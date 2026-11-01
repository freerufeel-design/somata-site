'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:60000});
 try{
  const result=await h.evaluate(`(()=>{
   const drop=document.getElementById('paramRoundingMaxRadiusDrop');
   const checkbox=document.getElementById('paramRoundingSmoothSplines');
   if(!drop||!checkbox)throw Error('missing new rounding controls');
   const defaults={drop:drop.value,splines:checkbox.checked};
   const base=createLayer('unified-browser-regression');Object.assign(base,{N:6,K:1,radius:150,rounding:70,
     profileMode:'segments',profileNodes:[{x:0,y:0},{x:.2,y:.3},{x:.6,y:-.1},{x:1,y:0}],closedLoop:true,fill:false});
   const draw=(layer)=>{
    const calls=[];const native=document.createElement('canvas').getContext('2d');native.__spiroGLGeometryRecorder=true;
    const c=new Proxy(native,{get(target,key){const v=target[key];if(typeof v!=='function')return v;return (...args)=>{
     if(['moveTo','lineTo','bezierCurveTo','quadraticCurveTo','closePath'].includes(key))calls.push([key,...args]);
     return v.apply(target,args);
    };}});
    renderLayerOrbitPaths(c,layer);
    return calls;
   };
   const raw=draw({...base,rounding:0});
   const round=draw(base);
   const beyond=draw({...base,rounding:175});
   const finite=rows=>rows.every(row=>row.slice(1).every(Number.isFinite));
   const sampleRadius=(layer)=>{
     const raw=buildOrbitPolylines(layer);
     const fitted=applyMonoradiusRoundingCompensation(raw,layer,layer.rounding).paths;
     const render=buildLampRenderedAttachmentPathsUncached(fitted,layer,null,getRoundingStrength(layer.rounding));
     return Math.max(0,...render.flatMap(path=>path.points.map(p=>Math.hypot(p.x,p.y))));
   };
   const radiusByMode=[];
   for(const rounding of [0,30,70,100,150,200])for(const mode of ['standard','monoradius']){
    const layer={...base,rounding,roundingMode:mode,roundingMaxRadiusDrop:30};
    radiusByMode.push({rounding,mode,radius:sampleRadius(layer)});
   }
   // Additional spline rounding is deliberately disabled unless requested.
   const curve=[{x:0,y:0},{x:40,y:70},{x:95,y:20},{x:150,y:0},{x:190,y:60}];
   const native=document.createElement('canvas').getContext('2d');
   const commands=[];
   const c=new Proxy(native,{get(target,key){const v=target[key];if(typeof v!=='function')return v;return (...args)=>{
    if(['moveTo','lineTo','bezierCurveTo','closePath'].includes(key))commands.push([key,...args]);return v.apply(target,args);
   };}});
   const splineLayer={...base,profileMode:'spline',wholeCurveSpline:true,rounding:65,roundingSmoothSplines:false};
   splinePathForDraw(c,curve,false,.65,[],[],true,1,0,splineLayer);
   const first=JSON.stringify(commands);
   commands.length=0;
   splinePathForDraw(c,curve,false,.65,[],[],true,1,0,{...splineLayer,roundingSmoothSplines:true});
   const second=JSON.stringify(commands);
   return {defaults,cubics:{raw:raw.filter(q=>q[0]==='bezierCurveTo').length,
     normal:round.filter(q=>q[0]==='bezierCurveTo').length,
     above:beyond.filter(q=>q[0]==='bezierCurveTo').length},
     allFinite:[finite(raw),finite(round),finite(beyond)],radiusByMode,splinesDiffer:first!==second,
     noDuplicateOriginal:round.length>0&&round.length<1500};
  })()`,{timeoutMs:50000,label:'Somata 11.0.5 new corner overlay native Chromium Canvas2D'});
  console.log('BROWSER SUMMARY',JSON.stringify(result));
  assert.deepEqual(result.defaults,{drop:'30',splines:false});
  assert(result.allFinite.every(Boolean));
  assert(result.cubics.normal>0&&result.cubics.above>0);
  assert(result.splinesDiffer,'spline checkbox should visibly affect already smooth knots');
  assert(result.noDuplicateOriginal);
  for(const r of result.radiusByMode){
   if(r.mode==='monoradius')assert(Math.abs(r.radius-150)<.2,`MonoRadius drift ${JSON.stringify(r)}`);
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 11.0.5 browser: defaults, Bézier overlays, full 0–200%, optional spline rounding, fitted MonoRadius');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL 11.0.5 browser',e.stack||e);process.exitCode=1;});
