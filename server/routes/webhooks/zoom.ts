import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../../lib/supabase.js';

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

  // Return 200 immediately
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
  const webinarId = webinarObj.id as string;

  // Calculate duration in minutes
  const durationMs = new Date(leaveTime).getTime() - new Date(joinTime).getTime();
  const durationMinutes = Math.round(durationMs / 60000);

  // Upsert into zoom_attendance by webinar_id + email
  const { error: upsertError } = await supabase
    .from('zoom_attendance')
    .upsert(
      {
        webinar_id: String(webinarId),
        email,
        join_time: joinTime,
        leave_time: leaveTime,
        duration_minutes: durationMinutes,
      },
      { onConflict: 'webinar_id,email' }
    );

  if (upsertError) {
    console.error('Error upserting zoom_attendance:', upsertError);
    return;
  }

  // Match to contacts by email
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (contact) {
    // Mark contact as attended
    await supabase
      .from('contacts')
      .update({ attended_workshop: true })
      .eq('email', email);

    // Update matched_contact_id in zoom_attendance
    await supabase
      .from('zoom_attendance')
      .update({ matched_contact_id: contact.id })
      .eq('webinar_id', String(webinarId))
      .eq('email', email);

    // If duration > 45 min, mark as high intent
    if (durationMinutes > 45) {
      console.log(`High intent participant: ${email} (${durationMinutes} min in webinar ${webinarId})`);
      await supabase
        .from('contacts')
        .update({ high_intent: true })
        .eq('email', email);
    }
  } else {
    console.log(`No matching contact found for Zoom participant: ${email}`);
  }
}

export default router;
