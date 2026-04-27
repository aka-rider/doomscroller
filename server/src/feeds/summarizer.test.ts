import { describe, test, expect } from 'bun:test';
import { extractiveSummarize, tokenizeSentences, wordCount } from './summarizer';

describe('tokenizeSentences', () => {
  test('splits basic sentences', () => {
    const text = 'Hello world. This is a test. How are you doing today?';
    const sentences = tokenizeSentences(text);
    expect(sentences.length).toBe(3);
    expect(sentences[0]).toContain('Hello world.');
    expect(sentences[2]).toContain('How are you doing today?');
  });

  test('handles abbreviations', () => {
    const text = 'Dr. Smith went to Washington. He met with Mr. Jones. They discussed the U.S. economy.';
    const sentences = tokenizeSentences(text);
    // "Dr. Smith went to Washington." should be one sentence
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences[0]).toContain('Dr.');
  });

  test('returns empty for empty input', () => {
    expect(tokenizeSentences('')).toEqual([]);
    expect(tokenizeSentences('   ')).toEqual([]);
  });

  test('handles single sentence', () => {
    const sentences = tokenizeSentences('This is a single sentence with no ending period');
    expect(sentences.length).toBe(1);
  });

  test('skips very short fragments', () => {
    const text = 'OK. This is a proper sentence. No. Really it is.';
    const sentences = tokenizeSentences(text);
    // "OK." and "No." are too short (<10 chars), should be skipped
    for (const s of sentences) {
      expect(s.length).toBeGreaterThan(10);
    }
  });

  test('handles exclamation and question marks', () => {
    const text = 'What a great day! Can you believe it? I certainly can.';
    const sentences = tokenizeSentences(text);
    expect(sentences.length).toBe(3);
  });
});

describe('wordCount', () => {
  test('counts words correctly', () => {
    expect(wordCount('hello world')).toBe(2);
    expect(wordCount('one two three four five')).toBe(5);
  });

  test('handles empty string', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
  });

  test('handles multiple spaces', () => {
    expect(wordCount('hello   world   test')).toBe(3);
  });
});

describe('extractiveSummarize', () => {
  const ARTICLE = `
    The European Central Bank announced a surprise interest rate cut on Thursday,
    lowering its benchmark rate by 25 basis points to 3.5 percent. The decision
    came amid growing concerns about the region's economic slowdown. ECB President
    Christine Lagarde said the move was necessary to support the eurozone economy.
    Inflation has been declining steadily over the past several months, falling to
    2.1 percent in the latest reading. The rate cut was not unanimously supported
    by all members of the governing council. Some members argued that inflation
    risks remained elevated and that premature easing could reignite price pressures.
    Markets reacted positively to the announcement, with European stock indices
    rising by more than 1 percent. Bond yields fell across the eurozone, with
    German 10-year bunds dropping to their lowest level in three months. Analysts
    expect further rate cuts in the coming months if economic data continues to
    weaken. The euro fell slightly against the dollar following the announcement.
  `.trim();

  test('produces a non-empty summary', () => {
    const summary = extractiveSummarize(ARTICLE);
    expect(summary.length).toBeGreaterThan(0);
  });

  test('summary is shorter than original', () => {
    const summary = extractiveSummarize(ARTICLE);
    expect(summary.length).toBeLessThan(ARTICLE.length);
  });

  test('summary contains only sentences from the original', () => {
    const summary = extractiveSummarize(ARTICLE);
    // Each sentence in the summary should appear in the original
    const summSentences = tokenizeSentences(summary);
    for (const s of summSentences) {
      // Allow for whitespace normalization
      const normalized = s.replace(/\s+/g, ' ').trim();
      expect(ARTICLE.replace(/\s+/g, ' ')).toContain(normalized);
    }
  });

  test('respects maxSentences parameter', () => {
    const summary2 = extractiveSummarize(ARTICLE, 2);
    const summary5 = extractiveSummarize(ARTICLE, 5);
    const sentences2 = tokenizeSentences(summary2);
    const sentences5 = tokenizeSentences(summary5);
    expect(sentences2.length).toBeLessThanOrEqual(2);
    expect(sentences5.length).toBeLessThanOrEqual(5);
  });

  test('handles short text (fewer sentences than maxSentences)', () => {
    const shortText = 'This is a short article. It has just two sentences.';
    const summary = extractiveSummarize(shortText, 3);
    expect(summary).toBe(shortText);
  });

  test('handles very short text', () => {
    const summary = extractiveSummarize('Hello world.');
    expect(summary.length).toBeGreaterThan(0);
  });

  test('handles empty text', () => {
    const summary = extractiveSummarize('');
    expect(summary).toBe('');
  });
});
