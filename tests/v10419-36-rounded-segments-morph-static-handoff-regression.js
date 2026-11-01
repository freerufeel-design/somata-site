'use strict';
// Order is held at exactly 1. The CPU rounded-segment Morph must use the
// same authored corner profile as Static at both endpoints, even if rounding
// starts/ends at zero. Both tangential and conventional coils are covered.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:70000});
 try{
  const out=await h.evaluate(`(()=>{
   const rows=[];
   const profiles=[
    [{x:0,y:0},{x:.17,y:.48},{x:.5,y:-.32},{x:.8,y:.20},{x:1,y:0}],
    [{x:0,y:0},{x:.16,y:-.34},{x:.47,y:.35},{x:.77,y:-.24},{x:1,y:0}]
   ];
   const N=7,K=2,R=220,rotation=12,rad=rotation*Math.PI/180;
   const P=Array.from({length:N},(_,j)=>{const angle=(j*K%N)*Math.PI*2/N+rad-Math.PI/2;return{x:R*Math.cos(angle),y:R*Math.sin(angle)};});
   const distance=(a,b)=>{
    if(a.length!==b.length)return Infinity;
    let max=0;
    for(let i=0;i<a.length;i++)max=Math.max(max,Math.hypot(a[i].x-b[i].x,a[i].y-b[i].y));
    return max;
   };
   const polyDistance=(point,poly)=>{
    let best=Infinity;
    for(let i=0;i<poly.length-1;i++){
     const a=poly[i],b=poly[i+1],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
     const u=l2>1e-12?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/l2)):0;
     best=Math.min(best,Math.hypot(point.x-(a.x+u*dx),point.y-(a.y+u*dy)));
    }
    return best;
   };
   const outlineDistance=(a,b)=>Math.max(
    ...a.map(p=>polyDistance(p,b)),...b.map(p=>polyDistance(p,a)));
   const shape=(nodes,round,tangent,closed)=>{
    const o={spiralEnabled:true,spiralOrder:1,spiralTangential:tangent?1:0,
     spiralClosed:closed,spiralRoundSeams:true,roundingFrac:round/100,
     authoredRoundedSpiralMorph:true,spiralStep:K,polygonN:N,
     profileMode:'segments',lineJoinType:'rounded',scratch:{}};
    return applyProfileToVertexRing(P,nodes,R,true,o)[0]?.points||[];
   };
   for(const tangent of [false,true])for(const closed of [false,true])
    for(const roundPair of [[0,55],[55,0],[20,90],[90,20]])
     for(const forward of [true,false]){
      const a=createLayer('handoff-a'),b=createLayer('handoff-b');
      const first=forward?0:1,last=1-first;
      Object.assign(a,{N,K,radius:R,rotation,spiralStepLinked:false,spiralStep:K,
       spiralEnabled:true,spiralOrder:1,spiralTangential:tangent,
       spiralClosed:closed,spiralRoundSeams:true,profileMode:'segments',
       rounding:roundPair[first],profileNodes:profiles[first]});
      Object.assign(b,a,{id:'handoff-b',rounding:roundPair[last],profileNodes:profiles[last]});
      const staticA=buildOrbitPolylines(a)[0].points;
      const staticB=buildOrbitPolylines(b)[0].points;
      const cpuA=shape(profiles[first],roundPair[first],tangent,closed);
      const cpuB=shape(profiles[last],roundPair[last],tangent,closed);
      const near=(t)=>{
       const nodes=profiles[first].map((p,i)=>({x:p.x+(profiles[last][i].x-p.x)*t,y:p.y+(profiles[last][i].y-p.y)*t}));
       return shape(nodes,roundPair[first]+(roundPair[last]-roundPair[first])*t,tangent,closed);
      };
      const near0=outlineDistance(near(.000001),staticA);
      const near1=outlineDistance(near(.999999),staticB);
      rows.push({tangent,closed,roundPair,forward,
       countA:[cpuA.length,staticA.length],countB:[cpuB.length,staticB.length],
       startError:distance(cpuA,staticA),endError:distance(cpuB,staticB),near0,near1});
     }
   return{rows,removed:!document.getElementById('paramWholeCurveSpline')};
  })()`,{label:'rounded segments order-one CPU Morph static continuity'});
  assert(out.removed,'obsolete whole-curve spline UI remains');
  assert.equal(out.rows.length,32);
  for(const q of out.rows){
   assert(q.startError<1e-8&&q.endError<1e-8,'Morph/static rounded control mismatch: '+JSON.stringify(q));
   assert(q.near0<.03&&q.near1<.03,'rounded endpoint jump within 1e-6: '+JSON.stringify(q));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 32 constant-order-one segment-profile Morph/Static boundary cases, rounded/tangential/open/closed, both directions and zero-rounding endpoints');
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
