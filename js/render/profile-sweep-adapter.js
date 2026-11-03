window.__spiroRegisterModule?.('js/render/profile-sweep-adapter');

// Adapter between the generic Sweep/Lightning pass and the current line-profile surface.
// Sweep never imports Graffiti renderers directly; only this adapter knows that implementation.
function isGraffitiSweepCarrier(frameCtx){const e=frameCtx?.effectLayer||(typeof getLayerEffectOwner==='function'?getLayerEffectOwner(frameCtx?.layer):null)||frameCtx?.layer;return (frameCtx?.lineProfileApplication||e?.lineProfileApplication||frameCtx?.layer?.lineProfileApplication)==='graffiti';}
function sweepCubicPoint(a,b,c,d,t){const q=1-t,q2=q*q,t2=t*t;return{x:q2*q*a.x+3*q2*t*b.x+3*q*t2*c.x+t2*t*d.x,y:q2*q*a.y+3*q2*t*b.y+3*q*t2*c.y+t2*t*d.y};}
// Pre-sample unchanged cubic profiles once. Spectral motion only changes the
// angular mask, so re-evaluating 18 Bézier samples and atan2 for every cubic on
// every paint frame is unnecessary (especially for Graffiti profiles).
const spectralGraffitiSampleCache=new WeakMap();
const spectralGraffitiSampleStats={builds:0,hits:0};
function preparedSpectralGraffitiSamples(prepared,count){
    const data=prepared.cubicData,subdiv=18,cx=Number(prepared.centerX)||0,cy=Number(prepared.centerY)||0;
    const start=Number(prepared.spectralStartAngle)||0;
    const old=spectralGraffitiSampleCache.get(data);
    if(old&&old.count===count&&old.cx===cx&&old.cy===cy&&old.start===start){spectralGraffitiSampleStats.hits++;return old;}
    const tau=Math.PI*2,points=new Float32Array(count*(subdiv+1)*2),angle=new Float32Array(count*subdiv);
    for(let ci=0;ci<count;ci++){
        const o=ci*8,a={x:data[o],y:data[o+1]},b={x:data[o+2],y:data[o+3]},c={x:data[o+4],y:data[o+5]},d={x:data[o+6],y:data[o+7]};
        const base=ci*(subdiv+1)*2,ang=ci*subdiv;
        for(let j=0;j<=subdiv;j++){
            const p=sweepCubicPoint(a,b,c,d,j/subdiv),k=base+j*2;points[k]=p.x;points[k+1]=p.y;
            if(j>0){const x=(points[k-2]+points[k])*.5-cx,y=(points[k-1]+points[k+1])*.5-cy;
                const raw=Math.atan2(y,x)-start;angle[ang+j-1]=((raw%tau)+tau)%tau;}
        }
    }
    const rec={count,cx,cy,start,subdiv,points,angle};spectralGraffitiSampleCache.set(data,rec);spectralGraffitiSampleStats.builds++;return rec;
}
window.__somataSpectralGraffitiCacheStatus=()=>({...spectralGraffitiSampleStats});
function sampleGraffitiSweepBezierPieces(prepared){
    const data=prepared?.cubicData,count=Math.max(0,Math.min(Number(prepared?.cubicCount)||0,data?Math.floor(data.length/8):0));if(!data||!count)return null;
    const breaks=prepared?.cubicBreaks,out=[];let current=null;const spectral=prepared?.spectral===true,tau=Math.PI*2,raw=Number(prepared?.spectralProgress)||0,progress=((raw%1)+1)%1,head=progress*tau,span=Math.max(.000001,Math.min(tau,Number(prepared?.sectorSpanAngle)||Math.PI/4)),tail=head-span;
    let fallbackStart=null;if(spectral&&!Number.isFinite(Number(prepared?.spectralStartAngle))){fallbackStart=Math.atan2((data[1]||0)-(Number(prepared?.centerY)||0),(data[0]||0)-(Number(prepared?.centerX)||0));}
    // The spectral arc frame is constant for all sampled segments of this pass.
    // Avoid rebuilding it (and allocating a midpoint object) for each subdivision.
    const spectralStart=fallbackStart==null?(Number.isFinite(Number(prepared?.spectralStartAngle))?Number(prepared.spectralStartAngle):0):fallbackStart;
    const spectralDir=Number(prepared?.spectralDirection)<0?-1:1;
    const spectralSamples=spectral?preparedSpectralGraffitiSamples({...prepared,spectralStartAngle:spectralStart},count):null;
    const append=(p,forceBreak=false)=>{if(forceBreak||!current){current=[];out.push(current);}const last=current[current.length-1];if(!last||Math.hypot((p.x||0)-(last.x||0),(p.y||0)-(last.y||0))>1e-5)current.push(p);};
    for(let ci=0;ci<count;ci++){
        const o=ci*8,a={x:data[o],y:data[o+1]},b={x:data[o+2],y:data[o+3]},c={x:data[o+4],y:data[o+5]},d={x:data[o+6],y:data[o+7]},breakBefore=ci===0||breaks?.[ci]===1;
        if(breakBefore)current=null;
        const subdiv=18,base=ci*(subdiv+1)*2,ang=ci*subdiv;
        let last=spectralSamples?{x:spectralSamples.points[base],y:spectralSamples.points[base+1]}:sweepCubicPoint(a,b,c,d,0),run=false;
        for(let j=1;j<=subdiv;j++){
            const q=base+j*2,p1=spectralSamples?{x:spectralSamples.points[q],y:spectralSamples.points[q+1]}:sweepCubicPoint(a,b,c,d,j/subdiv);
            let visible=true;
            if(spectral){const r=spectralSamples.angle[ang+j-1],rel=spectralDir>0?r:(tau-r)%tau;
                visible=span>=tau-.000001||(tail>=0?(rel+.00001>=tail&&rel<=head+.00001):(rel+.00001>=tail+tau||rel<=head+.00001));}
            if(visible){append(last,!run&&(!current||breakBefore));append(p1,false);run=true;}else{run=false;current=null;}
            last=p1;
        }
    }
    return out.filter(p=>p?.length>1);
}
function makeGraffitiSweepPrepared(pieces){
    // Build GPU ribbon descriptors in one pass, without a filtered intermediate array.
    const graffitiPlan=[];
    for(const points of pieces||[]){
        if(!Array.isArray(points)||points.length<=1)continue;
        graffitiPlan.push({vary:true,path:{points,closed:false,_sweepTransient:true},meta:null,chain:`sweep-${graffitiPlan.length}`,bridgeFromPrevious:false,bridgeToNext:false});
    }
    return graffitiPlan.length?{gpuRibbonEligible:true,graffitiPlan}:null;
}
function graffitiSweepPieces(frameCtx,effect){
    const data=effect?.frameData,cfg=data?.cfg||effect?.cfg;if(!data||!cfg)return null;
    if(cfg.effectType==='lightning'){
        // Current-profile Lightning reuses the authored carrier; there is no separate tail geometry.
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
    const data=effect.frameData,cfg=data.cfg,lightning=cfg.effectType==='lightning',f=lightning?data.lightningVector:null;
    const v=lightning?{glowSize:f?.glow,strength:f?.glowIntensity,brightness:f?.brightness,softness:f?.softness,opacity:100}:data.glintVisual;
    let pulse=null;if(lightning&&f?.stage==='strike'&&Array.isArray(f.microPulses)){for(const p of f.microPulses){if(!pulse||Number(p?.intensity||0)>Number(pulse?.intensity||0))pulse=p;}}
    const liveIntensity=lightning?Math.max(Number(f?.intensity)||0,Number(pulse?.intensity)||0):0;
    const alpha=lightning?Math.max(0,Math.min(1,liveIntensity*Math.max(0,Math.min(1,Number(baseAlpha)||0)))):Math.max(0,Math.min(1,Number(baseAlpha)||0));
    const opacity=Number.isFinite(Number(v?.opacity))?Number(v.opacity):1,opacityUnit=opacity>1?opacity/100:opacity;
    const pulseColor=lightning?lightningOnePassColor(f?.primary,f?.secondary):null; // Stable authored tint; micro pulses vary opacity only.
    return{width:lightning?Math.max(.15,Number(f?.boltW)||.15):Math.max(.15,Number(data.sweepW)||.15),color:String(lightning?(pulseColor||f?.primary||cfg.lightningColor||'#ffffff'):(cfg.color||'#ffffff')),haloColor:String(lightning?(pulseColor||f?.primary||cfg.lightningColor||'#ffffff'):(cfg.haloColor||cfg.color||'#ffffff')),coreAlpha:alpha*Math.max(0,Math.min(1,opacityUnit))*(lightning?Math.max(0,Math.min(1,Number(v?.strength)||0)):1),glowAlpha:Math.max(0,Math.min(1,alpha*.22*Math.max(0,Number(v?.strength)||0)*Math.max(0,Number(v?.brightness)||0))),glowSize:Math.max(0,Number(v?.glowSize)||0),softness:Math.max(0,Number(v?.softness)||0),microPulseIndex:pulse?Number(pulse.index):-1};
}
function renderGraffitiProfileSweep(frameCtx,effect,baseAlpha,visibleInstances){
    if(!isGraffitiSweepCarrier(frameCtx)||typeof WebGPUGraffitiRibbonRenderer==='undefined')return false;
    const pieces=graffitiSweepPieces(frameCtx,effect),prepared=makeGraffitiSweepPrepared(pieces);if(!prepared)return false;frameCtx._profileSweepAttempted=true;
    const vis=graffitiSweepVisual(effect,baseAlpha);if(vis.coreAlpha<=.001&&vis.glowAlpha<=.001)return true;
    const layer=(typeof liveGraffitiStyleLayerForFrame==='function'?liveGraffitiStyleLayerForFrame(frameCtx):(frameCtx.effectLayer||frameCtx.layer)),overlay=WebGPUGraffitiRibbonRenderer.getActiveOverlayTarget?.(frameCtx.frameId),scene=frameCtx.frame?.gpuLayerSceneDeferred?SomataLayerSceneService.resident(frameCtx):null,
        // When the authored Line is hidden, its Graffiti overlay is not
        // necessarily opened. Glint must still get an independent transparent
        // Layer Scene on *every* layer instead of silently disappearing.
        useOverlay=frameCtx.lineDisplayEnabled===true&&Boolean(overlay?.texture),
        effectScene=useOverlay?null:(scene?.texture?scene:SomataLayerSceneService.ensure(frameCtx,'standalone-profile-glint')),
        target=useOverlay?overlay.texture:effectScene?.texture;
    mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);try{
        if(useOverlay){
            let ok=true;
            if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorGlowToOverlay(prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.haloColor,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.drawGlowToOverlay(prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.haloColor,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});ok=ok&&Boolean(g?.handled);}
            const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorToOverlay(prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.drawToOverlay(prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});ok=ok&&Boolean(c?.handled);
            if(ok){renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.cfg?.effectType==='lightning'?'Graffiti-profile lightning overlay':'Graffiti-profile Glint overlay');return true;}return false;
        }
        if(target){
            if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.encodeCorridorGlowToLayerScene(target,prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.haloColor,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.encodeGlowToLayerScene(target,prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.haloColor,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});if(!g?.handled)return false;if(g.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('sweep'),g.commandBuffer,'graffiti-profile-glint-glow',g.onSubmitted);else g.onSubmitted?.();}
            const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.encodeCorridorToLayerScene(target,prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.encodeToLayerScene(target,prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});if(!c?.handled)return false;if(c.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('sweep',1),c.commandBuffer,'graffiti-profile-glint-core',c.onSubmitted);else c.onSubmitted?.();renderBackendTelemetry.mark('sweep','gpu',effect.frameData?.cfg?.effectType==='lightning'?'Graffiti-profile lightning':'Graffiti-profile Glint');return true;
        }

        let ok=true;if(vis.glowSize>.001&&vis.glowAlpha>.001){const g=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorGlowToOverlay(prepared,layer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,{width:vis.width,color:vis.haloColor,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'}):WebGPUGraffitiRibbonRenderer.drawGlowToOverlay(prepared,layer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,{width:vis.width,color:vis.haloColor,radiusPx:vis.glowSize,alphaScale:vis.glowAlpha,softness:vis.softness,composite:'source-over'});ok=ok&&Boolean(g?.handled);}const c=effect.tunnelActive?WebGPUGraffitiRibbonRenderer.drawCorridorToOverlay(prepared,layer,vis.coreAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over',{width:vis.width,color:vis.color}):WebGPUGraffitiRibbonRenderer.drawToOverlay(prepared,layer,vis.coreAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',{width:vis.width,color:vis.color});ok=ok&&Boolean(c?.handled);if(ok){renderBackendTelemetry.mark('sweep','gpu','Graffiti-profile Glint GPU overlay');return true;}
    }finally{mainCtx.restore();}
    return false;
}
function renderSweepOnActiveGraffitiOverlay(frameCtx,effect,baseAlpha,visibleInstances){
    const overlay=WebGPUGraffitiRibbonRenderer?.getActiveOverlayTarget?.(frameCtx.frameId);if(!overlay?.texture)return false;const cfg=effect.frameData?.cfg;if(!cfg)return false;let rec=null;
    const encodeLayer=(fn)=>{mainCtx.save();try{applyLayerFrameEffectTransform(mainCtx,frameCtx);return fn();}finally{mainCtx.restore();}};
    if((typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed())&&effect.frameData?.gpuMorphArcLightning===true){
        const behavior=lightningEffectiveClipBehavior(frameCtx,cfg,effect.frameData?.prepared?.visible||effect.paths);rec=encodeLayer(()=>effect.tunnelActive?WebGPULightningArcRenderer.encodeCorridorToLayerScene(overlay.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,behavior):WebGPULightningArcRenderer.encodeToLayerScene(overlay.texture,effect.frameData.prepared,effect.frameData.lightningVector,mainCtx,(baseAlpha)*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),behavior,frameCtx));
    }else if(cfg.effectType==='lightning'&&SweepGPURenderer.canEncodeToLayerScene?.()){
        const behavior=lightningEffectiveClipBehavior(frameCtx,cfg,effect.frameData?.prepared?.visible||effect.paths),stage=effect.frameData?.lightningVector?.stage||'',joinMode='max';
        if(behavior==='symmetric'){
            const dynamicLightning=frameCtx.geometryPlan?.dynamic===true;if(SweepGPURenderer.beginBatch(joinMode,dynamicLightning?null:frameCtx.layer,dynamicLightning)){let healthy=true;
                for(let si=0;si<visibleInstances.copies.length;si++){const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;mainCtx.save();try{if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);if(!queueMovingSweepGlowWebGL(mainCtx,effect.paths,frameCtx.layer,baseAlpha*a,effect.now,effect.frameData))healthy=false;}finally{mainCtx.restore();}if(!healthy)break;}
                if(healthy)rec=SweepGPURenderer.encodeToLayerScene(overlay.texture,null,'symmetric',frameCtx.frameId,cfg);if(!rec?.handled)SweepGPURenderer.clear();
            }
        }else{
            const records=[];let healthy=true,clipPaths=effect.frameData?.prepared?.visible||effect.frameData?.visible||effect.paths||[];
            for(let si=0;si<visibleInstances.copies.length;si++){const copy=visibleInstances.copies[si],a=visibleInstances.alphas[si];if(!shouldDrawTunnelEffectIndex('sweep',si,frameCtx,effect.footprint))continue;mainCtx.save();try{if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);const dynamicClip=frameCtx.geometryPlan?.dynamic===true,clipKey=dynamicClip?null:getLightningSceneStencilCacheKey(frameCtx.layer,copy,effect.tunnelActive);if(!SweepGPURenderer.beginBatch(joinMode,clipKey,dynamicClip)||!queueMovingSweepGlowWebGL(mainCtx,effect.paths,frameCtx.layer,baseAlpha*a,effect.now,effect.frameData)){healthy=false;break;}const clip=buildLightningSceneStencilGeometry(clipPaths,mainCtx.getTransform(),clipKey,dynamicClip),r=SweepGPURenderer.encodeToLayerScene(overlay.texture,clip,behavior,frameCtx.frameId,cfg);if(!r?.handled){healthy=false;break;}records.push(r);}finally{mainCtx.restore();}}
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
    hasActiveOverlay(frameCtx){return frameCtx?.lineDisplayEnabled===true&&Boolean(WebGPUGraffitiRibbonRenderer?.getActiveOverlayTarget?.(frameCtx?.frameId)?.texture);},
    renderOnActiveOverlay:renderSweepOnActiveGraffitiOverlay
};
window.SomataProfileSweepAdapter=SomataProfileSweepAdapter;
