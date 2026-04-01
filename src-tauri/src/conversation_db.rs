//! Conversation database using libSQL for persistence.
//!
//! Manages per-project libSQL databases for conversation storage.

use std::collections::HashMap;
use std::path::PathBuf;

use libsql::{params, Builder};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::constants::{CONVERSATIONS_DIR, MELDUI_DIR};

/// Errors from conversation database operations.
#[derive(Debug, Error)]
pub(crate) enum ConversationDbError {
    #[error("database error: {0}")]
    Database(#[from] libsql::Error),

    #[error("failed to create database directory: {0}")]
    DirCreate(#[source] std::io::Error),
}

/// Configuration for opening a conversation database.
#[derive(Clone, Debug, Default)]
#[allow(dead_code)] // Available for programmatic DB configuration
pub(crate) struct ConversationDbConfig {
    pub db_path: String,
    pub encryption_key: Option<String>,
}

/// A single libSQL database for conversation persistence.
pub(crate) struct ConversationDb {
    #[allow(dead_code)]
    pub(crate) db: libsql::Database,
    #[allow(dead_code)]
    pub(crate) conn: libsql::Connection,
}

impl std::fmt::Debug for ConversationDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConversationDb")
            .field("db", &"<libsql::Database>")
            .finish()
    }
}

impl ConversationDb {
    /// Open (or create) a conversation database at the given path.
    ///
    /// For tests, pass `":memory:"` to get an in-memory database.
    /// If an encryption key is provided, it MUST be set via `PRAGMA key`
    /// before any other operations on the connection.
    pub(crate) async fn open(
        db_path: &str,
        encryption_key: Option<&str>,
    ) -> Result<Self, ConversationDbError> {
        let db = Builder::new_local(db_path).build().await?;
        let conn = db.connect()?;

        // PRAGMA key MUST be the first statement after opening the connection.
        // Note: encryption support depends on the libsql build having encryption enabled.
        if let Some(key) = encryption_key {
            conn.execute("PRAGMA key = ?", params![key]).await?;
        }

        // Enable WAL mode for better concurrent read performance
        // PRAGMA returns a row, so use query() not execute()
        conn.query("PRAGMA journal_mode=WAL", params![]).await?;

        ensure_schema(&conn).await?;

        Ok(Self { db, conn })
    }
}

/// Create all tables and indexes if they don't already exist.
async fn ensure_schema(conn: &libsql::Connection) -> Result<(), ConversationDbError> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS conversations (
            ticket_id TEXT PRIMARY KEY,
            session_id TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            event_count INTEGER NOT NULL DEFAULT 0,
            last_step_id TEXT
        );

        CREATE TABLE IF NOT EXISTS conversation_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            turn_id TEXT,
            step_id TEXT,
            event_type TEXT NOT NULL,
            role TEXT,
            content TEXT,
            timestamp TEXT NOT NULL,
            embedding BLOB
        );

        CREATE TABLE IF NOT EXISTS conversation_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id TEXT NOT NULL,
            step_id TEXT NOT NULL UNIQUE,
            label TEXT,
            status TEXT NOT NULL DEFAULT 'in_progress',
            started_at TEXT NOT NULL,
            completed_at TEXT,
            first_sequence INTEGER NOT NULL,
            last_sequence INTEGER
        );

        CREATE TABLE IF NOT EXISTS conversation_context (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id TEXT NOT NULL,
            turn_id TEXT,
            step_id TEXT,
            api_messages_json TEXT,
            token_count_in INTEGER NOT NULL DEFAULT 0,
            token_count_out INTEGER NOT NULL DEFAULT 0,
            cache_reads INTEGER NOT NULL DEFAULT 0,
            cache_writes INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0.0,
            model TEXT,
            timestamp TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversation_checkpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id TEXT NOT NULL,
            turn_id TEXT,
            step_id TEXT,
            commit_hash TEXT,
            branch TEXT,
            timestamp TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_ticket_sequence
            ON conversation_events (ticket_id, sequence);

        CREATE INDEX IF NOT EXISTS idx_events_ticket_step
            ON conversation_events (ticket_id, step_id);

        CREATE INDEX IF NOT EXISTS idx_events_ticket_turn
            ON conversation_events (ticket_id, turn_id);

        CREATE INDEX IF NOT EXISTS idx_events_ticket_type
            ON conversation_events (ticket_id, event_type);

        CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
            ticket_id,
            content,
            content='conversation_events',
            content_rowid='id',
            tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS conversation_events_ai AFTER INSERT ON conversation_events BEGIN
            INSERT INTO conversation_search(rowid, ticket_id, content) VALUES (new.id, new.ticket_id, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS conversation_events_ad AFTER DELETE ON conversation_events BEGIN
            INSERT INTO conversation_search(conversation_search, rowid, ticket_id, content) VALUES('delete', old.id, old.ticket_id, old.content);
        END;
        ",
    )
    .await?;

    // Attempt to create vector similarity index — libSQL-specific.
    // This may fail on builds without vector search support, so log and continue.
    if let Err(e) = conn
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_events_vector ON conversation_events (
                libsql_vector_idx(embedding, 'metric=cosine', 'compress_neighbors=float8', 'max_neighbors=64')
            );",
        )
        .await
    {
        log::warn!("Vector index creation skipped (not supported in this libSQL build): {e}");
    }

    Ok(())
}

/// Manages conversation databases across multiple projects.
///
/// Lazily initializes and caches a `ConversationDb` per project directory.
#[derive(Debug)]
pub(crate) struct ConversationDbManager {
    dbs: Mutex<HashMap<String, ConversationDb>>,
}

impl ConversationDbManager {
    pub(crate) fn new() -> Self {
        Self {
            dbs: Mutex::new(HashMap::new()),
        }
    }

    /// Get a libSQL connection for the given project directory.
    ///
    /// If no database exists yet for this project, one is created at
    /// `<project_dir>/.meldui/conversations/conversations.db`.
    /// The encryption key is read from project settings if available.
    pub(crate) async fn get_connection(
        &self,
        project_dir: &str,
    ) -> Result<libsql::Connection, ConversationDbError> {
        let mut guard = self.dbs.lock().await;

        if !guard.contains_key(project_dir) {
            let (db_path, encryption_key) = if project_dir == ":memory:" {
                (":memory:".to_string(), None)
            } else {
                let dir = PathBuf::from(project_dir)
                    .join(MELDUI_DIR)
                    .join(CONVERSATIONS_DIR);
                std::fs::create_dir_all(&dir).map_err(ConversationDbError::DirCreate)?;
                let path = dir.join("conversations.db").to_string_lossy().to_string();
                let key = crate::settings::get_encryption_key(project_dir);
                (path, key)
            };

            let db = ConversationDb::open(&db_path, encryption_key.as_deref()).await?;
            guard.insert(project_dir.to_string(), db);
        }

        let db = guard.get(project_dir).expect("just inserted");
        Ok(db.db.connect()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_schema_creation() {
        let db = ConversationDb::open(":memory:", None).await.unwrap();
        let conn = &db.conn;
        let mut rows = conn
            .query(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
                params![],
            )
            .await
            .unwrap();

        let mut tables = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            tables.push(row.get::<String>(0).unwrap());
        }

        assert!(tables.contains(&"conversations".to_string()));
        assert!(tables.contains(&"conversation_events".to_string()));
        assert!(tables.contains(&"conversation_steps".to_string()));
        assert!(tables.contains(&"conversation_context".to_string()));
        assert!(tables.contains(&"conversation_checkpoints".to_string()));
    }

    #[tokio::test]
    async fn test_wal_mode_enabled() {
        let db = ConversationDb::open(":memory:", None).await.unwrap();
        let mut rows = db
            .conn
            .query("PRAGMA journal_mode", params![])
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let mode: String = row.get(0).unwrap();
        // In-memory databases may return "memory" instead of "wal"
        assert!(
            mode == "wal" || mode == "memory",
            "Got journal_mode: {mode}"
        );
    }

    #[tokio::test]
    async fn test_indexes_created() {
        let db = ConversationDb::open(":memory:", None).await.unwrap();
        let mut rows = db
            .conn
            .query(
                "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
                params![],
            )
            .await
            .unwrap();

        let mut indexes = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            indexes.push(row.get::<String>(0).unwrap());
        }

        assert!(indexes.contains(&"idx_events_ticket_sequence".to_string()));
        assert!(indexes.contains(&"idx_events_ticket_step".to_string()));
        assert!(indexes.contains(&"idx_events_ticket_turn".to_string()));
        assert!(indexes.contains(&"idx_events_ticket_type".to_string()));
    }

    #[tokio::test]
    async fn test_db_manager_caches_connections() {
        let manager = ConversationDbManager::new();
        let _conn1 = manager.get_connection(":memory:").await.unwrap();
        let _conn2 = manager.get_connection(":memory:").await.unwrap();
    }

    #[tokio::test]
    async fn test_file_db_connections_share_state() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db").to_string_lossy().to_string();
        let db = ConversationDb::open(&db_path, None).await.unwrap();
        let conn2 = db.db.connect().unwrap();
        // File-backed connections share the same database
        conn2
            .execute(
                "INSERT INTO conversations (ticket_id, status, created_at, updated_at) VALUES ('test', 'active', 'now', 'now')",
                params![],
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_open_without_encryption_key_backward_compat() {
        // Opening without a key should work exactly as before.
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("nokey.db").to_string_lossy().to_string();
        let db = ConversationDb::open(&db_path, None).await.unwrap();
        db.conn
            .execute(
                "INSERT INTO conversations (ticket_id, status, created_at, updated_at) VALUES ('t1', 'active', 'now', 'now')",
                params![],
            )
            .await
            .unwrap();
        let mut rows = db
            .conn
            .query(
                "SELECT ticket_id FROM conversations WHERE ticket_id = 't1'",
                params![],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let tid: String = row.get(0).unwrap();
        assert_eq!(tid, "t1");
    }

    /// Test that opening a database with an encryption key succeeds and data round-trips.
    ///
    /// NOTE: This test requires a libsql build compiled with encryption support.
    /// The standard local-only libsql crate may not include it, so this test is
    /// ignored by default. Run explicitly with:
    ///   cargo test test_open_with_encryption_key -- --ignored
    #[tokio::test]
    #[ignore = "requires libsql build with encryption support (PRAGMA key)"]
    async fn test_open_with_encryption_key() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir
            .path()
            .join("encrypted.db")
            .to_string_lossy()
            .to_string();

        // Open with encryption key, write data
        {
            let db = ConversationDb::open(&db_path, Some("test-secret-key"))
                .await
                .unwrap();
            db.conn
                .execute(
                    "INSERT INTO conversations (ticket_id, status, created_at, updated_at) VALUES ('enc1', 'active', 'now', 'now')",
                    params![],
                )
                .await
                .unwrap();
        }

        // Re-open with the same key and read back
        {
            let db = ConversationDb::open(&db_path, Some("test-secret-key"))
                .await
                .unwrap();
            let mut rows = db
                .conn
                .query(
                    "SELECT ticket_id FROM conversations WHERE ticket_id = 'enc1'",
                    params![],
                )
                .await
                .unwrap();
            let row = rows.next().await.unwrap().unwrap();
            let tid: String = row.get(0).unwrap();
            assert_eq!(tid, "enc1");
        }
    }
}
