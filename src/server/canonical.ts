/**
 * Kanonisk adresse. Sider som åpnes på en annen vertsadresse enn APP_URL – for eksempel den gamle
 * onrender.com-adressen etter at eget domene er tatt i bruk – sendes videre til samme sti på APP_URL.
 *
 * Det trengs fordi skjemaer bare godtas fra APP_URL (CSRF-sjekken i app.ts): uten videresending
 * ville innlogging og registrering feile på den gamle adressen, og søkemotorer ville se to kopier
 * av nettstedet. Bare GET og HEAD sendes videre. API-ruter (helsesjekk, webhooks, cron) sendes
 * aldri videre: de kalles av maskiner som ikke nødvendigvis følger omdirigeringer.
 */
export function canonicalRedirect(req: { method?: string; url?: string; host?: string | null }, appUrl: string): string | null {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;
  const path = req.url && req.url.startsWith('/') ? req.url : '/';
  if (path === '/api' || path.startsWith('/api/') || path.startsWith('/api?')) return null;
  const host = (req.host ?? '').trim().toLowerCase();
  if (!host) return null;
  const app = new URL(appUrl);
  if (host === app.host.toLowerCase()) return null;
  // Stien og spørringen settes hver for seg på APP_URL, så målet aldri kan bli et annet nettsted
  // («//annet.no» blir en sti), og tegn som ikke er lov i en Location-header, kodes.
  const target = new URL(app.origin);
  const q = path.indexOf('?');
  target.pathname = q === -1 ? path : path.slice(0, q);
  target.search = q === -1 ? '' : path.slice(q);
  return target.href;
}
