use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClaudeMessage {
    pub role: String,
    pub content: String,
    #[serde(rename = "type")]
    pub msg_type: String,
}

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

/// Send a message to Claude and collect responses (non-streaming, for chat panel)
pub async fn send_message(
    prompt: &str,
    _app: tauri::AppHandle,
) -> Result<Vec<ClaudeMessage>, String> {
    let mut cmd = claude_command()?;
    let mut child = cmd
        .args([
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--",
            prompt,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut messages: Vec<ClaudeMessage> = Vec::new();
    let mut assistant_text = String::new();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("Failed to read line: {}", e))?
    {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            let msg_type = json
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");

            match msg_type {
                "assistant" => {
                    if let Some(message) = json.get("message") {
                        if let Some(content) = message.get("content") {
                            if let Some(content_arr) = content.as_array() {
                                for block in content_arr {
                                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                        if let Some(text) =
                                            block.get("text").and_then(|t| t.as_str())
                                        {
                                            assistant_text.push_str(text);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                "result" => {
                    if let Some(result_text) = json.get("result").and_then(|r| r.as_str()) {
                        assistant_text = result_text.to_string();
                    }
                }
                _ => {}
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for claude: {}", e))?;

    if !assistant_text.is_empty() {
        messages.push(ClaudeMessage {
            role: "assistant".to_string(),
            content: assistant_text,
            msg_type: "text".to_string(),
        });
    } else if !status.success() {
        return Err("Claude command failed with no output".to_string());
    }

    Ok(messages)
}

/// Streaming event payload emitted to frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamChunk {
    pub issue_id: String,
    pub chunk_type: String, // "text", "tool_use", "result", "error"
    pub content: String,
}

/// Send a message to Claude with real-time streaming via Tauri events.
/// Returns the full accumulated response text.
pub async fn send_message_streaming(
    prompt: &str,
    app: &tauri::AppHandle,
    issue_id: &str,
    project_dir: Option<&str>,
) -> Result<String, String> {
    use tauri::Emitter;

    let mut cmd = claude_command()?;
    if let Some(dir) = project_dir {
        cmd.current_dir(dir);
    }
    let mut child = cmd
        .args([
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--",
            prompt,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut assistant_text = String::new();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("Failed to read line: {}", e))?
    {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            let msg_type = json
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");

            match msg_type {
                "content_block_delta" => {
                    if let Some(delta) = json.get("delta") {
                        if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                            assistant_text.push_str(text);
                            let _ = app.emit(
                                "workflow-step-output",
                                StreamChunk {
                                    issue_id: issue_id.to_string(),
                                    chunk_type: "text".to_string(),
                                    content: text.to_string(),
                                },
                            );
                        }
                    }
                }
                "assistant" => {
                    // "assistant" messages contain the full accumulated text;
                    // we only emit streaming chunks from content_block_delta,
                    // so we just track the full text here for the final return value
                    if let Some(message) = json.get("message") {
                        if let Some(content) = message.get("content") {
                            if let Some(content_arr) = content.as_array() {
                                let mut full_text = String::new();
                                for block in content_arr {
                                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                        if let Some(text) =
                                            block.get("text").and_then(|t| t.as_str())
                                        {
                                            full_text.push_str(text);
                                        }
                                    }
                                }
                                if !full_text.is_empty() {
                                    assistant_text = full_text;
                                }
                            }
                        }
                    }
                }
                "result" => {
                    if let Some(result_text) = json.get("result").and_then(|r| r.as_str()) {
                        assistant_text = result_text.to_string();
                        let _ = app.emit(
                            "workflow-step-output",
                            StreamChunk {
                                issue_id: issue_id.to_string(),
                                chunk_type: "result".to_string(),
                                content: result_text.to_string(),
                            },
                        );
                    }
                }
                _ => {}
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for claude: {}", e))?;

    if assistant_text.is_empty() && !status.success() {
        return Err("Claude command failed with no output".to_string());
    }

    Ok(assistant_text)
}
