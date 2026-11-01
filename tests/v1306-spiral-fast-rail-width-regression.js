'use strict';
// Spiral 13.0.6: compare phase-time width values from the old and new
// GPU fast rail width encoding (same Bézier positions, same subdivision).
// This is mathematical validation; it does not simulate real WebGPU timings.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../js/gpu/spiral-bezier-morph-renderer.js'),'utf8');
assert(src.includes('let logWs0=mix(w.x,w.z,phaseT);let logWs1=mix(w.y,w.w,phaseT);'));
assert(src.includes('gpuData[o+k]=Math.log(Math.max(.02,gpuData[o+k]))'));
assert(src.includes('meta[o+16]=Math.log(w0);meta[o+17]=Math.log(w1)'));
let maxAbs=0,maxRelative=0,examples=0;let seed=0x92fae3;
const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
// GPU storage width values are f32. Compute both equivalent formulations
// with f32 intermediate values, to quantify any precision difference.
const f=Math.fround;
for(let i=0;i<60000;i++){
 const widths=Array.from({length:4},()=>f(Math.exp((rand()*2-1)*4)));
 const phase=f(rand()),q=f(rand());
 const l=widths.map(w=>f(Math.log(Math.max(.02,w))));
 const oldW0=f(Math.exp(f(l[0]*f(1-phase)+l[2]*phase)));
 const oldW1=f(Math.exp(f(l[1]*f(1-phase)+l[3]*phase)));
 const old=f(Math.exp(f(f(Math.log(Math.max(.02,oldW0)))*f(1-q)+f(Math.log(Math.max(.02,oldW1)))*q)));
 const newLog0=f(l[0]+f(l[2]-l[0])*phase),newLog1=f(l[1]+f(l[3]-l[1])*phase);
 const next=f(Math.exp(f(newLog0+f(newLog1-newLog0)*q)));
 const abs=Math.abs(next-old);maxAbs=Math.max(maxAbs,abs);maxRelative=Math.max(maxRelative,abs/Math.max(.02,old));examples++;
}
assert(maxRelative<0.000002,`relative width regression: ${maxRelative}`);
console.log('PASS Spiral width shader encoded logs:',{examples,maxAbs,maxRelative});
