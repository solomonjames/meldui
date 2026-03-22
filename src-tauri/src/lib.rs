mod agent;
#[allow(dead_code)]
mod beads;
mod claude;
mod menu;
mod preferences;
mod settings;
mod sync;
mod tickets;
mod workflow;

use agent::AgentState;
use tickets::Ticket;
use workflow::{
    BranchInfo, CommitActionResult, DiffFile, StepExecutionResult, WorkflowDefinition,
    WorkflowState, WorkflowSuggestion,
};
// ── Folder dialog command ──

#[tauri::command]
#[specta::specta]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    let selected = rx.await.map_err(|e| e.to_string())?;

    // Guard: reject worktree directories — they are not valid project roots
    if let Some(ref path) = selected {
        if path.contains("/.meldui/worktrees/") {
            log::warn!("open_folder_dialog: rejected worktree path: {}", path);
            return Ok(None); // treat as cancelled
        }
    }

    Ok(selected)
}

// ── Claude commands ──

#[tauri::command]
#[specta::specta]
async fn claude_status() -> Result<claude::ClaudeStatus, String> {
    claude::get_status().await
}

#[tauri::command]
#[specta::specta]
async fn claude_login() -> Result<claude::ClaudeStatus, String> {
    claude::login().await
}

// ── Agent commands ──

#[tauri::command]
#[specta::specta]
async fn agent_permission_respond(
    request_id: String,
    allowed: bool,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    let handle_guard = state.handle.lock().await;
    if let Some(handle) = handle_guard.as_ref() {
        handle.respond_to_permission(&request_id, allowed).await
    } else {
        Err("No active agent session".to_string())
    }
}

#[tauri::command]
#[specta::specta]
async fn agent_feedback_respond(
    request_id: String,
    approved: bool,
    feedback: Option<String>,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    let handle_guard = state.handle.lock().await;
    if let Some(handle) = handle_guard.as_ref() {
        handle
            .respond_to_feedback(&request_id, approved, feedback)
            .await
    } else {
        Err("No active agent session".to_string())
    }
}

#[tauri::command]
#[specta::specta]
async fn agent_review_respond(
    request_id: String,
    submission: serde_json::Value,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    let handle_guard = state.handle.lock().await;
    if let Some(handle) = handle_guard.as_ref() {
        handle.respond_to_review(&request_id, submission).await
    } else {
        Err("No active agent session".to_string())
    }
}

// ── Ticket commands ──

#[tauri::command]
#[specta::specta]
async fn ticket_list(
    project_dir: String,
    status: Option<String>,
    ticket_type: Option<String>,
    show_all: Option<bool>,
) -> Result<Vec<Ticket>, String> {
    tickets::list_tickets(
        &project_dir,
        status.as_deref(),
        ticket_type.as_deref(),
        show_all.unwrap_or(true),
    )
}

#[tauri::command]
#[specta::specta]
async fn ticket_create(
    project_dir: String,
    title: String,
    description: Option<String>,
    ticket_type: Option<String>,
    priority: Option<i32>,
) -> Result<Ticket, String> {
    tickets::create_ticket(
        &project_dir,
        &title,
        description.as_deref(),
        ticket_type.as_deref().unwrap_or("task"),
        priority.unwrap_or(2),
    )
}

#[tauri::command]
#[specta::specta]
async fn ticket_update(
    project_dir: String,
    id: String,
    title: Option<String>,
    status: Option<String>,
    priority: Option<i32>,
    description: Option<String>,
    notes: Option<String>,
    design: Option<String>,
    acceptance_criteria: Option<String>,
    metadata: Option<String>,
) -> Result<Ticket, String> {
    tickets::update_ticket(
        &project_dir,
        &id,
        title.as_deref(),
        status.as_deref(),
        priority,
        description.as_deref(),
        notes.as_deref(),
        design.as_deref(),
        acceptance_criteria.as_deref(),
        metadata.as_deref(),
    )
}

#[tauri::command]
#[specta::specta]
async fn ticket_close(
    project_dir: String,
    id: String,
    reason: Option<String>,
) -> Result<Ticket, String> {
    tickets::close_ticket(&project_dir, &id, reason.as_deref())
}

#[tauri::command]
#[specta::specta]
async fn ticket_show(project_dir: String, id: String) -> Result<Ticket, String> {
    tickets::show_ticket(&project_dir, &id)
}

#[tauri::command]
#[specta::specta]
async fn ticket_delete(project_dir: String, id: String) -> Result<(), String> {
    tickets::delete_ticket(&project_dir, &id)
}

#[tauri::command]
#[specta::specta]
async fn ticket_add_comment(
    project_dir: String,
    id: String,
    text: String,
) -> Result<Ticket, String> {
    tickets::add_comment(&project_dir, &id, "user", &text)
}

#[tauri::command]
#[specta::specta]
async fn ticket_update_section(
    project_dir: String,
    ticket_id: String,
    section_id: String,
    content: serde_json::Value,
) -> Result<Ticket, String> {
    tickets::update_section(&project_dir, &ticket_id, &section_id, content)
}

#[tauri::command]
#[specta::specta]
async fn ticket_initialize_sections(
    project_dir: String,
    ticket_id: String,
    section_defs: Vec<tickets::TicketSectionDef>,
) -> Result<Ticket, String> {
    tickets::initialize_ticket_sections(&project_dir, &ticket_id, section_defs)
}

// ── Settings commands ──

#[tauri::command]
#[specta::specta]
async fn settings_get(project_dir: String) -> Result<settings::ProjectSettings, String> {
    settings::get_settings(&project_dir)
}

#[tauri::command]
#[specta::specta]
async fn settings_update(
    project_dir: String,
    settings: settings::ProjectSettings,
) -> Result<(), String> {
    settings::update_settings(&project_dir, &settings)
}

// ── Sync commands ──

#[tauri::command]
#[specta::specta]
async fn sync_pull_all(project_dir: String) -> Result<Vec<Ticket>, String> {
    sync::pull_all(&project_dir).await
}

#[tauri::command]
#[specta::specta]
async fn sync_push_ticket(project_dir: String, id: String) -> Result<String, String> {
    let ticket = tickets::show_ticket(&project_dir, &id)?;
    sync::push_ticket(&project_dir, &ticket).await
}

// ── Workflow commands ──

#[tauri::command]
#[specta::specta]
async fn workflow_list(project_dir: String) -> Result<Vec<WorkflowDefinition>, String> {
    Ok(workflow::list_workflows(&project_dir))
}

#[tauri::command]
#[specta::specta]
async fn workflow_get(
    project_dir: String,
    workflow_id: String,
) -> Result<WorkflowDefinition, String> {
    workflow::get_workflow(&project_dir, &workflow_id)
        .ok_or_else(|| format!("Workflow '{}' not found", workflow_id))
}

#[tauri::command]
#[specta::specta]
async fn workflow_assign(
    project_dir: String,
    issue_id: String,
    workflow_id: String,
) -> Result<WorkflowState, String> {
    workflow::assign_workflow(&project_dir, &issue_id, &workflow_id)
}

#[tauri::command]
#[specta::specta]
async fn workflow_advance(project_dir: String, issue_id: String) -> Result<WorkflowState, String> {
    workflow::advance_step(&project_dir, &issue_id)
}

#[tauri::command]
#[specta::specta]
async fn workflow_state(
    project_dir: String,
    issue_id: String,
    state: tauri::State<'_, AgentState>,
) -> Result<Option<WorkflowState>, String> {
    let wf_state = workflow::get_workflow_state(&project_dir, &issue_id)?;

    // Detect stale in-progress steps: if step_status is "in_progress" but no
    // sidecar is running, the app was closed/restarted mid-step. Reset to
    // failed so the user sees a Resume button instead of a stuck spinner.
    if let Some(ref ws) = wf_state {
        if ws.step_status == workflow::StepStatus::InProgress {
            let handle_guard = state.handle.lock().await;
            if handle_guard.is_none() {
                // No active sidecar — step is stale
                let failed_state = workflow::update_step_status(
                    &project_dir,
                    &issue_id,
                    workflow::StepStatus::Failed(
                        "Session interrupted — click Resume to continue".to_string(),
                    ),
                )?;
                return Ok(Some(failed_state));
            }
        }
    }

    Ok(wf_state)
}

#[tauri::command]
#[specta::specta]
async fn workflow_execute_step(
    project_dir: String,
    issue_id: String,
    app: tauri::AppHandle,
) -> Result<StepExecutionResult, String> {
    workflow::execute_step(&project_dir, &issue_id, app).await
}

#[tauri::command]
#[specta::specta]
async fn workflow_suggest(
    project_dir: String,
    issue_id: String,
    app: tauri::AppHandle,
) -> Result<WorkflowSuggestion, String> {
    workflow::suggest_workflow(&project_dir, &issue_id, app).await
}

#[tauri::command]
#[specta::specta]
async fn workflow_get_diff(
    project_dir: String,
    base_commit: Option<String>,
) -> Result<Vec<DiffFile>, String> {
    workflow::get_diff(&project_dir, base_commit.as_deref()).await
}

#[tauri::command]
#[specta::specta]
async fn workflow_get_branch_info(project_dir: String) -> Result<BranchInfo, String> {
    workflow::get_branch_info(&project_dir).await
}

#[tauri::command]
#[specta::specta]
async fn workflow_execute_commit_action(
    project_dir: String,
    issue_id: String,
    action: String,
    commit_message: String,
    app: tauri::AppHandle,
) -> Result<CommitActionResult, String> {
    workflow::execute_commit_action(&project_dir, &issue_id, &action, &commit_message, app).await
}

#[tauri::command]
#[specta::specta]
async fn workflow_cleanup_worktree(project_dir: String, issue_id: String) -> Result<(), String> {
    workflow::remove_worktree(&project_dir, &issue_id).await
}

// ── App setup ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use agent::{
        AgentFeedbackRequest, AgentPermissionRequest, AgentReviewFindingsRequest,
        NotificationEvent, PrUrlReportedEvent, SectionUpdateEvent, StatusUpdateEvent,
        StepCompleteEvent, SubtaskClosed, SubtaskCreated, SubtaskUpdated,
    };
    use claude::StreamChunk;

    let builder = tauri_specta::Builder::<tauri::Wry>::new()
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .commands(tauri_specta::collect_commands![
            open_folder_dialog,
            claude_status,
            claude_login,
            agent_permission_respond,
            agent_feedback_respond,
            agent_review_respond,
            ticket_list,
            ticket_create,
            ticket_update,
            ticket_close,
            ticket_show,
            ticket_delete,
            ticket_add_comment,
            ticket_update_section,
            ticket_initialize_sections,
            settings_get,
            settings_update,
            sync_pull_all,
            sync_push_ticket,
            workflow_list,
            workflow_get,
            workflow_assign,
            workflow_advance,
            workflow_state,
            workflow_execute_step,
            workflow_suggest,
            workflow_get_diff,
            workflow_get_branch_info,
            workflow_execute_commit_action,
            workflow_cleanup_worktree,
            preferences::get_app_preferences,
            preferences::set_app_preferences,
            preferences::open_preferences_window,
        ])
        .events(tauri_specta::collect_events![
            StreamChunk,
            AgentPermissionRequest,
            AgentFeedbackRequest,
            AgentReviewFindingsRequest,
            SubtaskCreated,
            SubtaskUpdated,
            SubtaskClosed,
            SectionUpdateEvent,
            NotificationEvent,
            StepCompleteEvent,
            StatusUpdateEvent,
            PrUrlReportedEvent,
            preferences::AppPreferences,
        ]);

    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AgentState::new())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Build and set macOS app menu
            match menu::build_app_menu(app) {
                Ok(menu) => {
                    app.set_menu(menu)?;
                    app.on_menu_event(|app_handle, event| {
                        if event.id().0.as_str() == "preferences" {
                            if let Err(e) = preferences::open_preferences_window(app_handle.clone())
                            {
                                log::error!("Failed to open preferences window: {}", e);
                            }
                        }
                    });
                }
                Err(e) => {
                    log::warn!("Failed to build app menu: {}", e);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn sanity_check() {
        assert_eq!(2 + 2, 4);
    }
}
