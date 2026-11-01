'use strict';
// Reproduction: the old convolution moved free open-spiral endpoints by 8+ units
// at 200% rounding, even though the source Morph rail had not moved.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
globalThis.centripetalSplineBezierControls=(p0,p1,p2,p3)=>({
 c1:{x:p1.x+(p2.x-p0.x)/6,y:p1.y+(p2.y-p0.y)/6},
 c2:{x:p2.x-(p3.x-p1.x)/6,y:p2.y-(p3.y-p1.y)/6}
});
const norm=p=>Math.hypot(p.x,p.y),minus=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function shape(points,round,drop,spline,guard=true){
 const commands=[],flags=points.map((_,i)=>i>0&&i<points.length-1);
 const ctx={moveTo(x,y){commands.push(['M',x,y]);},bezierCurveTo(...p){assert(p.every(Number.isFinite),'nonfinite cubic');commands.push(['C',...p]);},closePath(){throw Error('Open spiral was unexpectedly closed')}};
 const original=JSON.stringify(points);
 assert(drawUnifiedFilletPath(ctx,points,false,round,flags,{spline,wholeCurveSpline:spline,baseEdge:110,maxRadiusDrop:drop,skipRadiusSearch:!guard}));
 assert.equal(JSON.stringify(points),original,'Renderer mutated Morph anchors');
 const first={x:commands[0][1],y:commands[0][2]},lastCommand=commands.at(-1),last={x:lastCommand[5],y:lastCommand[6]};
 assert(norm(minus(first,points[0]))<1e-8,`open start drifted by ${norm(minus(first,points[0]))}`);
 assert(norm(minus(last,points.at(-1)))<1e-8,`open end drifted by ${norm(minus(last,points.at(-1)))}`);
 if(!spline){
   const a=minus(points[1],points[0]),b=minus({x:commands[1][1],y:commands[1][2]},first);
   const c=minus(points.at(-1),points.at(-2)),d=minus(last,{x:lastCommand[3],y:lastCommand[4]});
   const cross=(p,q)=>p.x*q.y-p.y*q.x;
   if(norm(b)>1e-8)assert(Math.abs(cross(a,b))/(norm(a)*norm(b))<1e-7,'start tangent changed');
   if(norm(d)>1e-8)assert(Math.abs(cross(c,d))/(norm(c)*norm(d))<1e-7,'end tangent changed');
   assert(a.x*b.x+a.y*b.y>0,'start tangent reversed');
   assert(c.x*d.x+c.y*d.y>0,'end tangent reversed');
 }
 return commands;
}
const spiral=(n,t)=>Array.from({length:n},(_,i)=>{
 const s=i/(n-1),a=3.7*Math.PI*s+t*.2,r=20+110*s;
 return{x:4+r*Math.cos(a),y:-2+r*Math.sin(a)};
});
const shapes=[
 [{x:0,y:0},{x:30,y:0},{x:30,y:100}],
 [{x:0,y:0},{x:25,y:0},{x:25,y:80},{x:65,y:100}],
 [{x:5,y:8},{x:50,y:5},{x:30,y:35},{x:100,y:40}],
 ...[4,6,12,24].map(n=>spiral(n,0))
];
let checks=0;
for(const points of shapes)for(const spline of [false,true])for(const round of [.05,.4,1,1.3,2])for(const drop of [0,30,95]){
 shape(points,round,drop,spline);checks++;
}
// Check that the same source points at neighboring Morph phases remain stable;
// no angular wrap or phase-specific endpoint pin is allowed.
let max=0;
for(const t of [0,1e-7,.001,.05,.25,.5,.75,.95,.999,1-1e-7]){
 const a=spiral(12,t),b=spiral(12,t+1e-7);
 for(const spline of [false,true])for(const round of [.5,1,2]){
  const c=shape(a,round,30,spline),d=shape(b,round,30,spline);
  assert.equal(c.length,d.length,'neighboring phases changed cubic command count');
  for(let j=0;j<c.length;j++)for(let k=1;k<c[j].length;k++)
   max=Math.max(max,Math.abs(c[j][k]-d[j][k]));
  checks++;
 }
}
assert(max<.002,`neighbor phase control points jumped by ${max}`);
console.log(`PASS 11.0.13: ${checks} anchored open profiles and spiral phase checks; max adjacent-phase control drift ${max.toExponential(3)}`);
