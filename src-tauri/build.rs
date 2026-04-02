use std::fs;
use std::path::Path;

// Include the shared parsing/codegen logic from the lib source.
// This avoids duplicating the code between build.rs and the main crate.
// The module's #[cfg(test)] tests run via `cargo test --lib`.
#[path = "src/schema/codegen.rs"]
mod codegen;

use codegen::{generate_migrations_module, parse_migration_filename};

/// Scan migration directories and generate Rust modules.
fn generate_migration_modules() {
    let migrations_dir = Path::new("migrations");
    if !migrations_dir.is_dir() {
        return;
    }

    // Tell Cargo to re-run if migrations or the codegen logic changes.
    // Once any rerun-if-changed is emitted, Cargo's default "any file" tracking
    // is disabled — so we must explicitly list codegen.rs too.
    println!("cargo::rerun-if-changed=migrations/");
    println!("cargo::rerun-if-changed=src/schema/codegen.rs");

    let schema_dir = Path::new("src/schema");
    fs::create_dir_all(schema_dir).expect("failed to create src/schema/");

    let mut entries: Vec<_> = fs::read_dir(migrations_dir)
        .expect("failed to read migrations/")
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let db_name = entry.file_name().to_string_lossy().to_string();

        // Collect and parse SQL files
        let mut sql_files: Vec<_> = fs::read_dir(entry.path())
            .expect("failed to read migration subdirectory")
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".sql"))
            .collect();
        sql_files.sort_by_key(|e| e.file_name());

        let mut migrations = Vec::new();
        for file in &sql_files {
            let filename = file.file_name().to_string_lossy().to_string();
            if let Some(parsed) = parse_migration_filename(&filename) {
                migrations.push(parsed);
            } else {
                println!("cargo::warning=Skipping migration file with invalid name: {db_name}/{filename}");
            }
        }

        // Sort by version (chronological)
        migrations.sort();

        let module_src = generate_migrations_module(&db_name, &migrations);
        let out_path = schema_dir.join(format!("{db_name}.rs"));
        fs::write(&out_path, module_src).unwrap_or_else(|e| {
            panic!("failed to write {}: {e}", out_path.display());
        });
    }
}

fn main() {
    generate_migration_modules();
    tauri_build::build()
}
