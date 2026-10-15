window.__spiroRegisterModule?.('js/render/outline-plan');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('outline',{domain:'appearance',plans:['outline','motion','sprite'],reads:['_baseStrokeCommitted','_webgpuStrokeBatch','_geometryContract'],outputs:[]});

function resetOutlineEffectPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    p.enabled=false;p.graffiti=false;p.gpuMorphNative=false;p.paths=null;p.profilePrepared=null;p.outlineLayer=null;p.coreLayer=null;p.baseLineWidth=0;p.extra=0;p.width=0;p.color='#ffffff';p.join='round';p.footprint=0;p.tunnelActive=false;p.mode='outer';p.outerAdd=0;p.coreInset=0;
    return p;
}

function resolveLayerOutlineEffectProvider(frameCtx,plan){
    const layer=frameCtx.layer;
    plan.enabled=state.lineOutline?.enabled===true&&getLayerLineVisible(frameCtx.effectLayer||liveEffectOwnerForFrameLayer(layer))&&frameCtx.geometryPlan?.kind!=='lightning';
    plan.tunnelActive=state.tunnel.active===true;
    if(!plan.enabled)return plan;
    plan.baseLineWidth=Math.max(.001,frameCtx.strokeWidth);
    plan.extra=Math.max(.1,Math.min(30,audioApplyNumeric('outline.width',Number(state.lineOutline.width)||1.5,frameCtx.layerIndex)));
    plan.color=state.lineOutline.color||'#ffffff';
    plan.mode=['outer','inner','median'].includes(state.lineOutline?.mode)?state.lineOutline.mode:'outer';
    plan.outerAdd=plan.mode==='outer'?plan.extra:(plan.mode==='median'?plan.extra*.5:0);
    plan.coreInset=plan.mode==='inner'?plan.extra:(plan.mode==='median'?plan.extra*.5:0);
    plan.join=(layer.lineJoinType||'rounded')==='straight'?'miter':'round';
    plan.graffiti=frameCtx.lineProfileApplication==='graffiti';
    if(plan.graffiti){

        const gpuBackendAllowed=typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed();
        const nativePrepared=gpuBackendAllowed&&typeof prepareGpuMorphGraffitiFrame==='function'?prepareGpuMorphGraffitiFrame(frameCtx):null;
        if(nativePrepared){plan.gpuMorphNative=true;plan.paths=null;plan.profilePrepared=nativePrepared;}
        else if(SomataGeometryPolicy.isStrict(frameCtx)){plan.enabled=false;const reason=SomataGeometryPolicy.ineligibleReason(frameCtx,'outline','exact geometry Web rail unavailable');if(!/warming/i.test(String(reason||'')))somataGpuDiagnosticError('web','strict-spiral-authority',String(reason||'exact geometry Web rail unavailable'),frameCtx,{fallback:'wait-for-exact-spiral-rail',recovered:false,authority:window.__spiroGpuMorphArcStatus?.()?.lastDecision||null});try{requestMainCanvasRender?.();}catch(_){ }return plan;}
        else{plan.paths=getLayerFrameAuxiliaryPaths(frameCtx);if(plan.paths?.length)plan.profilePrepared=prepareLayerFrameProfileData(frameCtx);}
        if(plan.profilePrepared){
            plan.width=plan.baseLineWidth+plan.outerAdd*2;
            const graffitiStyle=liveGraffitiStyleLayerForFrame(frameCtx)||layer;
            plan.outlineLayer={...graffitiStyle,strokeColor:plan.color,strokeWidth:plan.width,strokeWidthMultiplier:1,glow:0,glowMultiplier:1,glowIntensity:0,glowIntensityMultiplier:1};
            const coreWidth=Math.max(.001,plan.baseLineWidth-plan.coreInset*2);
            plan.coreLayer=plan.coreInset>0?{...graffitiStyle,strokeWidth:coreWidth,strokeWidthMultiplier:1,glow:0,glowMultiplier:1,glowIntensity:0,glowIntensityMultiplier:1}:null;
            plan.footprint=Math.max(plan.width,Math.max(0,Number(layer.glow)||0)*getLayerGlowMultiplier(layer)*.55);
        }
    }
    return plan;
}

SomataFeatureHost?.provide?.('outline','effectPlan',(frameCtx,previousPlans)=>resolveLayerOutlineEffectProvider(frameCtx,resetOutlineEffectPlan(previousPlans?.outline)));
SomataFeatureHost?.provide?.('outline','graphPass',(frameCtx,plans)=>{const plan=plans?.outline;return{name:'outline',caps:SPIRO_PATH_CAPS.POSITIONS,active:plan?.enabled===true,backend:'gpu'};});
SomataFeatureHost?.provide?.('outline','resetEffectPlan',plans=>resetOutlineEffectPlan(plans?.outline));

SomataFeatureHost?.provide?.('outline','strokeBatchSpec',(frameCtx,plans)=>{
    const outline=plans?.outline,markerProfile=frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='stroke';
    if(outline?.enabled!==true||outline.graffiti===true||markerProfile)return[];
    const mode=['outer','inner','median'].includes(outline.mode)?outline.mode:'outer',outerAdd=Math.max(0,Number(outline.outerAdd)||0),coreInset=Math.max(0,Number(outline.coreInset)||0),out=[];
    out.push({role:'outline',mode:'outline',extraLocal:outerAdd,baseLineWidth:outline.baseLineWidth,colorOverride:outline.color,alphaScale:1,composite:mode==='outer'?'destination-over':'source-over'});
    if(coreInset>0)out.push({role:'core',mode:'coreInset',extraLocal:coreInset,baseLineWidth:outline.baseLineWidth,alphaScale:1,composite:'source-over'});
    return out;
});
SomataFeatureHost?.provide?.('outline','strokeBatchScene',(frameCtx,plans)=>{
    const outline=plans?.outline,markerProfile=frameCtx?.lineProfileStrokeOnly===true&&frameCtx?.lineProfileApplication==='stroke';
    if(outline?.enabled!==true||outline.graffiti===true||markerProfile)return null;
    const mode=['outer','inner','median'].includes(outline.mode)?outline.mode:'outer',single=frameCtx?.layerIndex===0&&frameCtx?.frame?.renderLayerCount===1;
    return{includeOutline:mode!=='outer'||single,includeCore:Math.max(0,Number(outline.coreInset)||0)>0,outlineBehind:mode==='outer'};
});
