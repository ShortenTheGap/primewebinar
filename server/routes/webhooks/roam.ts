import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { query } from '../../lib/db.js';

const router = Router();

function verifyToken(provided: string | undefined): boolean {
  const expected = process.env.ROAM_WEBHOOK_SECRET || '';
  if (!expected || !provided) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Try a handful of common field locations to pluck an email out of whatever
// JSON shape ro.am sends. Logged payloads will tell us which one matches
// so we can tighten this later.
function extractEmail(body: any): string | null {
  if (!body || typeof body !== 'object') return null;

  const candidates = [
    body.email,
    body.attendee?.email,
    body.invitee?.email,
    body.participant?.email,
    body.contact?.email,
    body.booker?.email,
    body.user?.email,
    body.data?.email,
    body.data?.attendee?.email,
    body.booking?.email,
    body.booking?.attendee?.email,
    body.booking?.invitee?.email,
    body.payload?.email,
    body.payload?.attendee?.email,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.includes('@')) {
      return c.trim().toLowerCase();
    }
  }
  return null;
}

// Pull the host's email / name / id from the payload. ro.am might nest this
// in any of several places; try them all and return whatever we find.
function extractHostIdentifiers(body: any): string[] {
  if (!body || typeof body !== 'object') return [];
  const ids: string[] = [];
  const sources = [
    body.host,
    body.organizer,
    body.owner,
    body.user,
    body.meeting?.host,
    body.booking?.host,
    body.call?.host,
    body.data?.host,
    body.payload?.host,
  ];
  for (const s of sources) {
    if (!s) continue;
    if (typeof s === 'string') {
      ids.push(s);
    } else if (typeof s === 'object') {
      if (typeof s.email === 'string') ids.push(s.email);
      if (typeof s.name === 'string') ids.push(s.name);
      if (typeof s.id === 'string') ids.push(s.id);
      if (typeof s.full_name === 'string') ids.push(s.full_name);
      if (typeof s.display_name === 'string') ids.push(s.display_name);
    }
  }
  return ids.map((s) => s.trim()).filter(Boolean);
}

// Check the extracted host identifiers against ROAM_ALLOWED_HOSTS.
// Env var is a comma-separated list of names, emails, or IDs. Match is
// case-insensitive substring — so "Joe Reed" matches "joe reed", "Joe Reed, PhD",
// "joe.reed@prime.com" (if his email starts with "joe.reed"), etc.
// If ROAM_ALLOWED_HOSTS is empty/unset, all hosts are allowed (no filter).
function isAllowedHost(hostIds: string[]): boolean {
  const raw = process.env.ROAM_ALLOWED_HOSTS || '';
  if (!raw.trim()) return true; // no filter configured
  const allowed = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return hostIds.some((id) =>
    allowed.some((a) => id.toLowerCase().includes(a) || a.includes(id.toLowerCase())),
  );
}

// Same approach for a cohort / workshop date if ro.am passes one as metadata.
function extractCohort(body: any): string | null {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.workshop_cohort,
    body.cohort,
    body.metadata?.workshop_cohort,
    body.data?.workshop_cohort,
    body.booking?.metadata?.workshop_cohort,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c)) return c;
  }
  return null;
}

// GET for sanity (same pattern as zoom endpoint)
router.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, endpoint: 'roam-webhook' });
});

router.post('/', async (req: Request, res: Response) => {
  console.log('[roam-webhook] POST received', {
    headers: {
      contentType: req.headers['content-type'],
      hasToken: !!req.headers['x-roam-token'],
      hasAuthz: !!req.headers['authorization'],
    },
    bodyKeys: req.body ? Object.keys(req.body) : [],
    bodyPreview: JSON.stringify(req.body || {}).slice(0, 500),
  });

  // Accept token via x-roam-token header OR Authorization: Bearer <token>
  // (ro.am may use either convention)
  const token =
    (req.headers['x-roam-token'] as string | undefined) ||
    (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');

  if (!verifyToken(token)) {
    console.warn('[roam-webhook] rejected — invalid or missing token');
    res.status(401).json({ error: 'Invalid or missing auth token' });
    return;
  }

  // Respond 200 fast so ro.am doesn't retry
  res.status(200).json({ received: true });

  // Process asynchronously
  processRoamEvent(req.body).catch((err) => {
    console.error('[roam-webhook] processing error:', err);
  });
});

async function processRoamEvent(body: any): Promise<void> {
  const email = extractEmail(body);
  const cohort = extractCohort(body);
  const hostIds = extractHostIdentifiers(body);

  if (!email) {
    console.warn('[roam-webhook] no email found in payload — full body logged above for debugging');
    return;
  }

  // Filter 1: Only process bookings for specific ro.am host(s) if configured.
  if (!isAllowedHost(hostIds)) {
    console.log(
      `[roam-webhook] SKIPPED — host not in allowlist. hosts=${JSON.stringify(hostIds)}, allow=${process.env.ROAM_ALLOWED_HOSTS || '(none)'}`,
    );
    return;
  }

  // Filter 2: Only process emails that are known workshop buyers in our DB.
  // (This prevents random booking emails from getting marked as call_booked.)
  const existing = await query(
    `SELECT id, is_workshop_buyer FROM contacts WHERE LOWER(email) = $1`,
    [email],
  );

  if (existing.rowCount === 0) {
    console.log(`[roam-webhook] SKIPPED — no matching contact for email=${email} (not a workshop attendee)`);
    return;
  }
  if (!existing.rows[0].is_workshop_buyer) {
    console.log(`[roam-webhook] SKIPPED — contact exists but is not a workshop buyer: ${email}`);
    return;
  }

  console.log(`[roam-webhook] processing booking: email=${email}, cohort=${cohort || 'inherit'}, hosts=${JSON.stringify(hostIds)}`);

  const result = await query(
    `UPDATE contacts SET
       call_booked = true,
       call_booked_at = COALESCE(call_booked_at, NOW()),
       workshop_cohort = COALESCE($2::date, workshop_cohort)
     WHERE LOWER(email) = $1
     RETURNING id, workshop_cohort`,
    [email, cohort || null],
  );

  console.log(`[roam-webhook] marked call_booked for ${email} → cohort=${result.rows[0]?.workshop_cohort}`);
}

export default router;
