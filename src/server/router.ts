import type { Feature } from '@/domain/billing/plans';
import type { Handler } from './http';

/**
 * public – alle
 * guest  – kun utloggede (innloggede sendes til /app)
 * user   – innlogget, uavhengig av organisasjon
 * org    – innlogget med organisasjon (og fullført onboarding om ikke annet er sagt)
 * admin  – plattform-administrator
 */
export type Access = 'public' | 'guest' | 'user' | 'org' | 'admin';

export interface RouteDef {
  method: 'GET' | 'POST';
  path: string;
  access: Access;
  handler: Handler;
  /** CSRF-sjekk for POST (standard: på). Kun webhooks/cron skrur av, og verifiserer på annen måte. */
  csrf?: boolean;
  /** Krever at organisasjonen har fullført onboarding (standard: true for org-ruter). */
  requireOnboarding?: boolean;
  /** Krever en bestemt rettighet i planen. */
  feature?: Feature;
  /** Maks størrelse på forespørselskroppen i MB (standard 1). */
  maxBodyMb?: number;
}

interface CompiledRoute extends RouteDef {
  regex: RegExp;
  keys: string[];
}

export class Router {
  private routes: CompiledRoute[] = [];

  add(def: RouteDef): this {
    const keys: string[] = [];
    const pattern = def.path
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ ...def, regex: new RegExp(`^${pattern}/?$`), keys });
    return this;
  }

  get(path: string, access: Access, handler: Handler, extra: Partial<RouteDef> = {}): this {
    return this.add({ method: 'GET', path, access, handler, ...extra });
  }

  post(path: string, access: Access, handler: Handler, extra: Partial<RouteDef> = {}): this {
    return this.add({ method: 'POST', path, access, handler, ...extra });
  }

  match(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } | 'method_not_allowed' | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      const effectiveMethod = method === 'HEAD' ? 'GET' : method;
      if (route.method !== effectiveMethod) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1] ?? '');
        } catch {
          params[k] = m[i + 1] ?? '';
        }
      });
      return { route, params };
    }
    return pathMatched ? 'method_not_allowed' : null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
