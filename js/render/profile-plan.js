window.__spiroRegisterModule?.('js/render/profile-plan');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('profile',{domain:'appearance',plans:['profile','glow','outline'],reads:['_geometryContract'],outputs:[]});

function resetProfileEffectPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    p.enabled=false;p.application='stroke';p.gpuMorphNative=false;p.gpuArcNative=false;p.paths=null;p.prepared=null;p.footprint=0;p.tunnelActive=false;
    return p;
}

function prepareStrictSpiralGpuProfileFrame(frameCtx,lineModeProfile){
    if(!frameCtx||!SomataGeometryPolicy.isStrict(frameCtx)||!['slash','square','circle','cross'].includes(lineModeProfile))return null;
    const table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null,arcRec=table?._gpuMorphArcResource,morphRec=arcRec?.morphRec;if(!table?.gpuArcResident||!arcRec?.ready||!morphRec?.cubicBuffer)return null;
    const layer=frameCtx.layer,baseW=Math.max(.001,(Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer)),w=baseW*4,spacing=Math.max(2.4,w*(lineModeProfile==='slash'?1.85:1.55));
    const rawT=Number(table.gpuMorphT)||0,t=typeof morphRec.resolveMorphT==='function'?morphRec.resolveMorphT(rawT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(rawT):Math.max(0,Math.min(1,rawT))),lens=morphRec.cpuEndpointPathLengths;let total=0;
    if(lens?.length){for(let i=0;i+1<lens.length;i+=2)total+=(Number(lens[i])||0)*(1-t)+(Number(lens[i+1])||0)*t;}
    if(!(total>0))total=Math.max(spacing,Number(morphRec.cubicCount||arcRec.logicalSegmentCount||1)*spacing);
    const count=Math.max(0,Math.min(1800,Math.floor(total/spacing))),prepared={paths:null,rounded:null,type:lineModeProfile,application:'stroke',table,w,spacing,count,variationOn:false,gpuArcNative:true,gpuBezierDerived:true,retainedBezier:true,bezierSubdiv:Number(arcRec.subdiv||morphRec.bezierSubdiv)||6,estimatedArcTotal:total};
    return prepared;
}

function resolveLayerProfileEffectProvider(frameCtx,plan){
    const layer=frameCtx.layer,effectLayer=frameCtx.effectLayer||liveEffectOwnerForFrameLayer(layer);
    plan.application=frameCtx.lineProfileApplication;
    const lineModeProfile=effectLayer?.sprite?.enabled===true?'round':normalizeLineProfileValue(effectLayer?.lineProfileStroke ?? effectLayer?.lineProfile ?? layer?.lineProfileStroke ?? layer?.lineProfile,'round');plan.enabled=getLayerLineVisible(effectLayer)&&(['slash','square','circle','cross'].includes(lineModeProfile)||plan.application==='graffiti');
    plan.tunnelActive=state.tunnel.active===true;
    if(!plan.enabled)return plan;
    if(plan.application==='graffiti'){
        const strict=SomataGeometryPolicy.isStrict(frameCtx),gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();
        // Ordinary Static/Morph Graffiti must follow the exact same FrameContour as Line.
        // Only strict retained Spiral may use the GPU-native retained rail directly.
        const nativePrepared=strict&&gpuBackendAllowed&&typeof prepareGpuMorphGraffitiFrame==='function'?prepareGpuMorphGraffitiFrame(frameCtx):null;
        if(nativePrepared){plan.gpuMorphNative=true;plan.paths=null;plan.prepared=nativePrepared;}
        else if(strict){plan.enabled=false;try{requestMainCanvasRender?.();}catch(_){ }return plan;}
    }else if(SomataGeometryPolicy.isStrict(frameCtx)){
        const nativePrepared=prepareStrictSpiralGpuProfileFrame(frameCtx,lineModeProfile);
        if(nativePrepared){plan.gpuArcNative=true;plan.paths=null;plan.prepared=nativePrepared;}
        else{plan.enabled=false;plan.paths=null;try{WebGPUProfileArcMarkerRenderer?.warmup?.();requestMainCanvasRender?.();}catch(_){ }return plan;}
    }
    if(!plan.prepared){plan.paths=getLayerFrameAuthoritativePaths(frameCtx);if(!plan.paths?.length){plan.enabled=false;return plan;}plan.prepared=prepareLayerFrameProfileData(frameCtx);}
    plan.footprint=plan.application==='graffiti'
        ? Math.max(Number(frameCtx.strokeWidth)||1.5,Math.max(0,(Number(effectLayer?.glow ?? layer.glow)||0)*getLayerGlowMultiplier(effectLayer||layer))*.55)
        : Math.max(1,Number(plan.prepared?.spacing)||Number(frameCtx.strokeWidth)||1.5);
    return plan;
}

SomataFeatureHost?.provide?.('profile','effectPlan',(frameCtx,previousPlans)=>resolveLayerProfileEffectProvider(frameCtx,resetProfileEffectPlan(previousPlans?.profile)));
SomataFeatureHost?.provide?.('profile','graphPass',(frameCtx,plans)=>{
    const plan=plans?.profile;if(plan?.enabled!==true)return{name:'profile',caps:0,active:false,backend:'none'};
    const app=plan.application||'stroke',strict=Boolean(frameCtx?.strictSpiralGpu===true||(SomataGeometryPolicy.isStrict(frameCtx)));
    let caps=SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.EXACT_ARC;if(app==='graffiti')caps|=SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY;if(!strict&&plan.gpuMorphNative!==true&&plan.gpuArcNative!==true)caps|=SPIRO_PATH_CAPS.CPU_PATH;
    return{name:'profile',caps,active:true,backend:plan.gpuMorphNative?'gpu-morph-native':(plan.gpuArcNative?'gpu-marker-bezier-arc':'gpu-prepared'),meta:{application:app,gpuMorphNative:plan.gpuMorphNative===true,gpuArcNative:plan.gpuArcNative===true}};
});
SomataFeatureHost?.provide?.('profile','resetEffectPlan',plans=>resetProfileEffectPlan(plans?.profile));
