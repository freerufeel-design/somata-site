'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:110000});try{
 const rows=await h.evaluate(`(()=>{
  const saved={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,type:state.morph.spiralMorphType,mode:state.morph.mode};
  const phases=[0,.000001,.00001,.000099,.000101,.001,.01,.03499,.03501,.05,.5,.95,.96499,.96501,.99,.999,.999899,.999901,.99999,.999999,1];
  const flat=segments=>{const a=[];for(const s of segments||[])for(let j=0;j<=10;j++){const t=j/10,u=1-t;a.push({x:u*u*u*s.p0.x+3*u*u*t*s.c1.x+3*u*t*t*s.c2.x+t*t*t*s.p3.x,y:u*u*u*s.p0.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2.y+t*t*t*s.p3.y});}return a;};
  const resample=(a,k=200)=>{if(!a.length)return [];const cum=[0];for(let i=1;i<a.length;i++)cum.push(cum.at(-1)+Math.hypot(a[i].x-a[i-1].x,a[i].y-a[i-1].y));let i=1;const out=[];for(let j=0;j<k;j++){const d=j/(k-1)*cum.at(-1);while(i<cum.length-1&&cum[i]<d)i++;const r=(d-cum[i-1])/Math.max(1e-12,cum[i]-cum[i-1]);out.push({x:a[i-1].x+(a[i].x-a[i-1].x)*r,y:a[i-1].y+(a[i].y-a[i-1].y)*r});}return out;};
  const diff=(A,B)=>{if(!A.length||!B.length)return Infinity;let d=0;for(let i=0;i<A.length;i++)d=Math.max(d,Math.hypot(A[i].x-B[i].x,A[i].y-B[i].y));return d;};
  const nodes=[{x:0,y:0},{x:.22,y:.31},{x:.5,y:-.2},{x:.75,y:.27},{x:1,y:0}],data=[];
  try{state.morph.mode='linear';state.morph.spiralMorphType='continuous';
   for(const closed of [false,true])for(const profile of ['segments','spline'])for(const rounding of [50,175]){
    const src=createLayer('spur-a'),dst=createLayer('spur-b');
    Object.assign(src,{N:4,K:2,radius:190,rounding,spiralEnabled:true,spiralOrder:1.2,spiralClosed:closed,spiralRoundSeams:true,spiralTangential:true,profileMode:profile,profileNodes:nodes});
    Object.assign(dst,src,{id:'spur-b',spiralOrder:1.32,rotation:90,profileNodes:nodes.map((n,i)=>({...n,y:n.y+Math.sin(i)*.08}))});
    state.layers=[src];runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];
    const samples=phases.map(t=>{const plan=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t);return resample(flat(plan?.paths?.[0]||[]));});
    const maxBoundary=Math.max(...[0,1,2,16,17,18,19].map(i=>diff(samples[i],samples[i+1])));
    const before=diff(samples[0],samples[1]),after=diff(samples.at(-2),samples.at(-1));
    data.push({closed,profile,rounding,maxBoundary,before,after,allFinite:samples.every(v=>v.length&&v.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))});
   }
  }finally{state.layers=saved.layers;runtimeState.morph.renderSourceLayers=saved.src;runtimeState.morph.renderTargetLayers=saved.dst;state.morph.spiralMorphType=saved.type;state.morph.mode=saved.mode;}
  return data;
 })()`,{label:'11.0.8 actual spiral GPU carrier near phase boundaries',timeoutMs:100000});
 for(const r of rows){assert(r.allFinite,'nonfinite spiral '+JSON.stringify(r));assert(r.before<1.5&&r.after<1.5,'phase endpoint pop '+JSON.stringify(r));assert(r.maxBoundary<5,'spiral phase glitch '+JSON.stringify(r));}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 11.0.8: '+rows.length+' real GPU spiral carrier scenarios including closed/open, segments/spline, 50/175%, 21 phase samples; largest boundary displacement '+Math.max(...rows.map(v=>v.maxBoundary)).toFixed(4));
 }finally{await h.close();}})().catch(e=>{console.error('FAIL real spiral phase',e.stack||e);process.exitCode=1});
