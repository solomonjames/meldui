use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::claude::StreamChunk;

/// Config sent to the agent sidecar as the first stdin line.
#[derive(Debug, Serialize, Clone)]
struct SidecarConfig {
    project_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disallowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_turns: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bd_binary_path: Option<String>,
}

/// Execute command sent on stdin first line.
#[derive(Debug, Serialize)]
struct ExecuteCommand {
    #[serde(rename = "type")]
    cmd_type: String,
    prompt: String,
    config: SidecarConfig,
}

/// Permission response sent on stdin.
#[derive(Debug, Serialize)]
struct PermissionResponse {
    #[serde(rename = "type")]
    cmd_type: String,
    request_id: String,
    allowed: bool,
}

/// Cancel command sent on stdin.
#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct CancelCommand {
    #[serde(rename = "type")]
    cmd_type: String,
}

/// Permission request received from the sidecar on stdout.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AgentPermissionRequest {
    pub request_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
}

/// Active agent handle — holds the child process stdin for sending commands.
pub struct AgentHandle {
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
}

impl AgentHandle {
    /// Send a permission response to the sidecar.
    pub async fn respond_to_permission(
        &self,
        request_id: &str,
        allowed: bool,
    ) -> Result<(), String> {
        let response = PermissionResponse {
            cmd_type: "permission_response".to_string(),
            request_id: request_id.to_string(),
            allowed,
        };
        let json =
            serde_json::to_string(&response).map_err(|e| format!("Serialize error: {}", e))?;

        let mut stdin_guard = self.stdin.lock().await;
        if let Some(stdin) = stdin_guard.as_mut() {
            stdin
                .write_all(format!("{}\n", json).as_bytes())
                .await
                .map_err(|e| format!("Failed to write to sidecar stdin: {}", e))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush sidecar stdin: {}", e))?;
        } else {
            return Err("Agent sidecar stdin not available".to_string());
        }

        Ok(())
    }

    /// Send cancel command to the sidecar.
    #[allow(dead_code)]
    pub async fn cancel(&self) -> Result<(), String> {
        let cmd = CancelCommand {
            cmd_type: "cancel".to_string(),
        };
        let json = serde_json::to_string(&cmd).map_err(|e| format!("Serialize error: {}", e))?;

        let mut stdin_guard = self.stdin.lock().await;
        if let Some(stdin) = stdin_guard.as_mut() {
            stdin
                .write_all(format!("{}\n", json).as_bytes())
                .await
                .map_err(|e| format!("Failed to write cancel to sidecar: {}", e))?;
            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush cancel: {}", e))?;
        }

        Ok(())
    }
}

/// Managed state for the active agent handle.
pub struct AgentState {
    pub handle: Mutex<Option<AgentHandle>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }
}

/// Find the agent sidecar binary.
///
/// In production: next to the Tauri app executable (bundled via externalBin).
/// In dev: built by `bun run agent:build` in src-tauri/binaries/.
fn find_agent_binary() -> Option<PathBuf> {
    // 1. Check next to the app executable (Tauri externalBin placement)
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let arch = if cfg!(target_arch = "aarch64") {
                "aarch64"
            } else {
                "x86_64"
            };
            let sidecar_name = format!("agent-{}-apple-darwin", arch);
            let sidecar = exe_dir.join(&sidecar_name);
            if sidecar.exists() {
                return Some(sidecar);
            }
            // Also check without arch suffix (Tauri sometimes uses just the name)
            let sidecar_plain = exe_dir.join("agent");
            if sidecar_plain.exists() {
                return Some(sidecar_plain);
            }
        }
    }

    // 2. Dev mode: check src-tauri/binaries/ relative to manifest dir
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    };
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("agent-{}-apple-darwin", arch));
    if dev_path.exists() {
        return Some(dev_path);
    }

    None
}

/// Find the bd binary path to pass to the sidecar.
fn find_bd_path() -> Option<String> {
    // Reuse the same search logic as beads.rs
    let home = env::var("HOME").unwrap_or_default();
    let candidates = [
        "/opt/homebrew/bin/bd".to_string(),
        "/usr/local/bin/bd".to_string(),
        format!("{}/.local/bin/bd", home),
        format!("{}/go/bin/bd", home),
    ];

    for path in &candidates {
        if PathBuf::from(path).exists() {
            return Some(path.clone());
        }
    }

    if let Ok(output) = std::process::Command::new("which").arg("bd").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    None
}

/// Build augmented PATH that includes common binary locations.
fn augmented_path() -> String {
    let home = env::var("HOME").unwrap_or_default();
    let existing = env::var("PATH").unwrap_or_default();

    let extra_dirs = [
        format!("{}/.local/bin", home),
        format!("{}/.bun/bin", home),
        format!("{}/.npm-global/bin", home),
        format!("{}/.claude/bin", home),
        format!("{}/go/bin", home),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
    ];

    let mut parts: Vec<String> = extra_dirs
        .iter()
        .filter(|d| PathBuf::from(d).exists())
        .cloned()
        .collect();

    if !existing.is_empty() {
        parts.push(existing);
    }

    parts.join(":")
}

/// Determine allowed tools based on step view type.
pub fn tools_for_view(view: &str) -> Vec<String> {
    match view {
        "progress" => vec![
            "mcp__beads".into(),
            "Read".into(),
            "Write".into(),
            "Edit".into(),
            "Bash".into(),
            "Glob".into(),
            "Grep".into(),
        ],
        "chat" => vec![
            "mcp__beads".into(),
            "Read".into(),
            "Glob".into(),
            "Grep".into(),
            "WebSearch".into(),
            "WebFetch".into(),
        ],
        "review" => vec![
            "mcp__beads".into(),
            "Read".into(),
            "Glob".into(),
            "Grep".into(),
        ],
        _ => vec![
            "mcp__beads".into(),
            "Read".into(),
            "Write".into(),
            "Edit".into(),
            "Bash".into(),
            "Glob".into(),
            "Grep".into(),
        ],
    }
}

/// Execute a workflow step via the agent sidecar.
///
/// Returns (response_text, session_id).
pub async fn execute_step(
    project_dir: &str,
    issue_id: &str,
    prompt: &str,
    session_id: Option<&str>,
    allowed_tools: Option<Vec<String>>,
    app_handle: &tauri::AppHandle,
) -> Result<(String, String), String> {
    let agent_bin = find_agent_binary().ok_or_else(|| {
        "Agent sidecar binary not found. Run 'bun run agent:build' first.".to_string()
    })?;

    let config = SidecarConfig {
        project_dir: project_dir.to_string(),
        system_prompt: None,
        allowed_tools,
        disallowed_tools: None,
        session_id: session_id.map(|s| s.to_string()),
        max_turns: Some(200),
        model: None,
        bd_binary_path: find_bd_path(),
    };

    let execute_cmd = ExecuteCommand {
        cmd_type: "execute".to_string(),
        prompt: prompt.to_string(),
        config,
    };

    let execute_json = serde_json::to_string(&execute_cmd)
        .map_err(|e| format!("Failed to serialize execute command: {}", e))?;

    // Spawn the sidecar with augmented PATH
    let mut child = Command::new(&agent_bin)
        .env("PATH", augmented_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn agent sidecar: {}", e))?;

    // Send execute command on stdin
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture sidecar stdin".to_string())?;

    stdin
        .write_all(format!("{}\n", execute_json).as_bytes())
        .await
        .map_err(|e| format!("Failed to write to sidecar stdin: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush sidecar stdin: {}", e))?;

    // Store stdin in agent state for permission responses
    let stdin_arc = Arc::new(Mutex::new(Some(stdin)));
    let agent_handle = AgentHandle {
        stdin: stdin_arc.clone(),
    };

    // Store the handle in Tauri managed state
    if let Some(state) = app_handle.try_state::<AgentState>() {
        let mut handle_guard = state.handle.lock().await;
        *handle_guard = Some(agent_handle);
    }

    // Read stdout NDJSON
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture sidecar stdout".to_string())?;

    // Also capture stderr for debugging
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture sidecar stderr".to_string())?;

    let stderr_app = app_handle.clone();
    let stderr_issue_id = issue_id.to_string();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                let _ = stderr_app.emit(
                    "workflow-step-output",
                    StreamChunk {
                        issue_id: stderr_issue_id.clone(),
                        chunk_type: "stderr".to_string(),
                        content: line,
                    },
                );
            }
        }
    });

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut response_text = String::new();
    let mut final_session_id = String::new();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("Failed to read sidecar output: {}", e))?
    {
        if line.trim().is_empty() {
            continue;
        }

        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let msg_type = json
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");

        match msg_type {
            "session" => {
                if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                    final_session_id = sid.to_string();
                }
            }
            "text" => {
                if let Some(content) = json.get("content").and_then(|c| c.as_str()) {
                    let _ = app_handle.emit(
                        "workflow-step-output",
                        StreamChunk {
                            issue_id: issue_id.to_string(),
                            chunk_type: "text".to_string(),
                            content: content.to_string(),
                        },
                    );
                }
            }
            "tool_start" => {
                let tool_name = json
                    .get("tool_name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown");
                let tool_id = json.get("tool_id").and_then(|i| i.as_str()).unwrap_or("");
                let payload = serde_json::json!({
                    "tool_name": tool_name,
                    "tool_id": tool_id,
                });
                let _ = app_handle.emit(
                    "workflow-step-output",
                    StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "tool_start".to_string(),
                        content: payload.to_string(),
                    },
                );
            }
            "tool_input" => {
                if let Some(content) = json.get("content").and_then(|c| c.as_str()) {
                    let _ = app_handle.emit(
                        "workflow-step-output",
                        StreamChunk {
                            issue_id: issue_id.to_string(),
                            chunk_type: "tool_input".to_string(),
                            content: content.to_string(),
                        },
                    );
                }
            }
            "tool_end" => {
                let tool_id = json.get("tool_id").and_then(|i| i.as_str()).unwrap_or("0");
                let _ = app_handle.emit(
                    "workflow-step-output",
                    StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "tool_end".to_string(),
                        content: tool_id.to_string(),
                    },
                );
            }
            "tool_result" => {
                let tool_id = json.get("tool_id").and_then(|i| i.as_str()).unwrap_or("");
                let content = json.get("content").and_then(|c| c.as_str()).unwrap_or("");
                let is_error = json
                    .get("is_error")
                    .and_then(|e| e.as_bool())
                    .unwrap_or(false);
                let payload = serde_json::json!({
                    "tool_id": tool_id,
                    "content": content,
                    "is_error": is_error,
                });
                let _ = app_handle.emit(
                    "workflow-step-output",
                    StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "tool_result".to_string(),
                        content: payload.to_string(),
                    },
                );
            }
            "thinking" => {
                if let Some(content) = json.get("content").and_then(|c| c.as_str()) {
                    let _ = app_handle.emit(
                        "workflow-step-output",
                        StreamChunk {
                            issue_id: issue_id.to_string(),
                            chunk_type: "thinking".to_string(),
                            content: content.to_string(),
                        },
                    );
                }
            }
            "permission_request" => {
                if let Ok(perm_req) = serde_json::from_value::<AgentPermissionRequest>(json.clone())
                {
                    let _ = app_handle.emit("agent-permission-request", perm_req);
                }
            }
            "result" => {
                if let Some(content) = json.get("content").and_then(|c| c.as_str()) {
                    response_text = content.to_string();
                    let _ = app_handle.emit(
                        "workflow-step-output",
                        StreamChunk {
                            issue_id: issue_id.to_string(),
                            chunk_type: "result".to_string(),
                            content: content.to_string(),
                        },
                    );
                }
                if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                    if !sid.is_empty() {
                        final_session_id = sid.to_string();
                    }
                }
            }
            "error" => {
                let message = json
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown agent error");
                let _ = app_handle.emit(
                    "workflow-step-output",
                    StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "error".to_string(),
                        content: message.to_string(),
                    },
                );
            }
            _ => {}
        }
    }

    // Wait for stderr reader
    let _ = stderr_handle.await;

    // Wait for child process
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for agent sidecar: {}", e))?;

    // Clear the agent handle
    if let Some(state) = app_handle.try_state::<AgentState>() {
        let mut handle_guard = state.handle.lock().await;
        *handle_guard = None;
    }

    if response_text.is_empty() && !status.success() {
        return Err("Agent sidecar failed with no output".to_string());
    }

    Ok((response_text, final_session_id))
}
