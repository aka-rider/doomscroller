# Doomscroller — Project Conventions

## What This Is

Self-hosted RSS reader with embedding-powered content tagging.
Single-user, fully local, Docker-only. SQLite is the database. Period.

**Stack:** Bun + Hono (server), SolidJS + Vite (web), nomic-embed-text-v1.5 (embeddings), SQLite (WAL).

## Design Philosophy

Think Apple for RSS. Ship amazing defaults that work for everyone out of the box.

- **Defaults over settings.** Every behavior should have one correct default. If you're tempted to add a toggle, pick the better option and hardcode it. A setting is an admission that you didn't finish designing.
- **Simplicity = longevity.** Every config option is a maintenance burden forever. Every preference pane is UI that can break, state that can corrupt, and docs that need writing. Less surface area means fewer bugs and easier upgrades.
- **Zero configuration on first run.** `make up` and it works. Feeds fetch, tagging runs, the UI loads. An onboarding flow guides first-time setup, and a settings panel lets you tweak behavior. But the defaults are opinionated and work out of the box.
- **Convention over configuration.** 30-minute fetch interval. If power users want knobs, they can fork — but the product serves the person who just wants to read.
- **Opinionated is a feature.** Don't build infrastructure for hypothetical needs. Don't add plugin systems, theming engines, or extension points. Build one thing, make it feel inevitable.
- **When in doubt, remove.** The best feature is the one you didn't build. If it doesn't clearly serve the core experience — reading feeds, categorized by AI — it doesn't ship.

**Quick start:** `make up` → <http://localhost:6767>
**Mobile RSS:** Point Reeder/NetNewsWire at `http://<host>:6767/fever/` with the Fever API key (printed on first boot, stored in SQLite config table).
**Fever auth:** username `doomscroller`, password is the generated API key.

## Architecture at a Glance

```text
┌──────────────────────────────────────────────────────────┐
│  docker compose up                                       │
│                                                          │
│  ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │  doomscroller        │    │  embeddings (llama.cpp) │  │
│  │  (Bun)               │───▶│  nomic-embed-text-v1.5   │  │
│  │                      │    │  POST /v1/embeddings     │  │
│  │  Hono API            │    └─────────────────────────┘  │
│  │  SolidJS (static)    │                                 │
│  │  Feed fetcher        │                                 │
│  │  Job queue           │                                 │
│  │  Fever API           │                                 │
│  │       │              │                                 │
│  │  ┌────┴────┐         │                                 │
│  │  │ SQLite  │         │                                 │
│  │  │ (WAL)   │         │                                 │
│  │  └─────────┘         │                                 │
│  └──────────────────────┘                                 │
└──────────────────────────────────────────────────────────┘
```

Two containers. One SQLite file. No Postgres, no Redis, no message queues.

## Directory Structure

```text
server/src/
  index.ts          — entry point, wires everything together
  categories.ts     — feed-to-category mapping
  taxonomy.ts       — depth anchors for quality scoring
  types.ts          — branded types, Result<T,E>, shared interfaces
  db/
    schema.sql      — source of truth for database schema
    index.ts        — init, migrations, pragma setup
    queries.ts      — prepared statements, typed wrappers
  feeds/
    fetcher.ts      — HTTP fetch with ETag/If-Modified-Since
    parser.ts       — feedparser wrapper, normalize to Entry shape
    extractor.ts    — readability/HTML extraction for articles
    summarizer.ts   — TextRank extractive summarization
  jobs/
    queue.ts        — SQLite-backed job queue (poll, claim, complete, fail)
  tagger/
    embeddings.ts   — embedding sidecar HTTP client + input builder
    batch.ts        — batch embedding + cosine similarity tag assignment
  scorer/
    preference.ts   — user preference vector from thumbed articles
  api/
    routes.ts       — Hono routes: /api/feeds, /api/entries, /api/tags, etc.
    fever.ts        — Fever API for native mobile RSS clients
web/src/
  index.tsx         — SolidJS mount
  App.tsx           — state-based view switching (feed/favorites/trash/noise/everything) + layout
  components/       — UI components
  lib/api.ts        — typed fetch wrapper
```

## TypeScript Rules

- `strict: true` everywhere, no escape hatches
- **Branded types** for database IDs: `type FeedId = Brand<number, 'FeedId'>`
- **Zod** for all external boundaries: RSS parsing output, embedding API responses, API inputs
- No `any`. No `as` casts unless you leave a `// SAFETY:` comment explaining why it's sound
- Prefer `unknown` + narrowing over `any`
- Errors are values, not exceptions. Use `Result<T, E>` for operations that can fail expectedly
- Exceptions are for bugs (programmer errors), not expected failures (network timeout, malformed feed)

## SQLite Rules

- **WAL mode.** Set on every connection open. Non-negotiable.
- **Foreign keys ON.** Set on every connection open.
- **Synchronous = NORMAL.** WAL + NORMAL is crash-safe for single-writer.
- **All writes go through one connection.** Bun's SQLite is synchronous — this is natural.
- **Reads can use separate connections** if needed, but for a single-user app one connection is fine.
- **Prepared statements** for everything. Never concatenate SQL strings.
- **Migrations** are inline `ALTER TABLE` statements in `db/index.ts`, guarded by `pragma_table_info` checks for idempotency. No `_migrations` table.
- `unixepoch()` for all timestamps. No ISO strings in the database.
- IDs are `INTEGER PRIMARY KEY` (SQLite rowid alias). No UUIDs.

## Job Queue Design

SQLite-based. No external dependencies.

```sql
jobs table: id, type, payload (JSON), status, priority, run_after, started_at, completed_at, attempts, max_attempts, error, created_at
```

- Workers poll with `UPDATE ... SET status='running' WHERE status='pending' AND run_after <= now LIMIT 1 RETURNING *`
- This is atomic — SQLite single-writer guarantees no double-claim
- Failed jobs retry with exponential backoff: `run_after = now + (2^attempts * 60)`
- Job types: `fetch_feed`, `tag_batch`, `cleanup`

## Embedding Pipeline

- **nomic-embed-text-v1.5** runs in a lightweight llama.cpp sub-container via `llama-server` (~260MB model)
- Exposes `POST /v1/embeddings` accepting `{input: string[]}` returning `{data: [{embedding: number[]}]}`
- 768-dimensional embeddings, 8192 token context, handles full articles without chunking
- **All embedding calls are async jobs.** Batch up to 64 articles per call (~1-3 seconds)
- Embedding responses validated with Zod before writing to DB
- Topic tags (~120) assigned via cosine similarity against tag embeddings
- `depth_score` (0–1) replaces signal tags — continuous quality signal computed from content signals
- Tag descriptions embedded on startup; article embeddings compared against tag embeddings
- User preference vector computed from thumbed articles (thumb up/down) — activates after 5+ thumbed entries

## Feed Fetching

- Respect `ETag` and `If-Modified-Since` headers — don't re-download unchanged feeds
- Respect `Retry-After` on 429s
- Timeout: 30 seconds per feed. If it's slower, it's broken.
- Dedup by `(feed_id, guid)`. If no guid, hash `(url + title + published_date)`
- Parse with a robust RSS/Atom parser. Normalize to a common `Entry` shape.
- Strip HTML for the `summary` field (plain text for embedding). Keep original `content` for display.
- Fetch interval: global default 30 min (configurable via DEFAULT_CONFIG). Per-feed `fetch_interval_min` column exists but is not yet used by the scheduler.

## API Design

Two APIs:

1. **Main API** (`/api/*`) — JSON REST for the SolidJS frontend
2. **Fever API** (`/fever/*`) — implements Fever protocol for native RSS clients (Reeder, NetNewsWire, Unread)

The Fever API is read-heavy and must be fast. It's mostly `SELECT` queries on indexed columns.

---

# SolidJS Pitfalls and Safety Nets

> These are non-obvious. Violating them produces bugs that are silent at first
> and miserable to debug later. Read this before writing any component.

## 1. NEVER Destructure Props

```tsx
// BROKEN — `title` is read once, reactivity is dead
function Card({ title }: { title: string }) {
  return <h2>{title}</h2>;
}

// CORRECT — props is a proxy, access properties on it
function Card(props: { title: string }) {
  return <h2>{props.title}</h2>;
}
```

**Why:** SolidJS tracks property access on the props proxy object. Destructuring
reads the value once at call time and throws away the proxy. The component will
never update when the parent changes that prop.

## 2. NEVER Destructure Stores

```tsx
// BROKEN
const { user } = store;
return <span>{user.name}</span>;

// CORRECT
return <span>{store.user.name}</span>;
```

Same reason as props. Stores are proxies. Destructuring kills tracking.

**Note:** This project does not use `createStore` — all state is managed via `createSignal` and `createResource`. The SolidJS store destructuring pitfall is documented for reference but is not exercised in this codebase.

## 3. Signal Getters Are Function Calls

```tsx
const [count, setCount] = createSignal(0);

// WRONG mental model: count is a value
console.log(count); // logs the getter function itself

// CORRECT
console.log(count()); // logs 0
```

In JSX, `{count()}` — always call the getter. If you see a signal name without
parentheses, it's a bug (unless you're passing the getter itself as a callback).

## 4. Use `<Show>` for Conditional Rendering, Not Ternaries

```tsx
// WORKS but re-creates the entire subtree on every toggle
{
  condition() ? <Heavy /> : <Other />;
}

// CORRECT — SolidJS caches the branches
<Show when={condition()} fallback={<Other />}>
  <Heavy />
</Show>;
```

Ternaries work but bypass SolidJS's branch caching. For cheap elements it doesn't
matter. For anything with state or effects, use `<Show>`.

## 5. `<For>` vs `<Index>` — Know the Difference

```tsx
// <For> — keyed by REFERENCE. Use for arrays of objects.
// Moves DOM nodes when items reorder. Item identity = reference equality.
<For each={entries()}>{(entry) => <EntryCard entry={entry} />}</For>

// <Index> — keyed by INDEX. Use for arrays of primitives.
// Updates content in place when values change. More efficient for primitives.
<Index each={scores()}>{(score, i) => <span>{score()}</span>}</Index>
```

**Rule of thumb:** objects → `<For>`, primitives → `<Index>`.

## 6. `splitProps` Before Spreading

```tsx
// BROKEN — passes `onClick` to the native <div>, might work but leaks logic props
function Card(props: { title: string; class?: string }) {
  return <div {...props}>{props.title}</div>; // `title` becomes an HTML attribute
}

// CORRECT
function Card(props: { title: string; class?: string }) {
  const [local, rest] = splitProps(props, ["title"]);
  return <div {...rest}>{local.title}</div>;
}
```

## 7. Effects Don't Run During SSR

`createEffect` only runs in the browser. If you ever add SSR, anything in
effects won't execute on the server. Design accordingly. For this project
we're SPA-only so this is informational.

## 8. `onMount` vs `createEffect`

- `onMount`: runs once after first render. Use for "component did mount" logic.
- `createEffect`: runs after first render AND re-runs when tracked dependencies change.

Don't use `createEffect` when you mean `onMount`. The extra re-runs are bugs waiting to happen.

## 9. `batch()` for Multiple Signal Updates

```tsx
// Two renders
setCount(1);
setName("foo");

// One render
batch(() => {
  setCount(1);
  setName("foo");
});
```

Inside event handlers SolidJS batches automatically. Outside (timers, async callbacks),
wrap in `batch()`.

## 10. Resources and Suspense

```tsx
const [entries] = createResource(feedId, fetchEntries);
```

- `entries()` returns `undefined` while loading. Always handle the loading state.
- `entries.loading` is a boolean signal.
- Wrap in `<Suspense>` to show a fallback while loading.
- `<ErrorBoundary>` catches resource errors.
- **Always** pair `createResource` with both `<Suspense>` and `<ErrorBoundary>`.

## 11. Refs Must Be Assigned, Not Initialized

```tsx
// WRONG
const ref = document.createElement("div");

// CORRECT
let ref!: HTMLDivElement;
return <div ref={ref} />;
```

The `!` (definite assignment assertion) is fine here — SolidJS assigns the ref synchronously during render.

## 12. Derived State — Just Use Functions

```tsx
// Don't do this (unnecessary signal)
const [doubled, setDoubled] = createSignal(count() * 2);
createEffect(() => setDoubled(count() * 2));

// Do this (plain derived computation)
const doubled = () => count() * 2;
```

If it can be computed from other signals, make it a function. Only use `createMemo`
if the computation is expensive and you need to cache the result.

---

# General Code Style

- No classes. Plain functions and objects. This isn't Java.
- Prefer `const` arrow functions for components: `const Card = (props: Props) => ...`
- One component per file unless tightly coupled (<100 lines together)
- File names: `kebab-case.ts` for modules, `PascalCase.tsx` for components
- Imports: no barrel files (`index.ts` re-exports). Import directly from the source file.
- No default exports. Named exports only. `export const Card = ...`
- Tests: colocated as `*.test.ts` next to the source file
- No `console.log` in committed code. Use `console.debug` for dev logging; use Bun's built-in `console` for production.

# Performance Targets

- Feed page load: <100ms for cached data, <500ms for fresh fetch
- SQLite query for "top 50 entries ranked": <5ms
- Feed fetch + parse: <2s per feed (timeout at 30s)
- Embedding tagging: <5 seconds for a batch of 64 articles (async job)
- Web UI bundle: <100KB gzipped (SolidJS helps — it's 7KB)

# Security

- Server binds to `0.0.0.0` (Docker compose maps to localhost)
- No `curl | sh`, no `wget | bash`
- Dependencies pinned with lockfile hashes
- Docker images pinned to digest
- Non-root user in containers
- `read_only: true` filesystem where possible
- No secrets in environment variables (there are none — it's fully local)
- CSP headers on the web UI
- Fever API uses API key auth (generated on first boot, stored in SQLite)


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
