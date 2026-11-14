/**
 * Hva hvert punkt i vurderingen bygger på – finere enn de tre grunnformene (fakta, beregning, AI), så kunden ser
 * forskjell på det som står i kunngjøringen, det som står i dokumentene, publiserte tildelinger, deres egne data,
 * beregninger og AI-vurderinger. Og én samlet liste over det vi ikke vet (usikkerhet).
 *
 * Rene funksjoner – brukes av siden, PDF-en og testene.
 */
import type { Basis, IntelligenceReport, SourceRef } from './types';

export type BasisKey = 'notice' | 'document' | 'award' | 'own' | 'fact' | 'calculation' | 'ai';

export interface BasisLabel {
  key: BasisKey;
  /** Kort merke («Fra kunngjøringen»). */
  label: string;
  /** Forklaring (verktøytips og PDF). */
  title: string;
  /** Grunnformen – styrer fargen. */
  basis: Basis;
}

const LABELS: Record<BasisKey, Omit<BasisLabel, 'key'>> = {
  notice: { label: 'Fra kunngjøringen', title: 'Står i den offentlige kunngjøringen – lenke til kilden følger med', basis: 'fact' },
  document: { label: 'Fra dokumentene', title: 'Står i konkurransedokumentene dere har lastet opp – med side', basis: 'fact' },
  award: { label: 'Fra tildelinger', title: 'Publiserte tildelinger i TED og Doffin', basis: 'fact' },
  own: { label: 'Deres data', title: 'Fra bedriftsprofilen, kalkylen eller resultatene deres', basis: 'fact' },
  fact: { label: 'Fakta', title: 'Opplysninger fra kilden eller deres egne data', basis: 'fact' },
  calculation: { label: 'Beregning', title: 'Regnet ut av AnbudRadar fra fakta – ikke et anslag fra AI', basis: 'calculation' },
  ai: { label: 'AI-vurdering', title: 'Vurdert av AI – kontroller mot kilden', basis: 'ai' },
};

/** Merket for ett punkt: grunnformen, presisert med kilden når den finnes. */
export function basisLabel(basis: Basis, source?: SourceRef | null): BasisLabel {
  if (basis === 'fact' && source && source.kind !== 'ai') return { key: source.kind, ...LABELS[source.kind] };
  const key: BasisKey = basis === 'fact' ? 'fact' : basis;
  return { key, ...LABELS[key] };
}

/** Alle merkene, i den rekkefølgen forklaringen viser dem. */
export const BASIS_LEGEND: BasisLabel[] = (['notice', 'document', 'award', 'own', 'calculation', 'ai'] as BasisKey[]).map((key) => ({ key, ...LABELS[key] }));

/**
 * Det vi ikke vet sikkert – samlet på ett sted, så ingen tror vurderingen er mer sikker enn den er.
 * Bygger bare på rapporten (ingen nye anslag).
 */
export function uncertaintyList(r: Pick<IntelligenceReport, 'tender' | 'fit' | 'risk' | 'profit' | 'competition' | 'learning' | 'ai'>): string[] {
  const out: string[] = [];
  const add = (s: string | null | false | undefined) => {
    if (s && !out.includes(s)) out.push(s);
  };
  // Hva som er lest
  add(r.risk.read.noticeOnly && 'Bare kunngjøringen er lest. Konkurransegrunnlaget har som regel flere krav, frister og vilkår.');
  if (r.risk.read.notReadable.length) add(`Kunne ikke lese: ${r.risk.read.notReadable.slice(0, 3).join(', ')}${r.risk.read.notReadable.length > 3 ? ' m.fl.' : ''} (f.eks. skannet PDF uten tekst).`);
  if (r.ai.mode === 'mock') add('AI-svarene her er simulert (testmodus) – de er ikke en ekte vurdering.');
  else if (!r.ai.used) add('Ingen AI er brukt: kravene er funnet med ordsøk, som finner ord – ikke betydning. Krav skrevet med andre ord kan mangle.');
  // Kunngjøringen
  add(r.tender.deadlineAt && !r.tender.deadlineTimeKnown && 'Klokkeslettet for fristen er ikke oppgitt i kunngjøringen.');
  add(!r.tender.deadlineAt && 'Fristen er ikke oppgitt i dataene vi har. Sjekk kunngjøringen hos kilden.');
  add(r.tender.estimatedValue === null && 'Oppdragsgiver har ikke oppgitt anslått verdi.');
  // Treff mot profilen
  if (r.fit.availability === 'no_profile') add('Bedriftsprofilen mangler, så treffet mot bedriften er ikke regnet ut.');
  for (const reason of r.fit.uncertainty?.reasons ?? []) add(reason.endsWith('.') ? reason : `${reason}.`);
  if (r.fit.turnover && r.fit.turnover.ok === null) add('Omsetningen deres er ikke lagt inn, så omsetningskravet kan ikke sjekkes.');
  // Lønnsomhet
  add(r.profit.availability === 'no_costs' && 'Kostnadene er ikke lagt inn, så selvkost, minstepris og margin er ikke regnet ut.');
  if (r.profit.availability !== 'locked' && r.profit.market) {
    add(r.profit.market.strength === 'few' && `Få sammenlignbare tildelinger (${r.profit.market.n}) – markedsprisen er bare en pekepinn.`);
    add(r.profit.market.strength === 'none' && 'For få publiserte tildelinger til å si noe om markedsprisen.');
  }
  if (r.profit.calc?.completeness.aiLines) add(`${r.profit.calc.completeness.aiLines} mengder i kalkylen er AI-estimater – kontroller dem.`);
  // Konkurranse og læring
  if (r.competition.availability === 'ok' && !r.competition.buyer?.contracts && !r.competition.similar?.contracts) add('Ingen publiserte tildelinger fra oppdragsgiveren eller for lignende kontrakter.');
  add(r.learning.sameBuyer.delivered + r.learning.similar.delivered < r.learning.minDecided && 'For få avgjorte tilbud til at egne resultater påvirker vurderingen.');
  // AI
  const unverified = [...r.risk.contractFindings, ...(r.risk.ai?.points ?? []), ...(r.fit.ai?.unfulfilled ?? [])].filter((p) => p.source?.kind === 'ai' && p.source.verified === false).length;
  add(unverified > 0 && `${unverified} AI-påstander har sitat som ikke ble funnet ordrett i kilden.`);
  return out.slice(0, 12);
}
