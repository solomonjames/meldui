mod agent;
mod beads;
mod claude;
mod workflow;

use agent::AgentState;
use beads::BeadsIssue;
use workflow::{
    DiffFile, StepExecutionResult, WorkflowDefinition, WorkflowState, WorkflowSuggestion,
};
// ── Folder dialog command ──

#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    rx.await.map_err(|e| e.to_string())
}

// ── Claude commands ──

#[tauri::command]
async fn claude_status() -> Result<String, String> {
    claude::get_status().await
}

#[tauri::command]
async fn claude_login() -> Result<String, String> {
    claude::login().await
}

// ── Agent commands ──

#[tauri::command]
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

// ── Beads commands ──

#[tauri::command]
async fn beads_status(project_dir: String) -> Result<String, String> {
    beads::get_status(&project_dir).await
}

#[tauri::command]
async fn beads_init(project_dir: String) -> Result<String, String> {
    beads::init(&project_dir).await
}

#[tauri::command]
async fn beads_list(
    project_dir: String,
    status: Option<String>,
    issue_type: Option<String>,
    show_all: Option<bool>,
) -> Result<Vec<BeadsIssue>, String> {
    beads::list_issues(
        &project_dir,
        status.as_deref(),
        issue_type.as_deref(),
        show_all.unwrap_or(false),
    )
    .await
}

#[tauri::command]
async fn beads_create(
    project_dir: String,
    title: String,
    description: Option<String>,
    issue_type: Option<String>,
    priority: Option<String>,
) -> Result<BeadsIssue, String> {
    beads::create_issue(
        &project_dir,
        &title,
        description.as_deref(),
        issue_type.as_deref().unwrap_or("task"),
        priority.as_deref().unwrap_or("2"),
    )
    .await
}

#[tauri::command]
async fn beads_update(
    project_dir: String,
    id: String,
    title: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    description: Option<String>,
    notes: Option<String>,
    design: Option<String>,
    acceptance: Option<String>,
    metadata: Option<String>,
) -> Result<serde_json::Value, String> {
    beads::update_issue(
        &project_dir,
        &id,
        title.as_deref(),
        status.as_deref(),
        priority.as_deref(),
        description.as_deref(),
        notes.as_deref(),
        design.as_deref(),
        acceptance.as_deref(),
        metadata.as_deref(),
    )
    .await
}

#[tauri::command]
async fn beads_close(
    project_dir: String,
    id: String,
    reason: Option<String>,
) -> Result<serde_json::Value, String> {
    beads::close_issue(&project_dir, &id, reason.as_deref()).await
}

#[tauri::command]
async fn beads_show(project_dir: String, id: String) -> Result<Vec<BeadsIssue>, String> {
    beads::show_issue(&project_dir, &id).await
}

#[tauri::command]
async fn beads_delete(project_dir: String, id: String) -> Result<serde_json::Value, String> {
    beads::delete_issue(&project_dir, &id).await
}

#[tauri::command]
async fn beads_add_comment(
    project_dir: String,
    id: String,
    text: String,
) -> Result<serde_json::Value, String> {
    beads::add_comment(&project_dir, &id, &text).await
}

// ── Workflow commands ──

#[tauri::command]
async fn workflow_list(project_dir: String) -> Result<Vec<WorkflowDefinition>, String> {
    Ok(workflow::list_workflows(&project_dir))
}

#[tauri::command]
async fn workflow_get(
    project_dir: String,
    workflow_id: String,
) -> Result<WorkflowDefinition, String> {
    workflow::get_workflow(&project_dir, &workflow_id)
        .ok_or_else(|| format!("Workflow '{}' not found", workflow_id))
}

#[tauri::command]
async fn workflow_assign(
    project_dir: String,
    issue_id: String,
    workflow_id: String,
) -> Result<WorkflowState, String> {
    workflow::assign_workflow(&project_dir, &issue_id, &workflow_id).await
}

#[tauri::command]
async fn workflow_advance(project_dir: String, issue_id: String) -> Result<WorkflowState, String> {
    workflow::advance_step(&project_dir, &issue_id).await
}

#[tauri::command]
async fn workflow_state(
    project_dir: String,
    issue_id: String,
) -> Result<Option<WorkflowState>, String> {
    workflow::get_workflow_state(&project_dir, &issue_id).await
}

#[tauri::command]
async fn workflow_execute_step(
    project_dir: String,
    issue_id: String,
    app: tauri::AppHandle,
) -> Result<StepExecutionResult, String> {
    workflow::execute_step(&project_dir, &issue_id, app).await
}

#[tauri::command]
async fn workflow_suggest(
    project_dir: String,
    issue_id: String,
    app: tauri::AppHandle,
) -> Result<WorkflowSuggestion, String> {
    workflow::suggest_workflow(&project_dir, &issue_id, app).await
}

#[tauri::command]
async fn workflow_get_diff(project_dir: String) -> Result<Vec<DiffFile>, String> {
    workflow::get_diff(&project_dir).await
}

// ── App setup ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AgentState::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            claude_status,
            claude_login,
            agent_permission_respond,
            beads_status,
            beads_init,
            beads_list,
            beads_create,
            beads_update,
            beads_close,
            beads_show,
            beads_delete,
            beads_add_comment,
            workflow_list,
            workflow_get,
            workflow_assign,
            workflow_advance,
            workflow_state,
            workflow_execute_step,
            workflow_suggest,
            workflow_get_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
