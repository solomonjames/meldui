//! Project-level settings management (worktree config, workflow config).
use std::path::PathBuf;

use thiserror::Error;

use crate::constants::{MELDUI_DIR, SETTINGS_FILE};

use serde::{Deserialize, Serialize};

/// Structured error type for settings operations.
#[derive(Debug, Error)]
#[allow(clippy::enum_variant_names)]
pub(crate) enum SettingsError {
    #[error("failed to read settings")]
    ReadFailed(#[source] std::io::Error),

    #[error("failed to write settings")]
    WriteFailed(#[source] std::io::Error),

    #[error("failed to parse settings")]
    ParseFailed(#[source] serde_json::Error),

    #[error("failed to serialize settings")]
    SerializeFailed(#[source] serde_json::Error),

    #[error("failed to create settings directory")]
    DirCreateFailed(#[source] std::io::Error),
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, specta::Type)]
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

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct WorktreeSettings {
    /// Optional shell command to run after worktree creation (e.g., "bun install")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_command: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct ProjectSettings {
    #[serde(default)]
    pub sync: Option<SyncSettings>,
    #[serde(default)]
    pub worktree: Option<WorktreeSettings>,
}

fn settings_path(project_dir: &str) -> PathBuf {
    PathBuf::from(project_dir)
        .join(MELDUI_DIR)
        .join(SETTINGS_FILE)
}

fn get_settings_inner(project_dir: &str) -> Result<ProjectSettings, SettingsError> {
    let path = settings_path(project_dir);
    if !path.exists() {
        return Ok(ProjectSettings::default());
    }
    let content = std::fs::read_to_string(&path).map_err(SettingsError::ReadFailed)?;
    serde_json::from_str(&content).map_err(SettingsError::ParseFailed)
}

fn update_settings_inner(
    project_dir: &str,
    settings: &ProjectSettings,
) -> Result<(), SettingsError> {
    let path = settings_path(project_dir);

    // Ensure .meldui directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(SettingsError::DirCreateFailed)?;
        }
    }

    let content = serde_json::to_string_pretty(settings).map_err(SettingsError::SerializeFailed)?;
    std::fs::write(&path, content).map_err(SettingsError::WriteFailed)
}

pub fn get_settings(project_dir: &str) -> Result<ProjectSettings, String> {
    get_settings_inner(project_dir).map_err(|e| e.to_string())
}

pub fn update_settings(project_dir: &str, settings: &ProjectSettings) -> Result<(), String> {
    update_settings_inner(project_dir, settings).map_err(|e| e.to_string())
}
