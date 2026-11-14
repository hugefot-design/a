import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { env, isDev, isProd, paymentsOpen } from '@/lib/env';
import { UiContext, type UiContextValue } from '@/ui/context';
import type { RequestContext } from './http';
import { liveSources } from '@/domain/tenders/source-status';
import { aiModeFor } from '@/domain/ai/provider';
import { LOCALE_INFO, LOCALES, localePath, MARKETING_PATHS, messages, preferredLocale } from '@/i18n';

const ASSET_DIR = join(process.cwd(), 'public', 'assets');
let manifestCache: Record<string, string> | null = null;

function manifest(): Record<string, string> {
  if (manifestCache && isProd) return manifestCache;
  const file = join(ASSET_DIR, 'manifest.json');
  manifestCache = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>) : {};
  return manifestCache;
}

export function asset(name: string): string {
  return `/assets/${manifest()[name] ?? name}`;
}

export interface RenderOptions {
  title: string;
  description?: string;
  status?: number;
  noindex?: boolean;
  bodyClass?: string;
  /** Kanonisk adresse for sider som bare finnes på norsk (f.eks. /fylker/oslo). Oversatte sider får den automatisk. */
  canonical?: string;
  /** Strukturerte data (schema.org), f.eks. brødsmuler. */
  jsonLd?: unknown[];
}

function uiValue(ctx: RequestContext): UiContextValue {
  const ai = aiModeFor(ctx.org);
  return {
    path: ctx.path,
    csrfToken: ctx.csrfToken,
    user: ctx.user,
    org: ctx.org,
    flash: ctx.flash,
    unreadCount: ctx.unreadCount,
    isDev: isDev,
    aiConfigured: ai.configured,
    aiIsMock: ai.isMock,
    paymentsOpen: paymentsOpen(),
    publicTenderPages: env.PUBLIC_TENDER_PAGES,
    legalReviewed: env.LEGAL_PAGES_REVIEWED,
    liveSources: liveSources(),
    trialDays: env.TRIAL_DAYS,
    locale: ctx.locale,
    m: messages(ctx.locale),
    lp: (href) => localePath(ctx.locale, href),
    search: ctx.url.search,
    suggestLocale: suggestion(ctx),
  };
}

const isMarketing = (path: string) => (MARKETING_PATHS as readonly string[]).includes(path) || /^\/bransjer\/[a-z-]+$/.test(path);

/** Tilbyr språket nettleseren foretrekker – bare på norske markedssider som finnes på det språket. */
function suggestion(ctx: RequestContext) {
  if (ctx.locale !== 'nb' || ctx.method !== 'GET' || !isMarketing(ctx.path)) return null;
  const preferred = preferredLocale(ctx.req.headers['accept-language']);
  return preferred && preferred !== 'nb' ? preferred : null;
}

/**
 * Strukturerte data på forsiden: nettstedets navn (Google viser «AnbudRadar» i stedet for adressen)
 * og logoen. Bare fakta som stemmer: navn, adresse og logo.
 */
function structuredData(ctx: RequestContext): string {
  const base = env.APP_URL.replace(/\/$/, '');
  const data = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'AnbudRadar', url: `${base}/`, inLanguage: ctx.locale },
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'AnbudRadar', url: `${base}/`, logo: `${base}/icon-512.png` },
  ];
  // < escapes, så innholdet aldri kan avslutte script-taggen.
  return `<script type="application/ld+json" nonce="${ctx.nonce}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** Forhåndsvisning når en lenke deles (Facebook, LinkedIn, Messenger, SMS): tittel, tekst og bilde. */
function socialMeta(ctx: RequestContext, title: string, description: string): string {
  const base = env.APP_URL.replace(/\/$/, '');
  const url = base + (isMarketing(ctx.path) ? localePath(ctx.locale, ctx.path) : ctx.path);
  const m = messages(ctx.locale);
  return [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="AnbudRadar">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="${escapeHtml(`${base}/assets/og/og-${ctx.locale}.png`)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${escapeHtml(`${m.home.title1} ${m.home.title2}`)}">`,
    `<meta property="og:locale" content="${LOCALE_INFO[ctx.locale].intl.replace('-', '_')}">`,
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n');
}

/** Kanonisk adresse og hreflang for de oversatte markedssidene. */
function alternates(ctx: RequestContext): string {
  if (!isMarketing(ctx.path)) return '';
  const base = env.APP_URL.replace(/\/$/, '');
  const links = LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${escapeHtml(base + localePath(l, ctx.path))}">`);
  return [
    `<link rel="canonical" href="${escapeHtml(base + localePath(ctx.locale, ctx.path))}">`,
    ...links,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(base + ctx.path)}">`,
  ].join('\n');
}

export function renderHtml(ctx: RequestContext, element: ReactNode, opts: RenderOptions): string {
  const title = opts.title ? `${opts.title} – AnbudRadar` : 'AnbudRadar';
  const description = opts.description ?? messages(ctx.locale).meta.siteDescription;
  const body = renderToString(<UiContext.Provider value={uiValue(ctx)}>{element}</UiContext.Provider>);
  const noindex = opts.noindex || ctx.path.startsWith('/app') || ctx.path.startsWith('/admin');
  return `<!DOCTYPE html>
<html lang="${ctx.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
${noindex || (opts.status ?? 200) !== 200 ? '' : alternates(ctx)}
${!noindex && (opts.status ?? 200) === 200 && opts.canonical && !isMarketing(ctx.path) ? `<link rel="canonical" href="${escapeHtml(env.APP_URL.replace(/\/$/, '') + opts.canonical)}">` : ''}
${opts.jsonLd?.length && (opts.status ?? 200) === 200 ? `<script type="application/ld+json" nonce="${ctx.nonce}">${JSON.stringify(opts.jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
${noindex || (opts.status ?? 200) !== 200 ? '' : socialMeta(ctx, title, description)}
<meta name="theme-color" content="#060e1b">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-96x96.png" type="image/png" sizes="96x96">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
${env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${escapeHtml(env.GOOGLE_SITE_VERIFICATION)}">` : ''}
${ctx.path === '/' && (opts.status ?? 200) === 200 ? structuredData(ctx) : ''}
<link rel="preload" href="${asset('fonts/schibsted-grotesk-latin-wght-normal.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset('app.css')}">
<script type="module" src="${asset('app.js')}" nonce="${ctx.nonce}"></script>
<script nonce="${ctx.nonce}">document.documentElement.classList.add('js');try{var t=localStorage.getItem('ar-tema');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
</head>
<body class="${escapeHtml(opts.bodyClass ?? '')}">${body}</body>
</html>`;
}

export function render(ctx: RequestContext, element: ReactNode, opts: RenderOptions): Response {
  const html = renderHtml(ctx, element, opts);
  return new Response(html, {
    status: opts.status ?? 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Language' },
  });
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
