

window.__spiroRegisterModule?.('js/render/consumer-demand');

const SPIRO_CONSUMER_NEEDS={GPU_PATH:1,CPU_PATH:2,ARC_LENGTH:4,CANVAS_VECTOR:8,FILL:16,LAMPS:32,EXACT_ARC:64};
const renderConsumerDemandRuntime={frames:0,layers:0,gpuOnlyLayers:0,cpuPathLayers:0,arcLengthLayers:0,vectorMasterRequested:0,vectorMasterSkipped:0,last:null};

function demandRole(plan,name,needs,enabled=true){
    if(!enabled)return plan;
    plan.mask|=needs;plan.roles[name]=needs;return plan;
}
function layerConsumerConfig(layer){
    const effectState=typeof ensureLayerEffectState==='function'?ensureLayerEffectState(layer):layer;
    return{
        motion:effectState?.lineMotionFx||layer?.lineMotionFx||null,
        sprite:effectState?.sprite||layer?.sprite||null,
        sweep:typeof getLayerSweepConfig==='function'?getLayerSweepConfig(layer):(layer?.sweep||null),
        lamps:typeof ensureLayerLampState==='function'?ensureLayerLampState(layer):(layer?.lamps||state?.lamps||null)
    };
}
function prepareLayerConsumerDemand(frameCtx){
    const layer=frameCtx?.layer,plan=frameCtx.consumerDemand&&typeof frameCtx.consumerDemand==='object'?frameCtx.consumerDemand:{roles:{}};
    plan.mask=0;plan.roles||(plan.roles={});for(const k of Object.keys(plan.roles))delete plan.roles[k];
    plan.layerId=layer?.id||null;plan.frameId=Number(frameCtx?.frameId)||0;
    if(!layer){frameCtx.consumerDemand=plan;return plan;}

    const graph=typeof compileLayerRenderGraph==='function'?compileLayerRenderGraph(frameCtx):null;
    if(graph){
        const mapCaps=(caps)=>{let out=0;if(caps&SPIRO_PATH_CAPS.POSITIONS)out|=SPIRO_CONSUMER_NEEDS.GPU_PATH;if(caps&SPIRO_PATH_CAPS.CPU_PATH)out|=SPIRO_CONSUMER_NEEDS.CPU_PATH;if(caps&(SPIRO_PATH_CAPS.APPROX_ARC|SPIRO_PATH_CAPS.EXACT_ARC))out|=SPIRO_CONSUMER_NEEDS.ARC_LENGTH;if(caps&SPIRO_PATH_CAPS.EXACT_ARC)out|=SPIRO_CONSUMER_NEEDS.EXACT_ARC;if(caps&SPIRO_PATH_CAPS.CANVAS)out|=SPIRO_CONSUMER_NEEDS.CANVAS_VECTOR;if(caps&SPIRO_PATH_CAPS.FILL)out|=SPIRO_CONSUMER_NEEDS.FILL;if(caps&SPIRO_PATH_CAPS.LAMPS)out|=SPIRO_CONSUMER_NEEDS.LAMPS;return out;};
        for(const pass of graph.passes){const needs=mapCaps(pass.caps);plan.roles[pass.name]=needs;plan.mask|=needs;}
        plan.needsGpuPath=graph.needsPositions;plan.needsCpuPath=graph.needsCpuPath;plan.needsArcLength=graph.needsApproxArc||graph.needsExactArc;plan.needsExactArc=graph.needsExactArc;plan.arcMode=graph.arcTier;plan.needsCanvasVector=graph.needsCanvas;plan.gpuOnly=graph.gpuOnly;plan.dynamic=graph.dynamic;plan.renderGraph=graph;
    }else{

        const cfg=layerConsumerConfig(layer),lineVisible=frameCtx.lineDisplayEnabled===true||getLayerLineVisible?.(layer)===true;
        const fill=(getLayerLineVisible?.(layer)!==false)&&layer.fill===true,glow=(Number(frameCtx.glow)||Number(layer.glow)||0)>0,outline=state?.lineOutline?.enabled===true;
        const profileApplication=frameCtx.lineProfileApplication||layer.lineProfileApplication||'stroke',profileMode=profileApplication==='graffiti'?'graffiti':normalizeLineProfileValue?.(layer.lineProfileStroke??layer.lineProfile,'round');
        const profileEnabled=lineVisible&&(profileApplication==='graffiti'||['slash','square','circle','cross'].includes(profileMode));
        const motion=cfg.motion?.enabled===true,sprite=cfg.sprite?.enabled===true,sweep=cfg.sweep?.enabled===true,web=getLayerWebEnabled?.(layer)===true;
        const sweepGpuArcCapable=sweep&&cfg.sweep?.effectType!=='lightning'&&(cfg.sweep?.mode==='whole'||cfg.sweep?.mode==='perPath')&&Boolean(typeof WebGPUCanonicalSweepRenderer!=='undefined'&&WebGPUCanonicalSweepRenderer.isReady?.());
        const lamps=frameCtx.lampDisplayEnabled===true||getLayerLampsEnabled?.(layer)===true||frameCtx.forcedLampMorph===true||frameCtx.greenLampDisplay===true;
        demandRole(plan,'base',SPIRO_CONSUMER_NEEDS.GPU_PATH,lineVisible);demandRole(plan,'fill',SPIRO_CONSUMER_NEEDS.FILL|SPIRO_CONSUMER_NEEDS.CPU_PATH,fill);demandRole(plan,'glow',SPIRO_CONSUMER_NEEDS.GPU_PATH,glow&&lineVisible);demandRole(plan,'outline',SPIRO_CONSUMER_NEEDS.GPU_PATH,outline&&lineVisible);demandRole(plan,'profile',SPIRO_CONSUMER_NEEDS.GPU_PATH|SPIRO_CONSUMER_NEEDS.CPU_PATH|SPIRO_CONSUMER_NEEDS.ARC_LENGTH,profileEnabled);demandRole(plan,'motion',SPIRO_CONSUMER_NEEDS.GPU_PATH|SPIRO_CONSUMER_NEEDS.ARC_LENGTH|SPIRO_CONSUMER_NEEDS.EXACT_ARC,motion);demandRole(plan,'sprite',SPIRO_CONSUMER_NEEDS.GPU_PATH|SPIRO_CONSUMER_NEEDS.ARC_LENGTH|SPIRO_CONSUMER_NEEDS.EXACT_ARC,sprite);demandRole(plan,'sweep',SPIRO_CONSUMER_NEEDS.GPU_PATH|SPIRO_CONSUMER_NEEDS.ARC_LENGTH|SPIRO_CONSUMER_NEEDS.EXACT_ARC|(sweepGpuArcCapable?0:SPIRO_CONSUMER_NEEDS.CPU_PATH),sweep);demandRole(plan,'web',SPIRO_CONSUMER_NEEDS.GPU_PATH|SPIRO_CONSUMER_NEEDS.CPU_PATH,web);demandRole(plan,'lamps',SPIRO_CONSUMER_NEEDS.LAMPS|SPIRO_CONSUMER_NEEDS.CPU_PATH,lamps);
        plan.needsGpuPath=Boolean(plan.mask&SPIRO_CONSUMER_NEEDS.GPU_PATH);plan.needsCpuPath=Boolean(plan.mask&SPIRO_CONSUMER_NEEDS.CPU_PATH);plan.needsArcLength=Boolean(plan.mask&SPIRO_CONSUMER_NEEDS.ARC_LENGTH);plan.needsExactArc=Boolean(plan.mask&SPIRO_CONSUMER_NEEDS.EXACT_ARC);plan.arcMode=plan.needsExactArc?'exact':(plan.needsArcLength?'approx':'none');plan.needsCanvasVector=Boolean(plan.mask&SPIRO_CONSUMER_NEEDS.CANVAS_VECTOR);plan.gpuOnly=plan.needsGpuPath&&!plan.needsCpuPath&&!fill&&!lamps;plan.dynamic=frameCtx.geometryPlan?.dynamic===true;
    }
    plan.webgpuStrokeReady=Boolean(typeof WebGPUStrokeRenderer!=='undefined'&&WebGPUStrokeRenderer.isReady?.());plan.pathFxReady=Boolean(typeof WebGPUPathFxRenderer!=='undefined'&&WebGPUPathFxRenderer.isReady?.());frameCtx.consumerDemand=plan;
    renderConsumerDemandRuntime.layers++;if(plan.gpuOnly)renderConsumerDemandRuntime.gpuOnlyLayers++;if(plan.needsCpuPath)renderConsumerDemandRuntime.cpuPathLayers++;if(plan.needsArcLength)renderConsumerDemandRuntime.arcLengthLayers++;
    renderConsumerDemandRuntime.last={layerId:plan.layerId,mask:plan.mask,needsGpuPath:plan.needsGpuPath,needsCpuPath:plan.needsCpuPath,needsArcLength:plan.needsArcLength,needsExactArc:plan.needsExactArc,arcMode:plan.arcMode,gpuOnly:plan.gpuOnly,roles:{...plan.roles},graphMask:graph?.mask||0};
    return plan;
}
function shouldPrepareDynamicVectorMaster(frameCtx){
    const d=frameCtx?.consumerDemand||prepareLayerConsumerDemand(frameCtx);
    if(!frameCtx?.geometryMorphEnabled||frameCtx.geometryPlan?.kind==='lightning'||typeof Path2D==='undefined'||state.showRoundingGuides)return false;
    renderConsumerDemandRuntime.vectorMasterRequested++;

    const gpuStrokeReady=Boolean(d.webgpuStrokeReady&&!frameCtx.lineProfileStrokeOnly);
    if(gpuStrokeReady){renderConsumerDemandRuntime.vectorMasterSkipped++;return false;}
    return Boolean((state.tunnel.active&&frameCtx.visibleInstances?.copies?.length)||(!state.tunnel.active&&frameCtx.glow>0)||state.lineOutline?.enabled===true);
}
function beginRenderConsumerDemandFrame(){renderConsumerDemandRuntime.frames++;if(typeof beginSpiroRenderGraphFrame==='function')beginSpiroRenderGraphFrame();}
window.__spiroConsumerDemandStatus=()=>({...renderConsumerDemandRuntime,last:renderConsumerDemandRuntime.last?{...renderConsumerDemandRuntime.last,roles:{...renderConsumerDemandRuntime.last.roles}}:null,contract:'effects declare GPU/CPU path and exact-arc demand before materialization; whole/perPath GPU Sweep no longer forces CPU paths when its backend is ready.'});
