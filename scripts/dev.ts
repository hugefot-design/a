/**
 * Lokal utvikling: bygger CSS/JS ved endringer og starter serveren med automatisk omstart.
 *   npm run dev
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { context } from 'esbuild';
import { buildAssets } from './build';

const root = process.cwd();
const children: ChildProcess[] = [];

function run(cmd: string, args: string[], name: string) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`[${name}] avsluttet med kode ${code}`);
  });
  children.push(child);
}

async function main() {
  await buildAssets(true);
  const tw = join(root, 'node_modules', '.bin', 'tailwindcss');
  run(existsSync(tw) ? tw : 'tailwindcss', ['-i', 'src/styles/app.css', '-o', 'public/assets/app.css', '--watch'], 'tailwind');

  const ctx = await context({
    entryPoints: ['src/client/main.ts'],
    outfile: 'public/assets/app.js',
    bundle: true,
    format: 'esm',
    target: ['es2020'],
    sourcemap: 'inline',
    logLevel: 'info',
  });
  await ctx.watch();

  run(join(root, 'node_modules', '.bin', 'tsx'), ['watch', '--clear-screen=false', 'src/server/main.ts'], 'server');
}

function shutdown() {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error(err);
  shutdown();
});
