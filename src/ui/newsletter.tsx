/**
 * Påmelding til ukesbrevet «Ukens anbud» (bare norsk). Bransje og fylke kan være gitt av siden
 * (f.eks. vakthold i Trøndelag) eller velges i skjemaet. Virker uten JavaScript.
 */
import { LuMail } from 'react-icons/lu';
import { INDUSTRIES, INDUSTRY_BY_ID, REGION_BY_CODE, REGIONS } from '@/domain/reference';
import { cn, CsrfField } from './components';

export function NewsletterSignup({
  industry,
  region,
  sourcePath,
  className,
}: {
  industry?: string | null;
  region?: string | null;
  sourcePath: string;
  className?: string;
}) {
  const industryName = industry ? INDUSTRY_BY_ID.get(industry)?.name : null;
  const county = region ? REGION_BY_CODE.get(region)?.name : null;
  // «Bygg og anlegg» → «bygg og anlegg», men «IT og programvare» beholdes.
  const lower = (n: string) => (/^[A-ZÆØÅ]{2,}\b/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1));
  const topic = industryName ? `${lower(industryName)}${county ? ` i ${county}` : ''}` : county ? `i ${county}` : null;
  return (
    <form method="post" action="/ukesbrev" className={cn('relative rounded-3xl border border-line bg-cream p-6', className)}>
      <CsrfField />
      <input type="hidden" name="kilde" value={sourcePath} />
      <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
        <LuMail className="size-4" aria-hidden /> Gratis, uten konto
      </p>
      <p className="mt-2 text-[18px] font-[720] leading-snug text-strong">Få ukens nye anbud på e-post</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
        Hver mandag: nye offentlige anbud{topic ? ` – ${topic}` : ''}. Meld deg av med ett klikk.
      </p>
      <div className="mt-4 space-y-2.5">
        {industry ? (
          <input type="hidden" name="bransje" value={industry} />
        ) : (
          <>
            <label htmlFor="nl-bransje" className="sr-only">
              Bransje
            </label>
            <select id="nl-bransje" name="bransje" required className="field-input" defaultValue="">
              <option value="" disabled>
                Velg bransje
              </option>
              {INDUSTRIES.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </>
        )}
        {region ? (
          <input type="hidden" name="fylke" value={region} />
        ) : (
          <>
            <label htmlFor="nl-fylke" className="sr-only">
              Fylke
            </label>
            <select id="nl-fylke" name="fylke" className="field-input" defaultValue="">
              <option value="">Hele landet</option>
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="nl-epost" className="sr-only">
          E-postadresse
        </label>
        <input id="nl-epost" name="email" type="email" required autoComplete="email" placeholder="navn@firma.no" className="field-input" />
        {/* Felle for roboter: usynlig for mennesker og skjermlesere. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
          <label>
            Nettside
            <input name="nettside" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <button type="submit" className="btn-signal w-full">
          Meld meg på
        </button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Vi sender en e-post du må bekrefte først. Adressen brukes bare til ukesbrevet. <a href="/personvern#formal">Personvern</a>
      </p>
    </form>
  );
}
