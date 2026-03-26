//! Diff parsing, branch operations, commit actions, and review types.

use std::path::PathBuf;

use thiserror::Error;

use serde::{Deserialize, Serialize};

use super::effective_project_dir;
use crate::constants::{MELDUI_DIR, TICKETS_DIR};

/// Structured error type for diff/branch operations.
#[derive(Debug, Error)]
pub(crate) enum DiffError {
    #[error("git command failed to execute")]
    GitSpawnFailed(#[source] std::io::Error),

    #[error("not in a git repository or no commits yet")]
    NotARepo,
}

// ── Diff Types ──

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineType {
    Added,
    Removed,
    Context,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct DiffLine {
    pub line_type: DiffLineType,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line_no: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line_no: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct DiffFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
}

// ── Branch Info ──

/// Branch information for the commit view.
#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
pub struct BranchInfo {
    pub branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_tracking: Option<String>,
}

/// Get the current git branch and its remote tracking branch.
pub async fn get_branch_info(project_dir: &str) -> Result<BranchInfo, String> {
    get_branch_info_inner(project_dir)
        .await
        .map_err(|e| e.to_string())
}

async fn get_branch_info_inner(project_dir: &str) -> Result<BranchInfo, DiffError> {
    use std::process::Stdio;
    use tokio::process::Command;

    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(DiffError::GitSpawnFailed)?;

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    if branch.is_empty() {
        return Err(DiffError::NotARepo);
    }

    // Try to get the remote tracking branch (may not exist)
    let upstream_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "@{upstream}"])
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(DiffError::GitSpawnFailed)?;

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

// ── Commit Action ──

/// Result of a commit action executed via the agent sidecar.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
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
    on_chunk: tauri::ipc::Channel<crate::claude::StreamChunk>,
    app_handle: tauri::AppHandle,
) -> Result<CommitActionResult, String> {
    let prompt = if action == "commit_and_pr" {
        format!(
            "You must commit the current changes and create a pull request. Follow these exact steps:\n\
            1. Run `git add -A` to stage all changes\n\
            2. Run `git commit` with the EXACT commit message below — do NOT modify it, do NOT add co-author lines or any other text:\n\
            ```\n{commit_message}\n```\n\
            3. Push the current branch to origin\n\
            4. Create a pull request using `gh pr create` with an appropriate title and body based on the commit message\n\
            5. After the PR is created, call `meldui_report_pr_url` with the ticket ID and the PR URL so the app can display it\n\n\
            After completing, report the commit hash and PR URL."
        )
    } else {
        format!(
            "You must commit the current changes. Follow these exact steps:\n\
            1. Run `git add -A` to stage all changes\n\
            2. Run `git commit` with the EXACT commit message below — do NOT modify it, do NOT add co-author lines or any other text:\n\
            ```\n{commit_message}\n```\n\n\
            After completing, report the commit hash."
        )
    };

    let allowed_tools = vec!["Bash".into(), "Read".into(), "Glob".into()];

    // Use the worktree path if available — that's where the changes live
    let agent_project_dir = effective_project_dir(project_dir, issue_id);

    let tickets_dir = PathBuf::from(project_dir)
        .join(MELDUI_DIR)
        .join(TICKETS_DIR)
        .to_string_lossy()
        .to_string();
    let (response_text, _session_id) = crate::agent::execute_step(
        &agent_project_dir,
        issue_id,
        &prompt,
        None,
        Some(allowed_tools),
        &on_chunk,
        &app_handle,
        Some(&tickets_dir),
        Some(project_dir),
        None,
        None,
        // No supervisor needed for commit
        String::new(),
        0,
        String::new(),
        String::new(),
    )
    .await?;

    // Parse the response to extract commit hash and PR URL
    let commit_hash = extract_commit_hash(&response_text);
    let pr_url = if action == "commit_and_pr" {
        // Primary: read pr_url from ticket metadata (set by meldui_report_pr_url MCP tool)
        let metadata_url = crate::tickets::show_ticket(project_dir, issue_id)
            .ok()
            .and_then(|t| {
                t.metadata
                    .get("pr_url")
                    .and_then(|v| v.as_str())
                    .map(String::from)
            });
        // Fallback: extract from agent response text
        metadata_url.or_else(|| extract_pr_url(&response_text))
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
pub async fn get_diff(
    project_dir: &str,
    base_commit: Option<&str>,
) -> Result<Vec<DiffFile>, String> {
    get_diff_inner(project_dir, base_commit)
        .await
        .map_err(|e| e.to_string())
}

async fn get_diff_inner(
    project_dir: &str,
    base_commit: Option<&str>,
) -> Result<Vec<DiffFile>, DiffError> {
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
        .map_err(DiffError::GitSpawnFailed)?;

    let diff_text = if !output.status.success() {
        // Might be a fresh repo with no commits — try just `git diff`
        let output2 = Command::new("git")
            .arg("diff")
            .current_dir(project_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(DiffError::GitSpawnFailed)?;
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
                                old_line_no: line.source_line_no.map(|n| n as u32),
                                new_line_no: line.target_line_no.map(|n| n as u32),
                            }
                        })
                        .collect();

                    DiffHunk {
                        header: hunk.section_header.clone(),
                        old_start: hunk.source_start as u32,
                        old_count: hunk.source_length as u32,
                        new_start: hunk.target_start as u32,
                        new_count: hunk.target_length as u32,
                        lines,
                    }
                })
                .collect();

            DiffFile {
                path: file.path(),
                status: status.to_string(),
                additions: file.added() as u32,
                deletions: file.removed() as u32,
                hunks,
            }
        })
        .collect()
}

// ── Review Types ──
// These structs mirror the TypeScript ReviewFinding/ReviewComment/ReviewSubmission types.
// The Rust side currently passes review data as serde_json::Value, but these are kept
// for future use when the review flow needs Rust-side validation or persistence.

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[allow(dead_code)] // Mirrors TypeScript ReviewFinding; reserved for Rust-side review validation
pub struct ReviewFinding {
    pub id: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_number: Option<u32>,
    pub severity: String,
    pub validity: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[allow(dead_code)] // Mirrors TypeScript ReviewComment; reserved for Rust-side review validation
pub struct ReviewComment {
    pub id: String,
    pub file_path: String,
    pub line_number: u32,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    #[serde(default)]
    pub resolved: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[allow(dead_code)] // Mirrors TypeScript ReviewSubmission; reserved for Rust-side review validation
pub struct ReviewSubmission {
    pub action: String,
    pub summary: String,
    pub comments: Vec<ReviewComment>,
    pub finding_actions: Vec<FindingAction>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
#[allow(dead_code)] // Mirrors TypeScript FindingAction; reserved for Rust-side review validation
pub struct FindingAction {
    pub finding_id: String,
    pub action: String,
}
