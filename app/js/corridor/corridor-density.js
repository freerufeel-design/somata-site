// Visual density, independent of the copy lattice and Corridor spacing.
export const TUNNEL_DENSITY_DEFAULT = 100;
export const TUNNEL_DENSITY_MAX = 200;

export function normalizeTunnelDensity(value) {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) && n >= 0
    ? Math.min(TUNNEL_DENSITY_MAX, n)
    : TUNNEL_DENSITY_DEFAULT;
}

// Keep saved classic density (100) and maximum (200) compatible.
export function densityPercent(value) {
  const d = normalizeTunnelDensity(value);
  return d <= 100 ? d * 0.75 : 75 + (d - 100) / 4;
}
export function densityFromPercent(percent) {
  return percent <= 75 ? percent / 0.75 : 100 + (percent - 75) * 4;
}

export function tunnelDensityAlpha(position, count, density = TUNNEL_DENSITY_DEFAULT) {
  const mix = (density - TUNNEL_DENSITY_DEFAULT) / (TUNNEL_DENSITY_MAX - TUNNEL_DENSITY_DEFAULT);
  if (mix === 1) return 1; // v15.16: no base fade by depth
  const progress = Math.max(0, Math.min(1, position / Math.max(1, count - 1)));
  const classic = 0.08 + 0.92 * Math.pow(progress, 0.72); // v6.7
  if (mix < 0) {
    const pct = densityPercent(density);
    const exponent = 1 + (75 - Math.max(25, pct)) / 25;
    return Math.pow(classic, exponent) * Math.min(1, pct / 25);
  }
  return classic + (1 - classic) * mix;
}
