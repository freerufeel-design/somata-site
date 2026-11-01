'use strict';
const fs=require('fs'),path=require('path'),{performance}=require('perf_hooks');
const root=path.join(__dirname,'..');
const fn=new Function('window',fs.readFileSync(path.join(root,'js/geometry/unified-fillet.js'),'utf8')+'\nreturn drawUnifiedFilletPath;')({});
const ctx={moveTo(){},bezierCurveTo(){},closePath(){}};
const med=a=>a.sort((a,b)=>a-b)[a.length>>1];
for(const n of [1000,2000,5000])for(const kind of ['circle','wave','saw']){
 const p=Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2,r=kind==='circle'?100:kind==='wave'?85+25*Math.sin(a*6):i%2?25:100;return{x:r*Math.cos(a),y:r*Math.sin(a)};});
 const opts={baseEdge:100,maxRadiusDrop:30};const flags=p.map(()=>true);
 const bench=fast=>{for(let i=0;i<3;i++)fn(ctx,p,true,1.5,flags,{...opts,fastPolynomialFillets:fast});const times=[];for(let i=0;i<7;i++){const t=performance.now();fn(ctx,p,true,1.5,flags,{...opts,fastPolynomialFillets:fast});times.push(performance.now()-t);}return med(times);};
 const baseline=bench(false),sweep=bench(true);
 console.log(JSON.stringify({n,kind,baselineMs:+baseline.toFixed(2),sweepMs:+sweep.toFixed(2),speedup:+(baseline/sweep).toFixed(2)}));
}
