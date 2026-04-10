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
  const [cohort, setCohort] = useState('all');
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    getDashboardData(cohort).then(setData);
  }, [cohort]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

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
