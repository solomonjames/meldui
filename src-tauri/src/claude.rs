use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

/// Find the claude CLI binary by searching common locations.
/// Desktop apps launched from Finder don't inherit the shell PATH,
/// so we need to check known install locations explicitly.
fn find_claude_binary() -> Option<PathBuf> {
    let home = env::var("HOME").unwrap_or_default();

    let candidates = [
        format!("{}/.local/bin/claude", home),
        format!("{}/.claude/bin/claude", home),
        format!("{}/.bun/bin/claude", home),
        format!("{}/.npm-global/bin/claude", home),
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
pub async fn get_status() -> Result<String, String> {
    let bin = find_claude_binary();

    if bin.is_none() {
        return Ok(serde_json::json!({
            "installed": false,
            "authenticated": false,
            "message": "Claude Code CLI not found. Install it from https://code.claude.com"
        })
        .to_string());
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
        .map_err(|e| format!("Failed to check claude auth: {}", e))?;

    let stderr = String::from_utf8_lossy(&auth_check.stderr);
    let authenticated = auth_check.status.success()
        || (!stderr.contains("not logged in") && !stderr.contains("authentication"));

    Ok(serde_json::json!({
        "installed": true,
        "authenticated": authenticated,
        "path": bin_path.to_string_lossy(),
        "message": if authenticated {
            "Claude Code is installed and authenticated"
        } else {
            "Claude Code is installed but not authenticated"
        }
    })
    .to_string())
}

/// Trigger Claude Code login flow
pub async fn login() -> Result<String, String> {
    let mut cmd = claude_command()?;
    let output = cmd
        .arg("login")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to start claude login: {}", e))?;

    if output.status.success() {
        Ok("Login initiated. Check your browser.".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Login failed: {}", stderr))
    }
}

/// Streaming event payload emitted to frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamChunk {
    pub issue_id: String,
    pub chunk_type: String, // "text", "tool_start", "tool_input", "tool_end", "tool_result", "thinking", "result", "error", "stderr"
    pub content: String,
}
