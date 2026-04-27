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
const applyMigrations = (db: Database): void => {
  // v004: Add thumb column to entries
  const cols = db.query<{ name: string }, []>(
    "SELECT name FROM pragma_table_info('entries') WHERE name = 'thumb'"
  ).all();
  if (cols.length === 0) {
    db.exec('ALTER TABLE entries ADD COLUMN thumb INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_thumb ON entries(thumb) WHERE thumb IS NOT NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_dismissed ON entries(thumb) WHERE thumb = -1');
  }

  // v005: Add category_slug column to tags
  const tagCols = db.query<{ name: string }, []>(
    "SELECT name FROM pragma_table_info('tags') WHERE name = 'category_slug'"
  ).all();
  if (tagCols.length === 0) {
    db.exec('ALTER TABLE tags ADD COLUMN category_slug TEXT REFERENCES categories(slug)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category_slug)');
  }

  // v006: Add depth_score column to entries
  const depthCol = db.query<{ name: string }, []>(
    "SELECT name FROM pragma_table_info('entries') WHERE name = 'depth_score'"
  ).all();
  if (depthCol.length === 0) {
    db.exec('ALTER TABLE entries ADD COLUMN depth_score REAL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_depth ON entries(depth_score) WHERE depth_score IS NOT NULL');
  }
};

export const closeDb = (): void => {
  if (db) {
    db.close();
    db = null;
  }
};
