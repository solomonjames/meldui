//! Ticket CRUD operations with file-based JSON storage.
//!
//! Tickets are stored as individual JSON files in `.meldui/tickets/`.
use std::path::PathBuf;

use thiserror::Error;

use crate::constants::{MELDUI_DIR, TICKETS_DIR};

use serde::{Deserialize, Serialize};

/// Structured error type for ticket operations.
#[derive(Debug, Error)]
pub(crate) enum TicketError {
    #[error("ticket '{id}' not found")]
    NotFound { id: String },

    #[error("failed to read ticket '{id}'")]
    ReadFailed {
        id: String,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to write ticket '{id}'")]
    WriteFailed {
        id: String,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to parse ticket '{id}'")]
    ParseFailed {
        id: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("failed to serialize ticket '{id}'")]
    SerializeFailed {
        id: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("failed to delete ticket '{id}'")]
    DeleteFailed {
        id: String,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to create tickets directory")]
    DirCreateFailed(#[source] std::io::Error),

    #[error("failed to list tickets")]
    ListFailed(#[source] std::io::Error),

    #[error("invalid metadata JSON")]
    InvalidMetadata(#[source] serde_json::Error),

    #[error("section '{section_id}' not found on ticket '{ticket_id}'")]
    SectionNotFound {
        section_id: String,
        ticket_id: String,
    },
}

/// Allow `?` to propagate `TicketError` in functions returning `Result<T, String>`.
impl From<TicketError> for String {
    fn from(err: TicketError) -> Self {
        err.to_string()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct TicketComment {
    pub id: String,
    pub author: String,
    pub text: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
pub struct TicketSection {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub section_type: String,
    pub content: serde_json::Value,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
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
    pub sections: Vec<TicketSection>,
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(default)]
    pub comments: Vec<TicketComment>,
}

/// Get path to the .meldui/tickets/ directory, creating if needed.
fn tickets_dir(project_dir: &str) -> Result<PathBuf, TicketError> {
    let dir = PathBuf::from(project_dir)
        .join(MELDUI_DIR)
        .join(TICKETS_DIR);
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(TicketError::DirCreateFailed)?;
    }
    Ok(dir)
}

/// Path to a specific ticket file.
fn ticket_path(project_dir: &str, id: &str) -> Result<PathBuf, TicketError> {
    let dir = tickets_dir(project_dir)?;
    Ok(dir.join(format!("{id}.json")))
}

/// Read a single ticket from disk.
fn read_ticket(project_dir: &str, id: &str) -> Result<Ticket, TicketError> {
    let path = ticket_path(project_dir, id)?;
    if !path.exists() {
        return Err(TicketError::NotFound { id: id.to_owned() });
    }
    let content = std::fs::read_to_string(&path).map_err(|e| TicketError::ReadFailed {
        id: id.to_owned(),
        source: e,
    })?;
    serde_json::from_str(&content).map_err(|e| TicketError::ParseFailed {
        id: id.to_owned(),
        source: e,
    })
}

/// Write a ticket to disk.
fn write_ticket(project_dir: &str, ticket: &Ticket) -> Result<(), TicketError> {
    let path = ticket_path(project_dir, &ticket.id)?;
    let content =
        serde_json::to_string_pretty(ticket).map_err(|e| TicketError::SerializeFailed {
            id: ticket.id.clone(),
            source: e,
        })?;
    std::fs::write(&path, content).map_err(|e| TicketError::WriteFailed {
        id: ticket.id.clone(),
        source: e,
    })
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
    list_tickets_inner(project_dir, status, ticket_type, show_all).map_err(|e| e.to_string())
}

/// Inner implementation returning structured errors.
fn list_tickets_inner(
    project_dir: &str,
    status: Option<&str>,
    ticket_type: Option<&str>,
    show_all: bool,
) -> Result<Vec<Ticket>, TicketError> {
    let dir = tickets_dir(project_dir)?;
    let mut tickets = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(TicketError::ListFailed)?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
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
    create_ticket_inner(project_dir, title, description, ticket_type, priority)
        .map_err(|e| e.to_string())
}

/// Inner implementation returning structured errors.
fn create_ticket_inner(
    project_dir: &str,
    title: &str,
    description: Option<&str>,
    ticket_type: &str,
    priority: i32,
) -> Result<Ticket, TicketError> {
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
        sections: Vec::new(),
        metadata: serde_json::json!({}),
        comments: Vec::new(),
    };

    write_ticket(project_dir, &ticket)?;
    Ok(ticket)
}

/// Update a ticket's fields.
#[allow(clippy::too_many_arguments)]
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
    update_ticket_inner(
        project_dir,
        id,
        title,
        status,
        priority,
        description,
        notes,
        design,
        acceptance_criteria,
        metadata,
    )
    .map_err(|e| e.to_string())
}

/// Inner implementation returning structured errors.
#[allow(clippy::too_many_arguments)]
fn update_ticket_inner(
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
) -> Result<Ticket, TicketError> {
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
            serde_json::from_str(m).map_err(TicketError::InvalidMetadata)?;
        ticket.metadata = meta;
    }

    ticket.updated_at = chrono::Utc::now().to_rfc3339();
    write_ticket(project_dir, &ticket)?;
    Ok(ticket)
}

/// Close a ticket.
pub fn close_ticket(project_dir: &str, id: &str, reason: Option<&str>) -> Result<Ticket, String> {
    close_ticket_inner(project_dir, id, reason).map_err(|e| e.to_string())
}

/// Inner implementation returning structured errors.
fn close_ticket_inner(
    project_dir: &str,
    id: &str,
    reason: Option<&str>,
) -> Result<Ticket, TicketError> {
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
    read_ticket(project_dir, id).map_err(|e| e.to_string())
}

/// Delete a ticket.
pub fn delete_ticket(project_dir: &str, id: &str) -> Result<(), String> {
    delete_ticket_inner(project_dir, id).map_err(|e| e.to_string())
}

/// Inner implementation returning structured errors.
fn delete_ticket_inner(project_dir: &str, id: &str) -> Result<(), TicketError> {
    let path = ticket_path(project_dir, id)?;
    if !path.exists() {
        return Err(TicketError::NotFound { id: id.to_owned() });
    }
    std::fs::remove_file(&path).map_err(|e| TicketError::DeleteFailed {
        id: id.to_owned(),
        source: e,
    })
}

/// Add a comment to a ticket.
pub fn add_comment(
    project_dir: &str,
    id: &str,
    author: &str,
    text: &str,
) -> Result<Ticket, String> {
    add_comment_inner(project_dir, id, author, text).map_err(|e| e.to_string())
}

/// Inner implementation returning structured errors.
fn add_comment_inner(
    project_dir: &str,
    id: &str,
    author: &str,
    text: &str,
) -> Result<Ticket, TicketError> {
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

/// Definition for initializing a ticket section from a workflow.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct TicketSectionDef {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub section_type: String,
    #[serde(default)]
    pub collapsed: bool,
}

/// Update a single typed section's content on a ticket.
pub fn update_section(
    project_dir: &str,
    ticket_id: &str,
    section_id: &str,
    content: serde_json::Value,
) -> Result<Ticket, String> {
    update_section_inner(project_dir, ticket_id, section_id, content).map_err(|e| e.to_string())
}

/// Inner implementation returning structured errors.
fn update_section_inner(
    project_dir: &str,
    ticket_id: &str,
    section_id: &str,
    content: serde_json::Value,
) -> Result<Ticket, TicketError> {
    let mut ticket = read_ticket(project_dir, ticket_id)?;
    let now = chrono::Utc::now().to_rfc3339();

    let section = ticket
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| TicketError::SectionNotFound {
            section_id: section_id.to_owned(),
            ticket_id: ticket_id.to_owned(),
        })?;

    section.content = content;
    section.updated_at = now.clone();

    ticket.updated_at = now;
    write_ticket(project_dir, &ticket)?;
    Ok(ticket)
}

/// Initialize typed sections on a ticket from workflow section definitions.
/// Skips sections where an entry with the same ID already exists.
pub fn initialize_ticket_sections(
    project_dir: &str,
    ticket_id: &str,
    section_defs: Vec<TicketSectionDef>,
) -> Result<Ticket, String> {
    initialize_ticket_sections_inner(project_dir, ticket_id, section_defs)
        .map_err(|e| e.to_string())
}

/// Inner implementation returning structured errors.
fn initialize_ticket_sections_inner(
    project_dir: &str,
    ticket_id: &str,
    section_defs: Vec<TicketSectionDef>,
) -> Result<Ticket, TicketError> {
    let mut ticket = read_ticket(project_dir, ticket_id)?;
    let now = chrono::Utc::now().to_rfc3339();

    for def in section_defs {
        if ticket.sections.iter().any(|s| s.id == def.id) {
            continue;
        }

        let empty_content = match def.section_type.as_str() {
            "markdown" => serde_json::json!({ "text": "" }),
            "acceptance_criteria" | "checklist" => serde_json::json!({ "items": [] }),
            "key_value" => serde_json::json!({ "entries": [] }),
            _ => serde_json::json!({}),
        };

        ticket.sections.push(TicketSection {
            id: def.id,
            label: def.label,
            section_type: def.section_type,
            content: empty_content,
            collapsed: def.collapsed,
            source: "workflow".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    ticket.updated_at = now;
    write_ticket(project_dir, &ticket)?;
    Ok(ticket)
}
