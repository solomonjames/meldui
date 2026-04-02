CREATE TABLE IF NOT EXISTS conversations (
    ticket_id TEXT PRIMARY KEY,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    last_step_id TEXT
);

CREATE TABLE IF NOT EXISTS conversation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    turn_id TEXT,
    step_id TEXT,
    event_type TEXT NOT NULL,
    role TEXT,
    content TEXT,
    timestamp TEXT NOT NULL,
    embedding BLOB
);

CREATE TABLE IF NOT EXISTS conversation_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    step_id TEXT NOT NULL UNIQUE,
    label TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    first_sequence INTEGER NOT NULL,
    last_sequence INTEGER
);

CREATE TABLE IF NOT EXISTS conversation_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    turn_id TEXT,
    step_id TEXT,
    api_messages_json TEXT,
    token_count_in INTEGER NOT NULL DEFAULT 0,
    token_count_out INTEGER NOT NULL DEFAULT 0,
    cache_reads INTEGER NOT NULL DEFAULT 0,
    cache_writes INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    model TEXT,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    turn_id TEXT,
    step_id TEXT,
    commit_hash TEXT,
    branch TEXT,
    timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_ticket_sequence
    ON conversation_events (ticket_id, sequence);

CREATE INDEX IF NOT EXISTS idx_events_ticket_step
    ON conversation_events (ticket_id, step_id);

CREATE INDEX IF NOT EXISTS idx_events_ticket_turn
    ON conversation_events (ticket_id, turn_id);

CREATE INDEX IF NOT EXISTS idx_events_ticket_type
    ON conversation_events (ticket_id, event_type);

CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
    ticket_id,
    content,
    content='conversation_events',
    content_rowid='id',
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS conversation_events_ai AFTER INSERT ON conversation_events BEGIN
    INSERT INTO conversation_search(rowid, ticket_id, content) VALUES (new.id, new.ticket_id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS conversation_events_ad AFTER DELETE ON conversation_events BEGIN
    INSERT INTO conversation_search(conversation_search, rowid, ticket_id, content) VALUES('delete', old.id, old.ticket_id, old.content);
END;
