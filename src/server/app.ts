import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, Transform } from 'node:stream';
import { env, isProd } from '@/lib/env';
import { ipHash as hashIp, randomToken, safeEqual } from '@/lib/crypto';
import { log } from '@/lib/logger';
import { withTenant } from '@/lib/db';
import { getSession, SESSION_COOKIE } from '@/domain/auth/auth';
import { loadOrgContext } from '@/domain/org/org';
import { FEATURE_LABELS } from '@/domain/billing/plans';
import { ErrorPage, FeatureLockedPage } from '@/ui/pages/system';
import { HttpError, parseCookies, redirect, serializeCookie, type RequestContext } from './http';
import { decodeFlash, FLASH_COOKIE } from './flash';
import { render } from './render';
import { serveStatic } from './static';
import { canonicalRedirect } from './canonical';
import { refreshLiveSourcesIfStale } from '@/domain/tenders/source-status';
import type { Router } from './router';

const GUEST_CSRF_COOKIE = 'ar_csrf';
const APP_ORIGIN = new URL(env.APP_URL).origin;

function clientIp(req: IncomingMessage): string {
  if (env.TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    const firstIp = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function securityHeaders(nonce: string): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const headers: Record<string, string> = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (isProd) headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains';
  return headers;
}

function limitStream(source: Readable, maxBytes: number): Readable {
  let seen = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) cb(new HttpError(413, 'Forespørselen er for stor.'));
      else cb(null, chunk);
    },
  });
  source.on('error', (e) => limiter.destroy(e));
  return source.pipe(limiter);
}

function createContext(req: IncomingMessage, url: URL, maxBodyBytes: number): RequestContext {
  const cookies = parseCookies(req.headers.cookie);
  const ip = clientIp(req);
  let webRequest: Request | null = null;
  let formCache: Promise<FormData> | null = null;
  let bufferCache: Promise<Buffer> | null = null;

  const getWebRequest = () => {
    if (webRequest) return webRequest;
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBodyBytes) throw new HttpError(413, 'Forespørselen er for stor.');
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(', '));
    }
    const body = Readable.toWeb(limitStream(req, maxBodyBytes)) as unknown as ReadableStream;
    webRequest = new Request(url, { method: req.method, headers, body, duplex: 'half' } as RequestInit);
    return webRequest;
  };

  const ctx: RequestContext = {
    req,
    url,
    method: (req.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    params: {},
    query: url.searchParams,
    requestId: randomUUID(),
    nonce: randomBytes(16).toString('base64'),
    ip,
    ipHash: hashIp(ip),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    cookies,
    responseCookies: [],
    session: null,
    user: null,
    org: null,
    csrfToken: '',
    flash: null,
    unreadCount: 0,
    form() {
      formCache ??= (async () => {
        const type = req.headers['content-type'] ?? '';
        if (!type.includes('application/x-www-form-urlencoded') && !type.includes('multipart/form-data')) {
          return new FormData();
        }
        try {
          return await getWebRequest().formData();
        } catch (err) {
          if (err instanceof HttpError) throw err;
          const cause = (err as { cause?: unknown })?.cause;
          if (cause instanceof HttpError) throw cause;
          throw new HttpError(400, 'Kunne ikke lese skjemaet.');
        }
      })();
      return formCache;
    },
    bodyBuffer() {
      bufferCache ??= (async () => {
        try {
          return Buffer.from(await getWebRequest().arrayBuffer());
        } catch (err) {
          const cause = (err as { cause?: unknown })?.cause;
          if (cause instanceof HttpError) throw cause;
          throw err instanceof HttpError ? err : new HttpError(400, 'Kunne ikke lese forespørselen.');
        }
      })();
      return bufferCache;
    },
    tenant(fn) {
      if (!ctx.user) throw new HttpError(401, 'Du må være innlogget.');
      return withTenant({ userId: ctx.user.id, orgId: ctx.org?.id ?? null }, fn);
    },
  };
  return ctx;
}

async function loadAuth(ctx: RequestContext): Promise<void> {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token) {
    const session = await getSession(token);
    if (session) {
      ctx.session = { id: session.sessionId, csrfToken: session.csrfToken };
      ctx.user = session.user;
    } else {
      ctx.responseCookies.push(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isProd }));
    }
  }
  if (ctx.session) {
    ctx.csrfToken = ctx.session.csrfToken;
  } else {
    let guestToken = ctx.cookies[GUEST_CSRF_COOKIE];
    if (!guestToken || guestToken.length < 20 || guestToken.length > 64) {
      guestToken = randomToken(24);
      ctx.responseCookies.push(serializeCookie(GUEST_CSRF_COOKIE, guestToken, { secure: isProd, maxAge: 60 * 60 * 24 }));
    }
    ctx.csrfToken = guestToken;
  }
  const flash = decodeFlash(ctx.cookies[FLASH_COOKIE]);
  if (ctx.cookies[FLASH_COOKIE]) ctx.responseCookies.push(serializeCookie(FLASH_COOKIE, '', { maxAge: 0, secure: isProd }));
  ctx.flash = flash;
}

function originAllowed(ctx: RequestContext): boolean {
  const origin = ctx.req.headers.origin;
  if (origin) return origin === APP_ORIGIN;
  const referer = ctx.req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin === APP_ORIGIN;
    } catch {
      return false;
    }
  }
  // Noen nettlesere sender verken Origin eller Referer; CSRF-tokenet beskytter da.
  return true;
}

async function checkCsrf(ctx: RequestContext): Promise<void> {
  if (!originAllowed(ctx)) throw new HttpError(403, 'Forespørselen kom fra en ukjent kilde.');
  const headerToken = ctx.req.headers['x-csrf-token'];
  let provided = typeof headerToken === 'string' ? headerToken : '';
  if (!provided) {
    const form = await ctx.form();
    const value = form.get('_csrf');
    provided = typeof value === 'string' ? value : '';
  }
  if (!provided || !ctx.csrfToken || !safeEqual(provided, ctx.csrfToken)) {
    throw new HttpError(403, 'Skjemaet er utløpt. Last inn siden på nytt og prøv igjen.');
  }
}

async function dispatch(ctx: RequestContext, router: Router): Promise<Response> {
  const matched = router.match(ctx.method, ctx.path);
  if (matched === null) throw new HttpError(404, 'Siden finnes ikke.');
  if (matched === 'method_not_allowed') throw new HttpError(405, 'Metoden er ikke tillatt.');
  const { route, params } = matched;
  ctx.params = params;
  await refreshLiveSourcesIfStale();

  await loadAuth(ctx);

  if (route.method === 'POST' && route.csrf !== false) await checkCsrf(ctx);

  switch (route.access) {
    case 'public':
      break;
    case 'guest':
      if (ctx.user) return redirect('/app');
      break;
    case 'user':
    case 'org':
    case 'admin': {
      if (!ctx.user) {
        if (ctx.method === 'GET') return redirect(`/logg-inn?neste=${encodeURIComponent(ctx.path + ctx.url.search)}`);
        throw new HttpError(401, 'Du må være innlogget.');
      }
      if (route.access === 'admin' && !ctx.user.isPlatformAdmin) throw new HttpError(404, 'Siden finnes ikke.');
      ctx.org = await loadOrgContext(ctx.user);
      if (route.access === 'org') {
        if (!ctx.org) return redirect('/app/onboarding');
        if (route.requireOnboarding !== false && !ctx.org.onboardingCompleted) return redirect('/app/onboarding');
        if (route.feature && !ctx.org.entitlements[route.feature]) {
          const label = FEATURE_LABELS[route.feature];
          return render(ctx, FeatureLockedPage({ feature: label.name, minPlan: label.minPlan }), {
            title: label.name,
            status: 403,
          });
        }
      }
      if (ctx.org) {
        const rows = (await ctx.tenant(
          (tx) => tx`select count(*)::int as n from notifications where read_at is null`,
        )) as unknown as { n: number }[];
        ctx.unreadCount = rows[0]?.n ?? 0;
      }
      break;
    }
  }
  return route.handler(ctx);
}

async function writeResponse(res: ServerResponse, response: Response, ctx: RequestContext | null, nonce: string, head: boolean) {
  res.statusCode = response.status;
  const sec = securityHeaders(nonce);
  for (const [k, v] of Object.entries(sec)) res.setHeader(k, v);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = [...(response.headers.getSetCookie?.() ?? []), ...(ctx?.responseCookies ?? [])];
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  if (ctx) res.setHeader('X-Request-Id', ctx.requestId);
  if (head || response.body === null) {
    res.end();
    return;
  }
  const buf = Buffer.from(await response.arrayBuffer());
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}

function errorResponse(ctx: RequestContext | null, status: number, message: string): Response {
  const accept = ctx?.req.headers.accept ?? '';
  if (ctx && (accept.includes('application/json') || ctx.path.startsWith('/api/'))) {
    return new Response(JSON.stringify({ error: message, requestId: ctx.requestId }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (!ctx) return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return render(ctx, ErrorPage({ status, message, requestId: ctx.requestId }), {
    title: status === 404 ? 'Fant ikke siden' : 'Noe gikk galt',
    status,
    noindex: true,
  });
}

export function createApp(router: Router) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now();
    let ctx: RequestContext | null = null;
    let status = 500;
    try {
      // Gammel adresse (f.eks. onrender.com) → samme side på APP_URL. Bare i produksjon.
      const canonical = isProd ? canonicalRedirect({ method: req.method, url: req.url, host: req.headers.host }, env.APP_URL) : null;
      if (canonical) {
        // Kort mellomlagring, så en senere domeneendring ikke sitter fast i nettleserne.
        res.writeHead(301, { Location: canonical, 'Cache-Control': 'public, max-age=3600' });
        res.end();
        status = 301;
        return;
      }
      const url = new URL(req.url ?? '/', APP_ORIGIN);
      if (serveStatic(req, res, url.pathname)) {
        status = res.statusCode;
        return;
      }
      const matchedRoute = router.match((req.method ?? 'GET').toUpperCase(), url.pathname);
      const limitMb = matchedRoute && matchedRoute !== 'method_not_allowed' ? (matchedRoute.route.maxBodyMb ?? 1) : 1;
      ctx = createContext(req, url, limitMb * 1024 * 1024);
      const response = await dispatch(ctx, router);
      status = response.status;
      await writeResponse(res, response, ctx, ctx.nonce, req.method === 'HEAD');
    } catch (err) {
      const httpErr = err instanceof HttpError ? err : null;
      status = httpErr?.status ?? 500;
      if (!httpErr || status >= 500) log.error('request_failed', { path: ctx?.path, requestId: ctx?.requestId, err });
      const message =
        httpErr && httpErr.expose ? httpErr.message : 'Noe gikk galt hos oss. Prøv igjen, eller kontakt oss hvis feilen fortsetter.';
      try {
        if (!res.headersSent) {
          await writeResponse(res, errorResponse(ctx, status, message), ctx, ctx?.nonce ?? '', req.method === 'HEAD');
        } else {
          res.end();
        }
      } catch (writeErr) {
        log.error('error_response_failed', { err: writeErr });
        res.end();
      }
    } finally {
      const ms = Math.round(performance.now() - started);
      if (!req.url?.startsWith('/assets/')) {
        log.info('request', { method: req.method, path: req.url?.split('?')[0], status, ms });
      }
    }
  };
}
