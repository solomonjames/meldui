//! Conversation persistence using NDJSON event logs.
//!
//! Each conversation is stored as a series of NDJSON events in `.meldui/conversations/`.
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use crate::constants::{CONVERSATIONS_DIR, MELDUI_DIR};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SCHEMA_VERSION: u32 = 1;

/// Structured error type for conversation operations.
#[derive(Debug, Error)]
#[allow(clippy::enum_variant_names, dead_code)]
pub(crate) enum ConversationError {
    #[error("failed to read conversation")]
    ReadFailed(#[source] std::io::Error),

    #[error("failed to write conversation")]
    WriteFailed(#[source] std::io::Error),

    #[error("failed to parse conversation")]
    ParseFailed(#[source] serde_json::Error),

    #[error("failed to serialize conversation")]
    SerializeFailed(#[source] serde_json::Error),

    #[error("failed to create conversations directory")]
    DirCreateFailed(#[source] std::io::Error),

    #[error("conversation not found")]
    NotFound,
}

// ── NDJSON line format ──

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConversationEvent {
    pub timestamp: String,
    pub sequence: u32,
    pub step_id: String,
    pub event_type: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "marker_type")]
pub enum StepMarker {
    #[serde(rename = "start")]
    Start { label: String },
    #[serde(rename = "end")]
    End { status: String },
}

// ── Snapshot format ──

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
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

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
pub struct ConversationEventRecord {
    pub timestamp: String,
    pub sequence: u32,
    pub step_id: String,
    pub event_type: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
pub struct ConversationStepRecord {
    pub step_id: String,
    pub label: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: String,
    pub first_sequence: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
pub struct ConversationSummary {
    pub ticket_id: String,
    pub status: String,
    pub event_count: u32,
    pub updated_at: String,
}

// ── Writer ──

pub struct ConversationWriter {
    file: fs::File,
    sequence: u32,
}

fn conversations_dir(project_dir: &str) -> PathBuf {
    PathBuf::from(project_dir)
        .join(MELDUI_DIR)
        .join(CONVERSATIONS_DIR)
}

fn ndjson_path(project_dir: &str, ticket_id: &str) -> PathBuf {
    conversations_dir(project_dir).join(format!("{ticket_id}.ndjson"))
}

fn snapshot_path(project_dir: &str, ticket_id: &str) -> PathBuf {
    conversations_dir(project_dir).join(format!("{ticket_id}.snapshot.json"))
}

impl ConversationWriter {
    fn open_inner(project_dir: &str, ticket_id: &str) -> Result<Self, ConversationError> {
        let dir = conversations_dir(project_dir);
        fs::create_dir_all(&dir).map_err(ConversationError::DirCreateFailed)?;

        let path = ndjson_path(project_dir, ticket_id);

        let last_seq = if path.exists() {
            let file = fs::File::open(&path).map_err(ConversationError::ReadFailed)?;
            let reader = BufReader::new(file);
            let mut max_seq: u32 = 0;
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(event) = serde_json::from_str::<ConversationEvent>(&line) {
                    max_seq = max_seq.max(event.sequence);
                }
            }
            max_seq
        } else {
            0
        };

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(ConversationError::WriteFailed)?;

        Ok(Self {
            file,
            sequence: last_seq,
        })
    }

    pub fn open(project_dir: &str, ticket_id: &str) -> Result<Self, String> {
        Self::open_inner(project_dir, ticket_id).map_err(|e| e.to_string())
    }

    fn append_raw_inner(
        &mut self,
        msg_type: &str,
        params: &serde_json::Value,
        step_id: &str,
    ) -> Result<(), ConversationError> {
        self.sequence += 1;
        let event = ConversationEvent {
            timestamp: Utc::now().to_rfc3339(),
            sequence: self.sequence,
            step_id: step_id.to_string(),
            event_type: msg_type.to_string(),
            content: serde_json::to_string(params).unwrap_or_default(),
        };
        let mut line = serde_json::to_string(&event).map_err(ConversationError::SerializeFailed)?;
        line.push('\n');
        self.file
            .write_all(line.as_bytes())
            .map_err(ConversationError::WriteFailed)?;
        Ok(())
    }

    pub fn append_raw(
        &mut self,
        msg_type: &str,
        params: &serde_json::Value,
        step_id: &str,
    ) -> Result<(), String> {
        self.append_raw_inner(msg_type, params, step_id)
            .map_err(|e| e.to_string())
    }

    fn write_step_marker_inner(
        &mut self,
        step_id: &str,
        marker: &StepMarker,
    ) -> Result<(), ConversationError> {
        self.sequence += 1;
        let (event_type, content) = match marker {
            StepMarker::Start { label } => (
                "step_start".to_string(),
                serde_json::json!({ "step_label": label }).to_string(),
            ),
            StepMarker::End { status } => (
                "step_end".to_string(),
                serde_json::json!({ "status": status }).to_string(),
            ),
        };
        let event = ConversationEvent {
            timestamp: Utc::now().to_rfc3339(),
            sequence: self.sequence,
            step_id: step_id.to_string(),
            event_type,
            content,
        };
        let mut line = serde_json::to_string(&event).map_err(ConversationError::SerializeFailed)?;
        line.push('\n');
        self.file
            .write_all(line.as_bytes())
            .map_err(ConversationError::WriteFailed)?;
        Ok(())
    }

    pub fn write_step_marker(&mut self, step_id: &str, marker: &StepMarker) -> Result<(), String> {
        self.write_step_marker_inner(step_id, marker)
            .map_err(|e| e.to_string())
    }

    fn flush_inner(&mut self) -> Result<(), ConversationError> {
        self.file.flush().map_err(ConversationError::WriteFailed)
    }

    pub fn flush(&mut self) -> Result<(), String> {
        self.flush_inner().map_err(|e| e.to_string())
    }
}

// ── Reading ──

fn replay_ndjson(
    project_dir: &str,
    ticket_id: &str,
) -> Result<Option<ConversationSnapshot>, ConversationError> {
    let path = ndjson_path(project_dir, ticket_id);
    if !path.exists() {
        return Ok(None);
    }

    let file = fs::File::open(&path).map_err(ConversationError::ReadFailed)?;
    let reader = BufReader::new(file);

    let mut events: Vec<ConversationEventRecord> = Vec::new();
    let mut steps: Vec<ConversationStepRecord> = Vec::new();
    let mut first_timestamp: Option<String> = None;
    let mut last_timestamp = String::new();
    let mut status = "active".to_string();

    for line in reader.lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            _ => continue,
        };
        let event: ConversationEvent = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        if first_timestamp.is_none() {
            first_timestamp = Some(event.timestamp.clone());
        }
        last_timestamp = event.timestamp.clone();

        match event.event_type.as_str() {
            "step_start" => {
                let label = serde_json::from_str::<serde_json::Value>(&event.content)
                    .ok()
                    .and_then(|v| {
                        v.get("step_label")
                            .and_then(|l| l.as_str())
                            .map(String::from)
                    });
                steps.push(ConversationStepRecord {
                    step_id: event.step_id.clone(),
                    label,
                    started_at: event.timestamp.clone(),
                    completed_at: None,
                    status: "in_progress".to_string(),
                    first_sequence: event.sequence,
                });
            }
            "step_end" => {
                let end_status = serde_json::from_str::<serde_json::Value>(&event.content)
                    .ok()
                    .and_then(|v| v.get("status").and_then(|s| s.as_str()).map(String::from))
                    .unwrap_or_else(|| "completed".to_string());
                if let Some(step) = steps.iter_mut().rev().find(|s| s.step_id == event.step_id) {
                    step.completed_at = Some(event.timestamp.clone());
                    step.status = end_status;
                }
            }
            _ => {
                events.push(ConversationEventRecord {
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    step_id: event.step_id,
                    event_type: event.event_type,
                    content: event.content,
                });
            }
        }
    }

    if let Some(last_step) = steps.last() {
        if last_step.completed_at.is_none() {
            status = "interrupted".to_string();
        }
    }

    let event_count = events.len() as u32;

    Ok(Some(ConversationSnapshot {
        schema_version: SCHEMA_VERSION,
        ticket_id: ticket_id.to_string(),
        session_id: None,
        created_at: first_timestamp.unwrap_or_default(),
        updated_at: last_timestamp,
        status,
        events,
        steps,
        event_count,
    }))
}

fn snapshot_conversation_inner(
    project_dir: &str,
    ticket_id: &str,
    session_id: Option<&str>,
) -> Result<(), ConversationError> {
    let Some(mut snapshot) = replay_ndjson(project_dir, ticket_id)? else {
        return Ok(());
    };
    snapshot.session_id = session_id.map(String::from);

    let path = snapshot_path(project_dir, ticket_id);
    let json =
        serde_json::to_string_pretty(&snapshot).map_err(ConversationError::SerializeFailed)?;
    fs::write(&path, json).map_err(ConversationError::WriteFailed)?;
    Ok(())
}

pub fn snapshot_conversation(
    project_dir: &str,
    ticket_id: &str,
    session_id: Option<&str>,
) -> Result<(), String> {
    snapshot_conversation_inner(project_dir, ticket_id, session_id).map_err(|e| e.to_string())
}

fn restore_conversation_inner(
    project_dir: &str,
    ticket_id: &str,
) -> Result<Option<ConversationSnapshot>, ConversationError> {
    let snap_path = snapshot_path(project_dir, ticket_id);
    if snap_path.exists() {
        let content = fs::read_to_string(&snap_path).map_err(ConversationError::ReadFailed)?;
        match serde_json::from_str::<ConversationSnapshot>(&content) {
            Ok(snapshot) if snapshot.schema_version <= SCHEMA_VERSION => {
                return Ok(Some(snapshot));
            }
            Ok(_) => {
                log::warn!("conversation: snapshot has newer schema version, replaying NDJSON");
            }
            Err(e) => {
                log::warn!("conversation: corrupt snapshot ({e}), replaying NDJSON");
                let _ = fs::remove_file(&snap_path);
            }
        }
    }
    replay_ndjson(project_dir, ticket_id)
}

pub fn restore_conversation(
    project_dir: &str,
    ticket_id: &str,
) -> Result<Option<ConversationSnapshot>, String> {
    restore_conversation_inner(project_dir, ticket_id).map_err(|e| e.to_string())
}

fn list_conversations_inner(
    project_dir: &str,
) -> Result<Vec<ConversationSummary>, ConversationError> {
    let dir = conversations_dir(project_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut summaries = Vec::new();
    let entries = fs::read_dir(&dir).map_err(ConversationError::ReadFailed)?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("ndjson") {
            continue;
        }
        let ticket_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if ticket_id.is_empty() {
            continue;
        }

        let snap = snapshot_path(project_dir, &ticket_id);
        if snap.exists() {
            if let Ok(content) = fs::read_to_string(&snap) {
                if let Ok(s) = serde_json::from_str::<ConversationSnapshot>(&content) {
                    summaries.push(ConversationSummary {
                        ticket_id,
                        status: s.status,
                        event_count: s.event_count,
                        updated_at: s.updated_at,
                    });
                    continue;
                }
            }
        }

        let file = fs::File::open(&path).ok();
        let count = file
            .map(|f| BufReader::new(f).lines().map_while(Result::ok).count() as u32)
            .unwrap_or(0);

        let metadata = fs::metadata(&path).ok();
        let updated = metadata
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
            .unwrap_or_default();

        summaries.push(ConversationSummary {
            ticket_id,
            status: "unknown".to_string(),
            event_count: count,
            updated_at: updated,
        });
    }

    Ok(summaries)
}

pub fn list_conversations(project_dir: &str) -> Result<Vec<ConversationSummary>, String> {
    list_conversations_inner(project_dir).map_err(|e| e.to_string())
}
