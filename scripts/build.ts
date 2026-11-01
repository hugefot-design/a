/**
 * Produksjonsbygg:
 *  1. CSS med Tailwind (minifisert, innholds-hash i filnavnet)
 *  2. Klientskript med esbuild
 *  3. Server, arbeider og CLI-skript til dist/
 *
 * Bruk:  npm run build            (produksjon)
 *        tsx scripts/build.ts --assets-only --dev   (brukes av npm run dev)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const assetsDir = join(root, 'public', 'assets');
const dev = process.argv.includes('--dev');
const assetsOnly = process.argv.includes('--assets-only');

function tailwindBin(): string {
  const local = join(root, 'node_modules', '.bin', 'tailwindcss');
  return existsSync(local) ? local : 'tailwindcss';
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10);
}

export async function buildAssets(isDev: boolean): Promise<Record<string, string>> {
  mkdirSync(assetsDir, { recursive: true });
  for (const f of readdirSync(assetsDir)) {
    if (/^app(\.[0-9a-f]{10})?\.(css|js)(\.map)?$/.test(f)) rmSync(join(assetsDir, f));
  }

  execFileSync(tailwindBin(), ['-i', 'src/styles/app.css', '-o', join(assetsDir, 'app.css'), ...(isDev ? [] : ['--minify'])], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  await build({
    entryPoints: ['src/client/main.ts'],
    outfile: join(assetsDir, 'app.js'),
    bundle: true,
    format: 'esm',
    target: ['es2020'],
    minify: !isDev,
    sourcemap: isDev ? 'inline' : false,
    logLevel: 'warning',
  });

  const manifest: Record<string, string> = {};
  for (const name of ['app.css', 'app.js']) {
    if (isDev) {
      manifest[name] = name;
      continue;
    }
    const hashed = name.replace(/\.(css|js)$/, `.${hashFile(join(assetsDir, name))}.$1`);
    renameSync(join(assetsDir, name), join(assetsDir, hashed));
    manifest[name] = hashed;
  }
  writeFileSync(join(assetsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function buildServer(): Promise<void> {
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  await build({
    entryPoints: {
      server: 'src/server/main.ts',
      worker: 'scripts/worker.ts',
      migrate: 'scripts/migrate.ts',
      ingest: 'scripts/ingest.ts',
      'make-admin': 'scripts/make-admin.ts',
      'import-file': 'scripts/import-file.ts',
      'import-cpv': 'scripts/import-cpv.ts',
    },
    outdir: 'dist',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node22'],
    packages: 'external',
    jsx: 'automatic',
    sourcemap: true,
    logLevel: 'warning',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
}

const isMain = process.argv[1]?.endsWith('build.ts');
if (isMain) {
  const started = Date.now();
  buildAssets(dev)
    .then(async (manifest) => {
      console.log(`Ressurser: ${Object.values(manifest).join(', ')}`);
      if (!assetsOnly) {
        await buildServer();
        console.log('Server og skript bygget til dist/');
      }
      console.log(`Ferdig på ${((Date.now() - started) / 1000).toFixed(1)} s`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
