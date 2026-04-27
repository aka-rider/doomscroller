// Category definitions derived from the hierarchical taxonomy.
// Used by API routes and frontend. Categories and their tag membership
// come from taxonomy.ts — the single source of truth.

import { BUILTIN_CATEGORIES, BUILTIN_TAGS } from './taxonomy';

export interface CategoryView {
  readonly slug: string;
  readonly label: string;
  readonly tagSlugs: readonly string[];
}

// Build categories with their tag slugs from the taxonomy
export const CATEGORIES: readonly CategoryView[] = BUILTIN_CATEGORIES.map(cat => ({
  slug: cat.slug,
  label: cat.label,
  tagSlugs: BUILTIN_TAGS
    .filter(t => t.category_slug === cat.slug)
    .map(t => t.slug),
}));

export const CATEGORY_MAP = new Map<string, CategoryView>(
  CATEGORIES.map(c => [c.slug, c]),
);

// Reverse map: tag slug → category slug
export const TAG_TO_CATEGORY = new Map<string, string>();
for (const cat of CATEGORIES) {
  for (const tagSlug of cat.tagSlugs) {
    TAG_TO_CATEGORY.set(tagSlug, cat.slug);
  }
}
