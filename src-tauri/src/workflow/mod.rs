//! Workflow orchestration — step execution, prompt building, and suggestions.

mod definition;
mod diff;
mod state;
mod worktree;

pub use definition::*;
pub use diff::*;
pub use state::*;
pub use worktree::*;

use serde::{Deserialize, Serialize};

// ── Step Execution ──

/// Build the full prompt for a step by combining instructions with ticket context
fn build_step_prompt(
    step: &WorkflowStep,
    ticket: &crate::tickets::Ticket,
    state: &WorkflowState,
) -> Result<String, String> {
    let instructions = match &step.instructions {
        StepInstructions::Prompt { prompt } => prompt.clone(),
        StepInstructions::File { file } => std::fs::read_to_string(file)
            .map_err(|e| format!("Failed to read instruction file '{file}': {e}"))?,
    };

    let mut prompt = instructions;

    // Append ticket context
    prompt.push_str("\n\n## Ticket Context\n\n");
    prompt.push_str(&format!("**ID:** {}\n", ticket.id));
    prompt.push_str(&format!("**Title:** {}\n", ticket.title));
    prompt.push_str(&format!("**Status:** {}\n", ticket.status));

    if let Some(desc) = &ticket.description {
        if !desc.is_empty() {
            prompt.push_str(&format!("\n**Description:**\n{desc}\n"));
        }
    }
    if let Some(notes) = &ticket.notes {
        if !notes.is_empty() {
            prompt.push_str(&format!("\n**Notes:**\n{notes}\n"));
        }
    }
    if let Some(design) = &ticket.design {
        if !design.is_empty() {
            prompt.push_str(&format!("\n**Design:**\n{design}\n"));
        }
    }
    if let Some(acceptance) = &ticket.acceptance_criteria {
        if !acceptance.is_empty() {
            prompt.push_str(&format!("\n**Acceptance Criteria:**\n{acceptance}\n"));
        }
    }

    // Append workflow state context
    prompt.push_str("\n## Workflow State\n\n");
    prompt.push_str(&format!(
        "**Workflow:** {} ({})\n",
        state.workflow_id, step.name
    ));
    prompt.push_str(&format!(
        "**Current Step:** {} — {}\n",
        step.id, step.description
    ));

    if !state.step_history.is_empty() {
        prompt.push_str("\n**Completed Steps:**\n");
        for record in &state.step_history {
            prompt.push_str(&format!(
                "- {} (completed: {})\n",
                record.step_id,
                record.completed_at.as_deref().unwrap_or("unknown"),
            ));
        }
    }

    Ok(prompt)
}

/// Execute the current step: send instructions to Claude, store response, handle gates
pub async fn execute_step(
    project_dir: &str,
    ticket_id: &str,
    on_chunk: tauri::ipc::Channel<crate::claude::StreamChunk>,
    app_handle: tauri::AppHandle,
    user_message: Option<String>,
) -> Result<StepExecutionResult, String> {
    // 1. Load workflow state
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;

    let state =
        read_workflow_state(&ticket.metadata).ok_or("No workflow assigned to this ticket")?;

    let current_step_id = state
        .current_step_id
        .as_ref()
        .ok_or("Workflow already completed")?;

    // 2. Load workflow definition to get step details
    let wf = get_workflow(project_dir, &state.workflow_id)
        .ok_or_else(|| format!("Workflow '{}' not found", state.workflow_id))?;

    let step = wf
        .steps
        .iter()
        .find(|s| &s.id == current_step_id)
        .ok_or_else(|| format!("Step '{current_step_id}' not found in workflow"))?;

    // 3. Create worktree if this is the first step (no worktree_path in metadata yet)
    let has_worktree = ticket
        .metadata
        .get("worktree_path")
        .and_then(|v| v.as_str())
        .is_some();

    if !has_worktree {
        match create_worktree(project_dir, ticket_id).await {
            Ok(info) => {
                log::info!(
                    "worktree: created for ticket {} at {} (branch {})",
                    ticket_id,
                    info.path,
                    info.branch
                );
            }
            Err(e) => {
                log::error!("worktree: failed to create for ticket {ticket_id}: {e}");
                let _ = update_step_status(project_dir, ticket_id, StepStatus::Failed(e.clone()));
                return Err(format!("Failed to create worktree: {e}"));
            }
        }
    }

    // Resolve the effective project dir (worktree path if available)
    let agent_project_dir = effective_project_dir(project_dir, ticket_id);

    // 4. Set status to InProgress
    update_step_status(project_dir, ticket_id, StepStatus::InProgress)?;

    // 5. Build prompt
    // If user sent a follow-up message on a completed step, use that as the prompt.
    // Otherwise, build the normal step prompt and optionally append the user message.
    let is_follow_up = state
        .step_history
        .iter()
        .any(|r| r.step_id == *current_step_id);
    let prompt = if is_follow_up {
        if let Some(ref msg) = user_message {
            msg.clone()
        } else {
            build_step_prompt(step, &ticket, &state)?
        }
    } else {
        let mut base_prompt = build_step_prompt(step, &ticket, &state)?;
        if let Some(ref msg) = user_message {
            base_prompt.push_str("\n\n## User Message\n\n");
            base_prompt.push_str(msg);
        }
        base_prompt
    };

    // 6. Determine allowed tools based on step view type
    let view_str = match &step.view {
        StepViewType::Chat => "chat",
        StepViewType::Review => "review",
        _ => "progress",
    };
    let allowed_tools = crate::agent::tools_for_view(view_str);

    // 7. Get session_id from workflow state metadata for continuity
    let session_id = ticket
        .metadata
        .get("agent_session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 7b. Open conversation writer for persistence
    let conversation_writer =
        match crate::conversation::ConversationWriter::open(project_dir, ticket_id) {
            Ok(mut w) => {
                // Write step_start marker
                if let Err(e) = w.write_step_marker(
                    current_step_id,
                    &crate::conversation::StepMarker::Start {
                        label: step.name.clone(),
                    },
                ) {
                    log::error!("conversation: failed to write step_start: {e}");
                }
                Some(tokio::sync::Mutex::new(w))
            }
            Err(e) => {
                log::error!("conversation: failed to open writer: {e}");
                None
            }
        };

    // 8. Call agent sidecar with the worktree path as project_dir
    //    but keep original project_dir for tickets_dir so ticket reads/writes work
    let tickets_dir = format!("{project_dir}/.meldui/tickets");
    let (response_text, new_session_id) = match crate::agent::execute_step(
        &agent_project_dir,
        ticket_id,
        &prompt,
        session_id.as_deref(),
        Some(allowed_tools),
        &on_chunk,
        &app_handle,
        Some(&tickets_dir),
        Some(project_dir),
        conversation_writer.as_ref(),
        Some(current_step_id.as_str()),
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            if let Some(ref writer) = conversation_writer {
                let mut w = writer.lock().await;
                let _ = w.write_step_marker(
                    current_step_id,
                    &crate::conversation::StepMarker::End {
                        status: "failed".to_string(),
                    },
                );
                let _ = w.flush();
            }
            let _ = crate::conversation::snapshot_conversation(project_dir, ticket_id, None);
            let _ = update_step_status(project_dir, ticket_id, StepStatus::Failed(e.clone()));
            return Err(e);
        }
    };

    // Write step_end marker and snapshot
    if let Some(ref writer) = conversation_writer {
        let mut w = writer.lock().await;
        if let Err(e) = w.write_step_marker(
            current_step_id,
            &crate::conversation::StepMarker::End {
                status: "completed".to_string(),
            },
        ) {
            log::error!("conversation: failed to write step_end: {e}");
        }
        let _ = w.flush();
    }
    // Snapshot the conversation
    if let Err(e) = crate::conversation::snapshot_conversation(
        project_dir,
        ticket_id,
        Some(new_session_id.as_str()).filter(|s| !s.is_empty()),
    ) {
        log::error!("conversation: failed to snapshot: {e}");
    }

    // 8. Store session_id back into metadata for next step
    if !new_session_id.is_empty() {
        let fresh_ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;
        let mut meta = fresh_ticket.metadata;
        meta["agent_session_id"] = serde_json::Value::String(new_session_id);
        let meta_str = serde_json::to_string(&meta)
            .map_err(|e| format!("Failed to serialize session metadata: {e}"))?;
        crate::tickets::update_ticket(
            project_dir,
            ticket_id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(&meta_str),
        )?;
    }

    // 9. Only mark step completed if the agent didn't already advance the workflow.
    // When the agent calls meldui_step_complete, advance_step() moves current_step_id
    // to the next step. If we blindly call update_step_status(Completed) here, we'd
    // mark the NEXT step as completed before it runs.
    let fresh_state = get_workflow_state(project_dir, ticket_id)?;
    let already_advanced = match &fresh_state {
        Some(s) => s.current_step_id.as_deref() != Some(current_step_id),
        None => false,
    };

    if !already_advanced {
        update_step_status(project_dir, ticket_id, StepStatus::Completed)?;
    }

    let workflow_completed = fresh_state
        .as_ref()
        .map(|s| s.current_step_id.is_none())
        .unwrap_or(false);

    Ok(StepExecutionResult {
        step_id: current_step_id.clone(),
        response: response_text,
        workflow_completed,
    })
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct StepExecutionResult {
    pub step_id: String,
    pub response: String,
    pub workflow_completed: bool,
}

// ── Workflow Suggestion ──

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct WorkflowSuggestion {
    pub workflow_id: String,
    pub reasoning: String,
}

/// Suggest a workflow for a ticket based on complexity analysis
pub async fn suggest_workflow(
    project_dir: &str,
    ticket_id: &str,
    on_chunk: tauri::ipc::Channel<crate::claude::StreamChunk>,
    app_handle: tauri::AppHandle,
) -> Result<WorkflowSuggestion, String> {
    // Load the ticket
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;

    // Load available workflows
    let workflows = list_workflows(project_dir);
    let workflow_list: Vec<String> = workflows
        .iter()
        .map(|wf| format!("- {} ({}): {}", wf.id, wf.name, wf.description))
        .collect();

    let prompt = format!(
        "You are a complexity analyst. Evaluate this ticket and recommend which workflow to use.\n\n\
        ## Ticket\n\
        **Title:** {}\n\
        **Description:** {}\n\
        **Acceptance Criteria:** {}\n\n\
        ## Available Workflows\n\
        {}\n\n\
        Respond with ONLY a JSON object (no markdown, no code fences):\n\
        {{\"workflow_id\": \"the-id\", \"reasoning\": \"brief explanation\"}}\n",
        ticket.title,
        ticket.description.as_deref().unwrap_or("(none)"),
        ticket.acceptance_criteria.as_deref().unwrap_or("(none)"),
        workflow_list.join("\n"),
    );

    let (response, _session_id) = crate::agent::execute_step(
        project_dir,
        ticket_id,
        &prompt,
        None,
        Some(vec!["Read".into(), "Glob".into(), "Grep".into()]),
        &on_chunk,
        &app_handle,
        None,
        None,
        None,
        None,
    )
    .await?;

    // Parse the JSON response
    let trimmed = response.trim();
    // Try to extract JSON from the response (handle possible markdown wrapping)
    let json_str = if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            &trimmed[start..=end]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    serde_json::from_str::<WorkflowSuggestion>(json_str)
        .map_err(|e| format!("Failed to parse workflow suggestion: {e} — raw: {response}"))
}
