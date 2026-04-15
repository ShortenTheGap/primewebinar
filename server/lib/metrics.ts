import type { DashboardPayload } from '../../src/types.js';

// ─── Row types matching Supabase table schemas ─────────────────────────

export interface ContactRow {
  id: string;
  ghl_contact_id: string | null;
  email: string | null;
  created_at: string;
  workshop_cohort: string | null;
  lead_source: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_medium: string | null;
  referral_partner: string | null;
  is_workshop_buyer: boolean;
  attended_workshop: boolean | null;
  deposit_paid: boolean;
  deposit_paid_at: string | null;
  deposit_refunded: boolean;
  call_booked: boolean;
  call_booked_at: string | null;
  call_completed: boolean;
  call_completed_at: string | null;
  call_disposition: 'sold' | 'follow_up' | 'not_a_fit' | 'no_show' | null;
  converted_to_pe: boolean;
  converted_at: string | null;
  assigned_rep: string | null;
  mrr_value: number;
  pe_payment_plan?: string | null;
  pe_initial_payment?: number | string | null;
}

export interface AdSpendRow {
  id: string;
  date: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string | null;
  creative_id: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  updated_at: string;
}

export interface ZoomAttendanceRow {
  id: string;
  webinar_id: string;
  email: string;
  join_time: string | null;
  leave_time: string | null;
  duration_minutes: number;
  workshop_cohort: string | null;
  matched_contact_id: string | null;
}

export interface CohortRow {
  id: string;
  workshop_date: string;
  label: string;
  is_active: boolean;
  created_at: string;
}

export interface RawData {
  contacts: ContactRow[];
  adSpend: AdSpendRow[];
  zoomAttendance: ZoomAttendanceRow[];
  cohorts: CohortRow[];
}

// ─── Formatting helpers ────────────────────────────────────────────────

function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  return denominator === 0 ? fallback : numerator / denominator;
}

function fmtCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    return `$${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    const k = amount / 1_000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

function fmtCurrencyExact(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

function fmtPct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function fmtMultiplier(value: number): string {
  return `${Math.round(value * 10) / 10}×`;
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function daysBetween(earlier: string, later: string): number {
  const msPerDay = 86_400_000;
  return (new Date(later).getTime() - new Date(earlier).getTime()) / msPerDay;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

// ─── Lead-source chart colors ──────────────────────────────────────────

const LEAD_SOURCE_COLORS: Record<string, string> = {
  'Email Kit': '#a78bfa',
  'FB Ad': '#3b82f6',
  'IG Ad': '#ec4899',
  'IG Organic': '#f472b6',
  'FB Organic': '#60a5fa',
  'Partner': '#2dd4bf',
};

const DEFAULT_SOURCE_COLOR = '#94a3b8';

// Disposition colors
const DISPOSITION_COLORS: Record<string, string> = {
  sold: '#4ade80',
  follow_up: '#f59e0b',
  not_a_fit: '#f97316',
  no_show: '#f472b6',
};

const DISPOSITION_LABELS: Record<string, string> = {
  sold: 'Sold',
  follow_up: 'Follow-up',
  not_a_fit: 'Not a Fit',
  no_show: 'No-show',
};

// Closer leaderboard colors (cycled)
const CLOSER_COLORS = ['#4ade80', '#f59e0b', '#3b82f6', '#ec4899', '#a78bfa', '#f97316'];

// Funnel stage colors
const FUNNEL_COLORS = ['#2dd4bf', '#3b82f6', '#4ade80', '#f59e0b', '#f97316', '#a78bfa'];

// ─── Main computation ──────────────────────────────────────────────────

export function computeDashboardMetrics(data: RawData): DashboardPayload {
  const { contacts, adSpend, zoomAttendance, cohorts } = data;

  // ── Funnel Volume raw counts ───────────────────────────────────────
  const purchases = contacts.filter((c) => c.is_workshop_buyer);
  const attendees = contacts.filter((c) => c.attended_workshop === true);
  const deposited = contacts.filter((c) => c.deposit_paid);
  const callsBooked = contacts.filter((c) => c.call_booked);
  const callsCompleted = contacts.filter((c) => c.call_completed);
  const converted = contacts.filter((c) => c.converted_to_pe);

  const purchaseCount = purchases.length;
  const attendeeCount = attendees.length;
  const depositedCount = deposited.length;
  const bookedCount = callsBooked.length;
  const completedCount = callsCompleted.length;
  const convertedCount = converted.length;

  // ── Rates ──────────────────────────────────────────────────────────
  const showRate = safeDivide(attendeeCount, purchaseCount) * 100;
  const depositRate = safeDivide(depositedCount, purchaseCount) * 100;
  const callBookRate = safeDivide(bookedCount, depositedCount) * 100;
  const callShowRate = safeDivide(completedCount, bookedCount) * 100;
  const closeRate = safeDivide(convertedCount, completedCount) * 100;

  // ── Cost & Revenue ─────────────────────────────────────────────────
  const totalAdSpend = adSpend.reduce((s, row) => s + Number(row.spend), 0);
  const mrrAdded = converted.reduce((s, c) => s + (c.mrr_value || 0), 0);
  // PE initial payments: $30k for paid-in-full, $2k for monthly (deposit $500
  // already counted below). If pe_initial_payment is explicitly stored, use it.
  const peInitialPayments = converted.reduce((s, c) => {
    const n = Number(c.pe_initial_payment);
    if (!Number.isNaN(n) && n > 0) return s + n;
    if (c.pe_payment_plan === 'paid_in_full') return s + 30000;
    if (c.pe_payment_plan === 'monthly') return s + 2000;
    return s; // no plan info — don't double-count
  }, 0);
  const revenueCollected = purchaseCount * 97 + depositedCount * 500 + peInitialPayments;
  const projected12moLTV = mrrAdded * 12;
  const costPerBuy = safeDivide(totalAdSpend, purchaseCount);
  const costPerClose = safeDivide(totalAdSpend, convertedCount);

  // ── CRO Signals ───────────────────────────────────────────────────
  const totalRevenue = revenueCollected;
  const roas = safeDivide(totalRevenue, totalAdSpend);
  const revPerAttendee = safeDivide(totalRevenue, attendeeCount);
  const revPerCallCompleted = safeDivide(totalRevenue, completedCount);
  const ghostRate = safeDivide(depositedCount - bookedCount, depositedCount) * 100;
  const followUpCount = contacts.filter((c) => c.call_disposition === 'follow_up').length;
  const openPipelineValue = followUpCount * 2500;

  // Avg days purchase -> close for converted contacts
  const convertedWithDates = converted.filter((c) => c.converted_at && c.created_at);
  const avgDaysPurchaseToClose =
    convertedWithDates.length > 0
      ? convertedWithDates.reduce((sum, c) => sum + daysBetween(c.created_at, c.converted_at!), 0) /
        convertedWithDates.length
      : 0;

  // ── Funnel Volume KPI cards ────────────────────────────────────────
  const funnelVolume = [
    {
      label: 'Workshop Purchases',
      value: fmtInt(purchaseCount),
      sub: `${fmtCurrencyExact(purchaseCount * 97)} collected`,
    },
    {
      label: 'Attendees Showed',
      value: fmtInt(attendeeCount),
      sub: `↑${fmtPct(showRate)} show rate`,
    },
    {
      label: 'Deposit Paid',
      value: fmtInt(depositedCount),
      sub: `↑${fmtPct(depositRate)} of purchasers`,
    },
    {
      label: 'Calls Booked',
      value: fmtInt(bookedCount),
      sub: `${fmtPct(callBookRate)} of deposited`,
    },
    {
      label: 'Calls Completed',
      value: fmtInt(completedCount),
      sub: `${fmtPct(callShowRate)} showed up`,
    },
    {
      label: 'Converted to PE',
      value: fmtInt(convertedCount),
      sub: `↑${fmtPct(closeRate)} close rate`,
    },
  ];

  // ── CRO Signals KPI cards ─────────────────────────────────────────
  const croSignals = [
    { label: 'ROAS', value: fmtMultiplier(roas), color: 'green' },
    { label: 'Rev / Attendee', value: fmtCurrencyExact(revPerAttendee) },
    { label: 'Rev / Call Completed', value: fmtCurrencyExact(revPerCallCompleted) },
    { label: 'Deposit→Call Ghost Rate', value: fmtPct(ghostRate) },
    {
      label: 'Open Pipeline Value',
      value: fmtCurrencyExact(openPipelineValue),
      sub: `${followUpCount} follow-ups × $2,500/mo`,
    },
    { label: 'Purchase→Close Days', value: (Math.round(avgDaysPurchaseToClose * 10) / 10).toString() },
  ];

  // ── Cost & Revenue KPI cards ───────────────────────────────────────
  const costRevenue = [
    { label: 'MRR Added', value: fmtCurrency(mrrAdded), color: 'green' },
    { label: 'Revenue Collected', value: fmtCurrency(revenueCollected), color: 'green' },
    { label: 'Projected 12-Mo LTV', value: fmtCurrency(projected12moLTV), color: 'green' },
    { label: 'Ad Spend', value: fmtCurrencyExact(totalAdSpend), color: 'amber' },
    { label: 'Cost Per Workshop Buy', value: fmtCurrencyExact(costPerBuy) },
    { label: 'Cost Per Close', value: fmtCurrencyExact(costPerClose) },
  ];

  // ── Conversion Funnel stages ───────────────────────────────────────
  const funnelCounts = [purchaseCount, attendeeCount, depositedCount, bookedCount, completedCount, convertedCount];
  const funnelLabels = ['Purchased Workshop', 'Attended', 'Deposit Paid', 'Call Booked', 'Call Completed', 'Closed PE Member'];

  const funnelStages = funnelLabels.map((label, i) => {
    const count = funnelCounts[i];
    const pctOfTotal = Math.round(safeDivide(count, purchaseCount) * 100);
    const stepRate = i === 0 ? 100 : Math.round(safeDivide(count, funnelCounts[i - 1]) * 100);
    return { label, count, pctOfTotal, stepRate, color: FUNNEL_COLORS[i] };
  });

  // ── Revenue Waterfall ──────────────────────────────────────────────
  const paidInFullCount = converted.filter((c) => c.pe_payment_plan === 'paid_in_full').length;
  const monthlyCount = converted.filter((c) => c.pe_payment_plan === 'monthly').length;

  const revenueWaterfall = [
    { label: '$97 Workshop Sales', value: fmtCurrencyExact(purchaseCount * 97) },
    { label: `$500 Deposits (${depositedCount})`, value: fmtCurrencyExact(depositedCount * 500) },
    ...(paidInFullCount > 0
      ? [{ label: `PE Paid-in-Full (${paidInFullCount})`, value: fmtCurrencyExact(paidInFullCount * 30000) }]
      : []),
    ...(monthlyCount > 0
      ? [{ label: `PE Monthly 1st Payments (${monthlyCount})`, value: fmtCurrencyExact(monthlyCount * 2000) }]
      : []),
    { label: 'Total Collected', value: fmtCurrencyExact(revenueCollected) },
    { label: 'MRR Added', value: `${fmtCurrencyExact(mrrAdded)}/mo`, color: 'green' },
    { label: 'Projected 12-mo LTV', value: fmtCurrencyExact(projected12moLTV), color: 'green' },
    { label: 'Ad Spend', value: fmtCurrencyExact(totalAdSpend), color: 'amber' },
    { label: 'ROAS', value: fmtMultiplier(roas) },
  ];

  // ── Lead Source Breakdown ──────────────────────────────────────────
  const sourceGroups = new Map<
    string,
    { purchases: number; deposited: number; callsBooked: number; closed: number }
  >();

  for (const c of contacts) {
    const src = c.lead_source || 'Unknown';
    if (!sourceGroups.has(src)) {
      sourceGroups.set(src, { purchases: 0, deposited: 0, callsBooked: 0, closed: 0 });
    }
    const g = sourceGroups.get(src)!;
    if (c.is_workshop_buyer) g.purchases++;
    if (c.deposit_paid) g.deposited++;
    if (c.call_booked) g.callsBooked++;
    if (c.converted_to_pe) g.closed++;
  }

  const leadSourceTable = Array.from(sourceGroups.entries())
    .map(([source, g]) => {
      const cr = safeDivide(g.closed, g.callsBooked) * 100;
      const revenue = g.closed * 2500 + g.deposited * 500;
      const quality: 'High' | 'Mid' | 'Low' = cr >= 40 ? 'High' : cr >= 20 ? 'Mid' : 'Low';
      return {
        source,
        purchases: g.purchases,
        deposited: g.deposited,
        callsBooked: g.callsBooked,
        closed: g.closed,
        closeRate: Math.round(cr * 10) / 10,
        revenue,
        quality,
      };
    })
    .sort((a, b) => b.purchases - a.purchases);

  const leadSourceChart = leadSourceTable.map((row) => ({
    name: row.source,
    value: row.purchases,
    color: LEAD_SOURCE_COLORS[row.source] || DEFAULT_SOURCE_COLOR,
  }));

  // ── Call Dispositions ──────────────────────────────────────────────
  const dispositionKeys: Array<'sold' | 'follow_up' | 'not_a_fit' | 'no_show'> = [
    'sold',
    'follow_up',
    'not_a_fit',
    'no_show',
  ];

  const dispositionCounts = new Map<string, number>();
  for (const key of dispositionKeys) {
    dispositionCounts.set(key, 0);
  }
  for (const c of contacts) {
    if (c.call_disposition && dispositionCounts.has(c.call_disposition)) {
      dispositionCounts.set(c.call_disposition, dispositionCounts.get(c.call_disposition)! + 1);
    }
  }

  const totalDispositions = Array.from(dispositionCounts.values()).reduce((a, b) => a + b, 0);

  const dispositions = dispositionKeys.map((key) => {
    const count = dispositionCounts.get(key) || 0;
    const pct = Math.round(safeDivide(count, totalDispositions) * 1000) / 10;
    return { label: DISPOSITION_LABELS[key], count, pct, color: DISPOSITION_COLORS[key] };
  });

  // Disposition stats
  const depositRefundedCount = contacts.filter((c) => c.deposit_refunded).length;

  const contactsWithCallDate = contacts.filter((c) => c.call_booked_at && c.created_at && c.is_workshop_buyer);
  const avgDaysPurchaseToCall =
    contactsWithCallDate.length > 0
      ? Math.round(
          (contactsWithCallDate.reduce((sum, c) => sum + daysBetween(c.created_at, c.call_booked_at!), 0) /
            contactsWithCallDate.length) *
            10,
        ) / 10
      : 0;

  const repsWithCalls = new Set(contacts.filter((c) => c.call_completed && c.assigned_rep).map((c) => c.assigned_rep));
  const avgCallsPerCloser =
    repsWithCalls.size > 0 ? Math.round(completedCount / repsWithCalls.size) : 0;

  const dispositionStats = {
    depositRefunded: depositRefundedCount,
    avgDaysPurchaseToCall,
    avgCallsPerCloser,
  };

  // ── Closer Leaderboard ─────────────────────────────────────────────
  const repGroups = new Map<string, { calls: number; closed: number; noShows: number; followUps: ContactRow[] }>();

  for (const c of contacts) {
    if (!c.assigned_rep) continue;
    const rep = c.assigned_rep;
    if (!repGroups.has(rep)) {
      repGroups.set(rep, { calls: 0, closed: 0, noShows: 0, followUps: [] });
    }
    const g = repGroups.get(rep)!;
    if (c.call_completed) g.calls++;
    if (c.converted_to_pe) g.closed++;
    if (c.call_disposition === 'no_show') g.noShows++;
    if (c.call_disposition === 'follow_up') g.followUps.push(c);
  }

  const closerLeaderboard = Array.from(repGroups.entries())
    .map(([name, g], i) => ({
      name,
      calls: g.calls,
      closeRate: Math.round(safeDivide(g.closed, g.calls) * 100),
      color: CLOSER_COLORS[i % CLOSER_COLORS.length],
    }))
    .sort((a, b) => b.closeRate - a.closeRate);

  // Closer stats
  const totalNoShows = Array.from(repGroups.values()).reduce((s, g) => s + g.noShows, 0);
  // No-show rebook = contacts that were no-show but then had call_booked_at after initial no-show
  // Approximation: contacts with disposition no_show that also have call_booked = true
  const noShowRebooked = contacts.filter(
    (c) => c.call_disposition === 'no_show' && c.call_booked,
  ).length;
  const noShowRebookRate = Math.round(safeDivide(noShowRebooked, totalNoShows) * 100);

  // Stale follow-ups: follow_up contacts where call_completed_at (or call_booked_at) > 14 days ago
  const now = Date.now();
  const fourteenDaysMs = 14 * 86_400_000;
  const staleFollowUps = contacts.filter((c) => {
    if (c.call_disposition !== 'follow_up') return false;
    const refDate = c.call_completed_at || c.call_booked_at;
    if (!refDate) return true; // no date = stale
    return now - new Date(refDate).getTime() > fourteenDaysMs;
  }).length;

  const closerStats = { noShowRebookRate, staleFollowUps };

  // ── Cohort Comparison ──────────────────────────────────────────────
  const cohortContactGroups = new Map<string, ContactRow[]>();
  for (const c of contacts) {
    if (!c.workshop_cohort) continue;
    const key = c.workshop_cohort;
    if (!cohortContactGroups.has(key)) {
      cohortContactGroups.set(key, []);
    }
    cohortContactGroups.get(key)!.push(c);
  }

  const cohortRows = Array.from(cohortContactGroups.entries())
    .map(([date, group]) => {
      const p = group.filter((c) => c.is_workshop_buyer).length;
      const a = group.filter((c) => c.attended_workshop === true).length;
      const d = group.filter((c) => c.deposit_paid).length;
      const cl = group.filter((c) => c.call_completed).length;
      const closed = group.filter((c) => c.converted_to_pe).length;
      const mrr = group.filter((c) => c.converted_to_pe).reduce((s, c) => s + (c.mrr_value || 0), 0);

      // Top source by purchase count
      const srcCounts = new Map<string, number>();
      for (const c of group) {
        if (c.is_workshop_buyer && c.lead_source) {
          srcCounts.set(c.lead_source, (srcCounts.get(c.lead_source) || 0) + 1);
        }
      }
      let topSource = 'N/A';
      let topSourceCount = 0;
      for (const [src, cnt] of srcCounts) {
        if (cnt > topSourceCount) {
          topSourceCount = cnt;
          topSource = src;
        }
      }

      return {
        workshopDate: formatDate(date),
        sortDate: date,
        purchases: p,
        attended: a,
        showPct: Math.round(safeDivide(a, p) * 1000) / 10,
        deposited: d,
        depPct: Math.round(safeDivide(d, p) * 1000) / 10,
        calls: cl,
        closed,
        closePct: Math.round(safeDivide(closed, cl) * 1000) / 10,
        mrr,
        topSource,
        // Placeholders for normalization — filled below
        showPctNorm: 0,
        closePctNorm: 0,
        mrrNorm: 0,
      };
    })
    .sort((a, b) => (b.sortDate > a.sortDate ? 1 : -1));

  // Heat-map normalization (0-1 scale)
  if (cohortRows.length > 0) {
    const maxShow = Math.max(...cohortRows.map((r) => r.showPct));
    const minShow = Math.min(...cohortRows.map((r) => r.showPct));
    const maxClose = Math.max(...cohortRows.map((r) => r.closePct));
    const minClose = Math.min(...cohortRows.map((r) => r.closePct));
    const maxMrr = Math.max(...cohortRows.map((r) => r.mrr));
    const minMrr = Math.min(...cohortRows.map((r) => r.mrr));

    for (const row of cohortRows) {
      row.showPctNorm = Math.round(safeDivide(row.showPct - minShow, maxShow - minShow, 1) * 100) / 100;
      row.closePctNorm = Math.round(safeDivide(row.closePct - minClose, maxClose - minClose, 1) * 100) / 100;
      row.mrrNorm = Math.round(safeDivide(row.mrr - minMrr, maxMrr - minMrr, 1) * 100) / 100;
    }
  }

  // Strip the sortDate helper before returning
  const cohortTable = cohortRows.map(({ sortDate: _, ...rest }) => rest);

  // ── Ad Performance ─────────────────────────────────────────────────
  const totalImpressions = adSpend.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = adSpend.reduce((s, r) => s + r.clicks, 0);
  const totalReach = adSpend.reduce((s, r) => s + r.reach, 0);

  const ctr = Math.round(safeDivide(totalClicks, totalImpressions) * 1000) / 10;
  const cpm = Math.round(safeDivide(totalAdSpend, totalImpressions) * 10000) / 10;
  const landingPageCvr = Math.round(safeDivide(purchaseCount, totalClicks) * 1000) / 10;

  // Top creative = creative_id with most spend
  const creativeSpendsMap = new Map<string, number>();
  for (const row of adSpend) {
    if (row.creative_id) {
      creativeSpendsMap.set(row.creative_id, (creativeSpendsMap.get(row.creative_id) || 0) + Number(row.spend));
    }
  }
  let topCreative = 'N/A';
  let topCreativeSpend = 0;
  for (const [cid, sp] of creativeSpendsMap) {
    if (sp > topCreativeSpend) {
      topCreativeSpend = sp;
      topCreative = cid;
    }
  }

  // Top audience = adset_id with most spend (or placeholder)
  const adsetSpendsMap = new Map<string, number>();
  for (const row of adSpend) {
    if (row.adset_id) {
      adsetSpendsMap.set(row.adset_id, (adsetSpendsMap.get(row.adset_id) || 0) + Number(row.spend));
    }
  }
  let topAudience = 'N/A';
  let topAudienceSpend = 0;
  for (const [aid, sp] of adsetSpendsMap) {
    if (sp > topAudienceSpend) {
      topAudienceSpend = sp;
      topAudience = aid;
    }
  }

  const adPerformance = {
    totalSpend: totalAdSpend,
    impressions: totalImpressions,
    clicks: totalClicks,
    ctr,
    cpm,
    landingPageCvr,
    topCreative,
    topAudience,
  };

  // ── Organic Performance ────────────────────────────────────────────
  const igOrganicCount = contacts.filter(
    (c) => c.lead_source === 'IG Organic' && c.is_workshop_buyer,
  ).length;
  const fbOrganicCount = contacts.filter(
    (c) => c.lead_source === 'FB Organic' && c.is_workshop_buyer,
  ).length;
  const emailKitCount = contacts.filter(
    (c) => c.lead_source === 'Email Kit' && c.is_workshop_buyer,
  ).length;

  // Email open rate and click-to-buy CVR are derived from UTM data when available
  // Approximate: email contacts that became buyers / total email contacts
  const emailContacts = contacts.filter((c) => c.lead_source === 'Email Kit');
  const emailBuyers = emailContacts.filter((c) => c.is_workshop_buyer);
  const emailOpenRate = emailContacts.length > 0
    ? Math.round(safeDivide(emailBuyers.length, emailContacts.length) * 1000) / 10
    : 0;

  // Click-to-buy CVR: approximate from total organic + email clicks to purchases
  const organicPurchases = igOrganicCount + fbOrganicCount + emailKitCount;
  const totalOrganicContacts = contacts.filter(
    (c) => c.lead_source === 'IG Organic' || c.lead_source === 'FB Organic' || c.lead_source === 'Email Kit',
  ).length;
  const clickToBuyCvr =
    Math.round(safeDivide(organicPurchases, totalOrganicContacts) * 1000) / 10;

  // Top email subject and IG posts from utm_content (best effort)
  const emailContentCounts = new Map<string, number>();
  for (const c of emailContacts) {
    if (c.utm_content) {
      emailContentCounts.set(c.utm_content, (emailContentCounts.get(c.utm_content) || 0) + 1);
    }
  }
  let topEmailSubject = 'N/A';
  let topEmailSubjectCount = 0;
  for (const [subj, cnt] of emailContentCounts) {
    if (cnt > topEmailSubjectCount) {
      topEmailSubjectCount = cnt;
      topEmailSubject = subj;
    }
  }

  const igContentCounts = new Map<string, number>();
  for (const c of contacts.filter((ct) => ct.lead_source === 'IG Organic')) {
    if (c.utm_content) {
      igContentCounts.set(c.utm_content, (igContentCounts.get(c.utm_content) || 0) + 1);
    }
  }
  const igPostsSorted = Array.from(igContentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name);
  const topIgPosts = igPostsSorted.length > 0 ? igPostsSorted.join(', ') : 'N/A';

  const organicPerformance = {
    igOrganic: igOrganicCount,
    fbOrganic: fbOrganicCount,
    emailKit: emailKitCount,
    emailOpenRate,
    clickToBuyCvr,
    topEmailSubject,
    topIgPosts,
  };

  // ── Partners Breakdown ─────────────────────────────────────────────
  const partnerGroups = new Map<string, { purchases: number; closed: number }>();
  for (const c of contacts) {
    if (!c.referral_partner) continue;
    if (!partnerGroups.has(c.referral_partner)) {
      partnerGroups.set(c.referral_partner, { purchases: 0, closed: 0 });
    }
    const g = partnerGroups.get(c.referral_partner)!;
    if (c.is_workshop_buyer) g.purchases++;
    if (c.converted_to_pe) g.closed++;
  }

  const partners = Array.from(partnerGroups.entries())
    .map(([name, g]) => ({
      name,
      purchases: g.purchases,
      closed: g.closed,
      revenue: g.closed * 2500,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── Cohort Dropdown ────────────────────────────────────────────────
  const cohortOptions: { value: string; label: string }[] = [{ value: 'all', label: 'All Cohorts' }];

  const sortedCohorts = [...cohorts].sort(
    (a, b) => new Date(b.workshop_date).getTime() - new Date(a.workshop_date).getTime(),
  );

  for (const ch of sortedCohorts) {
    const d = new Date(ch.workshop_date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const label = `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    cohortOptions.push({ value: ch.workshop_date, label });
  }

  // ── Assemble payload ───────────────────────────────────────────────
  return {
    funnelVolume,
    croSignals,
    costRevenue,
    funnelStages,
    revenueWaterfall,
    leadSourceChart,
    leadSourceTable,
    dispositions,
    dispositionStats,
    closerLeaderboard,
    closerStats,
    cohortTable,
    adPerformance,
    organicPerformance,
    partners,
    cohorts: cohortOptions,
  };
}
