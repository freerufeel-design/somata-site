// Validates the module graph: every import resolves and every imported name is exported.
// Usage: npm run check:graph
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'js/main.js')],
    bundle: true,
    write: false,
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
  });
  console.log(
    `module graph OK: ${Object.keys(r.metafile.inputs).length} modules, ${r.warnings.length} warnings`,
  );
  for (const w of r.warnings) console.log(`  warning: ${w.text} (${w.location?.file}:${w.location?.line})`);
} catch (e) {
  console.error('module graph errors:');
  for (const er of e.errors || [e])
    console.error(`  ${er.text} ${er.location ? `(${er.location.file}:${er.location.line})` : ''}`);
  process.exit(1);
}
