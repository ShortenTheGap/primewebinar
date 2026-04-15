import { useEffect, useState } from 'react';
import type { DashboardPayload } from './types';
import { getDashboardData } from './data/provider';
import TopBar from './components/TopBar';
import KPISection from './components/KPISection';
import FunnelAndWaterfall from './components/FunnelAndWaterfall';
import LeadSourceSection from './components/LeadSourceSection';
import CallOutcomes from './components/CallOutcomes';
import CohortTable from './components/CohortTable';
import AdditionalTracking from './components/AdditionalTracking';
import AutomationSpec from './components/AutomationSpec';

export default function App() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cohort, setCohort] = useState('all');
  const [darkMode, setDarkMode] = useState(true);
  const [includeAllAdSpend, setIncludeAllAdSpend] = useState(false);

  useEffect(() => {
    setError(null);
    getDashboardData(cohort, includeAllAdSpend)
      .then(setData)
      .catch((err) => {
        console.error('Failed to load dashboard:', err);
        setError(err?.message || 'Failed to load dashboard data');
      });
  }, [cohort, includeAllAdSpend]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <div className="max-w-md bg-card border border-border rounded-lg p-6 text-center">
          <div className="text-[#f87171] text-sm font-semibold mb-2">Dashboard unavailable</div>
          <div className="text-muted text-sm mb-4">{error}</div>
          <div className="text-xs text-muted">
            Check that <code className="text-[#2dd4bf]">DATABASE_URL</code> is set in Railway
            and the schema has been initialized.
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted text-lg">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white pb-12">
      <TopBar
        cohorts={data.cohorts}
        selectedCohort={cohort}
        onCohortChange={setCohort}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode(!darkMode)}
        includeAllAdSpend={includeAllAdSpend}
        onToggleIncludeAllAdSpend={() => setIncludeAllAdSpend(!includeAllAdSpend)}
      />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 space-y-6 mt-6">
        <KPISection
          funnelVolume={data.funnelVolume}
          croSignals={data.croSignals}
          costRevenue={data.costRevenue}
        />
        <FunnelAndWaterfall
          stages={data.funnelStages}
          waterfall={data.revenueWaterfall}
        />
        <LeadSourceSection
          chart={data.leadSourceChart}
          table={data.leadSourceTable}
        />
        <CallOutcomes
          dispositions={data.dispositions}
          stats={data.dispositionStats}
          leaderboard={data.closerLeaderboard}
          closerStats={data.closerStats}
        />
        <CohortTable rows={data.cohortTable} />
        <AdditionalTracking
          ad={data.adPerformance}
          organic={data.organicPerformance}
          partners={data.partners}
        />
        <AutomationSpec />
      </div>
    </div>
  );
}
