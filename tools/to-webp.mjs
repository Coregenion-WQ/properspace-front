// Convert raster images to WebP (except social/favicon images), rewrite all
// references, and delete the originals. WebP is ~30-45% smaller at equal quality.
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PUB = '/Users/holgerleitermann/dev/psfront/public';
const IMG = path.join(PUB, 'images');
// keep these as jpg/png — social scrapers + favicons don't do webp reliably
const KEEP = new Set(['DLVZu4KeV74Dy33sWCV8xfrRuBE.jpg', 'KavS92NEgcDJiCr83Jjl2lsKY.png', '2nUlBrn0JW8Ljmo3TakdgotLoU.jpg']);
const sh = (c, a) => execFileSync(c, a, { stdio: ['ignore', 'ignore', 'ignore'] });

// 1) convert
const files = readdirSync(IMG).filter(f => /\.(jpe?g|png)$/i.test(f) && !KEEP.has(f));
let conv = 0, before = 0, after = 0;
const converted = new Set(); // old basenames now available as .webp
for (const f of files) {
  const src = path.join(IMG, f);
  const out = path.join(IMG, f.replace(/\.(jpe?g|png)$/i, '.webp'));
  before += statSync(src).size;
  try {
    const q = /\.png$/i.test(f) ? '80' : '62';
    sh('cwebp', ['-quiet', '-q', q, src, '-o', out]);
    after += statSync(out).size;
    converted.add(f);
    conv++;
  } catch (e) { /* leave original if conversion fails */ }
}
console.log(`Converted ${conv} images to webp (${(before/1048576).toFixed(0)}MB -> ${(after/1048576).toFixed(0)}MB).`);

// 2) rewrite references in every text file
function walk(d) { return readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }
const texts = walk(PUB).filter(f => /\.(html|mjs|js|css|json)$/.test(f));
const REF = /((?:\.?\/)?images\/)([A-Za-z0-9._-]+)\.(jpe?g|png)/g;
let rew = 0;
for (const f of texts) {
  let t = readFileSync(f, 'utf8'); const b = t;
  t = t.replace(REF, (m, pre, stem, ext) => {
    const fname = `${stem}.${ext}`;
    return converted.has(fname) ? `${pre}${stem}.webp` : m; // keep excluded (favicon/og) as-is
  });
  if (t !== b) { writeFileSync(f, t); rew++; }
}
console.log(`Rewrote image refs in ${rew} files.`);

// 3) delete the converted originals
let del = 0, reclaimed = 0;
for (const f of converted) { const p = path.join(IMG, f); if (existsSync(p)) { reclaimed += statSync(p).size; unlinkSync(p); del++; } }
console.log(`Deleted ${del} original files (${(reclaimed/1048576).toFixed(0)}MB reclaimed).`);
