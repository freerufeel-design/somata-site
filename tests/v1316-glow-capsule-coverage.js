'use strict';
const {createBrowserHarness}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:60000});try{
 const r=await h.evaluate(`(()=>{
 const nodes=[{x:0,y:0},{x:.17,y:.3},{x:.4,y:-.23},{x:.67,y:.32},{x:1,y:0}];
 const ls=Array.from({length:3},(_,i)=>{const l=createLayer('glow-visual-'+i);Object.assign(l,{N:17+i,K:5+i,radius:165+i*22,rotation:13*i,rounding:160,profileMode:'spline',profileNodes:nodes,spiralEnabled:true,spiralOrder:3,spiralStepLinked:false,spiralStep:2.75+i*.05,spiralClosed:true,spiralRoundSeams:true,spiralTangential:true,glow:12});ensureLayerEffectState(l);return l});state.layers=ls;state.activeLayerId=ls[0].id;runtimeState.morph.active=true;runtimeState.morph.mode='circleSlide';runtimeState.morph.geometryT=.45;runtimeState.morph.progress=.45;runtimeState.morph.renderSourceLayers=ls.map(l=>({...l}));runtimeState.morph.renderTargetLayers=ls.map((l,i)=>({...l,N:l.N+1,K:l.K+1,rotation:l.rotation+32+i*7,profileNodes:nodes.map((p,j)=>({...p,y:p.y+Math.sin(j+i)*.1}))}));
 const curves=ls.flatMap((l,i)=>(__somataSpiralCarrierMorphPlan(i,.45)?.paths||[]).flat());
 const pt=(q,t)=>{const u=1-t;return{x:u*u*u*q.p0.x+3*u*u*t*q.c1.x+3*u*t*t*q.c2.x+t*t*t*q.p3.x,y:u*u*u*q.p0.y+3*u*u*t*q.c1.y+3*u*t*t*q.c2.y+t*t*t*q.p3.y}};
 const sat=x=>Math.max(0,Math.min(1,x));const smooth=x=>{x=sat(x);return x*x*(3-2*x)};
 function cov(a,b,w0,w1,p,r=6.6){const d={x:b.x-a.x,y:b.y-a.y},len=Math.max(.0001,Math.hypot(d.x,d.y)),q=sat(((p.x-a.x)*d.x+(p.y-a.y)*d.y)/(len*len)),c={x:a.x+q*d.x,y:a.y+q*d.y};const hw=Math.exp(Math.log(w0)*(1-q)+Math.log(w1)*q),edge=Math.max(0,Math.hypot(p.x-c.x,p.y-c.y)-hw);return Math.exp(-Math.pow(edge/Math.max(.55,r*.44),2)*1.65)*(1-smooth((edge-r*.76)/((r+2)-r*.76)));}
 const glowRadius=12*.55;let maxDiff=0,meanDiff=0,count=0,joins=0,wideDiff=0;
 for(const [ci,q] of curves.entries()){
  if(ci%7!==0)continue;const l0=Math.log(Math.max(.02,Number(q.widthScale0)||1)),l1=Math.log(Math.max(.02,Number(q.widthScale1)||1));
  for(let j=0;j<8;j+=2){const a=pt(q,j/8),m=pt(q,(j+1)/8),b=pt(q,(j+2)/8),d={x:b.x-a.x,y:b.y-a.y},f=sat(((m.x-a.x)*d.x+(m.y-a.y)*d.y)/Math.max(.000001,d.x*d.x+d.y*d.y));const err=Math.hypot(m.x-a.x-f*d.x,m.y-a.y-f*d.y);const w0=Math.max(.18,1.25*Math.exp(l0+(l1-l0)*(j/8))),wm=Math.max(.18,1.25*Math.exp(l0+(l1-l0)*((j+1)/8))),we=Math.max(.18,1.25*Math.exp(l0+(l1-l0)*((j+2)/8)));const predicted=Math.exp(Math.log(w0)*(1-f)+Math.log(we)*f);if((m.x-a.x)*(b.x-m.x)+(m.y-a.y)*(b.y-m.y)<=0||err>Math.min(.60,Math.max(.22,glowRadius*.045))||Math.abs(wm-predicted)>Math.min(.25,Math.max(.12,glowRadius*.020)))continue;
   joins++;
   const length=Math.hypot(d.x,d.y),normal={x:-d.y/Math.max(.000001,length),y:d.x/Math.max(.000001,length)};
   // Quantified coverage error over relevant glow offsets, from both sides.
   for(const t of [0,.2,.4,.6,.8,1])for(const n of [-14,-10,-6,-3,0,3,6,10,14]){
    const p={x:a.x+t*d.x+n*normal.x,y:a.y+t*d.y+n*normal.y};const old=Math.max(cov(a,m,w0,wm,p),cov(m,b,wm,we,p)),fresh=cov(a,b,w0,we,p),diff=Math.abs(old-fresh);maxDiff=Math.max(maxDiff,diff);meanDiff+=diff;count++;if(diff>.12)wideDiff++;
   }
  }
 }
 return{curves:curves.length,glowRadius,joins,samples:count,maxAlphaError:Number(maxDiff.toFixed(6)),meanAlphaError:Number((meanDiff/Math.max(1,count)).toFixed(6)),samplesOver12Pct:wideDiff};
})()`,{timeoutMs:60000});
 assert(r.joins>100);console.log(JSON.stringify(r,null,2));
 }finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
