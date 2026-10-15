window.__spiroRegisterModule?.('js/render/web-plan');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('web',{domain:'effect',plans:['web'],reads:['_fillBelowWebResolved'],outputs:['_webPassHandled']});

function resetWebEffectPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    p.enabled=false;p.contextDriven=true;p.paths=null;p.frameData=null;p.footprint=0;p.tunnelActive=false;p.gpuMorphWebNative=false;
    return p;
}

function resolveLayerWebEffectProvider(frameCtx,plan){
    const effectLayer=frameCtx.effectLayer||liveEffectOwnerForFrameLayer(frameCtx.layer);
    plan.enabled=getLayerWebEnabled(effectLayer)===true;plan.tunnelActive=state.tunnel.active===true;plan.gpuMorphWebNative=false;
    if(!plan.enabled)return plan;

    const strict=SomataGeometryPolicy.isStrict(frameCtx);
    // Ordinary Web follows the shared FrameContour. Only strict retained Spiral may use
    // the GPU-native Morph Web rail, because there is no CPU contour authority there.
    const nativeData=strict&&typeof prepareGpuMorphWebFrame==='function'?prepareGpuMorphWebFrame(frameCtx):null;
    if(nativeData){plan.frameData=nativeData;plan.paths=null;plan.gpuMorphWebNative=true;plan.enabled=true;}

    else if(strict){plan.enabled=false;try{requestMainCanvasRender?.();}catch(_){ }return plan;}
    else{plan.frameData=prepareLayerFrameWebData(frameCtx);plan.paths=plan.frameData?.paths||getLayerFrameAuthoritativePaths(frameCtx);plan.enabled=plan.frameData?.enabled===true&&Boolean(plan.paths?.length);}
    if(plan.enabled)plan.footprint=Math.max(.03,Number(plan.frameData?.width)||.6)*2.4;
    return plan;
}

SomataFeatureHost?.provide?.('web','effectPlan',(frameCtx,previousPlans)=>resolveLayerWebEffectProvider(frameCtx,resetWebEffectPlan(previousPlans?.web)));
SomataFeatureHost?.provide?.('web','graphPass',(frameCtx,plans)=>{const plan=plans?.web;return{name:'web',caps:SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC|(plan?.gpuMorphWebNative===true?0:SPIRO_PATH_CAPS.CPU_PATH),active:plan?.enabled===true,backend:plan?.gpuMorphWebNative===true?'gpu-web-arc':'gpu-prepared',meta:{webMorphNative:plan?.gpuMorphWebNative===true}};});
SomataFeatureHost?.provide?.('web','resetEffectPlan',plans=>resetWebEffectPlan(plans?.web));
