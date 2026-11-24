// For like-to-like morphs, report the geometry phase rather than a cross-mode
// blending weight. An idle editor is a completed same-mode transition.
export function profileModeLiveLabel({ current, from, to, progress, weight }) {
  const name = mode => mode === 'spline' ? 'Сплайн' : mode === 'segments' ? 'Отрезки' : 'От руки';
  const active = !!from && !!to;
  const value = active ? (weight ?? progress) : 1;
  const pct = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
  return `${name(active ? from : current)} → ${name(active ? to : current)} · ${pct}%`;
}
