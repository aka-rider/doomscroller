// TextRank extractive summarization.
// Picks the N most representative sentences from an article using
// TF-IDF cosine similarity + PageRank. Pure JS, no external deps.
// Runs in <50ms for typical articles.

// --- Sentence Tokenization ---

// Abbreviations that shouldn't trigger sentence breaks
const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd',
  'gen', 'gov', 'sgt', 'cpl', 'pvt', 'capt', 'lt', 'col', 'maj',
  'inc', 'ltd', 'corp', 'co', 'dept', 'div', 'est', 'approx',
  'vs', 'etc', 'al', 'fig', 'eq', 'vol', 'no', 'op',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]);

// Split text into sentences, handling abbreviations and common edge cases.
export const tokenizeSentences = (text: string): string[] => {
  // Normalize whitespace
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const sentences: string[] = [];
  let start = 0;

  // Match sentence-ending punctuation followed by space + uppercase or end of string
  const re = /([.!?]+)(\s+|$)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(clean)) !== null) {
    const endPos = match.index + match[0]!.length;

    // Check if this is an abbreviation (word before the period)
    const before = clean.slice(start, match.index + match[1]!.length);
    const lastWord = before.match(/(\w+)\.*$/)?.[1]?.toLowerCase() ?? '';

    if (match[1] === '.' && ABBREV.has(lastWord)) {
      continue; // Skip — abbreviation, not a sentence break
    }

    // Check if next character is uppercase or end of string
    const nextChar = clean[endPos];
    if (nextChar && nextChar !== nextChar.toUpperCase()) {
      continue; // Next word is lowercase — probably not a sentence break
    }

    // U.S., A.I., etc. — skip single-letter abbreviations with periods
    if (match[1] === '.' && lastWord.length === 1 && /[a-z]/i.test(lastWord)) {
      continue;
    }

    const sentence = clean.slice(start, endPos).trim();
    if (sentence.length > 10) { // Skip very short fragments
      sentences.push(sentence);
    }
    start = endPos;
  }

  // Remaining text after last sentence break
  const remaining = clean.slice(start).trim();
  if (remaining.length > 10) {
    sentences.push(remaining);
  }

  return sentences;
};

// --- TF-IDF ---

// Tokenize a sentence into lowercase words (letters and digits only)
const tokenizeWords = (sentence: string): string[] =>
  sentence.toLowerCase().match(/\b[a-z][a-z0-9]{1,}\b/g) ?? [];

// Stop words to exclude from TF-IDF
const STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'in', 'that', 'have', 'it', 'for',
  'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but',
  'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an',
  'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so',
  'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
  'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
  'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only',
  'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use',
  'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new',
  'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  'was', 'were', 'been', 'has', 'had', 'are', 'is', 'did', 'does',
]);

interface TfIdfVector {
  readonly terms: Map<string, number>;
  readonly magnitude: number;
}

const buildTfIdf = (sentences: string[]): TfIdfVector[] => {
  const N = sentences.length;

  // Document frequency per term
  const df = new Map<string, number>();
  const sentenceTerms: Map<string, number>[] = [];

  for (const sentence of sentences) {
    const words = tokenizeWords(sentence);
    const tf = new Map<string, number>();
    for (const w of words) {
      if (STOP_WORDS.has(w)) continue;
      tf.set(w, (tf.get(w) ?? 0) + 1);
    }
    sentenceTerms.push(tf);

    // Count unique terms for DF
    for (const term of tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // Build TF-IDF vectors
  return sentenceTerms.map((tf) => {
    const terms = new Map<string, number>();
    let sumSq = 0;
    for (const [term, count] of tf) {
      const idf = Math.log((N + 1) / ((df.get(term) ?? 0) + 1));
      const tfidf = count * idf;
      terms.set(term, tfidf);
      sumSq += tfidf * tfidf;
    }
    return { terms, magnitude: Math.sqrt(sumSq) || 1 };
  });
};

const cosineSim = (a: TfIdfVector, b: TfIdfVector): number => {
  let dot = 0;
  for (const [term, weight] of a.terms) {
    const bWeight = b.terms.get(term);
    if (bWeight !== undefined) {
      dot += weight * bWeight;
    }
  }
  return dot / (a.magnitude * b.magnitude);
};

// --- TextRank (PageRank on sentence similarity graph) ---

const textRank = (
  vectors: TfIdfVector[],
  maxIter = 50,
  damping = 0.85,
  convergence = 0.0001,
): number[] => {
  const N = vectors.length;
  if (N === 0) return [];

  // Build similarity matrix (only store edges above a threshold)
  const edges: Array<Array<{ j: number; w: number }>> = Array.from({ length: N }, () => []);

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const sim = cosineSim(vectors[i]!, vectors[j]!);
      if (sim > 0.05) {
        edges[i]!.push({ j, w: sim });
        edges[j]!.push({ j: i, w: sim });
      }
    }
  }

  // PageRank iterations
  const scores = new Float64Array(N).fill(1 / N);
  const newScores = new Float64Array(N);

  for (let iter = 0; iter < maxIter; iter++) {
    let maxDelta = 0;

    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (const { j, w } of edges[i]!) {
        const neighborTotal = edges[j]!.reduce((acc, e) => acc + e.w, 0);
        if (neighborTotal > 0) {
          sum += (w / neighborTotal) * scores[j]!;
        }
      }
      newScores[i] = (1 - damping) / N + damping * sum;
    }

    for (let i = 0; i < N; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(newScores[i]! - scores[i]!));
      scores[i] = newScores[i]!;
    }

    if (maxDelta < convergence) break;
  }

  return Array.from(scores);
};

// --- Public API ---

// Count words in plain text.
export const wordCount = (text: string): number => {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
};

// Extract the N most representative sentences from text using TextRank.
// Returns sentences in their original document order.
export const extractiveSummarize = (text: string, maxSentences = 3): string => {
  const sentences = tokenizeSentences(text);

  // Short article fallback: just return first sentences
  if (sentences.length <= maxSentences) {
    return sentences.join(' ');
  }
  if (sentences.length < 5) {
    return sentences.slice(0, Math.min(2, sentences.length)).join(' ');
  }

  // Build TF-IDF vectors
  const vectors = buildTfIdf(sentences);

  // Run TextRank
  const scores = textRank(vectors);

  // Pick top N sentences by score
  const ranked = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences);

  // Return in original document order
  ranked.sort((a, b) => a.index - b.index);

  return ranked.map(r => sentences[r.index]!).join(' ');
};
