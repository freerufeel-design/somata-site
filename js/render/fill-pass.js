window.__spiroRegisterModule?.('js/render/fill-pass');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('fill',{domain:'appearance',plans:['glow'],reads:['_geometryContract','_fillMeshShadow','_webgpuStrokeBatch'],outputs:['_baseFillCommitted','_corridorLayerSceneActive','_corridorNativeFillPreflight','_nativeFillMeshCandidate','_spiralFillGlowScenePrepared','_spiralFillScenePrepared','_webgpuFillPrepared','_fillBelowWebResolved','_fillRenderedBelowWeb','_suppressLateFillForWeb']});

function shouldForceCanvasStaticFill(frameCtx){
    return false;
}

const fillRuntimeDiagnostic={
    frameId:0,layerId:null,requested:false,handled:false,stage:'idle',backend:'none',reason:'',
    fillAlpha:0,fillContourCount:0,closedPathCount:0,openPathCount:0,hasClosedFillTopology:false,
    nativeCandidate:false,nativeComplete:false,gpuMaskEligible:false,lastUpdatedAt:0
};
const fillFailureSignatures=new Set();
const fillWarmupStartedAtByLayer=new Map();
const FILL_WARMUP_GRACE_MS=2500;
function isFillGpuWarming(frameCtx){
    // Cold GPU startup is asynchronous, not a permanent Fill failure. Unlike a
    // generic skip, this branch expires and exposes a real failure in diagnostics.
    let status=null;
    try{status=FillGPURenderer.status?.()||null;}catch(_){return false;}
    const mesh=status?.nativeMesh||{},mask=status?.webgpuMask||{};
    const nativePending=mesh.initializing===true&&mesh.available!==true&&!mesh.lost&&!mesh.lastError;
    const maskPending=mask.initializing===true&&mask.available!==true&&!mask.lost&&!mask.lastError;
    const maskHasSurface=mask.available===true&&Number(mask.width)>0&&Number(mask.height)>0;
    // A ready mask *device* with a 0×0 surface cannot composite anything yet.
    // Don't classify this first-frame GPU lifecycle as a permanent Fill error
    // while the native backend is still initializing. The 2.5s grace still
    // expires, so a genuine persistent failure remains diagnosable.
    const warming=Boolean(!mesh.lost&&!mask.lost&&
        (nativePending||maskPending||(!maskHasSurface&&mask.available===true&&Number(mask.width)===0&&Number(mask.height)===0&&mesh.initializing===true))&&
        mesh.available!==true&&!mesh.lastError&&!mask.lastError);
    const id=String(frameCtx?.effectLayer?.id||frameCtx?.layer?.id||'unknown');
    if(!warming){fillWarmupStartedAtByLayer.delete(id);return false;}
    const now=performance.now();
    if(!fillWarmupStartedAtByLayer.has(id))fillWarmupStartedAtByLayer.set(id,now);
    return now-fillWarmupStartedAtByLayer.get(id)<FILL_WARMUP_GRACE_MS;
}
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
    if(!fillFailureSignatures.has(sig)){fillFailureSignatures.add(sig);console.warn(`[SpiroStar Fill] NOT DRAWN @ ${stage}: ${msg}`,{...fillRuntimeDiagnostic});}
}


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


function tryRenderLayerFillGPU(frameCtx){
    if(!FillGPURenderer.isAvailable())return false;
    const contract=getLayerGeometryContract(frameCtx),strictGeometry=SomataGeometryRoleService.isStrict(frameCtx);
    // Ordinary Static and Dynamic Fill use the same frame-resident Line carrier. Specialized
    // Spiral/Corridor adapters remain authoritative for their geometry families.
    let sharedOrdinary=state.tunnel?.active!==true&&!strictGeometry&&Boolean(SomataFrameContourService?.current?.(frameCtx));
    if(contract?.fillRequested&&contract?.nativeGpuFillEligible===true&&state.tunnel?.active!==true){
        const lineMesh=SomataFillGeometryAdapter.query('directMesh',frameCtx);
        sharedOrdinary=sharedOrdinary||Boolean(state.tunnel?.active!==true&&!strictGeometry&&SomataFrameContourService?.current?.(frameCtx));
        if(lineMesh?.nativeComplete&&FillGPURenderer.renderMesh(frameCtx,lineMesh,mainCtx)){
            frameCtx._nativeFillMeshCandidate=lineMesh;
            fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;geometryContractStats.nativeMeshFill++;return true;
        }
        // A claimed FrameContour forbids a different Fill boundary fallback.
        if(sharedOrdinary)return false;
    }
    if(contract?.fillRequested&&FillMeshPreparer.canUseNative(frameCtx)){
        const mesh=frameCtx._nativeFillMeshCandidate||frameCtx._fillMeshShadow;
        if(mesh?.complete&&FillGPURenderer.renderMesh(frameCtx,mesh,mainCtx)){
            fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;geometryContractStats.nativeMeshFill++;return true;
        }
    }

    if(strictGeometry)return false;
    const prepared=frameCtx?._webgpuFillPrepared||prepareLayerFillMaskGPU(frameCtx);if(!prepared)return false;if(frameCtx&&!frameCtx._webgpuFillPrepared)frameCtx._webgpuFillPrepared=prepared;
    if(prepared.empty)return true;
    if(prepared.authoritative!==true||!prepared.mask){fillMaskValidationStats.canvasFallback++;return false;}
    const ok=FillGPURenderer.render(prepared.mask,prepared.fillStyle,mainCtx);if(ok){fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;}else fillMaskValidationStats.canvasFallback++;return ok;
}



// Corridor/retained-geometry Fill integration.
function getDynamicCorridorFillMesh(frameCtx){
    if(frameCtx?.geometryPlan?.dynamic!==true||state.tunnel?.active!==true)return null;
    if(frameCtx._corridorNativeFillPreflight?.dynamic===true&&Number(frameCtx._corridorNativeFillPreflight.frameId)===Number(frameCtx.frameId))return frameCtx._corridorNativeFillPreflight;
    const commands=getDynamicTunnelMorphMasterStrokeCommands?.(frameCtx,true);
    if(!commands?.length)return null;
    const mesh=FillMeshPreparer.prepareDynamicCommands?.(frameCtx,commands)||null;
    if(mesh?.nativeComplete){
        frameCtx._corridorNativeFillPreflight=mesh;
        frameCtx._nativeFillMeshCandidate=mesh;
        return mesh;
    }
    return null;
}

function canAttachNativeCorridorFillToLayerScene(frameCtx,contract=null){
    const c=contract||getLayerGeometryContract(frameCtx);
    if(c?.fillRequested!==true)return true;
    if(c.nativeGpuFillEligible!==true)return false;
    const sharedMaster=SomataFillGeometryAdapter.query('corridorMesh',frameCtx);
    const mesh=sharedMaster||(frameCtx?.geometryPlan?.dynamic===true
        ? getDynamicCorridorFillMesh(frameCtx)
        : (frameCtx?._fillMeshShadow||FillMeshPreparer.prepareFrame?.(frameCtx)));
    if(!mesh?.nativeComplete||!(Number(mesh.fanTriangleCount)>0))return false;
    if(typeof FillGPURenderer==='undefined')return false;
    try{FillGPURenderer.isAvailable?.();}catch(_){}
    if(FillGPURenderer.canEncodeMeshToTexture?.(frameCtx,mesh)!==true)return false;
    frameCtx._corridorNativeFillPreflight=mesh;
    frameCtx._nativeFillMeshCandidate=mesh;
    return true;
}


function tryOpenGpuCorridorFillLayerScene(frameCtx){
    const contract=getLayerGeometryContract(frameCtx);
    if(!contract?.fillRequested||state.tunnel?.active!==true)return{handled:false,required:false,reason:'not a Corridor Fill'};
    if(contract.nativeGpuFillEligible!==true)return{handled:false,required:true,reason:'Corridor Fill has no native GPU topology for this frame'};

    const interwindingMesh=SomataFillGeometryAdapter.query('corridorMesh',frameCtx);
    const mesh=interwindingMesh||frameCtx?._corridorNativeFillPreflight||frameCtx?._fillMeshShadow||
        (frameCtx?.geometryPlan?.dynamic===true?getDynamicCorridorFillMesh(frameCtx):FillMeshPreparer.prepareFrame?.(frameCtx));
    if(!mesh?.nativeComplete||!mesh?.fanTriangleCount){

        const specialPolicy=SomataFillGeometryAdapter.query('missingCorridorPolicy',frameCtx,contract);
        if(specialPolicy)return specialPolicy;
        return{handled:false,required:true,reason:'canonical native Fill mesh unavailable'};
    }
    try{FillGPURenderer.isAvailable?.();}catch(_){}
    if(!FillGPURenderer.canEncodeMeshToTexture?.(frameCtx,mesh))return{handled:false,required:true,reason:'native WebGPU Fill pipeline warming/unavailable'};

    const plan=SomataEffectStackOrder?.plan?.(frameCtx)||null;
    const resident=SomataLayerSceneService.resident(frameCtx);
    let rootSeed=!resident?.texture&&plan?.fillCanSeedRoot===true;
    let target=resident?.texture?resident:(rootSeed?SomataLayerSceneService.target(frameCtx,'corridor-native-fill-root'):SomataLayerSceneService.ensure(frameCtx,'corridor-native-fill'));
    if(rootSeed&&!target?.texture){rootSeed=false;target=SomataLayerSceneService.ensure(frameCtx,'corridor-native-fill');}
    if(!target?.texture)return{handled:false,required:true,reason:'GPU Layer Scene target unavailable'};
    const preserve=Boolean(resident?.texture||!rootSeed);
    // A preserving native Fill may not load the persistent MSAA scratch: that would
    // accumulate previous frames.  Render the Fill into a clean isolated texture and
    // composite it once over the resident Layer Scene.  Root Fill can keep the faster
    // direct path because it owns/clears the target.
    const rec=preserve
        ?(mesh?.corridorBaked===true?FillGPURenderer.encodeMeshIsolatedCommandToTexture?.(target.texture,frameCtx,mesh,mainCtx,false):FillGPURenderer.encodeCorridorMeshIsolatedCommandToTexture?.(target.texture,frameCtx,mesh,mainCtx,false))
        :(mesh?.corridorBaked===true?FillGPURenderer.encodeMeshCommandToTexture?.(target.texture,frameCtx,mesh,mainCtx,false):FillGPURenderer.encodeCorridorMeshCommandToTexture?.(target.texture,frameCtx,mesh,mainCtx,false));
    if(!rec?.handled)return{handled:false,required:true,reason:rec?.reason||FillGPURenderer.status?.()?.nativeMesh?.lastError||'Corridor Fill encode failed'};
    if(rec.commandBuffer){
        const accepted=rootSeed?SomataLayerSceneService.queueAsRoot(frameCtx,somataEffectPhase('fill'),rec.commandBuffer,'corridor-native-fill'):SomataLayerSceneService.queue(frameCtx,somataEffectPhase('fill'),rec.commandBuffer,'corridor-native-fill');
        if(!accepted)return{handled:false,required:true,reason:resident?.texture?'Corridor Fill command could not join resident Layer Scene':'Corridor Fill command could not become Layer Scene root'};
        SomataLayerSceneService.markDeferred(frameCtx,{mainSceneEmpty:false});frameCtx._corridorLayerSceneActive=true;
    }
    frameCtx._nativeFillMeshCandidate=mesh;
    return{handled:true,required:true,deferred:Boolean(rec.commandBuffer),joinedResident:Boolean(resident?.texture),triangles:Number(rec.triangles||0)+Number(rec.windingTriangles||0)};
}


// When Web is enabled on ordinary geometry, Fill must be a real scene pass below Web,
// not an attachment hidden inside the later Base batch. This gives the physical order:
// Fill -> Web -> Glow/Base/Profile/Sweep. The Fill mesh still comes from the same Line
// FrameContour, so ordering does not create another geometry source.
function prepareOrdinaryFillBelowWeb(frameCtx){
    if(state.tunnel?.active===true||SomataGeometryPolicy.isStrict(frameCtx))return null;
    const plan=SomataEffectStackOrder?.plan?.(frameCtx)||null;
    // Default/no-Web fast path: keep Fill inside the existing stroke batch. Separate Fill
    // only when Web is active or the chosen artistic order needs Fill independent of Geometry.
    if(plan?.standaloneFill!==true){frameCtx._fillBelowWebResolved=true;frameCtx._fillRenderedBelowWeb=false;frameCtx._suppressLateFillForWeb=false;return null;}
    const contract=getLayerGeometryContract(frameCtx);
    if(contract?.fillRequested!==true){frameCtx._fillBelowWebResolved=true;frameCtx._fillRenderedBelowWeb=true;frameCtx._suppressLateFillForWeb=false;return{handled:true,required:false,empty:true,reason:'no Fill requested'};}
    const mesh=SomataFillGeometryAdapter.query('directMesh',frameCtx);
    if(!mesh?.nativeComplete||!(Number(mesh.fanTriangleCount)>0)){
        frameCtx._fillBelowWebResolved=true;frameCtx._fillRenderedBelowWeb=false;frameCtx._suppressLateFillForWeb=true;
        noteFillFailureOnce(frameCtx,'web-order-preflight','shared Line-carrier Fill mesh unavailable; Web waits so it cannot render below Fill');
        return{handled:false,required:true,reason:'shared Line-carrier Fill mesh unavailable'};
    }
    const scene=SomataLayerSceneService.ensure(frameCtx,'fill-ordered');
    if(!scene?.texture){frameCtx._fillBelowWebResolved=true;frameCtx._fillRenderedBelowWeb=false;frameCtx._suppressLateFillForWeb=true;try{FillGPURenderer.isAvailable?.();}catch(_){}return{handled:false,required:true,reason:'Layer Scene unavailable for ordered Fill'};}
    // ensure() has already queued the transparent root clear, so ordered Fill must load
    // that target instead of clearing away a lower user-ordered effect.
    // Ordered Fill must preserve lower effect groups, but preserving the target must
    // never mean preserving the Fill renderer's multisample scratch across frames.
    const out=FillGPURenderer.encodeMeshIsolatedCommandToTexture?.(scene.texture,frameCtx,mesh,mainCtx,false);
    if(!out?.handled){frameCtx._fillBelowWebResolved=true;frameCtx._fillRenderedBelowWeb=false;frameCtx._suppressLateFillForWeb=true;try{FillGPURenderer.isAvailable?.();}catch(_){}return{handled:false,required:true,reason:out?.reason||'Fill Layer Scene encode unavailable'};}
    const accepted=!out.commandBuffer||SomataLayerSceneService.queue(frameCtx,somataEffectPhase('fill'),out.commandBuffer,'fill-ordered');
    if(!accepted){frameCtx._fillBelowWebResolved=true;frameCtx._fillRenderedBelowWeb=false;frameCtx._suppressLateFillForWeb=true;return{handled:false,required:true,reason:'Fill Layer Scene queue failed'};}
    frameCtx._nativeFillMeshCandidate=mesh;frameCtx._baseFillCommitted=true;frameCtx._fillBelowWebResolved=true;frameCtx._fillRenderedBelowWeb=true;frameCtx._suppressLateFillForWeb=false;
    frameCtx._webgpuFillPrepared={mask:null,fillStyle:contract.fillStyle,empty:false,authoritative:true,nativeMesh:true,orderedBelowWeb:true};
    renderBackendTelemetry.mark('fill','gpu','shared FrameContour ordered Fill');
    noteFillRuntime(frameCtx,{handled:true,stage:'fill-ordered',backend:'webgpu-native-scene',reason:'',nativeCandidate:true});
    return{handled:true,required:true,mesh,reason:''};
}

// Retained-geometry Fill, optional Glow, and Base share one Layer Scene.
// Geometry-family details are delegated to SomataFillGeometryAdapter.
function prepareRetainedFillSceneBeforeGlow(frameCtx){
    const ordered=prepareOrdinaryFillBelowWeb(frameCtx);if(ordered?.required||ordered?.handled)return ordered;
    const glowRequested=frameCtx?.effectsPlan?.glow?.enabled===true;
    if(state.tunnel?.active===true){
        const special=SomataFillGeometryAdapter.query('retainedScene',frameCtx,{glowRequested});
        if(special?.handled||special?.required)return special;
        const rec=tryOpenGpuCorridorFillLayerScene(frameCtx);
        if(rec?.handled){frameCtx._baseFillCommitted=true;frameCtx._spiralFillGlowScenePrepared=true;frameCtx._spiralFillScenePrepared=true;}
        return rec||{handled:false,required:false,reason:'Corridor Fill not requested'};
    }
    return SomataFillGeometryAdapter.query('retainedScene',frameCtx,{glowRequested})||{handled:false,required:false,reason:'ordinary Line batch owns Fill'};
}


// Public Fill boundary used by Base/compositor. Base receives only a compact Fill plan
// and never selects Fill renderers or inspects native/mask backends itself.
const SomataFillPassService=(()=>{
    const stats={begins:0,resolves:0,sceneCommits:0,sceneSplits:0,gpuCommits:0,misses:0};
    function prepareBatchAttachment(frameCtx,strictGeometry=false){
        const contract=getLayerGeometryContract(frameCtx),forceCanvasFill=shouldForceCanvasStaticFill(frameCtx);
        let nativeMeshCandidate=null;
        let sharedOrdinary=state.tunnel?.active!==true&&!strictGeometry&&Boolean(SomataFrameContourService?.current?.(frameCtx));
        if(!forceCanvasFill&&contract?.fillRequested===true){
            if(state.tunnel?.active!==true&&contract.nativeGpuFillEligible===true){
                nativeMeshCandidate=SomataFillGeometryAdapter.query('directMesh',frameCtx);
                // directMesh itself is allowed to be the first FrameContour consumer.
                // Re-check AFTER the query so a failed shared mesh can never fall through
                // to an older independently reconstructed Fill boundary.
                sharedOrdinary=sharedOrdinary||Boolean(!strictGeometry&&SomataFrameContourService?.current?.(frameCtx));
            }
            // 7.8: once ordinary FrameContour exists, Fill may not fall back to a
            // separately prepared static/dynamic contour.
            if(!nativeMeshCandidate&&!sharedOrdinary&&FillMeshPreparer.canUseNative(frameCtx)){
                nativeMeshCandidate=frameCtx._fillMeshShadow;
            }
        }
        const nativeCandidate=Boolean(nativeMeshCandidate?.nativeComplete&&Number(nativeMeshCandidate?.fanTriangleCount)>0);
        frameCtx._nativeFillMeshCandidate=nativeCandidate?nativeMeshCandidate:null;
        const prepared=(forceCanvasFill||(strictGeometry&&!nativeCandidate))?null:(nativeCandidate?{mask:null,fillStyle:contract.fillStyle,empty:false,authoritative:false,nativeMesh:true}:prepareLayerFillMaskGPU(frameCtx));
        if(prepared)frameCtx._webgpuFillPrepared=prepared;
        const nativeMesh=nativeCandidate&&FillGPURenderer.canEncodeMeshToTexture(frameCtx,frameCtx._nativeFillMeshCandidate)?frameCtx._nativeFillMeshCandidate:null;
        return{contract,prepared,nativeCandidate,sceneFillMask:prepared?.authoritative===true?prepared.mask:null,sceneNativeFill:nativeMesh,fillStyle:prepared?.fillStyle||contract?.fillStyle||null};
    }
    function begin(frameCtx,batch,strictGeometry=false,forceCanvasBase=false){
        stats.begins++;
        const contract=getLayerGeometryContract(frameCtx),forceCanvasFill=shouldForceCanvasStaticFill(frameCtx),fillPrepared=frameCtx?._webgpuFillPrepared;
        const sceneHasAuthoritativeFill=batch?.fillInScene===true&&(fillPrepared?.authoritative===true||batch?.nativeFillInScene===true)&&(!strictGeometry||batch?.nativeFillInScene===true);
        const fillAlreadyCommitted=frameCtx?._baseFillCommitted===true,effectOrderPlan=SomataEffectStackOrder?.plan?.(frameCtx)||null;
        // When the artistic stack requires Fill to be independent from Geometry, Base is
        // not allowed to recover a missed Fill by drawing it late.  Doing so would silently
        // merge/reorder the two layers and could cover Web or any other group between them.
        const standaloneFillRequired=effectOrderPlan?.standaloneFill===true;
        const orderedFillMiss=frameCtx?._suppressLateFillForWeb===true||(standaloneFillRequired&&contract?.fillRequested===true&&!fillAlreadyCommitted);
        const needsOutOfSceneFill=contract?.fillRequested===true&&!orderedFillMiss&&!sceneHasAuthoritativeFill&&!fillAlreadyCommitted;
        const canKeepGpuSceneOverCanvasFill=Boolean(!strictGeometry&&forceCanvasFill&&!forceCanvasBase&&batch?.sceneCombined&&canDeferLayerSceneDirect(frameCtx,batch));
        if(fillAlreadyCommitted)noteFillRuntime(frameCtx,{handled:true,stage:'fill-ordered',backend:'webgpu-native-scene',reason:'',nativeCandidate:Boolean(frameCtx?._nativeFillMeshCandidate)});
        else noteFillRuntime(frameCtx,{handled:false,stage:'contract',backend:'none',reason:'',nativeCandidate:Boolean(frameCtx?._nativeFillMeshCandidate)});
        return{contract,forceCanvasFill,fillPrepared,sceneHasAuthoritativeFill,needsOutOfSceneFill,canKeepGpuSceneOverCanvasFill,strictGeometry:Boolean(strictGeometry)};
    }
    function markSceneCommitted(frameCtx,batch,plan,stage='layer-scene'){
        if(plan?.contract?.fillRequested!==true||plan?.sceneHasAuthoritativeFill!==true)return false;
        const mask=plan?.fillPrepared?.authoritative===true&&plan?.fillPrepared?.mask&&!batch?.nativeFillInScene;
        if(mask)renderBackendTelemetry.mark('fill','canvas','Canvas fill-rule mask');
        renderBackendTelemetry.mark('fill','gpu',batch?.nativeFillInScene===true?'native WebGPU fill':'resident GPU fill-mask composite');
        noteFillRuntime(frameCtx,{handled:true,stage,backend:batch?.nativeFillInScene===true?'webgpu-native-scene':'webgpu-mask-scene',reason:''});
        stats.sceneCommits++;return true;
    }
    function noteStrictDeferred(frameCtx,reason='Fill unavailable; Base remains GPU-resident'){
        renderBackendTelemetry.mark('fill','gpu','strict geometry Fill deferred; Canvas split forbidden');
        noteFillRuntime(frameCtx,{handled:false,stage:'retained-gpu-deferred',backend:'webgpu',reason});
    }
    function noteSceneSplit(){fillMaskValidationStats.sceneSplit++;geometryContractStats.sceneSplitForFill++;stats.sceneSplits++;}
    function resolve(frameCtx,batch,plan,layerSceneCompositeFailed=false){
        stats.resolves++;
        const contract=plan?.contract||getLayerGeometryContract(frameCtx),forceCanvasFill=plan?.forceCanvasFill===true,sceneHasAuthoritativeFill=plan?.sceneHasAuthoritativeFill===true;
        const effectOrderPlan=SomataEffectStackOrder?.plan?.(frameCtx)||null;
        const standaloneFillRequired=effectOrderPlan?.standaloneFill===true;
        if((frameCtx?._suppressLateFillForWeb===true||standaloneFillRequired)&&contract?.fillRequested===true&&frameCtx?._baseFillCommitted!==true){
            noteFillRuntime(frameCtx,{handled:false,stage:'ordered-fill-retry',backend:'webgpu',reason:'ordered Fill unavailable this frame; late Fill suppressed to preserve the configured effect stack'});
            // No self-invalidation on failed ordered Fill: wait for GPU-ready callback
            // or a genuine state change, otherwise strict Spiral can redraw forever.
            return false;
        }
        const fillUsesCanvasMask=Boolean(frameCtx?._webgpuFillPrepared?.authoritative===true&&frameCtx?._webgpuFillPrepared?.mask&&!batch?.nativeFillInScene);
        let fillHandled=frameCtx._baseFillCommitted===true||(forceCanvasFill?false:(sceneHasAuthoritativeFill&&!layerSceneCompositeFailed));
        if(fillHandled&&frameCtx._baseFillCommitted!==true){
            fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;if(batch?.nativeFillInScene===true)geometryContractStats.nativeMeshFill++;
            if(contract?.fillRequested){
                if(fillUsesCanvasMask)renderBackendTelemetry.mark('fill','canvas','Canvas fill-rule mask');
                renderBackendTelemetry.mark('fill','gpu',batch?.nativeFillInScene===true?'native WebGPU fill':'GPU fill-mask composite');
                noteFillRuntime(frameCtx,{handled:true,stage:'layer-scene',backend:batch?.nativeFillInScene===true?'webgpu-native-scene':'webgpu-mask-scene',reason:''});
            }
            stats.gpuCommits++;
        } else if(!fillHandled&&!forceCanvasFill){
            const corridorFill=state.tunnel?.active===true?tryOpenGpuCorridorFillLayerScene(frameCtx):null;
            if(corridorFill?.suppressed){
                fillHandled=true;renderBackendTelemetry.mark('fill','gpu','dynamic Corridor Fill skipped: geometry adapter reported no closed topology');
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
                renderBackendTelemetry.mark('fill','gpu','Corridor Fill GPU-only wait');
                noteFillRuntime(frameCtx,{handled:false,stage:'corridor-gpu-wait',backend:'webgpu',reason:corridorFill.reason||'GPU Fill unavailable'});
                somataGpuDiagnosticError('fill','corridor-native-fill',corridorFill.reason||'GPU Fill unavailable',frameCtx,{fallback:'skip-fill-pass',recovered:true,fill:FillGPURenderer.status?.()||null});
                // Do not spin an unbounded frame loop while the backend remains unavailable.
                // GPU ready/lost callbacks and user changes request their own redraws.
            }
        }
        if(!fillHandled&&contract?.fillRequested){
            if(isFillGpuWarming(frameCtx)){
                noteFillRuntime(frameCtx,{handled:false,stage:'gpu-warming',backend:'webgpu',reason:'GPU Fill initialization pending; repaint on ready'});
                // The WebGPU Fill initializers request a new frame when ready. Do not
                // spin a CPU render loop or misreport the very first frame as a crash.
                return false;
            }
            fillMaskValidationStats.canvasFallback++;stats.misses++;
            const g=contract?.geometry||{};let reason='GPU Fill backends returned false';
            if(frameCtx?.geometryPlan?.dynamic!==true&&g.hasClosedFillTopology!==true)reason=`no closed fill topology (closed=${Number(g.closedPathCount)||0}, open=${Number(g.openPathCount)||0}, fillContours=${Number(g.fillContourCount)||0})`;
            else{try{const fs=FillGPURenderer.status?.();const e=fs?.nativeMesh?.lastError||fs?.webgpuMask?.lastError||fs?.webgl2?.lastError;if(e)reason=String(e);}catch(_){} }
            noteFillFailureOnce(frameCtx,'gpu-backend-chain',reason);
            somataGpuDiagnosticError('fill','gpu-only',reason,frameCtx,{fallback:'skip-fill-pass',recovered:true,fillStatus:FillGPURenderer.status?.()||null,fillContract:{requested:contract?.fillRequested===true,nativeEligible:contract?.nativeGpuFillEligible===true,maskEligible:contract?.gpuMaskEligible===true,closedContours:Number(g?.closedPathCount)||0,fillContours:Number(g?.fillContourCount)||0},fillRuntime:{...fillRuntimeDiagnostic}});
            // A permanent GPU-only Fill failure must NOT self-invalidate the entire
            // scene every frame. Actual renderer lifecycle callbacks request repaint.
        }
        if(fillHandled){
            frameCtx._baseFillCommitted=true;
            fillWarmupStartedAtByLayer.delete(String(frameCtx?.effectLayer?.id||frameCtx?.layer?.id||'unknown'));
        }
        return fillHandled;
    }
    function status(){return{...stats,contract:'Base consumes a compact Fill plan; Fill renderer selection, diagnostics and fallback policy are owned only by fill-pass.js.'};}
    return{prepareBatchAttachment,begin,markSceneCommitted,noteStrictDeferred,noteSceneSplit,resolve,status};
})();
window.SomataFillPassService=SomataFillPassService;
window.__somataFillPassServiceStatus=()=>SomataFillPassService.status();

window.SomataRenderPassRegistry?.register?.('fill',{stage:window.SomataRenderPassRegistry.STAGES.FILL,order:10,run:prepareRetainedFillSceneBeforeGlow});
