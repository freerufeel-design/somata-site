'use strict';
// Source geometry + Corridor subpixel glint regression; GPU commands in v8205 test.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert').strict;
const root=path.resolve(__dirname,'..'),src=p=>fs.readFileSync(path.join(root,p),'utf8');
const sandbox={window:{__spiroRegisterModule(){}},Map,Math,Float32Array};
vm.runInNewContext(src('js/app/prism-3d-layer.js'),sandbox);
const shapes=['sphere','lens','cube','skull','dodecahedron','cross'],stats={};
for(const shape of shapes){const m=sandbox.window.SomataPrism3D.meshFor(shape);
 assert(m.triangles>0);assert.equal(m.vertices.length,m.normals.length);
 assert(Array.from(m.vertices).every(Number.isFinite));assert(Array.from(m.normals).every(Number.isFinite));stats[shape]=m.triangles;}
const p=src('js/geometry/frame-paths.js');
function extract(name){const start=p.indexOf('function '+name+'(');assert(start!==-1,name);let brace=p.indexOf('{',start),depth=0,i=brace;
 for(;i<p.length;i++){if(p[i]==='{')depth++;else if(p[i]==='}'&&!--depth)break;}return p.slice(start,i+1);}
const gate={state:{tunnel:{active:true},zoom:1},effectCullStats:{sweep:0,web:0},getTunnelEffectScreenScale:()=>.00001,getMotionTunnelLagRadians:()=>0};
vm.runInNewContext(['shouldDrawTunnelEffectCopy','shouldDrawTunnelEffectIndex','packTunnelEffectCopyRecords'].map(extract).join('\n'),gate);
const copies=Array.from({length:12},(_,i)=>({scale:Math.pow(.5,i+2)}));
const frame={instanceMetrics:copies.map(c=>({radiusPx:c.scale,screenScale:c.scale})),visibleInstances:{copies},layerExtent:100,audioScale:1,combinedScale:1};
const alphas=copies.map(()=>1),out=new Float32Array(copies.length*8);
assert(gate.shouldDrawTunnelEffectIndex('sweep',11,frame,.002));
assert(!gate.shouldDrawTunnelEffectIndex('web',11,frame,.002),'web still culls subpixel geometry');
assert.equal(gate.packTunnelEffectCopyRecords(out,copies,alphas,frame,'sweep',.002),12,'glint must reach EVERY visible copy');
alphas[5]=0;assert.equal(gate.packTunnelEffectCopyRecords(out,copies,alphas,frame,'sweep',.002),11,'zero-alpha copies remain excluded');
const s=src('js/core/state.js');assert(/normalizeSizes:\s*true/.test(s));assert(/prism:\s*\{enabled:false,mode:'3d'/.test(s));
const html=src('index.html');assert(/id="morphNormalizeSizes"[^>]*checked/.test(html));
assert(html.includes('js/app/prism-3d-layer.js'));assert(html.includes('<option value="sphere" selected>'));
const ui=src('js/app/ui-project-runtime.js');assert(ui.includes("else if(mode==='ambient')window.SomataAmbientPrism?.toggleAmbient?.()"));
assert(ui.includes("else if(mode==='prism')window.SomataAmbientPrism?.togglePrism?.()"));
console.log('PASS 8.20.3-compat',JSON.stringify({meshTriangles:stats,corridorCopies:copies.length,blueNormalizeByDefault:true,rightClickAmbientAndPrism:true}));
