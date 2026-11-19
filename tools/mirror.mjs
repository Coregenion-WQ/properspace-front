// Framer -> static localizer
// Downloads all primary assets referenced by the homepage into an organized
// public/ folder (css/ js/ fonts/ images/) and rewrites every URL to a local
// relative path so the site is self-hosted, not hotlinking Framer's CDN.

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SITE = 'https://remarkable-operations-836315.framer.app/';
const OUT = process.argv[2] || '/Users/holgerleitermann/dev/psfront/public';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const dirs = { css: 'css', js: 'js', fonts: 'fonts', images: 'images' };
for (const d of Object.values(dirs)) await mkdir(path.join(OUT, d), { recursive: true });

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.text();
}
async function fetchBin(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---- URL -> local mapping -------------------------------------------------
const used = new Set();
const map = new Map(); // absolute url -> { local: 'images/foo.jpg', dir }
function classify(url) {
  const clean = url.split('?')[0].split('#')[0];
  let base = decodeURIComponent(clean.split('/').pop());
  let dir;
  if (/\.mjs$/i.test(base)) dir = dirs.js;
  else if (/\.woff2?$/i.test(base) || /\.ttf$/i.test(base)) dir = dirs.fonts;
  else if (/\.(jpe?g|png|webp|gif|svg|avif|ico)$/i.test(base)) dir = dirs.images;
  else return null; // not an asset we localize
  // ensure unique filename
  let name = base, i = 1;
  while (used.has(dir + '/' + name)) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
    name = `${stem}-${i++}${ext}`;
  }
  used.add(dir + '/' + name);
  const rec = { local: `${dir}/${name}`, dir };
  map.set(url, rec);
  return rec;
}

// Match every absolute asset URL on the three CDNs we care about.
const ASSET_RE = /https:\/\/(?:framerusercontent\.com|app\.framerstatic\.com|fonts\.gstatic\.com)\/[A-Za-z0-9._\/-]+\.(?:mjs|woff2?|ttf|jpe?g|png|webp|gif|svg|avif|ico)/g;

// ---- 1. Homepage ----------------------------------------------------------
console.log('Fetching homepage…');
let html = await fetchText(SITE);

// Extract <style> blocks -> css/styles.css
const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
let css = '', m, firstStyleIndex = -1, styleMatches = [];
while ((m = styleRe.exec(html)) !== null) { styleMatches.push(m); css += m[1] + '\n'; }

// Collect asset URLs from HTML + CSS
const urls = new Set();
for (const u of html.match(ASSET_RE) || []) urls.add(u);
for (const u of css.match(ASSET_RE) || []) urls.add(u);
console.log(`Found ${urls.size} unique assets to download.`);

for (const u of urls) classify(u);

// ---- 2. Download all ------------------------------------------------------
let done = 0;
const entries = [...map.entries()];
async function pool(items, n, fn) {
  const q = [...items]; const running = [];
  async function next() { if (!q.length) return; const it = q.shift(); await fn(it); return next(); }
  for (let i = 0; i < n; i++) running.push(next());
  await Promise.all(running);
}
await pool(entries, 12, async ([url, rec]) => {
  const dest = path.join(OUT, rec.local);
  try {
    const buf = await fetchBin(url);
    await writeFile(dest, buf);
  } catch (e) { console.error('FAIL', url, e.message); }
  done++; if (done % 20 === 0) console.log(`  downloaded ${done}/${map.size}`);
});
console.log(`Downloaded ${done} files.`);

// ---- 3. Rewrite CSS -------------------------------------------------------
// URLs inside css sit in css/styles.css, so local refs are ../images ../fonts
css = css.replace(ASSET_RE, (u) => {
  const rec = map.get(u);
  return rec ? '../' + rec.local : u;
});
await writeFile(path.join(OUT, 'css/styles.css'), css);
console.log('Wrote css/styles.css');

// ---- 4. Rewrite HTML ------------------------------------------------------
// Replace first <style> with the stylesheet link, drop the rest.
let replacedFirst = false;
html = html.replace(styleRe, () => {
  if (!replacedFirst) { replacedFirst = true; return '<link rel="stylesheet" href="css/styles.css">'; }
  return '';
});
// Rewrite all remaining asset URLs (mjs, images, og image, icons) to local.
html = html.replace(ASSET_RE, (u) => {
  const rec = map.get(u);
  return rec ? rec.local : u;
});
// Remove Framer analytics beacon (external tracking call, not needed self-hosted).
html = html.replace(/<script[^>]*src="https:\/\/events\.framer\.com[^"]*"[\s\S]*?<\/script>/g, '');
html = html.replace(/<script[^>]*events\.framer\.com[\s\S]*?<\/script>/g, '');

await writeFile(path.join(OUT, 'index.html'), html);
console.log('Wrote index.html');
console.log('DONE ->', OUT);
