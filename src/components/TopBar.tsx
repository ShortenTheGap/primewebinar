interface Props {
  cohorts: { value: string; label: string }[];
  selectedCohort: string;
  onCohortChange: (v: string) => void;
  darkMode: boolean;
  onToggleDark: () => void;
  includeAllAdSpend: boolean;
  onToggleIncludeAllAdSpend: () => void;
}

export default function TopBar({
  cohorts,
  selectedCohort,
  onCohortChange,
  darkMode,
  onToggleDark,
  includeAllAdSpend,
  onToggleIncludeAllAdSpend,
}: Props) {
  return (
    <header className="sticky top-0 z-50 bg-[#0f0f0f]/95 backdrop-blur border-b border-border">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-teal" />
          <h1 className="text-base font-semibold tracking-tight">
            Prime Elite — Workshop Funnel
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs font-medium text-[#4ade80]">
            <span className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse-live" />
            LIVE
          </span>

          <select
            value={selectedCohort}
            onChange={(e) => onCohortChange(e.target.value)}
            className="bg-card border border-border rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal"
          >
            {cohorts.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onToggleIncludeAllAdSpend}
            title={
              includeAllAdSpend
                ? 'Showing ALL ad spend in cohort window. Click to use only attributed campaigns.'
                : 'Showing only attributed campaigns. Click to include ALL ad spend in cohort window.'
            }
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs transition-colors ${
              includeAllAdSpend
                ? 'bg-amber/10 border-amber/40 text-amber'
                : 'bg-card border-border text-muted hover:text-white'
            }`}
          >
            <span
              className={`w-7 h-4 rounded-full relative transition-colors ${
                includeAllAdSpend ? 'bg-amber/60' : 'bg-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  includeAllAdSpend ? 'left-3.5' : 'left-0.5'
                }`}
              />
            </span>
            {includeAllAdSpend ? 'ALL ad spend' : 'Attributed only'}
          </button>

          <a
            href="/admin"
            className="text-xs text-muted hover:text-white transition-colors"
          >
            Admin
          </a>

          <button
            onClick={onToggleDark}
            className="w-8 h-8 flex items-center justify-center rounded-md border border-border hover:bg-card transition-colors"
            aria-label="Toggle dark mode"
          >
            {darkMode ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
