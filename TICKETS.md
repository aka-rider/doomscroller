# Doomscroller — Waterfall Tickets

Deliverables D1–D11. Each ends with a verifiable smoke test. Dependencies flow strictly downward.

---

## Critical Blockers (Read First)

1. **Schema Mismatch** — Live schema uses `categories`, `entry_scores`, `entry_categories`, `preferences`, `interactions`. Plan requires `tags`, `entry_tags`, `tag_preferences`. No migration — delete the DB and recreate from the new `schema.sql`. This is a pre-release app with no user data worth preserving.
2. **Scorer → Tagger Rewrite** — Current `scorer/` implements relevance scoring (0.0–1.0). Plan requires single-pass LLM tagging. None of the existing scorer code is reusable.
3. **Starter Feeds Include Dead URLs** — `rss.nytimes.com` and `feeds.ft.com/rss/home/us` are dead. Plan has 55 verified feeds; codebase has 8 (some broken).

---

## D1: Schema Rewrite (Nuke & Pave)

No migration. Delete the old DB file and recreate from the new `schema.sql`. This is pre-release — there is no user data to preserve.

| # | Ticket | Description |
|---|--------|-------------|
| 1.1 | Rewrite `schema.sql` | Replace entire file with plan's data model: `feeds` (no `group_id`), `entries` (add `tagged_at`, drop `is_hidden`), `tags`, `entry_tags`, `tag_preferences`, `jobs`, `config`. No `categories`, `feed_categories`, `entry_scores`, `entry_categories`, `preferences`, `interactions`. No `_migrations` — not needed with nuke-and-pave. |
| 1.2 | Rewrite `db/index.ts` | On boot: open SQLite, set WAL/FK/synchronous pragmas, run `schema.sql` verbatim (all `CREATE TABLE IF NOT EXISTS`). Delete the migration runner. If schema changes during development, delete `data/doomscroller.db` and restart. |
| 1.3 | Rewrite `db/queries.ts` | Delete all category/score/preference/interaction queries. Write new prepared statements for tags, entry_tags, tag_preferences. Typed wrappers with branded IDs. |
| 1.4 | Update `types.ts` | Add `TagId` branded type. Add `Tag`, `EntryTag`, `TagPreference` types. Remove `Category`, `CategoryId`, `EntryScore`, `Preference`, `Interaction`, `ScoredEntry`. |
| 1.5 | Delete `scorer/` directory | Remove `client.ts`, `batch.ts`, `prompts.ts` and all tests. Dead code — will be replaced by `tagger/` in D4. |
| 1.6 | Rewrite `index.ts` boot sequence | Remove category seeding, interest_profile seeding, starter feed seeding (moved to D3), `score_batch` handler. Wire tag seeding (D2). Fix all remaining compile errors in `api/routes.ts`, `api/fever.ts`. |

### Smoke Test

```
rm -f data/doomscroller.db
bun test passes.
bun run server/src/index.ts boots, creates DB with new schema.
sqlite3 data/doomscroller.db ".tables" shows:
  feeds entries tags entry_tags tag_preferences jobs config
No old tables. No _migrations table.
entries table has tagged_at column, no is_hidden column.
```

---

## D2: Tag Seeding & Core Operations

| # | Ticket | Description |
|---|--------|-------------|
| 2.1 | Seed 32 built-in tags | On first boot, insert all built-in tags from plan with `is_builtin=1`, correct `tag_group` and `sort_order`. No `use_count` leaderboard — all tags always in prompt. |
| 2.2 | Tag CRUD queries | `getAllTags`, `getTagBySlug`, `createTag`, `deleteTag`, `getAllTagSlugs` (flat list for LLM prompt) |
| 2.3 | Tag preference queries | `setTagPreference(tagId, mode)`, `getTagPreferences()`, `getPreferenceForTag(tagId)` |
| 2.4 | Entry-tag association queries | `addEntryTag(entryId, tagId, source)`, `getTagsForEntry(entryId)`, `getEntriesByTag(tagId)` |
| 2.5 | Entry visibility query | Implement filtering logic: whitelist > blacklist > none. Single SQL query that returns visible entries. Untagged entries always shown. |
| 2.6 | Tag API routes | `GET /api/tags` (all tags grouped), `PUT /api/tags/:id/preference` (set mode), `POST /api/tags` (create custom tag) |
| 2.7 | Unit tests for all tag queries | Test seeding, CRUD, preference cycling, visibility filtering edge cases (all-blacklisted, one-whitelisted-overrides, untagged-always-shown) |

### Smoke Test

```
bun test passes.
Boot server.
curl localhost:6767/api/tags → returns 32 built-in tags with correct groups.
curl -X PUT localhost:6767/api/tags/:id/preference -d '{"mode":"whitelist"}' → persists.
curl localhost:6767/api/entries?filter=preferences → returns only visible entries per filtering rules.
```

---

## D3: Curated Feeds

| # | Ticket | Description |
|---|--------|-------------|
| 3.1 | Replace starter feeds | Remove 8 old feeds (including dead NYT, FT). Seed all 55 verified feeds from plan on first boot. |
| 3.2 | Update `/api/feeds` routes | `GET /api/feeds` (list with unread counts), `POST /api/feeds` (add by URL), `DELETE /api/feeds/:id` |
| 3.3 | Unit tests for feed operations | Verify seed data, add/remove |

### Smoke Test

```
Boot server.
curl localhost:6767/api/feeds → returns 55 feeds.
Wait 2 min.
curl localhost:6767/api/entries → returns entries from BBC, HN, Lobsters etc.
```

---

## D4: LLM Tagger (Replace Scorer)

Single-pass tagging. No chunked protocol — title + summary + truncated content is enough to tag any article. The LLM sees all tags (32 built-in + any custom/proposed). No `use_count` leaderboard.

| # | Ticket | Description |
|---|--------|-------------|
| 4.1 | Create `tagger/client.ts` | HTTP client for llama.cpp `/v1/chat/completions`. Sends system prompt + user message. Parses JSON response. Zod schema for `{tags: string[], new_tags?: string[]}`. |
| 4.2 | Create `tagger/prompt.ts` | Build prompt from `getAllTagSlugs()`. Template: title, source, summary, content (truncated to ~4000 chars). Single pass — no chunking, no confidence negotiation. |
| 4.3 | Create `tagger/batch.ts` | Tagger worker: query untagged entries (`WHERE tagged_at IS NULL LIMIT 20`), run single-pass tagging for each, validate output with Zod, write `entry_tags`, create new proposed tags (`is_builtin=0`, `tag_group='proposed'`), set `tagged_at`. |
| 4.4 | Wire tagger into job queue | Replace `score_batch` job type with `tag_batch`. Schedule every 5 minutes. Update `index.ts` handler registration. |
| 4.5 | Unit tests | Mock LLM responses. Test: successful tag, new tag proposal, invalid JSON retry, LLM unavailable graceful failure. |

### Smoke Test

```
Boot full stack (make up).
Wait for fetch + tag cycle.
sqlite3 data/doomscroller.db \
  "SELECT e.title, t.slug FROM entries e
   JOIN entry_tags et ON e.id=et.entry_id
   JOIN tags t ON et.tag_id=t.id LIMIT 10"
→ returns tagged entries with valid tag slugs.
entries.tagged_at is set for tagged rows.
Untagged entries still appear in /api/entries.
```

---

## D5: Docker Cleanup

| # | Ticket | Description |
|---|--------|-------------|
| 5.1 | Remove embeddings container | Delete `embeddings` service from `docker-compose.yml`. Remove embeddings download from `model-init` script. Phase 3 — don't download what we don't use. |
| 5.2 | Add SHA256 verification to model-init | Verify Gemma GGUF hash after download. Skip download if file exists and hash matches. Use `curl -C -` for resume. |
| 5.3 | Bind ports to `0.0.0.0` | All ports on `0.0.0.0` — unsecured local network server. Users who want auth put it behind a reverse proxy. Remove `127.0.0.1` binding from `doomscroller` and `llm` ports. |
| 5.4 | Update `Dockerfile` | Non-root user, `read_only: true`, tmpfs `/tmp`, healthcheck. |

### Smoke Test

```
make clean && make up
Model downloads (~5GB). No embeddings model downloaded.
docker compose ps → shows doomscroller + llm + model-init (exited). No embeddings container.
curl <host>:8081/health → returns OK (accessible from LAN).
curl <host>:6767 → serves HTML (accessible from LAN).
```

---

## D6: Design System Foundation (CSS)

Fonts are self-hosted. No Google Fonts CDN. Zero external requests on page load.

| # | Ticket | Description |
|---|--------|-------------|
| 6.1 | Download fonts locally | Download Source Serif 4 (variable, woff2), Inter (400/500/600, woff2), JetBrains Mono (400, woff2) from Google Fonts. Place in `web/public/fonts/`. Add `@font-face` declarations in CSS. No external network requests. |
| 6.2 | CSS custom properties | All typography tokens, color tokens, spacing tokens, border-radius tokens, motion tokens from plan's design system |
| 6.3 | Global reset & base styles | Dark background, text colors, scrollbar styling, reduced-motion media query, focus styles |
| 6.4 | Utility classes | `.sr-only`, `.btn`, `.btn-primary`, form input styles, content typography (`.article-content`) |

### Smoke Test

```
cd web && bun run build
Open dist/index.html in browser.
DevTools Network → zero external font requests. All fonts loaded from /fonts/.
Page background is dark (#141414).
Text is warm off-white (#e8e4df).
Source Serif 4 renders for headings. Inter for UI. JetBrains Mono for data.
```

---

## D7: Two-Panel Layout + Entry Cards

Two panels, not three. Tag sidebar + post list. Feed-level navigation happens through tags or a feed dropdown — no dedicated middle panel eating 280px of screen.

| # | Ticket | Description |
|---|--------|-------------|
| 7.1 | Create `AppShell.tsx` | Flex container with 2 slots: TagSidebar (240px) + PostList (flex:1, max-width 42rem centered). Responsive: sidebar hidden on mobile (<768px), visible on desktop. |
| 7.2 | Create `Header.tsx` | Sticky header: wordmark left, unread toggle + settings gear right. Frosted glass effect. 56px height. |
| 7.3 | Create `TagSidebar.tsx` | Tags grouped by `tag_group`, sticky group headers, "All Entries" at top, preference indicators (● neutral, ★ whitelist, ✕ blacklist), unread count per tag. |
| 7.4 | Rewrite `EntryCard.tsx` | Feed source (accent), dot, timestamp, title (serif), summary (2-line clamp), tag pills row, star toggle, optional thumbnail. States: read (dimmed), untagged ("Pending" pill), hover, active, focused. |
| 7.5 | Tag pill component | Three visual states: neutral, whitelisted (gold border), blacklisted (red border, strikethrough). Click navigates to tag filter. |
| 7.6 | Navigation state | SolidJS signal for active tag. Tag click filters post list. Keyboard: j/k navigation, s for star, o for open. |
| 7.7 | Mobile drawer | Tag sidebar as slide-out drawer on mobile. Hamburger in header. Overlay + panel. |

### Smoke Test

```
cd web && bun run dev
Desktop (>=768px): sidebar + post list visible. Sidebar 240px, posts centered max 42rem.
Mobile (<768px): posts only. Hamburger → tag drawer slides out.
Header sticky on scroll. Frosted glass blur visible.
Entry cards show serif titles, tag pills, feed source in amber.
Click tag in sidebar → post list filters. Click star → fills gold.
```

---

## D8: Tag Sidebar Interactivity & Filtering

| # | Ticket | Description |
|---|--------|-------------|
| 8.1 | Preference cycling UI | Click tag cycles: none → whitelist → blacklist → none. Visual updates instantly. PUT to `/api/tags/:id/preference`. |
| 8.2 | Filtering integration | When preferences set, `GET /api/entries?filter=preferences` returns only visible entries. Whitelist > blacklist > none. Server-side SQL filtering. |
| 8.3 | "[+ New Tag]" button | Creates custom tag: prompt for label, auto-generate slug, `tag_group='custom'`. POST to `/api/tags`. |
| 8.4 | Wire entry cards to real API | `PostList` fetches `GET /api/entries` with active tag filter. `<For>` loop. `<Suspense>` loading. Star/read toggles hit API with optimistic update. |

### Smoke Test

```
Boot full stack, wait for tags + entries.
Tag sidebar shows ~32 tags grouped by News/Tech/Science/etc.
Click a tag → post list filters to entries with that tag.
Click a tag preference indicator → cycles none/whitelist/blacklist with correct icons.
Blacklist "sports" + "celebrity" → those entries disappear from "All Entries".
Whitelist "programming" → programming entries always shown even if other tags blacklisted.
Create custom tag "rust" → appears in sidebar under Custom group.
```

---

## D9: Onboarding Wizard

Full-screen takeover on first boot. Three steps: welcome, tag preferences, done. Gates the main UI until completed. The onboarding preference grid is the same component reused in Settings (D10).

| # | Ticket | Description |
|---|--------|-------------|
| 9.1 | Create `Onboarding.tsx` | Full-screen, 3-step wizard. Step 1: Welcome hero text. Step 2: Tag preference grid (all 32 tags, grouped by `tag_group`, three-state toggle: none/whitelist/blacklist). Step 3: "Start Reading" confirmation. |
| 9.2 | Onboarding gate | Check `config` table for `onboarding_complete`. If not set, render Onboarding instead of main app. On completion, write all tag preferences + set `onboarding_complete` in config. |
| 9.3 | Tag preference grid component | Reusable grid of tag cards with three-state toggle. Grouped by tag_group. Same component used in Settings (D10). |
| 9.4 | Step navigation | Back/Next buttons. Step indicator (3 dots). Last step = "Start Reading" → batch-writes preferences + config flag. |
| 9.5 | API route | `GET /api/config/onboarding` (check status), `POST /api/config/onboarding` (complete + write preferences). |

### Smoke Test

```
rm -f data/doomscroller.db && make up
Open localhost:6767.
Full-screen onboarding appears (NOT the feed list).
Step 1: Welcome text. Click Next.
Step 2: Tag grid. Whitelist "programming", blacklist "sports". Click Next.
Step 3: "Start Reading". Click it.
Main UI loads with two-panel layout.
Refresh page → onboarding does NOT reappear.
sqlite3 data/doomscroller.db "SELECT * FROM tag_preferences" → shows programming=whitelist, sports=blacklist.
sqlite3 data/doomscroller.db "SELECT value FROM config WHERE key='onboarding_complete'" → returns truthy value.
```

---

## D10: Settings Panel & Feed Management

| # | Ticket | Description |
|---|--------|-------------|
| 10.1 | Rewrite `SettingsPanel.tsx` | Modal overlay. Tabs: "Feeds" and "Tags". Open with gear icon or `,` key. |
| 10.2 | Feeds tab | List all feeds. Add feed by URL. Remove feed. Import/export OPML. |
| 10.3 | Tags tab | Same three-state preference grid from onboarding (D9.3). Custom tag creation. Proposed tag management (promote to real group, delete). |
| 10.4 | OPML import/export | Parse OPML XML → insert feeds. Export feeds → OPML XML download. |
| 10.5 | API routes for settings | `POST /api/import/opml`, `GET /api/export/opml` |

### Smoke Test

```
Open Settings (gear icon or , key).
Feeds tab: 55 feeds listed.
Add https://xkcd.com/rss.xml → appears in feed list.
Delete it → disappears.
Export OPML → downloads valid XML.
Import a sample OPML → feeds appear.
Tags tab: change preferences, create custom tag "rust" → appears in sidebar.
```

---

## D11: Fever API Update

No auth. Unsecured, like the main API. Users who want auth put a reverse proxy in front.

| # | Ticket | Description |
|---|--------|-------------|
| 11.1 | Strip Fever auth | Remove API key generation, remove `authenticate()`, remove `config` key check. All Fever endpoints respond without auth (`auth: 1` always). Delete API key seeding from boot. |
| 11.2 | Update Fever responses for tag model | Fever `groups` endpoint returns tags as groups (Fever clients expect groups — tags are the closest analog). `feeds_groups` maps feeds. Items return correctly. |
| 11.3 | Test with Reeder/NetNewsWire | Manual verification: configure client with any password (or empty), feeds load, entries display, read/star sync works. |

### Smoke Test

```
Configure NetNewsWire:
  Server: http://<host>:6767/fever/
  Username: doomscroller
  Password: (anything — auth is always accepted)
Feeds load in mobile app.
Entries display with titles and summaries.
Mark read/star in app → syncs to web UI.
```

---

## Removed from Plan

These were in the original tickets. They're cut.

| Cut | Reason |
|-----|--------|
| **Feed groups / middle panel (was D3, D7)** | Two organizational hierarchies (groups for sources, tags for content) confuse users. Tags handle organization. The middle panel ate 280px for a list of feed names. Removed. |
| **Chunked tagging protocol (was D5.3)** | Over-engineered. Title + summary + truncated content is enough to tag any article. Single LLM call, not 1-3 calls with confidence negotiation. |
| **`use_count` leaderboard / top-100 rule (was D2)** | With ~32 built-in + a few custom/proposed tags, all fit in the prompt. No need for a popularity contest to decide which tags the LLM sees. |
| **Google Fonts CDN (was D6.1)** | External dependency on every page load. Fonts are self-hosted as woff2 in the build. |
| **Fever API key auth (was D12.2)** | Security theater on a local-network app. Main API has zero auth. Fever should match. Reverse proxy for anyone who wants auth. |
| **Embeddings container download (was D4)** | Phase 3 feature. Don't download ~328MB of model you won't use. |
| **Docker image digest pinning (was D4.4)** | Nice-to-have, not a deliverable. Do it when convenient, not as a blocker. |
| **`127.0.0.1` port binding** | Defeats the purpose for mobile clients on LAN. Bind `0.0.0.0`. |
| **Incremental migrations** | Pre-release app with no user data. `schema.sql` is the source of truth. Delete DB + restart to apply schema changes. No migration runner, no numbered SQL files, no `_migrations` tracking overhead. |

---

## Dependency Graph

```
D1 ──→ D2 ──→ D3 ──→ D4
                       │
D6 ──→ D7 ──→ D8 ──→ D9 ──→ D10
       ▲
       │
  D5 ──┘ (Docker cleanup can land anytime before D7 needs full stack)

D11 ── needs D2 (tag model) + existing Fever code, can run in parallel
```

- **D1** unblocks everything (schema is foundation)
- **D2** needs D1 (tag tables must exist)
- **D3** needs D2 (seed feeds after tags exist, so tagger has something to process)
- **D4** needs D2 + D3 (tagger needs tags + entries)
- **D5** can run anytime (Docker cleanup is independent)
- **D6** can start in parallel with D1 (CSS is independent of server)
- **D7** needs D6 + D5 (layout needs design system + working Docker stack)
- **D8** needs D7 (interactive features need the shell)
- **D9** needs D8 (onboarding needs the full UI shell to gate)
- **D10** needs D9 (settings reuses onboarding's preference grid component)
- **D11** needs D2 (Fever needs tag model), can run in parallel with D6–D10
