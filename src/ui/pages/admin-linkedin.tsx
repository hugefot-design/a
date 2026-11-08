/**
 * Admin → LinkedIn: velg bransje og/eller fylke, få en ferdig tekst med ukens største nye anbud,
 * kopier og post selv. Lenken i teksten måles under Besøk (utm_source=linkedin).
 */
import { LuCopy } from 'react-icons/lu';
import type { LinkedinPost } from '@/domain/admin/linkedin';
import { INDUSTRIES, REGIONS } from '@/domain/reference';
import { buttonVariants, cn, PageHeader, Panel, PanelHeader } from '../components';
import { AdminShell } from '../layouts';

export function AdminLinkedinPage({
  industry,
  region,
  post,
  topics,
}: {
  industry: string | null;
  region: string | null;
  post: LinkedinPost;
  topics: { id: string; name: string; n: number }[];
}) {
  return (
    <AdminShell>
      <PageHeader
        title="Ukens anbud til LinkedIn"
        description="Ferdig tekst med ukens største nye anbud, laget fra offentlige kunngjøringer. Kopier, se over og post selv – lenken måles under Besøk."
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="min-w-0">
          <PanelHeader title="Lag tekst" description={`Gjelder ${post.topic}.`} />
          <div className="p-5">
            <form method="get" action="/admin/linkedin" className="flex flex-wrap items-end gap-3">
              <label className="min-w-[12rem] flex-1 text-[13px] font-semibold text-ink">
                Bransje
                <select name="bransje" defaultValue={industry ?? ''} className="field-input mt-1.5">
                  <option value="">Alle bransjer</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-[12rem] flex-1 text-[13px] font-semibold text-ink">
                Fylke
                <select name="fylke" defaultValue={region ?? ''} className="field-input mt-1.5">
                  <option value="">Hele landet</option>
                  {REGIONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={buttonVariants({ variant: 'primary' })}>
                Lag tekst
              </button>
            </form>

            {post.count ? (
              <div className="mt-6">
                <label htmlFor="linkedin-tekst" className="block text-[13px] font-semibold text-ink">
                  Tekst ({post.count === 1 ? '1 nytt anbud' : `${post.count} nye anbud`} siste 7 dager)
                </label>
                <textarea id="linkedin-tekst" readOnly rows={18} className="field-input mt-1.5 font-mono text-[13px] leading-relaxed" value={post.text} />
                <button type="button" data-copy={post.text} className={cn(buttonVariants({ variant: 'signal' }), 'mt-3')}>
                  <LuCopy className="size-4" aria-hidden /> <span data-label>Kopier teksten</span>
                </button>
                <p className="mt-3 text-[12px] text-muted">
                  Les gjennom før du poster. Verdiene er oppdragsgivers anslag fra kunngjøringen, og fristene er norsk tid.
                </p>
              </div>
            ) : (
              <p className="mt-6 rounded-xl border border-dashed border-line-strong p-5 text-[14px] text-muted">
                Ingen nye åpne anbud siste 7 dager for dette valget. Prøv hele landet eller en annen bransje.
              </p>
            )}
          </div>
        </Panel>
        <Panel className="min-w-0">
          <PanelHeader title="Flest nye denne uken" description="Gode emner for ukens innlegg." />
          {topics.length ? (
            <ul className="divide-y divide-line">
              {topics.map((t) => (
                <li key={t.id}>
                  <a href={`/admin/linkedin?bransje=${t.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px] text-strong no-underline hover:bg-cream">
                    <span className="truncate">{t.name}</span>
                    <span className="num font-semibold">{t.n}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 text-[13px] text-muted">Ingen nye anbud siste 7 dager.</p>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
