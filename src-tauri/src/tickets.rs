use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TicketComment {
    pub id: String,
    pub author: String,
    pub text: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ticket {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: i32,
    pub ticket_type: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub design: Option<String>,
    #[serde(default)]
    pub acceptance_criteria: Option<String>,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub closed_at: Option<String>,
    #[serde(default)]
    pub close_reason: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub children_ids: Vec<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(default)]
    pub comments: Vec<TicketComment>,
    #[serde(default)]
    pub external_id: Option<String>,
    #[serde(default)]
    pub external_source: Option<String>,
}

/// Get path to the .meldui/tickets/ directory, creating if needed.
fn tickets_dir(project_dir: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(project_dir).join(".meldui").join("tickets");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create tickets directory: {}", e))?;
    }
    Ok(dir)
}

/// Path to a specific ticket file.
fn ticket_path(project_dir: &str, id: &str) -> Result<PathBuf, String> {
    let dir = tickets_dir(project_dir)?;
    Ok(dir.join(format!("{}.json", id)))
}

/// Read a single ticket from disk.
fn read_ticket(project_dir: &str, id: &str) -> Result<Ticket, String> {
    let path = ticket_path(project_dir, id)?;
    if !path.exists() {
        return Err(format!("Ticket '{}' not found", id));
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read ticket: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse ticket: {}", e))
}

/// Write a ticket to disk (public for sync module).
pub fn write_ticket_raw(project_dir: &str, ticket: &Ticket) -> Result<(), String> {
    write_ticket(project_dir, ticket)
}

/// Write a ticket to disk.
fn write_ticket(project_dir: &str, ticket: &Ticket) -> Result<(), String> {
    let path = ticket_path(project_dir, &ticket.id)?;
    let content = serde_json::to_string_pretty(ticket)
        .map_err(|e| format!("Failed to serialize ticket: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write ticket: {}", e))
}

/// Generate a new ticket ID.
fn generate_id() -> String {
    let uuid = uuid::Uuid::new_v4().to_string();
    format!("meld-{}", &uuid[..8])
}

/// List all tickets, optionally filtering by status and type.
pub fn list_tickets(
    project_dir: &str,
    status: Option<&str>,
    ticket_type: Option<&str>,
    show_all: bool,
) -> Result<Vec<Ticket>, String> {
    let dir = tickets_dir(project_dir)?;
    let mut tickets = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Failed to read tickets: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let ticket: Ticket = match serde_json::from_str(&content) {
            Ok(t) => t,
            Err(_) => continue,
        };

        // Filter by status (unless show_all)
        if !show_all {
            if let Some(s) = status {
                if ticket.status != s {
                    continue;
                }
            }
        }

        // Filter by type
        if let Some(t) = ticket_type {
            if ticket.ticket_type != t {
                continue;
            }
        }

        tickets.push(ticket);
    }

    // Sort by priority (ascending), then created_at (descending)
    tickets.sort_by(|a, b| {
        a.priority
            .cmp(&b.priority)
            .then_with(|| b.created_at.cmp(&a.created_at))
    });

    Ok(tickets)
}

/// Create a new ticket.
pub fn create_ticket(
    project_dir: &str,
    title: &str,
    description: Option<&str>,
    ticket_type: &str,
    priority: i32,
) -> Result<Ticket, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let ticket = Ticket {
        id: generate_id(),
        title: title.to_string(),
        status: "open".to_string(),
        priority,
        ticket_type: ticket_type.to_string(),
        description: description.map(|s| s.to_string()),
        notes: None,
        design: None,
        acceptance_criteria: None,
        assignee: None,
        created_by: None,
        created_at: now.clone(),
        updated_at: now,
        closed_at: None,
        close_reason: None,
        labels: Vec::new(),
        parent_id: None,
        children_ids: Vec::new(),
        metadata: serde_json::json!({}),
        comments: Vec::new(),
        external_id: None,
        external_source: None,
    };

    write_ticket(project_dir, &ticket)?;
    Ok(ticket)
}

/// Update a ticket's fields.
pub fn update_ticket(
    project_dir: &str,
    id: &str,
    title: Option<&str>,
    status: Option<&str>,
    priority: Option<i32>,
    description: Option<&str>,
    notes: Option<&str>,
    design: Option<&str>,
    acceptance_criteria: Option<&str>,
    metadata: Option<&str>,
) -> Result<Ticket, String> {
    let mut ticket = read_ticket(project_dir, id)?;

    if let Some(t) = title {
        ticket.title = t.to_string();
    }
    if let Some(s) = status {
        ticket.status = s.to_string();
    }
    if let Some(p) = priority {
        ticket.priority = p;
    }
    if let Some(d) = description {
        ticket.description = Some(d.to_string());
    }
    if let Some(n) = notes {
        ticket.notes = Some(n.to_string());
    }
    if let Some(ds) = design {
        ticket.design = Some(ds.to_string());
    }
    if let Some(a) = acceptance_criteria {
        ticket.acceptance_criteria = Some(a.to_string());
    }
    if let Some(m) = metadata {
        let meta: serde_json::Value =
            serde_json::from_str(m).map_err(|e| format!("Invalid metadata JSON: {}", e))?;
        ticket.metadata = meta;
    }

    ticket.updated_at = chrono::Utc::now().to_rfc3339();
    write_ticket(project_dir, &ticket)?;
    Ok(ticket)
}

/// Close a ticket.
pub fn close_ticket(project_dir: &str, id: &str, reason: Option<&str>) -> Result<Ticket, String> {
    let mut ticket = read_ticket(project_dir, id)?;
    let now = chrono::Utc::now().to_rfc3339();

    ticket.status = "closed".to_string();
    ticket.closed_at = Some(now.clone());
    ticket.updated_at = now;
    if let Some(r) = reason {
        ticket.close_reason = Some(r.to_string());
    }

    write_ticket(project_dir, &ticket)?;
    Ok(ticket)
}

/// Show a single ticket by ID.
pub fn show_ticket(project_dir: &str, id: &str) -> Result<Ticket, String> {
    read_ticket(project_dir, id)
}

/// Delete a ticket.
pub fn delete_ticket(project_dir: &str, id: &str) -> Result<(), String> {
    let path = ticket_path(project_dir, id)?;
    if !path.exists() {
        return Err(format!("Ticket '{}' not found", id));
    }
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete ticket: {}", e))
}

/// Add a comment to a ticket.
pub fn add_comment(
    project_dir: &str,
    id: &str,
    author: &str,
    text: &str,
) -> Result<Ticket, String> {
    let mut ticket = read_ticket(project_dir, id)?;

    let comment = TicketComment {
        id: uuid::Uuid::new_v4().to_string()[..8].to_string(),
        author: author.to_string(),
        text: text.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    ticket.comments.push(comment);
    ticket.updated_at = chrono::Utc::now().to_rfc3339();
    write_ticket(project_dir, &ticket)?;
    Ok(ticket)
}
