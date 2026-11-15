/**
 * Oversikten over oppdragsgivere (/oppdragsgivere, bare norsk): de som har en side med nok innhold til å stå i
 * nettstedskartet – minst ett åpent anbud og minst BUYER_MIN_NOTICES anbud og tildelinger siste 12 måneder.
 * Ingen tynne sider. Alfabetisk, med hopp til forbokstaven.
 */
import { BUYER_MIN_NOTICES, type BuyerIndexEntry } from '@/domain/tenders/buyer-page';
import { PublicLayout } from '../layouts';
import { NightHero, Wrap } from '../site';

/** Forbokstaven en oppdragsgiver sorteres under («Æ», «Ø» og «Å» for seg; tall og tegn under «#»). */
export function initialOf(name: string): string {
  const c = name.trim().charAt(0).toLocaleUpperCase('nb-NO');
  return /\p{L}/u.test(c) ? c : '#';
}

const anchor = (letter: string) => `bokstav-${letter === '#' ? 'tall' : letter.toLowerCase()}`;

export function BuyersIndexPage({ buyers }: { buyers: BuyerIndexEntry[] }) {
  const groups = new Map<string, BuyerIndexEntry[]>();
  for (const b of buyers) {
    const k = initialOf(b.name);
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const open = buyers.reduce((n, b) => n + b.open, 0);
  return (
    <PublicLayout>
      <NightHero
        eyebrow="Oppdragsgivere"
        title="Hvem kjøper hva?"
        lead={
          buyers.length
            ? `${buyers.length.toLocaleString('nb-NO')} offentlige oppdragsgivere med til sammen ${open.toLocaleString('nb-NO')} åpne anbud akkurat nå. Se hva hver av dem kjøper mest, de åpne anbudene og kontraktene som snart utløper – og følg dem på e-post, uten konto.`
            : 'Her kommer oppdragsgiverne som har åpne anbud akkurat nå.'
        }
      />
      <section className="bg-surface py-12 sm:py-16">
        <Wrap>
          {buyers.length ? (
            <>
              <nav aria-label="Hopp til forbokstav" className="flex flex-wrap gap-1.5">
                {[...groups.keys()].map((k) => (
                  <a
                    key={k}
                    href={`#${anchor(k)}`}
                    className="inline-flex size-10 items-center justify-center rounded-full border border-line text-[15px] font-semibold text-strong no-underline hover:border-strong"
                  >
                    {k}
                  </a>
                ))}
              </nav>
              <div className="mt-10 space-y-10">
                {[...groups.entries()].map(([k, list]) => (
                  <section key={k} aria-labelledby={anchor(k)}>
                    <h2 id={anchor(k)} className="scroll-mt-24 border-b border-line pb-2 text-[22px] font-[760] text-strong">
                      {k}
                    </h2>
                    <ul className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                      {list.map((b) => (
                        <li key={b.path} className="flex items-baseline justify-between gap-3 border-b border-line/70 py-2.5">
                          <span className="min-w-0">
                            <a href={b.path} className="font-semibold text-strong [overflow-wrap:anywhere]">
                              {b.name}
                            </a>
                            {b.city ? <span className="block text-[13px] text-muted">{b.city}</span> : null}
                          </span>
                          <span className="shrink-0 text-[13.5px] tabular-nums text-muted">
                            {b.open.toLocaleString('nb-NO')} {b.open === 1 ? 'åpent' : 'åpne'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <p className="rounded-2xl border border-dashed border-line-strong p-6 text-[15px] text-muted">Ingen oppdragsgivere å vise akkurat nå.</p>
          )}
          <p className="mt-12 max-w-3xl text-[13.5px] leading-relaxed text-muted">
            Med her er oppdragsgivere med norsk organisasjonsnummer, minst ett åpent anbud og minst {BUYER_MIN_NOTICES} anbud og tildelinger siste 12 måneder. Fra
            kunngjøringene i Doffin og TED, oppdateres flere ganger i døgnet. Navnene står slik kunngjøringene skriver dem.{' '}
            <a href="/metode" className="font-semibold">
              Slik regner vi
            </a>
          </p>
        </Wrap>
      </section>
    </PublicLayout>
  );
}
