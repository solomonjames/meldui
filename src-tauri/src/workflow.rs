use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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

    // 3. Set status to InProgress
    update_step_status(project_dir, ticket_id, StepStatus::InProgress)?;

    // 4. Build prompt
    let prompt = build_step_prompt(step, &ticket, &state)?;

    // 5. Determine allowed tools based on step view type
    let view_str = match &step.view {
        StepViewType::Progress => "progress",
        StepViewType::Chat => "chat",
        StepViewType::Review => "review",
        _ => "progress",
    };
    let allowed_tools = crate::agent::tools_for_view(view_str);

    // 6. Get session_id from workflow state metadata for continuity
    let session_id = ticket
        .metadata
        .get("agent_session_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 7. Call agent sidecar with streaming events
    let (response_text, new_session_id) = crate::agent::execute_step(
        project_dir,
        ticket_id,
        &prompt,
        session_id.as_deref(),
        Some(allowed_tools),
        &app_handle,
    )
    .await?;

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

    // 9. Mark step completed — workflow advancement is controlled by the agent
    // via meldui_step_complete, not by a human_gate flag
    update_step_status(project_dir, ticket_id, StepStatus::Completed)?;
    Ok(StepExecutionResult {
        step_id: current_step_id.clone(),
        response: response_text,
        workflow_completed: false,
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
pub struct DiffFile {
    pub path: String,
    pub status: String,
    pub content: String,
}

/// Get the git diff for the current project (for diff-review view)
pub async fn get_diff(project_dir: &str) -> Result<Vec<DiffFile>, String> {
    use std::process::Stdio;
    use tokio::process::Command;

    // Get both staged and unstaged changes
    let output = Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        // Might be a fresh repo with no commits — try just `git diff`
        let output2 = Command::new("git")
            .arg("diff")
            .current_dir(project_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run git diff: {}", e))?;

        let diff_text = String::from_utf8_lossy(&output2.stdout).to_string();
        return Ok(parse_diff(&diff_text));
    }

    let diff_text = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(parse_diff(&diff_text))
}

fn parse_diff(diff_text: &str) -> Vec<DiffFile> {
    let mut files: Vec<DiffFile> = Vec::new();
    let mut current_path = String::new();
    let mut current_content = String::new();

    for line in diff_text.lines() {
        if line.starts_with("diff --git") {
            // Save previous file if any
            if !current_path.is_empty() {
                files.push(DiffFile {
                    path: current_path.clone(),
                    status: "modified".to_string(),
                    content: current_content.clone(),
                });
            }
            // Extract file path from "diff --git a/path b/path"
            current_path = line.split(" b/").last().unwrap_or("").to_string();
            current_content = String::new();
        }
        current_content.push_str(line);
        current_content.push('\n');
    }

    // Save last file
    if !current_path.is_empty() {
        files.push(DiffFile {
            path: current_path,
            status: "modified".to_string(),
            content: current_content,
        });
    }

    files
}
