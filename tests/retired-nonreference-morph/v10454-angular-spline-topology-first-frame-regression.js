'use strict';
// Regression for the first-frame jolt when Blue Morph switches segment ↔ spline.
// The render snapshots use an equalized interpolation grid, but the visible
// endpoints must remain the canonical, authored curves. Measure real Canvas2D
// pixels at t=0, t≈0 and t=1, including both spline directions and rounding.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:120000});
 try{
  const results=await h.evaluate(`(async()=>{
   const saved={layers:state.layers,id:state.activeLayerId,fourier:state.fourierMode,
    mode:state.morph.mode,trans:state.morph.profileModeTransition,
    pct:state.morph.profileModeTransitionPercent,opts:{...state.morph.options}};
   const P=[{x:0,y:0},{x:.18,y:.48},{x:.51,y:-.29},{x:.74,y:.31},{x:1,y:0}],
     Q=[{x:0,y:0},{x:.14,y:-.31},{x:.4,y:.48},{x:.69,y:-.23},{x:1,y:0}];
   const c=document.createElement('canvas');c.width=540;c.height=540;
   const ctx=c.getContext('2d',{willReadFrequently:true});
   const paint=fn=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,540,540);
    ctx.translate(270,270);ctx.strokeStyle='white';ctx.lineWidth=2;
    ctx.lineJoin='round';fn();const d=ctx.getImageData(0,0,540,540).data;
    const alpha=new Uint8Array(d.length/4);for(let i=0;i<alpha.length;i++)alpha[i]=d[4*i+3];return alpha;};
   const staticDraw=lay=>paint(()=>{for(const p of buildOrbitPolylines(lay)){
    ctx.beginPath();const r=getRoundingStrength(lay.rounding);
    if(useSmoothSplinePath(lay,r,p))splinePathForDraw(ctx,p.points,p.closed,r,p.cornerFlags||[],p.bridgeRoundFlags||[],lay.wholeCurveSpline===true);
    else roundPolylineForDraw(ctx,p.points,p.closed,r,p.cornerFlags||[]);ctx.stroke();
   }});
   const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i++)n+=Math.abs(a[i]-b[i]);return n/a.length;};
   const cases=[];
   try{
    state.fourierMode=false;state.morph.mode='circleSlide';state.morph.profileModeTransition='phase';
    state.morph.profileModeTransitionPercent=100;
    Object.assign(state.morph.options,{byShape:true,byVertices:false,bySteps:false,byRounding:false,
     bySize:false,byRotation:false,bySpiralOrder:false,bySpiralLayers:false});
    for(const sourceMode of ['spline','segments'])for(const round of [0,55,120]){
     if(runtimeState.morph.active)document.getElementById('btnMorph').click();
     const source=createLayer('v10454-source');
     Object.assign(source,{N:7,K:2,radius:190,rotation:0,fill:false,closedLoop:true,
      spiralEnabled:false,rounding:round,profileMode:sourceMode,
      wholeCurveSpline:sourceMode==='spline',profileNodes:P.map(p=>({...p}))});
     state.layers=[source];state.activeLayerId=source.id;
     const authored=staticDraw(source);
     document.getElementById('btnMorph').click();await new Promise(r=>setTimeout(r,35));
     const a=runtimeState.morph.renderSourceLayers?.[0],b=runtimeState.morph.renderTargetLayers?.[0];
     if(!a||!b)throw Error('No Blue render endpoint layers');
     b.N=9;b.K=2;b.closedLoop=a.closedLoop;b.chaosStar=false;
     b.spiralEnabled=false;b.fill=false;
     // Force a deterministic opposite-mode target without altering the live
     // source snapshot: exercises both directions independently of randomness.
     const targetMode=sourceMode==='spline'?'segments':'spline';
     b.profileMode=targetMode;b.rounding=round;b.wholeCurveSpline=targetMode==='spline';
     b.profileNodes=Array.from({length:12},(_,i)=>({x:i/11,y:Math.sin(i*.8)*.25}));
     b.__morphExactProfileNodes=Q.map(p=>({...p}));b.__morphExactProfileSampled=false;
     if(targetMode==='spline')setPreSampledSplineLayer(b,true);
     const targetStatic={...b,profileNodes:b.__morphExactProfileNodes};
     const targetPixels=staticDraw(targetStatic);
     const morph=t=>paint(()=>drawAngularAnchorMorph(ctx,b,a,b,t,1,'phase','angular'));
     const start=morph(0),near=morph(.0001),first=morph(.001),quarter=morph(.25),end=morph(1);
     cases.push({sourceMode,targetMode,round,sourceKnots:source.profileNodes.length,
      sampledKnots:a.profileNodes.length,start:diff(start,authored),near:diff(near,authored),
      first:diff(first,authored),end:diff(end,targetPixels),changed:diff(quarter,authored)});
     document.getElementById('btnMorph').click();
    }
   } finally{
    if(runtimeState.morph.active)document.getElementById('btnMorph').click();
    state.layers=saved.layers;state.activeLayerId=saved.id;state.fourierMode=saved.fourier;
    state.morph.mode=saved.mode;state.morph.profileModeTransition=saved.trans;
    state.morph.profileModeTransitionPercent=saved.pct;
    Object.assign(state.morph.options,saved.opts);
   }
   return cases;
  })()`,{label:'Blue UI first-frame and final-frame mixed spline pixel parity',timeoutMs:120000});
  assert.equal(results.length,6);
  for(const c of results){
   assert(c.start<.001&&c.end<.001,'authored visible contour replaced at endpoint: '+JSON.stringify(c));
   assert(c.near<.09&&c.first<.9,'sudden geometry jump in first 0.1%: '+JSON.stringify(c));
   assert(c.changed>.01,'profile never interpolated: '+JSON.stringify(c));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10454: 6 real Blue UI cases, angular segments↔spline with changing N/K, 0/55/120%, exact first and last frames');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v10454',err.stack||err);process.exitCode=1;});
