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

/** HTTP-kall med tidsavbrudd og forsøk på nytt ved 429/5xx (eksponentiell ventetid). */
export async function fetchWithRetry(url: string, init: RequestInit, opts: { retries?: number; timeoutMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ConnectorError(`HTTP ${res.status}`, res.status);
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
        if (attempt < retries) await new Promise((r) => setTimeout(r, Math.min(waitMs, 30_000)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
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
