'use strict';
// The quick radius witness must never choose a different outline than the
// exhaustive 17-iteration limiter. In particular, changing phase must not
// abruptly turn radius protection on/off.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
let seed=1234567;function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;}
const generate=(n,stage)=>Array.from({length:n},(_,i)=>{
 const a=i*2*Math.PI/n, r=(i%3?35:125)+(rnd()-.5)*10;
 return {x:r*Math.cos(a)+stage*5*Math.sin(i*.7),y:r*Math.sin(a)+stage*7*Math.cos(i*1.3)};
});
function draw(points,closed,round,drop,force){
 const commands=[];const ctx={moveTo(...v){commands.push(['M',...v]);},bezierCurveTo(...v){commands.push(['C',...v]);},closePath(){commands.push(['Z']);}};
 const flags=points.map((_,i)=>i%4!==1);
 const opts={layer:{N:7,radius:100,roundingMaxRadiusDrop:drop},forceFullRadiusProbe:force};
 assert(drawUnifiedFilletPath(ctx,points,closed,round,flags,opts));
 return commands;
}
let checks=0,maxDiff=0;
for(const n of [6,12,48,240,1601])for(const closed of [false,true])for(const round of [.15,1,1.75,2])for(const drop of [0,30,90]){
 const points=generate(n,.13);
 const A=draw(points,closed,round,drop,false),B=draw(points,closed,round,drop,true);
 assert.equal(A.length,B.length,`radius witness changed segment topology at n=${n}, round=${round}`);
 for(let i=0;i<A.length;i++)for(let k=0;k<A[i].length;k++){
  if(k===0)assert.equal(A[i][k],B[i][k]);
  else{const d=Math.abs(A[i][k]-B[i][k]);maxDiff=Math.max(maxDiff,d);
   assert(d<1e-7,`radius witness mismatch (${n}, ${closed}, ${round}, ${drop}): ${d}`);}
 }
 checks++;
}
// Never mutate the input rail: its points are controlled by Morph, NOT the
// fillet renderer. Check near frame 0, 1 and a typical intermediate frame.
for(const t of [0,1e-8,.5,1-1e-8,1]){
 const rail=generate(80,t),before=JSON.stringify(rail);
 draw(rail,false,1.6,30,false);
 assert.equal(JSON.stringify(rail),before,'fillet changed Morph anchor positions');
 checks++;
}
console.log(`PASS 11.0.10: ${checks} witness/full radius-solver equivalence and immutable Morph rail checks, max coordinate diff ${maxDiff}`);
