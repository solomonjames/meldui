//! Claude CLI detection, authentication status, and login.
use std::env;
use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// Find the claude CLI binary by searching common locations.
/// Desktop apps launched from Finder don't inherit the shell PATH,
/// so we need to check known install locations explicitly.
fn find_claude_binary() -> Option<PathBuf> {
    let home = env::var("HOME").unwrap_or_default();

    let candidates = [
        format!("{home}/.local/bin/claude"),
        format!("{home}/.claude/bin/claude"),
        format!("{home}/.bun/bin/claude"),
        format!("{home}/.npm-global/bin/claude"),
        "/usr/local/bin/claude".to_string(),
        "/opt/homebrew/bin/claude".to_string(),
    ];

    for path in &candidates {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }

    // Fallback: try bare "claude" in case PATH works (e.g., dev mode)
    if let Ok(output) = std::process::Command::new("which").arg("claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    None
}

/// Create a Command with the full path to the claude binary
fn claude_command() -> Result<Command, String> {
    let bin = find_claude_binary().ok_or_else(|| {
        "Claude Code CLI not found. Install it from https://code.claude.com".to_string()
    })?;
    Ok(Command::new(bin))
}

/// Check if Claude Code CLI is available and authenticated
pub async fn get_status() -> Result<ClaudeStatus, String> {
    let bin = find_claude_binary();

    if bin.is_none() {
        return Ok(ClaudeStatus {
            installed: false,
            authenticated: false,
            path: None,
            message: "Claude Code CLI not found. Install it from https://code.claude.com"
                .to_string(),
        });
    }

    let bin_path = bin.unwrap();

    // Check auth status
    let auth_check = Command::new(&bin_path)
        .args([
            "--print",
            "--output-format",
            "json",
            "--max-turns",
            "0",
            "--",
            "test",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to check claude auth: {e}"))?;

    let stderr = String::from_utf8_lossy(&auth_check.stderr);
    let authenticated = auth_check.status.success()
        || (!stderr.contains("not logged in") && !stderr.contains("authentication"));

    Ok(ClaudeStatus {
        installed: true,
        authenticated,
        path: Some(bin_path.to_string_lossy().to_string()),
        message: if authenticated {
            "Claude Code is installed and authenticated".to_string()
        } else {
            "Claude Code is installed but not authenticated".to_string()
        },
    })
}

/// Trigger Claude Code login flow
pub async fn login() -> Result<ClaudeStatus, String> {
    let mut cmd = claude_command()?;
    let output = cmd
        .arg("login")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to start claude login: {e}"))?;

    if output.status.success() {
        // Re-check status after login
        get_status().await
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Login failed: {stderr}"))
    }
}

/// Status of the Claude Code CLI installation and authentication.
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct ClaudeStatus {
    pub installed: bool,
    pub authenticated: bool,
    #[serde(default)]
    pub path: Option<String>,
    pub message: String,
}

/// Streaming event payload emitted to frontend
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct StreamChunk {
    pub issue_id: String,
    pub chunk_type: String, // "text", "tool_start", "tool_input", "tool_end", "tool_result", "thinking", "result", "error", "stderr"
    pub content: String,
}
