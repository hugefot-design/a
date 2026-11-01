import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isProd } from '@/lib/env';

const PUBLIC_DIR = resolve(process.cwd(), 'public');

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const ROOT_FILES = new Set(['/favicon.svg', '/robots.txt']);

/** Serverer filer fra /public. Returnerer true hvis forespørselen ble håndtert. */
export function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!pathname.startsWith('/assets/') && !ROOT_FILES.has(pathname)) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const filePath = normalize(join(PUBLIC_DIR, decoded));
  if (!filePath.startsWith(PUBLIC_DIR + sep)) return false;

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const hashed = /\.[0-9a-f]{8,}\.(css|js|woff2?)$/.test(filePath);
  const cacheControl = hashed && isProd ? 'public, max-age=31536000, immutable' : isProd ? 'public, max-age=3600' : 'no-cache';

  res.setHeader('Content-Type', TYPES[extname(filePath)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (pathname.includes('/fonts/')) res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return true;
  }
  res.setHeader('Content-Length', stat.size);
  res.statusCode = 200;
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(filePath).pipe(res);
  return true;
}
