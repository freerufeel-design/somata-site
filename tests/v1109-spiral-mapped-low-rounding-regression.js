'use strict';
const assert = require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:40000});
 try{
  const result=await h.evaluate(`(()=>{
   const inputs=Array.from({length:9},(_,i)=>({x:i*34,y:45*Math.sin(i*.9),widthScale:1-i*.065}));
   for(let i=0;i<inputs.length-1;i++){
    const p=inputs[i],q=inputs[i+1],dx=q.x-p.x,dy=q.y-p.y;
    p.__spiralBezierC1X=p.x+dx*.3;p.__spiralBezierC1Y=p.y+dy*.3+18;
    p.__spiralBezierC2X=p.x+dx*.7;p.__spiralBezierC2Y=p.y+dy*.7+18;
   }
   const flags=inputs.map((_,i)=>i>0&&i<inputs.length-1);
   const flatten=(c)=>{const out=[];for(const b of c){for(let i=0;i<=24;i++){const t=i/24,u=1-t;out.push({x:u*u*u*b.p0.x+3*u*u*t*b.c1.x+3*u*t*t*b.c2.x+t*t*t*b.p3.x,y:u*u*u*b.p0.y+3*u*u*t*b.c1.y+3*u*t*t*b.c2.y+t*t*t*b.p3.y});}}return out;};
   const same=(a,b)=>{const one=(A,B)=>{let max=0;for(let i=0;i<A.length;i+=3){const p=A[i];let min=Infinity;for(let j=1;j<B.length;j++){const q=B[j-1],r=B[j],dx=r.x-q.x,dy=r.y-q.y,u=Math.max(0,Math.min(1,((p.x-q.x)*dx+(p.y-q.y)*dy)/Math.max(1e-15,dx*dx+dy*dy)));min=Math.min(min,Math.hypot(p.x-q.x-u*dx,p.y-q.y-u*dy));}max=Math.max(max,min);}return max;};return Math.max(one(a,b),one(b,a));};
   const levels=[0,.0008,.000999,.001001,.0012,.01,.04,.079999,.080001,.119999,.12,.120001];
   const results=[];
   for(const tangentOnly of [false,true])for(const flagsCase of [flags,inputs.map(()=>false)]){
    const rail=inputs.map(p=>({...p}));
    if(tangentOnly)for(let i=0;i<rail.length;i++){
       const p=rail[i];delete p.__spiralBezierC1X;delete p.__spiralBezierC1Y;delete p.__spiralBezierC2X;delete p.__spiralBezierC2Y;
       if(i<rail.length-1){p.__spiralBezierOutTx=34;p.__spiralBezierOutTy=55;}
       if(i>0){p.__spiralBezierInTx=34;p.__spiralBezierInTy=-45;}
    }
    const paths=levels.map(r=>flatten(window.__spiroBuildSpiralBezierSegments(rail,r,flagsCase,false)));
    results.push({tangentOnly,steps:levels.slice(1).map((r,i)=>({from:levels[i],to:r,drift:same(paths[i],paths[i+1])})),count:paths.map(x=>x.length)});
   }
   return results;
  })()`,{timeoutMs:35000,label:'mapped spiral low rounding continuity'});
  const near=result.flatMap(r=>r.steps.filter(s=>s.from>=.0008&&s.to<=.0012 || s.from>=.079999&&s.to<=.080001 || s.from>=.119999&&s.to<=.120001));
  const worst=Math.max(...near.map(s=>s.drift));
  assert(worst<1,`mapped Bézier carrier jumped at rounding threshold by ${worst}`);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log(`PASS 11.0.9: mapped Spiral Bézier controls; mapped controls and tangents, both corner policies, 12 rounding levels; worst threshold drift ${worst.toFixed(5)}`);
 }finally{await h.close()}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1});
