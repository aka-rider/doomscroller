import { z } from 'zod';
import type { Result } from '../types';
import { Ok, Err } from '../types';

// Zod schema for LLM tag response
export const tagResponseSchema = z.object({
  tags: z.array(z.string()).min(1).max(5),
  new_tags: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)).max(2).optional(),
});

export type TagResponse = z.infer<typeof tagResponseSchema>;

export interface LLMConfig {
  readonly baseUrl: string;
  readonly model: string;
}

// Strip markdown code fences that LLMs sometimes wrap JSON in
const stripFences = (text: string): string => {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
};

// Send a tagging request to llama.cpp, validate response with Zod
export const tagArticle = async (
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<Result<TagResponse, string>> => {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Err(`LLM request failed: ${message}`);
  }

  if (!response.ok) {
    return Err(`LLM returned HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return Err('LLM returned invalid JSON response');
  }

  // Extract content from OpenAI-compatible response
  const content = (body as { choices?: Array<{ message?: { content?: string } }> })
    ?.choices?.[0]?.message?.content;

  if (!content) {
    return Err('LLM response missing choices[0].message.content');
  }

  const cleaned = stripFences(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return Err(`LLM returned unparseable JSON: ${cleaned.slice(0, 200)}`);
  }

  const validated = tagResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return Err(`LLM response failed validation: ${validated.error.message}`);
  }

  return Ok(validated.data);
};

// Health check — verify llama.cpp is reachable
export const healthCheck = async (config: LLMConfig): Promise<boolean> => {
  try {
    const response = await fetch(`${config.baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};
