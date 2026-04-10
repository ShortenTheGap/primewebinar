import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../../lib/supabase.js';

const router = Router();

function verifySignature(payload: string, signature: string): boolean {
  const secret = process.env.GHL_WEBHOOK_SECRET || '';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

router.post('/', (req: Request, res: Response) => {
  const signature = req.headers['x-ghl-signature'] as string | undefined;

  if (!signature || !verifySignature(JSON.stringify(req.body), signature)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Return 200 immediately, process asynchronously
  res.status(200).json({ received: true });

  const { event, body } = req.body;

  processEvent(event, body).catch((err) => {
    console.error('GHL webhook processing error:', err);
  });
});

async function processEvent(event: string, body: Record<string, any>): Promise<void> {
  switch (event) {
    case 'contact.created': {
      const { email, utm_source, utm_campaign, utm_content, utm_medium, referral_partner, workshop_cohort } = body;
      await supabase
        .from('contacts')
        .upsert(
          {
            email,
            lead_source: utm_source || null,
            utm_campaign: utm_campaign || null,
            utm_content: utm_content || null,
            utm_medium: utm_medium || null,
            referral_partner: referral_partner || null,
            workshop_cohort: workshop_cohort || null,
          },
          { onConflict: 'email' }
        );
      break;
    }

    case 'contact.tag_added': {
      const { email, tag } = body;

      switch (tag) {
        case 'workshop-buyer':
          await supabase
            .from('contacts')
            .update({ is_workshop_buyer: true })
            .eq('email', email);
          break;

        case 'deposit-paid':
          await supabase
            .from('contacts')
            .update({ deposit_paid: true, deposit_paid_at: new Date().toISOString() })
            .eq('email', email);
          break;

        case 'call-booked':
          await supabase
            .from('contacts')
            .update({ call_booked: true, call_booked_at: new Date().toISOString() })
            .eq('email', email);
          break;

        case 'prime-elite-member':
          await supabase
            .from('contacts')
            .update({
              converted_to_pe: true,
              converted_at: new Date().toISOString(),
              mrr_value: 2500,
            })
            .eq('email', email);
          break;

        case 'workshop-noshow':
          await supabase
            .from('contacts')
            .update({ attended_workshop: false })
            .eq('email', email);
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

      const disposition = stageMap[stage_name] || stage_name;

      await supabase
        .from('contacts')
        .update({
          call_disposition: disposition,
          assigned_rep: owner || null,
          call_completed: true,
          call_completed_at: new Date().toISOString(),
        })
        .eq('email', email);
      break;
    }

    default:
      console.log(`Unhandled GHL event: ${event}`);
  }
}

export default router;
