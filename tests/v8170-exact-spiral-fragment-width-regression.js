'use strict';
// 8.17.0: guard the only shader edit against a geometry/colour semantic change.
// Structural/numeric coverage, not hardware WGSL validation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../js/gpu/spiral-bezier-morph-renderer.js'),'utf8');
const shader=src.match(/const WGSL=`([\s\S]*?)`;/)?.[1];
assert(shader,'Spiral shader missing');
const vs=shader.slice(shader.indexOf('@vertex fn vs('),shader.indexOf('@fragment fn fs('));
const frag=shader.slice(shader.indexOf('@fragment fn fs('),shader.indexOf('struct UniformOut'));
assert(vs.includes('o.logHalfWidth0=log(max(.001,hw0))'),'missing start width log in vertex');
assert(vs.includes('o.logHalfWidth1=log(max(.001,hw1))'),'missing end width log in vertex');
assert(frag.includes('exp(mix(v.logHalfWidth0,v.logHalfWidth1,q))'),'width law differs');
assert(!/log\(max\(\.001,v\.halfWidth/.test(frag),'duplicate fragment log present');
assert(shader.includes('@location(2) @interpolate(flat) logHalfWidth0:f32'));
assert(shader.includes('@location(3) @interpolate(flat) logHalfWidth1:f32'));
assert.equal((shader.match(/@vertex fn vs\(/g)||[]).length,1);
// Important: shader's other path must remain independent; its coverage and center fade are untouched.
assert(shader.includes('fn centerShade(')&&shader.includes('@fragment fn fsUniform('));
assert(frag.includes('centerShade(v.position.xy)'));
let seed=0x127acf90;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const f=Math.fround;
let maxRelativeDifference=0, tests=0;
for(let i=0;i<2500;i++){
 const width=f(Math.max(.18,Math.exp((rnd()-.5)*15)));
 const widthEnd=f(Math.max(.18,Math.exp((rnd()-.5)*15)));
 const low=f(Math.log(Math.max(.001,width))),high=f(Math.log(Math.max(.001,widthEnd)));
 for(let j=0;j<16;j++){
  const q=f(j/15);
  const baseline=f(Math.exp(f(f(Math.log(Math.max(.001,width)))*(1-q)+f(Math.log(Math.max(.001,widthEnd)))*q)));
  const candidate=f(Math.exp(f(low*(1-q)+high*q)));
  const relative=Math.abs(baseline-candidate)/Math.max(1,Math.abs(baseline));
  maxRelativeDifference=Math.max(maxRelativeDifference,relative);tests++;
  assert(relative<2e-6,`width divergence ${relative}`);
 }
}
console.log(`PASS 8.17 exact Spiral shader width parity (${tests} samples; max relative difference ${maxRelativeDifference})`);
