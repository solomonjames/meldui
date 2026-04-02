//! Generic SQL migration runner for libSQL databases.
//!
//! Provides a reusable migration system that any database in the app can use.
//! Migrations are embedded at compile time via `include_str!` and auto-discovered
//! by `build.rs` from the `migrations/` directory.

#[allow(dead_code)] // Used by build.rs via #[path] and by tests
pub(crate) mod codegen;
pub(crate) mod conversations;

/// A single forward-only SQL migration.
pub(crate) struct Migration {
    /// Timestamp-based version string parsed from filename (e.g. "20260401000000").
    pub version: &'static str,
    /// Human-readable name parsed from filename (e.g. "initial_schema").
    pub name: &'static str,
    /// The SQL text, embedded via `include_str!`.
    pub sql: &'static str,
    /// If true, execution errors are logged and skipped (for optional features
    /// like vector indexes that depend on the libSQL build).
    pub allow_failure: bool,
}

/// Run all pending migrations on the given connection.
///
/// Creates a `schema_migrations` table if it doesn't exist, then applies any
/// migrations that haven't been recorded yet. Migrations must be provided in
/// version order (guaranteed by build.rs sorting).
pub(crate) async fn run_migrations(
    conn: &libsql::Connection,
    db_name: &str,
    migrations: &[Migration],
) -> Result<(), libsql::Error> {
    // 1. Ensure the schema_migrations table exists
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .await?;

    // 2. Query already-applied versions
    let mut rows = conn
        .query("SELECT version FROM schema_migrations", libsql::params![])
        .await?;
    let mut applied = std::collections::HashSet::new();
    while let Some(row) = rows.next().await? {
        applied.insert(row.get::<String>(0)?);
    }

    // 3. Apply pending migrations in order, each wrapped in a transaction
    // so the migration SQL and its schema_migrations record are atomic.
    for migration in migrations {
        if applied.contains(migration.version) {
            continue;
        }

        log::info!(
            "[{db_name}] Applying migration {}: {}",
            migration.version,
            migration.name
        );

        let now = chrono::Utc::now().to_rfc3339();

        // Build a transactional batch: BEGIN + migration SQL + record + COMMIT.
        // This ensures a crash can't leave a migration applied but unrecorded.
        let txn_sql = format!(
            "BEGIN;\n{}\nINSERT INTO schema_migrations (version, name, applied_at) VALUES ('{}', '{}', '{}');\nCOMMIT;",
            migration.sql, migration.version, migration.name, now
        );

        match conn.execute_batch(&txn_sql).await {
            Ok(_) => {}
            Err(e) if migration.allow_failure => {
                // Rollback in case BEGIN succeeded but the migration failed
                let _ = conn.execute_batch("ROLLBACK;").await;
                log::warn!(
                    "[{db_name}] Optional migration {} ({}) skipped: {e}",
                    migration.version,
                    migration.name
                );
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK;").await;
                return Err(e);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libsql::{params, Builder};

    async fn open_memory_db() -> (libsql::Database, libsql::Connection) {
        let db = Builder::new_local(":memory:").build().await.unwrap();
        let conn = db.connect().unwrap();
        (db, conn)
    }

    #[tokio::test]
    async fn test_creates_schema_migrations_table() {
        let (_db, conn) = open_memory_db().await;

        run_migrations(&conn, "test", &[]).await.unwrap();

        let mut rows = conn
            .query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
                params![],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap();
        assert!(row.is_some(), "schema_migrations table should exist");
    }

    #[tokio::test]
    async fn test_applies_single_migration() {
        let (_db, conn) = open_memory_db().await;

        let migrations = &[Migration {
            version: "20260401000000",
            name: "create_users",
            sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
            allow_failure: false,
        }];

        run_migrations(&conn, "test", migrations).await.unwrap();

        // Verify the table was created
        let mut rows = conn
            .query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
                params![],
            )
            .await
            .unwrap();
        assert!(
            rows.next().await.unwrap().is_some(),
            "users table should exist"
        );

        // Verify migration was recorded
        let mut rows = conn
            .query(
                "SELECT version, name FROM schema_migrations WHERE version = '20260401000000'",
                params![],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "20260401000000");
        assert_eq!(row.get::<String>(1).unwrap(), "create_users");
    }

    #[tokio::test]
    async fn test_applies_migrations_in_order() {
        let (_db, conn) = open_memory_db().await;

        let migrations = &[
            Migration {
                version: "20260401000000",
                name: "create_users",
                sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
                allow_failure: false,
            },
            Migration {
                version: "20260401000001",
                name: "add_email",
                sql: "ALTER TABLE users ADD COLUMN email TEXT;",
                allow_failure: false,
            },
        ];

        run_migrations(&conn, "test", migrations).await.unwrap();

        // Verify both migrations applied — the email column should exist
        conn.execute(
            "INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')",
            params![],
        )
        .await
        .unwrap();

        // Verify both recorded
        let mut rows = conn
            .query("SELECT COUNT(*) FROM schema_migrations", params![])
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<i64>(0).unwrap(), 2);
    }

    #[tokio::test]
    async fn test_skips_already_applied() {
        let (_db, conn) = open_memory_db().await;

        let migrations = &[Migration {
            version: "20260401000000",
            name: "create_users",
            sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
            allow_failure: false,
        }];

        // Run twice
        run_migrations(&conn, "test", migrations).await.unwrap();
        run_migrations(&conn, "test", migrations).await.unwrap();

        // Should still have exactly one entry
        let mut rows = conn
            .query("SELECT COUNT(*) FROM schema_migrations", params![])
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<i64>(0).unwrap(), 1);
    }

    #[tokio::test]
    async fn test_allow_failure_continues() {
        let (_db, conn) = open_memory_db().await;

        let migrations = &[
            Migration {
                version: "20260401000000",
                name: "create_users",
                sql: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
                allow_failure: false,
            },
            Migration {
                version: "20260401000001",
                name: "bad_optional",
                sql: "THIS IS NOT VALID SQL;",
                allow_failure: true,
            },
            Migration {
                version: "20260401000002",
                name: "add_column",
                sql: "ALTER TABLE users ADD COLUMN name TEXT;",
                allow_failure: false,
            },
        ];

        // Should not error despite the bad optional migration
        run_migrations(&conn, "test", migrations).await.unwrap();

        // First and third migrations should be recorded, second should NOT
        let mut rows = conn
            .query(
                "SELECT version FROM schema_migrations ORDER BY version",
                params![],
            )
            .await
            .unwrap();
        let mut versions = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            versions.push(row.get::<String>(0).unwrap());
        }
        assert_eq!(versions, vec!["20260401000000", "20260401000002"]);

        // Third migration should have worked
        conn.execute("INSERT INTO users (id, name) VALUES (1, 'Bob')", params![])
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_strict_migration_propagates_error() {
        let (_db, conn) = open_memory_db().await;

        let migrations = &[Migration {
            version: "20260401000000",
            name: "bad_strict",
            sql: "THIS IS NOT VALID SQL;",
            allow_failure: false,
        }];

        let result = run_migrations(&conn, "test", migrations).await;
        assert!(
            result.is_err(),
            "strict migration with invalid SQL should error"
        );
    }

    #[tokio::test]
    async fn test_records_applied_at_timestamp() {
        let (_db, conn) = open_memory_db().await;

        let migrations = &[Migration {
            version: "20260401000000",
            name: "create_users",
            sql: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
            allow_failure: false,
        }];

        run_migrations(&conn, "test", migrations).await.unwrap();

        let mut rows = conn
            .query(
                "SELECT applied_at FROM schema_migrations WHERE version = '20260401000000'",
                params![],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        let applied_at: String = row.get(0).unwrap();

        // Should be a valid ISO-8601 timestamp (parseable by chrono)
        assert!(
            chrono::DateTime::parse_from_rfc3339(&applied_at).is_ok(),
            "applied_at should be a valid RFC3339 timestamp, got: {applied_at}"
        );
    }
}
