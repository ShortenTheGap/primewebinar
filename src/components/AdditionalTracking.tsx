import type { AdPerformance, OrganicPerformance, PartnerRow } from '../types';

function SectionLabel({ text }: { text: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
      {text}
    </h2>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between text-sm py-1.5">
      <span className="text-muted">{label}</span>
      <span className={`font-medium ${color || ''}`}>{value}</span>
    </div>
  );
}

interface Props {
  ad: AdPerformance;
  organic: OrganicPerformance;
  partners: PartnerRow[];
}

export default function AdditionalTracking({ ad, organic, partners }: Props) {
  return (
    <div>
      <SectionLabel text="Additional Tracking" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Ad Performance */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
            Ad Performance
          </h3>
          <div className="space-y-0.5">
            <StatRow label="Total Ad Spend" value={`$${ad.totalSpend.toLocaleString()}`} color="text-[#f59e0b]" />
            <StatRow label="Impressions" value={ad.impressions.toLocaleString()} />
            <StatRow label="Clicks" value={ad.clicks.toLocaleString()} />
            <StatRow label="CTR" value={`${ad.ctr}%`} />
            <StatRow label="CPM" value={`$${ad.cpm.toFixed(2)}`} />
            <StatRow label="Landing Page CVR" value={`${ad.landingPageCvr}%`} />
            <StatRow label="Top Creative" value={ad.topCreative} color="text-[#a78bfa]" />
            <StatRow label="Top Audience" value={ad.topAudience} color="text-[#a78bfa]" />
          </div>
        </div>

        {/* Organic Performance */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
            Organic Performance
          </h3>
          <div className="space-y-0.5">
            <StatRow label="IG Organic" value={String(organic.igOrganic)} />
            <StatRow label="FB Organic" value={String(organic.fbOrganic)} />
            <StatRow label="Email Kit" value={String(organic.emailKit)} />
            <StatRow label="Email Open Rate" value={`${organic.emailOpenRate}%`} color="text-[#4ade80]" />
            <StatRow label="Click-to-Buy CVR" value={`${organic.clickToBuyCvr}%`} />
            <StatRow label="Top Email Subject" value={organic.topEmailSubject} color="text-[#a78bfa]" />
            <StatRow label="Top IG Posts" value={organic.topIgPosts} color="text-[#a78bfa]" />
          </div>
        </div>

        {/* Partner / Referral */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
            Partner / Referral
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-[11px] uppercase tracking-wider">
                <th className="text-left pb-2 font-medium">Partner</th>
                <th className="text-right pb-2 font-medium">Purchases</th>
                <th className="text-right pb-2 font-medium">Closed</th>
                <th className="text-right pb-2 font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {partners.map((p) => (
                <tr key={p.name} className="hover:bg-[#141414] transition-colors">
                  <td className="py-2 font-medium">{p.name}</td>
                  <td className="py-2 text-right">{p.purchases}</td>
                  <td className="py-2 text-right">{p.closed}</td>
                  <td className="py-2 text-right text-[#4ade80]">${p.revenue.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="text-muted">
                <td className="py-2 italic">[Add partner]</td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
