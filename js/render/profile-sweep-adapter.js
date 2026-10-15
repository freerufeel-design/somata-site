window.__spiroRegisterModule?.('js/render/profile-sweep-adapter');

// Adapter between the generic Sweep/Lightning pass and the current line-profile surface.
// Sweep never imports Graffiti renderers directly; only this adapter knows that implementation.
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
    let pulse=null;if(lightning&&!pre&&f?.stage==='after'&&Array.isArray(f.microPulses)){for(const p of f.microPulses){if(!pulse||Number(p?.intensity||0)>Number(pulse?.intensity||0))pulse=p;}}
    const liveIntensity=lightning&&!pre?Math.max(Number(f?.intensity)||0,Number(pulse?.intensity)||0):0;
    const alpha=lightning?Math.max(0,Math.min(1,pre?(Number(f?.prechargeAlpha)||0):liveIntensity*Math.max(0,Math.min(1,Number(baseAlpha)||0)))):Math.max(0,Math.min(1,Number(baseAlpha)||0));
    const opacity=Number.isFinite(Number(v?.opacity))?Number(v.opacity):1,opacityUnit=opacity>1?opacity/100:opacity;
    const pulseColor=pulse?(Number(pulse.index)%2===0?(f?.secondary||f?.primary):(f?.primary||f?.secondary)):null;
    return{width:lightning?Math.max(.15,Number(pre?f?.prechargeWidth:f?.boltW)||.15):Math.max(.15,Number(data.sweepW)||.15),color:String(lightning?(pre?(f?.flash||cfg.color||'#ffffff'):(pulseColor||f?.primary||cfg.lightningColor||'#ffffff')):(cfg.color||'#ffffff')),coreAlpha:alpha*Math.max(0,Math.min(1,opacityUnit)),glowAlpha:Math.max(0,Math.min(1,alpha*.22*Math.max(0,Number(v?.strength)||0)*Math.max(0,Number(v?.brightness)||0))),glowSize:Math.max(0,Number(v?.glowSize)||0),softness:Math.max(0,Math.min(1.5,Number(v?.softness)||0)),microPulseIndex:pulse?Number(pulse.index):-1};
}
function renderGraffitiProfileSweep(frameCtx,effect,baseAlpha,visibleInstances){
    if(!isGraffitiSweepCarrier(frameCtx)||typeof WebGPUGraffitiRibbonRenderer==='undefined')return false;
    const pieces=graffitiSweepPieces(frameCtx,effect),prepared=makeGraffitiSweepPrepared(pieces);if(!prepared)return false;frameCtx._profileSweepAttempted=true;
    const vis=graffitiSweepVisual(effect,baseAlpha);if(vis.coreAlpha<=.001&&vis.glowAlpha<=.001)return true;
    const layer=(typeof liveGraffitiStyleLayerForFrame==='function'?liveGraffitiStyleLayerForFrame(frameCtx):(frameCtx.effectLayer||frameCtx.layer)),overlay=WebGPUGraffitiRibbonRenderer.getActiveOverlayTarget?.(frameCtx.frameId),scene=frameCtx.frame?.gpuLayerSceneDeferred?SomataLayerSceneService.resident(frameCtx):null,useOverlay=Boolean(overlay?.texture),target=useOverlay?overlay.texture:scene?.texture;
    mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);try{
        if(useOverlay){
            let ok=true;
            if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorGlowToOverlay(prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.drawGlowToOverlay(prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});ok=ok&&Boolean(g?.handled);}
            const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorToOverlay(prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.drawToOverlay(prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});ok=ok&&Boolean(c?.handled);
            if(ok){renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.cfg?.effectType==='lightning'?'Graffiti-profile lightning preflash overlay':'Graffiti-profile Glint overlay');return true;}return false;
        }
        if(target){
            if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.encodeCorridorGlowToLayerScene(target,prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.encodeGlowToLayerScene(target,prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.color,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});if(!g?.handled)return false;if(g.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('sweep'),g.commandBuffer,'graffiti-profile-glint-glow',g.onSubmitted);else g.onSubmitted?.();}
            const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.encodeCorridorToLayerScene(target,prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.encodeToLayerScene(target,prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});if(!c?.handled)return false;if(c.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('sweep',1),c.commandBuffer,'graffiti-profile-glint-core',c.onSubmitted);else c.onSubmitted?.();renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.cfg?.effectType==='lightning'?'Graffiti-profile lightning preflash':'Graffiti-profile Glint');return true;
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


const SomataProfileSweepAdapter={
    isCurrentCarrier:isGraffitiSweepCarrier,
    renderCurrent:renderGraffitiProfileSweep,
    hasActiveOverlay(frameCtx){return Boolean(WebGPUGraffitiRibbonRenderer?.getActiveOverlayTarget?.(frameCtx?.frameId)?.texture);},
    renderOnActiveOverlay:renderSweepOnActiveGraffitiOverlay
};
window.SomataProfileSweepAdapter=SomataProfileSweepAdapter;
