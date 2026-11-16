// Габариты: максимальный радиус слоя и всей композиции.
import '../ui/profile-editor.js'; // initialisation order: this module runs after it
import { state } from '../core/state.js';
import {
  getCachedLayerDrawData,
  getEffectiveLayerRadius,
  getLayerGlowMultiplier,
  getLayerStrokeWidthMultiplier,
} from '../effects/motion.js';
import { computeLayerGeometryCircles } from '../render/geometry-circles-pass.js';

function computeMaxLayerRadius() {
  let maxRadius = 0;
  state.layers.forEach((layer) => {
    if (!layer.visible) return;
    const radius = getEffectiveLayerRadius(layer, 0);
    if (Number.isFinite(radius)) maxRadius = Math.max(maxRadius, radius);
  });
  return maxRadius > 0 ? maxRadius : 220;
}
function computeMaxArtworkRadius() {
  let maxRadius = 0;
  state.layers.forEach((layer) => {
    if (!layer?.visible) return;
    const drawData = getCachedLayerDrawData(layer);
    const padding =
      Math.max(0, (Number(layer.strokeWidth) || 0) * getLayerStrokeWidthMultiplier(layer)) / 2 +
      Math.max(0, (Number(layer.glow) || 0) * getLayerGlowMultiplier(layer));
    for (const path of drawData?.paths || [])
      for (const point of path?.points || []) {
        maxRadius = Math.max(maxRadius, Math.hypot(Number(point.x) || 0, Number(point.y) || 0) + padding);
      }
    const circleCfg = layer.geometryCircles;
    if (circleCfg?.enabled === true) {
      for (const c of computeLayerGeometryCircles(drawData?.paths || [], circleCfg)) {
        maxRadius = Math.max(
          maxRadius,
          Math.hypot(Number(c.x) || 0, Number(c.y) || 0) + (Number(c.r) || 0) + padding,
        );
      }
    }
  });
  return maxRadius > 0 ? maxRadius : computeMaxLayerRadius();
}

export { computeMaxArtworkRadius, computeMaxLayerRadius };
