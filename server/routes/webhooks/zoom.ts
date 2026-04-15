import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { query } from '../../lib/db.js';

const router = Router();

function verifyZoomSignature(req: Request): boolean {
  const secret = process.env.ZOOM_WEBHOOK_SECRET || '';
  if (!secret) return false;

  const message = `v0:${req.headers['x-zm-request-timestamp']}:${JSON.stringify(req.body)}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(message);
  const digest = `v0=${hmac.digest('hex')}`;

  const signature = req.headers['x-zm-signature'] as string | undefined;
  if (!signature) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Also accept GET/HEAD so Zoom's initial connectivity probe (if any) works
router.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, endpoint: 'zoom-webhook' });
});

router.post('/', (req: Request, res: Response) => {
  console.log('[zoom-webhook] POST received', {
    event: req.body?.event,
    hasPayload: !!req.body?.payload,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    hasSecret: !!process.env.ZOOM_WEBHOOK_SECRET,
  });

  // Handle Zoom URL validation challenge
  if (req.body?.event === 'endpoint.url_validation') {
    const plainToken = req.body.payload?.plainToken;
    const secret = process.env.ZOOM_WEBHOOK_SECRET || '';

    if (!secret) {
      console.error('[zoom-webhook] validation failed: ZOOM_WEBHOOK_SECRET is not set');
      res.status(500).json({ error: 'Server missing ZOOM_WEBHOOK_SECRET' });
      return;
    }
    if (!plainToken) {
      console.error('[zoom-webhook] validation failed: no plainToken in payload');
      res.status(400).json({ error: 'Missing plainToken' });
      return;
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(plainToken);
    const encryptedToken = hmac.digest('hex');
    console.log('[zoom-webhook] validation OK — responding');
    res.status(200).json({ plainToken, encryptedToken });
    return;
  }

  if (!verifyZoomSignature(req)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  res.status(200).json({ received: true });

  const { event, payload } = req.body;

  if (event === 'webinar.participant_left') {
    processParticipantLeft(payload).catch((err) => {
      console.error('Zoom webhook processing error:', err);
    });
  }
});

export async function processParticipantLeft(payload: Record<string, any>): Promise<void> {
  const participant = payload?.object?.participant || {};
  const webinarObj = payload?.object || {};

  const email = (participant.email as string || '').toLowerCase().trim();
  const joinTime = participant.join_time as string;
  const leaveTime = participant.leave_time as string;
  const webinarId = String(webinarObj.id);

  if (!email || !webinarId) {
    console.log('[zoom] skipping: missing email or webinar_id');
    return;
  }

  // Only process events for webinars we've explicitly registered as a
  // workshop cohort. This filters out 1:1 calls, team meetings, and
  // unrelated webinars on the same Zoom account.
  const cohortLookup = await query(
    `SELECT workshop_date FROM cohorts WHERE zoom_webinar_id = $1 LIMIT 1`,
    [webinarId],
  );
  if (cohortLookup.rows.length === 0) {
    console.log(`[zoom] ignoring event for unregistered webinar ${webinarId} (${email})`);
    return;
  }
  const workshopCohort = cohortLookup.rows[0].workshop_date;

  const durationMs = new Date(leaveTime).getTime() - new Date(joinTime).getTime();
  const durationMinutes = Math.round(durationMs / 60000);

  // Upsert into zoom_attendance (with cohort linkage)
  await query(
    `INSERT INTO zoom_attendance
       (webinar_id, email, join_time, leave_time, duration_minutes, workshop_cohort)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (webinar_id, email) DO UPDATE SET
       join_time = EXCLUDED.join_time,
       leave_time = EXCLUDED.leave_time,
       duration_minutes = GREATEST(EXCLUDED.duration_minutes, zoom_attendance.duration_minutes),
       workshop_cohort = EXCLUDED.workshop_cohort`,
    [webinarId, email, joinTime, leaveTime, durationMinutes, workshopCohort],
  );

  // Match to the contact row for THIS cohort (so a multi-cohort buyer gets
  // attendance recorded only against the workshop they actually attended).
  const existing = await query(
    `SELECT id FROM contacts
     WHERE LOWER(email) = $1 AND workshop_cohort = $2::date
     LIMIT 1`,
    [email, workshopCohort],
  );
  const stayedFullSession = durationMinutes >= 45;

  let contactId: string;
  if (existing.rowCount && existing.rowCount > 0) {
    contactId = existing.rows[0].id;
    await query(
      `UPDATE contacts SET
         attended_workshop = true,
         attended_full_session = $1 OR attended_full_session,
         attended_minutes = GREATEST(COALESCE(attended_minutes, 0), $2)
       WHERE id = $3`,
      [stayedFullSession, durationMinutes, contactId],
    );
  } else {
    // No contact in GHL for this email + cohort — they're a guest (invited
    // directly to Zoom, bypassing the GHL funnel). Auto-create a guest
    // contact row so attendance still counts toward the dashboard.
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
      [email, workshopCohort, stayedFullSession, durationMinutes],
    );
    contactId = inserted.rows[0].id;
    console.log(`[zoom] auto-created guest contact for ${email} in cohort ${workshopCohort}`);
  }

  await query(
    `UPDATE zoom_attendance SET matched_contact_id = $1 WHERE webinar_id = $2 AND email = $3`,
    [contactId, webinarId, email],
  );
}

export default router;
