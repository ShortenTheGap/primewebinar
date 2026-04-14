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

router.post('/', (req: Request, res: Response) => {
  // Handle Zoom URL validation challenge
  if (req.body?.event === 'endpoint.url_validation') {
    const plainToken = req.body.payload?.plainToken;
    const secret = process.env.ZOOM_WEBHOOK_SECRET || '';
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(plainToken);
    res.status(200).json({
      plainToken,
      encryptedToken: hmac.digest('hex'),
    });
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

async function processParticipantLeft(payload: Record<string, any>): Promise<void> {
  const participant = payload?.object?.participant || {};
  const webinarObj = payload?.object || {};

  const email = participant.email as string;
  const joinTime = participant.join_time as string;
  const leaveTime = participant.leave_time as string;
  const webinarId = String(webinarObj.id);

  const durationMs = new Date(leaveTime).getTime() - new Date(joinTime).getTime();
  const durationMinutes = Math.round(durationMs / 60000);

  // Upsert into zoom_attendance
  await query(
    `INSERT INTO zoom_attendance (webinar_id, email, join_time, leave_time, duration_minutes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (webinar_id, email) DO UPDATE SET
       join_time = EXCLUDED.join_time,
       leave_time = EXCLUDED.leave_time,
       duration_minutes = EXCLUDED.duration_minutes`,
    [webinarId, email, joinTime, leaveTime, durationMinutes],
  );

  // Match to contacts by email
  const result = await query(`SELECT id FROM contacts WHERE email = $1 LIMIT 1`, [email]);
  const contact = result.rows[0];

  if (contact) {
    // 45 min = stayed through meaningful portion of a 60-min session
    const stayedFullSession = durationMinutes >= 45;

    await query(
      `UPDATE contacts SET
         attended_workshop = true,
         attended_full_session = $1 OR attended_full_session,
         attended_minutes = GREATEST(COALESCE(attended_minutes, 0), $2)
       WHERE email = $3`,
      [stayedFullSession, durationMinutes, email],
    );
    await query(
      `UPDATE zoom_attendance SET matched_contact_id = $1 WHERE webinar_id = $2 AND email = $3`,
      [contact.id, webinarId, email],
    );
  } else {
    console.log(`No matching contact found for Zoom participant: ${email}`);
  }
}

export default router;
