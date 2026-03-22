use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Manager;
use tauri_specta::Event;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::claude::StreamChunk;

// ── JSON-RPC 2.0 Structs ──

#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcMessage {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    // Present if this is a request or notification
    method: Option<String>,
    params: Option<serde_json::Value>,
    // Present if this is a request (not notification)
    id: Option<serde_json::Value>,
    // Present if this is a response
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    #[allow(dead_code)]
    code: i64,
    message: String,
    #[allow(dead_code)]
    data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<serde_json::Value>,
}

// ── Config sent as `query` params ──

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

// ── Event types emitted to frontend (unchanged) ──

/// Permission request received from the sidecar.
#[derive(Debug, Deserialize, Serialize, Clone, specta::Type, tauri_specta::Event)]
pub struct AgentPermissionRequest {
    pub request_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
}

/// Feedback request received from the sidecar.
#[derive(Debug, Deserialize, Serialize, Clone, specta::Type, tauri_specta::Event)]
pub struct AgentFeedbackRequest {
    pub request_id: String,
    pub ticket_id: String,
    pub summary: String,
}

/// Review findings request received from the sidecar.
#[derive(Debug, Deserialize, Serialize, Clone, specta::Type, tauri_specta::Event)]
pub struct AgentReviewFindingsRequest {
    pub request_id: String,
    pub ticket_id: String,
    pub findings: serde_json::Value,
    pub summary: String,
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

/// Emitted when a workflow step is complete.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct StepCompleteEvent {
    pub ticket_id: String,
    pub summary: String,
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

struct PendingPermission {
    json_rpc_id: serde_json::Value,
}

struct PendingFeedback {
    json_rpc_id: serde_json::Value,
}

struct PendingReview {
    json_rpc_id: serde_json::Value,
}

/// Active agent handle — holds socket writer and pending request channels.
pub struct AgentHandle {
    socket_writer: Arc<Mutex<tokio::io::WriteHalf<UnixStream>>>,
    pending_permission: Arc<Mutex<Option<PendingPermission>>>,
    pending_feedback: Arc<Mutex<Option<PendingFeedback>>>,
    pending_review: Arc<Mutex<Option<PendingReview>>>,
    next_id: Arc<AtomicU64>,
}

impl AgentHandle {
    /// Send a JSON-RPC message over the socket.
    async fn send_raw(&self, json: &str) -> Result<(), String> {
        let mut writer = self.socket_writer.lock().await;
        writer
            .write_all(format!("{}\n", json).as_bytes())
            .await
            .map_err(|e| format!("Failed to write to socket: {}", e))?;
        writer
            .flush()
            .await
            .map_err(|e| format!("Failed to flush socket: {}", e))?;
        Ok(())
    }

    /// Send a JSON-RPC response.
    async fn send_response(
        &self,
        id: serde_json::Value,
        result: serde_json::Value,
    ) -> Result<(), String> {
        let response = JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        };
        let json =
            serde_json::to_string(&response).map_err(|e| format!("Serialize error: {}", e))?;
        self.send_raw(&json).await
    }

    /// Send a permission response — resolves the pending oneshot channel.
    pub async fn respond_to_permission(
        &self,
        _request_id: &str,
        allowed: bool,
    ) -> Result<(), String> {
        let mut pending = self.pending_permission.lock().await;
        if let Some(p) = pending.take() {
            // Send JSON-RPC response to sidecar
            let decision = if allowed { "allow" } else { "deny" };
            self.send_response(p.json_rpc_id, serde_json::json!({ "decision": decision }))
                .await?;
            Ok(())
        } else {
            Err("No pending permission request".to_string())
        }
    }

    /// Send a feedback response.
    pub async fn respond_to_feedback(
        &self,
        _request_id: &str,
        approved: bool,
        feedback: Option<String>,
    ) -> Result<(), String> {
        let mut pending = self.pending_feedback.lock().await;
        if let Some(p) = pending.take() {
            self.send_response(
                p.json_rpc_id,
                serde_json::json!({ "approved": approved, "feedback": feedback }),
            )
            .await?;
            Ok(())
        } else {
            Err("No pending feedback request".to_string())
        }
    }

    /// Send a review response.
    pub async fn respond_to_review(
        &self,
        _request_id: &str,
        submission: serde_json::Value,
    ) -> Result<(), String> {
        let mut pending = self.pending_review.lock().await;
        if let Some(p) = pending.take() {
            self.send_response(
                p.json_rpc_id,
                serde_json::json!({ "submission": submission }),
            )
            .await?;
            Ok(())
        } else {
            Err("No pending review request".to_string())
        }
    }

    /// Send cancel JSON-RPC request.
    #[allow(dead_code)]
    pub async fn cancel(&self) -> Result<(), String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: "cancel".to_string(),
            params: Some(serde_json::json!({})),
        };
        let json =
            serde_json::to_string(&request).map_err(|e| format!("Serialize error: {}", e))?;
        self.send_raw(&json).await
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
            log::info!(
                "agent: using override binary from MELDUI_AGENT_BINARY: {}",
                override_path
            );
            return Some(path);
        }
        log::warn!(
            "agent: MELDUI_AGENT_BINARY set but path does not exist: {}",
            override_path
        );
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

/// Clean up stale socket files from dead sidecar processes.
fn cleanup_stale_sockets() {
    let tmpdir = env::temp_dir();
    let entries = match std::fs::read_dir(&tmpdir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let filename = match entry.file_name().into_string() {
            Ok(f) => f,
            Err(_) => continue,
        };
        if !filename.starts_with("meldui-sidecar-") || !filename.ends_with(".sock") {
            continue;
        }
        let pid_str = &filename["meldui-sidecar-".len()..filename.len() - ".sock".len()];
        let pid: i32 = match pid_str.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        // Check if PID is still running via kill(pid, 0) syscall
        let alive = unsafe { libc::kill(pid as libc::pid_t, 0) == 0 };
        if !alive {
            log::info!(
                "agent: removing stale socket {:?} (pid {} dead)",
                entry.path(),
                pid
            );
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Determine allowed tools based on step view type.
pub fn tools_for_view(view: &str) -> Vec<String> {
    match view {
        "progress" => vec![
            "mcp__meldui".into(),
            "Read".into(),
            "Write".into(),
            "Edit".into(),
            "Bash".into(),
            "Glob".into(),
            "Grep".into(),
        ],
        "chat" => vec![
            "mcp__meldui".into(),
            "Read".into(),
            "Glob".into(),
            "Grep".into(),
            "WebSearch".into(),
            "WebFetch".into(),
        ],
        "review" => vec![
            "mcp__meldui".into(),
            "Read".into(),
            "Glob".into(),
            "Grep".into(),
        ],
        _ => vec![
            "mcp__meldui".into(),
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
    tickets_dir_override: Option<&str>,
    canonical_project_dir: Option<&str>,
) -> Result<(String, String), String> {
    let agent_bin = find_agent_binary().ok_or_else(|| {
        "Agent sidecar binary not found. Run 'bun run agent:build' first.".to_string()
    })?;

    log::info!("agent: using binary at {:?}", agent_bin);

    // Clean up stale sockets from dead processes
    cleanup_stale_sockets();

    // NDJSON capture file for recording sessions (set MELDUI_CAPTURE_NDJSON=path)
    let capture_file = env::var("MELDUI_CAPTURE_NDJSON").ok();
    if let Some(ref path) = capture_file {
        log::info!("agent: capturing messages to {}", path);
    }

    let config = SidecarConfig {
        project_dir: project_dir.to_string(),
        system_prompt: None,
        allowed_tools,
        disallowed_tools: None,
        session_id: session_id.map(|s| s.to_string()),
        max_turns: Some(200),
        model: None,
        tickets_dir: Some(
            tickets_dir_override
                .map(|d| d.to_string())
                .unwrap_or_else(|| format!("{}/.meldui/tickets", project_dir)),
        ),
    };

    let tools_summary = config.allowed_tools.as_ref().map(|t| t.join(","));

    log::info!(
        "agent: executing for issue {} (session={}, tools={:?}, prompt_len={})",
        issue_id,
        session_id.unwrap_or("new"),
        tools_summary,
        prompt.len()
    );

    let start_time = std::time::Instant::now();

    // Spawn the sidecar with augmented PATH + forward auth/env vars
    // stdout is captured only for SOCKET_PATH announcement
    // stdin is NOT piped (no longer used for IPC)
    let mut cmd = Command::new(&agent_bin);
    cmd.env("PATH", augmented_path())
        .stdin(Stdio::null())
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

    // ── Read SOCKET_PATH from stdout ──

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture sidecar stdout".to_string())?;

    let mut stdout_reader = BufReader::new(stdout);
    let mut first_line = String::new();

    let socket_path = {
        let read_result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            stdout_reader.read_line(&mut first_line),
        )
        .await;

        match read_result {
            Err(_) => {
                let _ = child.kill().await;
                return Err("Sidecar failed to announce socket path within 10 seconds".to_string());
            }
            Ok(Err(e)) => {
                let _ = child.kill().await;
                return Err(format!("Failed to read sidecar stdout: {}", e));
            }
            Ok(Ok(0)) => {
                let _ = child.kill().await;
                return Err("Sidecar exited before announcing socket path".to_string());
            }
            Ok(Ok(_)) => {
                let trimmed = first_line.trim();
                if let Some(path) = trimmed.strip_prefix("SOCKET_PATH=") {
                    PathBuf::from(path)
                } else {
                    let _ = child.kill().await;
                    return Err(format!(
                        "Sidecar printed unexpected first line (expected SOCKET_PATH=...): {}",
                        &trimmed[..trimmed.len().min(200)]
                    ));
                }
            }
        }
    };

    log::info!("agent: connecting to socket at {:?}", socket_path);

    // ── Connect to Unix socket ──

    let stream = UnixStream::connect(&socket_path)
        .await
        .map_err(|e| format!("Failed to connect to sidecar socket: {}", e))?;

    let (read_half, write_half) = tokio::io::split(stream);
    let write_half = Arc::new(Mutex::new(write_half));
    let next_id = Arc::new(AtomicU64::new(1));

    // ── Set up AgentHandle ──

    let pending_permission: Arc<Mutex<Option<PendingPermission>>> = Arc::new(Mutex::new(None));
    let pending_feedback: Arc<Mutex<Option<PendingFeedback>>> = Arc::new(Mutex::new(None));
    let pending_review: Arc<Mutex<Option<PendingReview>>> = Arc::new(Mutex::new(None));

    let agent_handle = AgentHandle {
        socket_writer: write_half.clone(),
        pending_permission: pending_permission.clone(),
        pending_feedback: pending_feedback.clone(),
        pending_review: pending_review.clone(),
        next_id: next_id.clone(),
    };

    // Store the handle in Tauri managed state
    if let Some(state) = app_handle.try_state::<AgentState>() {
        let mut handle_guard = state.handle.lock().await;
        *handle_guard = Some(agent_handle);
    }

    // ── Send `query` JSON-RPC request ──

    let query_id = next_id.fetch_add(1, Ordering::Relaxed);
    let query_request = JsonRpcRequest {
        jsonrpc: "2.0",
        id: query_id,
        method: "query".to_string(),
        params: Some(serde_json::json!({
            "prompt": prompt,
            "config": config,
        })),
    };
    let query_json = serde_json::to_string(&query_request)
        .map_err(|e| format!("Failed to serialize query request: {}", e))?;

    {
        let mut writer = write_half.lock().await;
        writer
            .write_all(format!("{}\n", query_json).as_bytes())
            .await
            .map_err(|e| format!("Failed to write query to socket: {}", e))?;
        writer
            .flush()
            .await
            .map_err(|e| format!("Failed to flush socket: {}", e))?;
    }

    // Capture to file if enabled
    if let Some(ref path) = capture_file {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            use std::io::Write;
            let _ = writeln!(f, "> {}", query_json);
        }
    }

    // ── Also capture stderr for debugging ──

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
                let _ = StreamChunk {
                    issue_id: stderr_issue_id.clone(),
                    chunk_type: "stderr".to_string(),
                    content: line,
                }
                .emit(&stderr_app);
            }
        }
    });

    // ── Open capture file for ongoing writes ──

    let mut capture_writer = capture_file.as_ref().and_then(|path| {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()
    });

    // ── Read loop: process JSON-RPC messages from socket ──

    let socket_reader = BufReader::new(read_half);
    let mut lines = socket_reader.lines();
    let mut response_text = String::new();
    let mut final_session_id = String::new();

    let idle_timeout = std::time::Duration::from_secs(120);
    let mut timed_out = false;
    let mut got_query_response = false;

    let read_result: Result<(), String> = 'outer: loop {
        let line_result = tokio::time::timeout(idle_timeout, lines.next_line()).await;
        let line = match line_result {
            Err(_) => {
                timed_out = true;
                break 'outer Ok(());
            }
            Ok(Err(e)) => break 'outer Err(format!("Failed to read from socket: {}", e)),
            Ok(Ok(None)) => break 'outer Ok(()),
            Ok(Ok(Some(line))) => line,
        };

        if line.trim().is_empty() {
            continue;
        }

        // Capture received message
        if let Some(ref mut writer) = capture_writer {
            use std::io::Write;
            let _ = writeln!(writer, "{}", &line);
        }

        let msg: JsonRpcMessage = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "stderr".to_string(),
                    content: format!(
                        "Malformed JSON-RPC from sidecar: {} (line: {})",
                        e,
                        &line[..line.len().min(200)]
                    ),
                }
                .emit(app_handle);
                continue;
            }
        };

        // ── Handle JSON-RPC response (to our query/cancel requests) ──

        if msg.method.is_none() && (msg.result.is_some() || msg.error.is_some()) {
            // This is a response to a request we sent
            if let Some(ref id) = msg.id {
                if id.as_u64() == Some(query_id) {
                    // Response to our `query` request
                    if let Some(ref err) = msg.error {
                        break 'outer Err(format!("Query failed: {}", err.message));
                    }
                    got_query_response = true;
                    log::info!("agent: query accepted by sidecar");
                }
            }
            continue;
        }

        // ── Handle JSON-RPC notification or request from sidecar ──

        let method = match msg.method.as_deref() {
            Some(m) => m,
            None => continue,
        };
        let params = msg.params.unwrap_or(serde_json::Value::Null);

        match method {
            // ── Notifications ──
            "message" => {
                let msg_type = params
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown");

                // Log message type
                match msg_type {
                    "text" | "tool_input" | "thinking" => {
                        let content_len = params
                            .get("content")
                            .and_then(|c| c.as_str())
                            .map(|s| s.len())
                            .unwrap_or(0);
                        log::debug!(
                            "agent: message type={} content_len={}",
                            msg_type,
                            content_len
                        );
                    }
                    "error" => {
                        log::error!(
                            "agent: message {}",
                            serde_json::to_string(&params).unwrap_or_default()
                        );
                    }
                    _ => {
                        let s = serde_json::to_string(&params).unwrap_or_default();
                        let max = s.len().min(1000);
                        let end = s.floor_char_boundary(max);
                        log::info!("agent: message {}", &s[..end]);
                    }
                }

                // Dispatch to Tauri events (same as old NDJSON dispatch)
                dispatch_message_to_tauri(
                    msg_type,
                    &params,
                    issue_id,
                    app_handle,
                    canonical_project_dir.unwrap_or(project_dir),
                );
            }

            "queryComplete" => {
                if let Some(sid) = params.get("sessionId").and_then(|s| s.as_str()) {
                    if !sid.is_empty() {
                        final_session_id = sid.to_string();
                    }
                }
                if let Some(resp) = params.get("response").and_then(|r| r.as_str()) {
                    response_text = resp.to_string();
                    let _ = StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "result".to_string(),
                        content: resp.to_string(),
                    }
                    .emit(app_handle);
                }
                break 'outer Ok(());
            }

            "queryError" => {
                let message = params
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown agent error");
                let _ = StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "error".to_string(),
                    content: message.to_string(),
                }
                .emit(app_handle);
                break 'outer Ok(());
            }

            // ── Reverse requests (sidecar → Rust, expect response) ──
            "toolApproval" => {
                if let Some(id) = msg.id {
                    let request_id = params
                        .get("requestId")
                        .and_then(|r| r.as_str())
                        .unwrap_or("")
                        .to_string();
                    let tool_name = params
                        .get("toolName")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    let input = params
                        .get("input")
                        .cloned()
                        .unwrap_or(serde_json::json!({}));

                    {
                        let mut pending = pending_permission.lock().await;
                        *pending = Some(PendingPermission { json_rpc_id: id });
                    }

                    // Emit Tauri event for frontend
                    let _ = AgentPermissionRequest {
                        request_id,
                        tool_name,
                        input,
                    }
                    .emit(app_handle);
                }
            }

            "feedbackRequest" => {
                if let Some(id) = msg.id {
                    let request_id = params
                        .get("requestId")
                        .and_then(|r| r.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ticket_id = params
                        .get("ticketId")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    let summary = params
                        .get("summary")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string();

                    {
                        let mut pending = pending_feedback.lock().await;
                        *pending = Some(PendingFeedback { json_rpc_id: id });
                    }

                    let _ = AgentFeedbackRequest {
                        request_id,
                        ticket_id,
                        summary,
                    }
                    .emit(app_handle);
                }
            }

            "reviewRequest" => {
                if let Some(id) = msg.id {
                    let request_id = params
                        .get("requestId")
                        .and_then(|r| r.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ticket_id = params
                        .get("ticketId")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    let findings = params
                        .get("findings")
                        .cloned()
                        .unwrap_or(serde_json::json!([]));
                    let summary = params
                        .get("summary")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string();

                    {
                        let mut pending = pending_review.lock().await;
                        *pending = Some(PendingReview { json_rpc_id: id });
                    }

                    let _ = AgentReviewFindingsRequest {
                        request_id,
                        ticket_id,
                        findings,
                        summary,
                    }
                    .emit(app_handle);
                }
            }

            _ => {
                log::debug!("agent: unknown JSON-RPC method: {}", method);
            }
        }
    };

    // ── Cleanup ──

    if timed_out {
        let timeout_msg = format!(
            "Agent sidecar timed out after {} seconds of inactivity. The session can be resumed.",
            idle_timeout.as_secs()
        );
        let _ = StreamChunk {
            issue_id: issue_id.to_string(),
            chunk_type: "error".to_string(),
            content: timeout_msg.clone(),
        }
        .emit(app_handle);
        let _ = child.kill().await;
        if let Some(state) = app_handle.try_state::<AgentState>() {
            let mut handle_guard = state.handle.lock().await;
            *handle_guard = None;
        }
        // Clean up socket file
        let _ = std::fs::remove_file(&socket_path);
        return Err(timeout_msg);
    }

    if let Err(e) = read_result {
        let _ = child.kill().await;
        let _ = std::fs::remove_file(&socket_path);
        return Err(e);
    }

    // Clear the agent handle FIRST to drop the socket write half reference.
    // The sidecar stays alive until the socket closes, so we must release
    // our write half before waiting for the child to exit — otherwise we
    // deadlock (Rust waits for child exit, child waits for socket close).
    if let Some(state) = app_handle.try_state::<AgentState>() {
        let mut handle_guard = state.handle.lock().await;
        *handle_guard = None;
    }
    // Drop our local Arc to the write half — combined with the AgentHandle
    // drop above, this fully closes the socket write end.
    drop(write_half);

    // Now the sidecar detects socket close and exits, which closes stderr.
    // Wait for stderr reader and child process with a timeout to avoid
    // hanging if the sidecar doesn't exit cleanly.
    let shutdown_timeout = std::time::Duration::from_secs(5);
    if tokio::time::timeout(shutdown_timeout, stderr_handle)
        .await
        .is_err()
    {
        log::warn!("agent: stderr reader did not finish within timeout, killing sidecar");
        let _ = child.kill().await;
    }

    // Wait for child process
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for agent sidecar: {}", e))?;

    let elapsed = start_time.elapsed();
    log::info!(
        "agent: sidecar exited with status {} (elapsed={:.1}s, response_len={})",
        status,
        elapsed.as_secs_f64(),
        response_text.len()
    );

    // Clean up socket file if sidecar didn't
    let _ = std::fs::remove_file(&socket_path);

    if !status.success() && !got_query_response {
        return Err(format!(
            "Agent sidecar exited with status {}{}",
            status,
            if response_text.is_empty() {
                " and no output"
            } else {
                ""
            }
        ));
    }

    Ok((response_text, final_session_id))
}

/// Dispatch a `message` notification's params to the appropriate Tauri event.
/// This maps directly from the old NDJSON `msg_type` dispatch.
fn dispatch_message_to_tauri(
    msg_type: &str,
    params: &serde_json::Value,
    issue_id: &str,
    app_handle: &tauri::AppHandle,
    canonical_project_dir: &str,
) {
    match msg_type {
        "session" => {
            // Session ID is tracked in queryComplete, but emit for frontend
            if let Some(sid) = params.get("session_id").and_then(|s| s.as_str()) {
                let _ = StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "session".to_string(),
                    content: sid.to_string(),
                }
                .emit(app_handle);
            }
        }
        "text" => {
            if let Some(content) = params.get("content").and_then(|c| c.as_str()) {
                let _ = StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "text".to_string(),
                    content: content.to_string(),
                }
                .emit(app_handle);
            }
        }
        "tool_start" => {
            let tool_name = params
                .get("tool_name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown");
            let tool_id = params.get("tool_id").and_then(|i| i.as_str()).unwrap_or("");
            let payload = serde_json::json!({
                "tool_name": tool_name,
                "tool_id": tool_id,
            });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "tool_start".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "tool_input" => {
            let tool_id = params.get("tool_id").and_then(|i| i.as_str()).unwrap_or("");
            let content = params.get("content").and_then(|c| c.as_str()).unwrap_or("");
            let payload = serde_json::json!({
                "tool_id": tool_id,
                "content": content,
            });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "tool_input".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "tool_end" => {
            let tool_id = params
                .get("tool_id")
                .and_then(|i| i.as_str())
                .unwrap_or("0");
            let payload = serde_json::json!({ "tool_id": tool_id });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "tool_end".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "tool_result" => {
            let tool_id = params.get("tool_id").and_then(|i| i.as_str()).unwrap_or("");
            let content = params.get("content").and_then(|c| c.as_str()).unwrap_or("");
            let is_error = params
                .get("is_error")
                .and_then(|e| e.as_bool())
                .unwrap_or(false);
            let payload = serde_json::json!({
                "tool_id": tool_id,
                "content": content,
                "is_error": is_error,
            });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "tool_result".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "thinking" => {
            if let Some(content) = params.get("content").and_then(|c| c.as_str()) {
                let _ = StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "thinking".to_string(),
                    content: content.to_string(),
                }
                .emit(app_handle);
            }
        }
        "result" => {
            if let Some(content) = params.get("content").and_then(|c| c.as_str()) {
                let _ = StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "result".to_string(),
                    content: content.to_string(),
                }
                .emit(app_handle);
            }
        }
        "error" => {
            let message = params
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown agent error");
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "error".to_string(),
                content: message.to_string(),
            }
            .emit(app_handle);
        }
        "section_update" => {
            let ticket_id = params
                .get("ticket_id")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let section = params
                .get("section")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let section_id = params
                .get("section_id")
                .and_then(|s| s.as_str())
                .map(|s| s.to_string());
            let content = params
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            let _ = SectionUpdateEvent {
                ticket_id,
                section,
                section_id,
                content,
            }
            .emit(app_handle);
        }
        "notification" => {
            let title = params
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let message = params
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            let level = params
                .get("level")
                .and_then(|l| l.as_str())
                .unwrap_or("info")
                .to_string();
            let _ = NotificationEvent {
                title,
                message,
                level,
            }
            .emit(app_handle);
        }
        "step_complete" => {
            let ticket_id = params
                .get("ticket_id")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let summary = params
                .get("summary")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();

            if !ticket_id.is_empty() {
                match crate::workflow::advance_step(canonical_project_dir, &ticket_id) {
                    Ok(_state) => {
                        log::info!(
                            "agent: workflow advanced for {} (summary: {})",
                            ticket_id,
                            summary
                        );
                    }
                    Err(e) => {
                        log::error!("agent: failed to advance workflow: {}", e);
                    }
                }
            }

            let _ = StepCompleteEvent { ticket_id, summary }.emit(app_handle);
        }
        "status_update" => {
            let ticket_id = params
                .get("ticket_id")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let status_text = params
                .get("status_text")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let _ = StatusUpdateEvent {
                ticket_id,
                status_text,
            }
            .emit(app_handle);
        }
        "feedback_request" => {
            // This type is now handled as a JSON-RPC reverse request, not a notification.
            // If it somehow arrives as a message notification, log and ignore.
            log::warn!("agent: received feedback_request as message notification (should be JSON-RPC request)");
        }
        "review_findings" => {
            // Same as feedback_request — now a JSON-RPC reverse request.
            log::warn!("agent: received review_findings as message notification (should be JSON-RPC request)");
        }
        "pr_url_reported" => {
            let ticket_id = params
                .get("ticket_id")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let url = params
                .get("url")
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            let _ = PrUrlReportedEvent { ticket_id, url }.emit(app_handle);
        }
        "subtask_created" => {
            let subtask_id = params
                .get("subtask_id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let parent_id = params
                .get("parent_id")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            let _ = SubtaskCreated {
                subtask_id,
                parent_id,
            }
            .emit(app_handle);
        }
        "subtask_updated" => {
            let subtask_id = params
                .get("subtask_id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let parent_id = params
                .get("parent_id")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            let _ = SubtaskUpdated {
                subtask_id,
                parent_id,
            }
            .emit(app_handle);
        }
        "subtask_closed" => {
            let subtask_id = params
                .get("subtask_id")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let parent_id = params
                .get("parent_id")
                .and_then(|p| p.as_str())
                .unwrap_or("")
                .to_string();
            let _ = SubtaskClosed {
                subtask_id,
                parent_id,
            }
            .emit(app_handle);
        }
        "tool_progress" => {
            let tool_name = params
                .get("tool_name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let tool_use_id = params
                .get("tool_use_id")
                .and_then(|i| i.as_str())
                .unwrap_or("");
            let elapsed = params
                .get("elapsed_seconds")
                .and_then(|e| e.as_f64())
                .unwrap_or(0.0);
            let payload = serde_json::json!({
                "tool_name": tool_name,
                "tool_use_id": tool_use_id,
                "elapsed_seconds": elapsed,
            });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "tool_progress".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "subagent_start" => {
            let task_id = params.get("task_id").and_then(|t| t.as_str()).unwrap_or("");
            let tool_use_id = params
                .get("tool_use_id")
                .and_then(|i| i.as_str())
                .unwrap_or("");
            let description = params
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("");
            let payload = serde_json::json!({
                "task_id": task_id,
                "tool_use_id": tool_use_id,
                "description": description,
            });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "subagent_start".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "subagent_progress" => {
            let payload = serde_json::json!({
                "task_id": params.get("task_id").and_then(|t| t.as_str()).unwrap_or(""),
                "summary": params.get("summary"),
                "last_tool_name": params.get("last_tool_name"),
                "usage": params.get("usage"),
            });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "subagent_progress".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "subagent_complete" => {
            let payload = serde_json::json!({
                "task_id": params.get("task_id").and_then(|t| t.as_str()).unwrap_or(""),
                "status": params.get("status").and_then(|s| s.as_str()).unwrap_or("completed"),
                "summary": params.get("summary"),
                "usage": params.get("usage"),
            });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "subagent_complete".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "files_changed" => {
            let files = params
                .get("files")
                .cloned()
                .unwrap_or(serde_json::json!([]));
            let payload = serde_json::json!({ "files": files });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "files_changed".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "tool_use_summary" => {
            let summary = params.get("summary").and_then(|s| s.as_str()).unwrap_or("");
            let tool_ids = params
                .get("tool_ids")
                .cloned()
                .unwrap_or(serde_json::json!([]));
            let payload = serde_json::json!({
                "summary": summary,
                "tool_ids": tool_ids,
            });
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "tool_use_summary".to_string(),
                content: payload.to_string(),
            }
            .emit(app_handle);
        }
        "compacting" => {
            let is_compacting = params
                .get("is_compacting")
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            let _ = StreamChunk {
                issue_id: issue_id.to_string(),
                chunk_type: "compacting".to_string(),
                content: is_compacting.to_string(),
            }
            .emit(app_handle);
        }
        "heartbeat" => {
            log::debug!("agent: heartbeat received");
        }
        _ => {}
    }
}
