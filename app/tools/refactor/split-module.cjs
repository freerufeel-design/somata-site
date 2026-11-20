// Usage: node split-module.js <appRoot> <spec.json>
// spec: { "source": "js/app/x.js", "segments": [ { "line": 1, "path": "js/a.js", "title": "..." }, ... ] }
// Splits an ES module into contiguous segments (by top-level statement start line).
// Segments are chained in order so initialisation order is unchanged; imports/exports are
// recomputed from references; every importer of the source module is retargeted.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const eslintScope = require('eslint-scope');

const root = process.argv[2];
const spec = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const srcRel = spec.source;
const srcAbs = path.join(root, srcRel);
const src = fs.readFileSync(srcAbs, 'utf8');
const parse = (code) =>
  acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ranges: true, locations: true });
const ast = parse(src);

const rel = (fromRel, toRel) => {
  let p = path.relative(path.dirname(fromRel), toRel).split(path.sep).join('/');
  return p.startsWith('.') ? p : './' + p;
};
const resolveSpec = (fromRel, s) =>
  path
    .normalize(path.join(path.dirname(fromRel), s))
    .split(path.sep)
    .join('/');
const setterName = (n) => 'set' + n[0].toUpperCase() + n.slice(1);

// ---- collect imports, export list, setters, body ------------------------------
const importsByLocal = new Map(); // local -> { source(abs rel), imported }
let chainPrev = null;
const exportedNames = new Set();
const body = [];
for (const st of ast.body) {
  if (st.type === 'ImportDeclaration') {
    const from = resolveSpec(srcRel, st.source.value);
    if (!st.specifiers.length) {
      chainPrev = from;
      continue;
    }
    for (const sp of st.specifiers) {
      if (sp.type !== 'ImportSpecifier') throw new Error('unsupported import form in ' + srcRel);
      importsByLocal.set(sp.local.name, { from, imported: sp.imported.name });
    }
    continue;
  }
  if (st.type === 'ExportNamedDeclaration' && !st.declaration) {
    for (const sp of st.specifiers) exportedNames.add(sp.exported.name);
    continue;
  }
  body.push(st);
}

function declNames(st) {
  const out = [];
  const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
  const collect = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') out.push(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => collect(q.value || q.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(collect);
    else if (p.type === 'AssignmentPattern') collect(p.left);
    else if (p.type === 'RestElement') collect(p.argument);
  };
  if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') out.push(d.id.name);
  else if (d.type === 'VariableDeclaration') d.declarations.forEach((x) => collect(x.id));
  return out;
}
// generated setters: `export function setX(value) { X = value; return value; }`
const setterFor = new Map(); // setterName -> varName
for (const st of body) {
  if (st.type === 'ExportNamedDeclaration' && st.declaration?.type === 'FunctionDeclaration') {
    const fn = st.declaration,
      b = fn.body.body;
    if (
      b.length === 2 &&
      b[0].type === 'ExpressionStatement' &&
      b[0].expression.type === 'AssignmentExpression' &&
      b[0].expression.left.type === 'Identifier'
    )
      setterFor.set(fn.id.name, b[0].expression.left.name);
  }
}

// ---- assign statements to segments --------------------------------------------
const segs = spec.segments.map((s, i) => ({ ...s, index: i, stmts: [] }));
for (let i = 1; i < segs.length; i++)
  if (segs[i].line <= segs[i - 1].line) throw new Error('segments must be increasing');
const segOfLine = (line) => {
  let k = 0;
  for (let i = 0; i < segs.length; i++) if (line >= segs[i].line) k = i;
  return k;
};
const owner = new Map(); // name -> seg index
const ownerKind = new Map();
for (const st of body) {
  if (st.type === 'ExportNamedDeclaration' && setterFor.has(st.declaration.id.name)) continue; // placed later
  const k = segOfLine(st.loc.start.line);
  segs[k].stmts.push(st);
  for (const n of declNames(st)) {
    owner.set(n, k);
    ownerKind.set(n, st.kind || st.type);
  }
}
for (const [sn, v] of setterFor) {
  if (!owner.has(v)) throw new Error('setter target not found ' + v);
  owner.set(sn, owner.get(v));
}
for (const s of segs) if (!s.stmts.length) throw new Error('empty segment ' + s.path);

// ---- text of each segment (statements + leading comments) ----------------------
// a statement's text starts right after the previous body/import statement ends
const allTop = ast.body;
const prevEnd = new Map();
for (let i = 0; i < allTop.length; i++) prevEnd.set(allTop[i], i ? allTop[i - 1].end : 0);
for (const s of segs) {
  s.parts = s.stmts.map((st) => {
    let a = prevEnd.get(st);
    let text = src.slice(a, st.end);
    if (st.type === 'ExportNamedDeclaration')
      text = text.replace(/\bexport\s+(?=function|const|let|class|async)/, '');
    return text.replace(/^\s*\n/, '');
  });
  s.text = s.parts.join('\n');
}
// setters go to the segment that owns the variable
for (const [sn, v] of setterFor) {
  const s = segs[owner.get(v)];
  s.text += `\n\nfunction ${sn}(value) {\n  ${v} = value;\n  return value;\n}`;
}

// ---- references per segment ---------------------------------------------------
for (const s of segs) {
  const sast = parse(s.text);
  const sm = eslintScope.analyze(sast, { ecmaVersion: 2022, sourceType: 'module' });
  s.sibling = new Map(); // seg index -> Set(names)
  s.external = new Map(); // from -> Set("imported as local")
  s.crossWrites = [];
  for (const ref of sm.globalScope.through) {
    const n = ref.identifier.name;
    if (owner.has(n) && owner.get(n) !== s.index) {
      const k = owner.get(n);
      if (!s.sibling.has(k)) s.sibling.set(k, new Set());
      if (ref.isWrite()) {
        s.crossWrites.push(ref.identifier);
        s.sibling.get(k).add(setterName(n));
        if (!owner.has(setterName(n))) segs[k].needSetter = (segs[k].needSetter || new Set()).add(n);
      }
      if (ref.isRead() || !ref.isWrite()) s.sibling.get(k).add(n);
    } else if (importsByLocal.has(n)) {
      const im = importsByLocal.get(n);
      if (ref.isWrite()) throw new Error(`write to imported binding ${n} in ${s.path}`);
      if (!s.external.has(im.from)) s.external.set(im.from, new Set());
      s.external.get(im.from).add(im.imported === n ? n : `${im.imported} as ${n}`);
    }
  }
  s.ast = sast;
}
// new setters for cross-segment writes
for (const s of segs)
  if (s.needSetter)
    for (const v of s.needSetter) {
      if (owner.has(setterName(v))) continue;
      s.text += `\n\nfunction ${setterName(v)}(value) {\n  ${v} = value;\n  return value;\n}`;
      owner.set(setterName(v), s.index);
    }
for (const s of segs)
  if (s.crossWrites.length) {
    const ids = new Set(s.crossWrites.map((i) => i.start));
    const edits = [];
    walk.simple(s.ast, {
      AssignmentExpression(n) {
        if (n.left.type === 'Identifier' && ids.has(n.left.start)) {
          if (n.operator !== '=') throw new Error('compound cross-segment write');
          edits.push({
            a: n.start,
            b: n.end,
            t: `${setterName(n.left.name)}(${s.text.slice(n.right.start, n.right.end)})`,
          });
        }
      },
    });
    edits.sort((x, y) => y.a - x.a);
    for (const e of edits) s.text = s.text.slice(0, e.a) + e.t + s.text.slice(e.b);
  }

// ---- who needs what from each segment ------------------------------------------
const exportsOfSeg = segs.map(() => new Set());
for (const s of segs) for (const [k, names] of s.sibling) for (const n of names) exportsOfSeg[k].add(n);
// external importers of the source module
const allFiles = [];
(function list(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) list(p);
    else if (e.name.endsWith('.js')) allFiles.push(path.relative(root, p).split(path.sep).join('/'));
  }
})(path.join(root, 'js'));
const importerEdits = [];
for (const f of allFiles) {
  if (f === srcRel) continue;
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  if (!code.includes(path.basename(srcRel))) continue;
  const fast = parse(code);
  for (const st of fast.body) {
    if (st.type !== 'ImportDeclaration') continue;
    if (resolveSpec(f, st.source.value) !== srcRel) continue;
    importerEdits.push({ f, st, code });
    for (const sp of st.specifiers) {
      const n = sp.imported.name;
      if (!owner.has(n)) throw new Error(`${f} imports ${n} which ${srcRel} does not declare`);
      exportsOfSeg[owner.get(n)].add(n);
    }
  }
}

// ---- write segments --------------------------------------------------------------
const header = (s) => (s.title ? `// ${s.title}\n` : '');
for (const s of segs) {
  const lines = [];
  const prev = s.index === 0 ? chainPrev : segs[s.index - 1].path;
  if (prev) lines.push(`import '${rel(s.path, prev)}'; // initialisation order: this module runs after it`);
  const ext = [...s.external.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [from, names] of ext)
    lines.push(`import { ${[...names].sort().join(', ')} } from '${rel(s.path, from)}';`);
  for (const [k, names] of [...s.sibling.entries()].sort((a, b) => a[0] - b[0]))
    lines.push(`import { ${[...names].sort().join(', ')} } from '${rel(s.path, segs[k].path)}';`);
  const exp = [...exportsOfSeg[s.index]].sort();
  let out =
    header(s) +
    (lines.length ? lines.join('\n') + '\n\n' : '') +
    s.text.replace(/^\n+/, '').replace(/\s*$/, '\n');
  if (exp.length) out += `\nexport { ${exp.join(', ')} };\n`;
  fs.mkdirSync(path.dirname(path.join(root, s.path)), { recursive: true });
  if (fs.existsSync(path.join(root, s.path)) && s.path !== srcRel) throw new Error('target exists ' + s.path);
  fs.writeFileSync(path.join(root, s.path), out);
}

// ---- retarget importers ----------------------------------------------------------
const byFile = new Map();
for (const e of importerEdits) {
  if (!byFile.has(e.f)) byFile.set(e.f, []);
  byFile.get(e.f).push(e);
}
for (const [f, edits] of byFile) {
  let code = fs.readFileSync(path.join(root, f), 'utf8');
  edits.sort((a, b) => b.st.start - a.st.start);
  for (const { st } of edits) {
    let repl;
    if (!st.specifiers.length) {
      const tail = code.slice(st.end).match(/^[ \t]*\/\/[^\n]*/)?.[0] || '';
      repl = `import '${rel(f, segs[segs.length - 1].path)}';` + tail;
      code = code.slice(0, st.start) + repl + code.slice(st.end + tail.length);
      continue;
    }
    const groups = new Map();
    for (const sp of st.specifiers) {
      const k = owner.get(sp.imported.name);
      if (!groups.has(k)) groups.set(k, []);
      groups
        .get(k)
        .push(sp.imported.name === sp.local.name ? sp.local.name : `${sp.imported.name} as ${sp.local.name}`);
    }
    repl = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, ns]) => `import { ${ns.sort().join(', ')} } from '${rel(f, segs[k].path)}';`)
      .join('\n');
    code = code.slice(0, st.start) + repl + code.slice(st.end);
  }
  fs.writeFileSync(path.join(root, f), code);
}
if (!segs.some((s) => s.path === srcRel)) fs.unlinkSync(srcAbs);
console.log(`split ${srcRel} into ${segs.length} modules; retargeted ${byFile.size} importers`);
for (const s of segs)
  console.log(`  ${s.path}: ${s.text.split('\n').length} lines, exports ${exportsOfSeg[s.index].size}`);
