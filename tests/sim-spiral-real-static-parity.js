'use strict';const fs=require('fs');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:120000});try{
 const r=await h.evaluate(`(()=>{const old={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,transport:state.morph.spiralMorphType};const out=[];
 const pts=qq=>{const a=[];for(const q of qq||[])for(let k=0;k<=16;k++){const t=k/16,u=1-t;a.push({x:u*u*u*q.p0.x+3*u*u*t*q.c1.x+3*u*t*t*q.c2.x+t*t*t*q.p3.x,y:u*u*u*q.p0.y+3*u*u*t*q.c1.y+3*u*t*t*q.c2.y+t*t*t*q.p3.y});}return a;};
 const haus=(qa,qb)=>{const a=pts(qa),b=pts(qb);if(!a.length||!b.length)return Infinity;const d=(x,y)=>{let max=0;for(let i=0;i<x.length;i+=4){let min=Infinity;for(let j=0;j<y.length;j+=4)min=Math.min(min,Math.hypot(x[i].x-y[j].x,x[i].y-y[j].y));max=Math.max(max,min);}return max;};return Math.max(d(a,b),d(b,a));};
 const P=[{x:0,y:0},{x:.16,y:.38},{x:.49,y:-.28},{x:.78,y:.23},{x:1,y:0}],Q=[{x:0,y:0},{x:.15,y:-.28},{x:.49,y:.37},{x:.78,y:-.25},{x:1,y:0}];
 try{state.morph.spiralMorphType='continuous';for(const closed of [true,false])for(const profile of ['segments','spline-local','spline-whole'])for(const round of [0,55,120]){
 const src=createLayer('a'),dst=createLayer('b');Object.assign(src,{N:4,K:1,spiralEnabled:true,spiralOrder:1,spiralClosed:closed,spiralTangential:true,spiralRoundSeams:true,radius:220,rounding:round,profileMode:profile==='segments'?'segments':'spline',wholeCurveSpline:profile==='spline-whole',profileNodes:P});Object.assign(dst,src,{id:'b',profileNodes:Q});
 state.layers=[src];runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];
 const pm=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1);
 const stat=getCachedLayerDrawData(dst);const paths=stat?.paths||[];
 out.push({closed,profile,round,branchCount:paths.length,prepared:pm.preparedContinuousSplineRail,live:pm.liveRoundedSpline,
   targetDist:haus(pm.paths[0],pm.targetPaths[0]),staticDist:haus(pm.paths[0],paths[0]?._bezierSegments),
   countMorph:pm.paths[0]?.length,countTarget:pm.targetPaths[0]?.length,countStatic:paths[0]?._bezierSegments?.length,
   allBranches:paths.map((path,i)=>({i,dist:haus(pm.paths[i],path._bezierSegments),morph:pm.paths[i]?.length,static:path._bezierSegments?.length}))});
 }}finally{state.layers=old.layers;runtimeState.morph.renderSourceLayers=old.src;runtimeState.morph.renderTargetLayers=old.dst;state.morph.spiralMorphType=old.transport;}return out;})()`,{label:'compare prepared terminal GPU Spiral cubics with actual static draw cache',timeoutMs:120000});
 fs.writeFileSync('/mnt/data/somata_spiral_static_parity.json',JSON.stringify({cases:r,uncaught:uncaughtExceptions(h.events)},null,2));
 for(const x of r)console.log((x.closed?'closed':'open').padEnd(6),x.profile.padEnd(13),String(x.round).padStart(3),'target='+x.targetDist.toFixed(4),'static='+x.staticDist.toFixed(3),x.countMorph,x.countStatic,'branches',x.branchCount);
 }finally{await h.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
