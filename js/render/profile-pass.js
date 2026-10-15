window.__spiroRegisterModule?.('js/render/profile-pass');

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

function tryRenderStrokeMarkerEffectGPU(frameCtx,opts={}){
    const profile=frameCtx?.effectsPlan?.profile,prepared=profile?.prepared;
    if(!profile?.enabled||profile.application!=='stroke'||!['slash','square','circle','cross'].includes(prepared?.type))return false;
    const strictArc=SomataGeometryPolicy.isStrict(frameCtx)&&prepared?.gpuArcNative===true;
    const {layer,visibleInstances,baseAlpha}=frameCtx;const alpha=Number.isFinite(Number(opts.alpha))?Math.max(0,Math.min(1,Number(opts.alpha))):baseAlpha;

    if(strictArc){
        WebGPUProfileArcMarkerRenderer.warmup?.();const scene=frameCtx.frame?.gpuLayerSceneDeferred?SomataLayerSceneService.resident(frameCtx):null;if(!scene?.texture||!WebGPUProfileArcMarkerRenderer.isReady?.())return false;
        mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);let rec=null;try{rec=WebGPUProfileArcMarkerRenderer.encodeToLayerScene(scene.texture,prepared,layer,profile.tunnelActive?alpha:alpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,frameCtx,opts,profile.tunnelActive?visibleInstances.copies:null,profile.tunnelActive?visibleInstances.alphas:null,profile.footprint);}finally{mainCtx.restore();}
        if(rec?.handled){if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,opts.mode==='glow'?somataEffectPhase('geometry',12):somataEffectPhase('geometry',30),rec.commandBuffer,`profile-bezier-arc-${opts.mode||'effect'}`,rec.onSubmitted);noteProfileGpuSuccess('dash',`retained Bézier Arc marker ${opts.mode||'effect'}`,'webgpu-layer-scene');return true;}
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



function renderLayerProfilePass(frameCtx) {
    const effect=frameCtx.effectsPlan?.profile;
    if(!effect?.enabled)return;
    const gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();
    const strictSpiralProfileGpu=SomataGeometryPolicy.isStrict(frameCtx);
    const layer=frameCtx.layer,graffitiStyleLayer=liveGraffitiStyleLayerForFrame(frameCtx)||layer,visibleInstances=frameCtx.visibleInstances,baseAlpha=Math.max(0,Math.min(1,Number(frameCtx.lineAlpha??frameCtx.baseAlpha)||0));
    const markerCoreInset=(effect.application==='stroke'&&frameCtx.effectsPlan?.outline?.enabled===true)?Math.max(0,Number(frameCtx.effectsPlan.outline.coreInset)||0):0;
    const markerCoreOpts=markerCoreInset>0?{widthDeltaLocal:-2*markerCoreInset}:{};

    if(frameCtx.frame?.gpuLayerSceneDeferred&&effect.application==='stroke'&&(['slash','square','circle','cross'].includes(effect.prepared?.type))){
        const scene=SomataLayerSceneService.resident(frameCtx);
        if(scene?.texture){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const arcNative=effect.prepared?.gpuArcNative===true;

            if(arcNative&&frameCtx.effectsPlan?.glow?.enabled===true){const g=frameCtx.effectsPlan.glow,ga=Math.max(0,Number(g.compositeAlpha)||0);const grec=WebGPUProfileArcMarkerRenderer.encodeToLayerScene(scene.texture,effect.prepared,layer,effect.tunnelActive?ga:ga*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,frameCtx,{mode:'glow',extraPx:Math.max(.5,(Number(g.amount)||0)*.55*frameCtx.frame.dpr)},effect.tunnelActive?visibleInstances.copies:null,effect.tunnelActive?visibleInstances.alphas:null,effect.footprint);if(grec?.handled&&grec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',32),grec.commandBuffer,'profile-bezier-arc-glow',grec.onSubmitted);}
            const rec=arcNative
                ? WebGPUProfileArcMarkerRenderer.encodeToLayerScene(scene.texture,effect.prepared,layer,effect.tunnelActive?baseAlpha:baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,frameCtx,markerCoreOpts,effect.tunnelActive?visibleInstances.copies:null,effect.tunnelActive?visibleInstances.alphas:null,effect.footprint)
                : (effect.tunnelActive
                    ? WebGPUProfileMarkerRenderer.encodeCorridorToLayerScene(scene.texture,effect.prepared?.table,layer,baseAlpha,mainCtx,effect.prepared,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,markerCoreOpts)
                    : WebGPUProfileMarkerRenderer.encodeToLayerScene(scene.texture,effect.prepared?.table,layer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,effect.prepared,markerCoreOpts));
            mainCtx.restore();
            if(rec?.handled){renderBackendTelemetry.mark('profile','gpu',arcNative?'retained Bézier GPU-Arc profile markers':'deferred GPU profile markers');noteProfileGpuSuccess('dash',effect.tunnelActive?'marker corridor layer-scene':'marker layer-scene','webgpu-layer-scene');if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',40),rec.commandBuffer,arcNative?'profile-bezier-arc':'profile',rec.onSubmitted);return;}else{const st=arcNative?(WebGPUProfileArcMarkerRenderer.status?.()||{}):(WebGPUProfileMarkerRenderer.status?.()||{});noteProfileGpuFailure('dash','marker layer-scene',st.lastError||st.diagnostic?.reason||(st.initializing?'GPU marker pipeline warming':'marker Layer Scene encode returned not handled'),{renderer:st});}
        }

        if(strictSpiralProfileGpu){renderBackendTelemetry.mark('profile','gpu','Spiral profile GPU-only warmup');somataGpuContractError('SPIRAL_PROFILE_GPU_UNAVAILABLE',frameCtx,{profile:effect?.application||null});try{requestMainCanvasRender?.();}catch(_){}return;}
        materializeDeferredLayerScene(frameCtx);
    }

    if(gpuBackendAllowed&&effect.application==='graffiti'&&effect.prepared?.gpuMorphNative===true){
        if(frameCtx.frame?.gpuLayerSceneDeferred){
            const scene=SomataLayerSceneService.resident(frameCtx);let rec=null;
            if(scene?.texture){
                mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
                const g=frameCtx.effectsPlan?.glow;if(g?.enabled===true){const glowOpts={radiusPx:Math.max(.5,(Number(g.amount)||0)*.55*frameCtx.frame.dpr),alphaScale:Math.max(0,Number(g.compositeAlpha)||0),composite:'source-over'};const grec=effect.tunnelActive
                    ? WebGPUGraffitiMorphRenderer.encodeCorridorGlowToLayerScene?.(scene.texture,effect.prepared,graffitiStyleLayer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,glowOpts)
                    : WebGPUGraffitiMorphRenderer.encodeGlowToLayerScene?.(scene.texture,effect.prepared,graffitiStyleLayer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,glowOpts,frameCtx);
                    if(grec?.handled){noteGraffitiContourGlowOutcome(frameCtx,true);if(grec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',32),grec.commandBuffer,effect.tunnelActive?'graffiti-morph-contour-glow-corridor':'graffiti-morph-contour-glow',grec.onSubmitted);renderBackendTelemetry.mark('glow','gpu','exact Morph Graffiti contour Glow');}
                    else{noteGraffitiContourGlowOutcome(frameCtx,false);const gst=WebGPUGraffitiMorphRenderer.status?.()||{},cst=typeof WebGPUGraffitiContourGlow!=='undefined'?WebGPUGraffitiContourGlow.status?.():null;noteProfileGpuFailure('graffiti','contour glow',gst.lastError||cst?.lastError||'Morph Graffiti contour Glow encode returned not handled',{renderer:gst,contourGlow:cst});}
                }
                rec=effect.tunnelActive
                    ? WebGPUGraffitiMorphRenderer.encodeCorridorToLayerScene(scene.texture,effect.prepared,graffitiStyleLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over')
                    : WebGPUGraffitiMorphRenderer.encodeToLayerScene(scene.texture,effect.prepared,graffitiStyleLayer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over',null,frameCtx);
                mainCtx.restore();
            }
            if(rec?.handled){renderBackendTelemetry.mark('profile','gpu','GPU-native Morph Graffiti');noteProfileGpuSuccess('graffiti',effect.tunnelActive?'morph corridor layer-scene':'morph layer-scene','webgpu-layer-scene');if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',40),rec.commandBuffer,effect.tunnelActive?'graffiti-morph-corridor':'graffiti-morph',rec.onSubmitted);return;}else{const st=WebGPUGraffitiMorphRenderer.status?.()||{};noteProfileGpuFailure('graffiti','morph layer-scene',st.lastError||st.diagnostic?.reason||'GPU-native Morph encode returned not handled');}
            if(strictSpiralProfileGpu){renderBackendTelemetry.mark('profile','gpu','Spiral profile GPU-only warmup');somataGpuContractError('SPIRAL_PROFILE_GPU_UNAVAILABLE',frameCtx,{profile:effect?.application||null});try{requestMainCanvasRender?.();}catch(_){}return;}
        materializeDeferredLayerScene(frameCtx);
        }
        somataGpuDiagnosticError('graffiti','morph-profile','GPU-native Morph Graffiti unavailable; pass skipped',frameCtx,{fallback:'skip-profile-pass',recovered:true});
        try{requestMainCanvasRender?.();}catch(_){}
        return;
    }

    if(frameCtx.frame?.gpuLayerSceneDeferred&&effect.application==='graffiti'&&effect.prepared?.gpuRibbonEligible===true){
        const scene=SomataLayerSceneService.resident(frameCtx);
        if(scene?.texture){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            const g=frameCtx.effectsPlan?.glow;if(g?.enabled===true){const glowOpts={radiusPx:Math.max(.5,(Number(g.amount)||0)*.55*frameCtx.frame.dpr),alphaScale:Math.max(0,Number(g.compositeAlpha)||0),composite:'source-over'};const grec=effect.tunnelActive
                ? WebGPUGraffitiRibbonRenderer.encodeCorridorGlowToLayerScene?.(scene.texture,effect.prepared,graffitiStyleLayer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,glowOpts)
                : WebGPUGraffitiRibbonRenderer.encodeGlowToLayerScene?.(scene.texture,effect.prepared,graffitiStyleLayer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,glowOpts);
                if(grec?.handled){noteGraffitiContourGlowOutcome(frameCtx,true);if(grec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',32),grec.commandBuffer,effect.tunnelActive?'graffiti-ribbon-contour-glow-corridor':'graffiti-ribbon-contour-glow');renderBackendTelemetry.mark('glow','gpu','exact Graffiti ribbon contour Glow');}
                else{noteGraffitiContourGlowOutcome(frameCtx,false);const gst=WebGPUGraffitiRibbonRenderer.status?.()||{},cst=typeof WebGPUGraffitiContourGlow!=='undefined'?WebGPUGraffitiContourGlow.status?.():null;noteProfileGpuFailure('graffiti','contour glow',gst.lastError||cst?.lastError||'Graffiti ribbon contour Glow encode returned not handled',{renderer:gst,contourGlow:cst});}
            }
            const rec=effect.tunnelActive
                ? WebGPUGraffitiRibbonRenderer.encodeCorridorToLayerScene(scene.texture,effect.prepared,graffitiStyleLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over')
                : WebGPUGraffitiRibbonRenderer.encodeToLayerScene(scene.texture,effect.prepared,graffitiStyleLayer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over');
            mainCtx.restore();
            if(rec?.handled){renderBackendTelemetry.mark('profile','gpu','GPU Graffiti ribbon');noteProfileGpuSuccess('graffiti',effect.tunnelActive?'ribbon corridor layer-scene':'ribbon layer-scene','webgpu-layer-scene');if(rec.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('geometry',40),rec.commandBuffer,effect.tunnelActive?'graffiti-variable-corridor':'graffiti-variable');return;}else{const st=WebGPUGraffitiRibbonRenderer.status?.()||{};noteProfileGpuFailure('graffiti','ribbon layer-scene',st.lastError||st.diagnostic?.reason||'GPU ribbon encode returned not handled',{gpuRibbonEligible:effect.prepared?.gpuRibbonEligible===true});}
        }
        if(strictSpiralProfileGpu){renderBackendTelemetry.mark('profile','gpu','Spiral profile GPU-only warmup');somataGpuContractError('SPIRAL_PROFILE_GPU_UNAVAILABLE',frameCtx,{profile:effect?.application||null});try{requestMainCanvasRender?.();}catch(_){}return;}
        materializeDeferredLayerScene(frameCtx);
    }

    if(gpuBackendAllowed&&effect.application==='graffiti'&&effect.prepared?.gpuRibbonEligible===true){
        mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
        const g=frameCtx.effectsPlan?.glow;if(g?.enabled===true){const glowOpts={radiusPx:Math.max(.5,(Number(g.amount)||0)*.55*frameCtx.frame.dpr),alphaScale:Math.max(0,Number(g.compositeAlpha)||0),composite:'source-over'};const grec=effect.tunnelActive
            ? WebGPUGraffitiRibbonRenderer.drawCorridorGlowToOverlay?.(effect.prepared,graffitiStyleLayer,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,glowOpts)
            : WebGPUGraffitiRibbonRenderer.drawGlowToOverlay?.(effect.prepared,graffitiStyleLayer,Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,glowOpts);
            if(grec?.handled){noteGraffitiContourGlowOutcome(frameCtx,true);renderBackendTelemetry.mark('glow','gpu','exact Graffiti overlay contour Glow');}else{noteGraffitiContourGlowOutcome(frameCtx,false);const gst=WebGPUGraffitiRibbonRenderer.status?.()||{},cst=typeof WebGPUGraffitiContourGlow!=='undefined'?WebGPUGraffitiContourGlow.status?.():null;noteProfileGpuFailure('graffiti','overlay contour glow',gst.lastError||cst?.lastError||'GPU overlay contour Glow unavailable',{renderer:gst,contourGlow:cst});}
        }
        const rec=effect.tunnelActive
            ? WebGPUGraffitiRibbonRenderer.drawCorridorToOverlay(effect.prepared,graffitiStyleLayer,baseAlpha,mainCtx,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,'source-over')
            : WebGPUGraffitiRibbonRenderer.drawToOverlay(effect.prepared,graffitiStyleLayer,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),mainCtx,'source-over');
        mainCtx.restore();
        if(rec?.handled){renderBackendTelemetry.mark('profile','gpu','GPU Graffiti overlay');noteProfileGpuSuccess('graffiti',effect.tunnelActive?'ribbon corridor overlay':'ribbon overlay','webgpu-overlay');return;}
        const st=WebGPUGraffitiRibbonRenderer.status?.()||{};const why=st.lastError||st.diagnostic?.reason||(st.available?'overlay draw returned not handled':'GPU Graffiti pipeline unavailable/warming');noteProfileGpuFailure('graffiti','overlay',why,{renderer:st});renderBackendTelemetry.mark('profile','gpu',st.lastError?`GPU-only Graffiti unavailable: ${st.lastError}`:'GPU-only Graffiti warming');return;
    }

    if(gpuBackendAllowed&&effect.application==='stroke'&&effect.prepared?.type!=='round'){
        if(WebGPUProfileMarkerRenderer.isReady()){
            mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);
            let ok=false;
            if(effect.tunnelActive)ok=WebGPUProfileMarkerRenderer.renderCorridor(effect.prepared?.table,layer,baseAlpha,mainCtx,effect.prepared,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,markerCoreOpts);
            else{const a=baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1)));ok=WebGPUProfileMarkerRenderer.render(effect.prepared?.table,layer,a,mainCtx,effect.prepared,markerCoreOpts);}
            mainCtx.restore();if(ok){renderBackendTelemetry.mark('profile','gpu','GPU profile markers');noteProfileGpuSuccess('dash',effect.tunnelActive?'marker corridor draw':'marker draw','webgpu');return;}const st=WebGPUProfileMarkerRenderer.status?.()||{};noteProfileGpuFailure('dash',effect.tunnelActive?'marker corridor draw':'marker draw',st.lastError||st.diagnostic?.reason||(st.available?'GPU marker render returned false':'GPU marker renderer unavailable'),{renderer:st});
        }else{const st=WebGPUProfileMarkerRenderer.status?.()||{};noteProfileGpuFailure('dash','marker ready',st.lastError||st.diagnostic?.reason||(st.initializing?'GPU marker pipeline warming':'GPU marker renderer unavailable'),{renderer:st});}
    }
    if(effect.application==='graffiti'){
        const rs=WebGPUGraffitiRibbonRenderer.status?.()||{},ms=WebGPUGraffitiMorphRenderer.status?.()||{};
        noteProfileGpuFailure('graffiti','profile exhausted',rs.lastError||ms.lastError||'no eligible Graffiti GPU renderer handled this frame',{ribbon:rs,morph:ms});
        somataGpuDiagnosticError('graffiti','profile','GPU profile skipped; no CPU/Canvas fallback',frameCtx,{fallback:'skip-profile-pass',recovered:true});
        try{requestMainCanvasRender?.();}catch(_){}
        return;
    }
    const ds=WebGPUProfileMarkerRenderer.status?.()||{};
    noteProfileGpuFailure('dash','profile exhausted',ds.lastError||ds.diagnostic?.reason||'GPU marker renderer unavailable',{renderer:ds});
    somataGpuDiagnosticError('profile','markers','GPU markers skipped; no CPU/Canvas fallback',frameCtx,{fallback:'skip-profile-pass',recovered:true});
    try{requestMainCanvasRender?.();}catch(_){}

}


SomataFeatureHost.provide('profile','sceneAdmission',(frameCtx)=>{
    const effect=frameCtx?.effectsPlan?.profile;if(!effect?.enabled)return true;
    if(effect.application==='stroke')return{admit:['slash','square','circle','cross'].includes(effect.prepared?.type)&&WebGPUProfileMarkerRenderer.isReady(),reason:'profile marker renderer unavailable'};
    if(effect.application!=='graffiti')return{admit:false,reason:'profile application cannot join Layer Scene'};
    if(effect.prepared?.gpuMorphNative===true)return{admit:Boolean(typeof WebGPUGraffitiMorphRenderer!=='undefined'&&WebGPUGraffitiMorphRenderer.canEncode?.(effect.prepared)),reason:'Morph Graffiti renderer unavailable'};
    return{admit:effect.prepared?.gpuRibbonEligible===true&&(effect.tunnelActive?WebGPUGraffitiRibbonRenderer.canEncodeCorridor(frameCtx?.layer,effect.prepared):WebGPUGraffitiRibbonRenderer.canEncode(frameCtx?.layer,effect.prepared)&&WebGPUGraffitiRibbonRenderer.isReady()),reason:'Graffiti ribbon renderer unavailable'};
});

SomataFeatureHost.provide('profile','frameBegin',({renderFrame,displayLayers,gpuBackendAllowed,width,height})=>{
    const liveGraffitiVisible=(displayLayers||[]).some(l=>l?.visible!==false&&liveEffectOwnerForFrameLayer(l)?.lineProfileApplication==='graffiti');
    if(gpuBackendAllowed)WebGPUGraffitiRibbonRenderer.beginOverlayFrame?.(renderFrame?.id,width,height,liveGraffitiVisible);
    try{if(gpuBackendAllowed&&liveGraffitiVisible)WebGPUGraffitiMorphRenderer?.warmup?.();}catch(_){}
    return null;
});

window.SomataRenderPassRegistry?.register?.('profile',{stage:window.SomataRenderPassRegistry.STAGES.POST_BASE,order:20,run:renderLayerProfilePass});
