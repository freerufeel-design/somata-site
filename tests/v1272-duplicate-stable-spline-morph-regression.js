'use strict';
// Geometric, not raster-only: adding a zero-length Morph topology slot must
// leave surviving Bézier cubics unchanged, and separation must be continuous.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const box=vm.createContext({Math,Number,Float64Array});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/geometry/spline-corner-mode.js'),'utf8'),box);
function record(points,closed,rounding,spiralEnabled=false,duplicateStable=true){
 const commands=[],ctx={moveTo:(...a)=>commands.push(['M',...a]),lineTo:(...a)=>commands.push(['L',...a]),
  bezierCurveTo:(...a)=>commands.push(['C',...a]),closePath:()=>commands.push(['Z'])};
 assert.equal(box.somataDrawSplineCornerMode(ctx,points,closed,rounding/100,
  {layer:{N:4,radius:220,radiusMultiplier:1,spiralEnabled},duplicateStable}),true);
 const cubics=[];let current=null;
 for(const c of commands){
  if(c[0]==='M')current={x:c[1],y:c[2]};
  if(c[0]==='C'){
   const end={x:c[5],y:c[6]};
   const q={p0:current,c1:{x:c[1],y:c[2]},c2:{x:c[3],y:c[4]},p3:end};
   const distance=Math.hypot(end.x-current.x,end.y-current.y);
   if(distance>1e-8)cubics.push(q); // a duplicated vertex creates an exactly degenerate cubic
   current=end;
  }
 }
 return cubics;
}
function deviation(a,b,ignoreVeryShort=false){
 if(ignoreVeryShort) b=b.filter(q=>Math.hypot(q.p3.x-q.p0.x,q.p3.y-q.p0.y)>0.001);
 if(a.length!==b.length)throw Error(`Different surviving cubic counts: ${a.length} vs ${b.length}`);
 let max=0;
 for(let j=0;j<a.length;j++)for(const key of ['p0','c1','c2','p3']){
  const x=a[j][key],y=b[j][key];
  max=Math.max(max,Math.hypot(x.x-y.x,x.y-y.y));
 }
 return max;
}
const square=[{x:220,y:0},{x:0,y:220},{x:-220,y:0},{x:0,y:-220}];
const open=[{x:-200,y:-130},{x:-125,y:80},{x:25,y:100},{x:175,y:-95}];
let checks=0;
for(const [vertices,closed] of [[square,true],[open,false]]){
 for(const amount of [0.001,15,50,100,125,175,199.9,200]){
  const baseline=record(vertices,closed,amount);
  for(let pos=0;pos<vertices.length;pos++){
   const duplicate=vertices.map(p=>({...p}));duplicate.splice(pos,0,{...vertices[pos]});
   const same=record(duplicate,closed,amount);
   const error=deviation(baseline,same);
   assert(error<1e-7,`Duplicated vertex changed a surviving cubic (closed=${closed}, amount=${amount}, pos=${pos}): ${error}`);
   // Taking an infinitesimal first Morph step must NOT create a finite jump.
   const near=duplicate.map(p=>({...p}));
   near[pos].x+=1e-6;near[pos].y-=2e-6;
   const nearError=deviation(baseline,record(near,closed,amount),true);
   assert(nearError<0.005,`Infinitesimal duplicate separation jumped ${nearError}`);
   checks+=2;
  }
 }
}
for(const amount of [10,50,100,140,200]){
 const baseline=record(open,false,amount,true);
 const pts=open.map(p=>({...p}));pts.splice(2,0,{...pts[2]});
 assert(deviation(baseline,record(pts,false,amount,true))<1e-7,
  `Spiral duplicate changed a surviving cubic at ${amount}%`);
 checks++;
}
// Smoothly turn off the repair before near-duplicate/normal edge classification.
// Both samples are physically close; their curves must be close too.
for(const amount of [50,140]){
 const a=square.map(p=>({...p})),b=square.map(p=>({...p}));
 a.splice(1,0,{...a[1],x:a[1].x+7.99});
 b.splice(1,0,{...b[1],x:b[1].x+8.01});
 assert(deviation(record(a,true,amount),record(b,true,amount))<0.5,
  'Near-duplicate tangent transition introduced a new hard step');
 checks++;
}
console.log('PASS duplicate-stable Morph Spline+:',checks,'geometric comparisons');
