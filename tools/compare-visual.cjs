// Usage: node compare.js <dirA> <dirB> [diffOutDir]
// Compares same-named PNGs. Reports canvas-region and UI-region pixel differences.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const [, , A, B, D] = process.argv;
if (D) fs.mkdirSync(D, { recursive: true });
const SIDEBAR_X = 405; // left UI panel width; canvas area is to the right
const TOPBAR_Y = 46;
const files = fs
  .readdirSync(A)
  .filter((f) => f.endsWith('.png'))
  .sort();
let worst = 0;
const rows = [];
for (const f of files) {
  const pb = path.join(B, f);
  if (!fs.existsSync(pb)) {
    rows.push(`${f}: MISSING in B`);
    worst = Infinity;
    continue;
  }
  const a = PNG.sync.read(fs.readFileSync(path.join(A, f)));
  const b = PNG.sync.read(fs.readFileSync(pb));
  if (a.width !== b.width || a.height !== b.height) {
    rows.push(`${f}: size differs`);
    worst = Infinity;
    continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const total = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  let canvas = 0,
    ui = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) {
        if (x >= SIDEBAR_X && y >= TOPBAR_Y) canvas++;
        else if (!(y < TOPBAR_Y && x >= 760 && x <= 880)) ui++;
        else continue;
      }
    }
  worst = Math.max(worst, total);
  rows.push(`${f}: total=${total} canvas=${canvas} ui=${ui}`);
  if (D && total) fs.writeFileSync(path.join(D, f), PNG.sync.write(diff));
}
console.log(rows.join('\n'));
console.log('WORST', worst);
