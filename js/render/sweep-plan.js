window.__spiroRegisterModule?.('js/render/sweep-plan');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('sweep',{domain:'effect',plans:['sweep'],reads:['_geometryContract','_webgpuStrokeBatch'],outputs:['sweepData','sweepPrepared','sweepPreparedReady','_profileSweepAttempted']});

function resetSweepEffectPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    p.enabled=false;p.contextDriven=true;p.cfg=null;p.paths=null;p.frameData=null;p.footprint=0;p.now=0;p.tunnelActive=false;p.gpuMorphArc=false;p.gpuMorphArcLightning=false;p.instances=[];
    return p;
}

function sweepModeConfig(cfg,effectType){
    return{...cfg,enabled:true,effectType:effectType==='lightning'?'lightning':'glint'};
}
function sweepModeFrameContext(frameCtx,cfg){
    return{...frameCtx,layerSweep:cfg,sweepPreparedReady:false,sweepPrepared:null,sweepData:{},_profileSweepAttempted:false};
}
function commitGlintClock(source,preparedCfg){
    if(!source||!preparedCfg)return;
    for(const key of ['phase','lastUpdate','currentVelocity','cycleCount'])if(Number.isFinite(Number(preparedCfg[key])))source[key]=preparedCfg[key];
}
function commitLightningClock(source,preparedCfg){
    if(!source||!preparedCfg)return;
    for(const key of ['lightningPhase','lightningLastUpdate','lightningCycleCount'])if(Number.isFinite(Number(preparedCfg[key])))source[key]=preparedCfg[key];
}
function resolveSweepSubEffect(frameCtx,baseCfg,effectType){
    const cfg=sweepModeConfig(baseCfg,effectType),sub=resetSweepEffectPlan({});
    sub.cfg=cfg;sub.enabled=true;sub.tunnelActive=state.tunnel.active===true;sub.now=frameCtx.now;sub.effectType=cfg.effectType;
    const localCtx=sweepModeFrameContext(frameCtx,cfg),gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();

    // One Lightning handler for static + ordinary Morph. 7.7 had routed non-strict Morph Lightning
    // through the retained GPU-Arc renderer while static Lightning used the prepared-path renderer.
    // That split changed the authored carrier, visual result and workload. Only strict Spiral keeps
    // the GPU-only Arc authority; every other Lightning frame goes through prepareLayerFrameSweepData.
    const strictLightning=cfg?.effectType==='lightning'&&SomataGeometryPolicy.isStrict(frameCtx);
    const lightningGpuData=gpuBackendAllowed&&strictLightning&&typeof prepareGpuMorphArcLightningFrame==='function'?prepareGpuMorphArcLightningFrame(localCtx,cfg):null;
    if(lightningGpuData){sub.paths=null;sub.frameData=lightningGpuData;sub.gpuMorphArcLightning=lightningGpuData.gpuMorphArcLightning===true;const lv=lightningGpuData.lightningVector,vis=typeof getLightningVisualSettings==='function'?getLightningVisualSettings(cfg,frameCtx.layerIndex):null;sub.footprint=Math.max(1,Number(vis?.glowSize)||(Number(cfg.lightningGlow)||0)*Math.max(0,Number(cfg.lightningGlowMultiplier)||1),Number(lv?.boltW)||Number(frameCtx.strokeWidth)||1.5);commitLightningClock(baseCfg,lightningGpuData.cfg||cfg);return sub;}

    // Ordinary Sweep/Glint also consumes the shared FrameContour. Retained GPU Arc is a
    // strict-Spiral specialization only; otherwise it would create a second base contour.
    const gpuData=gpuBackendAllowed&&SomataGeometryPolicy.isStrict(frameCtx)&&cfg?.effectType!=='lightning'&&typeof prepareGpuMorphArcSweepFrame==='function'?prepareGpuMorphArcSweepFrame(localCtx,cfg):null;
    if(gpuData){sub.paths=null;sub.frameData=gpuData;sub.gpuMorphArc=gpuData.gpuMorphArc===true;const sweepCfg=gpuData.cfg||cfg;sub.footprint=Math.max(.5,Number(gpuData.sweepW)||Number(frameCtx.strokeWidth)||1.5,(Number(sweepCfg?.glow)||0)*.55*Math.max(0,Number(sweepCfg?.glowMultiplier)||1));commitGlintClock(baseCfg,sweepCfg);return sub;}

    if(SomataGeometryPolicy.isStrict(frameCtx)){sub.enabled=false;sub.paths=null;sub.frameData=null;const reason=SomataGeometryPolicy.ineligibleReason(frameCtx,cfg?.effectType==='lightning'?'lightning':'sweep','exact geometry Arc rail unavailable');if(cfg?.effectType==='lightning'&&!/warming/i.test(String(reason||'')))somataGpuDiagnosticError('lightning','strict-spiral-authority',String(reason||'exact geometry Arc rail unavailable'),frameCtx,{fallback:'wait-for-exact-spiral-rail',recovered:false,authority:window.__spiroGpuMorphArcStatus?.()?.lastDecision||null});try{requestMainCanvasRender?.();}catch(_){}return sub;}
    sub.paths=getLayerFrameAuthoritativePaths(frameCtx);
    if(!sub.paths?.length){sub.enabled=false;return sub;}
    sub.frameData=prepareLayerFrameSweepData(localCtx);
    if(cfg?.effectType==='lightning')try{SweepGPURenderer?.canEncodeToLayerScene?.();}catch(_){}
    const sweepCfg=sub.frameData?.cfg||cfg;
    if(cfg.effectType==='lightning')commitLightningClock(baseCfg,sweepCfg);else commitGlintClock(baseCfg,sweepCfg);
    sub.footprint=sweepCfg?.effectType==='lightning'
        ? Math.max(1,Number((typeof getLightningVisualSettings==='function'?getLightningVisualSettings(sweepCfg,frameCtx.layerIndex):null)?.glowSize)||(Number(sweepCfg.lightningGlow)||0)*Math.max(0,Number(sweepCfg.lightningGlowMultiplier)||1),Number(frameCtx.strokeWidth)||1.5)
        : Math.max(.5,Number(sub.frameData?.sweepW)||Number(frameCtx.strokeWidth)||1.5,(Number(sweepCfg?.glow)||0)*.55*Math.max(0,Number(sweepCfg?.glowMultiplier)||1));
    return sub;
}

function copySweepCompatibilityView(plan,instance){
    if(!instance)return plan;
    for(const key of ['cfg','paths','frameData','footprint','now','tunnelActive','gpuMorphArc','gpuMorphArcLightning'])plan[key]=instance[key];
    return plan;
}
function resolveLayerSweepEffectProvider(frameCtx,plan){
    const effectLayer=frameCtx.effectLayer||liveEffectOwnerForFrameLayer(frameCtx.layer),cfg=getLayerSweepConfig(effectLayer);normalizeSweepConfig(cfg);
    plan.now=frameCtx.now;plan.tunnelActive=state.tunnel.active===true;plan.instances=[];
    if(cfg?.glintEnabled===true){const glint=resolveSweepSubEffect(frameCtx,cfg,'glint');if(glint?.enabled)plan.instances.push(glint);}
    if(cfg?.lightningEnabled===true){const lightning=resolveSweepSubEffect(frameCtx,cfg,'lightning');if(lightning?.enabled)plan.instances.push(lightning);}
    plan.enabled=plan.instances.length>0;
    // Old consumers/tests expect the single active effect directly on `sweep`; preserve that view.
    copySweepCompatibilityView(plan,plan.instances.length===1?plan.instances[0]:(plan.instances[0]||null));
    return plan;
}

SomataFeatureHost?.provide?.('sweep','effectPlan',(frameCtx,previousPlans)=>resolveLayerSweepEffectProvider(frameCtx,resetSweepEffectPlan(previousPlans?.sweep)));
SomataFeatureHost?.provide?.('sweep','graphPass',(frameCtx,plans)=>{
    const plan=plans?.sweep;if(plan?.enabled!==true)return{name:'sweep',caps:0,active:false,backend:'none'};
    const list=plan.instances?.length?plan.instances:[plan];let caps=SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC,allNative=true;
    const effectTypes=[];
    for(const item of list){const lightning=item.cfg?.effectType==='lightning',native=lightning?item.gpuMorphArcLightning===true:item.gpuMorphArc===true;allNative=allNative&&native;if(!native)caps|=SPIRO_PATH_CAPS.CPU_PATH;effectTypes.push(item.cfg?.effectType||'sweep');}
    return{name:'sweep',caps,active:true,backend:list.length>1?'gpu-multi':(effectTypes[0]==='lightning'?(allNative?'gpu-lightning-arc':'gpu-prepared'):(allNative?'gpu-sweep-arc':'gpu-prepared')),meta:{effectType:effectTypes[0]||'sweep',effectTypes,mode:plan.cfg?.mode||'whole',native:allNative}};
});
SomataFeatureHost?.provide?.('sweep','resetEffectPlan',plans=>resetSweepEffectPlan(plans?.sweep));

window.__somataLightningCarrierPolicy=()=>({ordinary:'prepared-path-unified-static-dynamic',strictSpiral:'retained-gpu-arc',contract:'Static and non-strict Morph Lightning share prepareLayerFrameSweepData + SweepGPURenderer; strict Spiral remains GPU-only.'});
