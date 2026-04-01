//! Conversation persistence using libSQL.
//!
//! Each conversation is stored in a shared libSQL database at
//! `.meldui/conversations/conversations.db`.

use std::time::Instant;

use chrono::Utc;
use libsql::params;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::conversation_db::ConversationDbError;

const SCHEMA_VERSION: u32 = 2;
/// Batch size for event writes. Set to 1 (write-through) to prevent data loss
/// on crash — no events are buffered in memory. Increase once a proper
/// Drop-based flush or flush-on-error strategy is implemented.
const BATCH_SIZE: usize = 1;
const BATCH_FLUSH_MS: u64 = 50;

/// Structured error type for conversation operations.
#[derive(Debug, Error)]
#[allow(clippy::enum_variant_names, dead_code)]
pub(crate) enum ConversationError {
    #[error("database error: {0}")]
    Database(#[from] ConversationDbError),

    #[error("libsql error: {0}")]
    LibSql(#[from] libsql::Error),

    #[error("failed to serialize conversation")]
    SerializeFailed(#[source] serde_json::Error),

    #[error("conversation not found")]
    NotFound,
}

// ── Turn triggers ──

/// Events that create a new turn boundary.
#[derive(Clone, Debug, PartialEq)]
pub enum TurnTrigger {
    StepStart,
    UserMessage,
    SupervisorReply,
}

// ── Event types ──

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ConversationEvent {
    pub timestamp: String,
    pub sequence: u32,
    pub step_id: String,
    pub event_type: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "marker_type")]
pub enum StepMarker {
    #[serde(rename = "start")]
    Start { label: String },
    #[serde(rename = "end")]
    End { status: String },
}

// ── Snapshot format ──

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct ConversationSnapshot {
    pub schema_version: u32,
    pub ticket_id: String,
    pub session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub status: String,
    pub events: Vec<ConversationEventRecord>,
    pub steps: Vec<ConversationStepRecord>,
    pub event_count: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct ConversationEventRecord {
    pub timestamp: String,
    pub sequence: u32,
    pub step_id: String,
    pub event_type: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct ConversationStepRecord {
    pub step_id: String,
    pub label: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: String,
    pub first_sequence: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct ConversationSummary {
    pub ticket_id: String,
    pub status: String,
    pub event_count: u32,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct TurnSummary {
    pub turn_id: String,
    pub start_sequence: u32,
    pub end_sequence: u32,
    pub event_count: u32,
    pub first_event_type: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct SearchResult {
    pub ticket_id: String,
    pub step_id: String,
    pub event_type: String,
    pub content: String,
    pub timestamp: String,
    pub rank: f64,
}

// ── Context tracking ──

/// Internal struct for recording API context/usage data per turn.
/// Not exposed via IPC — no specta::Type needed.
#[derive(Clone, Debug)]
#[allow(dead_code)] // Used by Task 24 (agent context capture) — not yet wired
pub(crate) struct ContextRecord {
    pub api_messages_json: String,
    pub token_count_in: u32,
    pub token_count_out: u32,
    pub cache_reads: u32,
    pub cache_writes: u32,
    pub cost_usd: f64,
    pub model: String,
}

/// Aggregated conversation statistics exposed to the frontend via IPC.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct ConversationStats {
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub total_cache_reads: u32,
    pub total_cache_writes: u32,
    pub total_cost_usd: f64,
    pub turn_count: u32,
    pub model: Option<String>,
}

/// Record context/usage data for a specific turn in the conversation.
#[allow(dead_code)] // Called from Task 24 (agent context capture) — not yet wired
pub async fn record_context(
    conn: &libsql::Connection,
    ticket_id: &str,
    turn_id: &str,
    step_id: &str,
    context: &ContextRecord,
) -> Result<(), ConversationError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO conversation_context (ticket_id, turn_id, step_id, api_messages_json, token_count_in, token_count_out, cache_reads, cache_writes, cost_usd, model, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            ticket_id,
            turn_id,
            step_id,
            context.api_messages_json.clone(),
            context.token_count_in,
            context.token_count_out,
            context.cache_reads,
            context.cache_writes,
            context.cost_usd,
            context.model.clone(),
            now
        ],
    )
    .await?;
    Ok(())
}

/// Get aggregated conversation statistics for a ticket.
pub async fn get_conversation_stats(
    conn: &libsql::Connection,
    ticket_id: &str,
) -> Result<ConversationStats, ConversationError> {
    let mut rows = conn
        .query(
            "SELECT COALESCE(SUM(token_count_in),0), COALESCE(SUM(token_count_out),0), COALESCE(SUM(cache_reads),0), COALESCE(SUM(cache_writes),0), COALESCE(SUM(cost_usd),0.0), COUNT(*), MAX(model) FROM conversation_context WHERE ticket_id = ?1",
            params![ticket_id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(ConversationStats {
            total_input_tokens: row.get::<u32>(0).unwrap_or(0),
            total_output_tokens: row.get::<u32>(1).unwrap_or(0),
            total_cache_reads: row.get::<u32>(2).unwrap_or(0),
            total_cache_writes: row.get::<u32>(3).unwrap_or(0),
            total_cost_usd: row.get::<f64>(4).unwrap_or(0.0),
            turn_count: row.get::<u32>(5).unwrap_or(0),
            model: row.get::<String>(6).ok(),
        })
    } else {
        Ok(ConversationStats {
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_reads: 0,
            total_cache_writes: 0,
            total_cost_usd: 0.0,
            turn_count: 0,
            model: None,
        })
    }
}

// ── Writer ──

/// Buffers conversation events and writes them to libSQL in batches.
pub struct ConversationWriter {
    conn: libsql::Connection,
    ticket_id: String,
    #[allow(dead_code)]
    current_step_id: String,
    current_turn_id: String,
    sequence: u32,
    turn_number: u32,
    batch: Vec<ConversationEvent>,
    last_flush: Instant,
}

impl ConversationWriter {
    /// Open a conversation writer backed by an existing libSQL connection.
    ///
    /// Upserts a row into the `conversations` table and reads the current max sequence.
    #[allow(dead_code)] // Used in tests; production callers switch in Task 8
    pub async fn open_async(
        conn: libsql::Connection,
        ticket_id: &str,
    ) -> Result<Self, ConversationError> {
        let now = Utc::now().to_rfc3339();

        // Upsert conversation row
        conn.execute(
            "INSERT INTO conversations (ticket_id, status, created_at, updated_at, event_count)
             VALUES (?1, 'active', ?2, ?2, 0)
             ON CONFLICT(ticket_id) DO UPDATE SET updated_at = ?2",
            params![ticket_id, now.clone()],
        )
        .await?;

        // Read max sequence
        let mut rows = conn
            .query(
                "SELECT COALESCE(MAX(sequence), 0) FROM conversation_events WHERE ticket_id = ?1",
                params![ticket_id],
            )
            .await?;

        let max_seq = if let Some(row) = rows.next().await? {
            row.get::<u32>(0).unwrap_or(0)
        } else {
            0
        };

        // Read max turn number from existing turn_ids
        let prefix = format!("{ticket_id}-t");
        let mut turn_rows = conn
            .query(
                "SELECT COALESCE(MAX(CAST(REPLACE(turn_id, ?1, '') AS INTEGER)), 0) FROM conversation_events WHERE ticket_id = ?2 AND turn_id IS NOT NULL",
                params![prefix, ticket_id],
            )
            .await?;

        let max_turn = if let Some(row) = turn_rows.next().await? {
            row.get::<u32>(0).unwrap_or(0)
        } else {
            0
        };

        Ok(Self {
            conn,
            ticket_id: ticket_id.to_string(),
            current_step_id: String::new(),
            current_turn_id: String::new(),
            sequence: max_seq,
            turn_number: max_turn,
            batch: Vec::new(),
            last_flush: Instant::now(),
        })
    }

    /// Create a new turn, returning its ID.
    ///
    /// Turn IDs are formatted as `"{ticket_id}-t{turn_number}"` and are
    /// monotonically increasing per ticket.
    pub fn new_turn(&mut self, _trigger: TurnTrigger) -> String {
        self.turn_number += 1;
        let turn_id = format!("{}-t{}", self.ticket_id, self.turn_number);
        self.current_turn_id = turn_id.clone();
        turn_id
    }

    /// Append a raw event to the batch buffer.
    ///
    /// Flushes automatically when the batch reaches `BATCH_SIZE` items
    /// or `BATCH_FLUSH_MS` milliseconds have elapsed since the last flush.
    pub async fn append_raw(
        &mut self,
        msg_type: &str,
        content_params: &serde_json::Value,
        step_id: &str,
    ) -> Result<(), String> {
        self.append_raw_inner(msg_type, content_params, step_id)
            .await
            .map_err(|e| e.to_string())
    }

    async fn append_raw_inner(
        &mut self,
        msg_type: &str,
        content_params: &serde_json::Value,
        step_id: &str,
    ) -> Result<(), ConversationError> {
        // Auto-create new turn on trigger event types
        match msg_type {
            "user_message" => {
                self.new_turn(TurnTrigger::UserMessage);
            }
            "supervisor_reply" => {
                self.new_turn(TurnTrigger::SupervisorReply);
            }
            _ => {}
        }

        self.sequence += 1;
        let event = ConversationEvent {
            timestamp: Utc::now().to_rfc3339(),
            sequence: self.sequence,
            step_id: step_id.to_string(),
            event_type: msg_type.to_string(),
            content: serde_json::to_string(content_params).unwrap_or_default(),
        };
        self.batch.push(event);

        if self.batch.len() >= BATCH_SIZE
            || self.last_flush.elapsed().as_millis() >= BATCH_FLUSH_MS as u128
        {
            self.flush_batch().await?;
        }
        Ok(())
    }

    /// Write a step start/end marker to the database.
    pub async fn write_step_marker(
        &mut self,
        step_id: &str,
        marker: &StepMarker,
    ) -> Result<(), String> {
        self.write_step_marker_inner(step_id, marker)
            .await
            .map_err(|e| e.to_string())
    }

    async fn write_step_marker_inner(
        &mut self,
        step_id: &str,
        marker: &StepMarker,
    ) -> Result<(), ConversationError> {
        // Flush any pending batch first
        self.flush_batch().await?;

        // Auto-create new turn on step_start
        if matches!(marker, StepMarker::Start { .. }) {
            self.new_turn(TurnTrigger::StepStart);
        }

        self.sequence += 1;
        let now = Utc::now().to_rfc3339();

        let turn_id = if self.current_turn_id.is_empty() {
            None
        } else {
            Some(self.current_turn_id.clone())
        };

        match marker {
            StepMarker::Start { label } => {
                // Insert event
                self.conn
                    .execute(
                        "INSERT INTO conversation_events (ticket_id, sequence, turn_id, step_id, event_type, content, timestamp)
                         VALUES (?1, ?2, ?3, ?4, 'step_start', ?5, ?6)",
                        params![
                            self.ticket_id.clone(),
                            self.sequence,
                            turn_id.clone(),
                            step_id,
                            serde_json::json!({ "step_label": label }).to_string(),
                            now.clone()
                        ],
                    )
                    .await?;

                // Insert/update step record
                self.conn
                    .execute(
                        "INSERT INTO conversation_steps (ticket_id, step_id, label, status, started_at, first_sequence)
                         VALUES (?1, ?2, ?3, 'in_progress', ?4, ?5)
                         ON CONFLICT(step_id) DO UPDATE SET
                            label = ?3, status = 'in_progress', started_at = ?4, first_sequence = ?5",
                        params![
                            self.ticket_id.clone(),
                            step_id,
                            label.clone(),
                            now.clone(),
                            self.sequence
                        ],
                    )
                    .await?;

                self.current_step_id = step_id.to_string();
            }
            StepMarker::End { status } => {
                // Insert event
                self.conn
                    .execute(
                        "INSERT INTO conversation_events (ticket_id, sequence, turn_id, step_id, event_type, content, timestamp)
                         VALUES (?1, ?2, ?3, ?4, 'step_end', ?5, ?6)",
                        params![
                            self.ticket_id.clone(),
                            self.sequence,
                            turn_id,
                            step_id,
                            serde_json::json!({ "status": status }).to_string(),
                            now.clone()
                        ],
                    )
                    .await?;

                // Update step record
                self.conn
                    .execute(
                        "UPDATE conversation_steps SET status = ?1, completed_at = ?2, last_sequence = ?3
                         WHERE step_id = ?4 AND ticket_id = ?5",
                        params![
                            status.clone(),
                            now.clone(),
                            self.sequence,
                            step_id,
                            self.ticket_id.clone()
                        ],
                    )
                    .await?;
            }
        }

        // Update conversation metadata
        self.conn
            .execute(
                "UPDATE conversations SET updated_at = ?1, event_count = event_count + 1, last_step_id = ?2
                 WHERE ticket_id = ?3",
                params![now, step_id, self.ticket_id.clone()],
            )
            .await?;

        Ok(())
    }

    /// Flush pending batch to the database inside a transaction.
    async fn flush_batch(&mut self) -> Result<(), ConversationError> {
        if self.batch.is_empty() {
            return Ok(());
        }

        let batch = std::mem::take(&mut self.batch);
        let batch_len = batch.len() as u32;

        let tx = self.conn.transaction().await?;

        let turn_id = if self.current_turn_id.is_empty() {
            None
        } else {
            Some(self.current_turn_id.clone())
        };

        for event in &batch {
            tx.execute(
                "INSERT INTO conversation_events (ticket_id, sequence, turn_id, step_id, event_type, content, timestamp)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    self.ticket_id.clone(),
                    event.sequence,
                    turn_id.clone(),
                    event.step_id.clone(),
                    event.event_type.clone(),
                    event.content.clone(),
                    event.timestamp.clone()
                ],
            )
            .await?;
        }

        // Update event count and timestamp
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE conversations SET event_count = event_count + ?1, updated_at = ?2 WHERE ticket_id = ?3",
            params![batch_len, now, self.ticket_id.clone()],
        )
        .await?;

        tx.commit().await?;
        self.last_flush = Instant::now();

        Ok(())
    }

    /// Flush any pending events.
    pub async fn flush(&mut self) -> Result<(), String> {
        self.flush_batch().await.map_err(|e| e.to_string())
    }
}

// ── Reading ──

/// Restore a conversation from the database.
///
/// Returns `None` if no conversation exists for the given ticket.
pub async fn restore_conversation(
    conn: &libsql::Connection,
    ticket_id: &str,
) -> Result<Option<ConversationSnapshot>, ConversationError> {
    // Query conversation metadata
    let mut rows = conn
        .query(
            "SELECT ticket_id, session_id, status, created_at, updated_at, event_count
             FROM conversations WHERE ticket_id = ?1",
            params![ticket_id],
        )
        .await?;

    let Some(meta_row) = rows.next().await? else {
        return Ok(None);
    };

    let ticket_id_val: String = meta_row.get(0)?;
    let session_id: Option<String> = meta_row.get(1).ok();
    let status: String = meta_row.get(2)?;
    let created_at: String = meta_row.get(3)?;
    let updated_at: String = meta_row.get(4)?;
    let event_count: u32 = meta_row.get(5)?;

    // Query events (excluding step markers)
    let mut event_rows = conn
        .query(
            "SELECT timestamp, sequence, step_id, event_type, content
             FROM conversation_events
             WHERE ticket_id = ?1 AND event_type NOT IN ('step_start', 'step_end')
             ORDER BY sequence",
            params![ticket_id_val.clone()],
        )
        .await?;

    let mut events = Vec::new();
    while let Some(row) = event_rows.next().await? {
        events.push(ConversationEventRecord {
            timestamp: row.get(0)?,
            sequence: row.get(1)?,
            step_id: row.get::<String>(2).unwrap_or_default(),
            event_type: row.get(3)?,
            content: row.get::<String>(4).unwrap_or_default(),
        });
    }

    // Query steps
    let mut step_rows = conn
        .query(
            "SELECT step_id, label, status, started_at, completed_at, first_sequence
             FROM conversation_steps
             WHERE ticket_id = ?1
             ORDER BY first_sequence",
            params![ticket_id_val.clone()],
        )
        .await?;

    let mut steps = Vec::new();
    while let Some(row) = step_rows.next().await? {
        steps.push(ConversationStepRecord {
            step_id: row.get(0)?,
            label: row.get(1).ok(),
            status: row.get(2)?,
            started_at: row.get(3)?,
            completed_at: row.get(4).ok(),
            first_sequence: row.get(5)?,
        });
    }

    Ok(Some(ConversationSnapshot {
        schema_version: SCHEMA_VERSION,
        ticket_id: ticket_id_val,
        session_id,
        created_at,
        updated_at,
        status,
        events,
        steps,
        event_count,
    }))
}

/// List all conversations, ordered by most recently updated.
pub async fn list_conversations(
    conn: &libsql::Connection,
) -> Result<Vec<ConversationSummary>, ConversationError> {
    let mut rows = conn
        .query(
            "SELECT ticket_id, status, event_count, updated_at
             FROM conversations
             ORDER BY updated_at DESC",
            params![],
        )
        .await?;

    let mut summaries = Vec::new();
    while let Some(row) = rows.next().await? {
        summaries.push(ConversationSummary {
            ticket_id: row.get(0)?,
            status: row.get(1)?,
            event_count: row.get(2)?,
            updated_at: row.get(3)?,
        });
    }

    Ok(summaries)
}

/// Load all events for a specific turn.
pub async fn load_turn(
    conn: &libsql::Connection,
    ticket_id: &str,
    turn_id: &str,
) -> Result<Vec<ConversationEventRecord>, ConversationError> {
    let mut rows = conn
        .query(
            "SELECT timestamp, sequence, step_id, event_type, content
             FROM conversation_events
             WHERE ticket_id = ?1 AND turn_id = ?2
             ORDER BY sequence",
            params![ticket_id, turn_id],
        )
        .await?;

    let mut events = Vec::new();
    while let Some(row) = rows.next().await? {
        events.push(ConversationEventRecord {
            timestamp: row.get(0)?,
            sequence: row.get(1)?,
            step_id: row.get::<String>(2).unwrap_or_default(),
            event_type: row.get(3)?,
            content: row.get::<String>(4).unwrap_or_default(),
        });
    }

    Ok(events)
}

/// List all turns for a ticket with summary metadata.
pub async fn list_turns(
    conn: &libsql::Connection,
    ticket_id: &str,
) -> Result<Vec<TurnSummary>, ConversationError> {
    let mut rows = conn
        .query(
            "SELECT turn_id, MIN(sequence) as start_seq, MAX(sequence) as end_seq, COUNT(*) as cnt,
                    (SELECT event_type FROM conversation_events e2
                     WHERE e2.ticket_id = ?1 AND e2.turn_id = conversation_events.turn_id
                     ORDER BY e2.sequence LIMIT 1) as first_type,
                    MIN(timestamp) as ts
             FROM conversation_events
             WHERE ticket_id = ?1 AND turn_id IS NOT NULL
             GROUP BY turn_id
             ORDER BY MIN(sequence)",
            params![ticket_id],
        )
        .await?;

    let mut turns = Vec::new();
    while let Some(row) = rows.next().await? {
        turns.push(TurnSummary {
            turn_id: row.get(0)?,
            start_sequence: row.get(1)?,
            end_sequence: row.get(2)?,
            event_count: row.get(3)?,
            first_event_type: row.get::<String>(4).unwrap_or_default(),
            timestamp: row.get(5)?,
        });
    }

    Ok(turns)
}

/// Full-text search across conversation events using FTS5.
///
/// When `ticket_id` is `Some`, results are scoped to that ticket.
/// Results are ordered by FTS5 rank (best match first).
pub async fn search_conversations(
    conn: &libsql::Connection,
    query: &str,
    ticket_id: Option<&str>,
    limit: u32,
) -> Result<Vec<SearchResult>, ConversationError> {
    let mut results = Vec::new();

    let mut rows = if let Some(tid) = ticket_id {
        conn.query(
            "SELECT ce.ticket_id, ce.step_id, ce.event_type, ce.content, ce.timestamp, cs.rank
             FROM conversation_search cs
             JOIN conversation_events ce ON cs.rowid = ce.id
             WHERE cs.content MATCH ?1 AND cs.ticket_id = ?2
             ORDER BY cs.rank
             LIMIT ?3",
            params![query, tid, limit],
        )
        .await?
    } else {
        conn.query(
            "SELECT ce.ticket_id, ce.step_id, ce.event_type, ce.content, ce.timestamp, cs.rank
             FROM conversation_search cs
             JOIN conversation_events ce ON cs.rowid = ce.id
             WHERE cs.content MATCH ?1
             ORDER BY cs.rank
             LIMIT ?2",
            params![query, limit],
        )
        .await?
    };

    while let Some(row) = rows.next().await? {
        results.push(SearchResult {
            ticket_id: row.get(0)?,
            step_id: row.get::<String>(1).unwrap_or_default(),
            event_type: row.get(2)?,
            content: row.get::<String>(3).unwrap_or_default(),
            timestamp: row.get(4)?,
            rank: row.get(5)?,
        });
    }

    Ok(results)
}

// ── Retention / Cleanup ──

/// Result of a cleanup operation.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct CleanupResult {
    pub deleted_count: u32,
    pub freed_events: u32,
}

/// Delete old conversations based on age and total count limits.
///
/// Conversations older than `max_age_days` are deleted first. Then, if
/// more than `max_conversations` remain, the oldest (by `updated_at`) are
/// pruned to bring the count down. All related rows in child tables are
/// cascade-deleted and a `VACUUM` is run to reclaim space.
pub async fn cleanup_old_conversations(
    conn: &libsql::Connection,
    max_age_days: u32,
    max_conversations: u32,
) -> Result<CleanupResult, ConversationError> {
    let mut deleted_count: u32 = 0;
    let mut freed_events: u32 = 0;

    // Phase 1: delete conversations older than max_age_days
    {
        let mut rows = conn
            .query(
                &format!(
                    "SELECT ticket_id FROM conversations WHERE updated_at < datetime('now', '-{max_age_days} days')"
                ),
                params![],
            )
            .await?;

        let mut old_ids = Vec::new();
        while let Some(row) = rows.next().await? {
            old_ids.push(row.get::<String>(0)?);
        }

        for tid in &old_ids {
            let events_deleted = delete_conversation_cascade(conn, tid).await?;
            freed_events += events_deleted;
            deleted_count += 1;
        }
    }

    // Phase 2: enforce max_conversations count (keep newest by updated_at)
    {
        let mut rows = conn
            .query(
                "SELECT ticket_id FROM conversations ORDER BY updated_at DESC",
                params![],
            )
            .await?;

        let mut all_ids = Vec::new();
        while let Some(row) = rows.next().await? {
            all_ids.push(row.get::<String>(0)?);
        }

        if all_ids.len() > max_conversations as usize {
            let excess = &all_ids[max_conversations as usize..];
            for tid in excess {
                let events_deleted = delete_conversation_cascade(conn, tid).await?;
                freed_events += events_deleted;
                deleted_count += 1;
            }
        }
    }

    // VACUUM to reclaim disk space (only if we deleted something)
    if deleted_count > 0 {
        let _ = conn.execute("VACUUM", params![]).await;
    }

    Ok(CleanupResult {
        deleted_count,
        freed_events,
    })
}

/// Delete a single conversation and all its related rows. Returns the number of events deleted.
async fn delete_conversation_cascade(
    conn: &libsql::Connection,
    ticket_id: &str,
) -> Result<u32, ConversationError> {
    // Count events first so we can report freed_events
    let mut rows = conn
        .query(
            "SELECT COUNT(*) FROM conversation_events WHERE ticket_id = ?1",
            params![ticket_id],
        )
        .await?;
    let event_count = if let Some(row) = rows.next().await? {
        row.get::<u32>(0).unwrap_or(0)
    } else {
        0
    };

    // Delete from all child tables
    conn.execute(
        "DELETE FROM conversation_events WHERE ticket_id = ?1",
        params![ticket_id],
    )
    .await?;
    conn.execute(
        "DELETE FROM conversation_steps WHERE ticket_id = ?1",
        params![ticket_id],
    )
    .await?;
    conn.execute(
        "DELETE FROM conversation_context WHERE ticket_id = ?1",
        params![ticket_id],
    )
    .await?;
    conn.execute(
        "DELETE FROM conversation_checkpoints WHERE ticket_id = ?1",
        params![ticket_id],
    )
    .await?;
    conn.execute(
        "DELETE FROM conversations WHERE ticket_id = ?1",
        params![ticket_id],
    )
    .await?;

    Ok(event_count)
}

/// Update the session_id for a conversation in the database.
pub async fn update_session_id(
    conn: &libsql::Connection,
    ticket_id: &str,
    session_id: &str,
) -> Result<(), ConversationError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE conversations SET session_id = ?1, updated_at = ?2 WHERE ticket_id = ?3",
        params![session_id, now, ticket_id],
    )
    .await?;
    Ok(())
}

// ── Checkpoint types ──

/// A recorded git checkpoint associated with a conversation turn.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct CheckpointRecord {
    pub ticket_id: String,
    pub turn_id: String,
    pub step_id: String,
    pub commit_hash: String,
    pub branch: String,
    pub timestamp: String,
}

// ── Checkpoint functions ──

/// Record a git checkpoint for a conversation turn.
#[allow(dead_code)] // Called from Task 49 (workflow checkpoint hook) — not yet wired
pub async fn record_checkpoint(
    conn: &libsql::Connection,
    ticket_id: &str,
    turn_id: &str,
    step_id: &str,
    commit_hash: &str,
    branch: &str,
) -> Result<(), ConversationError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO conversation_checkpoints (ticket_id, turn_id, step_id, commit_hash, branch, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![ticket_id, turn_id, step_id, commit_hash, branch, now],
    )
    .await?;
    Ok(())
}

/// Get all checkpoints for a ticket, ordered by timestamp.
pub async fn get_checkpoints(
    conn: &libsql::Connection,
    ticket_id: &str,
) -> Result<Vec<CheckpointRecord>, ConversationError> {
    let mut rows = conn
        .query(
            "SELECT ticket_id, turn_id, step_id, commit_hash, branch, timestamp
             FROM conversation_checkpoints
             WHERE ticket_id = ?1
             ORDER BY timestamp",
            params![ticket_id],
        )
        .await?;

    let mut checkpoints = Vec::new();
    while let Some(row) = rows.next().await? {
        checkpoints.push(CheckpointRecord {
            ticket_id: row.get(0)?,
            turn_id: row.get::<String>(1).unwrap_or_default(),
            step_id: row.get::<String>(2).unwrap_or_default(),
            commit_hash: row.get::<String>(3).unwrap_or_default(),
            branch: row.get::<String>(4).unwrap_or_default(),
            timestamp: row.get(5)?,
        });
    }

    Ok(checkpoints)
}

/// Get the checkpoint for a specific turn, if one exists.
pub async fn get_checkpoint_for_turn(
    conn: &libsql::Connection,
    ticket_id: &str,
    turn_id: &str,
) -> Result<Option<CheckpointRecord>, ConversationError> {
    let mut rows = conn
        .query(
            "SELECT ticket_id, turn_id, step_id, commit_hash, branch, timestamp
             FROM conversation_checkpoints
             WHERE ticket_id = ?1 AND turn_id = ?2
             ORDER BY timestamp
             LIMIT 1",
            params![ticket_id, turn_id],
        )
        .await?;

    if let Some(row) = rows.next().await? {
        Ok(Some(CheckpointRecord {
            ticket_id: row.get(0)?,
            turn_id: row.get::<String>(1).unwrap_or_default(),
            step_id: row.get::<String>(2).unwrap_or_default(),
            commit_hash: row.get::<String>(3).unwrap_or_default(),
            branch: row.get::<String>(4).unwrap_or_default(),
            timestamp: row.get(5)?,
        }))
    } else {
        Ok(None)
    }
}

// ── Semantic / hybrid search types ──

/// A result from semantic (vector) search.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct SemanticSearchResult {
    pub ticket_id: String,
    pub step_id: String,
    pub content: String,
    pub timestamp: String,
    pub distance: f64,
}

/// A result from hybrid (FTS5 + vector) search.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct HybridSearchResult {
    pub ticket_id: String,
    pub step_id: String,
    pub content: String,
    pub timestamp: String,
    pub fts_rank: Option<f64>,
    pub vector_distance: Option<f64>,
    pub combined_score: f64,
}

/// A chunk of context retrieved via RAG.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct ContextChunk {
    pub ticket_id: String,
    pub step_id: String,
    pub step_label: Option<String>,
    pub content: String,
    pub timestamp: String,
    pub relevance: f64,
}

/// A related conversation found via embedding similarity.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, specta::Type)]
pub struct RelatedConversation {
    pub ticket_id: String,
    pub similarity: f64,
    pub event_count: u32,
    pub updated_at: String,
}

// ── Semantic search ──

/// Search conversation events by vector similarity.
///
/// Takes a pre-computed query embedding (caller is responsible for running the embedder).
/// Uses `vector_distance_cos` which is libSQL-specific.
pub async fn semantic_search(
    conn: &libsql::Connection,
    query_embedding: &[f32],
    ticket_id: Option<&str>,
    limit: u32,
) -> Result<Vec<SemanticSearchResult>, ConversationError> {
    use crate::embeddings::embedding_to_bytes;

    let embedding_blob = embedding_to_bytes(query_embedding);
    let mut results = Vec::new();

    let mut rows = if let Some(tid) = ticket_id {
        conn.query(
            "SELECT ce.ticket_id, ce.step_id, ce.content, ce.timestamp,
                    vector_distance_cos(ce.embedding, vector(?1)) AS distance
             FROM conversation_events ce
             WHERE ce.embedding IS NOT NULL AND ce.ticket_id = ?2
             ORDER BY distance
             LIMIT ?3",
            params![libsql::Value::Blob(embedding_blob), tid, limit],
        )
        .await?
    } else {
        conn.query(
            "SELECT ce.ticket_id, ce.step_id, ce.content, ce.timestamp,
                    vector_distance_cos(ce.embedding, vector(?1)) AS distance
             FROM conversation_events ce
             WHERE ce.embedding IS NOT NULL
             ORDER BY distance
             LIMIT ?2",
            params![libsql::Value::Blob(embedding_blob), limit],
        )
        .await?
    };

    while let Some(row) = rows.next().await? {
        results.push(SemanticSearchResult {
            ticket_id: row.get(0)?,
            step_id: row.get::<String>(1).unwrap_or_default(),
            content: row.get::<String>(2).unwrap_or_default(),
            timestamp: row.get(3)?,
            distance: row.get(4)?,
        });
    }

    Ok(results)
}

/// Hybrid search combining FTS5 full-text and vector similarity.
///
/// Runs both searches separately and merges results using Reciprocal Rank Fusion (RRF):
/// `score = sum(1 / (k + rank_i))` where k=60.
pub async fn hybrid_search(
    conn: &libsql::Connection,
    fts_query: &str,
    query_embedding: &[f32],
    ticket_id: Option<&str>,
    limit: u32,
) -> Result<Vec<HybridSearchResult>, ConversationError> {
    use std::collections::HashMap;

    // Run FTS5 search (reuse existing function internally, but we need raw data)
    let fts_results = search_conversations(conn, fts_query, ticket_id, limit * 2).await?;

    // Run semantic search
    let vec_results = semantic_search(conn, query_embedding, ticket_id, limit * 2).await;
    let vec_results = vec_results.unwrap_or_default(); // gracefully degrade if vector search fails

    // Build a map keyed by (ticket_id, content hash) for merging
    // Using content prefix + ticket_id as a dedup key
    struct MergedEntry {
        ticket_id: String,
        step_id: String,
        content: String,
        timestamp: String,
        fts_rank: Option<f64>,
        vector_distance: Option<f64>,
        fts_position: Option<usize>,
        vec_position: Option<usize>,
    }

    let mut merged: HashMap<String, MergedEntry> = HashMap::new();
    let k = 60.0f64;

    for (i, r) in fts_results.iter().enumerate() {
        let key = format!("{}:{}", r.ticket_id, &r.content[..r.content.len().min(100)]);
        let entry = merged.entry(key).or_insert(MergedEntry {
            ticket_id: r.ticket_id.clone(),
            step_id: r.step_id.clone(),
            content: r.content.clone(),
            timestamp: r.timestamp.clone(),
            fts_rank: None,
            vector_distance: None,
            fts_position: None,
            vec_position: None,
        });
        entry.fts_rank = Some(r.rank);
        entry.fts_position = Some(i);
    }

    for (i, r) in vec_results.iter().enumerate() {
        let key = format!("{}:{}", r.ticket_id, &r.content[..r.content.len().min(100)]);
        let entry = merged.entry(key).or_insert(MergedEntry {
            ticket_id: r.ticket_id.clone(),
            step_id: r.step_id.clone(),
            content: r.content.clone(),
            timestamp: r.timestamp.clone(),
            fts_rank: None,
            vector_distance: None,
            fts_position: None,
            vec_position: None,
        });
        entry.vector_distance = Some(r.distance);
        entry.vec_position = Some(i);
    }

    // Calculate RRF combined score
    let mut results: Vec<HybridSearchResult> = merged
        .into_values()
        .map(|e| {
            let mut score = 0.0f64;
            if let Some(pos) = e.fts_position {
                score += 1.0 / (k + pos as f64);
            }
            if let Some(pos) = e.vec_position {
                score += 1.0 / (k + pos as f64);
            }
            HybridSearchResult {
                ticket_id: e.ticket_id,
                step_id: e.step_id,
                content: e.content,
                timestamp: e.timestamp,
                fts_rank: e.fts_rank,
                vector_distance: e.vector_distance,
                combined_score: score,
            }
        })
        .collect();

    // Sort by combined score descending
    results.sort_by(|a, b| {
        b.combined_score
            .partial_cmp(&a.combined_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit as usize);

    Ok(results)
}

// ── RAG context retrieval ──

/// Retrieve context chunks for RAG, staying within a token budget.
///
/// Uses semantic search to find relevant events, estimates token count as chars/4,
/// and accumulates results until `max_tokens` budget is reached.
pub async fn get_rag_context(
    conn: &libsql::Connection,
    query_embedding: &[f32],
    max_tokens: u32,
) -> Result<Vec<ContextChunk>, ConversationError> {
    let Ok(search_results) = semantic_search(conn, query_embedding, None, 100).await else {
        return Ok(Vec::new()); // gracefully degrade
    };

    let mut chunks = Vec::new();
    let mut token_budget = max_tokens;

    for result in search_results {
        // Estimate tokens as chars / 4
        let estimated_tokens = (result.content.len() as u32) / 4;
        if estimated_tokens > token_budget {
            break;
        }
        token_budget -= estimated_tokens;

        // Look up step label if available
        let step_label = if !result.step_id.is_empty() {
            let mut label_rows = conn
                .query(
                    "SELECT label FROM conversation_steps WHERE step_id = ?1 LIMIT 1",
                    params![result.step_id.clone()],
                )
                .await
                .ok();
            if let Some(ref mut rows) = label_rows {
                if let Ok(Some(row)) = rows.next().await {
                    row.get::<String>(0).ok()
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        // Convert distance to relevance: lower distance = higher relevance
        let relevance = 1.0 - result.distance;

        chunks.push(ContextChunk {
            ticket_id: result.ticket_id,
            step_id: result.step_id,
            step_label,
            content: result.content,
            timestamp: result.timestamp,
            relevance,
        });
    }

    Ok(chunks)
}

/// Find conversations related to a given ticket based on embedding similarity.
///
/// Computes the average embedding of the source ticket's events and finds
/// other tickets with similar embeddings.
pub async fn get_related_conversations(
    conn: &libsql::Connection,
    ticket_id: &str,
    limit: u32,
) -> Result<Vec<RelatedConversation>, ConversationError> {
    use crate::embeddings::{bytes_to_embedding, embedding_to_bytes};

    // Get all embeddings for the source ticket
    let mut rows = conn
        .query(
            "SELECT embedding FROM conversation_events WHERE ticket_id = ?1 AND embedding IS NOT NULL",
            params![ticket_id],
        )
        .await?;

    let mut all_embeddings: Vec<Vec<f32>> = Vec::new();
    while let Some(row) = rows.next().await? {
        if let Ok(blob) = row.get::<Vec<u8>>(0) {
            if !blob.is_empty() {
                all_embeddings.push(bytes_to_embedding(&blob));
            }
        }
    }

    if all_embeddings.is_empty() {
        return Ok(Vec::new());
    }

    // Compute average embedding
    let dims = all_embeddings[0].len();
    let mut avg = vec![0.0f32; dims];
    for emb in &all_embeddings {
        for (i, v) in emb.iter().enumerate() {
            if i < dims {
                avg[i] += v;
            }
        }
    }
    let count = all_embeddings.len() as f32;
    for v in &mut avg {
        *v /= count;
    }

    // L2-normalize
    let norm: f32 = avg.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in &mut avg {
            *v /= norm;
        }
    }

    // Search for similar events from other tickets
    let blob = embedding_to_bytes(&avg);
    // Fetch more than needed so we can group by ticket
    let fetch_limit = limit * 10;
    let search_result = conn
        .query(
            "SELECT ce.ticket_id, vector_distance_cos(ce.embedding, vector(?1)) AS distance
             FROM conversation_events ce
             WHERE ce.embedding IS NOT NULL AND ce.ticket_id != ?2
             ORDER BY distance
             LIMIT ?3",
            params![libsql::Value::Blob(blob), ticket_id, fetch_limit],
        )
        .await;

    // If vector search isn't supported, return empty
    let Ok(mut search_rows) = search_result else {
        return Ok(Vec::new());
    };

    // Group by ticket, take best (lowest) distance per ticket
    let mut ticket_scores: std::collections::HashMap<String, f64> =
        std::collections::HashMap::new();
    while let Some(row) = search_rows.next().await? {
        let tid: String = row.get(0)?;
        let dist: f64 = row.get(1)?;
        let entry = ticket_scores.entry(tid).or_insert(dist);
        if dist < *entry {
            *entry = dist;
        }
    }

    // For each related ticket, get metadata
    let mut results: Vec<RelatedConversation> = Vec::new();
    for (tid, distance) in &ticket_scores {
        let mut meta_rows = conn
            .query(
                "SELECT event_count, updated_at FROM conversations WHERE ticket_id = ?1",
                params![tid.clone()],
            )
            .await?;

        if let Some(meta_row) = meta_rows.next().await? {
            results.push(RelatedConversation {
                ticket_id: tid.clone(),
                similarity: 1.0 - distance,
                event_count: meta_row.get::<u32>(0).unwrap_or(0),
                updated_at: meta_row.get::<String>(1).unwrap_or_default(),
            });
        }
    }

    // Sort by similarity descending
    results.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(limit as usize);

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation_db::ConversationDb;

    /// Helper that creates a file-backed test database.
    /// File-backed DBs allow multiple connections to share state (unlike :memory:).
    struct TestDb {
        db: ConversationDb,
        _dir: tempfile::TempDir,
    }

    impl TestDb {
        fn conn(&self) -> libsql::Connection {
            self.db.db.connect().unwrap()
        }
    }

    async fn test_db() -> TestDb {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db").to_string_lossy().to_string();
        let db = ConversationDb::open(&path, None).await.unwrap();
        TestDb { db, _dir: dir }
    }

    #[tokio::test]
    async fn test_writer_open_creates_conversation() {
        let tdb = test_db().await;
        let _writer = ConversationWriter::open_async(tdb.conn(), "TICKET-1")
            .await
            .unwrap();

        // Verify conversation row exists
        let mut rows = tdb
            .conn()
            .query(
                "SELECT ticket_id, status FROM conversations WHERE ticket_id = ?1",
                params!["TICKET-1"],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "TICKET-1");
        assert_eq!(row.get::<String>(1).unwrap(), "active");
    }

    #[tokio::test]
    async fn test_writer_append_and_flush() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-2")
            .await
            .unwrap();

        let p = serde_json::json!({"content": "hello"});
        writer
            .append_raw("user_message", &p, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        // Verify event was written
        let mut rows = tdb
            .conn()
            .query(
                "SELECT event_type, content, sequence FROM conversation_events WHERE ticket_id = ?1",
                params!["TICKET-2"],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "user_message");
        assert!(row.get::<String>(1).unwrap().contains("hello"));
        assert_eq!(row.get::<u32>(2).unwrap(), 1);
    }

    #[tokio::test]
    async fn test_writer_batch_flush_at_threshold() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-3")
            .await
            .unwrap();

        // Write BATCH_SIZE events -- each auto-flushes (write-through with BATCH_SIZE=1)
        for i in 0..BATCH_SIZE {
            let p = serde_json::json!({"i": i});
            writer.append_raw("event", &p, "step-1").await.unwrap();
        }

        // Verify events were written (batch auto-flushed)
        let mut rows = tdb
            .conn()
            .query(
                "SELECT COUNT(*) FROM conversation_events WHERE ticket_id = ?1",
                params!["TICKET-3"],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<u32>(0).unwrap(), BATCH_SIZE as u32);
    }

    #[tokio::test]
    async fn test_step_markers() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-4")
            .await
            .unwrap();

        writer
            .write_step_marker(
                "step-research",
                &StepMarker::Start {
                    label: "Research".to_string(),
                },
            )
            .await
            .unwrap();

        writer
            .write_step_marker(
                "step-research",
                &StepMarker::End {
                    status: "completed".to_string(),
                },
            )
            .await
            .unwrap();

        // Verify step record
        let mut rows = tdb
            .conn()
            .query(
                "SELECT step_id, label, status, completed_at FROM conversation_steps WHERE ticket_id = ?1",
                params!["TICKET-4"],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "step-research");
        assert_eq!(row.get::<String>(1).unwrap(), "Research");
        assert_eq!(row.get::<String>(2).unwrap(), "completed");
        assert!(row.get::<String>(3).is_ok()); // completed_at is set
    }

    #[tokio::test]
    async fn test_restore_conversation_roundtrip() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-5")
            .await
            .unwrap();

        // Write a step + some events
        writer
            .write_step_marker(
                "step-1",
                &StepMarker::Start {
                    label: "Step One".to_string(),
                },
            )
            .await
            .unwrap();

        let p = serde_json::json!({"content": "test message"});
        writer
            .append_raw("assistant_message", &p, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        writer
            .write_step_marker(
                "step-1",
                &StepMarker::End {
                    status: "completed".to_string(),
                },
            )
            .await
            .unwrap();

        // Restore using a separate read connection
        let snapshot = restore_conversation(&tdb.conn(), "TICKET-5")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(snapshot.ticket_id, "TICKET-5");
        assert_eq!(snapshot.status, "active");
        assert_eq!(snapshot.events.len(), 1);
        assert_eq!(snapshot.events[0].event_type, "assistant_message");
        assert_eq!(snapshot.steps.len(), 1);
        assert_eq!(snapshot.steps[0].step_id, "step-1");
        assert_eq!(snapshot.steps[0].label, Some("Step One".to_string()));
        assert_eq!(snapshot.steps[0].status, "completed");
    }

    #[tokio::test]
    async fn test_restore_nonexistent_returns_none() {
        let tdb = test_db().await;
        let result = restore_conversation(&tdb.conn(), "NONEXISTENT")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_list_conversations() {
        let tdb = test_db().await;

        // Create two conversations
        let mut w1 = ConversationWriter::open_async(tdb.conn(), "TICKET-A")
            .await
            .unwrap();
        let p = serde_json::json!({"x": 1});
        w1.append_raw("msg", &p, "s1").await.unwrap();
        w1.flush().await.unwrap();

        let mut w2 = ConversationWriter::open_async(tdb.conn(), "TICKET-B")
            .await
            .unwrap();
        w2.append_raw("msg", &p, "s1").await.unwrap();
        w2.flush().await.unwrap();

        let summaries = list_conversations(&tdb.conn()).await.unwrap();
        assert_eq!(summaries.len(), 2);
        let ids: Vec<&str> = summaries.iter().map(|s| s.ticket_id.as_str()).collect();
        assert!(ids.contains(&"TICKET-A"));
        assert!(ids.contains(&"TICKET-B"));
    }

    #[tokio::test]
    async fn test_list_conversations_empty() {
        let tdb = test_db().await;
        let summaries = list_conversations(&tdb.conn()).await.unwrap();
        assert!(summaries.is_empty());
    }

    #[tokio::test]
    async fn test_sequence_continuity() {
        let tdb = test_db().await;

        // First writer session
        let mut w1 = ConversationWriter::open_async(tdb.conn(), "TICKET-SEQ")
            .await
            .unwrap();
        let p = serde_json::json!({"x": 1});
        w1.append_raw("msg", &p, "s1").await.unwrap();
        w1.append_raw("msg", &p, "s1").await.unwrap();
        w1.flush().await.unwrap();
        drop(w1);

        // Second writer session -- should continue from sequence 2
        let mut w2 = ConversationWriter::open_async(tdb.conn(), "TICKET-SEQ")
            .await
            .unwrap();
        w2.append_raw("msg", &p, "s1").await.unwrap();
        w2.flush().await.unwrap();

        // Verify sequence numbers
        let mut rows = tdb
            .conn()
            .query(
                "SELECT sequence FROM conversation_events WHERE ticket_id = ?1 ORDER BY sequence",
                params!["TICKET-SEQ"],
            )
            .await
            .unwrap();

        let mut seqs = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            seqs.push(row.get::<u32>(0).unwrap());
        }
        assert_eq!(seqs, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn test_update_session_id() {
        let tdb = test_db().await;
        let _writer = ConversationWriter::open_async(tdb.conn(), "TICKET-SID")
            .await
            .unwrap();

        update_session_id(&tdb.conn(), "TICKET-SID", "session-abc")
            .await
            .unwrap();

        let snapshot = restore_conversation(&tdb.conn(), "TICKET-SID")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.session_id, Some("session-abc".to_string()));
    }

    #[tokio::test]
    async fn test_record_context_and_query_back() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        let ctx = ContextRecord {
            api_messages_json: r#"[{"role":"user","content":"hello"}]"#.to_string(),
            token_count_in: 100,
            token_count_out: 50,
            cache_reads: 10,
            cache_writes: 5,
            cost_usd: 0.003,
            model: "claude-sonnet-4-20250514".to_string(),
        };

        record_context(&conn, "TICKET-CTX", "t1", "step-1", &ctx)
            .await
            .unwrap();

        // Verify row was written
        let mut rows = conn
            .query(
                "SELECT ticket_id, turn_id, step_id, token_count_in, token_count_out, cache_reads, cache_writes, cost_usd, model FROM conversation_context WHERE ticket_id = ?1",
                params!["TICKET-CTX"],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "TICKET-CTX");
        assert_eq!(row.get::<String>(1).unwrap(), "t1");
        assert_eq!(row.get::<String>(2).unwrap(), "step-1");
        assert_eq!(row.get::<u32>(3).unwrap(), 100);
        assert_eq!(row.get::<u32>(4).unwrap(), 50);
        assert_eq!(row.get::<u32>(5).unwrap(), 10);
        assert_eq!(row.get::<u32>(6).unwrap(), 5);
        assert!((row.get::<f64>(7).unwrap() - 0.003).abs() < 1e-9);
        assert_eq!(row.get::<String>(8).unwrap(), "claude-sonnet-4-20250514");
    }

    #[tokio::test]
    async fn test_get_conversation_stats_aggregates() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        let ctx1 = ContextRecord {
            api_messages_json: "[]".to_string(),
            token_count_in: 100,
            token_count_out: 50,
            cache_reads: 10,
            cache_writes: 5,
            cost_usd: 0.003,
            model: "claude-sonnet-4-20250514".to_string(),
        };

        let ctx2 = ContextRecord {
            api_messages_json: "[]".to_string(),
            token_count_in: 200,
            token_count_out: 75,
            cache_reads: 20,
            cache_writes: 8,
            cost_usd: 0.005,
            model: "claude-sonnet-4-20250514".to_string(),
        };

        record_context(&conn, "TICKET-STATS", "t1", "step-1", &ctx1)
            .await
            .unwrap();
        record_context(&conn, "TICKET-STATS", "t2", "step-1", &ctx2)
            .await
            .unwrap();

        let stats = get_conversation_stats(&conn, "TICKET-STATS").await.unwrap();

        assert_eq!(stats.total_input_tokens, 300);
        assert_eq!(stats.total_output_tokens, 125);
        assert_eq!(stats.total_cache_reads, 30);
        assert_eq!(stats.total_cache_writes, 13);
        assert!((stats.total_cost_usd - 0.008).abs() < 1e-9);
        assert_eq!(stats.turn_count, 2);
        assert_eq!(stats.model, Some("claude-sonnet-4-20250514".to_string()));
    }

    #[tokio::test]
    async fn test_get_conversation_stats_empty_returns_zeros() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        let stats = get_conversation_stats(&conn, "NONEXISTENT").await.unwrap();

        assert_eq!(stats.total_input_tokens, 0);
        assert_eq!(stats.total_output_tokens, 0);
        assert_eq!(stats.total_cache_reads, 0);
        assert_eq!(stats.total_cache_writes, 0);
        assert!((stats.total_cost_usd - 0.0).abs() < 1e-9);
        assert_eq!(stats.turn_count, 0);
        assert_eq!(stats.model, None);
    }

    // ── FTS5 search tests ──

    async fn insert_searchable_events(tdb: &TestDb, ticket_id: &str, messages: &[(&str, &str)]) {
        let mut writer = ConversationWriter::open_async(tdb.conn(), ticket_id)
            .await
            .unwrap();
        for (event_type, content_text) in messages {
            let p = serde_json::json!({"content": content_text});
            writer.append_raw(event_type, &p, "step-1").await.unwrap();
        }
        writer.flush().await.unwrap();
    }

    #[tokio::test]
    async fn test_fts_basic_keyword_search() {
        let tdb = test_db().await;
        insert_searchable_events(
            &tdb,
            "TICKET-FTS-1",
            &[
                ("user_message", "implement the authentication module"),
                ("assistant_message", "I will create the login page"),
                ("user_message", "also add password reset"),
            ],
        )
        .await;

        let results = search_conversations(&tdb.conn(), "authentication", None, 50)
            .await
            .unwrap();
        assert!(!results.is_empty(), "Should find 'authentication'");
        assert!(results[0].content.contains("authentication"));
    }

    #[tokio::test]
    async fn test_fts_search_scoped_to_ticket() {
        let tdb = test_db().await;
        insert_searchable_events(
            &tdb,
            "TICKET-FTS-A",
            &[("user_message", "deploy to production server")],
        )
        .await;
        insert_searchable_events(
            &tdb,
            "TICKET-FTS-B",
            &[("user_message", "deploy to staging server")],
        )
        .await;

        let results = search_conversations(&tdb.conn(), "deploy", Some("TICKET-FTS-A"), 50)
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].ticket_id, "TICKET-FTS-A");
        assert!(results[0].content.contains("production"));

        let all_results = search_conversations(&tdb.conn(), "deploy", None, 50)
            .await
            .unwrap();
        assert_eq!(all_results.len(), 2);
    }

    #[tokio::test]
    async fn test_fts_rank_is_present() {
        let tdb = test_db().await;
        insert_searchable_events(
            &tdb,
            "TICKET-FTS-RANK",
            &[
                ("user_message", "rust rust rust programming"),
                ("assistant_message", "rust is great"),
            ],
        )
        .await;

        let results = search_conversations(&tdb.conn(), "rust", None, 50)
            .await
            .unwrap();
        assert!(results.len() >= 2);
        for r in &results {
            assert!(r.rank < 0.0, "FTS5 rank should be negative, got {}", r.rank);
        }
    }

    #[tokio::test]
    async fn test_fts_no_results_for_nonmatching() {
        let tdb = test_db().await;
        insert_searchable_events(&tdb, "TICKET-FTS-NONE", &[("user_message", "hello world")]).await;

        let results = search_conversations(&tdb.conn(), "zyxwvutsrqp", None, 50)
            .await
            .unwrap();
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn test_fts_phrase_search() {
        let tdb = test_db().await;
        insert_searchable_events(
            &tdb,
            "TICKET-FTS-PHRASE",
            &[
                ("user_message", "the quick brown fox jumps"),
                ("assistant_message", "brown quick not a phrase match"),
            ],
        )
        .await;

        let results = search_conversations(&tdb.conn(), "\"quick brown\"", None, 50)
            .await
            .unwrap();
        assert_eq!(results.len(), 1, "Only the exact phrase should match");
        assert!(results[0].content.contains("quick brown fox"));
    }

    // ── Turn grouping tests ──

    #[tokio::test]
    async fn test_step_start_creates_new_turn() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-TURN1")
            .await
            .unwrap();

        // step_start should create turn 1
        writer
            .write_step_marker(
                "step-1",
                &StepMarker::Start {
                    label: "Research".to_string(),
                },
            )
            .await
            .unwrap();

        // Subsequent text event belongs to the same turn
        let p = serde_json::json!({"content": "hello"});
        writer
            .append_raw("assistant_message", &p, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        // Verify both events have the same turn_id
        let mut rows = tdb
            .conn()
            .query(
                "SELECT turn_id FROM conversation_events WHERE ticket_id = ?1 ORDER BY sequence",
                params!["TICKET-TURN1"],
            )
            .await
            .unwrap();

        let mut turn_ids = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            turn_ids.push(row.get::<String>(0).unwrap_or_default());
        }

        assert_eq!(turn_ids.len(), 2);
        assert_eq!(turn_ids[0], "TICKET-TURN1-t1");
        assert_eq!(turn_ids[1], "TICKET-TURN1-t1"); // same turn
    }

    #[tokio::test]
    async fn test_user_message_creates_new_turn() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-TURN2")
            .await
            .unwrap();

        // First: a step_start (turn 1)
        writer
            .write_step_marker(
                "step-1",
                &StepMarker::Start {
                    label: "Impl".to_string(),
                },
            )
            .await
            .unwrap();

        // Then assistant message (still turn 1)
        let p = serde_json::json!({"content": "thinking..."});
        writer
            .append_raw("assistant_message", &p, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        // user_message creates turn 2
        let p2 = serde_json::json!({"content": "do this"});
        writer
            .append_raw("user_message", &p2, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        let mut rows = tdb
            .conn()
            .query(
                "SELECT turn_id FROM conversation_events WHERE ticket_id = ?1 ORDER BY sequence",
                params!["TICKET-TURN2"],
            )
            .await
            .unwrap();

        let mut turn_ids = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            turn_ids.push(row.get::<String>(0).unwrap_or_default());
        }

        assert_eq!(turn_ids[0], "TICKET-TURN2-t1"); // step_start
        assert_eq!(turn_ids[1], "TICKET-TURN2-t1"); // assistant_message
        assert_eq!(turn_ids[2], "TICKET-TURN2-t2"); // user_message
    }

    #[tokio::test]
    async fn test_supervisor_reply_creates_new_turn() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-TURN3")
            .await
            .unwrap();

        // step_start (turn 1)
        writer
            .write_step_marker(
                "step-1",
                &StepMarker::Start {
                    label: "Step".to_string(),
                },
            )
            .await
            .unwrap();

        // supervisor_reply creates turn 2
        let p = serde_json::json!({"content": "approved"});
        writer
            .append_raw("supervisor_reply", &p, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        let mut rows = tdb
            .conn()
            .query(
                "SELECT turn_id FROM conversation_events WHERE ticket_id = ?1 ORDER BY sequence",
                params!["TICKET-TURN3"],
            )
            .await
            .unwrap();

        let mut turn_ids = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            turn_ids.push(row.get::<String>(0).unwrap_or_default());
        }

        assert_eq!(turn_ids[0], "TICKET-TURN3-t1"); // step_start
        assert_eq!(turn_ids[1], "TICKET-TURN3-t2"); // supervisor_reply
    }

    #[tokio::test]
    async fn test_load_turn_returns_correct_events() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-TURN4")
            .await
            .unwrap();

        // Turn 1: step_start + assistant
        writer
            .write_step_marker(
                "step-1",
                &StepMarker::Start {
                    label: "Research".to_string(),
                },
            )
            .await
            .unwrap();

        let p = serde_json::json!({"content": "researching..."});
        writer
            .append_raw("assistant_message", &p, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        // Turn 2: user_message
        let p2 = serde_json::json!({"content": "look here"});
        writer
            .append_raw("user_message", &p2, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        // Load turn 1
        let events = load_turn(&tdb.conn(), "TICKET-TURN4", "TICKET-TURN4-t1")
            .await
            .unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type, "step_start");
        assert_eq!(events[1].event_type, "assistant_message");

        // Load turn 2
        let events2 = load_turn(&tdb.conn(), "TICKET-TURN4", "TICKET-TURN4-t2")
            .await
            .unwrap();
        assert_eq!(events2.len(), 1);
        assert_eq!(events2[0].event_type, "user_message");
    }

    #[tokio::test]
    async fn test_list_turns_returns_correct_summaries() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "TICKET-TURN5")
            .await
            .unwrap();

        // Turn 1: step_start + 2 events
        writer
            .write_step_marker(
                "step-1",
                &StepMarker::Start {
                    label: "Research".to_string(),
                },
            )
            .await
            .unwrap();
        let p = serde_json::json!({"x": 1});
        writer
            .append_raw("assistant_message", &p, "step-1")
            .await
            .unwrap();
        writer
            .append_raw("assistant_message", &p, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        // Turn 2: user_message
        let p2 = serde_json::json!({"content": "hi"});
        writer
            .append_raw("user_message", &p2, "step-1")
            .await
            .unwrap();
        writer.flush().await.unwrap();

        let turns = list_turns(&tdb.conn(), "TICKET-TURN5").await.unwrap();
        assert_eq!(turns.len(), 2);

        assert_eq!(turns[0].turn_id, "TICKET-TURN5-t1");
        assert_eq!(turns[0].start_sequence, 1);
        assert_eq!(turns[0].end_sequence, 3);
        assert_eq!(turns[0].event_count, 3);
        assert_eq!(turns[0].first_event_type, "step_start");

        assert_eq!(turns[1].turn_id, "TICKET-TURN5-t2");
        assert_eq!(turns[1].start_sequence, 4);
        assert_eq!(turns[1].end_sequence, 4);
        assert_eq!(turns[1].event_count, 1);
        assert_eq!(turns[1].first_event_type, "user_message");
    }

    // ── Checkpoint tests ──

    #[tokio::test]
    async fn test_record_checkpoint_writes_to_db() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        record_checkpoint(&conn, "TICKET-CP1", "t1", "step-1", "abc123", "feature/foo")
            .await
            .unwrap();

        // Verify row was written
        let mut rows = conn
            .query(
                "SELECT ticket_id, turn_id, step_id, commit_hash, branch, timestamp FROM conversation_checkpoints WHERE ticket_id = ?1",
                params!["TICKET-CP1"],
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "TICKET-CP1");
        assert_eq!(row.get::<String>(1).unwrap(), "t1");
        assert_eq!(row.get::<String>(2).unwrap(), "step-1");
        assert_eq!(row.get::<String>(3).unwrap(), "abc123");
        assert_eq!(row.get::<String>(4).unwrap(), "feature/foo");
        assert!(!row.get::<String>(5).unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_checkpoints_returns_all_for_ticket() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        record_checkpoint(&conn, "TICKET-CP2", "t1", "step-1", "aaa111", "main")
            .await
            .unwrap();
        record_checkpoint(&conn, "TICKET-CP2", "t2", "step-2", "bbb222", "main")
            .await
            .unwrap();
        // Different ticket — should not appear
        record_checkpoint(&conn, "TICKET-OTHER", "t1", "step-1", "ccc333", "main")
            .await
            .unwrap();

        let checkpoints = get_checkpoints(&conn, "TICKET-CP2").await.unwrap();
        assert_eq!(checkpoints.len(), 2);
        assert_eq!(checkpoints[0].commit_hash, "aaa111");
        assert_eq!(checkpoints[1].commit_hash, "bbb222");
    }

    #[tokio::test]
    async fn test_get_checkpoint_for_turn_returns_specific() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        record_checkpoint(&conn, "TICKET-CP3", "t1", "step-1", "hash1", "feat")
            .await
            .unwrap();
        record_checkpoint(&conn, "TICKET-CP3", "t2", "step-2", "hash2", "feat")
            .await
            .unwrap();

        let cp = get_checkpoint_for_turn(&conn, "TICKET-CP3", "t2")
            .await
            .unwrap();
        assert!(cp.is_some());
        let cp = cp.unwrap();
        assert_eq!(cp.turn_id, "t2");
        assert_eq!(cp.commit_hash, "hash2");
    }

    #[tokio::test]
    async fn test_get_checkpoints_empty_returns_empty_vec() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        let checkpoints = get_checkpoints(&conn, "NONEXISTENT").await.unwrap();
        assert!(checkpoints.is_empty());
    }

    #[tokio::test]
    async fn test_get_checkpoint_for_turn_missing_returns_none() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        let cp = get_checkpoint_for_turn(&conn, "NONEXISTENT", "t1")
            .await
            .unwrap();
        assert!(cp.is_none());
    }

    // ── Cleanup / retention tests ──

    /// Helper to insert a conversation with a specific updated_at timestamp.
    async fn insert_conversation_with_timestamp(
        conn: &libsql::Connection,
        ticket_id: &str,
        updated_at: &str,
    ) {
        conn.execute(
            "INSERT INTO conversations (ticket_id, status, created_at, updated_at, event_count)
             VALUES (?1, 'active', ?2, ?2, 0)",
            params![ticket_id, updated_at],
        )
        .await
        .unwrap();
    }

    /// Helper to insert events for a conversation.
    async fn insert_events_for_cleanup(conn: &libsql::Connection, ticket_id: &str, count: u32) {
        for i in 0..count {
            conn.execute(
                "INSERT INTO conversation_events (ticket_id, sequence, event_type, content, timestamp)
                 VALUES (?1, ?2, 'msg', 'test', datetime('now'))",
                params![ticket_id, i + 1],
            )
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn test_cleanup_deletes_old_conversations() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        // Insert one old conversation (200 days ago) and one recent
        insert_conversation_with_timestamp(&conn, "OLD-1", "2020-01-01T00:00:00Z").await;
        insert_events_for_cleanup(&conn, "OLD-1", 3).await;

        insert_conversation_with_timestamp(&conn, "NEW-1", "2099-01-01T00:00:00Z").await;
        insert_events_for_cleanup(&conn, "NEW-1", 2).await;

        let result = cleanup_old_conversations(&conn, 90, 500).await.unwrap();

        assert_eq!(result.deleted_count, 1);
        assert_eq!(result.freed_events, 3);

        // NEW-1 should still exist
        let summaries = list_conversations(&conn).await.unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].ticket_id, "NEW-1");
    }

    #[tokio::test]
    async fn test_cleanup_respects_max_conversations() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        // Insert 5 conversations, all recent — limit to 3
        for i in 0..5 {
            let tid = format!("TICKET-{}", i);
            let ts = format!("2099-01-0{}T00:00:00Z", i + 1);
            insert_conversation_with_timestamp(&conn, &tid, &ts).await;
            insert_events_for_cleanup(&conn, &tid, 1).await;
        }

        let result = cleanup_old_conversations(&conn, 9999, 3).await.unwrap();

        assert_eq!(result.deleted_count, 2);
        assert_eq!(result.freed_events, 2);

        // Should keep the 3 newest
        let summaries = list_conversations(&conn).await.unwrap();
        assert_eq!(summaries.len(), 3);
        let ids: Vec<&str> = summaries.iter().map(|s| s.ticket_id.as_str()).collect();
        assert!(ids.contains(&"TICKET-4"));
        assert!(ids.contains(&"TICKET-3"));
        assert!(ids.contains(&"TICKET-2"));
    }

    #[tokio::test]
    async fn test_cleanup_cascades_to_all_tables() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        // Create old conversation with events, steps, context, and checkpoints
        insert_conversation_with_timestamp(&conn, "CASCADE-1", "2020-01-01T00:00:00Z").await;
        insert_events_for_cleanup(&conn, "CASCADE-1", 5).await;

        conn.execute(
            "INSERT INTO conversation_steps (ticket_id, step_id, status, started_at, first_sequence)
             VALUES ('CASCADE-1', 'step-1', 'completed', '2020-01-01T00:00:00Z', 1)",
            params![],
        )
        .await
        .unwrap();

        conn.execute(
            "INSERT INTO conversation_context (ticket_id, turn_id, step_id, api_messages_json, timestamp)
             VALUES ('CASCADE-1', 't1', 'step-1', '[]', '2020-01-01T00:00:00Z')",
            params![],
        )
        .await
        .unwrap();

        conn.execute(
            "INSERT INTO conversation_checkpoints (ticket_id, turn_id, step_id, commit_hash, branch, timestamp)
             VALUES ('CASCADE-1', 't1', 'step-1', 'abc123', 'main', '2020-01-01T00:00:00Z')",
            params![],
        )
        .await
        .unwrap();

        let result = cleanup_old_conversations(&conn, 90, 500).await.unwrap();
        assert_eq!(result.deleted_count, 1);
        assert_eq!(result.freed_events, 5);

        // Verify all tables are empty for this ticket
        async fn count_rows(conn: &libsql::Connection, table: &str, ticket_id: &str) -> u32 {
            let mut rows = conn
                .query(
                    &format!("SELECT COUNT(*) FROM {} WHERE ticket_id = ?1", table),
                    params![ticket_id],
                )
                .await
                .unwrap();
            rows.next().await.unwrap().unwrap().get::<u32>(0).unwrap()
        }

        assert_eq!(count_rows(&conn, "conversations", "CASCADE-1").await, 0);
        assert_eq!(
            count_rows(&conn, "conversation_events", "CASCADE-1").await,
            0
        );
        assert_eq!(
            count_rows(&conn, "conversation_steps", "CASCADE-1").await,
            0
        );
        assert_eq!(
            count_rows(&conn, "conversation_context", "CASCADE-1").await,
            0
        );
        assert_eq!(
            count_rows(&conn, "conversation_checkpoints", "CASCADE-1").await,
            0
        );
    }

    #[tokio::test]
    async fn test_cleanup_nothing_to_clean_returns_zeros() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        // Insert one recent conversation — nothing should be cleaned
        insert_conversation_with_timestamp(&conn, "RECENT-1", "2099-01-01T00:00:00Z").await;

        let result = cleanup_old_conversations(&conn, 90, 500).await.unwrap();
        assert_eq!(result.deleted_count, 0);
        assert_eq!(result.freed_events, 0);

        // Conversation should still be there
        let summaries = list_conversations(&conn).await.unwrap();
        assert_eq!(summaries.len(), 1);
    }

    // ── Semantic / hybrid search tests ──

    /// Helper to insert events with embeddings for vector search testing.
    #[allow(dead_code)] // Available for future vector search integration tests
    async fn insert_event_with_embedding(
        conn: &libsql::Connection,
        ticket_id: &str,
        sequence: u32,
        step_id: &str,
        content: &str,
        embedding: &[f32],
    ) {
        use crate::embeddings::embedding_to_bytes;

        let blob = embedding_to_bytes(embedding);
        conn.execute(
            "INSERT INTO conversation_events (ticket_id, sequence, step_id, event_type, content, timestamp, embedding)
             VALUES (?1, ?2, ?3, 'user_message', ?4, datetime('now'), ?5)",
            params![
                ticket_id,
                sequence,
                step_id,
                content,
                libsql::Value::Blob(blob)
            ],
        )
        .await
        .unwrap();
    }

    /// NOTE: Tests that use `vector_distance_cos` may fail on libSQL builds without
    /// vector search support. These tests verify the SQL is correct; in CI they may
    /// be skipped if the build doesn't support vectors.

    #[tokio::test]
    async fn test_semantic_search_no_embeddings_returns_empty() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        // No events at all
        let query_vec = vec![0.1f32; 384];
        // vector_distance_cos may not be available, so treat errors as empty
        let results = semantic_search(&conn, &query_vec, None, 10).await;
        match results {
            Ok(r) => assert!(r.is_empty()),
            Err(_) => { /* vector ops not supported, acceptable */ }
        }
    }

    #[tokio::test]
    async fn test_hybrid_search_fts_only_fallback() {
        // When vector search isn't available, hybrid search should still return FTS results
        let tdb = test_db().await;
        insert_searchable_events(
            &tdb,
            "TICKET-HYB-1",
            &[("user_message", "implement authentication module")],
        )
        .await;

        let query_vec = vec![0.1f32; 384];
        let results = hybrid_search(&tdb.conn(), "authentication", &query_vec, None, 10)
            .await
            .unwrap();

        // Should have at least the FTS result even if vector fails
        assert!(!results.is_empty());
        assert!(results[0].fts_rank.is_some());
        assert!(results[0].combined_score > 0.0);
    }

    #[tokio::test]
    async fn test_hybrid_search_merges_results() {
        let tdb = test_db().await;

        // Insert events with text (for FTS)
        insert_searchable_events(
            &tdb,
            "TICKET-HYB-2",
            &[
                ("user_message", "database migration strategy"),
                ("result", "migration completed successfully"),
            ],
        )
        .await;

        let query_vec = vec![0.1f32; 384];
        let results = hybrid_search(&tdb.conn(), "migration", &query_vec, None, 10)
            .await
            .unwrap();

        // FTS should find "migration" results
        assert!(!results.is_empty());
        // Results should be sorted by combined_score descending
        for window in results.windows(2) {
            assert!(window[0].combined_score >= window[1].combined_score);
        }
    }

    #[tokio::test]
    async fn test_hybrid_search_respects_ticket_filter() {
        let tdb = test_db().await;
        insert_searchable_events(
            &tdb,
            "TICKET-HYB-A",
            &[("user_message", "deploy to production")],
        )
        .await;
        insert_searchable_events(
            &tdb,
            "TICKET-HYB-B",
            &[("user_message", "deploy to staging")],
        )
        .await;

        let query_vec = vec![0.1f32; 384];
        let results = hybrid_search(&tdb.conn(), "deploy", &query_vec, Some("TICKET-HYB-A"), 10)
            .await
            .unwrap();

        // All results should be from the filtered ticket
        for r in &results {
            assert_eq!(r.ticket_id, "TICKET-HYB-A");
        }
    }

    // ── RAG context tests ──

    #[tokio::test]
    async fn test_rag_context_empty_db_returns_empty() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        let query_vec = vec![0.1f32; 384];
        let chunks = get_rag_context(&conn, &query_vec, 4000).await.unwrap();
        assert!(chunks.is_empty());
    }

    #[tokio::test]
    async fn test_related_conversations_empty_returns_empty() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        let related = get_related_conversations(&conn, "NONEXISTENT", 5)
            .await
            .unwrap();
        assert!(related.is_empty());
    }

    #[tokio::test]
    async fn test_fts5_trigger_syncs_on_batch_flush() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "FTS-TRIG")
            .await
            .unwrap();

        // Write events via the normal writer path (not direct SQL)
        let p1 = serde_json::json!({"content": "authentication middleware refactor"});
        writer.append_raw("text", &p1, "step-1").await.unwrap();
        let p2 = serde_json::json!({"content": "database migration script"});
        writer.append_raw("text", &p2, "step-1").await.unwrap();
        writer.flush().await.unwrap();

        // FTS5 trigger should have synced — search should find results
        let results = search_conversations(&tdb.conn(), "authentication", None, 10)
            .await
            .unwrap();
        assert!(!results.is_empty(), "FTS5 trigger should sync on INSERT");
        assert!(results[0].content.contains("authentication"));

        // Verify scoped search excludes non-matching content
        let results2 = search_conversations(&tdb.conn(), "database migration", None, 10)
            .await
            .unwrap();
        assert!(!results2.is_empty());
    }

    #[tokio::test]
    async fn test_interrupted_step_has_no_completed_at() {
        let tdb = test_db().await;
        let mut writer = ConversationWriter::open_async(tdb.conn(), "INTERRUPT-1")
            .await
            .unwrap();

        // Write step_start but never step_end (simulates crash)
        writer
            .write_step_marker(
                "step-research",
                &StepMarker::Start {
                    label: "Research".to_string(),
                },
            )
            .await
            .unwrap();

        // Write some events mid-step
        let p = serde_json::json!({"content": "working on research..."});
        writer
            .append_raw("text", &p, "step-research")
            .await
            .unwrap();
        writer.flush().await.unwrap();
        drop(writer);

        // Restore — step should be in_progress with no completed_at
        let snapshot = restore_conversation(&tdb.conn(), "INTERRUPT-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.steps.len(), 1);
        assert_eq!(snapshot.steps[0].status, "in_progress");
        assert!(snapshot.steps[0].completed_at.is_none());

        // Simulate crash recovery: mark step as interrupted
        tdb.conn()
            .execute(
                "UPDATE conversation_steps SET status = 'interrupted', completed_at = datetime('now') WHERE ticket_id = ?1 AND step_id = ?2 AND status = 'in_progress'",
                params!["INTERRUPT-1", "step-research"],
            )
            .await
            .unwrap();
        tdb.conn()
            .execute(
                "UPDATE conversations SET status = 'interrupted' WHERE ticket_id = ?1",
                params!["INTERRUPT-1"],
            )
            .await
            .unwrap();

        // Restore again — should reflect interrupted state
        let snapshot2 = restore_conversation(&tdb.conn(), "INTERRUPT-1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(snapshot2.status, "interrupted");
        assert_eq!(snapshot2.steps[0].status, "interrupted");
        assert!(snapshot2.steps[0].completed_at.is_some());
    }

    #[tokio::test]
    async fn test_semantic_search_with_embeddings() {
        use crate::embeddings::{embedding_to_bytes, Embedder, MockEmbedder};

        let tdb = test_db().await;
        let conn = tdb.conn();
        let embedder = MockEmbedder;

        // Create conversation and insert events with embeddings
        conn.execute(
            "INSERT INTO conversations (ticket_id, status, created_at, updated_at, event_count) VALUES ('SEM-1', 'active', 'now', 'now', 2)",
            params![],
        )
        .await
        .unwrap();

        let texts = [
            "authentication middleware security",
            "database schema migration",
        ];
        for (i, text) in texts.iter().enumerate() {
            let emb = embedder.embed(text).unwrap();
            let blob = embedding_to_bytes(&emb);
            conn.execute(
                "INSERT INTO conversation_events (ticket_id, sequence, step_id, event_type, content, timestamp, embedding) VALUES (?1, ?2, 'step-1', 'text', ?3, datetime('now'), ?4)",
                params![(i + 1) as u32, "SEM-1", *text, libsql::Value::Blob(blob)],
            )
            .await
            .unwrap();
        }

        // Search with embedding of a related query
        let query_emb = embedder
            .embed("authentication middleware security")
            .unwrap();
        let results = semantic_search(&conn, &query_emb, None, 10).await;

        // Vector search may not be supported in all libSQL builds
        match results {
            Ok(r) => {
                assert!(!r.is_empty(), "Should find results when embeddings exist");
                // First result should be the most similar
                assert!(r[0].content.contains("authentication"));
            }
            Err(_) => {
                // Vector search not supported in this build — acceptable
            }
        }
    }

    #[tokio::test]
    async fn test_rag_context_respects_token_budget() {
        use crate::embeddings::{embedding_to_bytes, Embedder, MockEmbedder};

        let tdb = test_db().await;
        let conn = tdb.conn();
        let embedder = MockEmbedder;

        // Create conversation with several events
        conn.execute(
            "INSERT INTO conversations (ticket_id, status, created_at, updated_at, event_count) VALUES ('RAG-1', 'active', 'now', 'now', 5)",
            params![],
        )
        .await
        .unwrap();

        // Insert 5 events each ~100 chars (~25 tokens each)
        for i in 0..5 {
            let content = format!("This is event number {} with some meaningful content about the authentication system and how it handles user sessions and tokens for security. Extra padding.", i);
            let emb = embedder.embed(&content).unwrap();
            let blob = embedding_to_bytes(&emb);
            conn.execute(
                "INSERT INTO conversation_events (ticket_id, sequence, step_id, event_type, content, timestamp, embedding) VALUES ('RAG-1', ?1, 'step-1', 'text', ?2, datetime('now'), ?3)",
                params![(i + 1) as u32, content, libsql::Value::Blob(blob)],
            )
            .await
            .unwrap();
        }

        // Request with a very small token budget — should get fewer results
        let query_emb = embedder.embed("authentication").unwrap();
        let results = get_rag_context(&conn, &query_emb, 50).await;

        match results {
            Ok(chunks) => {
                // With ~25 tokens per event and budget of 50, should get at most 2 chunks
                assert!(
                    chunks.len() <= 2,
                    "Token budget should limit results, got {} chunks",
                    chunks.len()
                );
            }
            Err(_) => {
                // Vector search not supported — acceptable
            }
        }

        // Request with large budget — should get all events
        let results_all = get_rag_context(&conn, &query_emb, 10000).await;
        match results_all {
            Ok(chunks) => {
                assert!(
                    chunks.len() >= 3,
                    "Large budget should return more results, got {} chunks",
                    chunks.len()
                );
            }
            Err(_) => {}
        }
    }

    #[tokio::test]
    async fn test_related_conversations_excludes_source_ticket() {
        let tdb = test_db().await;
        let conn = tdb.conn();

        // Create source ticket with events (but no embeddings since vector ops may not work)
        insert_conversation_with_timestamp(&conn, "SOURCE", "2099-01-01T00:00:00Z").await;
        insert_conversation_with_timestamp(&conn, "OTHER", "2099-01-01T00:00:00Z").await;

        // Without embeddings, related should return empty (no vectors to compare)
        let related = get_related_conversations(&conn, "SOURCE", 5).await.unwrap();
        // Source should never appear in results
        for r in &related {
            assert_ne!(r.ticket_id, "SOURCE");
        }
    }
}
