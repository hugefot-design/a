import type { NormalizedNotice, SourceId } from '@/domain/tenders/normalize';

export interface FetchWindow {
  /** Hent kunngjøringer publisert fra og med denne datoen. */
  since: Date;
  /** Valgfri øvre grense. */
  until?: Date;
  /** Maks antall kunngjøringer (sikkerhetsgrense). */
  limit?: number;
}

export interface ConnectorStatus {
  configured: boolean;
  message: string;
}

/**
 * Felles grensesnitt for datakilder. Nye land legges til ved å lage en ny connector
 * som oversetter kildens format til NormalizedNotice.
 */
export interface SourceConnector {
  id: SourceId;
  name: string;
  status(): ConnectorStatus;
  /** Henter og normaliserer kunngjøringer. Kaster ved feil som stopper hele kjøringen. */
  fetch(window: FetchWindow, onError: (sourceNoticeId: string | null, error: string, raw: unknown) => Promise<void>): Promise<NormalizedNotice[]>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** Ventetid fra Retry-After (sekunder eller HTTP-dato), ellers null. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Eksponentiell ventetid med tilfeldig spredning (unngår at mange klienter prøver samtidig). */
export function backoffMs(attempt: number, baseMs = 1000): number {
  return Math.round(baseMs * 2 ** attempt * (0.75 + Math.random() * 0.5));
}

let retryDelayFactor = 1;
/** Kun for tester: kort ned ventetidene. */
export function setRetryDelayFactor(factor: number): void {
  retryDelayFactor = factor;
}

/** HTTP-kall med tidsavbrudd og nye forsøk ved 408/429/5xx og nettverksfeil (eksponentiell ventetid). */
export async function fetchWithRetry(url: string, init: RequestInit, opts: { retries?: number; timeoutMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        lastErr = new ConnectorError(`HTTP ${res.status}`, res.status);
        const waitMs = retryAfterMs(res.headers.get('retry-after')) ?? backoffMs(attempt);
        await res.body?.cancel().catch(() => {});
        if (attempt < retries) await sleep(Math.min(waitMs, 60_000) * retryDelayFactor);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(backoffMs(attempt) * retryDelayFactor);
    }
  }
  if (lastErr instanceof ConnectorError) throw lastErr;
  // Gjør nettverksfeil forståelige i adminpanelet ("fetch failed" sier lite).
  const cause = lastErr instanceof Error ? ((lastErr.cause as { code?: string; message?: string } | undefined) ?? null) : null;
  const detail = cause?.code ?? cause?.message ?? (lastErr instanceof Error ? lastErr.message : String(lastErr));
  throw new ConnectorError(`Fikk ikke kontakt med ${new URL(url).host} etter ${retries + 1} forsøk (${detail}).`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
