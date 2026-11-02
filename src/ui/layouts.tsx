import type { ReactNode } from 'react';
import {
  LuBell,
  LuBookmark,
  LuBuilding2,
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
  LuUsers,
} from 'react-icons/lu';
import { useUi } from './context';
import { Alert, Button, buttonVariants, cn, CsrfField, FlashMessage, Logo, PostForm } from './components';
import { formatDate, sourcesPhrase } from './format';

// ---------------------------------------------------------------------------
// Offentlige sider
// ---------------------------------------------------------------------------
const PUBLIC_NAV = [
  { href: '/funksjoner', label: 'Funksjoner' },
  { href: '/bransjer', label: 'Bransjer' },
  { href: '/priser', label: 'Priser' },
  { href: '/om', label: 'Om oss' },
];

export function PublicLayout({ children, heroDark = false }: { children: ReactNode; heroDark?: boolean }) {
  const { user, path } = useUi();
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <a href="#innhold" className="sr-only-focusable absolute left-3 top-3 z-50 rounded bg-white px-3 py-2 text-navy-900">
        Hopp til innhold
      </a>
      <header className={cn('relative z-10', heroDark ? 'bg-navy-900' : 'border-b border-line bg-white')}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <a href="/" className="no-underline" aria-label="AnbudRadar – til forsiden">
            <Logo inverse={heroDark} />
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Hovedmeny">
            {PUBLIC_NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                aria-current={path === item.href ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-2 text-[14px] font-semibold no-underline',
                  heroDark ? 'text-navy-100 hover:bg-white/10 hover:text-white' : 'text-muted hover:text-navy-900',
                  path === item.href && (heroDark ? 'text-white' : 'text-navy-900'),
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <a href="/app" className={buttonVariants({ variant: heroDark ? 'inverse' : 'primary', size: 'sm' })}>
                Til appen
              </a>
            ) : (
              <>
                <a
                  href="/logg-inn"
                  className={cn('hidden px-2 text-[14px] font-semibold no-underline sm:inline', heroDark ? 'text-white' : 'text-navy-900')}
                >
                  Logg inn
                </a>
                <a href="/registrer" className={buttonVariants({ variant: heroDark ? 'inverse' : 'primary', size: 'sm' })}>
                  Prøv gratis
                </a>
              </>
            )}
            <details className="relative md:hidden">
              <summary
                className={cn('flex size-9 cursor-pointer list-none items-center justify-center rounded-md', heroDark ? 'text-white' : 'text-navy-900')}
                aria-label="Meny"
              >
                <LuMenu className="size-5" />
              </summary>
              <div className="absolute right-0 top-11 w-56 rounded-lg border border-line bg-white p-2 shadow-lg">
                {[...PUBLIC_NAV, { href: '/kontakt', label: 'Kontakt' }, ...(user ? [] : [{ href: '/logg-inn', label: 'Logg inn' }])].map((item) => (
                  <a key={item.href} href={item.href} className="block rounded-md px-3 py-2 text-[14px] font-semibold text-navy-900 no-underline hover:bg-navy-50">
                    {item.label}
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

function PublicFooter() {
  const { liveSources } = useUi();
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm space-y-3">
          <Logo />
          <p className="text-[14px] text-muted">
            Kunngjøringer hentes fra {sourcesPhrase(liveSources)}. Kildelenken følger alltid med, så du kan sjekke originalen.
          </p>
        </div>
        <nav aria-label="Produkt" className="space-y-2 text-[14px]">
          <p className="font-semibold text-navy-900">Produkt</p>
          <a className="block text-muted no-underline hover:text-navy-900" href="/funksjoner">Funksjoner</a>
          <a className="block text-muted no-underline hover:text-navy-900" href="/bransjer">Bransjer</a>
          <a className="block text-muted no-underline hover:text-navy-900" href="/priser">Priser</a>
        </nav>
        <nav aria-label="Selskap" className="space-y-2 text-[14px]">
          <p className="font-semibold text-navy-900">Selskap</p>
          <a className="block text-muted no-underline hover:text-navy-900" href="/om">Om oss</a>
          <a className="block text-muted no-underline hover:text-navy-900" href="/kontakt">Kontakt</a>
          <a className="block text-muted no-underline hover:text-navy-900" href="/personvern">Personvern</a>
          <a className="block text-muted no-underline hover:text-navy-900" href="/vilkar">Vilkår</a>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-4 text-[12px] text-muted sm:px-6">
          © {new Date().getFullYear()} AnbudRadar. TED-data © Den europeiske union. Doffin driftes av Direktoratet for forvaltning og økonomistyring (DFØ).
        </p>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Innlogging / registrering
// ---------------------------------------------------------------------------
export function AuthLayout({ children, title, intro }: { children: ReactNode; title: string; intro?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="mx-auto flex w-full max-w-6xl items-center px-4 py-5 sm:px-6">
        <a href="/" className="no-underline" aria-label="AnbudRadar – til forsiden">
          <Logo />
        </a>
      </header>
      <main id="innhold" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-10">
        <div className="w-full max-w-md">
          <h1 className="font-serif text-[28px] font-semibold leading-tight text-navy-900">{title}</h1>
          {intro ? <div className="mt-2 text-[15px] text-muted">{intro}</div> : null}
          <div className="mt-6 rounded-lg border border-line bg-white p-6 sm:p-7">
            <FlashMessage />
            {children}
          </div>
        </div>
      </main>
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
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-semibold no-underline',
        active ? 'bg-white/10 text-white' : 'text-navy-200 hover:bg-white/5 hover:text-white',
      )}
    >
      <Icon className={cn('size-[18px] shrink-0', active ? 'text-marker' : 'text-navy-300 group-hover:text-white')} aria-hidden />
      <span className="flex-1">{item.label}</span>
      {item.badge ? (
        <span className="num rounded-full bg-marker px-1.5 text-[11px] font-bold text-navy-900" aria-label={`${item.badge} uleste`}>
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      ) : null}
    </a>
  );
}

function AppNav() {
  const { path, unreadCount, user } = useUi();
  const main: NavItem[] = [
    { href: '/app', label: 'Oversikt', icon: LuLayoutDashboard, match: '/app' },
    { href: '/app/anbud', label: 'Finn anbud', icon: LuSearch },
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
        <p className="text-[12px] text-navy-300">{org.billing.label}</p>
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
        className="w-full rounded-md border border-white/20 bg-navy-800 px-2 py-1.5 text-[13px] font-semibold text-white"
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
      <p className="mt-1 text-[12px] text-navy-300">{org.billing.label}</p>
    </PostForm>
  );
}

function Sidebar() {
  return (
    <div className="flex h-full flex-col gap-6 bg-navy-900 px-3 py-5">
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
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a href="#innhold" className="sr-only-focusable absolute left-3 top-3 z-50 rounded bg-white px-3 py-2 text-navy-900">
        Hopp til innhold
      </a>
      <div className="hidden bg-navy-900 lg:block">
        <aside className="sticky top-0 h-screen overflow-y-auto">
          <Sidebar />
        </aside>
      </div>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <details className="relative lg:hidden">
              <summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-navy-900 hover:bg-navy-50" aria-label="Meny">
                <LuMenu className="size-5" />
              </summary>
              <div className="fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] overflow-y-auto shadow-xl">
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
                className="h-9 w-full rounded-md border border-line bg-paper pl-9 pr-3 text-[14px] placeholder:text-faint focus:border-navy-600 focus:bg-white focus:outline-none"
              />
            </form>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden max-w-40 truncate text-[13px] text-muted md:inline">{user?.name}</span>
              <form method="post" action="/logg-ut">
                <CsrfField />
                <button
                  type="submit"
                  className="flex size-9 items-center justify-center rounded-md text-muted hover:bg-navy-50 hover:text-navy-900"
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
  { href: '/admin', label: 'Nøkkeltall' },
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
    <div className="min-h-screen bg-paper">
      <header className="border-b border-navy-800 bg-navy-900">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <a href="/admin" className="no-underline">
            <Logo inverse />
          </a>
          <span className="rounded bg-marker px-1.5 text-[12px] font-bold text-navy-900">Admin</span>
          <a href="/app" className="ml-auto text-[13px] font-semibold text-navy-100 no-underline hover:text-white">
            Tilbake til appen
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
                      'block rounded-md px-3 py-1.5 text-[13px] font-semibold no-underline',
                      active ? 'bg-white/15 text-white' : 'text-navy-200 hover:text-white',
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
