'use strict';
const fs=require('fs');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:160000});
 try{const result=await h.evaluate(`(()=>{
 const sv={layers:state.layers,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,transport:state.morph.spiralMorphType,mode:state.morph.mode,profileTiming:state.morph.profileModeTransition,fourier:state.fourierMode};
 const out=[],nodesA=[{x:0,y:0},{x:.16,y:.38},{x:.49,y:-.28},{x:.78,y:.23},{x:1,y:0}],nodesB=[{x:0,y:0},{x:.15,y:-.28},{x:.49,y:.37},{x:.78,y:-.25},{x:1,y:0}];
 const T=[0,.1,.25,.5,.75,.9,.95,.975,.99,.995,.999,.9999,1];
 const values=q=>(q||[]).flatMap(c=>[c.p0.x,c.p0.y,c.c1.x,c.c1.y,c.c2.x,c.c2.y,c.p3.x,c.p3.y]);
 const sample=cubics=>{const arr=[];for(const c of cubics||[])for(let j=0;j<=12;j++){
  const t=j/12,z=1-t;arr.push({x:z*z*z*c.p0.x+3*z*z*t*c.c1.x+3*z*t*t*c.c2.x+t*t*t*c.p3.x,
   y:z*z*z*c.p0.y+3*z*z*t*c.c1.y+3*z*t*t*c.c2.y+t*t*t*c.p3.y});}return arr;};
 const maxCoord=(a,b)=>{const x=values(a),y=values(b);if(x.length!==y.length)return Infinity;
  return x.reduce((m,v,i)=>Math.max(m,Math.abs(v-y[i])),0);};
 const haus=(A,B)=>{const a=sample(A),b=sample(B);if(!a.length||!b.length)return Infinity;
  const directed=(x,y)=>{let max=0;for(let i=0;i<x.length;i+=3){const p=x[i];let best=Infinity;for(let j=0;j<y.length;j+=3){const q=y[j];best=Math.min(best,Math.hypot(p.x-q.x,p.y-q.y));}max=Math.max(max,best);}return max;};return Math.max(directed(a,b),directed(b,a));};
 try{
   state.fourierMode=false;state.morph.mode='linear';state.morph.spiralMorphType='continuous';state.morph.profileModeTransition='phase';
   for(const closed of [true,false])for(const prof of ['segments','spline-local','spline-whole'])for(const rounding of [0,55,120]){
    const a=createLayer('sp-a'),b=createLayer('sp-b');
    const spline=prof!=='segments',whole=prof==='spline-whole';
    Object.assign(a,{N:4,K:1,spiralEnabled:true,spiralOrder:1,spiralClosed:closed,spiralRoundSeams:true,spiralTangential:true,radius:220,
      rounding,profileMode:spline?'spline':'segments',wholeCurveSpline:whole,profileNodes:nodesA});
    Object.assign(b,a,{id:'sp-b',profileNodes:nodesB,spiralOrder:1.18});
    state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
    const frames=T.map(t=>({t,plan:WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t)}));
    const final=frames.at(-1)?.plan,near=frames.at(-2)?.plan,frame=final?.carrierFrames?.[0];
    const reference=frame?__spiroBuildSpiralCarrierPath(b,frame.anchor,{radius:220,delta:frame.delta,targetScale:frame.targetScale,
      tangential:frame.tangential,closed,roundSeams:true,roundingFrac:rounding/100,profileNodes:b.profileNodes})._bezierSegments:[];
    const rows=[];for(let i=1;i<frames.length;i++){
     const prev=frames[i-1],next=frames[i],dt=next.t-prev.t;
     const q=prev.plan?.paths?.[0],p=next.plan?.paths?.[0];rows.push({to:next.t,dt,
      count:p?.length||0,maxControlStep:maxCoord(q,p),controlSpeed:maxCoord(q,p)/dt,
      maxCurveStep:haus(q,p),curveSpeed:haus(q,p)/dt});
    }
    out.push({closed,profile:prof,rounding,prepared:final?.preparedContinuousSplineRail,mapped:final?.carrierMapped,overflow:final?.carrierOverflow,
      endCount:final?.paths?.[0]?.length||0,refCount:reference?.length||0,
      endHaus:haus(final?.paths?.[0],reference),endControlMax:maxCoord(final?.paths?.[0],reference),
      nearHaus:haus(near?.paths?.[0],final?.paths?.[0]),nearControl:maxCoord(near?.paths?.[0],final?.paths?.[0]),
      lateRates:rows.filter(x=>x.to>=.9)});
   }
 }finally{state.layers=sv.layers;runtimeState.morph.renderSourceLayers=sv.src;runtimeState.morph.renderTargetLayers=sv.dst;
  state.morph.spiralMorphType=sv.transport;state.morph.mode=sv.mode;state.morph.profileModeTransition=sv.profileTiming;state.fourierMode=sv.fourier;}
 return out;})()`,{label:'real retained GPU Spiral carrier geometric interpolation from t=0 to static endpoint',timeoutMs:160000});
 const errors=uncaughtExceptions(h.events);fs.writeFileSync('/mnt/data/somata_spiral_morph_simulation.json',JSON.stringify({cases:result,uncaught:errors},null,2));
 for(const r of result)console.log([r.closed?'closed':'open  ',r.profile.padEnd(13),'round='+String(r.rounding).padStart(3),
  'endHaus='+Number(r.endHaus).toFixed(3),'lastStep='+Number(r.nearHaus).toFixed(4),
  'C='+r.endCount,'refC='+r.refCount,'ready='+r.mapped,'overflow='+r.overflow].join(' '));
 console.log('cases',result.length,'errors',errors.length);
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
