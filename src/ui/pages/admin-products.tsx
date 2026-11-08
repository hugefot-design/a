import { PRODUCT_GROUPS, minPlanName, productState, type AdminProductContext } from '@/domain/admin/products';
import { Alert, Badge, PageHeader, Panel, PanelHeader } from '../components';
import { AdminShell } from '../layouts';

const TONE = { ok: 'ok', demo: 'marker', setup: 'urgent' } as const;

export function AdminProductsPage({ c }: { c: AdminProductContext }) {
  const s = { aiOn: c.aiOn, adminAccess: Boolean(c.org), stripe: c.stripe, storage: c.storage };
  return (
    <AdminShell>
      <PageHeader
        title="Produkter"
        description="Alt kundene får i AnbudRadar, med lenke rett inn i appen. Din egen organisasjon har alle funksjoner uten betaling, så du kan prøve alt selv."
      />
      {c.org ? (
        <Alert tone="info" title={`Admin-tilgang for ${c.org.name}`} className="mb-6">
          Alle funksjoner (Enterprise) er åpne uten betaling. Abonnementet og Stripe endres ikke.
          {c.aiOn ? null : ' AI er ikke slått på, så AI-funksjonene kjører i testmodus med simulerte svar – merket som det.'}
          {c.org.onboarded ? null : (
            <>
              {' '}
              <strong>Fyll ut bedriftsprofilen først</strong> (<a href="/app/profil">Bedriftsprofil</a>), så får du treff og vurderinger.
            </>
          )}
        </Alert>
      ) : (
        <Alert tone="warning" title="Du har ingen egen organisasjon ennå" className="mb-6">
          Åpne <a href="/app">appen</a> og opprett en organisasjon. Organisasjoner du eier, får alle funksjoner uten betaling.
        </Alert>
      )}
      {c.tenderId ? null : (
        <p className="mb-6 text-[14px] text-muted">Fant ikke noe åpent anbud å vise frem – lenkene til anbudssidene er skjult til hentingen har kjørt.</p>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {PRODUCT_GROUPS.map((g) => (
          <Panel key={g.title}>
            <PanelHeader title={g.title} />
            <ul>
              {g.items.map((item) => {
                const state = productState(item, s);
                const needsTender = item.href.includes(':anbud');
                const href = needsTender ? (c.tenderId ? item.href.replace(':anbud', c.tenderId) : null) : item.href;
                return (
                  <li key={item.name} className="border-b border-line px-5 py-4 last:border-b-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-strong">
                        {href ? <a href={href}>{item.name}</a> : item.name}
                      </p>
                      <Badge tone={TONE[state.tone]} className="whitespace-normal">{state.text}</Badge>
                    </div>
                    <p className="mt-1 text-[13.5px] text-ink">{item.what}</p>
                    <p className="mt-1 text-[12.5px] text-muted">Kunder: {minPlanName(item.feature)}</p>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
    </AdminShell>
  );
}
