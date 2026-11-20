// Проблеск (sweep): WebGL и WebGPU.
import '../render/stroke-command-cache.js'; // initialisation order: this module runs after it
import {
  SWEEP_BLEND_MODES,
  sweepBlendCanvasOperation,
  sweepBlendGpuState,
  sweepCoreBlendMode,
  sweepGlowBlendMode,
} from '../core/defaults-layers.js';
import { renderRuntime } from '../core/render-runtime.js';
import { performanceGovernor, requestMainCanvasRender } from '../core/scheduler.js';
import { SomataSweepLampBlend } from './sweep-lamp-blend.js';
import { mainCanvas, sweepGlCanvas } from '../ui/profile-presets.js';
import { WebGPUDeviceHub } from './device-hub.js';
import { WebGPUBufferRecycler } from './buffer-recycler.js';
import { GPUColorCache, assertWebGPUShaderModule } from './gpu-utils.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const SweepWebGLRenderer = (() => {
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
    count = 0,
    data = null;
  const canvas = sweepGlCanvas;
  const STRIDE = 12;
  const VERT = `#version 300 es
                precision highp float;
                layout(location=0) in vec2 aCorner;
                layout(location=1) in vec2 iStart;
                layout(location=2) in vec2 iEnd;
                layout(location=3) in float iHalfWidth;
                layout(location=4) in float iGlowRadius;
                layout(location=5) in vec3 iColor;
                layout(location=6) in float iCoreAlpha;
                layout(location=7) in float iGlowAlpha;
                uniform vec2 uViewport;
                out vec2 vLocal;
                flat out float vLen;
                flat out float vHalfWidth;
                flat out float vGlowRadius;
                flat out vec3 vColor;
                flat out float vCoreAlpha;
                flat out float vGlowAlpha;
                void main(){
                    vec2 d=iEnd-iStart;
                    float len=max(length(d),0.0001);
                    vec2 dir=d/len;
                    vec2 n=vec2(-dir.y,dir.x);
                    float pad=iHalfWidth+iGlowRadius+3.0;
                    float tx=(aCorner.x+1.0)*0.5;
                    float lx=mix(-pad,len+pad,tx);
                    float ly=aCorner.y*pad;
                    vec2 p=iStart+dir*lx+n*ly;
                    vec2 clip=vec2(p.x/uViewport.x*2.0-1.0,1.0-p.y/uViewport.y*2.0);
                    gl_Position=vec4(clip,0.0,1.0);
                    vLocal=vec2(lx,ly);vLen=len;vHalfWidth=iHalfWidth;vGlowRadius=iGlowRadius;
                    vColor=iColor;vCoreAlpha=iCoreAlpha;vGlowAlpha=iGlowAlpha;
                }`;
  const FRAG = `#version 300 es
                precision highp float;
                in vec2 vLocal;
                flat in float vLen;
                flat in float vHalfWidth;
                flat in float vGlowRadius;
                flat in vec3 vColor;
                flat in float vCoreAlpha;
                flat in float vGlowAlpha;
                out vec4 outColor;
                void main(){
                    float cx=clamp(vLocal.x,0.0,vLen);
                    float d=length(vec2(vLocal.x-cx,vLocal.y));
                    float centerCoverage=min(1.0,2.0*vHalfWidth);
                    float core=min(centerCoverage,clamp(vHalfWidth+0.5-d,0.0,1.0));
                    float edge=max(0.0,d-vHalfWidth);
                    float glow=0.0;
                    if(vGlowRadius>0.01){
                        float q=edge/max(0.55,vGlowRadius*0.44);
                        glow=exp(-q*q*1.65);
                        glow*=1.0-smoothstep(vGlowRadius*0.76,vGlowRadius+2.0,edge);
                    }
                    float intensity=max(0.0,vCoreAlpha*core+vGlowAlpha*glow);
                    float a=clamp(intensity,0.0,1.0);
                    outColor=vec4(vColor*a,a);
                }`;
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(sh) || 'sweep shader compile');
    return sh;
  }
  function init() {
    if (available && !lost) return true;
    if (attempted && !available) return false;
    attempted = true;
    try {
      if (!canvas) throw new Error('нет sweep GL canvas');
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
        throw new Error(gl.getProgramInfoLog(program) || 'sweep program link');
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
      const stride = STRIDE * 4;
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
      gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 5 * 4);
      gl.vertexAttribDivisor(4, 1);
      gl.enableVertexAttribArray(5);
      gl.vertexAttribPointer(5, 3, gl.FLOAT, false, stride, 6 * 4);
      gl.vertexAttribDivisor(5, 1);
      gl.enableVertexAttribArray(6);
      gl.vertexAttribPointer(6, 1, gl.FLOAT, false, stride, 9 * 4);
      gl.vertexAttribDivisor(6, 1);
      gl.enableVertexAttribArray(7);
      gl.vertexAttribPointer(7, 1, gl.FLOAT, false, stride, 10 * 4);
      gl.vertexAttribDivisor(7, 1);
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
        width = height = capacity = count = 0;
        init();
        requestMainCanvasRender();
      });
      available = true;
      lastError = '';
      return true;
    } catch (err) {
      available = false;
      lastError = String(err?.message || err);
      console.warn('WebGL sweep disabled:', err);
      return false;
    }
  }
  function ensureSize() {
    if (!init()) return false;
    const w = Math.max(1, mainCanvas.width | 0),
      h = Math.max(1, mainCanvas.height | 0);
    if (width === w && height === h && canvas.width === w && canvas.height === h) return true;
    canvas.width = w;
    canvas.height = h;
    width = w;
    height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }
  function ensureCapacity(n) {
    if (n <= capacity) return;
    capacity = performanceGovernor.capacityFor(n, capacity, 512, 1.7);
    const next = new Float32Array(capacity * STRIDE);
    if (data && count > 0) next.set(data.subarray(0, count * STRIDE));
    data = next;
  }
  const parseColor = GPUColorCache.rgb;
  let batchBlendMode = 'over';
  function beginBatch(blendMode = 'over') {
    count = 0;
    batchBlendMode = blendMode === 'max' ? 'max' : 'over';
    return init();
  }
  function queueStroke(ctx, pieces, lineWidth, color, coreAlpha = 1, glowRadius = 0, glowAlpha = 0) {
    if (!init() || !pieces?.length) return false;
    const tr = ctx?.getTransform?.();
    const a = Number(tr?.a) || 1,
      b = Number(tr?.b) || 0,
      c = Number(tr?.c) || 0,
      d = Number(tr?.d) || 1,
      e = Number(tr?.e) || 0,
      f = Number(tr?.f) || 0;
    const sx = Math.hypot(a, b),
      sy = Math.hypot(c, d),
      scale = Math.sqrt(Math.max(1e-12, sx * sy));
    const hw = Math.max(0.18, Math.abs(Number(lineWidth) || 1) * scale * 0.5),
      gr = Math.max(0, Number(glowRadius) || 0) * scale;
    const rgb = parseColor(color),
      ca = Math.max(0, Math.min(8, Number(coreAlpha) || 0)),
      ga = Math.max(0, Math.min(32, Number(glowAlpha) || 0));
    if (ca <= 0.0001 && ga <= 0.0001) return true;
    let add = 0;
    for (const pts of pieces || []) if (pts?.length > 1) add += pts.length - 1;
    if (!add) return true;
    ensureCapacity(count + add);
    for (const pts of pieces || []) {
      if (!pts || pts.length < 2) continue;
      let p0 = pts[0],
        px = a * (Number(p0?.x) || 0) + c * (Number(p0?.y) || 0) + e,
        py = b * (Number(p0?.x) || 0) + d * (Number(p0?.y) || 0) + f;
      for (let i = 1; i < pts.length; i++) {
        const qp = pts[i],
          qx = a * (Number(qp?.x) || 0) + c * (Number(qp?.y) || 0) + e,
          qy = b * (Number(qp?.x) || 0) + d * (Number(qp?.y) || 0) + f,
          dx = qx - px,
          dy = qy - py;
        if (dx * dx + dy * dy > 1e-8) {
          const o = count * STRIDE;
          data[o] = px;
          data[o + 1] = py;
          data[o + 2] = qx;
          data[o + 3] = qy;
          data[o + 4] = hw;
          data[o + 5] = gr;
          data[o + 6] = rgb[0];
          data[o + 7] = rgb[1];
          data[o + 8] = rgb[2];
          data[o + 9] = ca;
          data[o + 10] = ga;
          data[o + 11] = 0;
          count++;
        }
        px = qx;
        py = qy;
      }
    }
    return true;
  }
  function flush(targetCtx, clipPath = null) {
    if (!count) return true;
    if (!ensureSize()) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    if (batchBlendMode === 'max') {
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
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.bindVertexArray(null);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      lastError = `GL error ${err}`;
      count = 0;
      return false;
    }

    targetCtx.save();
    if (clipPath) {
      try {
        targetCtx.clip(clipPath, 'evenodd');
      } catch (_err) {
        targetCtx.clip(clipPath);
      }
    }
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.globalAlpha = 1;
    targetCtx.globalCompositeOperation = 'lighter';
    targetCtx.filter = 'none';
    targetCtx.drawImage(canvas, 0, 0);
    targetCtx.restore();
    count = 0;
    return true;
  }
  function clear() {
    count = 0;
    batchBlendMode = 'over';
    if (gl && canvas) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
  function status() {
    return { available: init(), lastError, width, height, count };
  }
  return { beginBatch, queueStroke, flush, clear, status, isAvailable: () => init() };
})();
const WebGPUSweepRenderer = (() => {
  const STRIDE = 13;
  const canvas = document.createElement('canvas');
  let adapter = null,
    device = null,
    context = null,
    format = null,
    cornerBuffer = null,
    instanceBuffers = [null, null, null],
    uniformBuffer = null,
    bindGroupLayout = null,
    bindGroup = null,
    pipelineMaxHalo = null,
    pipelineOverHalo = null,
    pipelineMaxCore = null,
    pipelineOverCore = null,
    pipelineMaxCombined = null,
    pipelineOverCombined = null;

  let sceneScratchTexture = null,
    sceneScratchView = null,
    sceneAddPipeline = null,
    sceneAddStencilPipeline = null,
    sceneOverPipeline = null,
    sceneOverStencilPipeline = null,
    sceneBlendPipelines = Object.create(null),
    sceneBlendStencilPipelines = Object.create(null),
    sceneCompositeBindGroupLayout = null,
    sceneAddBindGroup = null,
    sceneOverBindGroup = null;
  let sceneStencilTexture = null,
    sceneStencilView = null,
    sceneMaskPipeline = null,
    sceneMaskCapacity = 0,
    sceneMaskBuffers = [],
    sceneMaskCursor = 0;
  let sceneMaskResidentCache = new Map(),
    sceneTargetViewCache = new WeakMap(),
    sceneMaskResidentSerial = 0,
    sceneMaskResidentBuilds = 0,
    sceneMaskResidentHits = 0,
    sceneMaskResidentUploads = 0,
    sceneMaskResidentUploadSkips = 0,
    sceneMaskResidentEvictions = 0;

  let sceneInstanceResidentCache = new Map(),
    sceneInstanceResidentSerial = 0,
    sceneInstanceResidentBuilds = 0,
    sceneInstanceResidentHits = 0,
    sceneInstanceResidentUploads = 0,
    sceneInstanceResidentUploadSkips = 0,
    sceneInstanceResidentUploadBytes = 0,
    sceneInstanceResidentAvoidedBytes = 0,
    sceneInstanceResidentEvictions = 0;
  let batchResidencyKey = null,
    batchResidencyDynamic = false;
  let sceneBatchFrameId = -1,
    sceneBatchSlot = 0,
    lastUniformWidth = -1,
    lastUniformHeight = -1,
    viewportUniformUploads = 0,
    viewportUniformUploadSkips = 0;
  let attempted = false,
    initializing = false,
    ready = false,
    lost = false,
    lastError = '',
    hubGeneration = 0,
    width = 0,
    height = 0,
    capacity = 0,
    count = 0,
    data = null,
    batchBlendMode = 'over',
    submissions = 0,
    sceneDirectFrames = 0,
    sceneDirectSegments = 0,
    sceneClippedFrames = 0,
    sceneMaskUploads = 0;
  const uniformData = new Float32Array(12);
  const WGSL = `
struct Uniforms { viewport: vec2<f32>, _pad: vec2<f32>, };
@group(0) @binding(0) var<uniform> u: Uniforms;
struct VSIn {
    @location(0) corner: vec2<f32>,
    @location(1) start: vec2<f32>,
    @location(2) end: vec2<f32>,
    @location(3) halfWidth: f32,
    @location(4) glowRadius: f32,
    @location(5) color: vec3<f32>,
    @location(6) coreAlpha: f32,
    @location(7) glowAlpha: f32,
    @location(8) glowSoftness: f32,
    @location(9) kind: f32,
};
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) @interpolate(flat) segLen: f32,
    @location(2) @interpolate(flat) halfWidth: f32,
    @location(3) @interpolate(flat) glowRadius: f32,
    @location(4) @interpolate(flat) color: vec3<f32>,
    @location(5) @interpolate(flat) coreAlpha: f32,
    @location(6) @interpolate(flat) glowAlpha: f32,
    @location(7) @interpolate(flat) glowSoftness: f32,
    @location(8) @interpolate(flat) kind: f32,
};
@vertex fn vsMain(v:VSIn)->VSOut {
    var o:VSOut;
    let delta=v.end-v.start;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);
    let pad=v.halfWidth+v.glowRadius+3.0;let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let p=v.start+dir*lx+n*ly;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidth=v.halfWidth;o.glowRadius=v.glowRadius;o.color=v.color;o.coreAlpha=v.coreAlpha;o.glowAlpha=v.glowAlpha;o.glowSoftness=v.glowSoftness;o.kind=v.kind;return o;
}
fn shade(v:VSOut,corePass:bool)->vec4<f32>{
    let cx=clamp(v.local.x,0.0,v.segLen);let d=length(vec2<f32>(v.local.x-cx,v.local.y));let centerCoverage=min(1.0,2.0*v.halfWidth);let core=min(centerCoverage,clamp(v.halfWidth+0.5-d,0.0,1.0));let edge=max(0.0,d-v.halfWidth);var glow=0.0;
    if(v.glowRadius>0.01){let q=edge/max(0.0001,v.glowRadius);let s=clamp(v.glowSoftness,0.0,1.5);let start=mix(0.84,0.02,min(1.0,s));glow=1.0-smoothstep(start,1.0,q);if(s>1.0){glow=pow(max(0.0,glow),mix(1.0,0.58,min(1.0,(s-1.0)*2.0)));}}
    let intensity=max(0.0,select(v.glowAlpha*glow,v.coreAlpha*core,corePass));let a=clamp(intensity,0.0,1.0);return vec4<f32>(v.color*a,a);
}


@fragment fn fsHalo(v:VSOut)->@location(0) vec4<f32>{if(v.glowAlpha<=0.0001){discard;}let q=shade(v,false);if(q.a<0.00015){discard;}return q;}
@fragment fn fsCore(v:VSOut)->@location(0) vec4<f32>{if(v.coreAlpha<=0.0001){discard;}let q=shade(v,true);if(q.a<0.00015){discard;}return q;}


@fragment fn fsCombined(v:VSOut)->@location(0) vec4<f32>{
    if(v.coreAlpha<=0.0001&&v.glowAlpha<=0.0001){discard;}
    let core=shade(v,true).a;let halo=shade(v,false).a;
    let alpha=clamp(1.0-(1.0-core)*(1.0-halo),0.0,1.0);
    if(alpha<0.00015){discard;}return vec4<f32>(v.color*alpha,alpha);
}`;
  function blend(kind) {
    return kind === 'max'
      ? {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
        }
      : {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        };
  }
  async function initAsync() {
    if (ready && !lost) return true;
    if (initializing) return false;
    if (attempted && !ready) return false;
    attempted = true;
    initializing = true;
    lastError = '';
    try {
      const shared = await WebGPUDeviceHub.acquire();
      adapter = shared.adapter;
      device = shared.device;
      hubGeneration = shared.generation;
      lost = false;
      context = canvas.getContext('webgpu');
      if (!context) throw new Error('WebGPU canvas context недоступен');
      format = navigator.gpu.getPreferredCanvasFormat();
      const module = device.createShaderModule({ label: 'SpiroStar sweep WGSL', code: WGSL });
      await assertWebGPUShaderModule(module, 'SpiroStar sweep WGSL');
      bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const buffers = [
        {
          arrayStride: 8,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        },
        {
          arrayStride: STRIDE * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 1, offset: 0, format: 'float32x2' },
            { shaderLocation: 2, offset: 8, format: 'float32x2' },
            { shaderLocation: 3, offset: 16, format: 'float32' },
            { shaderLocation: 4, offset: 20, format: 'float32' },
            { shaderLocation: 5, offset: 24, format: 'float32x3' },
            { shaderLocation: 6, offset: 36, format: 'float32' },
            { shaderLocation: 7, offset: 40, format: 'float32' },
            { shaderLocation: 8, offset: 44, format: 'float32' },
            { shaderLocation: 9, offset: 48, format: 'float32' },
          ],
        },
      ];
      const make = (kind, passKind) =>
        device.createRenderPipeline({
          label: `SpiroStar sweep ${kind} ${passKind}`,
          layout,
          vertex: { module, entryPoint: 'vsMain', buffers },
          fragment: {
            module,
            entryPoint: passKind === 'combined' ? 'fsCombined' : passKind === 'core' ? 'fsCore' : 'fsHalo',
            targets: [{ format, blend: blend(kind) }],
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
        });
      pipelineMaxHalo = make('max', 'halo');
      pipelineOverHalo = make('over', 'halo');
      pipelineMaxCore = make('max', 'core');
      pipelineOverCore = make('over', 'core');
      pipelineMaxCombined = make('max', 'combined');
      pipelineOverCombined = make('over', 'combined');
      cornerBuffer = device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        label: 'SpiroStar sweep corners',
      });
      device.queue.writeBuffer(cornerBuffer, 0, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
      uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'SpiroStar sweep uniforms',
      });
      bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      const sceneModule = device.createShaderModule({
        label: 'SpiroStar sweep scene additive WGSL',
        code: `
@group(0) @binding(0) var srcTex:texture_2d<f32>;
struct V{@builtin(position) p:vec4<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);return o;}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let d=textureDimensions(srcTex);let q=vec2<i32>(clamp(i32(p.x),0,i32(d.x)-1),clamp(i32(p.y),0,i32(d.y)-1));return textureLoad(srcTex,q,0);}`,
      });
      await assertWebGPUShaderModule(sceneModule, 'SpiroStar sweep scene additive WGSL');
      const addBlend = {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
        overBlend = {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        };

      sceneCompositeBindGroupLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }],
      });
      const sceneLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneCompositeBindGroupLayout] });
      const stencilState = {
        format: 'depth24plus-stencil8',
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilFront: { compare: 'equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
        stencilBack: { compare: 'equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
        stencilReadMask: 1,
        stencilWriteMask: 0,
      };
      sceneBlendPipelines = Object.create(null);
      sceneBlendStencilPipelines = Object.create(null);
      for (const mode of typeof SWEEP_BLEND_MODES !== 'undefined'
        ? SWEEP_BLEND_MODES
        : ['normal', 'screen', 'multiply', 'add', 'darken', 'lighten']) {
        const blendState = sweepBlendGpuState(mode);
        sceneBlendPipelines[mode] = device.createRenderPipeline({
          label: `SpiroStar sweep ${mode} -> Layer Scene`,
          layout: sceneLayout,
          vertex: { module: sceneModule, entryPoint: 'vs' },
          fragment: { module: sceneModule, entryPoint: 'fs', targets: [{ format, blend: blendState }] },
          primitive: { topology: 'triangle-list' },
        });
        sceneBlendStencilPipelines[mode] = device.createRenderPipeline({
          label: `SpiroStar sweep ${mode} parity-clipped -> Layer Scene`,
          layout: sceneLayout,
          vertex: { module: sceneModule, entryPoint: 'vs' },
          fragment: { module: sceneModule, entryPoint: 'fs', targets: [{ format, blend: blendState }] },
          primitive: { topology: 'triangle-list' },
          depthStencil: stencilState,
        });
      }
      sceneAddPipeline = sceneBlendPipelines.add;
      sceneAddStencilPipeline = sceneBlendStencilPipelines.add;
      sceneOverPipeline = sceneBlendPipelines.normal;
      sceneOverStencilPipeline = sceneBlendStencilPipelines.normal;
      const maskModule = device.createShaderModule({
        label: 'SpiroStar lightning parity mask WGSL',
        code: `
struct Uniforms { viewport: vec2<f32>, _pad: vec2<f32>, };
@group(0) @binding(0) var<uniform> u: Uniforms;
struct Vin{@location(0) p:vec2<f32>}; struct Vout{@builtin(position) p:vec4<f32>};
@vertex fn vsMask(v:Vin)->Vout{var o:Vout;o.p=vec4<f32>(v.p.x/u.viewport.x*2.0-1.0,1.0-v.p.y/u.viewport.y*2.0,0.0,1.0);return o;}
@fragment fn fsMask()->@location(0) vec4<f32>{return vec4<f32>(0.0);}`,
      });
      await assertWebGPUShaderModule(maskModule, 'SpiroStar lightning parity mask WGSL');
      const invert = { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'invert' };
      sceneMaskPipeline = device.createRenderPipeline({
        label: 'SpiroStar lightning even-odd stencil',
        layout,
        vertex: {
          module: maskModule,
          entryPoint: 'vsMask',
          buffers: [
            {
              arrayStride: 8,
              stepMode: 'vertex',
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
            },
          ],
        },
        fragment: { module: maskModule, entryPoint: 'fsMask', targets: [{ format, writeMask: 0 }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: 'depth24plus-stencil8',
          depthWriteEnabled: false,
          depthCompare: 'always',
          stencilFront: invert,
          stencilBack: invert,
          stencilReadMask: 1,
          stencilWriteMask: 1,
        },
      });
      ready = true;
      initializing = false;
      lost = false;
      requestMainCanvasRender();
      return true;
    } catch (err) {
      ready = false;
      initializing = false;
      lastError = String(err?.message || err);
      return false;
    }
  }
  function destroyResidentSceneMasks() {
    for (const rec of sceneMaskResidentCache.values())
      if (rec?.buffer) WebGPUBufferRecycler.recycle(device, hubGeneration, rec.buffer);
    sceneMaskResidentCache = new Map();
    sceneTargetViewCache = new WeakMap();
  }
  function destroyResidentSceneInstances() {
    for (const rec of sceneInstanceResidentCache.values())
      if (rec?.buffer) WebGPUBufferRecycler.recycle(device, hubGeneration, rec.buffer);
    sceneInstanceResidentCache = new Map();
    batchResidencyKey = null;
    batchResidencyDynamic = false;
  }
  function warmup() {
    const hubReady = WebGPUDeviceHub.warmup(),
      gen = WebGPUDeviceHub.getGeneration();
    if (ready && (!hubReady || gen !== hubGeneration)) {
      ready = false;
      attempted = false;
      initializing = false;
      lost = !hubReady;
      try {
        context?.unconfigure?.();
      } catch (error) {
        noteSuppressedError('gpu/sweep-renderer#warmup', error);
      }
      for (const b of instanceBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/sweep-renderer#warmup', error);
        }
      for (const b of sceneMaskBuffers)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/sweep-renderer#warmup', error);
        }
      destroyResidentSceneMasks();
      destroyResidentSceneInstances();
      try {
        sceneScratchTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/sweep-renderer#warmup', error);
      }
      try {
        sceneStencilTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/sweep-renderer#warmup', error);
      }
      sceneScratchTexture = sceneScratchView = sceneAddBindGroup = sceneOverBindGroup = null;
      sceneCompositeBindGroupLayout = null;
      sceneStencilTexture = sceneStencilView = null;
      sceneMaskBuffers = [];
      sceneMaskCapacity = 0;
      sceneBatchFrameId = -1;
      sceneBatchSlot = 0;
      lastUniformWidth = lastUniformHeight = -1;
      instanceBuffers = [null, null, null];
      capacity = 0;
      data = null;
    }
    if (!ready && !initializing && (!attempted || lost)) void initAsync();
    return ready && !lost && hubReady;
  }
  function ensureSize() {
    if (!ready || lost || !device || !context) return false;
    const w = Math.max(1, mainCanvas.width | 0),
      h = Math.max(1, mainCanvas.height | 0);
    if (
      width === w &&
      height === h &&
      canvas.width === w &&
      canvas.height === h &&
      sceneScratchTexture &&
      sceneStencilTexture
    )
      return true;
    canvas.width = w;
    canvas.height = h;
    width = w;
    height = h;
    context.configure({ device, format, alphaMode: 'premultiplied' });
    try {
      sceneScratchTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/sweep-renderer#ensureSize', error);
    }
    try {
      sceneStencilTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/sweep-renderer#ensureSize', error);
    }
    destroyResidentSceneMasks();
    sceneScratchTexture = device.createTexture({
      label: 'SpiroStar sweep Layer Scene scratch',
      size: [w, h, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    sceneScratchView = sceneScratchTexture.createView();
    sceneStencilTexture = device.createTexture({
      label: 'SpiroStar lightning parity stencil',
      size: [w, h, 1],
      format: 'depth24plus-stencil8',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    sceneStencilView = sceneStencilTexture.createView();
    sceneAddBindGroup =
      sceneAddPipeline && sceneCompositeBindGroupLayout
        ? device.createBindGroup({
            layout: sceneCompositeBindGroupLayout,
            entries: [{ binding: 0, resource: sceneScratchView }],
          })
        : null;
    sceneOverBindGroup =
      sceneOverPipeline && sceneCompositeBindGroupLayout
        ? device.createBindGroup({
            layout: sceneCompositeBindGroupLayout,
            entries: [{ binding: 0, resource: sceneScratchView }],
          })
        : null;
    lastUniformWidth = lastUniformHeight = -1;
    return true;
  }
  function ensureCapacity(n) {
    const ringCount = performanceGovernor.ringCount(3);
    if (n <= capacity && instanceBuffers.length >= ringCount && instanceBuffers.every(Boolean) && data)
      return;
    const grow = n > capacity || !data || instanceBuffers.some((x) => !x);
    if (grow) {
      capacity = performanceGovernor.capacityFor(n, capacity, 512, 1.7);
      data = new Float32Array(capacity * STRIDE);
      for (const b of instanceBuffers) if (b) WebGPUBufferRecycler.recycle(device, hubGeneration, b);
      instanceBuffers = [];
    }
    while (instanceBuffers.length < ringCount)
      instanceBuffers.push(
        WebGPUBufferRecycler.acquire(
          device,
          hubGeneration,
          capacity * STRIDE * 4,
          GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          `SpiroStar sweep instances ${instanceBuffers.length}`,
        ),
      );
  }
  function ensureSceneInstanceSlots(minSlots) {
    const desired = Math.max(performanceGovernor.ringCount(3), Math.max(1, minSlots | 0));
    while (instanceBuffers.length < desired)
      instanceBuffers.push(
        WebGPUBufferRecycler.acquire(
          device,
          hubGeneration,
          capacity * STRIDE * 4,
          GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          `SpiroStar sweep deferred instances ${instanceBuffers.length}`,
        ),
      );
  }
  function ensureSceneMaskCapacity(vertexCount, minSlots = 1) {
    const desired = Math.max(performanceGovernor.ringCount(3), Math.max(1, minSlots | 0));
    if (vertexCount > sceneMaskCapacity || sceneMaskBuffers.some((x) => !x)) {
      sceneMaskCapacity = performanceGovernor.capacityFor(vertexCount, sceneMaskCapacity, 384, 1.65);
      for (const b of sceneMaskBuffers) if (b) WebGPUBufferRecycler.recycle(device, hubGeneration, b);
      sceneMaskBuffers = [];
    }
    while (sceneMaskBuffers.length < desired)
      sceneMaskBuffers.push(
        WebGPUBufferRecycler.acquire(
          device,
          hubGeneration,
          Math.max(8, sceneMaskCapacity * 8),
          GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          `SpiroStar lightning parity vertices ${sceneMaskBuffers.length}`,
        ),
      );
  }
  function ensureViewportUniform() {
    if (lastUniformWidth === width && lastUniformHeight === height) {
      viewportUniformUploadSkips++;
      return;
    }
    uniformData[0] = width;
    uniformData[1] = height;
    uniformData[2] = 0;
    uniformData[3] = 0;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, 16);
    lastUniformWidth = width;
    lastUniformHeight = height;
    viewportUniformUploads++;
  }
  function sceneTargetView(texture) {
    let view = sceneTargetViewCache.get(texture);
    if (!view) {
      view = texture.createView();
      sceneTargetViewCache.set(texture, view);
    }
    return view;
  }
  function pruneResidentSceneMasks(activeRec = null) {
    const limit = Math.max(24, 24 * (performanceGovernor.residencyScale?.() || 1));
    if (sceneMaskResidentCache.size <= limit) return;
    const victims = [...sceneMaskResidentCache.entries()]
      .filter(([, r]) => r !== activeRec)
      .sort((a, b) => (a[1]?.lastUsedFrame || 0) - (b[1]?.lastUsedFrame || 0));
    while (sceneMaskResidentCache.size > limit && victims.length) {
      const [key, rec] = victims.shift();
      sceneMaskResidentCache.delete(key);
      if (rec?.buffer) WebGPUBufferRecycler.recycle(device, hubGeneration, rec.buffer);
      sceneMaskResidentEvictions++;
    }
  }
  function acquireSceneMaskBuffer(clipGeometry, vertexCount, sceneSlot) {
    const verts = clipGeometry?.vertices instanceof Float32Array ? clipGeometry.vertices : null,
      floatCount = Math.max(
        0,
        Math.min(verts?.length || 0, Number(clipGeometry?.floatCount) || verts?.length || 0),
      ),
      key =
        clipGeometry?.resident === true && clipGeometry?.cacheKey && typeof clipGeometry.cacheKey === 'object'
          ? clipGeometry.cacheKey
          : null;
    if (!key) {
      ensureSceneMaskCapacity(vertexCount, sceneSlot + 1);
      const buffer = sceneMaskBuffers[sceneSlot];
      device.queue.writeBuffer(buffer, 0, verts.buffer, verts.byteOffset, floatCount * 4);
      sceneMaskUploads += floatCount * 4;
      return buffer;
    }
    let rec = sceneMaskResidentCache.get(key);
    const revision = Math.max(0, Number(clipGeometry?.revision) || 0);
    if (!rec || rec.generation !== hubGeneration || !rec.buffer || rec.capacity < vertexCount) {
      if (rec?.buffer) WebGPUBufferRecycler.recycle(device, hubGeneration, rec.buffer);
      const capacity = performanceGovernor.capacityFor(vertexCount, rec?.capacity || 0, 384, 1.65),
        buffer = WebGPUBufferRecycler.acquire(
          device,
          hubGeneration,
          Math.max(8, capacity * 8),
          GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          `SpiroStar resident lightning parity ${++sceneMaskResidentSerial}`,
        );
      rec = { buffer, capacity, revision: -1, generation: hubGeneration, lastUsedFrame: 0 };
      sceneMaskResidentCache.set(key, rec);
      sceneMaskResidentBuilds++;
    } else sceneMaskResidentHits++;
    rec.lastUsedFrame = Math.max(1, Number(renderRuntime?.frameId) || 1);
    if (rec.revision !== revision) {
      device.queue.writeBuffer(rec.buffer, 0, verts.buffer, verts.byteOffset, floatCount * 4);
      rec.revision = revision;
      sceneMaskUploads += floatCount * 4;
      sceneMaskResidentUploads++;
    } else sceneMaskResidentUploadSkips++;
    pruneResidentSceneMasks(rec);
    return rec.buffer;
  }
  function pruneResidentSceneInstances(activeRec = null) {
    const limit = Math.max(24, 24 * (performanceGovernor.residencyScale?.() || 1));
    if (sceneInstanceResidentCache.size <= limit) return;
    const victims = [...sceneInstanceResidentCache.entries()]
      .filter(([, r]) => r !== activeRec)
      .sort((a, b) => (a[1]?.lastUsedFrame || 0) - (b[1]?.lastUsedFrame || 0));
    while (sceneInstanceResidentCache.size > limit && victims.length) {
      const [key, rec] = victims.shift();
      sceneInstanceResidentCache.delete(key);
      if (rec?.buffer) WebGPUBufferRecycler.recycle(device, hubGeneration, rec.buffer);
      sceneInstanceResidentEvictions++;
    }
  }
  function residentInstancePayloadEqual(rec, floatCount) {
    if (!rec?.snapshot || rec.floatCount !== floatCount) return false;
    const snap = rec.snapshot;
    for (let i = 0; i < floatCount; i++) if (snap[i] !== data[i]) return false;
    return true;
  }
  function acquireSceneInstanceBuffer(sceneSlot) {
    const key =
      !batchResidencyDynamic && batchResidencyKey && typeof batchResidencyKey === 'object'
        ? batchResidencyKey
        : null;
    if (!key) {
      const buffer = instanceBuffers[sceneSlot];
      device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, count * STRIDE * 4);
      return buffer;
    }
    let rec = sceneInstanceResidentCache.get(key);
    if (!rec || rec.generation !== hubGeneration || !rec.buffer || rec.capacity < count) {
      if (rec?.buffer) WebGPUBufferRecycler.recycle(device, hubGeneration, rec.buffer);
      const cap = performanceGovernor.capacityFor(count, rec?.capacity || 0, 512, 1.7),
        buffer = WebGPUBufferRecycler.acquire(
          device,
          hubGeneration,
          Math.max(48, cap * STRIDE * 4),
          GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          `SpiroStar resident lightning batch ${++sceneInstanceResidentSerial}`,
        );
      rec = {
        buffer,
        capacity: cap,
        snapshot: new Float32Array(cap * STRIDE),
        floatCount: -1,
        generation: hubGeneration,
        lastUsedFrame: 0,
      };
      sceneInstanceResidentCache.set(key, rec);
      sceneInstanceResidentBuilds++;
    } else sceneInstanceResidentHits++;
    rec.lastUsedFrame = Math.max(1, Number(renderRuntime?.frameId) || 1);
    const floatCount = count * STRIDE,
      bytes = floatCount * 4;
    if (residentInstancePayloadEqual(rec, floatCount)) {
      sceneInstanceResidentUploadSkips++;
      sceneInstanceResidentAvoidedBytes += bytes;
    } else {
      device.queue.writeBuffer(rec.buffer, 0, data.buffer, data.byteOffset, bytes);
      rec.snapshot.set(data.subarray(0, floatCount), 0);
      rec.floatCount = floatCount;
      sceneInstanceResidentUploads++;
      sceneInstanceResidentUploadBytes += bytes;
    }
    pruneResidentSceneInstances(rec);
    return rec.buffer;
  }
  function acquireSceneSlot(frameId) {
    if (frameId !== undefined && frameId !== null) {
      const id = Number(frameId) || 0;
      if (id !== sceneBatchFrameId) {
        sceneBatchFrameId = id;
        sceneBatchSlot = 0;
      }
      const slot = sceneBatchSlot++;
      ensureSceneInstanceSlots(slot + 1);
      return slot;
    }
    const slot = (submissions + sceneDirectFrames) % Math.max(1, instanceBuffers.length);
    ensureSceneInstanceSlots(slot + 1);
    return slot;
  }
  function beginBatch(mode = 'over', residencyKey = null, dynamic = false) {
    if (!ready || lost) return false;
    count = 0;
    batchBlendMode = mode === 'max' ? 'max' : 'over';
    batchResidencyKey = residencyKey && typeof residencyKey === 'object' ? residencyKey : null;
    batchResidencyDynamic = dynamic === true;
    return true;
  }
  function queueStroke(
    ctx,
    pieces,
    lineWidth,
    color,
    coreAlpha = 1,
    glowRadius = 0,
    glowAlpha = 0,
    glowSoftness = 1,
  ) {
    if (!ready || lost || !pieces?.length) return false;
    const tr = ctx?.getTransform?.();
    const a = Number(tr?.a) || 1,
      b = Number(tr?.b) || 0,
      c = Number(tr?.c) || 0,
      d = Number(tr?.d) || 1,
      e = Number(tr?.e) || 0,
      f = Number(tr?.f) || 0;
    const sx = Math.hypot(a, b),
      sy = Math.hypot(c, d),
      scale = Math.sqrt(Math.max(1e-12, sx * sy));
    const hw = Math.max(0.18, Math.abs(Number(lineWidth) || 1) * scale * 0.5),
      gr = Math.max(0, Number(glowRadius) || 0) * scale;
    const rgb = GPUColorCache.rgb(color),
      ca = Math.max(0, Math.min(8, Number(coreAlpha) || 0)),
      ga = Math.max(0, Math.min(32, Number(glowAlpha) || 0)),
      gs = Math.max(0, Math.min(1.5, Number(glowSoftness) || 0));
    if (ca <= 0.0001 && ga <= 0.0001) return true;
    let add = 0;
    for (const pts of pieces) if (pts?.length > 1) add += pts.length - 1;
    if (!add) return true;
    ensureCapacity(count + add);
    for (const pts of pieces) {
      if (!pts || pts.length < 2) continue;
      let p0 = pts[0],
        px = a * (Number(p0?.x) || 0) + c * (Number(p0?.y) || 0) + e,
        py = b * (Number(p0?.x) || 0) + d * (Number(p0?.y) || 0) + f;
      for (let i = 1; i < pts.length; i++) {
        const qp = pts[i],
          qx = a * (Number(qp?.x) || 0) + c * (Number(qp?.y) || 0) + e,
          qy = b * (Number(qp?.x) || 0) + d * (Number(qp?.y) || 0) + f,
          dx = qx - px,
          dy = qy - py;
        if (dx * dx + dy * dy > 1e-8) {
          const o = count * STRIDE;
          data[o] = px;
          data[o + 1] = py;
          data[o + 2] = qx;
          data[o + 3] = qy;
          data[o + 4] = hw;
          data[o + 5] = gr;
          data[o + 6] = rgb[0];
          data[o + 7] = rgb[1];
          data[o + 8] = rgb[2];
          data[o + 9] = ca;
          data[o + 10] = ga;
          data[o + 11] = gs;
          data[o + 12] = ga > 0.0001 && ca <= 0.0001 ? 0 : 1;
          count++;
        }
        px = qx;
        py = qy;
      }
    }
    return true;
  }
  function flush(targetCtx, clipPath = null, cfg = null) {
    if (!count) return true;
    if (!ensureSize()) return false;
    try {
      const ringBuffer = instanceBuffers[submissions % instanceBuffers.length];
      device.queue.writeBuffer(ringBuffer, 0, data.buffer, data.byteOffset, count * STRIDE * 4);
      ensureViewportUniform();
      const glowMode = sweepGlowBlendMode(cfg),
        coreMode = sweepCoreBlendMode(cfg),
        drawStage = (core) => {
          const mode = core ? coreMode : glowMode,
            encoder = device.createCommandEncoder({
              label: core ? 'SpiroStar sweep core encoder' : 'SpiroStar sweep halo encoder',
            }),
            pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: context.getCurrentTexture().createView(),
                  clearValue: { r: 0, g: 0, b: 0, a: 0 },
                  loadOp: 'clear',
                  storeOp: 'store',
                },
              ],
            });
          pass.setPipeline(
            core === 'combined'
              ? batchBlendMode === 'max'
                ? pipelineMaxCombined
                : pipelineOverCombined
              : core
                ? batchBlendMode === 'max'
                  ? pipelineMaxCore
                  : pipelineOverCore
                : batchBlendMode === 'max'
                  ? pipelineMaxHalo
                  : pipelineOverHalo,
          );
          pass.setBindGroup(0, bindGroup);
          pass.setVertexBuffer(0, cornerBuffer);
          pass.setVertexBuffer(1, ringBuffer);
          pass.draw(6, count);
          pass.end();
          device.queue.submit([encoder.finish()]);
          submissions++;
          targetCtx.save();
          if (clipPath) {
            try {
              targetCtx.clip(clipPath, 'evenodd');
            } catch (_err) {
              targetCtx.clip(clipPath);
            }
          }
          targetCtx.setTransform(1, 0, 0, 1, 0, 0);
          targetCtx.globalAlpha = 1;
          targetCtx.globalCompositeOperation = sweepBlendCanvasOperation(mode);
          targetCtx.filter = 'none';
          targetCtx.drawImage(canvas, 0, 0);
          targetCtx.restore();
        };
      if (cfg?.effectType === 'lightning') drawStage('combined');
      else {
        drawStage(false);
        drawStage(true);
      }
      count = 0;
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      count = 0;
      return false;
    }
  }
  function encodeToLayerScene(
    targetTexture,
    clipGeometry = null,
    clipMode = 'symmetric',
    frameId = null,
    cfg = null,
  ) {
    if (!targetTexture) return null;
    if (!count) return { handled: true, commandBuffer: null };
    if (!ensureSize() || !sceneScratchView || !sceneAddBindGroup) return null;
    try {
      const sceneSlot = acquireSceneSlot(frameId),
        ringBuffer = acquireSceneInstanceBuffer(sceneSlot);
      ensureViewportUniform();
      const encoder = device.createCommandEncoder({ label: 'SpiroStar vector lightning -> Layer Scene' }),
        targetView = sceneTargetView(targetTexture);
      const verts = clipGeometry?.vertices instanceof Float32Array ? clipGeometry.vertices : null,
        floatCount = Math.max(
          0,
          Math.min(verts?.length || 0, Number(clipGeometry?.floatCount) || verts?.length || 0),
        ),
        vertexCount = Math.floor(floatCount / 2),
        clipped =
          (clipMode === 'inside' || clipMode === 'outside') &&
          vertexCount >= 3 &&
          sceneMaskPipeline &&
          sceneAddStencilPipeline &&
          sceneStencilView;
      let pass;
      if (clipped) {
        const maskBuffer = acquireSceneMaskBuffer(clipGeometry, vertexCount, sceneSlot);
        pass = encoder.beginRenderPass({
          colorAttachments: [{ view: targetView, loadOp: 'load', storeOp: 'store' }],
          depthStencilAttachment: {
            view: sceneStencilView,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
            stencilClearValue: 0,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store',
          },
        });
        pass.setPipeline(sceneMaskPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, maskBuffer);
        pass.draw(vertexCount);
        pass.end();
        sceneClippedFrames++;
      }
      const glowMode = sweepGlowBlendMode(cfg),
        coreMode = sweepCoreBlendMode(cfg),
        stage = (core) => {
          pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: sceneScratchView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          pass.setPipeline(
            core === 'combined'
              ? batchBlendMode === 'max'
                ? pipelineMaxCombined
                : pipelineOverCombined
              : core
                ? batchBlendMode === 'max'
                  ? pipelineMaxCore
                  : pipelineOverCore
                : batchBlendMode === 'max'
                  ? pipelineMaxHalo
                  : pipelineOverHalo,
          );
          pass.setBindGroup(0, bindGroup);
          pass.setVertexBuffer(0, cornerBuffer);
          pass.setVertexBuffer(1, ringBuffer);
          pass.draw(6, count);
          pass.end();
          const mode = core ? sweepCoreBlendMode(cfg) : sweepGlowBlendMode(cfg);
          if (
            SomataSweepLampBlend.encode(encoder, device, format, sceneScratchTexture, targetTexture, mode, {
              width,
              height,
              stencilView: clipped ? sceneStencilView : null,
              stencilReference: clipMode === 'inside' ? 1 : 0,
            })
          )
            return;
          const att = { view: targetView, loadOp: 'load', storeOp: 'store' },
            desc = { colorAttachments: [att] };
          if (clipped)
            desc.depthStencilAttachment = {
              view: sceneStencilView,
              depthLoadOp: 'load',
              depthStoreOp: 'discard',
              stencilLoadOp: 'load',
              stencilStoreOp: 'discard',
            };
          pass = encoder.beginRenderPass(desc);
          if (clipped) pass.setStencilReference(clipMode === 'inside' ? 1 : 0);
          const pipelines = clipped ? sceneBlendStencilPipelines : sceneBlendPipelines;
          pass.setPipeline(pipelines[mode] || pipelines.normal);
          pass.setBindGroup(0, core ? sceneOverBindGroup : sceneAddBindGroup);
          pass.draw(3);
          pass.end();
        };
      if (cfg?.effectType === 'lightning') stage('combined');
      else {
        stage(false);
        stage(true);
      }
      const n = count;
      count = 0;
      sceneDirectFrames++;
      sceneDirectSegments += n;
      return { handled: true, commandBuffer: encoder.finish() };
    } catch (err) {
      lastError = String(err?.message || err);
      count = 0;
      return null;
    }
  }
  function clear() {
    count = 0;
    batchBlendMode = 'over';
    batchResidencyKey = null;
    batchResidencyDynamic = false;
  }
  function status() {
    warmup();
    return {
      supported: !!navigator?.gpu,
      secure: !!globalThis.isSecureContext,
      attempted,
      initializing,
      available: ready && !lost && WebGPUDeviceHub.isReady(),
      lost,
      lastError,
      width,
      height,
      count,
      submissions,
      ringBuffers: instanceBuffers.length,
      sceneDirectFrames,
      sceneDirectSegments,
      sceneClippedFrames,
      sceneMaskUploads,
      sceneMaskRingBuffers: sceneMaskBuffers.length,
      sceneInstanceSlots: instanceBuffers.length,
      sceneFrameSlots: sceneBatchSlot,
      lightningResidency: {
        maskRecords: sceneMaskResidentCache.size,
        maskBuilds: sceneMaskResidentBuilds,
        maskHits: sceneMaskResidentHits,
        maskUploads: sceneMaskResidentUploads,
        maskUploadSkips: sceneMaskResidentUploadSkips,
        maskEvictions: sceneMaskResidentEvictions,
        strikeRecords: sceneInstanceResidentCache.size,
        strikeBuilds: sceneInstanceResidentBuilds,
        strikeHits: sceneInstanceResidentHits,
        strikeUploads: sceneInstanceResidentUploads,
        strikeUploadSkips: sceneInstanceResidentUploadSkips,
        strikeUploadBytes: sceneInstanceResidentUploadBytes,
        strikeAvoidedBytes: sceneInstanceResidentAvoidedBytes,
        strikeEvictions: sceneInstanceResidentEvictions,
        viewportUniformUploads,
        viewportUniformUploadSkips,
        policy:
          'static/non-Morph parity uses persistent WebGPU mask buffers; packed strike batches use persistent WebGPU instance buffers with exact upload dedup; dynamic/Morph geometry uses ring fallback',
      },
      hub: WebGPUDeviceHub.status(),
    };
  }
  return {
    warmup,
    isReady: () => {
      warmup();
      return ready && !lost;
    },
    beginBatch,
    queueStroke,
    flush,
    encodeToLayerScene,
    clear,
    status,
  };
})();
const SweepGPURenderer = (() => {
  let active = 'none';
  function isAvailable() {
    WebGPUSweepRenderer.warmup();
    return WebGPUSweepRenderer.isReady();
  }
  function beginBatch(mode = 'over', residencyKey = null, dynamic = false) {
    WebGPUSweepRenderer.warmup();
    if (!WebGPUSweepRenderer.isReady()) {
      active = 'none';
      return false;
    }
    active = 'webgpu';
    return WebGPUSweepRenderer.beginBatch(mode, residencyKey, dynamic);
  }
  function queueStroke(...args) {
    return active === 'webgpu' && WebGPUSweepRenderer.queueStroke(...args);
  }
  function flush(...args) {
    return active === 'webgpu' && WebGPUSweepRenderer.flush(...args);
  }
  function canEncodeToLayerScene() {
    WebGPUSweepRenderer.warmup();
    return WebGPUSweepRenderer.isReady();
  }
  function encodeToLayerScene(
    targetTexture,
    clipGeometry = null,
    clipMode = 'symmetric',
    frameId = null,
    cfg = null,
  ) {
    if (active !== 'webgpu') return null;
    return WebGPUSweepRenderer.encodeToLayerScene(targetTexture, clipGeometry, clipMode, frameId, cfg);
  }
  function clear() {
    WebGPUSweepRenderer.clear();
    active = 'none';
  }
  function status() {
    return { active, webgpu: WebGPUSweepRenderer.status(), contract: 'webgpu-only' };
  }
  return {
    isAvailable,
    beginBatch,
    queueStroke,
    flush,
    canEncodeToLayerScene,
    encodeToLayerScene,
    clear,
    status,
  };
})();

export { SweepGPURenderer, WebGPUSweepRenderer };
