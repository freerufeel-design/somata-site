// Tests ordinary angular morph's live visible-rail selection with contour sticking.
// Test-only; does not add any UI controls to Somata.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,why)=>{if(!ok)throw Error(why);};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:280,evalTimeoutMs:25000});
 try{
 const result=await h.evaluate(`(async()=>{
   const l=state.layers[0]||createLayer('circle-13.0.2');state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;
   Object.assign(l,{visible:true,lineVisible:true,N:9,K:3,radius:190,rounding:125,profileMode:'spline',showLamps:true,
     profileNodes:[{x:0,y:0},{x:.22,y:.25},{x:.57,y:-.20},{x:1,y:0}]});
   const cfg=ensureLayerLampState(l);Object.assign(cfg,{positionMode:'key',morphMotionMode:'linear',snapToContour:true,calmMode:true});
   invalidateLayerGeometry(l,'v1302-snap-to-own-rounded-line');syncSidebarInputs();
   const choose=(id,val)=>{const el=document.getElementById(id);if(!el)throw Error('missing '+id);el.value=String(val);el.dispatchEvent(new Event('change',{bubbles:true}));};
   choose('morphMode','circleSlide');choose('morphVertexMin','11');choose('morphVertexMax','11');
   choose('morphStepMin','4');choose('morphStepMax','4');
   choose('morphRoundingMin','145');choose('morphRoundingMax','145');
   document.getElementById('btnMorph')?.click();await new Promise(r=>setTimeout(r,350));
   beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;
   const ctx=prepareMainLayerFrame(f,0);ctx.layerLampConfig=cfg;
   const rail=SomataFrameContourService.paths(ctx);
   const gpu=prepareGpuMorphLampFrame(ctx);
   const raw=getLayerFrameAuxiliaryPaths(ctx),t=Number(ctx.blueMorphProvider?.geometryT ?? runtimeState.morph.geometryT)||0;
   const points=withLampConfig(cfg,()=>collectMorphLampPoints(0,t,260,raw,rail));
   const distanceSq=(p,path)=>{const pts=path?.points||[],n=path?.closed?pts.length:pts.length-1;let best=Infinity;
      for(let j=0;j<n;j++){const a=pts[j],b=pts[(j+1)%pts.length],dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
      const u=den>1e-12?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
      const ex=p.x-a.x-dx*u,ey=p.y-a.y-dy*u;best=Math.min(best,ex*ex+ey*ey);}return best;};
   return{active:runtimeState.morph.active,mode:state.morph.mode,rounding:l.rounding,railCount:rail?.length||0,points:points.length,
      attached:points.filter(p=>p.__lampVisualProfileAttached).length, maxDist:points.reduce((best,p)=>Math.max(best,Math.sqrt(distanceSq(p,rail?.[p.pathIndex]))),0),
      native:!!gpu,nativeReason:window.__spiroGpuMorphLampBridgeStatus?.().lastReason};
 })()`,{timeoutMs:22000,label:'live Circle Slide lamps on rounded line'});
 assert(result.active&&result.mode==='circleSlide','circleSlide did not activate: '+JSON.stringify(result));
 assert(result.railCount>0&&result.points>0,'no visual rail or key lamps: '+JSON.stringify(result));
 assert(result.attached===result.points,'not all lamps attached to visual contour: '+JSON.stringify(result));
 assert(result.maxDist<1e-5,'lamp off the rendered curve: '+JSON.stringify(result));
 assert(!result.native,'GPU path ignored contour attachment: '+JSON.stringify(result));
 assert(!uncaughtExceptions(h.events).length,'browser JS exception');
 console.log('PASS Circle Slide rendered spline lamps: ',result);
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL Circle Slide lamps:',e.stack||e.message);process.exitCode=1});
