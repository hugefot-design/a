/**
 * «Slik regner vi» (/metode, bare norsk): reglene bak treffpoeng, merkingen av grunnlag, ordsøket etter krav og
 * vilkår, markedspris, lønnsomhet og kontraktsutløp – og det vi ikke vet.
 *
 * Tallene hentes fra de samme konstantene som koden bruker (SCORE_PARTS, SCORE_CAPS, MIN_COMPARABLES osv.), og
 * testene sjekker at beskrivelsen stemmer med motoren. Ingen nye påstander: står det her, gjør koden det.
 */
import type { ReactNode } from 'react';
import { LuArrowRight } from 'react-icons/lu';
import { BASIS_LEGEND } from '@/domain/intelligence/basis';
import { QUICK_GOOD } from '@/domain/matching/quick';
import { SCORE_CAPS, SCORE_PARTS } from '@/domain/matching/engine';
import { SENSITIVITY_STEPS } from '@/domain/profit/calculator';
import { MAX_AGE_YEARS, MIN_COMPARABLES, SOLID_COMPARABLES } from '@/domain/profit/market';
import { TERM_LABELS } from '@/domain/profit/terms-scan';
import { sourcesText } from '@/i18n';
import { useUi } from '../context';
import { PublicLayout } from '../layouts';
import { NightHero, SignalCta, Wrap } from '../site';

const PARTS: [id: string, title: string][] = [
  ['kilder', 'Kildene'],
  ['treff', 'Treffpoeng 0–100'],
  ['grunnlag', 'Hva hvert punkt bygger på'],
  ['krav', 'Krav, avvisning og kostbare vilkår'],
  ['markedspris', 'Markedspris fra tidligere tildelinger'],
  ['kalkyle', 'Lønnsomhet'],
  ['utlop', 'Kontrakter som utløper'],
  ['ai', 'AI'],
  ['vet-ikke', 'Det vi ikke vet'],
];

function Part({ id, children }: { id: string; children: ReactNode }) {
  const title = PARTS.find(([p]) => p === id)![1];
  return (
    <section id={id} aria-labelledby={`${id}-tittel`} className="scroll-mt-24 border-t border-line pt-10 first:border-0 first:pt-0">
      <h2 id={`${id}-tittel`} className="text-[24px] font-[760] leading-tight tracking-[-0.02em] text-strong sm:text-[28px]">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[16px] leading-relaxed text-ink">{children}</div>
    </section>
  );
}

const List = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1.5 pl-5 marker:text-muted">{children}</ul>;

export function MethodPage() {
  const { m, liveSources, aiConfigured, aiIsMock, publicTools, user } = useUi();
  const sources = sourcesText(m, liveSources);
  const aiReal = aiConfigured && !aiIsMock;
  return (
    <PublicLayout>
      <NightHero
        eyebrow="Åpen metode"
        title="Slik regner vi."
        lead="Alt AnbudRadar viser, bygger på offentlige kunngjøringer, publiserte tildelinger og tallene dere selv legger inn. Her er reglene – de samme for alle."
      />
      <section className="bg-surface py-14 sm:py-20">
        <Wrap className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="Innhold" className="h-fit lg:sticky lg:top-24">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted">Innhold</p>
            <ol className="mt-3 flex flex-wrap gap-2 lg:block lg:space-y-1.5">
              {PARTS.map(([id, title]) => (
                <li key={id}>
                  <a href={`#${id}`} className="block rounded-full border border-line px-3 py-1.5 text-[14px] font-medium text-strong no-underline hover:border-strong lg:rounded-lg lg:border-0 lg:px-0 lg:py-0.5 lg:hover:underline">
                    {title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="min-w-0 max-w-3xl space-y-10">
            <Part id="kilder">
              <p>
                Kunngjøringene kommer fra {sources} og hentes flere ganger i døgnet. Tildelingene – hvem som vant og hva kontrakten ble tildelt for – kommer fra de samme
                kildene.
              </p>
              <List>
                <li>Vi leser kunngjøringsteksten. Konkurransegrunnlaget (vedleggene) hentes ikke automatisk. I appen kan dere laste det opp, og da leses det også – med sidetall.</li>
                <li>Norske kunngjøringer i TED er ofte på engelsk. Teksten vises slik kilden publiserer den.</li>
                <li>E-postadresser og telefonnumre i kunngjøringene skjules på de offentlige sidene.</li>
              </List>
            </Part>

            <Part id="treff">
              <p>
                Poengsummen viser hvor godt anbudet passer bedriften – <strong>ikke sjansen for å vinne</strong>. Den regnes ut med faste regler, uten AI: samme profil og
                samme kunngjøring gir alltid samme svar. {QUICK_GOOD} eller mer regnes som et godt treff.
              </p>
              <div className="scroll-x rounded-2xl border border-line">
                <table className="w-full text-[14.5px] normal-nums">
                  <caption className="sr-only">Delene i poengsummen</caption>
                  <thead>
                    <tr className="border-b border-line bg-cream text-left text-[13px] text-muted">
                      <th scope="col" className="rounded-tl-2xl px-4 py-2.5 font-semibold">
                        Del
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                        Maks
                      </th>
                      <th scope="col" className="rounded-tr-2xl px-4 py-2.5 font-semibold">
                        Slik gis poengene
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {SCORE_PARTS.map((p) => (
                      <tr key={p.key} className="border-b border-line align-top last:border-0">
                        <th scope="row" className="px-4 py-3 text-left font-semibold text-strong">
                          {p.label}
                        </th>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-strong">{p.max}</td>
                        <td className="px-4 py-3 text-ink">{p.rule}</td>
                      </tr>
                    ))}
                    <tr className="bg-cream">
                      <th scope="row" className="rounded-bl-2xl px-4 py-3 text-left font-semibold text-strong">
                        Til sammen
                      </th>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-strong">{SCORE_PARTS.reduce((sum, p) => sum + p.max, 0)}</td>
                      <td className="rounded-br-2xl px-4 py-3" />
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>Søkeord alene skal aldri gi høy score, og mulige hindringer skal trekke ned. Derfor har poengsummen tak:</p>
              <List>
                {SCORE_CAPS.map((c) => (
                  <li key={c.text}>
                    {c.text}: maks {c.max}.
                  </li>
                ))}
                <li>Utenfor landene dere dekker, eller fristen har gått ut: maks 20.</li>
                <li>Det dere har sagt nei takk til (CPV-koder og ord), vises ikke.</li>
              </List>
              <p>
                Hvert treff viser hvorfor det passer, hva som mangler og hvor sikker vurderingen er. I «Prøv uten konto» brukes bare bransje, fylke og ordene dere skriver – derfor
                kan tallet bli et annet i appen, der godkjenninger, kontraktsstørrelse og det dere ikke vil ha også teller.
              </p>
            </Part>

            <Part id="grunnlag">
              <p>Hvert punkt i en vurdering er merket med hva det bygger på:</p>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {BASIS_LEGEND.map((b) => (
                  <div key={b.key} className="rounded-2xl bg-cream px-4 py-3">
                    <dt className="text-[15px] font-semibold text-strong">{b.label}</dt>
                    <dd className="mt-0.5 text-[14.5px] text-muted">{b.title}.</dd>
                  </div>
                ))}
              </dl>
              <p>Til slutt i hver vurdering står «Det vi ikke vet sikkert»: hva som ikke er lest, hva som mangler i profilen og hva som er usikkert.</p>
            </Part>

            <Part id="krav">
              <p>
                Teksten søkes gjennom etter formuleringer som pleier å bety avvisning, minstekrav, kvalifikasjonskrav og befaring – og etter vilkår som koster penger:{' '}
                {Object.values(TERM_LABELS)
                  .map((l) => l.toLowerCase())
                  .join(', ')}
                .
              </p>
              <List>
                <li>Funnene vises ordrett, med ordet som ga treffet uthevet. Vi skriver ikke om og legger ikke til noe.</li>
                <li>Står det at et vilkår ikke gjelder («ingen dagbøter»), regnes det ikke som et funn.</li>
                <li>Ordsøk finner ikke alt. Les alltid hele konkurransegrunnlaget før dere leverer.</li>
              </List>
            </Part>

            <Part id="markedspris">
              <p>
                Vi finner tildelte kontrakter med samme CPV-kode – så presist som grunnlaget tillater: først fem sifre, så fire, så tre – og viser hva de ble tildelt for.
              </p>
              <List>
                <li>Bare ekte verdier fra tildelingskunngjøringer. Ingen anslag og ingen utfylling.</li>
                <li>
                  Holdes utenfor: rammeavtaler (verdien er ofte et tak), annen valuta (vi regner ikke om), tildelinger eldre enn {MAX_AGE_YEARS} år og eksempeldata. Samme vinner fra
                  både TED og Doffin telles én gang.
                </li>
                <li>
                  Med færre enn {MIN_COMPARABLES} tildelinger viser vi ingen statistikk. Med færre enn {SOLID_COMPARABLES} står det at grunnlaget er tynt.
                </li>
                <li>Vi viser median og midterste halvdel. Svært store eller små verdier kan skjules i grafen, men telles med.</li>
              </List>
              <p>Det er en pekepinn på prisnivået, ikke en fasit: omfang, kvalitetskrav og opsjoner varierer fra kontrakt til kontrakt.</p>
            </Part>

            <Part id="kalkyle">
              <p>Lønnsomheten regnes bare med tallene dere legger inn:</p>
              <dl className="space-y-2 rounded-2xl border border-line p-4 text-[15px] sm:p-5">
                {(
                  [
                    ['Direkte kostnader', 'summen av kostnadslinjene (mengde × enhetskost)'],
                    ['Indirekte kostnader', 'direkte kostnader × påslag (%)'],
                    ['Selvkost', 'direkte + indirekte kostnader – prisen der dere går i null'],
                    ['Risikopåslag', 'selvkost × risiko (%) – i appen'],
                    ['Målpris', '(selvkost + risikopåslag) ÷ (1 − ønsket margin)'],
                    ['Minstepris', '(selvkost + risikopåslag) ÷ (1 − minstemargin) – i appen'],
                    ['Margin ved kontraktsverdien', '(kontraktsverdi − selvkost) ÷ kontraktsverdi'],
                    ['Følsomhet', `det samme med ${SENSITIVITY_STEPS.join(', ')} % høyere kostnader`],
                  ] as const
                ).map(([term, def]) => (
                  <div key={term} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                    <dt className="shrink-0 font-semibold text-strong sm:w-56">{term}</dt>
                    <dd className="text-ink">{def}</dd>
                  </div>
                ))}
              </dl>
              <List>
                <li>Margin regnes av prisen, ikke av kostnaden: 10 % margin på 1 000 000 kr i kostnader gir en pris på 1 111 111 kr.</li>
                <li>
                  Kontraktsverdien fra kunngjøringen er oppdragsgivers anslag og merkes slik. For rammeavtaler er den ofte et tak – ikke garantert omsetning.
                </li>
                <li>I appen regnes også kostbare vilkår fra dokumentene (dagbøter, betalingsfrist, garantier) om til kroner, og kapasiteten sjekkes.</li>
                <li>Kalkylen sier ingenting om hvilken pris som vinner.</li>
              </List>
              {publicTools ? (
                <p>
                  <a href="/kalkulator" className="inline-flex items-center gap-1.5 font-semibold">
                    Prøv lønnsomhetssjekken <LuArrowRight className="size-4" aria-hidden />
                  </a>
                </p>
              ) : null}
            </Part>

            <Part id="utlop">
              <p>
                Sluttdatoen er enten oppgitt i kunngjøringen, eller regnet ut fra oppstart (eller tildelingsdato) pluss varighet. Hva den bygger på, står ved hver kontrakt.
              </p>
              <List>
                <li>Opsjoner (forlengelser) står sjelden i dataene, så en kontrakt kan vare lenger enn anslått.</li>
                <li>Kontrakter uten sluttdato eller varighet gjettes ikke, og er ikke med.</li>
                <li>På de offentlige sidene vises ikke hvem som har kontrakten i dag. Det står i appen.</li>
              </List>
            </Part>

            <Part id="ai">
              {aiReal ? (
                <>
                  <p>
                    AI brukes til sammendrag, spørsmål om anbudet og utkast til tekst – og alt den lager, er merket «AI-vurdering». Hvert svar skal vise til stedet i teksten det
                    bygger på, og sitater som ikke finnes ordrett i kilden, merkes.
                  </p>
                  <p>Treffpoeng, ordsøk, markedspris og lønnsomhet regnes uten AI.</p>
                </>
              ) : (
                <p>AI er ikke slått på ennå. Alt på denne siden virker uten AI: reglene er faste, og ingenting er generert.</p>
              )}
            </Part>

            <Part id="vet-ikke">
              <List>
                <li>Sjansen for å vinne. Poengsummen og kalkylen sier ingenting om hva konkurrentene byr.</li>
                <li>Det som står i dokumenter vi ikke har lest. Uten opplastede dokumenter er bare kunngjøringen lest.</li>
                <li>Hva oppdragsgiver faktisk kommer til å kjøpe på en rammeavtale.</li>
                <li>Anbud som ikke er kunngjort i {sources}.</li>
              </List>
            </Part>
          </div>
        </Wrap>
      </section>
      <SignalCta
        title="Se reglene i bruk."
        lead="Et ekte, åpent anbud vurdert med appens regler – eller deres egen bransje, uten konto."
        primary={{ href: '/eksempel', label: 'Se et ekte eksempel' }}
        secondary={publicTools ? { href: '/prov', label: 'Prøv uten konto' } : user ? { href: '/app', label: 'Til appen' } : { href: '/registrer', label: 'Start gratis' }}
      />
    </PublicLayout>
  );
}
