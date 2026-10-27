import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.HELIANTHE_SITE_ROOT || fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || process.argv[process.argv.indexOf('--port') + 1] || 4177);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
};

function safePath(urlPath) {
  const requestPath = decodeURIComponent(urlPath).replace(/^\/helianthe(?:\/|$)/, '/helianthe/');
  const candidate = resolve(join(root, requestPath.replace(/^\//, '')));
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) return null;
  return candidate;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    let filePath = safePath(requestUrl.pathname);
    if (!filePath) { response.writeHead(403); response.end('Forbidden'); return; }
    try { if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html'); }
    catch { response.writeHead(404); response.end('Not found'); return; }
    const body = await readFile(filePath);
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    if (request.method === 'HEAD') response.end(); else response.end(body);
  } catch {
    response.writeHead(400);
    response.end('Bad request');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Helianthe local preview: http://127.0.0.1:${port}/helianthe/`);
});
