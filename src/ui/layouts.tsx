import type { ReactNode } from 'react';
import {
  LuBell,
  LuBookmark,
  LuBuilding2,
  LuCheck,
  LuGlobe,
  LuCalculator,
  LuChartBar,
  LuHandshake,
  LuClipboardList,
  LuCreditCard,
  LuLayoutDashboard,
  LuLogOut,
  LuMenu,
  LuSave,
  LuSearch,
  LuSettings,
  LuShield,
  LuTelescope,
  LuUsers,
} from 'react-icons/lu';
import { useUi } from './context';
import { Alert, Button, buttonVariants, cn, CsrfField, FlashMessage, Logo, PostForm } from './components';
import { formatDate, sourcesPhrase } from './format';
import { companyConfigured, companyInfo, LEGAL_DOCS } from '@/domain/legal/legal';
import { isTranslatedPath, LOCALE_INFO, LOCALES, localePath, messages, sourcesText } from '@/i18n';
import { fill } from '@/i18n/format';
import { RadarDecor } from './site';

// ---------------------------------------------------------------------------
// Offentlige sider
// ---------------------------------------------------------------------------
const PUBLIC_NAV = ['/funksjoner', '/bransjer', '/priser', '/om'] as const;

function useNavLabels() {
  const { m } = useUi();
  return { '/funksjoner': m.nav.features, '/bransjer': m.nav.industries, '/priser': m.nav.pricing, '/om': m.nav.about, '/kontakt': m.nav.contact } as Record<string, string>;
}

/** Språkvelger: samme side på et annet språk. Fungerer uten JavaScript. */
function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { locale, path, search, m } = useUi();
  const target = isTranslatedPath(path) ? path : '/';
  return (
    <details className="relative">
      <summary
        className={cn(
          'flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold uppercase [&::-webkit-details-marker]:hidden',
          dark ? 'text-white/85 hover:bg-white/10 hover:text-white' : 'text-navy-900 hover:bg-navy-50',
        )}
        aria-label={m.nav.language}
      >
        <LuGlobe className="size-4" aria-hidden />
        <span className={cn('font-mono text-[12px] tracking-[0.08em]', dark && 'hidden sm:inline')}>{locale === 'nb' ? 'no' : locale}</span>
      </summary>
      <ul className="absolute right-0 top-11 z-50 max-h-[70vh] w-52 overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-xl">
        {LOCALES.map((l) => (
          <li key={l}>
            <a
              href={localePath(l, target) + (target === path ? search : '')}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? 'true' : undefined}
              className={cn('flex items-center justify-between rounded-xl px-3 py-1.5 text-[14px] text-navy-900 no-underline hover:bg-navy-50', l === locale && 'font-semibold')}
            >
              {LOCALE_INFO[l].name}
              {l === locale ? <LuCheck className="size-4 text-navy-700" aria-hidden /> : null}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Når nettleseren foretrekker et annet språk vi har: en diskret lenke øverst, på det språket. */
function LanguageSuggestion() {
  const { suggestLocale, path, search } = useUi();
  if (!suggestLocale) return null;
  const t = messages(suggestLocale);
  return (
    <div className="bg-signal text-night" lang={suggestLocale}>
      <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] font-medium sm:px-6">
        <LuGlobe className="size-4" aria-hidden />
        {t.nav.suggest}
        <a href={localePath(suggestLocale, path) + search} hrefLang={suggestLocale} className="font-bold text-night underline">
          {t.nav.suggestAction} →
        </a>
      </p>
    </div>
  );
}

export function PublicLayout({ children }: { children: ReactNode; heroDark?: boolean }) {
  const { user, path, m, lp } = useUi();
  const labels = useNavLabels();
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <a href="#innhold" className="sr-only-focusable absolute left-3 top-3 z-50 rounded bg-white px-3 py-2 text-navy-900">
        {m.nav.skip}
      </a>
      <LanguageSuggestion />
      <header className="site-header sticky top-0 z-40 text-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href={lp('/')} className="no-underline" aria-label={m.nav.home}>
            <Logo inverse />
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label={m.nav.mainMenu}>
            {PUBLIC_NAV.map((href) => (
              <a
                key={href}
                href={lp(href)}
                aria-current={path === href || path.startsWith(`${href}/`) ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3.5 py-2 text-[14px] font-medium no-underline transition-colors',
                  path === href || path.startsWith(`${href}/`) ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white',
                )}
              >
                {labels[href]}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher dark />
            {user ? (
              <a href={user.isPlatformAdmin ? '/admin' : '/app'} className="btn-signal !px-4 !py-2 !text-[14px]">
                {user.isPlatformAdmin ? m.nav.toAdmin : m.nav.toApp}
              </a>
            ) : (
              <>
                <a href={lp('/logg-inn')} className="hidden px-3 text-[14px] font-medium text-white/80 no-underline hover:text-white sm:inline">
                  {m.nav.login}
                </a>
                <a href={lp('/registrer')} className="btn-signal !px-4 !py-2 !text-[14px]">
                  {m.nav.start}
                </a>
              </>
            )}
            <details className="relative md:hidden">
              <summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded-full text-white hover:bg-white/10" aria-label={m.nav.menu}>
                <LuMenu className="size-5" />
              </summary>
              <div className="absolute right-0 top-11 w-60 rounded-2xl border border-line bg-white p-2 shadow-xl">
                {[...PUBLIC_NAV, '/kontakt', ...(user ? [] : ['/logg-inn'])].map((href) => (
                  <a key={href} href={lp(href)} className="block rounded-xl px-3 py-2.5 text-[15px] font-semibold text-navy-900 no-underline hover:bg-navy-50">
                    {href === '/logg-inn' ? m.nav.login : labels[href]}
                  </a>
                ))}
              </div>
            </details>
          </div>
        </div>
      </header>
      <main id="innhold" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

function FooterNav({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <nav aria-label={title} className="space-y-2.5 text-[14px]">
      <p className="font-semibold text-white">{title}</p>
      {links.map((l) => (
        <a key={l.href} className="block text-white/60 no-underline transition-colors hover:text-white" href={l.href}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}

function PublicFooter() {
  const { liveSources, m, lp, path, locale } = useUi();
  const labels = useNavLabels();
  const company = companyInfo();
  const legal = m.footer.legalDocs as Record<string, string>;
  const target = isTranslatedPath(path) ? path : '/';
  return (
    <footer className="night print:hidden">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-10 px-4 pb-10 pt-16 sm:px-6 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="col-span-2 max-w-sm space-y-4 lg:col-span-1">
          <Logo inverse />
          <p className="text-[14px] leading-relaxed text-white/60">{fill(m.footer.about, { sources: sourcesText(m, liveSources) })}</p>
        </div>
        <FooterNav title={m.footer.product} links={['/funksjoner', '/bransjer', '/priser'].map((href) => ({ href: lp(href), label: labels[href]! }))} />
        <FooterNav title={m.footer.company} links={['/om', '/kontakt'].map((href) => ({ href: lp(href), label: labels[href]! }))} />
        <div className="space-y-2">
          <FooterNav title={m.footer.legal} links={LEGAL_DOCS.map((d) => ({ href: d.href, label: legal[d.href.slice(1)] ?? d.label }))} />
          {m.footer.legalNote ? <p className="pt-1 text-[12px] text-white/45">{m.footer.legalNote}</p> : null}
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-7xl space-y-3 px-4 py-6 text-[12px] text-white/45 sm:px-6">
          <nav aria-label={m.footer.languages} className="flex flex-wrap gap-x-3 gap-y-1">
            {LOCALES.map((l) => (
              <a key={l} href={localePath(l, target)} hrefLang={l} lang={l} className={cn('no-underline transition-colors hover:text-white', l === locale ? 'font-semibold text-white' : 'text-white/50')}>
                {LOCALE_INFO[l].name}
              </a>
            ))}
          </nav>
          <div className="space-y-1">
            <p>
              © {new Date().getFullYear()} AnbudRadar
              {companyConfigured(company) ? ` · ${fill(m.footer.deliveredBy, { name: company.name, orgNumber: company.orgNumber, address: company.address })}` : ''}
            </p>
            <p>{m.footer.credit}</p>
            {m.footer.translated ? <p>{m.footer.translated}</p> : null}
          </div>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Innlogging / registrering
// ---------------------------------------------------------------------------
export function AuthLayout({ children, title, intro }: { children: ReactNode; title: string; intro?: ReactNode }) {
  const { m, lp, path } = useUi();
  return (
    <div className="flex min-h-screen bg-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-5 py-5 sm:px-10">
          <a href={lp('/')} className="no-underline" aria-label={m.nav.home}>
            <Logo />
          </a>
          {/* Bare innlogging og registrering er oversatt – ikke onboarding i appen. */}
          {isTranslatedPath(path) ? <LanguageSwitcher /> : null}
        </header>
        <main id="innhold" className="flex flex-1 items-start justify-center px-5 pb-16 pt-4 sm:px-10 sm:pt-10 lg:items-center lg:pt-0">
          <div className="w-full max-w-[27rem]">
            <h1 className="text-[32px] font-[780] leading-[1.08] tracking-[-0.03em] text-night sm:text-[36px]">{title}</h1>
            {intro ? <div className="mt-3 text-[15px] leading-relaxed text-muted">{intro}</div> : null}
            <div className="mt-8">
              <FlashMessage />
              {children}
            </div>
          </div>
        </main>
      </div>
      <aside className="night relative hidden w-[44%] max-w-[680px] flex-col justify-center overflow-hidden lg:flex">
        <div className="dot-grid absolute inset-0 opacity-50" aria-hidden />
        <RadarDecor className="absolute -right-40 top-1/2 w-[560px] -translate-y-1/2 opacity-80" />
        <div className="relative max-w-md px-12 xl:px-16">
          <p className="text-[34px] font-[780] leading-[1.05] tracking-[-0.035em] text-white xl:text-[40px]">{m.auth.side.title}</p>
          <ul className="mt-8 space-y-3.5">
            {m.auth.side.points.map((x) => (
              <li key={x} className="flex items-center gap-3 text-[16px] text-white/85">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal">
                  <LuCheck className="size-3.5" aria-hidden strokeWidth={3} />
                </span>
                {x}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appen (innlogget)
// ---------------------------------------------------------------------------
interface NavItem {
  href: string;
  label: string;
  icon: typeof LuSearch;
  match?: string;
  badge?: number;
  /** Liten etikett, f.eks. «Enterprise» for en funksjon planen ikke har. */
  tag?: string;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium no-underline transition-colors focus-visible:outline-white',
        active ? 'bg-white/[0.08] text-white' : 'text-white/60 hover:bg-white/[0.05] hover:text-white',
      )}
    >
      {active ? <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-signal" aria-hidden /> : null}
      <Icon className={cn('size-[18px] shrink-0', active ? 'text-signal' : 'text-white/45 group-hover:text-white')} aria-hidden />
      <span className="flex-1">{item.label}</span>
      {item.badge ? (
        <span className="num rounded-full bg-signal px-1.5 text-[11px] font-bold text-night" aria-label={`${item.badge} uleste`}>
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      ) : null}
      {item.tag ? <span className="rounded-full border border-signal/40 px-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-signal/90">{item.tag}</span> : null}
    </a>
  );
}

function AppNav() {
  const { path, unreadCount, user, org } = useUi();
  const main: NavItem[] = [
    { href: '/app', label: 'Oversikt', icon: LuLayoutDashboard, match: '/app' },
    { href: '/app/anbud', label: 'Finn anbud', icon: LuSearch },
    {
      href: '/app/fremtidige',
      label: 'Fremtidige prosjekter',
      icon: LuTelescope,
      tag: org?.entitlements.futureOpportunities ? undefined : 'Enterprise',
    },
    { href: '/app/lagret', label: 'Lagrede anbud', icon: LuBookmark },
    { href: '/app/sok', label: 'Lagrede søk', icon: LuSave },
    { href: '/app/lonnsomhet', label: 'Lønnsomhet', icon: LuCalculator },
    { href: '/app/tilbud', label: 'Tilbudsarbeid', icon: LuClipboardList },
    { href: '/app/partnere', label: 'Anbudspartnere', icon: LuHandshake },
    { href: '/app/konkurrenter', label: 'Konkurrenter', icon: LuChartBar },
    { href: '/app/varsler', label: 'Varsler', icon: LuBell, badge: unreadCount },
  ];
  const secondary: NavItem[] = [
    { href: '/app/profil', label: 'Bedriftsprofil', icon: LuBuilding2 },
    { href: '/app/kapasitet', label: 'Kapasitet og økonomi', icon: LuUsers },
    { href: '/app/abonnement', label: 'Abonnement', icon: LuCreditCard },
    { href: '/app/innstillinger', label: 'Innstillinger', icon: LuSettings },
    ...(user?.isPlatformAdmin ? [{ href: '/admin', label: 'Admin', icon: LuShield }] : []),
  ];
  const isActive = (item: NavItem) => (item.match ? path === item.match : path === item.href || path.startsWith(item.href + '/'));
  return (
    <nav aria-label="Appmeny" className="flex flex-1 flex-col gap-6">
      <div className="space-y-0.5">
        {main.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item)} />
        ))}
      </div>
      <div className="space-y-0.5 border-t border-white/10 pt-4">
        {secondary.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item)} />
        ))}
      </div>
    </nav>
  );
}

function OrgSwitcher() {
  const { org } = useUi();
  if (!org) return null;
  if (org.memberships.length <= 1) {
    return (
      <div className="min-w-0 px-3">
        <p className="truncate text-[13px] font-semibold text-white">{org.name}</p>
        <p className="text-[12px] text-white/50">{org.billing.label}</p>
      </div>
    );
  }
  return (
    <PostForm action="/app/org/bytt" className="px-3">
      <label htmlFor="org-switch" className="sr-only">
        Bytt organisasjon
      </label>
      <select
        id="org-switch"
        name="orgId"
        defaultValue={org.id}
        data-autosubmit
        className="w-full rounded-xl border border-white/15 bg-night-700 px-2.5 py-1.5 text-[13px] font-semibold text-white"
      >
        {org.memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.name}
          </option>
        ))}
      </select>
      <noscript>
        <Button size="sm" variant="inverse" className="mt-2">
          Bytt
        </Button>
      </noscript>
      <p className="mt-1 text-[12px] text-white/50">{org.billing.label}</p>
    </PostForm>
  );
}

function Sidebar() {
  return (
    <div className="night flex h-full flex-col gap-6 px-3 py-5">
      <a href="/app" className="px-3 no-underline" aria-label="AnbudRadar – oversikt">
        <Logo inverse />
      </a>
      <OrgSwitcher />
      <AppNav />
    </div>
  );
}

function AccountBanners() {
  const { user, org, isDev } = useUi();
  const banners: ReactNode[] = [];
  if (user && !user.emailVerified) {
    banners.push(
      <Alert key="verify" tone="warning" title="Bekreft e-postadressen din">
        Vi har sendt en lenke til {user.email}. Uten bekreftet adresse får du ikke e-postvarsler.
        <PostForm action="/send-bekreftelse-pa-nytt" className="mt-2">
          <Button size="sm" variant="secondary" type="submit">
            Send lenken på nytt
          </Button>
        </PostForm>
      </Alert>,
    );
  }
  if (org?.billing.notice) {
    banners.push(
      <Alert key="billing" tone={org.billing.status === 'past_due' ? 'danger' : 'warning'}>
        {org.billing.notice}{' '}
        <a href="/app/abonnement" className="font-semibold">
          Gå til abonnement
        </a>
      </Alert>,
    );
  } else if (org?.billing.status === 'trial' && org.billing.trialEndsAt) {
    const daysLeft = Math.ceil((new Date(org.billing.trialEndsAt).getTime() - Date.now()) / 86_400_000);
    if (daysLeft <= 5) {
      banners.push(
        <Alert key="trial" tone="info">
          Prøveperioden varer til {formatDate(org.billing.trialEndsAt)}.{' '}
          <a href="/app/abonnement" className="font-semibold">
            Velg plan
          </a>
        </Alert>,
      );
    }
  }
  if (isDev) {
    banners.push(
      <p key="dev" className="text-[12px] text-muted">
        Utviklingsmodus. Kunngjøringer merket «Eksempeldata» er fiktive.
      </p>,
    );
  }
  if (!banners.length) return null;
  return <div className="mb-5 space-y-3">{banners}</div>;
}

export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user } = useUi();
  return (
    <div className="min-h-screen bg-cream lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <a href="#innhold" className="sr-only-focusable absolute left-3 top-3 z-50 rounded bg-white px-3 py-2 text-navy-900">
        Hopp til innhold
      </a>
      <div className="hidden bg-night lg:block">
        <aside className="sticky top-0 h-screen overflow-y-auto">
          <Sidebar />
        </aside>
      </div>
      <div className="min-w-0">
        {/* Ingen backdrop-filter her: det ville gjort at mobilmenyen (position: fixed) bare ble like høy som toppen. */}
        <header className="sticky top-0 z-20 border-b border-line bg-white">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <details className="relative lg:hidden">
              <summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded-full text-night hover:bg-night/5" aria-label="Meny">
                <LuMenu className="size-5" />
              </summary>
              <div className="fixed inset-0 z-30 bg-night/50" data-close-details aria-hidden />
              <div className="fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] overflow-y-auto shadow-2xl">
                <Sidebar />
              </div>
            </details>
            <form action="/app/anbud" method="get" role="search" className="relative min-w-0 flex-1 sm:max-w-xl">
              <LuSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <label htmlFor="global-search" className="sr-only">
                Søk i anbud
              </label>
              <input
                id="global-search"
                name="nl"
                type="search"
                placeholder="Søk, f.eks. «renhold i Trøndelag over 1 million»"
                className="h-10 w-full rounded-full border border-line bg-cream pl-9 pr-4 text-[14px] placeholder:text-faint focus:border-night focus:bg-white focus:outline-none focus:ring-4 focus:ring-signal/25"
              />
            </form>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden max-w-40 truncate text-[13px] text-muted md:inline">{user?.name}</span>
              <form method="post" action="/logg-ut">
                <CsrfField />
                <button
                  type="submit"
                  className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-night/5 hover:text-night"
                  title="Logg ut"
                >
                  <LuLogOut className="size-[18px]" aria-hidden />
                  <span className="sr-only">Logg ut</span>
                </button>
              </form>
            </div>
          </div>
        </header>
        <main id="innhold" className={cn('mx-auto px-4 py-6 sm:px-6 sm:py-8', wide ? 'max-w-7xl' : 'max-w-6xl')}>
          <AccountBanners />
          <FlashMessage />
          {children}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
const ADMIN_NAV = [
  { href: '/admin', label: 'Oversikt' },
  { href: '/admin/brukere', label: 'Brukere' },
  { href: '/admin/organisasjoner', label: 'Organisasjoner' },
  { href: '/admin/importer', label: 'Importer' },
  { href: '/admin/kilder', label: 'Datakilder' },
  { href: '/admin/ai', label: 'AI-bruk' },
  { href: '/admin/epost', label: 'E-post' },
  { href: '/admin/rapporter', label: 'Henvendelser' },
  { href: '/admin/logg', label: 'Revisjonslogg' },
  { href: '/admin/helse', label: 'Systemhelse' },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const { path } = useUi();
  return (
    <div className="min-h-screen bg-cream">
      <header className="night border-b border-white/10">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <a href="/admin" className="no-underline">
            <Logo inverse />
          </a>
          <span className="rounded-full bg-signal px-2 py-0.5 text-[12px] font-bold text-night">Admin</span>
          <a href="/app" className="ml-auto text-[13px] font-semibold text-white/70 no-underline hover:text-white">
            Til appen
          </a>
        </div>
        <nav className="scroll-x mx-auto max-w-7xl px-2 sm:px-4" aria-label="Adminmeny">
          <ul className="flex min-w-max gap-1 pb-2">
            {ADMIN_NAV.map((item) => {
              const active = item.href === '/admin' ? path === '/admin' : path.startsWith(item.href);
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-full px-3.5 py-1.5 text-[13px] font-semibold no-underline',
                      active ? 'bg-white/[0.12] text-white' : 'text-white/60 hover:text-white',
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main id="innhold" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <FlashMessage />
        {children}
      </main>
    </div>
  );
}
