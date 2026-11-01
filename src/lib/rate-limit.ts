import { systemSql } from './db';

/**
 * Fast-vindu rate limiting i Postgres (ingen Redis nødvendig i MVP).
 * Returnerer true hvis forespørselen er innenfor grensen.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const sql = systemSql();
  const rows = (await sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limits.window_start end
    returning count
  `) as unknown as { count: number }[];
  return (rows[0]?.count ?? 0) <= limit;
}

export async function resetRateLimit(key: string): Promise<void> {
  await systemSql()`delete from rate_limits where key = ${key}`;
}
