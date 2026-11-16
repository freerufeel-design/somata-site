// Usage: node outline.js file.js — compact outline of top-level statements
const fs = require('fs'),
  acorn = require('acorn');
const src = fs.readFileSync(process.argv[2], 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: [] });
const out = [];
for (const st of ast.body) {
  const L = st.loc.start.line,
    n = st.loc.end.line - L + 1;
  let name;
  if (st.type === 'FunctionDeclaration') name = 'f:' + st.id.name;
  else if (st.type === 'VariableDeclaration')
    name = st.kind[0] + ':' + st.declarations.map((d) => d.id.name || '{..}').join(',');
  else if (st.type === 'ImportDeclaration' || st.type === 'ExportNamedDeclaration') continue;
  else if (st.type === 'ExpressionStatement') {
    const e = st.expression;
    name =
      'x:' +
      (e.type === 'CallExpression'
        ? src.slice(e.callee.start, Math.min(e.callee.end, e.callee.start + 40)) + '()'
        : e.type === 'AssignmentExpression'
          ? src.slice(e.left.start, Math.min(e.left.end, e.left.start + 40)) + '='
          : e.type);
  } else name = st.type;
  out.push(`${L}${n > 60 ? '(' + n + ')' : ''} ${name.replace(/\s+/g, ' ')}`);
}
console.log(out.join(' | '));
