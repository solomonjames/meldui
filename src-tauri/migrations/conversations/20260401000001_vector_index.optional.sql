CREATE INDEX IF NOT EXISTS idx_events_vector ON conversation_events (
    libsql_vector_idx(embedding, 'metric=cosine', 'compress_neighbors=float8', 'max_neighbors=64')
);
