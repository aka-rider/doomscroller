-- Doomscroller schema v002
-- SQLite with WAL mode. All timestamps are unixepoch integers.

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
    tagged_at       INTEGER,
    UNIQUE(feed_id, guid)
);

-- Tags for LLM-driven classification
CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    label       TEXT,
    tag_group   TEXT NOT NULL DEFAULT '',
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    use_count   INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Many-to-many: entries tagged by LLM or user
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source      TEXT NOT NULL DEFAULT 'llm',
    PRIMARY KEY (entry_id, tag_id)
);

-- User preference per tag (boost, mute, etc.)
CREATE TABLE IF NOT EXISTS tag_preferences (
    tag_id      INTEGER PRIMARY KEY REFERENCES tags(id) ON DELETE CASCADE,
    mode        TEXT NOT NULL DEFAULT 'none',
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Background job queue
CREATE TABLE IF NOT EXISTS jobs (
    id              INTEGER PRIMARY KEY,
    type            TEXT NOT NULL,       -- 'fetch_feed', 'tag_batch', etc.
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
CREATE INDEX IF NOT EXISTS idx_entries_tagged      ON entries(tagged_at) WHERE tagged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tags_slug           ON tags(slug);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag      ON entry_tags(tag_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_jobs_pending        ON jobs(priority DESC, run_after ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_running        ON jobs(started_at) WHERE status = 'running';
