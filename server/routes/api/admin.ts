import { Router, type Request, type Response, type NextFunction } from 'express';
import { parse as parseCsv } from 'csv-parse/sync';
import { query } from '../../lib/db.js';
import { processGhlEvent } from '../webhooks/ghl.js';
import { processParticipantLeft } from '../webhooks/zoom.js';
import { syncMetaAdsInsights } from '../../jobs/metaAdsCron.js';

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
      `SELECT id, workshop_date, label, is_active, zoom_webinar_id,
              ad_campaign_ids, ad_attribution_start, created_at
       FROM cohorts ORDER BY workshop_date DESC`,
    );
    res.json({ cohorts: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list cohorts' });
  }
});

/**
 * GET /api/admin/meta-campaigns
 * Distinct Meta campaigns pulled from ad_spend, with spend totals and
 * date ranges. Used by the /admin UI to let users assign campaigns to
 * cohorts for attribution.
 */
router.get('/meta-campaigns', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         campaign_id,
         MAX(campaign_name) AS campaign_name,
         MIN(date) AS first_date,
         MAX(date) AS last_date,
         SUM(spend)::numeric(12,2) AS total_spend,
         SUM(impressions)::int AS total_impressions,
         SUM(clicks)::int AS total_clicks
       FROM ad_spend
       GROUP BY campaign_id
       ORDER BY SUM(spend) DESC`,
    );
    res.json({ campaigns: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list campaigns' });
  }
});

/**
 * POST /api/admin/cohorts
 * Body: { cohorts: [{ workshop_date, label?, zoom_webinar_id? }] }
 *   or: { workshop_date, label?, zoom_webinar_id? }  (single)
 * Upserts by workshop_date. If a row already exists, non-null values in the
 * payload update the existing row (so you can add a zoom_webinar_id later).
 */
router.post('/cohorts', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const items: Array<{
      workshop_date: string;
      label?: string;
      zoom_webinar_id?: string;
      ad_campaign_ids?: string[];
      ad_attribution_start?: string | null;
    }> = Array.isArray(body?.cohorts) ? body.cohorts : body?.workshop_date ? [body] : [];

    if (items.length === 0) {
      res.status(400).json({
        error: 'Provide { workshop_date, label?, zoom_webinar_id?, ad_campaign_ids?, ad_attribution_start? } or a { cohorts: [...] } array',
      });
      return;
    }

    const touched: Array<{ workshop_date: string; action: 'inserted' | 'updated' }> = [];

    for (const item of items) {
      if (!item.workshop_date || !/^\d{4}-\d{2}-\d{2}$/.test(item.workshop_date)) {
        res.status(400).json({ error: `Invalid workshop_date: ${item.workshop_date} (use YYYY-MM-DD)` });
        return;
      }
      const label = item.label || formatDefaultLabel(item.workshop_date);
      const zoomId = item.zoom_webinar_id ? String(item.zoom_webinar_id).replace(/\s+/g, '') : null;

      // Ad attribution: presence of the key means "user explicitly set this".
      // undefined = keep existing DB value. null/empty array = clear it.
      const hasAdCampaigns = 'ad_campaign_ids' in item;
      const hasAdStart = 'ad_attribution_start' in item;
      const adCampaigns = hasAdCampaigns
        ? (Array.isArray(item.ad_campaign_ids) ? item.ad_campaign_ids.map(String) : [])
        : null;
      let adStart: string | null = null;
      if (hasAdStart) {
        const v = item.ad_attribution_start;
        if (v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          adStart = v;
        } else if (v === null || v === '') {
          adStart = null;
        } else {
          res.status(400).json({ error: `Invalid ad_attribution_start: ${v}` });
          return;
        }
      }

      const result = await query(
        `INSERT INTO cohorts (workshop_date, label, zoom_webinar_id, ad_campaign_ids, ad_attribution_start)
         VALUES ($1, $2, $3, COALESCE($4::text[], '{}'), $5::date)
         ON CONFLICT (workshop_date) DO UPDATE SET
           label = EXCLUDED.label,
           zoom_webinar_id = COALESCE(EXCLUDED.zoom_webinar_id, cohorts.zoom_webinar_id),
           ad_campaign_ids = COALESCE($6::text[], cohorts.ad_campaign_ids),
           ad_attribution_start = CASE WHEN $7::boolean THEN $5::date ELSE cohorts.ad_attribution_start END
         RETURNING workshop_date, (xmax = 0) AS inserted`,
        [
          item.workshop_date,
          label,
          zoomId,
          adCampaigns,
          adStart,
          adCampaigns, // $6 — same value as $4 for the UPDATE case
          hasAdStart,  // $7 — flag whether to override ad_attribution_start on update
        ],
      );
      touched.push({
        workshop_date: item.workshop_date,
        action: result.rows[0]?.inserted ? 'inserted' : 'updated',
      });
    }

    res.json({ totalRequested: items.length, results: touched });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to upsert cohorts' });
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
 * POST /api/admin/import-ghl-export
 * Accepts the raw GHL contact export format (an object keyed by GHL
 * contact ID with "First Name" / "Email" / "Tags" / etc fields) and
 * imports those contacts as workshop buyers.
 *
 * Body:
 * {
 *   "workshop_cohort": "2026-04-02",     // required
 *   "lead_source": "Email Kit",           // optional — applied to all rows
 *   "ghlExport": {
 *     "<ghl_contact_id>": { "Email": "...", "Tags": "...", ... },
 *     ...
 *   }
 * }
 */
router.post('/import-ghl-export', async (req: Request, res: Response) => {
  try {
    const cohort = req.body?.workshop_cohort as string;
    const leadSource = (req.body?.lead_source as string) || null;
    const ghlExport = req.body?.ghlExport;

    if (!cohort || !/^\d{4}-\d{2}-\d{2}$/.test(cohort)) {
      res.status(400).json({ error: 'workshop_cohort required in YYYY-MM-DD format' });
      return;
    }
    if (!ghlExport || typeof ghlExport !== 'object' || Array.isArray(ghlExport)) {
      res.status(400).json({ error: 'ghlExport must be an object keyed by GHL contact ID' });
      return;
    }

    const entries = Object.entries(ghlExport as Record<string, any>);
    if (entries.length === 0) {
      res.status(400).json({ error: 'ghlExport is empty' });
      return;
    }

    const results = { inserted: 0, updated: 0, skipped: [] as string[] };

    for (const [ghlId, raw] of entries) {
      // GHL export uses capitalized field names with spaces — normalize case-insensitively
      const email = pickField(raw, ['Email', 'email'])?.toString().trim().toLowerCase();
      if (!email) {
        results.skipped.push(ghlId);
        continue;
      }

      const result = await query(
        `INSERT INTO contacts (
           email, ghl_contact_id, workshop_cohort, lead_source,
           is_workshop_buyer
         ) VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (LOWER(email), workshop_cohort) DO UPDATE SET
           ghl_contact_id = COALESCE(EXCLUDED.ghl_contact_id, contacts.ghl_contact_id),
           lead_source = COALESCE(EXCLUDED.lead_source, contacts.lead_source),
           is_workshop_buyer = true
         RETURNING (xmax = 0) AS inserted`,
        [email, ghlId, cohort, leadSource],
      );
      if (result.rows[0]?.inserted) results.inserted++;
      else results.updated++;
    }

    res.json({ ok: true, totalProcessed: entries.length, ...results });
  } catch (err: any) {
    console.error('GHL export import failed:', err);
    res.status(500).json({ error: err?.message || 'GHL export import failed' });
  }
});

function pickField(obj: any, names: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  // Case-insensitive fallback
  const lowered: Record<string, any> = {};
  for (const k of Object.keys(obj)) lowered[k.toLowerCase()] = obj[k];
  for (const n of names) {
    const v = lowered[n.toLowerCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

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
         ON CONFLICT (LOWER(email), workshop_cohort) DO UPDATE SET
           ghl_contact_id = COALESCE(EXCLUDED.ghl_contact_id, contacts.ghl_contact_id),
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
 * POST /api/admin/import-zoom-attendance
 * Bulk import Zoom webinar attendee data (from a CSV export). Matches
 * attendees to existing contacts by email and updates their attendance
 * flags. Rows with no matching contact are still stored in zoom_attendance
 * for later reconciliation.
 *
 * Body:
 * {
 *   "webinar_id": "82612345678",           // required — from Zoom
 *   "workshop_cohort": "2026-04-02",       // required — YYYY-MM-DD
 *   "full_session_minutes": 45,            // optional — threshold for "stayed to end"
 *   "attendees": [
 *     { "email": "x@y.com", "join_time": "...", "leave_time": "...", "duration_minutes": 58 },
 *     ...
 *   ]
 * }
 *
 * duration_minutes can be provided directly, or computed from join/leave times.
 */
router.post('/import-zoom-attendance', async (req: Request, res: Response) => {
  try {
    const { webinar_id, workshop_cohort, attendees } = req.body || {};
    const fullSessionMinutes: number = Number(req.body?.full_session_minutes) || 45;

    if (!webinar_id || typeof webinar_id !== 'string') {
      res.status(400).json({ error: 'webinar_id is required (string)' });
      return;
    }
    if (!workshop_cohort || !/^\d{4}-\d{2}-\d{2}$/.test(workshop_cohort)) {
      res.status(400).json({ error: 'workshop_cohort required in YYYY-MM-DD format' });
      return;
    }
    if (!Array.isArray(attendees) || attendees.length === 0) {
      res.status(400).json({ error: 'attendees must be a non-empty array' });
      return;
    }

    const results = {
      attendeesImported: 0,
      contactsMatched: 0,
      guestsCreated: 0,
      contactsStayedFullSession: 0,
    };

    for (const a of attendees) {
      const email: string = (a.email || '').toLowerCase().trim();
      if (!email) continue;

      let duration = Number(a.duration_minutes);
      if (!duration && a.join_time && a.leave_time) {
        const ms = new Date(a.leave_time).getTime() - new Date(a.join_time).getTime();
        duration = Math.round(ms / 60000);
      }
      duration = Math.max(0, duration || 0);

      // Upsert zoom_attendance row
      await query(
        `INSERT INTO zoom_attendance
           (webinar_id, email, join_time, leave_time, duration_minutes, workshop_cohort)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (webinar_id, email) DO UPDATE SET
           join_time = COALESCE(EXCLUDED.join_time, zoom_attendance.join_time),
           leave_time = COALESCE(EXCLUDED.leave_time, zoom_attendance.leave_time),
           duration_minutes = GREATEST(EXCLUDED.duration_minutes, zoom_attendance.duration_minutes),
           workshop_cohort = COALESCE(EXCLUDED.workshop_cohort, zoom_attendance.workshop_cohort)`,
        [webinar_id, email, a.join_time || null, a.leave_time || null, duration, workshop_cohort],
      );
      results.attendeesImported++;

      const stayedFull = duration >= fullSessionMinutes;
      if (stayedFull) results.contactsStayedFullSession++;

      // Match to existing contact for this cohort, or auto-create as guest
      const contactResult = await query(
        `SELECT id, is_guest FROM contacts
         WHERE LOWER(email) = $1 AND workshop_cohort = $2::date
         LIMIT 1`,
        [email, workshop_cohort],
      );
      const contact = contactResult.rows[0];

      let contactId: string;
      if (contact) {
        contactId = contact.id;
        await query(
          `UPDATE contacts SET
             attended_workshop = true,
             attended_full_session = $1 OR attended_full_session,
             attended_minutes = GREATEST(COALESCE(attended_minutes, 0), $2)
           WHERE id = $3`,
          [stayedFull, duration, contactId],
        );
        results.contactsMatched++;
      } else {
        // No existing contact → treat as guest (invited to Zoom directly,
        // not through the GHL paid-purchase funnel)
        const inserted = await query(
          `INSERT INTO contacts
             (email, workshop_cohort, is_workshop_buyer, is_guest,
              attended_workshop, attended_full_session, attended_minutes)
           VALUES ($1, $2::date, true, true, true, $3, $4)
           ON CONFLICT (LOWER(email), workshop_cohort) DO UPDATE SET
             attended_workshop = true,
             attended_full_session = EXCLUDED.attended_full_session OR contacts.attended_full_session,
             attended_minutes = GREATEST(COALESCE(contacts.attended_minutes, 0), EXCLUDED.attended_minutes)
           RETURNING id`,
          [email, workshop_cohort, stayedFull, duration],
        );
        contactId = inserted.rows[0].id;
        results.guestsCreated++;
      }

      await query(
        `UPDATE zoom_attendance SET matched_contact_id = $1 WHERE webinar_id = $2 AND email = $3`,
        [contactId, webinar_id, email],
      );
    }

    res.json({ ok: true, ...results });
  } catch (err: any) {
    console.error('Zoom import failed:', err);
    res.status(500).json({ error: err?.message || 'Zoom import failed' });
  }
});

/**
 * POST /api/admin/import-zoom-csv
 * Upload a raw Zoom Attendee Report CSV and auto-import attendance.
 * Handles Zoom's usual format — header/summary rows at the top, then the
 * actual table starting with columns like "Name", "User Email",
 * "Join Time", "Leave Time", "Time in Session (minutes)".
 *
 * Send as:
 *   Content-Type: text/csv
 *   curl --data-binary @report.csv ?workshop_cohort=2026-04-02&webinar_id=XXX
 *
 * Query params (all required except full_session_minutes):
 *   workshop_cohort=YYYY-MM-DD
 *   webinar_id=<any string, can be from Zoom or just the cohort date>
 *   full_session_minutes=45  (default 45)
 */
router.post('/import-zoom-csv', async (req: Request, res: Response) => {
  try {
    const cohort = req.query.workshop_cohort as string;
    const webinarId = (req.query.webinar_id as string) || `apr2-${cohort}`;
    const fullSessionMinutes = Number(req.query.full_session_minutes) || 45;

    if (!cohort || !/^\d{4}-\d{2}-\d{2}$/.test(cohort)) {
      res.status(400).json({ error: 'workshop_cohort query param required (YYYY-MM-DD)' });
      return;
    }

    const csvText = typeof req.body === 'string' ? req.body : '';
    if (!csvText.trim()) {
      res.status(400).json({ error: 'CSV body is empty. Send with Content-Type: text/csv and --data-binary @file.csv' });
      return;
    }

    // Parse CSV as a 2D array so we can hunt for the header row ourselves.
    const rows: string[][] = parseCsv(csvText, {
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    });

    // Find the header row: the first row that contains both an Email-like
    // column AND a Time/Duration-like column. Zoom's attendee report has
    // a summary block at the top; the real table starts lower down.
    let headerIdx = -1;
    let emailCol = -1, joinCol = -1, leaveCol = -1, durationCol = -1, attendedCol = -1;

    const normalize = (s: string) => (s || '').toLowerCase().trim();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].map(normalize);
      const ec = row.findIndex((c) => c.includes('email'));
      const dc = row.findIndex((c) => c.includes('time in session') || c.includes('duration') || c.includes('time (minutes)'));
      if (ec >= 0 && dc >= 0) {
        headerIdx = i;
        emailCol = ec;
        durationCol = dc;
        joinCol = row.findIndex((c) => c.includes('join time') || c === 'join');
        leaveCol = row.findIndex((c) => c.includes('leave time') || c === 'leave');
        attendedCol = row.findIndex((c) => c === 'attended');
        break;
      }
    }

    if (headerIdx < 0) {
      res.status(400).json({
        error: "Couldn't find the attendee table header. Expected columns like 'User Email' and 'Time in Session (minutes)'. Are you sure this is the Zoom Attendee Report?",
      });
      return;
    }

    const attendees: Array<{
      email: string;
      join_time: string | null;
      leave_time: string | null;
      duration_minutes: number;
    }> = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      // Stop at an empty/summary row
      if (!row[emailCol] || !row[emailCol].trim()) continue;

      // Filter to only attended=Yes if that column exists
      if (attendedCol >= 0) {
        const attendedVal = (row[attendedCol] || '').toLowerCase().trim();
        if (attendedVal && attendedVal !== 'yes' && attendedVal !== 'true') continue;
      }

      const email = row[emailCol].trim().toLowerCase();
      if (!email.includes('@')) continue; // skip non-email rows (e.g. another summary section)

      const durationRaw = row[durationCol] || '0';
      const duration = parseInt(durationRaw.toString().replace(/[^\d]/g, ''), 10) || 0;

      attendees.push({
        email,
        join_time: joinCol >= 0 ? (row[joinCol] || null) : null,
        leave_time: leaveCol >= 0 ? (row[leaveCol] || null) : null,
        duration_minutes: duration,
      });
    }

    if (attendees.length === 0) {
      res.status(400).json({ error: 'No attendee rows found in CSV' });
      return;
    }

    const results = {
      attendeesImported: 0,
      contactsMatched: 0,
      guestsCreated: 0,
      contactsStayedFullSession: 0,
    };

    for (const a of attendees) {
      await query(
        `INSERT INTO zoom_attendance
           (webinar_id, email, join_time, leave_time, duration_minutes, workshop_cohort)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (webinar_id, email) DO UPDATE SET
           join_time = COALESCE(EXCLUDED.join_time, zoom_attendance.join_time),
           leave_time = COALESCE(EXCLUDED.leave_time, zoom_attendance.leave_time),
           duration_minutes = GREATEST(EXCLUDED.duration_minutes, zoom_attendance.duration_minutes),
           workshop_cohort = COALESCE(EXCLUDED.workshop_cohort, zoom_attendance.workshop_cohort)`,
        [webinarId, a.email, a.join_time, a.leave_time, a.duration_minutes, cohort],
      );
      results.attendeesImported++;

      const stayedFull = a.duration_minutes >= fullSessionMinutes;
      if (stayedFull) results.contactsStayedFullSession++;

      const contactResult = await query(
        `SELECT id FROM contacts
         WHERE LOWER(email) = $1 AND workshop_cohort = $2::date
         LIMIT 1`,
        [a.email, cohort],
      );
      const contact = contactResult.rows[0];

      let contactId: string;
      if (contact) {
        contactId = contact.id;
        await query(
          `UPDATE contacts SET
             attended_workshop = true,
             attended_full_session = $1 OR attended_full_session,
             attended_minutes = GREATEST(COALESCE(attended_minutes, 0), $2)
           WHERE id = $3`,
          [stayedFull, a.duration_minutes, contactId],
        );
        results.contactsMatched++;
      } else {
        // Auto-create as guest (invited directly to Zoom, not through GHL)
        const inserted = await query(
          `INSERT INTO contacts
             (email, workshop_cohort, is_workshop_buyer, is_guest,
              attended_workshop, attended_full_session, attended_minutes)
           VALUES ($1, $2::date, true, true, true, $3, $4)
           ON CONFLICT (LOWER(email), workshop_cohort) DO UPDATE SET
             attended_workshop = true,
             attended_full_session = EXCLUDED.attended_full_session OR contacts.attended_full_session,
             attended_minutes = GREATEST(COALESCE(contacts.attended_minutes, 0), EXCLUDED.attended_minutes)
           RETURNING id`,
          [a.email, cohort, stayedFull, a.duration_minutes],
        );
        contactId = inserted.rows[0].id;
        results.guestsCreated++;
      }

      await query(
        `UPDATE zoom_attendance SET matched_contact_id = $1 WHERE webinar_id = $2 AND email = $3`,
        [contactId, webinarId, a.email],
      );
    }

    res.json({
      ok: true,
      parsed: attendees.length,
      ...results,
      preview: attendees.slice(0, 3),
    });
  } catch (err: any) {
    console.error('Zoom CSV import failed:', err);
    res.status(500).json({ error: err?.message || 'Zoom CSV import failed' });
  }
});

/**
 * POST /api/admin/meta-sync
 * Manually trigger a Meta Ads insights sync. Useful for backfilling
 * historical ad spend and for testing the connection without waiting
 * for the 6am UTC cron.
 *
 * Body (all optional):
 *   { since: "YYYY-MM-DD", until: "YYYY-MM-DD" }
 * Defaults to yesterday only (same as the cron).
 * Max range: ~90 days (Meta's API limits).
 */
router.post('/meta-sync', async (req: Request, res: Response) => {
  try {
    const { since, until } = req.body || {};
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (since && !dateRegex.test(since)) {
      res.status(400).json({ error: 'since must be YYYY-MM-DD' });
      return;
    }
    if (until && !dateRegex.test(until)) {
      res.status(400).json({ error: 'until must be YYYY-MM-DD' });
      return;
    }
    const result = await syncMetaAdsInsights({ since, until });
    const status = result.ok ? 200 : 500;
    res.status(status).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Meta sync failed' });
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

    // Snapshot contact state BEFORE so we can show what changed
    const lookupQuery = body.email
      ? `SELECT email, ghl_contact_id, workshop_cohort, is_workshop_buyer,
                attended_workshop, deposit_paid, call_booked, call_completed,
                call_disposition, converted_to_pe, mrr_value
         FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1`
      : `SELECT email, ghl_contact_id, workshop_cohort, is_workshop_buyer,
                attended_workshop, deposit_paid, call_booked, call_completed,
                call_disposition, converted_to_pe, mrr_value
         FROM contacts WHERE ghl_contact_id = $1 LIMIT 1`;
    const lookupParam = body.email || body.ghl_contact_id;

    const before = lookupParam ? (await query(lookupQuery, [lookupParam])).rows[0] || null : null;

    await processGhlEvent(event, body);

    const after = lookupParam ? (await query(lookupQuery, [lookupParam])).rows[0] || null : null;

    const matched = !!after;
    const changed = matched && JSON.stringify(before) !== JSON.stringify(after);

    res.json({
      ok: true,
      event,
      body,
      matched,
      changed,
      contactExisted: !!before,
      contact: after,
      note: !matched
        ? `No contact in DB matched email=${body.email} or ghl_contact_id=${body.ghl_contact_id}. The event was processed but updated 0 rows.`
        : changed
          ? 'Contact found and state updated.'
          : 'Contact found but no fields changed (already in target state, or event applied no-op).',
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Simulate failed' });
  }
});

/**
 * POST /api/admin/contacts/update
 * Surgical update of a single contact's fields. Use for cleanup —
 * e.g. unset attended_workshop on a contact that was wrongly flagged.
 *
 * Body: { email | ghl_contact_id, set: { field: value, ... } }
 *
 * Whitelisted fields: workshop_cohort, lead_source, referral_partner,
 *   is_workshop_buyer, attended_workshop, attended_full_session,
 *   attended_minutes, deposit_paid, deposit_refunded, call_booked,
 *   call_completed, call_disposition, converted_to_pe, assigned_rep, mrr_value
 *
 * Setting any *_at field to NULL also clears the timestamp; setting a flag
 * to false clears its corresponding timestamp automatically.
 */
router.post('/contacts/update', async (req: Request, res: Response) => {
  try {
    const { email, ghl_contact_id, set } = req.body || {};
    if (!email && !ghl_contact_id) {
      res.status(400).json({ error: 'Provide email or ghl_contact_id' });
      return;
    }
    if (!set || typeof set !== 'object') {
      res.status(400).json({ error: 'Provide a "set" object with fields to update' });
      return;
    }

    const allowed = new Set([
      'workshop_cohort', 'lead_source', 'referral_partner',
      'is_workshop_buyer', 'is_guest',
      'attended_workshop', 'attended_full_session', 'attended_minutes',
      'deposit_paid', 'deposit_paid_at', 'deposit_refunded',
      'call_booked', 'call_booked_at',
      'call_completed', 'call_completed_at',
      'call_disposition',
      'converted_to_pe', 'converted_at',
      'assigned_rep', 'mrr_value',
      'pe_payment_plan', 'pe_initial_payment',
    ]);

    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const [field, value] of Object.entries(set)) {
      if (!allowed.has(field)) continue;
      sets.push(`${field} = $${i++}`);
      params.push(value);
      // Auto-clear corresponding *_at timestamp when its boolean flips false
      if (value === false) {
        const tsField = `${field}_at`;
        sets.push(`${tsField} = NULL`);
      }
    }
    if (sets.length === 0) {
      res.status(400).json({ error: 'No valid fields in set object (or all values omitted)' });
      return;
    }

    const whereClause = email ? `LOWER(email) = LOWER($${i})` : `ghl_contact_id = $${i}`;
    params.push(email || ghl_contact_id);

    const result = await query(
      `UPDATE contacts SET ${sets.join(', ')} WHERE ${whereClause} RETURNING *`,
      params,
    );

    res.json({
      ok: true,
      updatedRows: result.rowCount,
      contact: result.rows[0] || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Update failed' });
  }
});

/**
 * POST /api/admin/simulate-zoom
 * Run a fake Zoom participant_left event through the real handler —
 * verifies the full Zoom flow (DB upsert, contact matching, attended flags)
 * works without needing a live webinar.
 *
 * Body:
 * {
 *   "email": "test@example.com",
 *   "webinar_id": "999888777",           // any string, used as the attendance row key
 *   "duration_minutes": 65,              // how long they "stayed"
 *   "join_time": "2026-04-30T14:00:00Z", // optional — auto-generated if omitted
 *   "leave_time": "2026-04-30T15:05:00Z" // optional
 * }
 */
router.post('/simulate-zoom', async (req: Request, res: Response) => {
  try {
    const { email, webinar_id, duration_minutes, join_time, leave_time } = req.body || {};
    if (!email || !webinar_id) {
      res.status(400).json({ error: 'Body must include email and webinar_id' });
      return;
    }
    const duration = Number(duration_minutes) || 0;
    const now = new Date();
    const fakeJoin = join_time || new Date(now.getTime() - duration * 60_000).toISOString();
    const fakeLeave = leave_time || now.toISOString();

    const payload = {
      object: {
        id: webinar_id,
        participant: {
          email,
          join_time: fakeJoin,
          leave_time: fakeLeave,
        },
      },
    };

    await processParticipantLeft(payload);

    // Report back what we stored so the user can verify
    const zoomRow = await query(
      `SELECT webinar_id, email, duration_minutes, matched_contact_id
       FROM zoom_attendance WHERE webinar_id = $1 AND email = $2`,
      [String(webinar_id), email],
    );
    const contactRow = await query(
      `SELECT email, attended_workshop, attended_full_session, attended_minutes
       FROM contacts WHERE email = $1`,
      [email],
    );

    res.json({
      ok: true,
      simulated: payload,
      zoom_attendance: zoomRow.rows[0] || null,
      contact: contactRow.rows[0] || null,
      note: contactRow.rows.length === 0
        ? 'No matching contact in the contacts table — the attendance row was stored but not linked. Real webhooks will behave the same way for guest attendees.'
        : 'Contact matched and attendance flags updated.',
    });
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
