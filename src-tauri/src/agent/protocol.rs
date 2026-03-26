//! JSON-RPC 2.0 wire format types for agent sidecar communication.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub(crate) struct JsonRpcRequest {
    pub(crate) jsonrpc: &'static str,
    pub(crate) id: u64,
    pub(crate) method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) params: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct JsonRpcMessage {
    #[allow(dead_code)] // Present in JSON-RPC 2.0 spec; deserialized but not read directly
    pub(crate) jsonrpc: Option<String>,
    // Present if this is a request or notification
    pub(crate) method: Option<String>,
    pub(crate) params: Option<serde_json::Value>,
    // Present if this is a request (not notification)
    pub(crate) id: Option<serde_json::Value>,
    // Present if this is a response
    pub(crate) result: Option<serde_json::Value>,
    pub(crate) error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct JsonRpcError {
    #[allow(dead_code)] // Present in JSON-RPC 2.0 spec; deserialized but not read directly
    pub(crate) code: i64,
    pub(crate) message: String,
    #[allow(dead_code)] // Present in JSON-RPC 2.0 spec; deserialized but not read directly
    pub(crate) data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub(crate) struct JsonRpcResponse {
    pub(crate) jsonrpc: &'static str,
    pub(crate) id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<serde_json::Value>,
}

// ── Config sent as `query` params ──

#[derive(Clone, Debug, Serialize)]
pub(crate) struct SidecarConfig {
    pub(crate) project_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) disallowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_turns: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) tickets_dir: Option<String>,
}

// ── Supervisor protocol types ──

/// Params for the supervisorEvaluate JSON-RPC request.
#[derive(Debug, Serialize)]
pub(crate) struct SupervisorEvaluateParams {
    #[serde(rename = "workerResponse")]
    pub worker_response: String,
    /// Full ticket serialized as JSON string — gives the supervisor all fields/sections.
    #[serde(rename = "ticketJson")]
    pub ticket_json: String,
    /// Current step info.
    #[serde(rename = "stepIndex")]
    pub step_index: u32,
    #[serde(rename = "stepName")]
    pub step_name: String,
    #[serde(rename = "stepPrompt")]
    pub step_prompt: String,
    #[serde(rename = "systemPrompt", skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(rename = "projectDir", skip_serializing_if = "Option::is_none")]
    pub project_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

/// Result from supervisorEvaluate.
#[derive(Debug, Deserialize)]
pub(crate) struct SupervisorEvaluateResult {
    pub action: String,
    pub message: Option<String>,
    pub reasoning: Option<String>,
}

/// Params for queryFollowUp JSON-RPC request.
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub(crate) struct QueryFollowUpParams {
    pub message: String,
}
