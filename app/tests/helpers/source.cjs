// Source access for sandboxed unit tests.
//
// Somata's functions depend on a lot of shared application state, so several tests run a few
// real functions inside a `vm` context with small stubs around them. Earlier versions cut those
// functions out of big files by searching for text with an exact indentation, which broke on any
// reformatting. Here functions are found by *name* with a JavaScript parser, in whichever module
// currently holds them, so moving code between modules or reformatting does not affect tests.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function listModules(dir = 'js') {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...listModules(rel));
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out.sort();
}

const parsed = new Map();
function parse(file) {
  if (!parsed.has(file)) {
    const src = read(file);
    const sourceType = file.startsWith('js/bootstrap/') ? 'script' : 'module';
    parsed.set(file, { src, ast: acorn.parse(src, { ecmaVersion: 'latest', sourceType }) });
  }
  return parsed.get(file);
}

function declaredNames(node) {
  const d = node.type === 'ExportNamedDeclaration' && node.declaration ? node.declaration : node;
  if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') return d.id ? [d.id.name] : [];
  if (d.type === 'VariableDeclaration')
    return d.declarations.filter((x) => x.id.type === 'Identifier').map((x) => x.id.name);
  return [];
}
function stripExport(src, node) {
  const text = src.slice(node.start, node.end);
  return node.type === 'ExportNamedDeclaration' ? text.replace(/^export\s+/, '') : text;
}

// name -> { file, text } for every top-level declaration; nested declarations are a fallback.
let topIndex = null;
function index() {
  if (topIndex) return topIndex;
  topIndex = new Map();
  for (const file of listModules()) {
    const { src, ast } = parse(file);
    for (const st of ast.body)
      for (const n of declaredNames(st))
        if (!topIndex.has(n)) topIndex.set(n, { file, text: stripExport(src, st) });
  }
  return topIndex;
}
function findNested(name) {
  for (const file of listModules()) {
    const { src, ast } = parse(file);
    let hit = null;
    (function walk(node) {
      if (hit || !node || typeof node.type !== 'string') return;
      if (
        (node.type === 'FunctionDeclaration' || node.type === 'VariableDeclaration') &&
        declaredNames(node).includes(name)
      ) {
        hit = { file, text: src.slice(node.start, node.end) };
        return;
      }
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v.type === 'string') walk(v);
      }
    })(ast);
    if (hit) return hit;
  }
  return null;
}

/** Source text of the named declarations (top-level first, then nested), in the given order. */
function declarations(...names) {
  const parts = [];
  const seen = new Set();
  for (const name of names.flat()) {
    const hit = index().get(name) || findNested(name);
    if (!hit) throw new Error(`declaration not found: ${name}`);
    if (seen.has(hit.text)) continue;
    seen.add(hit.text);
    parts.push(hit.text);
  }
  return parts.join('\n');
}

/** Which module declares `name` at top level. */
function moduleOf(name) {
  const hit = index().get(name);
  return hit ? hit.file : null;
}

/** A module's body as a classic script: imports and export lists removed, `export` keywords stripped. */
function moduleAsScript(file) {
  const { src, ast } = parse(file);
  let out = '';
  let last = 0;
  for (const st of ast.body) {
    if (st.type === 'ImportDeclaration' || (st.type === 'ExportNamedDeclaration' && !st.declaration)) {
      out += src.slice(last, st.start);
      last = st.end;
    } else if (st.type === 'ExportNamedDeclaration') {
      out += src.slice(last, st.start) + stripExport(src, st);
      last = st.end;
    }
  }
  return out + src.slice(last);
}

/** Initialisation order of the application modules (follows the chain imports from js/main.js). */
function moduleOrder() {
  const resolve = (from, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const chainOf = (file) => {
    const m = read(file).match(/^import '([^']+)'; \/\/ initialisation order/m);
    return m ? resolve(file, m[1]) : null;
  };
  const first = read('js/main.js').match(/^import '([^']+)';/m)[1];
  const order = [];
  for (let f = resolve('js/main.js', first); f; f = chainOf(f)) order.unshift(f);
  return order;
}

module.exports = { ROOT, read, listModules, declarations, moduleOf, moduleAsScript, moduleOrder };
