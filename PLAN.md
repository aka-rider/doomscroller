# Doomscroller: Self-Hosted AI-Filtered RSS Reader

## The Problem

Information firehose. 500 RSS items/day, 480 are noise. Sports, fashion, celebrity drama, beginner tutorials rehashing the same 5 concepts. You want signal: geopolitics that matters, markets moving, real engineering, serious science, and art that isn't AI-generated slop.

Current solutions either: (a) require cloud accounts and phone-home telemetry, (b) have no intelligence beyond "show me everything chronologically", or (c) bolt on OpenAI API calls and leak your reading habits to Sam Altman.

## The Goal

A fully local, Docker-only RSS reader that:

- Is an excellent RSS reader first. Fetches, parses, deduplicates, serves via web UI and Fever API.
- Uses a local LLM to **tag** every article from a set of ~35 built-in tags (users can also create custom tags)
- Lets the user **whitelist or blacklist** tags to control what they see — whitelist wins over blacklist
- Shows tags transparently on every entry — the user always sees why an article is there
- Stores everything in SQLite because localhost networking overhead for a single-user app is clown engineering

The magic is simple: LLM tags articles, user whitelists/blacklists tags, feed filters accordingly. Tags are always visible on every entry card.

---

## Stack

| Layer         | Technology                                         |
| ------------- | -------------------------------------------------- |
| Runtime       | Bun                                                |
| API framework | Hono                                               |
| Frontend      | SolidJS + Vite                                     |
| Database      | SQLite (WAL mode, via `bun:sqlite`)                |
| LLM inference | llama.cpp server (OpenAI-compatible API)           |
| Classifier    | Gemma 4 E4B (unsloth Q4_K_M, 4.98 GB)             |
| Embeddings    | Nomic Embed v2 MoE (Phase 3)                      |
| Container     | Docker Compose (2 long-running + 1 bootstrap)    |

**Why this stack:**

- **Bun** — fast runtime, native SQLite driver, runs TypeScript directly (no transpile step for server)
- **Hono** — lightweight, fast, middleware ecosystem (CSP headers, CORS), runs anywhere Bun runs
- **SolidJS** — 7KB runtime, fine-grained reactivity without virtual DOM overhead. Keeps bundle <100KB gzipped.
- **llama.cpp** — direct GGUF model loading, no Ollama abstraction layer, one fewer container. OpenAI-compatible API means the client code is standard.
- **Gemma 4 E4B** — best instruction-following at ~4B effective params. 128K context window. Structured JSON output via json_schema mode. Assigns tags from a known list + recognizes user-defined tags.

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
│  │  Fever API           │    │  Nomic Embed v2 MoE      │  │
│  │       │              │    │  /v1/embeddings          │  │
│  │  ┌────┴────┐         │    └─────────────────────────┘  │
│  │  │ SQLite  │         │                                 │
│  │  │ (WAL)   │         │                                 │
│  │  └─────────┘         │                                 │
│  └──────────────────────┘                                 │
└──────────────────────────────────────────────────────────┘
```

Three long-running containers (plus one ephemeral model downloader). One SQLite file. No Postgres, no Redis, no message queues.

> **Note:** The `embeddings` container is only needed from Phase 3 onward. Until then, `docker-compose.yml` should omit or comment out the `embeddings` service to avoid downloading an unused model and wasting RAM.

---

## Data Model (SQLite)

```sql
-- Feed groups for the feed tree sidebar. Flat (no nesting).
CREATE TABLE feed_groups (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Feeds the user subscribes to
CREATE TABLE feeds (
    id                  INTEGER PRIMARY KEY,
    url                 TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL DEFAULT '',
    site_url            TEXT NOT NULL DEFAULT '',
    description         TEXT NOT NULL DEFAULT '',
    group_id            INTEGER REFERENCES feed_groups(id) ON DELETE SET NULL,
    etag                TEXT,
    last_modified       TEXT,
    last_fetched_at     INTEGER,
    fetch_interval_min  INTEGER NOT NULL DEFAULT 30,
    error_count         INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tags. ~35 built-in tags seeded on first boot. LLM can propose new tags.
-- The LLM always sees the top 100 tags by use_count, plus any tags the
-- user has whitelisted or blacklisted (guaranteed in prompt). Built-in tags get a
-- jumpstart (use_count = 1000) so they dominate early. LLM-proposed tags
-- start at 1 and earn their way in. Users can also create tags manually.
CREATE TABLE tags (
    id          INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,       -- 'politics', 'sports', 'rust', etc.
    label       TEXT NOT NULL,              -- 'Politics', 'Sports', 'Rust'
    tag_group   TEXT NOT NULL DEFAULT '',   -- display grouping: 'news', 'tech', 'science', 'sports', 'culture', 'meta', 'proposed', 'custom'
    is_builtin  INTEGER NOT NULL DEFAULT 0, -- 1 = seeded on first boot, 0 = LLM-proposed or user-created
    use_count   INTEGER NOT NULL DEFAULT 0, -- number of entries tagged with this. Built-in tags seeded at 1000.
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Many-to-many: tags per entry. LLM assigns built-in tags; user can manually add any tag.
CREATE TABLE entry_tags (
    entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source      TEXT NOT NULL DEFAULT 'llm',  -- 'llm' | 'user'
    PRIMARY KEY (entry_id, tag_id)
);

-- Per-tag user preference: whitelist, blacklist, or neutral (default).
-- Whitelist overrides blacklist: if an entry has ANY whitelisted tag, it shows
-- regardless of blacklisted tags. An entry is hidden only if it has NO
-- whitelisted tags AND ALL its tags are blacklisted.
CREATE TABLE tag_preferences (
    tag_id      INTEGER PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
    mode        TEXT NOT NULL DEFAULT 'none',  -- 'whitelist' | 'blacklist' | 'none'
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
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
    tagged_at       INTEGER,                    -- NULL = not yet tagged by LLM
    UNIQUE(feed_id, guid)
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

-- App-wide key-value config (fever api key, onboarding state, etc.)
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

## LLM Tag Assignment

### Model: Gemma 4 E4B (via llama.cpp)

- **HuggingFace repo:** `unsloth/gemma-4-E4B-it-GGUF`
- **GGUF file:** `gemma-4-E4B-it-Q4_K_M.gguf` (4.98 GB)
- **Served via:** `llm` container running llama.cpp

The LLM has one job: read an article, assign 1-5 tags from the prompt tag list (top 100 by usage + all whitelisted/blacklisted tags). It can also propose new tags that don't exist yet.

### Chunked Tagging (OOM-Safe)

Content is processed incrementally. The model reads a chunk and either tags confidently or requests more context.

**Protocol:**

1. Content is split into chunks of ~4000 characters (~1000 tokens)
2. First request: title + feed source + first chunk
3. Model responds with either:
   - `{"confident": true, "tags": ["politics", "war-conflict"], ...}` → done
   - `{"confident": false}` → send next chunk
4. If not confident, next request includes title + feed source + accumulated chunks
5. **Hard cap: 3 chunks.** After the third chunk, the model must produce tags regardless.
6. If content fits in a single chunk, it's a single-pass tag assignment.

**OOM Prevention Guarantees:**

- `--ctx-size 8192` hard limit on llama.cpp server
- System prompt + tag list: ~400 tokens (top 100 by use_count + preferenced tags, ~250-300 tokens for slugs)
- Per chunk: ~1000 tokens. Max 3 chunks: ~3000 tokens input
- Max output (`--n-predict 512`): 512 tokens
- **Worst case total: ~3900 tokens** — well under 50% of context budget

### Tag Assignment Prompt

```
You are a content tagger. Given an article, assign 1-5 tags.

Pick from these known tags (preferred):
TAGS: {prompt_tags}

You MAY also propose up to 2 NEW tags if none of the above fit well.
New tags must be lowercase, hyphenated slugs (e.g., "home-automation").

If you have enough context to tag confidently, respond with:
{"confident": true, "tags": ["tag1", "tag2"], "new_tags": ["optional-new-slug"]}

If you need more context, respond with:
{"confident": false}

ARTICLE:
Title: {title}
Source: {feed_title}
Content (chunk {n} of up to 3):
{chunk_text}

Respond with ONLY valid JSON, no markdown.
```

`{prompt_tags}` is built dynamically at tagger startup:

```sql
-- Union of top 100 by popularity + all user-preferenced tags (whitelist/blacklist)
SELECT slug FROM tags WHERE id IN (
  SELECT id FROM tags ORDER BY use_count DESC LIMIT 100
  UNION
  SELECT tag_id FROM tag_preferences WHERE mode != 'none'
)
ORDER BY use_count DESC
```

The prompt refreshes every tagging cycle (5 min). Built-in tags dominate early (jumpstart `use_count = 1000`), LLM-proposed tags earn their way in, and whitelisted/blacklisted tags are **always present** regardless of rank — the user's filtering intent must be respected by the tagger.

### Batch Processing

1. Feed poller fetches new entries every 30 minutes
2. New entries land in `entries` table with `tagged_at = NULL`
3. Tagger worker (runs every 5 minutes):
   a. Refreshes the tag prompt: top 100 by `use_count` UNION all whitelisted/blacklisted tags
   b. Queries `SELECT * FROM entries WHERE tagged_at IS NULL LIMIT 20`
4. For each entry, runs the chunked tag assignment (1–3 LLM calls)
5. LLM output validated with Zod:
   - `tags[]` — matched against existing `tags` table. Each match increments `use_count`.
   - `new_tags[]` — validated as lowercase hyphenated slugs. Created in `tags` table with `is_builtin = 0`, `tag_group = 'proposed'`, `use_count = 1`. Duplicates silently ignored.
6. Writes to `entry_tags` table (source: `'llm'`), sets `tagged_at` on the entry.
7. Untagged entries remain visible in the feed — they just can't be filtered yet.

---

## Tags

### Tag Economy

Tags are a living pool. ~35 built-in tags are seeded on first boot with a high `use_count` (1000) so they dominate early. The LLM can propose new tags — these start at `use_count = 1` and earn their way up. Users can also create custom tags manually.

**The top-100 rule:** The LLM prompt contains the top 100 tags by `use_count` **plus any whitelisted or blacklisted tags** (guaranteed, regardless of rank). Refreshed every tagging cycle. This means:

- Built-in tags are always in the prompt early on (jumpstart = 1000)
- LLM-proposed tags that prove useful accumulate `use_count` and naturally enter the top 100
- Stale or one-off proposed tags fall below the top 100 and stop being assigned (but remain in the DB)
- User-created tags get `use_count = 500` (half of built-in) so they appear in the prompt immediately but can be overtaken
- **Whitelisted/blacklisted tags are always in the prompt** — if the user cares enough to preference a tag, the LLM must always consider it, even if its `use_count` is low

**Tag sources:**

- **Built-in** (`is_builtin = 1`) — seeded, `use_count = 1000`, grouped by topic
- **LLM-proposed** (`is_builtin = 0`, `tag_group = 'proposed'`) — created during tagging, `use_count = 1`
- **User-created** (`is_builtin = 0`, `tag_group = 'custom'`) — created in Settings, `use_count = 500`

**`use_count` increments:** Every time a tag is assigned to an entry (by LLM or user), its `use_count` is incremented by 1. This is the only signal. No decay, no time-weighting — raw popularity.

The LLM assigns tags. The user whitelists or blacklists tags. That's the entire model.

**Three states per tag:**

- **None** (default) — neutral. Entry visibility not affected by this tag.
- **Whitelist** — if ANY of an entry's tags are whitelisted, the entry is always shown.
- **Blacklist** — if ALL of an entry's tags are blacklisted (and none whitelisted), the entry is hidden.

**Precedence:** whitelist > blacklist > none. A single whitelisted tag on an entry overrides any number of blacklisted tags.

### Built-in Tags (~35, seeded at `use_count = 1000`)

| Group | Tag | Slug |
|-------|-----|------|
| **News** | Politics | `politics` |
| **News** | Geopolitics | `geopolitics` |
| **News** | War & Conflict | `war-conflict` |
| **News** | Economics | `economics` |
| **News** | Environment & Climate | `environment` |
| **News** | Health & Medicine | `health` |
| **Tech** | Programming | `programming` |
| **Tech** | Technology | `technology` |
| **Tech** | Gadgets & Hardware | `gadgets` |
| **Tech** | AI & Machine Learning | `ai-ml` |
| **Tech** | Cybersecurity | `cybersecurity` |
| **Tech** | Open Source | `open-source` |
| **Tech** | Apple / iOS | `apple` |
| **Tech** | Android / Mobile | `android` |
| **Tech** | Startups & VC | `startups` |
| **Tech** | Crypto & Web3 | `crypto` |
| **Science** | Science | `science` |
| **Science** | Space & Astronomy | `space` |
| **Sports** | Sports | `sports` |
| **Culture** | Gaming | `gaming` |
| **Culture** | Movies & TV | `movies-tv` |
| **Culture** | Music | `music` |
| **Culture** | Celebrity | `celebrity` |
| **Culture** | Fashion & Style | `fashion` |
| **Culture** | Food & Drink | `food` |
| **Culture** | Travel | `travel` |
| **Meta** | Opinion & Editorial | `opinion` |
| **Meta** | Tutorial & How-to | `tutorial` |
| **Meta** | Long Read | `long-read` |
| **Meta** | Humor | `humor` |
| **Meta** | Press Release | `press-release` |
| **Meta** | Deals & Sales | `deals` |

**Tag groups** exist for visual layout during onboarding and in the tag sidebar. Stored as `tag_group` column on the `tags` row. The LLM never sees groups; it only sees the flat slug list sorted by `use_count`.

**Filtering logic:** Whitelist > blacklist > none.

1. If an entry has ANY whitelisted tag → **always shown** (regardless of other tags)
2. If an entry has NO whitelisted tags AND ALL tags are blacklisted → **hidden**
3. Otherwise (has at least one neutral tag, or untagged) → **shown**
4. Untagged entries are always shown.

**Tag visibility in UI:** Every tag in the system is visible in the tag sidebar, grouped by `tag_group`. Tags show their `use_count` as a secondary label. LLM-proposed tags with low usage appear in a "Proposed" group. Users can promote a proposed tag (set `tag_group` to a real group), delete it, or whitelist/blacklist it like any other tag.

**User-created tags:** Users can create custom tags in Settings. Custom tags get `is_builtin = 0`, `tag_group = 'custom'`, `use_count = 500` (ensures they enter the top 100 immediately). Users can manually assign any tag (built-in, proposed, or custom) to any entry via the UI.

---

## Curated Feeds (verified working 2026-04-25)

55 feeds. Every URL verified via `curl` → HTTP 200 + valid RSS/Atom XML.

**NO NYT. NO WaPo. NO Reuters (all public RSS endpoints dead since ~2024). NO Metacritic (HTTP 410 Gone).**

### Sourcing strategy for dead/paywalled feeds

Some major outlets have killed public RSS. Strategy:

- **Reuters**: Dead. All endpoints return 404/401/timeout. No known working proxy. Omitted entirely. BBC World + Al Jazeera + The Guardian cover the same wire-service role.
- **AP News**: No official RSS. Third-party proxy `feedx.net/rss/ap.xml` exists but reliability unknown — not included in defaults. Users can add manually.
- **Metacritic**: HTTP 410 Gone. No replacement RSS. GameSpot + IGN cover gaming reviews.
- **The Athletic**: Returns HTML, not RSS (paywall). BBC Sport + Guardian Sport + ESPN cover sports.
- **Self-hosted RSSHub**: Phase 4 item. A self-hosted RSSHub container could proxy Reuters, Twitter/X, YouTube, Telegram, Instagram. Not part of the curated defaults — requires user to run an additional container.

### World News / Geopolitics

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| BBC World News          | `https://feeds.bbci.co.uk/news/world/rss.xml`                                           |
| Al Jazeera              | `https://www.aljazeera.com/xml/rss/all.xml`                                             |
| The Guardian World      | `https://www.theguardian.com/world/rss`                                                 |
| NPR News                | `https://feeds.npr.org/1001/rss.xml`                                                    |
| r/worldnews             | `https://www.reddit.com/r/worldnews/top/.rss?t=day`                                    |

### Markets / Finance

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| CNBC Top News           | `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114`  |
| Yahoo Finance           | `https://finance.yahoo.com/news/rssindex`                                               |
| Bloomberg Markets       | `https://feeds.bloomberg.com/markets/news.rss`                                          |
| MarketWatch             | `https://feeds.marketwatch.com/marketwatch/topstories/`                                 |
| Financial Times         | `https://www.ft.com/rss/home`                                                           |

### Engineering / Programming

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Hacker News Best        | `https://hnrss.org/best`                                                                |
| r/programming           | `https://www.reddit.com/r/programming/top/.rss?t=day`                                   |
| DEV.to                  | `https://dev.to/feed`                                                                   |
| Lobsters                | `https://lobste.rs/rss`                                                                 |
| Pragmatic Engineer      | `https://blog.pragmaticengineer.com/rss/`                                               |

### Science

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Nature                  | `https://www.nature.com/nature.rss`                                                     |
| r/science               | `https://www.reddit.com/r/science/.rss`                                                 |

### Technology / Gadgets

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Ars Technica            | `https://feeds.arstechnica.com/arstechnica/index`                                       |
| The Verge               | `https://www.theverge.com/rss/index.xml`                                                |
| TechCrunch              | `https://techcrunch.com/feed/`                                                          |
| Wired                   | `https://www.wired.com/feed/rss`                                                        |
| Tom's Hardware          | `https://www.tomshardware.com/feeds/all`                                                |
| r/technology            | `https://www.reddit.com/r/technology/.rss`                                              |
| VentureBeat             | `https://feeds.feedburner.com/venturebeat/SZYF`                                        |

### Gaming

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Rock Paper Shotgun      | `https://www.rockpapershotgun.com/feed`                                                 |
| GameSpot                | `https://www.gamespot.com/feeds/mashup/`                                                |
| IGN                     | `https://feeds.feedburner.com/ign/all`                                                  |
| r/GameDeals             | `https://www.reddit.com/r/gamedeals/.rss`                                               |

### Space / Astronomy

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| NASA                    | `https://www.nasa.gov/feed/`                                                            |
| SpaceNews               | `https://spacenews.com/feed/`                                                           |
| Space.com               | `https://www.space.com/feeds/all`                                                       |

### Culture / Arts

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Hyperallergic           | `https://hyperallergic.com/feed/`                                                       |
| Designboom              | `https://www.designboom.com/feed/`                                                      |
| Dezeen                  | `https://www.dezeen.com/feed/`                                                          |
| ArchDaily               | `https://www.archdaily.com/feed`                                                        |
| Creative Bloq           | `https://www.creativebloq.com/feeds/all`                                                |
| PetaPixel               | `https://petapixel.com/feed/`                                                           |

### Long Reads / Deep Dives

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Longreads               | `https://longreads.com/feed/`                                                           |
| The Atlantic            | `https://www.theatlantic.com/feed/all/`                                                 |

### Security / Privacy

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Krebs on Security       | `https://krebsonsecurity.com/feed/`                                                     |
| Schneier on Security    | `https://www.schneier.com/feed/`                                                        |

### AI / Machine Learning

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| r/MachineLearning       | `https://www.reddit.com/r/MachineLearning/.rss`                                        |

### Open Source

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| GitHub Blog             | `https://github.blog/feed/`                                                             |

### Apple / iOS

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| 9to5Mac                 | `https://9to5mac.com/feed/`                                                             |

### Android / Mobile

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Android Authority       | `https://www.androidauthority.com/feed/`                                                |

### Sports

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| BBC Sport               | `https://feeds.bbci.co.uk/sport/rss.xml`                                                |
| The Guardian Sport      | `https://www.theguardian.com/uk/sport/rss`                                              |
| ESPN                    | `https://www.espn.com/espn/rss/news`                                                   |

### Music

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Pitchfork               | `https://pitchfork.com/feed/feed-news/rss`                                              |
| Stereogum               | `https://www.stereogum.com/feed/`                                                       |
| Consequence of Sound    | `https://consequenceofsound.net/feed/`                                                  |
| r/Music                 | `https://www.reddit.com/r/music/.rss`                                                   |

### Movies / Entertainment

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Hollywood Reporter      | `https://www.hollywoodreporter.com/feed/`                                               |
| Variety                 | `https://variety.com/feed/`                                                             |
| IndieWire               | `https://www.indiewire.com/feed/`                                                       |
| SlashFilm               | `https://www.slashfilm.com/feed/`                                                       |
| Collider                | `https://collider.com/feed/`                                                            |
| r/movies                | `https://www.reddit.com/r/movies/.rss`                                                  |

### Fashion / Style

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Vogue                   | `https://www.vogue.com/feed/rss`                                                        |
| Fashionista             | `https://fashionista.com/feed`                                                          |
| Highsnobiety            | `https://www.highsnobiety.com/feed/`                                                    |

### Environment / Climate

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Grist                   | `https://grist.org/feed/`                                                               |
| Inside Climate News     | `https://insideclimatenews.org/feed/`                                                   |

### Health / Medicine

| Feed                    | URL                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| STAT News               | `https://www.statnews.com/feed/`                                                        |

**Total: 55 verified feeds.**

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
          curl -C - -L -o /models/gemma-4-E4B-it-Q4_K_M.gguf <HF_URL>
        fi
        if [ ! -f /models/nomic-embed-text-v2-moe.Q4_K_M.gguf ]; then
          curl -C - -L -o /models/nomic-embed-text-v2-moe.Q4_K_M.gguf <HF_URL>
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
      # EMBEDDINGS_BASE_URL is Phase 3 — uncomment when embeddings container is enabled
      # - EMBEDDINGS_BASE_URL=http://embeddings:8082
    depends_on:
      model-init:
        condition: service_completed_successfully
      llm:
        condition: service_started
      # embeddings dependency is Phase 3 — uncomment when embeddings container is enabled
      # embeddings:
      #   condition: service_started
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

Four services total: three long-running (`doomscroller`, `llm`, `embeddings`) + one ephemeral (`model-init`). No reverse proxy, no Redis, no message queue, no Kubernetes.

> **Phase note:** The `embeddings` service is only used from Phase 3 onward. For Phase 2.5 deployments, comment it out (along with its `model-init` download step) to save ~500MB of disk and significant RAM.

**Model bootstrap:** A `model-init` service runs on first `docker compose up`. It downloads both GGUF files from HuggingFace into a Docker named volume (`models`), then exits. Subsequent starts skip the download — the volume persists across restarts. The `llm` and `embeddings` services mount this volume read-only and depend on `model-init` completing successfully. Must use robust downloading with resume capability (e.g., `curl -C -` or `aria2c`) and enforce strict SHA256 verification before marking the container as successful. No host-side tools needed beyond Docker.

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
- Model files MUST be verified by SHA256 during `model-init` to prevent corruption.

---

## Design System

### Design Philosophy

Content is the product. The interface is invisible until you need it, then obvious when you do. Every pixel either helps you read or helps you navigate. Nothing else.

**Core principles:**

1. **Text is the hero.** 80% of design effort goes to typography — measure, leading, weight, contrast, optical sizing. If the text feels wrong, nothing else matters.
2. **Navigation is furniture.** 20% of effort. It should be where everyone expects it. No invention, no surprise. A reader's hands already know where things are from every other reader they've used.
3. **Silence is a feature.** No decoration that doesn't serve comprehension. No gradients, no shadows that don't communicate depth, no color that doesn't carry meaning. Quiet interfaces let loud content breathe.
4. **One density, one rhythm.** The entire app beats to the same spacing grid. Every gap, every margin, every padding is a multiple of the base unit. You feel the rhythm before you see it.
5. **Dark by nature.** This is a reading app. Bright screens at midnight are hostile. The palette is warm and low-contrast enough for 2am reading, high-contrast enough for legibility at any hour.

---

### Typography

Typography is the entire product. Three typefaces, three jobs, no exceptions.

#### Typeface Selection

| Role | Typeface | Why |
|------|----------|-----|
| **Content** | Source Serif 4 (variable) | Optical sizing adapts stroke contrast from 8pt captions to 60pt headlines. Variable weight (300-900) means one file, infinite precision. Generous x-height for screen reading. The serifs guide the eye along long lines, reducing saccade effort. |
| **Interface** | Inter (400, 500, 600) | Designed for screens at small sizes. Tall x-height, open apertures, tabular figures by default. Disappears when it's doing its job — you read the label, not the font. |
| **Data** | JetBrains Mono (400) | Monospaced for alignment. Scores, percentages, timestamps — anything that benefits from columnar reading. |

#### Font Loading

Google Fonts with `display=swap`. Variable axes for Source Serif 4: `ital,opsz,wght@0,8..60,300..900;1,8..60,300..900`. Inter: `wght@400;500;600`. JetBrains Mono: `wght@400`.

```css
--font-serif: 'Source Serif 4', Georgia, 'Times New Roman', serif;
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
```

#### Type Scale

Modular scale, ratio 1.25 (major third). Every size has a specific role.

| Token | Size | Line height | Letter spacing | Usage |
|-------|------|-------------|----------------|-------|
| `--text-xs` | 0.75rem (12px) | 1.5 (18px) | +0.02em | Timestamps, entry counts, badge labels |
| `--text-sm` | 0.875rem (14px) | 1.5 (21px) | +0.01em | Metadata, feed source names, secondary labels |
| `--text-base` | 1rem (16px) | 1.6 (25.6px) | 0 | Body text, buttons, form inputs, settings labels |
| `--text-lg` | 1.125rem (18px) | 1.55 (27.9px) | -0.005em | Entry summaries in list, section labels |
| `--text-xl` | 1.25rem (20px) | 1.4 (28px) | -0.01em | Entry titles (mobile), section headings |
| `--text-2xl` | 1.5rem (24px) | 1.35 (32.4px) | -0.015em | Entry titles (desktop), section headers |
| `--text-3xl` | 1.875rem (30px) | 1.3 (39px) | -0.02em | Onboarding step titles |
| `--text-4xl` | 2.25rem (36px) | 1.2 (43.2px) | -0.025em | Onboarding hero text, empty state headline |

**Letter spacing rationale:** Large text needs negative tracking to feel balanced — the letterforms have enough internal whitespace. Small text needs positive tracking for legibility at low resolution.

**Line height rationale:** Body text (base, lg) gets generous leading (1.55-1.6) for sustained reading. Headlines (2xl+) tighten because the eye tracks large text with less effort and loose leading looks disconnected.

#### Optical Sizing

Source Serif 4 supports the `opsz` axis. Use it:

```css
.article-title { font-variation-settings: 'opsz' 36; }   /* Headlines: bolder stroke contrast */
.entry-summary { font-variation-settings: 'opsz' 14; }    /* Body: smoother strokes */
.meta { font-variation-settings: 'opsz' 10; }             /* Captions: widened proportions */
```

This is the invisible detail that makes text feel "right" without anyone knowing why.

#### Content Typography (Article Rendering)

When `content_html` is rendered in a future article view or expanded entry:

```css
.article-content {
  font-family: var(--font-serif);
  font-size: var(--text-lg);             /* 18px — optimal for sustained reading */
  line-height: 1.7;                       /* generous for long-form */
  font-variation-settings: 'opsz' 16;
  max-width: 38rem;                       /* ~65 chars/line — the golden measure */
  hanging-punctuation: first last;
  hyphens: auto;
  text-wrap: pretty;                      /* Chrome/Safari: avoids orphans */
}

.article-content p + p { margin-top: 1.2em; }
.article-content h2 { font-size: var(--text-2xl); margin-top: 2em; margin-bottom: 0.6em; }
.article-content h3 { font-size: var(--text-xl); margin-top: 1.6em; margin-bottom: 0.5em; }
.article-content blockquote {
  border-left: 2px solid var(--text-tertiary);
  padding-left: var(--space-5);
  color: var(--text-secondary);
  font-style: italic;
}
.article-content pre {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.5;
  background: var(--bg-secondary);
  padding: var(--space-4);
  border-radius: 0.375rem;
  overflow-x: auto;
}
.article-content a { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
.article-content img { max-width: 100%; height: auto; border-radius: 0.375rem; margin: var(--space-6) 0; }
```

**The golden measure:** 38rem at 18px is roughly 65 characters per line — the sweet spot for reading speed and comprehension.

---

### Color System

Warm, low-fatigue, dark-first. Every color has a semantic purpose. No decorative color.

#### Background Layers

Five depths. Each layer represents a different surface elevation.

| Token | Hex | Role |
|-------|-----|------|
| `--bg-primary` | `#141414` | Page canvas. The default. |
| `--bg-secondary` | `#1c1c1c` | Cards, elevated surfaces, code blocks |
| `--bg-tertiary` | `#242424` | Nested surfaces, settings panel sections |
| `--bg-hover` | `#2a2a2a` | Interactive hover state |
| `--bg-active` | `#333333` | Active/pressed state, focused entry |

The progression is linear 8-step increments in lightness: 14, 1c, 24, 2a, 33. Uniform depth perception.

#### Text Hierarchy

Four levels. Never use more.

| Token | Hex | Contrast ratio (on #141414) | Role |
|-------|-----|----------------------------|------|
| `--text-primary` | `#e8e4df` | 12.3:1 | Headlines, titles, body text. Warm off-white — pure #fff is harsh. |
| `--text-secondary` | `#a09a92` | 5.7:1 | Feed names, metadata, timestamps. Clearly subordinate. |
| `--text-tertiary` | `#6b665f` | 3.2:1 | Disabled states, placeholder text. Below WCAG AA — intentional, only for non-essential content. |
| `--text-accent` | `#d4a574` | 7.8:1 | Feed source attribution, active states, interactive affordances. Warm amber — the app's signature color. |

**Why warm?** Cool grays feel clinical and digital. Warm grays with amber/brown undertones feel like paper. The brain relaxes because the tones reference analog reading.

#### Semantic Colors

Purpose-assigned. Never appear as decoration.

| Token | Hex | Purpose |
|-------|-----|---------|
| `--link` | `#8bb4d9` | Unvisited links. Steel blue. |
| `--link-visited` | `#a08bc4` | Visited links. Muted lavender. |
| `--star` | `#d4a84c` | Starred entries. Gold. |
| `--untagged` | `#6b8aad` | Untagged indicator. Muted slate blue — entry not yet processed by LLM. |
| `--danger` | `#c75b5b` | Destructive actions, errors. Muted red. |

#### Border System

| Token | Hex | Purpose |
|-------|-----|---------|
| `--border` | `#2a2a2a` | Structural dividers, card edges, section separators |
| `--border-subtle` | `#222222` | Hairline separators between list items |

Borders are used sparingly. Prefer whitespace. `--border-subtle` is the default; `--border` only where structural clarity demands it.

---

### Spacing System

8-point base grid with a 4px sub-grid. Every spatial decision references these tokens.

| Token | Value | Pixel equiv. | Usage |
|-------|-------|-------------|-------|
| `--space-1` | 0.25rem | 4px | Inline gaps: icon-to-label, pill padding vertical |
| `--space-2` | 0.5rem | 8px | Tight groups: button icon gap, list item internal padding |
| `--space-3` | 0.75rem | 12px | Standard element padding: pills, small buttons |
| `--space-4` | 1rem | 16px | Base rhythm: card padding, section gaps |
| `--space-5` | 1.25rem | 20px | Comfortable padding: card inner spacing, settings sections |
| `--space-6` | 1.5rem | 24px | Section dividers: gap between entry cards |
| `--space-8` | 2rem | 32px | Major sections: padding increase at tablet |
| `--space-10` | 2.5rem | 40px | Generous breathing room: onboarding step gaps |
| `--space-12` | 3rem | 48px | Page-level margins: desktop content inset |
| `--space-16` | 4rem | 64px | Dramatic space: empty state vertical centering |

**The rule:** Adjacent elements of the same type use the same gap. Parent-child use the next step up. Cross-section uses two steps up. Tight within, looser between, spacious across.

#### Content Column

```css
--content-width: 42rem;  /* ~672px — main reading column */
```

Centered at 42rem max-width. On mobile, edge-to-edge with `--space-4` padding.

---

### Layout System

#### Page Zones

Three-panel drill-down navigation: **Tags → Feeds → Posts**

```
+------------------+---------------------+----------------------------+
| TAG SIDEBAR      | FEED LIST           | POST LIST                  |
| width: 220px     | width: 280px        | flex: 1, max-w: 42rem      |
|                  |                     |                            |
| [All Entries]    | [All Feeds]         | Entry Card                 |
|                  | BBC World News (12) | Entry Card                 |
| NEWS             | The Guardian (8)    | Entry Card                 |
|  ● Politics      | Al Jazeera (5)      |                            |
|  ● Geopolitics   |                     |                            |
|  ○ War & Conflict| --- Group: Tech --- |                            |
|  ✕ Celebrity     | Ars Technica (9)    |                            |
|                  | Hacker News (24)    |                            |
| TECH             |                     |                            |
|  ● Programming   | --- Ungrouped ---   |                            |
|  ● AI & ML       | My Custom Feed (3)  |                            |
|  ✕ Crypto        |                     |                            |
|                  |                     |                            |
| CUSTOM           |                     |                            |
|  ● Rust          |                     |                            |
|                  |                     |                            |
| [+ New Tag]      |                     |                            |
+------------------+---------------------+----------------------------+

● = neutral (none)   ★ = whitelisted   ✕ = blacklisted
```

**Mobile:** Panels stack as pages. Tag sidebar is a slide-out drawer. Feed list and post list are swipeable views. Back arrow navigates up.

**Desktop (< 1280px):** Two panels: feed list collapses into tag sidebar as an expandable tree. Post list fills remaining width.

**Desktop (>= 1280px):** Full three-panel layout as shown above.

##### Tag Sidebar

- Width: 220px fixed
- Background: `--bg-secondary`
- "All Entries" link at top — shows unfiltered chronological feed
- Tags grouped by `tag_group` under sticky group headers
- Each tag shows: label + visual indicator of preference state
  - **None (default):** bullet `●`, `--text-secondary`
  - **Whitelisted:** star `★`, `--star` color (gold)
  - **Blacklisted:** cross `✕`, `--danger` color, label has strikethrough + dimmed
- Click a tag → middle panel shows feeds, right panel filters to entries with that tag
- Right-click / long-press a tag → cycles: none → whitelist → blacklist → none
- "[+ New Tag]" button at bottom — creates a custom tag (prompts for label, auto-generates slug)
- Tag count (number of unread entries with that tag) shown in `--text-tertiary`

##### Feed List (Middle Panel)

- Width: 280px fixed
- Background: `--bg-primary`
- Context-dependent: shows all feeds, or feeds relevant to selected tag
- "All Feeds" link at top — shared chronological stream from all feeds
- Feeds grouped by `feed_groups` with collapsible group headers
- Each feed row: feed title + unread count
- Ungrouped feeds appear under "Ungrouped" at the bottom
- Click a feed → right panel shows that feed's entries
- Drag feeds between groups (desktop only)

##### Post List (Right Panel)

- Flex: 1, content max-width: 42rem, centered
- Chronological entry list — same Entry Card component as before
- Context: "All Entries", entries for a tag, entries for a feed, or a combination
- Sticky header shows current context: "All Entries", "Tag: Politics", "Feed: Hacker News", etc.

#### Layout

- **App shell:** `display: flex`, `min-height: 100dvh`
- **Tag sidebar:** `width: 220px`, `flex-shrink: 0`, `overflow-y: auto`
- **Feed list:** `width: 280px`, `flex-shrink: 0`, `overflow-y: auto`
- **Post list:** `flex: 1`, content centered with `max-width: 42rem` + auto margins
- **Entry card:** `flex-direction: row` (content | optional image)

**Exception:** Onboarding tag selection uses a multi-column grid — a genuine 2D layout.

---

### Components

Every component: props are proxies (never destructured), all interactive elements have hover/active/focus states, all transitions use `var(--ease-out)`.

#### Header

- Wordmark: Source Serif 4, `--text-lg`, weight 600. Not a logo — a word.
- Height: 3.5rem (56px). Padding: 0 `--space-4`.
- Background: `bg-primary` at 85% opacity + `backdrop-filter: blur(12px)`. Frosted-glass effect.
- Border: `1px solid var(--border-subtle)` bottom.
- Position: sticky, top 0, z-index 100.
- Content: wordmark left, unread toggle + settings gear right.
- Buttons: icon only, no border, no background. Hover: `--bg-hover`. Active: `--bg-active`. Focus: `outline: 2px solid var(--text-accent)`.
- On mobile, the header spans the full width above the active panel.

#### Entry Card

The fundamental unit. Must be scannable in 200ms.

**Anatomy:**

| Element | Font | Size | Weight | Color |
|---------|------|------|--------|-------|
| Feed source | Sans | `--text-sm` | 500 | `--text-accent` |
| Separator dot | Sans | `--text-sm` | — | `--text-tertiary` |
| Timestamp | Sans | `--text-sm` | 400 | `--text-secondary` |
| Author | Sans | `--text-sm` | 400 | `--text-secondary` |
| Title | Serif | `--text-xl` (mob) / `--text-2xl` (desk) | 600 | `--text-primary` |
| Summary | Serif | `--text-base` | 400 | `--text-secondary` |
| Tag pills | Sans | `--text-xs` | 500 | varies by preference state |
| Star | — | `--text-lg` | — | `--star` (filled) / `--text-tertiary` (empty) |
| Thumbnail | — | 6rem x 6rem (mob) / 8rem x 8rem (desk) | — | `border-radius: 0.5rem`, `object-fit: cover` |

**Spacing inside card:**

- Card padding: `--space-5` top/bottom, `--space-4` left/right
- Content to image: `--space-4`
- Meta line to title: `--space-1`
- Title to summary: `--space-1`
- Summary to tag row: `--space-2`
- Tag row to action row: `--space-2`
- Between cards: `1px solid var(--border-subtle)` (hairline, cards are flush)

**States:**

- Default: `background: transparent`
- Hover: `background: var(--bg-hover)`, transition 0.15s
- Focused (keyboard): `outline: 2px solid var(--text-accent)`, `outline-offset: -2px`, `border-radius: 0.375rem`
- Read: title shifts to `--text-secondary`, summary to `--text-tertiary`. Read items fade.
- Untagged: tag row shows a single pill "Pending" in `--untagged` color. Signals the LLM hasn't tagged this entry yet.
- Pressed: `background: var(--bg-active)`, instant

**Tag row:** Displayed below the summary on every entry card. Each tag is a small pill:

- **Neutral tag:** `--bg-tertiary` background, `--text-secondary` text
- **Whitelisted tag:** `--star` (gold) border, `--bg-tertiary` background, `--text-primary` text
- **Blacklisted tag:** `--danger` border, `--bg-primary` background, `--text-tertiary` text, strikethrough
- Tag pills are Sans, `--text-xs`, weight 500, padding `--space-1` horizontal, border-radius `1rem`
- Clicking a tag pill navigates to that tag's filtered view in the sidebar
- Tags are always visible — this is the transparency guarantee

**Summary truncation:** `-webkit-line-clamp: 2`. Two lines max. Uniform card height for scanning.

#### Settings Panel

Modal overlay. Settings are secondary — visited rarely.

- Overlay: `rgba(0,0,0,0.6)`, fixed, z-index 200
- Panel: max-width 36rem, centered, `bg-secondary`, border-radius 0.75rem, margin-top 5vh
- Header: serif, `--text-2xl`, weight 600, padding `--space-5`, border-bottom
- Tabs: sans, `--text-sm`, weight 500, padding `--space-3`
- Body: scrollable, padding `--space-5`, max-height `calc(90vh - header - tabs)`
- No mount animation. `<Show>` toggle.

#### Onboarding Wizard

Full-screen takeover. Three steps. No chrome. Content max-width: 32rem, centered.

- Hero text: serif, `--text-4xl`, weight 700
- Subtitle: serif, `--text-lg`, weight 400, `--text-secondary`
- Step indicator: 3 dots. Active: `--text-accent`, 8px. Inactive: `--text-tertiary`, 6px.
- Navigation: "Back" (text button, left) / "Next" (primary button, right). Last step: "Start Reading".
- Tag cards (Step 2): displayed in groups (News, Tech, Science, Sports, Culture, Meta). Each tag is a pill with three-state toggle. Default: all neutral (none). User taps to cycle: none → blacklist → none, or long-press/right-click for whitelist.
  - **None:** border `--text-accent`, bg `--bg-tertiary`
  - **Whitelisted:** border `--star`, bg `--bg-tertiary`, star icon
  - **Blacklisted:** border `--danger`, bg `--bg-primary`, dimmed, strikethrough text

#### Buttons

Two tiers only.

**Primary (`btn-primary`):** Sans, `--text-base`, weight 600, dark text on `--text-accent` background, padding `--space-3` / `--space-6`, radius 0.375rem. Hover: opacity 0.9. Active: opacity 0.8. Used sparingly — one primary button per visible context max.

**Ghost (`btn`):** Sans, `--text-sm`, weight 500, `--text-secondary` on transparent, 1px `--border`, padding `--space-2` / `--space-3`, radius 0.375rem. Hover: `--text-primary` + `--bg-hover`. Active: `--bg-active`.

#### Form Inputs

Sans, `--text-base`, `--text-primary` on `--bg-primary`, 1px `--border`, radius 0.375rem, padding `--space-3`. Focus: border shifts to `--text-accent`, no outline ring.

---

### Border Radius

| Value | Usage |
|-------|-------|
| `2px` | Micro: scrollbar thumb |
| `0.375rem` (6px) | Standard: buttons, inputs, code blocks, focused entry outline |
| `0.5rem` (8px) | Cards: thumbnails, onboarding tag cards |
| `0.75rem` (12px) | Panels: settings overlay, modals |
| `1rem` (16px) | Pills: tag pills |

---

### Motion and Transitions

#### Curve

```css
--ease-out: cubic-bezier(0.25, 0.46, 0.45, 0.94);
```

One curve for everything. Decelerates naturally. No bounce.

#### Durations

| Duration | Usage |
|----------|-------|
| 0ms | Active/pressed states |
| 150ms | Hover states, color/border changes |
| 300ms | Chrome show/hide (mobile header auto-hide) |

Never exceed 300ms.

#### What Animates

- Color transitions: hover, focus, active states
- Chrome auto-hide: `transform: translateY(-100%)` with 300ms

#### What Does Not Animate

- Entry card rendering (instant)
- Settings open/close (mount/unmount)
- Panel navigation (instant)
- State changes: read, starred (instant color swap)
- No parallax, no fade-in-on-scroll, no entrance animations

#### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

---

### Icons

No icon library. Inline SVGs. 8 icons total, each under 200 bytes.

| Icon | Usage | Size | Style |
|------|-------|------|-------|
| Gear | Settings | 20px | Stroke 1.5px |
| Circle | Unread toggle | 18px | Fill/stroke toggle |
| Star (filled) | Starred | 18px | Fill `--star` |
| Star (outline) | Unstarred | 18px | Stroke `--text-tertiary` 1.5px |
| Close | Settings panel, drawers | 20px | Stroke `--text-secondary` 2px |
| Chevron-right | Drill-down navigation | 16px | Stroke 1.5px |
| Chevron-left | Back navigation (mobile) | 16px | Stroke 1.5px |
| Plus | Create tag, add feed | 16px | Stroke 1.5px |

All icons: `stroke-linecap: round`, `stroke-linejoin: round`, color via `currentColor`.

---

### Responsive Behavior

Mobile-first. Three breakpoints. Layout changes significantly.

| Name | Query | What changes |
|------|-------|-------------|
| **Mobile** | < 768px | Single panel visible at a time. Tag sidebar is a slide-out drawer. Feed list and post list are swipeable/navigable views. |
| **Tablet** | >= 768px, < 1280px | Two panels: tag sidebar with inline feed tree + post list. |
| **Desktop** | >= 1280px | Full three-panel layout: tag sidebar + feed list + post list. |

```css
@media (pointer: coarse) { /* Touch: auto-hide header, 44px min tap targets, drawer gestures */ }
@media (pointer: fine) { /* Mouse: header always visible, hover states, right-click tag menus */ }
```

---

### Gestures and Keyboard

#### Keyboard (Desktop)

| Key | Action |
|-----|--------|
| `j` | Next entry |
| `k` | Previous entry |
| `o` / `Enter` | Open entry link |
| `s` | Toggle star |
| `t` | Focus tag sidebar |
| `f` | Focus feed list |
| `,` | Settings |
| `Esc` | Close / deselect / back |

Vim-style. No modifier keys. Disabled when text input is focused.

#### Touch (Mobile)

- Scroll down: hide chrome (300ms)
- Scroll up: show chrome (300ms)
- Idle 2s: hide chrome
- Tap top edge / scroll top: show chrome
- No pull-to-refresh, no swipe, no long-press

---

### Scrollbar

6px wide. Transparent track. `var(--bg-active)` thumb, radius 3px. Hover: `var(--text-tertiary)`.

Firefox: `scrollbar-width: thin; scrollbar-color: var(--bg-active) transparent;`

---

### Z-Index Scale

| Value | Usage |
|-------|-------|
| 10 | Sidebar group headers (sticky) |
| 100 | App header |
| 150 | Mobile drawer overlay |
| 200 | Settings overlay + panel |
| 300 | Onboarding wizard |

---

### Accessibility

- **Contrast:** WCAG AA (4.5:1 body, 3:1 large). `--text-tertiary` is decorative only.
- **Focus:** 2px solid accent outline on every focusable element.
- **Screen reader:** `.sr-only` for icon-only buttons. All interactive elements labeled.
- **Reduced motion:** Full `prefers-reduced-motion` support.
- **Keyboard:** Complete navigation. No traps. Tab order = visual order.
- **Semantic HTML:** `<header>`, `<nav>`, `<main>`, `<article>`, `<section>`. ARIA only where needed.
- **Touch targets:** 44x44px minimum (Apple HIG).

---

### Empty States

Center-aligned, vertically centered. Serif font, `--text-tertiary`.

- **No unread entries:** "You're all caught up."
- **No feeds added:** "Add your first feed." (with inline affordance)
- **No feeds in group:** "Drag feeds here to organize."
- **Tagging in progress:** "Entries are being tagged..." (with count)
- **Feed error:** "[Feed name] hasn't responded in [X hours]."
- **Tag selected, no entries:** "No entries tagged [tag name]."

---

### Performance Targets (Visual)

| Metric | Target |
|--------|--------|
| First Contentful Paint | < 200ms |
| Cumulative Layout Shift | 0 |
| JS bundle | < 100KB gzipped |
| CSS | < 10KB uncompressed, one file |

---

### What This Design System Does NOT Include

- **Light mode.** Dark reading app. A light mode doubles the color system.
- **Theming.** The palette is the brand.
- **srcset.** Thumbnails are 6-8rem. One size.
- **Print styles.** Nobody prints RSS.
- **RTL.** Not in v1.
- **Micro-interactions.** No confetti. This is a reading tool.

---

### Pages (Application Views)

**SolidJS SPA + Vite build.** Static files served by Hono.

0. **Onboarding** — full-screen wizard. 3 steps: welcome + feed selection, tag preferences (whitelist/blacklist), done. Blocked until completed.
1. **Main view** — three-panel drill-down: Tags (sidebar) → Feeds (middle) → Posts (right). All entries chronological. Tags visible on every entry card. Tag sidebar shows whitelist/blacklist state at a glance.
2. **Settings** (modal) — Feeds (add/remove/OPML/groups), Tags (same three-state grid as onboarding + custom tag creation).

Mobile: Fever API for native apps (Reeder, NetNewsWire, Unread). Web UI is responsive.

---

## Job Queue Design

SQLite-based. No external dependencies.

- Workers poll with `UPDATE ... SET status='running' WHERE status='pending' AND run_after <= now LIMIT 1 RETURNING *`
- Atomic — SQLite single-writer guarantees no double-claim
- Failed jobs retry with exponential backoff
- Job types: `fetch_feed`, `tag_batch`, `cleanup`
- Poll interval: 1 second
- Feed fetches: every 30 minutes
- Tagging: every 5 minutes
- Cleanup: daily (removes 7-day-old jobs, 30-day-old read entries)

---

## Feed Fetching

- Respect `ETag` and `If-Modified-Since` headers — don't re-download unchanged feeds
- Timeout: 30 seconds per feed
- Dedup by `(feed_id, guid)`
- Parse with a robust RSS/Atom parser. Normalize to a common `Entry` shape.
- Strip HTML for the `summary` field (plain text for LLM). Keep `content_html` for display.
- Feeds selected during onboarding from a curated list of 30 verified sources
- `last_fetched_at` timestamps prevent re-fetching on container restart

---

## API Design

Two APIs:

1. **Main API** (`/api/*`) — JSON REST for the SolidJS frontend
2. **Fever API** (`/fever/*`) — implements Fever protocol for native RSS clients

**Main API routes:**

- `GET /api/entries` — chronological feed. Respects tag preferences (whitelist/blacklist). Each entry includes `tags[]` array with preference state per tag. Supports `?tag=slug` and `?feed_id=N` filters.
- `PUT /api/entries/:id/read` — mark read/unread
- `PUT /api/entries/:id/star` — toggle star
- `POST /api/entries/:id/tags` — manually add a tag to an entry (body: `{ tag_id }`)
- `DELETE /api/entries/:id/tags/:tag_id` — remove a manually-added tag
- `GET /api/feeds` — list all feeds with group info and unread counts
- `POST /api/feeds` — add feed by URL (optional `group_id`)
- `DELETE /api/feeds/:id` — remove feed
- `PUT /api/feeds/:id` — update feed (title, group_id)
- `POST /api/feeds/import` — OPML import
- `GET /api/feeds/export` — OPML export
- `GET /api/feed-groups` — list feed groups
- `POST /api/feed-groups` — create feed group
- `PUT /api/feed-groups/:id` — rename/reorder
- `DELETE /api/feed-groups/:id` — delete group (feeds become ungrouped)
- `GET /api/tags` — all tags with `mode` (whitelist/blacklist/none), `is_builtin`, `use_count`, and `tag_group`
- `POST /api/tags` — create custom tag (body: `{ label }`, auto-generates slug, sets `use_count = 500`)
- `DELETE /api/tags/:id` — delete tag (only if `is_builtin = 0`)
- `PUT /api/tags/:id/preference` — set tag preference (body: `{ mode: 'whitelist' | 'blacklist' | 'none' }`)
- `PUT /api/tags/preference/bulk` — set multiple tag preferences at once (onboarding)
- `GET /api/onboarding` — onboarding status + curated feed list + tags
- `POST /api/onboarding/complete` — finalize onboarding

The Fever API is read-heavy and must be fast. Mostly `SELECT` queries on indexed columns.

Fever auth: username `doomscroller`, password is the generated API key.

---

## Implementation Phases

### Phase 1: Core Loop (Partial ✅ — score-based system)

> **Status note:** Phase 1 built a *score-based* system (categories, relevance/depth/novelty scores, interest profiles). The plan's target is a *tag-based* system. Phase 2.5 replaces the scoring model with the tag model described in this document.

- [x] SQLite schema, WAL mode, pragmas, migrations
- [x] Feed polling + entry storage with ETag/If-Modified-Since
- [x] RSS/Atom parser with entry normalization
- [x] llama.cpp integration + scoring prompt (⚠️ scores, not tags — rewritten in Phase 2.5)
- [x] Batch scorer with Zod validation (⚠️ scores, not tags — rewritten in Phase 2.5)
- [x] SQLite-backed job queue (poll, claim, complete, fail)
- [x] Minimal SolidJS web UI: list entries, mark as read
- [x] Hono API routes for feeds, entries, categories (⚠️ categories, not tags — replaced in Phase 2.5)
- [x] Docker Compose with llama.cpp container
- [x] Fever API for mobile clients

### Phase 2: Filtering + Preferences (Partial ✅ — score-based system)

> **Status note:** Phase 2 implemented category-based filtering with numeric relevance scores and an interest profile. The tag whitelist/blacklist system described in this plan is **not yet implemented** — it is the core deliverable of Phase 2.5.

- [x] Category system with LLM assignment (⚠️ categories, not tags — replaced in Phase 2.5)
- [ ] ~~Built-in tag system with LLM assignment + proposed tag creation~~ → Phase 2.5
- [ ] ~~Tag whitelist/blacklist filtering~~ → Phase 2.5
- [ ] ~~Tag management UI in Settings~~ → Phase 2.5
- [x] OPML import/export
- [x] Keyboard navigation (j/k/o/s)

### Phase 2.5: Schema Migration + Tag System + Onboarding + Navigation

#### Schema Migration (score-based → tag-based)

The current codebase implements a score-based system (`categories`, `entry_scores`, `entry_categories`, `preferences`, `interactions` tables). This phase replaces it with the tag-based model described in this plan.

- [ ] Write migration to drop score-based tables: `categories`, `entry_scores`, `entry_categories`, `preferences`, `interactions`, `feed_categories`
- [ ] Write migration to create tag-based tables: `tags`, `entry_tags`, `tag_preferences`, `feed_groups`
- [ ] Add `group_id` foreign key to `feeds` table, add `tagged_at` column to `entries` table
- [ ] Rewrite `server/src/scorer/client.ts` → tag assignment client (chunked tagging protocol, replaces scoring)
- [ ] Rewrite `server/src/scorer/batch.ts` → batch tagger (replaces batch scorer, implements tag economy: `use_count` increments, proposed tag creation)
- [ ] Update Zod schemas for tag assignment response (`{ confident, tags, new_tags }`) replacing score response
- [ ] Update `server/src/db/queries.ts` — replace score-based queries with tag-based queries (`getEntries` with whitelist/blacklist, `getTagsWithPreferences`, `getPromptTags`, etc.)
- [ ] Update `server/src/types.ts` — replace `Category`, `EntryScore`, `Interaction` types with `Tag`, `TagPreference`, `FeedGroup`, `EntryWithTags`
- [ ] Update `server/src/api/routes.ts` — replace category/preference/score endpoints with tag/feed-group/onboarding endpoints
- [ ] Update `server/src/index.ts` — replace category-based job handlers with tag-based handlers

#### Onboarding

- [ ] Curated feed registry (`server/src/feeds/curated.ts`) — 55 verified RSS feeds
- [ ] Built-in tag list (`server/src/tags.ts`) — ~35 tags across 6 groups, seeded on first boot with `use_count = 1000`
- [ ] Onboarding wizard API: status, curated feeds, tags, complete endpoint
- [ ] Replace hardcoded seed feeds in `server/src/index.ts` (currently includes dead NYT feed) with curated registry; gate on `onboarding_completed` config flag
- [ ] SolidJS onboarding wizard (3 steps: welcome + feeds → tag preferences → done)
- [ ] Feed selection: curated feed list with checkboxes. All pre-selected.
- [ ] Tag preference step: tags displayed as pills grouped by tag group. Default: all neutral. User taps to blacklist, long-press to whitelist.
- [ ] Reset onboarding button in Settings (danger zone, clears all data, restarts wizard)

#### Tag-Based Filtering (Whitelist/Blacklist)

The LLM tags articles. The user whitelists or blacklists tags. Three-panel navigation surfaces everything transparently.

##### Data Layer

Tables: `tags`, `entry_tags`, `tag_preferences`, `feed_groups` (created by schema migration in Phase 2.5 — replacing the current `categories`, `entry_scores`, `entry_categories`, `preferences`, `interactions` tables).

**Query: `getEntries`** — the core query with whitelist/blacklist logic:

```sql
SELECT e.*, f.title as feed_title, e.tagged_at IS NOT NULL as is_tagged,
       GROUP_CONCAT(t.slug) as tag_slugs
FROM entries e
JOIN feeds f ON e.feed_id = f.id
LEFT JOIN entry_tags et ON e.id = et.entry_id
LEFT JOIN tags t ON et.tag_id = t.id
WHERE e.is_read = 0  -- or omit for "show all"
  AND (
    e.tagged_at IS NULL  -- untagged entries always visible
    OR EXISTS (
      -- has at least one whitelisted tag → always show
      SELECT 1 FROM entry_tags et_w
      JOIN tag_preferences tp_w ON et_w.tag_id = tp_w.tag_id
      WHERE et_w.entry_id = e.id AND tp_w.mode = 'whitelist'
    )
    OR NOT (
      -- NOT (all tags are blacklisted) → show
      -- i.e., has at least one tag that isn't blacklisted
      NOT EXISTS (
        SELECT 1 FROM entry_tags et_n
        LEFT JOIN tag_preferences tp_n ON et_n.tag_id = tp_n.tag_id
        WHERE et_n.entry_id = e.id
        AND COALESCE(tp_n.mode, 'none') != 'blacklist'
      )
    )
  )
GROUP BY e.id
ORDER BY COALESCE(e.published_at, e.fetched_at) DESC
```

**Filtering precedence:**

1. Untagged entries → always shown
2. Entry has ANY whitelisted tag → always shown (whitelist wins)
3. Entry has ALL tags blacklisted (and none whitelisted) → hidden
4. Otherwise → shown

##### UI Layer

**Three-panel drill-down.** Tags → Feeds → Posts.

- **Tag sidebar:** all tags visible at all times, grouped by `tag_group`. Each tag shows its preference state (none/whitelist/blacklist) with visual indicators. Click to filter; right-click to cycle preference. Custom tags at bottom with "[+ New Tag]" affordance.
- **Feed list:** context-dependent. Shows all feeds or feeds relevant to selected tag. Grouped by `feed_groups`.
- **Post list:** chronological entries with tag pills visible on every card. Current context shown in a sticky header.

Tags on entry cards:

- Every entry shows its assigned tags as colored pills below the summary
- Pill color reflects preference state: neutral (gray), whitelisted (gold border), blacklisted (red border + strikethrough)
- "Pending" pill for untagged entries
- Clicking a tag pill navigates to that tag's view

**Tag management in Settings:** Same three-state grid as onboarding step 2. Tags displayed as pill toggles grouped by tag group. Plus custom tag creation (label → auto-slug) and deletion (custom tags only).

**Mobile chrome auto-hide:** On touch devices, the sticky header hides when scrolling down or idle >2 seconds. Reappears on scroll-up, tap top edge, or reaching page top.

```tsx
let lastScrollY = 0;
let scrollDirection: 'up' | 'down' = 'down';
let idleTimer: number;

const onScroll = () => {
  const y = window.scrollY;
  scrollDirection = y > lastScrollY ? 'down' : 'up';
  lastScrollY = y;

  if (scrollDirection === 'down' && y > headerHeight) {
    hideChrome();
  } else if (scrollDirection === 'up') {
    showChrome();
  }

  clearTimeout(idleTimer);
  idleTimer = setTimeout(hideChrome, 2000);
};
```

CSS `transform: translateY(-100%)` with smooth transition. Only on touch devices: `@media (pointer: coarse)`.

##### Implementation Steps

1. **Data layer** — seed `tags` table (built-in at `use_count = 1000`), `feed_groups` table, query functions (`getEntries` with whitelist/blacklist, `getTagsWithPreferences`, `getPromptTags` (top 100 + preferenced), `setTagPreference`, `createCustomTag`, `createProposedTag`, `incrementTagUseCount`, `getFeedsGrouped`)
2. **API routes** — tag CRUD + preference endpoints, feed group endpoints, entry tag management, onboarding endpoints
3. **Client API** — `api.tags.list()`, `api.tags.setPreference(id, mode)`, `api.tags.create(label)`, `api.feedGroups.list()`, etc.
4. **Tag sidebar** — tag list grouped by tag_group, three-state visual indicators, click-to-filter, right-click-to-cycle-preference, custom tag creation
5. **Feed list panel** — feeds grouped by feed_groups, unread counts, click-to-filter-posts
6. **Post list panel** — chronological entries with visible tag pills, context header, tag navigation
7. **Settings panel** — Feeds tab (add/remove/OPML/groups) + Tags tab (three-state grid + custom tag CRUD)
8. **Onboarding wizard** — 3-step flow: feeds → tag preferences → done
9. **Responsive layout** — three-panel (desktop) → two-panel (tablet) → single-panel + drawer (mobile)
10. **Mobile chrome auto-hide** — scroll direction detection, CSS transform show/hide, idle timer

##### Files Touched

**Server:**

- `server/src/tags.ts` — built-in tag definitions + seed function (sets `use_count = 1000`)
- `server/src/db/schema.sql` — `tags`, `entry_tags`, `tag_preferences`, `feed_groups` tables, `group_id` on `feeds`
- `server/src/db/queries.ts` — queries for tag filtering (whitelist/blacklist), feed groups, custom tags
- `server/src/types.ts` — `Tag`, `TagPreference`, `FeedGroup`, `EntryWithTags` types
- `server/src/api/routes.ts` — tag endpoints, feed group endpoints, onboarding endpoints

**Web:**

- `web/src/App.tsx` — three-panel layout shell, responsive breakpoints
- `web/src/lib/api.ts` — tag/feed/group API methods
- `web/src/components/TagSidebar.tsx` — **new**, tag list with preference indicators, custom tag creation
- `web/src/components/FeedList.tsx` — **new**, feeds grouped by feed_groups, unread counts
- `web/src/components/PostList.tsx` — **new**, entry list with context header and tag pills
- `web/src/components/TagGrid.tsx` — **new**, reusable three-state tag toggle grid (onboarding + settings)
- `web/src/components/EntryCard.tsx` — updated with visible tag pills row
- `web/src/components/SettingsPanel.tsx` — Feeds + Tags tabs, custom tag CRUD
- `web/src/components/Onboarding.tsx` — **new**, 3-step wizard
- `web/src/styles/global.css` — three-panel layout, tag pills, sidebar styles, drawer

### Phase 3: Embeddings + Learning

- [ ] Embeddings container integration (Nomic Embed v2 MoE)
- [ ] LanceDB integration for vector storage (see Resolved Design Decisions)
- [ ] Entry embedding pipeline (embed on fetch, store in LanceDB)
- [ ] Novelty detection via cosine similarity (flag near-dupes)
- [ ] Semantic dedup for syndicated content
- [ ] Interaction tracking (read, star, skip, time spent)
- [ ] Implicit interest vector from starred/read embeddings
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
- [ ] Smoke test: `make up` on clean machine → feeds load, tagging runs, Fever auth works

### Phase 4: Polish

- [ ] Stats dashboard (read/skip ratios, tag distribution)
- [ ] Feed error management UI
- [ ] Mobile-responsive refinements
- [ ] Self-hosted RSSHub container for sources without public RSS (Reuters, AP, Twitter/X, YouTube, Telegram)
- [ ] RSS-Bridge integration for additional platforms

---

## Resolved Design Decisions

### Gemma 2B vs. bigger model?

**Decision: Gemma 4 E4B (4.5B effective params).** The 2B floor was too low for nuanced tagging — distinguishing "international politics" from "celebrity gossip about a politician" requires understanding that small models miss. Gemma 4 E4B is the sweet spot: excellent instruction-following, 128K context, structured JSON output, ~5GB on disk. One model assigns tags from the prompt list (top 100 by usage + all preferenced tags) and proposes new tags via a chunked protocol.

### HTMX vs. SPA?

**Decision: SolidJS SPA.** A feed reader is interactive — infinite scroll, keyboard shortcuts, real-time updates, tag filtering. HTMX becomes `hx-swap` spaghetti for this. SolidJS is 7KB, fine-grained reactivity, and Vite gives a proper dev experience. The bundle stays under 100KB gzipped.

### Single container vs. separate tagger?

**Decision: Single process with job queue.** The tagger runs as async jobs within the main Bun process. For a single-user app, separating the tagger adds complexity with no benefit. The SQLite job queue provides isolation — if tagging fails, it retries without affecting the API.

### Ollama vs. llama.cpp directly?

**Decision: llama.cpp directly.** Ollama adds an abstraction layer (another container, model management API) that provides nothing we need. llama.cpp's server mode exposes the same OpenAI-compatible API. One fewer moving part. Model file management is handled by a Makefile target.

### How aggressive should filtering be?

**Decision: Whitelist + blacklist with whitelist priority.** Three states per tag: whitelist, blacklist, or none (default). An entry is hidden only if ALL its tags are blacklisted and NONE are whitelisted. A single whitelisted tag overrides any number of blacklisted tags. Untagged entries are always visible. This lets power users curate precisely: whitelist the topics you love, blacklist the noise, and everything else flows through naturally.

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

### Onboarding vs. zero-config?

**Decision: Guided onboarding with amazing defaults.** The design philosophy says "zero configuration on first run" — but that means zero *mandatory* configuration. The onboarding wizard pre-selects all curated feeds and keeps all tags neutral (no whitelist, no blacklist). A user can click "Next → Next → Start Reading" and get a working reader in 5 seconds. Users who want personalization can deselect feeds and set tag preferences during onboarding, or adjust later in Settings. Custom tags can be created anytime.

### Tag-based filtering vs. custom filter rules?

**Decision: Tags ARE the filters, with an organic tag economy.** ~35 built-in tags seeded at `use_count = 1000` + LLM-proposed tags that start at 1 and earn their way up + user-created tags at 500. The LLM sees the top 100 tags by usage count plus all whitelisted/blacklisted tags (guaranteed in prompt), so user filtering intent is always respected by the tagger. Whitelist/blacklist preference per tag (`tag_preferences` table). Tags are always visible on every entry card — full transparency. Three-panel navigation (Tags → Feeds → Posts) surfaces the tag structure as first-class UI.
