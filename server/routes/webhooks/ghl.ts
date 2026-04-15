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

/**
 * Find the right contact row to update for a per-cohort event.
 *
 * Resolution order:
 *   1. If workshop_cohort is supplied, look up by (email, workshop_cohort) — exact match
 *   2. Otherwise, fall back to the contact's MOST RECENT cohort row (by workshop_date)
 *
 * Returns the contact row id, or null if no matching contact was found.
 * Logs a warning when no match is made so it shows up in the logs.
 */
export async function resolveContactId(
  email: string | null | undefined,
  ghlContactId: string | null | undefined,
  workshopCohort: string | null | undefined,
  eventLabel: string,
): Promise<string | null> {
  if (!email && !ghlContactId) {
    console.warn(`[ghl] ${eventLabel}: no email or ghl_contact_id, skipping`);
    return null;
  }

  // Prefer exact (email, cohort) match when cohort is given
  if (workshopCohort) {
    const exact = await query(
      `SELECT id FROM contacts
       WHERE workshop_cohort = $1::date
         AND (LOWER(email) = LOWER($2) OR ghl_contact_id = $3)
       LIMIT 1`,
      [workshopCohort, email || null, ghlContactId || null],
    );
    if (exact.rowCount && exact.rowCount > 0) return exact.rows[0].id;
    console.warn(`[ghl] ${eventLabel}: no contact in cohort ${workshopCohort} for ${email || ghlContactId}`);
  }

  // Fallback: most recent cohort the contact is in
  const fallback = await query(
    `SELECT id, workshop_cohort FROM contacts
     WHERE (LOWER(email) = LOWER($1) OR ghl_contact_id = $2)
     ORDER BY workshop_cohort DESC NULLS LAST
     LIMIT 1`,
    [email || null, ghlContactId || null],
  );
  if (fallback.rowCount && fallback.rowCount > 0) {
    console.log(`[ghl] ${eventLabel}: using most recent cohort ${fallback.rows[0].workshop_cohort} for ${email || ghlContactId}`);
    return fallback.rows[0].id;
  }
  console.warn(`[ghl] ${eventLabel}: no contact at all matched (email=${email}, ghl_id=${ghlContactId})`);
  return null;
}

export async function processGhlEvent(event: string, body: Record<string, any>): Promise<void> {
  switch (event) {
    case 'contact.created':
    case 'contact.purchased': {
      // One row per (email, workshop_cohort). A repeat buyer (same email,
      // different cohort) gets a NEW row, preserving their previous cohort
      // funnel state intact.
      const isBuyer = event === 'contact.purchased';
      const { email, ghl_contact_id, utm_source, utm_campaign, utm_content, utm_medium, referral_partner, workshop_cohort } = body;
      const lcEmail = email ? String(email).toLowerCase() : null;

      if (!lcEmail || !workshop_cohort) {
        console.warn('[ghl] purchased: email and workshop_cohort are both required for cohort-scoped upsert');
        break;
      }

      await query(
        `INSERT INTO contacts (
           email, ghl_contact_id, lead_source, utm_campaign, utm_content,
           utm_medium, referral_partner, workshop_cohort, is_workshop_buyer
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (LOWER(email), workshop_cohort) DO UPDATE SET
           ghl_contact_id = COALESCE(EXCLUDED.ghl_contact_id, contacts.ghl_contact_id),
           lead_source = COALESCE(EXCLUDED.lead_source, contacts.lead_source),
           utm_campaign = COALESCE(EXCLUDED.utm_campaign, contacts.utm_campaign),
           utm_content = COALESCE(EXCLUDED.utm_content, contacts.utm_content),
           utm_medium = COALESCE(EXCLUDED.utm_medium, contacts.utm_medium),
           referral_partner = COALESCE(EXCLUDED.referral_partner, contacts.referral_partner),
           is_workshop_buyer = EXCLUDED.is_workshop_buyer OR contacts.is_workshop_buyer`,
        [
          lcEmail, ghl_contact_id || null,
          utm_source || null, utm_campaign || null, utm_content || null,
          utm_medium || null, referral_partner || null, workshop_cohort,
          isBuyer,
        ],
      );
      break;
    }

    case 'contact.deposit_paid': {
      const { email, ghl_contact_id, workshop_cohort, amount } = body;
      const targetId = await resolveContactId(email, ghl_contact_id, workshop_cohort, 'deposit_paid');
      if (!targetId) break;

      await query(
        `UPDATE contacts SET
           deposit_paid = true,
           deposit_paid_at = COALESCE(deposit_paid_at, NOW())
         WHERE id = $1`,
        [targetId],
      );
      if (amount) console.log(`[ghl] deposit_paid for ${email || ghl_contact_id} — amount ${amount}`);
      break;
    }

    case 'contact.call_booked': {
      const { email, ghl_contact_id, workshop_cohort } = body;
      const targetId = await resolveContactId(email, ghl_contact_id, workshop_cohort, 'call_booked');
      if (!targetId) break;

      await query(
        `UPDATE contacts SET
           call_booked = true,
           call_booked_at = COALESCE(call_booked_at, NOW())
         WHERE id = $1`,
        [targetId],
      );
      break;
    }

    case 'contact.converted': {
      const { email, ghl_contact_id, workshop_cohort, mrr_value, assigned_rep, payment_plan, initial_payment } = body;
      const mrr = Number(mrr_value) > 0 ? Math.round(Number(mrr_value)) : 2500;
      // Default initial_payment based on plan when not explicitly provided
      const plan = payment_plan === 'paid_in_full' || payment_plan === 'monthly' ? payment_plan : null;
      const initPay = Number(initial_payment) > 0
        ? Number(initial_payment)
        : (plan === 'paid_in_full' ? 30000 : plan === 'monthly' ? 2000 : null);

      const targetId = await resolveContactId(email, ghl_contact_id, workshop_cohort, 'converted');
      if (!targetId) break;

      await query(
        `UPDATE contacts SET
           converted_to_pe = true,
           converted_at = COALESCE(converted_at, NOW()),
           mrr_value = GREATEST(COALESCE(mrr_value, 0), $1::int),
           assigned_rep = COALESCE($2, assigned_rep),
           call_disposition = COALESCE(call_disposition, 'sold'),
           pe_payment_plan = COALESCE($4, pe_payment_plan),
           pe_initial_payment = COALESCE($5::numeric, pe_initial_payment)
         WHERE id = $3`,
        [mrr, assigned_rep || null, targetId, plan, initPay],
      );
      console.log(`[ghl] converted ${email || ghl_contact_id} → mrr=${mrr}, plan=${plan || 'unspecified'}, initial=${initPay || 'n/a'}`);
      break;
    }

    case 'contact.call_completed': {
      const { email, ghl_contact_id, workshop_cohort, disposition, assigned_rep } = body;
      const validDispositions = new Set(['sold', 'follow_up', 'not_a_fit', 'no_show']);
      const dispo = disposition && validDispositions.has(disposition) ? disposition : null;
      const targetId = await resolveContactId(email, ghl_contact_id, workshop_cohort, 'call_completed');
      if (!targetId) break;

      await query(
        `UPDATE contacts SET
           call_completed = true,
           call_completed_at = COALESCE(call_completed_at, NOW()),
           call_disposition = COALESCE($1::call_disposition_type, call_disposition),
           assigned_rep = COALESCE($2, assigned_rep)
         WHERE id = $3`,
        [dispo, assigned_rep || null, targetId],
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
