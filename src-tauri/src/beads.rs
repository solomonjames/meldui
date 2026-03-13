use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BeadsComment {
    #[serde(default)]
    pub id: i32,
    #[serde(default)]
    pub issue_id: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BeadsDependency {
    #[serde(default)]
    pub depends_on_id: Option<String>,
    #[serde(default, rename = "type")]
    pub dep_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BeadsIssue {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: i32,
    pub issue_type: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub design: Option<String>,
    #[serde(default)]
    pub acceptance: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub closed_at: Option<String>,
    #[serde(default)]
    pub close_reason: Option<String>,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub dependency_count: Option<i32>,
    #[serde(default)]
    pub dependent_count: Option<i32>,
    #[serde(default)]
    pub comment_count: Option<i32>,
    #[serde(default)]
    pub labels: Option<Vec<String>>,
    #[serde(default)]
    pub dependencies: Option<Vec<BeadsDependency>>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub comments: Option<Vec<BeadsComment>>,
}

/// Find the bd CLI binary — checks bundled sidecar first, then system locations
fn find_bd_binary() -> Option<PathBuf> {
    // 1. Check for bundled sidecar next to the app executable
    //    Tauri places externalBin binaries in the same directory as the main binary
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let sidecar = exe_dir.join("bd");
            if sidecar.exists() {
                return Some(sidecar);
            }
            // On macOS, also check inside the .app bundle's MacOS directory
            // (current_exe already points there, but check just in case)
        }
    }

    // 2. Fall back to system-installed locations
    let home = env::var("HOME").unwrap_or_default();

    let candidates = [
        "/opt/homebrew/bin/bd".to_string(),
        "/usr/local/bin/bd".to_string(),
        format!("{}/.local/bin/bd", home),
        format!("{}/go/bin/bd", home),
    ];

    for path in &candidates {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }

    // 3. Last resort: `which bd`
    if let Ok(output) = std::process::Command::new("which").arg("bd").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    None
}

/// Create a Command for bd with the project directory set
fn bd_command(project_dir: &str) -> Result<Command, String> {
    let bin = find_bd_binary()
        .ok_or_else(|| "Beads CLI (bd) not found. Install from https://github.com/steveyegge/beads".to_string())?;
    let mut cmd = Command::new(bin);
    cmd.current_dir(project_dir);
    Ok(cmd)
}

/// Run a bd command and return parsed JSON
async fn run_bd_json<T: for<'de> Deserialize<'de>>(
    project_dir: &str,
    args: &[&str],
) -> Result<T, String> {
    let mut cmd = bd_command(project_dir)?;
    let output = cmd
        .args(args)
        .arg("--json")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run bd: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("bd command failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse bd output: {} — raw: {}", e, stdout))
}

/// Check if beads is available and initialized in a directory
pub async fn get_status(project_dir: &str) -> Result<String, String> {
    let bin = find_bd_binary();

    if bin.is_none() {
        return Ok(serde_json::json!({
            "installed": false,
            "initialized": false,
            "message": "Beads CLI (bd) not found"
        })
        .to_string());
    }

    // Check if .beads directory exists in project
    let beads_dir = PathBuf::from(project_dir).join(".beads");
    let initialized = beads_dir.exists();

    Ok(serde_json::json!({
        "installed": true,
        "initialized": initialized,
        "path": bin.unwrap().to_string_lossy(),
        "message": if initialized {
            "Beads is installed and initialized"
        } else {
            "Beads is installed but not initialized in this project"
        }
    })
    .to_string())
}

/// List issues from beads
pub async fn list_issues(
    project_dir: &str,
    status: Option<&str>,
    issue_type: Option<&str>,
    show_all: bool,
) -> Result<Vec<BeadsIssue>, String> {
    let mut args: Vec<&str> = vec!["list"];

    if show_all {
        args.push("--all");
    }

    // We need to own the strings for status and type
    let status_flag;
    if let Some(s) = status {
        status_flag = format!("{}", s);
        args.push("-s");
        args.push(&status_flag);
    }

    let type_flag;
    if let Some(t) = issue_type {
        type_flag = format!("{}", t);
        args.push("-t");
        args.push(&type_flag);
    }

    args.push("-n");
    args.push("0"); // unlimited

    let mut issues: Vec<BeadsIssue> = run_bd_json(project_dir, &args).await?;

    // Derive parent_id from dependencies with type "parent-child"
    for issue in &mut issues {
        if issue.parent_id.is_some() {
            continue;
        }
        issue.parent_id = issue
            .dependencies
            .as_ref()
            .and_then(|deps| {
                deps.iter()
                    .find(|d| d.dep_type.as_deref() == Some("parent-child"))
                    .and_then(|d| d.depends_on_id.clone())
            });
    }

    Ok(issues)
}

/// Create a new issue
pub async fn create_issue(
    project_dir: &str,
    title: &str,
    description: Option<&str>,
    issue_type: &str,
    priority: &str,
) -> Result<BeadsIssue, String> {
    let mut args: Vec<&str> = vec!["create", title, "-t", issue_type, "-p", priority];

    let desc;
    if let Some(d) = description {
        desc = d.to_string();
        args.push("-d");
        args.push(&desc);
    }

    run_bd_json(project_dir, &args).await
}

/// Update an issue
pub async fn update_issue(
    project_dir: &str,
    id: &str,
    title: Option<&str>,
    status: Option<&str>,
    priority: Option<&str>,
    description: Option<&str>,
    notes: Option<&str>,
    design: Option<&str>,
    acceptance: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["update", id];

    if let Some(t) = title {
        args.push("--title");
        args.push(t);
    }
    if let Some(s) = status {
        args.push("-s");
        args.push(s);
    }
    if let Some(p) = priority {
        args.push("-p");
        args.push(p);
    }
    if let Some(d) = description {
        args.push("-d");
        args.push(d);
    }
    if let Some(n) = notes {
        args.push("--notes");
        args.push(n);
    }
    if let Some(ds) = design {
        args.push("--design");
        args.push(ds);
    }
    if let Some(a) = acceptance {
        args.push("--acceptance");
        args.push(a);
    }

    run_bd_json(project_dir, &args).await
}

/// Close an issue
pub async fn close_issue(
    project_dir: &str,
    id: &str,
    reason: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["close", id];

    if let Some(r) = reason {
        args.push("-r");
        args.push(r);
    }

    run_bd_json(project_dir, &args).await
}

/// Show issue details
pub async fn show_issue(project_dir: &str, id: &str) -> Result<Vec<BeadsIssue>, String> {
    run_bd_json(project_dir, &["show", id]).await
}

/// Delete an issue
pub async fn delete_issue(project_dir: &str, id: &str) -> Result<serde_json::Value, String> {
    run_bd_json(project_dir, &["delete", id, "--force"]).await
}

/// Add a comment to an issue
pub async fn add_comment(project_dir: &str, id: &str, text: &str) -> Result<serde_json::Value, String> {
    run_bd_json(project_dir, &["comments", "add", id, text]).await
}

/// Initialize beads in a project directory
pub async fn init(project_dir: &str) -> Result<String, String> {
    let mut cmd = bd_command(project_dir)?;
    let output = cmd
        .arg("init")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to init beads: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(format!("Failed to init beads: {}{}", stdout, stderr))
    }
}
