window.__spiroRegisterModule?.('js/render/spiral-fill-adapter');

// Spiral-specific Fill bridge. This is the only render module allowed to translate
// retained Spiral/Morph rails into Fill meshes and to seed their shared Layer Scene.
function somataSpiralFillMorphT(frameCtx){
    if(frameCtx?.spiralEditMorph&&Number.isFinite(Number(frameCtx.spiralEditMorph.progress)))return Number(frameCtx.spiralEditMorph.progress);
    if(Number.isFinite(Number(frameCtx?.blueMorphProvider?.geometryT)))return Number(frameCtx.blueMorphProvider.geometryT);
    if(Number.isFinite(Number(frameCtx?.geometryPlan?.progress)))return Number(frameCtx.geometryPlan.progress);
    return Number(runtimeState?.morph?.geometryT)||0;
}
function somataSpiralFillAuxPaths(frameCtx){
    let paths=null;try{paths=typeof getGpuSpiralBezierMorphAuxPaths==='function'?getGpuSpiralBezierMorphAuxPaths(frameCtx.layerIndex,somataSpiralFillMorphT(frameCtx),frameCtx):null;}catch(_){paths=null;}return paths;
}
function somataSpiralMorphFillMesh(frameCtx){
    if((frameCtx?.geometryPlan?.dynamic!==true&&!frameCtx?.spiralEditMorph)||!isSpiralLayer(frameCtx?.layer)||frameCtx?.layer?.spiralClosed===false)return null;
    const paths=somataSpiralFillAuxPaths(frameCtx);if(!paths?.length)return null;
    return FillMeshPreparer.prepareSpiralMorphBands?.(frameCtx,paths)||null;
}
function somataSpiralCorridorFillMesh(frameCtx){
    if(!isSpiralLayer(frameCtx?.layer)||frameCtx?.layer?.spiralFillEnabled!==true||frameCtx?.layer?.spiralFillType!=='interwinding'||state.tunnel?.active!==true)return null;
    const aux=frameCtx?.geometryPlan?.dynamic===true?somataSpiralFillAuxPaths(frameCtx):null;
    return FillMeshPreparer.prepareInterwindingCorridor?.(frameCtx,aux)||null;
}
function somataSpiralMissingCorridorPolicy(frameCtx,contract){
    if(frameCtx?.geometryPlan?.dynamic===true&&contract?.spiral===true)return{handled:false,required:false,suppressed:true,reason:'dynamic Spiral Corridor has no closed native Fill contour'};
    return null;
}
function somataPrepareRetainedSpiralFillScene(frameCtx,{glowRequested=false}={}){
    const contract=getLayerGeometryContract(frameCtx);
    if(contract?.fillRequested!==true)return null;
    if(frameCtx?._spiralBezierMorphGpuNative!==true)return null;
    if(SomataGeometryRoleService.canRenderRole(frameCtx,'base')!==true)return{handled:false,required:false,reason:'retained geometry Base role not active'};
    if(glowRequested&&SomataGeometryRoleService.canRenderRole(frameCtx,'glow')!==true)return{handled:false,required:true,reason:'retained geometry Glow role not active'};
    if(state.tunnel?.active===true)return null; // generic Corridor path owns scene composition
    if(contract.nativeGpuFillEligible!==true)return{handled:false,required:true,reason:'retained Spiral Fill has no native GPU topology for this frame'};
    const mesh=(frameCtx?.geometryPlan?.dynamic===true||frameCtx?.spiralEditMorph)?somataSpiralMorphFillMesh(frameCtx):(frameCtx?._nativeFillMeshCandidate||frameCtx?._fillMeshShadow||FillMeshPreparer.prepareFrame?.(frameCtx));
    if(!mesh?.nativeComplete||!(Number(mesh.fanTriangleCount)>0))return{handled:false,required:true,reason:'native retained Spiral Fill mesh unavailable'};
    try{FillGPURenderer.isAvailable?.();}catch(_){}
    if(!FillGPURenderer.canEncodeMeshToTexture?.(frameCtx,mesh))return{handled:false,required:true,reason:'native WebGPU Fill pipeline warming/unavailable'};
    const plan=SomataEffectStackOrder?.plan?.(frameCtx)||null;
    const resident=SomataLayerSceneService.resident(frameCtx);let rootSeed=!resident?.texture&&plan?.fillCanSeedRoot===true;
    let target=resident?.texture?resident:(rootSeed?SomataLayerSceneService.target(frameCtx,'retained-native-fill-root'):SomataLayerSceneService.ensure(frameCtx,'retained-native-fill'));
    if(rootSeed&&!target?.texture){rootSeed=false;target=SomataLayerSceneService.ensure(frameCtx,'retained-native-fill');}
    if(!target?.texture)return{handled:false,required:true,reason:'GPU Layer Scene target unavailable'};
    const preserve=Boolean(resident?.texture||!rootSeed);
    const rec=preserve?FillGPURenderer.encodeMeshIsolatedCommandToTexture?.(target.texture,frameCtx,mesh,mainCtx,false):FillGPURenderer.encodeMeshCommandToTexture?.(target.texture,frameCtx,mesh,mainCtx,false);
    if(!rec?.handled)return{handled:false,required:true,reason:rec?.reason||FillGPURenderer.status?.()?.nativeMesh?.lastError||'retained Fill encode failed'};
    if(rec.commandBuffer){
        const accepted=rootSeed?SomataLayerSceneService.queueAsRoot(frameCtx,somataEffectPhase('fill'),rec.commandBuffer,'retained-native-fill'):SomataLayerSceneService.queue(frameCtx,somataEffectPhase('fill'),rec.commandBuffer,'retained-native-fill');
        if(!accepted)return{handled:false,required:true,reason:resident?.texture?'retained Fill command could not join resident Layer Scene':'retained Fill command could not become Layer Scene root'};
        SomataLayerSceneService.markDeferred(frameCtx,{mainSceneEmpty:false});
    }
    frameCtx._nativeFillMeshCandidate=mesh;frameCtx._baseFillCommitted=true;frameCtx._spiralFillGlowScenePrepared=true;frameCtx._spiralFillScenePrepared=true;
    fillMaskValidationStats.gpuSuppression++;geometryContractStats.gpuFill++;geometryContractStats.nativeMeshFill++;
    renderBackendTelemetry.mark('fill','gpu',glowRequested?'native retained Fill seeded below Glow':'native retained Fill seeded below Base');
    noteFillRuntime(frameCtx,{handled:true,stage:glowRequested?'retained-pre-glow-layer-scene':'retained-pre-base-layer-scene',backend:'webgpu-native-retained-scene',reason:''});
    return{handled:true,required:true,deferred:Boolean(rec.commandBuffer),joinedResident:Boolean(resident?.texture),triangles:Number(rec.triangles||0)+Number(rec.windingTriangles||0)};
}
SomataFillGeometryAdapter.register('spiral',{
    directMesh(frameCtx){return somataSpiralMorphFillMesh(frameCtx);},
    corridorMesh(frameCtx){return somataSpiralCorridorFillMesh(frameCtx);},
    missingCorridorPolicy(frameCtx,contract){return somataSpiralMissingCorridorPolicy(frameCtx,contract);},
    retainedScene(frameCtx,opt){return somataPrepareRetainedSpiralFillScene(frameCtx,opt);}
},100);
window.__somataSpiralFillGlowPolicy=()=>({fillPhase:somataEffectPhase('fill'),glowPhase:somataEffectPhase('geometry',10),basePhase:somataEffectPhase('geometry',20),scene:'shared-layer-scene',fillWithoutGlow:true,semantic:'Spiral adapter owns retained Fill topology; artistic stack owns compositor phases'});
