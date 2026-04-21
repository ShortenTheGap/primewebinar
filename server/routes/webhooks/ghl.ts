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
 * Parse an optional `occurred_at` field from an event body. Accepts an ISO
 * date/timestamp string (e.g. "2026-04-05" or "2026-04-05T14:30:00Z").
 * Returns null if absent or malformed — which means the SQL COALESCE will
 * fall back to any existing value, then NOW().
 */
function parseOccurredAt(val: unknown): string | null {
  if (!val || typeof val !== 'string') return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * GHL merge tags (e.g. {{contact.utm_source}}) sometimes resolve to one of
 * several "empty-like" string values instead of real null/absence:
 *   - "" (empty string — when the field exists but has no value)
 *   - "null" (literal string "null" — when GHL stringifies a null value)
 *   - "undefined" (similar)
 *   - "{{contact.xxx}}" (the literal unresolved merge tag, when the path
 *      doesn't exist on that contact's record)
 *   - "--" (some GHL UIs use this as the empty indicator)
 *
 * We coerce all of these to real null so downstream logic (normalizer,
 * INSERT coalesce, dashboard filters) sees a consistent absence signal.
 * Real values pass through unchanged.
 */
function cleanMergeField(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (trimmed === '') return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === '--') return null;
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return null;
  return trimmed;
}

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

/**
 * Derive a clean, human-readable lead_source label from UTM fields + Meta placement.
 *
 * Meta's dynamic {{placement}} value arrives on ad clicks (e.g. `facebook_feed`,
 * `instagram_reels`). We use it to split FB vs IG when utm_source=facebook is
 * hardcoded across placements — a click on an IG placement still sends
 * utm_source=facebook, but placement=instagram_* tells us the truth.
 *
 *   paid mediums:    cpc | paid | ad | ads
 *   organic mediums: organic | social | post | organic_social | social_organic | unpaid_social
 *
 *   utm_source=facebook + placement starts with instagram_  → "IG Ad"
 *   utm_source=facebook + organic medium                    → "FB Organic"
 *   utm_source=facebook + (paid / empty / anything else)    → "FB Ad"
 *   utm_source=instagram + placement starts with facebook_  → "FB Ad"
 *   utm_source=instagram + organic medium                   → "IG Organic"
 *   utm_source=instagram + (paid / empty / anything else)   → "IG Ad"
 *   utm_source=email (or medium=email)                      → "Email"
 *   referral_partner set                                    → "Partner"
 *   utm_source present but unrecognized                     → titlecased utm_source
 *   nothing set                                             → null → "Unknown"
 */
function normalizeLeadSource(
  utmSource: string | null | undefined,
  utmMedium: string | null | undefined,
  referralPartner: string | null | undefined,
  placement: string | null | undefined,
): string | null {
  if (referralPartner) return 'Partner';

  const src = (utmSource || '').toLowerCase().trim();
  const med = (utmMedium || '').toLowerCase().trim();
  const plc = (placement || '').toLowerCase().trim();

  if (!src) return null;

  if (src === 'email' || med === 'email') return 'Email';

  const paidMediums = ['cpc', 'paid', 'ad', 'ads'];
  const organicMediums = ['organic', 'social', 'post', 'organic_social', 'social_organic', 'unpaid_social'];

  if (src === 'facebook' || src === 'fb') {
    if (plc.startsWith('instagram_')) return 'IG Ad';
    if (organicMediums.includes(med)) return 'FB Organic';
    if (paidMediums.includes(med)) return 'FB Ad';
    return 'FB Ad'; // default fb to paid (safer assumption)
  }

  if (src === 'instagram' || src === 'ig') {
    if (plc.startsWith('facebook_')) return 'FB Ad';
    if (organicMediums.includes(med)) return 'IG Organic';
    if (paidMediums.includes(med)) return 'IG Ad';
    return 'IG Ad';
  }

  // Unrecognized source — titlecase the raw value
  return src.charAt(0).toUpperCase() + src.slice(1);
}

export async function processGhlEvent(event: string, body: Record<string, any>): Promise<void> {
  switch (event) {
    case 'contact.created':
    case 'contact.purchased': {
      // One row per (email, workshop_cohort). A repeat buyer (same email,
      // different cohort) gets a NEW row, preserving their previous cohort
      // funnel state intact.
      const isBuyer = event === 'contact.purchased';
      const { email, ghl_contact_id, workshop_cohort, is_guest } = body;
      // Attribution fields come from GHL merge tags which may resolve to
      // "empty-like" strings ("null", "undefined", "--", or the literal
      // unresolved tag). Coerce those to real null at the boundary so the
      // normalizer and INSERT see a consistent absence signal.
      const utm_source = cleanMergeField(body.utm_source);
      const utm_medium = cleanMergeField(body.utm_medium);
      const utm_campaign = cleanMergeField(body.utm_campaign);
      const utm_content = cleanMergeField(body.utm_content);
      const referral_partner = cleanMergeField(body.referral_partner);
      const fbclid = cleanMergeField(body.fbclid);
      const placement = cleanMergeField(body.placement);
      const lcEmail = email ? String(email).toLowerCase() : null;
      const isGuest = is_guest === true || is_guest === 'true';
      const leadSource = normalizeLeadSource(utm_source, utm_medium, referral_partner, placement);

      if (!lcEmail || !workshop_cohort) {
        console.warn('[ghl] purchased: email and workshop_cohort are both required for cohort-scoped upsert');
        break;
      }

      await query(
        `INSERT INTO contacts (
           email, ghl_contact_id, lead_source, utm_source, utm_campaign, utm_content,
           utm_medium, referral_partner, workshop_cohort, is_workshop_buyer, is_guest,
           fbclid, placement
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (LOWER(email), workshop_cohort) DO UPDATE SET
           ghl_contact_id = COALESCE(EXCLUDED.ghl_contact_id, contacts.ghl_contact_id),
           lead_source = COALESCE(EXCLUDED.lead_source, contacts.lead_source),
           utm_source = COALESCE(EXCLUDED.utm_source, contacts.utm_source),
           utm_campaign = COALESCE(EXCLUDED.utm_campaign, contacts.utm_campaign),
           utm_content = COALESCE(EXCLUDED.utm_content, contacts.utm_content),
           utm_medium = COALESCE(EXCLUDED.utm_medium, contacts.utm_medium),
           referral_partner = COALESCE(EXCLUDED.referral_partner, contacts.referral_partner),
           fbclid = COALESCE(EXCLUDED.fbclid, contacts.fbclid),
           placement = COALESCE(EXCLUDED.placement, contacts.placement),
           is_workshop_buyer = EXCLUDED.is_workshop_buyer OR contacts.is_workshop_buyer,
           is_guest = EXCLUDED.is_guest OR contacts.is_guest`,
        [
          lcEmail, ghl_contact_id || null,
          leadSource, utm_source || null, utm_campaign || null, utm_content || null,
          utm_medium || null, referral_partner || null, workshop_cohort,
          isBuyer, isGuest,
          fbclid || null, placement || null,
        ],
      );
      break;
    }

    case 'contact.deposit_paid': {
      const { email, ghl_contact_id, workshop_cohort, amount, occurred_at } = body;
      const targetId = await resolveContactId(email, ghl_contact_id, workshop_cohort, 'deposit_paid');
      if (!targetId) break;
      const occurredAt = parseOccurredAt(occurred_at);

      await query(
        `UPDATE contacts SET
           deposit_paid = true,
           deposit_paid_at = COALESCE($2::timestamptz, deposit_paid_at, NOW())
         WHERE id = $1`,
        [targetId, occurredAt],
      );
      if (amount) console.log(`[ghl] deposit_paid for ${email || ghl_contact_id} — amount ${amount}`);
      break;
    }

    case 'contact.call_booked': {
      const { email, ghl_contact_id, workshop_cohort, occurred_at } = body;
      const targetId = await resolveContactId(email, ghl_contact_id, workshop_cohort, 'call_booked');
      if (!targetId) break;
      const occurredAt = parseOccurredAt(occurred_at);

      await query(
        `UPDATE contacts SET
           call_booked = true,
           call_booked_at = COALESCE($2::timestamptz, call_booked_at, NOW())
         WHERE id = $1`,
        [targetId, occurredAt],
      );
      break;
    }

    case 'contact.converted': {
      const { email, ghl_contact_id, workshop_cohort, mrr_value, assigned_rep, payment_plan, initial_payment, occurred_at } = body;
      const plan = payment_plan === 'paid_in_full' || payment_plan === 'monthly' ? payment_plan : null;
      const occurredAt = parseOccurredAt(occurred_at);

      // MRR is 2500 for monthly subscribers (recurring). Paid-in-full has NO
      // monthly recurring revenue — they paid the full annual value upfront.
      // If an explicit mrr_value is passed we honor it; otherwise default
      // based on plan.
      const mrrProvided = mrr_value !== undefined && mrr_value !== null && mrr_value !== '';
      const mrr = mrrProvided
        ? Math.max(0, Math.round(Number(mrr_value)))
        : (plan === 'paid_in_full' ? 0 : 2500);

      // Default initial_payment based on plan when not explicitly provided
      const initPay = Number(initial_payment) > 0
        ? Number(initial_payment)
        : (plan === 'paid_in_full' ? 30000 : plan === 'monthly' ? 2000 : null);

      const targetId = await resolveContactId(email, ghl_contact_id, workshop_cohort, 'converted');
      if (!targetId) break;

      await query(
        `UPDATE contacts SET
           converted_to_pe = true,
           -- If occurred_at is supplied (backfill), it wins. Otherwise keep
           -- the existing converted_at if any, else NOW() for live events.
           converted_at = COALESCE($6::timestamptz, converted_at, NOW()),
           mrr_value = GREATEST(COALESCE(mrr_value, 0), $1::int),
           assigned_rep = COALESCE($2, assigned_rep),
           -- Conversion is the definitive outcome — always mark as 'sold',
           -- overriding any prior disposition (e.g. 'follow_up' from a
           -- previous call that later closed).
           call_disposition = 'sold'::call_disposition_type,
           pe_payment_plan = COALESCE($4, pe_payment_plan),
           pe_initial_payment = COALESCE($5::numeric, pe_initial_payment)
         WHERE id = $3`,
        [mrr, assigned_rep || null, targetId, plan, initPay, occurredAt],
      );
      console.log(`[ghl] converted ${email || ghl_contact_id} → mrr=${mrr}, plan=${plan || 'unspecified'}, initial=${initPay || 'n/a'}`);
      break;
    }

    case 'contact.call_completed': {
      const { email, ghl_contact_id, workshop_cohort, disposition, assigned_rep, occurred_at } = body;
      const validDispositions = new Set(['sold', 'follow_up', 'not_a_fit', 'no_show']);
      const dispo = disposition && validDispositions.has(disposition) ? disposition : null;
      const targetId = await resolveContactId(email, ghl_contact_id, workshop_cohort, 'call_completed');
      if (!targetId) break;
      const occurredAt = parseOccurredAt(occurred_at);

      await query(
        `UPDATE contacts SET
           call_completed = true,
           call_completed_at = COALESCE($4::timestamptz, call_completed_at, NOW()),
           call_disposition = COALESCE($1::call_disposition_type, call_disposition),
           assigned_rep = COALESCE($2, assigned_rep)
         WHERE id = $3`,
        [dispo, assigned_rep || null, targetId, occurredAt],
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
