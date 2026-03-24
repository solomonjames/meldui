//! Tauri event types emitted from the agent sidecar to the frontend.

use serde::{Deserialize, Serialize};

/// Permission request received from the sidecar.
#[derive(Debug, Deserialize, Serialize, Clone, specta::Type, tauri_specta::Event)]
pub struct AgentPermissionRequest {
    pub request_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
}

/// Review findings request received from the sidecar.
#[derive(Debug, Deserialize, Serialize, Clone, specta::Type, tauri_specta::Event)]
pub struct AgentReviewFindingsRequest {
    pub request_id: String,
    pub ticket_id: String,
    pub findings: serde_json::Value,
    pub summary: String,
}

/// Emitted when the agent sidecar initializes and reports its configuration.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct AgentInitMetadata {
    pub model: String,
    pub available_models: Vec<String>,
    pub tools: Vec<String>,
    pub slash_commands: Vec<String>,
    pub skills: Vec<String>,
    pub mcp_servers: Vec<McpServerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct McpServerInfo {
    pub name: String,
    pub status: String,
}

/// Emitted when a subtask is created by the agent.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct SubtaskCreated {
    pub subtask_id: String,
    pub parent_id: String,
}

/// Emitted when a subtask is updated by the agent.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct SubtaskUpdated {
    pub subtask_id: String,
    pub parent_id: String,
}

/// Emitted when a subtask is closed by the agent.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct SubtaskClosed {
    pub subtask_id: String,
    pub parent_id: String,
}

/// Emitted when a ticket section is updated by the agent.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct SectionUpdateEvent {
    pub ticket_id: String,
    pub section: String,
    #[serde(default)]
    pub section_id: Option<String>,
    pub content: String,
}

/// Emitted when the agent sends a notification.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct NotificationEvent {
    pub title: String,
    pub message: String,
    pub level: String,
}

/// Emitted when the agent provides a status update.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct StatusUpdateEvent {
    pub ticket_id: String,
    pub status_text: String,
}

/// Emitted when the agent reports a pull request URL.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct PrUrlReportedEvent {
    pub ticket_id: String,
    pub url: String,
}

// ── Pending request types for oneshot channels ──

pub(crate) struct PendingPermission {
    pub(crate) json_rpc_id: serde_json::Value,
}

pub(crate) struct PendingReview {
    pub(crate) json_rpc_id: serde_json::Value,
}
