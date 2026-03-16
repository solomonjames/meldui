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
    tickets_dir: Option<String>,
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
///
/// Override: set `MELDUI_AGENT_BINARY` env var to use a custom binary path
/// (e.g. the mock sidecar for E2E testing).
fn find_agent_binary() -> Option<PathBuf> {
    // 0. Environment variable override (for E2E testing with mock sidecar)
    if let Ok(override_path) = env::var("MELDUI_AGENT_BINARY") {
        let path = PathBuf::from(&override_path);
        if path.exists() {
            log::info!("agent: using override binary from MELDUI_AGENT_BINARY: {}", override_path);
            return Some(path);
        }
        log::warn!("agent: MELDUI_AGENT_BINARY set but path does not exist: {}", override_path);
    }

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
            "mcp__tickets".into(),
            "Read".into(),
            "Write".into(),
            "Edit".into(),
            "Bash".into(),
            "Glob".into(),
            "Grep".into(),
        ],
        "chat" => vec![
            "mcp__tickets".into(),
            "Read".into(),
            "Glob".into(),
            "Grep".into(),
            "WebSearch".into(),
            "WebFetch".into(),
        ],
        "review" => vec![
            "mcp__tickets".into(),
            "Read".into(),
            "Glob".into(),
            "Grep".into(),
        ],
        _ => vec![
            "mcp__tickets".into(),
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

    log::info!("agent: using binary at {:?}", agent_bin);

    // NDJSON capture file for recording sessions (set MELDUI_CAPTURE_NDJSON=path)
    let capture_file = env::var("MELDUI_CAPTURE_NDJSON").ok();
    if let Some(ref path) = capture_file {
        log::info!("agent: capturing NDJSON to {}", path);
    }

    let config = SidecarConfig {
        project_dir: project_dir.to_string(),
        system_prompt: None,
        allowed_tools,
        disallowed_tools: None,
        session_id: session_id.map(|s| s.to_string()),
        max_turns: Some(200),
        model: None,
        tickets_dir: Some(format!("{}/.meldui/tickets", project_dir)),
    };

    let tools_summary = config.allowed_tools.as_ref().map(|t| t.join(","));

    let execute_cmd = ExecuteCommand {
        cmd_type: "execute".to_string(),
        prompt: prompt.to_string(),
        config,
    };

    let execute_json = serde_json::to_string(&execute_cmd)
        .map_err(|e| format!("Failed to serialize execute command: {}", e))?;

    log::info!("agent: sending execute command for issue {} (session={}, tools={:?}, prompt_len={})",
        issue_id,
        session_id.unwrap_or("new"),
        tools_summary,
        prompt.len());

    let start_time = std::time::Instant::now();

    // Spawn the sidecar with augmented PATH + forward auth/env vars
    let mut cmd = Command::new(&agent_bin);
    cmd.env("PATH", augmented_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Forward auth-critical and runtime env vars
    for key in [
        "HOME",
        "USER",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ] {
        if let Ok(val) = env::var(key) {
            cmd.env(key, val);
        }
    }

    // Forward mock fixture dir for E2E testing
    if let Ok(fixture_dir) = env::var("MOCK_FIXTURE_DIR") {
        cmd.env("MOCK_FIXTURE_DIR", fixture_dir);
    }

    let mut child = cmd
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

    // Open capture file if MELDUI_CAPTURE_NDJSON is set
    let mut capture_writer = capture_file.as_ref().and_then(|path| {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
    });

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut response_text = String::new();
    let mut final_session_id = String::new();

    let read_result = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        async {
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("Failed to read sidecar output: {}", e))?
    {
        if line.trim().is_empty() {
            continue;
        }

        // Capture NDJSON line to file if enabled
        if let Some(ref mut writer) = capture_writer {
            use std::io::Write;
            let _ = writeln!(writer, "{}", &line);
        }

        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = app_handle.emit(
                    "workflow-step-output",
                    StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "stderr".to_string(),
                        content: format!("Malformed JSON from sidecar: {} (line: {})", e, &line[..line.len().min(200)]),
                    },
                );
                continue;
            }
        };

        let msg_type = json
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");

        // Log full JSON for each message (truncate large content fields)
        match msg_type {
            "text" | "tool_input" | "thinking" => {
                // High-frequency delta messages — log at debug with truncated content
                let content_len = json.get("content").and_then(|c| c.as_str()).map(|s| s.len()).unwrap_or(0);
                log::debug!("agent: NDJSON type={} content_len={}", msg_type, content_len);
            }
            "error" => log::error!("agent: NDJSON {}", line),
            _ => log::info!("agent: NDJSON {}", &line[..line.len().min(1000)]),
        }

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
    Ok::<(), String>(())
        }
    ).await;

    if read_result.is_err() {
        let _ = app_handle.emit(
            "workflow-step-output",
            StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "error".to_string(),
                content: "Agent sidecar timed out after 5 minutes".to_string(),
            },
        );
        // Kill the child process
        let _ = child.kill().await;
        return Err("Agent sidecar timed out after 5 minutes".to_string());
    }

    if let Err(e) = read_result.unwrap() {
        return Err(e);
    }

    // Wait for stderr reader
    let _ = stderr_handle.await;

    // Wait for child process
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for agent sidecar: {}", e))?;

    let elapsed = start_time.elapsed();
    log::info!("agent: sidecar exited with status {} (elapsed={:.1}s, response_len={})",
        status, elapsed.as_secs_f64(), response_text.len());

    // Clear the agent handle
    if let Some(state) = app_handle.try_state::<AgentState>() {
        let mut handle_guard = state.handle.lock().await;
        *handle_guard = None;
    }

    if !status.success() {
        return Err(format!(
            "Agent sidecar exited with status {}{}",
            status,
            if response_text.is_empty() { " and no output" } else { "" }
        ));
    }

    // Empty result on success exit is OK if errors were already emitted via events.
    // The sidecar now properly handles SDKResultError and emits error events before exiting.

    Ok((response_text, final_session_id))
}
