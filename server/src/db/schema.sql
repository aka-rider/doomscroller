-- Doomscroller schema v006
-- SQLite with WAL mode. All timestamps are unixepoch integers.
-- Embeddings stored as raw Little-Endian Float32Array BLOBs (768 × 4 = 3072 bytes).

-- App-wide key-value config (fever api key, etc.)
CREATE TABLE IF NOT EXISTS config (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- Hierarchical tag categories (e.g. Programming, Sports, Science)
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    description TEXT,                   -- rich description for embedding similarity
    sort_order  INTEGER NOT NULL DEFAULT 0,
    embedding   BLOB                    -- 768 × float32 = 3072 bytes, raw LE binary
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
    summary         TEXT NOT NULL DEFAULT '',  -- plain text for embedding
    image_url       TEXT,                      -- hero image
    published_at    INTEGER,
    fetched_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    is_read         INTEGER NOT NULL DEFAULT 0,
    is_starred      INTEGER NOT NULL DEFAULT 0,
    tagged_at       INTEGER,
    embedding       BLOB,              -- 768 × float32 = 3072 bytes, raw LE binary
    relevance_score REAL,              -- cosine sim to user preference vector (-1.0 to 1.0)
    depth_score     REAL,              -- content depth (0.0=noise, 1.0=dense academic)
    thumb           INTEGER,           -- 1=up, -1=down, NULL=none
    UNIQUE(feed_id, guid)
);

-- Tags for embedding-based classification
CREATE TABLE IF NOT EXISTS tags (
    id              INTEGER PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    label           TEXT,
    description     TEXT,                   -- rich description for embedding similarity
    tag_group       TEXT NOT NULL DEFAULT '',
    category_slug   TEXT,                   -- FK to categories.slug (NULL for signal tags)
    is_builtin      INTEGER NOT NULL DEFAULT 0,
    use_count       INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    embedding       BLOB,                   -- 768 × float32 = 3072 bytes, raw LE binary
    FOREIGN KEY (category_slug) REFERENCES categories(slug)
);

-- Many-to-many: entries tagged by embeddings or user
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source      TEXT NOT NULL DEFAULT 'embedding',
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
CREATE INDEX IF NOT EXISTS idx_tags_category       ON tags(category_slug);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag      ON entry_tags(tag_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_jobs_pending        ON jobs(priority DESC, run_after ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_running        ON jobs(started_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_entries_thumb        ON entries(thumb) WHERE thumb IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entries_dismissed     ON entries(thumb) WHERE thumb = -1;
