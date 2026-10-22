// v8.2: one authoritative Corridor master and one per-frame copy payload
// across FeatureHost-scoped Glow / Base views. No hardware GPU required.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(condition,msg)=>{if(!condition)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:12000});
 try{
  const result=await h.evaluate(`(()=>{
   const tunnelWas=state.tunnel.active;state.tunnel.active=true;
   try{
    const layer=createLayer('v820-shared-corridor');layer.strokeColor='#aabbcc';layer.lineVisible=true;
    let calls=0,offset=0;
    const frame={frameId:812,sourceLayer:layer,effectLayerSource:layer,layer,prepared:true,geometryPlan:{kind:'blue-circle-slide',dynamic:true},baseAlpha:.8,lineDisplayEnabled:true,strokeWidth:3,lineCap:'round',lineJoin:'round',miterLimit:6,
     visibleInstances:{copies:[{scale:1,position:0},{scale:.78,position:.2}],alphas:[1,.5]},tunnelBaseStrokeColor:'#aabbcc',combinedScale:1,combinedRotationRad:0,
     drawLayerGeometry(rec){calls++;rec.beginPath();rec.moveTo(0,0);rec.lineTo(20+offset,0);rec.lineTo(20+offset,20);rec.stroke();}};
    const get=(kind)=>SomataFeatureHost.run(kind,frame,view=>getDynamicTunnelMorphMasterStrokeCommands(view));
    const a=get('glow'),b=get('base');
    const sameMaster=a&&a===b&&calls===1;
    const stats=__spiroDynamicTunnelMorphMasterStatus();
    const renderColor=(kind)=>SomataFeatureHost.run(kind,frame,view=>{const opt=buildCorridorGPUOptions(view);return {cacheKey:opt.copyCacheKey,owner:opt.copyResidencyKey,color:opt.colorForCopy(frame.visibleInstances.copies[0],0),again:opt.colorForCopy(frame.visibleInstances.copies[0],0)};});
    const colorBefore=__spiroCorridorGpuCpuCacheStatus();
    const glow=renderColor('glow'),base=renderColor('base');
    const colorAfter=__spiroCorridorGpuCpuCacheStatus();
    const stableCopyKeys=glow.cacheKey===frame&&base.cacheKey===frame&&glow.owner===layer&&base.owner===layer;
    const sharedColor=colorAfter.colorCacheBuilds-colorBefore.colorCacheBuilds===1&&colorAfter.colorCacheHits-colorBefore.colorCacheHits>=2&&glow.color===base.color;
    const sharedMasterHits=stats.sharedFrameHits>0;
    offset=15;frame.frameId++;
    const c=get('glow');const invalidationWorks=c?.[0]?.subpaths?.[0]?.points?.[1]?.x===35&&calls===2;
    const other=createLayer('v820-other');const clone={...frame,sourceLayer:other,effectLayerSource:other,layer:other,frameId:814};
    SomataFeatureHost.run('glow',clone,view=>getDynamicTunnelMorphMasterStrokeCommands(view));
    const noLayerBleed=calls===3;
    return {sameMaster,sharedMasterHits,sharedColor,stableCopyKeys,invalidationWorks,noLayerBleed,drawCalls:calls};
   }finally{state.tunnel.active=tunnelWas;}
  })()`,{label:'v8.2 corridor share',timeoutMs:10500});
  for(const [key,val] of Object.entries(result))if(key!=='drawCalls')assert(val===true,`${key}: ${val}`);
  assert(uncaughtExceptions(h.events).length===0,`uncaught: ${uncaughtExceptions(h.events).join(' | ')}`);
  console.log('PASS v8.2 Corridor shared frame master, copy cache, stable layer owner and generation isolation',result);
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v8.2',err.stack||err);process.exitCode=1});
