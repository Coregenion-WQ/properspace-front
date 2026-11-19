// Replicate Framer's on-the-fly image CDN locally.
// Framer refs images as NAME.ext?scale-down-to=N (a resized variant). A static
// server ignores the query and ships the full original (here up to 8736px / 23MB),
// which is why scrolling/marquees stutter. This generates real resized files per
// referenced width and rewrites refs to them, then caps the giant originals.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PUB = process.argv[2] || '/Users/holgerleitermann/dev/psfront/public';
const IMG = path.join(PUB, 'images');
const CAP = 2560; // max dimension for the "full" original — nothing on web needs more
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'] });

// text files that reference images
const textFiles = ['index.html', ...readdirSync(path.join(PUB, 'js')).filter(f => /\.mjs$/.test(f)).map(f => 'js/' + f)]
  .map(f => path.join(PUB, f));

// 1) collect base-image -> set of referenced widths
const REF = /\/images\/([A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp))\?scale-down-to=(\d+)/g;
const widths = new Map(); // name -> Set(N)
for (const f of textFiles) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(REF)) {
    if (!widths.has(m[1])) widths.set(m[1], new Set());
    widths.get(m[1]).add(parseInt(m[2], 10));
  }
}
console.log(`${widths.size} distinct images referenced with a width; generating variants…`);

function dims(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = +(/pixelWidth: (\d+)/.exec(out)?.[1] || 0);
  const h = +(/pixelHeight: (\d+)/.exec(out)?.[1] || 0);
  return { w, h };
}

// webp helper: decode to a working png once, resize via sips, re-encode webp
function makeWebpVariant(srcWebp, N, outWebp) {
  const tmpPng = '/tmp/_wv.png', tmpR = '/tmp/_wvr.png';
  sh('dwebp', [srcWebp, '-o', tmpPng]);
  sh('sips', ['-Z', String(N), tmpPng, '--out', tmpR]);
  sh('cwebp', ['-quiet', '-q', '82', tmpR, '-o', outWebp]);
}

const rename = new Map(); // "NAME.ext?scale-down-to=N" -> "NAME-N.ext"
let made = 0, skipped = 0;
for (const [name, ns] of widths) {
  const src = path.join(IMG, name);
  if (!existsSync(src)) { continue; }
  const ext = name.slice(name.lastIndexOf('.'));
  const stem = name.slice(0, name.lastIndexOf('.'));
  const isWebp = /\.webp$/i.test(name);
  let ow = 0; try { ow = dims(src).w; } catch { ow = CAP + 1; }
  for (const N of ns) {
    const key = `${name}?scale-down-to=${N}`;
    if (ow && N >= ow) { rename.set(key, name); skipped++; continue; } // variant >= original: use original
    const outName = `${stem}-${N}${ext}`;
    const out = path.join(IMG, outName);
    try {
      if (!existsSync(out)) {
        if (isWebp) makeWebpVariant(src, N, out);
        else sh('sips', ['-Z', String(N), src, '--out', out]);
      }
      rename.set(key, outName); made++;
    } catch (e) { rename.set(key, name); }
  }
}
console.log(`Generated ${made} variants (${skipped} widths >= original, mapped to full).`);

// 2) cap the giant originals in place (jpg/png only; webp originals are already smaller)
let capped = 0;
for (const f of readdirSync(IMG)) {
  if (!/\.(jpg|jpeg|png)$/i.test(f)) continue;
  const p = path.join(IMG, f);
  let d; try { d = dims(p); } catch { continue; }
  if (Math.max(d.w, d.h) > CAP) { try { sh('sips', ['-Z', String(CAP), p, '--out', p]); capped++; } catch {} }
}
console.log(`Capped ${capped} oversized originals to ${CAP}px.`);

// 3) rewrite references: NAME.ext?scale-down-to=N -> variant filename
let rew = 0;
for (const f of textFiles) {
  let t = readFileSync(f, 'utf8'); const b = t;
  t = t.replace(REF, (full, name, n) => {
    const nn = rename.get(`${name}?scale-down-to=${n}`);
    return nn ? `/images/${nn}` : `/images/${name}`; // drop the ?query either way
  });
  if (t !== b) { writeFileSync(f, t); rew++; }
}
console.log(`Rewrote image refs in ${rew} files.`);
