window.__spiroRegisterModule?.('js/render/sweep-plan');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('sweep',{domain:'effect',plans:['sweep'],reads:['_geometryContract','_webgpuStrokeBatch'],outputs:['sweepData','sweepPrepared','sweepPreparedReady','_profileSweepAttempted']});

function resetSweepEffectPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    p.enabled=false;p.contextDriven=true;p.cfg=null;p.paths=null;p.frameData=null;p.footprint=0;p.now=0;p.tunnelActive=false;p.gpuMorphArc=false;p.gpuMorphArcLightning=false;
    return p;
}

function resolveLayerSweepEffectProvider(frameCtx,plan){
    const effectLayer=frameCtx.effectLayer||liveEffectOwnerForFrameLayer(frameCtx.layer);
    const cfg=getLayerSweepConfig(effectLayer);
    plan.cfg=cfg;plan.enabled=cfg?.enabled===true;plan.tunnelActive=state.tunnel.active===true;plan.now=frameCtx.now;plan.gpuMorphArc=false;plan.gpuMorphArcLightning=false;
    if(!plan.enabled)return plan;

    const gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();
    // One Lightning handler for static + ordinary Morph. 7.7 had routed non-strict Morph Lightning
    // through the retained GPU-Arc renderer while static Lightning used the prepared-path renderer.
    // That split changed the authored carrier, visual result and workload. Only strict Spiral keeps
    // the GPU-only Arc authority; every other Lightning frame goes through prepareLayerFrameSweepData.
    const strictLightning=cfg?.effectType==='lightning'&&SomataGeometryPolicy.isStrict(frameCtx);
    const lightningGpuData=gpuBackendAllowed&&strictLightning&&typeof prepareGpuMorphArcLightningFrame==='function'?prepareGpuMorphArcLightningFrame(frameCtx,cfg):null;
    if(lightningGpuData){plan.paths=null;plan.frameData=lightningGpuData;plan.gpuMorphArcLightning=lightningGpuData.gpuMorphArcLightning===true;const lv=lightningGpuData.lightningVector,vis=typeof getLightningVisualSettings==='function'?getLightningVisualSettings(cfg,frameCtx.layerIndex):null;plan.footprint=Math.max(1,Number(vis?.glowSize)||(Number(cfg.lightningGlow)||0)*Math.max(0,Number(cfg.lightningGlowMultiplier)||1),Number(lv?.boltW)||Number(frameCtx.strokeWidth)||1.5);return plan;}

    // Ordinary Sweep/Glint also consumes the shared FrameContour. Retained GPU Arc is a
    // strict-Spiral specialization only; otherwise it would create a second base contour.
    const gpuData=gpuBackendAllowed&&SomataGeometryPolicy.isStrict(frameCtx)&&cfg?.effectType!=='lightning'&&typeof prepareGpuMorphArcSweepFrame==='function'?prepareGpuMorphArcSweepFrame(frameCtx,cfg):null;
    if(gpuData){plan.paths=null;plan.frameData=gpuData;plan.gpuMorphArc=gpuData.gpuMorphArc===true;const sweepCfg=gpuData.cfg||cfg;plan.footprint=Math.max(.5,Number(gpuData.sweepW)||Number(frameCtx.strokeWidth)||1.5,(Number(sweepCfg?.glow)||0)*.55*Math.max(0,Number(sweepCfg?.glowMultiplier)||1));return plan;}

    if(SomataGeometryPolicy.isStrict(frameCtx)){plan.enabled=false;plan.paths=null;plan.frameData=null;const reason=SomataGeometryPolicy.ineligibleReason(frameCtx,cfg?.effectType==='lightning'?'lightning':'sweep','exact geometry Arc rail unavailable');if(cfg?.effectType==='lightning'&&!/warming/i.test(String(reason||'')))somataGpuDiagnosticError('lightning','strict-spiral-authority',String(reason||'exact geometry Arc rail unavailable'),frameCtx,{fallback:'wait-for-exact-spiral-rail',recovered:false,authority:window.__spiroGpuMorphArcStatus?.()?.lastDecision||null});try{requestMainCanvasRender?.();}catch(_){}return plan;}
    plan.paths=getLayerFrameAuthoritativePaths(frameCtx);
    if(!plan.paths?.length){plan.enabled=false;return plan;}
    plan.frameData=prepareLayerFrameSweepData(frameCtx);
    if(cfg?.effectType==='lightning')try{SweepGPURenderer?.canEncodeToLayerScene?.();}catch(_){}
    const sweepCfg=plan.frameData?.cfg||cfg;
    plan.footprint=sweepCfg?.effectType==='lightning'
        ? Math.max(1,Number((typeof getLightningVisualSettings==='function'?getLightningVisualSettings(sweepCfg,frameCtx.layerIndex):null)?.glowSize)||(Number(sweepCfg.lightningGlow)||0)*Math.max(0,Number(sweepCfg.lightningGlowMultiplier)||1),Number(frameCtx.strokeWidth)||1.5)
        : Math.max(.5,Number(plan.frameData?.sweepW)||Number(frameCtx.strokeWidth)||1.5,(Number(sweepCfg?.glow)||0)*.55*Math.max(0,Number(sweepCfg?.glowMultiplier)||1));
    return plan;
}

SomataFeatureHost?.provide?.('sweep','effectPlan',(frameCtx,previousPlans)=>resolveLayerSweepEffectProvider(frameCtx,resetSweepEffectPlan(previousPlans?.sweep)));
SomataFeatureHost?.provide?.('sweep','graphPass',(frameCtx,plans)=>{
    const plan=plans?.sweep;if(plan?.enabled!==true)return{name:'sweep',caps:0,active:false,backend:'none'};
    const lightning=plan.cfg?.effectType==='lightning',native=lightning?plan.gpuMorphArcLightning===true:plan.gpuMorphArc===true;let caps=SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC;if(!native)caps|=SPIRO_PATH_CAPS.CPU_PATH;
    return{name:'sweep',caps,active:true,backend:lightning?(native?'gpu-lightning-arc':'gpu-prepared'):(native?'gpu-sweep-arc':'gpu-prepared'),meta:{effectType:plan.cfg?.effectType||'sweep',mode:plan.cfg?.mode||'whole',native}};
});
SomataFeatureHost?.provide?.('sweep','resetEffectPlan',plans=>resetSweepEffectPlan(plans?.sweep));

window.__somataLightningCarrierPolicy=()=>({ordinary:'prepared-path-unified-static-dynamic',strictSpiral:'retained-gpu-arc',contract:'Static and non-strict Morph Lightning share prepareLayerFrameSweepData + SweepGPURenderer; strict Spiral remains GPU-only.'});
