import type { KPICard } from '../types';

function SectionLabel({ text }: { text: string }) {
  return (
    <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
      {text}
    </h2>
  );
}

const COLOR_MAP: Record<string, string> = {
  green: 'text-[#4ade80]',
  amber: 'text-[#f59e0b]',
  purple: 'text-[#a78bfa]',
  teal: 'text-[#2dd4bf]',
  red: 'text-[#f87171]',
};

function resolveColor(color?: string): string {
  if (!color) return 'text-white';
  return COLOR_MAP[color] || 'text-white';
}

function Card({ card, variant }: { card: KPICard; variant?: 'cro' | 'default' }) {
  const bg = variant === 'cro' ? 'bg-[#141414]' : 'bg-card';
  const valueColor = resolveColor(card.color);

  return (
    <div className={`${bg} border border-border rounded-lg p-4 flex flex-col justify-between h-[112px]`}>
      <span className="text-[11px] uppercase tracking-widest text-muted font-medium leading-tight">
        {card.label}
      </span>
      <div className="flex flex-col">
        {card.breakdown && card.breakdown.length > 0 ? (
          <div className="flex items-baseline gap-4">
            {card.breakdown.map((item, i) => (
              <div key={i} className="flex flex-col leading-none">
                <span className={`text-2xl font-bold ${resolveColor(item.color)}`}>
                  {item.value}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted mt-1">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className={`text-2xl font-bold ${valueColor} leading-none`}>{card.value}</span>
        )}
        {card.sub && (
          <p className="text-[11px] text-muted mt-2 leading-tight truncate">{card.sub}</p>
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
