import type { CohortRow } from '../types';

function SectionLabel({ text }: { text: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
      {text}
    </h2>
  );
}

function heatColor(norm: number): string {
  if (norm >= 0.7) return 'rgba(74, 222, 128, 0.15)';
  if (norm >= 0.4) return 'rgba(245, 158, 11, 0.1)';
  return 'rgba(239, 68, 68, 0.1)';
}

function heatText(norm: number): string {
  if (norm >= 0.7) return '#4ade80';
  if (norm >= 0.4) return '#f59e0b';
  return '#f87171';
}

interface Props {
  rows: CohortRow[];
}

export default function CohortTable({ rows }: Props) {
  return (
    <div>
      <SectionLabel text="Cohort Performance" />
      <div className="bg-card border border-border rounded-lg p-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-[11px] uppercase tracking-wider">
              <th className="text-left pb-3 font-medium">Workshop Date</th>
              <th className="text-right pb-3 font-medium">Purchases</th>
              <th className="text-right pb-3 font-medium">Attended</th>
              <th className="text-right pb-3 font-medium">Show%</th>
              <th className="text-right pb-3 font-medium">Deposited</th>
              <th className="text-right pb-3 font-medium">Dep%</th>
              <th className="text-right pb-3 font-medium">Calls</th>
              <th className="text-right pb-3 font-medium">Closed</th>
              <th className="text-right pb-3 font-medium">Close%</th>
              <th className="text-right pb-3 font-medium">MRR</th>
              <th className="text-left pb-3 font-medium pl-4">Top Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.workshopDate} className="hover:bg-[#141414] transition-colors">
                <td className="py-2.5 font-medium">{row.workshopDate}</td>
                <td className="py-2.5 text-right">{row.purchases}</td>
                <td className="py-2.5 text-right">{row.attended}</td>
                <td
                  className="py-2.5 text-right font-medium rounded"
                  style={{
                    backgroundColor: heatColor(row.showPctNorm),
                    color: heatText(row.showPctNorm),
                  }}
                >
                  {row.showPct.toFixed(1)}%
                </td>
                <td className="py-2.5 text-right">{row.deposited}</td>
                <td className="py-2.5 text-right text-muted">{row.depPct.toFixed(1)}%</td>
                <td className="py-2.5 text-right">{row.calls}</td>
                <td className="py-2.5 text-right">{row.closed}</td>
                <td
                  className="py-2.5 text-right font-medium rounded"
                  style={{
                    backgroundColor: heatColor(row.closePctNorm),
                    color: heatText(row.closePctNorm),
                  }}
                >
                  {row.closePct.toFixed(1)}%
                </td>
                <td
                  className="py-2.5 text-right font-medium rounded"
                  style={{
                    backgroundColor: heatColor(row.mrrNorm),
                    color: heatText(row.mrrNorm),
                  }}
                >
                  ${(row.mrr / 1000).toFixed(1)}K
                </td>
                <td className="py-2.5 text-left pl-4 text-muted">{row.topSource}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
