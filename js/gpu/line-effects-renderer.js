// Эффекты линий и выбор GPU-рендереров геометрии.
import './stroke-renderer.js'; // initialisation order: this module runs after it
import { performanceGovernor } from '../core/scheduler.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { GeometryWebGLRenderer } from './webgl-geometry-renderer.js';
import { GPUColorCache } from './gpu-utils.js';
import { WebGPUStrokeRenderer } from './stroke-renderer.js';

const LineEffectsWebGLRenderer = (() => {
  let gl = null,
    program = null,
    vao = null,
    cornerBuffer = null,
    instanceBuffer = null,
    viewportUniform = null,
    modeUniform = null,
    attempted = false,
    available = false,
    lost = false,
    lastError = '',
    width = 0,
    height = 0,
    capacity = 0,
    data = null;
  const canvas = document.createElement('canvas');
  const V = `#version 300 es
                precision highp float;
                layout(location=0) in vec2 aCorner;
                layout(location=1) in vec2 iStart;
                layout(location=2) in vec2 iEnd;
                layout(location=3) in float iHalfWidth;
                layout(location=4) in float iRadius;
                layout(location=5) in vec4 iColor;
                uniform vec2 uViewport;
                out vec2 vLocal;flat out float vLen;flat out float vHalfWidth;flat out float vRadius;flat out vec4 vColor;
                void main(){vec2 d=iEnd-iStart;float len=max(length(d),.0001);vec2 dir=d/len,n=vec2(-dir.y,dir.x);float pad=iHalfWidth+iRadius+2.5;float tx=(aCorner.x+1.0)*.5;float lx=mix(-pad,len+pad,tx),ly=aCorner.y*pad;vec2 p=iStart+dir*lx+n*ly;gl_Position=vec4(p.x/uViewport.x*2.0-1.0,1.0-p.y/uViewport.y*2.0,0,1);vLocal=vec2(lx,ly);vLen=len;vHalfWidth=iHalfWidth;vRadius=iRadius;vColor=iColor;}`;
  const F = `#version 300 es
                precision highp float;in vec2 vLocal;flat in float vLen;flat in float vHalfWidth;flat in float vRadius;flat in vec4 vColor;uniform int uMode;out vec4 outColor;
                void main(){float cx=clamp(vLocal.x,0.0,vLen);float d=length(vec2(vLocal.x-cx,vLocal.y));float cov=0.0;
                    if(uMode==0){float r=max(.001,vRadius);float q=max(0.0,d-vHalfWidth)/r;float tail=exp(-3.15*q*q);float cutoff=1.0-smoothstep(.82,1.04,q);cov=tail*cutoff;}
                    else if(uMode==1){float edge=vHalfWidth+max(0.0,vRadius);float centerCoverage=min(1.0,2.0*edge);cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));}
                    else if(uMode==3){float edge=max(0.0,vHalfWidth-max(0.0,vRadius));float centerCoverage=min(1.0,2.0*edge);cov=min(centerCoverage,clamp(edge+0.5-d,0.0,1.0));}
                    else{float r=max(.001,vRadius);float e=max(0.0,d-vHalfWidth);float q=e/r;float tail=exp(-3.15*q*q);float cutoff=1.0-smoothstep(.82,1.04,q);float outside=smoothstep(0.0,min(1.0,r*.55),e);cov=tail*cutoff*outside;}
                    float a=clamp(vColor.a*cov,0.0,1.0);if(a<.00015)discard;outColor=vec4(vColor.rgb*a,a);}`;
  const compile = (t, src) => {
    const sh = gl.createShader(t);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh) || 'linefx shader');
    return sh;
  };
  function init() {
    if (available && !lost) return true;
    if (attempted && !available) return false;
    attempted = true;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        depth: false,
        stencil: false,
      });
      if (!gl) throw new Error('WebGL2');
      const vs = compile(gl.VERTEX_SHADER, V),
        fs = compile(gl.FRAGMENT_SHADER, F);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) || 'linefx link');
      viewportUniform = gl.getUniformLocation(program, 'uViewport');
      modeUniform = gl.getUniformLocation(program, 'uMode');
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      cornerBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      instanceBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      const stride = 10 * 4;
      for (const [loc, size, off] of [
        [1, 2, 0],
        [2, 2, 2],
        [3, 1, 4],
        [4, 1, 5],
        [5, 4, 6],
      ]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      canvas.addEventListener(
        'webglcontextlost',
        (e) => {
          e.preventDefault();
          lost = true;
          available = false;
        },
        { passive: false },
      );
      canvas.addEventListener('webglcontextrestored', () => {
        attempted = false;
        available = false;
        lost = false;
        gl = null;
        init();
      });
      available = true;
      return true;
    } catch (e) {
      lastError = String(e?.message || e);
      available = false;
      return false;
    }
  }
  function size(w, h) {
    if (!init()) return false;
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    if (width !== w || height !== h) {
      canvas.width = w;
      canvas.height = h;
      width = w;
      height = h;
      gl.viewport(0, 0, w, h);
    }
    return true;
  }
  function cap(n) {
    if (n <= capacity) return;
    capacity = performanceGovernor.capacityFor(n, capacity, 256, 1.6);
    data = new Float32Array(capacity * 10);
  }
  function color(style) {
    return GPUColorCache.rgba(style);
  }
  function render(commands, targetCtx, opt = {}) {
    if (!commands?.length || !size(mainCanvas.width, mainCanvas.height)) return false;
    const mode =
      opt.mode === 'outline'
        ? 1
        : opt.mode === 'halo' || ['saiyan', 'drip', 'mountain'].includes(opt.mode)
          ? 2
          : opt.mode === 'coreInset'
            ? 3
            : 0;
    let count = 0;
    for (const cmd of commands)
      for (const sp of cmd.subpaths || [])
        count += Math.max(0, (sp.points?.length || 0) - 1) + (sp.closed ? 1 : 0);
    if (!count) return true;
    cap(count);
    let k = 0;
    const override = opt.colorOverride ? color(opt.colorOverride) : null,
      alphaScale = Number.isFinite(Number(opt.alphaScale)) ? Number(opt.alphaScale) : 1;
    for (const cmd of commands) {
      const c = override || color(cmd.strokeStyle),
        variable = cmd?.__variableWidthSpiral === true,
        baseLineWidth = Math.max(0.001, Number(cmd.screenLineWidth) || 1);
      for (const sp of cmd.subpaths || []) {
        const pts = sp.points || [],
          n = pts.length - 1 + (sp.closed ? 1 : 0),
          segAlpha =
            Array.isArray(sp.segmentAlphas) || ArrayBuffer.isView(sp.segmentAlphas) ? sp.segmentAlphas : null;
        for (let i = 0; i < n; i++) {
          const p = pts[i],
            q = pts[(i + 1) % pts.length];
          if (!p || !q || (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 1e-8) continue;
          const rawAlpha =
              segAlpha && Number.isFinite(Number(segAlpha[i])) ? Number(segAlpha[i]) : Number(cmd.alpha) || 0,
            alpha = Math.max(0, Math.min(1, rawAlpha * alphaScale * c[3]));
          if (alpha <= 0.0001) continue;
          const wa = variable ? Math.max(0.02, Number(p?.widthScale) || 1) : 1,
            wb = variable ? Math.max(0.02, Number(q?.widthScale) || wa) : 1,
            segLineWidth = baseLineWidth * Math.sqrt(wa * wb),
            hw = segLineWidth * 0.5;
          const extra =
            mode === 1 || mode === 3
              ? Math.max(
                  0,
                  (Number(opt.extraLocal) || 0) *
                    (segLineWidth / Math.max(0.001, Number(opt.baseLineWidth) || 1)),
                )
              : Math.max(0.1, Number(opt.radiusPx) || 1);
          const o = k * 10;
          data[o] = p.x;
          data[o + 1] = p.y;
          data[o + 2] = q.x;
          data[o + 3] = q.y;
          data[o + 4] = hw;
          data[o + 5] = extra;
          data[o + 6] = c[0];
          data[o + 7] = c[1];
          data[o + 8] = c[2];
          data[o + 9] = alpha;
          k++;
        }
      }
    }
    if (!k) return true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(program);
    gl.uniform2f(viewportUniform, width, height);
    gl.uniform1i(modeUniform, mode);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, k * 10), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, k);
    gl.bindVertexArray(null);
    if (gl.getError() !== gl.NO_ERROR) return false;
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.globalAlpha = 1;
    targetCtx.globalCompositeOperation = opt.composite || 'source-over';
    targetCtx.filter = 'none';
    targetCtx.drawImage(canvas, 0, 0);
    targetCtx.restore();
    return true;
  }
  return {
    render,
    isAvailable: () => init(),
    status: () => ({ available: init(), lastError, width, height }),
  };
})();
const GeometryGPURenderer = (() => {
  let lastBackend = 'none';
  function isAvailable() {
    WebGPUStrokeRenderer.warmup();
    return WebGPUStrokeRenderer.isReady() || GeometryWebGLRenderer.isAvailable();
  }
  function render(commands, targetCtx, deferComposite = false) {
    WebGPUStrokeRenderer.warmup();
    if (
      WebGPUStrokeRenderer.isReady() &&
      WebGPUStrokeRenderer.renderGeometry(commands, targetCtx, deferComposite)
    ) {
      lastBackend = 'webgpu';
      return true;
    }
    const ok = GeometryWebGLRenderer.render(commands, targetCtx, deferComposite);
    if (ok) lastBackend = 'webgl2';
    return ok;
  }
  function renderCorridor(commands, copies, targetCtx, opt = {}) {
    WebGPUStrokeRenderer.warmup();
    if (!WebGPUStrokeRenderer.isReady()) return false;
    const ok = WebGPUStrokeRenderer.renderCorridor(commands, copies, targetCtx, opt);
    if (ok) lastBackend = 'webgpu';
    return ok;
  }
  function composite(targetCtx) {
    return lastBackend === 'webgpu'
      ? WebGPUStrokeRenderer.composite(targetCtx, 'source-over')
      : GeometryWebGLRenderer.composite(targetCtx);
  }
  function clear() {
    WebGPUStrokeRenderer.clear();
    GeometryWebGLRenderer.clear();
  }
  function status() {
    return {
      active: lastBackend,
      webgpu: WebGPUStrokeRenderer.status(),
      webgl2: GeometryWebGLRenderer.status(),
    };
  }
  return { isAvailable, render, renderCorridor, composite, clear, status };
})();
const LineEffectsGPURenderer = (() => {
  let lastBackend = 'none';
  function isAvailable() {
    WebGPUStrokeRenderer.warmup();
    return WebGPUStrokeRenderer.isReady() || LineEffectsWebGLRenderer.isAvailable();
  }
  function render(commands, targetCtx, opt = {}) {
    WebGPUStrokeRenderer.warmup();
    if (WebGPUStrokeRenderer.isReady() && WebGPUStrokeRenderer.renderEffects(commands, targetCtx, opt)) {
      lastBackend = 'webgpu';
      return true;
    }
    const ok = LineEffectsWebGLRenderer.render(commands, targetCtx, opt);
    if (ok) lastBackend = 'webgl2';
    return ok;
  }
  function renderCorridor(commands, copies, targetCtx, opt = {}) {
    WebGPUStrokeRenderer.warmup();
    if (!WebGPUStrokeRenderer.isReady()) return false;
    const ok = WebGPUStrokeRenderer.renderCorridor(commands, copies, targetCtx, opt);
    if (ok) lastBackend = 'webgpu';
    return ok;
  }
  function status() {
    return {
      active: lastBackend,
      webgpu: WebGPUStrokeRenderer.status(),
      webgl2: LineEffectsWebGLRenderer.status(),
    };
  }
  return { isAvailable, render, renderCorridor, status };
})();

export { GeometryGPURenderer, LineEffectsGPURenderer };
