//! Agent sidecar orchestration and JSON-RPC 2.0 communication.
//!
//! Manages the lifecycle of the AI agent sidecar binary:
//! spawns the compiled Bun sidecar, connects via Unix socket,
//! implements bidirectional JSON-RPC for commands/permissions/reviews,
//! and emits Tauri events for frontend consumption.

mod events;
mod protocol;
pub(crate) mod supervisor;

// Re-export public event types (used by lib.rs for specta registration)
pub use events::*;

// Internal imports from submodules
use protocol::{JsonRpcMessage, JsonRpcRequest, JsonRpcResponse, SidecarConfig};

use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tauri::Manager;
use tauri_specta::Event;
use thiserror::Error;

use crate::constants::{MELDUI_DIR, TICKETS_DIR};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::claude::StreamChunk;

/// Structured error type for agent sidecar operations.
#[derive(Debug, Error)]
pub(crate) enum AgentError {
    #[error("agent sidecar binary not found — run 'bun run agent:build' first")]
    BinaryNotFound,

    #[error("failed to spawn agent sidecar: {0}")]
    SpawnFailed(#[source] std::io::Error),

    #[error("failed to capture sidecar {0}")]
    StdioCaptureError(&'static str),

    #[error("sidecar failed to announce socket path within timeout")]
    SocketPathTimeout,

    #[error("sidecar exited before announcing socket path")]
    SocketPathEof,

    #[error("sidecar printed unexpected first line: {0}")]
    SocketPathInvalid(String),

    #[error("failed to read sidecar stdout: {0}")]
    StdoutReadFailed(#[source] std::io::Error),

    #[error("failed to connect to sidecar socket: {0}")]
    SocketConnectFailed(#[source] std::io::Error),

    #[error("failed to write to socket: {0}")]
    SocketWriteFailed(#[source] std::io::Error),

    #[error("failed to read from socket: {0}")]
    SocketReadFailed(#[source] std::io::Error),

    #[error("failed to serialize message: {0}")]
    SerializeFailed(#[source] serde_json::Error),

    #[error("agent is not running")]
    NotRunning,

    #[error("no pending permission request")]
    NoPendingPermission,

    #[error("no pending review request")]
    NoPendingReview,

    #[error("query failed: {0}")]
    QueryFailed(String),

    #[error("agent sidecar exited with status {status}{detail}")]
    SidecarExitError {
        status: String,
        detail: &'static str,
    },

    #[error("agent sidecar timed out after {0} seconds of inactivity")]
    IdleTimeout(u64),

    #[error("failed to wait for agent sidecar: {0}")]
    WaitFailed(#[source] std::io::Error),
}

/// Active agent handle — holds socket writer and pending request channels.
pub struct AgentHandle {
    socket_writer: Arc<Mutex<tokio::io::WriteHalf<UnixStream>>>,
    pending_permission: Arc<Mutex<Option<PendingPermission>>>,
    pending_review: Arc<Mutex<Option<PendingReview>>>,
    next_id: Arc<AtomicU64>,
}

impl AgentHandle {
    /// Send a JSON-RPC message over the socket.
    async fn send_raw(&self, json: &str) -> Result<(), AgentError> {
        let mut writer = self.socket_writer.lock().await;
        writer
            .write_all(format!("{json}\n").as_bytes())
            .await
            .map_err(AgentError::SocketWriteFailed)?;
        writer
            .flush()
            .await
            .map_err(AgentError::SocketWriteFailed)?;
        Ok(())
    }

    /// Send a JSON-RPC response.
    async fn send_response(
        &self,
        id: serde_json::Value,
        result: serde_json::Value,
    ) -> Result<(), AgentError> {
        let response = JsonRpcResponse {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        };
        let json = serde_json::to_string(&response).map_err(AgentError::SerializeFailed)?;
        self.send_raw(&json).await
    }

    /// Send a permission response — resolves the pending oneshot channel.
    pub async fn respond_to_permission(
        &self,
        _request_id: &str,
        allowed: bool,
    ) -> Result<(), AgentError> {
        let mut pending = self.pending_permission.lock().await;
        if let Some(p) = pending.take() {
            // Send JSON-RPC response to sidecar
            let decision = if allowed { "allow" } else { "deny" };
            self.send_response(p.json_rpc_id, serde_json::json!({ "decision": decision }))
                .await?;
            Ok(())
        } else {
            Err(AgentError::NoPendingPermission)
        }
    }

    /// Send a review response.
    pub async fn respond_to_review(
        &self,
        _request_id: &str,
        submission: serde_json::Value,
    ) -> Result<(), AgentError> {
        let mut pending = self.pending_review.lock().await;
        if let Some(p) = pending.take() {
            self.send_response(
                p.json_rpc_id,
                serde_json::json!({ "submission": submission }),
            )
            .await?;
            Ok(())
        } else {
            Err(AgentError::NoPendingReview)
        }
    }

    /// Send cancel JSON-RPC request.
    #[allow(dead_code)] // Planned for future agent cancellation support
    pub async fn cancel(&self) -> Result<(), AgentError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: "cancel".to_string(),
            params: Some(serde_json::json!({})),
        };
        let json = serde_json::to_string(&request).map_err(AgentError::SerializeFailed)?;
        self.send_raw(&json).await
    }
}

/// Managed state for the active agent handle.
pub struct AgentState {
    pub handle: Mutex<Option<AgentHandle>>,
    /// Auto-advance enabled per project (keyed by project_dir).
    /// Uses RwLock since reads are frequent (every queryComplete) and writes are rare (toggle).
    pub auto_advance: tokio::sync::RwLock<std::collections::HashMap<String, bool>>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
            auto_advance: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn agent_set_model(
    model: String,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    agent_set_model_inner(model, &state)
        .await
        .map_err(|e| e.to_string())
}

async fn agent_set_model_inner(model: String, state: &AgentState) -> Result<(), AgentError> {
    let handle_guard = state.handle.lock().await;
    let handle = handle_guard.as_ref().ok_or(AgentError::NotRunning)?;
    let id = handle.next_id.fetch_add(1, Ordering::Relaxed);
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "agent/set_model",
        "params": { "model": model },
        "id": id
    });
    let json = serde_json::to_string(&request).map_err(AgentError::SerializeFailed)?;
    handle.send_raw(&json).await
}

#[tauri::command]
#[specta::specta]
pub async fn agent_set_thinking(
    thinking_type: String,
    budget_tokens: Option<u32>,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    agent_set_thinking_inner(thinking_type, budget_tokens, &state)
        .await
        .map_err(|e| e.to_string())
}

async fn agent_set_thinking_inner(
    thinking_type: String,
    budget_tokens: Option<u32>,
    state: &AgentState,
) -> Result<(), AgentError> {
    let handle_guard = state.handle.lock().await;
    let handle = handle_guard.as_ref().ok_or(AgentError::NotRunning)?;
    let id = handle.next_id.fetch_add(1, Ordering::Relaxed);
    let mut params = serde_json::json!({ "type": thinking_type });
    if let Some(tokens) = budget_tokens {
        params["budgetTokens"] = serde_json::json!(tokens);
    }
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "agent/set_thinking",
        "params": params,
        "id": id
    });
    let json = serde_json::to_string(&request).map_err(AgentError::SerializeFailed)?;
    handle.send_raw(&json).await
}

#[tauri::command]
#[specta::specta]
pub async fn agent_set_effort(
    effort: String,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    agent_set_effort_inner(effort, &state)
        .await
        .map_err(|e| e.to_string())
}

async fn agent_set_effort_inner(effort: String, state: &AgentState) -> Result<(), AgentError> {
    let handle_guard = state.handle.lock().await;
    let handle = handle_guard.as_ref().ok_or(AgentError::NotRunning)?;
    let id = handle.next_id.fetch_add(1, Ordering::Relaxed);
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "agent/set_effort",
        "params": { "effort": effort },
        "id": id
    });
    let json = serde_json::to_string(&request).map_err(AgentError::SerializeFailed)?;
    handle.send_raw(&json).await
}

#[tauri::command]
#[specta::specta]
pub async fn agent_set_fast_mode(
    enabled: bool,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    agent_set_fast_mode_inner(enabled, &state)
        .await
        .map_err(|e| e.to_string())
}

async fn agent_set_fast_mode_inner(enabled: bool, state: &AgentState) -> Result<(), AgentError> {
    let handle_guard = state.handle.lock().await;
    let handle = handle_guard.as_ref().ok_or(AgentError::NotRunning)?;
    let id = handle.next_id.fetch_add(1, Ordering::Relaxed);
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "agent/set_fast_mode",
        "params": { "enabled": enabled },
        "id": id
    });
    let json = serde_json::to_string(&request).map_err(AgentError::SerializeFailed)?;
    handle.send_raw(&json).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_auto_advance(
    state: tauri::State<'_, AgentState>,
    project_dir: String,
    enabled: bool,
) -> Result<(), String> {
    let mut map = state.auto_advance.write().await;
    map.insert(project_dir, enabled);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_auto_advance(
    state: tauri::State<'_, AgentState>,
    project_dir: String,
) -> Result<bool, String> {
    let map = state.auto_advance.read().await;
    Ok(map.get(&project_dir).copied().unwrap_or(false))
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
            log::info!("agent: using override binary from MELDUI_AGENT_BINARY: {override_path}");
            return Some(path);
        }
        log::warn!("agent: MELDUI_AGENT_BINARY set but path does not exist: {override_path}");
    }

    // 1. Check next to the app executable (Tauri externalBin placement)
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let arch = if cfg!(target_arch = "aarch64") {
                "aarch64"
            } else {
                "x86_64"
            };
            let sidecar_name = format!("agent-{arch}-apple-darwin");
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
        .join(format!("agent-{arch}-apple-darwin"));
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
        format!("{home}/.local/bin"),
        format!("{home}/.bun/bin"),
        format!("{home}/.npm-global/bin"),
        format!("{home}/.claude/bin"),
        format!("{home}/go/bin"),
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
#[allow(unsafe_code)] // Required for process signal delivery
fn cleanup_stale_sockets() {
    let tmpdir = env::temp_dir();
    let Ok(entries) = std::fs::read_dir(&tmpdir) else {
        return;
    };

    for entry in entries.flatten() {
        let Ok(filename) = entry.file_name().into_string() else {
            continue;
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
        // "progress" and all other views get the full tool set
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
#[allow(clippy::too_many_arguments)]
pub async fn execute_step(
    project_dir: &str,
    issue_id: &str,
    prompt: &str,
    session_id: Option<&str>,
    allowed_tools: Option<Vec<String>>,
    on_chunk: &tauri::ipc::Channel<StreamChunk>,
    app_handle: &tauri::AppHandle,
    tickets_dir_override: Option<&str>,
    _canonical_project_dir: Option<&str>,
    conversation_writer: Option<&Mutex<crate::conversation::ConversationWriter>>,
    current_step_id: Option<&str>,
) -> Result<(String, String), String> {
    let agent_bin = find_agent_binary().ok_or_else(|| AgentError::BinaryNotFound.to_string())?;

    log::info!("agent: using binary at {agent_bin:?}");

    // Clean up stale sockets from dead processes
    cleanup_stale_sockets();

    // NDJSON capture file for recording sessions (set MELDUI_CAPTURE_NDJSON=path)
    let capture_file = env::var("MELDUI_CAPTURE_NDJSON").ok();
    if let Some(ref path) = capture_file {
        log::info!("agent: capturing messages to {path}");
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
                .unwrap_or_else(|| {
                    PathBuf::from(project_dir)
                        .join(MELDUI_DIR)
                        .join(TICKETS_DIR)
                        .to_string_lossy()
                        .to_string()
                }),
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
        "LOGNAME",
        "TMPDIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
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
        .map_err(|e| AgentError::SpawnFailed(e).to_string())?;

    // ── Read SOCKET_PATH from stdout ──

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AgentError::StdioCaptureError("stdout").to_string())?;

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
                return Err(AgentError::SocketPathTimeout.to_string());
            }
            Ok(Err(e)) => {
                let _ = child.kill().await;
                return Err(AgentError::StdoutReadFailed(e).to_string());
            }
            Ok(Ok(0)) => {
                let _ = child.kill().await;
                return Err(AgentError::SocketPathEof.to_string());
            }
            Ok(Ok(_)) => {
                let trimmed = first_line.trim();
                if let Some(path) = trimmed.strip_prefix("SOCKET_PATH=") {
                    PathBuf::from(path)
                } else {
                    let _ = child.kill().await;
                    let preview = &trimmed[..trimmed.len().min(200)];
                    return Err(AgentError::SocketPathInvalid(preview.to_string()).to_string());
                }
            }
        }
    };

    log::info!("agent: connecting to socket at {socket_path:?}");

    // ── Connect to Unix socket ──

    let stream = UnixStream::connect(&socket_path)
        .await
        .map_err(|e| AgentError::SocketConnectFailed(e).to_string())?;

    let (read_half, write_half) = tokio::io::split(stream);
    let write_half = Arc::new(Mutex::new(write_half));
    let next_id = Arc::new(AtomicU64::new(1));

    // ── Set up AgentHandle ──

    let pending_permission: Arc<Mutex<Option<PendingPermission>>> = Arc::new(Mutex::new(None));
    let pending_review: Arc<Mutex<Option<PendingReview>>> = Arc::new(Mutex::new(None));

    let agent_handle = AgentHandle {
        socket_writer: write_half.clone(),
        pending_permission: pending_permission.clone(),
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
        .map_err(|e| AgentError::SerializeFailed(e).to_string())?;

    {
        let mut writer = write_half.lock().await;
        writer
            .write_all(format!("{query_json}\n").as_bytes())
            .await
            .map_err(|e| AgentError::SocketWriteFailed(e).to_string())?;
        writer
            .flush()
            .await
            .map_err(|e| AgentError::SocketWriteFailed(e).to_string())?;
    }

    // Capture to file if enabled
    if let Some(ref path) = capture_file {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            use std::io::Write;
            let _ = writeln!(f, "> {query_json}");
        }
    }

    // ── Also capture stderr for debugging ──

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AgentError::StdioCaptureError("stderr").to_string())?;

    let stderr_chunk_channel = on_chunk.clone();
    let stderr_issue_id = issue_id.to_string();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                let _ = stderr_chunk_channel.send(StreamChunk {
                    issue_id: stderr_issue_id.clone(),
                    chunk_type: "stderr".to_string(),
                    content: line,
                });
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
            Ok(Err(e)) => break 'outer Err(AgentError::SocketReadFailed(e).to_string()),
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
                let _ = on_chunk.send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "stderr".to_string(),
                    content: format!(
                        "Malformed JSON-RPC from sidecar: {} (line: {})",
                        e,
                        &line[..line.len().min(200)]
                    ),
                });
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
                        break 'outer Err(AgentError::QueryFailed(err.message.clone()).to_string());
                    }
                    got_query_response = true;
                    log::info!("agent: query accepted by sidecar");
                }
            }
            continue;
        }

        // ── Handle JSON-RPC notification or request from sidecar ──

        let Some(method) = msg.method.as_deref() else {
            continue;
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
                        log::debug!("agent: message type={msg_type} content_len={content_len}");
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
                        // Find a valid char boundary at or before `max`
                        let end = (0..=max)
                            .rev()
                            .find(|&i| s.is_char_boundary(i))
                            .unwrap_or(0);
                        log::info!("agent: message {}", &s[..end]);
                    }
                }

                // Dispatch to Tauri events (same as old NDJSON dispatch)
                dispatch_message_to_tauri(
                    msg_type,
                    &params,
                    issue_id,
                    on_chunk,
                    app_handle,
                    project_dir,
                );

                // Persist to conversation NDJSON
                if let Some(writer) = conversation_writer {
                    let step = current_step_id.unwrap_or(issue_id);
                    if let Err(e) = writer.lock().await.append_raw(msg_type, &params, step) {
                        log::error!("conversation: failed to append: {e}");
                    }
                }
            }

            "queryComplete" => {
                if let Some(sid) = params.get("sessionId").and_then(|s| s.as_str()) {
                    if !sid.is_empty() {
                        final_session_id = sid.to_string();
                    }
                }
                if let Some(resp) = params.get("response").and_then(|r| r.as_str()) {
                    response_text = resp.to_string();
                    let _ = on_chunk.send(StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "result".to_string(),
                        content: resp.to_string(),
                    });
                }
                break 'outer Ok(());
            }

            "queryError" => {
                let message = params
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown agent error");
                let _ = on_chunk.send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "error".to_string(),
                    content: message.to_string(),
                });
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
                log::debug!("agent: unknown JSON-RPC method: {method}");
            }
        }
    };

    // ── Cleanup ──

    if timed_out {
        let err = AgentError::IdleTimeout(idle_timeout.as_secs());
        let timeout_msg = format!("{err}. The session can be resumed.");
        let _ = on_chunk.send(StreamChunk {
            issue_id: issue_id.to_string(),
            chunk_type: "error".to_string(),
            content: timeout_msg.clone(),
        });
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
        .map_err(|e| AgentError::WaitFailed(e).to_string())?;

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
        return Err(AgentError::SidecarExitError {
            status: status.to_string(),
            detail: if response_text.is_empty() {
                " and no output"
            } else {
                ""
            },
        }
        .to_string());
    }

    Ok((response_text, final_session_id))
}

/// Dispatch a `message` notification's params to the appropriate Tauri event.
/// This maps directly from the old NDJSON `msg_type` dispatch.
fn dispatch_message_to_tauri(
    msg_type: &str,
    params: &serde_json::Value,
    issue_id: &str,
    on_chunk: &tauri::ipc::Channel<StreamChunk>,
    app_handle: &tauri::AppHandle,
    _canonical_project_dir: &str,
) {
    match msg_type {
        "session" => {
            // Session ID is tracked in queryComplete, but emit for frontend
            if let Some(sid) = params.get("session_id").and_then(|s| s.as_str()) {
                on_chunk
                    .send(StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "session".to_string(),
                        content: sid.to_string(),
                    })
                    .ok();
            }
        }
        "text" => {
            if let Some(content) = params.get("content").and_then(|c| c.as_str()) {
                on_chunk
                    .send(StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "text".to_string(),
                        content: content.to_string(),
                    })
                    .ok();
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
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "tool_start".to_string(),
                    content: payload.to_string(),
                })
                .ok();
        }
        "tool_input" => {
            let tool_id = params.get("tool_id").and_then(|i| i.as_str()).unwrap_or("");
            let content = params.get("content").and_then(|c| c.as_str()).unwrap_or("");
            let payload = serde_json::json!({
                "tool_id": tool_id,
                "content": content,
            });
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "tool_input".to_string(),
                    content: payload.to_string(),
                })
                .ok();
        }
        "tool_end" => {
            let tool_id = params
                .get("tool_id")
                .and_then(|i| i.as_str())
                .unwrap_or("0");
            let payload = serde_json::json!({ "tool_id": tool_id });
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "tool_end".to_string(),
                    content: payload.to_string(),
                })
                .ok();
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
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "tool_result".to_string(),
                    content: payload.to_string(),
                })
                .ok();
        }
        "thinking" => {
            if let Some(content) = params.get("content").and_then(|c| c.as_str()) {
                on_chunk
                    .send(StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "thinking".to_string(),
                        content: content.to_string(),
                    })
                    .ok();
            }
        }
        "result" => {
            if let Some(content) = params.get("content").and_then(|c| c.as_str()) {
                on_chunk
                    .send(StreamChunk {
                        issue_id: issue_id.to_string(),
                        chunk_type: "result".to_string(),
                        content: content.to_string(),
                    })
                    .ok();
            }
        }
        "error" => {
            let message = params
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown agent error");
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "error".to_string(),
                    content: message.to_string(),
                })
                .ok();
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
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "tool_progress".to_string(),
                    content: payload.to_string(),
                })
                .ok();
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
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "subagent_start".to_string(),
                    content: payload.to_string(),
                })
                .ok();
        }
        "subagent_progress" => {
            let payload = serde_json::json!({
                "task_id": params.get("task_id").and_then(|t| t.as_str()).unwrap_or(""),
                "summary": params.get("summary"),
                "last_tool_name": params.get("last_tool_name"),
                "usage": params.get("usage"),
            });
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "subagent_progress".to_string(),
                    content: payload.to_string(),
                })
                .ok();
        }
        "subagent_complete" => {
            let payload = serde_json::json!({
                "task_id": params.get("task_id").and_then(|t| t.as_str()).unwrap_or(""),
                "status": params.get("status").and_then(|s| s.as_str()).unwrap_or("completed"),
                "summary": params.get("summary"),
                "usage": params.get("usage"),
            });
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "subagent_complete".to_string(),
                    content: payload.to_string(),
                })
                .ok();
        }
        "files_changed" => {
            let files = params
                .get("files")
                .cloned()
                .unwrap_or(serde_json::json!([]));
            let payload = serde_json::json!({ "files": files });
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "files_changed".to_string(),
                    content: payload.to_string(),
                })
                .ok();
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
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "tool_use_summary".to_string(),
                    content: payload.to_string(),
                })
                .ok();
        }
        "compacting" => {
            let is_compacting = params
                .get("is_compacting")
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "compacting".to_string(),
                    content: is_compacting.to_string(),
                })
                .ok();
        }
        "init_metadata" => {
            // Parse mcp_servers from params
            let mcp_servers: Vec<McpServerInfo> = params
                .get("mcp_servers")
                .and_then(|s| serde_json::from_value(s.clone()).ok())
                .unwrap_or_default();

            let _ = AgentInitMetadata {
                model: params
                    .get("model")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                available_models: params
                    .get("available_models")
                    .and_then(|a| serde_json::from_value(a.clone()).ok())
                    .unwrap_or_default(),
                tools: params
                    .get("tools")
                    .and_then(|t| serde_json::from_value(t.clone()).ok())
                    .unwrap_or_default(),
                slash_commands: params
                    .get("slash_commands")
                    .and_then(|s| serde_json::from_value(s.clone()).ok())
                    .unwrap_or_default(),
                skills: params
                    .get("skills")
                    .and_then(|s| serde_json::from_value(s.clone()).ok())
                    .unwrap_or_default(),
                mcp_servers,
            }
            .emit(app_handle);

            // Also forward as StreamChunk
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: "init_metadata".to_string(),
                    content: serde_json::to_string(params).unwrap_or_default(),
                })
                .ok();
        }
        "compact_boundary" | "rate_limit" => {
            on_chunk
                .send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: msg_type.to_string(),
                    content: serde_json::to_string(&params).unwrap_or_default(),
                })
                .ok();
        }
        "heartbeat" => {
            log::debug!("agent: heartbeat received");
        }
        _ => {}
    }
}
