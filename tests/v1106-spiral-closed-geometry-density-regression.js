'use strict';
const {createBrowserHarness}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:100000});try{const x=await h.evaluate(`(()=>{
const A=createLayer('sp-a'),B=createLayer('sp-b');
const nodesA=[{x:0,y:0},{x:.16,y:.38},{x:.49,y:-.28},{x:.78,y:.23},{x:1,y:0}],nodesB=[{x:0,y:0},{x:.15,y:-.28},{x:.49,y:.37},{x:.78,y:-.25},{x:1,y:0}];
Object.assign(A,{N:4,K:1,spiralEnabled:true,spiralOrder:1,spiralClosed:true,spiralRoundSeams:true,spiralTangential:true,radius:220,rounding:55,profileMode:'spline',wholeCurveSpline:false,profileNodes:nodesA});
Object.assign(B,A,{id:'sp-b',profileNodes:nodesB,spiralOrder:1.18});
const saved={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,transport:state.morph.spiralMorphType,mode:state.morph.mode,transition:state.morph.profileModeTransition,fourier:state.fourierMode};
try{
state.fourierMode=false;state.morph.mode='linear';state.morph.spiralMorphType='continuous';state.morph.profileModeTransition='phase';state.layers=[A];runtimeState.morph.renderSourceLayers=[A];runtimeState.morph.renderTargetLayers=[B];
const plan=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1),frame=plan.carrierFrames[0],path=__spiroBuildSpiralCarrierPath(B,frame.anchor,{radius:220,delta:frame.delta,targetScale:frame.targetScale,tangential:frame.tangential,closed:true,roundSeams:true,roundingFrac:.55,profileNodes:B.profileNodes});
const c1=plan.paths[0],c2=path._bezierSegments;
const sample=(c,N)=>{const p=[];for(const b of c)for(let j=0;j<=N;j++){const t=j/N,u=1-t;p.push({x:u*u*u*b.p0.x+3*u*u*t*b.c1.x+3*u*t*t*b.c2.x+t*t*t*b.p3.x,y:u*u*u*b.p0.y+3*u*u*t*b.c1.y+3*u*t*t*b.c2.y+t*t*t*b.p3.y});}return p;};
const haus=(A,B)=>{const d=(a,b)=>{let m=0;for(let i=0;i<a.length;i+=Math.max(1,Math.floor(a.length/750))){const p=a[i];let best=1e9;for(let j=0;j<b.length;j++){const q=b[j],x=p.x-q.x,y=p.y-q.y,dd=x*x+y*y;if(dd<best)best=dd;}m=Math.max(m,Math.sqrt(best));}return m;};return Math.max(d(A,B),d(B,A));};
const res={counts:[c1.length,c2.length],byDensity:[]};for(let N of [12,30,70])res.byDensity.push({N,dist:haus(sample(c1,N),sample(c2,N))});return res;
}finally{state.layers=saved.layers;runtimeState.morph.renderSourceLayers=saved.src;runtimeState.morph.renderTargetLayers=saved.dst;state.morph.spiralMorphType=saved.transport;state.morph.mode=saved.mode;state.morph.profileModeTransition=saved.transition;state.fourierMode=saved.fourier;}
})()`,{timeoutMs:100000});assert(x.byDensity[2].dist<.6 && x.byDensity[2].dist<x.byDensity[0].dist, 'closed spiral endpoint has a persistent geometry discontinuity: '+JSON.stringify(x));console.log('PASS 11.0.6 spiral closed cubic end phase: dense curve sampling converges',JSON.stringify(x));}finally{await h.close();}})().catch(e=>{console.error(e);process.exitCode=1});
