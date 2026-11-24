// Map equal fractions of phase time to equal lengths of a polar trajectory.
// r(u)=r0+(r1-r0)u, angle(u)=a0+angleDelta*u.
// Exact primitive of sqrt(dr² + (angleDelta*r)²), with straight/circular limits.
export function stablePolarProgress(t, r0, r1, angleDelta) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const a = Math.abs(Number(angleDelta) || 0), dr = r1 - r0;
  if (u === 0 || u === 1 || !(a > 1e-8) || !(Math.abs(dr) > 1e-7 * Math.max(1, Math.abs(r0), Math.abs(r1)))) return u;
  const d = Math.abs(dr);
  const primitive = r => (r * Math.hypot(d, a * r) + d * d / a * Math.asinh(a * r / d)) / 2;
  const start = primitive(r0), span = primitive(r1) - start;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-10) return u;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if ((primitive(r0 + dr * mid) - start) / span < u) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
