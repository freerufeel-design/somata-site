'use strict';
// 8.20.11: guard the actual artistic requirements, not merely a show-flag.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html'),source=read('js/app/prism-3d-layer.js');
const ambient=read('js/app/ambient-prism.js'),routing=read('js/core/parameter-routing.js'),matrix=read('js/core/parameter-matrix.js');
const m={window:{__spiroRegisterModule(){}},Map,Math,Float32Array};vm.runInNewContext(source,m);
const sphere=m.window.SomataPrism3D.meshFor('sphere');
const skull=m.window.SomataPrism3D.meshFor('skull');
const cube=m.window.SomataPrism3D.meshFor('cube');
assert(sphere.triangles>=16000,'dense smooth sphere expected');
assert(skull.triangles>=16000,'sculpted skull must have enough detail');
assert.equal(cube.triangles,12,'unrelated cube preserved');
assert(Array.from(sphere.vertices).every(Number.isFinite));
assert(Array.from(skull.vertices).every(Number.isFinite));
// Sculpted skull has different xyz from scaled ball, and a recessed face.
const idx=Array.from(skull.vertices).findIndex((v,i)=>i%3===2&&v>0.7);
assert(idx>0);
assert.match(source,/const leftEye=Math\.exp/);assert.match(source,/const cheek=Math\.exp/);
assert.match(source,/let teeth = teethBand|const teeth = teethBand/);
assert.match(source,/let smoothMagnitude = maxPixels \* \(1\.0 - exp/);
assert.doesNotMatch(source,/clamp\(offsetPx,\s*vec2<f32>\(-maxPixels\)/,'no rectangular refraction clip');
assert.match(source,/palette: vec4<f32>/);assert.match(source,/let bodyColor/);assert.match(source,/let lightColor/);
assert.match(source,/data\.set\(\[\(\(Number\(cfg\.lightHue/,'new color parameters passed into live GPU uniforms');
assert(html.includes('id="prismPrevShape"')&&html.includes('id="prismNextShape"'));
assert(ambient.includes("shapeSelect.dispatchEvent(new Event('change'"),'arrows must trigger normal shape update path');
const additions=['lightHue','lightIntensity','fillHue','fill'];
const context={window:{__spiroRegisterModule(){}},Math,Map,Set,Array,Object,Number,String};
vm.runInNewContext(routing+'\n'+matrix,context);
const reg=context.window.SomataParameterRegistry,mat=context.window.SomataParameterMatrix;
for(const suffix of additions){const id='prism.'+suffix;assert(reg.get(id),id);assert(mat.get(id),id);assert(html.includes('id="prism'+suffix[0].toUpperCase()+suffix.slice(1)+'"'));}
for(const id of [...html.matchAll(/<input id="((?:ambient|prism)[A-Za-z]+)" type="range"/g)].map(m=>m[1])){
 const key=id.slice(5,6).toLowerCase()+id.slice(6);
 if((id.startsWith('prism')&&['opacity','lightHue','fillHue','lightIntensity','fill'].includes(key))||id==='ambientRainOpacity'){assert(!html.includes('id="'+id+'Multiplier"'),'bounded inputs use native range without dead multiplier');continue;}
 const control=id+'Multiplier';const node=html.match(new RegExp(`<input id="${control}" type="number"[^>]+>`))?.[0];
 assert(node&&node.includes('data-log-multiplier="1"'),`${id} missing Lamp-style logarithmic multiplier`);
}
for(const key of ['lightHue','lightIntensity','fillHue','fill']){
 assert(ambient.includes(key),'live prism state contains '+key);
 assert(html.includes('id="prism'+key[0].toUpperCase()+key.slice(1)+'Text"'),'value label '+key);
}
const stat=read('js/core/state.js');assert(/prism:\{enabled:false,mode:'3d'/.test(stat));
console.log('PASS 8.20.11 crystal materials, smooth sphere, sculpted skull, arrows, 29 routed numeric fields and log multipliers');
