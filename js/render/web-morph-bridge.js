

window.__spiroRegisterModule?.('js/render/web-morph-bridge');

const gpuMorphWebBridgeStats={requests:0,hits:0,fallbacks:0,cpuPathBuildsAvoided:0,cpuCornerScansAvoided:0,cpuPathTablesAvoided:0,lastReason:'not-requested'};

function gpuMorphWebIneligibleReason(frameCtx,requireReady=true){
    const layer=frameCtx?.layer;if(!frameCtx||!layer)return'no-frame';if(getLayerWebEnabled(layer)!==true)return'web-disabled';
    if(typeof gpuMorphArcIneligibleReason==='function'){const reason=gpuMorphArcIneligibleReason(frameCtx);if(reason)return reason;}
    const cfg=getLayerWebConfig(layer),branches=typeof getWebBranchFlags==='function'?getWebBranchFlags(cfg):{inside:cfg?.region!=='outside',outsideStraight:false,outsideArc:cfg?.region!=='inside'};
    const placement=['corners','selfIntersection','selfIntersectionCorridor'].includes(cfg?.placementMode)?cfg.placementMode:'selfIntersection';
    if(!branches.inside||branches.outsideStraight||branches.outsideArc)return'web-multi-or-outer-branch-uses-exact-gpu-raster-fallback';
    const owner=ensureLayerEffectState(layer),transition=owner?webRuntime?.transitionByLayer?.get(owner.id):null;if(transition?.kind==='visibility')return'web-visibility-transition-uses-exact-gpu-raster-fallback';
    if(cfg?.style==='spiderSun')return'spider-sun-uses-gpu-raster-fan-fallback';
    const morphRec=typeof currentGpuBezierResourceForFrame==='function'?currentGpuBezierResourceForFrame(frameCtx):(typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx.layerIndex):(typeof getSharedGpuMorphPathResource==='function'?getSharedGpuMorphPathResource(frameCtx.layerIndex):null));if(!morphRec?.ready)return'gpu-retained-resource-unavailable';

    if(requireReady){
        if(typeof WebGPUWebMorphRenderer==='undefined'||!WebGPUWebMorphRenderer.isReady?.())return'gpu-web-warming';
        if(typeof warmupGpuMorphArcResource!=='function'||!warmupGpuMorphArcResource())return'gpu-morph-arc-warming';
        if(typeof warmupGpuWebCornerResource!=='function'||!warmupGpuWebCornerResource())return'gpu-web-corner-warming';
    }
    return'';
}
function canUseGpuMorphWebFrame(frameCtx,requireReady=true){return gpuMorphWebIneligibleReason(frameCtx,requireReady)==='';}
function prepareGpuMorphWebFrame(frameCtx){
    if(!frameCtx)return null;gpuMorphWebBridgeStats.requests++;try{WebGPUWebMorphRenderer?.warmup?.();warmupGpuMorphArcResource?.();warmupGpuWebCornerResource?.();}catch(_){}
    const reason=gpuMorphWebIneligibleReason(frameCtx,true);if(reason){gpuMorphWebBridgeStats.fallbacks++;gpuMorphWebBridgeStats.lastReason=reason;return null;}
    const pair=typeof getGpuWebCornerResourceForFrame==='function'?getGpuWebCornerResourceForFrame(frameCtx):null;if(!pair?.table?.gpuArcResident||!pair?.resource?.ready){gpuMorphWebBridgeStats.fallbacks++;gpuMorphWebBridgeStats.lastReason='gpu-web-corner-resource-unavailable';return null;}
    const layer=frameCtx.layer,owner=ensureLayerEffectState(layer),cfg=owner?.web||getLayerWebConfig(layer),idx=frameCtx.layerIndex,now=frameCtx.now||performance.now();
    const threshold=Math.max(1,Math.min(179,audioApplyNumeric('web.angleThreshold',Number(cfg.angleThreshold)||60,idx))),spacing=Math.max(1,Math.min(80,audioApplyNumeric('web.spacing',Number(cfg.spacing)||10,idx))),depthPercent=Math.max(0,Math.min(100,audioApplyNumeric('web.distance',Number(cfg.distance)||20,idx))),depthMultiplier=Math.max(0,Number.isFinite(Number(cfg.depthMultiplier))?Number(cfg.depthMultiplier):1),variation=Math.max(0,Math.min(45,audioApplyNumeric('web.angleVariation',Number(cfg.angleVariation)||0,idx))),jitterStrength=Math.sin(variation*Math.PI/180)*.9;
    const color=typeof resolveWebPrimaryColor==='function'?resolveWebPrimaryColor(cfg,layer,frameCtx):(/^#[0-9a-f]{6}$/i.test(cfg.color||'')?cfg.color:'#ffffff'),secondaryColor=/^#[0-9a-f]{6}$/i.test(cfg.secondaryColor||'')?cfg.secondaryColor:'#00ffff',baseLineWidth=Math.max(.1,Number(frameCtx.strokeWidth)||audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,idx)*getLayerStrokeWidthMultiplier(layer)),widthBase=cfg.widthRelative===true?Math.max(.05,Math.min(12,baseLineWidth*Math.max(.01,Math.min(4,(Number(cfg.widthPercent)||40)/100)))):Math.max(.1,Math.min(4,Number(cfg.width)||.6)),baseWidth=Math.max(.03,Math.min(24,audioApplyNumeric('web.width',widthBase,idx))),style=typeof getWebStyleProfile==='function'?getWebStyleProfile(cfg,baseWidth,Number(frameCtx.frame?.dpr)||1):{style:'web',width:baseWidth,alpha:.88,halo:Math.min(6,baseWidth*2.4)};
    const morphRec=pair.table._gpuMorphArcResource?.morphRec||(typeof currentGpuBezierResourceForFrame==='function'?currentGpuBezierResourceForFrame(frameCtx):(typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx.layerIndex):getSharedGpuMorphPathResource(frameCtx.layerIndex))),transition=owner?webRuntime.transitionByLayer.get(owner.id):null;
    const data={enabled:true,layerIndex:idx,paths:null,visualPaths:null,clipPath:null,corners:null,visualPathTables:null,persistentVectorRecord:null,pathBevel:null,pathRounding:null,animating:true,owner,cfg,transition,now,region:'inside',insideEnabled:true,outsideStraightEnabled:false,outsideArcEnabled:false,placementMode:['corners','selfIntersection','selfIntersectionCorridor'].includes(cfg.placementMode)?cfg.placementMode:'selfIntersection',oscillating:cfg.oscillating===true,oscillationStrength:Math.max(0,Math.min(100,Number(cfg.oscillationStrength)||10)),oscillationStrengthMultiplier:Math.max(.015625,Math.min(64,Number(cfg.oscillationStrengthMultiplier)||1)),oscillationMultiplier:Math.max(.015625,Math.min(64,Number(cfg.oscillationMultiplier)||1)),oscillationPhase:0,angleThreshold:threshold,spacing,depthPercent,depthMultiplier,jitterStrength,color,secondaryColor,width:style.width,renderWidth:style.width,threadAlpha:style.alpha,haloRadius:style.halo,style:style.style,dpr:Number(frameCtx.frame?.dpr)||1,gpuMorphWebNative:true,gpuMorphArcTable:pair.table,gpuWebCornerResource:pair.resource,gpuMorphResource:morphRec};
    if(data.oscillating){const cycleSec=typeof getTapMorphIntervalSec==='function'?getTapMorphIntervalSec(Number(state?.morph?.intervalSec)||5,'full'):(Number(state?.morph?.intervalSec)||5),cycleMs=Math.max(100,cycleSec*1000);data.oscillationPhase=((now%cycleMs)/cycleMs)*Math.PI*2*data.oscillationMultiplier;}frameCtx.webPrepared=data;frameCtx.webPreparedReady=true;gpuMorphWebBridgeStats.hits++;gpuMorphWebBridgeStats.cpuPathBuildsAvoided++;gpuMorphWebBridgeStats.cpuCornerScansAvoided+=morphRec?.segmentCount||0;gpuMorphWebBridgeStats.cpuPathTablesAvoided+=morphRec?.pathCount||0;gpuMorphWebBridgeStats.lastReason='gpu-web-topology-arc';return data;
}

window.__spiroGpuMorphWebBridgeStatus=()=>({...gpuMorphWebBridgeStats,corner:window.__spiroGpuWebCornerStatus?.()||null,renderer:window.__spiroGpuMorphWebStatus?.()||null,contract:'Somata 7.4.30 Morph Web consumes the shared retained Bézier/Arc resources. No renderer fallback to CPU/Canvas.'});
