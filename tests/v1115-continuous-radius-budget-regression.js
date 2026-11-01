'use strict';
// The exterior-radius guard must not switch between disconnected roots of the
// non-monotonic true-radius function as the budget or Morph phase changes.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(process.env.SOMATA_FILLET_SOURCE||path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
const witness=[
 {x:0,y:0},{x:5,y:6.107299740239689},{x:10,y:52.95449655108399},
 {x:15,y:12.274069510183205},{x:20,y:114.12690594973688},
 {x:25,y:8.036393857668784},{x:30,y:74.23546617229049},
 {x:35,y:1.6587855889849301},{x:40,y:-34.370886150090065},
 {x:45,y:-5.548035308620956},{x:50,y:-102.37939260449642},
 {x:55,y:-12.523284578912675},{x:60,y:-62.22195221886625},
 {x:65,y:-11.3105510320793},{x:70,y:-67.6307865179989}
];
function render(points,drop,round=1.8,closed=false){
 const original=JSON.stringify(points),flags=points.map((_,i)=>closed||i>0&&i<points.length-1);
 let cur,start,commands=0,maxRadius=0;const poly=[];
 const add=(x,y)=>{assert(Number.isFinite(x)&&Number.isFinite(y),'non-finite Bézier point');poly.push({x,y});maxRadius=Math.max(maxRadius,Math.hypot(x,y));};
 const ctx={moveTo(x,y){cur={x,y};start=cur;add(x,y);},bezierCurveTo(x1,y1,x2,y2,x,y){
  const p=cur;commands++;for(let k=1;k<=12;k++){const t=k/12,u=1-t;
   add(u*u*u*p.x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x,
       u*u*u*p.y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y);
  }cur={x,y};},closePath(){if(start)add(start.x,start.y);}};
 assert(drawUnifiedFilletPath(ctx,points,closed,round,flags,{baseEdge:150,maxRadiusDrop:drop}));
 assert.equal(JSON.stringify(points),original,'Morph anchors mutated by the fillet guard');
 if(!closed){assert(Math.hypot(poly[0].x-points[0].x,poly[0].y-points[0].y)<1e-8,'start moved');
 assert(Math.hypot(cur.x-points.at(-1).x,cur.y-points.at(-1).y)<1e-8,'end moved');}
 const arcs=[0];for(let i=1;i<poly.length;i++)arcs.push(arcs.at(-1)+Math.hypot(poly[i].x-poly[i-1].x,poly[i].y-poly[i-1].y));
 const length=arcs.at(-1);
 const at=t=>{const s=t*length;let lo=1,hi=arcs.length-1;while(lo<hi){const m=(lo+hi)>>1;if(arcs[m]<s)lo=m+1;else hi=m;}
  const i=lo,v=(s-arcs[i-1])/Math.max(1e-12,arcs[i]-arcs[i-1]);
  return{x:poly[i-1].x+(poly[i].x-poly[i-1].x)*v,y:poly[i-1].y+(poly[i].y-poly[i-1].y)*v};};
 return {at,maxRadius,commands};
}
const difference=(a,b)=>{let max=0;for(let i=0;i<=350;i++){const p=a.at(i/350),q=b.at(i/350);max=Math.max(max,Math.hypot(p.x-q.x,p.y-q.y));}return max;};
const a=render(witness,11.6),b=render(witness,11.8);
const budgetDrift=difference(a,b);
assert(budgetDrift<2,`radius guard jumped between disconnected roots: ${budgetDrift.toFixed(5)} units`);
let phaseMax=0,radiusChecks=0;
for(const closed of [false,true])for(const drop of [0,.01,2,10,30,60])for(const round of [.25,1,2]){
 const p=closed?witness.slice(0,9):witness;
 const perturbed=p.map((q,i)=>({x:q.x+Math.cos(i*.7)*1e-6,y:q.y+Math.sin(i*.9)*1e-6}));
 const x=render(p,drop,round,closed),y=render(perturbed,drop,round,closed);
 const d=difference(x,y);phaseMax=Math.max(phaseMax,d);
 assert(d<.015,`neighboring Morph frames jumped ${d} at drop=${drop}, round=${round}, closed=${closed}`);
 const initialR=Math.max(...p.map(q=>Math.hypot(q.x,q.y)));
 assert(x.maxRadius>=initialR*(1-drop/100)-.3,`radius guard violated ${drop}% outer-radius budget`);
 radiusChecks++;
}
console.log(`PASS 11.0.15: budget-root seam drift ${budgetDrift.toFixed(5)}, ${radiusChecks} fixed-budget neighbor-frame/radius checks, maximum frame drift ${phaseMax.toFixed(7)}`);
