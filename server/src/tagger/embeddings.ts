import { z } from 'zod';
import type { Result } from '../types';
import { Ok, Err } from '../types';

// Strict embedding dimensions matching nomic-embed-text-v1.5
export const EMBEDDING_DIM = 768;

const embedResponseSchema = z.object({
  data: z.array(z.object({
    embedding: z.array(z.number()).length(EMBEDDING_DIM),
  })),
});

export interface EmbeddingConfig {
  readonly baseUrl: string;
}

// Embed a batch of texts (up to 64) via llama-server /v1/embeddings.
// Returns Float32Arrays, mapped to L2-normalized vectors.
export const embed = async (
  config: EmbeddingConfig,
  texts: string[],
): Promise<Result<Float32Array[], string>> => {
  if (texts.length === 0) return Ok([]);
  if (texts.length > 64) return Err('Batch size exceeds maximum of 64');

  // nomic requires "search_document: " prefix for documents
  const input = texts.map((t) => `search_document: ${t}`);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Err(`Embedding request failed: ${message}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return Err(`Embedding sidecar returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return Err('Embedding sidecar returned invalid JSON');
  }

  const validated = embedResponseSchema.safeParse(body);
  if (!validated.success) {
    return Err(`Embedding response validation failed: ${validated.error.message}`);
  }

  const vectors = validated.data.data.map((item) => {
    const vec = item.embedding;

    // L2 Normalize
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
    const magnitude = Math.sqrt(sumSq) || 1; // avoid div by zero

    const float32 = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) float32[i] = vec[i] / magnitude;
    return float32;
  });

  return Ok(vectors);
};

// Health check — verify the embedding sidecar is reachable and model is loaded.
export const healthCheck = async (config: EmbeddingConfig): Promise<boolean> => {
  try {
    const response = await fetch(`${config.baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

// --- Embedding Input Builder ---

// Strip HTML tags for plain text embedding input.
const stripHtml = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Build the text to embed for an article entry.
// Format: "{title} | {feed_title}\n{summary}\n\n{content_text[:4000]}"
export const buildEmbeddingInput = (entry: {
  title: string;
  feed_title: string;
  summary: string;
  content_html: string;
}): string => {
  const plainContent = stripHtml(entry.content_html);
  const summary = entry.summary || plainContent.slice(0, 300);
  const bodyText = plainContent.slice(0, 4000);

  return `${entry.title} | ${entry.feed_title}\n${summary}\n\n${bodyText}`;
};

// Convert a Float32Array to a Buffer for SQLite BLOB storage (raw LE binary).
export const float32ToBuffer = (vec: Float32Array): Buffer =>
  Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);

// Convert a SQLite BLOB Buffer back to a Float32Array.
export const bufferToFloat32 = (buf: Buffer): Float32Array => {
  // Ensure proper alignment by copying to a new ArrayBuffer
  const ab = new ArrayBuffer(buf.byteLength);
  const view = new Uint8Array(ab);
  view.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return new Float32Array(ab);
};
