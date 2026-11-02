'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:30000});
 try{
  const r=await h.evaluate(`(()=>{
   const rows=()=>{const commands=[];return {commands,ctx:{
    moveTo:(...x)=>commands.push(['M',...x]),lineTo:(...x)=>commands.push(['L',...x]),
    bezierCurveTo:(...x)=>commands.push(['C',...x]),closePath:()=>commands.push(['Z'])
   }};};
   const pts=[{x:0,y:0},{x:25,y:35},{x:45,y:50},{x:70,y:45},{x:90,y:70},{x:120,y:30},{x:140,y:25}];
   const flags=[false,false,false,true,false,false,false];
   const splineLayer={profileMode:'spline',rounding:0,roundingMode:'standard',N:7,radius:140,wholeCurveSpline:false};
   const segmentsLayer={...splineLayer,profileMode:'segments'};
   const draw=(fn)=>{const c=rows();fn(c.ctx);return c.commands;};
   const directZero=draw(ctx=>splinePathForDraw(ctx,pts,false,0,flags,[],false,1,0,splineLayer));
   const directRounded=draw(ctx=>splinePathForDraw(ctx,pts,false,.65,flags,[],false,1,0,splineLayer));
   const expectedRounded=draw(ctx=>somataDrawSplineCornerMode(ctx,pts,false,.65,{layer:splineLayer,baseSplineBlend:1}));
   const morphZero=draw(ctx=>drawMorphPathQuality(ctx,pts,false,0,'spline',null,false,'smooth',flags,[],false,0,false,splineLayer));
   const morphRounded=draw(ctx=>drawMorphPathQuality(ctx,pts,false,.65,'spline',null,false,'smooth',flags,[],false,0,false,splineLayer));
   const morphSegments=draw(ctx=>drawMorphPathQuality(ctx,pts,false,0,'segments',null,false,'smooth',flags,[],false,0,false,segmentsLayer));
   const splineTransition=draw(ctx=>drawMorphPathQuality(ctx,pts,false,0,'segments',.5,true,'smooth',flags,[],false,0,false,splineLayer));
   const anyC=cmds=>cmds.some(q=>q[0]==='C');
   const cubes=directZero.filter(q=>q[0]==='C');
   const before=cubes[2],after=cubes[3];
   const inX=before[5]-before[3],inY=before[6]-before[4];
   const outX=after[1]-before[5],outY=after[2]-before[6];
   const dot=inX*outX+inY*outY,scale=Math.hypot(inX,inY)*Math.hypot(outX,outY);
   const sharpJoinAngle=scale>1e-12?Math.acos(Math.max(-1,Math.min(1,dot/scale)))*180/Math.PI:0;
   const render=(round,mode='spline')=>{
    const layer={...createLayer('spline-path-test'),N:7,K:1,radius:120,profileMode:mode,
     profileNodes:[{x:0,y:0},{x:.22,y:.6},{x:.48,y:-.7},{x:.65,y:.7},{x:1,y:0}],
     wholeCurveSpline:false,rounding:round,closedLoop:true,fill:false};
    const c=rows();const canvas=document.createElement('canvas').getContext('2d');
    const proxy=new Proxy(canvas,{get(target,key){if(key==='__spiroGLGeometryRecorder')return true;
      if(['moveTo','lineTo','bezierCurveTo','closePath'].includes(key))return (...a)=>{c.ctx[key](...a);return target[key](...a);};
      const val=target[key];return typeof val==='function'?val.bind(target):val;}});
    renderLayerOrbitPaths(proxy,layer);return c.commands;
   };
   const staticZero=render(0),staticRounded=render(70),staticSegmentZero=render(0,'segments');
   const spiral=pts.map((p,i)=>({...p,__profileCorner:flags[i],widthScale:1}));
   const gpuZero=__spiroBuildSpiralBezierSegments(spiral,0,flags,true)||[];
   const gpuRounded=__spiroBuildSpiralBezierSegments(spiral,.65,flags,true)||[];
   const finite=r=>r.every(row=>row.slice(1).every(v=>Number.isFinite(v)));
   return {available:{splinePath:typeof splinePathForDraw,morph:typeof drawMorphPathQuality,gpu:typeof __spiroBuildSpiralBezierSegments},
    directZero,directRounded,expectedRounded,morphZero,morphRounded,morphSegments,splineTransition,
    sharpJoinAngle, directZeroHasC:anyC(directZero),morphZeroHasC:anyC(morphZero),morphSegmentHasC:anyC(morphSegments),transitionHasC:anyC(splineTransition),
    static:{zeroC:staticZero.filter(q=>q[0]==='C').length,roundC:staticRounded.filter(q=>q[0]==='C').length,segmentC:staticSegmentZero.filter(q=>q[0]==='C').length,
    zeroSize:staticZero.length,roundSize:staticRounded.length,different:JSON.stringify(staticZero)!==JSON.stringify(staticRounded)},
    gpu:{zero:gpuZero.length,rounded:gpuRounded.length,finite:gpuZero.every(v=>[v.p0,v.c1,v.c2,v.p3].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))},
    allFinite:[directZero,directRounded,morphZero,splineTransition].every(finite)};
  })()`,{label:'Spline profile when rounding is switched off',timeoutMs:30000});
  const {directZero,directRounded,expectedRounded,morphZero,morphRounded,morphSegments,splineTransition,...report}=r;
  console.log('SPLINE_PROFILE_0_100',JSON.stringify(report));
  assert(r.directZeroHasC,'zero-rounding spline profile should contain cubic curves');
  assert(r.morphZeroHasC,'zero-rounding spline Morph should contain cubic curves');
  assert(!r.morphSegmentHasC,'zero-rounding Segments profile must remain straight');
  assert(r.transitionHasC,'zero-rounding profile Morph blend must use cubic curves');
  assert(r.sharpJoinAngle>20,'sharp profile junction must retain an angular kink even with cubic commands');
  assert.deepEqual(r.directRounded,r.expectedRounded,'positive rounding must preserve approved Spline+ output');
  assert.deepEqual(r.morphRounded,r.expectedRounded,'positive Morph rounding must preserve approved Spline+ output');
  assert(r.static.zeroC>0&&r.static.roundC>0&&r.static.different,'real static profile slider changes geometry');
  assert(r.static.segmentC===0,'zero-rounding Segments profile has no cubic segments');
  assert(r.gpu.zero>0&&r.gpu.rounded>0&&r.gpu.finite,'GPU carrier should preserve unrounded spline cubics');
  assert(r.allFinite,'all paths must remain finite');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS zero-rounding Spline profile, sharp joins, Morph, spiral GPU carriers, positive Spline+ parity');
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
