// Build system prompt for the tagger
export const buildSystemPrompt = (allTagSlugs: string[]): string =>
  `You are a content tagger. Given an article, assign 1-5 tags.

Pick from these known tags (preferred):
TAGS: ${allTagSlugs.join(', ')}

You MAY also propose up to 2 NEW tags if none of the above fit well.
New tags must be lowercase, hyphenated slugs (e.g., "home-automation").

Respond with ONLY valid JSON:
{"tags": ["tag1", "tag2"], "new_tags": ["optional-new-slug"]}`;

// Build user message for a specific article
export const buildUserMessage = (article: {
  title: string;
  source: string;
  summary: string;
  content: string;
}): string => {
  // Truncate content to ~4000 chars to fit context window
  const truncatedContent = article.content.length > 4000
    ? article.content.slice(0, 4000) + '…'
    : article.content;

  return `Title: ${article.title}
Source: ${article.source}
Summary: ${article.summary}
Content: ${truncatedContent}`;
};
