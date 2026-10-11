// SpiroStar v512 — Sweep / Glint render pass and GPU Morph Arc bridge
// Owns Sweep rendering orchestration independently from the main frame pipeline.
window.__spiroRegisterModule?.('js/render/sweep-pass');

const sweepGpuArcBridgeStats={requests:0,hits:0,fallbacks:0,cpuPathBuildsAvoided:0,lastReason:'not-requested'};

const lightningGpuArcBridgeStats={requests:0,hits:0,fallbacks:0,cpuPathBuildsAvoided:0,cpuExactRailBuildsAvoided:0,cpuPieceBuildsAvoided:0,lastReason:'not-requested'};

function spiralSweepGpuStrict(frameCtx){if(typeof isStrictSpiralWebGPUFrame==='function')return isStrictSpiralWebGPUFrame(frameCtx);const spiral=l=>Boolean(l&&typeof isSpiralLayer==='function'&&isSpiralLayer(l));return Boolean(state?.fourierMode!==true&&(spiral(frameCtx?.layer)||spiral(frameCtx?.geometryPlan?.sourceLayer)||spiral(frameCtx?.geometryPlan?.targetLayer)));}


function prepareSharedTopologySpectralBezier(frameCtx,cfg,now,lightning=false,cycleProgress=0){
    const rec=typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx?.layerIndex):(typeof getSharedGpuMorphPathResource==='function'?getSharedGpuMorphPathResource(frameCtx?.layerIndex):null);
    if(!rec?.ready||!rec?.bezierVisualRail||!rec?.cubicBuffer||!(rec.segmentCount>0))return null;
    const rawT=frameCtx?.blueMorphProvider?.geometryT??frameCtx?.geometryPlan?.progress,t=typeof rec.resolveMorphT==='function'?rec.resolveMorphT(rawT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(rawT):Math.max(0,Math.min(1,Number(rawT)||0)));
    const prefix=lightning?'lightning':'sweep',sectorBase=Number.isFinite(Number(cfg?.spectralSectorDegrees))?Number(cfg.spectralSectorDegrees):45,speedBase=Number.isFinite(Number(cfg?.spectralAngularSpeed))?Number(cfg.spectralAngularSpeed):90;
    const sectorDeg=Math.max(1,Math.min(360,audioApplyNumeric(`${prefix}.spectralSector`,sectorBase,frameCtx.layerIndex))),speedDeg=Math.max(-720,Math.min(720,audioApplyNumeric(`${prefix}.spectralSpeed`,speedBase,frameCtx.layerIndex)));
    // Spectral is cycle-locked: exactly one non-wrapping lap per Glint/Lightning preflash.
    // The old absolute-time angular clock could finish only part of a lap during precharge and
    // wrapped the sector through the seam, lighting already-visited geometry again.
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
    lightningGpuArcBridgeStats.requests++;
    try{WebGPULightningArcRenderer?.warmup?.();warmupGpuMorphArcResource?.();}catch(_){}
    const reason=gpuMorphArcLightningIneligibleReason(frameCtx,cfg,true);if(reason){lightningGpuArcBridgeStats.fallbacks++;lightningGpuArcBridgeStats.lastReason=reason;return null;}
    const table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null;if(!table?.gpuArcResident){lightningGpuArcBridgeStats.fallbacks++;lightningGpuArcBridgeStats.lastReason=__spiroGpuMorphArcStatus?.().lastDecision?.reason||'gpu-arc-unavailable';return null;}
    const layer=frameCtx.layer,idx=frameCtx.layerIndex,now=frameCtx.now||performance.now(),mode=['perSegment','everyNth','perPath','whole'].includes(cfg.lightningMode)?cfg.lightningMode:'perPath';
    const modeCode=mode==='perSegment'?0:(mode==='everyNth'?1:(mode==='perPath'?2:3)),N=Math.max(2,Math.round(Number(layer?.N)||2)),K=Math.max(1,Math.round(Number(layer?.K)||1)),constructionSegments=Math.max(1,Math.round(N/Math.max(1,gcd(N,K))));
    // Advance the Lightning clock BEFORE freezing cycle-dependent random placement. The legacy
    // exact path does the same, so a wrap frame cannot use the previous cycle's random offset.
    const lightningPhase=getLightningMotionPhase(now,cfg,idx),cycle=Math.max(0,Math.round(Number(cfg.lightningCycleCount)||0));
    const frac=Math.max(.01,Math.min(1,audioApplyNumeric('lightning.segment',Number(cfg.lightningSegmentPercent)||100,idx)/100)),nth=Math.max(2,Math.min(24,Math.round(Number(cfg.lightningEveryN)||2)));
    const prepared={now,paths:null,layer,visible:null,pieces:null,exactRanges:null,strikePath:null,gpuArcResident:true,gpuMorphArcLightning:true,table,cfg,lightningSelection:{mode,modeCode,frac,nth,cycle,random:cfg.lightningRandomPosition===true,constructionSegments}};
    const lightningVector=prepareLightningVectorFrame(layer,lightningPhase,prepared,idx,cfg);if(!lightningVector){lightningGpuArcBridgeStats.fallbacks++;lightningGpuArcBridgeStats.lastReason='vector-style-unavailable';return null;}
    const data=frameCtx.sweepData||(frameCtx.sweepData={});data.cfg=cfg;data.layerIndex=idx;data.paths=null;data.now=now;data.phase=0;data.lightningPhase=lightningPhase;data.lightningVector=lightningVector;data.vectorPath=null;data.sweepW=0;data.glintVisual=null;data.canonicalGPU=false;data.gpuMorphArc=false;data.gpuMorphArcLightning=true;data.prepared=prepared;data.lightningSpectralPrepared=null;data.lightningSpectralCfg=null;data.lightningSpectralVisual=null;data.lightningSpectralW=0;
    if(lightningVector.stage==='precharge'&&normalizeSweepFlashMode(cfg.flashMode)==='spectral'){
        WebGPUBezierSweepRenderer?.warmup?.();if(!WebGPUBezierSweepRenderer?.isReady?.()){lightningGpuArcBridgeStats.fallbacks++;lightningGpuArcBridgeStats.lastReason='spectral-bezier-warming';return null;}
        const spectralPrepared=prepareSharedTopologySpectralBezier(frameCtx,cfg,now,true,lightningVector.prechargeT);
        if(spectralPrepared){const spectralCfg={...cfg,effectType:'glint',flashType:'spectral',glintPrecision:'spectral',_lightningPreflashBlend:false,_lightningPreflashCoreOnTop:true,color:cfg.color||'#ffffff'};data.lightningSpectralPrepared=spectralPrepared;data.lightningSpectralCfg=spectralCfg;data.lightningSpectralW=lightningVector.prechargeWidth;data.lightningSpectralVisual={glowSize:lightningVector.prechargeGlow,strength:lightningVector.prechargeGlowIntensity,brightness:lightningVector.prechargeBrightness,softness:lightningVector.prechargeSoftness,opacity:lightningVector.flashOpacity};data.gpuMorphArcLightning=false;}
    }
    frameCtx.sweepPrepared=data;frameCtx.sweepPreparedReady=true;lightningGpuArcBridgeStats.hits++;lightningGpuArcBridgeStats.cpuPathBuildsAvoided++;lightningGpuArcBridgeStats.cpuExactRailBuildsAvoided++;lightningGpuArcBridgeStats.cpuPieceBuildsAvoided++;lightningGpuArcBridgeStats.lastReason=data.lightningSpectralPrepared?'gpu-retained-cubic-spectral-preflash':`gpu-arc-${mode}`;return data;
}
window.__spiroLightningGpuArcBridgeStatus=()=>({...lightningGpuArcBridgeStats,contract:'Topology-Morph Lightning perSegment/everyNth/perPath/whole selects arc windows on the resident GPU contour before any CPU Morph path access; exact/simple precision share the same carrier geometry. Across, hidden-base carrier and clipped Corridor retain lazy fallback.'});

function canUseGpuMorphArcForSweep(frameCtx,cfg){
    if(!frameCtx||cfg?.enabled!==true||cfg?.effectType==='lightning')return false;
    if(cfg?.mode==='across')return false;
    if(typeof gpuMorphArcIneligibleReason==='function'&&gpuMorphArcIneligibleReason(frameCtx))return false;
    const type=effectiveGlintType(cfg);
    if(type==='spectral'){WebGPUBezierSweepRenderer?.warmup?.();const rec=typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx.layerIndex):getSharedGpuMorphPathResource?.(frameCtx.layerIndex);return Boolean(rec?.bezierVisualRail&&WebGPUBezierSweepRenderer?.isReady?.());}
    return ['whole','perPath','perSegment','everyNth'].includes(cfg?.mode)&&Boolean(WebGPUCanonicalSweepRenderer?.canUse?.(cfg,state.tunnel?.active===true));
}
function prepareGpuMorphArcSweepFrame(frameCtx,cfg){
    sweepGpuArcBridgeStats.requests++;
    if(!canUseGpuMorphArcForSweep(frameCtx,cfg)){sweepGpuArcBridgeStats.fallbacks++;sweepGpuArcBridgeStats.lastReason='renderer-or-mode';return null;}
    const layer=frameCtx.layer,now=frameCtx.now||performance.now(),phase=getSweepMotionPhase(now,cfg),lenFrac=Math.max(.01,Math.min(1,audioApplyNumeric('sweep.length',Number(cfg?.lengthPercent)||18,frameCtx.layerIndex)/100));
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

function materializeSweepCpuFallback(frameCtx,effect,reason='gpu-sweep-fallback'){
    if(!effect)return null;
    const cfg=effect.cfg||effect.frameData?.cfg||getLayerSweepConfig(frameCtx.layer);
    const paths=getLayerFrameAuxiliaryPaths(frameCtx);effect.paths=paths;
    frameCtx.sweepPreparedReady=false;frameCtx.sweepPrepared=null;
    const data=prepareLayerFrameSweepData(frameCtx);effect.frameData=data;
    sweepGpuArcBridgeStats.fallbacks++;sweepGpuArcBridgeStats.lastReason=String(reason||'gpu-sweep-fallback');
    return data;
}

function isLightningSpectralPreflash(effect){const cfg=effect?.frameData?.cfg||effect?.cfg;return cfg?.effectType==='lightning'&&effect.frameData?.lightningVector?.stage==='precharge'&&Boolean(effect.frameData?.lightningSpectralPrepared);}
function lightningSpectralPreflashAlpha(effect,_baseAlpha){return Math.max(0,Math.min(1,Number(effect?.frameData?.lightningVector?.prechargeAlpha)||0));}

// Glint is a post-profile effect.  When the carrier is Graffiti its core and halo must use
// the exact same calligraphic ribbon (nib shape, marker angle, joins and authored variations),
// not a round capsule around the centreline.  Phases 40/41 are intentionally after Graffiti
// contour Glow/core (19/20).
const GRAFFITI_SWEEP_GLOW_PHASE=40,GRAFFITI_SWEEP_CORE_PHASE=41;
function isGraffitiSweepCarrier(frameCtx){return (frameCtx?.lineProfileApplication||frameCtx?.layer?.lineProfileApplication)==='graffiti';}
function sweepCubicPoint(a,b,c,d,t){const q=1-t,q2=q*q,t2=t*t;return{x:q2*q*a.x+3*q2*t*b.x+3*q*t2*c.x+t2*t*d.x,y:q2*q*a.y+3*q2*t*b.y+3*q*t2*c.y+t2*t*d.y};}
function sweepSpectralRelAngle(x,y,prepared){const tau=Math.PI*2,cx=Number(prepared?.centerX)||0,cy=Number(prepared?.centerY)||0,start=Number.isFinite(Number(prepared?.spectralStartAngle))?Number(prepared.spectralStartAngle):0,a=Math.atan2(y-cy,x-cx),dir=Number(prepared?.spectralDirection)<0?-1:1,raw=dir>0?a-start:start-a;return raw-Math.floor(raw/tau)*tau;}
function sampleGraffitiSweepBezierPieces(prepared){
    const data=prepared?.cubicData,count=Math.max(0,Math.min(Number(prepared?.cubicCount)||0,data?Math.floor(data.length/8):0));if(!data||!count)return null;
    const breaks=prepared?.cubicBreaks,out=[];let current=null;const spectral=prepared?.spectral===true,tau=Math.PI*2,progress=Math.max(0,Math.min(1,Number(prepared?.spectralProgress)||0)),head=progress*tau,span=Math.max(.000001,Math.min(tau,Number(prepared?.sectorSpanAngle)||Math.PI/4)),tail=Math.max(0,head-span);
    if(spectral&&head<=.000001)return [];
    let fallbackStart=null;if(spectral&&!Number.isFinite(Number(prepared?.spectralStartAngle))){fallbackStart=Math.atan2((data[1]||0)-(Number(prepared?.centerY)||0),(data[0]||0)-(Number(prepared?.centerX)||0));}
    const spectralPrepared=fallbackStart==null?prepared:{...prepared,spectralStartAngle:fallbackStart};
    const append=(p,forceBreak=false)=>{if(forceBreak||!current){current=[];out.push(current);}const last=current[current.length-1];if(!last||Math.hypot((p.x||0)-(last.x||0),(p.y||0)-(last.y||0))>1e-5)current.push(p);};
    for(let ci=0;ci<count;ci++){
        const o=ci*8,a={x:data[o],y:data[o+1]},b={x:data[o+2],y:data[o+3]},c={x:data[o+4],y:data[o+5]},d={x:data[o+6],y:data[o+7]},breakBefore=ci===0||breaks?.[ci]===1;
        if(breakBefore)current=null;
        const subdiv=18;let last=sweepCubicPoint(a,b,c,d,0),run=false;
        for(let j=1;j<=subdiv;j++){
            const p1=sweepCubicPoint(a,b,c,d,j/subdiv);let visible=true;
            if(spectral){const mid={x:(last.x+p1.x)*.5,y:(last.y+p1.y)*.5},rel=sweepSpectralRelAngle(mid.x,mid.y,spectralPrepared);visible=rel+.00001>=tail&&rel<=head+.00001;}
            if(visible){append(last,!run&&(!current||breakBefore));append(p1,false);run=true;}else{run=false;current=null;}
            last=p1;
        }
    }
    return out.filter(p=>p?.length>1);
}
function makeGraffitiSweepPrepared(pieces){
    const valid=(pieces||[]).filter(p=>Array.isArray(p)&&p.length>1);if(!valid.length)return null;
    return{gpuRibbonEligible:true,graffitiPlan:valid.map((points,i)=>({vary:true,path:{points,closed:false,_sweepTransient:true},meta:null,chain:`sweep-${i}`,bridgeFromPrevious:false,bridgeToNext:false}))};
}
function graffitiSweepPieces(frameCtx,effect){
    const data=effect?.frameData,cfg=data?.cfg||effect?.cfg;if(!data||!cfg)return null;
    if(cfg.effectType==='lightning'){
        if(data.lightningVector?.stage!=='precharge')return null;
        if(data.lightningSpectralPrepared)return sampleGraffitiSweepBezierPieces(data.lightningSpectralPrepared);
        return data.lightningVector?.prechargePieces||null;
    }
    if(data.prepared?.pieces?.length)return data.prepared.pieces;
    if(data.prepared?.cubicData)return sampleGraffitiSweepBezierPieces(data.prepared);
    // Canonical GPU Glint deliberately has no CPU pieces.  For non-strict geometry build the
    // small moving window lazily only when Graffiti needs a calligraphic ribbon; rasterization
    // remains WebGPU and no Canvas presentation path is introduced.
    if(data.canonicalGPU===true&&!spiralSweepGpuStrict(frameCtx)&&typeof getPreparedSweepFrame==='function'){
        const sampled=getPreparedSweepFrame(effect.paths,frameCtx.layer,data.phase,effect.now,cfg,frameCtx.layerIndex);return sampled?.pieces||null;
    }
    return null;
}
function graffitiSweepVisual(effect,baseAlpha){
    const data=effect.frameData,cfg=data.cfg,lightning=cfg.effectType==='lightning',f=lightning?data.lightningVector:null,v=lightning?{glowSize:f?.prechargeGlow,strength:f?.prechargeGlowIntensity,brightness:f?.prechargeBrightness,softness:f?.prechargeSoftness,opacity:f?.flashOpacity}:data.glintVisual;
    const alpha=lightning?Math.max(0,Math.min(1,Number(f?.prechargeAlpha)||0)):Math.max(0,Math.min(1,Number(baseAlpha)||0));
    return{width:lightning?Math.max(.15,Number(f?.prechargeWidth)||.15):Math.max(.15,Number(data.sweepW)||.15),color:String(lightning?(f?.flash||cfg.color||'#ffffff'):(cfg.color||'#ffffff')),coreAlpha:alpha*Math.max(0,Math.min(1,Number.isFinite(Number(v?.opacity))?Number(v.opacity):1)),glowAlpha:Math.max(0,Math.min(1,alpha*.22*Math.max(0,Number(v?.strength)||0)*Math.max(0,Number(v?.brightness)||0))),glowSize:Math.max(0,Number(v?.glowSize)||0),softness:Math.max(0,Math.min(1.5,Number(v?.softness)||0))};
}
function renderGraffitiProfileSweep(frameCtx,effect,baseAlpha,visibleInstances){
    if(!isGraffitiSweepCarrier(frameCtx)||typeof WebGPUGraffitiRibbonRenderer==='undefined')return false;
    const pieces=graffitiSweepPieces(frameCtx,effect),prepared=makeGraffitiSweepPrepared(pieces);if(!prepared)return false;frameCtx._graffitiSweepProfileAttempted=true;
    const vis=graffitiSweepVisual(effect,baseAlpha);if(vis.coreAlpha<=.001&&vis.glowAlpha<=.001)return true;
    const layer=frameCtx.layer,overlay=WebGPUGraffitiRibbonRenderer.getActiveOverlayTarget?.(frameCtx.frameId),scene=frameCtx.frame?.gpuLayerSceneDeferred?WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId):null,useOverlay=Boolean(overlay?.texture),target=useOverlay?overlay.texture:scene?.texture;
    mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);try{
        if(useOverlay){
            let ok=true;
            if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorGlowToOverlay(prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.drawGlowToOverlay(prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});ok=ok&&Boolean(g?.handled);}
            const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorToOverlay(prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.drawToOverlay(prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});ok=ok&&Boolean(c?.handled);
            if(ok){renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.cfg?.effectType==='lightning'?'Graffiti-profile lightning preflash overlay':'Graffiti-profile Glint overlay');return true;}return false;
        }
        if(target){
            if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.encodeCorridorGlowToLayerScene(target,prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.encodeGlowToLayerScene(target,prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});if(!g?.handled)return false;if(g.commandBuffer)queueLayerSceneEffectCommand(frameCtx,GRAFFITI_SWEEP_GLOW_PHASE,g.commandBuffer,'graffiti-profile-glint-glow',g.onSubmitted);else g.onSubmitted?.();}
            const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.encodeCorridorToLayerScene(target,prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.encodeToLayerScene(target,prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});if(!c?.handled)return false;if(c.commandBuffer)queueLayerSceneEffectCommand(frameCtx,GRAFFITI_SWEEP_CORE_PHASE,c.commandBuffer,'graffiti-profile-glint-core',c.onSubmitted);else c.onSubmitted?.();renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.cfg?.effectType==='lightning'?'Graffiti-profile lightning preflash':'Graffiti-profile Glint');return true;
        }
        // No Layer Scene: use the transparent WebGPU overlay as a GPU-only presentation target.
        let ok=true;if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorGlowToOverlay(prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.drawGlowToOverlay(prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});ok=ok&&Boolean(g?.handled);}const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorToOverlay(prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.drawToOverlay(prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});ok=ok&&Boolean(c?.handled);if(ok){renderBackendTelemetry.mark('sweep','gpu','Graffiti-profile Glint GPU overlay');return true;}
    }finally{mainCtx.restore();}
    return false;
}
function renderSweepOnActiveGraffitiOverlay(frameCtx,effect,baseAlpha,visibleInstances){
    const overlay=WebGPUGraffitiRibbonRenderer?.getActiveOverlayTarget?.(frameCtx.frameId);if(!overlay?.texture)return false;const cfg=effect.frameData?.cfg;if(!cfg)return false;let rec=null;
    const encodeLayer=(fn)=>{mainCtx.save();try{applyLayerFrameEffectTransform(mainCtx,frameCtx);return fn();}finally{mainCtx.restore();}};
    if(effect.frameData?.gpuMorphArcLightning===true){
        const behavior=normalizeLightningBehaviorValue(cfg.lightningBehavior,'inside');rec=encodeLayer(()=>effect.tunnelActive?WebGPULightningArcRenderer.encodeCorridorToLayerScene(overlay.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,effect.frameData?.lightningVector?.stage==='precharge'?1:baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,behavior):WebGPULightningArcRenderer.encodeToLayerScene(overlay.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,(effect.frameData?.lightningVector?.stage==='precharge'?1:baseAlpha)*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),behavior,frameCtx));
    }else if(isLightningSpectralPreflash(effect)){
        const alpha=lightningSpectralPreflashAlpha(effect,baseAlpha);rec=encodeLayer(()=>effect.tunnelActive?WebGPUBezierSweepRenderer.encodeToLayerScene(overlay.texture,effect.frameData.lightningSpectralPrepared,mainCtx,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer):WebGPUBezierSweepRenderer.encodeToLayerScene(overlay.texture,effect.frameData.lightningSpectralPrepared,mainCtx,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer));
    }else if(cfg.effectType==='lightning'&&SweepGPURenderer.canEncodeToLayerScene?.()){
        const behavior=normalizeLightningBehaviorValue(cfg.lightningBehavior,'inside'),stage=effect.frameData?.lightningVector?.stage||'',joinMode='max';
        if(behavior==='symmetric'){
            const dynamicLightning=frameCtx.geometryPlan?.dynamic===true;if(SweepGPURenderer.beginBatch(joinMode,dynamicLightning?null:frameCtx.layer,dynamicLightning)){let healthy=true;
                for(let si=0;si<visibleInstances.copies.length;si++){const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;mainCtx.save();try{if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);if(!queueMovingSweepGlowWebGL(mainCtx,effect.paths,frameCtx.layer,(stage==='precharge'?1:baseAlpha)*a,effect.now,effect.frameData))healthy=false;}finally{mainCtx.restore();}if(!healthy)break;}
                if(healthy)rec=SweepGPURenderer.encodeToLayerScene(overlay.texture,null,'symmetric',frameCtx.frameId,cfg,stage==='precharge');if(!rec?.handled)SweepGPURenderer.clear();
            }
        }else{
            const records=[];let healthy=true,clipPaths=effect.frameData?.prepared?.visible||effect.frameData?.visible||effect.paths||[];
            for(let si=0;si<visibleInstances.copies.length;si++){const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;mainCtx.save();try{if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);const dynamicClip=frameCtx.geometryPlan?.dynamic===true,clipKey=dynamicClip?null:getLightningSceneStencilCacheKey(frameCtx.layer,copy,effect.tunnelActive);if(!SweepGPURenderer.beginBatch(joinMode,clipKey,dynamicClip)||!queueMovingSweepGlowWebGL(mainCtx,effect.paths,frameCtx.layer,(stage==='precharge'?1:baseAlpha)*a,effect.now,effect.frameData)){healthy=false;break;}const clip=buildLightningSceneStencilGeometry(clipPaths,mainCtx.getTransform(),clipKey,dynamicClip),r=SweepGPURenderer.encodeToLayerScene(overlay.texture,clip,behavior,frameCtx.frameId,cfg,stage==='precharge');if(!r?.handled){healthy=false;break;}records.push(r);}finally{mainCtx.restore();}}
            if(healthy&&records.length){for(const r of records)if(!WebGPUGraffitiRibbonRenderer.submitOverlayEffect?.(r,`lightning-${behavior}`))return false;renderBackendTelemetry.mark('sweep','gpu','post-Graffiti clipped Lightning WebGPU overlay');return true;}SweepGPURenderer.clear();
        }
    }else if(effect.frameData?.bezierGlintGPU===true&&cfg.effectType!=='lightning'){
        rec=encodeLayer(()=>effect.tunnelActive?WebGPUBezierSweepRenderer.encodeToLayerScene(overlay.texture,effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,1,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer):WebGPUBezierSweepRenderer.encodeToLayerScene(overlay.texture,effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer));
    }else if(effect.frameData?.canonicalGPU===true&&cfg.effectType!=='lightning'){
        rec=encodeLayer(()=>effect.tunnelActive?WebGPUCanonicalSweepRenderer.encodeCorridorToLayerScene(overlay.texture,effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,1,effect.frameData.prepared?.lenFrac,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer):WebGPUCanonicalSweepRenderer.encodeToLayerScene(overlay.texture,effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),effect.frameData.prepared?.lenFrac,frameCtx.layer,frameCtx));
    }
    if(rec?.handled&&WebGPUGraffitiRibbonRenderer.submitOverlayEffect?.(rec,cfg.effectType==='lightning'?'lightning':'glint')){renderBackendTelemetry.mark('sweep','gpu','post-Graffiti WebGPU overlay');return true;}return false;
}

function renderLayerSweepPass(frameCtx) {
    const effect=frameCtx.effectsPlan?.sweep;
    if(!effect?.enabled)return;
    const {layer,baseAlpha,visibleInstances}=frameCtx;
    const cfg=effect.frameData?.cfg;
    // Shared Glint/preflash adopts the exact Graffiti nib profile.  Do this before the generic
    // capsule/line renderers so Marker Angle and nib joins are identical to the carrier.
    if(isGraffitiSweepCarrier(frameCtx)&&(cfg?.effectType!=='lightning'||effect.frameData?.lightningVector?.stage==='precharge')){
        frameCtx._graffitiSweepProfileAttempted=false;if(renderGraffitiProfileSweep(frameCtx,effect,baseAlpha,visibleInstances))return;
        if(frameCtx._graffitiSweepProfileAttempted===true){console.error('[Somata GPU diagnostic] Exact Graffiti-profile Glint/Preflash encode failed; thin-line substitution blocked',{frameId:frameCtx.frameId,layerIndex:frameCtx.layerIndex,effectType:cfg?.effectType,stage:effect.frameData?.lightningVector?.stage||'glint',gpuOnly:true});return;}
        if(WebGPUGraffitiRibbonRenderer?.getActiveOverlayTarget?.(frameCtx.frameId)){console.error('[Somata GPU diagnostic] Graffiti-profile Glint could not be encoded on active GPU overlay',{frameId:frameCtx.frameId,layerIndex:frameCtx.layerIndex,effectType:cfg?.effectType,stage:effect.frameData?.lightningVector?.stage||'glint'});return;}
    }
    // If Graffiti itself is on the transparent WebGPU overlay, every later Lightning/Glint
    // effect must join that same physical target or it would appear underneath it.
    if(WebGPUGraffitiRibbonRenderer?.getActiveOverlayTarget?.(frameCtx.frameId)){if(renderSweepOnActiveGraffitiOverlay(frameCtx,effect,baseAlpha,visibleInstances))return;console.error('[Somata GPU diagnostic] Sweep could not join active Graffiti WebGPU overlay',{frameId:frameCtx.frameId,layerIndex:frameCtx.layerIndex,effectType:cfg?.effectType});return;}
    // v516: Exact topology-Morph Lightning can consume the resident exact GPU Arc directly.
    // The shader evaluates the active range and precharge window; CPU geometry stays asleep.
    if(effect.frameData?.gpuMorphArcLightning===true){
        if(frameCtx.frame?.gpuLayerSceneDeferred){
            const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId),behavior=normalizeLightningBehaviorValue(cfg?.lightningBehavior,'inside');let rec=null;
            if(scene?.texture){
                mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
                rec=effect.tunnelActive
                    ? WebGPULightningArcRenderer.encodeCorridorToLayerScene(scene.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,effect.frameData?.lightningVector?.stage==='precharge'?1:baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,behavior)
                    : WebGPULightningArcRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,(effect.frameData?.lightningVector?.stage==='precharge'?1:baseAlpha)*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),behavior,frameCtx);
                mainCtx.restore();
            }
            if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu','shared GPU-arc exact lightning');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,`lightning-arc-${behavior}`,rec.onSubmitted);return;}
        }
        // Spiral 6.8 is strict WebGPU/Bézier. Never materialize the Morph carrier on CPU
        // merely because the deferred Layer Scene was not available in this pass.
        if(spiralSweepGpuStrict(frameCtx)){renderBackendTelemetry.mark('sweep','gpu','Spiral Lightning GPU-only warmup');somataGpuContractError?.('SPIRAL_LIGHTNING_GPU_UNAVAILABLE',frameCtx,{stage:'arc'});return;}
        materializeSweepCpuFallback(frameCtx,effect,'gpu-lightning-arc-render-failed');
    }
    // v392: canonical Glint and every vector Lightning placement mode can remain entirely
    // inside the deferred Layer Scene. Symmetric uses direct additive composite; Inside/Outside
    // preserve MAX/OVER joins and exact even-odd clipping with a WebGPU parity stencil.
    if(frameCtx.frame?.gpuLayerSceneDeferred){
        const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId);
        if(isLightningSpectralPreflash(effect)&&scene?.texture){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const alpha=lightningSpectralPreflashAlpha(effect,baseAlpha),rec=effect.tunnelActive
                ? WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.lightningSpectralPrepared,mainCtx,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
                : WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.lightningSpectralPrepared,mainCtx,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer);
            mainCtx.restore();
            if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu','spectral Bézier lightning preflash');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,'lightning-spectral-preflash',rec.onSubmitted);else rec.onSubmitted?.();return;}
        }else if(cfg?.effectType==='lightning'&&scene?.texture&&SweepGPURenderer.canEncodeToLayerScene()){
            const lightningBehavior=normalizeLightningBehaviorValue(cfg.lightningBehavior,'inside'),lightningStage=effect.frameData?.lightningVector?.stage||'',joinMode='max';
            if(lightningBehavior==='symmetric'){
                const dynamicLightning=frameCtx.geometryPlan?.dynamic===true;
                if(SweepGPURenderer.beginBatch(joinMode,dynamicLightning?null:frameCtx.layer,dynamicLightning)){
                    let healthy=true;
                    for(let si=0;si<visibleInstances.copies.length;si++){
                        const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;
                        mainCtx.save();if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
                        if(!queueMovingSweepGlowWebGL(mainCtx,effect.paths,layer,(effect.frameData?.lightningVector?.stage==='precharge'?1:baseAlpha)*a,effect.now,effect.frameData))healthy=false;mainCtx.restore();if(!healthy)break;
                    }
                    if(healthy){const rec=SweepGPURenderer.encodeToLayerScene(scene.texture,null,'symmetric',frameCtx.frameId,cfg,lightningStage==='precharge');if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu','deferred GPU lightning');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,'lightning');return;}}
                    SweepGPURenderer.clear();
                }
            }else{
                const pending=lightningSceneStencilScratch.pending;pending.length=0;let healthy=true;const clipPaths=effect.frameData?.prepared?.visible||effect.frameData?.visible||effect.paths||[];
                for(let si=0;si<visibleInstances.copies.length;si++){
                    const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;
                    mainCtx.save();try{if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
                        const dynamicClip=frameCtx.geometryPlan?.dynamic===true,clipKey=dynamicClip?null:getLightningSceneStencilCacheKey(frameCtx.layer,copy,effect.tunnelActive);
                        if(!SweepGPURenderer.beginBatch(joinMode,clipKey,dynamicClip)||!queueMovingSweepGlowWebGL(mainCtx,effect.paths,layer,(effect.frameData?.lightningVector?.stage==='precharge'?1:baseAlpha)*a,effect.now,effect.frameData)){healthy=false;break;}
                        const clip=buildLightningSceneStencilGeometry(clipPaths,mainCtx.getTransform(),clipKey,dynamicClip),rec=SweepGPURenderer.encodeToLayerScene(scene.texture,clip,lightningBehavior,frameCtx.frameId,cfg,lightningStage==='precharge');if(!rec?.handled){healthy=false;break;}if(rec.commandBuffer)pending.push(rec.commandBuffer);
                    }finally{mainCtx.restore();}
                }
                if(healthy){renderBackendTelemetry.mark('sweep','gpu','deferred clipped GPU lightning');for(let i=0;i<pending.length;i++)queueLayerSceneEffectCommand(frameCtx,40,pending[i],`lightning-${lightningBehavior}`);pending.length=0;return;}
                pending.length=0;SweepGPURenderer.clear();
            }
        }else if(effect.frameData?.bezierGlintGPU===true&&cfg?.effectType!=='lightning'&&scene?.texture){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const rec=effect.tunnelActive
                ? WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,1,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
                : WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer);
            mainCtx.restore();
            if(rec?.handled){const label=effect.frameData.prepared?.spectral===true?'spectral-bezier-glint':(effect.frameData.prepared?.glintType==='chaotic'?'chaotic-bezier-glint':'precise-bezier-glint');renderBackendTelemetry.mark('sweep','gpu',label);if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,label,rec.onSubmitted);else rec.onSubmitted?.();return;}
        }else if(effect.frameData?.canonicalGPU===true&&cfg?.effectType!=='lightning'&&scene?.texture){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const rec=effect.tunnelActive
                ? WebGPUCanonicalSweepRenderer.encodeCorridorToLayerScene(scene.texture,effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,1,effect.frameData.prepared?.lenFrac,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
                : WebGPUCanonicalSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),effect.frameData.prepared?.lenFrac,frameCtx.layer,frameCtx);
            mainCtx.restore();
            if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.gpuMorphArc===true?'deferred shared GPU-arc glint':'deferred canonical glint');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,'sweep');return;}
            if(effect.frameData?.gpuMorphArc===true&&!spiralSweepGpuStrict(frameCtx))materializeSweepCpuFallback(frameCtx,effect,'deferred-gpu-render-failed');
        }
        // Strict Spiral never tears down the GPU Layer Scene just because an optional effect
        // pipeline is warming. Materializing here created exactly the mixed GPU→Canvas frame
        // the 6.8 contract is meant to forbid, and also detached sweep from the current cubic rail.
        if(spiralSweepGpuStrict(frameCtx)){renderBackendTelemetry.mark('sweep','gpu','Spiral Layer-Scene resource warmup; materialization suppressed');somataGpuContractError?.('SPIRAL_SWEEP_LAYER_SCENE_UNAVAILABLE',frameCtx);try{requestMainCanvasRender?.();}catch(_){}return;}
        materializeDeferredLayerScene(frameCtx);
    }
    // Somata 6.8 strict Spiral contract: after the deferred GPU Layer Scene path has been
    // attempted, never call the legacy direct renderers. Their pixels are WebGPU-generated
    // but presented through drawImage()/Canvas2D, which creates a mixed presentation path and
    // can desynchronise the effect from the retained Spiral rail. Wait one frame for the GPU
    // scene/resource instead; the base and every Spiral effect then share one ordered GPU scene.
    if(spiralSweepGpuStrict(frameCtx)){
        renderBackendTelemetry.mark('sweep','gpu','Spiral Layer-Scene-only sweep warmup');
        try{requestMainCanvasRender?.();}catch(_){}
        return;
    }
    if(isLightningSpectralPreflash(effect)){
        const alpha=lightningSpectralPreflashAlpha(effect,baseAlpha);mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
        const ok=effect.tunnelActive
            ? WebGPUBezierSweepRenderer.render(effect.frameData.lightningSpectralPrepared,mainCtx,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
            : WebGPUBezierSweepRenderer.render(effect.frameData.lightningSpectralPrepared,mainCtx,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer);
        mainCtx.restore();if(ok){renderBackendTelemetry.mark('sweep','gpu','spectral Bézier lightning preflash');return;}
        if(spiralSweepGpuStrict(frameCtx)){renderBackendTelemetry.mark('sweep','gpu','Spiral spectral preflash GPU warmup (Canvas fallback disabled)');return;}
        for(let si=0;si<visibleInstances.copies.length;si++){const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;mainCtx.save();if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);drawBezierGlintPrepared(mainCtx,effect.frameData.lightningSpectralPrepared,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha*a);mainCtx.restore();}
        renderBackendTelemetry.mark('sweep','canvas','spectral Bézier lightning preflash warmup',true);return;
    }
    const lightningBehavior=normalizeLightningBehaviorValue(cfg?.lightningBehavior,'inside');
    const clippedLightning=cfg?.effectType==='lightning' && lightningBehavior!=='symmetric';
    const glAvailable=SweepGPURenderer.isAvailable();
    const lightningStage=effect.frameData?.lightningVector?.stage||'';
    // v422: every Lightning stage, including the moving pre-glow, uses MAX accumulation.
    // OVER made every analytic capsule endpoint brighter than the segment middle, which
    // appeared as irregular points in Simple/Medium precision. MAX keeps joins uniform.
    const uniformLightningJoin=cfg?.effectType==='lightning';

    // v293: inside/outside used to force the complete lightning stack back to Canvas2D
    // simply because it needed a contour clip. That is especially expensive for Glow,
    // afterglow and corridor copies. Render each clipped copy on the GPU, then apply the
    // already-prepared Path2D only while compositing the one GL surface. Symmetric mode
    // keeps the old single batched flush across all copies for maximum throughput.
    if(clippedLightning&&glAvailable){
        const prepared=effect.frameData?.prepared||getPreparedLightningFrame(effect.paths,layer,effect.now,cfg,frameCtx.layerIndex);
        const lightningClip=getPreparedLightningClipPath(prepared,lightningBehavior);
        for(let si=0;si<visibleInstances.copies.length;si++){
            const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];
            if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;
            mainCtx.save();
            if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            SweepGPURenderer.beginBatch(uniformLightningJoin?'max':'over');
            const effectAlpha=(lightningStage==='precharge'?1:baseAlpha)*a,handled=queueMovingSweepGlowWebGL(mainCtx,effect.paths,layer,effectAlpha,effect.now,effect.frameData);
            if(handled){
                if(!SweepGPURenderer.flush(mainCtx,lightningClip,cfg,lightningStage==='precharge')){
                    SweepGPURenderer.clear();
                    renderBackendTelemetry.mark('sweep','canvas','Canvas lightning fallback',true);drawMovingSweepGlow(mainCtx,effect.paths,layer,effectAlpha,effect.now,effect.frameData,true);
                }
            }else{
                SweepGPURenderer.clear();
                renderBackendTelemetry.mark('sweep','canvas','Canvas lightning fallback',true);drawMovingSweepGlow(mainCtx,effect.paths,layer,effectAlpha,effect.now,effect.frameData,true);
            }
            mainCtx.restore();
        }
        renderBackendTelemetry.mark('sweep','gpu','GPU clipped lightning');
        return;
    }

    // High/Chaotic/Spectral glints retain cubic Bézier controls whenever available and evaluate them on WebGPU.
    // The halo is additive, then the coloured core is source-overed so it remains visibly
    // above the already rendered figure instead of merely tinting/brightening the base line.
    if(cfg?.effectType!=='lightning'&&effect.frameData?.bezierGlintGPU===true){
        mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
        const ok=effect.tunnelActive
            ? WebGPUBezierSweepRenderer.render(effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,1,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
            : WebGPUBezierSweepRenderer.render(effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer);
        mainCtx.restore();
        if(ok){renderBackendTelemetry.mark('sweep','gpu',effect.frameData.prepared?.spectral===true?'spectral Bézier WebGPU glint':(effect.frameData.prepared?.glintType==='chaotic'?'chaotic Bézier WebGPU glint':'precise Bézier WebGPU glint'));return;}
        if(spiralSweepGpuStrict(frameCtx)){renderBackendTelemetry.mark('sweep','gpu','Spiral Bézier glint GPU warmup (Canvas fallback disabled)');return;}
        // Non-Spiral compatibility may still use Canvas while WebGPU warms.
        for(let si=0;si<visibleInstances.copies.length;si++){
            const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;
            mainCtx.save();if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
            drawBezierGlintPrepared(mainCtx,effect.frameData.prepared,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,a);mainCtx.restore();
        }
        renderBackendTelemetry.mark('sweep','canvas','Bézier glint warmup fallback',true);return;
    }

    // v328: chaotic whole/perPath glints use the canonical arc-length buffer both normally and
    // in Corridor. Corridor uploads only copy scale/rotation/alpha; segment × copy expansion
    // and moving-window clipping happen in WGSL, so CPU no longer rebuilds sweep pieces per copy.
    if(cfg?.effectType!=='lightning'&&effect.frameData?.canonicalGPU===true){
        mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
        const ok=effect.tunnelActive
            ? WebGPUCanonicalSweepRenderer.renderCorridor(effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,1,effect.frameData.prepared?.lenFrac,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
            : WebGPUCanonicalSweepRenderer.render(effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),effect.frameData.prepared?.lenFrac,frameCtx.layer);
        mainCtx.restore();
        if(ok){renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.gpuMorphArc===true?'shared GPU-arc WebGPU glint':'canonical WebGPU glint');return;}
        // Driver/runtime failure: reconstruct the exact legacy pieces lazily and continue.
        if(spiralSweepGpuStrict(frameCtx)){renderBackendTelemetry.mark('sweep','gpu','Spiral GPU-only sweep waiting for WebGPU resource');somataGpuContractError?.('SPIRAL_SWEEP_GPU_UNAVAILABLE',frameCtx);return;}
        if(effect.frameData?.gpuMorphArc===true)materializeSweepCpuFallback(frameCtx,effect,'direct-gpu-render-failed');
        else {effect.frameData.canonicalGPU=false;effect.frameData.prepared=getPreparedSweepFrame(effect.frameData.paths||effect.paths,layer,effect.frameData.phase,effect.now,cfg,frameCtx.layerIndex);}
    }

    const useGL=glAvailable;
    if(useGL)SweepGPURenderer.beginBatch(uniformLightningJoin?'max':'over');
    let glHealthy=useGL;
    for(let si=0;si<visibleInstances.copies.length;si++){
        const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];
        if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;
        mainCtx.save();if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
        const effectAlpha=cfg?.effectType==='lightning'?(lightningStage==='precharge'?a:baseAlpha*a):a;
        if(glHealthy){
            const handled=queueMovingSweepGlowWebGL(mainCtx,effect.paths,layer,effectAlpha,effect.now,effect.frameData);
            if(!handled){if(spiralSweepGpuStrict(frameCtx)){mainCtx.restore();SweepGPURenderer.clear();renderBackendTelemetry.mark('sweep','gpu','Spiral sweep GPU-only fallback suppressed');somataGpuContractError?.('SPIRAL_SWEEP_DRAW_FAILED',frameCtx);return;}glHealthy=false;renderBackendTelemetry.mark('sweep','canvas','Canvas sweep fallback',true);drawMovingSweepGlow(mainCtx,effect.paths,layer,effectAlpha,effect.now,effect.frameData,true);}
        }else {if(spiralSweepGpuStrict(frameCtx)){mainCtx.restore();renderBackendTelemetry.mark('sweep','gpu','Spiral sweep GPU-only fallback suppressed');somataGpuContractError?.('SPIRAL_SWEEP_RENDERER_NOT_READY',frameCtx);return;}renderBackendTelemetry.mark('sweep','canvas','Canvas sweep fallback',true);drawMovingSweepGlow(mainCtx,effect.paths,layer,effectAlpha,effect.now,effect.frameData,true);}
        mainCtx.restore();
    }
    if(glHealthy){renderBackendTelemetry.mark('sweep','gpu','GPU sweep');}
    if(glHealthy&&!SweepGPURenderer.flush(mainCtx,null,cfg,lightningStage==='precharge')){
        // Context/driver failure: next frame automatically uses Canvas fallback.
        SweepGPURenderer.clear();
        FillGPURenderer.clear();
    }
}
