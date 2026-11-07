import { createServer } from 'node:http';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { closeDb } from '@/lib/db';
import { buildRouter } from '@/routes';
import { installErrorTracking } from '@/domain/ops/errors';
import { startWorker } from '@/worker/runner';
import { createApp } from './app';

// Feil som logges, samles i databasen og oppsummeres for administratoren (Admin → Feil).
installErrorTracking();
const app = createApp(buildRouter());
const server = createServer((req, res) => {
  void app(req, res);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 120_000;

server.listen(env.PORT, () => {
  log.info('server_started', { port: env.PORT, url: env.APP_URL, env: env.NODE_ENV, workerInWeb: env.RUN_WORKER_IN_WEB });
});

// Gratisoppsett: bakgrunnsjobbene kjører i samme prosess. Jobbene låses i databasen, så det er trygt
// også om en egen arbeider skulle kjøre samtidig – men da trengs ikke denne.
const worker = env.RUN_WORKER_IN_WEB ? startWorker('web') : null;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('server_stopping', { signal });
  server.close(async () => {
    await worker?.stop();
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandled_rejection', { err }));
