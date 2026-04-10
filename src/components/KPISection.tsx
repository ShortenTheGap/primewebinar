import type { KPICard } from '../types';

function SectionLabel({ text }: { text: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
      {text}
    </h2>
  );
}

function Card({ card, variant }: { card: KPICard; variant?: 'cro' | 'default' }) {
  const bg = variant === 'cro' ? 'bg-[#141414]' : 'bg-card';
  const colorMap: Record<string, string> = {
    green: 'text-[#4ade80]',
    amber: 'text-[#f59e0b]',
    purple: 'text-[#a78bfa]',
    teal: 'text-[#2dd4bf]',
  };
  const valueColor = card.color ? colorMap[card.color] || 'text-white' : 'text-white';

  return (
    <div className={`${bg} border border-border rounded-lg p-4 flex flex-col justify-between min-h-[100px]`}>
      <span className="text-[11px] uppercase tracking-widest text-muted font-medium">
        {card.label}
      </span>
      <div className="mt-2">
        <span className={`text-2xl font-bold ${valueColor}`}>{card.value}</span>
        {card.sub && (
          <p className="text-xs text-muted mt-1">{card.sub}</p>
        )}
      </div>
    </div>
  );
}

interface Props {
  funnelVolume: KPICard[];
  croSignals: KPICard[];
  costRevenue: KPICard[];
}

export default function KPISection({ funnelVolume, croSignals, costRevenue }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <SectionLabel text="Funnel Volume" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {funnelVolume.map((c) => (
            <Card key={c.label} card={c} />
          ))}
        </div>
      </div>
      <div>
        <SectionLabel text="CRO Signals" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {croSignals.map((c) => (
            <Card key={c.label} card={c} variant="cro" />
          ))}
        </div>
      </div>
      <div>
        <SectionLabel text="Cost & Revenue" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {costRevenue.map((c) => (
            <Card key={c.label} card={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
