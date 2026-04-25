import { z } from 'zod';
import type { Result, LLMClassification } from '../types';
import { Ok, Err } from '../types';

// llama.cpp HTTP client. Speaks the OpenAI-compatible /v1/chat/completions API.
// All calls are async. Timeouts are generous (LLM is slow, 1-5 tok/sec).

const LLM_TIMEOUT_MS = 120_000; // 2 minutes per request — Gemma 4 E4B on CPU is slow

// Zod schema for validating LLM JSON output. If the model produces garbage, we fail cleanly.
const classificationSchema = z.object({
  category: z.string(),
  secondary_categories: z.array(z.string()).default([]),
  relevance: z.number().min(0).max(1),
  depth: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  reasoning: z.string(),
});

interface LLMConfig {
  readonly baseUrl: string;
  readonly model: string;
}

export const classifyEntry = async (
  config: LLMConfig,
  entry: { title: string; summary: string; feedTitle: string },
  categories: readonly string[],
  userProfile: string,
): Promise<Result<LLMClassification, string>> => {
  const prompt = buildClassificationPrompt(entry, categories, userProfile);

  const result = await chatCompletion(config, [
    { role: 'system', content: 'You are a content classifier. Respond with ONLY valid JSON, no markdown fences, no explanation.' },
    { role: 'user', content: prompt },
  ], { temperature: 0.1, max_tokens: 300 });

  if (!result.ok) return result;

  // Parse JSON from LLM response
  const text = result.value.trim();

  // Try to extract JSON from potential markdown fences
  const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const validated = classificationSchema.safeParse(parsed);

    if (!validated.success) {
      return Err(`LLM output validation failed: ${validated.error.message}`);
    }

    return Ok(validated.data);
  } catch {
    return Err(`LLM returned invalid JSON: ${jsonStr.slice(0, 200)}`);
  }
};

export const suggestCategories = async (
  config: LLMConfig,
  feedTitle: string,
  sampleTitles: readonly string[],
  existingCategories: readonly string[],
): Promise<Result<string[], string>> => {
  const prompt = `Given this RSS feed "${feedTitle}" with these sample article titles:
${sampleTitles.map(t => `- ${t}`).join('\n')}

Existing categories: ${existingCategories.length > 0 ? existingCategories.join(', ') : 'none yet'}

Suggest 1-3 categories for this feed. Prefer existing categories if they fit.
If no existing category fits, suggest a new short category name (1-3 words).

Respond with ONLY a JSON array of strings. Example: ["Technology", "Science"]`;

  const result = await chatCompletion(config, [
    { role: 'system', content: 'Respond with ONLY a JSON array of strings.' },
    { role: 'user', content: prompt },
  ], { temperature: 0.3, max_tokens: 100 });

  if (!result.ok) return result;

  try {
    const text = result.value.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || !parsed.every(s => typeof s === 'string')) {
      return Err('LLM did not return an array of strings');
    }
    return Ok(parsed);
  } catch {
    return Err(`Invalid JSON from LLM: ${result.value.slice(0, 200)}`);
  }
};

// Check if llama.cpp server is reachable
export const healthCheck = async (config: LLMConfig): Promise<boolean> => {
  try {
    const res = await fetch(`${config.baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
};

// --- Internals ---

interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

const chatCompletion = async (
  config: LLMConfig,
  messages: readonly ChatMessage[],
  params: { temperature?: number; max_tokens?: number } = {},
): Promise<Result<string, string>> => {
  try {
    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: params.temperature ?? 0.1,
        max_tokens: params.max_tokens ?? 500,
        stream: false,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return Err(`LLM API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return Err('LLM response missing choices[0].message.content');
    }

    return Ok(content);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return Err(`LLM timeout after ${LLM_TIMEOUT_MS}ms`);
    }
    return Err(err instanceof Error ? err.message : String(err));
  }
};

const buildClassificationPrompt = (
  entry: { title: string; summary: string; feedTitle: string },
  categories: readonly string[],
  userProfile: string,
): string => `Classify this article for a personalized news reader.

CATEGORIES (pick one primary, 0-2 secondary):
${categories.map(c => `- ${c}`).join('\n')}

USER INTEREST PROFILE:
${userProfile}

ARTICLE:
Source: ${entry.feedTitle}
Title: ${entry.title}
Summary: ${entry.summary.slice(0, 500)}

Respond with JSON:
{
  "category": "primary category name",
  "secondary_categories": ["optional", "extras"],
  "relevance": 0.0 to 1.0 (match to user interests),
  "depth": 0.0 to 1.0 (0=beginner, 1=expert-level),
  "novelty": 0.0 to 1.0 (0=rehashed, 1=breaking/unique),
  "reasoning": "one sentence why"
}`;
