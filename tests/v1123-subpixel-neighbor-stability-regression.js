'use strict';
// Distinct from control-point parity: compare the visible geometry on either
// side of sub-pixel Morph and parameter changes, even if knot count changes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
vm.runInThisContext(fs.readFileSync(path.join(root,'js/geometry/unified-fillet.js'),'utf8'));
globalThis.centripetalSplineBezierControls=new Function('window',
 fs.readFileSync(path.join(root,'js/geometry/spline.js'),'utf8')+
 '\nreturn centripetalSplineBezierControls;')({__spiroRegisterModule(){}});
let seed=238751;function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function trace(points,r,closed,flags,opts){
 const copy=JSON.stringify(points),calls=[];
 const ctx={moveTo(x,y){calls.push([0,x,y]);},bezierCurveTo(...xy){calls.push([1,...xy]);},closePath(){calls.push([2]);}};
 const used=drawUnifiedFilletPath(ctx,points,closed,r,flags,opts);
 assert.equal(JSON.stringify(points),copy,'Changed linear Morph points');
 for(const call of calls)for(const val of call.slice(1))assert(Number.isFinite(val),'Non-finite Bézier control');
 return used?calls:null;
}
function sample(calls){const out=[];let current,first;
 for(const c of calls){if(c[0]===0){current=first={x:c[1],y:c[2]};out.push(current);continue;}
  if(c[0]===1){const [_,a,b,d,e,x,y]=c,old=current;
   for(let k=1;k<=10;k++){const t=k/10,u=1-t;
    out.push({x:u*u*u*old.x+3*u*u*t*a+3*u*t*t*d+t*t*t*x,
      y:u*u*u*old.y+3*u*u*t*b+3*u*t*t*e+t*t*t*y});}
   current={x,y};
  }else if(first){out.push(first);}}
 return out;
}
function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y;
 const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.max(1e-20,dx*dx+dy*dy)));
 return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function shapeDistance(commandsA,commandsB){const A=sample(commandsA),B=sample(commandsB);
 const directional=(from,to)=>{let max=0;const stride=Math.max(1,Math.floor(from.length/300));
  for(let i=0;i<from.length;i+=stride){let min=Infinity;
   for(let j=1;j<to.length;j++)min=Math.min(min,segmentDistance(from[i],to[j-1],to[j]));
   max=Math.max(max,min);}
  return max;};return Math.max(directional(A,B),directional(B,A));
}
let checks=0,maximum=0;
for(let i=0;i<600;i++){
 const count=3+Math.floor(rnd()*11),closed=rnd()<.65,spline=rnd()<.32;
 const points=[];let x=0,y=0;
 for(let j=0;j<count;j++){
  const scale=rnd()<.35?Math.pow(10,-9+rnd()*7):10+rnd()*85;
  const angle=rnd()*Math.PI*2;x+=Math.cos(angle)*scale;y+=Math.sin(angle)*scale;
  points.push({x,y});
 }
 if(closed&&rnd()<.25){const offset=rnd()*Math.PI*2;
  for(let j=0;j<count;j++){const r=30+rnd()*100,a=offset+2*Math.PI*j/count;
   points[j]={x:r*Math.cos(a),y:r*Math.sin(a)};}}
 const flags=points.map(()=>rnd()>.3);
 const rounding=[.1,.5,.99,1,1.3,1.7,2][Math.floor(rnd()*7)];
 const opts={baseEdge:20+rnd()*150,maxRadiusDrop:[0,2,10,30,70,95][Math.floor(rnd()*6)],
  spline,wholeCurveSpline:rnd()<.5};
 const perturbPoints=points.map(p=>({x:p.x+(rnd()-.5)*2e-7,y:p.y+(rnd()-.5)*2e-7}));
 const a=trace(points,rounding,closed,flags,opts),b=trace(perturbPoints,rounding,closed,flags,opts);
 if(a&&b){const d=shapeDistance(a,b);assert(d<.2,`Morph microstep changed contour by ${d} at case ${i}`);
  maximum=Math.max(maximum,d);checks++;}
 const changedOpts={...opts};if(i%2===0)changedOpts.baseEdge*=1+1e-9;
 else changedOpts.maxRadiusDrop+=1e-6;
 const c=trace(points,rounding,closed,flags,changedOpts);
 if(a&&c){const d=shapeDistance(a,c);assert(d<.2,`Radius microstep changed contour by ${d} at case ${i}`);
  maximum=Math.max(maximum,d);checks++;}
}
assert(checks>1000,`Too few drawn geometry pairs (${checks})`);
console.log(`PASS 11.0.23: ${checks} nearby Morph/rounding parameter pairs; maximum geometric distance ${maximum.toFixed(6)} units`);
