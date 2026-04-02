// Many items are `pub` so specta/tauri-specta can generate TypeScript bindings.
#![allow(unreachable_pub)]
//! MeldUI Tauri backend — the IPC command layer.
//!
//! Exposes Tauri commands that the React frontend calls via `invoke()`.
//! Coordinates ticket CRUD, workflow orchestration, agent sidecar communication,
//! external CLI wrappers (claude, git), and conversation persistence.
mod agent;
mod claude;
mod constants;
mod conversation;
pub mod conversation_db;
pub(crate) mod embeddings;
mod menu;
mod preferences;
pub(crate) mod schema;
mod settings;
mod tickets;
mod workflow;

use agent::AgentState;
use conversation_db::ConversationDbManager;
use embeddings::Embedder;
use tauri::Manager;
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
            log::warn!("open_folder_dialog: rejected worktree path: {path}");
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
    issue_id: String,
    request_id: String,
    allowed: bool,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    let handle = {
        let guard = state.handles.lock().await;
        guard
            .get(&issue_id)
            .cloned()
            .ok_or_else(|| format!("No active agent for ticket {issue_id}"))?
    };
    handle
        .respond_to_permission(&request_id, allowed)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn agent_review_respond(
    issue_id: String,
    request_id: String,
    submission: serde_json::Value,
    state: tauri::State<'_, AgentState>,
) -> Result<(), String> {
    let handle = {
        let guard = state.handles.lock().await;
        guard
            .get(&issue_id)
            .cloned()
            .ok_or_else(|| format!("No active agent for ticket {issue_id}"))?
    };
    handle
        .respond_to_review(&request_id, submission)
        .await
        .map_err(|e| e.to_string())
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
#[allow(clippy::too_many_arguments)] // Tauri commands receive owned values from IPC
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
    let mut s = settings::get_settings(&project_dir)?;
    s.encryption_key = None; // Never expose to frontend
    Ok(s)
}

#[tauri::command]
#[specta::specta]
async fn settings_update(
    project_dir: String,
    settings: settings::ProjectSettings,
) -> Result<(), String> {
    settings::update_settings(&project_dir, &settings)
}

// ── Conversation encryption commands ──

#[tauri::command]
#[specta::specta]
async fn conversation_set_encryption(
    project_dir: String,
    key: Option<String>,
) -> Result<(), String> {
    // Store the encryption key in project settings.
    // TODO: Actually re-encrypting an existing DB requires export/reimport.
    // For now we only persist the key so new databases (or after manual re-creation)
    // will use it.
    let mut s = settings::get_settings(&project_dir)?;
    s.encryption_key = key;
    settings::update_settings(&project_dir, &s)
}

#[tauri::command]
#[specta::specta]
async fn conversation_encryption_status(project_dir: String) -> Result<bool, String> {
    let s = settings::get_settings(&project_dir)?;
    Ok(s.encryption_key.is_some())
}

// ── Conversation commands ──

#[tauri::command]
#[specta::specta]
async fn conversation_restore(
    project_dir: String,
    ticket_id: String,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Option<conversation::ConversationSnapshot>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::restore_conversation(&conn, &ticket_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn conversation_list(
    project_dir: String,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::ConversationSummary>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::list_conversations(&conn)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn conversation_search(
    project_dir: String,
    query: String,
    ticket_id: Option<String>,
    limit: Option<u32>,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::SearchResult>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::search_conversations(&conn, &query, ticket_id.as_deref(), limit.unwrap_or(50))
        .await
        .map_err(|e| e.to_string())
}

// ── Semantic / hybrid search commands ──

#[tauri::command]
#[specta::specta]
async fn conversation_semantic_search(
    project_dir: String,
    query: String,
    ticket_id: Option<String>,
    limit: Option<u32>,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::SemanticSearchResult>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;

    // Use MockEmbedder for now; will switch to LocalEmbedder when ONNX is ready
    let embedder = embeddings::MockEmbedder;
    let query_embedding = embedder.embed(&query)?;

    conversation::semantic_search(
        &conn,
        &query_embedding,
        ticket_id.as_deref(),
        limit.unwrap_or(20),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn conversation_hybrid_search(
    project_dir: String,
    query: String,
    ticket_id: Option<String>,
    limit: Option<u32>,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::HybridSearchResult>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;

    let embedder = embeddings::MockEmbedder;
    let query_embedding = embedder.embed(&query)?;

    conversation::hybrid_search(
        &conn,
        &query,
        &query_embedding,
        ticket_id.as_deref(),
        limit.unwrap_or(20),
    )
    .await
    .map_err(|e| e.to_string())
}

// ── RAG context commands ──

#[tauri::command]
#[specta::specta]
async fn conversation_rag_context(
    project_dir: String,
    task_description: String,
    max_tokens: Option<u32>,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::ContextChunk>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;

    let embedder = embeddings::MockEmbedder;
    let query_embedding = embedder.embed(&task_description)?;

    conversation::get_rag_context(&conn, &query_embedding, max_tokens.unwrap_or(4000))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn conversation_related(
    project_dir: String,
    ticket_id: String,
    limit: Option<u32>,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::RelatedConversation>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;

    conversation::get_related_conversations(&conn, &ticket_id, limit.unwrap_or(5))
        .await
        .map_err(|e| e.to_string())
}

// ── Conversation stats command ──

#[tauri::command]
#[specta::specta]
async fn conversation_stats(
    project_dir: String,
    ticket_id: String,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<conversation::ConversationStats, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::get_conversation_stats(&conn, &ticket_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Turn query commands ──

#[tauri::command]
#[specta::specta]
async fn conversation_load_turn(
    project_dir: String,
    ticket_id: String,
    turn_id: String,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::ConversationEventRecord>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::load_turn(&conn, &ticket_id, &turn_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn conversation_list_turns(
    project_dir: String,
    ticket_id: String,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::TurnSummary>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::list_turns(&conn, &ticket_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Conversation cleanup command ──

#[tauri::command]
#[specta::specta]
async fn conversation_cleanup(
    project_dir: String,
    max_age_days: Option<u32>,
    max_conversations: Option<u32>,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<conversation::CleanupResult, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::cleanup_old_conversations(
        &conn,
        max_age_days.unwrap_or(90),
        max_conversations.unwrap_or(500),
    )
    .await
    .map_err(|e| e.to_string())
}

// ── Checkpoint commands ──

#[tauri::command]
#[specta::specta]
async fn conversation_checkpoints(
    project_dir: String,
    ticket_id: String,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Vec<conversation::CheckpointRecord>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::get_checkpoints(&conn, &ticket_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn conversation_checkpoint_for_turn(
    project_dir: String,
    ticket_id: String,
    turn_id: String,
    db_manager: tauri::State<'_, ConversationDbManager>,
) -> Result<Option<conversation::CheckpointRecord>, String> {
    let conn = db_manager
        .get_connection(&project_dir)
        .await
        .map_err(|e| e.to_string())?;
    conversation::get_checkpoint_for_turn(&conn, &ticket_id, &turn_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Project file commands ──

#[tauri::command]
#[specta::specta]
async fn list_project_files(project_dir: String) -> Result<Vec<String>, String> {
    use std::path::Path;

    let root = Path::new(&project_dir);
    if !root.is_dir() {
        return Err("Invalid project directory".to_string());
    }

    let mut files = Vec::new();
    let walker = ignore::WalkBuilder::new(root).max_depth(Some(6)).build();

    for entry in walker {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_some_and(|ft| ft.is_file()) {
            if let Ok(relative) = entry.path().strip_prefix(root) {
                files.push(relative.to_string_lossy().to_string());
            }
        }
        if files.len() >= 1000 {
            break;
        }
    }

    files.sort();
    Ok(files)
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
        .ok_or_else(|| format!("Workflow '{workflow_id}' not found"))
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
    app: tauri::AppHandle,
) -> Result<Option<WorkflowState>, String> {
    let wf_state = workflow::get_workflow_state(&project_dir, &issue_id)?;

    // Detect stale in-progress steps: if step_status is "in_progress" but no
    // sidecar is running for this ticket, the app was closed/restarted mid-step.
    // Reset to failed so the user sees a Resume button instead of a stuck spinner.
    if let Some(ref ws) = wf_state {
        if ws.step_status == workflow::StepStatus::InProgress {
            let handle_guard = state.handles.lock().await;
            if !handle_guard.contains_key(&issue_id) {
                // No active sidecar for this ticket — step is stale
                let failed_state = workflow::update_step_status(
                    &project_dir,
                    &issue_id,
                    workflow::StepStatus::Failed(
                        "Session interrupted — click Resume to continue where you left off"
                            .to_string(),
                    ),
                )?;

                // Best-effort: also mark conversation DB as interrupted
                if let Some(db_manager) = app.try_state::<ConversationDbManager>() {
                    if let Ok(conn) = db_manager.get_connection(&project_dir).await {
                        let now = chrono::Utc::now().to_rfc3339();
                        if let Some(ref step_id) = ws.current_step_id {
                            if let Err(e) = conn
                                .execute(
                                    "UPDATE conversation_steps SET status = 'interrupted', completed_at = ?1 WHERE ticket_id = ?2 AND step_id = ?3 AND status = 'in_progress'",
                                    libsql::params![now.clone(), issue_id.clone(), step_id.clone()],
                                )
                                .await
                            {
                                log::warn!("Failed to mark conversation step as interrupted: {e}");
                            }
                        }
                        if let Err(e) = conn
                            .execute(
                                "UPDATE conversations SET status = 'interrupted' WHERE ticket_id = ?1",
                                libsql::params![issue_id.clone()],
                            )
                            .await
                        {
                            log::warn!("Failed to mark conversation as interrupted: {e}");
                        }
                    }
                }

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
    on_chunk: tauri::ipc::Channel<claude::StreamChunk>,
    user_message: Option<String>,
    app: tauri::AppHandle,
) -> Result<StepExecutionResult, String> {
    workflow::execute_step(&project_dir, &issue_id, on_chunk, app, user_message).await
}

#[tauri::command]
#[specta::specta]
async fn workflow_suggest(
    project_dir: String,
    issue_id: String,
    on_chunk: tauri::ipc::Channel<claude::StreamChunk>,
    app: tauri::AppHandle,
) -> Result<WorkflowSuggestion, String> {
    workflow::suggest_workflow(&project_dir, &issue_id, on_chunk, app).await
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
    on_chunk: tauri::ipc::Channel<claude::StreamChunk>,
    app: tauri::AppHandle,
) -> Result<CommitActionResult, String> {
    workflow::execute_commit_action(
        &project_dir,
        &issue_id,
        &action,
        &commit_message,
        on_chunk,
        app,
    )
    .await
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
        agent_set_effort, agent_set_fast_mode, agent_set_model, agent_set_thinking,
        get_auto_advance, set_auto_advance, AgentInitMetadata, AgentPermissionRequest,
        AgentReviewFindingsRequest, AgentSessionEnded, NotificationEvent, PrUrlReportedEvent,
        SectionUpdateEvent, StatusUpdateEvent, SubtaskClosed, SubtaskCreated, SubtaskUpdated,
        SupervisorEvaluating, SupervisorReply,
    };
    let builder = tauri_specta::Builder::<tauri::Wry>::new()
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .commands(tauri_specta::collect_commands![
            open_folder_dialog,
            claude_status,
            claude_login,
            agent_permission_respond,
            agent_review_respond,
            agent_set_model,
            agent_set_thinking,
            agent_set_effort,
            agent_set_fast_mode,
            set_auto_advance,
            get_auto_advance,
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
            conversation_set_encryption,
            conversation_encryption_status,
            conversation_restore,
            conversation_list,
            conversation_search,
            conversation_stats,
            conversation_load_turn,
            conversation_list_turns,
            conversation_checkpoints,
            conversation_checkpoint_for_turn,
            conversation_cleanup,
            conversation_semantic_search,
            conversation_hybrid_search,
            conversation_rag_context,
            conversation_related,
            list_project_files,
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
            AgentPermissionRequest,
            AgentReviewFindingsRequest,
            AgentInitMetadata,
            AgentSessionEnded,
            SubtaskCreated,
            SubtaskUpdated,
            SubtaskClosed,
            SectionUpdateEvent,
            NotificationEvent,
            StatusUpdateEvent,
            PrUrlReportedEvent,
            SupervisorEvaluating,
            SupervisorReply,
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
        .manage(ConversationDbManager::new())
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
                                log::error!("Failed to open preferences window: {e}");
                            }
                        }
                    });
                }
                Err(e) => {
                    log::warn!("Failed to build app menu: {e}");
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
