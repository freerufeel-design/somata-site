// WebGPU/GPU: заливка.
import './fill-mesh-renderer.js'; // initialisation order: this module runs after it
import { mainCtx } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { staticFillMaskStats } from '../render/fill-pass.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { FillWebGLRenderer } from './webgl-fill-renderer.js';
import { WebGPUDeviceHub } from './device-hub.js';
import { GPUColorCache, assertWebGPUShaderModule } from './gpu-utils.js';
import { WebGPUFillMeshRenderer } from './fill-mesh-renderer.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUFillRenderer = (() => {
  const canvas = document.createElement('canvas');
  let adapter = null,
    device = null,
    context = null,
    format = null,
    hubGeneration = 0;
  let pipeline = null,
    maskTexture = null,
    sampler = null,
    uniformBuffer = null,
    bindGroup = null;
  let attempted = false,
    initializing = false,
    ready = false,
    lost = false,
    lastError = '',
    width = 0,
    height = 0,
    submissions = 0,
    maskUploads = 0,
    maskUploadSkips = 0,
    uniformUploads = 0,
    uniformUploadSkips = 0,
    lastStaticMask = null,
    lastStaticMaskRevision = 0,
    lastUniformKey = '';
  const fillUniform = new Float32Array(4);
  const WGSL = `
struct FillUniform { color: vec4<f32> };
@group(0) @binding(0) var maskTex: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> u: FillUniform;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsMain(@builtin(vertex_index) vid:u32)->VSOut{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[vid];var o:VSOut;o.pos=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let cov=clamp(textureSample(maskTex,maskSampler,v.uv).a,0.0,1.0);
    let a=clamp(u.color.a*cov,0.0,1.0);
    return vec4<f32>(u.color.rgb*a,a);
}`;
  function resetGpuObjects() {
    try {
      maskTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-renderer#resetGpuObjects', error);
    }
    maskTexture = null;
    bindGroup = null;
    pipeline = null;
    sampler = null;
    uniformBuffer = null;
    lastStaticMask = null;
    lastStaticMaskRevision = 0;
    lastUniformKey = '';
  }
  async function initAsync() {
    if (ready && !lost) return true;
    if (initializing) return false;
    if (attempted && !ready && !lost) return false;
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
      const module = device.createShaderModule({ label: 'SpiroStar fill WGSL', code: WGSL });
      await assertWebGPUShaderModule(module, 'SpiroStar fill WGSL');
      pipeline = device.createRenderPipeline({
        label: 'SpiroStar fill pipeline',
        layout: 'auto',
        vertex: { module, entryPoint: 'vsMain' },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });
      uniformBuffer = device.createBuffer({
        label: 'SpiroStar fill uniform',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      ready = true;
      lost = false;
      lastError = '';
      try {
        requestMainCanvasRender();
      } catch (error) {
        noteSuppressedError('gpu/fill-renderer#initAsync', error);
      }
      return true;
    } catch (err) {
      ready = false;
      lastError = String(err?.message || err);
      console.warn('WebGPU fill disabled:', err);
      return false;
    } finally {
      initializing = false;
    }
  }
  function warmup() {
    const hubReady = WebGPUDeviceHub.warmup(),
      gen = WebGPUDeviceHub.getGeneration();
    if (ready && (!hubReady || gen !== hubGeneration)) {
      ready = false;
      attempted = false;
      initializing = false;
      lost = !hubReady;
      resetGpuObjects();
      try {
        context?.unconfigure?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-renderer#warmup', error);
      }
    }
    if (!ready && !initializing && (!attempted || lost)) void initAsync();
    return ready && !lost && hubReady;
  }
  function ensureSize(w, h) {
    if (!warmup()) return false;
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    if (width === w && height === h && maskTexture && canvas.width === w && canvas.height === h) return true;
    width = w;
    height = h;
    canvas.width = w;
    canvas.height = h;
    context.configure({ device, format, alphaMode: 'premultiplied' });
    try {
      maskTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-renderer#ensureSize', error);
    }
    maskTexture = device.createTexture({
      label: 'SpiroStar fill mask',
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    lastStaticMask = null;
    lastStaticMaskRevision = 0;
    lastUniformKey = '';
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: maskTexture.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });
    return true;
  }
  function render(mask, fillStyle, targetCtx) {
    if (!mask || !targetCtx || !ensureSize(mainCanvas.width, mainCanvas.height)) return false;
    const c = GPUColorCache.rgba(fillStyle);
    if (c[3] <= 0.00001) return true;
    try {
      fillUniform[0] = c[0];
      fillUniform[1] = c[1];
      fillUniform[2] = c[2];
      fillUniform[3] = c[3];
      const uniformKey = `${c[0].toFixed(6)}|${c[1].toFixed(6)}|${c[2].toFixed(6)}|${c[3].toFixed(6)}`;
      if (uniformKey !== lastUniformKey) {
        device.queue.writeBuffer(uniformBuffer, 0, fillUniform);
        lastUniformKey = uniformKey;
        uniformUploads++;
      } else {
        uniformUploadSkips++;
        staticFillMaskStats.uniformUploadSkips++;
      }
      const staticMask = mask.__spiroStaticFillMask === true,
        revision = staticMask ? Number(mask.__spiroFillMaskRevision) || 0 : 0;
      if (!(staticMask && mask === lastStaticMask && revision === lastStaticMaskRevision)) {
        device.queue.copyExternalImageToTexture({ source: mask }, { texture: maskTexture }, [width, height]);
        maskUploads++;
        if (staticMask) {
          lastStaticMask = mask;
          lastStaticMaskRevision = revision;
        } else {
          lastStaticMask = null;
          lastStaticMaskRevision = 0;
        }
      } else {
        maskUploadSkips++;
        staticFillMaskStats.gpuUploadSkips++;
      }
      const encoder = device.createCommandEncoder({ label: 'SpiroStar fill encoder' });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      submissions++;
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = 'source-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(canvas, 0, 0);
      targetCtx.restore();
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      ready = false;
      lost = true;
      requestMainCanvasRender();
      return false;
    }
  }
  function clear() {
    /* pass uses loadOp=clear; no retained presentation state */
  }
  function status() {
    warmup();
    return {
      supported: !!navigator?.gpu,
      attempted,
      initializing,
      available: ready && !lost && WebGPUDeviceHub.isReady(),
      lost,
      lastError,
      width,
      height,
      submissions,
      maskUploads,
      maskUploadSkips,
      uniformUploads,
      uniformUploadSkips,
      staticMaskResident: Boolean(lastStaticMask),
      hubGeneration,
    };
  }
  return { warmup, isReady: () => warmup(), render, clear, status };
})();
const FillGPURenderer = (() => {
  let active = 'none';
  function isAvailable() {
    WebGPUFillMeshRenderer.warmup();
    WebGPUFillRenderer.warmup();
    return (
      WebGPUFillMeshRenderer.isReady() || WebGPUFillRenderer.isReady() || FillWebGLRenderer.isAvailable()
    );
  }
  function renderMesh(frameCtx, mesh, targetCtx) {
    WebGPUFillMeshRenderer.warmup();
    if (WebGPUFillMeshRenderer.isReady() && WebGPUFillMeshRenderer.render(frameCtx, mesh, targetCtx)) {
      active = 'webgpu-mesh';
      return true;
    }
    return false;
  }
  function canEncodeMeshToTexture(frameCtx, mesh) {
    return WebGPUFillMeshRenderer.canEncodeToTexture(frameCtx, mesh);
  }
  function encodeMeshToTexture(encoder, targetTexture, frameCtx, mesh, targetCtx = mainCtx) {
    const rec = WebGPUFillMeshRenderer.encodeToTexture(encoder, targetTexture, frameCtx, mesh, targetCtx);
    if (rec?.handled) active = 'webgpu-mesh-layer-scene';
    return rec;
  }
  function encodeMeshCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    preserveTarget = false,
  ) {
    const rec = WebGPUFillMeshRenderer.encodeMeshCommandToTexture(
      targetTexture,
      frameCtx,
      mesh,
      targetCtx,
      preserveTarget,
    );
    if (rec?.handled) active = 'webgpu-mesh-layer-scene-command';
    return rec;
  }
  function encodeCorridorMeshCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    preserveTarget = false,
  ) {
    const rec = WebGPUFillMeshRenderer.encodeCorridorCommandToTexture(
      targetTexture,
      frameCtx,
      mesh,
      targetCtx,
      preserveTarget,
    );
    if (rec?.handled) active = 'webgpu-mesh-corridor-layer-scene';
    return rec;
  }
  function encodeMeshIsolatedCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    clearTarget = false,
  ) {
    const rec = WebGPUFillMeshRenderer.encodeMeshIsolatedCommandToTexture(
      targetTexture,
      frameCtx,
      mesh,
      targetCtx,
      clearTarget,
    );
    if (rec?.handled) active = 'webgpu-mesh-isolated-layer-scene';
    return rec;
  }
  function encodeCorridorMeshIsolatedCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    clearTarget = false,
  ) {
    const rec = WebGPUFillMeshRenderer.encodeCorridorIsolatedCommandToTexture(
      targetTexture,
      frameCtx,
      mesh,
      targetCtx,
      clearTarget,
    );
    if (rec?.handled) active = 'webgpu-mesh-corridor-isolated-layer-scene';
    return rec;
  }
  function render(mask, fillStyle, targetCtx) {
    WebGPUFillRenderer.warmup();
    if (WebGPUFillRenderer.isReady() && WebGPUFillRenderer.render(mask, fillStyle, targetCtx)) {
      active = 'webgpu-mask';
      return true;
    }
    const ok = FillWebGLRenderer.render(mask, fillStyle, targetCtx);
    if (ok) active = 'webgl2-mask';
    return ok;
  }
  function clear() {
    active = 'none';
    WebGPUFillMeshRenderer.clear();
    WebGPUFillRenderer.clear();
    FillWebGLRenderer.clear();
  }
  function status() {
    return {
      active,
      nativeMesh: WebGPUFillMeshRenderer.status(),
      webgpuMask: WebGPUFillRenderer.status(),
      webgl2: FillWebGLRenderer.status(),
    };
  }
  return {
    isAvailable,
    renderMesh,
    canEncodeMeshToTexture,
    encodeMeshToTexture,
    encodeMeshCommandToTexture,
    encodeCorridorMeshCommandToTexture,
    encodeMeshIsolatedCommandToTexture,
    encodeCorridorMeshIsolatedCommandToTexture,
    render,
    clear,
    status,
  };
})();

export { FillGPURenderer };
