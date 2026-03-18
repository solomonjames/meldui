use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ── Worktree Management ──

#[derive(Debug, Serialize, Clone)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
}

/// Create a git worktree for a ticket workflow.
///
/// Creates the worktree at `.meldui/worktrees/{ticket_id}/` on branch `meld/{ticket_id}`.
/// If a `worktree.setup_command` is configured in project settings, runs it in the worktree.
pub async fn create_worktree(project_dir: &str, ticket_id: &str) -> Result<WorktreeInfo, String> {
    use std::process::Stdio;
    use tokio::process::Command;

    let branch_name = format!("meld/{}", ticket_id);
    let worktree_path = PathBuf::from(project_dir)
        .join(".meldui")
        .join("worktrees")
        .join(ticket_id);
    let worktree_str = worktree_path
        .to_str()
        .ok_or("Invalid worktree path")?
        .to_string();

    // Ensure parent directory exists
    if let Some(parent) = worktree_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create worktrees directory: {}", e))?;
        }
    }

    // Capture the base commit hash before creating the worktree (this is the branch point)
    let base_commit_output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to get base commit: {}", e))?;
    let base_commit = String::from_utf8_lossy(&base_commit_output.stdout)
        .trim()
        .to_string();

    // Create the worktree
    let output = Command::new("git")
        .args(["worktree", "add", &worktree_str, "-b", &branch_name])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to create worktree: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If the branch already exists, try adding worktree with existing branch
        if stderr.contains("already exists") {
            let output2 = Command::new("git")
                .args(["worktree", "add", &worktree_str, &branch_name])
                .current_dir(project_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
                .map_err(|e| format!("Failed to create worktree: {}", e))?;

            if !output2.status.success() {
                let stderr2 = String::from_utf8_lossy(&output2.stderr);
                return Err(format!("Failed to create worktree: {}", stderr2));
            }
        } else {
            return Err(format!("Failed to create worktree: {}", stderr));
        }
    }

    log::info!(
        "worktree: created at {} on branch {}",
        worktree_str,
        branch_name
    );

    // Run setup command if configured
    let settings = crate::settings::get_settings(project_dir).unwrap_or_default();
    if let Some(ref wt_settings) = settings.worktree {
        if let Some(ref setup_cmd) = wt_settings.setup_command {
            if !setup_cmd.trim().is_empty() {
                log::info!("worktree: running setup command: {}", setup_cmd);
                let setup_output = Command::new("sh")
                    .args(["-c", setup_cmd])
                    .current_dir(&worktree_str)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .await
                    .map_err(|e| format!("Failed to run worktree setup command: {}", e))?;

                if !setup_output.status.success() {
                    let stderr = String::from_utf8_lossy(&setup_output.stderr);
                    return Err(format!("Worktree setup command failed: {}", stderr.trim()));
                }
                log::info!("worktree: setup command completed successfully");
            }
        }
    }

    // Store worktree info in ticket metadata
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;
    let mut meta = ticket.metadata.clone();
    meta["worktree_path"] = serde_json::Value::String(worktree_str.clone());
    meta["worktree_branch"] = serde_json::Value::String(branch_name.clone());
    if !base_commit.is_empty() {
        meta["worktree_base_commit"] = serde_json::Value::String(base_commit.clone());
    }
    let meta_str = serde_json::to_string(&meta)
        .map_err(|e| format!("Failed to serialize worktree metadata: {}", e))?;
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

    Ok(WorktreeInfo {
        path: worktree_str,
        branch: branch_name,
    })
}

/// Remove a git worktree for a ticket.
pub async fn remove_worktree(project_dir: &str, ticket_id: &str) -> Result<(), String> {
    use std::process::Stdio;
    use tokio::process::Command;

    let worktree_path = PathBuf::from(project_dir)
        .join(".meldui")
        .join("worktrees")
        .join(ticket_id);
    let worktree_str = worktree_path
        .to_str()
        .ok_or("Invalid worktree path")?
        .to_string();

    if !worktree_path.exists() {
        // Already gone — just clean up metadata
        clear_worktree_metadata(project_dir, ticket_id)?;
        return Ok(());
    }

    // Remove the worktree
    let output = Command::new("git")
        .args(["worktree", "remove", &worktree_str, "--force"])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to remove worktree: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("worktree: git worktree remove failed: {}", stderr);
        // Fall back to manual removal
        if worktree_path.exists() {
            std::fs::remove_dir_all(&worktree_path)
                .map_err(|e| format!("Failed to remove worktree directory: {}", e))?;
        }
        // Prune stale worktree references
        let _ = Command::new("git")
            .args(["worktree", "prune"])
            .current_dir(project_dir)
            .output()
            .await;
    }

    log::info!("worktree: removed {}", worktree_str);

    // Delete the branch
    let branch_name = format!("meld/{}", ticket_id);
    let _ = Command::new("git")
        .args(["branch", "-D", &branch_name])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    clear_worktree_metadata(project_dir, ticket_id)?;
    Ok(())
}

fn clear_worktree_metadata(project_dir: &str, ticket_id: &str) -> Result<(), String> {
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;
    let mut meta = ticket.metadata.clone();
    if let Some(obj) = meta.as_object_mut() {
        obj.remove("worktree_path");
        obj.remove("worktree_branch");
    }
    let meta_str =
        serde_json::to_string(&meta).map_err(|e| format!("Failed to serialize metadata: {}", e))?;
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
    Ok(())
}

/// Get the effective project_dir for agent execution.
/// Returns the worktree path if one exists, otherwise the original project_dir.
fn effective_project_dir(project_dir: &str, ticket_id: &str) -> String {
    if let Ok(ticket) = crate::tickets::show_ticket(project_dir, ticket_id) {
        if let Some(wt_path) = ticket
            .metadata
            .get("worktree_path")
            .and_then(|v| v.as_str())
        {
            if PathBuf::from(wt_path).exists() {
                return wt_path.to_string();
            }
        }
    }
    project_dir.to_string()
}

// ── Workflow Definition (parsed from YAML) ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub steps: Vec<WorkflowStep>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StepViewType {
    Chat,
    Review,
    Progress,
    DiffReview,
    Commit,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowStep {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: StepInstructions,
    pub view: StepViewType,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum StepInstructions {
    Prompt { prompt: String },
    File { file: String },
}

// ── Workflow State (stored in ticket metadata) ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowState {
    pub workflow_id: String,
    pub current_step_id: Option<String>,
    pub step_status: StepStatus,
    pub step_history: Vec<StepRecord>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Failed(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepRecord {
    pub step_id: String,
    pub status: StepStatus,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub output_summary: Option<String>,
}

// ── Workflow Loading ──

/// Load bundled workflow definitions embedded at compile time
pub fn load_bundled_workflows() -> Vec<WorkflowDefinition> {
    let mut workflows = Vec::new();

    let bundled_yamls: &[&str] = &[
        include_str!("../workflows/meld-full.yaml"),
        include_str!("../workflows/meld-quick.yaml"),
    ];

    for yaml_str in bundled_yamls {
        match serde_yaml::from_str::<WorkflowDefinition>(yaml_str) {
            Ok(wf) => workflows.push(wf),
            Err(e) => eprintln!("Failed to parse bundled workflow: {}", e),
        }
    }

    workflows
}

/// Load workflow definitions from a project's .meldui/workflows/ directory
pub fn load_project_workflows(project_dir: &str) -> Vec<WorkflowDefinition> {
    let workflows_dir = PathBuf::from(project_dir).join(".meldui").join("workflows");
    let mut workflows = Vec::new();

    if !workflows_dir.exists() {
        return workflows;
    }

    let entries = match std::fs::read_dir(&workflows_dir) {
        Ok(entries) => entries,
        Err(_) => return workflows,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "yaml" && ext != "yml" {
            continue;
        }

        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_yaml::from_str::<WorkflowDefinition>(&content) {
                Ok(wf) => workflows.push(wf),
                Err(e) => eprintln!("Failed to parse {}: {}", path.display(), e),
            },
            Err(e) => eprintln!("Failed to read {}: {}", path.display(), e),
        }
    }

    workflows
}

/// List all available workflows (project overrides bundled by matching id)
pub fn list_workflows(project_dir: &str) -> Vec<WorkflowDefinition> {
    let bundled = load_bundled_workflows();
    let project = load_project_workflows(project_dir);

    let mut result: Vec<WorkflowDefinition> = Vec::new();

    // Start with bundled, then override with project-level by id
    for wf in &bundled {
        if let Some(override_wf) = project.iter().find(|p| p.id == wf.id) {
            result.push(override_wf.clone());
        } else {
            result.push(wf.clone());
        }
    }

    // Add project workflows that don't override a bundled one
    for wf in &project {
        if !bundled.iter().any(|b| b.id == wf.id) {
            result.push(wf.clone());
        }
    }

    result
}

/// Get a specific workflow by id (project overrides bundled)
pub fn get_workflow(project_dir: &str, workflow_id: &str) -> Option<WorkflowDefinition> {
    list_workflows(project_dir)
        .into_iter()
        .find(|wf| wf.id == workflow_id)
}

// ── Workflow State Machine ──

const WORKFLOW_STATE_KEY: &str = "workflow";

/// Read workflow state from ticket metadata
fn read_workflow_state(metadata: &serde_json::Value) -> Option<WorkflowState> {
    metadata
        .get(WORKFLOW_STATE_KEY)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}

/// Merge workflow state into existing metadata (read-merge-write)
fn merge_workflow_state(metadata: &serde_json::Value, state: &WorkflowState) -> serde_json::Value {
    let mut meta = metadata.clone();

    if let Ok(state_value) = serde_json::to_value(state) {
        meta[WORKFLOW_STATE_KEY] = state_value;
    }

    meta
}

/// Assign a workflow to a ticket. Returns the initial workflow state.
pub fn assign_workflow(
    project_dir: &str,
    ticket_id: &str,
    workflow_id: &str,
) -> Result<WorkflowState, String> {
    let wf = get_workflow(project_dir, workflow_id)
        .ok_or_else(|| format!("Workflow '{}' not found", workflow_id))?;

    let first_step_id = wf
        .steps
        .first()
        .map(|s| s.id.clone())
        .ok_or_else(|| "Workflow has no steps".to_string())?;

    let state = WorkflowState {
        workflow_id: workflow_id.to_string(),
        current_step_id: Some(first_step_id),
        step_status: StepStatus::Pending,
        step_history: Vec::new(),
    };

    // Read current ticket metadata
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;

    let merged = merge_workflow_state(&ticket.metadata, &state);
    let meta_str = serde_json::to_string(&merged)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

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

    Ok(state)
}

/// Advance to the next step in the workflow
pub fn advance_step(project_dir: &str, ticket_id: &str) -> Result<WorkflowState, String> {
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;

    let mut state =
        read_workflow_state(&ticket.metadata).ok_or("No workflow assigned to this ticket")?;

    let wf = get_workflow(project_dir, &state.workflow_id)
        .ok_or_else(|| format!("Workflow '{}' not found", state.workflow_id))?;

    let current_step_id = state
        .current_step_id
        .as_ref()
        .ok_or("Workflow already completed")?;

    // Find current step index
    let current_idx = wf
        .steps
        .iter()
        .position(|s| &s.id == current_step_id)
        .ok_or_else(|| format!("Step '{}' not found in workflow", current_step_id))?;

    // Record completed step in history
    state.step_history.push(StepRecord {
        step_id: current_step_id.clone(),
        status: StepStatus::Completed,
        started_at: None,
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
        output_summary: None,
    });

    // Advance to next step or mark complete
    if current_idx + 1 < wf.steps.len() {
        state.current_step_id = Some(wf.steps[current_idx + 1].id.clone());
        state.step_status = StepStatus::Pending;
    } else {
        state.current_step_id = None;
        state.step_status = StepStatus::Completed;
    }

    let merged = merge_workflow_state(&ticket.metadata, &state);
    let meta_str = serde_json::to_string(&merged)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

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

    Ok(state)
}

/// Get the current workflow state for a ticket
pub fn get_workflow_state(
    project_dir: &str,
    ticket_id: &str,
) -> Result<Option<WorkflowState>, String> {
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;
    Ok(read_workflow_state(&ticket.metadata))
}

/// Update the step status for the current step
pub fn update_step_status(
    project_dir: &str,
    ticket_id: &str,
    status: StepStatus,
) -> Result<WorkflowState, String> {
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;

    let mut state =
        read_workflow_state(&ticket.metadata).ok_or("No workflow assigned to this ticket")?;

    state.step_status = status;

    let merged = merge_workflow_state(&ticket.metadata, &state);
    let meta_str = serde_json::to_string(&merged)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

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

    Ok(state)
}

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
            .map_err(|e| format!("Failed to read instruction file '{}': {}", file, e))?,
    };

    let mut prompt = instructions;

    // Append ticket context
    prompt.push_str("\n\n## Ticket Context\n\n");
    prompt.push_str(&format!("**ID:** {}\n", ticket.id));
    prompt.push_str(&format!("**Title:** {}\n", ticket.title));
    prompt.push_str(&format!("**Status:** {}\n", ticket.status));

    if let Some(desc) = &ticket.description {
        if !desc.is_empty() {
            prompt.push_str(&format!("\n**Description:**\n{}\n", desc));
        }
    }
    if let Some(notes) = &ticket.notes {
        if !notes.is_empty() {
            prompt.push_str(&format!("\n**Notes:**\n{}\n", notes));
        }
    }
    if let Some(design) = &ticket.design {
        if !design.is_empty() {
            prompt.push_str(&format!("\n**Design:**\n{}\n", design));
        }
    }
    if let Some(acceptance) = &ticket.acceptance_criteria {
        if !acceptance.is_empty() {
            prompt.push_str(&format!("\n**Acceptance Criteria:**\n{}\n", acceptance));
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
    app_handle: tauri::AppHandle,
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
        .ok_or_else(|| format!("Step '{}' not found in workflow", current_step_id))?;

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
                log::error!("worktree: failed to create for ticket {}: {}", ticket_id, e);
                let _ = update_step_status(project_dir, ticket_id, StepStatus::Failed(e.clone()));
                return Err(format!("Failed to create worktree: {}", e));
            }
        }
    }

    // Resolve the effective project dir (worktree path if available)
    let agent_project_dir = effective_project_dir(project_dir, ticket_id);

    // 4. Set status to InProgress
    update_step_status(project_dir, ticket_id, StepStatus::InProgress)?;

    // 5. Build prompt
    let prompt = build_step_prompt(step, &ticket, &state)?;

    // 6. Determine allowed tools based on step view type
    let view_str = match &step.view {
        StepViewType::Progress => "progress",
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

    // 8. Call agent sidecar with the worktree path as project_dir
    //    but keep original project_dir for tickets_dir so ticket reads/writes work
    let tickets_dir = format!("{}/.meldui/tickets", project_dir);
    let (response_text, new_session_id) = match crate::agent::execute_step(
        &agent_project_dir,
        ticket_id,
        &prompt,
        session_id.as_deref(),
        Some(allowed_tools),
        &app_handle,
        Some(&tickets_dir),
        Some(project_dir),
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            // Mark step as failed so it's not stuck in in_progress.
            // The session_id is already stored in metadata, so the step
            // can be resumed by re-executing it.
            let _ = update_step_status(project_dir, ticket_id, StepStatus::Failed(e.clone()));
            return Err(e);
        }
    };

    // 8. Store session_id back into metadata for next step
    if !new_session_id.is_empty() {
        let fresh_ticket = crate::tickets::show_ticket(project_dir, ticket_id)?;
        let mut meta = fresh_ticket.metadata.clone();
        meta["agent_session_id"] = serde_json::Value::String(new_session_id);
        let meta_str = serde_json::to_string(&meta)
            .map_err(|e| format!("Failed to serialize session metadata: {}", e))?;
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepExecutionResult {
    pub step_id: String,
    pub response: String,
    pub workflow_completed: bool,
}

// ── Workflow Suggestion ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowSuggestion {
    pub workflow_id: String,
    pub reasoning: String,
}

/// Suggest a workflow for a ticket based on complexity analysis
pub async fn suggest_workflow(
    project_dir: &str,
    ticket_id: &str,
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
        &app_handle,
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

    serde_json::from_str::<WorkflowSuggestion>(json_str).map_err(|e| {
        format!(
            "Failed to parse workflow suggestion: {} — raw: {}",
            e, response
        )
    })
}

// ── Diff for Review ──

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineType {
    Added,
    Removed,
    Context,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiffLine {
    pub line_type: DiffLineType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line_no: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line_no: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiffFile {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub hunks: Vec<DiffHunk>,
}

/// Branch information for the commit view.
#[derive(Debug, Serialize, Clone)]
pub struct BranchInfo {
    pub branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_tracking: Option<String>,
}

/// Get the current git branch and its remote tracking branch.
pub async fn get_branch_info(project_dir: &str) -> Result<BranchInfo, String> {
    use std::process::Stdio;
    use tokio::process::Command;

    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to get branch: {}", e))?;

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    if branch.is_empty() {
        return Err("Not in a git repository or no commits yet".to_string());
    }

    // Try to get the remote tracking branch (may not exist)
    let upstream_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "@{upstream}"])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to check upstream: {}", e))?;

    let remote_tracking = if upstream_output.status.success() {
        let upstream = String::from_utf8_lossy(&upstream_output.stdout)
            .trim()
            .to_string();
        if upstream.is_empty() {
            None
        } else {
            Some(upstream)
        }
    } else {
        None
    };

    Ok(BranchInfo {
        branch,
        remote_tracking,
    })
}

/// Result of a commit action executed via the agent sidecar.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommitActionResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,
}

/// Execute a commit action (commit or commit+PR) via the agent sidecar.
pub async fn execute_commit_action(
    project_dir: &str,
    issue_id: &str,
    action: &str,
    commit_message: &str,
    app_handle: tauri::AppHandle,
) -> Result<CommitActionResult, String> {
    let prompt = if action == "commit_and_pr" {
        format!(
            "You must commit the current changes and create a pull request. Follow these exact steps:\n\
            1. Run `git add -A` to stage all changes\n\
            2. Run `git commit` with the EXACT commit message below — do NOT modify it, do NOT add co-author lines or any other text:\n\
            ```\n{}\n```\n\
            3. Push the current branch to origin\n\
            4. Create a pull request using `gh pr create` with an appropriate title and body based on the commit message\n\n\
            After completing, report the commit hash and PR URL.",
            commit_message
        )
    } else {
        format!(
            "You must commit the current changes. Follow these exact steps:\n\
            1. Run `git add -A` to stage all changes\n\
            2. Run `git commit` with the EXACT commit message below — do NOT modify it, do NOT add co-author lines or any other text:\n\
            ```\n{}\n```\n\n\
            After completing, report the commit hash.",
            commit_message
        )
    };

    let allowed_tools = vec!["Bash".into(), "Read".into(), "Glob".into()];

    // Use the worktree path if available — that's where the changes live
    let agent_project_dir = effective_project_dir(project_dir, issue_id);

    let tickets_dir = format!("{}/.meldui/tickets", project_dir);
    let (response_text, _session_id) = crate::agent::execute_step(
        &agent_project_dir,
        issue_id,
        &prompt,
        None,
        Some(allowed_tools),
        &app_handle,
        Some(&tickets_dir),
        Some(project_dir),
    )
    .await?;

    // Parse the response to extract commit hash and PR URL
    let commit_hash = extract_commit_hash(&response_text);
    let pr_url = if action == "commit_and_pr" {
        extract_pr_url(&response_text)
    } else {
        None
    };

    Ok(CommitActionResult {
        success: true,
        message: response_text,
        commit_hash,
        pr_url,
    })
}

fn extract_commit_hash(text: &str) -> Option<String> {
    // Look for a 7-40 char hex string that looks like a commit hash
    for word in text.split_whitespace() {
        let clean = word.trim_matches(|c: char| !c.is_ascii_hexdigit());
        if clean.len() >= 7 && clean.len() <= 40 && clean.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(clean.to_string());
        }
    }
    None
}

fn extract_pr_url(text: &str) -> Option<String> {
    for word in text.split_whitespace() {
        if word.contains("github.com") && word.contains("/pull/") {
            return Some(
                word.trim_matches(|c: char| c == '(' || c == ')' || c == '[' || c == ']')
                    .to_string(),
            );
        }
    }
    None
}

/// Get the git diff for the current project (for diff-review view)
pub async fn get_diff(project_dir: &str, base_commit: Option<&str>) -> Result<Vec<DiffFile>, String> {
    use std::process::Stdio;
    use tokio::process::Command;

    // When a base_commit is provided, diff from that commit to capture all branch changes
    // (committed + uncommitted). Otherwise fall back to git diff HEAD.
    let diff_arg = base_commit.unwrap_or("HEAD");
    let output = Command::new("git")
        .args(["diff", diff_arg])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    let diff_text = if !output.status.success() {
        // Might be a fresh repo with no commits — try just `git diff`
        let output2 = Command::new("git")
            .arg("diff")
            .current_dir(project_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run git diff: {}", e))?;
        String::from_utf8_lossy(&output2.stdout).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    Ok(parse_diff(&diff_text))
}

fn parse_diff(diff_text: &str) -> Vec<DiffFile> {
    use unidiff::PatchSet;

    if diff_text.trim().is_empty() {
        return Vec::new();
    }

    let mut patch = PatchSet::new();
    if patch.parse(diff_text).is_err() {
        return Vec::new();
    }

    patch
        .files()
        .iter()
        .map(|file| {
            let status = if file.is_added_file() {
                "added"
            } else if file.is_removed_file() {
                "removed"
            } else {
                "modified"
            };

            let hunks: Vec<DiffHunk> = file
                .hunks()
                .iter()
                .map(|hunk| {
                    let lines: Vec<DiffLine> = hunk
                        .lines()
                        .iter()
                        .map(|line| {
                            let line_type = if line.is_added() {
                                DiffLineType::Added
                            } else if line.is_removed() {
                                DiffLineType::Removed
                            } else {
                                DiffLineType::Context
                            };
                            DiffLine {
                                line_type,
                                content: line.value.clone(),
                                old_line_no: line.source_line_no,
                                new_line_no: line.target_line_no,
                            }
                        })
                        .collect();

                    DiffHunk {
                        header: hunk.section_header.clone(),
                        old_start: hunk.source_start,
                        old_count: hunk.source_length,
                        new_start: hunk.target_start,
                        new_count: hunk.target_length,
                        lines,
                    }
                })
                .collect();

            DiffFile {
                path: file.path(),
                status: status.to_string(),
                additions: file.added(),
                deletions: file.removed(),
                hunks,
            }
        })
        .collect()
}

// ── Review Types ──
// These structs mirror the TypeScript ReviewFinding/ReviewComment/ReviewSubmission types.
// The Rust side currently passes review data as serde_json::Value, but these are kept
// for future use when the review flow needs Rust-side validation or persistence.

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct ReviewFinding {
    pub id: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_number: Option<usize>,
    pub severity: String,
    pub validity: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct ReviewComment {
    pub id: String,
    pub file_path: String,
    pub line_number: usize,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    #[serde(default)]
    pub resolved: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct ReviewSubmission {
    pub action: String,
    pub summary: String,
    pub comments: Vec<ReviewComment>,
    pub finding_actions: Vec<FindingAction>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct FindingAction {
    pub finding_id: String,
    pub action: String,
}
