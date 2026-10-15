window.__spiroRegisterModule?.('js/render/glow-plan');

// Self-owned feature contract: changing this feature does not require editing the host.
SomataFeatureHost.register('glow',{domain:'appearance',plans:['glow'],reads:['_webPassHandled','_webgpuStrokeBatch','_geometryContract'],outputs:['_baseStrokeCommitted','_corridorLayerSceneActive','_fusedMorphBackend','_graffitiContourGlowCommitted','_graffitiContourGlowPending']});

function resetGlowEffectPlan(plan){
    const p=plan&&typeof plan==='object'?plan:{};
    p.enabled=false;p.amount=0;p.compositeAlpha=0;p.tunnelActive=false;p.tunnelGlowScale=1;p.panX=0;p.panY=0;p.zoom=1;p.rotationRad=0;
    return p;
}

function resolveLayerGlowEffectProvider(frameCtx,plan){
    const layer=frameCtx.layer,glowOwner=frameCtx.effectLayer||layer,dpr=frameCtx.frame.dpr;
    const intensityBase=Math.max(0,(Number.isFinite(Number(glowOwner?.glowIntensity))?Number(glowOwner.glowIntensity):40)/100);
    const intensity=intensityBase*getLayerGlowIntensityMultiplier(glowOwner);
    const compositeAlpha=(frameCtx.minimalFadeEnabled?0.72:frameCtx.baseAlpha*0.72)*intensity;
    plan.amount=Math.max(0,Number(frameCtx.glow)||0);
    plan.compositeAlpha=compositeAlpha;
    plan.tunnelActive=state.tunnel.active===true;
    plan.tunnelGlowScale=plan.tunnelActive?1/Math.max(1,dpr):1;
    plan.panX=(Number(state.panX)||0)+(Number(frameCtx.frame?.motionPanX)||0);plan.panY=(Number(state.panY)||0)+(Number(frameCtx.frame?.motionPanY)||0);plan.zoom=Number(state.zoom)||1;plan.rotationRad=Number(frameCtx.frame?.motionRotationRad)||0;
    plan.enabled=frameCtx.lineDisplayEnabled&&plan.amount>0&&compositeAlpha>.001;
    return plan;
}

SomataFeatureHost?.provide?.('glow','effectPlan',(frameCtx,previousPlans)=>resolveLayerGlowEffectProvider(frameCtx,resetGlowEffectPlan(previousPlans?.glow)));
SomataFeatureHost?.provide?.('glow','graphPass',(frameCtx,plans)=>{const plan=plans?.glow;return{name:'glow',caps:SPIRO_PATH_CAPS.POSITIONS,active:plan?.enabled===true,backend:'gpu'};});
SomataFeatureHost?.provide?.('glow','resetEffectPlan',plans=>resetGlowEffectPlan(plans?.glow));

SomataFeatureHost?.provide?.('glow','strokeBatchSpec',(frameCtx,plans)=>{
    const glow=plans?.glow;
    if(glow?.enabled!==true||frameCtx?.lineProfileStrokeOnly===true)return[];
    return[{role:'glow',mode:'glow',radiusPx:Math.max(.5,(Number(glow.amount)||0)*.55*(Number(frameCtx?.frame?.dpr)||1)),alphaScale:Math.max(0,Number(glow.compositeAlpha)||0),composite:'source-over'}];
});
