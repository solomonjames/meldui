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
    encryption_key: Option<String>,
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

        Ok(Self {
            db,
            conn,
            encryption_key: encryption_key.map(|k| k.to_string()),
        })
    }

    /// Create a new connection that inherits the encryption key (if any).
    pub(crate) async fn new_connection(&self) -> Result<libsql::Connection, ConversationDbError> {
        let conn = self.db.connect()?;
        if let Some(ref key) = self.encryption_key {
            conn.execute("PRAGMA key = ?", params![key.clone()]).await?;
        }
        Ok(conn)
    }
}

/// Run all pending migrations to ensure the schema is up to date.
async fn ensure_schema(conn: &libsql::Connection) -> Result<(), ConversationDbError> {
    crate::schema::run_migrations(
        conn,
        "conversations",
        crate::schema::conversations::MIGRATIONS,
    )
    .await?;
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
        db.new_connection().await
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

    #[tokio::test]
    async fn test_new_connection_works_without_encryption() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("nc.db").to_string_lossy().to_string();
        let db = ConversationDb::open(&db_path, None).await.unwrap();

        // Write via original connection
        db.conn
            .execute(
                "INSERT INTO conversations (ticket_id, status, created_at, updated_at) VALUES ('nc1', 'active', 'now', 'now')",
                params![],
            )
            .await
            .unwrap();

        // Read via new_connection()
        let conn2 = db.new_connection().await.unwrap();
        let mut rows = conn2
            .query(
                "SELECT ticket_id FROM conversations WHERE ticket_id = 'nc1'",
                params![],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "nc1");
    }

    #[tokio::test]
    #[ignore = "requires libsql build with encryption support (PRAGMA key)"]
    async fn test_new_connection_inherits_encryption_key() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("enc_nc.db").to_string_lossy().to_string();
        let db = ConversationDb::open(&db_path, Some("secret-key"))
            .await
            .unwrap();

        // Write via original keyed connection
        db.conn
            .execute(
                "INSERT INTO conversations (ticket_id, status, created_at, updated_at) VALUES ('enc-nc', 'active', 'now', 'now')",
                params![],
            )
            .await
            .unwrap();

        // Read via new_connection() — should inherit PRAGMA key
        let conn2 = db.new_connection().await.unwrap();
        let mut rows = conn2
            .query(
                "SELECT ticket_id FROM conversations WHERE ticket_id = 'enc-nc'",
                params![],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "enc-nc");
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
