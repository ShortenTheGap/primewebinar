import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';
import type { FunnelStage, RevenueRow } from '../types';

function SectionLabel({ text }: { text: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
      {text}
    </h2>
  );
}

interface Props {
  stages: FunnelStage[];
  waterfall: RevenueRow[];
}

export default function FunnelAndWaterfall({ stages, waterfall }: Props) {
  const chartData = stages.map((s) => ({
    name: s.label,
    value: s.count,
    pctOfTotal: s.pctOfTotal,
    stepRate: s.stepRate,
    color: s.color,
  }));

  const colorMap: Record<string, string> = {
    green: 'text-[#4ade80]',
    amber: 'text-[#f59e0b]',
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Conversion Funnel */}
      <div className="lg:col-span-3 bg-card border border-border rounded-lg p-5">
        <SectionLabel text="Conversion Funnel" />
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 80 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fill: '#fff', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff' }}
                formatter={(value: number) => [value, 'Count']}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={32} label={({ x, y, width, height, index }: any) => {
                const item = chartData[index];
                return (
                  <text
                    x={x + width + 8}
                    y={y + height / 2}
                    fill="#fff"
                    fontSize={12}
                    dominantBaseline="middle"
                  >
                    {item.value} ({item.pctOfTotal}%) {index > 0 ? `↓${item.stepRate}%` : ''}
                  </text>
                );
              }}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Revenue Waterfall */}
      <div className="lg:col-span-2 bg-card border border-border rounded-lg p-5">
        <SectionLabel text="Revenue Waterfall" />
        <div className="space-y-3 mt-2">
          {waterfall.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
            >
              <span className="text-sm text-muted">{row.label}</span>
              <span className={`text-sm font-semibold ${row.color ? colorMap[row.color] || 'text-white' : 'text-white'}`}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
