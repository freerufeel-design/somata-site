// Цвет ламп: разбор hex, фаза цвета, радиус градиента.
import '../geometry/orbit-builder.js'; // initialisation order: this module runs after it

function hexToRgbaParts(hex) {
  const clean = String(hex || '#ffffff')
    .replace('#', '')
    .slice(0, 6)
    .padEnd(6, 'f');
  const value = parseInt(clean, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
function wrapLampColorPhase(phase) {
  const p = Number(phase) || 0;
  return ((p % 1) + 1) % 1;
}
function lerpLampColorPhase(from, to, t) {
  const a = wrapLampColorPhase(from),
    b = wrapLampColorPhase(to),
    u = Math.max(0, Math.min(1, Number(t) || 0));
  let d = b - a;
  if (d > 0.5) d -= 1;
  else if (d < -0.5) d += 1;
  return wrapLampColorPhase(a + d * u);
}
function lampGradientOuterRadius(radius, softness, type, brightnessPercent) {
  const r = Math.max(1, Number(radius) || 1);
  const soft = Math.max(0, Math.min(150, Number.isFinite(Number(softness)) ? Number(softness) : 75));
  const bright = Math.max(
    0,
    Math.min(200, Number.isFinite(Number(brightnessPercent)) ? Number(brightnessPercent) : 100),
  );
  const softN = Math.min(100, soft) / 100;
  const overdrive = Math.max(0, Math.min(1, (bright - 100) / 100));
  const haloFade = 1 - overdrive;
  const whiteToSoftMix = type === 'whiteCore' && soft > 100 ? Math.max(0, Math.min(1, (soft - 100) / 50)) : 0;
  const coreHaloBase = type === 'softCore' ? 1.25 : type === 'whiteCore' ? 1.45 - 0.2 * whiteToSoftMix : 1.45;
  const haloScale = coreHaloBase + (type === 'star' ? 0.55 : softN * 2.8) * haloFade;
  return Math.max(r + 2, r * haloScale + 3);
}

export { hexToRgbaParts, lampGradientOuterRadius, lerpLampColorPhase, wrapLampColorPhase };
