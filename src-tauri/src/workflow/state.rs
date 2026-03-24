//! Workflow state machine — status tracking, step history, and metadata persistence.

use serde::{Deserialize, Serialize};

use super::get_workflow;

// ── Types ──

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Failed(String),
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct WorkflowState {
    pub workflow_id: String,
    pub current_step_id: Option<String>,
    pub step_status: StepStatus,
    pub step_history: Vec<StepRecord>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct StepRecord {
    pub step_id: String,
    pub status: StepStatus,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub output_summary: Option<String>,
}

// ── State Machine ──

const WORKFLOW_STATE_KEY: &str = "workflow";

/// Read workflow state from ticket metadata
pub fn read_workflow_state(metadata: &serde_json::Value) -> Option<WorkflowState> {
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
        .ok_or_else(|| format!("Workflow '{workflow_id}' not found"))?;

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
    let meta_str =
        serde_json::to_string(&merged).map_err(|e| format!("Failed to serialize metadata: {e}"))?;

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
        .ok_or_else(|| format!("Step '{current_step_id}' not found in workflow"))?;

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
    let meta_str =
        serde_json::to_string(&merged).map_err(|e| format!("Failed to serialize metadata: {e}"))?;

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
    let meta_str =
        serde_json::to_string(&merged).map_err(|e| format!("Failed to serialize metadata: {e}"))?;

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
