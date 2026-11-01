'use strict';
// Regression: an unchanged authored spline must not change shape when the
// base polygon edge crosses an integer sampling step during Morph or scaling.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
// Match the shared centripetal controls without loading the UI.
globalThis.centripetalSplineBezierControls=(p0,p1,p2,p3)=>({
 c1:{x:p1.x+(p2.x-p0.x)/6,y:p1.y+(p2.y-p0.y)/6},
 c2:{x:p2.x-(p3.x-p1.x)/6,y:p2.y-(p3.y-p1.y)/6}
});
const points=[{x:80,y:0},{x:40,y:90},{x:-55,y:74},{x:-95,y:-25},{x:-23,y:-80},{x:75,y:-65}];
const flags=points.map(()=>true);
function render(edge,closed,amount,drop){
 let cursor=null,start=null,commands=0;const poly=[];
 const ctx={moveTo(x,y){cursor={x,y};start=cursor;poly.push(cursor)},
 bezierCurveTo(x1,y1,x2,y2,x,y){
  const p=cursor;commands++;
  for(let j=1;j<=20;j++){
   const t=j/20,u=1-t;
   poly.push({x:u*u*u*p.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,
              y:u*u*u*p.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y});
  }
  cursor={x,y};
 },closePath(){poly.push(start)}};
 const initial=JSON.stringify(points);
 const radius=edge/(2*Math.sin(Math.PI/6));
 assert(drawUnifiedFilletPath(ctx,points,closed,amount,flags,{spline:true,wholeCurveSpline:true,
  layer:{N:6,radius,roundingMaxRadiusDrop:drop}}));
 assert.equal(JSON.stringify(points),initial,'Rounded renderer mutated Morph coordinates');
 assert(poly.every(p=>Number.isFinite(p.x+p.y)),'nonfinite spline output');
 const arc=[0];for(let i=1;i<poly.length;i++)arc.push(arc.at(-1)+Math.hypot(poly[i].x-poly[i-1].x,poly[i].y-poly[i-1].y));
 const total=arc.at(-1);
 const sample=t=>{
  const s=t*total;let lo=1,hi=arc.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(arc[mid]<s)lo=mid+1;else hi=mid;}
  const i=lo,u=Math.min(1,Math.max(0,(s-arc[i-1])/Math.max(1e-12,arc[i]-arc[i-1])));
  return{x:poly[i-1].x*(1-u)+poly[i].x*u,y:poly[i-1].y*(1-u)+poly[i].y*u};
 };
 return{commands,sample,total};
}
let maximum=0,checks=0;
for(const closed of [true,false])for(const amount of [.25,.8,1,1.4,2])
for(const drop of [30,95])for(const threshold of [16,18,20,22,24,26,28,30,32]){
 const a=render(threshold-1e-6,closed,amount,drop);
 const b=render(threshold+1e-6,closed,amount,drop);
 let deviation=0;
 for(let k=0;k<=300;k++){
  const p=a.sample(k/300),q=b.sample(k/300);
  deviation=Math.max(deviation,Math.hypot(p.x-q.x,p.y-q.y));
 }
 maximum=Math.max(maximum,deviation);
 assert.equal(a.commands,b.commands,'fillet topology jumped at a spline sampling boundary');
 assert(deviation<.005,`spline path popped by ${deviation} near edge=${threshold}, closed=${closed}, round=${amount}`);
 checks++;
}
console.log(`PASS 11.0.12: ${checks} spline-radius threshold pairs, max arc-relative deviation ${maximum.toFixed(8)} units`);
