import type { Database } from 'bun:sqlite';
import type { EntryId } from '../types';
import * as queries from '../db/queries';
import { bufferToFloat32, float32ToBuffer } from '../tagger/embeddings';
import { EMBEDDING_DIM } from '../tagger/embeddings';

// --- User Preference Vector ---
//
// Computes a preference vector from thumbed article embeddings.
// Thumb-up entries contribute positively, thumb-down contribute negatively (scaled 0.5x).
// Recent interactions weigh more than old ones (decay factor ~0.95 per position).
// Minimum 5 thumb interactions before the preference vector activates.

const MIN_INTERACTIONS_FOR_PREFERENCE = 5;
const DECAY_PER_POSITION = 0.95;
const NEGATIVE_WEIGHT = 0.5;

// Compute the preference vector from thumbed entry embeddings.
// Returns null if fewer than MIN_INTERACTIONS_FOR_PREFERENCE thumbed articles exist.
export const computePreferenceVector = (db: Database): Float32Array | null => {
  const thumbedEntries = queries.getThumbedEntryEmbeddings(db);

  if (thumbedEntries.length < MIN_INTERACTIONS_FOR_PREFERENCE) {
    return null;
  }

  const posVec = new Float32Array(EMBEDDING_DIM);
  const negVec = new Float32Array(EMBEDDING_DIM);
  let posWeight = 0;
  let negWeight = 0;

  for (let idx = 0; idx < thumbedEntries.length; idx++) {
    const entry = thumbedEntries[idx]!;
    const embedding = bufferToFloat32(entry.embedding);
    const decay = Math.pow(DECAY_PER_POSITION, idx);

    if (entry.thumb === 1) {
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        posVec[i]! += embedding[i]! * decay;
      }
      posWeight += decay;
    } else if (entry.thumb === -1) {
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        negVec[i]! += embedding[i]! * decay;
      }
      negWeight += decay;
    }
  }

  // Normalize each component
  if (posWeight > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      posVec[i]! /= posWeight;
    }
  }
  if (negWeight > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      negVec[i]! /= negWeight;
    }
  }

  // Combined: pos - 0.5 * neg, then L2-normalize
  const vec = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    vec[i] = posVec[i]! - NEGATIVE_WEIGHT * negVec[i]!;
  }

  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i]! /= norm;
    }
  }

  return vec;
};

// Recompute preference vector and store in config table.
// Returns true if a valid preference vector was computed.
export const updatePreferenceVector = (db: Database): boolean => {
  const vec = computePreferenceVector(db);

  if (!vec) {
    // Not enough data yet — clear any existing vector
    db.run("DELETE FROM config WHERE key = 'user_preference_vector'");
    return false;
  }

  const buf = float32ToBuffer(vec);
  queries.setConfig(db, 'user_preference_vector', buf.toString('base64'));
  return true;
};

// Re-score all entries that have embeddings against the current preference vector.
export const rescoreAllEntries = (db: Database): number => {
  const prefVecStr = queries.getConfig(db, 'user_preference_vector');
  if (!prefVecStr) return 0;

  const prefVec = bufferToFloat32(Buffer.from(prefVecStr, 'base64'));

  let rescored = 0;
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const batch = queries.getEntriesWithEmbeddings(db, batchSize, offset);
    if (batch.length === 0) break;

    const scores: Array<{ id: EntryId; score: number }> = [];
    for (const entry of batch) {
      const embedding = bufferToFloat32(entry.embedding);
      let dot = 0;
      for (let i = 0; i < embedding.length; i++) {
        dot += embedding[i]! * prefVec[i]!;
      }
      scores.push({ id: entry.id, score: dot });
    }

    queries.bulkUpdateRelevanceScores(db, scores);
    rescored += batch.length;
    offset += batchSize;
  }

  return rescored;
};
