use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct SyncSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub auto_push: bool,
    #[serde(default)]
    pub config: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct WorktreeSettings {
    /// Optional shell command to run after worktree creation (e.g., "bun install")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_command: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, specta::Type)]
pub struct ProjectSettings {
    #[serde(default)]
    pub sync: Option<SyncSettings>,
    #[serde(default)]
    pub worktree: Option<WorktreeSettings>,
}

fn settings_path(project_dir: &str) -> PathBuf {
    PathBuf::from(project_dir)
        .join(".meldui")
        .join("settings.json")
}

pub fn get_settings(project_dir: &str) -> Result<ProjectSettings, String> {
    let path = settings_path(project_dir);
    if !path.exists() {
        return Ok(ProjectSettings::default());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))
}

pub fn update_settings(project_dir: &str, settings: &ProjectSettings) -> Result<(), String> {
    let path = settings_path(project_dir);

    // Ensure .meldui directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings directory: {}", e))?;
        }
    }

    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write settings: {}", e))
}
