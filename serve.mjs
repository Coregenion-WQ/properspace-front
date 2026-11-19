// Minimal static server for local evaluation of the mirrored site.
// Correct MIME for .mjs (ES modules require a JS mime) + SPA fallback to index.html.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'public');
const PORT = process.env.PORT || 8090;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.framercms': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.framercms': 'application/octet-stream',
};
createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || (await stat(file)).isDirectory()) {
      const ext = path.extname(p);
      if (!ext) {
        // Prefer a pre-rendered page at <route>/index.html; else SPA fallback to home.
        const pageIndex = path.join(ROOT, p, 'index.html');
        file = existsSync(pageIndex) ? pageIndex : path.join(ROOT, 'index.html');
      } else { res.writeHead(404).end('Not found: ' + p); console.log('404', p); return; }
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) { res.writeHead(500).end(String(e)); }
}).listen(PORT, () => console.log(`Serving public/ at http://localhost:${PORT}`));
