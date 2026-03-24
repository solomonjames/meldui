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

#[derive(Debug, Serialize, Clone)]
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
