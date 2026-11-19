// Pass 3: recursively resolve the FULL Framer module graph.
// Chunks import siblings by relative path ("./chunk-X.mjs", "./x.framercms", …).
// We keep them all in js/ with original basenames so those relative imports stay
// valid, and we crawl transitively until closure so no lazy route/CMS/search
// module 404s at runtime. Also localizes absolute CDN asset URLs in every file.

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || '/Users/holgerleitermann/dev/psfront/public';
const BASE = 'https://framerusercontent.com/sites/biXhyxCOriw4tTF54AOXM/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const REFERER = 'https://remarkable-operations-836315.framer.app/';
for (const d of ['fonts', 'images', 'js', 'data']) await mkdir(path.join(OUT, d), { recursive: true });

// Fixed regex: longer/more-specific extensions first so "json"/"mjs" beat "js".
const CDN = '(?:framerusercontent\\.com|app\\.framerstatic\\.com|fonts\\.gstatic\\.com)';
const ASSET_RE = new RegExp(`https://${CDN}/[A-Za-z0-9._/-]+\\.(?:mjs|json|framercms|js|woff2|woff|ttf|jpe?g|png|webp|gif|svg|avif|ico)`, 'g');
// relative sibling specifiers inside module code: "./name.ext" or './name.ext'
const REL_RE = /["'`]\.\/([A-Za-z0-9._-]+\.(?:mjs|js|framercms|json))["'`]/g;

const TEXT = /\.(mjs|js|framercms|json)$/i;
function assetDir(name) {
  if (/\.(mjs|js|framercms)$/i.test(name)) return 'js';
  if (/\.json$/i.test(name)) return 'data';
  if (/\.(woff2|woff|ttf)$/i.test(name)) return 'fonts';
  return 'images';
}
function localRootFor(url) {
  const base = decodeURIComponent(url.split('?')[0].split('/').pop());
  const dir = assetDir(base);
  return { dir, base, root: `/${dir}/${base}`, abs: path.join(OUT, dir, base) };
}
async function fetchBuf(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': REFERER } });
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

const seen = new Set();          // basenames of sibling modules already handled
const queue = [];                // basenames to fetch+parse from BASE

// seed from existing js/ text files
for (const f of await readdir(path.join(OUT, 'js'))) {
  if (TEXT.test(f)) { seen.add(f); queue.push(f); }
}

let fetched = 0, parsed = 0;
const absToLocalize = new Set(); // absolute CDN asset urls discovered (fonts/images/json)

async function ensureSibling(name) {
  const abs = path.join(OUT, 'js', name);
  if (existsSync(abs)) return await readFile(abs, TEXT.test(name) ? 'utf8' : null);
  const buf = await fetchBuf(BASE + name);
  if (!buf) { console.error('  miss', name); return null; }
  await writeFile(abs, buf); fetched++;
  return TEXT.test(name) ? buf.toString('utf8') : buf;
}

// BFS over the module graph
while (queue.length) {
  const batch = queue.splice(0, 16);
  await Promise.all(batch.map(async (name) => {
    let txt;
    const abs = path.join(OUT, 'js', name);
    if (existsSync(abs) && TEXT.test(name)) txt = await readFile(abs, 'utf8');
    else { const r = await ensureSibling(name); txt = typeof r === 'string' ? r : null; }
    if (txt == null) return;
    parsed++;
    // discover new relative siblings
    for (const m of txt.matchAll(REL_RE)) {
      const dep = m[1];
      if (!seen.has(dep)) { seen.add(dep); queue.push(dep); }
    }
    // discover absolute CDN assets (to download + localize later)
    for (const u of txt.match(ASSET_RE) || []) {
      // sibling .mjs/.js under our BASE are handled via REL path already; skip those
      if (u.startsWith(BASE) && /\.(mjs|js|framercms)$/.test(u)) {
        const b = u.split('/').pop();
        if (!seen.has(b)) { seen.add(b); queue.push(b); }
      } else absToLocalize.add(u);
    }
  }));
  if (parsed % 32 === 0) console.log(`  parsed ${parsed}, fetched ${fetched}, queue ${queue.length}`);
}
console.log(`Module graph closed: ${seen.size} modules, ${fetched} newly fetched.`);

// download all discovered absolute CDN assets (fonts/images/json) not present
const absList = [...absToLocalize];
let dl = 0;
const q2 = [...absList];
async function w() {
  while (q2.length) {
    const url = q2.shift(); const { abs } = localRootFor(url);
    if (!existsSync(abs)) { const b = await fetchBuf(url); if (b) { await writeFile(abs, b); dl++; } }
  }
}
await Promise.all(Array.from({ length: 12 }, w));
console.log(`Downloaded ${dl} additional CDN assets (fonts/images/json).`);

// localize absolute CDN urls -> root-relative in EVERY text file under js/ and data/
let rw = 0;
for (const dir of ['js', 'data']) {
  for (const f of await readdir(path.join(OUT, dir))) {
    const p = path.join(OUT, dir, f);
    if (!TEXT.test(f)) continue;
    const t = await readFile(p, 'utf8');
    const nt = t.replace(ASSET_RE, (u) => (u.startsWith(BASE) && /\.(mjs|js|framercms)$/.test(u))
      ? './' + u.split('/').pop()            // keep sibling modules relative
      : localRootFor(u).root);
    if (nt !== t) { await writeFile(p, nt); rw++; }
  }
}
console.log(`Localized CDN refs in ${rw} text files.`);
console.log('DONE pass 3.');
