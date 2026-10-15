window.__spiroRegisterModule?.('js/render/green-role-adapter');
(function(){
    function eligible(frameCtx,role='base'){return Boolean((role==='base'||role==='glow')&&WebGPUGreenProjectMorphRenderer?.isEligible?.(frameCtx)===true);}
    function renderGlowBase(frameCtx,ctx2d,opts={}){if(frameCtx?.geometryPlan?.kind==='green-fade'||!eligible(frameCtx,'glow'))return false;return WebGPUGreenProjectMorphRenderer.renderGlowAndBase?.(frameCtx,ctx2d,opts)===true;}
    function renderGlow(frameCtx,ctx2d,opts={}){return eligible(frameCtx,'glow')&&WebGPUGreenProjectMorphRenderer.render?.(frameCtx,ctx2d,opts)===true;}
    function renderBase(frameCtx,ctx2d){return eligible(frameCtx,'base')&&WebGPUGreenProjectMorphRenderer.render?.(frameCtx,ctx2d,{mode:'base',alphaScale:Math.max(0,Math.min(1,Number(frameCtx?.lineOpacityFactor??1)))})===true;}
    SomataGeometryRoleService.register('green',{nativePriority:100,eligible,renderGlowBase,renderGlow,renderBase,nativeEligible(frameCtx){return eligible(frameCtx,'base');},warmup(){try{WebGPUGreenProjectMorphRenderer?.warmup?.();}catch(_){}}},200);
})();
