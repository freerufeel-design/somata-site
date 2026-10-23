

window.__spiroRegisterModule?.('js/render/sweep-pass');

// Lightning-owned stencil cache lives with Sweep/Lightning, not in the core pipeline.
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



const sweepGpuArcBridgeStats={requests:0,hits:0,fallbacks:0,cpuPathBuildsAvoided:0,lastReason:'not-requested'};

const lightningGpuArcBridgeStats={requests:0,hits:0,fallbacks:0,cpuPathBuildsAvoided:0,cpuExactRailBuildsAvoided:0,cpuPieceBuildsAvoided:0,lastReason:'not-requested'};

function spiralSweepGpuStrict(frameCtx){return SomataGeometryRoleService.isStrict(frameCtx);}

function prepareSharedTopologySpectralBezier(frameCtx,cfg,now,lightning=false,cycleProgress=0){
    const rec=typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx?.layerIndex):(typeof getSharedGpuMorphPathResource==='function'?getSharedGpuMorphPathResource(frameCtx?.layerIndex):null);
    if(!rec?.ready||!rec?.bezierVisualRail||!rec?.cubicBuffer||!(rec.segmentCount>0))return null;
    const rawT=frameCtx?.blueMorphProvider?.geometryT??frameCtx?.geometryPlan?.progress,t=typeof rec.resolveMorphT==='function'?rec.resolveMorphT(rawT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(rawT):Math.max(0,Math.min(1,Number(rawT)||0)));
    const prefix=lightning?'lightning':'sweep',sectorBase=Number.isFinite(Number(cfg?.spectralSectorDegrees))?Number(cfg.spectralSectorDegrees):45,speedBase=Number.isFinite(Number(cfg?.spectralAngularSpeed))?Number(cfg.spectralAngularSpeed):90;
    const sectorDeg=Math.max(1,Math.min(360,audioApplyNumeric(`${prefix}.spectralSector`,sectorBase,frameCtx.layerIndex))),speedDeg=Math.max(-720,Math.min(720,audioApplyNumeric(`${prefix}.spectralSpeed`,speedBase,frameCtx.layerIndex)));

    const progress=Math.max(0,Math.min(1,Number(cycleProgress)||0));
    const baseDir=cfg?.direction==='backward'?-1:1,speedDir=speedDeg<0?-1:1,direction=baseDir*speedDir;
    return{bezierGlint:true,glintType:'spectral',spectral:true,spectralCycleLocked:true,spectralProgress:progress,spectralDirection:direction,cubicCount:rec.segmentCount,gpuCubicBuffer:rec.cubicBuffer,gpuCubicCount:rec.segmentCount,gpuMorphResource:rec,gpuMorphT:t,centerX:0,centerY:0,sectorSpanAngle:sectorDeg*Math.PI/180,sectorDegrees:sectorDeg,angularSpeed:speedDeg,maskRadius:1e9};
}

function gpuMorphArcLightningIneligibleReason(frameCtx,cfg,requireReady=true){
    if(!frameCtx||cfg?.enabled!==true||cfg?.effectType!=='lightning')return'not-lightning';
    const mode=['perSegment','everyNth','across','perPath','whole'].includes(cfg.lightningMode)?cfg.lightningMode:'perPath';
    if(mode==='across')return'across-needs-geometric-x-band';
    const behavior=normalizeLightningBehaviorValue(cfg.lightningBehavior,'inside');
    if(state.tunnel?.active===true&&behavior!=='symmetric')return'clipped-corridor-needs-per-copy-stencil';
    if(cfg.lightningShowLines!==false&&getLayerLineVisible(frameCtx.layer)===false)return'hidden-base-line-required';
    if(typeof gpuMorphArcIneligibleReason==='function'){const reason=gpuMorphArcIneligibleReason(frameCtx);if(reason)return reason;}
    if(requireReady){
        if(typeof WebGPULightningArcRenderer==='undefined'||!WebGPULightningArcRenderer.isReady?.())return'gpu-lightning-warming';
        if(typeof warmupGpuMorphArcResource!=='function'||!warmupGpuMorphArcResource())return'gpu-morph-arc-warming';
    }
    return'';
}
function canUseGpuMorphArcLightningFrame(frameCtx,cfg,requireReady=true){return gpuMorphArcLightningIneligibleReason(frameCtx,cfg,requireReady)==='';}
function prepareGpuMorphArcLightningFrame(frameCtx,cfg){
    if(typeof somataGpuBackendAllowed==='function'&&!somataGpuBackendAllowed())return null;
    lightningGpuArcBridgeStats.requests++;
    try{WebGPULightningArcRenderer?.warmup?.();warmupGpuMorphArcResource?.();}catch(_){}
    const reason=gpuMorphArcLightningIneligibleReason(frameCtx,cfg,true);if(reason){lightningGpuArcBridgeStats.fallbacks++;lightningGpuArcBridgeStats.lastReason=reason;return null;}
    const table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null;if(!table?.gpuArcResident){lightningGpuArcBridgeStats.fallbacks++;lightningGpuArcBridgeStats.lastReason=__spiroGpuMorphArcStatus?.().lastDecision?.reason||'gpu-arc-unavailable';return null;}
    const layer=frameCtx.layer,idx=frameCtx.layerIndex,now=frameCtx.now||performance.now(),mode=['perSegment','everyNth','perPath','whole'].includes(cfg.lightningMode)?cfg.lightningMode:'perPath';
    const modeCode=mode==='perSegment'?0:(mode==='everyNth'?1:(mode==='perPath'?2:3)),N=Math.max(2,Math.round(Number(layer?.N)||2)),K=Math.max(1,Math.round(Number(layer?.K)||1)),constructionSegments=Math.max(1,Math.round(N/Math.max(1,gcd(N,K))));

    const lightningPhase=getLightningMotionPhase(now,cfg,idx),cycle=Math.max(0,Math.round(Number(cfg.lightningCycleCount)||0));
    const frac=Math.max(.01,Math.min(1,audioApplyNumeric('lightning.segment',Number(cfg.lightningSegmentPercent)||100,idx)/100)),nth=Math.max(2,Math.min(24,Math.round(Number(cfg.lightningEveryN)||2)));
    const prepared={now,paths:null,layer,visible:null,pieces:null,exactRanges:null,strikePath:null,gpuArcResident:true,gpuMorphArcLightning:true,table,cfg,lightningSelection:{mode,modeCode,frac,nth,cycle,random:cfg.lightningRandomPosition===true,constructionSegments}};
    const lightningVector=prepareLightningVectorFrame(layer,lightningPhase,prepared,idx,cfg);if(!lightningVector){lightningGpuArcBridgeStats.fallbacks++;lightningGpuArcBridgeStats.lastReason='vector-style-unavailable';return null;}
    const data=frameCtx.sweepData||(frameCtx.sweepData={});data.cfg=cfg;data.layerIndex=idx;data.paths=null;data.now=now;data.phase=0;data.lightningPhase=lightningPhase;data.lightningVector=lightningVector;data.vectorPath=null;data.sweepW=0;data.glintVisual=null;data.canonicalGPU=false;data.gpuMorphArc=false;data.gpuMorphArcLightning=true;data.prepared=prepared;

    frameCtx.sweepPrepared=data;frameCtx.sweepPreparedReady=true;lightningGpuArcBridgeStats.hits++;lightningGpuArcBridgeStats.cpuPathBuildsAvoided++;lightningGpuArcBridgeStats.cpuExactRailBuildsAvoided++;lightningGpuArcBridgeStats.cpuPieceBuildsAvoided++;lightningGpuArcBridgeStats.lastReason=data.lightningSpectralPrepared?'gpu-retained-cubic-spectral-preflash':`gpu-arc-${mode}`;return data;
}
window.__spiroLightningGpuArcBridgeStatus=()=>({...lightningGpuArcBridgeStats,contract:'Topology-Morph Lightning selects arc windows on the authoritative retained cubic/Arc carrier before any CPU Morph path access. Exact precision evaluates six retained Bézier subsegments inside every Arc microsegment; simple precision keeps one lightweight chord. Strict Spiral remains GPU-only; unsupported cases use the prepared GPU path or are skipped with diagnostics.'});

function canUseGpuMorphArcForSweep(frameCtx,cfg){
    if(!frameCtx||cfg?.enabled!==true||cfg?.effectType==='lightning')return false;
    if(cfg?.mode==='across')return false;
    if(typeof gpuMorphArcIneligibleReason==='function'&&gpuMorphArcIneligibleReason(frameCtx))return false;
    const type=effectiveGlintType(cfg);
    if(type==='spectral'){WebGPUBezierSweepRenderer?.warmup?.();const rec=typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx.layerIndex):getSharedGpuMorphPathResource?.(frameCtx.layerIndex);return Boolean(rec?.bezierVisualRail&&WebGPUBezierSweepRenderer?.isReady?.());}
    return ['whole','perPath','perSegment','everyNth'].includes(cfg?.mode)&&Boolean(WebGPUCanonicalSweepRenderer?.canUse?.(cfg,state.tunnel?.active===true));
}
function prepareGpuMorphArcSweepFrame(frameCtx,cfg){
    if(typeof somataGpuBackendAllowed==='function'&&!somataGpuBackendAllowed())return null;
    sweepGpuArcBridgeStats.requests++;
    if(!canUseGpuMorphArcForSweep(frameCtx,cfg)){sweepGpuArcBridgeStats.fallbacks++;sweepGpuArcBridgeStats.lastReason='renderer-or-mode';return null;}
    const layer=frameCtx.layer,now=frameCtx.now||performance.now(),phase=getSweepMotionPhase(now,cfg),lenFrac=Math.max(.01,Math.min(1,audioApplyNumeric('sweep.length',Number(cfg?.lengthPercent)||3,frameCtx.layerIndex)/100));
    const baseW=Math.max(.5,Number(frameCtx.strokeWidth)||Math.max(.5,audioApplyNumeric('layer.strokeWidth',Number(layer?.strokeWidth)||1.5,frameCtx.layerIndex)*getLayerStrokeWidthMultiplier(layer))),raw=audioApplyNumeric('sweep.width',Number(cfg.widthPercent),frameCtx.layerIndex),widthPct=Number.isFinite(raw)?Math.max(0,Math.min(200,raw)):100;
    const data=frameCtx.sweepData||(frameCtx.sweepData={});data.cfg=cfg;data.layerIndex=frameCtx.layerIndex;data.paths=null;data.now=now;data.phase=phase;data.lightningPhase=0;data.lightningVector=null;data.vectorPath=null;data.canonicalGPU=false;data.gpuMorphArc=false;data.bezierGlintGPU=false;data.sweepW=baseW*widthPct/100;data.glintVisual=getGlintVisualSettings(cfg,frameCtx.layerIndex);
    const type=effectiveGlintType(cfg);
    if(type==='spectral'){
        const prepared=prepareSharedTopologySpectralBezier(frameCtx,cfg,now,false,phase);if(!prepared){sweepGpuArcBridgeStats.fallbacks++;sweepGpuArcBridgeStats.lastReason='spectral-cubic-unavailable';return null;}
        data.prepared=prepared;data.bezierGlintGPU=true;sweepGpuArcBridgeStats.lastReason='gpu-retained-cubic-spectral';
    }else{
        const table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null;if(!table?.gpuArcResident){sweepGpuArcBridgeStats.fallbacks++;sweepGpuArcBridgeStats.lastReason=__spiroGpuMorphArcStatus?.().lastDecision?.reason||'gpu-arc-unavailable';return null;}
        data.canonicalGPU=true;data.gpuMorphArc=true;data.prepared={now,paths:null,layer,visible:null,table,canonicalGPU:true,gpuMorphArc:true,mode:cfg.mode,phase,layerIndex:frameCtx.layerIndex,lenFrac};sweepGpuArcBridgeStats.lastReason=`gpu-bezier-arc-${cfg.mode}`;
    }
    frameCtx.sweepPrepared=data;frameCtx.sweepPreparedReady=true;sweepGpuArcBridgeStats.hits++;sweepGpuArcBridgeStats.cpuPathBuildsAvoided++;return data;
}

window.__spiroSweepGpuArcBridgeStatus=()=>({...sweepGpuArcBridgeStats,contract:'Topology-Morph Glint consumes the shared retained cubic rail: Spectral reads cubics directly; whole/perPath/perSegment/everyNth use a small GPU arc micro-rail derived from those same cubics. Across remains geometric fallback.'});


const somataSweepPhase=()=>somataEffectPhase('sweep'),somataSweepCorePhase=()=>somataEffectPhase('sweep',1);
function sweepProfileMode(cfg){const value=cfg?.effectType==='lightning'?cfg?.lightningProfileShape:cfg?.profileShape;return value==='line'?'line':'current';}
function reportSweepGpuIssue(frameCtx,stage,reason,extra=null){
    try{renderBackendTelemetry.mark('sweep','gpu',`GPU pass skipped: ${stage}`);}catch(_){}
    if(typeof somataGpuDiagnosticError==='function')somataGpuDiagnosticError('sweep',stage,reason,frameCtx,{fallback:'skip-sweep-pass',recovered:true,...(extra||{})});
    else console.error('[Somata 7.5 GPU][sweep]',stage,reason,{frameId:frameCtx?.frameId,layerIndex:frameCtx?.layerIndex,...(extra||{})});
    try{requestMainCanvasRender?.();}catch(_){}
}
function renderLayerSweepInstance(frameCtx,effectOverride=null){
    const effect=effectOverride||frameCtx.effectsPlan?.sweep;
    if(!effect?.enabled)return;
    const {layer,baseAlpha,visibleInstances}=frameCtx,cfg=effect.frameData?.cfg;
    if(!cfg)return reportSweepGpuIssue(frameCtx,'missing-config','Sweep is enabled but its live configuration is unavailable');
    if(cfg.effectType==='lightning'&&effect.frameData?.lightningVector?.stage==='idle')return;
    if(typeof somataGpuBackendAllowed==='function'&&!somataGpuBackendAllowed())return reportSweepGpuIssue(frameCtx,'backend-unavailable','GPU backend is unavailable');

    const useCurrentProfile=sweepProfileMode(cfg)==='current';
    if(useCurrentProfile&&SomataProfileSweepAdapter.isCurrentCarrier(frameCtx)){
        frameCtx._profileSweepAttempted=false;
        if(SomataProfileSweepAdapter.renderCurrent(frameCtx,effect,baseAlpha,visibleInstances))return;
        if(frameCtx._profileSweepAttempted===true)return reportSweepGpuIssue(frameCtx,'profile-carrier-encode','Current-profile Sweep could not encode the active line-profile carrier; thin-line substitution is intentionally blocked',{effectType:cfg.effectType,profileShape:'current'});
    }

    if(SomataProfileSweepAdapter.hasActiveOverlay(frameCtx)){
        if(SomataProfileSweepAdapter.renderOnActiveOverlay(frameCtx,effect,baseAlpha,visibleInstances))return;
        return reportSweepGpuIssue(frameCtx,'profile-overlay-join','Sweep could not join the active line-profile GPU overlay',{effectType:cfg.effectType,profileShape:sweepProfileMode(cfg)});
    }

    let scene=SomataLayerSceneService.ensure(frameCtx,'sweep-effect');
    if(!scene?.texture)return reportSweepGpuIssue(frameCtx,'layer-scene-not-ready','GPU Layer Scene is not ready; Sweep is skipped for this frame and will retry on the next repaint',{effectType:cfg.effectType,fallback:'transparent-gpu-layer-scene-retry'});

    if(effect.frameData?.gpuMorphArcLightning===true){
        const behavior=normalizeLightningBehaviorValue(cfg.lightningBehavior,'inside');
        mainCtx.save();let rec=null;try{
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            rec=effect.tunnelActive
                ? WebGPULightningArcRenderer.encodeCorridorToLayerScene(scene.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,behavior)
                : WebGPULightningArcRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,(baseAlpha)*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),behavior,frameCtx);
        }finally{mainCtx.restore();}
        if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu','shared GPU-arc exact lightning');if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataSweepPhase(),rec.commandBuffer,`lightning-arc-${behavior}`,rec.onSubmitted);return;}
        const rendererReason=String(rec?.reason||WebGPULightningArcRenderer?.peekStatus?.()?.lastError||'unknown Lightning renderer failure');
        return reportSweepGpuIssue(frameCtx,'lightning-arc-encode',`Exact GPU Arc Lightning encode failed: ${rendererReason}`,{behavior,rendererReason,lightning:WebGPULightningArcRenderer?.peekStatus?.()||null});
    }


    if(cfg.effectType==='lightning'){
        if(!SweepGPURenderer.canEncodeToLayerScene?.())return reportSweepGpuIssue(frameCtx,'lightning-renderer-not-ready','GPU Lightning renderer is not ready');
        const behavior=normalizeLightningBehaviorValue(cfg.lightningBehavior,'inside'),stage=effect.frameData?.lightningVector?.stage||'',joinMode='max';
        if(behavior==='symmetric'){
            const dynamic=frameCtx.geometryPlan?.dynamic===true;
            if(!SweepGPURenderer.beginBatch(joinMode,dynamic?null:frameCtx.layer,dynamic))return reportSweepGpuIssue(frameCtx,'lightning-batch-begin','GPU Lightning batch could not start');
            let healthy=true;
            for(let si=0;si<visibleInstances.copies.length;si++){
                const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;
                mainCtx.save();try{if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);if(!queueMovingSweepGlowWebGL(mainCtx,effect.paths,layer,baseAlpha*a,effect.now,effect.frameData))healthy=false;}finally{mainCtx.restore();}
                if(!healthy)break;
            }
            if(healthy){const rec=SweepGPURenderer.encodeToLayerScene(scene.texture,null,'symmetric',frameCtx.frameId,cfg);if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu','deferred GPU lightning');if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataSweepPhase(),rec.commandBuffer,'lightning');return;}}
            SweepGPURenderer.clear();return reportSweepGpuIssue(frameCtx,'lightning-encode','GPU Lightning encode failed',{behavior});
        }
        const pending=[],clipPaths=effect.frameData?.prepared?.visible||effect.frameData?.visible||effect.paths||[];let healthy=true;
        for(let si=0;si<visibleInstances.copies.length;si++){
            const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;
            mainCtx.save();try{
                if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
                const dynamic=frameCtx.geometryPlan?.dynamic===true,clipKey=dynamic?null:getLightningSceneStencilCacheKey(frameCtx.layer,copy,effect.tunnelActive);
                if(!SweepGPURenderer.beginBatch(joinMode,clipKey,dynamic)||!queueMovingSweepGlowWebGL(mainCtx,effect.paths,layer,baseAlpha*a,effect.now,effect.frameData)){healthy=false;break;}
                const clip=buildLightningSceneStencilGeometry(clipPaths,mainCtx.getTransform(),clipKey,dynamic),rec=SweepGPURenderer.encodeToLayerScene(scene.texture,clip,behavior,frameCtx.frameId,cfg);if(!rec?.handled){healthy=false;break;}if(rec.commandBuffer)pending.push(rec.commandBuffer);
            }finally{mainCtx.restore();}
        }
        if(healthy){for(let i=0;i<pending.length;i++)SomataLayerSceneService.queue(frameCtx,somataSweepPhase(),pending[i],`lightning-${behavior}`);renderBackendTelemetry.mark('sweep','gpu','deferred clipped GPU lightning');return;}
        SweepGPURenderer.clear();return reportSweepGpuIssue(frameCtx,'lightning-clipped-encode','Clipped GPU Lightning encode failed',{behavior});
    }

    if(effect.frameData?.bezierGlintGPU===true){
        mainCtx.save();let rec=null;try{
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            rec=effect.tunnelActive
                ? WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,1,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
                : WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer);
        }finally{mainCtx.restore();}
        if(rec?.handled){const label=effect.frameData.prepared?.spectral===true?'spectral-bezier-glint':(effect.frameData.prepared?.glintType==='chaotic'?'chaotic-bezier-glint':'precise-bezier-glint');renderBackendTelemetry.mark('sweep','gpu',label);if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataSweepPhase(),rec.commandBuffer,label,rec.onSubmitted);else rec.onSubmitted?.();return;}
        return reportSweepGpuIssue(frameCtx,'bezier-glint-encode','Bézier Glint GPU encode failed',{profileShape:sweepProfileMode(cfg)});
    }

    if(effect.frameData?.canonicalGPU===true){
        mainCtx.save();let rec=null;try{
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            rec=effect.tunnelActive
                ? WebGPUCanonicalSweepRenderer.encodeCorridorToLayerScene(scene.texture,effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,1,effect.frameData.prepared?.lenFrac,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
                : WebGPUCanonicalSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),effect.frameData.prepared?.lenFrac,frameCtx.layer,frameCtx);
        }finally{mainCtx.restore();}
        if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.gpuMorphArc===true?'deferred shared GPU-arc glint':'deferred canonical glint');if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataSweepPhase(),rec.commandBuffer,'sweep',rec.onSubmitted);else rec.onSubmitted?.();return;}
        return reportSweepGpuIssue(frameCtx,'canonical-glint-encode','Canonical Glint GPU encode failed',{profileShape:sweepProfileMode(cfg)});
    }

    return reportSweepGpuIssue(frameCtx,'unsupported-frame-data','Sweep has no GPU-resident frame representation',{effectType:cfg.effectType});
}


function renderLayerSweepPass(frameCtx){
    const effect=frameCtx?.effectsPlan?.sweep;if(!effect?.enabled)return;
    const list=Array.isArray(effect.instances)&&effect.instances.length?effect.instances:[effect];
    let lastResult;
    for(const item of list){
        if(!item?.enabled)continue;
        try{frameCtx._profileSweepAttempted=false;lastResult=renderLayerSweepInstance(frameCtx,item);}
        catch(error){
            try{somataGpuDiagnosticError(item?.cfg?.effectType==='lightning'?'lightning':'sweep','subeffect-render-failure',String(error?.message||error),frameCtx,{fallback:'skip-only-failed-subeffect',recovered:true,effectType:item?.cfg?.effectType||'sweep'});}catch(_){}
            try{requestMainCanvasRender?.();}catch(_){}
        }
    }
    return lastResult;
}
function sweepInstanceSceneAdmission(effect){
    if(!effect?.enabled)return{admit:false,reason:'disabled'};const cfg=effect.frameData?.cfg;
    if(cfg?.effectType==='lightning'){
        return{admit:effect.frameData?.gpuMorphArcLightning===true?Boolean(typeof WebGPULightningArcRenderer!=='undefined'&&WebGPULightningArcRenderer.isReady?.()):SweepGPURenderer.canEncodeToLayerScene(),reason:'Lightning Layer Scene renderer unavailable'};
    }
    if(effect.frameData?.bezierGlintGPU===true)return{admit:Boolean(typeof WebGPUBezierSweepRenderer!=='undefined'&&WebGPUBezierSweepRenderer.isReady?.()),reason:'Bezier Glint renderer unavailable'};
    return{admit:effect.frameData?.canonicalGPU===true&&WebGPUCanonicalSweepRenderer.canUse(cfg,effect.tunnelActive===true),reason:'canonical Sweep renderer unavailable'};
}

SomataFeatureHost.provide('sweep','sceneAdmission',(frameCtx)=>{
    const effect=frameCtx?.effectsPlan?.sweep;if(!effect?.enabled)return true;const list=Array.isArray(effect.instances)&&effect.instances.length?effect.instances:[effect],checks=list.map(sweepInstanceSceneAdmission);
    if(checks.some(x=>x?.admit===true))return true;
    return checks.find(x=>x&&x.admit===false)||{admit:false,reason:'Sweep/Lightning Layer Scene renderer unavailable'};
});

window.SomataRenderPassRegistry?.register?.('sweep',{stage:window.SomataRenderPassRegistry.STAGES.POST_BASE,order:50,run:renderLayerSweepPass});
