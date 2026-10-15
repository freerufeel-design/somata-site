window.__spiroRegisterModule?.('js/render/consumer-demand');

const SPIRO_CONSUMER_NEEDS={GPU_PATH:1,CPU_PATH:2,ARC_LENGTH:4,CANVAS_VECTOR:8,FILL:16,LAMPS:32,EXACT_ARC:64};
const renderConsumerDemandRuntime={frames:0,layers:0,gpuOnlyLayers:0,cpuPathLayers:0,arcLengthLayers:0,vectorMasterRequested:0,vectorMasterSkipped:0,last:null};
function mapRenderGraphCaps(caps){let out=0;if(caps&SPIRO_PATH_CAPS.POSITIONS)out|=SPIRO_CONSUMER_NEEDS.GPU_PATH;if(caps&SPIRO_PATH_CAPS.CPU_PATH)out|=SPIRO_CONSUMER_NEEDS.CPU_PATH;if(caps&(SPIRO_PATH_CAPS.APPROX_ARC|SPIRO_PATH_CAPS.EXACT_ARC))out|=SPIRO_CONSUMER_NEEDS.ARC_LENGTH;if(caps&SPIRO_PATH_CAPS.EXACT_ARC)out|=SPIRO_CONSUMER_NEEDS.EXACT_ARC;if(caps&SPIRO_PATH_CAPS.CANVAS)out|=SPIRO_CONSUMER_NEEDS.CANVAS_VECTOR;if(caps&SPIRO_PATH_CAPS.FILL)out|=SPIRO_CONSUMER_NEEDS.FILL;if(caps&SPIRO_PATH_CAPS.LAMPS)out|=SPIRO_CONSUMER_NEEDS.LAMPS;return out;}
function prepareLayerConsumerDemand(frameCtx){
    const graph=typeof compileLayerRenderGraph==='function'?compileLayerRenderGraph(frameCtx):null;
    const plan=frameCtx.consumerDemand&&typeof frameCtx.consumerDemand==='object'?frameCtx.consumerDemand:{roles:{}};plan.mask=0;plan.roles||(plan.roles={});for(const k of Object.keys(plan.roles))delete plan.roles[k];
    plan.layerId=frameCtx?.layer?.id||null;plan.frameId=Number(frameCtx?.frameId)||0;
    for(const pass of graph?.passes||[]){const needs=mapRenderGraphCaps(pass.caps);plan.roles[pass.name]=needs;plan.mask|=needs;}
    plan.needsGpuPath=Boolean(graph?.needsPositions);plan.needsCpuPath=Boolean(graph?.needsCpuPath);plan.needsArcLength=Boolean(graph?.needsApproxArc||graph?.needsExactArc);plan.needsExactArc=Boolean(graph?.needsExactArc);plan.arcMode=graph?.arcTier||'none';plan.needsCanvasVector=Boolean(graph?.needsCanvas);plan.gpuOnly=Boolean(graph?.gpuOnly);plan.dynamic=Boolean(graph?.dynamic);plan.renderGraph=graph||null;
    frameCtx.consumerDemand=plan;renderConsumerDemandRuntime.layers++;if(plan.gpuOnly)renderConsumerDemandRuntime.gpuOnlyLayers++;if(plan.needsCpuPath)renderConsumerDemandRuntime.cpuPathLayers++;if(plan.needsArcLength)renderConsumerDemandRuntime.arcLengthLayers++;
    renderConsumerDemandRuntime.last={layerId:plan.layerId,mask:plan.mask,needsGpuPath:plan.needsGpuPath,needsCpuPath:plan.needsCpuPath,needsArcLength:plan.needsArcLength,needsExactArc:plan.needsExactArc,arcMode:plan.arcMode,gpuOnly:plan.gpuOnly,roles:{...plan.roles},graphMask:graph?.mask||0};return plan;
}
function shouldPrepareDynamicVectorMaster(frameCtx){
    const d=frameCtx?.consumerDemand||prepareLayerConsumerDemand(frameCtx);
    if(!frameCtx?.geometryMorphEnabled||frameCtx.geometryPlan?.kind==='lightning'||typeof Path2D==='undefined'||state.showRoundingGuides)return false;
    renderConsumerDemandRuntime.vectorMasterRequested++;
    const nativeBase=Boolean(!frameCtx.lineProfileStrokeOnly&&SomataGeometryRoleService?.canRenderRole?.(frameCtx,'base'));
    if(nativeBase){renderConsumerDemandRuntime.vectorMasterSkipped++;return false;}
    return Boolean((state.tunnel.active&&frameCtx.visibleInstances?.copies?.length)||(!state.tunnel.active&&frameCtx.glow>0)||state.lineOutline?.enabled===true);
}
function beginRenderConsumerDemandFrame(){renderConsumerDemandRuntime.frames++;if(typeof beginSpiroRenderGraphFrame==='function')beginSpiroRenderGraphFrame();}
window.__spiroConsumerDemandStatus=()=>({...renderConsumerDemandRuntime,last:renderConsumerDemandRuntime.last?{...renderConsumerDemandRuntime.last,roles:{...renderConsumerDemandRuntime.last.roles}}:null,contract:'Consumer demand is derived only from generic render-graph capability bits; it contains no effect-specific fallback logic.'});
