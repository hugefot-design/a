import type { Journey } from '@/domain/admin/journey';
import { cn, PageHeader, Panel, PanelHeader } from '../components';
import { AdminShell } from '../layouts';
import { FunnelBars } from '../charts';
import { formatInt } from '../format';

const PERIODS: { days: number | null; label: string; param: string }[] = [
  { days: 30, label: 'Siste 30 dager', param: '30' },
  { days: 90, label: 'Siste 90 dager', param: '90' },
  { days: null, label: 'Alle', param: 'alle' },
];

export function AdminJourneyPage({ j }: { j: Journey }) {
  const first = j.steps[0]!.n;
  const drop = j.biggestDrop;
  const from = drop !== null ? j.steps[drop - 1]! : null;
  const to = drop !== null ? j.steps[drop]! : null;
  return (
    <AdminShell>
      <PageHeader
        title="Kundereisen"
        description="Hvor mange av dem som registrerte seg, kom videre til hvert steg – og hvor de faller fra. Bare antall, ingen personopplysninger."
      />
      <nav aria-label="Periode" className="mb-5 flex flex-wrap gap-2">
        {PERIODS.map((p) => {
          const active = p.days === j.days;
          return (
            <a
              key={p.param}
              href={`/admin/kundereise?periode=${p.param}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold no-underline',
                active ? 'border-strong bg-strong text-surface' : 'border-line-strong bg-surface text-strong hover:border-strong',
              )}
            >
              {p.label}
            </a>
          );
        })}
      </nav>
      <Panel className="mb-6">
        <PanelHeader
          title={first ? `${formatInt(first)} registrerte seg` : 'Ingen registrerte seg i perioden'}
          description="Hvert steg telles for seg. «Av første» er andelen av dem som registrerte seg."
        />
        {first && from && to ? (
          <p className="border-b border-line px-5 py-3 text-[14px] text-ink">
            <strong>Største frafall:</strong> fra «{from.label}» til «{to.label}» – {formatInt(from.n - to.n)} av {formatInt(from.n)} kom ikke videre.
          </p>
        ) : null}
        <FunnelBars steps={j.steps} emphasize={drop} caption="Kundereisen: antall per steg" />
      </Panel>
      <p className="text-[13px] text-muted">
        Ikke med: administratorer og alle i organisasjoner som eies av en administrator (egne tester). En kunde kan lagre et anbud
        uten å ha fått treff, så stegene telles hver for seg.
      </p>
    </AdminShell>
  );
}
