import { Router, type Request, type Response } from 'express';
import { query } from '../../lib/db.js';
import { computeDashboardMetrics } from '../../lib/metrics.js';

const router = Router();

/**
 * Resolve the `cohort=current` sentinel to a specific workshop_date.
 *
 *   - If any cohort's workshop_date is today or later → pick the closest upcoming one
 *   - Else if any cohorts exist at all → pick the most recent past one
 *   - Else → fall back to 'all'
 *
 * `cohorts` rows are already sorted by workshop_date DESC when passed in.
 */
function resolveCurrentCohort(cohorts: Array<{ workshop_date: string }>): string {
  if (cohorts.length === 0) return 'all';
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  // workshop_date from pg is already a YYYY-MM-DD string (custom DATE parser in db.ts).
  // Upcoming = workshop_date >= today. Among those, pick the earliest (closest to today).
  const upcoming = cohorts
    .filter((c) => c.workshop_date >= today)
    .sort((a, b) => a.workshop_date.localeCompare(b.workshop_date));
  if (upcoming.length > 0) return upcoming[0].workshop_date;
  // No upcoming — pick the most recent past (cohorts[0] since rows come DESC-sorted).
  return cohorts[0].workshop_date;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const requestedCohort = (req.query.cohort as string) || 'all';
    const includeAllAdSpend = req.query.includeAll === '1' || req.query.includeAll === 'true';

    // Fetch cohorts (DESC by workshop_date)
    const cohortsResult = await query(
      `SELECT * FROM cohorts ORDER BY workshop_date DESC`,
    );

    // Resolve the `current` sentinel now that we know the cohort list.
    const cohort = requestedCohort === 'current'
      ? resolveCurrentCohort(cohortsResult.rows)
      : requestedCohort;

    // Fetch contacts (optionally filtered by cohort)
    const contactsResult = cohort !== 'all'
      ? await query(`SELECT * FROM contacts WHERE workshop_cohort = $1`, [cohort])
      : await query(`SELECT * FROM contacts`);

    // Fetch ad_spend
    const adSpendResult = await query(`SELECT * FROM ad_spend`);

    // Fetch zoom_attendance (optionally filtered)
    const zoomResult = cohort !== 'all'
      ? await query(`SELECT * FROM zoom_attendance WHERE workshop_cohort = $1`, [cohort])
      : await query(`SELECT * FROM zoom_attendance`);

    const payload = computeDashboardMetrics({
      contacts: contactsResult.rows,
      adSpend: adSpendResult.rows,
      zoomAttendance: zoomResult.rows,
      cohorts: cohortsResult.rows,
      selectedCohort: cohort,
      includeAllAdSpend,
    });

    res.json(payload);
  } catch (err: any) {
    console.error('Dashboard API error:', err);
    const message = err?.message || 'Internal server error';
    // Surface the real message so the frontend can tell the user what's wrong
    // (e.g. "DATABASE_URL must be set", "relation 'contacts' does not exist")
    res.status(500).json({ error: message });
  }
});

export default router;
