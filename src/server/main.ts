import { createServer } from 'node:http';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { closeDb } from '@/lib/db';
import { buildRouter } from '@/routes';
import { createApp } from './app';

const app = createApp(buildRouter());
const server = createServer((req, res) => {
  void app(req, res);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 120_000;

server.listen(env.PORT, () => {
  log.info('server_started', { port: env.PORT, url: env.APP_URL, env: env.NODE_ENV });
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('server_stopping', { signal });
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandled_rejection', { err }));
