import { Router, type Request, type Response, type NextFunction } from 'express';
import { query } from '../../lib/db.js';

const router = Router();

// Token-based auth middleware. Set ADMIN_TOKEN in Railway variables.
function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'ADMIN_TOKEN is not configured on the server' });
    return;
  }
  const provided = req.headers['x-admin-token'];
  if (provided !== expected) {
    res.status(401).json({ error: 'Invalid or missing x-admin-token header' });
    return;
  }
  next();
}

router.use(requireAdminToken);

/**
 * GET /api/admin/cohorts
 * List all cohorts, newest first.
 */
router.get('/cohorts', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, workshop_date, label, is_active, created_at
       FROM cohorts ORDER BY workshop_date DESC`,
    );
    res.json({ cohorts: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list cohorts' });
  }
});

/**
 * POST /api/admin/cohorts
 * Body: { cohorts: [{ workshop_date: "YYYY-MM-DD", label?: string }] }
 *   or: { workshop_date: "YYYY-MM-DD", label?: string }  (single)
 * Upserts by workshop_date; existing rows are left alone.
 */
router.post('/cohorts', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const items: Array<{ workshop_date: string; label?: string }> = Array.isArray(body?.cohorts)
      ? body.cohorts
      : body?.workshop_date
        ? [body]
        : [];

    if (items.length === 0) {
      res.status(400).json({
        error: 'Provide either { workshop_date, label } or { cohorts: [{ workshop_date, label }] }',
      });
      return;
    }

    const inserted: string[] = [];
    const skipped: string[] = [];

    for (const item of items) {
      if (!item.workshop_date || !/^\d{4}-\d{2}-\d{2}$/.test(item.workshop_date)) {
        res.status(400).json({ error: `Invalid workshop_date: ${item.workshop_date} (use YYYY-MM-DD)` });
        return;
      }
      const label = item.label || formatDefaultLabel(item.workshop_date);
      const result = await query(
        `INSERT INTO cohorts (workshop_date, label)
         VALUES ($1, $2)
         ON CONFLICT (workshop_date) DO NOTHING
         RETURNING workshop_date`,
        [item.workshop_date, label],
      );
      if (result.rowCount && result.rowCount > 0) {
        inserted.push(item.workshop_date);
      } else {
        skipped.push(item.workshop_date);
      }
    }

    res.json({ inserted, skipped, totalRequested: items.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to insert cohorts' });
  }
});

/**
 * DELETE /api/admin/cohorts/:workshop_date
 * Remove a cohort by date.
 */
router.delete('/cohorts/:workshop_date', async (req: Request, res: Response) => {
  try {
    const { workshop_date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workshop_date)) {
      res.status(400).json({ error: `Invalid workshop_date: ${workshop_date}` });
      return;
    }
    const result = await query(
      `DELETE FROM cohorts WHERE workshop_date = $1`,
      [workshop_date],
    );
    res.json({ deleted: result.rowCount ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to delete cohort' });
  }
});

function formatDefaultLabel(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export default router;
