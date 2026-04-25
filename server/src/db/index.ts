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

  return db;
};

const applySchema = (db: Database): void => {
  const schemaPath = join(import.meta.dir, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
};

export const closeDb = (): void => {
  if (db) {
    db.close();
    db = null;
  }
};
