import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { env, integrationStatus, isDev, isProd } from '@/lib/env';
import { UiContext, type UiContextValue } from '@/ui/context';
import type { RequestContext } from './http';
import { liveSources } from '@/domain/tenders/source-status';

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
}

function uiValue(ctx: RequestContext): UiContextValue {
  const integrations = integrationStatus();
  return {
    path: ctx.path,
    csrfToken: ctx.csrfToken,
    user: ctx.user,
    org: ctx.org,
    flash: ctx.flash,
    unreadCount: ctx.unreadCount,
    isDev: isDev,
    aiConfigured: integrations.ai,
    aiIsMock: integrations.aiIsMock,
    legalReviewed: env.LEGAL_PAGES_REVIEWED,
    liveSources: liveSources(),
    trialDays: env.TRIAL_DAYS,
  };
}

export function renderHtml(ctx: RequestContext, element: ReactNode, opts: RenderOptions): string {
  const title = opts.title ? `${opts.title} – AnbudRadar` : 'AnbudRadar';
  const description =
    opts.description ?? 'AnbudRadar hjelper bedrifter å finne, forstå og svare på offentlige anbud i Norge.';
  const body = renderToString(<UiContext.Provider value={uiValue(ctx)}>{element}</UiContext.Provider>);
  const noindex = opts.noindex || ctx.path.startsWith('/app') || ctx.path.startsWith('/admin');
  return `<!DOCTYPE html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<meta name="theme-color" content="#0f2340">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${asset('fonts/schibsted-grotesk-latin-wght-normal.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${asset('app.css')}">
<script type="module" src="${asset('app.js')}" nonce="${ctx.nonce}"></script>
</head>
<body class="${escapeHtml(opts.bodyClass ?? '')}">${body}</body>
</html>`;
}

export function render(ctx: RequestContext, element: ReactNode, opts: RenderOptions): Response {
  const html = renderHtml(ctx, element, opts);
  return new Response(html, {
    status: opts.status ?? 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
