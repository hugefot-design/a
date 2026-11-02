/**
 * Bakgrunnsarbeider: jobbkø, planlagt datainnhenting, varsler, e-post og opprydding.
 *   npm run worker        (produksjon, etter npm run build)
 *   npm run worker:dev    (utvikling)
 *
 * Kjør én arbeider per miljø. Flere arbeidere er trygt (jobber låses med SKIP LOCKED),
 * men planlagte oppgaver registreres slik at de bare kjøres én gang per intervall.
 * Selve løkken ligger i src/worker/runner.ts (kan også kjøre i nettsiden, se RUN_WORKER_IN_WEB).
 */
import { closeDb } from '../src/lib/db';
import { startWorker } from '../src/worker/runner';

const worker = startWorker('worker');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker.stop();
  await closeDb();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
