// WebGL: геометрия.
import './webgl-fill-renderer.js'; // initialisation order: this module runs after it
import { performanceGovernor, requestMainCanvasRender } from '../core/scheduler.js';
import { geometryGlCanvas, mainCanvas } from '../ui/profile-presets.js';
import { GPUColorCache } from './gpu-utils.js';

const GeometryWebGLRenderer = (() => {
  let gl = null,
    program = null,
    vao = null,
    cornerBuffer = null,
    instanceBuffer = null,
    viewportUniform = null;
  let attempted = false,
    available = false,
    lost = false,
    lastError = '';
  let width = 0,
    height = 0,
    capacity = 0,
    instanceData = null;
  const canvas = geometryGlCanvas;
  const VERT = `#version 300 es
                precision highp float;
                layout(location=0) in vec2 aCorner;
                layout(location=1) in vec2 iStart;
                layout(location=2) in vec2 iEnd;
                layout(location=3) in float iHalfWidth;
                layout(location=4) in vec4 iColor;
                uniform vec2 uViewport;
                out vec2 vLocal;
                flat out float vLen;
                flat out float vHalfWidth;
                flat out vec4 vColor;
                void main(){
                    vec2 d=iEnd-iStart;
                    float len=max(length(d),0.0001);
                    vec2 dir=d/len;
                    vec2 n=vec2(-dir.y,dir.x);
                    float aa=1.35;
                    float pad=iHalfWidth+aa*1.5;
                    float tx=(aCorner.x+1.0)*0.5;
                    float lx=mix(-pad,len+pad,tx);
                    float ly=aCorner.y*pad;
                    vec2 p=iStart+dir*lx+n*ly;
                    vec2 clip=vec2(p.x/uViewport.x*2.0-1.0,1.0-p.y/uViewport.y*2.0);
                    gl_Position=vec4(clip,0.0,1.0);
                    vLocal=vec2(lx,ly);vLen=len;vHalfWidth=iHalfWidth;vColor=iColor;
                }`;
  const FRAG = `#version 300 es
                precision highp float;
                in vec2 vLocal;
                flat in float vLen;
                flat in float vHalfWidth;
                flat in vec4 vColor;
                out vec4 outColor;
                void main(){
                    float cx=clamp(vLocal.x,0.0,vLen);
                    float d=length(vec2(vLocal.x-cx,vLocal.y));
                    float halfPixel=0.5;
                    float centerCoverage=min(1.0,2.0*vHalfWidth);
                    float coverage=min(centerCoverage,clamp(vHalfWidth+halfPixel-d,0.0,1.0));
                    float a=clamp(vColor.a*coverage,0.0,1.0);
                    outColor=vec4(vColor.rgb*a,a);
                }`;
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh) || 'geometry shader compile');
    return sh;
  }
  function init() {
    if (available && !lost) return true;
    if (attempted && !available) return false;
    attempted = true;
    try {
      if (!canvas) throw new Error('нет geometry GL canvas');
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        depth: false,
        stencil: false,
      });
      if (!gl) throw new Error('WebGL2 не поддерживается');
      const vs = compile(gl.VERTEX_SHADER, VERT),
        fs = compile(gl.FRAGMENT_SHADER, FRAG);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) || 'geometry program link');
      viewportUniform = gl.getUniformLocation(program, 'uViewport');
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
      const stride = 9 * 4;
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 2 * 4);
      gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 4 * 4);
      gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 5 * 4);
      gl.vertexAttribDivisor(4, 1);
      gl.bindVertexArray(null);
      canvas.addEventListener(
        'webglcontextlost',
        (e) => {
          e.preventDefault();
          lost = true;
          available = false;
          lastError = 'context lost';
        },
        { passive: false },
      );
      canvas.addEventListener('webglcontextrestored', () => {
        attempted = false;
        available = false;
        lost = false;
        gl = null;
        width = height = capacity = 0;
        init();
        requestMainCanvasRender();
      });
      available = true;
      lost = false;
      lastError = '';
      return true;
    } catch (err) {
      available = false;
      lastError = String(err?.message || err);
      console.warn('WebGL geometry disabled:', err);
      return false;
    }
  }
  function ensureSize(w, h) {
    if (!init()) return false;
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (width === w && height === h && canvas.width === w && canvas.height === h) return true;
    canvas.width = w;
    canvas.height = h;
    width = w;
    height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }
  function ensureCapacity(count) {
    if (count <= capacity) return;
    capacity = performanceGovernor.capacityFor(count, capacity, 256, 1.6);
    instanceData = new Float32Array(capacity * 9);
  }
  function parseColor(style) {
    return GPUColorCache.rgba(style || '#ffffff');
  }
  function render(commands, targetCtx, deferComposite = false) {
    if (!commands?.length) return false;
    if (!ensureSize(mainCanvas.width, mainCanvas.height)) return false;
    let segCount = 0;
    for (const cmd of commands)
      for (const sp of cmd.subpaths || [])
        if (sp?.points?.length > 1) segCount += Math.max(0, sp.points.length - 1) + (sp.closed ? 1 : 0);
    if (!segCount) return true;
    ensureCapacity(segCount);
    let k = 0;
    for (const cmd of commands) {
      const c = parseColor(cmd.strokeStyle),
        variable = cmd?.__variableWidthSpiral === true,
        baseHw = Math.max(0.001, (Number(cmd.screenLineWidth) || 1) * 0.5);
      for (const sp of cmd.subpaths || []) {
        const pts = sp.points || [];
        if (pts.length < 2) continue;
        const count = pts.length - 1 + (sp.closed ? 1 : 0),
          segAlpha =
            Array.isArray(sp.segmentAlphas) || ArrayBuffer.isView(sp.segmentAlphas) ? sp.segmentAlphas : null;
        for (let i = 0; i < count; i++) {
          const p = pts[i],
            q = pts[(i + 1) % pts.length];
          if (!p || !q) continue;
          const dx = q.x - p.x,
            dy = q.y - p.y;
          if (dx * dx + dy * dy < 1e-8) continue;
          const rawAlpha =
              segAlpha && Number.isFinite(Number(segAlpha[i])) ? Number(segAlpha[i]) : Number(cmd.alpha) || 0,
            a = Math.max(0, Math.min(1, rawAlpha * c[3]));
          if (a <= 0.0001) continue;
          const wa = variable ? Math.max(0.02, Number(p?.widthScale) || 1) : 1,
            wb = variable ? Math.max(0.02, Number(q?.widthScale) || wa) : 1,
            hw = baseHw * Math.sqrt(wa * wb);
          const o = k * 9;
          instanceData[o] = p.x;
          instanceData[o + 1] = p.y;
          instanceData[o + 2] = q.x;
          instanceData[o + 3] = q.y;
          instanceData[o + 4] = hw;
          instanceData[o + 5] = c[0];
          instanceData[o + 6] = c[1];
          instanceData[o + 7] = c[2];
          instanceData[o + 8] = a;
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

    let firstStyle = null,
      multiStyle = false;
    for (const cmd of commands) {
      const st = String(cmd?.strokeStyle || '#ffffff');
      if (firstStyle === null) firstStyle = st;
      else if (st !== firstStyle) {
        multiStyle = true;
        break;
      }
    }
    if (!multiStyle) {
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.useProgram(program);
    gl.uniform2f(viewportUniform, width, height);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData.subarray(0, k * 9), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, k);
    gl.bindVertexArray(null);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      lastError = `GL error ${err}`;
      return false;
    }
    if (!deferComposite) composite(targetCtx);
    return true;
  }
  function composite(targetCtx) {
    if (!targetCtx || !canvas) return false;
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.globalAlpha = 1;
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.filter = 'none';
    targetCtx.drawImage(canvas, 0, 0);
    targetCtx.restore();
    return true;
  }
  function clear() {
    if (gl && canvas) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
  function status() {
    return { available: init(), lastError, width, height };
  }
  return { render, composite, clear, status, isAvailable: () => init() };
})();

export { GeometryWebGLRenderer };
