function Chip({ children, variant }: { children: React.ReactNode; variant: 'teal' | 'amber' | 'purple' }) {
  const styles = {
    teal: 'bg-[#2dd4bf]/15 text-[#2dd4bf]',
    amber: 'bg-[#f59e0b]/15 text-[#f59e0b]',
    purple: 'bg-[#a78bfa]/15 text-[#a78bfa]',
  };
  return (
    <code className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-medium ${styles[variant]}`}>
      {children}
    </code>
  );
}

function SpecSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-white mb-2">{title}</h4>
      <div className="text-xs text-muted leading-relaxed space-y-1.5">{children}</div>
    </div>
  );
}

export default function AutomationSpec() {
  return (
    <div>
      <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">
        Automation Spec
      </h2>
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <SpecSection title="Workshop Purchase">
            <p>On purchase, GHL creates contact and fires <Chip variant="teal">contact.created</Chip> webhook.</p>
            <p>Tag <Chip variant="teal">workshop-buyer</Chip> is added automatically by GHL workflow.</p>
            <p>Workshop cohort is set from <Chip variant="purple">workshop_cohort</Chip> custom field.</p>
            <p>Revenue: <Chip variant="amber">$97</Chip> per workshop sale.</p>
          </SpecSection>

          <SpecSection title="Zoom Attendance">
            <p>Zoom fires <Chip variant="teal">webinar.participant_left</Chip> when attendee leaves.</p>
            <p>System matches by email and sets <Chip variant="purple">attended_workshop</Chip> = true.</p>
            <p>Duration &gt; 45 min marks contact as <Chip variant="teal">high_intent</Chip>.</p>
            <p>No-shows get tagged <Chip variant="teal">workshop-noshow</Chip> via GHL.</p>
          </SpecSection>

          <SpecSection title="Deposit + Call Booking">
            <p>Tag <Chip variant="teal">deposit-paid</Chip> triggers $500 deposit tracking.</p>
            <p>Tag <Chip variant="teal">call-booked</Chip> records interview scheduling.</p>
            <p>Ghost rate = deposited who never book a call.</p>
            <p>Deposit amount: <Chip variant="amber">$500</Chip> per deposit.</p>
          </SpecSection>

          <SpecSection title="Call Outcome + Close">
            <p>GHL <Chip variant="teal">opportunity.stage_changed</Chip> updates disposition.</p>
            <p>Stages: Sold, Follow-up, Not a Fit, No-show.</p>
            <p>Tag <Chip variant="teal">prime-elite-member</Chip> finalizes conversion.</p>
            <p>MRR per close: <Chip variant="amber">$2,500/mo</Chip>.</p>
          </SpecSection>

          <SpecSection title="UTM Tracking (Required)">
            <p><Chip variant="amber">utm_source</Chip> → lead_source (FB Ad, IG Ad, Email, etc.)</p>
            <p><Chip variant="amber">utm_campaign</Chip> → campaign identifier</p>
            <p><Chip variant="amber">utm_content</Chip> → creative / variation</p>
            <p><Chip variant="amber">utm_medium</Chip> → channel (paid, organic, email, partner)</p>
          </SpecSection>

          <SpecSection title="Metrics to Alert On">
            <p>Show rate drops below <Chip variant="amber">70%</Chip> → review reminder sequence.</p>
            <p>Ghost rate exceeds <Chip variant="amber">20%</Chip> → deposit→call flow issue.</p>
            <p>Close rate below <Chip variant="amber">30%</Chip> → review call script / rep training.</p>
            <p>Stale follow-ups &gt; <Chip variant="amber">14 days</Chip> → trigger re-engagement.</p>
          </SpecSection>
        </div>
      </div>
    </div>
  );
}
