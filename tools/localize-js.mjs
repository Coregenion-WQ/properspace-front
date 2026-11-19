// Pass 2: localize every CDN asset URL referenced *inside* the JS chunks and
// the searchIndex JSON, so nothing loads from Framer's servers at runtime.
// Uses ROOT-RELATIVE paths (/fonts/..) because many of these URLs get injected
// into document-level <style> or used as fetch/img.src, whose resolution base
// is the page (not the module). Root-relative is unambiguous when public/ is docroot.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || '/Users/holgerleitermann/dev/psfront/public';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
for (const d of ['fonts', 'images', 'js', 'data']) await mkdir(path.join(OUT, d), { recursive: true });

const CDN = '(?:framerusercontent\\.com|app\\.framerstatic\\.com|fonts\\.gstatic\\.com)';
const ASSET_RE = new RegExp(`https://${CDN}/[A-Za-z0-9._/-]+\\.(?:mjs|js|woff2?|ttf|jpe?g|png|webp|gif|svg|avif|ico|json)`, 'g');

function localFor(url) {
  const base = decodeURIComponent(url.split('?')[0].split('/').pop());
  let dir;
  if (/\.(mjs|js)$/i.test(base)) dir = 'js';
  else if (/\.(woff2?|ttf)$/i.test(base)) dir = 'fonts';
  else if (/\.json$/i.test(base)) dir = 'data';
  else dir = 'images';
  return { dir, base, root: `/${dir}/${base}`, abs: path.join(OUT, dir, base) };
}
async function download(url, dest) {
  if (existsSync(dest)) return true;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) { console.error('  FAIL', r.status, url); return false; }
    await writeFile(dest, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch (e) { console.error('  ERR', url, e.message); return false; }
}

// ---- collect all target URLs across JS + HTML ----
const jsFiles = (await readdir(path.join(OUT, 'js'))).filter(f => /\.mjs$/.test(f));
const texts = new Map();
const urls = new Set();
for (const f of jsFiles) {
  const p = path.join(OUT, 'js', f);
  const t = await readFile(p, 'utf8');
  texts.set(p, t);
  for (const u of t.match(ASSET_RE) || []) urls.add(u);
}
// searchIndex JSON referenced in HTML
const htmlPath = path.join(OUT, 'index.html');
let html = await readFile(htmlPath, 'utf8');
for (const u of html.match(ASSET_RE) || []) urls.add(u);

console.log(`Pass 2: ${urls.size} unique CDN asset URLs referenced inside JS/HTML.`);

// ---- download the ones we don't have yet ----
const list = [...urls];
let got = 0, n = 0;
const q = [...list];
async function worker() {
  while (q.length) {
    const url = q.shift();
    const { abs } = localFor(url);
    if (await download(url, abs)) got++;
    if (++n % 25 === 0) console.log(`  processed ${n}/${list.length}`);
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
console.log(`Ensured ${got} files present locally.`);

// ---- rewrite JS files ----
let rewritten = 0;
for (const [p, t] of texts) {
  const nt = t.replace(ASSET_RE, (u) => localFor(u).root);
  if (nt !== t) { await writeFile(p, nt); rewritten++; }
}
console.log(`Rewrote ${rewritten} JS files.`);

// ---- rewrite the JSON search index (and its internal asset refs) ----
for (const f of await readdir(path.join(OUT, 'data'))) {
  const p = path.join(OUT, 'data', f);
  let t = await readFile(p, 'utf8');
  const nt = t.replace(ASSET_RE, (u) => localFor(u).root);
  if (nt !== t) await writeFile(p, nt);
}

// ---- rewrite HTML: searchIndex meta + make asset paths root-relative + neutralize editor import ----
html = html.replace(ASSET_RE, (u) => localFor(u).root);
// existing relative local paths -> root-relative for consistency at docroot
html = html.replace(/(src|href)="(css|js|images|fonts|data)\//g, '$1="/$2/');
await writeFile(htmlPath, html);
console.log('Rewrote index.html (root-relative + local searchIndex).');
console.log('DONE pass 2.');
