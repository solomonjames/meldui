//! Supervisor evaluation loop — intercepts queryComplete when auto-advance is on.
//!
//! Sends worker response to the sidecar's supervisorEvaluate method,
//! then either emits SupervisorReply + sends queryFollowUp, or returns
//! to let the normal auto-advance flow proceed.

use std::sync::Arc;

use serde_json::json;
use tauri::Manager;
use tauri_specta::Event;
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

use super::events::SupervisorReply;
use super::protocol::{
    JsonRpcMessage, JsonRpcRequest, QueryFollowUpParams, StepContext, SupervisorEvaluateParams,
    SupervisorEvaluateResult, TicketContext,
};
use crate::claude::StreamChunk;
use crate::settings;

/// Result of a supervisor evaluation loop.
#[allow(dead_code)]
pub(crate) enum SupervisorDecision {
    /// Supervisor says advance to next step.
    Advance,
    /// Supervisor loop exhausted max replies — fall back to user.
    MaxRepliesReached,
}

/// Run the supervisor evaluation loop.
///
/// Called from the read loop when `queryComplete` arrives and auto-advance is on.
/// Returns when the supervisor decides to advance or hits the reply limit.
///
/// During the loop, this function:
/// 1. Sends `supervisorEvaluate` to sidecar
/// 2. If "reply": emits SupervisorReply event, sends `queryFollowUp`, reads until next `queryComplete`
/// 3. If "advance": returns SupervisorDecision::Advance
#[allow(clippy::too_many_arguments, dead_code)]
pub(crate) async fn run_supervisor_loop(
    project_dir: &str,
    issue_id: &str,
    worker_response: &str,
    ticket_context: TicketContext,
    socket_writer: &Arc<Mutex<tokio::io::WriteHalf<tokio::net::UnixStream>>>,
    next_id: &std::sync::atomic::AtomicU64,
    on_chunk: &tauri::ipc::Channel<StreamChunk>,
    app_handle: &tauri::AppHandle,
    lines: &mut tokio::io::Lines<BufReader<tokio::io::ReadHalf<tokio::net::UnixStream>>>,
    conversation_writer: Option<&Mutex<crate::conversation::ConversationWriter>>,
    current_step_id: Option<&str>,
) -> Result<(SupervisorDecision, String, String), String> {
    // Load supervisor settings
    let supervisor_settings = settings::get_settings(project_dir)
        .unwrap_or_default()
        .supervisor
        .unwrap_or_default();

    let max_replies = supervisor_settings.max_replies_per_step;
    let custom_prompt = supervisor_settings.custom_prompt;

    let mut current_response = worker_response.to_string();
    let mut final_session_id = String::new();
    let mut response_text = worker_response.to_string();

    for turn in 0..max_replies {
        // Check if user clicked "Take Over" (set_auto_advance(false)) between turns
        {
            let auto_advance_enabled =
                if let Some(state) = app_handle.try_state::<super::AgentState>() {
                    let map = state.auto_advance.read().await;
                    map.get(project_dir).copied().unwrap_or(false)
                } else {
                    false
                };
            if !auto_advance_enabled {
                log::info!("supervisor: auto-advance disabled mid-loop, returning to user");
                return Ok((SupervisorDecision::Advance, response_text, final_session_id));
            }
        }

        // 1. Send supervisorEvaluate request
        let eval_params = SupervisorEvaluateParams {
            worker_response: current_response.clone(),
            ticket_context: TicketContext {
                title: ticket_context.title.clone(),
                description: ticket_context.description.clone(),
                acceptance_criteria: ticket_context.acceptance_criteria.clone(),
                current_step: StepContext {
                    index: ticket_context.current_step.index,
                    name: ticket_context.current_step.name.clone(),
                    prompt: ticket_context.current_step.prompt.clone(),
                },
            },
            system_prompt: custom_prompt.clone(),
        };

        let id = next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: "supervisorEvaluate".to_string(),
            params: Some(serde_json::to_value(&eval_params).map_err(|e| e.to_string())?),
        };

        let mut msg_bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        msg_bytes.push(b'\n');

        {
            let mut writer = socket_writer.lock().await;
            writer
                .write_all(&msg_bytes)
                .await
                .map_err(|e| e.to_string())?;
            writer.flush().await.map_err(|e| e.to_string())?;
        }

        // 2. Read response (skip notifications, find our response by id)
        let eval_result = read_rpc_response(id, lines).await?;

        let result: SupervisorEvaluateResult = serde_json::from_value(eval_result)
            .map_err(|e| format!("supervisor parse error: {e}"))?;

        match result.action.as_str() {
            "advance" => {
                log::info!("supervisor: advance (turn {turn}): {:?}", result.reasoning);
                return Ok((SupervisorDecision::Advance, response_text, final_session_id));
            }
            "reply" => {
                let message = result.message.unwrap_or_default();
                log::info!("supervisor: reply (turn {turn}): {message}");

                // Emit SupervisorReply event to frontend
                let _ = SupervisorReply {
                    message: message.clone(),
                    reasoning: result.reasoning,
                    turn_number: turn + 1,
                }
                .emit(app_handle);

                // Persist supervisor reply to conversation log
                if let Some(writer) = conversation_writer {
                    let step = current_step_id.unwrap_or(issue_id);
                    let supervisor_msg = json!({
                        "type": "supervisor_reply",
                        "content": message,
                        "turn_number": turn + 1,
                    });
                    if let Err(e) =
                        writer
                            .lock()
                            .await
                            .append_raw("supervisor_reply", &supervisor_msg, step)
                    {
                        log::error!("conversation: failed to append supervisor reply: {e}");
                    }
                }

                // 3. Send queryFollowUp
                let follow_up_params = QueryFollowUpParams {
                    message: message.clone(),
                };

                let follow_id = next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let follow_request = JsonRpcRequest {
                    jsonrpc: "2.0",
                    id: follow_id,
                    method: "queryFollowUp".to_string(),
                    params: Some(
                        serde_json::to_value(&follow_up_params).map_err(|e| e.to_string())?,
                    ),
                };

                let mut follow_bytes =
                    serde_json::to_vec(&follow_request).map_err(|e| e.to_string())?;
                follow_bytes.push(b'\n');

                {
                    let mut writer = socket_writer.lock().await;
                    writer
                        .write_all(&follow_bytes)
                        .await
                        .map_err(|e| e.to_string())?;
                    writer.flush().await.map_err(|e| e.to_string())?;
                }

                // 4. Read until next queryComplete (processing streaming messages along the way)
                let (next_response, session_id) = read_until_query_complete(
                    issue_id,
                    on_chunk,
                    app_handle,
                    lines,
                    conversation_writer,
                    current_step_id,
                )
                .await?;

                current_response = next_response.clone();
                response_text = next_response;
                if !session_id.is_empty() {
                    final_session_id = session_id;
                }
            }
            other => {
                log::warn!("supervisor: unexpected action '{other}', treating as advance");
                return Ok((SupervisorDecision::Advance, response_text, final_session_id));
            }
        }
    }

    // Max replies reached
    log::warn!("supervisor: max replies ({max_replies}) reached, falling back to user");
    Ok((
        SupervisorDecision::MaxRepliesReached,
        response_text,
        final_session_id,
    ))
}

/// Read JSON-RPC lines until we find a response matching the given request id.
/// Discards notifications while waiting.
#[allow(dead_code)]
async fn read_rpc_response(
    expected_id: u64,
    lines: &mut tokio::io::Lines<BufReader<tokio::io::ReadHalf<tokio::net::UnixStream>>>,
) -> Result<serde_json::Value, String> {
    let timeout = std::time::Duration::from_secs(30);
    loop {
        let line = tokio::time::timeout(timeout, lines.next_line())
            .await
            .map_err(|_| "supervisor: timeout waiting for response".to_string())?
            .map_err(|e| format!("supervisor: read error: {e}"))?
            .ok_or_else(|| "supervisor: socket closed while waiting for response".to_string())?;

        let msg: JsonRpcMessage =
            serde_json::from_str(&line).map_err(|e| format!("supervisor: parse error: {e}"))?;

        // Check if this is a response to our request
        if let Some(ref id) = msg.id {
            if id.as_u64() == Some(expected_id) {
                if let Some(error) = msg.error {
                    return Err(format!("supervisor: RPC error: {error:?}"));
                }
                return Ok(msg.result.unwrap_or(json!({})));
            }
        }

        // Otherwise it's a notification — discard (supervisor doesn't generate streaming messages)
    }
}

/// Read from the socket until a queryComplete notification arrives.
/// Processes streaming messages (forwarding to frontend via on_chunk) along the way.
/// Returns (response_text, session_id).
#[allow(clippy::too_many_arguments, dead_code)]
async fn read_until_query_complete(
    issue_id: &str,
    on_chunk: &tauri::ipc::Channel<StreamChunk>,
    _app_handle: &tauri::AppHandle,
    lines: &mut tokio::io::Lines<BufReader<tokio::io::ReadHalf<tokio::net::UnixStream>>>,
    conversation_writer: Option<&Mutex<crate::conversation::ConversationWriter>>,
    current_step_id: Option<&str>,
) -> Result<(String, String), String> {
    let idle_timeout = std::time::Duration::from_secs(120);
    let mut response_text = String::new();
    let mut session_id = String::new();

    loop {
        let line_result = tokio::time::timeout(idle_timeout, lines.next_line()).await;
        let line = match line_result {
            Err(_) => return Err("supervisor: worker timed out".to_string()),
            Ok(Err(e)) => return Err(format!("supervisor: read error: {e}")),
            Ok(Ok(None)) => return Err("supervisor: socket closed".to_string()),
            Ok(Ok(Some(line))) => line,
        };

        let msg: JsonRpcMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let Some(method) = msg.method.as_deref() else {
            // Response to our queryFollowUp — ignore
            continue;
        };

        let params = msg.params.unwrap_or(json!({}));

        match method {
            "message" => {
                // Forward streaming messages to frontend
                let msg_type = params.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let content = params.get("content").and_then(|c| c.as_str()).unwrap_or("");

                let chunk_type = match msg_type {
                    "text" => "text",
                    "thinking" => "thinking",
                    "tool_start" | "tool_end" | "tool_input" | "tool_result" | "tool_progress" => {
                        "tool"
                    }
                    "error" => "error",
                    _ => "other",
                };

                let _ = on_chunk.send(StreamChunk {
                    issue_id: issue_id.to_string(),
                    chunk_type: chunk_type.to_string(),
                    content: content.to_string(),
                });

                // Persist to conversation log
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
                        session_id = sid.to_string();
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
                return Ok((response_text, session_id));
            }
            "queryError" => {
                let message = params
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown agent error");
                return Err(format!("supervisor: worker error: {message}"));
            }
            _ => {
                // toolApproval, reviewRequest, etc. — these need the same handling as
                // the main read loop. For now, log and skip. The existing permission/review
                // handlers on AgentHandle will NOT work here because we're in a different
                // read context. This is a known limitation for v1 — permission requests
                // during supervisor follow-up turns won't be handled.
                log::warn!("supervisor: unhandled method during follow-up: {method}");
            }
        }
    }
}
