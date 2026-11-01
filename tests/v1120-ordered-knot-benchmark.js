'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const perf=require('perf_hooks').performance;
const base=path.join(__dirname,'fixtures/v1120-unified-fillet-1119.js');
const fresh=path.join(__dirname,'../js/geometry/unified-fillet.js');
const load=x=>new Function(fs.readFileSync(x,'utf8')+'\nreturn drawUnifiedFilletPath')();
const prev=load(base),now=load(fresh);
const ctx={moveTo(){},bezierCurveTo(){},closePath(){}};
function shape(kind,n){return Array.from({length:n},(_,i)=>{const a=Math.PI*2*i/n,r=kind==='circle'?100:kind==='wave'?85+25*Math.sin(6*a):i%2?22:100;return {x:r*Math.cos(a),y:r*Math.sin(a)}})}
function measure(fn,points,repeats=9){const flags=points.map(()=>true),opts={baseEdge:100,maxRadiusDrop:30};for(let i=0;i<3;i++)assert(fn(ctx,points,true,1.7,flags,opts));const samples=[];for(let i=0;i<repeats;i++){const t=perf.now();assert(fn(ctx,points,true,1.7,flags,opts));samples.push(perf.now()-t)}samples.sort((a,b)=>a-b);return samples[Math.floor(samples.length/2)];}
for(const kind of ['wave','circle','saw'])for(const n of [1000,2000,5000]){let points=shape(kind,n),a=measure(prev,points),b=measure(now,points);console.log(kind,n,'11.0.19',a.toFixed(2),'11.0.20',b.toFixed(2),'speedup',(a/b).toFixed(2));}
