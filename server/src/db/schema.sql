-- Doomscroller schema v001
-- SQLite with WAL mode. All timestamps are unixepoch integers.

-- Tracks applied migrations
CREATE TABLE IF NOT EXISTS _migrations (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- App-wide key-value config (fever api key, etc.)
CREATE TABLE IF NOT EXISTS config (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- RSS/Atom feeds the user subscribes to
CREATE TABLE IF NOT EXISTS feeds (
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
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    slug        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',  -- natural language hint for LLM
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_auto     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Many-to-many: feeds belong to categories
CREATE TABLE IF NOT EXISTS feed_categories (
    feed_id     INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (feed_id, category_id)
);

-- Individual items from feeds
CREATE TABLE IF NOT EXISTS entries (
    id              INTEGER PRIMARY KEY,
    feed_id         INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid            TEXT NOT NULL,
    url             TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    author          TEXT NOT NULL DEFAULT '',
    content_html    TEXT NOT NULL DEFAULT '',
    summary         TEXT NOT NULL DEFAULT '',  -- plain text for LLM
    image_url       TEXT,                      -- hero image
    published_at    INTEGER,
    fetched_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    is_read         INTEGER NOT NULL DEFAULT 0,
    is_starred      INTEGER NOT NULL DEFAULT 0,
    is_hidden       INTEGER NOT NULL DEFAULT 0,
    UNIQUE(feed_id, guid)
);

-- LLM classification scores. One row per entry, written async by scorer.
CREATE TABLE IF NOT EXISTS entry_scores (
    entry_id        INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    relevance       REAL NOT NULL DEFAULT 0.5,  -- 0.0-1.0
    depth           REAL NOT NULL DEFAULT 0.5,  -- 0.0=beginner, 1.0=expert
    novelty         REAL NOT NULL DEFAULT 0.5,  -- 0.0=old news, 1.0=breaking
    category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    reasoning       TEXT NOT NULL DEFAULT '',
    model           TEXT NOT NULL DEFAULT '',
    scored_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Entry can belong to multiple categories with confidence scores
CREATE TABLE IF NOT EXISTS entry_categories (
    entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    confidence  REAL NOT NULL DEFAULT 0.5,
    PRIMARY KEY (entry_id, category_id)
);

-- User preference profile as key-value JSON blobs
CREATE TABLE IF NOT EXISTS preferences (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,  -- JSON
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Implicit feedback: reading behavior signals
CREATE TABLE IF NOT EXISTS interactions (
    id              INTEGER PRIMARY KEY,
    entry_id        INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,  -- 'read', 'star', 'hide', 'click', 'skip'
    duration_sec    INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Background job queue
CREATE TABLE IF NOT EXISTS jobs (
    id              INTEGER PRIMARY KEY,
    type            TEXT NOT NULL,       -- 'fetch_feed', 'score_batch', 'score_entry', etc.
    payload         TEXT NOT NULL DEFAULT '{}',  -- JSON
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending, running, done, failed, dead
    priority        INTEGER NOT NULL DEFAULT 0,  -- higher = sooner
    run_after       INTEGER NOT NULL DEFAULT (unixepoch()),
    started_at      INTEGER,
    completed_at    INTEGER,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    error           TEXT,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes: designed for the actual query patterns
CREATE INDEX IF NOT EXISTS idx_entries_feed_pub    ON entries(feed_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_published   ON entries(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_unread      ON entries(is_read, published_at DESC) WHERE is_read = 0;
CREATE INDEX IF NOT EXISTS idx_entries_starred     ON entries(is_starred, published_at DESC) WHERE is_starred = 1;
CREATE INDEX IF NOT EXISTS idx_scores_relevance    ON entry_scores(relevance DESC);
CREATE INDEX IF NOT EXISTS idx_scores_category     ON entry_scores(category_id, relevance DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_pending        ON jobs(priority DESC, run_after ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_running        ON jobs(started_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_interactions_entry  ON interactions(entry_id, action);
