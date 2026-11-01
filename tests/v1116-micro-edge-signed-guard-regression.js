'use strict';
// Real old-version failures: crossing the merge tolerance of two opposing
// tangent jumps must not change the global radius guard by a finite amount.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=process.env.SOMATA_FILLET_SOURCE||path.join(__dirname,'../js/geometry/unified-fillet.js');
vm.runInThisContext(fs.readFileSync(source,'utf8'));
const cases=require('./fixtures/v1116-micro-guard-cases.json');
const valid=(x)=>assert(Number.isFinite(x),'nonfinite Bézier coordinate');
function trace(points,c,skipRadiusSearch){
 const orig=JSON.stringify(points),curve=[];let start=null,current=null;
 const store=(x,y)=>{valid(x);valid(y);curve.push({x,y});};
 const ctx={moveTo(x,y){start=current={x,y};store(x,y);},
  bezierCurveTo(a,b,d,e,x,y){const p=current;for(let k=1;k<=72;k++){
   const t=k/72,u=1-t;store(u*u*u*p.x+3*u*u*t*a+3*u*t*t*d+t*t*t*x,
    u*u*u*p.y+3*u*u*t*b+3*u*t*t*e+t*t*t*y);
  }current={x,y};},closePath(){store(start.x,start.y);}};
 assert(drawUnifiedFilletPath(ctx,points,c.closed,c.round,c.flags,
  {baseEdge:c.base,maxRadiusDrop:c.drop,skipRadiusSearch}),'fillet was not drawn');
 assert.equal(JSON.stringify(points),orig,'fillet modified linear Morph anchors');
 if(!c.closed){
  assert(Math.hypot(start.x-points[0].x,start.y-points[0].y)<1e-8,'open start moved');
  assert(Math.hypot(current.x-points.at(-1).x,current.y-points.at(-1).y)<1e-8,'open end moved');
 }
 return curve;
}
function segmentDistance(p,a,b){
 const dx=b.x-a.x,dy=b.y-a.y;
 const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.max(dx*dx+dy*dy,1e-24)));
 return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
// Symmetric geometric distance, not comparison of Bézier segment counts;
// a real path can have different knot counts without changing its shape.
function distance(a,b){
 const one=(src,dst)=>{let max=0;
  for(let i=0;i<src.length;i+=Math.max(1,Math.floor(src.length/320))){
   let min=Infinity;
   for(let k=1;k<dst.length;k++)min=Math.min(min,segmentDistance(src[i],dst[k-1],dst[k]));
   max=Math.max(max,min);
  }
  return max;
 };
 return Math.max(one(a,b),one(b,a));
}
let peak=0,checks=0;
for(const c of cases){
 const old=trace(c.points,c,true),born=trace(c.bpoints,c,true);
 const base=distance(old,born);
 const a=trace(c.points,c,false),b=trace(c.bpoints,c,false);
 const change=distance(a,b);
 assert(base<.012,`underlying convolution is unstable in case ${c.trial}: ${base}`);
 assert(change<Math.max(.018,base*3),
  `radius guard introduced a discontinuity at mini-edge collapse, case=${c.trial}: ${change}`);
 peak=Math.max(peak,change);checks++;
}
console.log(`PASS 11.0.16: ${checks} old-version micro-edge radius-guard jump witnesses; maximum shape change ${peak.toFixed(7)} units`);
