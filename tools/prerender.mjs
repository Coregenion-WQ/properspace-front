// Pre-render each real route into its own local HTML file so deep links /
// hard-refresh show the correct page (not the home page via SPA fallback).
// Reuses the already-local shared js/fonts; downloads any NEW images and makes
// resized variants (replicating Framer's ?scale-down-to CDN).

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PUB = '/Users/holgerleitermann/dev/psfront/public';
const BASE = 'https://remarkable-operations-836315.framer.app';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const routes = readFileSync('/tmp/routes-to-render.txt', 'utf8').split('\n').filter(Boolean);

const CDN = '(?:framerusercontent\\.com|app\\.framerstatic\\.com|fonts\\.gstatic\\.com)';
const ASSET_RE = new RegExp(`https://${CDN}/[A-Za-z0-9._/-]+\\.(?:mjs|json|framercms|js|woff2|woff|ttf|jpe?g|png|webp|gif|svg|avif|ico|mp4)`, 'g');
const sh = (c, a) => execFileSync(c, a, { stdio: ['ignore', 'ignore', 'ignore'] });
const CAP = 2560;

async function fetchText(u) { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.text(); }
async function fetchBuf(u) { const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: BASE + '/' } }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }

function dirFor(name) {
  if (/\.(mjs|js|framercms)$/i.test(name)) return 'js';
  if (/\.json$/i.test(name)) return 'data';
  if (/\.(woff2|woff|ttf)$/i.test(name)) return 'fonts';
  if (/\.mp4$/i.test(name)) return 'videos';
  return 'images';
}
async function ensureLocal(url) {           // download asset if missing; return root path
  const name = decodeURIComponent(url.split('?')[0].split('/').pop());
  const dir = dirFor(name); const abs = path.join(PUB, dir, name);
  if (!existsSync(abs)) { const b = await fetchBuf(url); if (b) writeFileSync(abs, b); }
  return `/${dir}/${name}`;
}
function dims(f) { const o = execFileSync('sips', ['-g', 'pixelWidth', f], { encoding: 'utf8' }); return +(/pixelWidth: (\d+)/.exec(o)?.[1] || 0); }
function makeVariant(name, N) {              // ensure images/NAME-N.ext exists; return its basename or original
  const abs = path.join(PUB, 'images', name);
  if (!existsSync(abs)) return name;
  const ext = name.slice(name.lastIndexOf('.')); const stem = name.slice(0, name.lastIndexOf('.'));
  let ow = 0; try { ow = dims(abs); } catch { ow = CAP; }
  if (ow && N >= ow) return name;
  const outName = `${stem}-${N}${ext}`; const out = path.join(PUB, 'images', outName);
  if (!existsSync(out)) {
    try {
      if (/\.webp$/i.test(name)) { sh('dwebp', [abs, '-o', '/tmp/_p.png']); sh('sips', ['-Z', String(N), '/tmp/_p.png', '--out', '/tmp/_pr.png']); sh('cwebp', ['-quiet', '-q', '82', '/tmp/_pr.png', '-o', out]); }
      else sh('sips', ['-s', 'format', /\.png$/i.test(name) ? 'png' : 'jpeg', '-s', 'formatOptions', '72', '-Z', String(N), abs, '--out', out]);
    } catch { return name; }
  }
  return outName;
}
function compressOriginal(name) {
  const abs = path.join(PUB, 'images', name);
  if (!existsSync(abs) || !/\.(jpe?g|png)$/i.test(name)) return;
  try { if (dims(abs) > CAP) sh('sips', ['-s', 'format', /\.png$/i.test(name) ? 'png' : 'jpeg', '-s', 'formatOptions', '72', '-Z', String(CAP), abs, '--out', abs]); } catch {}
}

let ok = 0, fail = 0;
for (const route of routes) {
  let html;
  try { html = await fetchText(BASE + route); } catch (e) { console.log('  SKIP', route, e.message); fail++; continue; }

  // 1) download every asset this page needs (new images/fonts; mjs already local)
  const urls = [...new Set(html.match(ASSET_RE) || [])];
  const localMap = new Map();
  for (const u of urls) localMap.set(u, await ensureLocal(u));

  // 2) rewrite absolute CDN asset URLs -> local root paths
  html = html.replace(ASSET_RE, (u) => localMap.get(u) || u);

  // 3) images with ?scale-down-to=N -> resized variant (both /images/ and images/ forms)
  html = html.replace(/((?:\.?\/)?images\/)([A-Za-z0-9._-]+)\.(jpe?g|png|webp)\?scale-down-to=(\d+)/g,
    (m, pre, stem, ext, n) => `/images/${makeVariant(`${stem}.${ext}`, +n)}`);
  // 4) bare image refs -> compress the original in place
  for (const m of html.matchAll(/(?:\.?\/)?images\/([A-Za-z0-9._-]+\.(?:jpe?g|png))/g)) compressOriginal(m[1]);
  // normalise remaining relative asset refs to root-relative
  html = html.replace(/(src|href)="(?:\.\/)?(images|fonts|js|css|data|videos)\//g, '$1="/$2/');
  // 5) strip Framer analytics beacon
  html = html.replace(/<script[^>]*events\.framer\.com[\s\S]*?<\/script>/g, '');

  // 6) write to public/ROUTE/index.html
  const outDir = path.join(PUB, route.replace(/^\//, ''));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'index.html'), html);
  ok++; if (ok % 5 === 0) console.log(`  rendered ${ok}/${routes.length}…`);
}
console.log(`Pre-rendered ${ok} routes (${fail} skipped).`);
