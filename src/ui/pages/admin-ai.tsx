/**
 * Admin → AI-bruk: kostnad per funksjon og organisasjon denne måneden, gjenbruk fra hurtigbufferen og hva det sparte,
 * og hvor mye leverandøren leste fra sin egen buffer. Vises over listen med de siste AI-kallene.
 */
import type { AiCostRow, AiCostSummary } from '@/domain/ai/costs';
import { Panel, PanelHeader, Stat } from '../components';
import { Table } from './admin';

const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)} %`);

function rows(list: AiCostRow[]) {
  return list.map((r) => [r.label, String(r.calls), String(r.hits), String(r.escalations), usd(r.costUsd), usd(r.savedUsd)]);
}

export function AiCostPanels({ s }: { s: AiCostSummary }) {
  const head = ['', 'Nye svar', 'Gjenbrukt', 'Laget på nytt med kvalitetsmodellen', 'Kostnad', 'Spart'];
  return (
    <div className="mb-6 space-y-6">
      <Panel>
        <PanelHeader
          title={`AI-kostnad ${s.period}`}
          description="Nye svar teller mot kundenes kvote. Gjenbrukte svar (samme kilder og spørsmål) koster ingenting og teller ikke. «Spart» er hva de gjenbrukte svarene kostet å lage første gang."
        />
        <div className="grid grid-cols-2 gap-5 px-5 pb-5 sm:grid-cols-4">
          <Stat label="Kostnad" value={usd(s.totals.costUsd)} hint={`${s.totals.calls} nye svar`} />
          <Stat label="Spart ved gjenbruk" value={usd(s.totals.savedUsd)} hint={`${s.totals.hits} gjenbrukte svar`} />
          <Stat label="Andel gjenbrukt" value={pct(s.totals.hitRate)} hint="av alle forespørsler" />
          <Stat
            label="Lest fra leverandørens buffer"
            value={pct(s.promptCache.readShare)}
            hint={`${Math.round(s.promptCache.cacheReadTokens).toLocaleString('nb-NO')} av ${Math.round(s.promptCache.inputTokens).toLocaleString('nb-NO')} inn-tokens`}
          />
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Per funksjon" />
        <Table head={head} rows={rows(s.byFeature)} />
      </Panel>
      <Panel>
        <PanelHeader title="Per organisasjon (de 15 dyreste)" />
        <Table head={head} rows={rows(s.byOrg)} />
      </Panel>
    </div>
  );
}
