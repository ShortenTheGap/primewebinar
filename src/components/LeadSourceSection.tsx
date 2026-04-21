import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { LeadSourceChartItem, LeadSourceRow } from '../types';

function SectionLabel({ text }: { text: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
      {text}
    </h2>
  );
}

function QualityBadge({ quality }: { quality: 'High' | 'Mid' | 'Low' }) {
  const styles = {
    High: 'bg-[#4ade80]/15 text-[#4ade80]',
    Mid: 'bg-[#f59e0b]/15 text-[#f59e0b]',
    Low: 'bg-[#ef4444]/15 text-[#f87171]',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${styles[quality]}`}>
      {quality}
    </span>
  );
}

interface Props {
  chart: LeadSourceChartItem[];
  table: LeadSourceRow[];
}

export default function LeadSourceSection({ chart, table }: Props) {
  return (
    <div>
      <SectionLabel text="Lead Source Breakdown" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Donut Chart */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-5">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chart}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={100}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {chart.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff' }}
                />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  iconSize={8}
                  formatter={(value: string) => <span className="text-xs text-muted ml-1">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Table */}
        <div className="lg:col-span-3 bg-card border border-border rounded-lg p-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-[11px] uppercase tracking-wider">
                <th className="text-left pb-3 font-medium">Source</th>
                <th className="text-right pb-3 font-medium">Purchases</th>
                <th className="text-right pb-3 font-medium">Deposited</th>
                <th className="text-right pb-3 font-medium">Calls</th>
                <th className="text-right pb-3 font-medium">Closed</th>
                <th className="text-right pb-3 font-medium">Close %</th>
                <th className="text-right pb-3 font-medium">Revenue</th>
                <th className="text-center pb-3 font-medium">Quality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {table.map((row) => (
                <tr key={row.source} className="hover:bg-[#141414] transition-colors">
                  <td className="py-2.5 font-medium">{row.source}</td>
                  <td className="py-2.5 text-right">{row.purchases}</td>
                  <td className="py-2.5 text-right">{row.deposited}</td>
                  <td className="py-2.5 text-right">{row.callsBooked}</td>
                  <td className="py-2.5 text-right">{row.closed}</td>
                  <td className="py-2.5 text-right">{row.closeRate.toFixed(1)}%</td>
                  <td className="py-2.5 text-right text-[#4ade80]">${row.revenue.toLocaleString()}</td>
                  <td className="py-2.5 text-center">
                    {row.quality
                      ? <QualityBadge quality={row.quality} />
                      : <span className="text-muted text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
