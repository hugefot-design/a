import type { IncomingMessage } from 'node:http';
import type { Entitlements, BillingState, PlanId } from '@/domain/billing/plans';
import type { Tx } from '@/lib/db';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  currentOrgId: string | null;
}

export interface Membership {
  orgId: string;
  name: string;
  role: OrgRole;
}

export interface OrgContext {
  id: string;
  name: string;
  role: OrgRole;
  plan: PlanId;
  entitlements: Entitlements;
  billing: BillingState;
  onboardingCompleted: boolean;
  memberships: Membership[];
}

export interface Flash {
  type: 'success' | 'error' | 'info';
  message: string;
}

export interface RequestContext {
  req: IncomingMessage;
  url: URL;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  requestId: string;
  nonce: string;
  ip: string;
  ipHash: string;
  userAgent: string;
  cookies: Record<string, string>;
  responseCookies: string[];
  session: { id: string; csrfToken: string } | null;
  user: AuthUser | null;
  org: OrgContext | null;
  csrfToken: string;
  flash: Flash | null;
  unreadCount: number;
  form(): Promise<FormData>;
  bodyBuffer(): Promise<Buffer>;
  /** Kjør spørringer med RLS-kontekst for innlogget bruker (og valgt org). */
  tenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export type Handler = (ctx: RequestContext) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public expose = true,
  ) {
    super(message);
  }
}

export function notFound(message = 'Siden finnes ikke.'): never {
  throw new HttpError(404, message);
}

export function forbidden(message = 'Du har ikke tilgang til dette.'): never {
  throw new HttpError(403, message);
}

export function badRequest(message = 'Ugyldig forespørsel.'): never {
  throw new HttpError(400, message);
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Svar
// ---------------------------------------------------------------------------
export function redirect(location: string, status = 303): Response {
  return new Response(null, { status, headers: { Location: location } });
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function text(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(body, { ...init, headers });
}

/** Tillat kun relative lenker innenfor appen (hindrer åpne omdirigeringer). */
/** Der en bruker havner etter innlogging: plattform-administratorer i admin-panelet, alle andre i appen. */
export function homePath(user: { isPlatformAdmin: boolean } | null | undefined): string {
  return user?.isPlatformAdmin ? '/admin' : '/app';
}

export function safeRedirectPath(value: string | null | undefined, fallback = '/app'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}

export function wantsJson(ctx: RequestContext): boolean {
  return (ctx.req.headers.accept ?? '').includes('application/json');
}
