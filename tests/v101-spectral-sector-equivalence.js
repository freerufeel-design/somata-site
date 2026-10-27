'use strict';
const assert=require('node:assert/strict');
// Pixel-sector gate check: old atan2 formulation versus new two-cross-products gate.
const TAU=Math.PI*2;
function oldGate(angle,start,direction,progress,span){
  const head=progress*TAU;
  if(head<=1e-6)return false;
  const tail=Math.max(0,head-span);
  const raw=(direction>0?angle-start:start-angle);
  const rel=raw-Math.floor(raw/TAU)*TAU;
  return rel+1e-5>=tail&&rel<=head+1e-5;
}
function newGate(angle,start,direction,progress,span){
  const head=progress*TAU;if(head<=1e-6)return false;
  const tail=Math.max(0,head-span),arc=head-tail;
  if(arc>=TAU-1e-6)return true;
  const s=start+direction*tail,e=start+direction*head;
  const px=Math.cos(angle),py=Math.sin(angle);
  const c0=direction*(Math.cos(s)*py-Math.sin(s)*px);
  const c1=direction*(px*Math.sin(e)-py*Math.cos(e));
  return arc>Math.PI?(c0>=-1e-5||c1>=-1e-5):(c0>=-1e-5&&c1>=-1e-5);
}
let seed=14243;
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<100000;i++){
  const angle=rnd()*TAU,origin=(rnd()*2-1)*Math.PI,dir=rnd()<.5?-1:1,progress=rnd(),span=.00001+rnd()*(TAU-.00001);
  assert.equal(newGate(angle,origin,dir,progress,span),oldGate(angle,origin,dir,progress,span),`spectral sector mismatch at ${i}`);
}
console.log('PASS spectral sector angular classification: 100000 cases match old atan2 geometry');
