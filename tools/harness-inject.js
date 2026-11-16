// Injected before any page script. Test-harness only: makes rendering deterministic
// and works around headless Chrome being unable to present WebGPU canvases.
(() => {
  // ---- Virtual clock (stepped) -------------------------------------------
  // Time is frozen unless the harness explicitly steps it, one rAF = 1/60 s.
  const realRaf = window.requestAnimationFrame.bind(window);
  const realDateNow = Date.now;
  const epoch = 1767225600000; // fixed wall-clock epoch
  let virtualMs = 1000;
  let stepsLeft = 0;
  let stepWaiters = [];
  const H = (window.__harness = {
    get now() { return virtualMs; },
    frames: 0,
    stepMs: 1000 / 60,
    step(n, dt = 1000 / 60) {
      H.stepMs = dt;
      stepsLeft += n;
      return new Promise((res) => stepWaiters.push({ until: H.frames + n, res }));
    },
  });
  performance.now = () => virtualMs;
  Date.now = () => epoch + virtualMs;
  window.requestAnimationFrame = (cb) => realRaf(() => {
    cb(virtualMs);
  });
  // a single driver advances time once per real frame, before app callbacks run next frame
  const driver = () => {
    if (stepsLeft > 0) { stepsLeft--; virtualMs += H.stepMs; H.frames++; }
    stepWaiters = stepWaiters.filter((w) => (H.frames >= w.until ? (w.res(), false) : true));
    realRaf(driver);
  };
  realRaf(driver);
  // hide transient toasts (real-time setTimeout driven)
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '#shortcutToast,#fpsCounter{visibility:hidden!important}';
    document.head.appendChild(st);
  });

  // ---- Seeded Math.random --------------------------------------------------
  let seed = 0x9e3779b9;
  Math.random = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---- GPU upload fingerprint ---------------------------------------------
  // Records an order-sensitive hash of every queue.writeBuffer/writeTexture payload
  // per animation frame, so structural refactors can be checked bit-for-bit.
  if (window.GPUQueue) {
    const fnv = (h, bytes) => { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
    const asBytes = (data, off = 0, size) => {
      const buf = ArrayBuffer.isView(data) ? data.buffer : data;
      const base = ArrayBuffer.isView(data) ? data.byteOffset : 0;
      const el = ArrayBuffer.isView(data) ? (data.BYTES_PER_ELEMENT || 1) : 1;
      const start = base + off * el;
      const len = size != null ? size * el : (ArrayBuffer.isView(data) ? data.byteLength - off * el : buf.byteLength - off);
      return new Uint8Array(buf, start, Math.max(0, len));
    };
    let cur = { h: 2166136261, n: 0, bytes: 0 };
    H.uploads = [];
    const realWB = GPUQueue.prototype.writeBuffer;
    GPUQueue.prototype.writeBuffer = function (buffer, bufferOffset, data, dataOffset, size) {
      try {
        const b = asBytes(data, dataOffset || 0, size);
        cur.h = fnv(cur.h, new Uint8Array(new Uint32Array([buffer.size >>> 0, bufferOffset >>> 0]).buffer));
        cur.h = fnv(cur.h, b); cur.n++; cur.bytes += b.length;
      } catch (_) { /* ignore */ }
      return realWB.apply(this, arguments);
    };
    const realSubmit = GPUQueue.prototype.submit;
    GPUQueue.prototype.submit = function (cbs) { cur.submits = (cur.submits || 0) + (cbs?.length || 0); return realSubmit.apply(this, arguments); };
    const rollFrame = () => {
      H.uploads.push({ t: Math.round(virtualMs * 1000) / 1000, h: cur.h.toString(16), n: cur.n, bytes: cur.bytes, submits: cur.submits || 0 });
      if (H.uploads.length > 30) H.uploads.shift();
      cur = { h: 2166136261, n: 0, bytes: 0 };
      realRaf(rollFrame);
    };
    realRaf(rollFrame);
  }

  // ---- Fake WebGPU canvas context with 2D mirroring -----------------------
  if (!navigator.gpu) return;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  const fakeByCanvas = new WeakMap();
  const fakes = new Set();
  class FakeGPUCanvasContext {
    constructor(canvas) { this.canvas = canvas; this._cfg = null; this._tex = null; this._dirty = false; }
    configure(cfg) { this._cfg = { ...cfg }; this._tex = null; }
    unconfigure() { this._cfg = null; this._tex = null; }
    getConfiguration() { return this._cfg ? { ...this._cfg } : null; }
    getCurrentTexture() {
      if (!this._cfg) throw new DOMException('Canvas context is not configured', 'InvalidStateError');
      const w = Math.max(1, this.canvas.width | 0), h = Math.max(1, this.canvas.height | 0);
      const dev = this._cfg.device;
      if (!this._tex || this._tex.width !== w || this._tex.height !== h || this._tex.__dev !== dev) {
        const usage = (this._cfg.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING;
        const desc = { size: [w, h], format: this._cfg.format, usage };
        if (this._cfg.viewFormats) desc.viewFormats = this._cfg.viewFormats;
        this._tex = dev.createTexture(desc);
        this._tex.__dev = dev;
      }
      this._dirty = true;
      return this._tex;
    }
  }
  HTMLCanvasElement.prototype.getContext = function (type, opts) {
    if (type === 'webgpu') {
      let f = fakeByCanvas.get(this);
      if (!f) { f = new FakeGPUCanvasContext(this); fakeByCanvas.set(this, f); fakes.add(f); }
      return f;
    }
    if (fakeByCanvas.has(this) && type !== '2d') return null;
    return realGetContext.call(this, type, opts);
  };
  if (window.OffscreenCanvas) {
    const realOff = OffscreenCanvas.prototype.getContext;
    const offFakes = new WeakMap();
    OffscreenCanvas.prototype.getContext = function (type, opts) {
      if (type === 'webgpu') {
        let f = offFakes.get(this);
        if (!f) { f = new FakeGPUCanvasContext(this); offFakes.set(this, f); }
        return f;
      }
      return realOff.call(this, type, opts);
    };
  }

  function half(h) {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
    if (e === 31) return m ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + m / 1024);
  }
  async function mirror(f) {
    const tex = f._tex, cfg = f._cfg;
    if (!tex || !cfg) return;
    const dev = cfg.device, fmt = cfg.format;
    const bpp = fmt === 'rgba16float' ? 8 : 4;
    if (!['bgra8unorm', 'rgba8unorm', 'rgba16float'].includes(fmt)) return;
    const w = tex.width, h = tex.height, bpr = Math.ceil((w * bpp) / 256) * 256;
    const buf = dev.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    dev.queue.submit([enc.finish()]);
    try { await buf.mapAsync(GPUMapMode.READ); } catch (_) { buf.destroy(); return; }
    const src = new Uint8Array(buf.getMappedRange());
    const out = new ImageData(w, h);
    const d = out.data, opaque = cfg.alphaMode === 'opaque';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, i = y * bpr + x * bpp;
        let r, g, b, a;
        if (fmt === 'rgba16float') {
          const v = new Uint16Array(src.buffer, src.byteOffset + i, 4);
          r = half(v[0]) * 255; g = half(v[1]) * 255; b = half(v[2]) * 255; a = half(v[3]) * 255;
        } else if (fmt === 'bgra8unorm') { b = src[i]; g = src[i + 1]; r = src[i + 2]; a = src[i + 3]; }
        else { r = src[i]; g = src[i + 1]; b = src[i + 2]; a = src[i + 3]; }
        if (opaque) a = 255;
        else if (a > 0 && a < 255) { const k = 255 / a; r *= k; g *= k; b *= k; }
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
      }
    }
    buf.unmap(); buf.destroy();
    if (!(f.canvas instanceof HTMLCanvasElement)) return;
    const c2 = realGetContext.call(f.canvas, '2d');
    if (c2) { c2.clearRect(0, 0, w, h); c2.putImageData(out, 0, 0); }
  }
  let flushing = null;
  H.flush = async () => {
    if (flushing) return flushing;
    flushing = (async () => {
      const list = [...fakes].filter((f) => f._dirty);
      for (const f of list) f._dirty = false;
      for (const f of list) { try { await mirror(f); } catch (e) { console.warn('[harness] mirror failed', e?.message); } }
    })().finally(() => { flushing = null; });
    return flushing;
  };
  H.autoMirror = true;
  const pump = () => { if (H.autoMirror) H.flush(); realRaf(pump); };
  realRaf(pump);
})();
