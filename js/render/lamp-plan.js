window.__spiroRegisterModule?.('js/render/lamp-plan');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('lamps',{domain:'effect',plans:['lamps'],reads:['_geometryContract'],outputs:[]});

function resetLampEffectPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    p.enabled=false;p.contextDriven=true;p.baseConfig=null;p.instances=null;p.adaptiveCount=0;p.tunnelActive=false;p.drawContract='LampDrawPlan';
    if(!Array.isArray(p.sets))p.sets=[];else p.sets.length=0;if(!Array.isArray(p.setPool))p.setPool=[];p.setCursor=0;
    return p;
}

function pushLampEffectSet(plan,layer,points,alphaBase,config){
    if(!layer||!points?.length||alphaBase<=.001)return;
    const idx=plan.setCursor||0;let set=plan.setPool?.[idx];
    if(!set){set={layer:null,points:null,alphaBase:0,config:null,stylePlan:{},visualPlan:{items:[]},gpuLampNative:false,gpuPrepared:null};(plan.setPool||(plan.setPool=[]))[idx]=set;}
    if(!set.stylePlan)set.stylePlan={};if(!set.visualPlan)set.visualPlan={items:[]};
    plan.setCursor=idx+1;set.layer=layer;set.points=points;set.alphaBase=alphaBase;set.config=config||ensureLayerLampState(layer)||plan.baseConfig;set.gpuLampNative=false;set.gpuPrepared=null;
    plan.sets.push(set);
}
function pushGpuLampEffectSet(plan,layer,prepared,alphaBase,config){
    if(!layer||!prepared?.attachmentPoints?.length||alphaBase<=.001)return;
    const idx=plan.setCursor||0;let set=plan.setPool?.[idx];if(!set){set={layer:null,points:null,alphaBase:0,config:null,stylePlan:{},visualPlan:{items:[]},gpuLampNative:false,gpuPrepared:null};(plan.setPool||(plan.setPool=[]))[idx]=set;}
    if(!set.stylePlan)set.stylePlan={};if(!set.visualPlan)set.visualPlan={items:[]};plan.setCursor=idx+1;set.layer=layer;set.points=prepared.attachmentPoints;set.alphaBase=alphaBase;set.config=config||ensureLayerLampState(layer)||plan.baseConfig;set.gpuLampNative=true;set.gpuPrepared=prepared;plan.sets.push(set);
}

function resolveLayerLampEffectProvider(frameCtx,plan){
    const layer=frameCtx.layer,effectLayer=frameCtx.effectLayer||liveEffectOwnerForFrameLayer(layer),layerIndex=frameCtx.layerIndex;
    plan.enabled=(frameCtx.forcedLampMorph||frameCtx.greenLampDisplay||getLayerLampsEnabled(effectLayer))===true;
    plan.tunnelActive=state.tunnel.active===true;
    plan.baseConfig=ensureLayerLampState(effectLayer)||state.lamps;
    if(!plan.enabled)return plan;
    const {tunnelCopies,viewportOuterRadius}=frameCtx.frame;
    const instances=plan.tunnelActive
        ? prepareTunnelLampInstances(tunnelCopies,frameCtx.layerExtent,frameCtx.combinedScale,viewportOuterRadius,state.zoom,layer?.id||layerIndex,frameCtx.now,plan.baseConfig)
        : frameCtx.visibleInstances;
    plan.instances=instances;plan.adaptiveCount=instances.copies.length;

    if(frameCtx.minimalFadeEnabled){
        const mt=frameCtx.orangeMorphProvider?.progress||0;
        const src=frameCtx.minimalSourceLayer,dst=frameCtx.minimalTargetLayer;
        if(src&&getLayerLampsEnabled(src)){
            const srcLampConfig=ensureLayerLampState(src)||plan.baseConfig;
            const pts=frameCtx.orangeMorphProvider?.sourceLampPoints||withLampConfig(srcLampConfig,()=>collectStaticLampPoints(src,frameCtx.orangeMorphProvider?.sourceData||undefined,240));
            const opacity=audioApplyNumeric('layer.opacity',(src.opacity!==undefined?src.opacity:100),layerIndex)/100;
            pushLampEffectSet(plan,src,pts,opacity*.95*(1-mt),srcLampConfig);
        }
        if(dst&&getLayerLampsEnabled(dst)){
            const dstLampConfig=ensureLayerLampState(dst)||plan.baseConfig;
            const pts=frameCtx.orangeMorphProvider?.targetLampPoints||withLampConfig(dstLampConfig,()=>collectStaticLampPoints(dst,frameCtx.orangeMorphProvider?.targetData||undefined,240));
            const opacity=audioApplyNumeric('layer.opacity',(dst.opacity!==undefined?dst.opacity:100),layerIndex)/100;
            pushLampEffectSet(plan,dst,pts,opacity*.95*mt,dstLampConfig);
        }
    }else{
        const lampT=frameCtx.blueMorphProvider?.geometryT||0;
        const followsMorph=Boolean(!frameCtx.greenMorphEnabled&&frameCtx.morphFrameActive&&frameCtx.blueMorphProvider?.mode!=='fade');
        const allowed=frameCtx.forcedLampMorph||frameCtx.greenLampDisplay||getLayerLampsEnabled(effectLayer);
        const alpha=frameCtx.baseAlpha*((frameCtx.forcedLampMorph||followsMorph)?1:.95);

        const strictSpiralGpuBefore=SomataGeometryPolicy.isStrict(frameCtx),gpuLampPrepared=(followsMorph||strictSpiralGpuBefore)&&allowed&&typeof prepareGpuMorphLampFrame==='function'?prepareGpuMorphLampFrame(frameCtx):null;
        if(gpuLampPrepared){pushGpuLampEffectSet(plan,layer,gpuLampPrepared,alpha,plan.baseConfig);}
        else{

            const strictSpiralGpu=SomataGeometryPolicy.isStrict(frameCtx);
            if(strictSpiralGpu){plan.enabled=false;somataGpuContractError('SPIRAL_LAMP_ARC_RESOURCE_UNAVAILABLE',frameCtx,{arc:window.__spiroGpuMorphArcStatus?.()||null,lampBridge:window.__spiroGpuMorphLampBridgeStatus?.()||null,lamp:window.__spiroLampGPUStatus?.()||null,authority:(()=>{try{const r=typeof currentGpuBezierResourceForFrame==='function'?currentGpuBezierResourceForFrame(frameCtx):null;return r?{layerIndex:r.layerIndex,ready:r.ready===true,static:r.staticSpiralBezierRail===true,special:r.specialSpiralBezierRail===true,cubicCount:Number(r.cubicCount)||0,segmentCount:Number(r.segmentCount)||0,phaseSerial:Number(r.phaseSerial)||0}:null;}catch(_){return null;}})(),arcDecision:window.__spiroGpuMorphArcStatus?.()?.lastDecision||null});try{requestMainCanvasRender?.();}catch(_){ }return plan;}

            const rawPaths=followsMorph?getLayerFrameAuxiliaryPaths(frameCtx):null;
            // Topology/Calm lamp identity still follows the proven v505 construction path,
            // but the final contour attachment in 7.8 must use the ACTUAL visible profile
            // carrier of this frame. FrameContour is the same authority consumed by Line/Web;
            // rebuilding a second rounded/profile rail here can drift from the user's profile.
            let authoritativeLampAttachmentPaths=null;
            if(followsMorph&&typeof useCanonicalV505TopologyLampAttachment==='function'&&useCanonicalV505TopologyLampAttachment(frameCtx)){
                try{authoritativeLampAttachmentPaths=SomataFrameContourService?.paths?.(frameCtx)||null;}catch(_){authoritativeLampAttachmentPaths=null;}
            }
            const points=withLampConfig(plan.baseConfig,()=>frameCtx.greenMorphEnabled
                ? (frameCtx.greenMorphProvider?.frameLampPoints||[])
                : (followsMorph?collectMorphLampPoints(layerIndex,lampT,260,rawPaths,authoritativeLampAttachmentPaths):collectStaticLampPoints(layer,frameCtx.staticDrawData||undefined,240)));
            if(allowed)pushLampEffectSet(plan,layer,points,alpha,plan.baseConfig);
        }
    }
    plan.enabled=plan.sets.length>0;
    return plan;
}

SomataFeatureHost?.provide?.('lamps','effectPlan',(frameCtx,previousPlans)=>resolveLayerLampEffectProvider(frameCtx,resetLampEffectPlan(previousPlans?.lamps)));
SomataFeatureHost?.provide?.('lamps','graphPass',(frameCtx,plans)=>{
    const plan=plans?.lamps;if(plan?.enabled!==true)return{name:'lamps',caps:0,active:false,backend:'none'};
    const sets=plan.sets||[],gpuArc=sets.some(s=>s?.gpuPrepared?.gpuBezierDerived===true||s?.gpuPrepared?.gpuArcNative===true),gpuNative=sets.some(s=>s?.gpuLampNative===true);let caps=SPIRO_PATH_CAPS.LAMPS;if(gpuArc)caps|=SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC;else if(gpuNative)caps|=SPIRO_PATH_CAPS.LAMP_IDENTITY;else caps|=SPIRO_PATH_CAPS.CPU_PATH;
    return{name:'lamps',caps,active:true,backend:gpuArc?'gpu-lamp-arc':(gpuNative?'gpu-lamp-native':'gpu-prepared'),meta:{gpuArc,gpuNative,positionMode:typeof gpuMorphLampPositionMode==='function'?gpuMorphLampPositionMode(frameCtx):'key'}};
});
SomataFeatureHost?.provide?.('lamps','resetEffectPlan',plans=>resetLampEffectPlan(plans?.lamps));
