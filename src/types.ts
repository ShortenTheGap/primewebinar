export interface KPICard {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  // When set, the card displays the breakdown items side-by-side instead of
  // the single `value`. Use for metrics that have a meaningful split
  // (e.g. paid vs guest attendees).
  breakdown?: Array<{ label: string; value: string; color?: string }>;
}

export interface FunnelStage {
  label: string;
  count: number;
  pctOfTotal: number;
  stepRate: number;
  color: string;
}

export interface RevenueRow {
  label: string;
  value: string;
  color?: string;
}

export interface LeadSourceRow {
  source: string;
  purchases: number;
  deposited: number;
  callsBooked: number;
  closed: number;
  closeRate: number;
  revenue: number;
  quality: 'High' | 'Mid' | 'Low' | null;
}

export interface LeadSourceChartItem {
  name: string;
  value: number;
  color: string;
}

export interface DispositionItem {
  label: string;
  count: number;
  pct: number;
  color: string;
}

export interface CloserRow {
  name: string;
  calls: number;
  closeRate: number;
  color: string;
}

export interface CohortRow {
  workshopDate: string;
  purchases: number;
  attended: number;
  showPct: number;
  deposited: number;
  depPct: number;
  calls: number;
  closed: number;
  closePct: number;
  mrr: number;
  topSource: string;
  showPctNorm: number;
  closePctNorm: number;
  mrrNorm: number;
}

export interface AdPerformance {
  totalSpend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  adCvr: number;
  landingPageCvr: number;
  topCreative: string;
  topAudience: string;
}

export interface OrganicPerformance {
  igOrganic: number;
  fbOrganic: number;
  email: number;
  emailOpenRate: number;
  topEmailSubject: string;
  topIgPosts: string;
}

export interface PartnerRow {
  name: string;
  purchases: number;
  closed: number;
  revenue: number;
}

export interface DashboardPayload {
  funnelVolume: KPICard[];
  croSignals: KPICard[];
  costRevenue: KPICard[];
  funnelStages: FunnelStage[];
  revenueWaterfall: RevenueRow[];
  leadSourceChart: LeadSourceChartItem[];
  leadSourceTable: LeadSourceRow[];
  dispositions: DispositionItem[];
  dispositionStats: {
    depositRefunded: number;
    avgDaysPurchaseToCall: number;
    avgCallsPerCloser: number;
  };
  closerLeaderboard: CloserRow[];
  closerStats: {
    noShowRebookRate: number;
    staleFollowUps: number;
  };
  cohortTable: CohortRow[];
  adPerformance: AdPerformance;
  organicPerformance: OrganicPerformance;
  partners: PartnerRow[];
  cohorts: { value: string; label: string }[];
  // The cohort the server actually used when building this payload. If the
  // client requested `cohort=current`, the server resolves it to a specific
  // workshop_date (or 'all' if there are no cohorts). The client reflects this
  // back into its state so the dropdown shows the right label.
  selectedCohort: string;
}
