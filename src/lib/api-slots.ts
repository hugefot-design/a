/**
 * Tempo mot eksterne API-er, delt mellom alle prosesser via databasen.
 *
 * reserveSlot() gir hver kaller sin egen tidsluke med minst `intervalMs` mellom lukene. Kalleren
 * venter til luken sin før den sender forespørselen. Fordi reservasjonen er én atomisk
 * upsert, kan ikke to prosesser få samme luke. deferSlots() skyver alle kommende luker etter en
 * HTTP 429 (Retry-After), slik at også andre prosesser venter.
 */
import { systemSql } from './db';

export interface SlotProvider {
  /** Reserverer neste luke og returnerer hvor mange millisekunder kalleren må vente. */
  reserve(key: string, intervalMs: number): Promise<number>;
  /** Ingen luker før `untilMs` millisekunder fra nå (brukes etter 429). */
  defer(key: string, untilMs: number): Promise<void>;
}

export const dbSlots: SlotProvider = {
  async reserve(key, intervalMs) {
    const rows = (await systemSql()`
      insert into api_slots (key, next_at) values (${key}, clock_timestamp() + make_interval(secs => ${intervalMs / 1000}))
      on conflict (key) do update set
        next_at = greatest(api_slots.next_at, clock_timestamp()) + make_interval(secs => ${intervalMs / 1000}),
        updated_at = clock_timestamp()
      returning greatest(0, extract(epoch from (next_at - make_interval(secs => ${intervalMs / 1000}) - clock_timestamp())) * 1000)::float8 as wait_ms
    `) as unknown as { waitMs: number }[];
    return Math.max(0, Math.ceil(rows[0]?.waitMs ?? 0));
  },
  async defer(key, untilMs) {
    await systemSql()`
      insert into api_slots (key, next_at) values (${key}, clock_timestamp() + make_interval(secs => ${untilMs / 1000}))
      on conflict (key) do update set
        next_at = greatest(api_slots.next_at, clock_timestamp() + make_interval(secs => ${untilMs / 1000})),
        updated_at = clock_timestamp()
    `;
  },
};

/** For tester og verktøy uten database: samme regler, bare i minnet til denne prosessen. */
export function memorySlots(now: () => number = Date.now): SlotProvider {
  const next = new Map<string, number>();
  return {
    async reserve(key, intervalMs) {
      const t = now();
      const slot = Math.max(next.get(key) ?? t, t);
      next.set(key, slot + intervalMs);
      return slot - t;
    },
    async defer(key, untilMs) {
      const t = now();
      next.set(key, Math.max(next.get(key) ?? t, t + untilMs));
    },
  };
}
