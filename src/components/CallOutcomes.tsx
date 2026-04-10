import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import type { DispositionItem, CloserRow } from '../types';

function SectionLabel({ text }: { text: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
      {text}
    </h2>
  );
}

interface Props {
  dispositions: DispositionItem[];
  stats: {
    depositRefunded: number;
    avgDaysPurchaseToCall: number;
    avgCallsPerCloser: number;
  };
  leaderboard: CloserRow[];
  closerStats: {
    noShowRebookRate: number;
    staleFollowUps: number;
  };
}

export default function CallOutcomes({ dispositions, stats, leaderboard, closerStats }: Props) {
  const chartData = dispositions.map((d) => ({
    name: d.label,
    value: d.count,
    color: d.color,
  }));

  return (
    <div>
      <SectionLabel text="Interview Call Outcomes" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar Chart */}
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff' }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Big Number Cards */}
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {dispositions.map((d) => (
              <div key={d.label} className="bg-[#141414] rounded-lg p-3 text-center">
                <div className="text-2xl font-bold" style={{ color: d.color }}>{d.count}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted mt-1">{d.label}</div>
                <div className="text-xs text-muted">{d.pct.toFixed(1)}%</div>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Deposit Refunded</span>
              <span className="font-medium">{stats.depositRefunded}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Avg days purchase→call</span>
              <span className="font-medium">{stats.avgDaysPurchaseToCall}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Avg calls per closer</span>
              <span className="font-medium">{stats.avgCallsPerCloser}</span>
            </div>
          </div>
        </div>

        {/* Closer Leaderboard */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Closer Leaderboard</h3>
          <div className="space-y-3">
            {leaderboard.map((rep) => (
              <div key={rep.name} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{rep.name}</div>
                  <div className="text-xs text-muted">{rep.calls} calls</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-[#141414] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${rep.closeRate}%`, backgroundColor: rep.color }}
                    />
                  </div>
                  <span className="text-sm font-semibold" style={{ color: rep.color }}>
                    {rep.closeRate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border mt-4 pt-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted">No-show rebooking rate</span>
              <span className="font-medium text-[#f59e0b]">{closerStats.noShowRebookRate}%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Follow-up &gt;14 days stale</span>
              <span className="font-medium text-[#ef4444]">{closerStats.staleFollowUps}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
