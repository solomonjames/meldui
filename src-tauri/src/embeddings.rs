//! Embedding pipeline for vector search.
//!
//! Provides a trait-based abstraction for text embeddings, with a mock
//! implementation for tests and a placeholder for ONNX Runtime integration.

use libsql::params;

/// Trait for generating text embeddings.
///
/// Implementations must be `Send + Sync` so they can be shared across threads.
/// Methods are synchronous because embedding is CPU-bound.
pub(crate) trait Embedder: Send + Sync {
    /// Generate an embedding vector for the given text.
    fn embed(&self, text: &str) -> Result<Vec<f32>, String>;

    /// The number of dimensions in the output embedding vectors.
    fn dimensions(&self) -> usize;
}

/// Mock embedder for tests. Returns deterministic 384-dim vectors based on text hash.
#[derive(Debug)]
pub(crate) struct MockEmbedder;

impl Embedder for MockEmbedder {
    fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let dims = self.dimensions();
        let mut vec = vec![0.0f32; dims];

        // Simple deterministic hash: use bytes of the text to fill the vector
        let bytes = text.as_bytes();
        for (i, slot) in vec.iter_mut().enumerate() {
            if !bytes.is_empty() {
                let byte = bytes[i % bytes.len()];
                // Normalize to [-1, 1] range
                *slot = (byte as f32 / 127.5) - 1.0;
            }
        }

        // L2-normalize the vector for cosine similarity
        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for v in &mut vec {
                *v /= norm;
            }
        }

        Ok(vec)
    }

    fn dimensions(&self) -> usize {
        384
    }
}

/// Placeholder for ONNX Runtime-based local embedder.
///
/// The actual implementation will use the `ort` crate behind the `embeddings`
/// feature flag. For now, it returns an error.
#[allow(dead_code)]
#[derive(Debug)]
pub(crate) struct LocalEmbedder;

#[allow(dead_code)]
impl LocalEmbedder {
    /// Create a new local embedder.
    ///
    /// Currently returns an error because ONNX model loading is not yet implemented.
    pub(crate) fn new() -> Result<Self, String> {
        Err("ONNX embeddings not yet implemented — enable the 'embeddings' feature and provide a model file".to_string())
    }
}

#[allow(dead_code)]
impl Embedder for LocalEmbedder {
    fn embed(&self, _text: &str) -> Result<Vec<f32>, String> {
        Err("ONNX embeddings not yet implemented".to_string())
    }

    fn dimensions(&self) -> usize {
        384
    }
}

/// Convert a `Vec<f32>` embedding to raw bytes for storage as a BLOB.
pub(crate) fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(embedding.len() * 4);
    for &val in embedding {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    bytes
}

/// Convert raw bytes from a BLOB back to a `Vec<f32>` embedding.
#[allow(dead_code)]
pub(crate) fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Embed recent events that have NULL embeddings.
///
/// Processes up to 50 events per call. Returns the number of events embedded.
#[allow(dead_code)] // Called as background job — not yet wired into app lifecycle
pub(crate) async fn embed_recent_events(
    conn: &libsql::Connection,
    embedder: &dyn Embedder,
) -> Result<u32, String> {
    let mut rows = conn
        .query(
            "SELECT id, content FROM conversation_events WHERE embedding IS NULL AND event_type IN ('text', 'user_message', 'result') ORDER BY id DESC LIMIT 50",
            params![],
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut events: Vec<(i64, String)> = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let content: String = row.get::<String>(1).unwrap_or_default();
        events.push((id, content));
    }

    let mut count = 0u32;
    for (id, content) in &events {
        if content.is_empty() {
            continue;
        }
        let embedding = embedder.embed(content)?;
        let blob = embedding_to_bytes(&embedding);
        conn.execute(
            "UPDATE conversation_events SET embedding = ?1 WHERE id = ?2",
            params![libsql::Value::Blob(blob), *id],
        )
        .await
        .map_err(|e| e.to_string())?;
        count += 1;
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conversation_db::ConversationDb;

    #[test]
    fn test_mock_embedder_produces_384_dim_vectors() {
        let embedder = MockEmbedder;
        let vec = embedder.embed("hello world").unwrap();
        assert_eq!(vec.len(), 384);
        assert_eq!(embedder.dimensions(), 384);
    }

    #[test]
    fn test_mock_embedder_deterministic() {
        let embedder = MockEmbedder;
        let v1 = embedder.embed("test input").unwrap();
        let v2 = embedder.embed("test input").unwrap();
        assert_eq!(v1, v2);
    }

    #[test]
    fn test_mock_embedder_different_texts_differ() {
        let embedder = MockEmbedder;
        let v1 = embedder.embed("hello").unwrap();
        let v2 = embedder.embed("world").unwrap();
        assert_ne!(v1, v2);
    }

    #[test]
    fn test_mock_embedder_is_normalized() {
        let embedder = MockEmbedder;
        let vec = embedder.embed("normalize me").unwrap();
        let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!(
            (norm - 1.0).abs() < 0.01,
            "Vector should be L2-normalized, got norm={norm}"
        );
    }

    #[test]
    fn test_embedding_bytes_roundtrip() {
        let original = vec![1.0f32, -0.5, 0.0, 3.14];
        let bytes = embedding_to_bytes(&original);
        let restored = bytes_to_embedding(&bytes);
        assert_eq!(original, restored);
    }

    #[test]
    fn test_local_embedder_returns_error() {
        let result = LocalEmbedder::new();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ONNX"));
    }

    #[tokio::test]
    async fn test_embed_recent_events_updates_null_embeddings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db").to_string_lossy().to_string();
        let db = ConversationDb::open(&path, None).await.unwrap();
        let conn = db.db.connect().unwrap();

        // Insert events with NULL embeddings
        conn.execute(
            "INSERT INTO conversations (ticket_id, status, created_at, updated_at, event_count) VALUES ('T1', 'active', 'now', 'now', 0)",
            params![],
        )
        .await
        .unwrap();

        conn.execute(
            "INSERT INTO conversation_events (ticket_id, sequence, event_type, content, timestamp) VALUES ('T1', 1, 'user_message', 'hello world', 'now')",
            params![],
        )
        .await
        .unwrap();

        conn.execute(
            "INSERT INTO conversation_events (ticket_id, sequence, event_type, content, timestamp) VALUES ('T1', 2, 'result', 'the result is 42', 'now')",
            params![],
        )
        .await
        .unwrap();

        // This one should NOT be embedded (wrong event_type)
        conn.execute(
            "INSERT INTO conversation_events (ticket_id, sequence, event_type, content, timestamp) VALUES ('T1', 3, 'step_start', 'step marker', 'now')",
            params![],
        )
        .await
        .unwrap();

        let embedder = MockEmbedder;
        let count = embed_recent_events(&conn, &embedder).await.unwrap();
        assert_eq!(count, 2);

        // Verify embeddings were set
        let mut rows = conn
            .query(
                "SELECT id, embedding FROM conversation_events WHERE ticket_id = 'T1' ORDER BY id",
                params![],
            )
            .await
            .unwrap();

        let mut embedded_count = 0u32;
        while let Some(row) = rows.next().await.unwrap() {
            let blob: Result<Vec<u8>, _> = row.get(1);
            if blob.is_ok() && !blob.as_ref().unwrap().is_empty() {
                embedded_count += 1;
                let embedding = bytes_to_embedding(&blob.unwrap());
                assert_eq!(embedding.len(), 384);
            }
        }
        assert_eq!(embedded_count, 2);
    }

    #[tokio::test]
    async fn test_embed_recent_events_skips_already_embedded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db").to_string_lossy().to_string();
        let db = ConversationDb::open(&path, None).await.unwrap();
        let conn = db.db.connect().unwrap();

        conn.execute(
            "INSERT INTO conversations (ticket_id, status, created_at, updated_at, event_count) VALUES ('T2', 'active', 'now', 'now', 0)",
            params![],
        )
        .await
        .unwrap();

        // Insert with an existing embedding
        let fake_embedding = embedding_to_bytes(&vec![0.1f32; 384]);
        conn.execute(
            "INSERT INTO conversation_events (ticket_id, sequence, event_type, content, timestamp, embedding) VALUES ('T2', 1, 'user_message', 'already embedded', 'now', ?1)",
            params![libsql::Value::Blob(fake_embedding)],
        )
        .await
        .unwrap();

        let embedder = MockEmbedder;
        let count = embed_recent_events(&conn, &embedder).await.unwrap();
        assert_eq!(count, 0, "Should skip events that already have embeddings");
    }
}
