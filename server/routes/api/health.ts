import { Router, type Request, type Response } from 'express';
import { query } from '../../lib/db.js';

const router = Router();

/**
 * Diagnostic endpoint. Reports whether DATABASE_URL is set, whether the
 * schema tables exist, and row counts. Useful for debugging deploys.
 */
router.get('/', async (_req: Request, res: Response) => {
  const status: any = {
    hasDbUrl: !!process.env.DATABASE_URL,
    dataSource: process.env.VITE_DATA_SOURCE || 'unset',
    time: new Date().toISOString(),
  };

  if (!process.env.DATABASE_URL) {
    status.error = 'DATABASE_URL is not set';
    res.status(500).json(status);
    return;
  }

  try {
    const tablesResult = await query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    status.tables = tablesResult.rows.map((r: any) => r.table_name);

    const counts: Record<string, number> = {};
    for (const table of ['contacts', 'cohorts', 'ad_spend', 'zoom_attendance']) {
      if (status.tables.includes(table)) {
        const r = await query(`SELECT COUNT(*)::int AS n FROM ${table}`);
        counts[table] = r.rows[0].n;
      }
    }
    status.rowCounts = counts;
    status.ok = true;
    res.json(status);
  } catch (err: any) {
    status.error = err?.message || String(err);
    status.ok = false;
    res.status(500).json(status);
  }
});

export default router;
