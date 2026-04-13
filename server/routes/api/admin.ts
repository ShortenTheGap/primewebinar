import { Router, type Request, type Response, type NextFunction } from 'express';
import { query } from '../../lib/db.js';
import { processGhlEvent } from '../webhooks/ghl.js';

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

/**
 * POST /api/admin/simulate-ghl
 * Runs a GHL event through the real handler. Lets you test the full pipeline
 * end-to-end without needing to configure GHL webhooks.
 * Body: { event: "contact.tag_added", body: { ... } }
 */
router.post('/simulate-ghl', async (req: Request, res: Response) => {
  try {
    const { event, body } = req.body || {};
    if (!event || !body) {
      res.status(400).json({ error: 'Body must be { event, body }' });
      return;
    }
    await processGhlEvent(event, body);
    res.json({ ok: true, event, body });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Simulate failed' });
  }
});

/**
 * POST /api/admin/seed-demo
 * Generates a realistic funnel of fake contacts for a given cohort so the
 * dashboard shows a populated demo. Idempotent per email prefix.
 * Body: { workshop_cohort: "YYYY-MM-DD", count?: number }
 */
router.post('/seed-demo', async (req: Request, res: Response) => {
  try {
    const cohort = req.body?.workshop_cohort as string;
    const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 50, 1), 500);

    if (!cohort || !/^\d{4}-\d{2}-\d{2}$/.test(cohort)) {
      res.status(400).json({ error: 'workshop_cohort required in YYYY-MM-DD format' });
      return;
    }

    const sources = ['Email Kit', 'FB Ad', 'IG Ad', 'IG Organic', 'FB Organic', 'Partner'];
    const partners = [null, null, 'Krista M.', 'Joey M.', 'Sunny K.'];
    const reps = ['Rep A', 'Rep B'];
    const dispositions: Array<'sold' | 'follow_up' | 'not_a_fit' | 'no_show'> = [
      'sold', 'follow_up', 'not_a_fit', 'no_show',
    ];

    const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const chance = (p: number): boolean => Math.random() < p;

    // Clear existing demo rows for this cohort to keep the endpoint idempotent.
    await query(
      `DELETE FROM contacts WHERE email LIKE $1 AND workshop_cohort = $2`,
      [`demo+${cohort}-%`, cohort],
    );

    let created = 0;
    for (let i = 0; i < count; i++) {
      const email = `demo+${cohort}-${i}@example.com`;
      const lead_source = pick(sources);
      const referral_partner = lead_source === 'Partner' ? pick(partners.filter(Boolean)) : null;

      // Realistic funnel rates: everyone is a buyer, then drop-offs
      const attended = chance(0.76);
      const deposited = attended && chance(0.48 / 0.76);
      const booked = deposited && chance(0.83);
      const completed = booked && chance(0.78);
      const disposition = completed ? pick(dispositions) : null;
      const converted = disposition === 'sold';
      const assigned_rep = completed ? pick(reps) : null;

      await query(
        `INSERT INTO contacts
           (email, workshop_cohort, lead_source, referral_partner,
            is_workshop_buyer, attended_workshop, deposit_paid, deposit_paid_at,
            call_booked, call_booked_at, call_completed, call_completed_at,
            call_disposition, converted_to_pe, converted_at, assigned_rep, mrr_value)
         VALUES
           ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          email, cohort, lead_source, referral_partner,
          attended, deposited, deposited ? new Date() : null,
          booked, booked ? new Date() : null,
          completed, completed ? new Date() : null,
          disposition, converted, converted ? new Date() : null,
          assigned_rep, converted ? 2500 : 0,
        ],
      );
      created++;
    }

    res.json({ ok: true, cohort, created });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Seed failed' });
  }
});

/**
 * DELETE /api/admin/demo-data
 * Clears all fake demo contacts (emails starting with "demo+").
 */
router.delete('/demo-data', async (_req: Request, res: Response) => {
  try {
    const result = await query(`DELETE FROM contacts WHERE email LIKE 'demo+%'`);
    res.json({ deleted: result.rowCount ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Delete failed' });
  }
});

function formatDefaultLabel(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export default router;
