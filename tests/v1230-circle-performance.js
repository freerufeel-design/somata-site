'use strict';
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..');
const load=name=>new Function(fs.readFileSync(path.join(root,name),'utf8')+'\nreturn drawUnifiedFilletPath;')();
const baseline=load('tests/fixtures/v1230-unified-fillet-1220.js'),current=load('js/geometry/unified-fillet.js');
function bench(fn,pts,round,repeat=14){
 const n=pts.length,flags=pts.map(()=>true),opts={layer:{N:n,radius:100,roundingMaxRadiusDrop:30}};
 const samples=[],call={moveTo(){},bezierCurveTo(){},closePath(){}};
 for(let i=0;i<repeat+4;i++){
  const t=performance.now();fn(call,pts,true,round,flags,opts);
  if(i>=4)samples.push(performance.now()-t);
 }
 return samples.sort((a,b)=>a-b)[Math.floor(samples.length/2)];
}
for(const n of [300,1000,5000]){
 const p=Array.from({length:n},(_,i)=>{const a=i*2*Math.PI/n;return{x:100*Math.cos(a),y:100*Math.sin(a)};});
 const old=bench(baseline,p,2),fast=bench(current,p,2);
 const unchanged=bench(current,p,1);
 console.log(JSON.stringify({points:n,rounding200OldMs:+old.toFixed(3),rounding200NewMs:+fast.toFixed(3),speedup:+(old/fast).toFixed(2),rounding100NewMs:+unchanged.toFixed(3)}));
}
