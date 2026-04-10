import { Router, type Request, type Response } from 'express';
import { supabase } from '../../lib/supabase.js';
import { computeDashboardMetrics } from '../../lib/metrics.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const cohort = (req.query.cohort as string) || 'all';

    // Fetch cohorts list
    const { data: cohorts, error: cohortsError } = await supabase
      .from('cohorts')
      .select('*')
      .order('workshop_date', { ascending: false });

    if (cohortsError) {
      console.error('Error fetching cohorts:', cohortsError);
    }

    // Fetch contacts
    let contactsQuery = supabase.from('contacts').select('*');
    if (cohort !== 'all') {
      contactsQuery = contactsQuery.eq('workshop_cohort', cohort);
    }
    const { data: contacts, error: contactsError } = await contactsQuery;

    if (contactsError) {
      console.error('Error fetching contacts:', contactsError);
      res.status(500).json({ error: 'Failed to fetch contacts' });
      return;
    }

    // Fetch ad_spend
    const { data: adSpend, error: adSpendError } = await supabase
      .from('ad_spend')
      .select('*');

    if (adSpendError) {
      console.error('Error fetching ad_spend:', adSpendError);
    }

    // Fetch zoom_attendance
    let zoomQuery = supabase.from('zoom_attendance').select('*');
    if (cohort !== 'all') {
      zoomQuery = zoomQuery.eq('workshop_cohort', cohort);
    }
    const { data: zoomAttendance, error: zoomError } = await zoomQuery;

    if (zoomError) {
      console.error('Error fetching zoom_attendance:', zoomError);
    }

    const payload = computeDashboardMetrics({
      contacts: contacts || [],
      adSpend: adSpend || [],
      zoomAttendance: zoomAttendance || [],
      cohorts: cohorts || [],
    });

    res.json(payload);
  } catch (err) {
    console.error('Dashboard API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
