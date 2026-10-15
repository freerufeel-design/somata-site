const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const contour=read('js/geometry/frame-contour.js');
  const profile=read('js/render/profile-plan.js');
  const sweep=read('js/render/sweep-plan.js');
  const web=read('js/render/web-plan.js');
  const lamp=read('js/app/lamp-audio-core.js');
  const fill=read('js/render/fill-geometry-adapter.js');
  const webPass=read('js/render/web-pass.js');
  const fillPass=read('js/render/fill-pass.js');
  const registry=read('js/render/pass-registry.js');
  const pipeline=read('js/render/main-pipeline.js');

  assert(contour.includes("authority='shared-line-command-topology'"),'FrameContour is not explicitly owned by shared Line command topology');
  assert(/return getFrameGLStrokeCommands\((?:frameCtx|owner),false\)\|\|null/.test(contour),'FrameContour does not record the ordinary Line carrier');
  assert(profile.includes('getLayerFrameAuthoritativePaths(frameCtx)'),'Graffiti/Profile does not consume FrameContour');
  assert(profile.includes("const nativePrepared=strict&&"),'ordinary Graffiti can still bypass FrameContour through native Morph geometry');
  assert(sweep.includes('getLayerFrameAuthoritativePaths(frameCtx)'),'Sweep/Lightning does not consume FrameContour');
  assert(web.includes('getLayerFrameAuthoritativePaths(frameCtx)'),'Web does not consume FrameContour');
  assert(web.includes('const nativeData=strict&&'),'ordinary Web can still bypass FrameContour through native Morph geometry');
  assert(lamp.includes('sharedContour=paths?.__somataFrameContour===true'),'effect preparation does not recognize the shared FrameContour');
  assert(fill.includes("register('line-carrier'"),'Fill is not bound to the Line carrier');
  assert(registry.includes('OVER_FILL:25'),'explicit Fill -> Web compositor stage missing');
  assert(webPass.includes('STAGES.OVER_FILL'),'Web is not registered above Fill');
  assert(/somataEffectPhase\('web'/.test(webPass)&&/DEFAULT_ORDER=Object\.freeze\(\['fill','web','geometry','lamps','sweep','pathfx','particles'\]\)/.test(registry),'Web is not physically queued by the central artistic stack with default Fill < Web < Geometry');
  assert(fillPass.includes('standaloneFill')&&/somataEffectPhase\('fill'\)/.test(fillPass),'Fill is not explicitly separable/ordered below Web when Web is active');
  const fillStage=pipeline.indexOf('runRegisteredStage(SomataRenderPassRegistry.STAGES.FILL)');
  const webStage=pipeline.indexOf('runRegisteredStage(SomataRenderPassRegistry.STAGES.OVER_FILL)');
  const batchStage=pipeline.indexOf('SomataStrokeBatchService.prepare(frameCtx)');
  assert(fillStage>=0&&webStage>fillStage&&batchStage>webStage,'pipeline order is not Fill -> Web -> shared Line batch');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:12000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const oldGetter=window.getFrameGLStrokeCommands,oldTunnel=state.tunnel.active,oldTransform=mainCtx.getTransform();
      try{
        state.tunnel.active=false;mainCtx.setTransform(1,0,0,1,0,0);beginFrameGeometryRuntime();
        const layer=createLayer('frame-contour-authority');
        layer.spiralEnabled=false;layer.showWeb=true;layer.profileMode='segments';layer.strokeWidth=2;layer.lineProfileApplication='graffiti';layer.lineProfileGraffiti='slash';layer.graffitiSizeVariationEnabled=false;layer.graffitiRotationVariationEnabled=false;
        const cfg=createDefaultSweepConfig();cfg.enabled=true;cfg.effectType='lightning';cfg.lightningPrecision='exact';layer.sweep=cfg;
        const commands=[{alpha:1,strokeStyle:'#fff',subpaths:[{closed:true,points:[{x:20,y:20},{x:220,y:20},{x:220,y:180},{x:20,y:180}]}]}];
        let getterCalls=0;
        window.getFrameGLStrokeCommands=(ctx,hidden)=>{getterCalls++;ctx._glStrokeCommands=commands;ctx._glStrokeCommandFrameId=ctx.frameId;ctx._glStrokeCommandHiddenGraffitiCarrier=hidden===true;return commands;};
        const ctx={layer,effectLayer:layer,layerIndex:0,frameId:901,frame:{id:901,dpr:1,renderLayerCount:1},now:1000,drawLayerInstances:()=>{},combinedScale:2,combinedRotationRad:0,lineProfileStrokeOnly:true,lineProfileApplication:'graffiti',strokeWidth:2,geometryPlan:{kind:'blue-circle-slide',dynamic:true},profilePreparedReady:false,sweepPreparedReady:false,layerSweep:cfg};
        const rec=SomataFrameContourService.get(ctx),again=SomataFrameContourService.get(ctx);
        const p0=rec?.paths?.[0]?.points?.[0],p1=rec?.paths?.[0]?.points?.[1];
        const profileData=prepareLayerFrameProfileData(ctx);
        ctx.sweepPreparedReady=false;const sweepData=prepareLayerFrameSweepData(ctx);ctx.webPreparedReady=false;const webData=prepareLayerFrameWebData(ctx);
        const stages=SomataRenderPassRegistry.status().stages,passes=SomataRenderPassRegistry.status().passes;
        return{getterCalls,same:rec===again,authority:rec?.authority,paths:rec?.pathCount,points:rec?.pointCount,p0,p1,profileSame:profileData?.paths===rec?.paths,profileRoundedSame:profileData?.rounded===rec?.paths,sweepSame:sweepData?.paths===rec?.paths,webAnchorOwned:webData?.paths===rec?.anchorPaths,webVisualOwned:webData?.visualPaths===rec?.visualBezierPaths,stage:{fill:stages.FILL,web:stages.OVER_FILL,glow:stages.GLOW},webPass:passes.find(x=>x.name==='web')||null,status:__somataFrameContourStatus?.()||null};
      }finally{try{endFrameGeometryRuntime();}catch(_){}window.getFrameGLStrokeCommands=oldGetter;state.tunnel.active=oldTunnel;mainCtx.setTransform(oldTransform);}
    })()`,{timeoutMs:9000,label:'FrameContour authority'});
    assert(out.getterCalls===1,'FrameContour rebuilt Line commands more than once in one frame: '+JSON.stringify(out));
    assert(out.same===true&&out.authority==='shared-line-command-topology','FrameContour cache/authority failed: '+JSON.stringify(out));
    assert(out.paths===1&&out.points===4,'FrameContour did not preserve the Line topology: '+JSON.stringify(out));
    assert(Math.abs(out.p0.x-10)<1e-6&&Math.abs(out.p0.y-10)<1e-6&&Math.abs(out.p1.x-110)<1e-6,'FrameContour did not invert the Line transform back to shared local coordinates: '+JSON.stringify(out));
    assert(out.profileSame&&out.profileRoundedSame,'Graffiti/Profile reconstructed a second contour');
    assert(out.sweepSame,'Lightning/Sweep reconstructed a second contour');
    assert(out.webAnchorOwned&&out.webVisualOwned,'Web views are not owned by the shared FrameContour record');
    assert(out.stage.fill<out.stage.web&&out.stage.web<out.stage.glow&&out.webPass?.stage===out.stage.web,'runtime pass order is not Fill -> Web -> Glow/Base');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(!exc.length,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.8 FRAME CONTOUR AUTHORITY: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('SOMATA 7.8 FRAME CONTOUR AUTHORITY: FAIL',e.stack||e);process.exit(1)});
