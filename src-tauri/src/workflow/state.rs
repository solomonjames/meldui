//! Workflow state machine — persisted in ticket metadata.
//!
//! Tracks which step a ticket is on, step statuses, and state transitions
//! (assign, advance, update, read).

use thiserror::Error;

use serde::{Deserialize, Serialize};

use super::get_workflow;

/// Structured error type for workflow state operations.
#[derive(Debug, Error)]
pub(crate) enum StateError {
    #[error("workflow '{0}' not found")]
    WorkflowNotFound(String),

    #[error("workflow has no steps")]
    NoSteps,

    #[error("no workflow assigned to this ticket")]
    NotAssigned,

    #[error("workflow already completed")]
    AlreadyCompleted,

    #[error("step '{0}' not found in workflow")]
    StepNotFound(String),

    #[error("failed to serialize workflow metadata")]
    SerializeFailed(#[source] serde_json::Error),

    #[error("{0}")]
    Ticket(String),
}

// ── Types ──

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Failed(String),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct WorkflowState {
    pub workflow_id: String,
    pub current_step_id: Option<String>,
    pub step_status: StepStatus,
    pub step_history: Vec<StepRecord>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
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

/// Persist workflow state into ticket metadata via tickets module.
fn persist_state(
    project_dir: &str,
    ticket_id: &str,
    metadata: &serde_json::Value,
    state: &WorkflowState,
) -> Result<(), StateError> {
    let merged = merge_workflow_state(metadata, state);
    let meta_str = serde_json::to_string(&merged).map_err(StateError::SerializeFailed)?;
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
    )
    .map_err(StateError::Ticket)?;
    Ok(())
}

/// Assign a workflow to a ticket. Returns the initial workflow state.
pub fn assign_workflow(
    project_dir: &str,
    ticket_id: &str,
    workflow_id: &str,
) -> Result<WorkflowState, String> {
    assign_workflow_inner(project_dir, ticket_id, workflow_id).map_err(|e| e.to_string())
}

fn assign_workflow_inner(
    project_dir: &str,
    ticket_id: &str,
    workflow_id: &str,
) -> Result<WorkflowState, StateError> {
    let wf = get_workflow(project_dir, workflow_id)
        .ok_or_else(|| StateError::WorkflowNotFound(workflow_id.to_string()))?;

    let first_step_id = wf
        .steps
        .first()
        .map(|s| s.id.clone())
        .ok_or(StateError::NoSteps)?;

    let state = WorkflowState {
        workflow_id: workflow_id.to_string(),
        current_step_id: Some(first_step_id),
        step_status: StepStatus::Pending,
        step_history: Vec::new(),
    };

    let ticket = crate::tickets::show_ticket(project_dir, ticket_id).map_err(StateError::Ticket)?;
    persist_state(project_dir, ticket_id, &ticket.metadata, &state)?;

    Ok(state)
}

/// Advance to the next step in the workflow
pub fn advance_step(project_dir: &str, ticket_id: &str) -> Result<WorkflowState, String> {
    advance_step_inner(project_dir, ticket_id).map_err(|e| e.to_string())
}

fn advance_step_inner(project_dir: &str, ticket_id: &str) -> Result<WorkflowState, StateError> {
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id).map_err(StateError::Ticket)?;

    let mut state = read_workflow_state(&ticket.metadata).ok_or(StateError::NotAssigned)?;

    let wf = get_workflow(project_dir, &state.workflow_id)
        .ok_or_else(|| StateError::WorkflowNotFound(state.workflow_id.clone()))?;

    let current_step_id = state
        .current_step_id
        .as_ref()
        .ok_or(StateError::AlreadyCompleted)?;

    // Find current step index
    let current_idx = wf
        .steps
        .iter()
        .position(|s| &s.id == current_step_id)
        .ok_or_else(|| StateError::StepNotFound(current_step_id.clone()))?;

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

    persist_state(project_dir, ticket_id, &ticket.metadata, &state)?;

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
    update_step_status_inner(project_dir, ticket_id, status).map_err(|e| e.to_string())
}

fn update_step_status_inner(
    project_dir: &str,
    ticket_id: &str,
    status: StepStatus,
) -> Result<WorkflowState, StateError> {
    let ticket = crate::tickets::show_ticket(project_dir, ticket_id).map_err(StateError::Ticket)?;

    let mut state = read_workflow_state(&ticket.metadata).ok_or(StateError::NotAssigned)?;

    state.step_status = status;

    persist_state(project_dir, ticket_id, &ticket.metadata, &state)?;

    Ok(state)
}
