window.__spiroRegisterModule?.('js/render/compositor-policy');

// Composition policy is deliberately renderer-agnostic with respect to effects.
// Every feature owns its own admission rule and publishes it through SomataFeatureHost.
// This module only asks capabilities; it never imports Web/Lightning/Graffiti/etc renderers.
const somataCompositorPolicyStats={checks:0,featureChecks:0,featureRejects:0,lastReject:'',lastFeatures:[]};

function getLiveGeometryCircleConfig(frameCtx){
    const live=frameCtx?.effectLayer||liveEffectOwnerForFrameLayer(frameCtx?.layer)||frameCtx?.layer;
    return live?.geometryCircles&&typeof live.geometryCircles==='object'?live.geometryCircles:(frameCtx?.layer?.geometryCircles||null);
}
function canBridgeGeometryCirclesIntoLayerScene(frameCtx){
    const cfg=getLiveGeometryCircleConfig(frameCtx);if(cfg?.enabled!==true||(!cfg.circumscribed&&!cfg.inscribed&&!cfg.median&&!cfg.keyPoints))return true;
    if(state.showRoundingGuides)return false;
    const data=getLayerGeometryCircleFrameData(frameCtx);return Boolean(data?.commands?.length&&WebGPUStrokeRenderer.canEncodeGeometryCirclesToLayerScene?.(data.commands));
}
function normalizeSceneAdmission(value){
    if(value===undefined||value===null)return{admit:true,requiresFinalComposite:false};
    if(typeof value==='boolean')return{admit:value,requiresFinalComposite:false};
    return{admit:value.admit!==false,requiresFinalComposite:value.requiresFinalComposite===true,reason:String(value.reason||'')};
}
function collectFeatureSceneAdmissions(frameCtx,batch){
    const rows=SomataFeatureHost?.queryAll?.('sceneAdmission',frameCtx,{batch})||[];let requiresFinalComposite=false;
    somataCompositorPolicyStats.lastFeatures=[];
    for(const row of rows){
        const r=row.error?{admit:false,requiresFinalComposite:false,reason:`${row.name} capability failed: ${row.error}`} : normalizeSceneAdmission(row.value);somataCompositorPolicyStats.featureChecks++;
        somataCompositorPolicyStats.lastFeatures.push({name:row.name,admit:r.admit,requiresFinalComposite:r.requiresFinalComposite,reason:r.reason||''});
        if(!r.admit){somataCompositorPolicyStats.featureRejects++;somataCompositorPolicyStats.lastReject=r.reason||`${row.name}:scene-admission`;return{admit:false,requiresFinalComposite:false};}
        requiresFinalComposite=requiresFinalComposite||r.requiresFinalComposite;
    }
    return{admit:true,requiresFinalComposite};
}
function canDeferLayerSceneDirect(frameCtx,batch){
    somataCompositorPolicyStats.checks++;
    if(!batch?.sceneCombined||!batch?.sceneTexture||!frameCtx?.frame)return false;
    if(state.showBoundingCircle)return false;
    const multi=Number(frameCtx.frame.renderLayerCount||0)>1;if(multi&&!WebGPUStrokeRenderer.canUseFrameScene?.(frameCtx.frameId))return false;
    if(!canBridgeGeometryCirclesIntoLayerScene(frameCtx))return false;
    const features=collectFeatureSceneAdmissions(frameCtx,batch);if(!features.admit)return false;
    const gpuBaseRequired=Boolean(batch?.roles?.has?.('base')&&!shouldForceCanvasBaseStroke(frameCtx));
    return WebGPUFinalCompositeRenderer.canDeferLayerScene(frameCtx.frame,features.requiresFinalComposite||gpuBaseRequired);
}

window.__somataCompositorPolicyStatus=()=>({...somataCompositorPolicyStats,contract:'Compositor queries feature capabilities only; effect renderer implementations remain inside their own modules.'});
