// SpiroStar v513 — Layer Render Capability Graph
// Effects declare the smallest geometry capability they need. Expensive representations
// (exact arc, CPU paths, Canvas vectors) are materialized only when a declared pass needs them.
window.__spiroRegisterModule?.('js/render/render-graph');

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
const spiroRenderGraphRuntime={frames:0,layers:0,gpuOnlyLayers:0,cpuBoundaryLayers:0,exactArcLayers:0,canvasLayers:0,last:null};

function spiroGraphAddPass(graph,name,caps,active=true,backend='auto',meta=null){
    if(!active)return null;
    const pass={name,caps:caps|0,backend,meta:meta||null,order:graph.passes.length};
    graph.passes.push(pass);graph.mask|=pass.caps;graph.roles[name]=pass;return pass;
}
function spiroLayerEffectSnapshot(layer){
    const e=typeof ensureLayerEffectState==='function'?ensureLayerEffectState(layer):layer;
    return{
        motion:e?.lineMotionFx||layer?.lineMotionFx||null,
        sprite:e?.sprite||layer?.sprite||null,
        sweep:typeof getLayerSweepConfig==='function'?getLayerSweepConfig(layer):(layer?.sweep||null),
        lamps:typeof ensureLayerLampState==='function'?ensureLayerLampState(layer):(layer?.lamps||state?.lamps||null)
    };
}
function compileLayerRenderGraph(frameCtx){
    const layer=frameCtx?.layer,graph=frameCtx?.renderGraph&&typeof frameCtx.renderGraph==='object'?frameCtx.renderGraph:{passes:[],roles:{}};
    graph.mask=0;graph.passes.length=0;for(const k of Object.keys(graph.roles))delete graph.roles[k];
    graph.frameId=Number(frameCtx?.frameId)||Number(frameGeometryRuntime?.frameId)||0;graph.layerId=layer?.id||null;
    if(!layer){if(frameCtx)frameCtx.renderGraph=graph;return graph;}
    const cfg=spiroLayerEffectSnapshot(layer),lineVisible=frameCtx.lineDisplayEnabled===true||getLayerLineVisible?.(layer)===true;
    // 6.8 iter13 — strict Spiral is a GEOMETRY/BACKEND contract, not a transient
    // readiness result.  The old graph asked canUse*() while GPU pipelines were warming;
    // one false answer added CPU_PATH and eagerly materialised a second contour even though
    // the render pass later refused to use that Canvas/CPU fallback.  That wasted the first
    // moving frames and could make effects appear one rail behind the visible Spiral.
    const spiralEndpoint=(l)=>Boolean(l&&typeof isSpiralLayer==='function'&&isSpiralLayer(l));
    const strictSpiral=Boolean((typeof somataCpuBackendForced!=='function'||!somataCpuBackendForced())&&state?.fourierMode!==true&&((typeof isStrictSpiralWebGPUFrame==='function'&&isStrictSpiralWebGPUFrame(frameCtx))||spiralEndpoint(layer)||spiralEndpoint(frameCtx?.geometryPlan?.sourceLayer)||spiralEndpoint(frameCtx?.geometryPlan?.targetLayer)));
    const baseLineVisible=getLayerLineVisible?.(layer)!==false;
    const fill=baseLineVisible&&layer.fill===true,glow=(Number(frameCtx.glow)||Number(layer.glow)||0)>0,outline=state?.lineOutline?.enabled===true;
    const application=frameCtx.lineProfileApplication||layer.lineProfileApplication||'stroke';
    const profileMode=application==='graffiti'?'graffiti':normalizeLineProfileValue?.(layer.lineProfileStroke??layer.lineProfile,'round');
    const profileEnabled=lineVisible&&(application==='graffiti'||['slash','square','circle','cross'].includes(profileMode));
    const graffitiSizeVariation=layer?.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer?.graffitiSizeVariation)||0)>0;
    const graffitiRotationVariation=layer?.graffitiRotationVariationEnabled===true&&Math.max(0,Number(layer?.graffitiRotationVariation)||0)*Math.max(0,Number.isFinite(Number(layer?.graffitiRotationMultiplier))?Number(layer.graffitiRotationMultiplier):1)>0;
    const graffitiVariation=application==='graffiti'&&(graffitiSizeVariation||graffitiRotationVariation||layer?.graffitiNibShape==='pinched');
    const graffitiMorphNative=application==='graffiti'&&(strictSpiral||(typeof canUseGpuMorphGraffitiFrame==='function'&&canUseGpuMorphGraffitiFrame(frameCtx,true)));
    const graffitiSampleReq=application==='graffiti'&&typeof gpuMorphGraffitiSampledRequirement==='function'?gpuMorphGraffitiSampledRequirement(frameCtx):{needed:false,mode:'perSegment'};
    const graffitiMorphSampled=graffitiMorphNative&&graffitiSampleReq.needed===true;
    const motion=cfg.motion?.enabled===true,sprite=cfg.sprite?.enabled===true,sweep=cfg.sweep?.enabled===true,web=getLayerWebEnabled?.(layer)===true;
    const lamps=frameCtx.lampDisplayEnabled===true||getLayerLampsEnabled?.(layer)===true||frameCtx.forcedLampMorph===true||frameCtx.greenLampDisplay===true;
    const lampPositionMode=typeof gpuMorphLampPositionMode==='function'?gpuMorphLampPositionMode(frameCtx):(state?.lamps?.positionMode||'key');
    // In strict Spiral every lamp placement mode resolves through the authoritative retained
    // cubic Arc (Key/Corner can additionally carry an exact cubic-boundary identity).  Never
    // request a CPU path just because the lamp pipeline is compiling this frame.
    const lampsGpuArc=lamps&&(strictSpiral||(lampPositionMode==='arbitrary'&&typeof canUseGpuMorphArbitraryLampsFrame==='function'&&canUseGpuMorphArbitraryLampsFrame(frameCtx,true)));
    const lampsGpuIdentity=!strictSpiral&&lamps&&lampPositionMode==='key'&&((typeof canUseGpuMorphLampFrame==='function'&&canUseGpuMorphLampFrame(frameCtx,false))||(typeof canUseGpuMorphLampFrame!=='function'&&typeof canUseGpuMorphKeyLampsFrame==='function'&&canUseGpuMorphKeyLampsFrame(frameCtx)));
    const lampsPackedCorners=!strictSpiral&&lamps&&lampPositionMode==='corners'&&typeof canUseGpuMorphCornerLampsFrame==='function'&&canUseGpuMorphCornerLampsFrame(frameCtx);
    const sweepMode=cfg.sweep?.effectType==='lightning'?cfg.sweep?.lightningMode:cfg.sweep?.mode;
    const strictSweepGpu=Boolean(strictSpiral&&sweep&&sweepMode!=='across');
    const sweepCanonical=Boolean(sweep&&cfg.sweep?.effectType!=='lightning'&&(strictSweepGpu||((cfg.sweep?.mode==='whole'||cfg.sweep?.mode==='perPath')&&typeof WebGPUCanonicalSweepRenderer!=='undefined'&&WebGPUCanonicalSweepRenderer.isReady?.())));
    const lightningArcNative=Boolean(sweep&&cfg.sweep?.effectType==='lightning'&&(strictSweepGpu||(typeof canUseGpuMorphArcLightningFrame==='function'&&canUseGpuMorphArcLightningFrame(frameCtx,cfg.sweep,true))));
    const webMorphNative=Boolean(web&&(strictSpiral||(typeof canUseGpuMorphWebFrame==='function'&&canUseGpuMorphWebFrame(frameCtx,true))));

    spiroGraphAddPass(graph,'base',SPIRO_PATH_CAPS.POSITIONS,lineVisible,'gpu');
    spiroGraphAddPass(graph,'fill',strictSpiral?(SPIRO_PATH_CAPS.FILL|SPIRO_PATH_CAPS.POSITIONS):(SPIRO_PATH_CAPS.FILL|SPIRO_PATH_CAPS.CPU_PATH),fill,strictSpiral?'gpu-native-fill':'compat');
    spiroGraphAddPass(graph,'glow',SPIRO_PATH_CAPS.POSITIONS,glow&&lineVisible,'gpu');
    spiroGraphAddPass(graph,'outline',SPIRO_PATH_CAPS.POSITIONS,outline&&lineVisible,'gpu');
    if(profileEnabled){
        const caps=application==='graffiti'
            ? (graffitiMorphNative
                ? SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|(graffitiMorphSampled?SPIRO_PATH_CAPS.EXACT_ARC:0)
                : SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.CPU_PATH|(graffitiVariation?SPIRO_PATH_CAPS.EXACT_ARC:0))
            : (strictSpiral
                ? SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC
                : SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.EXACT_ARC|SPIRO_PATH_CAPS.CPU_PATH);
        spiroGraphAddPass(graph,'profile',caps,true,application==='graffiti'?(graffitiMorphNative?(graffitiMorphSampled?'gpu-morph-sampled':'gpu-morph-native'):'gpu-mesh'):(strictSpiral?'gpu-marker-bezier-arc':'gpu-marker'),{application,profileMode,graffitiVariation,graffitiMorphNative,graffitiMorphSampled,graffitiVariationMode:graffitiSampleReq.mode,strictBezierArc:strictSpiral&&application!=='graffiti'});
    }
    spiroGraphAddPass(graph,'motion',SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC,motion,'gpu');
    spiroGraphAddPass(graph,'sprite',SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC,sprite,'gpu');
    if(sweep){
        let caps=SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC;
        if(!sweepCanonical&&!lightningArcNative)caps|=SPIRO_PATH_CAPS.CPU_PATH;
        const backend=lightningArcNative?'gpu-lightning-arc':(sweepCanonical?'gpu-canonical':'compat');
        spiroGraphAddPass(graph,'sweep',caps,true,backend,{effectType:cfg.sweep?.effectType||'sweep',mode:cfg.sweep?.mode||'whole',canonical:sweepCanonical,lightningArcNative});
    }
    spiroGraphAddPass(graph,'web',SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC|(webMorphNative?0:SPIRO_PATH_CAPS.CPU_PATH),web,webMorphNative?'gpu-web-arc':'compat',{webMorphNative});
    {const lampCaps=SPIRO_PATH_CAPS.LAMPS|(lampsGpuArc?(SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.SEGMENT_TOPOLOGY|SPIRO_PATH_CAPS.EXACT_ARC):(lampsGpuIdentity?SPIRO_PATH_CAPS.LAMP_IDENTITY:(lampsPackedCorners?SPIRO_PATH_CAPS.CPU_PACKED_TOPOLOGY:(SPIRO_PATH_CAPS.POSITIONS|SPIRO_PATH_CAPS.CPU_PATH))));const lampBackend=lampsGpuArc?'gpu-lamp-arc':(lampsGpuIdentity?'gpu-lamp-identity':(lampsPackedCorners?'packed-lamp-corners':'mixed'));spiroGraphAddPass(graph,'lamps',lampCaps,lamps,lampBackend,{gpuArc:lampsGpuArc,gpuIdentity:lampsGpuIdentity,packedCorners:lampsPackedCorners,positionMode:lampPositionMode});}

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
function renderGraphHasCapability(frameCtx,cap){const g=frameCtx?.renderGraph||compileLayerRenderGraph(frameCtx);return Boolean(g.mask&(cap|0));}
window.__spiroRenderGraphStatus=()=>({...spiroRenderGraphRuntime,last:spiroRenderGraphRuntime.last?{...spiroRenderGraphRuntime.last,passes:spiroRenderGraphRuntime.last.passes.map(p=>({...p,meta:p.meta?{...p.meta}:null}))}:null,capabilities:{...SPIRO_PATH_CAPS},contract:'effects declare minimum geometry capability; CPU path / Canvas are explicit graph boundaries rather than implicit side effects'});
