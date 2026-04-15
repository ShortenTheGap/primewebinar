import { useEffect, useState } from 'react';

interface Cohort {
  id: string;
  workshop_date: string;
  label: string;
  is_active: boolean;
  zoom_webinar_id: string | null;
  ad_campaign_ids: string[] | null;
  ad_attribution_start: string | null;
  created_at: string;
}

interface Campaign {
  campaign_id: string;
  campaign_name: string;
  first_date: string;
  last_date: string;
  total_spend: number | string;
  total_impressions: number;
  total_clicks: number;
}

async function api(
  token: string,
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: any,
): Promise<any> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: {
      'x-admin-token': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: text };
  }
  if (!res.ok) throw new Error(parsed?.error || `HTTP ${res.status}`);
  return parsed;
}

function fmtDollar(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!Number.isFinite(num)) return '$0';
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`;
  return `$${num.toFixed(0)}`;
}

export default function AdminView() {
  const [token, setToken] = useState<string>(() => localStorage.getItem('adminToken') || '');
  const [tokenInput, setTokenInput] = useState('');
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // New cohort form
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newZoomId, setNewZoomId] = useState('');

  // Inline zoom-id edit
  const [editingZoomId, setEditingZoomId] = useState<string | null>(null);
  const [zoomEditValue, setZoomEditValue] = useState('');

  // Ad attribution — which cohort's panel is open, and the in-progress edits
  const [openAdsPanel, setOpenAdsPanel] = useState<string | null>(null);
  const [adEditCampaigns, setAdEditCampaigns] = useState<Set<string>>(new Set());
  const [adEditStart, setAdEditStart] = useState<string>('');

  async function loadCohorts() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [cohortsData, campaignsData] = await Promise.all([
        api(token, '/cohorts'),
        api(token, '/meta-campaigns').catch(() => ({ campaigns: [] })),
      ]);
      setCohorts(cohortsData.cohorts || []);
      setCampaigns(campaignsData.campaigns || []);
    } catch (err: any) {
      setError(err.message);
      if (err.message.includes('401')) {
        localStorage.removeItem('adminToken');
        setToken('');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadCohorts();
  }, [token]);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function saveToken() {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    localStorage.setItem('adminToken', trimmed);
    setToken(trimmed);
  }

  async function addCohort(e: React.FormEvent) {
    e.preventDefault();
    if (!newDate) return;
    try {
      await api(token, '/cohorts', 'POST', {
        workshop_date: newDate,
        label: newLabel || undefined,
        zoom_webinar_id: newZoomId.replace(/\s+/g, '') || undefined,
      });
      flashToast(`Saved ${newDate}`);
      setNewDate('');
      setNewLabel('');
      setNewZoomId('');
      loadCohorts();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function saveZoomId(cohort: Cohort) {
    try {
      await api(token, '/cohorts', 'POST', {
        workshop_date: cohort.workshop_date,
        zoom_webinar_id: zoomEditValue.replace(/\s+/g, '') || null,
      });
      flashToast(`Updated Zoom ID for ${cohort.workshop_date}`);
      setEditingZoomId(null);
      loadCohorts();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteCohort(cohort: Cohort) {
    if (!confirm(`Delete cohort ${cohort.workshop_date}? Contacts in it will remain but the cohort row will be removed.`)) return;
    try {
      await api(token, `/cohorts/${cohort.workshop_date}`, 'DELETE');
      flashToast(`Deleted ${cohort.workshop_date}`);
      loadCohorts();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function openAdsFor(cohort: Cohort) {
    setOpenAdsPanel(cohort.id);
    setAdEditCampaigns(new Set(cohort.ad_campaign_ids || []));
    setAdEditStart(cohort.ad_attribution_start || '');
  }

  function toggleCampaign(campaignId: string) {
    const next = new Set(adEditCampaigns);
    if (next.has(campaignId)) next.delete(campaignId);
    else next.add(campaignId);
    setAdEditCampaigns(next);
  }

  async function saveAdAttribution(cohort: Cohort) {
    try {
      await api(token, '/cohorts', 'POST', {
        workshop_date: cohort.workshop_date,
        ad_campaign_ids: Array.from(adEditCampaigns),
        ad_attribution_start: adEditStart || null,
      });
      flashToast(`Ad attribution saved for ${cohort.workshop_date}`);
      setOpenAdsPanel(null);
      loadCohorts();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function triggerMetaSync() {
    const since = prompt('Sync from date (YYYY-MM-DD). Leave blank for yesterday only:');
    if (since === null) return;
    const until = since ? prompt('Sync to date (YYYY-MM-DD). Leave blank = same as "since":') : null;
    if (until === null && since) return;
    try {
      const body: any = {};
      if (since) body.since = since;
      if (until) body.until = until;
      const result = await api(token, '/meta-sync', 'POST', body);
      if (result.ok) {
        flashToast(`Meta sync: ${result.upserted} rows upserted`);
        loadCohorts();
      } else {
        setError(result.error || 'Meta sync failed');
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  function signOut() {
    localStorage.removeItem('adminToken');
    setToken('');
    setCohorts([]);
  }

  // Token entry screen
  if (!token) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white flex items-center justify-center px-4">
        <form
          onSubmit={(e) => { e.preventDefault(); saveToken(); }}
          className="w-full max-w-sm bg-card border border-border rounded-lg p-6 space-y-4"
        >
          <h1 className="text-lg font-semibold">Admin — Enter Token</h1>
          <p className="text-xs text-muted">
            Paste your <code className="text-teal">ADMIN_TOKEN</code> value from Railway. Saved
            to this browser only.
          </p>
          <input
            type="password"
            autoFocus
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="w-full bg-[#141414] border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal"
          />
          <button
            type="submit"
            className="w-full bg-teal/20 hover:bg-teal/30 text-teal border border-teal/40 rounded px-3 py-2 text-sm font-medium"
          >
            Continue
          </button>
          <a href="/" className="block text-center text-xs text-muted hover:text-white">
            ← Back to dashboard
          </a>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white pb-12">
      <header className="sticky top-0 z-50 bg-[#0f0f0f]/95 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-teal" />
            <h1 className="text-base font-semibold tracking-tight">Admin — Cohorts</h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={triggerMetaSync} className="text-xs text-teal hover:underline">Sync Meta Ads</button>
            <a href="/" className="text-xs text-muted hover:text-white">← Dashboard</a>
            <button onClick={signOut} className="text-xs text-muted hover:text-white">Sign out</button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-6 space-y-6">
        {toast && (
          <div className="bg-[#4ade80]/10 border border-[#4ade80]/30 text-[#4ade80] rounded px-4 py-2 text-sm">
            {toast}
          </div>
        )}
        {error && (
          <div className="bg-[#ef4444]/10 border border-[#ef4444]/30 text-[#f87171] rounded px-4 py-2 text-sm flex items-start justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-xs opacity-60 hover:opacity-100">dismiss</button>
          </div>
        )}

        {/* Add cohort form */}
        <section className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">
            Add / Update Cohort
          </h2>
          <form onSubmit={addCohort} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Workshop Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                required
                className="w-full bg-[#141414] border border-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Label (optional)</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. May 10, 2026"
                className="w-full bg-[#141414] border border-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Zoom Webinar ID</label>
              <input
                type="text"
                value={newZoomId}
                onChange={(e) => setNewZoomId(e.target.value)}
                placeholder="e.g. 82612345678"
                className="w-full bg-[#141414] border border-border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full bg-teal/20 hover:bg-teal/30 text-teal border border-teal/40 rounded px-3 py-2 text-sm font-medium"
              >
                Save
              </button>
            </div>
          </form>
          <p className="text-xs text-muted mt-3">
            Ad attribution (which Meta campaigns + date window feed this cohort's ROAS) is
            managed per-cohort below — click <strong className="text-white">Manage Ads</strong>.
          </p>
        </section>

        {/* Cohorts list */}
        <section className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold">
              Registered Cohorts
            </h2>
            <button onClick={loadCohorts} disabled={loading} className="text-xs text-muted hover:text-white">
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {cohorts.length === 0 ? (
            <p className="text-sm text-muted">No cohorts yet. Add one above.</p>
          ) : (
            <div className="space-y-2">
              {cohorts.map((c) => {
                const isEditingZoom = editingZoomId === c.id;
                const isAdsOpen = openAdsPanel === c.id;
                const adCount = (c.ad_campaign_ids || []).length;
                return (
                  <div key={c.id} className="border border-border rounded-lg bg-[#141414]">
                    <div className="grid grid-cols-[120px_1fr_auto] sm:grid-cols-[140px_1fr_1fr_auto] gap-3 items-center p-4">
                      <div className="font-medium text-sm">{c.workshop_date}</div>
                      <div className="text-muted text-sm">{c.label}</div>
                      <div className="text-xs">
                        {isEditingZoom ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={zoomEditValue}
                              onChange={(e) => setZoomEditValue(e.target.value)}
                              placeholder="Zoom ID"
                              className="flex-1 bg-[#0f0f0f] border border-border rounded px-2 py-1 text-xs"
                            />
                            <button
                              onClick={() => saveZoomId(c)}
                              className="bg-teal/20 hover:bg-teal/30 text-teal border border-teal/40 rounded px-2 py-1 text-xs"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingZoomId(null)}
                              className="text-muted hover:text-white px-2 py-1 text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingZoomId(c.id); setZoomEditValue(c.zoom_webinar_id || ''); }}
                            className="text-left"
                          >
                            <div className="text-muted text-[10px] uppercase tracking-wider mb-0.5">Zoom ID</div>
                            {c.zoom_webinar_id ? (
                              <code className="text-[#a78bfa]">{c.zoom_webinar_id}</code>
                            ) : (
                              <span className="text-muted italic">not set — click to add</span>
                            )}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => isAdsOpen ? setOpenAdsPanel(null) : openAdsFor(c)}
                          className={`text-xs px-2 py-1 rounded border ${
                            isAdsOpen
                              ? 'bg-teal/20 text-teal border-teal/40'
                              : 'border-border text-muted hover:text-white hover:border-muted'
                          }`}
                        >
                          {isAdsOpen ? 'Close' : `Manage Ads${adCount > 0 ? ` (${adCount})` : ''}`}
                        </button>
                        <button
                          onClick={() => deleteCohort(c)}
                          className="text-xs text-[#f87171] hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Ads attribution expanded panel */}
                    {isAdsOpen && (
                      <div className="border-t border-border p-4 space-y-4 bg-[#0f0f0f]">
                        <div className="flex items-start gap-4">
                          <div>
                            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
                              Attribution Start
                            </label>
                            <input
                              type="date"
                              value={adEditStart}
                              onChange={(e) => setAdEditStart(e.target.value)}
                              className="bg-[#141414] border border-border rounded px-3 py-1.5 text-sm"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
                              Attribution End (workshop date)
                            </label>
                            <div className="text-sm py-1.5">{c.workshop_date}</div>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-[10px] uppercase tracking-wider text-muted">
                              Attributed Campaigns ({adEditCampaigns.size} selected)
                            </label>
                            <span className="text-[11px] text-muted">
                              {campaigns.length === 0
                                ? 'No campaigns pulled yet — hit "Sync Meta Ads" up top'
                                : `${campaigns.length} total in ad account`}
                            </span>
                          </div>
                          {campaigns.length > 0 && (
                            <div className="max-h-[280px] overflow-y-auto border border-border rounded">
                              {campaigns.map((camp) => {
                                const checked = adEditCampaigns.has(camp.campaign_id);
                                return (
                                  <label
                                    key={camp.campaign_id}
                                    className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer border-b border-border last:border-0 ${
                                      checked ? 'bg-teal/5' : 'hover:bg-[#141414]'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleCampaign(camp.campaign_id)}
                                      className="accent-teal"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="truncate">
                                        {camp.campaign_name || <span className="italic text-muted">(unnamed)</span>}
                                      </div>
                                      <div className="text-[11px] text-muted">
                                        <code className="text-[#a78bfa] mr-2">{camp.campaign_id}</code>
                                        {camp.first_date}{camp.first_date !== camp.last_date ? ` → ${camp.last_date}` : ''}
                                      </div>
                                    </div>
                                    <div className="text-xs text-muted whitespace-nowrap">
                                      {fmtDollar(camp.total_spend)} spent
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setOpenAdsPanel(null)}
                            className="text-xs px-3 py-1.5 text-muted hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveAdAttribution(c)}
                            className="text-xs px-3 py-1.5 bg-teal/20 hover:bg-teal/30 text-teal border border-teal/40 rounded"
                          >
                            Save Attribution
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="bg-[#141414] border border-border rounded-lg p-5 text-xs text-muted space-y-2">
          <h3 className="text-white font-medium text-sm mb-2">How Ad Attribution Works</h3>
          <p>
            For each cohort, pick the Meta campaigns you ran to drive that workshop, and set
            the <strong className="text-white">Attribution Start</strong> date (usually the day
            you turned ads on, or the day after the previous workshop).
          </p>
          <p>
            The dashboard's <strong className="text-white">ROAS, Cost Per Buy, and Ad Performance</strong> numbers
            only count ad spend from those campaigns within
            <code className="text-[#2dd4bf]"> [Attribution Start, Workshop Date]</code>. Non-webinar
            campaigns and spend outside the window are excluded.
          </p>
          <p>
            Hit <strong className="text-white">Sync Meta Ads</strong> (top right) to pull the latest spend
            from your Meta account. The cron also runs this daily at 6am UTC.
          </p>
        </section>
      </div>
    </div>
  );
}
