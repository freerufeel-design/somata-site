

window.__spiroRegisterModule?.('js/render/main-pipeline');

function prepareMainRenderFrame(renderFrame) {
    const renderStartedAt = renderFrame.now;

    renderFrame.strictSpiralGpuPresentRequired=false;

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
    // renderRuntime.frame is deliberately reused.  Deferred Layer Scene commands are not:
    // a Fill/Web command from frame N must never survive into frame N+1 just because frame N
    // missed its normal presentation/cleanup path (notably possible with Web active + Line hidden).
    try{beginLayerSceneEffectCommandFrame?.(renderFrame);clearFrameSceneEffectCallbacks?.(renderFrame);}catch(_){}
    if(gpuBackendAllowed)WebGPUStrokeRenderer.clearDeferredLayerScene?.();
    const displayLayers=(typeof SpiroMorphController!=='undefined'&&typeof SpiroMorphController.getDisplayLayers==='function')
        ? SpiroMorphController.getDisplayLayers()
        : (state.layers||[]);

    const strictGeometryEntryIntent=SomataGeometryPolicy.hasStrictEntryIntent(displayLayers);
    renderFrame.strictGeometryEntryIntent=strictGeometryEntryIntent;
    renderFrame.strictSpiralEntryIntent=strictGeometryEntryIntent; // compatibility field for older GPU services
    if(strictGeometryEntryIntent){
        try{WebGPUDeviceHub?.warmup?.();}catch(_){}
        try{SomataGeometryRoleService?.warmupEntry?.(true);}catch(_){}
        try{WebGPUFinalCompositeRenderer?.warmup?.();}catch(_){}
    }

    try{SomataFeatureLifecycle?.begin?.(renderFrame,displayLayers,gpuBackendAllowed,mainCanvas.width,mainCanvas.height);}catch(err){somataGpuDiagnosticError?.('feature-lifecycle','frame-begin',String(err?.message||err),renderFrame,{recovered:true});}
    
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

    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.globalAlpha = 1;
    mainCtx.filter = 'none';
    mainCtx.shadowBlur = 0;
    mainCtx.setLineDash([]);

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
    
    const morphProviders = SomataMorphProviderService.prepareFrameSnapshot(renderFrame);
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
    return renderFrame;
}

function prepareMainLayerMorphState(frameCtx, renderFrame) {
    const providers=SomataMorphProviderService.resolveLayerProviders(frameCtx,renderFrame);
    const blue=providers.blue, orange=providers.orange, green=providers.green;
    const sourceLayer=frameCtx.sourceLayer;
    const greenLampDisplay=Boolean(green.lampPlan?.pairs?.some(pair => (Number(pair?.startLevel)||0)>.001 || (Number(pair?.endLevel)||0)>.001));
    const lampDisplayEnabled=orange.active
        ? Boolean((orange.sourceLayer&&getLayerLampsEnabled(orange.sourceLayer)) || (orange.targetLayer&&getLayerLampsEnabled(orange.targetLayer)) || blue.forcedLampMorph)
        : (greenLampDisplay || getLayerLampsEnabled(sourceLayer) || blue.forcedLampMorph);

    const renderLayerSource=blue.renderLayer || sourceLayer;
    frameCtx.layerSource=renderLayerSource;
    frameCtx.layer=SomataRenderLayerSnapshot?.create?.(renderLayerSource)||renderLayerSource;
    const effectLayerSource=liveEffectOwnerForFrameLayer(renderLayerSource);
    frameCtx.effectLayerSource=effectLayerSource;
    frameCtx.effectLayer=effectLayerSource===renderLayerSource?frameCtx.layer:(SomataRenderLayerSnapshot?.create?.(effectLayerSource)||effectLayerSource);
    try{window.SomataMorphParameterRouting?.applyFrame?.(frameCtx);}catch(error){console.warn('[Somata Parameter Routing] frame overlay skipped',error);}
    try{window.applySharedAudioParameterFrameRouting?.(frameCtx);}catch(error){console.warn('[Somata Audio Parameter Routing] frame overlay skipped',error);}
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
    const effectLayer=frameCtx.effectLayer||liveEffectOwnerForFrameLayer(layer);
    frameCtx.effectLayer=effectLayer;
    if(layer && (getLayerFillMatchStroke(layer)||getLayerFillMatchStroke(frameCtx.sourceLayer))){
        layer.fillMatchStroke=true;
        syncLayerFillColorToStroke(layer,true);
    }
    const blue=frameCtx.blueMorphProvider;
    const audioActive=renderFrame.audioActive;
    const legacyAudioScale=audioActive?audioApplyNumeric('layer.scale',1,layerIndex):1;
    // 7.11.0: canonical Audio `Размер` must remain visible while Blue Morph owns an
    // already-resolved carrier. Compose the audio-driven radius as a post-Morph scale
    // instead of changing only the snapshot radius after the carrier was built.
    let routedRadiusScale=1;
    if(audioActive&&blue?.active===true&&hasActiveAudioRoute('layer.radius')){
        const baseRadius=Math.max(.0001,Math.abs(Number(layer?.radius)||1));
        const routedRadius=Math.max(0,Number(audioApplyNumeric('layer.radius',baseRadius,layerIndex))||0);
        routedRadiusScale=Math.max(.0001,routedRadius/baseRadius);
    }
    const audioScale=legacyAudioScale*routedRadiusScale;
    const audioRotationOffset=audioActive?audioApplyNumeric('layer.rotation',0,layerIndex):0;
    const lightMorphScale=blue?.lightScale ?? 1;
    const lightMorphRotation=blue?.lightRotation ?? 0;
    const linearMotionRotation=getLayerMotionRotationRadians(layer)*180/Math.PI;
    const baseAlpha=audioApplyNumeric('layer.opacity',(layer.opacity!==undefined?layer.opacity:100),layerIndex)/100;
    const lineOpacityFactor=Math.max(0,Math.min(1,(Number.isFinite(Number(layer?.lineOpacity))?Number(layer.lineOpacity):100)/100));
    const lineProfileApplication=['stroke','graffiti'].includes(effectLayer?.lineProfileApplication)?effectLayer.lineProfileApplication:'stroke';
    const lineModeProfile=effectLayer?.sprite?.enabled===true?'round':normalizeLineProfileValue(effectLayer?.lineProfileStroke ?? effectLayer?.lineProfile ?? layer?.lineProfileStroke ?? layer?.lineProfile,'round');

    if(effectLayer===layer){layer.lineProfile=lineModeProfile;layer.lineProfileStroke=lineModeProfile;}
    const lineProfileStrokeOnly=linesAreEffectivelyVisible(effectLayer) && (
        (lineProfileApplication==='stroke'&&['slash','square','circle','cross'].includes(lineModeProfile)) || lineProfileApplication==='graffiti'
    ) && (!blue?.active || blue.mode!=='lightning');

    frameCtx.lineProfileApplication=lineProfileApplication;
    // Graffiti replaces the ordinary Base only when the replacement GPU renderer
    // is ready. Otherwise a non-strict layer must keep its authoritative Line
    // visible while the GPU warms up; this matters most when it is soloed.
    // Strict Spiral remains retained-GPU-only and never falls back to a CPU contour.
    const graffitiWaiting= lineProfileApplication==='graffiti' && lineProfileStrokeOnly &&
        !SomataGeometryPolicy.isStrict(frameCtx) &&
        !(typeof WebGPUGraffitiRibbonRenderer!=='undefined' && WebGPUGraffitiRibbonRenderer.isReady?.());
    frameCtx.lineProfileStrokeOnly=graffitiWaiting?false:lineProfileStrokeOnly;
    frameCtx._graffitiBaseWhileGpuWarming=graffitiWaiting;
    frameCtx.lineDisplayEnabled=getLayerLineVisible(effectLayer) || frameCtx.lightningFlashAlpha>.001;
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
    frameCtx.tunnelPaletteProfile=tunnelColorShiftIsActive() ? resolveTunnelPaletteProfile(frameCtx.tunnelBaseStrokeColor,layer,layerIndex,'stroke') : null;
    frameCtx.tunnelFillPaletteProfile=tunnelColorShiftIsActive() ? resolveTunnelPaletteProfile(frameCtx.tunnelBaseFillColor,layer,layerIndex,'fill') : null;
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
    const glowOwner=frameCtx.effectLayer||layer;
    const glowBase = frameCtx.minimalFadeEnabled
        ? Math.max(0, (Number(frameCtx.minimalSourceLayer?.glow)||0)*getLayerGlowMultiplier(frameCtx.minimalSourceLayer), (Number(frameCtx.minimalTargetLayer?.glow)||0)*getLayerGlowMultiplier(frameCtx.minimalTargetLayer))
        : Math.max(0, (Number(glowOwner?.glow)||0)*getLayerGlowMultiplier(glowOwner));
    frameCtx.glow = frameCtx.geometryPlan?.kind === 'lightning'
        ? 0
        : audioApplyNumeric('layer.glow',glowBase,layerIndex);
}

function prepareMainLayerVectorMaster(frameCtx) {
    let frameVectorMaster = null;
    let frameVectorMasterScale = 1;
    const tunnelCanUseMaster = state.tunnel.active;
    const topologyGpuLazy=frameCtx._topologyMorphGpuLazy===true&&SomataGeometryRoleService.backendEligible(frameCtx,'topology','base')===true;
    const greenProjectGpuNative=SomataGeometryRoleService.backendEligible(frameCtx,'green','base')===true&&state.lineOutline?.enabled!==true;

    const spiralBezierGpuNative=frameCtx.morphFrameActive===true&&SomataGeometryRoleService.backendEligible(frameCtx,'spiral','base')===true;
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
        // Resolve the *same* per-frame Corridor attributes once for this Canvas pass,
        // instead of walking the FeatureHost owner chain three times per copy.
        // The cache remains owned and invalidated by SomataCorridorCopyFrame.
        const corridorActive=state.tunnel.active===true;
        const copyAttributes=corridorActive?SomataCorridorCopyFrame.batch(frameCtx):null;
        const closedSpiralCorridor=corridorActive&&isSpiralLayer(frameCtx.layer)&&frameCtx.layer.spiralClosed!==false;
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
            if (closedSpiralCorridor) {
                let nextAlpha = alpha;
                if (i + 1 < copies.length) {
                    const nextCopy = copies[i + 1];
                    const nextRawAlpha = alphas[i + 1];
                    const nextWeight = instanceWeight ? Math.max(0, Math.min(1, Number(instanceWeight(nextCopy, nextRawAlpha, i + 1)) || 0)) : 1;
                    nextAlpha = Math.max(0, nextRawAlpha * nextWeight);
                }

                targetCtx.__spiralCorridorAlphaEndRatio = alpha > 1e-8 ? nextAlpha / alpha : 1;
            } else {
                delete targetCtx.__spiralCorridorAlphaEndRatio;
            }
            if (corridorActive) {
                const copyStroke=SomataCorridorCopyFrame.strokeAt(copyAttributes,copy,i);
                const copyFill=SomataCorridorCopyFrame.fillAt(copyAttributes,copy,i);
                if (frameCtx.frameVectorMaster && frameCtx.tunnelCanUseMaster && !ignoreMaster) {
                    targetCtx.save();
                    const copyAngle=SomataCorridorCopyFrame.rotationAt(copyAttributes,copy,i);
                    if(Math.abs(copyAngle)>1e-12)targetCtx.rotate(copyAngle);
                    replayVectorRecording(targetCtx, frameCtx.frameVectorMaster, alpha, copy.scale / frameCtx.frameVectorMasterScale, {strokeStyle:copyStroke,fillStyle:copyFill});
                    targetCtx.restore();
                } else {
                    targetCtx.save();
                    targetCtx.strokeStyle=copyStroke;targetCtx.fillStyle=copyFill;
                    const copyAngle=SomataCorridorCopyFrame.rotationAt(copyAttributes,copy,i);
                    if(Math.abs(copyAngle)>1e-12)targetCtx.rotate(copyAngle);
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

    frameCtx.drawLayerFillInstances = (targetCtx) => {
        const copies=frameCtx.visibleInstances.copies;
        const alphas=frameCtx.visibleInstances.fillAlphas||frameCtx.visibleInstances.alphas;
        const corridorActive=state.tunnel.active===true;
        const copyAttributes=corridorActive?SomataCorridorCopyFrame.batch(frameCtx):null;
        const prevSuppressStroke=targetCtx.__suppressStroke;
        targetCtx.__suppressStroke=true;
        for(let i=0;i<copies.length;i++){
            const copy=copies[i],alpha=Math.max(0,Math.min(1,Number(alphas[i])||0));
            if(alpha<=.0001)continue;
            if(corridorActive){targetCtx.save();const copyFill=SomataCorridorCopyFrame.fillAt(copyAttributes,copy,i);targetCtx.fillStyle=copyFill;const copyAngle=SomataCorridorCopyFrame.rotationAt(copyAttributes,copy,i);if(Math.abs(copyAngle)>1e-12)targetCtx.rotate(copyAngle);targetCtx.scale(copy.scale,copy.scale);frameCtx.drawLayerGeometry(targetCtx,alpha);targetCtx.restore();}
            else frameCtx.drawLayerGeometry(targetCtx,alpha);
        }
        if(prevSuppressStroke===undefined)delete targetCtx.__suppressStroke;else targetCtx.__suppressStroke=prevSuppressStroke;
    };
}

function prepareMainLayerFrame(renderFrame, layerIndex) {
    const frameCtx = acquireLayerFrameEffectContext(layerIndex);
    frameCtx.frame = renderFrame;
    frameCtx.runtime = renderRuntime;
    frameCtx.now = renderFrame.now;
    if (!SomataMorphProviderService.resolveFrameSource(frameCtx, renderFrame)) return null;
    prepareMainLayerMorphState(frameCtx, renderFrame);
    try{window.SomataTestMorph?.applyFrame?.(frameCtx,renderFrame.now);}catch(error){console.warn('[Somata Test Morph] skipped',error);}
    prepareMainLayerTransformAndStyle(frameCtx, renderFrame);
    prepareMainLayerGeometry(frameCtx);
    prepareMainLayerInstances(frameCtx, renderFrame);
    // Build the Line execution carrier before effect planning. Ordinary effects now derive
    // their geometry from the exact Line commands for this frame, so the recorder must exist
    // before Web/Graffiti/Sweep plans are prepared.
    prepareMainLayerVectorMaster(frameCtx);
    prepareMainLayerEffects(frameCtx);
    if(typeof prepareLayerConsumerDemand==='function')prepareLayerConsumerDemand(frameCtx);
    frameCtx.prepared = true;
    return frameCtx;
}

window.__spiroMorphProviderSnapshot = (layerIndex=0) => {
    const frame=renderRuntime.frame || {};
    SomataMorphProviderService.prepareFrameSnapshot(frame);
    const ctx=acquireLayerFrameEffectContext(Math.max(0,Math.floor(Number(layerIndex)||0)));
    ctx.frame=frame;ctx.runtime=renderRuntime;ctx.now=performance.now();
    if(!SomataMorphProviderService.resolveFrameSource(ctx,frame))return null;
    const providers=SomataMorphProviderService.resolveLayerProviders(ctx,frame);
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
        geometryCircles:Boolean(getLiveGeometryCircleConfig(ctx)?.enabled===true&&ctx.layer?.visible!==false),
        spiral:Boolean(ctx.layer?.spiralEnabled===true&&ctx.layer?.visible!==false),
        motionRotation:Boolean(ctx.layer?.motionRotation?.enabled===true&&ctx.layer?.visible!==false),
        glow:Boolean(e.glow?.enabled),
        outline:Boolean(e.outline?.enabled),
        profile:Boolean(e.profile?.enabled),
        profileType:e.profile?.application||'stroke',
        motion:Boolean(e.motion?.enabled),
        sprite:Boolean(e.sprite?.enabled),
        particles:Boolean(typeof normalizeParticleConfig==='function'&&normalizeParticleConfig((ctx.effectLayer||liveEffectOwnerForFrameLayer(ctx.layer))?.particles)?.enabled===true&&ctx.layer?.visible!==false),
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

window.__somataSpiralAudit = (layerIndex=0) => {
    const li=Math.max(0,Math.floor(Number(layerIndex)||0));
    const layer=state.layers?.[li]||null;
    const rec=renderRuntime?.layerFrames?.[li]||null;
    const ctx=rec?.prepared?rec:null;
    return {
        version:'7.5',gpuOnly:true,layerIndex:li,layerId:layer?.id||null,
        spiral:Boolean(layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(layer)),
        strictGpu:Boolean(ctx&&SomataGeometryPolicy.isStrict(ctx)),
        corridor:state.tunnel?.active===true,
        morph:{blue:runtimeState?.morph?.active===true,orange:runtimeState?.minimalMorph?.active===true,green:runtimeState?.projectMorph?.active===true},
        effects:{web:getLayerWebEnabled(layer)===true,sweep:getLayerSweepConfig(layer)?.enabled===true,graffiti:layer?.lineProfileApplication==='graffiti',lamps:getLayerLampsEnabled(layer)===true},
        diagnostics:window.__somataGpuRuntimeDiagnostics?.()||null
    };
};

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

function renderPreparedMainLayer(frameCtx) {
    if (!frameCtx?.prepared || !frameCtx.layer) return;

    // 7.7.7: planning is the last phase allowed to normalize render-local layer data.
    // Every effect after this point sees immutable geometry/style snapshots, so one
    // effect cannot corrupt another effect's inputs within the same frame.
    try{SomataRenderLayerSnapshot?.seal?.(frameCtx.layer);if(frameCtx.effectLayer&&frameCtx.effectLayer!==frameCtx.layer)SomataRenderLayerSnapshot?.seal?.(frameCtx.effectLayer);}catch(_){}

    mainCtx.save();
    try {
        mainCtx.lineWidth = frameCtx.strokeWidth;
        mainCtx.lineCap = frameCtx.lineCap;
        mainCtx.lineJoin = frameCtx.lineJoin;
        mainCtx.miterLimit = frameCtx.miterLimit;
        mainCtx.strokeStyle = frameCtx.lightningStroke || frameCtx.layer.strokeColor || '#ffffff';
        mainCtx.fillStyle = frameCtx.layer.fillColor || 'transparent';
        mainCtx.shadowBlur = 0;

        const runPass=(name,fn,fallback=null)=>{const pt=renderPassProfiler.begin();try{
            const execute=(ctx)=>{
                const work=()=>fn(ctx);
                if(typeof runSpiroIsolatedRenderPass==='function')return runSpiroIsolatedRenderPass(ctx,name,work,fallback);
                work();return{ok:true};
            };
            if(typeof SomataFeatureHost!=='undefined'&&SomataFeatureHost.has?.(name))return SomataFeatureHost.run(name,frameCtx,execute);
            return execute(frameCtx);
        }finally{renderPassProfiler.end(name,pt);}};
        // 7.11.8: per-layer wall-clock diagnostics for the very frame that stalls.
        // The legacy pass profiler samples every ten frames and can therefore
        // report unrelated passes during a 500-1300 ms driver/Canvas stall.
        const layerTiming=frameCtx._slowFrameLayerTiming||null;
        const recordStep=(label,work)=>{
            if(!layerTiming)return work();
            const started=performance.now();
            try{return work();}finally{
                const ms=performance.now()-started;
                layerTiming.steps[label]=(layerTiming.steps[label]||0)+ms;
            }
        };
        const runRegisteredStage=(stage)=>recordStep('stage:'+String(stage),()=>SomataRenderPassRegistry.runStage(stage,frameCtx,(row)=>runPass(row.name,ctx=>row.run(ctx),row.fallback?()=>row.fallback(frameCtx):null)));
        const runRegisteredHooks=(stage)=>recordStep('hooks:'+String(stage),()=>SomataRenderPassRegistry.runHooks(stage,frameCtx,(row)=>row.run(frameCtx)));
        runRegisteredHooks('beforeLayer');
        // Fast path: do not open an offscreen Layer Scene merely because configurable
        // ordering exists. Fill/Web and later effects seed one when they actually need it.
        // A neutral root is reserved for the one case that cannot be recovered later:
        // a technically-late effect that the user has artistically moved below Geometry.
        const effectOrderPlan=SomataEffectStackOrder?.plan?.(frameCtx)||null;
        if(effectOrderPlan?.requiresEarlyScene===true){try{SomataLayerSceneService?.ensure?.(frameCtx,'effect-stack-order-root');}catch(_){}}
        runRegisteredStage(SomataRenderPassRegistry.STAGES.UNDERLAY);

        // Physical scene order is explicit: Fill -> Web -> Line/Glow. Web must never be
        // hidden under a Fill attachment inside the Base batch. Fill/Web establish the
        // resident Layer Scene first; only then is the shared stroke batch encoded so it
        // can load and preserve that scene.
        try{SomataGeometryPolicy.invoke(frameCtx,'ensureEffectSceneRoot');}catch(err){try{spiroPassIsolationNoteFailure?.('strictSpiralRootPreflight',err,frameCtx);}catch(_){} }
        runRegisteredStage(SomataRenderPassRegistry.STAGES.FILL);
        runRegisteredStage(SomataRenderPassRegistry.STAGES.OVER_FILL);

        try{recordStep('strokeBatch.prepare',()=>SomataStrokeBatchService.prepare(frameCtx));}catch(err){frameCtx._webgpuStrokeBatch=null;try{spiroPassIsolationNoteFailure?.('strokeBatch',err,frameCtx);}catch(_){} }
        runRegisteredHooks('afterStrokeBatch');

        if(Number(frameCtx.frame?.renderLayerCount||0)>1&&WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)){
            const batch=frameCtx._webgpuStrokeBatch,contract=getLayerGeometryContract(frameCtx),fillPrepared=frameCtx?._webgpuFillPrepared;
            const sceneHasAuthoritativeFill=batch?.fillInScene===true&&(fillPrepared?.authoritative===true||batch?.nativeFillInScene===true);
            const needsOutOfSceneFill=contract?.fillRequested===true&&!sceneHasAuthoritativeFill&&frameCtx?._baseFillCommitted!==true;
            const hiddenGraffitiCarrier=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
            const canJoin=Boolean((batch?.sceneCombined&&!needsOutOfSceneFill&&canDeferLayerSceneForFrame(frameCtx,batch))||canUseGpuOnlyCorridorLayerScene(frameCtx,hiddenGraffitiCarrier)||SomataGeometryPolicy.invoke(frameCtx,'canUseFrameScene')===true||SomataGeometryPolicy.invoke(frameCtx,'canUseLayerScene',hiddenGraffitiCarrier&&frameCtx.morphFrameActive===true)===true);
            if(!canJoin){
                if(SomataGeometryPolicy.isStrict(frameCtx)){renderBackendTelemetry.mark('geometry','gpu','strict Spiral waits to join frame GPU scene; materialization forbidden');try{requestMainCanvasRender?.();}catch(_){}return;}

                const presented=recordStep('frameScene.presentToMain',()=>WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId,mainCtx,true));
                if(presented){frameCtx.frame.gpuMainCanvasHasContent=true;try{notifyFrameSceneEffectCommandsSubmitted?.(frameCtx.frame);}catch(_){}}
                else somataGpuDiagnosticError('geometry','frame-scene-present','GPU frame scene could not be presented',frameCtx,{fallback:'gpu-current-frame-repaint',recovered:true});
                noteFrameGraphMaterialization(frameCtx.frameId);frameCtx.frame.gpuMainSceneEmpty=false;
            }
        }

        try{SomataGeometryPolicy.invoke(frameCtx,'ensureEffectSceneRoot');}catch(err){try{spiroPassIsolationNoteFailure?.('strictSpiralRoot',err,frameCtx);}catch(_){} }
        runRegisteredStage(SomataRenderPassRegistry.STAGES.GLOW);
        runRegisteredStage(SomataRenderPassRegistry.STAGES.BASE);

        try{spiroGpuPreflightLayerPrerequisites?.(frameCtx);}catch(err){try{spiroPassIsolationNoteFailure?.('gpuPreflight',err,frameCtx);}catch(_){} }
        runRegisteredStage(SomataRenderPassRegistry.STAGES.POST_BASE);


        const strictCarrierExpected=SomataGeometryPolicy.isStrict(frameCtx)&&frameCtx.lineDisplayEnabled===true&&
            frameCtx.lineProfileStrokeOnly!==true&&!(typeof isPathFxBaseReplacementActive==='function'&&isPathFxBaseReplacementActive(frameCtx));
        if(strictCarrierExpected&&frameCtx._baseStrokeCommitted!==true){
            frameCtx.frame._strictSpiralGpuFrameIncomplete=true;
            somataSpiralSceneDiag.base.stage='base-missing-full-gpu-error';
            renderBackendTelemetry.mark('geometry','gpu','strict Spiral Base missing; Full GPU frame rejected');
            somataGpuContractError('SPIRAL_BASE_MISSING_AT_FRAME_END',frameCtx,{base:{...somataSpiralSceneDiag.base}});
            try{requestMainCanvasRender?.();}catch(_){}
        }

        if(frameCtx._spiralBezierFrameSceneDirect===true&&frameCtx._spiralBezierFrameSceneCounted!==true){
            frameCtx._spiralBezierFrameSceneCounted=true;
            frameCtx.frame.gpuFrameSceneLayers=(Number(frameCtx.frame.gpuFrameSceneLayers)||0)+1;
            if(frameCtx.frame.gpuFrameSceneLayers===frameCtx.frame.renderLayerCount)frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;
        }

        if(frameCtx.frame?.gpuLayerSceneDeferred&&Number(frameCtx.frame.renderLayerCount||0)>1){
            const extra=collectLayerSceneCommandBuffers(frameCtx.frame);

            WebGPUStrokeRenderer.appendFrameUnderlayCommands?.(frameCtx.frameId,extra);
            if(recordStep('frameScene.sealDeferred',()=>WebGPUStrokeRenderer.sealDeferredLayerSceneToFrame?.(frameCtx.frameId,extra))){
                try{transferLayerSceneEffectCallbacksToFrameScene?.(frameCtx.frame);}catch(_){}
                frameCtx.frame.gpuLayerSceneDeferred=false;clearLayerSceneEffectCommands(frameCtx.frame);
                frameCtx.frame.gpuFrameSceneLayers=(Number(frameCtx.frame.gpuFrameSceneLayers)||0)+1;
                if(frameCtx.frame.gpuFrameSceneLayers===frameCtx.frame.renderLayerCount){

                    frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;
                }
            }else{
                if(SomataGeometryPolicy.isStrict(frameCtx)){

                    renderBackendTelemetry.mark('final','gpu','strict Spiral multi-layer seal failed; no fallback');
                    somataGpuContractError('SPIRAL_FRAME_SCENE_SEAL_FAILED',frameCtx,{layers:Number(frameCtx.frame?.gpuFrameSceneLayers)||0,expected:Number(frameCtx.frame?.renderLayerCount)||0});
                    frameCtx.frame._strictSpiralGpuFrameIncomplete=true;
                    try{WebGPUStrokeRenderer.discardFrameScene?.(frameCtx.frameId);}catch(_){}try{WebGPUStrokeRenderer.clearDeferredLayerScene?.();}catch(_){}try{WebGPUStrokeRenderer.discardFrameUnderlay?.(frameCtx.frameId);}catch(_){}clearLayerSceneEffectCommands(frameCtx.frame);frameCtx.frame.gpuLayerSceneDeferred=false;try{requestMainCanvasRender?.();}catch(_){}return;
                }

                if(WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId)){const presented=recordStep('frameScene.sealFallback',()=>WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameCtx.frameId,mainCtx,true));if(presented)try{notifyFrameSceneEffectCommandsSubmitted?.(frameCtx.frame);}catch(_){} }
                materializeDeferredLayerScene(frameCtx);frameCtx.frame.gpuMainSceneEmpty=false;
            }
        }
    } finally {
        mainCtx.restore();
        frameCtx.drawLayerGeometry = null;
        frameCtx.drawLayerInstances = null;
        frameCtx.drawLayerFillInstances = null;
        frameCtx.frameVectorMaster = null;
        frameCtx._corridorLayerSceneActive=false;frameCtx._spiralBezierFrameSceneDirect=false;frameCtx._spiralBezierFrameSceneCounted=false;frameCtx._webgpuStrokeBatch = null;frameCtx._webgpuFillPrepared = null;frameCtx._nativeFillMeshCandidate = null;frameCtx._frameContourRecord=null;frameCtx._geometryContract = null;frameCtx._geometryKernelView = null;frameCtx._geometryKernelStrokeView = null;frameCtx._fillMeshShadow = null;
        resetMainLayerGeometryPlan(frameCtx.geometryPlan);
        resetLayerEffectsPlan(frameCtx.effectsPlan);
        frameCtx.prepared = false;
    }
}

function renderMainLayer(renderFrame, layerIndex) {
    const started=performance.now();
    const details=renderPerf.currentFramePhases?.layerDetails;
    const diagnostic=Array.isArray(details)?{index:layerIndex,prepareMs:0,drawMs:0,totalMs:0,steps:Object.create(null)}:null;
    let __pt=renderPassProfiler.begin();let frameCtx=null;
    try{frameCtx=typeof runSpiroIsolatedLayerPreparation==='function'?runSpiroIsolatedLayerPreparation(renderFrame,layerIndex,()=>prepareMainLayerFrame(renderFrame,layerIndex)):prepareMainLayerFrame(renderFrame,layerIndex);}
    finally{renderPassProfiler.end('layerPrepare',__pt);if(diagnostic)diagnostic.prepareMs=performance.now()-started;}
    if(frameCtx){
        if(diagnostic){diagnostic.kind=String(frameCtx.geometryPlan?.kind||'unknown');frameCtx._slowFrameLayerTiming=diagnostic;}
        if(SomataGeometryPolicy.isStrict(frameCtx)&&renderFrame)renderFrame.strictSpiralGpuPresentRequired=true;
        const drawStarted=performance.now();
        try{renderPreparedMainLayer(frameCtx);}catch(err){try{spiroPassIsolationNoteFailure?.('layerRender',err,frameCtx);}catch(_){console.error('SpiroStar isolated layer render failure:',err);}}
        finally{if(diagnostic){diagnostic.drawMs=performance.now()-drawStarted;frameCtx._slowFrameLayerTiming=null;}}
    }
    if(diagnostic){diagnostic.totalMs=performance.now()-started;details.push(diagnostic);}
}

function renderMainLayers(renderFrame) {
    for (let layerIndex = 0; layerIndex < renderFrame.renderLayerCount; layerIndex++) {
        renderMainLayer(renderFrame, layerIndex);
    }
}

function renderMainViewportEffects(renderFrame) {
    const { w, h, dpr } = renderFrame;

    renderFrame.gpuFinalVignetteDeferred = (typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed())&&WebGPUFinalCompositeRenderer.canDeferVignette(renderFrame);

    if (!renderFrame.gpuFinalVignetteDeferred && renderFrame.strictSpiralGpuPresentRequired!==true) {
        applyTunnelScreenEdgeFeather(mainCtx, w, h, dpr);
        if(typeof applyTunnelCenterRevealMask==='function')applyTunnelCenterRevealMask(mainCtx,renderFrame);
    }
    
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

        clearLayerSceneEffectCommands(renderFrame);try{clearFrameSceneEffectCallbacks?.(renderFrame);}catch(_){}
        try{spiroPassIsolationNoteFailure?.('frame',err,{frameId:renderFrame?.id,layerIndex:-1});}catch(_){}
    } catch (_) {}
}

function recoverGpuPresentationToMainCanvas(renderFrame){
    const frameId=Number(renderFrame?.id)||0;
    let needed=false,recovered=false,ok=true;
    try{
        const frameScene=WebGPUStrokeRenderer.getFrameSceneTexture?.(frameId);
        if(frameScene){
            needed=true;
            const shown=WebGPUStrokeRenderer.presentFrameSceneToMain?.(frameId,mainCtx,true)===true;
            if(shown){recovered=true;try{notifyFrameSceneEffectCommandsSubmitted?.(renderFrame);}catch(_){} }
            else ok=false;
        }else if(renderFrame?.gpuLayerSceneDeferred===true){
            needed=true;
            const extra=collectLayerSceneCommandBuffers(renderFrame);
            const shown=WebGPUStrokeRenderer.presentDeferredLayerSceneToMain?.(frameId,mainCtx,extra)===true;
            if(shown){recovered=true;notifyLayerSceneEffectCommandsSubmitted(renderFrame);clearLayerSceneEffectCommands(renderFrame);}
            else ok=false;
        }
    }catch(_){ok=false;}
    try{
        if(renderFrame?.gpuLampsDeferred===true){needed=true;const shown=SomataLampPassService.presentDeferred()===true;if(shown)recovered=true;else ok=false;}
    }catch(_){ok=false;}
    try{WebGPUFinalCompositeRenderer.disable?.();}catch(_){}
    if(renderFrame){renderFrame.gpuLayerSceneDeferred=false;renderFrame.gpuLampsDeferred=false;renderFrame.gpuFinalVignetteDeferred=false;renderFrame.gpuMainSceneEmpty=false;}
    return{ok:ok===true,recovered,needed};
}

function finishMainRenderFrame(renderStartedAt,renderFrame){
    const framePhases=renderPerf.currentFramePhases;
    let phaseAt=performance.now();
    if(renderFrame?.canvasTransformSaved){try{mainCtx.restore();}catch(_){}renderFrame.canvasTransformSaved=false;}
    let presented=false;
    if(somataGpuBackendAllowed()){
        try{presented=WebGPUFinalCompositeRenderer.render(renderFrame)===true;}catch(err){somataGpuContractError('FINAL_GPU_RENDER_EXCEPTION',renderFrame,{error:String(err?.stack||err)});}
    }else somataGpuDiagnosticError('final','capability','WebGPU is unavailable; Somata 7.5 has no CPU renderer',renderFrame);
    if(framePhases)framePhases.finalGpuMs=performance.now()-phaseAt;
    phaseAt=performance.now();
    if(!presented){
        const rescue=recoverGpuPresentationToMainCanvas(renderFrame);
        if(rescue.ok){
            renderBackendTelemetry.mark('final','gpu',rescue.recovered?'GPU fallback presented current frame to main canvas':'current main-canvas frame shown; stale final GPU frame disabled');
            if(rescue.needed&&rescue.recovered){
                somataGpuDiagnosticError('final','presentation-fallback','Final WebGPU compositor declined the current frame; the current GPU scene was presented through the GPU-to-main fallback',renderFrame,{fallback:'gpu-to-main-canvas',recovered:true});
            }
        }else{
            renderBackendTelemetry.mark('final','gpu','GPU frame rejected; fallback presentation failed',true);
            const faults=Array.isArray(renderFrame?._fullGpuFaults)?renderFrame._fullGpuFaults.slice(-SOMATA_FULL_GPU_FRAME_FAULT_LIMIT):[];
            somataGpuContractError('FINAL_FULL_GPU_PRESENT_FAILED',renderFrame,{final:WebGPUFinalCompositeRenderer.status?.()||null,stroke:WebGPUStrokeRenderer.status?.()||null,faultCount:Number(renderFrame?._fullGpuFaultCount)||faults.length,faults,fallback:'gpu-to-main-canvas-failed'});
            try{WebGPUStrokeRenderer.discardFrameScene?.(renderFrame?.id);}catch(_){}
            try{WebGPUStrokeRenderer.clearDeferredLayerScene?.();}catch(_){}
            try{WebGPUStrokeRenderer.discardFrameUnderlay?.(renderFrame?.id);}catch(_){}
            try{SomataLampPassService.clear?.();}catch(_){}
            clearLayerSceneEffectCommands(renderFrame);try{clearFrameSceneEffectCallbacks?.(renderFrame);}catch(_){}
            try{requestMainCanvasRender?.();}catch(_){}
        }
    }else if(renderFrame){renderBackendTelemetry.mark('final','gpu','final WebGPU composite');renderFrame.gpuLayerSceneDeferred=false;renderFrame.gpuLampsDeferred=false;renderFrame.gpuFinalVignetteDeferred=false;renderFrame.gpuMainSceneEmpty=false;}
    if(framePhases)framePhases.presentationRescueMs=performance.now()-phaseAt;
    phaseAt=performance.now();
    try{SomataFeatureLifecycle?.end?.(renderFrame,somataGpuBackendAllowed());}catch(err){spiroPassIsolationNoteFailure?.('featureLifecycleEnd',err,{frameId:renderFrame?.id,layerIndex:-1});}
    finishLampAdaptiveFrame();endFrameGeometryRuntime();renderRuntime.end();
    if(framePhases)framePhases.frameCleanupMs=performance.now()-phaseAt;
    const paintNow=performance.now();renderPerf.lastRenderMs=Math.max(0,paintNow-renderStartedAt);renderPerf.lastPaintAt=paintNow;performanceGovernor.noteFrame(paintNow,renderPerf.lastRenderMs);renderBackendTelemetry.commit();
    if(showFpsCounter){if(!renderPerf.fpsLastFrameAt||paintNow-renderPerf.fpsLastFrameAt>500){renderPerf.fpsWindowStart=paintNow;renderPerf.fpsFrames=0;}renderPerf.fpsLastFrameAt=paintNow;renderPerf.fpsFrames+=1;const elapsed=paintNow-renderPerf.fpsWindowStart;if(elapsed>=750){const fps=Math.max(0,Math.round(renderPerf.fpsFrames*1000/Math.max(1,elapsed))),text=`${fps} FPS`;if(fpsCounterEl&&text!==renderPerf.lastFpsText){fpsCounterEl.textContent=text;renderPerf.lastFpsText=text;}renderPerf.fpsWindowStart=paintNow;renderPerf.fpsFrames=0;}}
    renderPassProfiler.finish();try{somataFxBenchmark?.noteFrame?.(paintNow,renderPerf.lastRenderMs);}catch(_){}
    if(framePhases){
        const round=ms=>Number((Math.max(0,Number(ms)||0)).toFixed(2));
        framePhases.totalMs=round(performance.now()-renderStartedAt);
        const keys=['framePrepareMs','layersMs','lampGpuMs','viewportMs','finalGpuMs','presentationRescueMs','frameCleanupMs'];
        for(const key of keys)framePhases[key]=round(framePhases[key]);
        framePhases.unattributedMs=round(framePhases.totalMs-keys.reduce((sum,key)=>sum+framePhases[key],0));
        // Retain only finite numeric timings and a small (up to 8) layer list;
        // never retain geometry, render contexts or GPU handles in diagnostics.
        const layerDetails=framePhases.layerDetails.slice(0,8).map(entry=>({
            index:entry.index,kind:entry.kind||'unknown',
            prepareMs:round(entry.prepareMs),drawMs:round(entry.drawMs),totalMs:round(entry.totalMs),
            steps:Object.fromEntries(Object.entries(entry.steps).map(([key,ms])=>[key,round(ms)]))
        }));
        const snapshot={...framePhases,layerDetails:layerDetails};
        renderPerf.lastFramePhases=snapshot;
        if(snapshot.totalMs>=100){const history=renderPerf.recentSlowFramePhases;history.push(snapshot);if(history.length>12)history.shift();}
        renderPerf.currentFramePhases=null;
    }
    renderPerf.rendering=false;
    // Notify the independent optical overlay only AFTER WebGPU composition for
    // this frame has been submitted. The foreground must sample this frame,
    // not the previous one prepared by the pre-paint animation task.
    try{window.SomataAmbientPrism?.afterScenePaint?.(paintNow,renderFrame?.id);}catch(err){
        console.error('[Somata 3D optical post-scene render]',err);
    }
}

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
        fillRequested:Boolean(layer&&layer.fill===true&&alpha>.00001),
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
        version:'7.5',boot:window.__spiroAppBootComplete===true,now:Number(performance.now().toFixed(1)),
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

window.__somataSpiralTrace=()=>{
    let layer=null,canonical=null,mode=null,uiMode=null;
    try{layer=(typeof getRuntimeLayerById==='function'?getRuntimeLayerById(state?.activeLayerId):null)||state?.layers?.[0]||null;}catch(_){layer=state?.layers?.[0]||null;}
    try{mode=layer&&typeof getContourMode==='function'?getContourMode(layer):null;}catch(_){}
    try{uiMode=document.querySelector('[data-contour-mode].active')?.dataset?.contourMode||null;}catch(_){}
    const morphActive=runtimeState?.morph?.active===true;
    let frameLayer=null,sourceLayer=null,targetLayer=null;
    try{const idx=(state?.layers||[]).findIndex(item=>item?.id===layer?.id);if(idx>=0){frameLayer=runtimeState?.morph?.frameLayers?.[idx]||null;sourceLayer=runtimeState?.morph?.renderSourceLayers?.[idx]||null;targetLayer=runtimeState?.morph?.renderTargetLayers?.[idx]||null;}}catch(_){}
    const modeOf=(item)=>{try{return item&&typeof getContourMode==='function'?getContourMode(item):null;}catch(_){return null;}};

    const authored={id:layer?.id||null,mode,spiralEnabled:layer?.spiralEnabled===true,spiralClosed:layer?.spiralClosed!==false,spiralOrder:Number(layer?.spiralOrder),closedLoop:layer?.closedLoop===true,profileMode:layer?.profileMode||null,geometryVersion:Number(layer?.__geometryVersion||layer?.geometryVersion||0)};
    const morph={active:morphActive,progress:Number(runtimeState?.morph?.progress)||0,geometryT:Number(runtimeState?.morph?.geometryT)||0,frameMode:modeOf(frameLayer),frameSpiralEnabled:frameLayer?.spiralEnabled===true,sourceMode:modeOf(sourceLayer),targetMode:modeOf(targetLayer)};
    try{canonical=layer&&typeof getCanonicalLayerGeometry==='function'?getCanonicalLayerGeometry(layer):null;}catch(err){canonical={error:String(err?.message||err)};}
    const paths=Array.isArray(canonical?.paths)?canonical.paths:[];
    const pointCount=paths.reduce((n,p)=>n+(Array.isArray(p?.points)?p.points.length:0),0);
    const out={version:'7.5',uiMode,mode,layer:authored,morph,canonical:canonical?{geometryKey:canonical.geometryKey||canonical.key||null,pathCount:paths.length,pointCount,closedPathCount:paths.filter(p=>p?.closed===true).length,openPathCount:paths.filter(p=>p?.closed!==true).length,spiralMetaClosedPoints:paths.reduce((n,p)=>n+(p?.points||[]).filter(q=>q?.__spiralClosed===true).length,0),error:canonical.error||null}:null,scene:{internal:{...somataSpiralSceneDiag.internal},base:{...somataSpiralSceneDiag.base}},webgpu:{hub:window.__spiroWebGPUHubStatus?.()||null,stroke:window.__spiroWebGPUStatus?.()||null,staticBezier:window.__spiroStaticSpiralBezierStatus?.()||null,bezier:window.__somataSpiralBezierMorphStatus?.()||null,arc:window.__spiroGpuMorphArcStatus?.()||null,profileArc:window.__spiroProfileArcMarkerStatus?.()||null,final:window.__spiroFinalGPUStatus?.()||null}};
    console.log('[Somata Spiral trace]',out);return out;
};

function renderMainCanvas() {
    // Do not queue another expensive frame when the GPU is not retiring buffers.
    // The animation scheduler may continue to advance time; presentation resumes on fence completion.
    if (typeof WebGPUDeviceHub!=='undefined' && WebGPUDeviceHub.shouldThrottle()) return;
    if (typeof WebGPUBufferRecycler!=='undefined' && WebGPUBufferRecycler.shouldThrottle()) return;
    if (renderPerf.rendering) return;
    renderPerf.rendering = true;
    const renderStartedAt = performance.now();
    const renderFrame = renderRuntime.begin(renderStartedAt);
    const framePhases={frameId:Number(renderFrame?.id)||0,framePrepareMs:0,layersMs:0,layerDetails:[],lampGpuMs:0,viewportMs:0,finalGpuMs:0,presentationRescueMs:0,frameCleanupMs:0,gpuMainUploadMs:0,gpuQueueSubmitMs:0};
    renderPerf.currentFramePhases=framePhases;
    try{if(typeof beginSpiroPassIsolationFrame==='function')beginSpiroPassIsolationFrame(renderFrame?.id||renderRuntime?.frameId||0);}catch(_){}
    renderBackendTelemetry.begin(renderFrame?.id||renderRuntime?.frameId||0);
    renderPassProfiler.beginFrame();
    try {
        let phaseAt=performance.now();
        let __pt=renderPassProfiler.begin();prepareMainRenderFrame(renderFrame);renderPassProfiler.end('framePrepare',__pt);framePhases.framePrepareMs=performance.now()-phaseAt;
        phaseAt=performance.now();__pt=renderPassProfiler.begin();renderMainLayers(renderFrame);renderPassProfiler.end('layersTotal',__pt);framePhases.layersMs=performance.now()-phaseAt;

        phaseAt=performance.now();__pt=renderPassProfiler.begin();
        if(typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed()){
            const deferGpuLamps=WebGPUFinalCompositeRenderer.canDeferLamps(renderFrame);SomataLampPassService.flush(renderFrame,deferGpuLamps);
        }else renderFrame.gpuLampsDeferred=false;
        renderPassProfiler.end('lampGPU',__pt);framePhases.lampGpuMs=performance.now()-phaseAt;
        phaseAt=performance.now();__pt=renderPassProfiler.begin();renderMainViewportEffects(renderFrame);renderPassProfiler.end('viewport',__pt);framePhases.viewportMs=performance.now()-phaseAt;
    } catch (err) {
        recoverMainRenderError(err, renderFrame);
    } finally {

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

window.__spiroV532SmoothnessStatus=()=>({
    ...window.__spiroV531SmoothnessStatus(),
    sweep:typeof window.__spiroCanonicalSweepGPUStatus==='function'?window.__spiroCanonicalSweepGPUStatus():null,
    lamps:typeof window.__spiroLampGPUStatus==='function'?window.__spiroLampGPUStatus():null,
    rasterContract:'segment/sprite quads use 4-vertex triangle strips on Blue/Green Morph, Web, exact Lightning, Glint, Path FX, Lamps and Particles; polygon parity masks remain triangle lists by design'
});

window.__spiroV533SmoothnessStatus=()=>({
    ...window.__spiroV532SmoothnessStatus(),
    particles:typeof window.__spiroParticleGPUStatus==='function'?window.__spiroParticleGPUStatus():null,
    residencyContract:'Morph/Arc prerequisites are shared in the ordered deferred GPU scene; compatible particles render directly into Layer Scene at phase 35, with overlay only as fallback',
    gpuObjectContract:'stable Layer Scene GPUTextureViews are cached for Web, exact Lightning, canonical Glint and Graffiti hot passes'
});

window.__spiroV534SmoothnessStatus=()=>({
    ...window.__spiroV533SmoothnessStatus(),
    green:typeof window.__spiroGreenProjectMorphGPUStatus==='function'?window.__spiroGreenProjectMorphGPUStatus():null,
    blue:typeof window.__spiroTopologyMorphGpuStatus==='function'?window.__spiroTopologyMorphGpuStatus():null,
    cornerLamps:typeof window.__spiroGpuLampCornerStatus==='function'?window.__spiroGpuLampCornerStatus():null,
    v534Contract:'dense Green endpoint rails preserve up to 960 samples; dense cyclic alignment uses bounded coarse+multi-basin refinement; Blue/Green base+glow retain GPURenderBundles; corner lamps use exact cumulative vertex fractions and stable path+vertex identity'
});

window.__spiroV535SmoothnessStatus=()=>({
    ...window.__spiroV534SmoothnessStatus(),
    lightning:typeof window.__spiroGpuLightningArcStatus==='function'?window.__spiroGpuLightningArcStatus():null,
    web:typeof window.__spiroGpuMorphWebStatus==='function'?window.__spiroGpuMorphWebStatus():null,
    pathFx:typeof window.__spiroPathFxGPUStatus==='function'?window.__spiroPathFxGPUStatus():null,
    particles:typeof window.__spiroParticleGPUStatus==='function'?window.__spiroParticleGPUStatus():null,
    governor:typeof window.__spiroPerformanceGovernorStatus==='function'?window.__spiroPerformanceGovernorStatus():null,
    v535Contract:'Blue exact-Arc/Web and Green endpoint/particle resources prewarm before visible phase clocks; GPU ring/cache residency is independent from instantaneous FPS; exact Lightning, Morph Web and Path FX reuse retained GPURenderBundles; lamp visual interpolation shares the render-frame timestamp'
});
