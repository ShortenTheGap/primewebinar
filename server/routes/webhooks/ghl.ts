import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { query } from '../../lib/db.js';

const router = Router();

function verifyGhlToken(provided: string | undefined): boolean {
  const expected = process.env.GHL_WEBHOOK_SECRET || '';
  if (!expected || !provided) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.post('/', (req: Request, res: Response) => {
  const token = req.headers['x-ghl-token'] as string | undefined;

  if (!verifyGhlToken(token)) {
    res.status(401).json({ error: 'Invalid or missing x-ghl-token header' });
    return;
  }

  // Return 200 immediately, process asynchronously
  res.status(200).json({ received: true });

  const { event, body } = req.body;

  processGhlEvent(event, body).catch((err) => {
    console.error('GHL webhook processing error:', err);
  });
});

export async function processGhlEvent(event: string, body: Record<string, any>): Promise<void> {
  switch (event) {
    case 'contact.created': {
      const { email, ghl_contact_id, utm_source, utm_campaign, utm_content, utm_medium, referral_partner, workshop_cohort } = body;
      await query(
        `INSERT INTO contacts (email, ghl_contact_id, lead_source, utm_campaign, utm_content, utm_medium, referral_partner, workshop_cohort)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (ghl_contact_id) DO UPDATE SET
           email = EXCLUDED.email,
           lead_source = COALESCE(EXCLUDED.lead_source, contacts.lead_source),
           utm_campaign = COALESCE(EXCLUDED.utm_campaign, contacts.utm_campaign),
           utm_content = COALESCE(EXCLUDED.utm_content, contacts.utm_content),
           utm_medium = COALESCE(EXCLUDED.utm_medium, contacts.utm_medium),
           referral_partner = COALESCE(EXCLUDED.referral_partner, contacts.referral_partner),
           workshop_cohort = COALESCE(EXCLUDED.workshop_cohort, contacts.workshop_cohort)`,
        [email, ghl_contact_id, utm_source || null, utm_campaign || null, utm_content || null, utm_medium || null, referral_partner || null, workshop_cohort || null],
      );
      break;
    }

    case 'contact.tag_added': {
      const { email, tag } = body;

      switch (tag) {
        case 'workshop-buyer':
          await query(`UPDATE contacts SET is_workshop_buyer = true WHERE email = $1`, [email]);
          break;

        case 'deposit-paid':
          await query(`UPDATE contacts SET deposit_paid = true, deposit_paid_at = NOW() WHERE email = $1`, [email]);
          break;

        case 'call-booked':
          await query(`UPDATE contacts SET call_booked = true, call_booked_at = NOW() WHERE email = $1`, [email]);
          break;

        case 'prime-elite-member':
          await query(
            `UPDATE contacts SET converted_to_pe = true, converted_at = NOW(), mrr_value = 2500 WHERE email = $1`,
            [email],
          );
          break;

        case 'workshop-noshow':
          await query(`UPDATE contacts SET attended_workshop = false WHERE email = $1`, [email]);
          break;

        default:
          console.log(`Unhandled tag: ${tag}`);
      }
      break;
    }

    case 'opportunity.stage_changed': {
      const { email, stage_name, owner } = body;

      const stageMap: Record<string, string> = {
        'Sold': 'sold',
        'Follow-up': 'follow_up',
        'Not a Fit': 'not_a_fit',
        'No-show': 'no_show',
      };

      const disposition = stageMap[stage_name] || null;

      await query(
        `UPDATE contacts SET call_disposition = $1, assigned_rep = $2, call_completed = true, call_completed_at = NOW() WHERE email = $3`,
        [disposition, owner || null, email],
      );
      break;
    }

    default:
      console.log(`Unhandled GHL event: ${event}`);
  }
}

export default router;
