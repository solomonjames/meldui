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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowStep {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: StepInstructions,
    #[serde(default)]
    pub human_gate: bool,
    #[serde(default)]
    pub view: Option<String>,
    #[serde(default)]
    pub writes_to: Option<Vec<String>>,
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
    AwaitingGate,
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
fn read_workflow_state(metadata: &Option<serde_json::Value>) -> Option<WorkflowState> {
    metadata
        .as_ref()
        .and_then(|m| m.get(WORKFLOW_STATE_KEY))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}

/// Merge workflow state into existing metadata (read-merge-write)
fn merge_workflow_state(
    metadata: &Option<serde_json::Value>,
    state: &WorkflowState,
) -> serde_json::Value {
    let mut meta = metadata.clone().unwrap_or_else(|| serde_json::json!({}));

    if let Ok(state_value) = serde_json::to_value(state) {
        meta[WORKFLOW_STATE_KEY] = state_value;
    }

    meta
}

/// Assign a workflow to a ticket. Returns the initial workflow state.
pub async fn assign_workflow(
    project_dir: &str,
    issue_id: &str,
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
    let issues: Vec<crate::beads::BeadsIssue> =
        crate::beads::show_issue(project_dir, issue_id).await?;
    let issue = issues.first().ok_or("Issue not found")?;

    let merged = merge_workflow_state(&issue.metadata, &state);
    let meta_str = serde_json::to_string(&merged)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

    crate::beads::update_issue(
        project_dir,
        issue_id,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(&meta_str),
    )
    .await?;

    Ok(state)
}

/// Advance to the next step in the workflow
pub async fn advance_step(project_dir: &str, issue_id: &str) -> Result<WorkflowState, String> {
    let issues: Vec<crate::beads::BeadsIssue> =
        crate::beads::show_issue(project_dir, issue_id).await?;
    let issue = issues.first().ok_or("Issue not found")?;

    let mut state =
        read_workflow_state(&issue.metadata).ok_or("No workflow assigned to this issue")?;

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

    let merged = merge_workflow_state(&issue.metadata, &state);
    let meta_str = serde_json::to_string(&merged)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

    crate::beads::update_issue(
        project_dir,
        issue_id,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(&meta_str),
    )
    .await?;

    Ok(state)
}

/// Get the current workflow state for a ticket
pub async fn get_workflow_state(
    project_dir: &str,
    issue_id: &str,
) -> Result<Option<WorkflowState>, String> {
    let issues: Vec<crate::beads::BeadsIssue> =
        crate::beads::show_issue(project_dir, issue_id).await?;
    let issue = issues.first().ok_or("Issue not found")?;
    Ok(read_workflow_state(&issue.metadata))
}

/// Update the step status for the current step
pub async fn update_step_status(
    project_dir: &str,
    issue_id: &str,
    status: StepStatus,
) -> Result<WorkflowState, String> {
    let issues: Vec<crate::beads::BeadsIssue> =
        crate::beads::show_issue(project_dir, issue_id).await?;
    let issue = issues.first().ok_or("Issue not found")?;

    let mut state =
        read_workflow_state(&issue.metadata).ok_or("No workflow assigned to this issue")?;

    state.step_status = status;

    let merged = merge_workflow_state(&issue.metadata, &state);
    let meta_str = serde_json::to_string(&merged)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

    crate::beads::update_issue(
        project_dir,
        issue_id,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(&meta_str),
    )
    .await?;

    Ok(state)
}

// ── Step Execution ──

/// Build the full prompt for a step by combining instructions with ticket context
fn build_step_prompt(
    step: &WorkflowStep,
    issue: &crate::beads::BeadsIssue,
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
    prompt.push_str(&format!("**ID:** {}\n", issue.id));
    prompt.push_str(&format!("**Title:** {}\n", issue.title));
    prompt.push_str(&format!("**Status:** {}\n", issue.status));

    if let Some(desc) = &issue.description {
        if !desc.is_empty() {
            prompt.push_str(&format!("\n**Description:**\n{}\n", desc));
        }
    }
    if let Some(notes) = &issue.notes {
        if !notes.is_empty() {
            prompt.push_str(&format!("\n**Notes:**\n{}\n", notes));
        }
    }
    if let Some(design) = &issue.design {
        if !design.is_empty() {
            prompt.push_str(&format!("\n**Design:**\n{}\n", design));
        }
    }
    if let Some(acceptance) = &issue.acceptance {
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
    issue_id: &str,
    app_handle: tauri::AppHandle,
) -> Result<StepExecutionResult, String> {
    // 1. Load workflow state
    let issues: Vec<crate::beads::BeadsIssue> =
        crate::beads::show_issue(project_dir, issue_id).await?;
    let issue = issues.first().ok_or("Issue not found")?;

    let state = read_workflow_state(&issue.metadata).ok_or("No workflow assigned to this issue")?;

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
    update_step_status(project_dir, issue_id, StepStatus::InProgress).await?;

    // 4. Build prompt
    let prompt = build_step_prompt(step, issue, &state)?;

    // 5. Call Claude
    let messages = crate::claude::send_message(&prompt, app_handle).await?;
    let response_text = messages
        .iter()
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n");

    // 6. Write response to ticket fields specified by writes_to
    if let Some(writes_to) = &step.writes_to {
        for field in writes_to {
            match field.as_str() {
                "notes" => {
                    crate::beads::update_issue(
                        project_dir,
                        issue_id,
                        None,
                        None,
                        None,
                        None,
                        Some(&response_text),
                        None,
                        None,
                        None,
                    )
                    .await?;
                }
                "design" => {
                    crate::beads::update_issue(
                        project_dir,
                        issue_id,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some(&response_text),
                        None,
                        None,
                    )
                    .await?;
                }
                "acceptance" => {
                    crate::beads::update_issue(
                        project_dir,
                        issue_id,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some(&response_text),
                        None,
                    )
                    .await?;
                }
                _ => {
                    eprintln!("Unknown writes_to field: {}", field);
                }
            }
        }
    }

    // 7. Handle gate or auto-advance
    if step.human_gate {
        update_step_status(project_dir, issue_id, StepStatus::AwaitingGate).await?;
        Ok(StepExecutionResult {
            step_id: current_step_id.clone(),
            response: response_text,
            awaiting_gate: true,
            workflow_completed: false,
        })
    } else {
        let new_state = advance_step(project_dir, issue_id).await?;
        Ok(StepExecutionResult {
            step_id: current_step_id.clone(),
            response: response_text,
            awaiting_gate: false,
            workflow_completed: new_state.current_step_id.is_none(),
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepExecutionResult {
    pub step_id: String,
    pub response: String,
    pub awaiting_gate: bool,
    pub workflow_completed: bool,
}
