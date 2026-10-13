

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
    const data=frameCtx.sweepData||(frameCtx.sweepData={});data.cfg=cfg;data.layerIndex=idx;data.paths=null;data.now=now;data.phase=0;data.lightningPhase=lightningPhase;data.lightningVector=lightningVector;data.vectorPath=null;data.sweepW=0;data.glintVisual=null;data.canonicalGPU=false;data.gpuMorphArc=false;data.gpuMorphArcLightning=true;data.prepared=prepared;data.lightningSpectralPrepared=null;data.lightningSpectralCfg=null;data.lightningSpectralVisual=null;data.lightningSpectralW=0;
    if(lightningVector.stage==='precharge'&&normalizeSweepFlashMode(cfg.flashMode)==='spectral'){
        WebGPUBezierSweepRenderer?.warmup?.();if(!WebGPUBezierSweepRenderer?.isReady?.()){lightningGpuArcBridgeStats.fallbacks++;lightningGpuArcBridgeStats.lastReason='spectral-bezier-warming';return null;}
        const spectralPrepared=prepareSharedTopologySpectralBezier(frameCtx,cfg,now,true,lightningVector.prechargeT);
        if(spectralPrepared){const spectralCfg={...cfg,effectType:'glint',flashType:'spectral',glintPrecision:'spectral',_lightningPreflashBlend:false,_lightningPreflashCoreOnTop:true,color:cfg.color||'#ffffff'};data.lightningSpectralPrepared=spectralPrepared;data.lightningSpectralCfg=spectralCfg;data.lightningSpectralW=lightningVector.prechargeWidth;data.lightningSpectralVisual={glowSize:lightningVector.prechargeGlow,strength:lightningVector.prechargeGlowIntensity,brightness:lightningVector.prechargeBrightness,softness:lightningVector.prechargeSoftness,opacity:lightningVector.flashOpacity};data.gpuMorphArcLightning=false;}
    }
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

function isLightningSpectralPreflash(effect){const cfg=effect?.frameData?.cfg||effect?.cfg;return cfg?.effectType==='lightning'&&effect.frameData?.lightningVector?.stage==='precharge'&&Boolean(effect.frameData?.lightningSpectralPrepared);}
function lightningSpectralPreflashAlpha(effect,_baseAlpha){return Math.max(0,Math.min(1,Number(effect?.frameData?.lightningVector?.prechargeAlpha)||0));}

const GRAFFITI_SWEEP_GLOW_PHASE=40,GRAFFITI_SWEEP_CORE_PHASE=41;
function isGraffitiSweepCarrier(frameCtx){const e=frameCtx?.effectLayer||(typeof getLayerEffectOwner==='function'?getLayerEffectOwner(frameCtx?.layer):null)||frameCtx?.layer;return (frameCtx?.lineProfileApplication||e?.lineProfileApplication||frameCtx?.layer?.lineProfileApplication)==='graffiti';}
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
        if(data.lightningVector?.stage==='precharge'){
            if(data.lightningSpectralPrepared)return sampleGraffitiSweepBezierPieces(data.lightningSpectralPrepared);
            return data.lightningVector?.prechargePieces||null;
        }
        // Current-profile Lightning keeps the strike/afterglow on the same authored carrier.
        return data.prepared?.pieces||null;
    }
    if(data.prepared?.pieces?.length)return data.prepared.pieces;
    if(data.prepared?.cubicData)return sampleGraffitiSweepBezierPieces(data.prepared);

    if(data.canonicalGPU===true&&!spiralSweepGpuStrict(frameCtx)&&typeof getPreparedSweepFrame==='function'){
        const sampled=getPreparedSweepFrame(effect.paths,frameCtx.layer,data.phase,effect.now,cfg,frameCtx.layerIndex);return sampled?.pieces||null;
    }
    return null;
}
function graffitiSweepVisual(effect,baseAlpha){
    const data=effect.frameData,cfg=data.cfg,lightning=cfg.effectType==='lightning',f=lightning?data.lightningVector:null,pre=lightning&&f?.stage==='precharge';
    const v=lightning?(pre?{glowSize:f?.prechargeGlow,strength:f?.prechargeGlowIntensity,brightness:f?.prechargeBrightness,softness:f?.prechargeSoftness,opacity:f?.flashOpacity}:{glowSize:f?.glow,strength:f?.glowIntensity,brightness:f?.brightness,softness:f?.softness,opacity:100}):data.glintVisual;
    const alpha=lightning?Math.max(0,Math.min(1,pre?(Number(f?.prechargeAlpha)||0):(Number(f?.intensity)||0)*Math.max(0,Math.min(1,Number(baseAlpha)||0)))):Math.max(0,Math.min(1,Number(baseAlpha)||0));
    const opacity=Number.isFinite(Number(v?.opacity))?Number(v.opacity):1,opacityUnit=opacity>1?opacity/100:opacity;
    return{width:lightning?Math.max(.15,Number(pre?f?.prechargeWidth:f?.boltW)||.15):Math.max(.15,Number(data.sweepW)||.15),color:String(lightning?(pre?(f?.flash||cfg.color||'#ffffff'):(f?.primary||cfg.lightningColor||'#ffffff')):(cfg.color||'#ffffff')),coreAlpha:alpha*Math.max(0,Math.min(1,opacityUnit)),glowAlpha:Math.max(0,Math.min(1,alpha*.22*Math.max(0,Number(v?.strength)||0)*Math.max(0,Number(v?.brightness)||0))),glowSize:Math.max(0,Number(v?.glowSize)||0),softness:Math.max(0,Math.min(1.5,Number(v?.softness)||0))};
}
function renderGraffitiProfileSweep(frameCtx,effect,baseAlpha,visibleInstances){
    if(!isGraffitiSweepCarrier(frameCtx)||typeof WebGPUGraffitiRibbonRenderer==='undefined')return false;
    const pieces=graffitiSweepPieces(frameCtx,effect),prepared=makeGraffitiSweepPrepared(pieces);if(!prepared)return false;frameCtx._graffitiSweepProfileAttempted=true;
    const vis=graffitiSweepVisual(effect,baseAlpha);if(vis.coreAlpha<=.001&&vis.glowAlpha<=.001)return true;
    const layer=(typeof liveGraffitiStyleLayerForFrame==='function'?liveGraffitiStyleLayerForFrame(frameCtx):(frameCtx.effectLayer||frameCtx.layer)),overlay=WebGPUGraffitiRibbonRenderer.getActiveOverlayTarget?.(frameCtx.frameId),scene=frameCtx.frame?.gpuLayerSceneDeferred?WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId):null,useOverlay=Boolean(overlay?.texture),target=useOverlay?overlay.texture:scene?.texture;
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

        let ok=true;if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorGlowToOverlay(prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.drawGlowToOverlay(prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});ok=ok&&Boolean(g?.handled);}const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorToOverlay(prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.drawToOverlay(prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});ok=ok&&Boolean(c?.handled);if(ok){renderBackendTelemetry.mark('sweep','gpu','Graffiti-profile Glint GPU overlay');return true;}
    }finally{mainCtx.restore();}
    return false;
}
function renderSweepOnActiveGraffitiOverlay(frameCtx,effect,baseAlpha,visibleInstances){
    const overlay=WebGPUGraffitiRibbonRenderer?.getActiveOverlayTarget?.(frameCtx.frameId);if(!overlay?.texture)return false;const cfg=effect.frameData?.cfg;if(!cfg)return false;let rec=null;
    const encodeLayer=(fn)=>{mainCtx.save();try{applyLayerFrameEffectTransform(mainCtx,frameCtx);return fn();}finally{mainCtx.restore();}};
    if((typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed())&&effect.frameData?.gpuMorphArcLightning===true){
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

function sweepProfileMode(cfg){const value=cfg?.effectType==='lightning'?cfg?.lightningProfileShape:cfg?.profileShape;return value==='line'?'line':'current';}
function reportSweepGpuIssue(frameCtx,stage,reason,extra=null){
    try{renderBackendTelemetry.mark('sweep','gpu',`GPU pass skipped: ${stage}`);}catch(_){}
    if(typeof somataGpuDiagnosticError==='function')somataGpuDiagnosticError('sweep',stage,reason,frameCtx,{fallback:'skip-sweep-pass',recovered:true,...(extra||{})});
    else console.error('[Somata 7.4.9 GPU][sweep]',stage,reason,{frameId:frameCtx?.frameId,layerIndex:frameCtx?.layerIndex,...(extra||{})});
    try{requestMainCanvasRender?.();}catch(_){}
}
function renderLayerSweepPass(frameCtx){
    const effect=frameCtx.effectsPlan?.sweep;
    if(!effect?.enabled)return;
    const {layer,baseAlpha,visibleInstances}=frameCtx,cfg=effect.frameData?.cfg;
    if(!cfg)return reportSweepGpuIssue(frameCtx,'missing-config','Sweep is enabled but its live configuration is unavailable');
    if(typeof somataGpuBackendAllowed==='function'&&!somataGpuBackendAllowed())return reportSweepGpuIssue(frameCtx,'backend-unavailable','GPU backend is unavailable');

    const useCurrentProfile=sweepProfileMode(cfg)==='current';
    if(useCurrentProfile&&isGraffitiSweepCarrier(frameCtx)){
        frameCtx._graffitiSweepProfileAttempted=false;
        if(renderGraffitiProfileSweep(frameCtx,effect,baseAlpha,visibleInstances))return;
        if(frameCtx._graffitiSweepProfileAttempted===true)return reportSweepGpuIssue(frameCtx,'graffiti-profile-encode','Current-profile Sweep could not encode the Graffiti ribbon; thin-line substitution is intentionally blocked',{effectType:cfg.effectType,profileShape:'current'});
    }

    if(WebGPUGraffitiRibbonRenderer?.getActiveOverlayTarget?.(frameCtx.frameId)){
        if(renderSweepOnActiveGraffitiOverlay(frameCtx,effect,baseAlpha,visibleInstances))return;
        return reportSweepGpuIssue(frameCtx,'graffiti-overlay-join','Sweep could not join the active Graffiti GPU overlay',{effectType:cfg.effectType,profileShape:sweepProfileMode(cfg)});
    }

    let scene=frameCtx.frame?.gpuLayerSceneDeferred?WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId):null;
    if(!scene?.texture){
        const opened=WebGPUStrokeRenderer.canUseExternalLayerScene?.(frameCtx.frameId)===true&&WebGPUStrokeRenderer.beginExternalLayerScene?.(frameCtx.frameId,'sweep-effect')===true;
        if(opened){frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture(frameCtx.frameId);}
    }
    if(!scene?.texture)return reportSweepGpuIssue(frameCtx,'layer-scene-not-ready','GPU Layer Scene is not ready; Sweep is skipped for this frame and will retry on the next repaint',{effectType:cfg.effectType,fallback:'transparent-gpu-layer-scene-retry'});

    if(effect.frameData?.gpuMorphArcLightning===true){
        const behavior=normalizeLightningBehaviorValue(cfg.lightningBehavior,'inside');
        mainCtx.save();let rec=null;try{
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            rec=effect.tunnelActive
                ? WebGPULightningArcRenderer.encodeCorridorToLayerScene(scene.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,effect.frameData?.lightningVector?.stage==='precharge'?1:baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,behavior)
                : WebGPULightningArcRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,(effect.frameData?.lightningVector?.stage==='precharge'?1:baseAlpha)*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),behavior,frameCtx);
        }finally{mainCtx.restore();}
        if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu','shared GPU-arc exact lightning');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,`lightning-arc-${behavior}`,rec.onSubmitted);return;}
        return reportSweepGpuIssue(frameCtx,'lightning-arc-encode','Exact GPU Arc Lightning encode failed; only the Lightning pass is skipped',{behavior});
    }

    if(isLightningSpectralPreflash(effect)){
        const alpha=lightningSpectralPreflashAlpha(effect,baseAlpha);mainCtx.save();let rec=null;try{
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            rec=effect.tunnelActive
                ? WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.lightningSpectralPrepared,mainCtx,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
                : WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.lightningSpectralPrepared,mainCtx,effect.frameData.lightningSpectralCfg,effect.frameData.lightningSpectralW,effect.frameData.lightningSpectralVisual,alpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer);
        }finally{mainCtx.restore();}
        if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu','spectral Bézier lightning preflash');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,'lightning-spectral-preflash',rec.onSubmitted);else rec.onSubmitted?.();return;}
        return reportSweepGpuIssue(frameCtx,'lightning-preflash-encode','Spectral Lightning preflash GPU encode failed');
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
                mainCtx.save();try{if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);if(!queueMovingSweepGlowWebGL(mainCtx,effect.paths,layer,(stage==='precharge'?1:baseAlpha)*a,effect.now,effect.frameData))healthy=false;}finally{mainCtx.restore();}
                if(!healthy)break;
            }
            if(healthy){const rec=SweepGPURenderer.encodeToLayerScene(scene.texture,null,'symmetric',frameCtx.frameId,cfg,stage==='precharge');if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu','deferred GPU lightning');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,'lightning');return;}}
            SweepGPURenderer.clear();return reportSweepGpuIssue(frameCtx,'lightning-encode','GPU Lightning encode failed',{behavior});
        }
        const pending=[],clipPaths=effect.frameData?.prepared?.visible||effect.frameData?.visible||effect.paths||[];let healthy=true;
        for(let si=0;si<visibleInstances.copies.length;si++){
            const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;
            mainCtx.save();try{
                if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
                const dynamic=frameCtx.geometryPlan?.dynamic===true,clipKey=dynamic?null:getLightningSceneStencilCacheKey(frameCtx.layer,copy,effect.tunnelActive);
                if(!SweepGPURenderer.beginBatch(joinMode,clipKey,dynamic)||!queueMovingSweepGlowWebGL(mainCtx,effect.paths,layer,(stage==='precharge'?1:baseAlpha)*a,effect.now,effect.frameData)){healthy=false;break;}
                const clip=buildLightningSceneStencilGeometry(clipPaths,mainCtx.getTransform(),clipKey,dynamic),rec=SweepGPURenderer.encodeToLayerScene(scene.texture,clip,behavior,frameCtx.frameId,cfg,stage==='precharge');if(!rec?.handled){healthy=false;break;}if(rec.commandBuffer)pending.push(rec.commandBuffer);
            }finally{mainCtx.restore();}
        }
        if(healthy){for(let i=0;i<pending.length;i++)queueLayerSceneEffectCommand(frameCtx,40,pending[i],`lightning-${behavior}`);renderBackendTelemetry.mark('sweep','gpu','deferred clipped GPU lightning');return;}
        SweepGPURenderer.clear();return reportSweepGpuIssue(frameCtx,'lightning-clipped-encode','Clipped GPU Lightning encode failed',{behavior});
    }

    if(effect.frameData?.bezierGlintGPU===true){
        mainCtx.save();let rec=null;try{
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            rec=effect.tunnelActive
                ? WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,1,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
                : WebGPUBezierSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared,mainCtx,cfg,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),null,null,frameCtx,effect.footprint,frameCtx.layer);
        }finally{mainCtx.restore();}
        if(rec?.handled){const label=effect.frameData.prepared?.spectral===true?'spectral-bezier-glint':(effect.frameData.prepared?.glintType==='chaotic'?'chaotic-bezier-glint':'precise-bezier-glint');renderBackendTelemetry.mark('sweep','gpu',label);if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,label,rec.onSubmitted);else rec.onSubmitted?.();return;}
        return reportSweepGpuIssue(frameCtx,'bezier-glint-encode','Bézier Glint GPU encode failed',{profileShape:sweepProfileMode(cfg)});
    }

    if(effect.frameData?.canonicalGPU===true){
        mainCtx.save();let rec=null;try{
            applyLayerFrameEffectTransform(mainCtx,frameCtx);
            rec=effect.tunnelActive
                ? WebGPUCanonicalSweepRenderer.encodeCorridorToLayerScene(scene.texture,effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,1,effect.frameData.prepared?.lenFrac,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,frameCtx.layer)
                : WebGPUCanonicalSweepRenderer.encodeToLayerScene(scene.texture,effect.frameData.prepared?.table,mainCtx,cfg,effect.frameData.phase,effect.frameData.sweepW,effect.frameData.glintVisual,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),effect.frameData.prepared?.lenFrac,frameCtx.layer,frameCtx);
        }finally{mainCtx.restore();}
        if(rec?.handled){renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.gpuMorphArc===true?'deferred shared GPU-arc glint':'deferred canonical glint');if(rec.commandBuffer)queueLayerSceneEffectCommand(frameCtx,40,rec.commandBuffer,'sweep',rec.onSubmitted);else rec.onSubmitted?.();return;}
        return reportSweepGpuIssue(frameCtx,'canonical-glint-encode','Canonical Glint GPU encode failed',{profileShape:sweepProfileMode(cfg)});
    }

    return reportSweepGpuIssue(frameCtx,'unsupported-frame-data','Sweep has no GPU-resident frame representation',{effectType:cfg.effectType});
}
