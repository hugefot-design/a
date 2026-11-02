/**
 * Hjelpere for databaseadresser (ingen avhengigheter – brukes før konfigurasjonen er lest).
 *
 * Gjør oppsettet hos Supabase/Render enklere: i stedet for to adresser kan man sette
 * DATABASE_ADMIN_URL og et eget passord for app-rollen (DATABASE_APP_PASSWORD). App-adressen
 * lages da av admin-adressen, og migreringen oppretter rollen hvis den mangler.
 */
export const APP_ROLE = 'anbudradar_app';

export function isPostgresUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'postgres:' || u.protocol === 'postgresql:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Samme vert, port og database som admin-adressen, men brukeren anbudradar_app og eget passord.
 * Supabase-pooleren bruker brukernavnet «rolle.prosjekt» – prosjektdelen beholdes.
 */
export function deriveAppDatabaseUrl(adminUrl: string, appPassword: string): string | null {
  if (!isPostgresUrl(adminUrl) || !appPassword) return null;
  const u = new URL(adminUrl.trim());
  const user = decodeURIComponent(u.username);
  const m = /^[^.]+(\..+)?$/.exec(user);
  if (!m) return null;
  u.username = `${APP_ROLE}${m[1] ?? ''}`;
  u.password = encodeURIComponent(appPassword);
  return u.toString();
}

/**
 * Setter passordet inn i en adresse (erstatter også Supabase-plassholderen «[YOUR-PASSWORD]»).
 * Spesialtegn kodes riktig, så passordet kan limes inn som det er.
 */
export function withPassword(url: string, password: string): string | null {
  if (!isPostgresUrl(url) || !password) return null;
  const u = new URL(url.trim());
  u.password = encodeURIComponent(password);
  return u.toString();
}

/** Rolle (uten Supabase-poolerens «.prosjekt») og passord fra en adresse. */
export function credentialsOf(url: string): { role: string; password: string } | null {
  if (!isPostgresUrl(url)) return null;
  const u = new URL(url.trim());
  const role = decodeURIComponent(u.username).split('.')[0] ?? '';
  const password = decodeURIComponent(u.password);
  return role && password ? { role, password } : null;
}
