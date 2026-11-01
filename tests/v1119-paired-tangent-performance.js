'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
function load(file){return new Function(fs.readFileSync(file,'utf8')+'\nreturn drawUnifiedFilletPath;')()}
const prior=load(path.join(__dirname,'fixtures/v1119-unified-fillet-1118.js'));
const current=load(path.join(__dirname,'../js/geometry/unified-fillet.js'));
const ctx={moveTo(){},bezierCurveTo(){},closePath(){}};
function med(a){return a.sort((a,b)=>a-b)[a.length>>1]}
for(let n of [500,1000,2000,5000])for(let kind of ['wave','circle','saw']){
 const pts=Array.from({length:n},(_,k)=>{const a=2*Math.PI*k/n,r=kind==='wave'?85+25*Math.sin(a*6):kind==='circle'?100:k%2?25:100;return {x:r*Math.cos(a),y:r*Math.sin(a)}});
 const flags=pts.map(()=>true),opts={baseEdge:100,maxRadiusDrop:30};
 function run(fn){return fn(ctx,pts,true,1.7,flags,opts)}
 for(let j=0;j<3;j++){run(prior);run(current)}
 let first=[],second=[];
 for(let j=0;j<7;j++){
  if(j%2){let t=performance.now();run(current);second.push(performance.now()-t);t=performance.now();run(prior);first.push(performance.now()-t)}
  else{let t=performance.now();run(prior);first.push(performance.now()-t);t=performance.now();run(current);second.push(performance.now()-t)}
 }
 console.log(`${kind.padEnd(7)} ${String(n).padStart(4)}: 11.0.18 ${med(first).toFixed(2)} ms; 11.0.19 ${med(second).toFixed(2)} ms`);
}
