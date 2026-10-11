'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const spiral=read('js/gpu/spiral-bezier-morph-renderer.js');
const defaults=JSON.parse(read('default.plist'));
const html=read('index.html');

assert.ok(!/\b(?:let|var|const)\s+do\b/.test(spiral),
  'Embedded WGSL must not declare reserved identifier `do`');
assert.ok(spiral.includes('let dout=safeUnit(vout,di)') && spiral.includes('di+dout'),
  'Tangent-repair WGSL must use the non-reserved outgoing tangent identifier');
assert.ok(spiral.includes("label:'Somata 7.3.7 Spiral spline tangent repair WGSL'") && spiral.includes("await assertWebGPUShaderModule(repairMod,'Somata 7.3.7 Spiral spline tangent repair WGSL')"),
  'Tangent-repair shader must remain covered by async WebGPU shader-module validation');
const holy=(defaults.projects||[]).find(p=>p?.name==='Святой')?.project;
assert.ok(holy?.settings?.morph?.defaultActive===true && holy?.settings?.tunnel?.defaultActive===true && holy?.layers?.some(l=>l?.spiralEnabled===true),
  'Factory Святой must retain Morph+Corridor defaults and a Spiral carrier');
assert.ok(html.includes('<title>Somata 7.3.7</title>') && html.includes('?v=20261012-v737'),
  '7.3.7 title/cache epoch missing');
console.log('Somata 7.3.7 Spiral WGSL startup invariants: PASS');
