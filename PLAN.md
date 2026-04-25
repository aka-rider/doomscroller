# Doomscroller: Self-Hosted AI-Filtered RSS Reader

## The Problem

Information firehose. 500 RSS items/day, 480 are noise. Sports, fashion, celebrity drama, beginner tutorials rehashing the same 5 concepts. You want signal: geopolitics that matters, markets moving, real engineering, serious science, and art that isn't AI-generated slop.

Current solutions either: (a) require cloud accounts and phone-home telemetry, (b) have no intelligence beyond "show me everything chronologically", or (c) bolt on OpenAI API calls and leak your reading habits to Sam Altman.

## The Goal

A fully local, Docker-only RSS reader that:

- Collects feeds from any RSS/Atom source
- Runs a local LLM to classify, rank, and filter content
- Learns your preferences: what you read, what you skip, what you save
- Presents a clean web UI and exposes a standard API for mobile clients
- Stores everything in SQLite because localhost networking overhead for a single-user app is clown engineering

---

## Stack

| Layer         | Technology                                         |
| ------------- | -------------------------------------------------- |
| Runtime       | Bun                                                |
| API framework | Hono                                               |
| Frontend      | SolidJS + Vite                                     |
| Database      | SQLite (WAL mode, via `bun:sqlite`)                |
| LLM inference | llama.cpp server (OpenAI-compatible API)           |
| LLM model     | Gemma 4 E4B (unsloth Q4_K_M, 4.98 GB)             |
| Embeddings    | Nomic Embed Text v2 MoE (GGUF Q4_K_M, 328 MB)    |
| Vector store  | LanceDB (embedded, via `@lancedb/lancedb`)         |
| Container     | Docker Compose (three containers)                  |

**Why this stack:**

- **Bun** — fast runtime, native SQLite driver, runs TypeScript directly (no transpile step for server)
- **Hono** — lightweight, fast, middleware ecosystem (CSP headers, CORS), runs anywhere Bun runs
- **SolidJS** — 7KB runtime, fine-grained reactivity without virtual DOM overhead. Keeps bundle <100KB gzipped.
- **llama.cpp** — direct GGUF model loading, no Ollama abstraction layer, one fewer container. OpenAI-compatible API means the client code is standard.
- **Gemma 4 E4B** — best instruction-following at ~4B effective params. 128K context window. Structured JSON output via json_schema mode. The sanest default for local LLM in 2026.
- **Nomic Embed v2 MoE** — 475M total / 305M active params, MoE architecture, ~100 languages, SoTA multilingual retrieval at its size class. GGUF Q4_K_M is only 328MB. Apache 2.0. Runs natively in llama.cpp with `--embeddings`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  docker compose up                                       │
│                                                          │
│  ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │  doomscroller        │    │  llm (llama.cpp)         │  │
│  │  (Bun)               │───▶│  Gemma 4 E4B             │  │
│  │                      │    │  /v1/chat/completions    │  │
│  │  Hono API            │    └─────────────────────────┘  │
│  │  SolidJS (static)    │                                 │
│  │  Feed fetcher        │    ┌─────────────────────────┐  │
│  │  Job queue           │───▶│  embeddings (llama.cpp)  │  │
│  │  Fever API           │    │  Nomic Embed v2 MoE     │  │
│  │       │              │    │  /v1/embeddings          │  │
│  │  ┌────┴────┐         │    └─────────────────────────┘  │
│  │  │ SQLite  │         │                                 │
│  │  │ (WAL)   │         │                                 │
│  │  └─────────┘         │                                 │
│  └──────────────────────┘                                 │
└──────────────────────────────────────────────────────────┘
```

Three containers. One SQLite file. No Postgres, no Redis, no message queues.

---

## Data Model (SQLite)

```sql
-- Feeds the user subscribes to
CREATE TABLE feeds (
    id                  INTEGER PRIMARY KEY,
    url                 TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL DEFAULT '',
    site_url            TEXT NOT NULL DEFAULT '',
    description         TEXT NOT NULL DEFAULT '',
    etag                TEXT,
    last_modified       TEXT,
    last_fetched_at     INTEGER,
    fetch_interval_min  INTEGER NOT NULL DEFAULT 30,
    error_count         INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

-- User-defined categories. LLM classifies entries into these.
CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    slug        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_auto     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Many-to-many: feeds belong to categories
CREATE TABLE feed_categories (
    feed_id     INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (feed_id, category_id)
);

-- Individual items from feeds
CREATE TABLE entries (
    id              INTEGER PRIMARY KEY,
    feed_id         INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid            TEXT NOT NULL,
    url             TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    author          TEXT NOT NULL DEFAULT '',
    content_html    TEXT NOT NULL DEFAULT '',
    summary         TEXT NOT NULL DEFAULT '',
    image_url       TEXT,
    published_at    INTEGER,
    fetched_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    is_read         INTEGER NOT NULL DEFAULT 0,
    is_starred      INTEGER NOT NULL DEFAULT 0,
    is_hidden       INTEGER NOT NULL DEFAULT 0,
    UNIQUE(feed_id, guid)
);

-- LLM classification scores. One row per entry, written async by scorer.
CREATE TABLE entry_scores (
    entry_id        INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    relevance       REAL NOT NULL DEFAULT 0.5,
    depth           REAL NOT NULL DEFAULT 0.5,
    novelty         REAL NOT NULL DEFAULT 0.5,
    category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    reasoning       TEXT NOT NULL DEFAULT '',
    model           TEXT NOT NULL DEFAULT '',
    scored_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Entry can belong to multiple categories with confidence scores
CREATE TABLE entry_categories (
    entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    confidence  REAL NOT NULL DEFAULT 0.5,
    PRIMARY KEY (entry_id, category_id)
);

-- User preference profile as key-value JSON blobs
CREATE TABLE preferences (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Implicit feedback: reading behavior signals
CREATE TABLE interactions (
    id              INTEGER PRIMARY KEY,
    entry_id        INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    duration_sec    INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Background job queue (SQLite-backed, no external dependencies)
CREATE TABLE jobs (
    id              INTEGER PRIMARY KEY,
    type            TEXT NOT NULL,
    payload         TEXT NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending',
    priority        INTEGER NOT NULL DEFAULT 0,
    run_after       INTEGER NOT NULL DEFAULT (unixepoch()),
    started_at      INTEGER,
    completed_at    INTEGER,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    error           TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- App-wide key-value config (fever api key, etc.)
CREATE TABLE config (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- Migration tracking
CREATE TABLE _migrations (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

---

## LLM Classification Strategy

### Model: Gemma 4 E4B (via llama.cpp)

- **HuggingFace repo:** `unsloth/gemma-4-E4B-it-GGUF`
- **GGUF file:** `gemma-4-E4B-it-Q4_K_M.gguf` (4.98 GB)
- **Architecture:** gemma4 — 8B total params, 4.5B effective (Per-Layer Embeddings)
- **Context window:** 128K tokens
- **Served via:** llama.cpp server (`ghcr.io/ggml-org/llama.cpp:server`)
- **API name in requests:** `gemma-4`

Why E4B and not smaller: Classification + structured JSON extraction benefits from the instruction-following quality at 4.5B effective params. The 128K context window is critical for graph-context-enriched classification prompts. Memory footprint ~5GB — fine for any machine with 16GB+ RAM.

Upgrade path: swap the GGUF file and update `LLM_MODEL` env var. The prompt and pipeline don't change.

### Embeddings Model: Nomic Embed Text v2 MoE (via llama.cpp)

- **HuggingFace repo:** `nomic-ai/nomic-embed-text-v2-moe-GGUF`
- **GGUF file:** `nomic-embed-text-v2-moe.Q4_K_M.gguf` (328 MB)
- **Architecture:** MoE — 475M total params, 305M active (8 experts, top-2 routing)
- **Dimensions:** 768 (supports Matryoshka truncation down to 256)
- **Max sequence length:** 512 tokens
- **Languages:** ~100 (trained on 1.6B multilingual pairs)
- **Served via:** separate llama.cpp instance with `--embeddings` flag
- **API endpoint:** `/v1/embeddings` (OpenAI-compatible)

Why a dedicated embedding model instead of reusing Gemma for embeddings: purpose-built embedding models produce dramatically better vector representations for similarity search, dedup, and novelty detection. Nomic v2 MoE is SoTA at its size class on both BEIR (English) and MIRACL (multilingual), and at 328MB Q4_K_M it's negligible overhead.

**Task prefixes required:**

- Queries: `search_query: <text>`
- Documents: `search_document: <text>`

**Use cases in Doomscroller:**

- **Novelty detection:** embed new entry summaries, compare against recent entries via cosine similarity. Flag near-duplicates and "same story, different outlet" clusters.
- **Preference learning:** embed user's starred/read entries to build an implicit interest vector. Compare new entries against this vector for relevance scoring without LLM calls.
- **Similar articles:** "more like this" feature — find entries with high embedding similarity.
- **Semantic dedup:** catch entries that are substantively identical but have different GUIDs (syndicated content, reposts).

### Classification Prompt (per entry)

```
You are a content classifier for a news/tech reader. Given an article's title and summary,
produce a JSON response with these fields:

- category: one of {user's category list}
- secondary_categories: array of 0-2 additional categories
- relevance: 0.0-1.0 score based on the user's interest profile below
- depth: 0.0-1.0 where 0 is "beginner explainer" and 1 is "assumes deep domain expertise"
- novelty: 0.0-1.0 where 0 is "widely reported, nothing new" and 1 is "breaking/unique angle"
- reasoning: one sentence explaining the score

USER INTEREST PROFILE:
{serialized preferences}

ARTICLE:
Title: {title}
Source: {feed_title}
Summary: {first 500 chars of plain text}

Respond with ONLY valid JSON, no markdown.
```

### Batch Processing

Entries are scored asynchronously via a SQLite-backed job queue:

1. Feed poller fetches new entries every 30 minutes
2. New entries land in `entries` table with no score
3. Scorer worker (runs every 5 minutes) queries `entries LEFT JOIN entry_scores WHERE entry_scores.entry_id IS NULL`
4. Processes entries one-by-one through llama.cpp's `/v1/chat/completions` endpoint
5. LLM output is validated with Zod before writing to `entry_scores` and `entry_categories`
6. If LLM returns garbage, the entry stays unscored with a default mid-range relevance (0.5)

### Auto-Categories

When a new feed is added:

1. Fetch the first batch of entries
2. Ask the LLM: "Given these article titles from {feed_title}, suggest 1-3 categories from the existing list, or propose new ones if none fit"
3. Create new categories with `is_auto=1`
4. User can rename, merge, or delete auto-categories

### Preference Learning (Phase 3)

Track implicit signals:

- **Read** (opened the article): mild positive signal
- **Starred**: strong positive signal
- **Time spent**: >30 seconds = engaged, <5 seconds = bounced
- **Skipped**: scrolled past without opening = mild negative

Periodically summarize interaction patterns and update the preference profile via LLM.

---

## Default Categories (seeded on first boot)

| Category      | Description                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| Geopolitics   | International relations, foreign policy, diplomacy, conflicts, treaties     |
| Markets       | Financial markets, economics, trading, monetary policy, fiscal policy       |
| Engineering   | Software engineering, systems programming, distributed systems, databases   |
| Science       | Physics, biology, chemistry, mathematics, academic research, papers         |
| Technology    | Tech industry, products, AI/ML, startups, open source                      |
| Art & Culture | Visual art, design, architecture, music, literature, creative technology   |
| Long Reads    | In-depth investigative journalism, essays, analysis pieces                  |

---

## Docker Compose Topology

```yaml
services:
  # One-time model downloader — exits after models are cached in the volume
  model-init:
    image: ghcr.io/ggml-org/llama.cpp:server
    volumes:
      - models:/models
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        if [ ! -f /models/gemma-4-E4B-it-Q4_K_M.gguf ]; then
          wget -O /models/gemma-4-E4B-it-Q4_K_M.gguf <HF_URL>
        fi
        if [ ! -f /models/nomic-embed-text-v2-moe.Q4_K_M.gguf ]; then
          wget -O /models/nomic-embed-text-v2-moe.Q4_K_M.gguf <HF_URL>
        fi
    restart: "no"

  doomscroller:
    build: .
    ports:
      - "127.0.0.1:6767:6767"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=6767
      - DATA_DIR=/app/data
      - LLM_BASE_URL=http://llm:8081
      - LLM_MODEL=gemma-4
      - EMBEDDINGS_BASE_URL=http://embeddings:8082
    depends_on:
      model-init:
        condition: service_completed_successfully
      llm:
        condition: service_started
      embeddings:
        condition: service_started
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp

  llm:
    image: ghcr.io/ggml-org/llama.cpp:server
    volumes:
      - models:/models:ro
    depends_on:
      model-init:
        condition: service_completed_successfully
    command: >
      --host 0.0.0.0
      --port 8081
      --model /models/gemma-4-E4B-it-Q4_K_M.gguf
      --ctx-size 8192
      --threads 4
      --batch-size 512
      --n-predict 512
    restart: unless-stopped

  embeddings:
    image: ghcr.io/ggml-org/llama.cpp:server
    volumes:
      - models:/models:ro
    depends_on:
      model-init:
        condition: service_completed_successfully
    command: >
      --host 0.0.0.0
      --port 8082
      --model /models/nomic-embed-text-v2-moe.Q4_K_M.gguf
      --ctx-size 512
      --threads 2
      --batch-size 512
      --embeddings
    restart: unless-stopped

volumes:
  models:
    driver: local
```

Four services, three long-running. No reverse proxy, no Redis, no message queue, no Kubernetes.

**Model bootstrap:** A `model-init` service runs on first `docker compose up`. It downloads both GGUF files from HuggingFace into a Docker named volume (`models`), then exits. Subsequent starts skip the download — the volume persists across restarts. The `llm` and `embeddings` services mount this volume read-only and depend on `model-init` completing successfully. No host-side tools needed beyond Docker.

---

## Security Posture

### Network

- All ports bound to `127.0.0.1`. Nothing exposed to LAN by default.
- No inbound connections needed. All outbound is RSS fetches.
- llama.cpp containers only reachable via Docker internal network (plus localhost 8081/8082 for debugging).
- If you want LAN access, add a reverse proxy with basic auth. Not default.

### Container

- Non-root user in Dockerfile (`doomscroller` user).
- Read-only filesystem (`read_only: true` + tmpfs for `/tmp`).
- No `privileged`, no `cap_add`, no `--net=host`.
- Healthcheck on the main container.
- No `curl | sh` anywhere.

### Data

- SQLite file on a bind mount (`./data/`). Backup = copy one file.
- Fever API uses API key auth (generated on first boot, stored in SQLite config table).
- CSP headers via Hono's `secureHeaders()` middleware.
- No telemetry, no analytics, no phoning home.

### Supply Chain

- Bun lockfile with pinned hashes.
- Docker base image: `oven/bun:1` / `oven/bun:1-slim`. **TODO:** Pin to digest for reproducibility.
- llama.cpp image from `ghcr.io/ggml-org/llama.cpp:server`. **TODO:** Pin to digest.
- Model file **not yet** verified by SHA256 — see Pre-Launch Blockers.

---

## UI

**SolidJS SPA + Vite build.** Static files served by Hono.

Pages:

1. **Feed** — the main view. Entries sorted by (relevance × recency), grouped by category. Color-coded relevance bars. Click to read. Keyboard navigation (j/k/o/s).
2. **Sources** — manage feeds. Add URL, see last fetch status, error count. OPML import/export.
3. **Categories** — manage categories. Rename, merge, delete, reorder.
4. **Preferences** — the interest profile in plain text. Edit directly.
5. **Stats** — read/skip ratios by category, score distribution, model performance.

Mobile: Fever API for native apps (Reeder, NetNewsWire, Unread). The web UI is also responsive.

---

## Job Queue Design

SQLite-based. No external dependencies.

- Workers poll with `UPDATE ... SET status='running' WHERE status='pending' AND run_after <= now LIMIT 1 RETURNING *`
- Atomic — SQLite single-writer guarantees no double-claim
- Failed jobs retry with exponential backoff
- Job types: `fetch_feed`, `score_batch`, `cleanup`
- Poll interval: 1 second
- Feed fetches: every 30 minutes
- Scoring: every 5 minutes
- Cleanup: daily (removes 7-day-old jobs, 30-day-old read entries)

---

## Feed Fetching

- Respect `ETag` and `If-Modified-Since` headers — don't re-download unchanged feeds
- Timeout: 30 seconds per feed
- Dedup by `(feed_id, guid)`
- Parse with a robust RSS/Atom parser. Normalize to a common `Entry` shape.
- Strip HTML for the `summary` field (plain text for LLM). Keep `content_html` for display.
- Feeds seeded on first boot with a curated starter list

---

## API Design

Two APIs:

1. **Main API** (`/api/*`) — JSON REST for the SolidJS frontend
2. **Fever API** (`/fever/*`) — implements Fever protocol for native RSS clients

The Fever API is read-heavy and must be fast. It's mostly `SELECT` queries on indexed columns.

Fever auth: username `doomscroller`, password is the generated API key.

---

## Implementation Phases

### Phase 1: Core Loop ✅

- [x] SQLite schema, WAL mode, pragmas, migrations
- [x] Feed polling + entry storage with ETag/If-Modified-Since
- [x] RSS/Atom parser with entry normalization
- [x] llama.cpp integration + classification prompt
- [x] Batch scorer with Zod validation
- [x] SQLite-backed job queue (poll, claim, complete, fail)
- [x] Minimal SolidJS web UI: list entries, mark as read
- [x] Hono API routes for feeds, entries, categories
- [x] Docker Compose with llama.cpp container
- [x] Fever API for mobile clients
- [x] Auto-category suggestions on feed add

### Phase 2: Categories + Preferences ✅

- [x] User-defined categories with LLM descriptions
- [x] Category-filtered views
- [x] Preference profile editing UI
- [x] OPML import/export
- [x] Keyboard navigation (j/k/o/s)

### Phase 3: Embeddings + Learning

- [ ] Embeddings container integration (Nomic Embed v2 MoE)
- [ ] LanceDB integration for vector storage (see Resolved Design Decisions)
- [ ] Entry embedding pipeline (embed on fetch, store in LanceDB)
- [ ] Novelty detection via cosine similarity (flag near-dupes)
- [ ] Semantic dedup for syndicated content
- [ ] Interaction tracking (read, star, skip, time spent)
- [ ] Implicit interest vector from starred/read embeddings
- [ ] Weekly preference profile updates from behavior
- [ ] Score calibration based on feedback loop
- [ ] "Why this score?" tooltip from LLM reasoning field
- [ ] "More like this" similar articles feature

### Pre-Launch Blockers (must fix before v1)

These items are required for a credible v1 release. They are currently unimplemented.

- [ ] Add `"test": "bun test"` to server/package.json and `"test": "bun run --filter server test"` to root package.json
- [ ] Add `make test` target to Makefile
- [ ] Model SHA256 verification on download in model-init container
- [ ] Pin `@types/bun` to specific version (not `latest`) — currently breaks reproducible builds
- [ ] Remove dead `html-to-text` dependency from server/package.json
- [ ] Pin Docker base images to digest (`oven/bun`, `ghcr.io/ggml-org/llama.cpp`)

### v1 GitHub Launch Checklist

- [ ] LICENSE file (MIT or AGPL-3.0)
- [ ] CONTRIBUTING.md (dev setup, test commands, PR process)
- [ ] GitHub Actions CI (`bun install`, `bun test`, `tsc --noEmit` on push/PR)
- [ ] Tighten `.gitignore` (add `.env`, `*.tmp`)
- [ ] Smoke test: `make up` on clean machine → feeds load, scoring runs, Fever auth works

### Phase 4: Polish

- [ ] Stats dashboard (read/skip ratios, score distribution)
- [ ] Feed error management UI
- [ ] Mobile-responsive refinements
- [ ] RSS-Bridge integration for Telegram/Reddit/YouTube

---

## Resolved Design Decisions

### Gemma 2B vs. bigger model?

**Decision: Gemma 4 E4B (4.5B effective params).** The 2B floor was too low for nuanced relevance scoring — "this article is about international politics but it's superficial gossip-tier" requires understanding that small models miss. Gemma 4 E4B is the sweet spot: excellent instruction-following, 128K context, structured JSON output, ~5GB on disk.

### HTMX vs. SPA?

**Decision: SolidJS SPA.** A feed reader is interactive — infinite scroll, keyboard shortcuts, real-time updates, category switching. HTMX becomes `hx-swap` spaghetti for this. SolidJS is 7KB, fine-grained reactivity, and Vite gives a proper dev experience. The bundle stays under 100KB gzipped.

### Single container vs. separate scorer?

**Decision: Single process with job queue.** The scorer runs as async jobs within the main Bun process. For a single-user app, separating the scorer adds complexity with no benefit. The SQLite job queue provides isolation — if scoring fails, it retries without affecting the API.

### Ollama vs. llama.cpp directly?

**Decision: llama.cpp directly.** Ollama adds an abstraction layer (another container, model management API) that provides nothing we need. llama.cpp's server mode exposes the same OpenAI-compatible API. One fewer moving part. Model file management is handled by a Makefile target.

### How aggressive should filtering be?

**Decision: Hybrid.** Default view sorted by relevance. Low-score items are at the bottom but accessible. No hard cutoff — the user can always see what was deprioritized and why. The point is to reduce noise, not create a filter bubble.

### Python vs. TypeScript?

**Decision: Bun + TypeScript.** The original plan proposed Python/FastAPI. TypeScript won because: (a) one language for server + client, (b) Bun's native SQLite driver is faster than Python's, (c) strict types catch bugs at compile time, (d) SolidJS frontend is TypeScript anyway.

### Where do embeddings vectors go?

**Decision: LanceDB (embedded mode).** SQLite has no native vector type, and bolting on `sqlite-vec` or storing BLOBs with application-side cosine similarity is fragile. LanceDB runs embedded in the Bun process (via `@lancedb/lancedb`), stores data on the local filesystem alongside the SQLite file (`./data/lancedb/`), and provides native ANN search with IVF-PQ indexing. No extra container, no network calls, no external service. Backup = copy the `data/` directory. Schema:

```
Table: entry_embeddings
  entry_id: int64 (unique)
  vector: fixed_size_list[float32, 768]
  embedded_at: int64 (unixepoch)
```

Nomic Embed v2 MoE produces 768-dim vectors. LanceDB handles similarity search natively. Matryoshka truncation to 256 dims is available if storage becomes a concern, but at ~3KB per entry (768 × 4 bytes) it won't for any reasonable feed count.
