window.__spiroRegisterModule?.('js/render/geometry-scene-routing');

// Presentation routing is deliberately isolated from effect modules.
// It owns scene-root compatibility for retained geometry and Corridor, while
// appearance/effect passes talk only to SomataGeometryRoleService.
// Geometry routing policy retained behind the semantic role service.
function isBlueSpiralGpuMorphKind(kind){return kind==='blue-circle-slide'||kind==='blue-prepared';}
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

    if(requiresExternal&&WebGPUStrokeRenderer.canUseExternalLayerScene?.(id)!==true)return noteSomataSpiralRootDecision(frameCtx,true,false,'external-layer-scene-unavailable',batch);
    if(multi&&WebGPUStrokeRenderer.canUseFrameScene?.(id)!==true)return noteSomataSpiralRootDecision(frameCtx,requiresExternal,false,'frame-scene-unavailable',batch);

    if(requiresExternal&&WebGPUFinalCompositeRenderer.canDeferLayerScene(frameCtx.frame,true)!==true)return noteSomataSpiralRootDecision(frameCtx,true,false,'final-compositor-not-ready',batch);
    return noteSomataSpiralRootDecision(frameCtx,requiresExternal,true,requiresExternal?'ready':'internal-gpu-scene-ready',batch);
}
function canDeferLayerSceneForFrame(frameCtx,batch){
    return isStrictSpiralWebGPUFrame(frameCtx)?canDeferStrictSpiralLayerSceneRoot(frameCtx,batch,false):canDeferLayerSceneDirect(frameCtx,batch);
}
function ensureStrictSpiralEffectLayerSceneRoot(frameCtx){
    if(!isStrictSpiralWebGPUFrame(frameCtx)||!frameCtx?.frame)return false;

    const residentRoot=SomataLayerSceneService.resident(frameCtx);
    if(residentRoot?.texture)return true;

    const baseWillOwnScene=frameCtx.lineDisplayEnabled===true&&frameCtx.lineProfileStrokeOnly!==true&&!isPathFxBaseReplacementActive(frameCtx);

    const rootContract=getLayerGeometryContract(frameCtx),orderedWebUnderBase=frameCtx.effectsPlan?.web?.enabled===true;
    const orderedSceneRoot=orderedWebUnderBase||rootContract?.fillRequested===true||state.tunnel?.active===true;
    if((baseWillOwnScene&&!orderedSceneRoot)||frameCtx._webgpuStrokeBatch?.sceneCombined)return false;

    if(!spiralGpuEffectsRequested(frameCtx))return false;
    const pseudo={sceneCombined:true,sceneTexture:{},roles:new Set(),outlineInScene:false};
    if(!canDeferStrictSpiralLayerSceneRoot(frameCtx,pseudo,true))return false;
    if(SomataLayerSceneService.ensure(frameCtx,'strict-spiral-effects')?.texture){
        frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;frameCtx._strictSpiralEmptyLayerSceneRoot=true;
        renderBackendTelemetry.mark('geometry','gpu','strict Spiral transparent GPU effect root');return true;
    }
    try{WebGPUStrokeRenderer.warmup?.();requestMainCanvasRender?.();}catch(_){}return false;
}

function hasStrictSpiralPresentationIntent(displayLayers){
    return typeof SomataGeometryPolicy!=='undefined'&&SomataGeometryPolicy.hasStrictEntryIntent?.(displayLayers)===true;
}
function isStrictSpiralWebGPUFrame(frameCtx){
    return typeof SomataGeometryPolicy!=='undefined'&&SomataGeometryPolicy.isStrict?.(frameCtx)===true;
}
window.__somataSpiralPresentationPolicy=()=>({strict:false,policy:'specialized WebGPU Spiral is preferred when available; general GPU presentation is the mandatory fallback; stale-frame retention is forbidden'});
function spiralGpuEffectsRequested(frameCtx){
    const e=frameCtx?.effectsPlan||{};
    // Fill is a first-class retained Spiral scene participant. Without this, a fill-only
    // Morph never opens the external Layer Scene, so the retained Base later has nowhere
    // to join and the fill disappears until Corridor happens to create a scene root.
    try{if(getLayerGeometryContract(frameCtx)?.fillRequested===true)return true;}catch(_){}
    if(e.glow?.enabled===true||e.outline?.enabled===true||e.profile?.enabled===true||e.motion?.enabled===true||e.sweep?.enabled===true||e.sprite?.enabled===true||e.web?.enabled===true||e.lamps?.enabled===true)return true;
    const gc=getLiveGeometryCircleConfig(frameCtx);if(gc?.enabled===true&&(gc.circumscribed||gc.inscribed||gc.median||gc.keyPoints))return true;
    try{const effectLayer=frameCtx?.effectLayer||liveEffectOwnerForFrameLayer(frameCtx?.layer);if(typeof normalizeParticleConfig==='function'&&normalizeParticleConfig(effectLayer?.particles)?.enabled===true)return true;}catch(_){}
    return false;
}
function canUseGpuSpiralBezierLayerScene(frameCtx,allowHiddenGraffitiCarrier=false){
    const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='graffiti';
    if(!frameCtx?.prepared||state.showRoundingGuides||(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)||!frameCtx.lineDisplayEnabled)return false;
    const staticSpiral=Boolean(!frameCtx.morphFrameActive&&frameCtx.geometryPlan?.dynamic!==true&&typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer));
    if(!isBlueSpiralGpuMorphKind(frameCtx.geometryPlan?.kind)&&!staticSpiral)return false;
    const eligibilityMode=hiddenGraffitiCarrier?'glow':'base';
    if(typeof WebGPUSpiralBezierMorphRenderer==='undefined'||WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,eligibilityMode)!==true)return false;
    if(typeof WebGPUStrokeRenderer==='undefined')return false;
    const resident=SomataLayerSceneService.resident(frameCtx);
    if(!resident?.texture&&!SomataLayerSceneService.canOpen(frameCtx))return false;
    if(shouldForceCanvasBaseStroke(frameCtx)&&!isStrictSpiralWebGPUFrame(frameCtx))return false;
    const contract=getLayerGeometryContract(frameCtx);if(contract?.fillRequested===true&&!resident?.texture)return false;
    const pseudo={sceneCombined:true,sceneTexture:{},roles:new Set([hiddenGraffitiCarrier?'glow':'base']),outlineInScene:false};

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

function canUseGpuSpiralBezierFrameScene(frameCtx){

    if(frameCtx?.morphFrameActive===true)return false;
    if(!frameCtx?.prepared||Number(frameCtx.frame?.renderLayerCount||0)<2||state.showRoundingGuides||frameCtx.lineProfileStrokeOnly||!frameCtx.lineDisplayEnabled)return false;
    const staticSpiral=Boolean(!frameCtx.morphFrameActive&&frameCtx.geometryPlan?.dynamic!==true&&state.tunnel?.active!==true&&typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer));
    if(!isBlueSpiralGpuMorphKind(frameCtx.geometryPlan?.kind)&&!staticSpiral)return false;
    if(typeof WebGPUSpiralBezierMorphRenderer==='undefined'||WebGPUSpiralBezierMorphRenderer.isEligible?.(frameCtx,'base')!==true)return false;
    const api=typeof WebGPUStrokeRenderer!=='undefined'?WebGPUStrokeRenderer:null;
    if(!api||api.canUseFrameScene?.(frameCtx.frameId)!==true||typeof api.getExternalFrameSceneTarget!=='function'||typeof api.deferExternalFrameScene!=='function')return false;
    if(shouldForceCanvasBaseStroke(frameCtx)&&!isStrictSpiralWebGPUFrame(frameCtx))return false;
    const contract=getLayerGeometryContract(frameCtx);if(contract?.fillRequested===true)return false;
    const e=frameCtx.effectsPlan||{};
    if(e.outline?.enabled===true||e.profile?.enabled===true||e.motion?.enabled===true||e.sweep?.enabled===true||e.sprite?.enabled===true||e.web?.enabled===true||e.lamps?.enabled===true)return false;
    try{const effectLayer=frameCtx?.effectLayer||liveEffectOwnerForFrameLayer(frameCtx?.layer);if(typeof normalizeParticleConfig==='function'&&normalizeParticleConfig(effectLayer?.particles)?.enabled===true)return false;}catch(_){}
    const gc=getLiveGeometryCircleConfig(frameCtx);if(gc?.enabled===true&&(gc.circumscribed||gc.inscribed||gc.median||gc.keyPoints))return false;
    return true;
}

function getResidentGpuLayerScene(frameCtx){
    const rec=SomataLayerSceneService.resident(frameCtx);
    return rec?.texture?rec:null;
}

function stabilizeWebUnderBaseStack(frameCtx){
    const resident=frameCtx?._webPassHandled===true?getResidentGpuLayerScene(frameCtx):null;
    if(!resident?.texture)return false;
    const batch=frameCtx._webgpuStrokeBatch,hiddenGraffiti=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
    const canStayResident=Boolean(
        (batch?.sceneCombined&&batch?.preserveExistingScene===true&&canDeferLayerSceneForFrame(frameCtx,batch))||
        canUseGpuOnlyCorridorLayerScene(frameCtx,hiddenGraffiti)||
        canUseGpuSpiralBezierLayerScene(frameCtx,hiddenGraffiti)
    );
    if(canStayResident)return true;
    // Some older specialized Morph renderers still present directly to Canvas2D. Materialize Web
    // once before them, then rebuild the batch with a clear root. This is the correctness fallback,
    // not the steady-state path.
    if(materializeDeferredLayerScene(frameCtx)){
        frameCtx._webMaterializedUnderBase=true;frameCtx.frame.gpuMainCanvasHasContent=true;
        SomataStrokeBatchService.prepare(frameCtx);
        renderBackendTelemetry.mark('web','gpu','Web materialized once before non-resident Line backend');
        return false;
    }
    try{WebGPUStrokeRenderer.clearDeferredLayerScene?.();}catch(_){}
    frameCtx.frame.gpuLayerSceneDeferred=false;clearLayerSceneEffectCommands(frameCtx.frame);try{requestMainCanvasRender?.();}catch(_){}
    return false;
}




// Corridor semantic geometry role adapter.
function canUseGpuOnlyCorridorLayerScene(frameCtx,allowHiddenGraffitiCarrier=false){
    const hiddenGraffitiCarrier=allowHiddenGraffitiCarrier===true&&frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='graffiti';
    if(!frameCtx?.prepared||state.tunnel?.active!==true||state.showRoundingGuides||(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)||!frameCtx.lineDisplayEnabled)return false;
    if(frameCtx.geometryPlan?.kind==='lightning')return false;

    if(frameCtx.geometryPlan?.dynamic===true&&Number(frameCtx.frame?.renderLayerCount||0)>3)return false;
    const strictSpiralCorridor=isStrictSpiralWebGPUFrame(frameCtx);

    if((state.tunnel?.colorShiftEnabled===true||state.tunnel?.paletteLagEnabled===true)&&!strictSpiralCorridor)return false;

    if(shouldForceCanvasBaseStroke(frameCtx)&&!strictSpiralCorridor)return false;

    const residentScene=getResidentGpuLayerScene(frameCtx);
    if(residentScene?.texture)return true;
    const contract=getLayerGeometryContract(frameCtx);
    if(contract?.fillRequested===true&&!canAttachNativeCorridorFillToLayerScene(frameCtx,contract))return false;
    const e=frameCtx.effectsPlan||{};

    if(!strictSpiralCorridor&&e.particles?.enabled===true)return false;
    if(!WebGPUStrokeRenderer.canUseExternalLayerScene?.(frameCtx.frameId))return false;
    const pseudo={sceneCombined:true,sceneTexture:{},roles:new Set(['base']),outlineInScene:false};

    return (strictSpiralCorridor?canDeferStrictSpiralLayerSceneRoot(frameCtx,pseudo,true):canDeferLayerSceneDirect(frameCtx,pseudo))===true;
}
function getGpuOnlyCorridorMaster(frameCtx,allowHiddenGraffitiCarrier=false){
    const spiral=isSpiralLayer(frameCtx.layer);if(spiral&&!canUseSpiralCorridorMasterInstancing(frameCtx))return null;

    if(frameCtx.geometryPlan?.dynamic===true)return getDynamicTunnelMorphMasterStrokeCommands(frameCtx,allowHiddenGraffitiCarrier);
    return getTunnelMasterStrokeCommands(frameCtx,allowHiddenGraffitiCarrier);
}
function encodeGpuOnlyCorridorLayerRole(frameCtx,role,extra={},clearScene=false,allowHiddenGraffitiCarrier=false){
    if(!canUseGpuOnlyCorridorLayerScene(frameCtx,allowHiddenGraffitiCarrier))return null;const master=getGpuOnlyCorridorMaster(frameCtx,allowHiddenGraffitiCarrier);if(!master?.length)return null;
    const copies=frameCtx.visibleInstances?.copies||[];if(!copies.length)return{handled:true,commandBuffer:null};
    const opt=buildCorridorGPUOptions(frameCtx,{...extra,copyCacheVariant:`layer-scene-${role}-${frameCtx.geometryPlan?.dynamic===true?'morph':'static'}`,weightForCopy:null,deferComposite:true,dynamicSegments:frameCtx.geometryPlan?.dynamic===true,layerSceneRole:role,layerSceneClear:clearScene,forceResidentCopyPayload:true});
    return WebGPUStrokeRenderer.renderCorridor(master,copies,null,opt);
}

function describeBaseGpuFallback(frameCtx,batch,forceCanvasBase=false){
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



window.SomataRenderPassRegistry?.registerHook?.('afterStrokeBatch','web-stack-stabilize',frameCtx=>{try{return stabilizeWebUnderBaseStack(frameCtx);}catch(err){try{spiroPassIsolationNoteFailure?.('webStack',err,frameCtx);}catch(_){}return null;}});
