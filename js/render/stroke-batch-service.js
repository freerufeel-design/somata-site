window.__spiroRegisterModule?.('js/render/stroke-batch-service');

// Shared stroke-batch compositor. It owns the mechanical WebGPU batch construction,
// while Base/Glow/Outline own their role specs through FeatureHost capabilities.
// Adding an effect therefore does not require adding another branch to main-pipeline.js.
const SomataStrokeBatchService=(()=>{
    const stats={prepares:0,batches:0,nativeGeometrySkips:0,sharedCarrierBatches:0,roleSpecs:0,lastRoles:[]};
    function roleSpecs(frameCtx){
        const rows=SomataFeatureHost?.queryAll?.('strokeBatchSpec',frameCtx,frameCtx?.effectsPlan||{})||[],out=[];
        for(const row of rows){const value=row?.value;if(Array.isArray(value))for(const spec of value)if(spec&&typeof spec==='object')out.push(spec);}
        return out;
    }
    function sceneOptions(frameCtx){
        const rows=SomataFeatureHost?.queryAll?.('strokeBatchScene',frameCtx,frameCtx?.effectsPlan||{})||[];
        const out={includeOutline:false,includeCore:false,outlineBehind:false};
        for(const row of rows){const v=row?.value;if(!v||typeof v!=='object')continue;out.includeOutline=out.includeOutline||v.includeOutline===true;out.includeCore=out.includeCore||v.includeCore===true;out.outlineBehind=out.outlineBehind||v.outlineBehind===true;}
        return out;
    }
    function prepare(frameCtx){
        stats.prepares++;
        frameCtx._webgpuStrokeBatch=null;frameCtx._webgpuFillPrepared=null;frameCtx._nativeFillMeshCandidate=null;frameCtx._topologyMorphGpuNative=false;
        const strictSpiralBatch=SomataGeometryPolicy.isStrict(frameCtx);
        const pathFxNeeded=(SomataFeatureHost?.queryAll?.('strokeBatchDemand',frameCtx,frameCtx?.effectsPlan||{})||[]).some(r=>r?.value===true);
        if(!frameCtx?.prepared||state.showRoundingGuides||frameCtx.geometryPlan?.kind==='lightning'||(!frameCtx.lineDisplayEnabled&&!pathFxNeeded))return null;

        const hiddenGraffitiCarrier=frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
        const hiddenGraffitiMorphCarrier=frameCtx.morphFrameActive===true&&hiddenGraffitiCarrier;
        // If any ordinary consumer already requested FrameContour, that record becomes the
        // visible-Line authority too.  Native topology/green Base renderers must not draw a
        // second, slightly different contour beside Fill/Web/Graffiti/Lightning.
        const sharedRecord=SomataFrameContourService?.current?.(frameCtx)||null;
        const sharedAuthority=Boolean(sharedRecord?.commands?.length);frameCtx._sharedFrameContourRequired=sharedAuthority;
        const nativeGeometry=sharedAuthority?null:SomataGeometryRoleService.nativeBaseKind(frameCtx,{allowHiddenGraffitiCarrier:hiddenGraffitiMorphCarrier,warmup:true});
        if(nativeGeometry==='spiral'){frameCtx._spiralBezierMorphGpuNative=true;stats.nativeGeometrySkips++;return null;}
        if(nativeGeometry==='topology'){frameCtx._topologyMorphGpuNative=true;stats.nativeGeometrySkips++;return null;}
        if(nativeGeometry==='green'){stats.nativeGeometrySkips++;return null;}
        if(state.tunnel?.active===true)return null;
        WebGPUStrokeRenderer.warmup();if(!WebGPUStrokeRenderer.isReady())return null;
        const commands=sharedAuthority?sharedRecord.commands:getFrameGLStrokeCommands(frameCtx,hiddenGraffitiCarrier);if(!commands?.length)return null;
        if(sharedAuthority)stats.sharedCarrierBatches++;
        const specs=roleSpecs(frameCtx);stats.roleSpecs+=specs.length;stats.lastRoles=specs.map(s=>s.role);

        // Effect-stack ownership is structural, not inferred from whether the earlier Fill
        // pass happened to commit a transient flag.  If the artistic plan says Fill must be
        // standalone (for example Fill -> Web -> Geometry), the Geometry stroke batch is
        // forbidden from attaching Fill again.  This is what makes Fill and Line genuinely
        // separate layers while still allowing the no-Web fast path to fuse them.
        const effectOrderPlan=SomataEffectStackOrder?.plan?.(frameCtx)||null;
        const separateFill=effectOrderPlan?.standaloneFill===true;
        const orderedFill=separateFill||frameCtx._fillRenderedBelowWeb===true||frameCtx._suppressLateFillForWeb===true;
        const fill=orderedFill?{contract:getLayerGeometryContract(frameCtx),prepared:frameCtx._webgpuFillPrepared||null,nativeCandidate:Boolean(frameCtx._nativeFillMeshCandidate),sceneFillMask:null,sceneNativeFill:null,fillStyle:getLayerGeometryContract(frameCtx)?.fillStyle||null}:SomataFillPassService.prepareBatchAttachment(frameCtx,strictSpiralBatch),sceneFlags=sceneOptions(frameCtx);
        const residentScene=SomataLayerSceneService.resident(frameCtx);
        const sceneOpt={uniformKey:String(frameCtx.layer?.id||`layer-${frameCtx.layerIndex}`),fillMask:orderedFill?null:(fill?.sceneFillMask||null),fillStyle:fill?.fillStyle||null,nativeFillMesh:orderedFill?null:(fill?.sceneNativeFill||null),nativeFillFrameCtx:(!orderedFill&&fill?.sceneNativeFill)?frameCtx:null,...sceneFlags,preserveExistingScene:Boolean(residentScene?.texture)};
        const batch=WebGPUStrokeRenderer.renderLayerBatch(commands,specs,sceneOpt);if(batch?.roles?.size>=1){frameCtx._webgpuStrokeBatch=batch;stats.batches++;}return frameCtx._webgpuStrokeBatch;
    }
    function status(){return{...stats,lastRoles:stats.lastRoles.slice(),contract:'Somata 7.8: when FrameContour exists, the visible ordinary Line batch consumes the exact same command carrier; native topology/green bypass is disabled for that frame.'};}
    return{prepare,status};
})();
window.SomataStrokeBatchService=SomataStrokeBatchService;
window.__somataStrokeBatchStatus=()=>SomataStrokeBatchService.status();
