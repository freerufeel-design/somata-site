// The reference circle is an input to the skeleton, never a measurement
// of a profile, fillet, Fourier wave, or the positions of moving vertices.
export function getLayerRadiusMultiplier(layer) {
  const v = Number(layer?.radiusMultiplier);
  return Number.isFinite(v) ? Math.max(0, v) : 1;
}
export function getEffectiveLayerRadius(layer, fallback = 220) {
  const raw = Number(layer?.radius);
  const base = Number.isFinite(raw) ? raw : Number(fallback) || 220;
  return Math.max(1, base * getLayerRadiusMultiplier(layer));
}
export function getMorphReferenceRadius(source, target, progress) {
  const a = getEffectiveLayerRadius(source), b = getEffectiveLayerRadius(target, a);
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  return a + (b - a) * t;
}
export function getLayerReferenceRadius(layer) {
  const frameRadius = layer?.__somataReferenceRadius;
  return Number.isFinite(frameRadius) && frameRadius >= 0
    ? frameRadius : getEffectiveLayerRadius(layer);
}
// The viewport guide is in world units; apply the same presentation scale
// as the skeleton, but not the independently instanced Corridor copies.
export function getFrameReferenceRadius(frame) {
  if (!frame?.layer) return 0;
  const gp = frame.geometryProvider;
  let r = getLayerReferenceRadius(frame.layer);
  if (!frame.lightMorphEnabled && gp?.geometryActive === true && gp.sourceLayer && gp.targetLayer) {
    const t = Math.max(0, Math.min(1, Number(gp.progress) || 0));
    if (gp.modeOverride === 'fade' || gp.kind === 'green-fade' || gp.kind === 'orange-fade') {
      r = Math.max(t < 1 ? getEffectiveLayerRadius(gp.sourceLayer) : 0,
        t > 0 ? getEffectiveLayerRadius(gp.targetLayer) : 0);
    } else {
      r = getMorphReferenceRadius(gp.sourceLayer, gp.targetLayer, t);
    }
  }
  const scale = Number(frame.combinedScale);
  return r * (Number.isFinite(scale) ? Math.abs(scale) : 1);
}
