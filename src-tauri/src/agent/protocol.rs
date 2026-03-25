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

/// Ticket context sent to the supervisor for evaluation.
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub(crate) struct TicketContext {
    pub title: String,
    pub description: String,
    #[serde(rename = "acceptanceCriteria", skip_serializing_if = "Option::is_none")]
    pub acceptance_criteria: Option<String>,
    #[serde(rename = "currentStep")]
    pub current_step: StepContext,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub(crate) struct StepContext {
    pub index: u32,
    pub name: String,
    pub prompt: String,
}

/// Params for the supervisorEvaluate JSON-RPC request.
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub(crate) struct SupervisorEvaluateParams {
    #[serde(rename = "workerResponse")]
    pub worker_response: String,
    #[serde(rename = "ticketContext")]
    pub ticket_context: TicketContext,
    #[serde(rename = "systemPrompt", skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
}

/// Result from supervisorEvaluate.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
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
