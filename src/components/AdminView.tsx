import { useEffect, useState } from 'react';

interface Cohort {
  id: string;
  workshop_date: string;
  label: string;
  is_active: boolean;
  zoom_webinar_id: string | null;
  created_at: string;
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

export default function AdminView() {
  const [token, setToken] = useState<string>(() => localStorage.getItem('adminToken') || '');
  const [tokenInput, setTokenInput] = useState('');
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // New cohort form
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newZoomId, setNewZoomId] = useState('');

  // Inline zoom-id edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  async function loadCohorts() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api(token, '/cohorts');
      setCohorts(data.cohorts || []);
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

  async function saveToken() {
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
        zoom_webinar_id: editValue.replace(/\s+/g, '') || null,
      });
      flashToast(`Updated Zoom ID for ${cohort.workshop_date}`);
      setEditingId(null);
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-teal" />
            <h1 className="text-base font-semibold tracking-tight">Admin — Cohorts</h1>
          </div>
          <div className="flex items-center gap-3">
            <a href="/" className="text-xs text-muted hover:text-white">← Dashboard</a>
            <button onClick={signOut} className="text-xs text-muted hover:text-white">Sign out</button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 mt-6 space-y-6">
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
            Entering a date that already exists will <em>update</em> that cohort's label and/or Zoom ID — won't create a duplicate.
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
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-[11px] uppercase tracking-wider">
                  <th className="text-left pb-3 font-medium">Date</th>
                  <th className="text-left pb-3 font-medium">Label</th>
                  <th className="text-left pb-3 font-medium">Zoom Webinar ID</th>
                  <th className="text-right pb-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cohorts.map((c) => {
                  const isEditing = editingId === c.id;
                  return (
                    <tr key={c.id} className="hover:bg-[#141414]">
                      <td className="py-3 font-medium">{c.workshop_date}</td>
                      <td className="py-3 text-muted">{c.label}</td>
                      <td className="py-3">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              placeholder="Zoom Webinar ID"
                              className="flex-1 bg-[#141414] border border-border rounded px-2 py-1 text-xs"
                            />
                            <button
                              onClick={() => saveZoomId(c)}
                              className="bg-teal/20 hover:bg-teal/30 text-teal border border-teal/40 rounded px-2 py-1 text-xs"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-muted hover:text-white px-2 py-1 text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : c.zoom_webinar_id ? (
                          <code className="text-[#a78bfa] text-xs">{c.zoom_webinar_id}</code>
                        ) : (
                          <span className="text-muted italic text-xs">not set</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {!isEditing && (
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => { setEditingId(c.id); setEditValue(c.zoom_webinar_id || ''); }}
                              className="text-xs text-teal hover:underline"
                            >
                              Edit Zoom ID
                            </button>
                            <button
                              onClick={() => deleteCohort(c)}
                              className="text-xs text-[#f87171] hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="bg-[#141414] border border-border rounded-lg p-5 text-xs text-muted space-y-2">
          <h3 className="text-white font-medium text-sm mb-2">How to find a Zoom Webinar ID</h3>
          <p>
            In the Zoom web portal, go to <strong className="text-white">Webinars</strong> and click your scheduled webinar.
            The ID is the 10–11 digit number shown as "Webinar ID" (e.g. <code className="text-[#a78bfa]">826 1234 5678</code>).
            Paste it here — spaces will be stripped automatically.
          </p>
          <p>
            Only events for webinars registered here will flow into the dashboard. 1:1 calls and other webinars on your Zoom account are ignored.
          </p>
        </section>
      </div>
    </div>
  );
}
