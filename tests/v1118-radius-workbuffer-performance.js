'use strict';
// Diagnostic microbenchmark only. Measurements are not full application FPS.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const load=p=>new Function(fs.readFileSync(p,'utf8')+'\nreturn drawUnifiedFilletPath;')();
const old=load(path.join(__dirname,'fixtures/v1118-radius-guard-reference-1117.js'));
const current=load(path.join(root,'js/geometry/unified-fillet.js'));
const ctx={moveTo(){},bezierCurveTo(){},closePath(){}};
function pts(n,type){return Array.from({length:n},(_,i)=>{
 const a=2*Math.PI*i/n,r=type==='circle'?100:type==='wave'?80+15*Math.sin(i*2*Math.PI*7/n):i%2?35:100;
 return{x:r*Math.cos(a),y:r*Math.sin(a)};
});}
function median(a){return a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];}
for(const n of [300,1000,2000,5000])for(const type of ['circle','wave','saw']){
 const points=pts(n,type),flags=points.map(()=>true),op={baseEdge:120,maxRadiusDrop:30};
 const run=fn=>fn(ctx,points,true,2,flags,op);
 const versions=[old,current];
 for(let i=0;i<3;i++)for(const fn of versions)run(fn);
 const a=[[],[]];
 for(let i=0;i<7;i++)for(const k of (i%2?[1,0]:[0,1])){
  const begin=performance.now();run(versions[k]);a[k].push(performance.now()-begin);
 }
 const before=median(a[0]),after=median(a[1]);
 console.log(`${type.padEnd(6)} n=${String(n).padStart(4)} baseline=${before.toFixed(2)} ms current=${after.toFixed(2)} ms speedup=${(before/after).toFixed(2)}x`);
}
