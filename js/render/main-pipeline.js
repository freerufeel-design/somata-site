// SpiroStar v512 — Main Render Pipeline
// Extracted from legacy/app-c: frame preparation, morph providers, geometry/effect plans,
// render passes and final frame lifecycle. Keep UI/persistence out of the frame hot path.
window.__spiroRegisterModule?.('js/render/main-pipeline');


// Somata 7.2.8 — strict Full-WebGPU diagnostic mode; recoverable frame diagnostics are warnings.
// Spiral/Morph/Corridor must never hide a missing Full GPU path behind Canvas, WebGL,
// a reduced "Fast GPU" renderer, or pixels from the previous frame.  Contract failures
// are fail-visible and reported in DevTools so every missing path can be fixed explicitly.
const SOMATA_STRICT_FULL_GPU_DIAGNOSTICS=true;
const SOMATA_FULL_GPU_FRAME_FAULT_LIMIT=32;
const SOMATA_RECOVERABLE_GPU_CONTRACT_CODES=new Set(['STRICT_SPIRAL_CANVAS_PATH_TOUCHED','FINAL_FULL_GPU_PRESENT_FAILED']);
const somataFullGpuDiag={errors:0,warnings:0,last:null,lastAt:0,byCode:Object.create(null),lastLogAt:new Map()};
function isRecoverableGpuContractDiagnostic(code,details){
    const c=String(code||'');
    if(!SOMATA_RECOVERABLE_GPU_CONTRACT_CODES.has(c))return false;
    if(c==='STRICT_SPIRAL_CANVAS_PATH_TOUCHED')return true;
    // FINAL_FULL_GPU_PRESENT_FAILED is commonly a deliberate frame rejection while the strict
    // GPU graph is warming/re-ordering. Keep it red only when a renderer/device reports an
    // actual error/loss; a clean-but-unpresentable frame is diagnostic, not an exception.
    const final=details?.final||{},stroke=details?.stroke||{};
    return !final?.lastError&&!final?.lastInitError&&!stroke?.lastError&&!stroke?.lastInitError&&final?.lost!==true&&stroke?.lost!==true;
}
function somataGpuContractError(code,ctx=null,details=null){
    const frame=ctx?.frame||ctx||null,layerIndex=Number(ctx?.layerIndex);
    const payload={code:String(code||'GPU_CONTRACT_ERROR'),frameId:Number(ctx?.frameId||frame?.id)||0,layerIndex:Number.isFinite(layerIndex)?layerIndex:-1,strictSpiral:Boolean(ctx?.layer?isStrictSpiralWebGPUFrame?.(ctx):frame?.strictSpiralGpuPresentRequired),details:details||null};
    const recoverable=isRecoverableGpuContractDiagnostic(payload.code,payload.details);
    if(recoverable)somataFullGpuDiag.warnings++;else somataFullGpuDiag.errors++;
    somataFullGpuDiag.last=payload;somataFullGpuDiag.lastAt=performance.now();somataFullGpuDiag.byCode[payload.code]=(somataFullGpuDiag.byCode[payload.code]||0)+1;
    if(frame&&typeof frame==='object'){
        frame._strictSpiralGpuFrameIncomplete=true;frame._fullGpuFaultCount=(Number(frame._fullGpuFaultCount)||0)+1;
        const faults=frame._fullGpuFaults||(frame._fullGpuFaults=[]);faults.push(payload);
        if(faults.length>SOMATA_FULL_GPU_FRAME_FAULT_LIMIT)faults.splice(0,faults.length-SOMATA_FULL_GPU_FRAME_FAULT_LIMIT);
    }
    const key=`${payload.code}:${payload.layerIndex}`;const now=performance.now(),prev=somataFullGpuDiag.lastLogAt.get(key)||-1e9;
    const minLogGapMs=recoverable?5000:500;
    if(now-prev>minLogGapMs){somataFullGpuDiag.lastLogAt.set(key,now);(recoverable?console.warn:console.error)(`[Somata 7.3.9 FullGPU] ${payload.code}`,payload);}
    return false;
}
window.__somataFullGpuDiagnostics=()=>({strict:true,canvasFallbackAllowed:false,fastGpuAllowed:false,errors:somataFullGpuDiag.errors,warnings:somataFullGpuDiag.warnings,last:somataFullGpuDiag.last,lastAt:somataFullGpuDiag.lastAt,byCode:{...somataFullGpuDiag.byCode}});

// v198 — Architecture phase 2: explicit renderer stages.
// These functions intentionally preserve the exact v195 draw order. The goal is to
// make ownership visible before changing any rendering algorithm.
function prepareMainRenderFrame(renderFrame) {
    const renderStartedAt = renderFrame.now;
    // 6.8 iter14 — this is a per-frame latch, never persistent state. A previous Spiral
    // frame must not force GPU-only presentation policy onto a later non-Spiral frame.
    renderFrame.strictSpiralGpuPresentRequired=false;
    // A direct synchronous paint satisfies any queued invalidation without
    // cancelling the scheduler itself (its animation tasks may still be active).
    animationScheduler.consumeRenderRequest();
    beginFrameGeometryRuntime();
    if(typeof beginRenderConsumerDemandFrame==='function')beginRenderConsumerDemandFrame();
    beginLampAdaptiveFrame();
    refreshLayerLookup();
    effectCullStats.graffiti=0;effectCullStats.sweep=0;effectCullStats.web=0;
    
    const mainContainer = mainContainerEl;
    const { w, h, dpr } = ensureMainCanvasSize(mainContainer);
    renderFrame.w=w; renderFrame.h=h; renderFrame.dpr=dpr;
    const gpuBackendAllowed=(typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed());
    if(gpuBackendAllowed){
        LampGPURenderer.beginFrame(mainCanvas.width,mainCanvas.height,renderFrame.now);
        WebGPUStrokeRenderer.clearDeferredLayerScene?.();
    }
    const displayLayers=(typeof SpiroMorphController!=='undefined'&&typeof SpiroMorphController.getDisplayLayers==='function')
        ? SpiroMorphController.getDisplayLayers()
        : (state.layers||[]);
    // Iter19 — entering strict Spiral is asynchronous because the WebGPU device/pipelines may
    // still be compiling. Detect that intent before touching mainCanvas so the last valid frame
    // remains visible until the first retained-Bezier GPU frame is actually presented.
    const strictSpiralEntryIntent=hasStrictSpiralPresentationIntent(displayLayers);
    renderFrame.strictSpiralEntryIntent=strictSpiralEntryIntent;
    if(strictSpiralEntryIntent){
        try{WebGPUDeviceHub?.warmup?.();}catch(_){}
        try{WebGPUStrokeRenderer?.warmup?.();}catch(_){}
        try{WebGPUFinalCompositeRenderer?.warmup?.();}catch(_){}
        try{WebGPUSpiralBezierMorphRenderer?.warmup?.();}catch(_){}
    }
    // v429: Sprite/Moving Line own a transparent WebGPU overlay. Clear it exactly once
    // per main frame; it remains available even when another effect uses Canvas/Legacy.
    renderFrame.pathFxOverlayReady=gpuBackendAllowed&&WebGPUPathFxRenderer.beginOverlayFrame?.(renderFrame.id,mainCanvas.width,mainCanvas.height,displayLayers.some(l=>l?.visible!==false&&(l?.sprite?.enabled===true||l?.lineMotionFx?.enabled===true)))===true;
    renderFrame.particleOverlayReady=gpuBackendAllowed&&WebGPUParticleRenderer?.beginOverlayFrame?.(renderFrame.id,mainCanvas.width,mainCanvas.height,displayLayers.some(l=>l?.visible!==false&&normalizeParticleConfig(l?.particles).enabled===true))===true;
    if(gpuBackendAllowed)WebGPUGraffitiRibbonRenderer.beginOverlayFrame?.(renderFrame.id,mainCanvas.width,mainCanvas.height,displayLayers.some(l=>l?.visible!==false&&l?.lineProfileApplication==='graffiti'));
    // v514: start compiling the procedural Morph Graffiti pipeline before effect planning.
    // If it is not ready this frame, the exact compatibility path remains authoritative.
    try{if(gpuBackendAllowed&&displayLayers.some(l=>l?.visible!==false&&l?.lineProfileApplication==='graffiti'))WebGPUGraffitiMorphRenderer?.warmup?.();}catch(_){}
    
    const transparentDesktop = state.transparentDesktop === true;
    const presentationBgColor = transparentDesktop ? 'transparent' : state.bgColor;
    const bgCacheKey = `${transparentDesktop?'transparent':'opaque'}:${state.bgColor}`;
    if (renderPerf.lastBgColor !== bgCacheKey) {
        mainContainer.style.backgroundColor = presentationBgColor;
        renderPerf.lastBgColor = bgCacheKey;
    }
    const gridEl = gridPatternEl;
    const gridVisible = state.showGrid === true && !transparentDesktop;
    if (renderPerf.lastGridVisible !== gridVisible) {
        gridEl.classList.toggle('hidden', !gridVisible);
        renderPerf.lastGridVisible = gridVisible;
    }
    
    // Explicitly reset all volatile Canvas2D state each frame. This makes the
    // renderer recover cleanly if a previous heavy filter/transform frame was interrupted.
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.globalAlpha = 1;
    mainCtx.filter = 'none';
    mainCtx.shadowBlur = 0;
    mainCtx.setLineDash([]);
    // Iter19 — never expose the container background merely because strict WebGPU is warming.
    // This is presentation preservation, not mixed rendering: the preserved Canvas pixels are
    // from the previous completed frame and are never uploaded/composited into the strict Spiral
    // frame. Successful Final WebGPU presentation hides mainCanvas atomically.
    // 7.0.2 diagnostic policy: never preserve stale pixels. Full WebGPU either presents
    // the current frame or the frame is visibly absent and the precise GPU contract error is logged.
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    renderFrame.strictSpiralPreservedPreviousCanvas=false;
    mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mainCtx.save();
    renderFrame.canvasTransformSaved = true;
    
    const motionViewport=getMotionViewportTransform(w,h);
    renderFrame.motionPanX=motionViewport.panX;renderFrame.motionPanY=motionViewport.panY;renderFrame.motionRotationRad=motionViewport.rotationRad;
    mainCtx.translate(w / 2 + state.panX + motionViewport.panX, h / 2 + state.panY + motionViewport.panY);
    if(Math.abs(motionViewport.rotationRad)>1e-9)mainCtx.rotate(motionViewport.rotationRad);
    mainCtx.scale(state.zoom, state.zoom);
    
    // v191: the on-canvas status pill was removed in v172. Do not spend a
    // find()+gcd()+template-string allocation every animation frame when it is absent.
    if (infoSuborbitsEl) {
        const activeLayer = getRuntimeLayerById(state.activeLayerId);
        if (activeLayer) {
            const maxS = gcd(activeLayer.N, activeLayer.K);
            const currentS = (activeLayer.customSuborbits !== null && activeLayer.customSuborbits !== undefined)
                ? Math.max(1, Math.min(Number(activeLayer.customSuborbits) || 1, maxS))
                : maxS;
            const infoText = `Суборбиты: ${currentS} (из ${maxS}) | Вершин/орбиту: ${activeLayer.N / maxS}${runtimeState.morph.active ? (runtimeState.morph.paused ? ' | ◇ Морфинг ⏸' : ' | ◇ Морфинг') : ''}${runtimeState.minimalMorph?.active ? (runtimeState.minimalMorph.paused ? ' | ◆ Мини-морфинг ⏸' : ' | ◆ Мини-морфинг') : ''}${state.tunnel.active ? ' | ◎ Туннель' : ''}${runtimeState.projectMorph?.active ? ' | ◆ Проектный морфин' : ''}`;
            if (renderPerf.lastInfoText !== infoText) {
                infoSuborbitsEl.textContent = infoText;
                renderPerf.lastInfoText = infoText;
            }
        }
    }
    
    // Tunnel scale lattice is identical for every layer and for glow/main
    // passes, so calculate it once for the whole frame.
    // v522.10 — app-c (which owns the full Tunnel policy) is loaded after this module.
    // The scheduler can request a first frame before app-c has finished executing; do not turn
    // that harmless boot race into a recovered render exception. Tunnel is off by default,
    // so one neutral copy is the exact safe first-frame fallback; the next invalidation uses
    // the real getTunnelCopies() implementation.
    const tunnelCopies = (typeof getTunnelCopies==='function')
        ? getTunnelCopies()
        : [{scale:1,alpha:1,position:0,stepRatio:1}];
    renderFrame.tunnelCopies=tunnelCopies;
    let viewportOuterRadius = 0;
    if (state.tunnel.active) {
        const invZoom = 1 / Math.max(0.001, state.zoom);
        const originX = w / 2 + state.panX + (renderFrame.motionPanX||0);
        const originY = h / 2 + state.panY + (renderFrame.motionPanY||0);
        viewportOuterRadius = Math.max(
            Math.hypot(originX, originY),
            Math.hypot(w - originX, originY),
            Math.hypot(originX, h - originY),
            Math.hypot(w - originX, h - originY)
        ) * invZoom;
    }
    renderFrame.viewportOuterRadius=viewportOuterRadius;
    
    const morphProviders = prepareMorphProviderFrameSnapshot(renderFrame);
    const minimalTransition = morphProviders.orange.transitioning;
    const renderLayerCount = minimalTransition
        ? Math.max(morphProviders.orange.sourceLayers.length, morphProviders.orange.targetLayers.length)
        : displayLayers.length;
    const audioActive = Boolean(state.audioReactive.active);
    if (audioActive) ensureAudioRoutingState();
    const audioRotationOverride = Boolean(audioActive && hasActiveAudioRoute('layer.rotation'));
    renderFrame.minimalTransition=minimalTransition; // compatibility for non-geometry passes
    renderFrame.renderLayerCount=renderLayerCount;
    renderFrame.audioActive=audioActive;
    renderFrame.audioRotationOverride=audioRotationOverride;
    if(displayLayers.some(l=>l?.visible!==false&&(l?.lineMotionFx?.enabled===true||l?.sprite?.enabled===true)))ensureGpuPathFxAnimation();
    return renderFrame;
}

// v432: decide replacement at the actual render point, not only while the effect plan was
// prepared. Path FX initializes asynchronously; the old cached replaceBaseReady could stay false
// for the frame that first became GPU-ready and leave the ordinary stroke visible underneath.
function isPathFxBaseReplacementActive(frameCtx){
    // v522.2 visual contract: Base may disappear only after the replacement effect was
    // successfully prepared for THIS layer/frame. Renderer readiness alone is not proof that a
    // usable carrier/bind group/overlay exists; hiding Base earlier produced Glow-only frames.
    return frameCtx?._pathFxReplacementCommitted===true;
}

// v522.6 — the ordinary Point/main line is WebGPU-authoritative again.
// v522.4 fixed the real cross-frame commit leak that had made a successfully prepared GPU stroke
// disappear after canvas clear. Keep Canvas only as the existing transactional fallback when the
// GPU batch/direct renderer is unavailable or explicitly reports failure.
function shouldForceCanvasBaseStroke(frameCtx){
    return false;
}

// v522.15 — static Fill is GPU-first again.  v522.4 temporarily forced ordinary static
// Fill through Canvas2D while the line compositor was being repaired.  Once Base became
// GPU-resident that policy created a fragile hybrid (Canvas Fill + GPU line + final upload),
// and the Fill could be lost even though drawLayerFillInstances() had completed.  The native
// WebGPU fill mesh / resident fill-mask path is authoritative again; Canvas is fallback only.
function shouldForceCanvasStaticFill(frameCtx){
    return false;
}

// v522.15 — one frame-local Fill trace, retained after the frame for manual diagnostics.
// It records where Fill was requested, which topology was available, which backend actually
// handled it, and the first concrete reason when nothing reached a render backend.
const fillRuntimeDiagnostic={
    frameId:0,layerId:null,requested:false,handled:false,stage:'idle',backend:'none',reason:'',
    fillAlpha:0,fillContourCount:0,closedPathCount:0,openPathCount:0,hasClosedFillTopology:false,
    nativeCandidate:false,nativeComplete:false,gpuMaskEligible:false,lastUpdatedAt:0
};
let fillFailureSignature='';
function noteFillRuntime(frameCtx,patch={}){
    const c=frameCtx?._geometryContract||null,g=c?.geometry||null,mesh=frameCtx?._fillMeshShadow||null;
    Object.assign(fillRuntimeDiagnostic,{
        frameId:Number(frameCtx?.frameId||frameCtx?.frame?.id)||0,
        layerId:frameCtx?.layer?.id||null,
        requested:c?.fillRequested===true,
        fillAlpha:Number(c?.fillAlpha)||0,
        fillContourCount:Number(g?.fillContourCount)||0,
        closedPathCount:Number(g?.closedPathCount)||0,
        openPathCount:Number(g?.openPathCount)||0,
        hasClosedFillTopology:g?.hasClosedFillTopology===true,
        nativeComplete:mesh?.nativeComplete===true,
        gpuMaskEligible:c?.gpuMaskEligible===true,
        lastUpdatedAt:performance.now(),
        ...patch
    });
}
function noteFillFailureOnce(frameCtx,stage,reason){
    const msg=String(reason||'unknown Fill failure'),sig=`${frameCtx?.layer?.id||''}|${stage}|${msg}`;
    noteFillRuntime(frameCtx,{handled:false,stage:String(stage||'unknown'),backend:'none',reason:msg});
    if(sig!==fillFailureSignature){fillFailureSignature=sig;console.error(`[SpiroStar Fill] NOT DRAWN @ ${stage}: ${msg}`,{...fillRuntimeDiagnostic});}
}

// 7.2.3 GPU purity diagnostics. These messages describe requested GPU paths that were not
// silently replaced by Canvas. They are deduplicated so a persistent device/pipeline fault
// remains visible without flooding DevTools every animation frame.
const somataGpuDiagnosticSignatures=new Map();
const somataGpuRuntimeDiagnostic={last:null,lastAt:0};
function somataGpuDiagnosticError(feature,stage,reason,frameCtx=null,extra=null){
    const msg=String(reason||'GPU path unavailable'),key=`${feature}|${stage}`,sig=`${stage}|${msg}`,prev=somataGpuDiagnosticSignatures.get(key);
    if(prev===sig)return;somataGpuDiagnosticSignatures.set(key,sig);
    const payload={feature,stage,reason:msg,frameId:Number(frameCtx?.frameId||frameCtx?.frame?.id)||0,layerId:frameCtx?.layer?.id||null,canvasFallbackBlocked:true,...(extra||{})};
    somataGpuRuntimeDiagnostic.last=payload;somataGpuRuntimeDiagnostic.lastAt=performance.now();
    console.warn(`[Somata GPU diagnostic] ${feature}: ${stage} — ${msg}`,payload);
}
window.__somataGpuRuntimeDiagnostics=()=>({last:somataGpuRuntimeDiagnostic.last,lastAt:somataGpuRuntimeDiagnostic.lastAt});

// v522.13 — profile GPU diagnostics are stage-based and deduplicated.  We only print when an
// actual path falls off GPU (or a new reason appears), never once per animation frame.
const profileGpuPassDiagnostics={
    dash:{stage:'idle',reason:'',backend:'unknown',lastFailureAt:0,lastSuccessAt:0},
    graffiti:{stage:'idle',reason:'',backend:'unknown',lastFailureAt:0,lastSuccessAt:0}
};
const profileGpuFailureSignatures=new Map();
function noteProfileGpuFailure(kind,stage,reason,extra=null){
    const key=kind==='graffiti'?'graffiti':'dash',msg=String(reason||'unknown GPU failure'),sig=`${stage}|${msg}`,d=profileGpuPassDiagnostics[key];
    d.stage=String(stage||'unknown');d.reason=msg;d.backend='fallback/unavailable';d.lastFailureAt=performance.now();
    if(profileGpuFailureSignatures.get(key)!==sig){profileGpuFailureSignatures.set(key,sig);console.error(`[SpiroStar ${key==='graffiti'?'Graffiti':'Dash'} GPU] ERROR @ ${d.stage}: ${msg}`,{kind:key,stage:d.stage,reason:msg,...(extra||{})});}
}
function noteProfileGpuSuccess(kind,stage,backend,extra=null){
    const key=kind==='graffiti'?'graffiti':'dash',d=profileGpuPassDiagnostics[key];d.stage=String(stage||'draw');d.reason='';d.backend=String(backend||'gpu');d.lastSuccessAt=performance.now();
}
window.__spiroReportStrokeGraffitiGpuStatus=()=>{
    const dashRenderer=typeof WebGPUProfileMarkerRenderer!=='undefined'?WebGPUProfileMarkerRenderer.status?.():null;
    const graffitiRibbon=typeof WebGPUGraffitiRibbonRenderer!=='undefined'?WebGPUGraffitiRibbonRenderer.status?.():null;
    const graffitiMorph=typeof WebGPUGraffitiMorphRenderer!=='undefined'?WebGPUGraffitiMorphRenderer.status?.():null;
    const out={
        dash:{pass:{...profileGpuPassDiagnostics.dash},renderer:dashRenderer,processing:'CPU: arc-length marker-center preparation; GPU: upload + rasterization'},
        graffiti:{pass:{...profileGpuPassDiagnostics.graffiti},ribbon:graffitiRibbon,morph:graffitiMorph,processing:'Static/variable: CPU ribbon mesh -> WebGPU rasterization. Topology Morph fast path: GPU-native expansion/rasterization.'}
    };
    console.group('[SpiroStar Profile GPU] Штрих + Graffiti');console.log('Штрих',out.dash);console.log('Graffiti',out.graffiti);console.groupEnd();return out;
};
window.__spiroReportProfileGpuStatus=window.__spiroReportStrokeGraffitiGpuStatus;

// v522.12 — Sprite replacement is GPU-first.  Canvas is now a transactional fallback only.
// The previous v522.3 safety repair accidentally made the fallback authoritative forever:
// prepareLayerSpriteCanvasFallback() normally succeeds, so the WebGPU Path FX renderer was never
// reached despite the UI saying GPU.  Commit the replacement only after a GPU queue succeeds;
// if WebGPU is unavailable, keep the exact continuous-UV Canvas fallback for correctness.
function preflightLayerPathFxReplacement(frameCtx){
    frameCtx._pathFxReplacementCommitted=false;frameCtx._pathFxReplacementKind='';frameCtx._pathFxPrequeuedSprite=false;frameCtx._pathFxPrequeuedMotion=false;frameCtx._pathFxCanvasSprite=false;frameCtx._pathFxCanvasSpriteTable=null;
    const e=frameCtx?.effectsPlan||{},sprite=e.sprite,motion=e.motion;
    const overlayReady=frameCtx?.frame?.pathFxOverlayReady===true;
    const gpuReady=overlayReady&&typeof WebGPUPathFxRenderer!=='undefined'&&WebGPUPathFxRenderer.isReady?.();
    if(sprite?.enabled===true&&!lineSpritePlacementIsSparse(sprite?.cfg?.mode)){
        if(gpuReady){
            const motionCfg=motion?.enabled===true?motion.cfg:null;
            const ok=typeof queueLayerPathFxPass==='function'&&queueLayerPathFxPass(frameCtx,sprite,'sprite',motionCfg)===true;
            if(ok){frameCtx._pathFxReplacementCommitted=true;frameCtx._pathFxReplacementKind='sprite-gpu';frameCtx._pathFxPrequeuedSprite=true;if(motion?.enabled===true)frameCtx._pathFxPrequeuedMotion=true;return true;}
        }
        if(isStrictSpiralWebGPUFrame(frameCtx)){renderBackendTelemetry.mark('sprite','gpu','Spiral Sprite GPU-only warmup; Canvas fallback forbidden');try{requestMainCanvasRender?.();}catch(_){}return false;}
        const canvasReady=typeof prepareLayerSpriteCanvasFallback==='function'&&prepareLayerSpriteCanvasFallback(frameCtx,sprite)===true;
        if(canvasReady){frameCtx._pathFxReplacementCommitted=true;frameCtx._pathFxReplacementKind='sprite-canvas-fallback';frameCtx._pathFxCanvasSprite=true;return true;}
        return false;
    }
    if(motion?.enabled===true&&motion?.cfg?.replaceBase===true){
        if(gpuReady){
            const ok=typeof queueLayerPathFxPass==='function'&&queueLayerPathFxPass(frameCtx,motion,'motion',motion.cfg)===true;
            if(ok){frameCtx._pathFxReplacementCommitted=true;frameCtx._pathFxReplacementKind='motion';frameCtx._pathFxPrequeuedMotion=true;return true;}
        }
        if(!isStrictSpiralWebGPUFrame(frameCtx)&&typeof prepareLayerMotionCanvasFallback==='function'&&prepareLayerMotionCanvasFallback(frameCtx,motion)===true){
            frameCtx._pathFxReplacementCommitted=true;frameCtx._pathFxReplacementKind='motion-canvas-fallback';return true;
        }
    }
    return false;
}

// v335 — prepare compatible non-Corridor stroke surfaces in one WebGPU command buffer; direct Layer Scene presentation defers submission to the frame coordinator.
// The surfaces are composited later at their historical pass positions, so Fill, geometry
// circles and destination-over Outline preserve the exact Canvas ordering.
function prepareLayerStrokeWebGPUBatch(frameCtx){
    if(typeof somataCpuBackendForced==='function'&&somataCpuBackendForced())return null;
    frameCtx._webgpuStrokeBatch=null;frameCtx._webgpuFillPrepared=null;frameCtx._nativeFillMeshCandidate=null;frameCtx._topologyMorphGpuNative=false;
    const strictSpiralBatch=isStrictSpiralWebGPUFrame(frameCtx);
    const pathFxNeeded=frameCtx?.effectsPlan?.motion?.enabled===true||frameCtx?.effectsPlan?.sprite?.enabled===true;
    if(!frameCtx?.prepared||state.showRoundingGuides||frameCtx.geometryPlan?.kind==='lightning'||(!frameCtx.lineDisplayEnabled&&!pathFxNeeded))return null;
    // v522.16 — topology Morph owns a dedicated GPU segment renderer. Do not eagerly record
    // the interpolated CPU path into the legacy stroke batch: that O(points) recording was the
    // main-thread bottleneck the shared GPU Morph/Arc resource was created to remove.
    // Iter36 — static Spiral has one authoritative raster path: the ordinary retained-cubic
    // WebGPU layer batch. Corridor already proves this exact command representation, and using
    // the same batch for static Closed/Open/profile geometry removes the second presentation
    // branch that could leave a valid carrier with no visible Base. The dedicated renderer is
    // reserved for an ACTIVE Spiral Morph, where it is needed for GPU interpolation.
    const hiddenGraffitiCarrier=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
    const hiddenGraffitiMorphCarrier=frameCtx.morphFrameActive===true&&hiddenGraffitiCarrier;
    const spiralBezierNative=frameCtx.morphFrameActive===true&&typeof WebGPUSpiralBezierMorphRenderer!=='undefined'&&
        (WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'base')||(hiddenGraffitiMorphCarrier&&WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'glow'))) &&
        !isPathFxBaseReplacementActive(frameCtx);
    if(spiralBezierNative){frameCtx._spiralBezierMorphGpuNative=true;WebGPUSpiralBezierMorphRenderer.warmup?.();return null;}
    const topologyNative=!strictSpiralBatch&&typeof WebGPUTopologyMorphBaseRenderer!=='undefined'&&WebGPUTopologyMorphBaseRenderer.isEligible?.(frameCtx,'base')&&!isPathFxBaseReplacementActive(frameCtx);
    if(topologyNative){frameCtx._topologyMorphGpuNative=true;WebGPUTopologyMorphBaseRenderer.warmup?.();return null;}
    const greenProjectNative=!strictSpiralBatch&&typeof WebGPUGreenProjectMorphRenderer!=='undefined'&&WebGPUGreenProjectMorphRenderer.isEligible?.(frameCtx)&&!isPathFxBaseReplacementActive(frameCtx);
    if(greenProjectNative){WebGPUGreenProjectMorphRenderer.warmup?.();return null;}
    if(state.tunnel?.active===true)return null;
    WebGPUStrokeRenderer.warmup();if(!WebGPUStrokeRenderer.isReady())return null;
    const commands=getFrameGLStrokeCommands(frameCtx,hiddenGraffitiCarrier);if(!commands?.length)return null;
    const specs=[];const profileReplacesCarrier=frameCtx.lineProfileStrokeOnly===true,markerProfile=profileReplacesCarrier&&frameCtx.lineProfileApplication==='stroke';const glow=frameCtx.effectsPlan?.glow;if(glow?.enabled&&!profileReplacesCarrier)specs.push({role:'glow',mode:'glow',radiusPx:Math.max(.5,glow.amount*.55*frameCtx.frame.dpr),alphaScale:glow.compositeAlpha,composite:'source-over'});
    const pathFxReplace=isPathFxBaseReplacementActive(frameCtx),motionReplace=pathFxReplace&&frameCtx.effectsPlan?.motion?.enabled===true&&frameCtx.effectsPlan?.motion?.cfg?.replaceBase===true,spriteReplace=pathFxReplace&&frameCtx.effectsPlan?.sprite?.enabled===true&&!lineSpritePlacementIsSparse(frameCtx.effectsPlan?.sprite?.cfg?.mode),baseHiddenForProfile=frameCtx.lineProfileStrokeOnly===true;
    const forceCanvasBase=shouldForceCanvasBaseStroke(frameCtx);
    if(!forceCanvasBase)specs.push({role:'base',mode:'base',alphaScale:(motionReplace||spriteReplace||baseHiddenForProfile)?0:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1))),composite:'source-over'});
    const outline=frameCtx.effectsPlan?.outline;let outlineMode='outer';
    if(outline?.enabled&&!outline.graffiti){outlineMode=['outer','inner','median'].includes(outline.mode)?outline.mode:'outer';const outerAdd=Math.max(0,Number(outline.outerAdd)||0),coreInset=Math.max(0,Number(outline.coreInset)||0);if(!markerProfile){specs.push({role:'outline',mode:'outline',extraLocal:outerAdd,baseLineWidth:outline.baseLineWidth,colorOverride:outline.color,alphaScale:1,composite:outlineMode==='outer'?'destination-over':'source-over'});if(coreInset>0)specs.push({role:'core',mode:'coreInset',extraLocal:coreInset,baseLineWidth:outline.baseLineWidth,alphaScale:1,composite:'source-over'});}}
    const fillContract=getLayerGeometryContract(frameCtx),forceCanvasStaticFill=shouldForceCanvasStaticFill(frameCtx);
    // v522.7 — when static Fill is intentionally Canvas-authoritative, do not also bake it
    // into the Layer Scene. This lets Canvas supply the Fill as the final scene input while
    // Base/Glow/Outline stay resident in the deferred WebGPU layer texture above it.
    const nativeFillCandidate=!forceCanvasStaticFill&&fillContract?.fillRequested===true&&FillMeshPreparer.canUseNative(frameCtx);
    frameCtx._nativeFillMeshCandidate=nativeFillCandidate?frameCtx._fillMeshShadow:null;
    const fillPrepared=(forceCanvasStaticFill||(strictSpiralBatch&&!nativeFillCandidate))?null:(nativeFillCandidate?{mask:null,fillStyle:fillContract.fillStyle,empty:false,authoritative:false,nativeMesh:true}:prepareLayerFillMaskGPU(frameCtx));if(fillPrepared)frameCtx._webgpuFillPrepared=fillPrepared;
    const singleLayerFrame=frameCtx.layerIndex===0&&frameCtx.frame?.renderLayerCount===1;
    const includeOutline=Boolean(outline?.enabled&&!outline.graffiti&&!markerProfile&&(outlineMode!=='outer'||singleLayerFrame));
    const includeCore=Boolean(outline?.enabled&&!outline.graffiti&&!markerProfile&&Math.max(0,Number(outline.coreInset)||0)>0);
    const sceneFillMask=fillPrepared?.authoritative===true?fillPrepared.mask:null;
    const sceneNativeFill=nativeFillCandidate&&FillGPURenderer.canEncodeMeshToTexture(frameCtx,frameCtx._nativeFillMeshCandidate)?frameCtx._nativeFillMeshCandidate:null;
    const sceneOpt={uniformKey:String(frameCtx.layer?.id||`layer-${frameCtx.layerIndex}`),fillMask:sceneFillMask,fillStyle:fillPrepared?.fillStyle||fillContract?.fillStyle||null,nativeFillMesh:sceneNativeFill,nativeFillFrameCtx:sceneNativeFill?frameCtx:null,includeOutline,includeCore,outlineBehind:outlineMode==='outer'};
    const batch=WebGPUStrokeRenderer.renderLayerBatch(commands,specs,sceneOpt);if(batch?.roles?.size>=1)frameCtx._webgpuStrokeBatch=batch;return frameCtx._webgpuStrokeBatch;
}

// v437 — dash-marker effects use the marker geometry itself. Glow/Outline must not
// be generated from the hidden continuous carrier line.
function tryRenderStrokeMarkerEffectGPU(frameCtx,opts={}){
    const profile=frameCtx?.effectsPlan?.profile,prepared=profile?.prepared;
    if(!profile?.enabled||profile.application!=='stroke'||!['slash','square','circle','cross'].includes(prepared?.type))return false;
    const strictArc=isStrictSpiralWebGPUFrame(frameCtx)&&prepared?.gpuArcNative===true;
    const {layer,visibleInstances,baseAlpha}=frameCtx;const alpha=Number.isFinite(Number(opts.alpha))?Math.max(0,Math.min(1,Number(opts.alpha))):baseAlpha;
    // Iter17: strict Spiral marker effects are allowed only inside the resident Layer Scene.
    // Never invoke the legacy hidden-WebGPU-canvas -> Canvas2D composite bridge here.
    if(strictArc){
        WebGPUProfileArcMarkerRenderer.warmup?.();const scene=frameCtx.frame?.gpuLayerSceneDeferred?WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId):null;if(!scene?.texture||!WebGPUProfileArcMarkerRenderer.isReady?.())return false;
        mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);let rec=null;try{rec=WebGPUProfileArcMarkerRenderer.encodeToLayerScene(scene.texture,prepared,layer,profile.tunnelActive?alpha:alpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,frameCtx,opts,profile.tunnelActive?visibleInstances.copies:null,profile.tunnelActive?visibleInstances.alphas:null,profile.footprint);}finally{mainCtx.restore();}
        if(rec?.handled){if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,opts.mode==='glow'?12:18,rec.commandBuffer,`profile-bezier-arc-${opts.mode||'effect'}`,rec.onSubmitted);noteProfileGpuSuccess('dash',`retained Bézier Arc marker ${opts.mode||'effect'}`,'webgpu-layer-scene');return true;}
        const st=WebGPUProfileArcMarkerRenderer.status?.()||{};noteProfileGpuFailure('dash',`retained Bézier Arc marker ${opts.mode||'effect'}`,st.lastError||'strict Spiral marker Arc encode unavailable',{renderer:st});return false;
    }
    if(!WebGPUProfileMarkerRenderer.isReady()){const st=WebGPUProfileMarkerRenderer.status?.()||{};noteProfileGpuFailure('dash',`marker ${opts.mode||'effect'} ready`,st.lastError||st.diagnostic?.reason||(st.initializing?'GPU marker pipeline warming':'GPU marker pipeline unavailable'),{renderer:st});return false;}
    mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);let ok=false;
    try{
        if(profile.tunnelActive)ok=WebGPUProfileMarkerRenderer.renderCorridor(prepared.table,layer,alpha,mainCtx,prepared,visibleInstances.copies,visibleInstances.alphas,frameCtx,profile.footprint,opts);
        else ok=WebGPUProfileMarkerRenderer.render(prepared.table,layer,alpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,prepared,opts);
    }finally{mainCtx.restore();}
    if(ok)noteProfileGpuSuccess('dash',`marker ${opts.mode||'effect'}`, 'webgpu');
    else{const st=WebGPUProfileMarkerRenderer.status?.()||{};noteProfileGpuFailure('dash',`marker ${opts.mode||'effect'}`,st.lastError||st.diagnostic?.reason||'GPU marker effect returned false',{renderer:st});}
    return ok;
}

// Graffiti Glow is generated from the exact GPU ribbon mask inside renderLayerProfilePass().
// The historical thin carrier helper was removed so it cannot silently return.

// v201 — Layer passes consume pre-resolved EffectProvider plans.
function renderLayerGlowPass(frameCtx) {
    const effect=frameCtx.effectsPlan?.glow;
    const strictSpiralGlow=isStrictSpiralWebGPUFrame(frameCtx);
    if(!effect?.enabled)return;
    const graffitiCarrierGlow=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
    // Graffiti Glow is owned by the Graffiti profile pass, not by the hidden carrier.  The
    // profile pass has the exact GPU ribbon geometry (including nib angle, width variation and
    // joins), rasterizes that ribbon to a GPU mask and blurs it in WebGPU before drawing core.
    // Never substitute the old thin centreline halo when contour Glow is unavailable.
    if(frameCtx.lineProfileApplication==='graffiti'){frameCtx._graffitiContourGlowPending=true;renderBackendTelemetry.mark('glow','gpu','Graffiti contour Glow deferred to exact GPU ribbon');return;}
    // Active Spiral Morph already has the authoritative retained current-cubic rail. Do not
    // ask the generic dynamic Corridor master recorder to reconstruct a hidden Graffiti carrier.
    // Static Corridor still uses the retained-cubic master path below.
    if(!strictSpiralGlow&&!(graffitiCarrierGlow&&frameCtx.morphFrameActive===true)&&canUseGpuOnlyCorridorLayerScene(frameCtx,graffitiCarrierGlow)){
        const residentBeforeGlow=getResidentGpuLayerScene(frameCtx),sceneAlreadyActive=Boolean(residentBeforeGlow?.texture);
        const rec=encodeGpuOnlyCorridorLayerRole(frameCtx,'glow',{effectMode:'glow',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alphaScale:effect.compositeAlpha,composite:'source-over'},!sceneAlreadyActive,graffitiCarrierGlow);
        if(rec?.handled&&rec.commandBuffer){
            const accepted=sceneAlreadyActive?queueLayerSceneEffectCommand(frameCtx,3,rec.commandBuffer,'corridor-glow'):WebGPUStrokeRenderer.deferExternalLayerScene?.(rec.commandBuffer,frameCtx.frameId,'corridor-glow')===true;
            if(accepted){frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=false;frameCtx._corridorLayerSceneActive=true;renderBackendTelemetry.mark('glow','gpu',sceneAlreadyActive?'GPU Corridor joined resident Layer Scene':'GPU Corridor Layer Scene');return;}
        }
    }
    // v531 — common dynamic Morph scenes do not need two GPU submissions just because Glow
    // and Base are separate logical passes. If no Fill/Web underlay must be inserted between
    // them, fuse both analytic strokes on the Morph renderer and mark Base as already committed.
    const fuseContract=getLayerGeometryContract(frameCtx),canFuseMorphGlowBase=frameCtx.lineDisplayEnabled===true&&frameCtx.lineProfileStrokeOnly!==true&&fuseContract?.fillRequested!==true&&frameCtx.effectsPlan?.web?.enabled!==true&&!(typeof isPathFxBaseReplacementActive==='function'&&isPathFxBaseReplacementActive(frameCtx))&&!(typeof spiroIsCompatibilityForced==='function'&&spiroIsCompatibilityForced('geometry'))&&!shouldForceCanvasBaseStroke(frameCtx);
    // Iter36 — static Spiral Glow/Base is already encoded into the internal retained-cubic
    // LayerScene batch. Do not bypass that proven static scene through the Morph renderer.
    // Base will publish the combined scene at its normal pass position.
    if(!frameCtx.morphFrameActive&&strictSpiralGlow&&frameCtx._webgpuStrokeBatch?.sceneCombined&&frameCtx._webgpuStrokeBatch?.roles?.has?.('glow')){renderBackendTelemetry.mark('glow','gpu','static Spiral retained-Bézier Layer Scene');return;}
    if(strictSpiralGlow&&canFuseMorphGlowBase&&typeof WebGPUSpiralBezierMorphRenderer!=='undefined'&&WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'glow')&&WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'base')){
        const ok=(()=>{const route=resolveGpuSpiralBezierSceneRoute(frameCtx);return (route.deferLayerScene||route.deferFrameScene)&&WebGPUSpiralBezierMorphRenderer.renderGlowAndBase?.(frameCtx,mainCtx,{mode:'glow-base',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),glowAlphaScale:effect.compositeAlpha,baseAlphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1))),deferFrameScene:route.deferFrameScene,deferLayerScene:route.deferLayerScene,layerScenePhase:3,layerSceneLabel:'spiral-glow-base'})===true;})();
        if(ok){frameCtx._baseStrokeCommitted=true;frameCtx._fusedMorphBackend='spiral-bezier';renderBackendTelemetry.mark('glow','gpu','fused retained-Spiral Glow+Base');return;}
    }
    if(!strictSpiralGlow&&canFuseMorphGlowBase&&typeof WebGPUGreenProjectMorphRenderer!=='undefined'&&WebGPUGreenProjectMorphRenderer.isEligible?.(frameCtx)&&frameCtx.geometryPlan?.kind!=='green-fade'){
        const ok=WebGPUGreenProjectMorphRenderer.renderGlowAndBase?.(frameCtx,mainCtx,{radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),glowAlphaScale:effect.compositeAlpha,baseAlphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1)))})===true;
        if(ok){frameCtx._baseStrokeCommitted=true;frameCtx._fusedMorphBackend='green';renderBackendTelemetry.mark('glow','gpu','fused Green Morph Glow+Base');return;}
    }
    if(!strictSpiralGlow&&canFuseMorphGlowBase&&typeof WebGPUTopologyMorphBaseRenderer!=='undefined'&&WebGPUTopologyMorphBaseRenderer.isEligible?.(frameCtx,'glow')&&WebGPUTopologyMorphBaseRenderer.isEligible?.(frameCtx,'base')){
        const ok=WebGPUTopologyMorphBaseRenderer.renderGlowAndBase?.(frameCtx,mainCtx,{radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),glowAlphaScale:effect.compositeAlpha,baseAlphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1)))})===true;
        if(ok){frameCtx._baseStrokeCommitted=true;frameCtx._fusedMorphBackend='topology';renderBackendTelemetry.mark('glow','gpu','fused Topology Morph Glow+Base');return;}
    }
    if(strictSpiralGlow&&typeof WebGPUSpiralBezierMorphRenderer!=='undefined'&&WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'glow')){
        const route=resolveGpuSpiralBezierSceneRoute(frameCtx,graffitiCarrierGlow),ok=(route.deferFrameScene||route.deferLayerScene)&&WebGPUSpiralBezierMorphRenderer.render(frameCtx,mainCtx,{mode:'glow',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alphaScale:effect.compositeAlpha,deferFrameScene:route.deferFrameScene,deferLayerScene:route.deferLayerScene,layerScenePhase:3,layerSceneLabel:'spiral-glow'});
        if(ok){renderBackendTelemetry.mark('glow','gpu','GPU-native retained-Spiral glow');return;}
    }
    // v524 — green playlist Morph has its own GPU-resident source/target segment pairs.
    // In Spiral transitions this avoids the legacy variable-width Canvas stroke loop.
    if(!strictSpiralGlow&&typeof WebGPUGreenProjectMorphRenderer!=='undefined'&&WebGPUGreenProjectMorphRenderer.isEligible?.(frameCtx)){
        const ok=WebGPUGreenProjectMorphRenderer.render(frameCtx,mainCtx,{mode:'glow',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alphaScale:effect.compositeAlpha});
        if(ok){renderBackendTelemetry.mark('glow','gpu','GPU-native green project Morph glow');return;}
    }
    // v522.16 — topology Morph glow reads the GPU morph segment buffer directly. This avoids
    // getFrameGLStrokeCommands(), which otherwise rebuilds the whole interpolated path on CPU.
    if(!strictSpiralGlow&&typeof WebGPUTopologyMorphBaseRenderer!=='undefined'&&WebGPUTopologyMorphBaseRenderer.isEligible?.(frameCtx,'glow')){
        const ok=WebGPUTopologyMorphBaseRenderer.render(frameCtx,mainCtx,{mode:'glow',radiusPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alphaScale:effect.compositeAlpha});
        if(ok){renderBackendTelemetry.mark('glow','gpu','GPU-native topology Morph glow');return;}
    }
    // 6.8 iter12 strict Spiral: from here down the legacy glow paths may composite an
    // offscreen GPU texture through Canvas2D or use Canvas blur. Never cross that boundary.
    // A combined static Layer Scene already contains Glow and will be deferred by Base.
    if(strictSpiralGlow){
        if(frameCtx._webgpuStrokeBatch?.sceneCombined&&frameCtx._webgpuStrokeBatch?.roles?.has?.('glow')){renderBackendTelemetry.mark('glow','gpu','strict Spiral resident Layer Scene');return;}
        renderBackendTelemetry.mark('glow','gpu','strict Spiral GPU-only warmup; Canvas presentation forbidden');
        somataGpuContractError('SPIRAL_GLOW_GPU_UNAVAILABLE',frameCtx,{morphFrameActive:frameCtx.morphFrameActive===true,hiddenGraffitiCarrier:graffitiCarrierGlow,batchRoles:frameCtx._webgpuStrokeBatch?.roles?[...frameCtx._webgpuStrokeBatch.roles]:[],spiralReason:WebGPUSpiralBezierMorphRenderer?.reason?.(frameCtx,'glow')||null,layerSceneEligible:canUseGpuSpiralBezierLayerScene(frameCtx,graffitiCarrierGlow),spiral:WebGPUSpiralBezierMorphRenderer?.status?.()||null,stroke:WebGPUStrokeRenderer?.status?.()||null});
        try{WebGPUStrokeRenderer?.warmup?.();WebGPUSpiralBezierMorphRenderer?.warmup?.();requestMainCanvasRender?.();}catch(_){}
        return;
    }
    // Graffiti contour Glow returned above and is encoded beside the exact ribbon in renderLayerProfilePass().
    if(frameCtx.lineProfileStrokeOnly&&frameCtx.lineProfileApplication==='stroke'){
        const ok=tryRenderStrokeMarkerEffectGPU(frameCtx,{mode:'glow',extraPx:Math.max(.5,effect.amount*.55*frameCtx.frame.dpr),alpha:effect.compositeAlpha,composite:'source-over'});
        if(ok){renderBackendTelemetry.mark('glow','gpu','GPU marker glow');return;}
    }
    if(frameCtx._webgpuStrokeBatch?.sceneCombined&&frameCtx._webgpuStrokeBatch?.roles?.has?.('glow')){renderBackendTelemetry.mark('glow','gpu','Layer Scene');return;}
    if(frameCtx._webgpuStrokeBatch?.roles?.has?.('glow')&&WebGPUStrokeRenderer.compositeLayerBatch(frameCtx._webgpuStrokeBatch,'glow',mainCtx,'source-over')){renderBackendTelemetry.mark('glow','gpu','WebGPU stroke batch');return;}
    const {layer,drawLayerInstances}=frameCtx;
    const {w,h,dpr}=frameCtx.frame;
    // v294: ordinary and spiral line glow share the analytic WebGL path. Spiral
    // variable width is already encoded into the recorded per-segment line widths.
    if((typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed())&&!frameCtx.lineProfileStrokeOnly&&!state.showRoundingGuides&&LineEffectsGPURenderer.isAvailable()){
        const gpuOpt={effectMode:'glow',radiusPx:Math.max(.5,effect.amount*.55*dpr),alphaScale:effect.compositeAlpha,composite:'source-over'};
        if(tryRenderCorridorLineEffectGPU(frameCtx,gpuOpt)){renderBackendTelemetry.mark('glow','gpu','GPU Corridor glow');return;}
        const commands=getFrameGLStrokeCommands(frameCtx);
        if(commands&&LineEffectsGPURenderer.render(commands,mainCtx,{mode:'glow',radiusPx:gpuOpt.radiusPx,alphaScale:gpuOpt.alphaScale,composite:'source-over'})){renderBackendTelemetry.mark('glow','gpu','analytic GPU glow');return;}
    }
    renderBackendTelemetry.mark('glow','canvas','Canvas2D blur fallback',true);
    const tunnelGlowScale=effect.tunnelGlowScale;
    const gw=Math.max(1,Math.round(mainCanvas.width*tunnelGlowScale));
    const gh=Math.max(1,Math.round(mainCanvas.height*tunnelGlowScale));
    const useReducedTunnelGlow=effect.tunnelActive&&tunnelGlowScale<.999;
    const staticCacheEligible=!effect.tunnelActive&&!frameCtx.geometryPlan?.dynamic&&!frameCtx.frame?.audioActive;
    let glowCacheRec=null,glowCacheKey='';
    if(staticCacheEligible){
        const gd=frameCtx.staticDrawData||{};
        glowCacheKey=[mainCanvas.width,mainCanvas.height,dpr,gd.geometryKey||'',gd.roundedKey||'',effect.amount.toFixed(4),effect.compositeAlpha.toFixed(5),effect.panX.toFixed(3),effect.panY.toFixed(3),effect.zoom.toFixed(6),Number(effect.rotationRad||0).toFixed(6),Number(frameCtx.strokeWidth).toFixed(4),Number(frameCtx.combinedScale).toFixed(6),Number(frameCtx.combinedRotationOffset).toFixed(5),frameCtx.lineProfileStrokeOnly?1:0,layer.strokeColor||'',layer.fillColor||'',Number(frameCtx.baseAlpha).toFixed(5)].join('|');
        glowCacheRec=acquireStaticGlowRecord(layer,mainCanvas.width,mainCanvas.height);
        if(glowCacheRec?.key===glowCacheKey){mainCtx.save();mainCtx.setTransform(1,0,0,1,0,0);mainCtx.globalAlpha=1;mainCtx.filter='none';mainCtx.drawImage(glowCacheRec.canvas,0,0);mainCtx.restore();staticGlowCacheStats.hits++;return;}
    }
    ensureGlowCanvasSize(gw,gh,useReducedTunnelGlow);
    glowCtx.setTransform(1,0,0,1,0,0);glowCtx.globalAlpha=1;glowCtx.filter='none';glowCtx.clearRect(0,0,gw,gh);
    glowCtx.save();
    const glowDpr=dpr*tunnelGlowScale;
    glowCtx.setTransform(glowDpr,0,0,glowDpr,0,0);
    glowCtx.translate(w/2+effect.panX,h/2+effect.panY);if(Math.abs(Number(effect.rotationRad)||0)>1e-9)glowCtx.rotate(Number(effect.rotationRad)||0);glowCtx.scale(effect.zoom,effect.zoom);
    glowCtx.lineWidth=mainCtx.lineWidth;glowCtx.strokeStyle=layer.strokeColor||'#ffffff';glowCtx.fillStyle=layer.fillColor||'transparent';glowCtx.globalAlpha=1;glowCtx.shadowBlur=0;
    drawLayerInstances(glowCtx);glowCtx.restore();
    mainCtx.save();mainCtx.setTransform(1,0,0,1,0,0);mainCtx.globalAlpha=effect.compositeAlpha;
    if(useReducedTunnelGlow&&glowBlurCtx){
        glowBlurCtx.setTransform(1,0,0,1,0,0);glowBlurCtx.globalAlpha=1;glowBlurCtx.globalCompositeOperation='source-over';glowBlurCtx.filter='none';glowBlurCtx.clearRect(0,0,gw,gh);
        glowBlurCtx.filter=`blur(${Math.max(.5,effect.amount*.55)*glowDpr}px)`;glowBlurCtx.drawImage(glowCanvas,0,0);glowBlurCtx.filter='none';
        const prevSmooth=mainCtx.imageSmoothingEnabled;mainCtx.imageSmoothingEnabled=true;mainCtx.drawImage(glowBlurCanvas,0,0,gw,gh,0,0,mainCanvas.width,mainCanvas.height);mainCtx.imageSmoothingEnabled=prevSmooth;
    }else if(glowCacheRec){
        const gc=glowCacheRec.ctx;gc.setTransform(1,0,0,1,0,0);gc.globalCompositeOperation='source-over';gc.globalAlpha=effect.compositeAlpha;gc.filter='none';gc.clearRect(0,0,glowCacheRec.w,glowCacheRec.h);gc.filter=`blur(${Math.max(.5,effect.amount*.55)*dpr}px)`;gc.drawImage(glowCanvas,0,0);gc.filter='none';gc.globalAlpha=1;glowCacheRec.key=glowCacheKey;staticGlowCacheStats.builds++;
        mainCtx.globalAlpha=1;mainCtx.filter='none';mainCtx.drawImage(glowCacheRec.canvas,0,0);
    }else{
        mainCtx.filter=`blur(${Math.max(.5,effect.amount*.55)*dpr}px)`;mainCtx.drawImage(glowCanvas,0,0);
    }
    mainCtx.restore();
}

function distanceOriginToSegment(a,b){
    const ax=Number(a?.x)||0,ay=Number(a?.y)||0,bx=Number(b?.x)||0,by=Number(b?.y)||0;
    const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
    if(den<=1e-12)return Math.hypot(ax,ay);
    const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den));
    return Math.hypot(ax+dx*t,ay+dy*t);
}
function solveCircle3x3(m,b){
    const a=[m[0].slice(),m[1].slice(),m[2].slice()],v=b.slice();
    for(let c=0;c<3;c++){
        let pivot=c;for(let r=c+1;r<3;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;
        if(Math.abs(a[pivot][c])<1e-10)return null;
        if(pivot!==c){[a[c],a[pivot]]=[a[pivot],a[c]];[v[c],v[pivot]]=[v[pivot],v[c]];}
        const div=a[c][c];for(let j=c;j<3;j++)a[c][j]/=div;v[c]/=div;
        for(let r=0;r<3;r++){if(r===c)continue;const f=a[r][c];if(Math.abs(f)<1e-14)continue;for(let j=c;j<3;j++)a[r][j]-=f*a[c][j];v[r]-=f*v[c];}
    }
    return v;
}
function fitCircleThroughKeyPoints(points){
    if(!Array.isArray(points)||points.length<3){
        const r=points?.length?points.reduce((sum,p)=>sum+Math.hypot(Number(p?.x)||0,Number(p?.y)||0),0)/points.length:0;
        return r>0?{x:0,y:0,r}:null;
    }
    let sxx=0,sxy=0,sx=0,syy=0,sy=0,n=0,bx=0,by=0,bc=0;
    for(const p of points){const x=Number(p?.x)||0,y=Number(p?.y)||0,q=x*x+y*y;const ax=2*x,ay=2*y;sxx+=ax*ax;sxy+=ax*ay;sx+=ax;syy+=ay*ay;sy+=ay;n++;bx+=ax*q;by+=ay*q;bc+=q;}
    const sol=solveCircle3x3([[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]],[bx,by,bc]);
    if(!sol)return null;const [cx,cy,c]=sol,r2=cx*cx+cy*cy+c;if(!(r2>1e-9))return null;return{x:cx,y:cy,r:Math.sqrt(r2)};
}
function computeLayerGeometryCircles(paths,cfg){
    const all=[],keys=[];let outer=0,inner=Infinity;
    for(const path of paths||[]){
        const pts=path?.points||[],flags=path?.cornerFlags||[];if(!pts.length)continue;
        for(let i=0;i<pts.length;i++){const p=pts[i],r=Math.hypot(Number(p?.x)||0,Number(p?.y)||0);outer=Math.max(outer,r);all.push(p);if(flags[i])keys.push(p);}
        for(let i=0;i<pts.length-1;i++)inner=Math.min(inner,distanceOriginToSegment(pts[i],pts[i+1]));
        if(path.closed&&pts.length>1)inner=Math.min(inner,distanceOriginToSegment(pts[pts.length-1],pts[0]));
    }
    if(!all.length)return[];if(!Number.isFinite(inner))inner=Math.min(...all.map(p=>Math.hypot(Number(p?.x)||0,Number(p?.y)||0)));
    const out=[];
    if(cfg.circumscribed===true&&outer>0)out.push({kind:'circumscribed',x:0,y:0,r:outer});
    if(cfg.inscribed===true&&inner>0)out.push({kind:'inscribed',x:0,y:0,r:inner});
    if(cfg.median===true&&outer>0&&inner>0)out.push({kind:'median',x:0,y:0,r:(outer+inner)/2});
    if(cfg.keyPoints===true){
        const source=keys.length>=3?keys:all;const fitted=fitCircleThroughKeyPoints(source);if(fitted)out.push({kind:'keyPoints',...fitted});
    }
    return out;
}
function buildGeometryCircleGPUCommands(frameCtx,circles){
    if(!GeometryGPURenderer.isAvailable()||!circles?.length)return null;
    const layer=frameCtx.layer,copies=frameCtx.visibleInstances?.copies||[{scale:1}],alphas=frameCtx.visibleInstances?.alphas||[1];
    const rec=createGeometryGLRecordingContext(mainCtx);rec.__suppressFill=true;
    try{
        for(let i=0;i<copies.length;i++){
            const copy=copies[i],alpha=Number(alphas[i]??1);if(alpha<=.001)continue;
            rec.save();
            if(state.tunnel.active){applyMotionTunnelLag(rec,copy,frameCtx.layer);rec.scale(Number(copy?.scale)||1,Number(copy?.scale)||1);}
            applyLayerFrameEffectTransform(rec,frameCtx);
            rec.globalAlpha=Math.max(0,Math.min(1,frameCtx.baseAlpha*alpha));
            rec.strokeStyle=getTunnelCopyColor(layer.strokeColor||'#ffffff',copy,frameCtx.tunnelPaletteProfile);rec.fillStyle='transparent';
            rec.lineWidth=Math.max(.5,Number(frameCtx.strokeWidth)||1.5)/Math.max(.001,Math.abs(Number(frameCtx.combinedScale)||1));
            for(const c of circles){if(!(c.r>0))continue;rec.beginPath();rec.arc(c.x,c.y,c.r,0,Math.PI*2);rec.stroke();}
            rec.restore();
        }
    }catch(_){return null;}
    return rec.unsupported||!rec.commands?.length?null:rec.commands;
}
function getLayerGeometryCircleFrameData(frameCtx){
    if(frameCtx?._geometryCircleFrameData!==undefined)return frameCtx._geometryCircleFrameData;
    const layer=frameCtx?.layer,cfg=layer?.geometryCircles;if(!layer||cfg?.enabled!==true||(!cfg.circumscribed&&!cfg.inscribed&&!cfg.median&&!cfg.keyPoints))return frameCtx?(frameCtx._geometryCircleFrameData=null):null;
    const paths=getLayerFrameAuxiliaryPaths(frameCtx),circles=computeLayerGeometryCircles(paths,cfg);if(!circles.length)return frameCtx?(frameCtx._geometryCircleFrameData=null):null;
    const gpuAllowed=(typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed());
    const commands=gpuAllowed&&!state.showRoundingGuides?buildGeometryCircleGPUCommands(frameCtx,circles):null,data={circles,commands};if(frameCtx)frameCtx._geometryCircleFrameData=data;return data;
}
function renderLayerGeometryCirclesPass(frameCtx){
    const data=getLayerGeometryCircleFrameData(frameCtx);if(!data)return;const {circles,commands}=data,layer=frameCtx.layer;
    // v347: exact GPU-resident path for deferred Layer Scene. Circle segments union with
    // MAX in scratch first, then the completed effect is source-overed into Layer Scene.
    if(frameCtx.frame?.gpuLayerSceneDeferred&&commands?.length){
        const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId);
        const rec=scene?.texture?WebGPUStrokeRenderer.encodeGeometryCirclesToLayerScene?.(scene.texture,commands):null;
        if(rec?.handled){if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,15,rec.commandBuffer,'geometry-circles');renderBackendTelemetry.mark('geometryCircles','gpu','resident Layer Scene');return;}
        if(isStrictSpiralWebGPUFrame(frameCtx)){renderBackendTelemetry.mark('geometryCircles','gpu','strict Spiral geometry circles GPU unavailable');renderBackendTelemetry.mark('geometry','gpu','strict Spiral geometry circles GPU unavailable');somataGpuContractError('SPIRAL_GEOMETRY_CIRCLES_GPU_UNAVAILABLE',frameCtx,{stage:'layer-scene'});try{requestMainCanvasRender?.();}catch(_){}return;}
        if(!materializeDeferredLayerScene(frameCtx))return;
    }
    if(isStrictSpiralWebGPUFrame(frameCtx)){renderBackendTelemetry.mark('geometryCircles','gpu','strict Spiral geometry circles missing resident Layer Scene');renderBackendTelemetry.mark('geometry','gpu','strict Spiral geometry circles missing resident Layer Scene');somataGpuContractError('SPIRAL_GEOMETRY_CIRCLES_NO_SCENE',frameCtx,{stage:'resident-scene'});try{requestMainCanvasRender?.();}catch(_){}return;}
    if(commands&&GeometryGPURenderer.render(commands,mainCtx)){renderBackendTelemetry.mark('geometryCircles','gpu','Geometry GPU renderer');return;}
    renderBackendTelemetry.mark('geometryCircles','canvas','Canvas2D geometry circles');
    const copies=frameCtx.visibleInstances?.copies||[{scale:1}],alphas=frameCtx.visibleInstances?.alphas||[1];
    for(let i=0;i<copies.length;i++){
        const copy=copies[i],alpha=Number(alphas[i]??1);if(alpha<=.001)continue;
        mainCtx.save();
        if(state.tunnel.active){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(Number(copy?.scale)||1,Number(copy?.scale)||1);}
        applyLayerFrameEffectTransform(mainCtx,frameCtx);
        mainCtx.globalAlpha=Math.max(0,Math.min(1,frameCtx.baseAlpha*alpha));
        mainCtx.strokeStyle=getTunnelCopyColor(layer.strokeColor||'#ffffff',copy,frameCtx.tunnelPaletteProfile);mainCtx.fillStyle='transparent';mainCtx.shadowBlur=0;mainCtx.setLineDash([]);
        mainCtx.lineWidth=Math.max(.5,Number(frameCtx.strokeWidth)||1.5)/Math.max(.001,Math.abs(Number(frameCtx.combinedScale)||1));
        for(const c of circles){if(!(c.r>0))continue;mainCtx.beginPath();mainCtx.arc(c.x,c.y,c.r,0,Math.PI*2);mainCtx.stroke();}
        mainCtx.restore();
    }
}

// v390 — multi-layer GPU residency pass. Geometry Circles reuse canonical resident segment buffers,
// persistent TextureView/bind groups and pressure-aware fallback rings (24→32→48→64).
// Morph, Fill, Spiral, lamps and raster-mode defaults are intentionally unchanged.
// v389 — static self-intersection Fill residency. Complex static contours keep the
// exact Canvas2D fill-rule semantics, but the full-frame mask is rebuilt only when geometry,
// transform, opacity, rule or viewport changes. Each static drawData owns one persistent mask
// canvas; WebGPU may therefore keep the corresponding texture contents resident as well.
let staticFillMaskCache=new WeakMap();
const staticFillMaskStats={builds:0,hits:0,invalidations:0,gpuUploadSkips:0,uniformUploadSkips:0};
function getStaticFillMaskCacheKey(frameCtx,contract){
    const plan=frameCtx?.geometryPlan||{},drawData=plan.sourceData||frameCtx?.staticDrawData;
    if(!drawData||plan.dynamic===true||contract?.spiral||contract?.corridor||state.fourierMode||state.showRoundingGuides)return null;
    const tr=mainCtx.getTransform(),layer=frameCtx.layer||{},fillAlpha=Number(frameCtx.visibleInstances?.fillAlphas?.[0]??1);
    return [mainCanvas.width|0,mainCanvas.height|0,String(drawData.geometryKey||''),String(drawData.roundedKey||''),
        getLayerFillRule(layer),Number(layer.rounding||0).toFixed(4),String(layer.profileMode||''),String(layer.splineRenderMode||''),
        Number(frameCtx.baseAlpha||0).toFixed(6),Number(fillAlpha||0).toFixed(6),
        tr.a.toFixed(7),tr.b.toFixed(7),tr.c.toFixed(7),tr.d.toFixed(7),tr.e.toFixed(3),tr.f.toFixed(3),
        Number(frameCtx.combinedScale||1).toFixed(7),Number(frameCtx.combinedRotationRad||0).toFixed(7)].join('|');
}
window.__spiroStaticFillMaskStatus=()=>({...staticFillMaskStats});

function prepareLayerFillMaskGPU(frameCtx){
    const layer=frameCtx?.layer,contract=getLayerGeometryContract(frameCtx);
    if(!layer||!contract)return null;
    if(!contract.fillRequested)return{mask:null,fillStyle:contract.fillStyle,empty:true,authoritative:true};
    // Somata 7.2.8 — dynamic Corridor Fill is GPU-native from the same frame-resident
    // morph command rail as Base. Never rasterize a transient Canvas2D mask for it.
    if(contract.dynamicCorridorNative===true)return{mask:null,fillStyle:contract.fillStyle,empty:false,authoritative:false,policyFallback:true,dynamicGpuOnly:true};
    if(!contract.gpuMaskEligible)return{mask:null,fillStyle:contract.fillStyle,empty:false,authoritative:false,policyFallback:true};
    const fillStyle=contract.fillStyle,w=mainCanvas.width,h=mainCanvas.height;
    const drawData=frameCtx.geometryPlan?.sourceData||frameCtx.staticDrawData,cacheKey=getStaticFillMaskCacheKey(frameCtx,contract);
    let maskCanvas=normalizedFillMaskCanvas,m=normalizedFillMaskCtx,cacheRec=null;
    if(cacheKey&&drawData&&typeof drawData==='object'){
        cacheRec=staticFillMaskCache.get(drawData)||null;
        if(cacheRec?.key===cacheKey&&cacheRec.canvas?.width===w&&cacheRec.canvas?.height===h){
            staticFillMaskStats.hits++;
            return{mask:cacheRec.canvas,fillStyle,empty:false,authoritative:true,rawMask:cacheRec.canvas,staticResident:true};
        }
        if(!cacheRec){const c=document.createElement('canvas');cacheRec={canvas:c,ctx:c.getContext('2d',{alpha:true}),key:'',revision:0};staticFillMaskCache.set(drawData,cacheRec);}
        if(cacheRec.canvas.width!==w||cacheRec.canvas.height!==h){cacheRec.canvas.width=w;cacheRec.canvas.height=h;}
        maskCanvas=cacheRec.canvas;m=cacheRec.ctx;staticFillMaskStats.invalidations++;
    }else{
        if(maskCanvas.width!==w||maskCanvas.height!==h){maskCanvas.width=w;maskCanvas.height=h;}
    }
    if(!m)return null;
    m.setTransform(1,0,0,1,0,0);m.globalAlpha=1;m.globalCompositeOperation='source-over';m.filter='none';m.shadowBlur=0;m.clearRect(0,0,w,h);
    const tr=mainCtx.getTransform();m.setTransform(tr.a,tr.b,tr.c,tr.d,tr.e,tr.f);m.globalCompositeOperation='lighter';m.globalAlpha=1;m.fillStyle='#ffffff';m.strokeStyle='transparent';
    const oldSuppressStroke=m.__suppressStroke,oldSuppressFill=m.__suppressFill;m.__suppressStroke=true;m.__suppressFill=false;
    try{frameCtx.drawLayerFillInstances(m);}catch(_){m.setTransform(1,0,0,1,0,0);m.globalCompositeOperation='source-over';return null;}
    if(oldSuppressStroke===undefined)delete m.__suppressStroke;else m.__suppressStroke=oldSuppressStroke;if(oldSuppressFill===undefined)delete m.__suppressFill;else m.__suppressFill=oldSuppressFill;
    m.setTransform(1,0,0,1,0,0);m.globalCompositeOperation='source-over';m.globalAlpha=1;
    const authoritative=validatePreparedFillMask(frameCtx,maskCanvas);
    if(cacheRec&&authoritative){cacheRec.key=cacheKey;cacheRec.revision=(cacheRec.revision+1)>>>0||1;maskCanvas.__spiroStaticFillMask=true;maskCanvas.__spiroFillMaskRevision=cacheRec.revision;staticFillMaskStats.builds++;}
    return{mask:authoritative?maskCanvas:null,fillStyle,empty:false,authoritative,rawMask:maskCanvas,staticResident:Boolean(cacheRec&&authoritative)};
}

function renderExactLayerFillCanvas(frameCtx){
    const contract=getLayerGeometryContract(frameCtx);
    if(!contract?.fillRequested||!frameCtx?.drawLayerFillInstances)return false;
    // Static geometry cannot produce visible Fill when it contains no closed contour.  Older
    // code returned true merely because drawLayerFillInstances() did not throw, which made the
    // pipeline report a successful Canvas Fill even though zero fill() calls were possible.
    if(frameCtx?.geometryPlan?.dynamic!==true&&contract.geometry?.hasClosedFillTopology!==true){
        noteFillRuntime(frameCtx,{handled:false,stage:'canvas-preflight',backend:'none',reason:'no closed fill topology'});
        return false;
    }
    const oldSuppressStroke=mainCtx.__suppressStroke,oldSuppressFill=mainCtx.__suppressFill;
    const oldAlpha=mainCtx.globalAlpha,oldComp=mainCtx.globalCompositeOperation,oldShadow=mainCtx.shadowBlur;
    try{
        mainCtx.__suppressStroke=true;mainCtx.__suppressFill=false;
        mainCtx.globalAlpha=1;mainCtx.globalCompositeOperation='source-over';mainCtx.shadowBlur=0;
        frameCtx.drawLayerFillInstances(mainCtx);
        if(frameCtx.frame){frameCtx.frame.gpuMainCanvasHasContent=true;frameCtx.frame.gpuMainSceneEmpty=false;}
        fillMaskValidationStats.canvasExact++;if(contract.corridor)fillMaskValidationStats.corridorExact++;
        geometryContractStats.canvasExactFill++;geometryContractStats.fillOnlyPasses++;
        noteFillRuntime(frameCtx,{handled:true,stage:'canvas-draw',backend:'canvas2d',reason:''});
        return true;
    }catch(err){
        noteFillRuntime(frameCtx,{handled:false,stage:'canvas-draw',backend:'canvas2d',reason:String(err?.message||err)});
        return false;
    }finally{
        if(oldSuppressStroke===undefined)delete mainCtx.__suppressStroke;else mainCtx.__suppressStroke=oldSuppressStroke;
        if(oldSuppressFill===undefined)delete mainCtx.__suppressFill;else mainCtx.__suppressFill=oldSuppressFill;
        mainCtx.globalAlpha=oldAlpha;mainCtx.globalCompositeOperation=oldComp;mainCtx.shadowBlur=oldShadow;
    }
}

function tryRenderLayerFillGPU(frameCtx){
    if(!FillGPURenderer.isAvailable())return false;
    const contract=getLayerGeometryContract(frameCtx),strictSpiralFill=isStrictSpiralWebGPUFrame(frameCtx);
    if(contract?.fillRequested&&FillMeshPreparer.canUseNative(frameCtx)){
        const mesh=frameCtx._nativeFillMeshCandidate||frameCtx._fillMeshShadow;
        if(mesh?.complete&&FillGPURenderer.renderMesh(frameCtx,mesh,mainCtx)){
            fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;geometryContractStats.nativeMeshFill++;return true;
        }
    }
    // Strict Spiral accepts native GPU mesh fill only; never create/upload a Canvas2D fill mask.
    if(strictSpiralFill)return false;
    const prepared=frameCtx?._webgpuFillPrepared||prepareLayerFillMaskGPU(frameCtx);if(!prepared)return false;if(frameCtx&&!frameCtx._webgpuFillPrepared)frameCtx._webgpuFillPrepared=prepared;
    if(prepared.empty)return true;
    if(prepared.authoritative!==true||!prepared.mask){fillMaskValidationStats.canvasFallback++;return false;}
    const ok=FillGPURenderer.render(prepared.mask,prepared.fillStyle,mainCtx);if(ok){fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;}else fillMaskValidationStats.canvasFallback++;return ok;
}

// v336 — frame-local command list for effects that draw directly into the deferred Layer Scene.
// It is deliberately owned by the render frame, not by individual renderers, so final submission
// preserves Profile → Sweep → Web → Lamps → Final order without extra queue.submit() calls.
function getLayerSceneEffectQueue(frameCtxOrFrame){
    const frame=frameCtxOrFrame?.frame||frameCtxOrFrame;if(!frame)return null;
    if(!Array.isArray(frame.gpuLayerSceneEffectCommands))frame.gpuLayerSceneEffectCommands=[];
    return frame.gpuLayerSceneEffectCommands;
}
function queueLayerSceneEffectCommand(frameCtx,phase,commandBuffer,label='effect',onSubmitted=null){
    if(typeof spiroGpuScheduleLayerSceneCommand==='function')return spiroGpuScheduleLayerSceneCommand(frameCtx,phase,commandBuffer,label,onSubmitted);
    if(!commandBuffer)return true;const q=getLayerSceneEffectQueue(frameCtx);if(!q)return false;
    const item={phase:Number(phase)||0,commandBuffer,label:String(label||'effect'),onSubmitted:typeof onSubmitted==='function'?onSubmitted:null};let i=q.length;
    while(i>0&&Number(q[i-1]?.phase)>item.phase)i--;q.splice(i,0,item);return true;
}
function notifyLayerSceneEffectCommandsSubmitted(frame){const q=peekLayerSceneEffectCommands(frame);for(const item of q){try{item?.onSubmitted?.();}catch(_){}}}
function peekLayerSceneEffectCommands(frame){
    const q=Array.isArray(frame?.gpuLayerSceneEffectCommands)?frame.gpuLayerSceneEffectCommands:null;
    return q?.length?q:[];
}
function clearLayerSceneEffectCommands(frame){const q=frame?.gpuLayerSceneEffectCommands;if(Array.isArray(q))q.length=0;const b=frame?.gpuLayerSceneCommandBuffers;if(Array.isArray(b))b.length=0;}
function collectLayerSceneCommandBuffers(frame){const q=peekLayerSceneEffectCommands(frame);let out=frame?.gpuLayerSceneCommandBuffers;if(!Array.isArray(out)){if(!frame)return[];out=frame.gpuLayerSceneCommandBuffers=[];}out.length=0;for(let i=0;i<q.length;i++){const b=q[i]?.commandBuffer;if(b)out.push(b);}return out;}
function materializeDeferredLayerScene(frameCtx){
    const frame=frameCtx?.frame;if(!frame?.gpuLayerSceneDeferred)return true;
    // Somata 7.2.4 hotfix2 — strictness is a FRAME contract, not only a property of the
    // layer currently being rendered. During polygon↔Spiral Morph an earlier ordinary layer
    // can precede a strict Spiral layer. Materializing that prefix poisons the whole frame and
    // makes Final reject it later as STRICT_SPIRAL_CANVAS_PATH_TOUCHED.
    const strictFrameIntent=frame.strictSpiralEntryIntent===true||frame.strictSpiralGpuPresentRequired===true||isStrictSpiralWebGPUFrame(frameCtx);
    if(strictFrameIntent){
        renderBackendTelemetry.mark('final','gpu','strict Spiral frame materialization firewall');
        somataGpuContractError('STRICT_SPIRAL_MATERIALIZATION_ATTEMPT',frameCtx,{stage:'materializeDeferredLayerScene',frameIntent:true});
        try{requestMainCanvasRender?.();}catch(_){}
        return false;
    }
    const extra=collectLayerSceneCommandBuffers(frame);
    let ok=false;try{ok=WebGPUStrokeRenderer.presentDeferredLayerSceneToMain(frame.id,mainCtx,extra);}catch(_){ok=false;}
    if(ok){notifyLayerSceneEffectCommandsSubmitted(frame);noteFrameGraphMaterialization(frameCtx?.frameId||frame?.id);frame.gpuLayerSceneDeferred=false;frame.gpuMainSceneEmpty=false;clearLayerSceneEffectCommands(frame);}return ok;
}
function canBridgeProfileIntoLayerScene(frameCtx,effect){
    if(!effect?.enabled)return true;
    if(effect.application==='stroke')return (['slash','square','circle','cross'].includes(effect.prepared?.type))&&WebGPUProfileMarkerRenderer.isReady();
    if(effect.application!=='graffiti')return false;
    if(effect.prepared?.gpuMorphNative===true)return Boolean(typeof WebGPUGraffitiMorphRenderer!=='undefined'&&WebGPUGraffitiMorphRenderer.canEncode?.(effect.prepared));
    // v348: both variable ribbons and worker bitmaps can remain GPU-resident in Corridor.
    if(effect.tunnelActive){
        if(effect.raster?.bitmap&&WebGPUGraffitiBitmapRenderer.canEncodeCorridor(effect.raster))return true;
        return effect.prepared?.gpuRibbonEligible===true&&WebGPUGraffitiRibbonRenderer.canEncodeCorridor(frameCtx?.layer,effect.prepared);
    }
    if(effect.raster?.bitmap&&WebGPUGraffitiBitmapRenderer.isReady())return true;
    return effect.prepared?.gpuRibbonEligible===true&&WebGPUGraffitiRibbonRenderer.canEncode(frameCtx?.layer,effect.prepared)&&WebGPUGraffitiRibbonRenderer.isReady();
}
function canBridgeOutlineIntoLayerScene(frameCtx,effect,batch){
    if(!effect?.enabled)return true;
    if(batch?.outlineInScene===true)return true;
    const multi=Number(frameCtx?.frame?.renderLayerCount||0)>1;
    if(effect.mode==='outer'&&multi){
        if(!WebGPUStrokeRenderer.canUseFrameUnderlay?.(frameCtx.frameId))return false;
        if(effect.graffiti!==true)return Boolean(batch?.roles?.has?.('outline'));
        if(effect.coreLayer)return false;
        if(effect.profilePrepared?.gpuMorphNative===true)return Boolean(typeof WebGPUGraffitiMorphRenderer!=='undefined'&&WebGPUGraffitiMorphRenderer.canEncode?.(effect.profilePrepared));
        if(effect.tunnelActive){if(effect.raster?.bitmap&&WebGPUGraffitiBitmapRenderer.canEncodeCorridor(effect.raster))return true;return effect.profilePrepared?.gpuRibbonEligible===true&&WebGPUGraffitiRibbonRenderer.canEncodeCorridor(effect.outlineLayer,effect.profilePrepared);}
        if(effect.raster?.bitmap&&WebGPUGraffitiBitmapRenderer.isReady())return true;
        return effect.profilePrepared?.gpuRibbonEligible===true&&WebGPUGraffitiRibbonRenderer.canEncode(effect.outlineLayer,effect.profilePrepared)&&WebGPUGraffitiRibbonRenderer.isReady();
    }
    if(effect.graffiti!==true||effect.mode!=='outer')return false;
    if(effect.profilePrepared?.gpuMorphNative===true)return Boolean(typeof WebGPUGraffitiMorphRenderer!=='undefined'&&WebGPUGraffitiMorphRenderer.canEncode?.(effect.profilePrepared));
    if(effect.tunnelActive){if(effect.raster?.bitmap&&WebGPUGraffitiBitmapRenderer.canEncodeCorridor(effect.raster))return true;return effect.profilePrepared?.gpuRibbonEligible===true&&WebGPUGraffitiRibbonRenderer.canEncodeCorridor(effect.outlineLayer,effect.profilePrepared);}
    if(effect.raster?.bitmap&&WebGPUGraffitiBitmapRenderer.isReady())return true;
    return effect.profilePrepared?.gpuRibbonEligible===true&&WebGPUGraffitiRibbonRenderer.canEncode(effect.outlineLayer,effect.profilePrepared)&&WebGPUGraffitiRibbonRenderer.isReady();
}
function canBridgeSweepIntoLayerScene(frameCtx,effect){
    if(!effect?.enabled)return true;const cfg=effect.frameData?.cfg;
    // v392 — all Lightning placement modes can stay in deferred WebGPU. Symmetric uses the
    // direct additive path; Inside/Outside use the same vector scratch plus even-odd stencil.
    if(cfg?.effectType==='lightning'){if(effect.frameData?.lightningSpectralPrepared)return Boolean(typeof WebGPUBezierSweepRenderer!=='undefined'&&WebGPUBezierSweepRenderer.isReady?.());return effect.frameData?.gpuMorphArcLightning===true?Boolean(typeof WebGPULightningArcRenderer!=='undefined'&&WebGPULightningArcRenderer.isReady?.()):SweepGPURenderer.canEncodeToLayerScene();}
    if(effect.frameData?.bezierGlintGPU===true)return Boolean(typeof WebGPUBezierSweepRenderer!=='undefined'&&WebGPUBezierSweepRenderer.isReady?.());
    return effect.frameData?.canonicalGPU===true&&WebGPUCanonicalSweepRenderer.canUse(cfg,effect.tunnelActive===true);
}
window.__spiroV392LightningStencilProbe=()=>{
    const old=SweepGPURenderer.canEncodeToLayerScene;let symmetric=false,inside=false,outside=false,disabled=false;
    try{
        SweepGPURenderer.canEncodeToLayerScene=()=>true;
        symmetric=canBridgeSweepIntoLayerScene(null,{enabled:true,frameData:{cfg:{effectType:'lightning',lightningBehavior:'symmetric'}}})===true;
        inside=canBridgeSweepIntoLayerScene(null,{enabled:true,frameData:{cfg:{effectType:'lightning',lightningBehavior:'inside'}}})===true;
        outside=canBridgeSweepIntoLayerScene(null,{enabled:true,frameData:{cfg:{effectType:'lightning',lightningBehavior:'outside'}}})===true;
        disabled=canBridgeSweepIntoLayerScene(null,{enabled:false})===true;
    }finally{SweepGPURenderer.canEncodeToLayerScene=old;}
    return{symmetric,inside,outside,disabledPassThrough:disabled,pass:symmetric&&inside&&outside&&disabled};
};
window.__spiroV393GlobalGpuSceneProbe=()=>{
    const api=WebGPUStrokeRenderer;const methods=['canUseFrameScene','prepareFrameScene','getFrameSceneTexture','getFrameSceneCommandBuffers','sealDeferredLayerSceneToFrame','markFrameScenePresented','presentFrameSceneToMain'];
    const methodsPresent=methods.every(k=>typeof api?.[k]==='function'),frameLayerCounter=Boolean(renderRuntime?.frame&&Object.prototype.hasOwnProperty.call(renderRuntime.frame,'gpuFrameSceneLayers')),rasterMarkersOff=state?.graffitiRasterized!==true;
    return{methodsPresent,frameLayerCounter,rasterMarkersOff,pass:methodsPresent&&frameLayerCounter&&rasterMarkersOff};
};
window.__spiroV394GlobalUnderlayFrameGraphProbe=()=>{
    const api=WebGPUStrokeRenderer,methods=['canUseFrameScene','canUseFrameUnderlay','appendFrameUnderlayCommands','sealDeferredLayerSceneToFrame','getFrameUnderlayTexture'];
    const methodsPresent=methods.every(k=>typeof api?.[k]==='function'),rasterMarkersOff=state?.graffitiRasterized!==true,rasterLampsOff=state?.lamps?.rasterized!==true;
    let multiOuterAllowed=false,multiOuterGuarded=false;const oldScene=api.canUseFrameScene,oldUnder=api.canUseFrameUnderlay,oldFinal=WebGPUFinalCompositeRenderer.canDeferLayerScene;
    try{
        api.canUseFrameScene=()=>true;api.canUseFrameUnderlay=()=>true;WebGPUFinalCompositeRenderer.canDeferLayerScene=()=>true;
        const batch={sceneCombined:true,sceneTexture:{},outlineInScene:false,roles:new Set(['outline'])},ctx={frame:{renderLayerCount:3},frameId:77,layer:{},effectsPlan:{outline:{enabled:true,mode:'outer',graffiti:false},profile:{enabled:false},sweep:{enabled:false},web:{enabled:false}}};
        multiOuterAllowed=canDeferLayerSceneDirect(ctx,batch)===true;api.canUseFrameUnderlay=()=>false;multiOuterGuarded=canDeferLayerSceneDirect(ctx,batch)===false;
    }catch(_){}finally{api.canUseFrameScene=oldScene;api.canUseFrameUnderlay=oldUnder;WebGPUFinalCompositeRenderer.canDeferLayerScene=oldFinal;}
    return{methodsPresent,multiOuterAllowed,multiOuterGuarded,rasterMarkersOff,rasterLampsOff,pass:methodsPresent&&multiOuterAllowed&&multiOuterGuarded&&rasterMarkersOff&&rasterLampsOff};
};
function canBridgeWebIntoLayerScene(frameCtx,effect){
    if(!effect?.enabled)return true;
    return Boolean(effect.frameData&&WebGPUWebThreadSceneRenderer.isReady());
}
function canBridgeGeometryCirclesIntoLayerScene(frameCtx){
    const cfg=frameCtx?.layer?.geometryCircles;if(cfg?.enabled!==true||(!cfg.circumscribed&&!cfg.inscribed&&!cfg.median&&!cfg.keyPoints))return true;
    if(state.showRoundingGuides)return false;
    const data=getLayerGeometryCircleFrameData(frameCtx);return Boolean(data?.commands?.length&&WebGPUStrokeRenderer.canEncodeGeometryCirclesToLayerScene?.(data.commands));
}
function getLayerSceneDestinationOverPolicy(frameCtx){
    const multi=Number(frameCtx?.frame?.renderLayerCount||0)>1,out=frameCtx?.effectsPlan?.outline;
    if(!multi||!out?.enabled||out.mode!=='outer')return{needsGlobalUnderlay:false,reason:''};
    return{needsGlobalUnderlay:true,reason:'multi-layer destination-over requires global GPU underlay accumulator'};
}
function canDeferLayerSceneDirect(frameCtx,batch){
    if(!batch?.sceneCombined||!batch?.sceneTexture||!frameCtx?.frame)return false;
    if(state.showBoundingCircle)return false;
    // v394: multi-layer destination-over can coexist with the global GPU scene. The
    // underlay uses its own persistent texture, but its commands are interleaved into the
    // same per-layer FrameGraph before shared role textures are reused.
    const multi=Number(frameCtx.frame.renderLayerCount||0)>1;if(multi&&!WebGPUStrokeRenderer.canUseFrameScene?.(frameCtx.frameId))return false;
    if(!canBridgeGeometryCirclesIntoLayerScene(frameCtx))return false;
    const underlay=getLayerSceneDestinationOverPolicy(frameCtx);if(underlay.needsGlobalUnderlay&&!WebGPUStrokeRenderer.canUseFrameUnderlay?.(frameCtx.frameId))return false;
    const e=frameCtx.effectsPlan||{};
    if(!canBridgeOutlineIntoLayerScene(frameCtx,e.outline,batch))return false;
    const pathFxRequired=e.motion?.enabled===true||e.sprite?.enabled===true;
    if(pathFxRequired&&!WebGPUPathFxRenderer.isReady())return false;
    if(!canBridgeProfileIntoLayerScene(frameCtx,e.profile)||!canBridgeSweepIntoLayerScene(frameCtx,e.sweep)||!canBridgeWebIntoLayerScene(frameCtx,e.web))return false;
    // v522.7 — Base is no longer treated as an optional profitability optimization.
    // If the ordinary line is present in the WebGPU Layer Scene, keep it GPU-resident all
    // the way to finalGpuCanvas even for a single static layer. Correctness blockers above
    // still win; this bypasses only the old "3+ layers / tunnel" profitability gate.
    const gpuBaseRequired=Boolean(batch?.roles?.has?.('base')&&!shouldForceCanvasBaseStroke(frameCtx));
    return WebGPUFinalCompositeRenderer.canDeferLayerScene(frameCtx.frame,pathFxRequired||gpuBaseRequired);
}

// Somata 6.8 iter18/23 — strict Spiral must not make Base visibility depend on optional-effect
// pipeline readiness. Base establishes the authoritative retained-Bézier GPU LayerScene first.
// Iter23 also separates INTERNAL batch deferral from EXTERNAL LayerScene writers. A static Spiral
// batch already owns a valid sceneTexture+commandBuffer; requiring canUseExternalLayerScene() for
// that batch was an unrelated gate and could keep the Base in an endless retry loop.
const somataSpiralSceneDiag={
    internal:{frameId:0,ok:false,reason:'not-checked'},
    external:{frameId:0,ok:false,reason:'not-checked'},
    base:{frameId:0,stage:'not-rendered',hasBatch:false,sceneCombined:false,hasSceneTexture:false,roles:[]}
};
function noteSomataSpiralRootDecision(frameCtx,external,ok,reason,batch=null){
    const d=external?somataSpiralSceneDiag.external:somataSpiralSceneDiag.internal;
    d.frameId=Number(frameCtx?.frameId)||0;d.ok=ok===true;d.reason=String(reason||'');
    d.sceneCombined=batch?.sceneCombined===true;d.hasSceneTexture=Boolean(batch?.sceneTexture);
    return ok===true;
}
function canDeferStrictSpiralLayerSceneRoot(frameCtx,batch,requiresExternal=false){
    if(!isStrictSpiralWebGPUFrame(frameCtx))return noteSomataSpiralRootDecision(frameCtx,requiresExternal,false,'not-strict-spiral',batch);
    if(!batch?.sceneCombined)return noteSomataSpiralRootDecision(frameCtx,requiresExternal,false,'batch-not-scene-combined',batch);
    if(!batch?.sceneTexture)return noteSomataSpiralRootDecision(frameCtx,requiresExternal,false,'batch-has-no-scene-texture',batch);
    if(!frameCtx?.frame)return noteSomataSpiralRootDecision(frameCtx,requiresExternal,false,'frame-missing',batch);
    if(state.showBoundingCircle)return noteSomataSpiralRootDecision(frameCtx,requiresExternal,false,'bounding-circle-enabled',batch);
    const id=Number(frameCtx.frameId)||0,multi=Number(frameCtx.frame.renderLayerCount||0)>1;
    if(typeof WebGPUStrokeRenderer==='undefined')return noteSomataSpiralRootDecision(frameCtx,requiresExternal,false,'stroke-renderer-missing',batch);
    // External writers (Morph/Corridor/effects-only) need the shared scratch target. Internal
    // renderLayerBatch() does not: it already encoded into that frame's retained sceneTexture.
    if(requiresExternal&&WebGPUStrokeRenderer.canUseExternalLayerScene?.(id)!==true)return noteSomataSpiralRootDecision(frameCtx,true,false,'external-layer-scene-unavailable',batch);
    if(multi&&WebGPUStrokeRenderer.canUseFrameScene?.(id)!==true)return noteSomataSpiralRootDecision(frameCtx,requiresExternal,false,'frame-scene-unavailable',batch);
    // Somata 6.8 Iter25 — an INTERNAL renderLayerBatch already owns a valid GPU sceneTexture
    // and commandBuffer. Publishing that retained Bézier scene must not be gated by Final's
    // asynchronous presentation pipeline. Final may still decline this frame and retry GPU-only,
    // but Base remains committed instead of endlessly preserving the previous polygon image.
    if(requiresExternal&&WebGPUFinalCompositeRenderer.canDeferLayerScene(frameCtx.frame,true)!==true)return noteSomataSpiralRootDecision(frameCtx,true,false,'final-compositor-not-ready',batch);
    return noteSomataSpiralRootDecision(frameCtx,requiresExternal,true,requiresExternal?'ready':'internal-gpu-scene-ready',batch);
}
function canDeferLayerSceneForFrame(frameCtx,batch){
    return isStrictSpiralWebGPUFrame(frameCtx)?canDeferStrictSpiralLayerSceneRoot(frameCtx,batch,false):canDeferLayerSceneDirect(frameCtx,batch);
}
function ensureStrictSpiralEffectLayerSceneRoot(frameCtx){
    if(!isStrictSpiralWebGPUFrame(frameCtx)||!frameCtx?.frame)return false;
    // Somata 7.3.9 — gpuLayerSceneDeferred is frame-wide history, not resident ownership.
    // After one layer is sealed into Frame Scene that boolean may remain true while the shared
    // per-layer scratch has already been released. Only the renderer's resident record proves
    // that THIS layer has a writable Layer Scene. A global Frame Scene may coexist with it.
    const residentRoot=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId);
    if(residentRoot?.texture)return true;
    // Normal visible Base must remain the root producer, otherwise a pre-clear command would
    // occupy the one deferred LayerScene slot before the retained-Bézier Base can publish it.
    const baseWillOwnScene=frameCtx.lineDisplayEnabled===true&&frameCtx.lineProfileStrokeOnly!==true&&!isPathFxBaseReplacementActive(frameCtx);
    // Somata 7.3.9 — Web is an underlay. If strict Spiral Web is enabled, open a transparent
    // LayerScene root before Base so Web can be queued at phase 4.5 and Base at phase 5 even
    // though the logical Web pass runs later. This also gives every exact effect one stable
    // canonical scene owner instead of racing for the external LayerScene slot.
    const rootContract=getLayerGeometryContract(frameCtx),orderedWebUnderBase=frameCtx.effectsPlan?.web?.enabled===true;
    const orderedSceneRoot=orderedWebUnderBase||rootContract?.fillRequested===true||state.tunnel?.active===true;
    if((baseWillOwnScene&&!orderedSceneRoot)||frameCtx._webgpuStrokeBatch?.sceneCombined)return false;
    // Graffiti hides Base and now defers its contour Glow until the exact ribbon Profile pass.
    // Therefore Graffiti cannot rely on the historical hidden-carrier Glow to open LayerScene;
    // create the transparent GPU root here like any other effects-only FullGPU layer.
    if(!spiralGpuEffectsRequested(frameCtx))return false;
    const pseudo={sceneCombined:true,sceneTexture:{},roles:new Set(),outlineInScene:false};
    if(!canDeferStrictSpiralLayerSceneRoot(frameCtx,pseudo,true))return false;
    if(WebGPUStrokeRenderer.beginExternalLayerScene?.(frameCtx.frameId,'strict-spiral-effects')){
        frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;frameCtx._strictSpiralEmptyLayerSceneRoot=true;
        renderBackendTelemetry.mark('geometry','gpu','strict Spiral transparent GPU effect root');return true;
    }
    try{WebGPUStrokeRenderer.warmup?.();requestMainCanvasRender?.();}catch(_){}return false;
}

// v539 — Tunnel/Corridor did not participate in the ordinary Layer Scene batch because
// it is master-contour × copy-transform geometry. For same-colour tunnel scenes, encode
// Glow/Base directly into the existing GPU Layer Scene so Sweep/Glint can continue there
// without a GPU -> Canvas2D bridge. Keep exact Fill, Web and path-FX cases on their proven paths.
// Iter19 — frame-level Spiral intent is needed before LayerFrame construction so entering
// Spiral cannot clear the only presented image while WebGPU asynchronously warms up.
function hasStrictSpiralPresentationIntent(displayLayers){
    if(typeof somataCpuBackendForced==='function'&&somataCpuBackendForced())return false;
    if(state?.fourierMode===true)return false;
    const spiral=(layer)=>Boolean(layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(layer));
    if(Array.isArray(displayLayers)&&displayLayers.some(layer=>layer?.visible!==false&&spiral(layer)))return true;
    const rt=runtimeState?.morph;
    if(rt?.active===true){
        const src=Array.isArray(rt.renderSourceLayers)?rt.renderSourceLayers:[];
        const dst=Array.isArray(rt.renderTargetLayers)?rt.renderTargetLayers:[];
        const n=Math.max(src.length,dst.length);
        for(let i=0;i<n;i++)if(spiral(src[i])||spiral(dst[i]))return true;
    }
    return false;
}
function isStrictSpiralWebGPUFrame(frameCtx){
    if(typeof somataCpuBackendForced==='function'&&somataCpuBackendForced())return false;
    if(state?.fourierMode===true||!frameCtx)return false;
    const spiral=(layer)=>Boolean(layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(layer));
    if(spiral(frameCtx.layer)||spiral(frameCtx.sourceLayer)||spiral(frameCtx.geometryPlan?.sourceLayer)||spiral(frameCtx.geometryPlan?.targetLayer)||spiral(frameCtx.blueMorphProvider?.sourceLayer)||spiral(frameCtx.blueMorphProvider?.targetLayer))return true;
    // 6.8 iter7: a polygon<->Spiral Morph can have a temporary render layer that is not
    // itself tagged as Spiral. The special retained rail is the authoritative geometry owner.
    try{const rec=typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx.layerIndex):null;const liveMorphAuthority=frameCtx.morphFrameActive===true||frameCtx.geometryPlan?.dynamic===true;if(liveMorphAuthority&&rec?.specialSpiralBezierRail===true&&rec?.gpuOnlySpiralEffects===true)return true;}catch(_){}
    return false;
}
function spiralGpuEffectsRequested(frameCtx){
    const e=frameCtx?.effectsPlan||{};
    if(e.glow?.enabled===true||e.outline?.enabled===true||e.profile?.enabled===true||e.motion?.enabled===true||e.sweep?.enabled===true||e.sprite?.enabled===true||e.web?.enabled===true||e.lamps?.enabled===true)return true;
    const gc=frameCtx?.layer?.geometryCircles;if(gc?.enabled===true&&(gc.circumscribed||gc.inscribed||gc.median||gc.keyPoints))return true;
    try{if(typeof normalizeParticleConfig==='function'&&normalizeParticleConfig(frameCtx?.layer?.particles)?.enabled===true)return true;}catch(_){}
    return false;
}
function canUseGpuSpiralBezierLayerScene(frameCtx,allowHiddenGraffitiCarrier=false){
    const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='graffiti';
    if(!frameCtx?.prepared||state.showRoundingGuides||(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)||!frameCtx.lineDisplayEnabled)return false;
    const staticSpiral=Boolean(!frameCtx.morphFrameActive&&frameCtx.geometryPlan?.dynamic!==true&&typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer));
    if(frameCtx.geometryPlan?.kind!=='blue-circle-slide'&&!staticSpiral)return false;
    const eligibilityMode=hiddenGraffitiCarrier?'glow':'base';
    if(typeof WebGPUSpiralBezierMorphRenderer==='undefined'||WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,eligibilityMode)!==true)return false;
    if(typeof WebGPUStrokeRenderer==='undefined')return false;
    const resident=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId);
    if(!resident?.texture&&(WebGPUStrokeRenderer.canUseExternalLayerScene?.(frameCtx.frameId)!==true||typeof WebGPUStrokeRenderer.getExternalLayerSceneTarget!=='function'))return false;
    if(typeof spiroIsCompatibilityForced==='function'&&spiroIsCompatibilityForced('geometry')&&!isStrictSpiralWebGPUFrame(frameCtx))return false;
    if(shouldForceCanvasBaseStroke(frameCtx)&&!isStrictSpiralWebGPUFrame(frameCtx))return false;
    const contract=getLayerGeometryContract(frameCtx);if(contract?.fillRequested===true&&!resident?.texture)return false;
    const pseudo={sceneCombined:true,sceneTexture:{},roles:new Set([hiddenGraffitiCarrier?'glow':'base']),outlineInScene:false};
    // A resident LayerScene is already the accepted root. Requiring canUseExternalLayerScene()
    // again would reject the exact scene we are trying to join, because that API intentionally
    // becomes false once the root is occupied. External eligibility is required only before root.
    const requiresExternal=!resident?.texture;
    return (isStrictSpiralWebGPUFrame(frameCtx)?canDeferStrictSpiralLayerSceneRoot(frameCtx,pseudo,requiresExternal):canDeferLayerSceneDirect(frameCtx,pseudo))===true;
}
function resolveGpuSpiralBezierSceneRoute(frameCtx,allowHiddenGraffitiCarrier=false){
    const resident=Boolean(getResidentGpuLayerScene(frameCtx)?.texture);
    if(resident&&canUseGpuSpiralBezierLayerScene(frameCtx,allowHiddenGraffitiCarrier))return{deferLayerScene:true,deferFrameScene:false,resident:true};
    if(!allowHiddenGraffitiCarrier&&canUseGpuSpiralBezierFrameScene(frameCtx))return{deferLayerScene:false,deferFrameScene:true,resident:false};
    if(canUseGpuSpiralBezierLayerScene(frameCtx,allowHiddenGraffitiCarrier))return{deferLayerScene:true,deferFrameScene:false,resident:false};
    return{deferLayerScene:false,deferFrameScene:false,resident:false};
}

// Somata 6.7 — the hot path for several plain Spiral layers.  A dedicated Spiral renderer
// already owns Base/Glow/Corridor on WebGPU, so sending every layer through the scratch
// Layer Scene only to fullscreen-seal it into Frame Scene wastes bandwidth.  When no later
// per-layer pass needs to interleave with the stroke, write the Spiral command buffer straight
// into the frame-global source-over texture.
function canUseGpuSpiralBezierFrameScene(frameCtx){
    // Somata 6.9: Morph retained-cubic micro-segments are unioned with MAX coverage to avoid
    // subdivision beads / glow hot-spots. MAX is correct only inside a transparent per-layer
    // scratch scene; the finished layer is then composited source-over into Frame Scene.
    // Static Spiral keeps the old direct-frame fast path because its proven batch owns coverage.
    if(frameCtx?.morphFrameActive===true)return false;
    if(!frameCtx?.prepared||Number(frameCtx.frame?.renderLayerCount||0)<2||state.showRoundingGuides||frameCtx.lineProfileStrokeOnly||!frameCtx.lineDisplayEnabled)return false;
    const staticSpiral=Boolean(!frameCtx.morphFrameActive&&frameCtx.geometryPlan?.dynamic!==true&&state.tunnel?.active!==true&&typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer));
    if(frameCtx.geometryPlan?.kind!=='blue-circle-slide'&&!staticSpiral)return false;
    if(typeof WebGPUSpiralBezierMorphRenderer==='undefined'||WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'base')!==true)return false;
    const api=typeof WebGPUStrokeRenderer!=='undefined'?WebGPUStrokeRenderer:null;
    if(!api||api.canUseFrameScene?.(frameCtx.frameId)!==true||typeof api.getExternalFrameSceneTarget!=='function'||typeof api.deferExternalFrameScene!=='function')return false;
    if(typeof spiroIsCompatibilityForced==='function'&&spiroIsCompatibilityForced('geometry')&&!isStrictSpiralWebGPUFrame(frameCtx))return false;
    if(shouldForceCanvasBaseStroke(frameCtx)&&!isStrictSpiralWebGPUFrame(frameCtx))return false;
    const contract=getLayerGeometryContract(frameCtx);if(contract?.fillRequested===true)return false;
    const e=frameCtx.effectsPlan||{};
    if(e.outline?.enabled===true||e.profile?.enabled===true||e.motion?.enabled===true||e.sweep?.enabled===true||e.sprite?.enabled===true||e.web?.enabled===true||e.lamps?.enabled===true)return false;
    try{if(typeof normalizeParticleConfig==='function'&&normalizeParticleConfig(frameCtx.layer?.particles)?.enabled===true)return false;}catch(_){}
    const gc=frameCtx.layer?.geometryCircles;if(gc?.enabled===true&&(gc.circumscribed||gc.inscribed||gc.median||gc.keyPoints))return false;
    return true;
}

function getResidentGpuLayerScene(frameCtx){
    if(typeof WebGPUStrokeRenderer==='undefined')return null;
    const rec=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx?.frameId);
    return rec?.texture?rec:null;
}

function getDynamicCorridorFillMesh(frameCtx){
    if(frameCtx?.geometryPlan?.dynamic!==true||state.tunnel?.active!==true)return null;
    if(frameCtx._corridorNativeFillPreflight?.dynamic===true&&Number(frameCtx._corridorNativeFillPreflight.frameId)===Number(frameCtx.frameId))return frameCtx._corridorNativeFillPreflight;
    const commands=getDynamicTunnelMorphMasterStrokeCommands?.(frameCtx);
    if(!commands?.length)return null;
    const mesh=FillMeshPreparer.prepareDynamicCommands?.(frameCtx,commands)||null;
    if(mesh?.nativeComplete){
        frameCtx._corridorNativeFillPreflight=mesh;
        frameCtx._nativeFillMeshCandidate=mesh;
        return mesh;
    }
    return null;
}

// Somata 7.2.8 — a Corridor Fill layer is allowed to open the resident GPU Layer Scene
// through Glow, but only after Fill has proved that it can join that same scene later in
// the frame.  The old blanket `fillRequested => false` rule made Glow fall through to the
// Canvas2D blur path; Base then tried to create a *second* Layer Scene for Fill and reported
// corridor-gpu-wait even though the native WebGPU Fill renderer itself was healthy.
// Preflight keeps the ordering deterministic (Glow -> Fill -> Base) without adding a
// fallback, readback, extra texture, or extra WGSL binding.
function canAttachNativeCorridorFillToLayerScene(frameCtx,contract=null){
    const c=contract||getLayerGeometryContract(frameCtx);
    if(c?.fillRequested!==true)return true;
    if(c.nativeGpuFillEligible!==true)return false;
    const mesh=frameCtx?.geometryPlan?.dynamic===true
        ? getDynamicCorridorFillMesh(frameCtx)
        : (frameCtx?._fillMeshShadow||FillMeshPreparer.prepareFrame?.(frameCtx));
    if(!mesh?.nativeComplete||!(Number(mesh.fanTriangleCount)>0))return false;
    if(typeof FillGPURenderer==='undefined')return false;
    try{FillGPURenderer.isAvailable?.();}catch(_){}
    if(FillGPURenderer.canEncodeMeshToTexture?.(frameCtx,mesh)!==true)return false;
    frameCtx._corridorNativeFillPreflight=mesh;
    frameCtx._nativeFillMeshCandidate=mesh;
    return true;
}

function canUseGpuOnlyCorridorLayerScene(frameCtx,allowHiddenGraffitiCarrier=false){
    const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='graffiti';
    if(!frameCtx?.prepared||state.tunnel?.active!==true||state.showRoundingGuides||(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)||!frameCtx.lineDisplayEnabled)return false;
    if(frameCtx.geometryPlan?.kind==='lightning')return false;
    // Dynamic Corridor has a triple-buffered master-segment ring. The target playlist uses
    // three layers; keep larger dynamic stacks on the immediate proven path until that ring
    // is made frame-global as well. Static Corridor has no such limit.
    if(frameCtx.geometryPlan?.dynamic===true&&Number(frameCtx.frame?.renderLayerCount||0)>3)return false;
    const strictSpiralCorridor=isStrictSpiralWebGPUFrame(frameCtx);
    // Iter21 — retain the proven non-Spiral policy. Strict Spiral has no Canvas corridor
    // fallback, and its Corridor renderer already carries per-copy colour in GPU storage.
    if((state.tunnel?.colorShiftEnabled===true||state.tunnel?.paletteLagEnabled===true)&&!strictSpiralCorridor)return false;
    // FullGPU strict Spiral must never inherit a compatibility-disable flag from an earlier
    // optional pass. Such a flag means "use legacy fallback", which is forbidden here.
    if(typeof spiroIsCompatibilityForced==='function'&&spiroIsCompatibilityForced('geometry')&&!strictSpiralCorridor)return false;
    if(shouldForceCanvasBaseStroke(frameCtx)&&!strictSpiralCorridor)return false;
    // Any same-frame deferred GPU producer may already own the resident Layer Scene. Corridor
    // must JOIN that texture rather than ask for a second external scene.  `_corridorLayerSceneActive`
    // is only telemetry/ownership history; the renderer's resident record is the source of truth.
    // This is especially important for strict Spiral: its generic stroke batch is intentionally
    // absent while Corridor owns Base, so rejecting an already-resident scene would drop Base.
    const residentScene=getResidentGpuLayerScene(frameCtx);
    if(residentScene?.texture)return true;
    const contract=getLayerGeometryContract(frameCtx);
    if(contract?.fillRequested===true&&!canAttachNativeCorridorFillToLayerScene(frameCtx,contract))return false;
    const e=frameCtx.effectsPlan||{};
    // 7.2.8 — do not reject the resident Corridor scene merely because Web / Motion /
    // Sprite are enabled. canDeferLayerSceneDirect() below already verifies that those
    // effects have a GPU bridge. The old blanket rejection forced Glow through an immediate
    // WebGPU-canvas -> Canvas2D composite even when every enabled pass was GPU-capable.
    // Particles still keep the conservative gate until their ordering is represented here.
    if(!strictSpiralCorridor&&e.particles?.enabled===true)return false;
    if(!WebGPUStrokeRenderer.canUseExternalLayerScene?.(frameCtx.frameId))return false;
    const pseudo={sceneCombined:true,sceneTexture:{},roles:new Set(['base']),outlineInScene:false};
    // Optional Spiral effects attach after the carrier. Their warm-up must not prevent
    // Corridor Base from opening the strict GPU LayerScene.
    return (strictSpiralCorridor?canDeferStrictSpiralLayerSceneRoot(frameCtx,pseudo,true):canDeferLayerSceneDirect(frameCtx,pseudo))===true;
}
function getGpuOnlyCorridorMaster(frameCtx,allowHiddenGraffitiCarrier=false){
    const spiral=isSpiralLayer(frameCtx.layer);if(spiral&&!canUseSpiralCorridorMasterInstancing(frameCtx))return null;
    // Dynamic Spiral Morph Graffiti is rendered by the retained-cubic Spiral renderer itself;
    // only the static Corridor master needs the hidden carrier exception.
    if(frameCtx.geometryPlan?.dynamic===true)return getDynamicTunnelMorphMasterStrokeCommands(frameCtx);
    return getTunnelMasterStrokeCommands(frameCtx,allowHiddenGraffitiCarrier);
}
function encodeGpuOnlyCorridorLayerRole(frameCtx,role,extra={},clearScene=false,allowHiddenGraffitiCarrier=false){
    if(!canUseGpuOnlyCorridorLayerScene(frameCtx,allowHiddenGraffitiCarrier))return null;const master=getGpuOnlyCorridorMaster(frameCtx,allowHiddenGraffitiCarrier);if(!master?.length)return null;
    const copies=frameCtx.visibleInstances?.copies||[];if(!copies.length)return{handled:true,commandBuffer:null};
    const opt=buildCorridorGPUOptions(frameCtx,{...extra,copyCacheVariant:`layer-scene-${role}-${frameCtx.geometryPlan?.dynamic===true?'morph':'static'}`,weightForCopy:null,deferComposite:true,dynamicSegments:frameCtx.geometryPlan?.dynamic===true,layerSceneRole:role,layerSceneClear:clearScene,forceResidentCopyPayload:true});
    return WebGPUStrokeRenderer.renderCorridor(master,copies,null,opt);
}

// v522.9 — explain the first concrete reason why ordinary Base could not stay on WebGPU.
// This is used both by the orange UI tooltip and by the automatic console diagnostic.
function describeBaseGpuFallback(frameCtx,batch,forceCompatibility=false,forceCanvasBase=false){
    if(forceCompatibility)return'compatibility isolation forced Canvas Base';
    if(forceCanvasBase)return'Base policy forced Canvas';
    let st=null,geom=null;try{st=WebGPUStrokeRenderer.status?.()||null;}catch(_){}try{geom=GeometryGPURenderer.status?.()||null;}catch(_){}
    const hub=st?.hub||null;
    if(hub?.supported===false||globalThis.navigator?.gpu==null)return'WebGPU unavailable: navigator.gpu missing';
    if(hub?.secure===false||globalThis.isSecureContext===false)return'WebGPU unavailable: insecure context';
    if(hub?.lastError)return`WebGPU device hub error: ${hub.lastError}`;
    if(st?.lastError)return`WebGPU stroke error: ${st.lastError}`;
    if(st?.available!==true)return st?.initializing===true?'WebGPU stroke renderer warming':'WebGPU stroke renderer not ready';
    if(!batch)return'WebGPU stroke batch was not created';
    if(!batch?.roles?.has?.('base'))return'WebGPU batch has no Base role';
    const glErr=geom?.webgl2?.lastError||'';
    if(glErr)return`WebGPU/Base composite failed; WebGL2 also failed: ${glErr}`;
    return'GPU Base render/composite returned false';
}

function canReserveStrictSpiralLateCanvasOverlay(frameCtx){
    const frame=frameCtx?.frame;if(!frame||isStrictSpiralWebGPUFrame(frameCtx))return false;
    const strictFrameIntent=frame.strictSpiralEntryIntent===true||frame.strictSpiralGpuPresentRequired===true;
    const isLastLayer=Number(frameCtx.layerIndex)===Math.max(0,Number(frame.renderLayerCount||1)-1);
    const cleanCanvasPrefix=frame.gpuMainCanvasHasContent!==true&&renderBackendTelemetry.hasMaterialization?.()!==true;
    const residentGpuPrefix=Boolean(WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId));
    return strictFrameIntent&&isLastLayer&&cleanCanvasPrefix&&residentGpuPrefix;
}
function reserveStrictSpiralLateCanvasOverlay(frameCtx,reason='last-layer compatibility overlay'){
    if(!canReserveStrictSpiralLateCanvasOverlay(frameCtx))return false;
    const frame=frameCtx.frame;
    frame.strictSpiralLateCanvasOverlay=true;
    frame.strictSpiralLateCanvasOverlayLayerIndex=Number(frameCtx.layerIndex)||0;
    // mainCanvas was cleared at frame start and the resident GPU prefix is never read back.
    // Reserve it now as a top-only overlay surface; Final uploads it once above Frame Scene.
    frame.gpuMainCanvasHasContent=true;
    frame.gpuMainSceneEmpty=false;
    renderBackendTelemetry.mark('final','gpu',`strict Spiral keeps GPU prefix resident; ${reason}`);
    return true;
}

function tryOpenGpuCorridorFillLayerScene(frameCtx){
    const contract=getLayerGeometryContract(frameCtx);
    if(!contract?.fillRequested||state.tunnel?.active!==true)return{handled:false,required:false,reason:'not a Corridor Fill'};
    if(contract.nativeGpuFillEligible!==true)return{handled:false,required:true,reason:'Corridor Fill has no native GPU topology for this frame'};
    // Somata 7.2.8: static Fill reuses its canonical plan; dynamic Morph Fill reuses the
    // exact frame-resident Corridor command rail. Both paths feed the same WebGPU stencil
    // renderer and join the same resident Layer Scene.
    const mesh=frameCtx?._corridorNativeFillPreflight||frameCtx?._fillMeshShadow||
        (frameCtx?.geometryPlan?.dynamic===true?getDynamicCorridorFillMesh(frameCtx):FillMeshPreparer.prepareFrame?.(frameCtx));
    if(!mesh?.nativeComplete||!mesh?.fanTriangleCount){
        // A Spiral Morph Corridor may legitimately expose an open retained rail for this
        // phase. There is then no fillable closed contour. Fill is optional visual content:
        // skip it for this frame and keep Morph/Base advancing instead of retrying forever.
        if(frameCtx?.geometryPlan?.dynamic===true&&contract?.spiral===true)
            return{handled:false,required:false,suppressed:true,reason:'dynamic Spiral Corridor has no closed native Fill contour'};
        return{handled:false,required:true,reason:'canonical native Fill mesh unavailable'};
    }
    try{FillGPURenderer.isAvailable?.();}catch(_){}
    if(!FillGPURenderer.canEncodeMeshToTexture?.(frameCtx,mesh))return{handled:false,required:true,reason:'native WebGPU Fill pipeline warming/unavailable'};

    // Hotfix2 — Glow/retained-Spiral may already own this layer's deferred GPU scene.
    // A Fill must JOIN that scene (Glow -> Fill -> Base), not ask for a second scratch scene.
    // Asking getExternalLayerSceneTarget() while one is deferred returns null and used to create
    // the repeated "GPU Layer Scene target unavailable" / render-retry loop seen in «ярко1».
    const resident=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId);
    const target=resident?.texture?resident:WebGPUStrokeRenderer.getExternalLayerSceneTarget?.(frameCtx.frameId);
    if(!target?.texture)return{handled:false,required:true,reason:'GPU Layer Scene target unavailable'};
    const rec=FillGPURenderer.encodeCorridorMeshCommandToTexture?.(target.texture,frameCtx,mesh,mainCtx);
    if(!rec?.handled)return{handled:false,required:true,reason:rec?.reason||FillGPURenderer.status?.()?.nativeMesh?.lastError||'Corridor Fill encode failed'};
    if(rec.commandBuffer){
        let accepted=false;
        if(resident?.texture)accepted=queueLayerSceneEffectCommand(frameCtx,4,rec.commandBuffer,'corridor-native-fill');
        else accepted=WebGPUStrokeRenderer.deferExternalLayerScene?.(rec.commandBuffer,frameCtx.frameId,'corridor-native-fill')===true;
        if(!accepted)return{handled:false,required:true,reason:resident?.texture?'Corridor Fill command could not join resident Layer Scene':'Corridor Fill command could not become Layer Scene root'};
        frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=false;frameCtx._corridorLayerSceneActive=true;
    }
    frameCtx._nativeFillMeshCandidate=mesh;
    return{handled:true,required:true,deferred:Boolean(rec.commandBuffer),joinedResident:Boolean(resident?.texture),triangles:Number(rec.triangles||0)+Number(rec.windingTriangles||0)};
}

function renderLayerBaseGeometryPass(frameCtx) {
    mainCtx.globalAlpha = 1;mainCtx.shadowBlur = 0;
    const strictSpiralGpu=isStrictSpiralWebGPUFrame(frameCtx);if(strictSpiralGpu&&frameCtx?.frame)frameCtx.frame.strictSpiralGpuPresentRequired=true;
    // Somata 6.8 Spiral contract: compatibility isolation must never turn a retained Bézier
    // Spiral into a Canvas/WebGL base. During WebGPU warmup we prefer one skipped frame over
    // mixing renderers and desynchronizing the shared effect rail.
    const forceCompatibility=(typeof spiroIsCompatibilityForced==='function'&&spiroIsCompatibilityForced('geometry'))&&!strictSpiralGpu;
    const forceCanvasBase=shouldForceCanvasBaseStroke(frameCtx)&&!strictSpiralGpu;
    const batch=frameCtx._webgpuStrokeBatch,contract=getLayerGeometryContract(frameCtx);
    if(strictSpiralGpu){const d=somataSpiralSceneDiag.base;d.frameId=Number(frameCtx.frameId)||0;d.stage='base-enter';d.hasBatch=Boolean(batch);d.sceneCombined=batch?.sceneCombined===true;d.hasSceneTexture=Boolean(batch?.sceneTexture);d.roles=batch?.roles?[...batch.roles]:[];}
    const forceCanvasFill=shouldForceCanvasStaticFill(frameCtx);
    // Strict Spiral keeps the entire effect stack in one WebGPU Layer Scene. The historical
    // Canvas-era Web-under-base detour would ask Web to render before that scene exists.
    // Queue Spiral Web later into the already-resident GPU scene; a dedicated behind blend
    // can refine ordering without reintroducing a CPU/Canvas bridge.
    const webNeedsUnderBase=frameCtx.effectsPlan?.web?.enabled===true&&!strictSpiralGpu;
    noteFillRuntime(frameCtx,{handled:false,stage:'contract',backend:'none',reason:'',nativeCandidate:Boolean(frameCtx?._nativeFillMeshCandidate)});
    let layerSceneCompositeFailed=false;
    const fillPrepared=frameCtx?._webgpuFillPrepared;
    const sceneHasAuthoritativeFill=batch?.fillInScene===true&&(fillPrepared?.authoritative===true||batch?.nativeFillInScene===true)&&(!strictSpiralGpu||batch?.nativeFillInScene===true);
    const needsOutOfSceneFill=contract?.fillRequested===true&&!sceneHasAuthoritativeFill;
    // Static Fill may deliberately remain on Canvas while the line stays GPU-resident.
    // Decide this BEFORE telemetry marks the Canvas Fill so the expected scene-input upload
    // is not mistaken for a fallback/materialization that blocks final GPU presentation.
    const canKeepGpuSceneOverCanvasFill=Boolean(!strictSpiralGpu&&forceCanvasFill&&!forceCompatibility&&!forceCanvasBase&&batch?.sceneCombined&&canDeferLayerSceneDirect(frameCtx,batch));

    if(!webNeedsUnderBase&&!forceCompatibility&&!forceCanvasBase&&!forceCanvasFill&&batch?.sceneCombined&&!needsOutOfSceneFill){
        if(canDeferLayerSceneForFrame(frameCtx,batch)&&WebGPUStrokeRenderer.deferLayerScene(batch,frameCtx.frameId)){
            frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=strictSpiralGpu?frameCtx.frame.gpuMainCanvasHasContent!==true:false;
            if(batch.roles?.has?.('base'))frameCtx._baseStrokeCommitted=true;
            if(strictSpiralGpu)somataSpiralSceneDiag.base.stage='internal-batch-deferred';
            renderBackendTelemetry.mark('geometry','gpu','deferred WebGPU Layer Scene');
            if(contract?.fillRequested){
                if(fillPrepared?.authoritative===true&&fillPrepared?.mask&&!batch?.nativeFillInScene)renderBackendTelemetry.mark('fill','canvas','Canvas fill-rule mask');
                renderBackendTelemetry.mark('fill','gpu',batch?.nativeFillInScene===true?'native WebGPU fill':'resident GPU fill-mask composite');
                if(sceneHasAuthoritativeFill)noteFillRuntime(frameCtx,{handled:true,stage:'layer-scene-deferred',backend:batch?.nativeFillInScene===true?'webgpu-native-scene':'webgpu-mask-scene',reason:''});
            }
            renderLayerGeometryCirclesPass(frameCtx);
            return;
        }
        // A strict Spiral never materializes a resident GPU prefix into Canvas. If the Layer
        // Scene cannot be deferred yet, wait for WebGPU readiness and retry next frame.
        if(strictSpiralGpu){somataSpiralSceneDiag.base.stage='internal-batch-defer-wait';renderBackendTelemetry.mark('geometry','gpu','strict Spiral Layer Scene unavailable; no fallback');somataGpuContractError('SPIRAL_LAYER_SCENE_DEFER_FAILED',frameCtx,{internal:{...somataSpiralSceneDiag.internal},external:{...somataSpiralSceneDiag.external}});try{WebGPUStrokeRenderer.warmup?.();requestMainCanvasRender?.();}catch(_){}return;}
        // A prior compatible non-Spiral layer may already be resident in the global GPU frame scene.
        if(WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)){WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId,mainCtx,true);frameCtx.frame.gpuMainSceneEmpty=false;}
        if(WebGPUStrokeRenderer.compositeLayerScene(batch,mainCtx)){
            if(contract?.fillRequested&&sceneHasAuthoritativeFill)noteFillRuntime(frameCtx,{handled:true,stage:'layer-scene-composite',backend:batch?.nativeFillInScene===true?'webgpu-native-scene':'webgpu-mask-scene',reason:''});
            renderLayerGeometryCirclesPass(frameCtx);return;
        }
        layerSceneCompositeFailed=true;
        if(batch.roles?.has?.('glow'))WebGPUStrokeRenderer.compositeLayerBatch(batch,'glow',mainCtx,'source-over');
    }else if(!webNeedsUnderBase&&!forceCompatibility&&!forceCanvasBase&&!forceCanvasFill&&batch?.sceneCombined&&needsOutOfSceneFill){
        // Iter19 defensive rule: an unavailable optional Fill may never suppress the strict
        // retained-Bezier carrier. GeometryContract normally filters topology-less Spiral Fill;
        // if a future dynamic contract requests Fill before its GPU representation is ready,
        // publish Base/Glow now and keep Fill GPU-only rather than returning a blank frame.
        if(strictSpiralGpu){
            if(canDeferLayerSceneForFrame(frameCtx,batch)&&WebGPUStrokeRenderer.deferLayerScene(batch,frameCtx.frameId)){
                frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;frameCtx._strictSpiralFillDeferred=true;
                if(batch.roles?.has?.('base'))frameCtx._baseStrokeCommitted=true;
                renderBackendTelemetry.mark('geometry','gpu','strict Spiral retained-Bezier Base preserved while Fill unavailable');
                renderBackendTelemetry.mark('fill','gpu','strict Spiral Fill deferred; Canvas split forbidden');
                noteFillRuntime(frameCtx,{handled:false,stage:'spiral-gpu-deferred',backend:'webgpu',reason:'Fill unavailable; Base remains GPU-resident'});
                renderLayerGeometryCirclesPass(frameCtx);try{requestMainCanvasRender?.();}catch(_){}return;
            }
            renderBackendTelemetry.mark('fill','gpu','strict Spiral Fill unavailable; no fallback');somataGpuContractError('SPIRAL_FILL_GPU_UNAVAILABLE',frameCtx,{contract});try{WebGPUStrokeRenderer.warmup?.();requestMainCanvasRender?.();}catch(_){}return;
        }
        if(WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)){WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId,mainCtx,true);frameCtx.frame.gpuMainSceneEmpty=false;}
        // Preserve the historical ordering Glow -> Fill -> Base. A combined Layer Scene
        // without authoritative fill cannot be composited/deferred as one texture.
        layerSceneCompositeFailed=true;fillMaskValidationStats.sceneSplit++;geometryContractStats.sceneSplitForFill++;
        if(batch.roles?.has?.('glow'))WebGPUStrokeRenderer.compositeLayerBatch(batch,'glow',mainCtx,'source-over');
    }

    const fillUsesCanvasMask=Boolean(frameCtx?._webgpuFillPrepared?.authoritative===true&&frameCtx?._webgpuFillPrepared?.mask&&!batch?.nativeFillInScene);
    let fillHandled=frameCtx._baseFillCommitted===true||(forceCompatibility||forceCanvasFill?false:(sceneHasAuthoritativeFill&&!layerSceneCompositeFailed));
    if(fillHandled&&frameCtx._baseFillCommitted!==true){
        fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;if(batch?.nativeFillInScene===true)geometryContractStats.nativeMeshFill++;
        if(contract?.fillRequested){
            if(fillUsesCanvasMask)renderBackendTelemetry.mark('fill','canvas','Canvas fill-rule mask');
            renderBackendTelemetry.mark('fill','gpu',batch?.nativeFillInScene===true?'native WebGPU fill':'GPU fill-mask composite');
            noteFillRuntime(frameCtx,{handled:true,stage:'layer-scene',backend:batch?.nativeFillInScene===true?'webgpu-native-scene':'webgpu-mask-scene',reason:''});
        }
    }
    else if(!fillHandled&&!forceCompatibility&&!forceCanvasFill){
        // Corridor Fill is part of the same resident WebGPU Layer Scene as Graffiti/Base.
        // Do not render it to a hidden WebGPU canvas and then drawImage() through Canvas2D.
        const corridorFill=state.tunnel?.active===true?tryOpenGpuCorridorFillLayerScene(frameCtx):null;
        if(corridorFill?.suppressed){
            fillHandled=true;
            renderBackendTelemetry.mark('fill','gpu','dynamic Spiral Corridor Fill skipped: no closed topology');
            noteFillRuntime(frameCtx,{handled:true,stage:'corridor-no-closed-fill',backend:'none',reason:corridorFill.reason||'no closed native Fill contour'});
        }else if(corridorFill?.handled){
            fillHandled=true;fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;geometryContractStats.nativeMeshFill++;
            renderBackendTelemetry.mark('fill','gpu','native WebGPU Corridor Fill Layer Scene');
            noteFillRuntime(frameCtx,{handled:true,stage:'corridor-layer-scene',backend:'webgpu-native-corridor-scene',reason:''});
        }else if(!corridorFill?.required){
            fillHandled=tryRenderLayerFillGPU(frameCtx);
            if(fillHandled&&contract?.fillRequested){
                if(Boolean(frameCtx?._webgpuFillPrepared?.authoritative===true&&frameCtx?._webgpuFillPrepared?.mask))renderBackendTelemetry.mark('fill','canvas','Canvas fill-rule mask');
                renderBackendTelemetry.mark('fill','gpu','GPU fill compositor');
                let active='gpu';try{active=FillGPURenderer.status?.()?.active||'gpu';}catch(_){}
                noteFillRuntime(frameCtx,{handled:true,stage:'gpu-draw',backend:String(active),reason:''});
            }
        }else{
            // If a strict-Spiral GPU prefix is already resident and this is the final non-Spiral
            // layer, an unavailable scratch Layer Scene is not a reason to deadlock. Reserve the
            // exact late Canvas overlay and fall through to renderExactLayerFillCanvas() below.
            const lateOverlayRecovered=reserveStrictSpiralLateCanvasOverlay(frameCtx,'Corridor Fill Layer Scene unavailable; exact late overlay');
            if(lateOverlayRecovered){
                renderBackendTelemetry.mark('fill','canvas','Corridor Fill recovered as strict late Canvas overlay');
                noteFillRuntime(frameCtx,{handled:false,stage:'corridor-late-overlay',backend:'canvas',reason:corridorFill.reason||'GPU Fill Layer Scene unavailable'});
            }else{
                renderBackendTelemetry.mark('fill','gpu','Corridor Fill GPU-only wait; Canvas fallback blocked');
                noteFillRuntime(frameCtx,{handled:false,stage:'corridor-gpu-wait',backend:'webgpu',reason:corridorFill.reason||'GPU Fill unavailable'});
                somataGpuDiagnosticError('fill','corridor-native-fill',corridorFill.reason||'GPU Fill unavailable',frameCtx,{fill:FillGPURenderer.status?.()||null});
                try{requestMainCanvasRender?.();}catch(_){}
            }
        }
    }
    if(!fillHandled&&contract?.fillRequested){
        // 7.2.3 — when a non-Spiral LAST layer is explicitly isolated as the safe late
        // Canvas overlay, Corridor Fill may use its exact Canvas path. The resident strict
        // Spiral prefix is never read back; Final uploads this overlay once and composites it
        // above the GPU scene. The strict Spiral layer itself remains Canvas-forbidden.
        const lateCanvasOverlayAllowed=Boolean(!strictSpiralGpu&&frameCtx.frame?.strictSpiralLateCanvasOverlay===true&&Number(frameCtx.layerIndex)===Math.max(0,Number(frameCtx.frame?.renderLayerCount||1)-1));
        const corridorGpuOnly=state.tunnel?.active===true&&!forceCompatibility&&!forceCanvasFill&&!lateCanvasOverlayAllowed;
        if(strictSpiralGpu||corridorGpuOnly){
            renderBackendTelemetry.mark('fill','gpu',strictSpiralGpu?'Spiral Fill GPU-only warmup; Canvas fill forbidden':'Corridor Fill GPU-only warmup; Canvas fill forbidden');
            noteFillRuntime(frameCtx,{handled:false,stage:strictSpiralGpu?'spiral-gpu-wait':'corridor-gpu-wait',backend:'webgpu',reason:'Canvas fallback forbidden for GPU-resident Fill'});
            if(corridorGpuOnly)somataGpuDiagnosticError('fill','corridor-gpu-wait','Canvas fallback blocked; waiting for native WebGPU Fill',frameCtx,{fill:FillGPURenderer.status?.()||null});
            try{requestMainCanvasRender?.();}catch(_){}
        }else{
            fillHandled=renderExactLayerFillCanvas(frameCtx);
            if(fillHandled)renderBackendTelemetry.mark('fill','canvas',forceCanvasFill?'authoritative static Canvas fill':(forceCompatibility?'isolated exact Canvas fill':'exact Canvas fill'),forceCanvasFill&&!canKeepGpuSceneOverCanvasFill?true:!forceCanvasFill);
            else{
                fillMaskValidationStats.canvasFallback++;
                const g=contract?.geometry||{};
                let reason='all Fill backends returned false';
                if(frameCtx?.geometryPlan?.dynamic!==true&&g.hasClosedFillTopology!==true)reason=`no closed fill topology (closed=${Number(g.closedPathCount)||0}, open=${Number(g.openPathCount)||0}, fillContours=${Number(g.fillContourCount)||0})`;
                else{try{const fs=FillGPURenderer.status?.();const e=fs?.nativeMesh?.lastError||fs?.webgpuMask?.lastError||fs?.webgl2?.lastError;if(e)reason=String(e);}catch(_){} }
                noteFillFailureOnce(frameCtx,'backend-chain',reason);
            }
        }
    }
    if(fillHandled)frameCtx._baseFillCommitted=true;

    // 7.0.6 — Graffiti is the authored visible stroke. The ordinary carrier exists only so
    // Glow/Arc/effects can follow the exact Spiral rail; drawing Base would put a normal line
    // underneath the Graffiti. Treat this as a successful intentional suppression, not as
    // SPIRAL_BASE_GPU_UNAVAILABLE.
    const graffitiReplacesBase=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
    if(graffitiReplacesBase){
        frameCtx._baseStrokeCommitted=true;frameCtx._baseStrokeSuppressedByGraffiti=true;
        if(strictSpiralGpu)somataSpiralSceneDiag.base.stage='base-intentionally-suppressed-by-graffiti';
        renderBackendTelemetry.mark('geometry','gpu','Base intentionally replaced by GPU Graffiti');
        renderLayerGeometryCirclesPass(frameCtx);
        return;
    }

    // v539 — same-colour Tunnel Base joins the deferred GPU Layer Scene. If Glow already
    // opened the scene, queue Base after it; otherwise Base becomes the root command.
    const residentBeforeCorridorBase=getResidentGpuLayerScene(frameCtx);
    if(!strictSpiralGpu&&(!fillHandled||Boolean(residentBeforeCorridorBase?.texture))&&!webNeedsUnderBase&&frameCtx.lineProfileStrokeOnly!==true&&canUseGpuOnlyCorridorLayerScene(frameCtx,false)){
        const sceneAlreadyActive=Boolean(residentBeforeCorridorBase?.texture);
        const rec=encodeGpuOnlyCorridorLayerRole(frameCtx,'base',{effectMode:'base',alphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1))),composite:'source-over'},!sceneAlreadyActive);
        if(rec?.handled&&rec.commandBuffer){
            let accepted=false;
            if(sceneAlreadyActive)accepted=queueLayerSceneEffectCommand(frameCtx,5,rec.commandBuffer,'corridor-base');
            else accepted=WebGPUStrokeRenderer.deferExternalLayerScene?.(rec.commandBuffer,frameCtx.frameId,'corridor-base')===true;
            if(accepted){frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=false;frameCtx._corridorLayerSceneActive=true;frameCtx._baseStrokeCommitted=true;renderBackendTelemetry.mark('geometry','gpu','GPU Corridor Layer Scene');renderLayerGeometryCirclesPass(frameCtx);return;}
        }
        if(sceneAlreadyActive){if(strictSpiralGpu){somataGpuContractError('CORRIDOR_BASE_GPU_ENCODE_FAILED',frameCtx,{role:'base'});try{WebGPUStrokeRenderer.clearDeferredLayerScene?.();}catch(_){}frameCtx.frame.gpuLayerSceneDeferred=false;frameCtx._corridorLayerSceneActive=false;return;}materializeDeferredLayerScene(frameCtx);frameCtx._corridorLayerSceneActive=false;}
    }

    // v522.16 — Web is an underlay relative to the visible line. Render it after Fill but
    // before Base so fill semantics stay unchanged while every line/profile pass remains in front.
    // The normal later Web pass becomes a no-op for this layer.
    if(webNeedsUnderBase){
        try{frameCtx._webRenderedUnderBase=false;renderLayerWebPass(frameCtx);frameCtx._webRenderedUnderBase=true;if(frameCtx.frame)frameCtx.frame.gpuMainCanvasHasContent=true;}
        catch(err){try{spiroPassIsolationNoteFailure?.('web-under-base',err,frameCtx);}catch(_){}}
    }

    // v522.7 — hybrid static contract: exact Fill may already be in mainCanvas, while the
    // ordinary line/effects remain in the WebGPU Layer Scene. Defer that scene directly to
    // finalGpuCanvas instead of downloading the GPU line back through Canvas2D drawImage().
    // The final compositor uploads mainCanvas once as the under-scene and blends this texture
    // above it, preserving historical Fill -> Base ordering without a GPU -> Canvas readback.
    if(canKeepGpuSceneOverCanvasFill&&batch?.roles?.has?.('base')&&WebGPUStrokeRenderer.deferLayerScene(batch,frameCtx.frameId)){
        frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=false;
        frameCtx._baseStrokeCommitted=true;
        renderBackendTelemetry.mark('geometry','gpu','deferred WebGPU base to finalGpuCanvas');
        renderLayerGeometryCirclesPass(frameCtx);
        return;
    }

    // Fill has already been rendered by either GPU or exact Canvas. Base fallback must
    // therefore be stroke-only, otherwise a WebGPU failure would double-apply fill alpha.
    const prevSuppressFill=mainCtx.__suppressFill;
    if(fillHandled)mainCtx.__suppressFill=true;
    const pathFxReplacesStroke=isPathFxBaseReplacementActive(frameCtx);
    if(pathFxReplacesStroke){renderBackendTelemetry.mark('geometry',frameCtx._pathFxCanvasSprite===true?'canvas':'gpu',frameCtx.effectsPlan?.sprite?.enabled===true&&!lineSpritePlacementIsSparse(frameCtx.effectsPlan?.sprite?.cfg?.mode)?'base replaced by textured Sprite':'base replaced by Moving Line');}
    else if(frameCtx._baseStrokeCommitted===true&&frameCtx._fusedMorphBackend){renderBackendTelemetry.mark('geometry','gpu',frameCtx._fusedMorphBackend==='green'?'fused Green Morph Glow+Base':(frameCtx._fusedMorphBackend==='spiral-bezier'?'fused Spiral Bézier Morph Glow+Base':'fused Topology Morph Glow+Base'));}
    else if(frameCtx._baseStrokeCommitted!==true){
        let spiralBezierBase=false,greenProjectBase=false,topologyBase=false;
        if(!forceCanvasBase&&!forceCompatibility&&typeof WebGPUSpiralBezierMorphRenderer!=='undefined'&&WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'base')){
            const route=resolveGpuSpiralBezierSceneRoute(frameCtx);
            spiralBezierBase=(route.deferLayerScene||route.deferFrameScene)&&WebGPUSpiralBezierMorphRenderer.render(frameCtx,mainCtx,{mode:'base',alphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1))),deferFrameScene:route.deferFrameScene,deferLayerScene:route.deferLayerScene,layerScenePhase:5,layerSceneLabel:'spiral-base'})===true;
        }
        if(!strictSpiralGpu&&!spiralBezierBase&&!forceCanvasBase&&!forceCompatibility&&typeof WebGPUGreenProjectMorphRenderer!=='undefined'&&WebGPUGreenProjectMorphRenderer.isEligible?.(frameCtx)){
            greenProjectBase=WebGPUGreenProjectMorphRenderer.render(frameCtx,mainCtx,{mode:'base',alphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1)))})===true;
        }
        if(!strictSpiralGpu&&!spiralBezierBase&&!greenProjectBase&&!forceCanvasBase&&!forceCompatibility&&typeof WebGPUTopologyMorphBaseRenderer!=='undefined'&&WebGPUTopologyMorphBaseRenderer.isEligible?.(frameCtx,'base')){
            topologyBase=WebGPUTopologyMorphBaseRenderer.render(frameCtx,mainCtx,{mode:'base',alphaScale:Math.max(0,Math.min(1,Number(frameCtx.lineOpacityFactor??1)))})===true;
        }
        const batchedBase=!strictSpiralGpu&&!spiralBezierBase&&!greenProjectBase&&!topologyBase&&!forceCanvasBase&&(!forceCompatibility&&batch?.roles?.has?.('base')&&WebGPUStrokeRenderer.compositeLayerBatch(batch,'base',mainCtx,'source-over'));
        let renderedGPU=spiralBezierBase||greenProjectBase||topologyBase||batchedBase,immediateBackend=spiralBezierBase?'webgpu-spiral-bezier':(greenProjectBase?'webgpu-green-project':(topologyBase?'webgpu-topology':'none'));
        if(!renderedGPU&&!forceCanvasBase&&!forceCompatibility&&!strictSpiralGpu){
            renderedGPU=tryRenderBaseGeometryGPU(frameCtx);
            try{immediateBackend=String(GeometryGPURenderer.status?.()?.active||'none');}catch(_){}
        }
        if(!renderedGPU){
            if(strictSpiralGpu){
                somataSpiralSceneDiag.base.stage='no-base-renderer-committed';
                try{WebGPUStrokeRenderer.warmup?.();WebGPUSpiralBezierMorphRenderer?.warmup?.();}catch(_){}
                renderBackendTelemetry.mark('geometry','gpu','Spiral Full WebGPU base unavailable');
                somataGpuContractError('SPIRAL_BASE_GPU_UNAVAILABLE',frameCtx,{reason:describeBaseGpuFallback(frameCtx,batch,false,false),spiral:WebGPUSpiralBezierMorphRenderer?.status?.()||null,stroke:WebGPUStrokeRenderer?.status?.()||null});
                // Iter21 — do not lie about Base commitment, but also do not invalidate or
                // freeze the entire frame. The animation/effect graph keeps advancing and Base
                // retries on the next render request.
                try{requestMainCanvasRender?.();}catch(_){}
            }else{
                const why=describeBaseGpuFallback(frameCtx,batch,forceCompatibility,forceCanvasBase);
                renderBackendTelemetry.mark('geometry','canvas',why,true);
                const prevLineOpacityOnly=mainCtx.__spiroLineOpacityOnly;mainCtx.__spiroLineOpacityOnly=true;
                try{frameCtx.drawLayerInstances(mainCtx);}finally{if(prevLineOpacityOnly===undefined)delete mainCtx.__spiroLineOpacityOnly;else mainCtx.__spiroLineOpacityOnly=prevLineOpacityOnly;}
                frameCtx._baseStrokeCommitted=true;
            }
        }else{
            const why=greenProjectBase?'GPU-native green project Morph':(topologyBase?'GPU-native topology Morph':(batchedBase?'WebGPU layer batch':(immediateBackend==='webgpu'?'WebGPU geometry':(immediateBackend==='webgl2'?'WebGL2 geometry fallback':'GPU geometry'))));
            renderBackendTelemetry.mark('geometry','gpu',why);
            frameCtx._baseStrokeCommitted=true;
        }
    }
    if(prevSuppressFill===undefined)delete mainCtx.__suppressFill;else mainCtx.__suppressFill=prevSuppressFill;
    renderLayerGeometryCirclesPass(frameCtx);
}

function renderLayerOutlinePass(frameCtx) {
    const effect=frameCtx.effectsPlan?.outline;
    if(!effect?.enabled)return;
    const strictSpiralOutline=isStrictSpiralWebGPUFrame(frameCtx);
    if(strictSpiralOutline&&frameCtx.lineDisplayEnabled===true&&frameCtx.lineProfileStrokeOnly!==true&&
        frameCtx._baseStrokeCommitted!==true&&!(typeof isPathFxBaseReplacementActive==='function'&&isPathFxBaseReplacementActive(frameCtx))){
        renderBackendTelemetry.mark('outline','gpu','strict Spiral waits for committed Base; outline-only frame suppressed');
        return;
    }
    if(frameCtx._webgpuStrokeBatch?.outlineInScene===true){renderBackendTelemetry.mark('outline','gpu','Layer Scene');return;}
    const {layer,baseAlpha,visibleInstances,frameVectorMaster,frameVectorMasterScale,drawLayerInstances}=frameCtx;
    const mode=['outer','inner','median'].includes(effect.mode)?effect.mode:'outer';
    const outerAdd=Math.max(0,Number(effect.outerAdd)||0),coreInset=Math.max(0,Number(effect.coreInset)||0);
    if(frameCtx.lineProfileStrokeOnly&&frameCtx.lineProfileApplication==='stroke'){
        let ok=true;
        if(outerAdd>0)ok=tryRenderStrokeMarkerEffectGPU(frameCtx,{mode:'outline',extraLocal:outerAdd,colorOverride:effect.color,alpha:baseAlpha,composite:mode==='outer'?'destination-over':'source-over'});
        if(ok&&coreInset>0)ok=tryRenderStrokeMarkerEffectGPU(frameCtx,{mode:'core',colorOverride:effect.color,alpha:baseAlpha,composite:'source-over'});
        if(ok){renderBackendTelemetry.mark('outline','gpu','GPU marker outline');return;}
    }
    if(effect.graffiti){
        if(!effect.paths?.length&&effect.profilePrepared?.gpuMorphNative!==true)return;
        // v349: multi-layer destination-over must live below all previously drawn layers.
        // Accumulate it in a frame-global GPU underlay; local Layer Scene remains valid only
        // for single-layer ordering. Core-inset Graffiti keeps the exact fallback for now.
        const globalGraffitiUnderlay=effect.mode==='outer'&&Number(frameCtx.frame?.renderLayerCount||0)>1&&!effect.coreLayer;
        if(globalGraffitiUnderlay){
            const under=WebGPUStrokeRenderer.prepareFrameUnderlay?.(frameCtx.frameId);let rec=null;
            if(under?.texture){
                mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
                if(effect.tunnelActive){
                    if(effect.profilePrepared?.gpuMorphNative===true)rec=WebGPUGraffitiMorphRenderer.encodeCorridorToLayerScene(under.texture,effect.profilePrepared,effect.outlineLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'destination-over',{width:effect.width,color:effect.color});
                    else if(effect.raster?.bitmap)rec=WebGPUGraffitiBitmapRenderer.encodeCorridorToLayerScene(under.texture,effect.raster,mainCtx,baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'destination-over');
                    else if(effect.profilePrepared?.gpuRibbonEligible===true)rec=WebGPUGraffitiRibbonRenderer.encodeCorridorToLayerScene(under.texture,effect.profilePrepared,effect.outlineLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'destination-over',{width:effect.width,color:effect.color});
                }else{
                    const a=baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1)));
                    if(effect.profilePrepared?.gpuMorphNative===true)rec=WebGPUGraffitiMorphRenderer.encodeToLayerScene(under.texture,effect.profilePrepared,effect.outlineLayer,a,mainCtx,'destination-over',{width:effect.width,color:effect.color});
                    else if(effect.raster?.bitmap)rec=WebGPUGraffitiBitmapRenderer.encodeToLayerScene(under.texture,effect.raster,mainCtx,a,'destination-over');
                    else if(effect.profilePrepared?.gpuRibbonEligible===true)rec=WebGPUGraffitiRibbonRenderer.encodeToLayerScene(under.texture,effect.profilePrepared,effect.outlineLayer,a,mainCtx,'destination-over',{width:effect.width,color:effect.color});
                }
                mainCtx.restore();
            }
            if(rec?.handled&&(!rec.commandBuffer||WebGPUStrokeRenderer.submitFrameUnderlayCommand?.(frameCtx.frameId,rec.commandBuffer))){renderBackendTelemetry.mark('outline','gpu','GPU underlay');if(effect.raster?.bitmap)GraffitiWorker.stats.used++;return;}
            WebGPUStrokeRenderer.abandonFrameUnderlay?.(frameCtx.frameId,mainCtx);
        }
        // v343: outer Graffiti outline bitmap is composited destination-over directly
        // into the deferred Layer Scene. No GPU->Canvas2D->GPU round-trip is needed.
        if(frameCtx.frame?.gpuLayerSceneDeferred&&effect.mode==='outer'){
            const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId);
            if(scene?.texture){
                mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
                let rec=null;
                if(effect.tunnelActive){
                    if(effect.profilePrepared?.gpuMorphNative===true)rec=WebGPUGraffitiMorphRenderer.encodeCorridorToLayerScene(scene.texture,effect.profilePrepared,effect.outlineLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'destination-over',{width:effect.width,color:effect.color});
                    else if(effect.raster?.bitmap)rec=WebGPUGraffitiBitmapRenderer.encodeCorridorToLayerScene(scene.texture,effect.raster,mainCtx,baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'destination-over');
                    else if(effect.profilePrepared?.gpuRibbonEligible===true)rec=WebGPUGraffitiRibbonRenderer.encodeCorridorToLayerScene(scene.texture,effect.profilePrepared,effect.outlineLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'destination-over',{width:effect.width,color:effect.color});
                }else{
                    const a=baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1)));
                    if(effect.profilePrepared?.gpuMorphNative===true)rec=WebGPUGraffitiMorphRenderer.encodeToLayerScene(scene.texture,effect.profilePrepared,effect.outlineLayer,a,mainCtx,'destination-over',{width:effect.width,color:effect.color},frameCtx);
                    else if(effect.raster?.bitmap)rec=WebGPUGraffitiBitmapRenderer.encodeToLayerScene(scene.texture,effect.raster,mainCtx,a,'destination-over');
                    else if(effect.profilePrepared?.gpuRibbonEligible===true)rec=WebGPUGraffitiRibbonRenderer.encodeToLayerScene(scene.texture,effect.profilePrepared,effect.outlineLayer,a,mainCtx,'destination-over',{width:effect.width,color:effect.color});
                }
                mainCtx.restore();
                if(rec?.handled){renderBackendTelemetry.mark('outline','gpu',effect.profilePrepared?.gpuMorphNative===true?'GPU-native Morph Graffiti outline':'GPU Graffiti outline');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,10,rec.commandBuffer,effect.tunnelActive?(effect.raster?.bitmap?'graffiti-bitmap-outline-corridor':(effect.profilePrepared?.gpuMorphNative===true?'graffiti-morph-outline-corridor':'graffiti-variable-outline-corridor')):(effect.raster?.bitmap?'graffiti-outline':(effect.profilePrepared?.gpuMorphNative===true?'graffiti-morph-outline':'graffiti-variable-outline')),rec.onSubmitted);if(effect.raster?.bitmap)GraffitiWorker.stats.used++;return;}
            }
            if(strictSpiralOutline){renderBackendTelemetry.mark('outline','gpu','strict Spiral Graffiti outline GPU-only warmup');somataGpuContractError('SPIRAL_OUTLINE_GRAFFITI_GPU_UNAVAILABLE',frameCtx,{stage:'layer-scene'});try{requestMainCanvasRender?.();}catch(_){}return;}
            materializeDeferredLayerScene(frameCtx);
        }
        if(effect.profilePrepared?.gpuMorphNative===true){
            if(strictSpiralOutline){renderBackendTelemetry.mark('outline','gpu','strict Spiral Graffiti outline retained-Bézier wait');somataGpuContractError('SPIRAL_OUTLINE_RETAINED_BEZIER_UNAVAILABLE',frameCtx);try{requestMainCanvasRender?.();}catch(_){}return;}
            materializeGpuMorphGraffitiCpuFallback(frameCtx,effect,'outline-materialized');effect.profilePrepared=effect.prepared||effect.profilePrepared;if(!effect.paths?.length)return;
        }
        if(isStrictSpiralWebGPUFrame(frameCtx)){renderBackendTelemetry.mark('outline','gpu','Spiral Graffiti outline GPU-only warmup');try{requestMainCanvasRender?.();}catch(_){}return;}
        renderBackendTelemetry.mark('outline','canvas','Graffiti outline fallback',true);
        for(let oi=0;oi<visibleInstances.copies.length;oi++){
            const copy=visibleInstances.copies[oi],oa=visibleInstances.alphas[oi];
            if(!shouldDrawTunnelEffectIndex('graffiti',oi,frameCtx,effect.footprint))continue;
            mainCtx.save();mainCtx.globalCompositeOperation=mode==='outer'?'destination-over':'source-over';if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
            if(!(effect.raster&&GraffitiWorker.drawRaster(mainCtx,effect.raster,baseAlpha*oa)))drawGraffitiMarker(mainCtx,effect.paths,effect.outlineLayer,baseAlpha*oa,effect.profilePrepared,true);
            if(effect.coreLayer){mainCtx.globalCompositeOperation='source-over';drawGraffitiMarker(mainCtx,effect.paths,effect.coreLayer,baseAlpha*oa,effect.profilePrepared,true);}
            mainCtx.restore();
        }
        return;
    }
    if(frameCtx.lineProfileStrokeOnly)return;
    if(strictSpiralOutline){renderBackendTelemetry.mark('outline','gpu','strict Spiral outline waits for resident GPU scene; Canvas composite forbidden');try{requestMainCanvasRender?.();}catch(_){}return;}
    const globalOuterUnderlay=mode==='outer'&&Number(frameCtx.frame?.renderLayerCount||0)>1;
    if(globalOuterUnderlay&&frameCtx._webgpuStrokeBatch?.roles?.has?.('outline')){
        if(WebGPUStrokeRenderer.compositeLayerBatchToFrameUnderlay?.(frameCtx._webgpuStrokeBatch,'outline',frameCtx.frameId)){
            if(coreInset>0&&frameCtx._webgpuStrokeBatch.roles.has('core')&&!frameCtx._webgpuStrokeBatch.sceneCombined)WebGPUStrokeRenderer.compositeLayerBatch(frameCtx._webgpuStrokeBatch,'core',mainCtx,'source-over');
            return;
        }
        WebGPUStrokeRenderer.abandonFrameUnderlay?.(frameCtx.frameId,mainCtx);
    }
    if(frameCtx._webgpuStrokeBatch?.roles?.has?.('outline')){
        const outlineComposite=mode==='outer'?'destination-over':'source-over';
        if(WebGPUStrokeRenderer.compositeLayerBatch(frameCtx._webgpuStrokeBatch,'outline',mainCtx,outlineComposite)){
            if(coreInset>0&&frameCtx._webgpuStrokeBatch.roles.has('core'))WebGPUStrokeRenderer.compositeLayerBatch(frameCtx._webgpuStrokeBatch,'core',mainCtx,'source-over');
            return;
        }
    }
    if(!state.showRoundingGuides&&LineEffectsGPURenderer.isAvailable()){
        const outlineCorridorOpt={effectMode:'outline',extraLocal:outerAdd,baseLineWidth:effect.baseLineWidth,colorOverride:effect.color,alphaScale:1,composite:mode==='outer'?'destination-over':'source-over'};
        if(tryRenderCorridorLineEffectGPU(frameCtx,outlineCorridorOpt)){
            renderBackendTelemetry.mark('outline','gpu','GPU Corridor outline');
            if(coreInset>0)tryRenderCorridorLineEffectGPU(frameCtx,{effectMode:'coreInset',extraLocal:coreInset,baseLineWidth:effect.baseLineWidth,alphaScale:1,composite:'source-over'});
            return;
        }
        const commands=getFrameGLStrokeCommands(frameCtx);
        if(commands){
            const outlineOk=LineEffectsGPURenderer.render(commands,mainCtx,{mode:'outline',extraLocal:outerAdd,baseLineWidth:effect.baseLineWidth,colorOverride:effect.color,alphaScale:1,composite:mode==='outer'?'destination-over':'source-over'});
            if(outlineOk){
                renderBackendTelemetry.mark('outline','gpu','analytic GPU outline');
                if(coreInset>0)LineEffectsGPURenderer.render(commands,mainCtx,{mode:'coreInset',extraLocal:coreInset,baseLineWidth:effect.baseLineWidth,alphaScale:1,composite:'source-over'});
                return;
            }
        }
    }
    if(isStrictSpiralWebGPUFrame(frameCtx)){renderBackendTelemetry.mark('outline','gpu','Spiral outline GPU-only warmup; Canvas fallback forbidden');somataGpuContractError('SPIRAL_OUTLINE_GPU_UNAVAILABLE',frameCtx);try{requestMainCanvasRender?.();}catch(_){}return;}
    renderBackendTelemetry.mark('outline','canvas','Canvas outline fallback',true);
    mainCtx.save();mainCtx.globalCompositeOperation=mode==='outer'?'destination-over':'source-over';
    const combinedScale=Math.max(.001,frameCtx.combinedScale);
    const outlineDelta=(outerAdd*2)/combinedScale,coreDelta=-(coreInset*2)/combinedScale;
    if(frameVectorMaster?.commands?.length){
        for(let oi=0;oi<visibleInstances.copies.length;oi++){
            const copy=visibleInstances.copies[oi],oa=visibleInstances.alphas[oi];
            const ratio=effect.tunnelActive?copy.scale/frameVectorMasterScale:1;
            if(effect.tunnelActive)mainCtx.save(),applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);
            replayVectorRecording(mainCtx,frameVectorMaster,oa,ratio,{strokeOnly:true,suppressFill:true,strokeStyle:effect.color,lineWidthDelta:outlineDelta,lineJoin:effect.join,lineCap:'round',miterLimit:6});
            if(coreInset>0){mainCtx.globalCompositeOperation='source-over';replayVectorRecording(mainCtx,frameVectorMaster,oa,ratio,{strokeOnly:true,suppressFill:true,lineWidthDelta:coreDelta,lineJoin:effect.join,lineCap:'round',miterLimit:6});}
            if(effect.tunnelActive)mainCtx.restore();
        }
    }else{
        mainCtx.strokeStyle=effect.color;mainCtx.fillStyle='transparent';mainCtx.lineWidth=effect.baseLineWidth+outerAdd*2;mainCtx.lineJoin=effect.join;mainCtx.lineCap='round';mainCtx.miterLimit=6;
        mainCtx.__forceStrokeStyle=effect.color;mainCtx.__suppressFill=true;mainCtx.__forcedLineWidth=effect.baseLineWidth+outerAdd*2;
        drawLayerInstances(mainCtx,true);
        delete mainCtx.__forceStrokeStyle;delete mainCtx.__forcedLineWidth;
        if(coreInset>0){mainCtx.globalCompositeOperation='source-over';mainCtx.strokeStyle=layer.strokeColor||'#ffffff';mainCtx.lineWidth=Math.max(.001,effect.baseLineWidth-coreInset*2);mainCtx.__forcedLineWidth=mainCtx.lineWidth;drawLayerInstances(mainCtx,true);delete mainCtx.__forcedLineWidth;}
        delete mainCtx.__suppressFill;
    }
    mainCtx.restore();
}

function renderLayerProfilePass(frameCtx) {
    const effect=frameCtx.effectsPlan?.profile;
    if(!effect?.enabled)return;
    const gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();
    const strictSpiralProfileGpu=isStrictSpiralWebGPUFrame(frameCtx);
    const layer=frameCtx.layer,visibleInstances=frameCtx.visibleInstances,baseAlpha=Math.max(0,Math.min(1,Number(frameCtx.lineAlpha??frameCtx.baseAlpha)||0));
    const markerCoreInset=(effect.application==='stroke'&&frameCtx.effectsPlan?.outline?.enabled===true)?Math.max(0,Number(frameCtx.effectsPlan.outline.coreInset)||0):0;
    const markerCoreOpts=markerCoreInset>0?{widthDeltaLocal:-2*markerCoreInset}:{};
    // v336: if Base/Glow/Fill is already a deferred Layer Scene, keep Profile on that same
    // GPU texture.  No presentation canvas is touched and the command stays deferred.
    if(frameCtx.frame?.gpuLayerSceneDeferred&&effect.application==='stroke'&&(['slash','square','circle','cross'].includes(effect.prepared?.type))){
        const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId);
        if(scene?.texture){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const arcNative=effect.prepared?.gpuArcNative===true;
            // Iter17: marker-profile Glow is intentionally deferred until the profile pass in
            // strict Spiral. Glow runs before Base in the logical pass order, but the strict
            // marker carrier has no Canvas/hidden-overlay path; draw its analytic halo into the
            // same resident Layer Scene immediately before the opaque marker core instead.
            if(arcNative&&frameCtx.effectsPlan?.glow?.enabled===true){const g=frameCtx.effectsPlan.glow,ga=Math.max(0,Number(g.compositeAlpha)||0);const grec=WebGPUProfileArcMarkerRenderer.encodeToLayerScene(scene.texture,effect.prepared,layer,effect.tunnelActive?ga:ga*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,frameCtx,{mode:'glow',extraPx:Math.max(.5,(Number(g.amount)||0)*.55*frameCtx.frame.dpr)},effect.tunnelActive?visibleInstances.copies:null,effect.tunnelActive?visibleInstances.alphas:null,effect.footprint);if(grec?.handled&&grec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,19,grec.commandBuffer,'profile-bezier-arc-glow',grec.onSubmitted);}
            const rec=arcNative
                ? WebGPUProfileArcMarkerRenderer.encodeToLayerScene(scene.texture,effect.prepared,layer,effect.tunnelActive?baseAlpha:baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,frameCtx,markerCoreOpts,effect.tunnelActive?visibleInstances.copies:null,effect.tunnelActive?visibleInstances.alphas:null,effect.footprint)
                : (effect.tunnelActive
                    ? WebGPUProfileMarkerRenderer.encodeCorridorToLayerScene(scene.texture,effect.prepared?.table,layer,baseAlpha,mainCtx,effect.prepared,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,markerCoreOpts)
                    : WebGPUProfileMarkerRenderer.encodeToLayerScene(scene.texture,effect.prepared?.table,layer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,effect.prepared,markerCoreOpts));
            mainCtx.restore();
            if(rec?.handled){renderBackendTelemetry.mark('profile','gpu',arcNative?'retained Bézier GPU-Arc profile markers':'deferred GPU profile markers');noteProfileGpuSuccess('dash',effect.tunnelActive?'marker corridor layer-scene':'marker layer-scene','webgpu-layer-scene');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,20,rec.commandBuffer,arcNative?'profile-bezier-arc':'profile',rec.onSubmitted);return;}else{const st=arcNative?(WebGPUProfileArcMarkerRenderer.status?.()||{}):(WebGPUProfileMarkerRenderer.status?.()||{});noteProfileGpuFailure('dash','marker layer-scene',st.lastError||st.diagnostic?.reason||(st.initializing?'GPU marker pipeline warming':'marker Layer Scene encode returned not handled'),{renderer:st});}
        }
        // Driver/validation failure must never drop the effect: materialize the scene and
        // continue through the exact historical GPU/Canvas fallback below.
        if(strictSpiralProfileGpu){renderBackendTelemetry.mark('profile','gpu','Spiral profile GPU-only warmup');somataGpuContractError('SPIRAL_PROFILE_GPU_UNAVAILABLE',frameCtx,{profile:effect?.application||null});try{requestMainCanvasRender?.();}catch(_){}return;}
        materializeDeferredLayerScene(frameCtx);
    }
    // v514: plain topology-Morph Graffiti is expanded procedurally from the shared GPU
    // point stream. The command buffer contains Morph compute -> ribbon draw, so no CPU path,
    // side arrays, triangle mesh, or dynamic vertex upload exists on the fast path.
    if(gpuBackendAllowed&&effect.application==='graffiti'&&effect.prepared?.gpuMorphNative===true){
        if(frameCtx.frame?.gpuLayerSceneDeferred){
            const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId);let rec=null;
            if(scene?.texture){
                mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
                const g=frameCtx.effectsPlan?.glow;if(g?.enabled===true){const glowOpts={radiusPx:Math.max(.5,(Number(g.amount)||0)*.55*frameCtx.frame.dpr),alphaScale:Math.max(0,Number(g.compositeAlpha)||0),composite:'source-over'};const grec=effect.tunnelActive
                    ? WebGPUGraffitiMorphRenderer.encodeCorridorGlowToLayerScene?.(scene.texture,effect.prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,glowOpts)
                    : WebGPUGraffitiMorphRenderer.encodeGlowToLayerScene?.(scene.texture,effect.prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,glowOpts,frameCtx);
                    if(grec?.handled){if(grec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,19,grec.commandBuffer,effect.tunnelActive?'graffiti-morph-contour-glow-corridor':'graffiti-morph-contour-glow',grec.onSubmitted);renderBackendTelemetry.mark('glow','gpu','exact Morph Graffiti contour Glow');}
                    else{const gst=WebGPUGraffitiMorphRenderer.status?.()||{},cst=typeof WebGPUGraffitiContourGlow!=='undefined'?WebGPUGraffitiContourGlow.status?.():null;noteProfileGpuFailure('graffiti','contour glow',gst.lastError||cst?.lastError||'Morph Graffiti contour Glow encode returned not handled',{renderer:gst,contourGlow:cst});}
                }
                rec=effect.tunnelActive
                    ? WebGPUGraffitiMorphRenderer.encodeCorridorToLayerScene(scene.texture,effect.prepared,layer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over')
                    : WebGPUGraffitiMorphRenderer.encodeToLayerScene(scene.texture,effect.prepared,layer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',null,frameCtx);
                mainCtx.restore();
            }
            if(rec?.handled){renderBackendTelemetry.mark('profile','gpu','GPU-native Morph Graffiti');noteProfileGpuSuccess('graffiti',effect.tunnelActive?'morph corridor layer-scene':'morph layer-scene','webgpu-layer-scene');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,20,rec.commandBuffer,effect.tunnelActive?'graffiti-morph-corridor':'graffiti-morph',rec.onSubmitted);return;}else{const st=WebGPUGraffitiMorphRenderer.status?.()||{};noteProfileGpuFailure('graffiti','morph layer-scene',st.lastError||st.diagnostic?.reason||'GPU-native Morph encode returned not handled');}
            if(strictSpiralProfileGpu){renderBackendTelemetry.mark('profile','gpu','Spiral profile GPU-only warmup');somataGpuContractError('SPIRAL_PROFILE_GPU_UNAVAILABLE',frameCtx,{profile:effect?.application||null});try{requestMainCanvasRender?.();}catch(_){}return;}
        materializeDeferredLayerScene(frameCtx);
        }
        // Exact compatibility fallback is lazy: only a frame that could not stay in the
        // deferred GPU scene pays for CPU Morph paths and the historical ribbon mesh.
        materializeGpuMorphGraffitiCpuFallback(frameCtx,effect,'profile-materialized');
        if(!effect.paths?.length){renderBackendTelemetry.mark('profile','gpu','GPU-native Graffiti unavailable');return;}
    }

    // Graffiti core and Glow both stay in the deferred Layer Scene. Glow is a post-process
    // of the exact ribbon mask, so it follows calligraphic width/angle/variation without support wedges.
    if(frameCtx.frame?.gpuLayerSceneDeferred&&effect.application==='graffiti'&&effect.prepared?.gpuRibbonEligible===true){
        const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId);
        if(scene?.texture){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const g=frameCtx.effectsPlan?.glow;if(g?.enabled===true){const glowOpts={radiusPx:Math.max(.5,(Number(g.amount)||0)*.55*frameCtx.frame.dpr),alphaScale:Math.max(0,Number(g.compositeAlpha)||0),composite:'source-over'};const grec=effect.tunnelActive
                ? WebGPUGraffitiRibbonRenderer.encodeCorridorGlowToLayerScene?.(scene.texture,effect.prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,glowOpts)
                : WebGPUGraffitiRibbonRenderer.encodeGlowToLayerScene?.(scene.texture,effect.prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,glowOpts);
                if(grec?.handled){if(grec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,19,grec.commandBuffer,effect.tunnelActive?'graffiti-ribbon-contour-glow-corridor':'graffiti-ribbon-contour-glow');renderBackendTelemetry.mark('glow','gpu','exact Graffiti ribbon contour Glow');}
                else{const gst=WebGPUGraffitiRibbonRenderer.status?.()||{},cst=typeof WebGPUGraffitiContourGlow!=='undefined'?WebGPUGraffitiContourGlow.status?.():null;noteProfileGpuFailure('graffiti','contour glow',gst.lastError||cst?.lastError||'Graffiti ribbon contour Glow encode returned not handled',{renderer:gst,contourGlow:cst});}
            }
            const rec=effect.tunnelActive
                ? WebGPUGraffitiRibbonRenderer.encodeCorridorToLayerScene(scene.texture,effect.prepared,layer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over')
                : WebGPUGraffitiRibbonRenderer.encodeToLayerScene(scene.texture,effect.prepared,layer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over');
            mainCtx.restore();
            if(rec?.handled){renderBackendTelemetry.mark('profile','gpu','GPU Graffiti ribbon');noteProfileGpuSuccess('graffiti',effect.tunnelActive?'ribbon corridor layer-scene':'ribbon layer-scene','webgpu-layer-scene');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,20,rec.commandBuffer,effect.tunnelActive?'graffiti-variable-corridor':'graffiti-variable');return;}else{const st=WebGPUGraffitiRibbonRenderer.status?.()||{};noteProfileGpuFailure('graffiti','ribbon layer-scene',st.lastError||st.diagnostic?.reason||'GPU ribbon encode returned not handled',{gpuRibbonEligible:effect.prepared?.gpuRibbonEligible===true});}
        }
        if(strictSpiralProfileGpu){renderBackendTelemetry.mark('profile','gpu','Spiral profile GPU-only warmup');somataGpuContractError('SPIRAL_PROFILE_GPU_UNAVAILABLE',frameCtx,{profile:effect?.application||null});try{requestMainCanvasRender?.();}catch(_){}return;}
        materializeDeferredLayerScene(frameCtx);
    }
    // v433: Graffiti is GPU-only. If FrameGraph is unavailable or another legacy pass
    // forced materialization, draw the same vector ribbon into an independent transparent
    // WebGPU overlay instead of falling back to Canvas2D.
    if(gpuBackendAllowed&&effect.application==='graffiti'&&effect.prepared?.gpuRibbonEligible===true){
        mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
        const g=frameCtx.effectsPlan?.glow;if(g?.enabled===true){const glowOpts={radiusPx:Math.max(.5,(Number(g.amount)||0)*.55*frameCtx.frame.dpr),alphaScale:Math.max(0,Number(g.compositeAlpha)||0),composite:'source-over'};const grec=effect.tunnelActive
            ? WebGPUGraffitiRibbonRenderer.drawCorridorGlowToOverlay?.(effect.prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,glowOpts)
            : WebGPUGraffitiRibbonRenderer.drawGlowToOverlay?.(effect.prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,glowOpts);
            if(grec?.handled)renderBackendTelemetry.mark('glow','gpu','exact Graffiti overlay contour Glow');else{const gst=WebGPUGraffitiRibbonRenderer.status?.()||{},cst=typeof WebGPUGraffitiContourGlow!=='undefined'?WebGPUGraffitiContourGlow.status?.():null;noteProfileGpuFailure('graffiti','overlay contour glow',gst.lastError||cst?.lastError||'GPU overlay contour Glow unavailable',{renderer:gst,contourGlow:cst});}
        }
        const rec=effect.tunnelActive
            ? WebGPUGraffitiRibbonRenderer.drawCorridorToOverlay(effect.prepared,layer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over')
            : WebGPUGraffitiRibbonRenderer.drawToOverlay(effect.prepared,layer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over');
        mainCtx.restore();
        if(rec?.handled){renderBackendTelemetry.mark('profile','gpu','GPU Graffiti overlay');noteProfileGpuSuccess('graffiti',effect.tunnelActive?'ribbon corridor overlay':'ribbon overlay','webgpu-overlay');return;}
        const st=WebGPUGraffitiRibbonRenderer.status?.()||{};const why=st.lastError||st.diagnostic?.reason||(st.available?'overlay draw returned not handled':'GPU Graffiti pipeline unavailable/warming');noteProfileGpuFailure('graffiti','overlay',why,{renderer:st});renderBackendTelemetry.mark('profile','gpu',st.lastError?`GPU-only Graffiti unavailable: ${st.lastError}`:'GPU-only Graffiti warming');return;
    }

    // Legacy bitmap branch is retained only for old imported runtime state, but v433 keeps
    // state.graffitiRasterized=false and never selects it from the editor.
    if(frameCtx.frame?.gpuLayerSceneDeferred&&effect.application==='graffiti'&&effect.raster?.bitmap){
        const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId);
        if(scene?.texture){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const rec=effect.tunnelActive
                ? WebGPUGraffitiBitmapRenderer.encodeCorridorToLayerScene(scene.texture,effect.raster,mainCtx,baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over')
                : WebGPUGraffitiBitmapRenderer.encodeToLayerScene(scene.texture,effect.raster,mainCtx,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),'source-over');
            mainCtx.restore();
            if(rec?.handled){renderBackendTelemetry.mark('profile','gpu','GPU Graffiti bitmap');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,20,rec.commandBuffer,effect.tunnelActive?'graffiti-bitmap-corridor':'graffiti');GraffitiWorker.stats.used++;return;}
        }
        if(strictSpiralProfileGpu){renderBackendTelemetry.mark('profile','gpu','Spiral profile GPU-only warmup');somataGpuContractError('SPIRAL_PROFILE_GPU_UNAVAILABLE',frameCtx,{profile:effect?.application||null});try{requestMainCanvasRender?.();}catch(_){}return;}
        materializeDeferredLayerScene(frameCtx);
    }

    // v327: slash/square profile markers are GPU-instanced both normally and in Corridor.
    // Marker positions are canonical; Corridor uploads only copy transform/alpha records.
    if(gpuBackendAllowed&&effect.application==='stroke'&&effect.prepared?.type!=='round'){
        if(WebGPUProfileMarkerRenderer.isReady()){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            let ok=false;
            if(effect.tunnelActive)ok=WebGPUProfileMarkerRenderer.renderCorridor(effect.prepared?.table,layer,baseAlpha,mainCtx,effect.prepared,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,markerCoreOpts);
            else{const a=baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1)));ok=WebGPUProfileMarkerRenderer.render(effect.prepared?.table,layer,a,mainCtx,effect.prepared,markerCoreOpts);}
            mainCtx.restore();if(ok){renderBackendTelemetry.mark('profile','gpu','GPU profile markers');noteProfileGpuSuccess('dash',effect.tunnelActive?'marker corridor draw':'marker draw','webgpu');return;}const st=WebGPUProfileMarkerRenderer.status?.()||{};noteProfileGpuFailure('dash',effect.tunnelActive?'marker corridor draw':'marker draw',st.lastError||st.diagnostic?.reason||(st.available?'GPU marker render returned false':'GPU marker renderer unavailable'),{renderer:st});
        }else{const st=WebGPUProfileMarkerRenderer.status?.()||{};noteProfileGpuFailure('dash','marker ready',st.lastError||st.diagnostic?.reason||(st.initializing?'GPU marker pipeline warming':'GPU marker renderer unavailable'),{renderer:st});}
    }
    if(gpuBackendAllowed&&effect.application==='graffiti'){const rs=WebGPUGraffitiRibbonRenderer.status?.()||{},ms=WebGPUGraffitiMorphRenderer.status?.()||{};noteProfileGpuFailure('graffiti','profile exhausted',rs.lastError||ms.lastError||'no eligible Graffiti GPU renderer handled this frame',{ribbon:rs,morph:ms});renderBackendTelemetry.mark('profile','gpu','GPU-only Graffiti: no Canvas fallback');return;}
    if(strictSpiralProfileGpu){renderBackendTelemetry.mark('profile','gpu','Spiral line-profile GPU-only warmup; Canvas fallback forbidden');somataGpuContractError('SPIRAL_PROFILE_GPU_UNAVAILABLE',frameCtx,{profile:effect?.application||null});try{requestMainCanvasRender?.();}catch(_){}return;}
    renderBackendTelemetry.mark('profile','canvas','Canvas line-profile fallback',true);
    for(let pi=0;pi<visibleInstances.copies.length;pi++){
        const copy=visibleInstances.copies[pi],a=visibleInstances.alphas[pi];
        if(!shouldDrawTunnelEffectIndex('graffiti',pi,frameCtx,effect.footprint))continue;
        mainCtx.save();if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
        if(!(effect.raster&&GraffitiWorker.drawRaster(mainCtx,effect.raster,baseAlpha*a))){
            if(effect.application==='graffiti')GraffitiWorker.stats.fallback++;
            drawLineProfileMarkers(mainCtx,effect.paths,layer,baseAlpha*a,effect.prepared,true);
        }
        mainCtx.restore();
    }
}

const lightningSceneStencilScratch={vertices:new Float32Array(0),result:{supported:true,vertices:null,floatCount:0,cacheKey:null,revision:0,resident:false},pending:[]};
const lightningSceneStencilGeometryCache=new Map(),lightningSceneStencilCopyKeyCache=new WeakMap();let lightningSceneStencilRevision=0,lightningSceneStencilBuilds=0,lightningSceneStencilHits=0,lightningSceneStencilEvictions=0;
function getLightningSceneStencilCacheKey(layer,copy,tunnelActive){if(!tunnelActive)return layer&&typeof layer==='object'?layer:null;if(!layer||typeof layer!=='object'||!copy||typeof copy!=='object')return null;let byCopy=lightningSceneStencilCopyKeyCache.get(layer);if(!byCopy){byCopy=new WeakMap();lightningSceneStencilCopyKeyCache.set(layer,byCopy);}let key=byCopy.get(copy);if(!key){key={};byCopy.set(copy,key);}return key;}
function pruneLightningSceneStencilGeometry(activeKey=null){const limit=Math.max(24,24*(performanceGovernor.residencyScale?.()||1));if(lightningSceneStencilGeometryCache.size<=limit)return;const victims=[...lightningSceneStencilGeometryCache.entries()].filter(([k])=>k!==activeKey).sort((a,b)=>(a[1]?.lastUsedFrame||0)-(b[1]?.lastUsedFrame||0));while(lightningSceneStencilGeometryCache.size>limit&&victims.length){const [key]=victims.shift();lightningSceneStencilGeometryCache.delete(key);lightningSceneStencilEvictions++;}}
function buildLightningSceneStencilGeometry(paths,tr,cacheKey=null,dynamic=false){
    const cacheable=!dynamic&&cacheKey&&typeof cacheKey==='object';
    if(cacheable){const rec=lightningSceneStencilGeometryCache.get(cacheKey);if(rec&&rec.paths===paths&&rec.a===tr.a&&rec.b===tr.b&&rec.c===tr.c&&rec.d===tr.d&&rec.e===tr.e&&rec.f===tr.f){rec.lastUsedFrame=Math.max(1,Number(renderRuntime?.frameId)||1);lightningSceneStencilHits++;return{supported:true,vertices:rec.vertices,floatCount:rec.floatCount,cacheKey,revision:rec.revision,resident:true};}}
    const out=lightningSceneStencilScratch.result;if(!Array.isArray(paths)||!tr){out.supported=true;out.vertices=null;out.floatCount=0;out.cacheKey=null;out.revision=0;out.resident=false;return out;}
    let edges=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const path of paths){const pts=path?.points||[];if(path?.closed!==true||pts.length<3)continue;edges+=pts.length;for(const p of pts){const x=tr.a*(Number(p?.x)||0)+tr.c*(Number(p?.y)||0)+tr.e,y=tr.b*(Number(p?.x)||0)+tr.d*(Number(p?.y)||0)+tr.f;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
    if(!edges||!Number.isFinite(minX)){out.supported=true;out.vertices=null;out.floatCount=0;out.cacheKey=null;out.revision=0;out.resident=false;return out;}
    const need=edges*6;if(lightningSceneStencilScratch.vertices.length<need)lightningSceneStencilScratch.vertices=new Float32Array(Math.max(need,Math.ceil(Math.max(384,lightningSceneStencilScratch.vertices.length*1.7))));
    const v=lightningSceneStencilScratch.vertices,span=Math.max(1,maxX-minX,maxY-minY),anchorX=minX-span-1024,anchorY=minY-span-1024;let o=0;
    for(const path of paths){const pts=path?.points||[];if(path?.closed!==true||pts.length<3)continue;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],ax=tr.a*(Number(a?.x)||0)+tr.c*(Number(a?.y)||0)+tr.e,ay=tr.b*(Number(a?.x)||0)+tr.d*(Number(a?.y)||0)+tr.f,bx=tr.a*(Number(b?.x)||0)+tr.c*(Number(b?.y)||0)+tr.e,by=tr.b*(Number(b?.x)||0)+tr.d*(Number(b?.y)||0)+tr.f;v[o++]=anchorX;v[o++]=anchorY;v[o++]=ax;v[o++]=ay;v[o++]=bx;v[o++]=by;}}
    if(cacheable){const vertices=new Float32Array(o);vertices.set(v.subarray(0,o));const rec={paths,a:tr.a,b:tr.b,c:tr.c,d:tr.d,e:tr.e,f:tr.f,vertices,floatCount:o,revision:++lightningSceneStencilRevision,lastUsedFrame:Math.max(1,Number(renderRuntime?.frameId)||1)};lightningSceneStencilGeometryCache.set(cacheKey,rec);lightningSceneStencilBuilds++;pruneLightningSceneStencilGeometry(cacheKey);return{supported:true,vertices,floatCount:o,cacheKey,revision:rec.revision,resident:true};}
    out.supported=true;out.vertices=v;out.floatCount=o;out.cacheKey=null;out.revision=0;out.resident=false;lightningSceneStencilBuilds++;return out;
}
window.__spiroV392LightningStencilGeometryProbe=()=>{const p=[{closed:true,points:[{x:0,y:0},{x:10,y:0},{x:5,y:10}]}],g=buildLightningSceneStencilGeometry(p,{a:1,b:0,c:0,d:1,e:3,f:4});return{floatCount:g.floatCount,triangles:g.floatCount/6,pass:g.floatCount===18&&g.vertices[2]===3&&g.vertices[3]===4};};
window.__spiroV407ResidentLightningBatchProbe=()=>{const st=WebGPUSweepRenderer.status?.()?.lightningResidency||{},rasterMarkersOff=state?.graffitiRasterized!==true,rasterLampsOff=state?.lamps?.rasterized!==true;const out={statusFields:Object.prototype.hasOwnProperty.call(st,'strikeRecords')&&Object.prototype.hasOwnProperty.call(st,'strikeUploadSkips'),staticOnly:String(st.policy||'').includes('dynamic/Morph geometry uses ring fallback'),rasterMarkersOff,rasterLampsOff};out.pass=Object.values(out).every(Boolean);return out;};
window.__spiroV410BufferRecyclerProbe=()=>{const st=WebGPUBufferRecycler.status?.()||{},rasterMarkersOff=state?.graffitiRasterized!==true,rasterLampsOff=state?.lamps?.rasterized!==true;const out={api:typeof WebGPUBufferRecycler.acquire==='function'&&typeof WebGPUBufferRecycler.recycle==='function',safeRetirement:String(st.policy||'').includes('onSubmittedWorkDone'),pressureAware:Number(st.limitBuffers)>=32&&Number(st.limitBytes)>=48*1024*1024,rasterMarkersOff,rasterLampsOff};out.pass=Object.values(out).every(Boolean);return out;};
window.__spiroV424LazyCanonicalStagingProbe=()=>{
    const path={points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],closed:false},list=[path];list._frameGeometryId=frameGeometryRuntime.frameId;
    const table=buildPathLengthTable(list),lazy=!(table.gpuSegmentData instanceof Float32Array)&&!Number(table.gpuSegmentFloatCount),policy=String(WebGPUCanonicalPathStore.status?.().dynamicResident?.policy||'');
    const out={cpuTableLazy:lazy,segmentsPresent:table.segmentCount===2,canonicalStoreLazy:policy.includes('packing is lazy'),rasterMarkersOff:state?.graffitiRasterized!==true,rasterLampsOff:state?.lamps?.rasterized!==true};out.pass=Object.values(out).every(Boolean);return out;
};
// Compatibility alias: the v409 eager-staging contract was intentionally retired in v424.
window.__spiroV409DirectCanonicalStagingProbe=()=>window.__spiroV424LazyCanonicalStagingProbe();
window.__spiroV408DynamicCanonicalPathProbe=()=>{const st=WebGPUCanonicalPathStore.status?.()||{},dr=st.dynamicResident||{},rasterMarkersOff=state?.graffitiRasterized!==true,rasterLampsOff=state?.lamps?.rasterized!==true;const out={residentPolicy:String(dr.policy||'').includes('persistent dynamic canonical path'),sameFrameReuse:Object.prototype.hasOwnProperty.call(dr,'frameHits'),snapshotDedup:Object.prototype.hasOwnProperty.call(dr,'uploadSkips')&&Object.prototype.hasOwnProperty.call(dr,'avoidedBytes'),rasterMarkersOff,rasterLampsOff};out.pass=Object.values(out).every(Boolean);return out;};


// v512: renderLayerSweepPass extracted to js/render/sweep-pass.js.

// v512: Web render pass extracted to js/render/web-pass.js.

function renderLayerLampPass(frameCtx) {
    const effect=frameCtx.effectsPlan?.lamps;
    let forceCpuLamps=typeof somataCpuBackendForced==='function'&&somataCpuBackendForced();
    if(!effect?.enabled||!effect.instances?.copies?.length)return;
    let strictSpiralGpu=isStrictSpiralWebGPUFrame(frameCtx);
    if(strictSpiralGpu&&LampGPURenderer.isWebGPUReady?.()!==true){
        const degraded=typeof somataGpuFeatureWaitOrFallback==='function'&&somataGpuFeatureWaitOrFallback('lamps','lamp-renderer-warming',{stage:'render',lamp:LampGPURenderer.status?.()||null},650,frameCtx,false);
        strictSpiralGpu=isStrictSpiralWebGPUFrame(frameCtx);forceCpuLamps=typeof somataCpuBackendForced==='function'&&somataCpuBackendForced();
        if(strictSpiralGpu&&!degraded){renderBackendTelemetry.mark('lamps','gpu','Spiral Full WebGPU lamp renderer unavailable');somataGpuContractError('SPIRAL_LAMPS_GPU_UNAVAILABLE',frameCtx,{lamp:LampGPURenderer.status?.()||null});return;}
    }
    for(const set of effect.sets){
        if(!set?.points?.length||set.alphaBase<=.001)continue;
        const drawPlan={
            config:set.config||effect.baseConfig||{},audioLayerIndex:frameCtx.layerIndex,tunnelActive:effect.tunnelActive===true,
            zoom:frameCtx.frame?.zoom ?? state.zoom,outerStateIsolated:true,preparedStyle:set.stylePlan||{},cssTransformScale:1
        };
        const prepareVisual=()=>{
            prepareLampDrawStyle(drawPlan.config,drawPlan.audioLayerIndex,lampAdaptivePointCount(set.points,drawPlan.config),effect.adaptiveCount,drawPlan.zoom,drawPlan.preparedStyle);
            return prepareLampVisualPlan(set.points,set.layer,drawPlan.config,drawPlan.preparedStyle,drawPlan.audioLayerIndex,set.visualPlan||(set.visualPlan={items:[]}));
        };
        let visualPlan=prepareVisual();
        // A lamp set may legitimately become visually empty during Minimal/Project Morph
        // or tunnel fading. That is a no-op frame, not a GPU queue failure.
        if(!visualPlan?.items?.length)continue;
        if(set.gpuLampNative===true&&set.gpuPrepared){
            const nativeKind=set.gpuPrepared.gpuLampNativeKind||'arc',arcNative=nativeKind==='arc',forceCompat=typeof spiroIsCompatibilityForced==='function'&&spiroIsCompatibilityForced('lamps');let queued=false;
            if(!forceCompat){
                if(nativeKind==='topology-key'||nativeKind==='topology-ghost'){
                    if(effect.tunnelActive)queued=LampGPURenderer.queueTopologyVisualPlan?.(mainCtx,visualPlan,set.alphaBase,drawPlan,set.gpuPrepared,effect.instances.copies,effect.instances.alphas,frameCtx)===true;
                    else if(effect.instances.copies.length===1){const a=Math.max(0,Math.min(1,Number(effect.instances.alphas?.[0]??1)));mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);queued=LampGPURenderer.queueTopologyVisualPlan?.(mainCtx,visualPlan,set.alphaBase*a,drawPlan,set.gpuPrepared,null,null,frameCtx)===true;mainCtx.restore();}
                }else if(arcNative){
                    if(effect.tunnelActive)queued=LampGPURenderer.queueArcVisualPlan?.(mainCtx,visualPlan,set.alphaBase,drawPlan,set.gpuPrepared,effect.instances.copies,effect.instances.alphas,frameCtx)===true;
                    else if(effect.instances.copies.length===1){const a=Math.max(0,Math.min(1,Number(effect.instances.alphas?.[0]??1)));mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);queued=LampGPURenderer.queueArcVisualPlan?.(mainCtx,visualPlan,set.alphaBase*a,drawPlan,set.gpuPrepared,null,null,frameCtx)===true;mainCtx.restore();}
                }
                if(queued){const topologyNative=nativeKind==='topology-key'||nativeKind==='topology-ghost',ghostNative=nativeKind==='topology-ghost';renderBackendTelemetry.mark('lamps','gpu',topologyNative?(effect.tunnelActive?(ghostNative?'GPU topology Ghost Corridor lamps':'GPU topology Key Corridor lamps'):(ghostNative?'GPU topology Ghost lamps':'GPU topology Key lamps')):(effect.tunnelActive?'GPU Morph Arc Corridor lamps':'GPU Morph Arc lamps'));continue;}
            }
            // Spiral 6.8 is GPU-only: never replace the exact Bézier-derived Arc with a
            // CPU materialized path merely because a WebGPU resource is still warming.
            if(isStrictSpiralWebGPUFrame(frameCtx)){
                const degraded=typeof somataGpuFeatureWaitOrFallback==='function'&&somataGpuFeatureWaitOrFallback('lamps','native-lamp-queue-warming',{stage:'native-queue',nativeKind},650,frameCtx,false);
                forceCpuLamps=typeof somataCpuBackendForced==='function'&&somataCpuBackendForced();
                if(isStrictSpiralWebGPUFrame(frameCtx)&&!degraded){renderBackendTelemetry.mark('lamps','gpu','Spiral lamps GPU-only warmup');somataGpuContractError('SPIRAL_LAMP_NATIVE_QUEUE_FAILED',frameCtx,{nativeKind});continue;}
            }
            // Non-Spiral / runtime-degraded compatibility keeps the historical fail-open path.
            if(arcNative){const lampT=frameCtx.blueMorphProvider?.geometryT||0,rawPaths=getLayerFrameAuxiliaryPaths(frameCtx);const fallback=withLampConfig(drawPlan.config,()=>collectMorphLampPoints(frameCtx.layerIndex,lampT,260,rawPaths,null));set.gpuLampNative=false;set.gpuPrepared=null;set.points=fallback;if(!fallback?.length)continue;visualPlan=prepareVisual();}
            else{set.gpuLampNative=false;set.points=set.gpuPrepared?.attachmentPoints||set.points;set.gpuPrepared=null;if(!set.points?.length)continue;visualPlan=prepareVisual();}
        }
        if(!visualPlan?.items?.length)continue;
        // v325 — WebGPU Corridor lamps are expanded on the GPU as lampCount × copyCount.
        if(!forceCpuLamps&&effect.tunnelActive&&LampGPURenderer.queueCorridorVisualPlan(mainCtx,visualPlan,set.alphaBase,drawPlan,effect.instances.copies,effect.instances.alphas,frameCtx)){renderBackendTelemetry.mark('lamps','gpu','GPU Corridor lamps');continue;}
        const cssBase=Math.abs(Number(frameCtx.combinedScale)||1)*Math.max(.001,Number(drawPlan.zoom)||1);
        for(let li=0;li<effect.instances.copies.length;li++){
            const copy=effect.instances.copies[li],copyAlpha=Math.max(0,Math.min(1,Number(effect.instances.alphas?.[li]??1))),effectiveAlpha=set.alphaBase*copyAlpha;
            // Tunnel fading intentionally excludes fully transparent copies. Previously these
            // no-op copies were sent to queueVisualPlan(), whose `false` return was interpreted
            // as a GPU failure and produced large diagnostics for effects such as «ярко1».
            if(effectiveAlpha<=.001)continue;
            drawPlan.cssTransformScale=effect.tunnelActive?Math.max(.000001,Math.abs(Number(copy.scale)||0)*cssBase):cssBase;
            mainCtx.save();if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const queuedGL=!forceCpuLamps&&LampGPURenderer.queueVisualPlan(mainCtx,visualPlan,effectiveAlpha,drawPlan);
            if(!queuedGL){
                const gpuRequested=!forceCpuLamps&&drawPlan.config?.webgl!==false&&drawPlan.config?.rasterized!==true;
                if(isStrictSpiralWebGPUFrame(frameCtx)){
                    const degraded=typeof somataGpuFeatureWaitOrFallback==='function'&&somataGpuFeatureWaitOrFallback('lamps','lamp-queue-warming',{stage:'queue',copyIndex:li},650,frameCtx,false);
                    forceCpuLamps=typeof somataCpuBackendForced==='function'&&somataCpuBackendForced();
                    if(isStrictSpiralWebGPUFrame(frameCtx)&&!degraded){renderBackendTelemetry.mark('lamps','gpu','Spiral lamps GPU-only warmup');somataGpuContractError('SPIRAL_LAMP_GPU_QUEUE_FAILED',frameCtx,{copyIndex:li});}
                    else{renderBackendTelemetry.mark('lamps','canvas','CPU lamp fallback after bounded GPU wait',true);drawLampVisualPlan(mainCtx,visualPlan,effectiveAlpha,drawPlan);}
                }
                else if(gpuRequested){
                    renderBackendTelemetry.mark('lamps','gpu','GPU lamps unavailable; Canvas fallback blocked');
                    somataGpuDiagnosticError('lamps','queue',`GPU lamp queue failed for copy ${li}`,frameCtx,{copyIndex:li,lamp:LampGPURenderer.status?.()||null});
                    try{Promise.resolve(LampGPURenderer.ensureWebGPUReady?.()).finally(()=>requestMainCanvasRender?.());}catch(_){try{requestMainCanvasRender?.();}catch(__){}}
                }else{renderBackendTelemetry.mark('lamps','canvas','explicit Canvas lamp mode');drawLampVisualPlan(mainCtx,visualPlan,effectiveAlpha,drawPlan);}
            }else renderBackendTelemetry.mark('lamps','gpu','GPU lamps');
            mainCtx.restore();
        }
    }
}

// v206 — Architecture phase 12: provider snapshot reads persistent config and live runtime separately.
// v200 — Architecture phase 6: morph systems expose normalized provider data.
// Renderer preparation no longer reaches directly into blue/orange/green state bags.
function prepareMorphProviderFrameSnapshot(renderFrame) {
    const bundle=renderFrame.morphProviders || (renderFrame.morphProviders={blue:{},orange:{},green:{}});
    const blueConfig=state.morph || {}, blueRuntime=runtimeState.morph;
    const orangeConfig=state.minimalMorph || {}, orangeRuntime=runtimeState.minimalMorph;
    const greenConfig=state.projectMorph || {}, greenRuntime=runtimeState.projectMorph;
    const blue=bundle.blue, orange=bundle.orange, green=bundle.green;

    blue.config=blueConfig;
    blue.runtime=blueRuntime;
    blue.active=Boolean(blueRuntime.active && blueRuntime.exactStartPending !== true);
    blue.paused=blueRuntime.paused===true;
    blue.mode=blueConfig.mode || 'circleSlide';
    blue.options=blueConfig.options || {};
    blue.geometryT=Number.isFinite(blueRuntime.geometryT)?blueRuntime.geometryT:0;
    blue.progress=Number(blueRuntime.progress)||0;
    blue.monoOrbitTransforms=blueConfig.monoOrbitTransforms===true;
    blue.sourceGeometry=blueRuntime.sourceGeometry || [];
    blue.targetGeometry=blueRuntime.targetGeometry || [];
    blue.sourceProfiles=blueRuntime.sourceProfiles || [];
    blue.targetProfiles=blueRuntime.targetProfiles || [];
    blue.sourceVisuals=blueRuntime.sourceVisuals || [];
    blue.targetVisuals=blueRuntime.targetVisuals || [];
    blue.renderSourceLayers=blueRuntime.renderSourceLayers || [];
    blue.renderTargetLayers=blueRuntime.renderTargetLayers || [];
    blue.lightLayers=blueRuntime.lightLayers || [];
    blue.lightDrawData=blueRuntime.lightDrawData || [];
    blue.lightScales=blueRuntime.lightScales || [];
    blue.lightRotations=blueRuntime.lightRotations || [];
    blue.lightningCycleColor=blueRuntime.lightningCycleColor || '#ffffff';
    blue.frameLayers=blueRuntime.frameLayers || [];
    blue.phaseSerial=Math.max(0,Number(blueRuntime.phaseSerial)||0)>>>0;

    orange.config=orangeConfig;
    orange.runtime=orangeRuntime;
    orange.active=orangeRuntime.active===true;
    orange.transitioning=Boolean(orange.active && orangeRuntime.transitioning);
    orange.progress=Math.max(0,Math.min(1,Number(orangeRuntime.progress)||0));
    orange.sourceLayers=orangeRuntime.sourceLayers || [];
    orange.targetLayers=orangeRuntime.targetLayers || [];
    orange.sourceDrawData=orangeRuntime.sourceDrawData || [];
    orange.targetDrawData=orangeRuntime.targetDrawData || [];
    orange.sourceLampPoints=orangeRuntime.sourceLampPoints || [];
    orange.targetLampPoints=orangeRuntime.targetLampPoints || [];

    green.config=greenConfig;
    green.runtime=greenRuntime;
    green.enabled=greenRuntime.active===true;
    green.active=greenRuntime.active===true && greenRuntime.transitionActive===true;
    green.transitionType=greenConfig.transitionType || 'smooth';
    green.renderMode=greenRuntime.renderMode || ((green.transitionType==='fade'||(green.transitionType==='linear'&&greenConfig.advancedLinear!==true))?'crossfade':'morph');
    green.progress=Number.isFinite(Number(greenRuntime.renderProgress)) ? Number(greenRuntime.renderProgress) : (Number(greenRuntime.progress)||0);
    green.parameterProgress=Number.isFinite(Number(greenRuntime.parameterProgress)) ? Number(greenRuntime.parameterProgress) : green.progress;
    green.fadeProgress=Math.max(0,Math.min(1,Number(greenRuntime.fadeProgress)||0));
    green.frameGeometry=greenRuntime.frameGeometry || [];
    green.sourceGeometry=greenRuntime.sourceGeometry || [];
    green.targetGeometry=greenRuntime.targetGeometry || [];
    green.sourceRenderLayers=greenRuntime.sourceRenderLayers || [];
    green.targetRenderLayers=greenRuntime.targetRenderLayers || [];
    green.frameExtents=greenRuntime.frameExtents || [];
    green.frameLampPoints=greenRuntime.frameLampPoints || [];
    green.lampPlans=greenRuntime.lampPlans || [];
    return bundle;
}

function resetLayerMorphProvider(provider,system) {
    provider.system=system;
    provider.active=false;
    provider.geometryActive=false;
    provider.kind='static';
    provider.progress=0;
    provider.sourceLayer=null;
    provider.targetLayer=null;
    provider.renderLayer=null;
    provider.sourceData=null;
    provider.targetData=null;
    provider.sourceGeometry=null;
    provider.targetGeometry=null;
    provider.sourcePaths=null;
    provider.targetPaths=null;
    provider.framePaths=null;
    provider.frameLampPoints=null;
    provider.sourceLampPoints=null;
    provider.targetLampPoints=null;
    provider.extent=0;
    provider.lightMorphEnabled=false;
    provider.forcedLampMorph=false;
    provider.lightningFlashAlpha=0;
    provider.circleAngular=false;
    provider.topology=false;
    provider.byTopology=false;
    provider.sourceProfileMode=null;
    provider.targetProfileMode=null;
    return provider;
}

const blueAtomicRenderLayerPool=[];
function getBlueAtomicRenderLayer(layerIndex,sourceLayer,snap){
    if(!snap?.active||snap.lightMorphEnabled)return sourceLayer;
    let out=blueAtomicRenderLayerPool[layerIndex];
    if(!out)out=blueAtomicRenderLayerPool[layerIndex]={};
    // Start from the live layer only for scalar/style state already interpolated by animateMorph.
    Object.assign(out,sourceLayer);
    const srcP=snap.sourceProfiles?.[layerIndex];
    const dstP=snap.targetProfiles?.[layerIndex];
    const srcV=snap.sourceVisuals?.[layerIndex]||{};
    const dstV=snap.targetVisuals?.[layerIndex]||srcV;
    const t=Math.max(0,Math.min(1,Number(snap.geometryT)||0));
    const closure=getMorphClosureTransitionPlan(srcV.closedLoop!==false,dstV.closedLoop!==false,t);
    out.profileMode=resolveMorphProfileModeForRender(srcP?.mode||sourceLayer?.profileMode||'segments',dstP?.mode||srcP?.mode||sourceLayer?.profileMode||'segments',closure.geometryT);
    // Never expose a newly generated target/raw profile as the frame's fallback profile.
    // The morph renderer owns geometry; fallback consumers get the current source snapshot.
    out.profileNodes=srcP?.nodes||sourceLayer?.profileNodes||[];
    out.closedLoop=(srcV.closedLoop!==false)===(dstV.closedLoop!==false)?(srcV.closedLoop!==false):(closure.closureMix<.5?(srcV.closedLoop!==false):(dstV.closedLoop!==false));
    out.lineJoinType=closure.geometryT<.5?(srcV.lineJoinType||sourceLayer?.lineJoinType||'rounded'):(dstV.lineJoinType||srcV.lineJoinType||sourceLayer?.lineJoinType||'rounded');
    return out;
}

function resolveBlueMorphLayerProvider(frameCtx,renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const sourceLayer=frameCtx.sourceLayer;
    const snap=renderFrame.morphProviders.blue;
    const provider=resetLayerMorphProvider(frameCtx.blueMorphProvider || (frameCtx.blueMorphProvider={}), 'blue');
    provider.active=snap.active;
    provider.mode=snap.mode;
    provider.geometryT=snap.geometryT;
    provider.progress=snap.progress;
    provider.options=snap.options;
    provider.lightMorphEnabled=Boolean(snap.active && snap.mode==='light' && !snap.monoOrbitTransforms);
    provider.forcedLampMorph=Boolean(snap.active && snap.mode==='lightning');
    provider.lightningFlashAlpha=provider.forcedLampMorph ? getLightningFlashAlpha(snap.progress) : 0;
    // v276: keep the live layer as the render/style owner exactly as in v261.
    // Geometry population (including customSuborbits) is already frozen in the
    // source/target topology snapshots.  Replacing the complete render layer with an
    // atomic profile proxy accidentally made downstream topology/effect consumers see
    // a mono-orbit interpretation.  Profile atomicity is carried explicitly by
    // sourceProfileMode/targetProfileMode and by the prepared geometry instead.
    provider.renderLayer=provider.lightMorphEnabled ? (snap.lightLayers[layerIndex] || sourceLayer) : sourceLayer;
    provider.lightScale=provider.lightMorphEnabled ? Math.max(.05,Number(snap.lightScales[layerIndex])||1) : 1;
    provider.lightRotation=provider.lightMorphEnabled ? (Number(snap.lightRotations[layerIndex])||0) : 0;
    provider.lightDrawData=provider.lightMorphEnabled ? (snap.lightDrawData[layerIndex]||null) : null;
    provider.sourceGeometry=snap.sourceGeometry[layerIndex]||null;
    provider.targetGeometry=snap.targetGeometry[layerIndex]||null;
    provider.sourceProfileMode=snap.sourceProfiles?.[layerIndex]?.mode || snap.renderSourceLayers?.[layerIndex]?.profileMode || sourceLayer?.profileMode || 'segments';
    provider.targetProfileMode=snap.targetProfiles?.[layerIndex]?.mode || snap.renderTargetLayers?.[layerIndex]?.profileMode || provider.sourceProfileMode;
    const sourceChaos=(snap.renderSourceLayers?.[layerIndex]?.chaosStar===true)||(snap.sourceVisuals?.[layerIndex]?.chaosStar===true)||(sourceLayer?.chaosStar===true);
    const targetChaos=(snap.renderTargetLayers?.[layerIndex]?.chaosStar===true)||(snap.targetVisuals?.[layerIndex]?.chaosStar===true);
    const specialSpiralEndpoint=Boolean(snap.renderSourceLayers?.[layerIndex]?.spiralEnabled===true||snap.renderTargetLayers?.[layerIndex]?.spiralEnabled===true||sourceLayer?.spiralEnabled===true);
    const specialSpiralExtraGeometry=specialSpiralEndpoint&&Boolean(snap.options.byRounding||snap.options.bySize||snap.options.byRotation||snap.options.bySpiralOrder||snap.options.bySpiralLayers);
    const specialSpiralGeometryRequested=specialSpiralEndpoint&&Boolean(snap.options.byVertices||snap.options.bySteps||snap.options.byShape||snap.monoOrbitTransforms||specialSpiralExtraGeometry);
    // Iter40: Circle Slide still applies globally when selected. Outside Circle Slide only a
    // Spiral endpoint is promoted to the retained Bézier carrier; non-Spiral sibling layers
    // stay on their normal topology/calm provider.
    const retainedSpiralMode=Boolean(specialSpiralGeometryRequested&&typeof spiralMorphUsesRetainedBezierRail==='function'&&spiralMorphUsesRetainedBezierRail());
    const effectiveCircleMode=snap.mode==='circleSlide'||(typeof spiralMorphUsesCircleRebuild==='function'&&spiralMorphUsesCircleRebuild())||retainedSpiralMode;
    // 7.2.8 — Chaos Circle Slide deliberately has no dense sourceGeometry snapshots. Its
    // dedicated direct circle evaluator is the geometry authority, so keep the provider dynamic
    // even when sourceGeometry/targetGeometry are null after phase preparation.
    const directChaosCircleMode=Boolean(!provider.lightMorphEnabled&&snap.active&&effectiveCircleMode&&(sourceChaos||targetChaos));
    provider.circleAngular=Boolean(!provider.lightMorphEnabled && !sourceChaos && !targetChaos && snap.active && effectiveCircleMode &&
        (snap.options.byVertices || snap.options.bySteps || snap.options.byShape || snap.monoOrbitTransforms || specialSpiralExtraGeometry));
    provider.topology=Boolean(!provider.lightMorphEnabled && snap.active && (directChaosCircleMode || (provider.sourceGeometry &&
        (sourceChaos || targetChaos || snap.options.byShape || snap.options.byVertices || snap.options.bySteps || snap.monoOrbitTransforms ||
         snap.options.byRounding || snap.options.bySize ||
         (snap.options.byRotation && !renderFrame.audioRotationOverride) || snap.mode==='fade' || snap.mode==='lightning'))));
    provider.geometryActive=provider.circleAngular || provider.topology;
    provider.progress=snap.geometryT;
    provider.byTopology=Boolean(snap.options.byVertices || snap.options.bySteps || snap.monoOrbitTransforms);
    if (snap.mode==='lightning') provider.kind='lightning';
    else if (provider.geometryActive && snap.mode==='fade') provider.kind='blue-fade';
    else if (provider.geometryActive && provider.circleAngular && effectiveCircleMode &&
        (snap.options.byVertices || snap.options.bySteps || snap.options.byShape || snap.monoOrbitTransforms || specialSpiralExtraGeometry)) {
        provider.kind='blue-circle-slide';
        const srcProfile=snap.sourceProfiles[layerIndex];
        const dstProfile=snap.targetProfiles[layerIndex];
        provider.sourceLayer=snap.renderSourceLayers[layerIndex] || {
            ...provider.renderLayer,
            ...snap.sourceVisuals[layerIndex],
            profileMode:srcProfile?.mode || provider.renderLayer?.profileMode || 'segments',
            profileNodes:srcProfile?.nodes || provider.renderLayer?.profileNodes
        };
        provider.targetLayer=snap.renderTargetLayers[layerIndex] || {
            ...provider.renderLayer,
            ...snap.targetVisuals[layerIndex],
            profileMode:dstProfile?.mode || provider.renderLayer?.profileMode || 'segments',
            profileNodes:dstProfile?.nodes || provider.renderLayer?.profileNodes
        };
    } else if (provider.geometryActive && effectiveCircleMode && (sourceChaos || targetChaos)) provider.kind='blue-prepared';
    else if (provider.geometryActive && effectiveCircleMode) provider.kind='blue-circle';
    else if (provider.geometryActive) provider.kind='blue-prepared';
    else provider.kind=provider.lightMorphEnabled?'light-static':'static';
    provider.lightningColor=snap.lightningCycleColor;
    return provider;
}

function resolveOrangeMorphLayerProvider(frameCtx,renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const snap=renderFrame.morphProviders.orange;
    const provider=resetLayerMorphProvider(frameCtx.orangeMorphProvider || (frameCtx.orangeMorphProvider={}), 'orange');
    provider.active=snap.transitioning;
    provider.progress=snap.progress;
    provider.sourceLayer=snap.sourceLayers[layerIndex]||null;
    provider.targetLayer=snap.targetLayers[layerIndex]||null;
    provider.sourceData=snap.sourceDrawData[layerIndex]||null;
    provider.targetData=snap.targetDrawData[layerIndex]||null;
    provider.sourceLampPoints=snap.sourceLampPoints[layerIndex]||null;
    provider.targetLampPoints=snap.targetLampPoints[layerIndex]||null;
    provider.geometryActive=Boolean(snap.transitioning && (provider.sourceData || provider.targetData));
    provider.kind=provider.geometryActive?'orange-fade':'static';
    provider.extent=provider.geometryActive ? Math.max(Number(provider.sourceData?.maxRadius)||0,Number(provider.targetData?.maxRadius)||0,1) : 0;
    return provider;
}

function resolveGreenMorphLayerProvider(frameCtx,renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const snap=renderFrame.morphProviders.green;
    const provider=resetLayerMorphProvider(frameCtx.greenMorphProvider || (frameCtx.greenMorphProvider={}), 'green');
    const paths=snap.active?snap.frameGeometry[layerIndex]:null;
    const gpuPlan=snap.active?snap.runtime?.geometryPlans?.[layerIndex]:null;
    const crossfade=snap.active&&snap.renderMode==='crossfade';
    const hasEndpointGeometry=Boolean((snap.sourceGeometry[layerIndex]?.length||0)||(snap.targetGeometry[layerIndex]?.length||0));
    const hasMorphPlan=Boolean(gpuPlan?.pairs?.length);
    provider.active=snap.active;
    provider.geometryActive=Boolean(snap.active&&(crossfade?hasEndpointGeometry:(hasMorphPlan||(Array.isArray(paths)&&paths.length>0))));
    provider.framePaths=Array.isArray(paths)&&paths.length?paths:null;
    provider.progress=snap.progress;
    provider.parameterProgress=snap.parameterProgress;
    provider.frameLampPoints=snap.frameLampPoints[layerIndex]||null;
    provider.lampPlan=snap.lampPlans[layerIndex]||null;
    provider.gpuGeometryPlan=gpuPlan||null;
    provider.extent=provider.geometryActive?Math.max(1,Number(snap.frameExtents[layerIndex])||1):0;
    if(provider.geometryActive&&crossfade){
        provider.kind='green-fade';
        provider.progress=snap.fadeProgress;
        provider.sourcePaths=snap.sourceGeometry[layerIndex]||null;
        provider.targetPaths=snap.targetGeometry[layerIndex]||null;
        provider.sourceLayer=snap.sourceRenderLayers[layerIndex]||null;
        provider.targetLayer=snap.targetRenderLayers[layerIndex]||null;
    }else if(provider.geometryActive)provider.kind='green-morph';
    return provider;
}

function resolveMainLayerMorphProviders(frameCtx,renderFrame) {
    const blue=resolveBlueMorphLayerProvider(frameCtx,renderFrame);
    const orange=resolveOrangeMorphLayerProvider(frameCtx,renderFrame);
    const green=resolveGreenMorphLayerProvider(frameCtx,renderFrame);
    frameCtx.geometryProvider = green.geometryActive ? green : (orange.geometryActive ? orange : blue);
    return {blue,orange,green,geometry:frameCtx.geometryProvider};
}

function resolveMainLayerFrameSource(frameCtx, renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const orange=renderFrame.morphProviders.orange;
    const minimalTransition=orange.transitioning;
    const resolvedDisplayLayer=(!minimalTransition&&typeof SpiroMorphController!=='undefined')
        ? SpiroMorphController.getDisplayLayerAt(layerIndex)
        : null;
    const sourceLayer=minimalTransition
        ? (orange.sourceLayers[layerIndex] || orange.targetLayers[layerIndex])
        : (resolvedDisplayLayer || state.layers[layerIndex]);
    if(!sourceLayer)return false;
    const minimalSourceLayer=minimalTransition?orange.sourceLayers[layerIndex]:null;
    const minimalTargetLayer=minimalTransition?orange.targetLayers[layerIndex]:null;
    if(!minimalTransition && !sourceLayer.visible)return false;
    if(minimalTransition && minimalSourceLayer?.visible===false && minimalTargetLayer?.visible===false)return false;
    frameCtx.sourceLayer=sourceLayer;
    frameCtx.minimalSourceLayer=minimalSourceLayer;
    frameCtx.minimalTargetLayer=minimalTargetLayer;
    return true;
}

function prepareMainLayerMorphState(frameCtx, renderFrame) {
    const providers=resolveMainLayerMorphProviders(frameCtx,renderFrame);
    const blue=providers.blue, orange=providers.orange, green=providers.green;
    const sourceLayer=frameCtx.sourceLayer;
    const greenLampDisplay=Boolean(green.lampPlan?.pairs?.some(pair => (Number(pair?.startLevel)||0)>.001 || (Number(pair?.endLevel)||0)>.001));
    const lampDisplayEnabled=orange.active
        ? Boolean((orange.sourceLayer&&getLayerLampsEnabled(orange.sourceLayer)) || (orange.targetLayer&&getLayerLampsEnabled(orange.targetLayer)) || blue.forcedLampMorph)
        : (greenLampDisplay || getLayerLampsEnabled(sourceLayer) || blue.forcedLampMorph);

    frameCtx.layer=blue.renderLayer || sourceLayer;
    frameCtx.morphFrameActive=blue.active;
    frameCtx.lightMorphEnabled=blue.lightMorphEnabled;
    frameCtx.forcedLampMorph=blue.forcedLampMorph;
    frameCtx.greenLampDisplay=greenLampDisplay;
    frameCtx.lampDisplayEnabled=lampDisplayEnabled;
    frameCtx.lightningFlashAlpha=blue.lightningFlashAlpha;
    frameCtx.greenFramePaths=green.framePaths;
    frameCtx.greenMorphEnabled=green.geometryActive;
    frameCtx.greenFadeEnabled=green.kind==='green-fade';
    frameCtx.greenFadeT=green.kind==='green-fade'?green.progress:0;
    frameCtx.greenSourcePaths=green.sourcePaths;
    frameCtx.greenTargetPaths=green.targetPaths;
    frameCtx.greenSourceLayer=green.sourceLayer;
    frameCtx.greenTargetLayer=green.targetLayer;
    frameCtx.minimalFadeEnabled=!green.geometryActive && orange.geometryActive;
    frameCtx.circleAngularMorphEnabled=blue.circleAngular;
    frameCtx.topologyMorphEnabled=blue.topology;
    frameCtx.geometryMorphEnabled=green.geometryActive || orange.geometryActive || blue.circleAngular || blue.topology;
}

function prepareMainLayerTransformAndStyle(frameCtx, renderFrame) {
    const layerIndex=frameCtx.layerIndex;
    const layer=frameCtx.layer;
    if(layer && (getLayerFillMatchStroke(layer)||getLayerFillMatchStroke(frameCtx.sourceLayer))){
        layer.fillMatchStroke=true;
        syncLayerFillColorToStroke(layer,true);
    }
    const blue=frameCtx.blueMorphProvider;
    const audioActive=renderFrame.audioActive;
    const audioScale=audioActive?audioApplyNumeric('layer.scale',1,layerIndex):1;
    const audioRotationOffset=audioActive?audioApplyNumeric('layer.rotation',0,layerIndex):0;
    const lightMorphScale=blue?.lightScale ?? 1;
    const lightMorphRotation=blue?.lightRotation ?? 0;
    const linearMotionRotation=getLayerMotionRotationRadians(layer)*180/Math.PI;
    const baseAlpha=audioApplyNumeric('layer.opacity',(layer.opacity!==undefined?layer.opacity:100),layerIndex)/100;
    const lineOpacityFactor=Math.max(0,Math.min(1,(Number.isFinite(Number(layer?.lineOpacity))?Number(layer.lineOpacity):100)/100));
    const lineProfileApplication=['stroke','graffiti'].includes(layer?.lineProfileApplication)?layer.lineProfileApplication:'stroke';
    const lineModeProfile=layer?.sprite?.enabled===true?'round':normalizeLineProfileValue(layer?.lineProfileStroke ?? layer?.lineProfile,'round');
    layer.lineProfile=lineModeProfile;layer.lineProfileStroke=lineModeProfile;
    const lineProfileStrokeOnly=linesAreEffectivelyVisible(layer) && (
        (lineProfileApplication==='stroke'&&['slash','square','circle','cross'].includes(lineModeProfile)) || lineProfileApplication==='graffiti'
    ) && (!blue?.active || blue.mode!=='lightning');

    frameCtx.lineProfileApplication=lineProfileApplication;
    frameCtx.lineProfileStrokeOnly=lineProfileStrokeOnly;
    frameCtx.lineDisplayEnabled=getLayerLineVisible(layer) || frameCtx.lightningFlashAlpha>.001;
    frameCtx.audioScale=audioScale;
    frameCtx.audioRotationOffset=audioRotationOffset;
    frameCtx.lightMorphScale=lightMorphScale;
    frameCtx.lightMorphRotation=lightMorphRotation;
    frameCtx.linearMotionRotation=linearMotionRotation;
    frameCtx.baseAlpha=baseAlpha;
    frameCtx.lineOpacityFactor=lineOpacityFactor;
    frameCtx.lineAlpha=baseAlpha*lineOpacityFactor;
    frameCtx.lineLayerMode=(layer?.lineLayerMode??layer?.spiralLineType)==='segmented'?'segmented':'uniform';
    frameCtx.spiralLineType=frameCtx.lineLayerMode; // legacy renderer/project alias
    frameCtx.combinedScale=audioScale*lightMorphScale;
    frameCtx.combinedRotationOffset=audioRotationOffset+lightMorphRotation+linearMotionRotation;
    frameCtx.combinedRotationRad=frameCtx.combinedRotationOffset*Math.PI/180;
    frameCtx.hasCombinedScale=Math.abs(frameCtx.combinedScale-1)>1e-6;
    frameCtx.hasCombinedRotation=Math.abs(frameCtx.combinedRotationOffset)>1e-6;
    frameCtx.strokeWidth=Math.max(.001,audioApplyNumeric('layer.strokeWidth',Number(layer.strokeWidth)||1.5,layerIndex)*getLayerStrokeWidthMultiplier(layer));
    frameCtx.lineCap='round';
    frameCtx.lineJoin=(layer.lineJoinType||'rounded')==='straight'?'miter':'round';
    frameCtx.miterLimit=6;
    frameCtx.lightningStroke=blue?.mode==='lightning' && frameCtx.lightningFlashAlpha>.001 ? (blue.lightningColor||'#ffffff') : null;
    frameCtx.tunnelBaseStrokeColor=frameCtx.lightningStroke || layer.strokeColor || '#ffffff';
    frameCtx.tunnelBaseFillColor=layer.fillColor || 'transparent';
    frameCtx.tunnelPaletteProfile=tunnelColorShiftIsActive() ? resolveTunnelPaletteProfile(frameCtx.tunnelBaseStrokeColor,layer) : null;
}

// v200 — Phase 6: every geometry source is normalized into one reusable data-only
// GeometryPlan. Render passes no longer choose between blue/orange/green morph systems;
// they execute the plan prepared for this layer/frame.
function resetMainLayerGeometryPlan(plan) {
    if (!plan) return plan;
    plan.kind='static';
    plan.dynamic=false;
    plan.progress=0;
    plan.framePaths=null;
    plan.sourcePaths=null;
    plan.targetPaths=null;
    plan.sourceLayer=null;
    plan.targetLayer=null;
    plan.sourceData=null;
    plan.targetData=null;
    plan.sourceGeometry=null;
    plan.targetGeometry=null;
    plan.byTopology=false;
    plan.sourceProfileMode=null;
    plan.targetProfileMode=null;
    return plan;
}

function prepareMainLayerGeometryPlan(frameCtx) {
    const plan=resetMainLayerGeometryPlan(frameCtx.geometryPlan || (frameCtx.geometryPlan={}));
    frameCtx._topologyMorphGpuLazy=false;frameCtx._topologyMorphCpuFallbackMaterialized=false;
    const provider=frameCtx.geometryProvider || frameCtx.blueMorphProvider;
    plan.kind=provider?.kind || 'static';
    plan.dynamic=Boolean(provider?.geometryActive || plan.kind==='lightning');
    plan.progress=Number(provider?.progress)||0;
    plan.framePaths=provider?.framePaths||null;
    plan.sourcePaths=provider?.sourcePaths||null;
    plan.targetPaths=provider?.targetPaths||null;
    plan.sourceLayer=provider?.sourceLayer||null;
    plan.targetLayer=provider?.targetLayer||null;
    plan.sourceData=provider?.sourceData||null;
    plan.targetData=provider?.targetData||null;
    plan.sourceGeometry=provider?.sourceGeometry||null;
    plan.targetGeometry=provider?.targetGeometry||null;
    plan.byTopology=provider?.byTopology===true;
    plan.sourceProfileMode=provider?.sourceProfileMode||null;
    plan.targetProfileMode=provider?.targetProfileMode||null;
    frameCtx._greenMorphGpuLazy=false;
    if(plan.kind==='green-morph'&&!plan.framePaths){
        const gpuReady=typeof WebGPUGreenProjectMorphRenderer!=='undefined'&&WebGPUGreenProjectMorphRenderer.isEligible?.(frameCtx)===true;
        frameCtx._greenMorphGpuLazy=gpuReady;
        if(!gpuReady&&typeof ensureProjectMorphFrameGeometryLayer==='function'){
            plan.framePaths=ensureProjectMorphFrameGeometryLayer(frameCtx.layerIndex,plan.progress);
            if(frameCtx.greenMorphProvider)frameCtx.greenMorphProvider.framePaths=plan.framePaths;
        }
    }

    if(plan.kind==='blue-prepared' && !plan.framePaths) {
        // v522.16 — keep topology Morph positions GPU-resident when the native base renderer can
        // consume SharedGpuMorphArc. CPU paths are materialized only if a compatibility consumer
        // actually asks for them later in the frame.
        const gpuTopologyLazy=typeof WebGPUTopologyMorphBaseRenderer!=='undefined'&&WebGPUTopologyMorphBaseRenderer.isEligible?.(frameCtx,'base');
        frameCtx._topologyMorphGpuLazy=gpuTopologyLazy===true;
        if(!gpuTopologyLazy){plan.framePaths=getLayerFrameAuxiliaryPaths(frameCtx);provider.framePaths=plan.framePaths;}
    }
    if(plan.kind==='static' || plan.kind==='light-static') plan.sourceData=frameCtx.staticDrawData;
    return plan;
}

function applyMainGeometryTransform(targetCtx,frameCtx) {
    if (frameCtx.hasCombinedRotation) targetCtx.rotate(frameCtx.combinedRotationRad);
    if (frameCtx.hasCombinedScale) {
        targetCtx.scale(frameCtx.combinedScale,frameCtx.combinedScale);
        targetCtx.lineWidth=(Number(targetCtx.__forcedLineWidth)||frameCtx.strokeWidth)/Math.max(.001,frameCtx.combinedScale);
    }
}

function drawGeometryPlanSnapshot(targetCtx,frameCtx,snapshotLayer,drawData,alphaMultiplier,fadeAlpha) {
    if(!snapshotLayer||!drawData||fadeAlpha<=.001||snapshotLayer.visible===false)return;
    if(getLayerFillMatchStroke(snapshotLayer)||getLayerFillMatchStroke(frameCtx.sourceLayer))syncLayerFillColorToStroke(snapshotLayer,true);
    targetCtx.save();
    targetCtx.lineWidth=(Number(snapshotLayer.strokeWidth)||1.5)/Math.max(.001,frameCtx.audioScale*frameCtx.lightMorphScale);
    targetCtx.strokeStyle=snapshotLayer.strokeColor||'#ffffff';
    targetCtx.fillStyle=snapshotLayer.fillColor||'transparent';
    const opacity=(snapshotLayer.opacity!==undefined?snapshotLayer.opacity:100)/100;
    const lineFactor=targetCtx.__spiroLineOpacityOnly===true?Math.max(0,Math.min(1,(Number.isFinite(Number(snapshotLayer.lineOpacity))?Number(snapshotLayer.lineOpacity):100)/100)):1;
    targetCtx.globalAlpha=opacity*lineFactor*alphaMultiplier*fadeAlpha;
    renderLayerOrbitPaths(targetCtx,snapshotLayer,drawData);
    targetCtx.restore();
}

function drawGreenGeometryPlanSnapshot(targetCtx,frameCtx,snapshotLayer,paths,alphaMultiplier,fadeAlpha) {
    if(!snapshotLayer||!Array.isArray(paths)||!paths.length||fadeAlpha<=.001||snapshotLayer.visible===false)return;
    if(getLayerFillMatchStroke(snapshotLayer)||getLayerFillMatchStroke(frameCtx.sourceLayer))syncLayerFillColorToStroke(snapshotLayer,true);
    targetCtx.save();
    targetCtx.lineWidth=(Number(snapshotLayer.strokeWidth)||1.5)/Math.max(.001,frameCtx.combinedScale);
    targetCtx.strokeStyle=snapshotLayer.strokeColor||'#ffffff';
    targetCtx.fillStyle=snapshotLayer.fillColor||'transparent';
    const opacity=Math.max(0,Math.min(1,Number(snapshotLayer.opacity??100)/100)),lineFactor=targetCtx.__spiroLineOpacityOnly===true?Math.max(0,Math.min(1,(Number.isFinite(Number(snapshotLayer.lineOpacity))?Number(snapshotLayer.lineOpacity):100)/100)):1;
    MorphRendering.drawPreparedMorphGeometry(targetCtx,snapshotLayer,paths,0,opacity*lineFactor*alphaMultiplier*fadeAlpha);
    targetCtx.restore();
}

function executeMainLayerGeometryPlan(targetCtx,frameCtx,alphaMultiplier=1) {
    const plan=frameCtx.geometryPlan;
    const layer=frameCtx.layer;
    const layerIndex=frameCtx.layerIndex;
    const strokeBaseAlpha=targetCtx.__spiroLineOpacityOnly===true?Math.max(0,Math.min(1,Number(frameCtx.lineAlpha??frameCtx.baseAlpha)||0)):frameCtx.baseAlpha;
    targetCtx.save();
    try {
        // v522.9 — Fill follows ordinary line visibility. lineDisplayEnabled may still become
        // true for a Lightning flash while the base line is hidden; the Lightning branch below
        // draws only the flash and therefore never resurrects the static Fill.
        if(!frameCtx.lineDisplayEnabled)return;

        if(plan.kind==='green-fade' || plan.kind==='green-morph') {
            applyMainGeometryTransform(targetCtx,frameCtx);
            if(plan.kind==='green-fade') {
                drawGreenGeometryPlanSnapshot(targetCtx,frameCtx,plan.sourceLayer,plan.sourcePaths,alphaMultiplier,1-plan.progress);
                drawGreenGeometryPlanSnapshot(targetCtx,frameCtx,plan.targetLayer,plan.targetPaths,alphaMultiplier,plan.progress);
            } else {
                if((!Array.isArray(plan.framePaths)||!plan.framePaths.length)&&typeof ensureProjectMorphFrameGeometryLayer==='function'){
                    plan.framePaths=ensureProjectMorphFrameGeometryLayer(layerIndex,plan.progress);
                    if(frameCtx.greenMorphProvider)frameCtx.greenMorphProvider.framePaths=plan.framePaths;
                    frameCtx._greenMorphCpuFallbackMaterialized=true;
                }
                MorphRendering.drawPreparedMorphGeometry(targetCtx,layer,plan.framePaths||[],plan.progress,strokeBaseAlpha*alphaMultiplier,plan.sourceProfileMode,plan.targetProfileMode);
            }
            return;
        }

        if(plan.kind==='lightning') {
            if(frameCtx.lightningFlashAlpha>.001) {
                applyMainGeometryTransform(targetCtx,frameCtx);
                drawLightningCentralMorph(targetCtx,layerIndex,layer,plan.progress,strokeBaseAlpha*alphaMultiplier*frameCtx.lightningFlashAlpha);
            }
            return;
        }

        if(frameCtx.lightningStroke) {
            targetCtx.strokeStyle=frameCtx.lightningStroke;
            targetCtx.fillStyle='transparent';
            targetCtx.globalAlpha=Math.max(0,Math.min(1,frameCtx.lightningFlashAlpha*alphaMultiplier));
        }
        applyMainGeometryTransform(targetCtx,frameCtx);

        switch(plan.kind) {
            case 'orange-fade':
                drawGeometryPlanSnapshot(targetCtx,frameCtx,plan.sourceLayer,plan.sourceData,alphaMultiplier,1-plan.progress);
                drawGeometryPlanSnapshot(targetCtx,frameCtx,plan.targetLayer,plan.targetData,alphaMultiplier,plan.progress);
                break;
            case 'blue-fade':
                MorphRendering.drawFadeMorph(targetCtx,layer,plan.sourceGeometry,plan.targetGeometry,plan.progress,strokeBaseAlpha*alphaMultiplier);
                break;
            case 'blue-circle-slide':
                MorphRendering.drawCircleSlideMorph(targetCtx,layer,plan.sourceLayer,plan.targetLayer,plan.progress,strokeBaseAlpha*alphaMultiplier);
                break;
            case 'blue-circle':
                MorphRendering.drawMorphGeometry(targetCtx,layer,plan.sourceGeometry,plan.targetGeometry,plan.progress,strokeBaseAlpha*alphaMultiplier,plan.byTopology,plan.sourceProfileMode,plan.targetProfileMode);
                break;
            case 'blue-prepared':
                if(!plan.framePaths){plan.framePaths=getLayerFrameAuxiliaryPaths(frameCtx);if(frameCtx.geometryProvider)frameCtx.geometryProvider.framePaths=plan.framePaths;frameCtx._topologyMorphCpuFallbackMaterialized=true;}
                MorphRendering.drawPreparedMorphGeometry(targetCtx,layer,plan.framePaths,plan.progress,strokeBaseAlpha*alphaMultiplier,plan.sourceProfileMode,plan.targetProfileMode);
                break;
            case 'light-static':
            case 'static':
            default:
                targetCtx.globalAlpha=strokeBaseAlpha*alphaMultiplier;
                renderLayerOrbitPaths(targetCtx,layer,plan.sourceData||frameCtx.staticDrawData);
                break;
        }
    } finally {
        targetCtx.restore();
    }
}

function prepareMainLayerGeometry(frameCtx) {
    const layer=frameCtx.layer;
    const blue=frameCtx.blueMorphProvider;
    const orange=frameCtx.orangeMorphProvider;
    const green=frameCtx.greenMorphProvider;
    // v505 — static authored geometry gets one canonical owner. Dynamic Geometry Morph
    // keeps its existing frame-local path because its coordinates legitimately change every frame.
    frameCtx.canonicalGeometry=(!frameCtx.geometryMorphEnabled&&!frameCtx.lightMorphEnabled&&typeof getCanonicalLayerGeometry==='function')
        ? getCanonicalLayerGeometry(layer)
        : null;
    frameCtx.staticDrawData=frameCtx.geometryMorphEnabled?null:(
        frameCtx.lightMorphEnabled
            ? (blue?.lightDrawData || getCachedLayerDrawData(layer))
            : (frameCtx.canonicalGeometry?.drawData || getCachedLayerDrawData(layer))
    );
    if(frameCtx.canonicalGeometry&&typeof noteCanonicalGeometryConsumer==='function')noteCanonicalGeometryConsumer('prepareMainLayerGeometry');

    const baseExtent=frameCtx.staticDrawData?.maxRadius || frameCtx.canonicalGeometry?.summary?.maxRadius || Math.max(1,getEffectiveLayerRadius(layer,220)*1.8);
    frameCtx.layerExtent=(green?.geometryActive
        ? green.extent
        : (orange?.geometryActive ? orange.extent : baseExtent))*frameCtx.lightMorphScale;

    const plan=prepareMainLayerGeometryPlan(frameCtx);
    plan.extent=frameCtx.layerExtent;
    frameCtx.drawLayerGeometry=(targetCtx,alphaMultiplier=1)=>executeMainLayerGeometryPlan(targetCtx,frameCtx,alphaMultiplier);
}

function prepareMainLayerInstances(frameCtx, renderFrame) {
    const layerIndex = frameCtx.layerIndex;
    const layer = frameCtx.layer;
    frameCtx.visibleInstances = prepareTunnelVisibleInstances(
        renderFrame.tunnelCopies, frameCtx.layerExtent, frameCtx.audioScale, renderFrame.viewportOuterRadius, state.zoom, layer?.id || layerIndex, frameCtx.now
    );
    const metrics=frameCtx.instanceMetrics;metrics.length=frameCtx.visibleInstances.copies.length;
    const metricZoom=Math.max(.001,Number(state.zoom)||1),metricCombined=Math.abs(Number(frameCtx.combinedScale)||1);
    const metricRadiusBase=Math.max(0,Number(frameCtx.layerExtent)||0)*Math.max(.001,Number(frameCtx.audioScale)||1)*metricZoom;
    for(let mi=0;mi<metrics.length;mi++){const copy=frameCtx.visibleInstances.copies[mi];let m=metrics[mi];if(!m)m=metrics[mi]={screenScale:1,radiusPx:0};const cs=Math.abs(Number(copy?.scale)||0);m.screenScale=state.tunnel.active?Math.max(.000001,cs*metricCombined*metricZoom):Math.max(.001,metricCombined*metricZoom);m.radiusPx=state.tunnel.active?metricRadiusBase*cs:metricRadiusBase;}
    const glowBase = frameCtx.minimalFadeEnabled
        ? Math.max(0, (Number(frameCtx.minimalSourceLayer?.glow)||0)*getLayerGlowMultiplier(frameCtx.minimalSourceLayer), (Number(frameCtx.minimalTargetLayer?.glow)||0)*getLayerGlowMultiplier(frameCtx.minimalTargetLayer))
        : Math.max(0, (Number(layer.glow)||0)*getLayerGlowMultiplier(layer));
    frameCtx.glow = frameCtx.geometryPlan?.kind === 'lightning'
        ? 0
        : audioApplyNumeric('layer.glow',glowBase,layerIndex);
}

function prepareMainLayerVectorMaster(frameCtx) {
    let frameVectorMaster = null;
    let frameVectorMasterScale = 1;
    const tunnelCanUseMaster = state.tunnel.active;
    const topologyGpuLazy=frameCtx._topologyMorphGpuLazy===true&&typeof WebGPUTopologyMorphBaseRenderer!=='undefined'&&WebGPUTopologyMorphBaseRenderer.isEligible?.(frameCtx,'base');
    const greenProjectGpuNative=typeof WebGPUGreenProjectMorphRenderer!=='undefined'&&WebGPUGreenProjectMorphRenderer.isEligible?.(frameCtx)&&state.lineOutline?.enabled!==true;
    // Somata 6.7: retained Spiral Bézier Morph already provides Base/Glow/Corridor on GPU.
    // Recording a dynamic Canvas vector master here secretly rebuilt the entire interpolated
    // Spiral on CPU every frame, defeating the GPU path even before rendering started.
    const spiralBezierGpuNative=frameCtx.morphFrameActive===true&&typeof WebGPUSpiralBezierMorphRenderer!=='undefined'&&WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'base')===true;
    const shouldRecordDynamicVector = (topologyGpuLazy||greenProjectGpuNative||spiralBezierGpuNative)?false:(typeof shouldPrepareDynamicVectorMaster==='function'
        ? shouldPrepareDynamicVectorMaster(frameCtx)
        : Boolean(frameCtx.geometryMorphEnabled && frameCtx.geometryPlan?.kind !== 'lightning' && typeof Path2D !== 'undefined' && !state.showRoundingGuides &&
            ((tunnelCanUseMaster && frameCtx.visibleInstances.copies.length) || (!state.tunnel.active && frameCtx.glow > 0) || state.lineOutline?.enabled === true)));
    if (shouldRecordDynamicVector) {
        frameVectorMasterScale = state.tunnel.active ? frameCtx.visibleInstances.maxScale : 1;
        try {
            const rec = createVectorRecordingContext({
                globalAlpha: 1,
                lineWidth: frameCtx.strokeWidth,
                strokeStyle: frameCtx.layer.strokeColor || '#ffffff',
                fillStyle: frameCtx.layer.fillColor || 'transparent',
                lineCap: frameCtx.lineCap,
                lineJoin: frameCtx.lineJoin,
                miterLimit: frameCtx.miterLimit
            });
            rec.scale(frameVectorMasterScale, frameVectorMasterScale);
            if (frameCtx.lineProfileStrokeOnly) rec.__suppressStroke = true;
            frameCtx.drawLayerGeometry(rec, 1);
            if (rec.commands.length) frameVectorMaster = rec;
        } catch (err) {
            frameVectorMaster = null;
        }
    }

    frameCtx.frameVectorMaster = frameVectorMaster;
    frameCtx.frameVectorMasterScale = frameVectorMasterScale;
    frameCtx.tunnelCanUseMaster = tunnelCanUseMaster;
    frameCtx.drawLayerInstances = (targetCtx, ignoreMaster = false, instanceWeight = null, allowHiddenGraffitiCarrier = false) => {
        const copies = frameCtx.visibleInstances.copies;
        const alphas = frameCtx.visibleInstances.alphas;
        const previousSuppressStroke = targetCtx.__suppressStroke;
        const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
        if (frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier) targetCtx.__suppressStroke = true;
        for (let i = 0; i < copies.length; i++) {
            const copy = copies[i];
            const rawAlpha = alphas[i];
            const weight = instanceWeight ? Math.max(0,Math.min(1,Number(instanceWeight(copy,rawAlpha,i))||0)) : 1;
            if(weight<=0.0001)continue;
            const alpha = rawAlpha*weight;
            if(alpha<=0.0001)continue;
            const previousSpiralAlphaEndRatio = targetCtx.__spiralCorridorAlphaEndRatio;
            if (state.tunnel.active && isSpiralLayer(frameCtx.layer) && frameCtx.layer.spiralClosed !== false) {
                let nextAlpha = alpha;
                if (i + 1 < copies.length) {
                    const nextCopy = copies[i + 1];
                    const nextRawAlpha = alphas[i + 1];
                    const nextWeight = instanceWeight ? Math.max(0, Math.min(1, Number(instanceWeight(nextCopy, nextRawAlpha, i + 1)) || 0)) : 1;
                    nextAlpha = Math.max(0, nextRawAlpha * nextWeight);
                }
                // The end of every closed spiral edge in copy i is the beginning of an
                // edge in copy i+1.  Supplying the neighbour ratio lets the spiral stroke
                // ramp smoothly to exactly the alpha that continues at the seam.
                targetCtx.__spiralCorridorAlphaEndRatio = alpha > 1e-8 ? nextAlpha / alpha : 1;
            } else {
                delete targetCtx.__spiralCorridorAlphaEndRatio;
            }
            if (state.tunnel.active) {
                const copyStroke=getTunnelCopyColor(frameCtx.tunnelBaseStrokeColor,copy,frameCtx.tunnelPaletteProfile);
                const copyFill=frameCtx.tunnelBaseFillColor==='transparent'?'transparent':getTunnelCopyColor(frameCtx.tunnelBaseFillColor,copy,frameCtx.tunnelPaletteProfile);
                if (frameCtx.frameVectorMaster && frameCtx.tunnelCanUseMaster && !ignoreMaster) {
                    targetCtx.save();
                    applyMotionTunnelLag(targetCtx,copy,frameCtx.layer);
                    replayVectorRecording(targetCtx, frameCtx.frameVectorMaster, alpha, copy.scale / frameCtx.frameVectorMasterScale, {strokeStyle:copyStroke,fillStyle:copyFill});
                    targetCtx.restore();
                } else {
                    targetCtx.save();
                    targetCtx.strokeStyle=copyStroke;targetCtx.fillStyle=copyFill;
                    applyMotionTunnelLag(targetCtx,copy,frameCtx.layer);
                    targetCtx.scale(copy.scale, copy.scale);
                    frameCtx.drawLayerGeometry(targetCtx, alpha);
                    targetCtx.restore();
                }
            } else if (frameCtx.frameVectorMaster && !ignoreMaster) {
                replayVectorRecording(targetCtx, frameCtx.frameVectorMaster, alpha, 1);
            } else {
                frameCtx.drawLayerGeometry(targetCtx, alpha);
            }
            if (previousSpiralAlphaEndRatio === undefined) delete targetCtx.__spiralCorridorAlphaEndRatio;
            else targetCtx.__spiralCorridorAlphaEndRatio = previousSpiralAlphaEndRatio;
        }
        if (previousSuppressStroke === undefined) delete targetCtx.__suppressStroke;
        else targetCtx.__suppressStroke = previousSuppressStroke;
    };

    // v280: fill copies use the same temporal/size fade but deliberately skip the
    // line-density attenuation. Their coverage is union-normalized in the fill mask,
    // so converging corridor copies or sub-orbits smoothly settle at one fill level.
    frameCtx.drawLayerFillInstances = (targetCtx) => {
        const copies=frameCtx.visibleInstances.copies;
        const alphas=frameCtx.visibleInstances.fillAlphas||frameCtx.visibleInstances.alphas;
        const prevSuppressStroke=targetCtx.__suppressStroke;
        targetCtx.__suppressStroke=true;
        for(let i=0;i<copies.length;i++){
            const copy=copies[i],alpha=Math.max(0,Math.min(1,Number(alphas[i])||0));
            if(alpha<=.0001)continue;
            if(state.tunnel.active){targetCtx.save();const copyFill=frameCtx.tunnelBaseFillColor==='transparent'?'transparent':getTunnelCopyColor(frameCtx.tunnelBaseFillColor,copy,frameCtx.tunnelPaletteProfile);targetCtx.fillStyle=copyFill;applyMotionTunnelLag(targetCtx,copy,frameCtx.layer);targetCtx.scale(copy.scale,copy.scale);frameCtx.drawLayerGeometry(targetCtx,alpha);targetCtx.restore();}
            else frameCtx.drawLayerGeometry(targetCtx,alpha);
        }
        if(prevSuppressStroke===undefined)delete targetCtx.__suppressStroke;else targetCtx.__suppressStroke=prevSuppressStroke;
    };
}

// v201 — Effect providers normalize all non-geometry layer effects before drawing.
// Render passes consume LayerEffectsPlan only; legacy state lookups are confined here.
function resetLayerEffectsPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    const glow=p.glow||(p.glow={});
    glow.enabled=false;glow.amount=0;glow.compositeAlpha=0;glow.tunnelActive=false;glow.tunnelGlowScale=1;glow.panX=0;glow.panY=0;glow.zoom=1;
    const outline=p.outline||(p.outline={});
    outline.enabled=false;outline.graffiti=false;outline.gpuMorphNative=false;outline.paths=null;outline.profilePrepared=null;outline.raster=null;outline.outlineLayer=null;outline.coreLayer=null;outline.baseLineWidth=0;outline.extra=0;outline.width=0;outline.color='#ffffff';outline.join='round';outline.footprint=0;outline.tunnelActive=false;outline.mode='outer';outline.outerAdd=0;outline.coreInset=0;
    const profile=p.profile||(p.profile={});
    profile.enabled=false;profile.application='stroke';profile.gpuMorphNative=false;profile.paths=null;profile.prepared=null;profile.raster=null;profile.footprint=0;profile.tunnelActive=false;
    const sweep=p.sweep||(p.sweep={});
    sweep.enabled=false;sweep.contextDriven=true;sweep.cfg=null;sweep.paths=null;sweep.frameData=null;sweep.footprint=0;sweep.now=0;sweep.tunnelActive=false;
    const motion=p.motion||(p.motion={});motion.enabled=false;motion.cfg=null;motion.table=null;motion.gpuMorphArc=false;motion.replaceBaseReady=false;motion.footprint=0;motion.now=0;
    const sprite=p.sprite||(p.sprite={});sprite.enabled=false;sprite.cfg=null;sprite.table=null;sprite.gpuMorphArc=false;sprite.replaceBaseReady=false;sprite.footprint=0;sprite.now=0;
    const web=p.web||(p.web={});
    web.enabled=false;web.contextDriven=true;web.paths=null;web.frameData=null;web.footprint=0;web.tunnelActive=false;
    const lamps=p.lamps||(p.lamps={});
    lamps.enabled=false;lamps.contextDriven=true;lamps.baseConfig=null;lamps.instances=null;lamps.adaptiveCount=0;lamps.tunnelActive=false;lamps.drawContract='LampDrawPlan';
    if(!Array.isArray(lamps.sets))lamps.sets=[];else lamps.sets.length=0;if(!Array.isArray(lamps.setPool))lamps.setPool=[];lamps.setCursor=0;
    return p;
}

function resolveLayerGlowEffectProvider(frameCtx,plan){
    const layer=frameCtx.layer,dpr=frameCtx.frame.dpr;
    const intensityBase=Math.max(0,(Number.isFinite(Number(layer.glowIntensity))?Number(layer.glowIntensity):40)/100);
    const intensity=intensityBase*getLayerGlowIntensityMultiplier(layer);
    const compositeAlpha=(frameCtx.minimalFadeEnabled?0.72:frameCtx.baseAlpha*0.72)*intensity;
    plan.amount=Math.max(0,Number(frameCtx.glow)||0);
    plan.compositeAlpha=compositeAlpha;
    plan.tunnelActive=state.tunnel.active===true;
    plan.tunnelGlowScale=plan.tunnelActive?1/Math.max(1,dpr):1;
    plan.panX=(Number(state.panX)||0)+(Number(frameCtx.frame?.motionPanX)||0);plan.panY=(Number(state.panY)||0)+(Number(frameCtx.frame?.motionPanY)||0);plan.zoom=Number(state.zoom)||1;plan.rotationRad=Number(frameCtx.frame?.motionRotationRad)||0;
    plan.enabled=frameCtx.lineDisplayEnabled&&plan.amount>0&&compositeAlpha>.001;
    return plan;
}

function resolveLayerOutlineEffectProvider(frameCtx,plan){
    const layer=frameCtx.layer;
    plan.enabled=state.lineOutline?.enabled===true&&getLayerLineVisible(layer)&&frameCtx.geometryPlan?.kind!=='lightning';
    plan.tunnelActive=state.tunnel.active===true;
    if(!plan.enabled)return plan;
    plan.baseLineWidth=Math.max(.001,frameCtx.strokeWidth);
    plan.extra=Math.max(.1,Math.min(30,audioApplyNumeric('outline.width',Number(state.lineOutline.width)||1.5,frameCtx.layerIndex)));
    plan.color=state.lineOutline.color||'#ffffff';
    plan.mode=['outer','inner','median'].includes(state.lineOutline?.mode)?state.lineOutline.mode:'outer';
    plan.outerAdd=plan.mode==='outer'?plan.extra:(plan.mode==='median'?plan.extra*.5:0);
    plan.coreInset=plan.mode==='inner'?plan.extra:(plan.mode==='median'?plan.extra*.5:0);
    plan.join=(layer.lineJoinType||'rounded')==='straight'?'miter':'round';
    plan.graffiti=frameCtx.lineProfileApplication==='graffiti';
    if(plan.graffiti){
        // v514: try the resident topology-Morph source before touching the CPU path accessor.
        // Unsupported nib/variation/geometry modes keep the historical exact preparation.
        const gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();
        const nativePrepared=gpuBackendAllowed&&typeof prepareGpuMorphGraffitiFrame==='function'?prepareGpuMorphGraffitiFrame(frameCtx):null;
        if(nativePrepared){plan.gpuMorphNative=true;plan.paths=null;plan.profilePrepared=nativePrepared;}
        else if(isStrictSpiralWebGPUFrame(frameCtx)){plan.enabled=false;try{requestMainCanvasRender?.();}catch(_){ }return plan;}
        else{plan.paths=getLayerFrameAuxiliaryPaths(frameCtx);if(plan.paths?.length)plan.profilePrepared=prepareLayerFrameProfileData(frameCtx);}
        if(plan.profilePrepared){
            plan.width=plan.baseLineWidth+plan.outerAdd*2;
            plan.outlineLayer={...layer,strokeColor:plan.color,strokeWidth:plan.width,strokeWidthMultiplier:1,glow:0,glowMultiplier:1,glowIntensity:0,glowIntensityMultiplier:1};
            const coreWidth=Math.max(.001,plan.baseLineWidth-plan.coreInset*2);
            plan.coreLayer=plan.coreInset>0?{...layer,strokeWidth:coreWidth,strokeWidthMultiplier:1,glow:0,glowMultiplier:1,glowIntensity:0,glowIntensityMultiplier:1}:null;
            plan.raster=null;
            plan.footprint=Math.max(plan.width,Math.max(0,Number(layer.glow)||0)*getLayerGlowMultiplier(layer)*.55);
        }
    }
    return plan;
}

// Somata 6.8 Iter17 — strict Spiral line profiles never materialize a CPU path.
// Marker count is a cheap scalar estimate from endpoint retained-cubic lengths; every visible
// marker centre is resolved from the exact shared GPU Arc / retained Bézier rail in WGSL.
function prepareStrictSpiralGpuProfileFrame(frameCtx,lineModeProfile){
    if(!frameCtx||!isStrictSpiralWebGPUFrame(frameCtx)||!['slash','square','circle','cross'].includes(lineModeProfile))return null;
    const table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null,arcRec=table?._gpuMorphArcResource,morphRec=arcRec?.morphRec;if(!table?.gpuArcResident||!arcRec?.ready||!morphRec?.cubicBuffer)return null;
    const layer=frameCtx.layer,baseW=Math.max(.001,(Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer)),w=baseW*4,spacing=Math.max(2.4,w*(lineModeProfile==='slash'?1.85:1.55));
    const rawT=Number(table.gpuMorphT)||0,t=typeof morphRec.resolveMorphT==='function'?morphRec.resolveMorphT(rawT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(rawT):Math.max(0,Math.min(1,rawT))),lens=morphRec.cpuEndpointPathLengths;let total=0;
    if(lens?.length){for(let i=0;i+1<lens.length;i+=2)total+=(Number(lens[i])||0)*(1-t)+(Number(lens[i+1])||0)*t;}
    if(!(total>0))total=Math.max(spacing,Number(morphRec.cubicCount||arcRec.logicalSegmentCount||1)*spacing);
    const count=Math.max(0,Math.min(1800,Math.floor(total/spacing))),prepared={paths:null,rounded:null,type:lineModeProfile,application:'stroke',table,w,spacing,count,variationOn:false,gpuArcNative:true,gpuBezierDerived:true,retainedBezier:true,bezierSubdiv:Number(arcRec.subdiv||morphRec.bezierSubdiv)||6,estimatedArcTotal:total};
    frameCtx.profilePrepared=prepared;frameCtx.profilePreparedReady=true;return prepared;
}

function resolveLayerProfileEffectProvider(frameCtx,plan){
    const layer=frameCtx.layer;
    plan.application=frameCtx.lineProfileApplication;
    const lineModeProfile=layer?.sprite?.enabled===true?'round':normalizeLineProfileValue(layer?.lineProfileStroke ?? layer?.lineProfile,'round');if(layer?.sprite?.enabled===true){layer.lineProfile='round';layer.lineProfileStroke='round';}plan.enabled=getLayerLineVisible(layer)&&(['slash','square','circle','cross'].includes(lineModeProfile)||plan.application==='graffiti');
    plan.tunnelActive=state.tunnel.active===true;
    if(!plan.enabled)return plan;
    if(plan.application==='graffiti'){
        const gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();
        const nativePrepared=gpuBackendAllowed&&typeof prepareGpuMorphGraffitiFrame==='function'?prepareGpuMorphGraffitiFrame(frameCtx):null;
        if(nativePrepared){plan.gpuMorphNative=true;plan.paths=null;plan.prepared=nativePrepared;}
        else if(isStrictSpiralWebGPUFrame(frameCtx)){plan.enabled=false;try{requestMainCanvasRender?.();}catch(_){ }return plan;}
    }else if(isStrictSpiralWebGPUFrame(frameCtx)){
        const nativePrepared=prepareStrictSpiralGpuProfileFrame(frameCtx,lineModeProfile);
        if(nativePrepared){plan.gpuArcNative=true;plan.paths=null;plan.prepared=nativePrepared;}
        else{plan.enabled=false;plan.paths=null;try{WebGPUProfileArcMarkerRenderer?.warmup?.();requestMainCanvasRender?.();}catch(_){ }return plan;}
    }
    if(!plan.prepared){plan.paths=getLayerFrameAuxiliaryPaths(frameCtx);if(!plan.paths?.length){plan.enabled=false;return plan;}plan.prepared=prepareLayerFrameProfileData(frameCtx);}
    plan.raster=null;
    plan.footprint=plan.application==='graffiti'
        ? Math.max(Number(frameCtx.strokeWidth)||1.5,Math.max(0,(Number(layer.glow)||0)*getLayerGlowMultiplier(layer))*.55)
        : Math.max(1,Number(plan.prepared?.spacing)||Number(frameCtx.strokeWidth)||1.5);
    return plan;
}

function resolveLayerSweepEffectProvider(frameCtx,plan){
    const cfg=getLayerSweepConfig(frameCtx.layer);
    frameCtx.layerSweep=cfg; // legacy helper compatibility during preparation
    plan.cfg=cfg;plan.enabled=cfg?.enabled===true;plan.tunnelActive=state.tunnel.active===true;plan.now=frameCtx.now;plan.gpuMorphArc=false;plan.gpuMorphArcLightning=false;
    if(!plan.enabled)return plan;
    // v516: Exact Lightning gets first access to the shared GPU Arc before any CPU path accessor.
    // Unsupported placement/clip semantics fall through to the historical exact preparation.
    const gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();
    const lightningGpuData=gpuBackendAllowed&&typeof prepareGpuMorphArcLightningFrame==='function'?prepareGpuMorphArcLightningFrame(frameCtx,cfg):null;
    if(lightningGpuData){plan.paths=null;plan.frameData=lightningGpuData;plan.gpuMorphArcLightning=lightningGpuData.gpuMorphArcLightning===true;const lv=lightningGpuData.lightningVector,vis=typeof getLightningVisualSettings==='function'?getLightningVisualSettings(cfg,frameCtx.layerIndex):null;plan.footprint=Math.max(1,Number(vis?.glowSize)||(Number(cfg.lightningGlow)||0)*Math.max(0,Number(cfg.lightningGlowMultiplier)||1),Number(lv?.boltW)||Number(frameCtx.strokeWidth)||1.5);return plan;}
    // v512: whole/perPath Glint can consume the exact shared GPU Morph Arc resource directly.
    // Do this BEFORE getLayerFrameAuxiliaryPaths(), otherwise merely enabling Sweep forces an
    // O(N) CPU Morph path + arc walk even though the renderer never needs those objects.
    const gpuData=gpuBackendAllowed&&typeof prepareGpuMorphArcSweepFrame==='function'?prepareGpuMorphArcSweepFrame(frameCtx,cfg):null;
    if(gpuData){plan.paths=null;plan.frameData=gpuData;plan.gpuMorphArc=gpuData.gpuMorphArc===true;const sweepCfg=gpuData.cfg||cfg;plan.footprint=Math.max(.5,Number(gpuData.sweepW)||Number(frameCtx.strokeWidth)||1.5,(Number(sweepCfg?.glow)||0)*.55*Math.max(0,Number(sweepCfg?.glowMultiplier)||1));return plan;}
    // 6.8 strict Spiral: an effect warmup/ineligible GPU branch must never trigger the lazy
    // CPU Morph path accessor. That accessor materializes a sampled rail and was the source of
    // both visible contour drift and large Spiral-frame CPU spikes. Wait for the resident
    // cubic/GPU-Arc resource instead.
    if(isStrictSpiralWebGPUFrame(frameCtx)){plan.enabled=false;plan.paths=null;plan.frameData=null;try{requestMainCanvasRender?.();}catch(_){}return plan;}
    plan.paths=getLayerFrameAuxiliaryPaths(frameCtx);
    if(!plan.paths?.length){plan.enabled=false;return plan;}
    plan.frameData=prepareLayerFrameSweepData(frameCtx);
    const sweepCfg=plan.frameData?.cfg||cfg;
    plan.footprint=sweepCfg?.effectType==='lightning'
        ? Math.max(1,Number((typeof getLightningVisualSettings==='function'?getLightningVisualSettings(sweepCfg,frameCtx.layerIndex):null)?.glowSize)||(Number(sweepCfg.lightningGlow)||0)*Math.max(0,Number(sweepCfg.lightningGlowMultiplier)||1),Number(frameCtx.strokeWidth)||1.5)
        : Math.max(.5,Number(plan.frameData?.sweepW)||Number(frameCtx.strokeWidth)||1.5,(Number(sweepCfg?.glow)||0)*.55*Math.max(0,Number(sweepCfg?.glowMultiplier)||1));
    return plan;
}

function resolveLayerMotionEffectProvider(frameCtx,plan){
    const owner=ensureLayerEffectState(frameCtx.layer),cfg=owner?.lineMotionFx||createDefaultLineMotionFxConfig();if(cfg.type==='sine')cfg.type='seaRaft';plan.cfg=cfg;plan.enabled=cfg.enabled===true;plan.now=frameCtx.now;if(!plan.enabled)return plan;
    plan.table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null;plan.gpuMorphArc=plan.table?.gpuArcResident===true;
    if(!plan.table&&isStrictSpiralWebGPUFrame(frameCtx)){plan.enabled=false;try{requestMainCanvasRender?.();}catch(_){ }return plan;}
    if(!plan.table)plan.table=getLayerFramePathFxTable(frameCtx);
    if(!(plan.table?.gpuArcResident===true)&&!plan.table?.total){plan.enabled=false;return plan;}plan.footprint=Math.max(1,(Number(frameCtx.strokeWidth)||1.5)*Math.max(.2,Number(cfg.widthPercent)||100)/100+Math.max(0,Number(cfg.amplitudePx)||0)*Math.max(0,Number.isFinite(Number(cfg.amplitudeMultiplier))?Number(cfg.amplitudeMultiplier):1));WebGPUPathFxRenderer.warmup();plan.replaceBaseReady=cfg.replaceBase===true&&WebGPUPathFxRenderer.isReady();return plan;
}
function resolveLayerSpriteEffectProvider(frameCtx,plan){
    const cfg=ensureLayerEffectState(frameCtx.layer)?.sprite||createDefaultLineSpriteConfig();cfg.lengthPercent=100;cfg.amplitudePx=0;cfg.speedPercent=0;plan.cfg=cfg;plan.enabled=cfg.enabled===true;plan.now=frameCtx.now;if(!plan.enabled)return plan;
    plan.table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null;plan.gpuMorphArc=plan.table?.gpuArcResident===true;
    if(!plan.table&&isStrictSpiralWebGPUFrame(frameCtx)){plan.enabled=false;try{requestMainCanvasRender?.();}catch(_){ }return plan;}
    if(!plan.table)plan.table=getLayerFramePathFxTable(frameCtx);
    if(!(plan.table?.gpuArcResident===true)&&!plan.table?.total){plan.enabled=false;return plan;}plan.footprint=Math.max(1,(Number(frameCtx.strokeWidth)||1.5)*Math.max(.4,Number(cfg.widthPercent)||1800)/100*Math.max(.01,Number(cfg.widthMultiplier)||1));WebGPUPathFxRenderer.warmup();plan.replaceBaseReady=!lineSpritePlacementIsSparse(cfg.mode)&&WebGPUPathFxRenderer.isReady();return plan;
}

function resolveLayerWebEffectProvider(frameCtx,plan){
    plan.enabled=getLayerWebEnabled(frameCtx.layer)===true;plan.tunnelActive=state.tunnel.active===true;plan.gpuMorphWebNative=false;
    if(!plan.enabled)return plan;
    // v517: ask the topology/arc bridge before touching getLayerFrameAuxiliaryPaths().
    // A supported ultra-polygon Morph therefore keeps Web completely off the CPU geometry path.
    const nativeData=typeof prepareGpuMorphWebFrame==='function'?prepareGpuMorphWebFrame(frameCtx):null;
    if(nativeData){plan.frameData=nativeData;plan.paths=null;plan.gpuMorphWebNative=true;plan.enabled=true;}
    // prepareGpuMorphWebFrame may intentionally degrade the complete strict scene to the CPU
    // reference backend after a bounded native warm-up. Re-evaluate strictness AFTER prepare.
    else if(isStrictSpiralWebGPUFrame(frameCtx)){plan.enabled=false;try{requestMainCanvasRender?.();}catch(_){ }return plan;}
    else{plan.frameData=prepareLayerFrameWebData(frameCtx);plan.paths=plan.frameData?.paths||getLayerFrameAuxiliaryPaths(frameCtx);plan.enabled=plan.frameData?.enabled===true&&Boolean(plan.paths?.length);}
    if(plan.enabled)plan.footprint=Math.max(.03,Number(plan.frameData?.width)||.6)*2.4;
    return plan;
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
    const layer=frameCtx.layer,layerIndex=frameCtx.layerIndex;
    plan.enabled=frameCtx.lampDisplayEnabled===true;
    plan.tunnelActive=state.tunnel.active===true;
    plan.baseConfig=ensureLayerLampState(layer)||state.lamps;
    frameCtx.layerLampConfig=plan.baseConfig; // compatibility for legacy lamp helpers
    if(!plan.enabled)return plan;
    const {tunnelCopies,viewportOuterRadius}=frameCtx.frame;
    const instances=plan.tunnelActive
        ? prepareTunnelLampInstances(tunnelCopies,frameCtx.layerExtent,frameCtx.combinedScale,viewportOuterRadius,state.zoom,layer?.id||layerIndex,frameCtx.now,plan.baseConfig)
        : frameCtx.visibleInstances;
    plan.instances=instances;plan.adaptiveCount=instances.copies.length;
    frameCtx.lampInstances=instances;frameCtx.lampInstancesReady=true;

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
        const allowed=frameCtx.forcedLampMorph||frameCtx.greenLampDisplay||getLayerLampsEnabled(layer);
        const alpha=frameCtx.baseAlpha*((frameCtx.forcedLampMorph||followsMorph)?1:.95);
        // v520: topology-Morph Lamps ask the identity/Arc bridge BEFORE any CPU Morph path accessor.
        // Key uses phase-resident identity; Arbitrary uses contour fractions + Exact Arc.
        const strictSpiralGpuBefore=isStrictSpiralWebGPUFrame(frameCtx),gpuLampPrepared=(followsMorph||strictSpiralGpuBefore)&&allowed&&typeof prepareGpuMorphLampFrame==='function'?prepareGpuMorphLampFrame(frameCtx):null;
        if(gpuLampPrepared){pushGpuLampEffectSet(plan,layer,gpuLampPrepared,alpha,plan.baseConfig);}
        else{
            // Native preparation may degrade a stalled strict scene to the CPU reference backend.
            // Re-evaluate strictness here so the same frame can materialize the exact CPU carrier.
            const strictSpiralGpu=isStrictSpiralWebGPUFrame(frameCtx);
            if(strictSpiralGpu){plan.enabled=false;somataGpuContractError('SPIRAL_LAMP_ARC_RESOURCE_UNAVAILABLE',frameCtx,{arc:window.__spiroGpuMorphArcStatus?.()||null,lampBridge:window.__spiroGpuMorphLampBridgeStatus?.()||null,lamp:window.__spiroLampGPUStatus?.()||null,authority:(()=>{try{const r=typeof currentGpuBezierResourceForFrame==='function'?currentGpuBezierResourceForFrame(frameCtx):null;return r?{layerIndex:r.layerIndex,ready:r.ready===true,static:r.staticSpiralBezierRail===true,special:r.specialSpiralBezierRail===true,cubicCount:Number(r.cubicCount)||0,segmentCount:Number(r.segmentCount)||0,phaseSerial:Number(r.phaseSerial)||0}:null;}catch(_){return null;}})(),arcDecision:window.__spiroGpuMorphArcStatus?.()?.lastDecision||null});try{requestMainCanvasRender?.();}catch(_){ }return plan;}
            // Green project Morph already owns stable lamp coordinates. Do not materialize its
            // hundreds of interpolated contour points again just to feed Lamps.
            const rawPaths=followsMorph?getLayerFrameAuxiliaryPaths(frameCtx):null;
            const points=withLampConfig(plan.baseConfig,()=>frameCtx.greenMorphEnabled
                ? (frameCtx.greenMorphProvider?.frameLampPoints||[])
                : (followsMorph?collectMorphLampPoints(layerIndex,lampT,260,rawPaths,null):collectStaticLampPoints(layer,frameCtx.staticDrawData||undefined,240)));
            if(allowed)pushLampEffectSet(plan,layer,points,alpha,plan.baseConfig);
        }
    }
    plan.enabled=plan.sets.length>0;
    return plan;
}

// v204 — effect preparation is a pure context consumer: providers receive the
// layer/config/audio index through frameCtx and never impersonate another active layer.
function prepareMainLayerEffects(frameCtx){
    const effects=resetLayerEffectsPlan(frameCtx.effectsPlan||(frameCtx.effectsPlan={}));
    resolveLayerGlowEffectProvider(frameCtx,effects.glow);
    resolveLayerOutlineEffectProvider(frameCtx,effects.outline);
    resolveLayerProfileEffectProvider(frameCtx,effects.profile);
    resolveLayerMotionEffectProvider(frameCtx,effects.motion);
    resolveLayerSweepEffectProvider(frameCtx,effects.sweep);
    resolveLayerSpriteEffectProvider(frameCtx,effects.sprite);
    resolveLayerWebEffectProvider(frameCtx,effects.web);
    resolveLayerLampEffectProvider(frameCtx,effects.lamps);
    return effects;
}

function prepareMainLayerFrame(renderFrame, layerIndex) {
    const frameCtx = acquireLayerFrameEffectContext(layerIndex);
    frameCtx.frame = renderFrame;
    frameCtx.runtime = renderRuntime;
    frameCtx.now = renderFrame.now;
    if (!resolveMainLayerFrameSource(frameCtx, renderFrame)) return null;
    prepareMainLayerMorphState(frameCtx, renderFrame);
    prepareMainLayerTransformAndStyle(frameCtx, renderFrame);
    prepareMainLayerGeometry(frameCtx);
    prepareMainLayerInstances(frameCtx, renderFrame);
    if(typeof prepareLayerConsumerDemand==='function')prepareLayerConsumerDemand(frameCtx);
    prepareMainLayerVectorMaster(frameCtx);
    prepareMainLayerEffects(frameCtx);
    frameCtx.prepared = true;
    return frameCtx;
}

window.__spiroMorphProviderSnapshot = (layerIndex=0) => {
    const frame=renderRuntime.frame || {};
    prepareMorphProviderFrameSnapshot(frame);
    const ctx=acquireLayerFrameEffectContext(Math.max(0,Math.floor(Number(layerIndex)||0)));
    ctx.frame=frame;ctx.runtime=renderRuntime;ctx.now=performance.now();
    if(!resolveMainLayerFrameSource(ctx,frame))return null;
    const providers=resolveMainLayerMorphProviders(ctx,frame);
    const summarize=p=>({
        system:p?.system||null,
        active:p?.active===true,
        geometryActive:p?.geometryActive===true,
        kind:p?.kind||'static',
        progress:Number(p?.progress)||0,
        hasSource:Boolean(p?.sourceLayer||p?.sourceData||p?.sourceGeometry||p?.sourcePaths),
        hasTarget:Boolean(p?.targetLayer||p?.targetData||p?.targetGeometry||p?.targetPaths),
        framePaths:Array.isArray(p?.framePaths)?p.framePaths.length:0
    });
    return {
        layerIndex:ctx.layerIndex,
        owner:providers.geometry?.system||'blue',
        blue:summarize(providers.blue),
        orange:summarize(providers.orange),
        green:summarize(providers.green)
    };
};

window.__spiroEffectsPlanSnapshot = (layerIndex=0) => {
    const f=renderRuntime.frame;
    const ctx=prepareMainLayerFrame(f,Math.max(0,Math.floor(Number(layerIndex)||0)));
    if(!ctx)return null;
    const e=ctx.effectsPlan||{},geometryContract=typeof getLayerGeometryContract==='function'?getLayerGeometryContract(ctx):null;
    const out={
        layerId:ctx.layer?.id||null,
        base:Boolean(ctx.lineDisplayEnabled&&ctx.lineProfileStrokeOnly!==true),
        fill:Boolean(geometryContract?.fillRequested),
        corridor:Boolean(geometryContract?.corridor),
        geometryCircles:Boolean(ctx.layer?.geometryCircles?.enabled===true&&ctx.layer?.visible!==false),
        spiral:Boolean(ctx.layer?.spiralEnabled===true&&ctx.layer?.visible!==false),
        motionRotation:Boolean(ctx.layer?.motionRotation?.enabled===true&&ctx.layer?.visible!==false),
        glow:Boolean(e.glow?.enabled),
        outline:Boolean(e.outline?.enabled),
        profile:Boolean(e.profile?.enabled),
        profileType:e.profile?.application||'stroke',
        motion:Boolean(e.motion?.enabled),
        sprite:Boolean(e.sprite?.enabled),
        particles:Boolean(typeof normalizeParticleConfig==='function'&&normalizeParticleConfig(ctx.layer?.particles)?.enabled===true&&ctx.layer?.visible!==false),
        sweep:Boolean(e.sweep?.enabled),
        sweepType:e.sweep?.cfg?.effectType||null,
        web:Boolean(e.web?.enabled),
        lamps:Boolean(e.lamps?.enabled),
        lampSets:e.lamps?.sets?.length||0,
        lampInstances:e.lamps?.instances?.copies?.length||0
    };
    ctx.drawLayerGeometry=null;ctx.drawLayerInstances=null;ctx.frameVectorMaster=null;ctx._geometryContract=null;
    resetMainLayerGeometryPlan(ctx.geometryPlan);resetLayerEffectsPlan(ctx.effectsPlan);ctx.prepared=false;
    return out;
};

window.__somataSpiral68Audit = (layerIndex=0) => {
    const li=Math.max(0,Math.floor(Number(layerIndex)||0)),layer=(runtimeState?.morph?.frameLayers?.[li]||state?.layers?.[li]||null),src=runtimeState?.morph?.renderSourceLayers?.[li]||null,dst=runtimeState?.morph?.renderTargetLayers?.[li]||null;
    const rec=typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(li):null;
    const spiral=l=>Boolean(l&&typeof isSpiralLayer==='function'&&isSpiralLayer(l)),strict=Boolean(state?.fourierMode!==true&&(spiral(layer)||spiral(src)||spiral(dst)||(rec?.specialSpiralBezierRail===true&&rec?.gpuOnlySpiralEffects===true)));
    const arc=typeof getGpuMorphArcResource==='function'?getGpuMorphArcResource(li):null;
    const statuses={
        spiral:typeof __somataSpiralBezierMorphStatus==='function'?__somataSpiralBezierMorphStatus():null,
        arc:typeof __spiroGpuMorphArcStatus==='function'?__spiroGpuMorphArcStatus():null,
        graffiti:typeof __spiroGpuMorphGraffitiBridgeStatus==='function'?__spiroGpuMorphGraffitiBridgeStatus():null,
        lamps:typeof __spiroGpuMorphLampBridgeStatus==='function'?__spiroGpuMorphLampBridgeStatus():null,
        web:typeof __spiroWebGPUThreadStatus==='function'?__spiroWebGPUThreadStatus():null,
        particles:typeof WebGPUParticleRenderer!=='undefined'?WebGPUParticleRenderer.status?.():null,
        profileArc:typeof WebGPUProfileArcMarkerRenderer!=='undefined'?WebGPUProfileArcMarkerRenderer.status?.():null,
        scheduler:typeof __spiroGpuCommandSchedulerStatus==='function'?__spiroGpuCommandSchedulerStatus():null
    };
    const contracts={
        base:{gpu:true,bezier:Boolean(rec?.ready&&rec?.bezierVisualRail),canvasFallback:!strict},
        glint:{gpu:true,bezier:Boolean(rec?.ready&&rec?.bezierVisualRail),canvasFallback:!strict},
        lightning:{gpu:true,bezier:Boolean(rec?.ready&&rec?.bezierVisualRail),canvasFallback:!strict},
        web:{gpu:true,bezier:Boolean(arc?.table?.gpuBezierDerived),canvasFallback:!strict},
        lamps:{gpu:true,bezier:Boolean(arc?.table?.gpuBezierDerived),canvasFallback:!strict},
        graffiti:{gpu:true,bezier:Boolean(rec?.ready&&rec?.bezierVisualRail),canvasFallback:!strict},
        particles:{gpu:true,bezier:Boolean(arc?.table?.gpuBezierDerived),canvasFallback:!strict},
        profile:{gpu:true,bezier:Boolean(arc?.table?.gpuBezierDerived),canvasFallback:!strict}
    };
    const endpointSpiral=Boolean(spiral(layer)||spiral(src)||spiral(dst));
    const backend=typeof __spiroRenderBackendStatus==='function'?__spiroRenderBackendStatus():null,cpuMorph=typeof __spiroMorphCpuFallbackStatus==='function'?__spiroMorphCpuFallbackStatus():null;
    const mixedBackendObserved=Boolean(strict&&(backend?.mixedMaterialization===true||backend?.sceneCanvasTouched===true||Object.values(backend?.features||{}).some(v=>v?.backend==='canvas'||v?.backend==='mixed')));
    const strictViolation=Boolean(strict&&(!rec?.ready||!rec?.bezierVisualRail||!rec?.gpuOnlySpiralEffects||Object.values(contracts).some(c=>c.canvasFallback||!c.gpu||!c.bezier)||mixedBackendObserved));
    return{version:'7.3.9',iteration:17,layerIndex:li,strictSpiralGpu:strict,endpointSpiral,retainedBezier:Boolean(rec?.ready&&rec?.bezierVisualRail),specialMorphBezier:Boolean(rec?.specialSpiralBezierRail),gpuOnlyEffects:Boolean(rec?.gpuOnlySpiralEffects),cubicCount:Number(rec?.cubicCount)||0,arcBezierDerived:Boolean(arc?.table?.gpuBezierDerived),arcMetric:'gauss3-cubic',arcLocalInverse:'endpoint-speed-analytic',arcSegments:Number(arc?.segmentCount)||0,arcSubdiv:Number(arc?.subdiv||rec?.arcSubdiv||rec?.bezierSubdiv)||0,minimalTurnEndpointExact:true,minimalTurnPathContinuousFallback:true,authoredCornerFlags:true,orderedGpuPrerequisites:true,sharedCurrentCubicProducer:true,arcReusesOrderedBaseCubics:true,strictExceptionFallbackBlocked:true,strictNoGpuCanvasRoundTrip:true,strictGraphNoCpuWarmup:true,strictNativeFillNoCpuShadow:true,perFrameStrictPresentationLatch:true,baseMorphClockIndependentOfOptionalEffectWarmup:true,retainedSpiralSkipsDenseCpuTopology:true,optionalArcWebWarmupDoesNotGateMorphClock:true,fullGpuPrewarmGatesMorphClock:true,webNeverGatesMorphClock:true,webStaleCornerStateRebuild:true,webRendererAwaitableWarmup:true,lampArcFrameAuthoritativeRail:true,freezeLightSharesLampFrameAuthority:true,phaseCircleLampArcPreclockGate:true,fullGpuFaultRingBounded:true,effectBenchmarkConsoleProfiler:true,corridorDepthAlphaNeutralized:false,corridorVisibilityFadeOnly:false,corridorCenterShadeAdjustable:true,corridorCenterShadeGpuCull:true,canvasFallbackForbidden:true,fastGpuForbidden:true,visualBezierSubdiv:12,arcEffectSubdiv:8,webCornerCandidateCompaction:true,morphFrameLayerVersionedSync:true,orderedGlowBaseCurrentCubicReuse:true,minimalTurnArcMetricCache:true,bezierSweepUniformPooling:true,graffitiCorridorHiddenCarrierGlow:true,graffitiBaseCarrierStillSuppressed:true,graffitiHiddenCarrierOwnsGpuRoot:true,graffitiHiddenCarrierStaticCorridorMaster:true,graffitiMorphGlowUsesRetainedBezier:true,graffitiContourGlowGpuMask:true,graffitiThinCarrierGlowRemoved:true,gpuFallbackConsoleDiagnostics:true,spiralMorphSharedExplicitRenderLayout:true,v701FreezeLightFeedback:true,v701LampArcBindGroupComplete:true,staticDirectCubicResource:true,staticBaseRetainedBezierWebGPU:true,unifiedSpiralGpuSubdiv:12,exactMorphLampBoundaries:true,strictFinalCanvasPresentationBlocked:true,strictMorphCpuPathFirewall:true,minimalTurnRetainedBezierPairing:true,minimalTurnCoherentOuterTurnGuard:true,strictBaseIndependentOfEffectReadiness:true,strictEffectsOnlyGpuSceneRoot:true,strictPresentationKeepsLastGpuFrame:false,strictCentralMaterializationFirewall:true,strictLateCanvasOverlayComposite:true,strictLastLayerAvoidsGpuReadback:true,strictLateCanvasVignetteBlocked:true,strictTopologylessFillCannotBlockBase:true,strictEntryPreservesPreviousFrame:false,strictEntryPrewarmsGpu:true,iter21RollbackBaseline:true,iter22OffscreenViewportFix:true,iter23InternalBatchDecoupledFromExternalScene:true,iter23SchedulerWatchdog:true,iter23ConsoleReport:true,iter25GpuInitRetry:true,iter25InternalSceneIndependentOfFinalInit:true,iter25SpiralTrace:true,iter26StaticBaseDedicatedBezier:true,iter28CorridorOuterScopeStats:true,iter28DeterministicMorphStop:true,iter28IdleBezierPipelineWarmup:true,iter29BezierCapacityComparisonFixed:true,iter29PersistentCorridorBezierRail:true,iter29BezierReleaseAndMutableReuse:true,iter30GpuReadinessRepaint:true,iter30SpiralGestureArcPrewarm:true,iter31WgslReservedIdentifiersPurged:true,iter32ProfilePresetPreservesSpiralMode:true,iter32OpenSpiralIntegrityGuard:true,iter33ProfileSpaceSplineBeforeSpiralMap:true,iter33ExplicitGpuCompositeLayouts:true,iter33MorphArcMutableFinalize:true,iter34MappedProfileControls:true,iter34ExternalImageTextureUsage:true,iter35FrozenProfileCarrier:true,iter35WgslValidationFixes:true,iter36StaticSpiralInternalBezierBatch:true,iter36DedicatedBezierReservedForMorph:false,strictStaticCorridorDedicatedBezier:true,spiralLampKeyAuthoredOnly:true,spiralLampCornerExactBoundary:true,spiralLampArcAuthorityAwareCache:true,genericLineLayerMode:true,crossFamilySpiralPathCartesianTransport:true,strictSpiralResidentSceneJoin:true,strictSpiralWebUnderBaseOrdered:true,webIndirectActiveCornerGuard:true,webCornersAuthoredAngularFallback:true,web67NeighbourCornerDepth:true,webAuthoredCornerFractionsOnly:true,webCornerExactCubicTangents:true,webPeriodicSelfIntersectionUsesNeighbourSpan:true,webCorridorCrosslinksNative:true,webCorridorCrosslinksDepthStencilCompatible:true,splineProfileModeAuthoritative:true,spiralTopologyTechnicalCutTangentRepair:true,spiralTangentRepairPreservesAuthoredCorners:true,strictSpiralStaleMorphResourceNotStaticAuthority:true,projectDefaultModes67Parity:true,projectDefaultModesPostCommitActivation:true,projectDefaultCorridorBeforeMorph:true,projectCommitQuiescesRuntime:true,projectDefaultPostPaintVerifyOnly:true,tunnelActiveRuntimeOnly:true,tunnelActiveNotSerialized:true,strictSpiralResidentRootRecordAuthority:true,lightningGlowGpuMaskBlur:true,lightningGlowStencilBlur:true,iter37PolygonProfileBezierGeneralization:true,iter38StorageBufferLimitNegotiation:true,iter39NullOverrideSpiralTransform:true,iter39PolygonProfileBezierGeneralization:true,v69MorphMaxCoverageUnion:true,v69PeriodicBezierClosure:true,v69MorphLayerSceneIsolation:true,v69StaticCornerZeroInertia:true,v69ViewportWorkspaceGestures:true,v69SweepCoreGlowBlendModes:true,v69LightningPreflashCoreOnTop:true,v69WebLogicalBoundaryCorners:true,v69SmoothFilletCollisionHandoff:true,v69StrictCarrierIntegrityGuard:true,v69UnboundedMicroStrikes:true,v69StaticSpiralLampContract:true,corridorStrictCarrierIndependent:true,corridorNativeFillPreflightSceneRoot:true,corridorResidentGlowFillBase:true,dynamicCorridorFillSharesMorphRail:true,dynamicCorridorFillNoCanvasMask:true,dynamicFillGpuBufferResident:true,corridorGpuBridgeEffectsCanStayResident:true,circleSlideSkipsDenseGenericTopology:true,chaosCircleDirectWithoutDenseEndpoints:true,webHaloCoreFusedMrt:true,webAnalyticCoverageNoMsaa:true,webSingleCompositePerLayerScene:true,webLegacyAndMorphGpuPathsFused:true,spiralCanonicalFastVisualRail:true,spiralFastRailDerivedAfterPeriodicClosure:true,webMasterThreadGeometryCompute:true,webPerVertexArcSamplingRemoved:true,webCorridorReusesMasterGeometry:true,blueSpiralExtraGeometryUsesBezier:true,strictOutlineRequiresCommittedBase:true,noFrameWideMissingBaseAbort:true,minimalTurnCoherentGuardDegrees:22.5,strictProfileMarkersGpuArc:true,strictProfileNoCpuShadow:true,mixedBackendObserved,cpuMorphPathBlocks:Number(cpuMorph?.strictSpiralBlocks)||0,mixedCanvasFallbackAllowed:!strict,strictViolation,contracts,statuses,backend};
};
window.__somataSpiral69Audit = (...args)=>window.__somataSpiral68Audit?.(...args);
window.__somataSpiral70Audit = (...args)=>window.__somataSpiral68Audit?.(...args);

window.__spiroEffectDrawContractSnapshot = (layerIndex=0) => {
    const f=renderRuntime.frame;
    const ctx=prepareMainLayerFrame(f,Math.max(0,Math.floor(Number(layerIndex)||0)));
    if(!ctx)return null;
    const e=ctx.effectsPlan||{};
    const out={
        layerId:ctx.layer?.id||null,
        lampContract:e.lamps?.drawContract||null,
        lampSets:(e.lamps?.sets||[]).map(set=>({
            layerId:set?.layer?.id||null,
            points:set?.points?.length||0,
            hasConfig:Boolean(set?.config),
            alphaBase:Number(set?.alphaBase)||0
        })),
        renderUsesGlobalLampSwap:false,
        preparedSweep:Boolean(e.sweep?.frameData),
        preparedWeb:Boolean(e.web?.frameData),
        preparedProfile:Boolean(e.profile?.prepared)
    };
    ctx.drawLayerGeometry=null;ctx.drawLayerInstances=null;ctx.frameVectorMaster=null;
    resetMainLayerGeometryPlan(ctx.geometryPlan);resetLayerEffectsPlan(ctx.effectsPlan);ctx.prepared=false;
    return out;
};

window.__spiroGeometryFrameSnapshot = (layerIndex=0) => {
    const f=renderRuntime.frame;
    const ctx=prepareMainLayerFrame(f,Math.max(0,Math.floor(Number(layerIndex)||0)));
    if(!ctx)return null;
    const out={
        layerId:ctx.layer?.id||null,
        geometryMode:ctx.geometryPlan?.kind||'static',
        geometryMorphEnabled:ctx.geometryMorphEnabled,
        geometryDynamic:ctx.geometryPlan?.dynamic===true,
        geometryProgress:Number(ctx.geometryPlan?.progress)||0,
        layerExtent:ctx.layerExtent,
        visibleCopies:ctx.visibleInstances?.copies?.length||0,
        vectorMaster:Boolean(ctx.frameVectorMaster),
        combinedScale:ctx.combinedScale,
        combinedRotationOffset:ctx.combinedRotationOffset,
        glow:ctx.glow
    };
    ctx.drawLayerGeometry=null;ctx.drawLayerInstances=null;ctx.frameVectorMaster=null;resetMainLayerGeometryPlan(ctx.geometryPlan);ctx.prepared=false;
    return out;
};

// v197 — Rendering consumes only a prepared LayerFrame. Runtime ownership is
// explicit and scoped here, so individual effect passes no longer depend on the
// caller having left global lamp/audio/effect state in a particular condition.
function renderPreparedMainLayer(frameCtx) {
    if (!frameCtx?.prepared || !frameCtx.layer) return;
    // v204: layer identity is carried entirely by LayerFrame / EffectDrawPlan.
    // renderRuntime now owns frame lifetime only; there is no global “current layer”.
    mainCtx.save();
    try {
        mainCtx.lineWidth = frameCtx.strokeWidth;
        mainCtx.lineCap = frameCtx.lineCap;
        mainCtx.lineJoin = frameCtx.lineJoin;
        mainCtx.miterLimit = frameCtx.miterLimit;
        mainCtx.strokeStyle = frameCtx.lightningStroke || frameCtx.layer.strokeColor || '#ffffff';
        mainCtx.fillStyle = frameCtx.layer.fillColor || 'transparent';
        mainCtx.shadowBlur = 0;

        try{preflightLayerPathFxReplacement(frameCtx);}catch(err){frameCtx._pathFxReplacementCommitted=false;frameCtx._pathFxPrequeuedSprite=false;frameCtx._pathFxPrequeuedMotion=false;try{spiroPassIsolationNoteFailure?.('pathFxPreflight',err,frameCtx);}catch(_){}}
        try{prepareLayerStrokeWebGPUBatch(frameCtx);}catch(err){frameCtx._webgpuStrokeBatch=null;frameCtx._webgpuFillPrepared=null;try{spiroPassIsolationNoteFailure?.('strokeBatch',err,frameCtx);}catch(_){}}
        // Somata 7.3.9 — establish the strict retained-Spiral scratch root BEFORE the
        // multi-layer ordering gate. Fill/Web/Corridor are consumers of that root and must not
        // make canJoin=false merely because the scratch has not been opened yet.
        try{ensureStrictSpiralEffectLayerSceneRoot(frameCtx);}catch(err){try{spiroPassIsolationNoteFailure?.('strictSpiralRootPreflight',err,frameCtx);}catch(_){}}
        // v393 ordering guard: if previous layers are already in the frame-global GPU scene
        // but this layer cannot join that path, materialize the prefix before *any* pass of
        // this layer (Glow included). This preserves exact source-over ordering on fallback.
        if(Number(frameCtx.frame?.renderLayerCount||0)>1&&WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)){
            const batch=frameCtx._webgpuStrokeBatch,contract=getLayerGeometryContract(frameCtx),fillPrepared=frameCtx?._webgpuFillPrepared;
            const sceneHasAuthoritativeFill=batch?.fillInScene===true&&(fillPrepared?.authoritative===true||batch?.nativeFillInScene===true);
            const needsOutOfSceneFill=contract?.fillRequested===true&&!sceneHasAuthoritativeFill;
            const hiddenGraffitiCarrier=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
            const canJoin=Boolean((batch?.sceneCombined&&!needsOutOfSceneFill&&canDeferLayerSceneForFrame(frameCtx,batch))||canUseGpuOnlyCorridorLayerScene(frameCtx,hiddenGraffitiCarrier)||canUseGpuSpiralBezierFrameScene(frameCtx)||canUseGpuSpiralBezierLayerScene(frameCtx,hiddenGraffitiCarrier&&frameCtx.morphFrameActive===true));
            if(!canJoin){
                if(isStrictSpiralWebGPUFrame(frameCtx)){renderBackendTelemetry.mark('geometry','gpu','strict Spiral waits to join frame GPU scene; materialization forbidden');try{requestMainCanvasRender?.();}catch(_){}return;}
                // 7.2.3 — do not download an already resident strict-Spiral GPU prefix merely
                // because the LAST layer needs the compatibility path. That GPU->Canvas->GPU
                // round-trip was the source of the repeated materializations / present rejects
                // seen during Blue Morph. Keep the accumulated Frame Scene resident and allow
                // the last layer to render into the (still empty) mainCanvas. Final WebGPU then
                // composites that Canvas once as a top overlay over the resident GPU scene.
                // If this layer manages to open its own Corridor/Fill Layer Scene later in the
                // pass, no Canvas pixels are produced and the frame stays fully GPU-native.
                if(reserveStrictSpiralLateCanvasOverlay(frameCtx,'last-layer Canvas overlay allowed')){
                    // The GPU prefix remains resident. This layer may still become fully GPU-native;
                    // otherwise its exact compatibility pixels are uploaded once as the top overlay.
                }else{
                    const presented=WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId,mainCtx,true);if(presented){frameCtx.frame.gpuMainCanvasHasContent=true;try{notifyFrameSceneEffectCommandsSubmitted?.(frameCtx.frame);}catch(_){}}noteFrameGraphMaterialization(frameCtx.frameId);frameCtx.frame.gpuMainSceneEmpty=false;
                }
            }
        }
        // Iter18: profile/Graffiti/effects-only Spiral Morph has no visible Base command to open
        // the LayerScene. Start a transparent GPU root so all retained-Bézier effects still have
        // a resident target; never synthesize a Canvas carrier just to host them.
        try{ensureStrictSpiralEffectLayerSceneRoot(frameCtx);}catch(err){try{spiroPassIsolationNoteFailure?.('strictSpiralRoot',err,frameCtx);}catch(_){}}
        const runPass=(name,fn,fallback=null)=>{const pt=renderPassProfiler.begin();try{if(typeof runSpiroIsolatedRenderPass==='function')return runSpiroIsolatedRenderPass(frameCtx,name,fn,fallback);fn();return{ok:true};}finally{renderPassProfiler.end(name,pt);}};
        runPass('glow',()=>renderLayerGlowPass(frameCtx));
        // Base geometry is critical. If any GPU/batch/composite branch throws, retry the same
        // pass once with its GPU paths explicitly disabled. This is stroke/fill exact Canvas
        // compatibility and does not erase the already completed Glow pass.
        runPass('geometry',()=>renderLayerBaseGeometryPass(frameCtx),()=>renderLayerBaseGeometryPass(frameCtx));
        // v518: once the Layer Scene is known to be deferred, compile shared Morph/Arc
        // prerequisites from the already prepared EffectPlan before any dependent effect pass.
        try{spiroGpuPreflightLayerPrerequisites?.(frameCtx);}catch(err){try{spiroPassIsolationNoteFailure?.('gpuPreflight',err,frameCtx);}catch(_){}}
        runPass('outline',()=>renderLayerOutlinePass(frameCtx));
        runPass('profile',()=>renderLayerProfilePass(frameCtx));
        runPass('motion',()=>renderLayerMotionFxPass(frameCtx));
        runPass('sweep',()=>renderLayerSweepPass(frameCtx));
        runPass('particles',()=>renderLayerParticlePass(frameCtx));
        runPass('sprite',()=>renderLayerSpritePass(frameCtx));
        runPass('web',()=>renderLayerWebPass(frameCtx));
        runPass('lamps',()=>renderLayerLampPass(frameCtx));
        // 7.0.2: an effects-only strict Spiral transaction is invalid. Do not preserve
        // the previous image and do not substitute another renderer; mark the Full-GPU frame
        // incomplete, log the exact contract failure and retry the authoritative path.
        const strictCarrierExpected=isStrictSpiralWebGPUFrame(frameCtx)&&frameCtx.lineDisplayEnabled===true&&
            frameCtx.lineProfileStrokeOnly!==true&&!(typeof isPathFxBaseReplacementActive==='function'&&isPathFxBaseReplacementActive(frameCtx));
        if(strictCarrierExpected&&frameCtx._baseStrokeCommitted!==true){
            frameCtx.frame._strictSpiralGpuFrameIncomplete=true;
            somataSpiralSceneDiag.base.stage='base-missing-full-gpu-error';
            renderBackendTelemetry.mark('geometry','gpu','strict Spiral Base missing; Full GPU frame rejected');
            somataGpuContractError('SPIRAL_BASE_MISSING_AT_FRAME_END',frameCtx,{base:{...somataSpiralSceneDiag.base}});
            try{requestMainCanvasRender?.();}catch(_){}
        }
        // Somata 6.7: direct Spiral FrameScene commands are already in final layer order.
        // Count the layer once so the final compositor can skip an unnecessary mainCanvas upload
        // when every visible layer stayed GPU-native.
        if(frameCtx._spiralBezierFrameSceneDirect===true&&frameCtx._spiralBezierFrameSceneCounted!==true){
            frameCtx._spiralBezierFrameSceneCounted=true;
            frameCtx.frame.gpuFrameSceneLayers=(Number(frameCtx.frame.gpuFrameSceneLayers)||0)+1;
            if(frameCtx.frame.gpuFrameSceneLayers===frameCtx.frame.renderLayerCount)frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;
        }
        // v393: seal this completed deferred Layer Scene into the frame-global GPU scene
        // before the shared scratch texture is reused by the next layer.
        if(frameCtx.frame?.gpuLayerSceneDeferred&&Number(frameCtx.frame.renderLayerCount||0)>1){
            const extra=collectLayerSceneCommandBuffers(frameCtx.frame);
            // v394: drain this layer's destination-over work into the same ordered command
            // stream. It executes after the producing batch and before the next layer can
            // overwrite shared role textures, while the underlay texture stays resident.
            WebGPUStrokeRenderer.appendFrameUnderlayCommands?.(frameCtx.frameId,extra);
            if(WebGPUStrokeRenderer.sealDeferredLayerSceneToFrame?.(frameCtx.frameId,extra)){
                try{transferLayerSceneEffectCallbacksToFrameScene?.(frameCtx.frame);}catch(_){}
                frameCtx.frame.gpuLayerSceneDeferred=false;clearLayerSceneEffectCommands(frameCtx.frame);
                frameCtx.frame.gpuFrameSceneLayers=(Number(frameCtx.frame.gpuFrameSceneLayers)||0)+1;
                if(frameCtx.frame.gpuFrameSceneLayers===frameCtx.frame.renderLayerCount){
                    // v522.14 — GPU layer completeness says nothing about Canvas under-content.
                    // Static Fill is intentionally Canvas-authoritative, and an earlier GPU prefix
                    // may also have been materialized there.  Skip the upload only when Canvas is
                    // genuinely empty.
                    frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;
                }
            }else{
                if(isStrictSpiralWebGPUFrame(frameCtx)){
                    // Iter18: failed multi-layer sealing invalidates this GPU frame. Preserve the
                    // previously presented GPU frame; never copy either the prefix or current
                    // LayerScene through Canvas2D just to recover ordering.
                    renderBackendTelemetry.mark('final','gpu','strict Spiral multi-layer seal failed; no fallback');
                    somataGpuContractError('SPIRAL_FRAME_SCENE_SEAL_FAILED',frameCtx,{layers:Number(frameCtx.frame?.gpuFrameSceneLayers)||0,expected:Number(frameCtx.frame?.renderLayerCount)||0});
                    frameCtx.frame._strictSpiralGpuFrameIncomplete=true;
                    try{WebGPUStrokeRenderer.discardFrameScene?.(frameCtx.frameId);}catch(_){}try{WebGPUStrokeRenderer.clearDeferredLayerScene?.();}catch(_){}try{WebGPUStrokeRenderer.discardFrameUnderlay?.(frameCtx.frameId);}catch(_){}clearLayerSceneEffectCommands(frameCtx.frame);frameCtx.frame.gpuLayerSceneDeferred=false;try{requestMainCanvasRender?.();}catch(_){}return;
                }
                // Runtime/device failure while sealing: preserve ordering by materializing the
                // already accumulated prefix first, then the current deferred layer.
                if(WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)){const presented=WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId,mainCtx,true);if(presented)try{notifyFrameSceneEffectCommandsSubmitted?.(frameCtx.frame);}catch(_){} }
                materializeDeferredLayerScene(frameCtx);frameCtx.frame.gpuMainSceneEmpty=false;
            }
        }
    } finally {
        mainCtx.restore();
        frameCtx.drawLayerGeometry = null;
        frameCtx.drawLayerInstances = null;
        frameCtx.drawLayerFillInstances = null;
        frameCtx.frameVectorMaster = null;
        frameCtx._corridorLayerSceneActive=false;frameCtx._spiralBezierFrameSceneDirect=false;frameCtx._spiralBezierFrameSceneCounted=false;frameCtx._webgpuStrokeBatch = null;frameCtx._webgpuFillPrepared = null;frameCtx._nativeFillMeshCandidate = null;frameCtx._geometryContract = null;frameCtx._geometryKernelView = null;frameCtx._geometryKernelStrokeView = null;frameCtx._fillMeshShadow = null;
        resetMainLayerGeometryPlan(frameCtx.geometryPlan);
        resetLayerEffectsPlan(frameCtx.effectsPlan);
        frameCtx.prepared = false;
    }
}

function renderMainLayer(renderFrame, layerIndex) {
    let __pt=renderPassProfiler.begin();let frameCtx=null;
    try{frameCtx=typeof runSpiroIsolatedLayerPreparation==='function'?runSpiroIsolatedLayerPreparation(renderFrame,layerIndex,()=>prepareMainLayerFrame(renderFrame,layerIndex)):prepareMainLayerFrame(renderFrame,layerIndex);}
    finally{renderPassProfiler.end('layerPrepare',__pt);}
    if(frameCtx){
        // Iter14: effects-only Spiral frames still require the GPU-only final compositor. Do not
        // rely on Base pass execution to raise the presentation latch (the base may be hidden).
        if(isStrictSpiralWebGPUFrame(frameCtx)&&renderFrame)renderFrame.strictSpiralGpuPresentRequired=true;
        try{renderPreparedMainLayer(frameCtx);}catch(err){try{spiroPassIsolationNoteFailure?.('layerRender',err,frameCtx);}catch(_){console.error('SpiroStar isolated layer render failure:',err);}}
    }
}


function renderMainLayers(renderFrame) {
    for (let layerIndex = 0; layerIndex < renderFrame.renderLayerCount; layerIndex++) {
        renderMainLayer(renderFrame, layerIndex);
    }
}

function renderMainViewportEffects(renderFrame) {
    const { w, h, dpr } = renderFrame;
    // Fade artwork against the physical viewport edge in pixel space.
    // Unlike per-copy tunnel alpha, this creates a continuous gradient through
    // every line/fill pixel and therefore remains smooth even with only a few
    // tunnel copies crossing the edge at the same moment.
    // v321: when the final WebGPU compositor is ready it evaluates the same vignette
    // in its full-screen shader. Keep Canvas2D as the exact fallback if the GPU pass is
    // unavailable or a project-background morph currently owns the background layers.
    renderFrame.gpuFinalVignetteDeferred = (typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed())&&WebGPUFinalCompositeRenderer.canDeferVignette(renderFrame);
    // Strict Spiral never rasterises a late vignette into mainCanvas. If Final is warming,
    // retain the previous valid GPU frame and retry rather than doing CPU work that cannot be
    // presented under the no-mixed-backend contract.
    if (!renderFrame.gpuFinalVignetteDeferred && renderFrame.strictSpiralGpuPresentRequired!==true) applyTunnelScreenEdgeFeather(mainCtx, w, h, dpr);
    
    if (state.showBoundingCircle) {
        const maxR = computeMaxLayerRadius();
        mainCtx.save();
        mainCtx.beginPath();
        mainCtx.arc(0, 0, maxR, 0, Math.PI * 2);
        mainCtx.setLineDash([6, 6]);
        mainCtx.strokeStyle = state.boundingCircleColor || '#94a3b8';
        mainCtx.globalAlpha = 0.42;
        mainCtx.lineWidth = 1 / Math.max(state.zoom, 0.2);
        mainCtx.shadowBlur = 0;
        mainCtx.stroke();
        mainCtx.restore();
    }
    
    mainCtx.restore();
    renderFrame.canvasTransformSaved = false;
}

function recoverMainRenderError(err, renderFrame) {
    const now = performance.now();
    if (!renderPerf.lastErrorAt || now - renderPerf.lastErrorAt > 1000) {
        console.error('SpiroStar render recovered from an error:', err);
        renderPerf.lastErrorAt = now;
    }
    try {
        if (renderFrame?.canvasTransformSaved) {
            mainCtx.restore();
            renderFrame.canvasTransformSaved = false;
        }
        mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        mainCtx.globalAlpha = 1;
        mainCtx.filter = 'none';
        mainCtx.shadowBlur = 0;
        mainCtx.setLineDash([]);
        // v522: never erase already completed geometry because an optional late pass failed.
        // Reset transient queues/state only; the next scheduled frame may repaint normally and
        // the pass circuit breaker routes the failing backend through compatibility.
        clearLayerSceneEffectCommands(renderFrame);try{clearFrameSceneEffectCallbacks?.(renderFrame);}catch(_){}
        try{spiroPassIsolationNoteFailure?.('frame',err,{frameId:renderFrame?.id,layerIndex:-1});}catch(_){}
    } catch (_) {}
}

function finishMainRenderFrame(renderStartedAt, renderFrame) {
    // v530: transparent GPU overlays are intentionally flushed AFTER the main FrameGraph
    // has committed.  Exact-arc consumers in the main scene can therefore publish the shared
    // Morph Arc once; Path FX / particles reuse that resident result in the same display frame
    // instead of independently encoding the same prefix scan before the main submit.
    // Keep the Canvas2D save/restore stack balanced even when an effect throws.
    if (renderFrame?.canvasTransformSaved) {
        try { mainCtx.restore(); } catch (_) {}
        renderFrame.canvasTransformSaved = false;
    }
    // v321: prefer one WebGPU full-frame presentation pass for scene blend / scene alpha /
    // vignette. If it cannot run, immediately restore the proven Canvas2D/CSS path.
    const strictLateCanvasOverlay=Boolean(renderFrame?.strictSpiralLateCanvasOverlay===true&&renderFrame?.gpuMainCanvasHasContent===true&&renderBackendTelemetry.hasMaterialization?.()!==true);
    if(renderFrame?.strictSpiralGpuPresentRequired===true&&renderBackendTelemetry.canvasTouched?.()===true&&!strictLateCanvasOverlay){
        somataGpuContractError('STRICT_SPIRAL_CANVAS_PATH_TOUCHED',renderFrame,{backend:window.__spiroRenderBackendStatus?.()||null});
    }
    const gpuBackendAllowed=(typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed());
    let finalGpuPresented=false;
    if(gpuBackendAllowed){
        try { finalGpuPresented=WebGPUFinalCompositeRenderer.render(renderFrame); } catch (err) { somataGpuContractError('FINAL_GPU_RENDER_EXCEPTION',renderFrame,{error:String(err?.stack||err)});finalGpuPresented=false; }
    }
    if(!gpuBackendAllowed){
        renderBackendTelemetry.mark('final','canvas','CPU backend final');
        renderFrame.gpuLayerSceneDeferred=false;renderFrame.gpuLampsDeferred=false;renderFrame.gpuFinalVignetteDeferred=false;renderFrame.gpuMainSceneEmpty=false;
        try { syncSceneBlendCanvasFromMain(); } catch (_) {}
    }else if(!finalGpuPresented){
        const strictSpiralPresent=renderFrame?.strictSpiralGpuPresentRequired===true;
        if(strictSpiralPresent){
            // 6.8 iter16: the NO-MIXED-BACKEND rule covers the FINAL presentation too. Earlier
            // builds correctly kept individual Spiral effects on WebGPU, but a final compositor
            // failure could still call presentFrameSceneToMain()/presentDeferredLayerSceneToMain(),
            // which copied the finished GPU scene into Canvas2D. Never do that. Discard only this
            // failed frame's queued presentation and keep the previous onscreen GPU frame until a
            // clean WebGPU frame succeeds.
            renderBackendTelemetry.mark('final','gpu','strict Spiral Full WebGPU presentation failed; no fallback');
            // Snapshot faults before reporting FINAL. Never pass the live array: the diagnostic
            // helper appends FINAL to that same array, which previously created a self-referential
            // payload and let the reused frame object grow to thousands of entries.
            const priorFaults=Array.isArray(renderFrame?._fullGpuFaults)?renderFrame._fullGpuFaults.slice(-SOMATA_FULL_GPU_FRAME_FAULT_LIMIT):[];
            somataGpuContractError('FINAL_FULL_GPU_PRESENT_FAILED',renderFrame,{final:WebGPUFinalCompositeRenderer.status?.()||null,stroke:WebGPUStrokeRenderer.status?.()||null,canvasTouched:renderBackendTelemetry.canvasTouched?.()===true,materialized:renderBackendTelemetry.hasMaterialization?.()===true,faultCount:Number(renderFrame?._fullGpuFaultCount)||priorFaults.length,faults:priorFaults});
            // Preserve the last successfully presented FullGPU surface while this one failed.
            // Disabling the final canvas here caused visible blocky/empty flashes on Spirals when
            // a transient strict-frame dependency was still warming. We still reject/discard the
            // current frame (no Canvas fallback), log the diagnostic, and immediately retry.
            // The previous GPU frame is presentation-only and is never fed back into rendering.
            try{WebGPUStrokeRenderer.discardFrameScene?.(renderFrame.id);}catch(_){}
            try{WebGPUStrokeRenderer.clearDeferredLayerScene?.();}catch(_){}
            try{WebGPUStrokeRenderer.discardFrameUnderlay?.(renderFrame.id);}catch(_){}
            try{LampGPURenderer.clear?.();}catch(_){}
            clearLayerSceneEffectCommands(renderFrame);try{clearFrameSceneEffectCallbacks?.(renderFrame);}catch(_){}
            renderFrame.gpuLayerSceneDeferred=false;renderFrame.gpuLampsDeferred=false;renderFrame.gpuFinalVignetteDeferred=false;
            try{requestMainCanvasRender?.();}catch(_){}
        }else{
            if(renderFrame?.gpuFinalVignetteDeferred||renderFrame?.gpuLayerSceneDeferred||renderFrame?.gpuLampsDeferred||WebGPUStrokeRenderer.getFrameSceneTexture?.(renderFrame?.id))renderBackendTelemetry.mark('final','canvas','final Canvas fallback/materialize',true);
            WebGPUFinalCompositeRenderer.disable();
            if(WebGPUStrokeRenderer.getFrameSceneTexture?.(renderFrame?.id)){let presented=false;try{presented=WebGPUStrokeRenderer.presentFrameSceneToMain?.(renderFrame.id,mainCtx,true);}catch(_){}if(presented)try{notifyFrameSceneEffectCommandsSubmitted?.(renderFrame);}catch(_){}renderFrame.gpuMainSceneEmpty=false;}
            if(renderFrame?.gpuLayerSceneDeferred){const extra=collectLayerSceneCommandBuffers(renderFrame);let presented=false;try{presented=WebGPUStrokeRenderer.presentDeferredLayerSceneToMain(renderFrame.id,mainCtx,extra);}catch(_){}if(presented)notifyLayerSceneEffectCommandsSubmitted(renderFrame);clearLayerSceneEffectCommands(renderFrame);renderFrame.gpuLayerSceneDeferred=false;renderFrame.gpuMainSceneEmpty=false;}
            try{WebGPUStrokeRenderer.presentFrameUnderlayToMain?.(renderFrame?.id,mainCtx,true);}catch(_){}
            if(renderFrame?.gpuLampsDeferred){try{LampGPURenderer.presentDeferredToMain();}catch(_){}renderFrame.gpuLampsDeferred=false;}
            if(renderFrame?.gpuFinalVignetteDeferred){try{applyTunnelScreenEdgeFeather(mainCtx,renderFrame.w,renderFrame.h,renderFrame.dpr);}catch(_){}renderFrame.gpuFinalVignetteDeferred=false;}
            // v303/v320 fallback: Normal mode leaves the duplicate canvas disabled; intermediate
            // strength uses the duplicate only when WebGPU final composition is not available.
            try { syncSceneBlendCanvasFromMain(); } catch (_) {}
        }
    }else if(renderFrame){renderBackendTelemetry.mark('final','gpu','final WebGPU composite');renderFrame.gpuLayerSceneDeferred=false;renderFrame.gpuMainSceneEmpty=false;}
    // Same browser frame, but after the main GPU queue submission.  These canvases are DOM
    // overlays, so their late command encoding does not change composition order; it only lets
    // them consume already-committed shared Morph/Arc buffers.
    if(gpuBackendAllowed){
        try { if(typeof flushPathFxFrameQueue==='function')flushPathFxFrameQueue(); } catch (_) {}
        try { if(typeof flushParticleFrameQueue==='function')flushParticleFrameQueue(); } catch (_) {}
    }
    finishLampAdaptiveFrame();
    endFrameGeometryRuntime();
    renderRuntime.end();
    const paintNow = performance.now();
    renderPerf.lastRenderMs = Math.max(0, paintNow - renderStartedAt);
    renderPerf.lastPaintAt = paintNow;
    performanceGovernor.noteFrame(paintNow,renderPerf.lastRenderMs);
    renderBackendTelemetry.commit();
    // v522.9 — log only when the Base GPU state changes, so a fallback has an actionable
    // reason in DevTools without spamming every animation frame. Manual call:
    // v522.11 — GPU status is manual-only. Graffiti/tunnel animation can legitimately
    // change backend telemetry every frame, so automatic status reporting flooded DevTools.
    // Actual renderer exceptions are logged once at their origin with a stack.
    
    // Count real SpiroStar canvas paints only while the FPS indicator is visible.
    // When hidden, both the DOM update and the FPS bookkeeping are skipped.
    if (showFpsCounter) {
        if (!renderPerf.fpsLastFrameAt || paintNow - renderPerf.fpsLastFrameAt > 500) {
            renderPerf.fpsWindowStart = paintNow;
            renderPerf.fpsFrames = 0;
        }
        renderPerf.fpsLastFrameAt = paintNow;
        renderPerf.fpsFrames += 1;
        const fpsElapsed = paintNow - renderPerf.fpsWindowStart;
        if (fpsElapsed >= 750) {
            const fps = Math.max(0, Math.round(renderPerf.fpsFrames * 1000 / Math.max(1, fpsElapsed)));
            const fpsText = `${fps} FPS`;
            if (fpsCounterEl && fpsText !== renderPerf.lastFpsText) {
                fpsCounterEl.textContent = fpsText;
                renderPerf.lastFpsText = fpsText;
            }
            renderPerf.fpsWindowStart = paintNow;
            renderPerf.fpsFrames = 0;
        }
    }
    renderPassProfiler.finish();
    try{somataFxBenchmark?.noteFrame?.(paintNow,renderPerf.lastRenderMs);}catch(_){}
    renderPerf.rendering = false;
}

// v522.15 — manual-only Fill diagnostic with the whole backend chain.
window.__spiroReportFillStatus=()=>{
    let layer=null;try{layer=getRuntimeLayerById(state.activeLayerId);}catch(_){}
    let backend=null;try{backend=renderBackendTelemetry.snapshot?.()||null;}catch(_){}
    let validation=null;try{validation=window.__spiroFillValidationStatus?.()||null;}catch(_){}
    let preparation=null;try{preparation=window.__spiroFillMeshPreparationStatus?.()||null;}catch(_){}
    let renderer=null;try{renderer=window.__spiroFillGPUStatus?.()||null;}catch(_){}
    let finalGpu=null;try{finalGpu=window.__spiroFinalGPUStatus?.()||null;}catch(_){}
    const alpha=layer?getFillOpacityUnit(layer.fillColor,DEFAULT_FILL_OPACITY_PERCENT):0;
    const frame=renderRuntime?.frame||null;
    const trace={...fillRuntimeDiagnostic};
    const out={
        layerId:layer?.id||null,
        fillEnabled:layer?.fill===true,
        lineVisible:layer?getLayerLineVisible(layer):false,
        fillOpacity:alpha,
        fillRequested:Boolean(layer&&layer.fill===true&&getLayerLineVisible(layer)&&alpha>.00001),
        trace,
        backend:backend?.features?.fill||null,
        finalBackend:backend?.features?.final||null,
        frame:frame?{id:frame.id,gpuMainSceneEmpty:frame.gpuMainSceneEmpty===true,gpuMainCanvasHasContent:frame.gpuMainCanvasHasContent===true,gpuFrameSceneLayers:Number(frame.gpuFrameSceneLayers)||0,renderLayerCount:Number(frame.renderLayerCount)||0}:null,
        renderer,finalGpu,
        validation,preparation
    };
    console.group('[SpiroStar Fill]');
    console.log('request',{enabled:out.fillEnabled,lineVisible:out.lineVisible,alpha:out.fillOpacity,requested:out.fillRequested});
    console.log('trace',trace);
    console.log('backend',{fill:out.backend,final:out.finalBackend,renderer:renderer?.active||'none',finalGpuActive:finalGpu?.active===true});
    console.log('topology',{fillContourCount:trace.fillContourCount,closedPathCount:trace.closedPathCount,openPathCount:trace.openPathCount,hasClosedFillTopology:trace.hasClosedFillTopology,nativeComplete:trace.nativeComplete,gpuMaskEligible:trace.gpuMaskEligible});
    if(out.fillRequested&&!trace.handled)console.error(`[SpiroStar Fill] NOT VISIBLE: ${trace.reason||'Fill requested but no backend committed it'}`,trace);
    console.log(out);console.groupEnd();return out;
};

// Somata 6.8 Iter23 — compact runtime report for first-frame / Spiral failures.
// Usage in DevTools: __somataReport() or __somataReportText(); __somataRenderNow() forces one
// synchronous paint only for diagnosis and returns the same report. No polling is installed.
window.__somataReport=()=>{
    let layer=null;try{layer=(typeof getRuntimeLayerById==='function'?getRuntimeLayerById(state?.activeLayerId):null)||state?.layers?.[0]||null;}catch(_){layer=state?.layers?.[0]||null;}
    let scheduler=null,hub=null,stroke=null,finalGpu=null,backend=null,morph=null;
    try{scheduler=animationScheduler.stats();}catch(_){}
    try{hub=window.__spiroWebGPUHubStatus?.()||null;}catch(_){}
    try{stroke=window.__spiroWebGPUStatus?.()||null;}catch(_){}
    try{finalGpu=window.__spiroFinalGPUStatus?.()||null;}catch(_){}
    try{backend=window.__spiroRenderBackendStatus?.()||null;}catch(_){}
    try{morph=window.__somataSpiralBezierMorphStatus?.()||null;}catch(_){}
    const frame=renderRuntime?.frame||null;
    const spiral=Boolean(layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(layer));
    const report={
        version:'7.3.9',boot:window.__spiroAppBootComplete===true,now:Number(performance.now().toFixed(1)),
        scheduler,
        layer:layer?{id:layer.id||null,visible:layer.visible!==false,spiral,lineVisible:typeof getLayerLineVisible==='function'?getLayerLineVisible(layer):null,opacity:Number(layer.opacity),fill:layer.fill===true,profileMode:layer.profileMode||null,splineRenderMode:layer.splineRenderMode||null}:null,
        frame:frame?{id:Number(frame.id)||0,strictSpiralGpuPresentRequired:frame.strictSpiralGpuPresentRequired===true,gpuLayerSceneDeferred:frame.gpuLayerSceneDeferred===true,gpuMainSceneEmpty:frame.gpuMainSceneEmpty===true,gpuMainCanvasHasContent:frame.gpuMainCanvasHasContent===true,gpuFrameSceneLayers:Number(frame.gpuFrameSceneLayers)||0,renderLayerCount:Number(frame.renderLayerCount)||0}:null,
        spiralScene:{internal:{...somataSpiralSceneDiag.internal},external:{...somataSpiralSceneDiag.external},base:{...somataSpiralSceneDiag.base}},
        webgpu:{hub,stroke:stroke?{available:stroke.available,ready:stroke.ready,lastError:stroke.lastError,offscreenBaseReady:stroke.offscreenBaseReady,layerBatch:stroke.layerBatch,hub:stroke.hub}:null,final:finalGpu,morph:morph?{ready:morph.ready,initializing:morph.initializing,lastError:morph.lastError,lastDecision:morph.lastDecision,stats:morph.stats}:null},
        backend,events:typeof window.__somataDiagEvents==='function'?window.__somataDiagEvents():[]
    };
    console.group('[Somata Iter31 report]');console.log(report);
    if(spiral&&!somataSpiralSceneDiag.internal.ok)console.warn('[Somata Spiral] internal GPU scene blocked:',somataSpiralSceneDiag.internal.reason);
    if(hub?.lastError)console.error('[Somata WebGPU hub]',hub.lastError);
    if(stroke?.lastError)console.error('[Somata stroke]',stroke.lastError);
    if(finalGpu?.lastError)console.error('[Somata final]',finalGpu.lastError);
    console.groupEnd();return report;
};
window.__somataReportText=()=>JSON.stringify(window.__somataReport(),null,2);
window.__somataRenderNow=()=>{try{window.__somataDiagNote?.('manual-render','__somataRenderNow');renderMainCanvas();}catch(err){console.error('[Somata manual render failed]',err);}return window.__somataReport();};
// Iter25 — zero-side-effect-ish Spiral state trace (canonical geometry is built only when this
// command is invoked manually). It distinguishes UI/state/geometry failures from GPU presentation.
window.__somataSpiralTrace=()=>{
    let layer=null,canonical=null,mode=null,uiMode=null;
    try{layer=(typeof getRuntimeLayerById==='function'?getRuntimeLayerById(state?.activeLayerId):null)||state?.layers?.[0]||null;}catch(_){layer=state?.layers?.[0]||null;}
    try{mode=layer&&typeof getContourMode==='function'?getContourMode(layer):null;}catch(_){}
    try{uiMode=document.querySelector('[data-contour-mode].active')?.dataset?.contourMode||null;}catch(_){}
    const morphActive=runtimeState?.morph?.active===true;
    let frameLayer=null,sourceLayer=null,targetLayer=null;
    try{const idx=(state?.layers||[]).findIndex(item=>item?.id===layer?.id);if(idx>=0){frameLayer=runtimeState?.morph?.frameLayers?.[idx]||null;sourceLayer=runtimeState?.morph?.renderSourceLayers?.[idx]||null;targetLayer=runtimeState?.morph?.renderTargetLayers?.[idx]||null;}}catch(_){}
    const modeOf=(item)=>{try{return item&&typeof getContourMode==='function'?getContourMode(item):null;}catch(_){return null;}};
    // Capture authored/morph state BEFORE canonical construction so this trace can prove a
    // UI-vs-model rollback without any geometry helper participating in the observation.
    const authored={id:layer?.id||null,mode,spiralEnabled:layer?.spiralEnabled===true,spiralClosed:layer?.spiralClosed!==false,spiralOrder:Number(layer?.spiralOrder),closedLoop:layer?.closedLoop===true,profileMode:layer?.profileMode||null,geometryVersion:Number(layer?.__geometryVersion||layer?.geometryVersion||0)};
    const morph={active:morphActive,progress:Number(runtimeState?.morph?.progress)||0,geometryT:Number(runtimeState?.morph?.geometryT)||0,frameMode:modeOf(frameLayer),frameSpiralEnabled:frameLayer?.spiralEnabled===true,sourceMode:modeOf(sourceLayer),targetMode:modeOf(targetLayer)};
    try{canonical=layer&&typeof getCanonicalLayerGeometry==='function'?getCanonicalLayerGeometry(layer):null;}catch(err){canonical={error:String(err?.message||err)};}
    const paths=Array.isArray(canonical?.paths)?canonical.paths:[];
    const pointCount=paths.reduce((n,p)=>n+(Array.isArray(p?.points)?p.points.length:0),0);
    const out={version:'7.3.9',uiMode,mode,layer:authored,morph,canonical:canonical?{geometryKey:canonical.geometryKey||canonical.key||null,pathCount:paths.length,pointCount,closedPathCount:paths.filter(p=>p?.closed===true).length,openPathCount:paths.filter(p=>p?.closed!==true).length,spiralMetaClosedPoints:paths.reduce((n,p)=>n+(p?.points||[]).filter(q=>q?.__spiralClosed===true).length,0),error:canonical.error||null}:null,scene:{internal:{...somataSpiralSceneDiag.internal},base:{...somataSpiralSceneDiag.base}},webgpu:{hub:window.__spiroWebGPUHubStatus?.()||null,stroke:window.__spiroWebGPUStatus?.()||null,staticBezier:window.__spiroStaticSpiralBezierStatus?.()||null,bezier:window.__somataSpiralBezierMorphStatus?.()||null,arc:window.__spiroGpuMorphArcStatus?.()||null,profileArc:window.__spiroProfileArcMarkerStatus?.()||null,final:window.__spiroFinalGPUStatus?.()||null}};
    console.log('[Somata Spiral trace]',out);return out;
};

function renderMainCanvas() {
    if (renderPerf.rendering) return;
    renderPerf.rendering = true;
    const renderStartedAt = performance.now();
    const renderFrame = renderRuntime.begin(renderStartedAt);
    try{if(typeof beginSpiroPassIsolationFrame==='function')beginSpiroPassIsolationFrame(renderFrame?.id||renderRuntime?.frameId||0);}catch(_){}
    renderBackendTelemetry.begin(renderFrame?.id||renderRuntime?.frameId||0);
    renderPassProfiler.beginFrame();
    try {
        let __pt=renderPassProfiler.begin();prepareMainRenderFrame(renderFrame);renderPassProfiler.end('framePrepare',__pt);
        __pt=renderPassProfiler.begin();renderMainLayers(renderFrame);renderPassProfiler.end('layersTotal',__pt);
        // v295: composite WebGL lamps before viewport masking. The vignette is a
        // final screen-space mask and must affect bright GL lamps just like geometry.
        __pt=renderPassProfiler.begin();
        if(typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed()){
            const deferGpuLamps=WebGPUFinalCompositeRenderer.canDeferLamps(renderFrame);LampGPURenderer.flush({deferComposite:deferGpuLamps});renderFrame.gpuLampsDeferred=LampGPURenderer.hasDeferredComposite();
        }else renderFrame.gpuLampsDeferred=false;
        renderPassProfiler.end('lampGPU',__pt);
        __pt=renderPassProfiler.begin();renderMainViewportEffects(renderFrame);renderPassProfiler.end('viewport',__pt);
    } catch (err) {
        recoverMainRenderError(err, renderFrame);
    } finally {
        // v503: frame finalization must not poison every later scheduled repaint. Some GPU/browser
        // finalizers live outside the main draw try/catch; if one throws, always release the
        // render lock and runtime/frame-geometry ownership so the next UI edit can paint normally.
        try {
            finishMainRenderFrame(renderStartedAt, renderFrame);
        } catch (finalizeErr) {
            console.error('SpiroStar frame finalization recovered from an error:', finalizeErr);
            try { endFrameGeometryRuntime(); } catch (_) {}
            try { renderRuntime.end(); } catch (_) {}
        } finally {
            renderPerf.rendering = false;
        }
    }
}


// v531 — one read-only diagnostics entry point for smooth-transition GPU residency.
// It intentionally does not warm/reconfigure a renderer beyond what the individual status()
// functions already do, and never schedules animation by itself.
window.__spiroV531SmoothnessStatus=()=>({
    frameId:Number(renderRuntime?.frameId)||0,
    green:typeof window.__spiroGreenProjectMorphGPUStatus==='function'?window.__spiroGreenProjectMorphGPUStatus():null,
    blue:typeof window.__spiroTopologyMorphGpuStatus==='function'?window.__spiroTopologyMorphGpuStatus():null,
    morphPath:typeof window.__spiroGpuMorphPathStatus==='function'?window.__spiroGpuMorphPathStatus():null,
    exactArc:typeof window.__spiroGpuMorphArcStatus==='function'?window.__spiroGpuMorphArcStatus():null,
    web:typeof window.__spiroGpuMorphWebStatus==='function'?window.__spiroGpuMorphWebStatus():null,
    webCorners:typeof window.__spiroGpuWebCornerStatus==='function'?window.__spiroGpuWebCornerStatus():null,
    lightning:typeof window.__spiroGpuLightningArcStatus==='function'?window.__spiroGpuLightningArcStatus():null,
    pathFx:typeof window.__spiroPathFxGPUStatus==='function'?window.__spiroPathFxGPUStatus():null,
    particles:typeof window.__spiroParticleGPUStatus==='function'?window.__spiroParticleGPUStatus():null,
    gpuScheduler:typeof window.__spiroGpuCommandSchedulerStatus==='function'?window.__spiroGpuCommandSchedulerStatus():null,
    governor:typeof window.__spiroPerformanceGovernorStatus==='function'?window.__spiroPerformanceGovernorStatus():null
});

// v532 — extends the transition diagnostics with the raster hot paths touched by the
// second smoothness audit.  Kept as a new entry point so old debug bookmarks still work.
window.__spiroV532SmoothnessStatus=()=>({
    ...window.__spiroV531SmoothnessStatus(),
    sweep:typeof window.__spiroCanonicalSweepGPUStatus==='function'?window.__spiroCanonicalSweepGPUStatus():null,
    lamps:typeof window.__spiroLampGPUStatus==='function'?window.__spiroLampGPUStatus():null,
    rasterContract:'segment/sprite quads use 4-vertex triangle strips on Blue/Green Morph, Web, exact Lightning, Glint, Path FX, Lamps and Particles; polygon parity masks remain triangle lists by design'
});

// v533 — cumulative smoothness diagnostics after particle Layer Scene residency and
// GPUTextureView hot-path caching. No extra animation/render work is scheduled.
window.__spiroV533SmoothnessStatus=()=>({
    ...window.__spiroV532SmoothnessStatus(),
    particles:typeof window.__spiroParticleGPUStatus==='function'?window.__spiroParticleGPUStatus():null,
    residencyContract:'Morph/Arc prerequisites are shared in the ordered deferred GPU scene; compatible particles render directly into Layer Scene at phase 35, with overlay only as fallback',
    gpuObjectContract:'stable Layer Scene GPUTextureViews are cached for Web, exact Lightning, canonical Glint and Graffiti hot passes'
});



// v534 — diagnostics for the dense-spiral / lamp identity / retained Morph draw audit.
window.__spiroV534SmoothnessStatus=()=>({
    ...window.__spiroV533SmoothnessStatus(),
    green:typeof window.__spiroGreenProjectMorphGPUStatus==='function'?window.__spiroGreenProjectMorphGPUStatus():null,
    blue:typeof window.__spiroTopologyMorphGpuStatus==='function'?window.__spiroTopologyMorphGpuStatus():null,
    cornerLamps:typeof window.__spiroGpuLampCornerStatus==='function'?window.__spiroGpuLampCornerStatus():null,
    v534Contract:'dense Green endpoint rails preserve up to 960 samples; dense cyclic alignment uses bounded coarse+multi-basin refinement; Blue/Green base+glow retain GPURenderBundles; corner lamps use exact cumulative vertex fractions and stable path+vertex identity'
});

// v535 — diagnostics for phase prewarm, FPS-independent GPU residency and retained
// auxiliary draw encoding.  Reading this object does not schedule additional work.
window.__spiroV535SmoothnessStatus=()=>({
    ...window.__spiroV534SmoothnessStatus(),
    lightning:typeof window.__spiroGpuLightningArcStatus==='function'?window.__spiroGpuLightningArcStatus():null,
    web:typeof window.__spiroGpuMorphWebStatus==='function'?window.__spiroGpuMorphWebStatus():null,
    pathFx:typeof window.__spiroPathFxGPUStatus==='function'?window.__spiroPathFxGPUStatus():null,
    particles:typeof window.__spiroParticleGPUStatus==='function'?window.__spiroParticleGPUStatus():null,
    governor:typeof window.__spiroPerformanceGovernorStatus==='function'?window.__spiroPerformanceGovernorStatus():null,
    v535Contract:'Blue exact-Arc/Web and Green endpoint/particle resources prewarm before visible phase clocks; GPU ring/cache residency is independent from instantaneous FPS; exact Lightning, Morph Web and Path FX reuse retained GPURenderBundles; lamp visual interpolation shares the render-frame timestamp'
});
