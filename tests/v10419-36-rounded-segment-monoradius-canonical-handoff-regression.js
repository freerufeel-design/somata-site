'use strict';
// Regression for rounded segment contours: Morph and Static must use the same
// fillet solver, including Mono Radius, with no late geometry substitution.
// Unrounded segments, spline, Spiral, and orbit-topology morph are left alone.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:65000});
 try{
  const result=await h.evaluate(`(()=>{
   const saved={mode:state.morph.mode,fourier:state.fourierMode};
   const canvas=document.createElement('canvas');canvas.width=580;canvas.height=580;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   const render=draw=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,580,580);
    ctx.translate(290,290);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.lineJoin='round';
    draw();const raw=ctx.getImageData(0,0,580,580).data;
    const a=new Uint8Array(raw.length/4);for(let i=0;i<a.length;i++)a[i]=raw[4*i+3];return a;};
   const error=(a,b)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
   const outer=(layer)=>{
    const d=getCachedLayerDrawData(layer);
    const sampled=buildLampRenderedAttachmentPathsUncached(d.paths,layer,null,getRoundingStrength(layer.rounding));
    return Math.max(...sampled.flatMap(path=>(path.points||[]).map(p=>Math.hypot(p.x,p.y))));
   };
   const a=[{x:0,y:0},{x:.16,y:.42},{x:.49,y:-.28},{x:.76,y:.22},{x:1,y:0}];
   const b=[{x:0,y:0},{x:.21,y:-.36},{x:.48,y:.32},{x:.69,y:-.16},{x:1,y:0}];
   const rows=[];const guards=[];const modeSwaps=[];const blueProviders=[];
   try{
    state.fourierMode=false;
    for(const mode of ['topology','calm','circleSlide','topoCircle'])
     for(const mono of [false,true])for(const pair of [[0,88],[88,0]])for(const changingProfile of [false,true]){
      state.morph.mode=mode;
      const src=createLayer('rounded-source'),dst=createLayer('rounded-target');
      Object.assign(src,{N:7,K:2,closedLoop:true,radius:184,rotation:12,
       roundingMode:mono?'monoradius':'standard',rounding:pair[0],profileMode:'segments',
       profileNodes:a,spiralEnabled:false,fill:false});
      Object.assign(dst,src,{rounding:pair[1],profileNodes:changingProfile?b:a});
      const frame=(t)=>render(()=>drawAngularAnchorMorph(ctx,{...dst,rounding:interpolateMorphRounding(pair[0],pair[1],t)},src,dst,t,1,'phase','linear'));
      const staticStart=render(()=>renderLayerOrbitPaths(ctx,src));
      const staticEnd=render(()=>renderLayerOrbitPaths(ctx,dst));
      const f0=frame(0),f000001=frame(.000001),f50=frame(.5),f999999=frame(.999999),f1=frame(1);
      const error0=error(staticStart,f0),error1=error(staticEnd,f1);
      const nearStart=error(staticStart,f000001),nearEnd=error(staticEnd,f999999);
      const changed=error(staticStart,f50);
      const fitted=mono?[0,.1,.3,.5,.7,.9,1].map(t=>{
       const profileNodes=changingProfile?a.map((p,i)=>({x:p.x+(b[i].x-p.x)*t,y:p.y+(b[i].y-p.y)*t})):a;
       const lay={...src,rounding:interpolateMorphRounding(pair[0],pair[1],t),profileNodes};
       return outer(lay);
      }):[];
      rows.push({mode,mono,pair,changingProfile,error0,error1,nearStart,nearEnd,changed,fitted});
     }
    for(const mode of ['topology','circleSlide'])for(const rounding of [22,72,135])
     for(const forward of [true,false]){
      state.morph.mode=mode;
      const src=createLayer('mono-mode-from'),dst=createLayer('mono-mode-to');
      Object.assign(src,{N:7,K:2,closedLoop:true,radius:184,rotation:12,profileMode:'segments',
       rounding,roundingMode:forward?'standard':'monoradius',profileNodes:a,spiralEnabled:false,fill:false});
      Object.assign(dst,src,{roundingMode:forward?'monoradius':'standard'});
      const renderMorph=t=>render(()=>drawAngularAnchorMorph(ctx,dst,src,dst,t,1,'phase','linear'));
      const first=render(()=>renderLayerOrbitPaths(ctx,src)),last=render(()=>renderLayerOrbitPaths(ctx,dst));
      const f0=renderMorph(0),f000001=renderMorph(.000001),f50=renderMorph(.5),
       f999999=renderMorph(.999999),f1=renderMorph(1);
      modeSwaps.push({mode,rounding,forward,
       begin:error(first,f0),end:error(last,f1),nearBegin:error(first,f000001),
       nearEnd:error(last,f999999),change:error(first,f50)});
     }
    for(const mode of ['topology','calm','circleSlide','topoCircle'])for(const mono of [false,true]){
      const src=createLayer('blue-round-source');
      Object.assign(src,{N:7,K:2,radius:184,rounding:0,roundingMode:mono?'monoradius':'standard',
       profileMode:'segments',profileNodes:a,spiralEnabled:false,closedLoop:true});
      const dst={...src,rounding:88};
      const snap={active:true,mode,options:{byRounding:true},geometryT:.5,progress:.5,
       monoOrbitTransforms:false,sourceVisuals:[src],targetVisuals:[dst],
       sourceProfiles:[{mode:'segments',rawNodes:a}],targetProfiles:[{mode:'segments',rawNodes:a}],
       sourceGeometry:[buildOrbitPolylines(src)],targetGeometry:[buildOrbitPolylines(dst)],
       renderSourceLayers:[src],renderTargetLayers:[dst],profileCarrierPlans:[],
       lightLayers:[],lightScales:[],lightRotations:[],lightDrawData:[],frameLayers:[src]};
      const frame={layerIndex:0,sourceLayer:{...src,rounding:interpolateMorphRounding(0,88,.5)},blueMorphProvider:{}};
      const provider=resolveBlueMorphLayerProvider(frame,{morphProviders:{blue:snap},audioRotationOverride:false});
      blueProviders.push({mode,mono,kind:provider.kind,geometryActive:provider.geometryActive});
    }
    const single=createLayer('guard');Object.assign(single,{N:7,K:2,rounding:25,profileMode:'segments',profileNodes:a});
    guards.push({kind:'same-unrounded',accept:isRoundedSegmentProfileMorphPair({...single,rounding:0},{...single,rounding:0})});
    guards.push({kind:'spline',accept:isRoundedSegmentProfileMorphPair({...single,profileMode:'spline'},{...single,profileMode:'spline'})||isRoundingOnlyMorphPair({...single,profileMode:'spline',rounding:0},{...single,profileMode:'spline',rounding:80})});
    guards.push({kind:'spiral',accept:isRoundedSegmentProfileMorphPair({...single,spiralEnabled:true,spiralOrder:1},{...single,spiralEnabled:true,spiralOrder:1})||isRoundingOnlyMorphPair({...single,spiralEnabled:true,spiralOrder:1,rounding:0},{...single,spiralEnabled:true,spiralOrder:1,rounding:80})});
    guards.push({kind:'different-orbits',accept:isRoundedSegmentProfileMorphPair({...single,N:7},{...single,N:11})});
   }finally{state.morph.mode=saved.mode;state.fourierMode=saved.fourier;}
   return{rows,guards,modeSwaps,blueProviders};
  })()`,{timeoutMs:60000,label:'live rounded segment Mono Radius Morph/Static pixel and radius parity'});
  assert.equal(result.rows.length,32);
  for(const row of result.rows){
   assert(row.error0<.001&&row.error1<.001,'Morph/Static endpoints disagree: '+JSON.stringify(row));
   assert(row.nearStart<.035&&row.nearEnd<.035,'visible first/last frame jump: '+JSON.stringify(row));
   assert(row.changed>.03,'intermediate fillet stopped animating: '+JSON.stringify(row));
   if(row.mono)for(const radius of row.fitted)assert(Math.abs(radius-184)<.7,'Mono Radius lost its outer radius: '+JSON.stringify(row));
  }
  assert.equal(result.modeSwaps.length,12);
  for(const row of result.modeSwaps){
   assert(row.begin<.001&&row.end<.001,'Mono Radius mode switch end does not equal Static: '+JSON.stringify(row));
   assert(row.nearBegin<.035&&row.nearEnd<.035,'Mono Radius mode switch jumps on boundary: '+JSON.stringify(row));
   assert(row.change>.015,'Mono Radius mode switch ignored: '+JSON.stringify(row));
  }
  assert.equal(result.blueProviders.length,8);
  for(const q of result.blueProviders)assert(q.kind==='static'&&q.geometryActive===false,
   'Blue Morph still uses the mismatched rounded carrier: '+JSON.stringify(q));
  for(const g of result.guards)assert(!g.accept,'unrelated transport entered rounded segment solver: '+JSON.stringify(g));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 32 fillet + 12 Mono Radius switch + 8 Blue provider cases: static handoff, smooth boundaries, radius fit; unrelated modes guarded');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL rounded segment Mono Radius parity',e.stack||e);process.exitCode=1});
