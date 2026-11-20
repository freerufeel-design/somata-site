// Usage: node move-module.js <appRoot> <fromRel> <toRel>  — moves an ES module and rewrites all specifiers
const fs = require('fs'),
  path = require('path'),
  acorn = require('acorn');
const [root, from, to] = process.argv.slice(2);
const resolve = (f, s) =>
  path
    .normalize(path.join(path.dirname(f), s))
    .split(path.sep)
    .join('/');
const rel = (f, t) => {
  let p = path.relative(path.dirname(f), t).split(path.sep).join('/');
  return p.startsWith('.') ? p : './' + p;
};
const files = [];
(function list(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) list(p);
    else if (e.name.endsWith('.js')) files.push(path.relative(root, p).split(path.sep).join('/'));
  }
})(path.join(root, 'js'));
function rewrite(file, newFile, mapTarget) {
  let code = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const edits = [];
  for (const st of ast.body) {
    if (st.type !== 'ImportDeclaration' && !(st.type === 'ExportNamedDeclaration' && st.source)) continue;
    const target = mapTarget(resolve(file, st.source.value));
    const spec = rel(newFile, target);
    if (spec !== st.source.value) edits.push([st.source.start, st.source.end, `'${spec}'`]);
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (const [a, b, t] of edits) code = code.slice(0, a) + t + code.slice(b);
  return code;
}
const map = (t) => (t === from ? to : t);
let n = 0;
for (const f of files) {
  if (f === from) continue;
  const c0 = fs.readFileSync(path.join(root, f), 'utf8');
  const c = rewrite(f, f, map);
  if (c !== c0) {
    fs.writeFileSync(path.join(root, f), c);
    n++;
  }
}
const moved = rewrite(from, to, map);
fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
fs.writeFileSync(path.join(root, to), moved);
fs.unlinkSync(path.join(root, from));
console.log(`moved ${from} -> ${to}; updated ${n} importers`);
