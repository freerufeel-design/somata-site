// WebGPU: проверка шейдеров и кэш цветов.
import './buffer-recycler.js'; // initialisation order: this module runs after it

async function assertWebGPUShaderModule(module, label = 'WebGPU shader') {
  if (!module?.getCompilationInfo) return module;
  const info = await module.getCompilationInfo();
  const errors = (info?.messages || []).filter((m) => m.type === 'error');
  if (errors.length) {
    const msg = errors
      .slice(0, 6)
      .map((m) => `${m.lineNum || '?'}:${m.linePos || '?'} ${m.message || 'WGSL error'}`)
      .join(' | ');
    throw new Error(`${label}: ${msg}`);
  }
  return module;
}
const GPUColorCache = (() => {
  const rgbaCache = new Map(),
    MAX = 512;
  function parse(style) {
    const key = String(style || '#ffffff')
      .trim()
      .toLowerCase();
    let hit = rgbaCache.get(key);
    if (hit) return hit;
    let r = 1,
      g = 1,
      b = 1,
      a = 1;
    if (key[0] === '#') {
      let h = key.slice(1);
      if (h.length === 3 || h.length === 4)
        h = h
          .split('')
          .map((c) => c + c)
          .join('');
      if (h.length === 6 || h.length === 8) {
        const n = parseInt(h.slice(0, 6), 16);
        r = ((n >> 16) & 255) / 255;
        g = ((n >> 8) & 255) / 255;
        b = (n & 255) / 255;
        if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
      }
    } else {
      const m = key.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
      if (m) {
        r = Math.min(255, +m[1]) / 255;
        g = Math.min(255, +m[2]) / 255;
        b = Math.min(255, +m[3]) / 255;
        if (m[4] != null) a = Math.max(0, Math.min(1, +m[4]));
      }
    }
    hit = Object.freeze([r, g, b, a]);
    if (rgbaCache.size >= MAX) rgbaCache.clear();
    rgbaCache.set(key, hit);
    return hit;
  }
  return {
    rgba: parse,
    rgb: (style) => {
      const c = parse(style);
      return c;
    },
    clear: () => rgbaCache.clear(),
    size: () => rgbaCache.size,
  };
})();

export { GPUColorCache, assertWebGPUShaderModule };
