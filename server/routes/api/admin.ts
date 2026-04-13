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
 * POST /api/admin/import-contacts
 * Bulk upsert of real contacts with full funnel state. For backfilling
 * historical cohorts that happened before webhooks were wired up.
 *
 * Body: { contacts: [ { email, workshop_cohort, is_workshop_buyer, ... } ] }
 *
 * Upsert key: email. Provide whichever fields you have; missing fields
 * default to safe values. Dates like deposit_paid_at are auto-set to NOW()
 * when their corresponding boolean is true and no explicit timestamp given.
 */
router.post('/import-contacts', async (req: Request, res: Response) => {
  try {
    const contacts: any[] = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    if (contacts.length === 0) {
      res.status(400).json({ error: 'Body must be { contacts: [...] } with at least one row' });
      return;
    }

    const validDispositions = new Set(['sold', 'follow_up', 'not_a_fit', 'no_show']);
    const results = { inserted: 0, updated: 0, skipped: [] as string[] };

    for (const c of contacts) {
      if (!c.email) {
        results.skipped.push(`(no email: ${JSON.stringify(c).slice(0, 60)})`);
        continue;
      }

      const disposition = c.call_disposition && validDispositions.has(c.call_disposition)
        ? c.call_disposition
        : null;

      const now = new Date();
      const depositAt = c.deposit_paid_at ? new Date(c.deposit_paid_at) : (c.deposit_paid ? now : null);
      const bookedAt = c.call_booked_at ? new Date(c.call_booked_at) : (c.call_booked ? now : null);
      const completedAt = c.call_completed_at ? new Date(c.call_completed_at) : (c.call_completed ? now : null);
      const convertedAt = c.converted_at ? new Date(c.converted_at) : (c.converted_to_pe ? now : null);

      const result = await query(
        `INSERT INTO contacts (
           email, ghl_contact_id, workshop_cohort, lead_source, utm_campaign,
           utm_content, utm_medium, referral_partner,
           is_workshop_buyer, attended_workshop,
           deposit_paid, deposit_paid_at, deposit_refunded,
           call_booked, call_booked_at,
           call_completed, call_completed_at,
           call_disposition, converted_to_pe, converted_at,
           assigned_rep, mrr_value
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
         )
         ON CONFLICT (ghl_contact_id) DO UPDATE SET
           email = EXCLUDED.email,
           workshop_cohort = COALESCE(EXCLUDED.workshop_cohort, contacts.workshop_cohort),
           lead_source = COALESCE(EXCLUDED.lead_source, contacts.lead_source),
           referral_partner = COALESCE(EXCLUDED.referral_partner, contacts.referral_partner),
           is_workshop_buyer = EXCLUDED.is_workshop_buyer OR contacts.is_workshop_buyer,
           attended_workshop = COALESCE(EXCLUDED.attended_workshop, contacts.attended_workshop),
           deposit_paid = EXCLUDED.deposit_paid OR contacts.deposit_paid,
           deposit_paid_at = COALESCE(contacts.deposit_paid_at, EXCLUDED.deposit_paid_at),
           deposit_refunded = EXCLUDED.deposit_refunded OR contacts.deposit_refunded,
           call_booked = EXCLUDED.call_booked OR contacts.call_booked,
           call_booked_at = COALESCE(contacts.call_booked_at, EXCLUDED.call_booked_at),
           call_completed = EXCLUDED.call_completed OR contacts.call_completed,
           call_completed_at = COALESCE(contacts.call_completed_at, EXCLUDED.call_completed_at),
           call_disposition = COALESCE(EXCLUDED.call_disposition, contacts.call_disposition),
           converted_to_pe = EXCLUDED.converted_to_pe OR contacts.converted_to_pe,
           converted_at = COALESCE(contacts.converted_at, EXCLUDED.converted_at),
           assigned_rep = COALESCE(EXCLUDED.assigned_rep, contacts.assigned_rep),
           mrr_value = GREATEST(EXCLUDED.mrr_value, contacts.mrr_value)
         RETURNING (xmax = 0) AS inserted`,
        [
          c.email,
          c.ghl_contact_id || c.email, // fall back to email as unique key if no GHL id
          c.workshop_cohort || null,
          c.lead_source || null,
          c.utm_campaign || null,
          c.utm_content || null,
          c.utm_medium || null,
          c.referral_partner || null,
          c.is_workshop_buyer ?? true,
          c.attended_workshop ?? null,
          c.deposit_paid ?? false,
          depositAt,
          c.deposit_refunded ?? false,
          c.call_booked ?? false,
          bookedAt,
          c.call_completed ?? false,
          completedAt,
          disposition,
          c.converted_to_pe ?? false,
          convertedAt,
          c.assigned_rep || null,
          c.mrr_value ?? (c.converted_to_pe ? 2500 : 0),
        ],
      );

      if (result.rows[0]?.inserted) results.inserted++;
      else results.updated++;
    }

    res.json({ ok: true, ...results });
  } catch (err: any) {
    console.error('Import failed:', err);
    res.status(500).json({ error: err?.message || 'Import failed' });
  }
});

/**
 * GET /api/admin/contacts?limit=20
 * Inspect recent contact rows for debugging. Shows the exact values stored —
 * critical for verifying workshop_cohort format, UTM fields, tags, etc.
 */
router.get('/contacts', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 200);
    const cohort = req.query.cohort as string | undefined;

    const result = cohort
      ? await query(
          `SELECT email, ghl_contact_id, workshop_cohort, lead_source,
                  is_workshop_buyer, attended_workshop, deposit_paid,
                  call_booked, call_completed, call_disposition,
                  converted_to_pe, mrr_value, created_at
           FROM contacts WHERE workshop_cohort = $1 ORDER BY created_at DESC LIMIT $2`,
          [cohort, limit],
        )
      : await query(
          `SELECT email, ghl_contact_id, workshop_cohort, lead_source,
                  is_workshop_buyer, attended_workshop, deposit_paid,
                  call_booked, call_completed, call_disposition,
                  converted_to_pe, mrr_value, created_at
           FROM contacts ORDER BY created_at DESC LIMIT $1`,
          [limit],
        );

    res.json({
      count: result.rowCount,
      contacts: result.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list contacts' });
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
