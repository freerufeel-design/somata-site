// Usage: node geom-compare.js a.json b.json
const fs = require('fs');
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
let diff = 0;
if (a.results.length !== b.results.length) console.log('count differs', a.results.length, b.results.length);
const n = Math.min(a.results.length, b.results.length);
for (let i = 0; i < n; i++) {
  const x = a.results[i],
    y = b.results[i];
  if (x.label !== y.label || x.h !== y.h || x.err !== y.err) {
    diff++;
    if (diff <= 8)
      console.log(
        'DIFF',
        x.label,
        x.h,
        y.h,
        x.err || '',
        y.err || '',
        JSON.stringify(x.first),
        JSON.stringify(y.first),
      );
  }
}
console.log(`${n} cases, ${diff} differ; total points ${a.results.reduce((s, r) => s + (r.pts || 0), 0)}`);
process.exit(diff ? 1 : 0);
