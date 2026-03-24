//! Git worktree management for ticket-based development.

use std::path::PathBuf;

use serde::Serialize;

/// Information about a created git worktree.
#[derive(Debug, Serialize, Clone, specta::Type)]
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

    let branch_name = format!("meld/{ticket_id}");
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
                .map_err(|e| format!("Failed to create worktrees directory: {e}"))?;
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
        .map_err(|e| format!("Failed to get base commit: {e}"))?;
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
        .map_err(|e| format!("Failed to create worktree: {e}"))?;

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
                .map_err(|e| format!("Failed to create worktree: {e}"))?;

            if !output2.status.success() {
                let stderr2 = String::from_utf8_lossy(&output2.stderr);
                return Err(format!("Failed to create worktree: {stderr2}"));
            }
        } else {
            return Err(format!("Failed to create worktree: {stderr}"));
        }
    }

    log::info!("worktree: created at {worktree_str} on branch {branch_name}");

    // Run setup command if configured
    let settings = crate::settings::get_settings(project_dir).unwrap_or_default();
    if let Some(ref wt_settings) = settings.worktree {
        if let Some(ref setup_cmd) = wt_settings.setup_command {
            if !setup_cmd.trim().is_empty() {
                log::info!("worktree: running setup command: {setup_cmd}");
                let setup_output = Command::new("sh")
                    .args(["-c", setup_cmd])
                    .current_dir(&worktree_str)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .await
                    .map_err(|e| format!("Failed to run worktree setup command: {e}"))?;

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
    let mut meta = ticket.metadata;
    meta["worktree_path"] = serde_json::Value::String(worktree_str.clone());
    meta["worktree_branch"] = serde_json::Value::String(branch_name.clone());
    if !base_commit.is_empty() {
        meta["worktree_base_commit"] = serde_json::Value::String(base_commit.clone());
    }
    let meta_str = serde_json::to_string(&meta)
        .map_err(|e| format!("Failed to serialize worktree metadata: {e}"))?;
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
        .map_err(|e| format!("Failed to remove worktree: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("worktree: git worktree remove failed: {stderr}");
        // Fall back to manual removal
        if worktree_path.exists() {
            std::fs::remove_dir_all(&worktree_path)
                .map_err(|e| format!("Failed to remove worktree directory: {e}"))?;
        }
        // Prune stale worktree references
        let _ = Command::new("git")
            .args(["worktree", "prune"])
            .current_dir(project_dir)
            .output()
            .await;
    }

    log::info!("worktree: removed {worktree_str}");

    // Delete the branch
    let branch_name = format!("meld/{ticket_id}");
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
    let mut meta = ticket.metadata;
    if let Some(obj) = meta.as_object_mut() {
        obj.remove("worktree_path");
        obj.remove("worktree_branch");
    }
    let meta_str =
        serde_json::to_string(&meta).map_err(|e| format!("Failed to serialize metadata: {e}"))?;
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
pub fn effective_project_dir(project_dir: &str, ticket_id: &str) -> String {
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
