window.__spiroRegisterModule?.('js/render/effect-owner-service');

// Neutral ownership/style service for render-time layer views.
// This used to live in main-pipeline.js, which made every effect module depend
// on the compositor for basic layer ownership. Keeping it here removes that
// inverted dependency: the compositor and effects are siblings using one small service.
const SomataEffectOwnerService=(()=>{
    function ownerForLayer(layer){
        try{return (typeof getLayerEffectOwner==='function'?getLayerEffectOwner(layer):(typeof ensureLayerEffectState==='function'?ensureLayerEffectState(layer):null))||layer||null;}
        catch(_){return layer||null;}
    }
    function graffitiStyleLayer(frameCtx){
        const base=frameCtx?.layer||null,fx=frameCtx?.effectLayer||ownerForLayer(base)||base;
        if(!base||!fx||fx===base)return base||fx;
        const out=frameCtx._liveGraffitiStyleLayer||(frameCtx._liveGraffitiStyleLayer={});
        Object.assign(out,base);
        out.motionRotation=fx.motionRotation??base.motionRotation;
        out.lineProfileGraffiti=fx.lineProfileGraffiti;out.graffitiAngle=fx.graffitiAngle;out.graffitiAngleMode=fx.graffitiAngleMode;out.graffitiNibShape=fx.graffitiNibShape;out.graffitiNibLength=fx.graffitiNibLength;out.graffitiNibLengthMultiplier=fx.graffitiNibLengthMultiplier;
        out.graffitiVariationMode=fx.graffitiVariationMode;out.graffitiVariationEveryN=fx.graffitiVariationEveryN;out.graffitiSizeVariationEnabled=fx.graffitiSizeVariationEnabled;out.graffitiSizeVariation=fx.graffitiSizeVariation;out.graffitiSizeFocus=fx.graffitiSizeFocus;
        out.graffitiRotationVariationEnabled=fx.graffitiRotationVariationEnabled;out.graffitiRotationVariation=fx.graffitiRotationVariation;out.graffitiRotationMultiplier=fx.graffitiRotationMultiplier;out.graffitiRotationFocus=fx.graffitiRotationFocus;
        return out;
    }
    return Object.freeze({ownerForLayer,graffitiStyleLayer});
})();
window.SomataEffectOwnerService=SomataEffectOwnerService;
// Compatibility aliases for older feature modules. They no longer originate in main-pipeline.
window.liveEffectOwnerForFrameLayer=(layer)=>SomataEffectOwnerService.ownerForLayer(layer);
window.liveGraffitiStyleLayerForFrame=(frameCtx)=>SomataEffectOwnerService.graffitiStyleLayer(frameCtx);
