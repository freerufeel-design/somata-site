'use strict';const fs=require('fs'),vm=require('vm'),path=require('path');vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
const cases=[];for(const shape of ['circle','waves','saw'])for(const count of [24,100,300]){
 const pts=Array.from({length:count},(_,i)=>{const a=i*2*Math.PI/count;const r=shape==='circle'?100:shape==='waves'?100+8*Math.sin(6*a):(i%3?77:100);return{x:r*Math.cos(a),y:r*Math.sin(a)}});
 cases.push({shape,count,pts,flags:pts.map(()=>true)});
}
let ctx={moveTo(){},bezierCurveTo(){},closePath(){}};
for(const c of cases){
 const measure=full=>{let a=[];for(let i=0;i<13;i++){const t=performance.now();drawUnifiedFilletPath(ctx,c.pts,true,1.2,c.flags,{baseEdge:45,maxRadiusDrop:30,forceFullRadiusGuard:full});a.push(performance.now()-t);}return (a.slice(3).sort((x,y)=>x-y)[4]+a.slice(3).sort((x,y)=>x-y)[5])/2;};
 let full=measure(true),fast=measure(false);console.log(c.shape,c.count,'full',full.toFixed(2),'fast',fast.toFixed(2),'ratio',+(full/fast).toFixed(2));
}
