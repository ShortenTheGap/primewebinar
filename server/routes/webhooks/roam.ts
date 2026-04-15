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

  // Check plural-invitee arrays first (ro.am uses these).
  // Prefer the one marked isBooker=true; otherwise the first one with an email.
  const inviteeArrays = [
    body.invitees,
    body.attendees,
    body.participants,
    body.bookers,
    body.booking?.invitees,
    body.booking?.attendees,
    body.booking?.participants,
    body.data?.invitees,
    body.payload?.invitees,
  ];
  for (const arr of inviteeArrays) {
    if (!Array.isArray(arr)) continue;
    const booker = arr.find(
      (i: any) => i?.isBooker === true && typeof i.email === 'string' && i.email.includes('@'),
    );
    if (booker) return booker.email.trim().toLowerCase();
    const first = arr.find(
      (i: any) => typeof i?.email === 'string' && i.email.includes('@'),
    );
    if (first) return first.email.trim().toLowerCase();
  }

  // Fall back to singular-email paths
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

  // Gather every plausible host container — can be singular or plural, at any
  // common nesting level
  const containers: any[] = [];
  const flat = [
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
  const arrays = [
    body.hosts,
    body.organizers,
    body.attendees,
    body.meeting?.hosts,
    body.booking?.hosts,
    body.call?.hosts,
    body.data?.hosts,
    body.payload?.hosts,
  ];

  for (const f of flat) if (f) containers.push(f);
  for (const arr of arrays) {
    if (Array.isArray(arr)) for (const item of arr) containers.push(item);
  }

  for (const s of containers) {
    if (typeof s === 'string') {
      ids.push(s);
    } else if (typeof s === 'object' && s !== null) {
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

// Svix-style signature verification — ro.am uses Svix for webhook delivery.
// Headers: webhook-id, webhook-timestamp, webhook-signature (format "v1,<base64> v1,<base64>").
// Signed payload: `${webhookId}.${timestamp}.${rawBody}`
// Key: base64-decoded secret (after stripping "whsec_" prefix if present).
// Digest: HMAC-SHA256, base64-encoded.
function verifySvixSignature(req: Request): boolean {
  const secret = process.env.ROAM_WEBHOOK_SECRET || '';
  if (!secret) return false;

  const webhookId = req.headers['webhook-id'] as string | undefined;
  const webhookTimestamp = req.headers['webhook-timestamp'] as string | undefined;
  const webhookSignature = req.headers['webhook-signature'] as string | undefined;
  if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

  const rawBody: string = (req as any).rawBody ?? JSON.stringify(req.body || {});
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

  // Secret may or may not have the "whsec_" prefix. Try both.
  const secretVariants = [
    secret.replace(/^whsec_/, ''),
    secret,
  ];

  // Signature header can contain multiple space-separated signatures: "v1,<b64> v1,<b64alt>"
  const providedSigs = webhookSignature
    .split(' ')
    .map((s) => s.split(',').pop() || '')
    .filter(Boolean);

  for (const s of secretVariants) {
    // Try secret as raw bytes (Svix uses base64-decoded secret)
    const keyVariants: Buffer[] = [];
    try { keyVariants.push(Buffer.from(s, 'base64')); } catch {}
    keyVariants.push(Buffer.from(s, 'utf8'));

    for (const key of keyVariants) {
      const computed = crypto.createHmac('sha256', key).update(signedContent).digest('base64');
      for (const provided of providedSigs) {
        if (providedMatch(computed, provided)) return true;
      }
    }
  }
  return false;
}

function providedMatch(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

router.post('/', async (req: Request, res: Response) => {
  // Single-line JSON log so Railway captures it as one entry
  console.log(JSON.stringify({
    marker: 'roam-webhook-received',
    allHeaders: req.headers,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    bodyPreview: JSON.stringify(req.body || {}).slice(0, 1500),
  }));

  // 1) Try Svix-style signature (what ro.am uses)
  const svixValid = verifySvixSignature(req);
  // 2) Fall back to raw-token header schemes (in case ro.am ever offers a simpler auth)
  const tokenCandidates = [
    req.headers['x-roam-token'],
    req.headers['x-webhook-secret'],
    req.headers['x-webhook-token'],
    req.headers['x-api-key'],
    (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, ''),
  ];
  const token = tokenCandidates.find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
  const tokenValid = verifyToken(token);

  if (!svixValid && !tokenValid) {
    console.warn('[roam-webhook] rejected — signature/token did not validate');
    res.status(401).json({ error: 'Invalid or missing auth' });
    return;
  }

  console.log(`[roam-webhook] auth passed via ${svixValid ? 'Svix signature' : 'token'}`);

  // Respond 200 fast so ro.am doesn't retry
  res.status(200).json({ received: true });

  // Read event type from the roam-event-type header (or fall back to body.type / body.event)
  const eventType =
    (req.headers['roam-event-type'] as string | undefined) ||
    req.body?.type ||
    req.body?.event ||
    'unknown';

  // Process asynchronously
  processRoamEvent(eventType, req.body).catch((err) => {
    console.error('[roam-webhook] processing error:', err);
  });
});

/**
 * Router for different ro.am event types. Currently handles:
 *   lobby:booked / call:booked / booking:created                → handleBooked
 *   recording.saved / transcript.saved / *ended / *completed    → handleCallEnded
 *   transcript.started / *started / *created                    → log + ignore
 *                                                                 (useful signal but
 *                                                                  not the same as completion)
 *   (anything else)                                             → log + ignore
 */
async function processRoamEvent(eventType: string, body: any): Promise<void> {
  const et = eventType.toLowerCase();

  // Booked events first
  if (
    et.includes('booked') ||
    et.includes('booking:created') ||
    (et.includes('scheduled') && !et.includes('started'))
  ) {
    await handleBooked(body);
    return;
  }

  // Explicitly SKIP start events — they fire mid-call, not at completion
  if (et.endsWith('.started') || et.endsWith(':started')) {
    console.log(`[roam-webhook] informational event: ${eventType} — not acting on this`);
    return;
  }

  // "Saved" events fire after the call ends (recording/transcript finalized).
  // Also catch explicit *ended / *completed / *finished.
  if (
    et.endsWith('.saved') ||
    et.endsWith(':saved') ||
    et.includes('ended') ||
    et.includes('completed') ||
    et.includes('finished') ||
    et === 'onair.event.updated'
  ) {
    await handleCallEnded(body);
    return;
  }

  console.log(`[roam-webhook] unhandled event type: ${eventType} — ignoring`);
}

async function handleBooked(body: any): Promise<void> {
  const email = extractEmail(body);
  const cohort = extractCohort(body);
  const hostIds = extractHostIdentifiers(body);

  if (!email) {
    console.warn('[roam-webhook] booked: no email found in payload');
    return;
  }

  if (!isAllowedHost(hostIds)) {
    console.log(
      `[roam-webhook] booked SKIPPED — host not in allowlist. hosts=${JSON.stringify(hostIds)}`,
    );
    return;
  }

  const existing = await query(
    `SELECT id, is_workshop_buyer FROM contacts WHERE LOWER(email) = $1`,
    [email],
  );
  if (existing.rowCount === 0) {
    console.log(`[roam-webhook] booked SKIPPED — no matching contact: ${email}`);
    return;
  }
  if (!existing.rows[0].is_workshop_buyer) {
    console.log(`[roam-webhook] booked SKIPPED — not a workshop buyer: ${email}`);
    return;
  }

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

async function handleCallEnded(body: any): Promise<void> {
  const email = extractEmail(body);
  const hostIds = extractHostIdentifiers(body);
  const durationMinutes = extractDurationMinutes(body);

  if (!email) {
    console.warn('[roam-webhook] call_ended: no email found in payload');
    return;
  }
  if (!isAllowedHost(hostIds)) {
    console.log(`[roam-webhook] call_ended SKIPPED — host not in allowlist. hosts=${JSON.stringify(hostIds)}`);
    return;
  }

  const existing = await query(
    `SELECT id, is_workshop_buyer FROM contacts WHERE LOWER(email) = $1`,
    [email],
  );
  if (existing.rowCount === 0) {
    console.log(`[roam-webhook] call_ended SKIPPED — no matching contact: ${email}`);
    return;
  }
  if (!existing.rows[0].is_workshop_buyer) {
    console.log(`[roam-webhook] call_ended SKIPPED — not a workshop buyer: ${email}`);
    return;
  }

  // Use duration as a proxy for "actually showed up". Under 5 minutes = likely a
  // no-show (joined briefly or call never really happened). Over 5 min = real call.
  const noShowThreshold = Number(process.env.ROAM_NOSHOW_THRESHOLD_MINUTES || 5);
  const showed = durationMinutes === null || durationMinutes >= noShowThreshold;

  if (!showed) {
    // Mark completed=true but disposition=no_show to feed the funnel correctly
    await query(
      `UPDATE contacts SET
         call_completed = true,
         call_completed_at = COALESCE(call_completed_at, NOW()),
         call_disposition = COALESCE(call_disposition, 'no_show')
       WHERE LOWER(email) = $1`,
      [email],
    );
    console.log(`[roam-webhook] marked call_completed=true, disposition=no_show for ${email} (${durationMinutes} min < ${noShowThreshold})`);
    return;
  }

  await query(
    `UPDATE contacts SET
       call_completed = true,
       call_completed_at = COALESCE(call_completed_at, NOW())
     WHERE LOWER(email) = $1`,
    [email],
  );
  console.log(`[roam-webhook] marked call_completed for ${email} (${durationMinutes ?? 'unknown'} min)`);
}

function extractDurationMinutes(body: any): number | null {
  if (!body || typeof body !== 'object') return null;

  // Try a duration-like field first
  const directCandidates = [
    body.duration_minutes,
    body.durationMinutes,
    body.duration,
    body.booking?.duration_minutes,
    body.booking?.duration,
    body.call?.duration,
    body.call?.duration_minutes,
  ];
  for (const c of directCandidates) {
    const n = Number(c);
    if (!Number.isNaN(n) && n > 0) return Math.round(n);
  }

  // Fall back to computing from start/end timestamps
  const starts = [body.start, body.booking?.start, body.call?.start, body.startTime];
  const ends = [body.end, body.booking?.end, body.call?.end, body.endTime, body.actualEnd];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const e = ends[i];
    if (typeof s === 'string' && typeof e === 'string') {
      const ms = new Date(e).getTime() - new Date(s).getTime();
      if (!Number.isNaN(ms) && ms > 0) return Math.round(ms / 60000);
    }
  }
  return null;
}

export default router;
