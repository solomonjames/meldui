//! Workflow YAML definitions and loading from bundled/project sources.
//!
//! Workflows define multi-step agent execution sequences. They are loaded
//! from bundled YAML files and optionally from a project's `.meldui/workflows/` directory.

use std::path::PathBuf;

use crate::constants::{MELDUI_DIR, WORKFLOWS_DIR};

use serde::{Deserialize, Serialize};

// ── Types ──

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct WorkflowSectionDef {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub section_type: String,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub steps: Vec<WorkflowStep>,
    #[serde(default)]
    pub ticket_sections: Vec<WorkflowSectionDef>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowPhase {
    Research,
    Plan,
    Implementation,
    Review,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum StepViewType {
    Chat,
    Review,
    Progress,
    DiffReview,
    Commit,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct WorkflowStep {
    pub id: String,
    pub name: String,
    pub description: String,
    pub instructions: StepInstructions,
    pub view: StepViewType,
    pub phase: Option<WorkflowPhase>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(untagged)]
pub enum StepInstructions {
    Prompt { prompt: String },
    File { file: String },
}

// ── Loading ──

/// Load bundled workflow definitions embedded at compile time
pub fn load_bundled_workflows() -> Vec<WorkflowDefinition> {
    let mut workflows = Vec::new();

    let bundled_yamls: &[&str] = &[
        include_str!("../../workflows/meld-full.yaml"),
        include_str!("../../workflows/meld-quick.yaml"),
    ];

    for yaml_str in bundled_yamls {
        match serde_yaml::from_str::<WorkflowDefinition>(yaml_str) {
            Ok(wf) => workflows.push(wf),
            Err(e) => eprintln!("Failed to parse bundled workflow: {e}"),
        }
    }

    workflows
}

/// Load workflow definitions from a project's .meldui/workflows/ directory
pub fn load_project_workflows(project_dir: &str) -> Vec<WorkflowDefinition> {
    let workflows_dir = PathBuf::from(project_dir)
        .join(MELDUI_DIR)
        .join(WORKFLOWS_DIR);
    let mut workflows = Vec::new();

    if !workflows_dir.exists() {
        return workflows;
    }

    let Ok(entries) = std::fs::read_dir(&workflows_dir) else {
        return workflows;
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
