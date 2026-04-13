import { Router, type Request, type Response } from 'express';
import { query } from '../../lib/db.js';
import { computeDashboardMetrics } from '../../lib/metrics.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const cohort = (req.query.cohort as string) || 'all';

    // Fetch cohorts
    const cohortsResult = await query(
      `SELECT * FROM cohorts ORDER BY workshop_date DESC`,
    );

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
