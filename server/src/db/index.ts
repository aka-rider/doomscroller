import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../types';

let db: Database | null = null;

export const getDb = (): Database => {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
};

export const initDb = (config: AppConfig): Database => {
  if (db) return db;

  const dbPath = join(config.dataDir, 'doomscroller.db');
  db = new Database(dbPath, { create: true });

  // Non-negotiable pragmas
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA cache_size = -20000'); // 20MB cache
  db.exec('PRAGMA temp_store = MEMORY');

  applySchema(db);
  applyMigrations(db);

  return db;
};

const applySchema = (db: Database): void => {
  const schemaPath = join(import.meta.dir, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
};

// Incremental migrations for schema changes to existing tables.
// Each migration checks before applying so they are idempotent.
// NOTE: All migrations through v008 have been collapsed into schema.sql.
// New migrations go here.
const applyMigrations = (db: Database): void => {
  // v009: Add target_url column for link-only entries (Reddit, HN)
  const cols = db.query<{ name: string }, []>('PRAGMA table_info(entries)').all();
  if (!cols.some(c => c.name === 'target_url')) {
    db.exec('ALTER TABLE entries ADD COLUMN target_url TEXT');
  }

  // v010: Clear all feed etags to force re-fetch after GUID bug fix.
  // One-time: only runs if config flag not set.
  const guidFixApplied = db.query<{ value: string }, [string]>(
    'SELECT value FROM config WHERE key = ?'
  ).get('guid_fix_refetch_done');
  if (!guidFixApplied) {
    db.exec('UPDATE feeds SET etag = NULL, last_modified = NULL');
    db.run(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
      ['guid_fix_refetch_done', '1']
    );
  }
};

export const closeDb = (): void => {
  if (db) {
    db.close();
    db = null;
  }
};
