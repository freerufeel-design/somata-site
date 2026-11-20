import './geometry-policy.js'; // initialisation order: this module runs after it
import { ensureLayerEffectState, getLayerEffectOwner } from '../core/defaults-layers.js';

const SomataEffectOwnerService = (() => {
  function ownerForLayer(layer) {
    try {
      return getLayerEffectOwner(layer) || layer || null;
    } catch (_) {
      return layer || null;
    }
  }
  function graffitiStyleLayer(frameCtx) {
    const base = frameCtx?.layer || null,
      fx = frameCtx?.effectLayer || ownerForLayer(base) || base;
    if (!base || !fx || fx === base) return base || fx;
    const out = frameCtx._liveGraffitiStyleLayer || (frameCtx._liveGraffitiStyleLayer = {});
    Object.assign(out, base);
    out.motionRotation = fx.motionRotation ?? base.motionRotation;
    out.lineProfileGraffiti = fx.lineProfileGraffiti;
    out.graffitiAngle = fx.graffitiAngle;
    out.graffitiAngleMode = fx.graffitiAngleMode;
    out.graffitiNibShape = fx.graffitiNibShape;
    out.graffitiNibLength = fx.graffitiNibLength;
    out.graffitiNibLengthMultiplier = fx.graffitiNibLengthMultiplier;
    out.graffitiVariationMode = fx.graffitiVariationMode;
    out.graffitiVariationEveryN = fx.graffitiVariationEveryN;
    out.graffitiSizeVariationEnabled = fx.graffitiSizeVariationEnabled;
    out.graffitiSizeVariation = fx.graffitiSizeVariation;
    out.graffitiSizeFocus = fx.graffitiSizeFocus;
    out.graffitiRotationVariationEnabled = fx.graffitiRotationVariationEnabled;
    out.graffitiRotationVariation = fx.graffitiRotationVariation;
    out.graffitiRotationMultiplier = fx.graffitiRotationMultiplier;
    out.graffitiRotationFocus = fx.graffitiRotationFocus;
    return out;
  }
  return Object.freeze({ ownerForLayer, graffitiStyleLayer });
})();
window.SomataEffectOwnerService = SomataEffectOwnerService;

window.liveEffectOwnerForFrameLayer = (layer) => SomataEffectOwnerService.ownerForLayer(layer);
window.liveGraffitiStyleLayerForFrame = (frameCtx) => SomataEffectOwnerService.graffitiStyleLayer(frameCtx);
