//! Beads-to-Ticket field mapping for sync operations.
use crate::beads;
use crate::tickets::Ticket;

/// Map a BeadsIssue to a Ticket.
fn beads_to_ticket(issue: &beads::BeadsIssue) -> Ticket {
    Ticket {
        id: format!("meld-{}", &issue.id[..8.min(issue.id.len())]),
        title: issue.title.clone(),
        status: issue.status.clone(),
        priority: issue.priority,
        ticket_type: issue.issue_type.clone(),
        description: issue.description.clone(),
        notes: issue.notes.clone(),
        design: issue.design.clone(),
        acceptance_criteria: issue.acceptance.clone(),
        assignee: issue.assignee.clone().or_else(|| issue.owner.clone()),
        created_by: issue.created_by.clone(),
        created_at: issue.created_at.clone().unwrap_or_default(),
        updated_at: issue.updated_at.clone().unwrap_or_default(),
        closed_at: issue.closed_at.clone(),
        close_reason: issue.close_reason.clone(),
        labels: issue.labels.clone().unwrap_or_default(),
        parent_id: issue.parent_id.clone(),
        children_ids: Vec::new(),
        sections: Vec::new(),
        metadata: issue
            .metadata
            .clone()
            .unwrap_or_else(|| serde_json::json!({})),
        comments: issue
            .comments
            .as_ref()
            .map(|cs| {
                cs.iter()
                    .map(|c| crate::tickets::TicketComment {
                        id: c.id.to_string(),
                        author: c.author.clone(),
                        text: c.text.clone(),
                        created_at: c.created_at.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        external_id: Some(issue.id.clone()),
        external_source: Some("beads".to_string()),
    }
}

/// Push a ticket to beads (create or update).
pub async fn push_ticket(project_dir: &str, ticket: &Ticket) -> Result<String, String> {
    if let Some(ext_id) = &ticket.external_id {
        // Update existing beads issue
        beads::update_issue(
            project_dir,
            ext_id,
            Some(&ticket.title),
            Some(&ticket.status),
            Some(&ticket.priority.to_string()),
            ticket.description.as_deref(),
            ticket.notes.as_deref(),
            ticket.design.as_deref(),
            ticket.acceptance_criteria.as_deref(),
            None,
        )
        .await?;
        Ok(ext_id.clone())
    } else {
        // Create new beads issue
        let issue = beads::create_issue(
            project_dir,
            &ticket.title,
            ticket.description.as_deref(),
            &ticket.ticket_type,
            &ticket.priority.to_string(),
        )
        .await?;
        Ok(issue.id)
    }
}

/// Pull all tickets from beads.
pub async fn pull_all(project_dir: &str) -> Result<Vec<Ticket>, String> {
    let issues = beads::list_issues(project_dir, None, None, true).await?;
    Ok(issues.iter().map(beads_to_ticket).collect())
}
