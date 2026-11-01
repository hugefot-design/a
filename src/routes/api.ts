import { systemSql } from '@/lib/db';
import { json } from '@/server/http';
import type { Router } from '@/server/router';

export function registerApiRoutes(router: Router): void {
  // Enkel helsesjekk for lastbalanserer/overvåking. Avslører ingen detaljer.
  router.get('/api/health', 'public', async () => {
    const started = Date.now();
    try {
      await systemSql()`select 1`;
      return json({ ok: true, db: 'ok', ms: Date.now() - started });
    } catch {
      return json({ ok: false, db: 'unavailable' }, { status: 503 });
    }
  });
}
