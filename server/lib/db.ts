import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL must be set');
    }
    _pool = new Pool({
      connectionString,
      // Railway drops idle connections — keep pool size modest and recycle often
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    // CRITICAL: pg pools crash the Node process if idle client errors
    // (e.g. Railway dropping idle TCP connections) have no listener.
    _pool.on('error', (err) => {
      console.error('[pg pool] idle client error (recovered):', err.message);
    });
  }
  return _pool;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Runs the SQL schema file on startup. Idempotent — safe to run on every boot.
 * Skips silently if DATABASE_URL is not set (Phase 1 static mode).
 */
export async function initSchema(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — skipping schema init (static mode)');
    return;
  }

  // Schema file is copied to dist/db/schema.sql during build.
  // In dev (tsx), __dirname is server/lib — resolve ../../db/schema.sql
  // In prod (compiled), __dirname is dist/server/lib — resolve ../../db/schema.sql
  const schemaPath = path.resolve(__dirname, '../../db/schema.sql');

  if (!fs.existsSync(schemaPath)) {
    console.warn(`Schema file not found at ${schemaPath} — skipping init`);
    return;
  }

  try {
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    await getPool().query(sql);
    console.log('Database schema initialized successfully');
  } catch (err) {
    console.error('Failed to initialize schema:', err);
    throw err;
  }
}
