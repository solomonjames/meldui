pub mod beads_adapter;

use crate::settings;
use crate::tickets::{self, Ticket};

/// Push a single ticket to the configured external system.
pub async fn push_ticket(project_dir: &str, ticket: &Ticket) -> Result<String, String> {
    let project_settings = settings::get_settings(project_dir)?;
    let sync = project_settings
        .sync
        .as_ref()
        .ok_or("Sync not configured")?;

    if !sync.enabled {
        return Err("Sync is not enabled".to_string());
    }

    match sync.provider.as_str() {
        "beads" => beads_adapter::push_ticket(project_dir, ticket).await,
        other => Err(format!("Unknown sync provider: {}", other)),
    }
}

/// Pull all tickets from the external system and merge into internal store.
pub async fn pull_all(project_dir: &str) -> Result<Vec<Ticket>, String> {
    let project_settings = settings::get_settings(project_dir)?;
    let sync = project_settings
        .sync
        .as_ref()
        .ok_or("Sync not configured")?;

    if !sync.enabled {
        return Err("Sync is not enabled".to_string());
    }

    let external_tickets = match sync.provider.as_str() {
        "beads" => beads_adapter::pull_all(project_dir).await?,
        other => return Err(format!("Unknown sync provider: {}", other)),
    };

    // Merge external tickets into internal store
    let mut merged = Vec::new();
    for ext_ticket in external_tickets {
        // Check if we already have this ticket via external_id
        let existing = tickets::list_tickets(project_dir, None, None, true)?
            .into_iter()
            .find(|t| t.external_id.as_deref() == Some(&ext_ticket.id));

        if let Some(existing) = existing {
            // Update existing ticket with external data, keeping internal ID
            let mut updated = ext_ticket;
            updated.id = existing.id;
            tickets::update_ticket(
                project_dir,
                &updated.id,
                Some(&updated.title),
                Some(&updated.status),
                Some(updated.priority),
                updated.description.as_deref(),
                updated.notes.as_deref(),
                updated.design.as_deref(),
                updated.acceptance_criteria.as_deref(),
                None,
            )?;
            merged.push(updated);
        } else {
            // Create new internal ticket from external
            tickets::write_ticket_raw(project_dir, &ext_ticket)?;
            merged.push(ext_ticket);
        }
    }

    Ok(merged)
}
