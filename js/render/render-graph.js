window.__spiroRegisterModule?.('js/render/render-graph');

// 7.7.4 generic render graph. Core geometry contributes Base/Fill only.
// Every optional effect declares its own geometry demand through FeatureHost.graphPass.
const SPIRO_PATH_CAPS={
    POSITIONS:1,
    SEGMENT_TOPOLOGY:2,
    APPROX_ARC:4,
    EXACT_ARC:8,
    CPU_PATH:16,
    CANVAS:32,
    FILL:64,
    LAMPS:128,
    LAMP_IDENTITY:256,
    CPU_PACKED_TOPOLOGY:512
};
const spiroRenderGraphRuntime={frames:0,layers:0,gpuOnlyLayers:0,cpuBoundaryLayers:0,exactArcLayers:0,canvasLayers:0,featureFailures:0,last:null};

function spiroGraphAddPass(graph,name,caps,active=true,backend='auto',meta=null){
    if(!active)return null;
    const pass={name,caps:caps|0,backend,meta:meta||null,order:graph.passes.length};
    graph.passes.push(pass);graph.mask|=pass.caps;graph.roles[name]=pass;return pass;
}
function somataNativeFillGraphFrame(frameCtx){
    return SomataGeometryPolicy.isStrict(frameCtx)||SomataGeometryPolicy.invoke(frameCtx,'graphRequiresNativeFill')===true;
}
function compileLayerRenderGraph(frameCtx){
    const layer=frameCtx?.layer,graph=frameCtx?.renderGraph&&typeof frameCtx.renderGraph==='object'?frameCtx.renderGraph:{passes:[],roles:{}};
    graph.mask=0;graph.passes.length=0;for(const k of Object.keys(graph.roles))delete graph.roles[k];
    graph.frameId=Number(frameCtx?.frameId)||Number(frameGeometryRuntime?.frameId)||0;graph.layerId=layer?.id||null;
    if(!layer){if(frameCtx)frameCtx.renderGraph=graph;return graph;}

    const strictSpiral=somataNativeFillGraphFrame(frameCtx);frameCtx.strictSpiralGpu=strictSpiral;
    const lineVisible=frameCtx.lineDisplayEnabled===true||getLayerLineVisible?.(layer)===true;
    const fill=layer.fill===true;
    spiroGraphAddPass(graph,'base',SPIRO_PATH_CAPS.POSITIONS,lineVisible,'gpu');
    spiroGraphAddPass(graph,'fill',strictSpiral?(SPIRO_PATH_CAPS.FILL|SPIRO_PATH_CAPS.POSITIONS):(SPIRO_PATH_CAPS.FILL|SPIRO_PATH_CAPS.CPU_PATH),fill,strictSpiral?'gpu-native-fill':'gpu-prepared');

    const plans=frameCtx.effectsPlan||{};
    const featureRows=SomataFeatureHost?.queryAll?.('graphPass',frameCtx,plans)||[];
    for(const feature of featureRows){
        if(feature?.error){spiroRenderGraphRuntime.featureFailures++;continue;}
        const rows=Array.isArray(feature?.value)?feature.value:[feature?.value];
        for(const row of rows){if(!row||typeof row!=='object')continue;spiroGraphAddPass(graph,row.name||feature.name,row.caps||0,row.active!==false,row.backend||'auto',row.meta||null);}
    }

    graph.needsPositions=Boolean(graph.mask&SPIRO_PATH_CAPS.POSITIONS);
    graph.needsSegmentTopology=Boolean(graph.mask&SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY);
    graph.needsApproxArc=Boolean(graph.mask&SPIRO_PATH_CAPS.APPROX_ARC);
    graph.needsExactArc=Boolean(graph.mask&SPIRO_PATH_CAPS.EXACT_ARC);
    graph.needsCpuPath=Boolean(graph.mask&SPIRO_PATH_CAPS.CPU_PATH);
    graph.needsCanvas=Boolean(graph.mask&SPIRO_PATH_CAPS.CANVAS);
    graph.needsFill=Boolean(graph.mask&SPIRO_PATH_CAPS.FILL);
    graph.needsLamps=Boolean(graph.mask&SPIRO_PATH_CAPS.LAMPS);
    graph.needsLampIdentity=Boolean(graph.mask&SPIRO_PATH_CAPS.LAMP_IDENTITY);
    graph.needsCpuPackedTopology=Boolean(graph.mask&SPIRO_PATH_CAPS.CPU_PACKED_TOPOLOGY);
    graph.gpuOnly=(graph.needsPositions||graph.needsLampIdentity||graph.needsFill)&&!graph.needsCpuPath&&!graph.needsCpuPackedTopology&&!graph.needsCanvas&&(!graph.needsFill||strictSpiral);
    graph.arcTier=graph.needsExactArc?'exact':(graph.needsApproxArc?'approx':'none');
    graph.dynamic=frameCtx.geometryPlan?.dynamic===true;graph.strictSpiralGpu=strictSpiral;
    frameCtx.renderGraph=graph;

    spiroRenderGraphRuntime.layers++;if(graph.gpuOnly)spiroRenderGraphRuntime.gpuOnlyLayers++;if(graph.needsCpuPath)spiroRenderGraphRuntime.cpuBoundaryLayers++;if(graph.needsExactArc)spiroRenderGraphRuntime.exactArcLayers++;if(graph.needsCanvas)spiroRenderGraphRuntime.canvasLayers++;
    spiroRenderGraphRuntime.last={layerId:graph.layerId,frameId:graph.frameId,mask:graph.mask,gpuOnly:graph.gpuOnly,strictSpiralGpu:graph.strictSpiralGpu===true,arcTier:graph.arcTier,needsCpuPath:graph.needsCpuPath,needsCpuPackedTopology:graph.needsCpuPackedTopology,needsCanvas:graph.needsCanvas,passes:graph.passes.map(p=>({name:p.name,caps:p.caps,backend:p.backend,meta:p.meta}))};
    return graph;
}
function beginSpiroRenderGraphFrame(){spiroRenderGraphRuntime.frames++;}
window.__spiroRenderGraphStatus=()=>({...spiroRenderGraphRuntime,last:spiroRenderGraphRuntime.last?{...spiroRenderGraphRuntime.last,passes:spiroRenderGraphRuntime.last.passes.map(p=>({...p,meta:p.meta?{...p.meta}:null}))}:null,capabilities:{...SPIRO_PATH_CAPS},contract:'Core graph knows only Base/Fill. Optional features publish graphPass capabilities and own their geometry demands.'});
