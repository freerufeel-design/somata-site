'use strict';
// Phase and seam stress tests for the replacement topology-free Bézier solver.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../js/geometry/unified-fillet.js'),'utf8'));
function render(points,amount,closed=true,N=8){
 const commands=[],flags=points.map(()=>true),ctx={
  moveTo(...v){commands.push(['M',...v]);},
  lineTo(...v){commands.push(['L',...v]);},
  bezierCurveTo(...v){commands.push(['C',...v]);},
  closePath(){commands.push(['Z']);}
 };
 const used=drawUnifiedFilletPath(ctx,points,closed,amount,flags,{layer:{N,radius:100,roundingMaxRadiusDrop:30}});
 assert(used,`rounding unexpectedly bypassed n=${points.length} amount=${amount}`);
 assert(commands.every(c=>c.slice(1).every(Number.isFinite)),'non-finite corner controls');
 const sampled=[];let p=null,first=null,maxR=0;
 const take=(q)=>{sampled.push(q);maxR=Math.max(maxR,Math.hypot(q.x,q.y));};
 for(const c of commands){
  if(c[0]==='M'){p={x:c[1],y:c[2]};first=p;take(p);}
  if(c[0]==='L'){p={x:c[1],y:c[2]};take(p);}
  if(c[0]==='C'){
   const start=p;
   for(let i=1;i<=20;i++){
    const t=i/20,u=1-t;
    take({x:u*u*u*start.x+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*c[5],
      y:u*u*u*start.y+3*u*u*t*c[2]+3*u*t*t*c[4]+t*t*t*c[6]});
   }
   p={x:c[5],y:c[6]};
  }
 }
 if(closed&&first)take(first);
 const inputR=Math.max(...points.map(p=>Math.hypot(p.x,p.y)));
 assert(maxR>=inputR*.699-0.15,`external radius collapsed: ${maxR}/${inputR}`);
 assert(maxR<=inputR*1.3+2,`outward horn generated: ${maxR}/${inputR}`);
 return {commands,sampled,maxR};
}
// Nearest distance from a sampled outline to a piecewise linear polyline.
// This is geometry-based rather than relying on a matching number of knots.
function distance(p,poly){
 let d=Infinity;
 for(let i=1;i<poly.length;i++){
  const a=poly[i-1],b=poly[i],dx=b.x-a.x,dy=b.y-a.y,
   t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.max(1e-12,dx*dx+dy*dy)));
  d=Math.min(d,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
 }return d;
}
function haus(A,B){
 function one(a,b){let d=0;for(let i=0;i<a.length;i+=Math.max(1,Math.floor(a.length/250)))d=Math.max(d,distance(a[i],b));return d;}
 return Math.max(one(A.sampled,B.sampled),one(B.sampled,A.sampled));
}
const polar=(r,ang)=>({x:r*Math.cos(ang),y:r*Math.sin(ang)});
const square=[polar(100,0),polar(100,Math.PI/2),polar(100,Math.PI),polar(100,3*Math.PI/2)];
const saw=Array.from({length:48},(_,i)=>polar(i%2?44:100,2*Math.PI*i/48));
const spiral=Array.from({length:30},(_,i)=>polar(35+i*2.2,4.4*Math.PI*i/29));
const mini=t=>[square[0],{x:100+2.6*t,y:.8*t},{x:100+3.8*t,y:3.4*t},...square.slice(1)];
const morph=t=>square.map((p,i)=>({x:p.x+t*35*Math.cos(i*1.7),y:p.y+t*25*Math.sin(i*1.2)}));
const winding=t=>spiral.map((p,i)=>({x:p.x+(i/29)*t*5,y:p.y+(i/29)*t*7}));
let cases=0,maxPhaseStep=0,maxSeamError=0;
for(const [name,pathFn,closed,N] of [
 ['mini',mini,true,4],['morph',morph,true,4],['spiral',winding,false,8],
 ['saw',t=>saw.map((p,i)=>({x:p.x*(1+t*.12),y:p.y*(1-t*.09)})),true,8]
]){
 for(const round of [.02,.3,.7,.99999,1,1.00001,1.3,1.75,2]){
  // Finest phase edges near t=0 and t=1; a newborn mini-profile
  // must be invisible at zero size, not trigger a different Bézier family.
  for(const t of [0,.00001,.0001,.01,.25,.5,.99,.9999,.99999]){
   const a=render(pathFn(t),round,closed,N);
   const b=render(pathFn(Math.min(1,t+1e-5)),round,closed,N);
   const step=haus(a,b);
   assert(step<.8,`${name}: phase jump at t=${t}, rounding=${round}: ${step}`);
   maxPhaseStep=Math.max(maxPhaseStep,step);cases++;
  }
  // Relabelling the first vertex must not reconfigure closed overlaps.
  if(closed){
   const poly=pathFn(.51),a=render(poly,round,true,N),b=render([...poly.slice(1),poly[0]],round,true,N);
   const error=haus(a,b);
   assert(error<.65,`${name}: cyclic seam changed shape at ${round}: ${error}`);
   maxSeamError=Math.max(maxSeamError,error);
  }
 }
}
// Vary the rounding through full contact at 100% and 200%, with phase fixed.
for(const [name,poly,closed,N] of [['square',square,true,4],['saw',saw,true,8],['spiral',spiral,false,8]]){
 for(const r of [0.001,.05,.3,.7,.9999,1,1.0001,1.3,1.9999]){
  const a=render(poly,r,closed,N),b=render(poly,r+.00005,closed,N);
  const d=haus(a,b);
  assert(d<.7,`${name}: rounding threshold discontinuity at ${r}: ${d}`);cases++;
 }
}
// The historical U-cap regression used to assert that no C command exists.
// The new algorithm ALWAYS emits exact cubics; instead test the actual curve
// for a sideways ear outside the author's narrow hairpin envelope.
const cap=render([{x:-100,y:0},{x:0,y:0},{x:-100,y:9}],.82,false,4);
assert(cap.sampled.every(p=>p.x>=-100.05&&p.x<=.05&&p.y>=-.05&&p.y<=9.05),
  'U-turn rounding escaped original hairpin triangle envelope');
console.log(`PASS 11.0.6: ${cases} phase/rounding comparisons, closed seam reindexing, open spirals; max phase drift ${maxPhaseStep.toFixed(4)}, max reindex error ${maxSeamError.toFixed(4)}`);
