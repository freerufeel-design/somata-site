'use strict';
// Mixed segment/spline Morph phase handoff and stable Corridor-copy population.
// Uses the real browser Canvas2D paths, not a simulated/custom geometry solver.
const assert = require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions} = require('./lib/browser-harness');

(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:70000});
 try{
  const out=await h.evaluate(`(()=>{
   const saved={mode:state.morph.mode,transition:state.morph.profileModeTransition,
    fourier:state.fourierMode,tunnel:{...state.tunnel}};
   const aNodes=[{x:0,y:0},{x:.12,y:.32},{x:.4,y:-.3},{x:.65,y:.4},{x:1,y:0}];
   const bNodes=[{x:0,y:0},{x:.14,y:-.24},{x:.51,y:.5},{x:1,y:0}];
   const canvas=document.createElement('canvas');canvas.width=440;canvas.height=440;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   const paint=draw=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,440,440);
    ctx.translate(220,220);ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.lineJoin='round';
    draw();const raw=ctx.getImageData(0,0,440,440).data,alpha=new Uint8Array(440*440);
    for(let i=0;i<alpha.length;i++)alpha[i]=raw[i*4+3];return alpha;};
   const delta=(x,y)=>{let sum=0;for(let i=0;i<x.length;i++)sum+=Math.abs(x[i]-y[i]);return sum/x.length;};
   const staticImage=layer=>paint(()=>renderLayerOrbitPaths(ctx,layer));
   const morphImage=(src,dst,t)=>paint(()=>{
    if(state.morph.mode==='circleSlide')drawCircleSlideMorph(ctx,dst,src,dst,t,1,'phase');
    else drawLinearAnchorMorph(ctx,dst,src,dst,t,1,'phase');
   });
   const cases=[],copies=[];
   try{
    state.fourierMode=false;state.morph.profileModeTransition='phase';
    for(const reverse of [false,true])for(const changeNodes of [false,true])
     for(const rounding of [0,59])for(const mode of ['topology','calm','circleSlide'])
      for(const wholeCurve of [false,true]){
       state.morph.mode=mode;
       const src=createLayer('profile-source'),dst=createLayer('profile-target');
       Object.assign(src,{N:8,K:3,radius:145,spiralEnabled:false,closedLoop:true,
        profileNodes:aNodes,profileMode:reverse?'spline':'segments',
        wholeCurveSpline:wholeCurve,rounding,fill:false,lineVisible:true});
       Object.assign(dst,src,{id:'profile-target',profileMode:reverse?'segments':'spline',
        profileNodes:changeNodes?bNodes:aNodes});
       const srcStatic=staticImage(src),dstStatic=staticImage(dst);
       const frame0=morphImage(src,dst,0),frameNear0=morphImage(src,dst,.00001);
       const frameNear1=morphImage(src,dst,.99999),frame1=morphImage(src,dst,1);
       cases.push({reverse,changeNodes,rounding,mode,wholeCurve,
        start:delta(srcStatic,frame0),afterStart:delta(srcStatic,frameNear0),
        end:delta(dstStatic,frame1),beforeEnd:delta(dstStatic,frameNear1),
        lastStep:delta(frameNear1,frame1)});
      }
    Object.assign(state.tunnel,{active:true,travelPhase:0,speedStrength:0,spacingStrength:3,
     spacingMultiplier:1,centerHiddenCopies:0,minScale:.055,maxScale:3.8,
     fadeOversize:false,fadeDurationSec:0,depthCurve:0,depthCurveMultiplier:1});
    for(const mode of ['segments','spline']){
     const layer=createLayer('corridor-profile');Object.assign(layer,{N:7,K:3,radius:180,
      profileMode:mode,profileNodes:[{x:0,y:0},{x:.2,y:.6},{x:.7,y:-.3},{x:1,y:0}]});
     const extent=getCachedLayerDrawData(layer).maxRadius;
     for(let tick=0;tick<=20;tick++){
      state.tunnel.travelPhase=tick/20;
      const pathCopies=getTunnelCopies().map(c=>({...c}));
      const visible=prepareTunnelVisibleInstances(pathCopies,extent,1,550,1,layer.id,performance.now());
      copies.push({mode,tick,count:visible.copies.length,
       firstId:visible.copies[0]?.copyId,lastId:visible.copies.at(-1)?.copyId});
     }
    }
   }finally{
    state.morph.mode=saved.mode;state.morph.profileModeTransition=saved.transition;
    state.fourierMode=saved.fourier;Object.assign(state.tunnel,saved.tunnel);
   }
   return {cases,copies};
  })()`,{label:'mixed profile phase and corridor population',timeoutMs:70000});
  assert.equal(out.cases.length,48);
  for(const c of out.cases)for(const key of ['start','afterStart','end','beforeEnd','lastStep'])
   assert(c[key]<.03,`Mixed profile has a phase seam (${key}): ${JSON.stringify(c)}`);
  assert.equal(out.copies.length,42);
  const s=out.copies.filter(x=>x.mode==='segments');
  const p=out.copies.filter(x=>x.mode==='spline');
  for(let i=0;i<s.length;i++){
   assert.equal(s[i].count,p[i].count,'Profile mode itself changed corridor copy count');
   assert.equal(s[i].count,s[0].count,'Fixed corridor lost a visible copy');
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 48 mixed-profile Canvas2D boundaries: spline↔segments, topology/calm/circleSlide, 0/59%, 4/5 knots, local/whole spline');
  console.log('PASS 42 fixed-geometry Corridor samples: stable count '+s[0].count+' across both profile modes');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL mixed profile and Corridor',e.stack||e);process.exitCode=1;});
