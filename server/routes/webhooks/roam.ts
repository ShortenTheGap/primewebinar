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

  if (!email) {
    console.warn('[roam-webhook] no email found in payload — full body logged above for debugging');
    return;
  }

  console.log(`[roam-webhook] extracted email=${email}, cohort=${cohort || 'none'}`);

  const result = await query(
    `UPDATE contacts SET
       call_booked = true,
       call_booked_at = COALESCE(call_booked_at, NOW()),
       workshop_cohort = COALESCE($2::date, workshop_cohort)
     WHERE LOWER(email) = $1
     RETURNING id, workshop_cohort`,
    [email, cohort || null],
  );

  if (result.rowCount === 0) {
    console.warn(`[roam-webhook] no contact matched for email=${email}`);
  } else {
    console.log(`[roam-webhook] marked call_booked for ${email} → cohort=${result.rows[0]?.workshop_cohort}`);
  }
}

export default router;
