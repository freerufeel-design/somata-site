// WebGPU: маркеры профиля.
import './sweep-renderer.js'; // initialisation order: this module runs after it
import { performanceGovernor, requestMainCanvasRender } from '../core/scheduler.js';
import { packTunnelEffectCopyRecords, pointAtPathDistance } from '../geometry/frame-paths.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { WebGPUDeviceHub } from './device-hub.js';
import { GPUColorCache, assertWebGPUShaderModule } from './gpu-utils.js';
import { WebGPUCorridorCopyStore } from './corridor-copy-store.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUProfileMarkerRenderer = (() => {
  const canvas = document.createElement('canvas');
  let adapter = null,
    device = null,
    context = null,
    format = null,
    cornerBuffer = null,
    uniformBuffer = null,
    bindGroup = null,
    pipeline = null,
    corridorPipeline = null,
    corridorUniformBindGroup = null;
  let attempted = false,
    initializing = false,
    ready = false,
    lost = false,
    lastError = '',
    hubGeneration = 0,
    width = 0,
    height = 0,
    capacity = 0,
    ring = [null, null, null],
    ringIndex = 0,
    positions = null,
    submissions = 0,
    frames = 0,
    sceneDirectFrames = 0,
    sceneDirectCorridorFrames = 0;
  const profileMarkerDiagnostic = {
    stage: 'idle',
    reason: '',
    lastBackend: 'none',
    geometryPreparation: 'CPU arc-length sampling -> marker-center buffer',
    gpuUpload: false,
    gpuDraw: false,
    presentation: 'none',
    failures: 0,
    lastFailureAt: 0,
    lastSuccessAt: 0,
  };
  let profileMarkerLastLoggedFailure = '';
  function profileMarkerFail(stage, reason, err = null, extra = null) {
    const msg = String(reason || err?.message || err || 'unknown failure');
    lastError = msg;
    profileMarkerDiagnostic.stage = String(stage || 'unknown');
    profileMarkerDiagnostic.reason = msg;
    profileMarkerDiagnostic.failures++;
    profileMarkerDiagnostic.lastFailureAt = performance.now();
    const sig = profileMarkerDiagnostic.stage + '|' + msg;
    if (sig !== profileMarkerLastLoggedFailure) {
      profileMarkerLastLoggedFailure = sig;
      console.error(
        `[SpiroStar Dash GPU] ${profileMarkerDiagnostic.stage}: ${msg}`,
        {
          stage: profileMarkerDiagnostic.stage,
          reason: msg,
          geometryPreparation: profileMarkerDiagnostic.geometryPreparation,
          lastBackend: profileMarkerDiagnostic.lastBackend,
          ...(extra || {}),
        },
        err || '',
      );
    }
  }
  function profileMarkerOk(stage, backend = 'webgpu', presentation = 'gpu') {
    profileMarkerDiagnostic.stage = stage;
    profileMarkerDiagnostic.reason = '';
    profileMarkerDiagnostic.lastBackend = backend;
    profileMarkerDiagnostic.gpuUpload = true;
    profileMarkerDiagnostic.gpuDraw = true;
    profileMarkerDiagnostic.presentation = presentation;
    profileMarkerDiagnostic.lastSuccessAt = performance.now();
    lastError = '';
  }
  let copyCapacity = 0,
    copyRing = [null, null, null],
    copyData = null,
    copyRingIndex = 0,
    corridorUploads = 0,
    corridorDraws = 0,
    corridorLogicalInstances = 0,
    corridorBindGroups = 0,
    sharedCopyReuse = 0,
    sharedCorridorBindCache = new WeakMap();
  let staticBuilds = 0,
    staticHits = 0,
    dynamicUploads = 0,
    staticUploads = 0;
  let profileUniformRecords = new WeakMap(),
    profileUniformRecordSet = new Set(),
    profileUniformBuilds = 0,
    profileUniformUploads = 0,
    profileUniformUploadSkips = 0;

  let profileLayerSceneViews = new WeakMap(),
    profileLayerSceneViewBuilds = 0,
    profileLayerSceneViewHits = 0;
  let profileSceneBundleBuilds = 0,
    profileSceneBundleHits = 0,
    profileSceneBundleExecutes = 0,
    profileSceneBundleFallbacks = 0;
  const uniformF32 = new Float32Array(24);
  const staticMarkerCache = new WeakMap();
  let corridorBindCache = new WeakMap();
  const WGSL = `
struct Uniforms {
    viewport: vec2<f32>, markerType: f32, aaLocal: f32,
    row0: vec4<f32>, row1: vec4<f32>, params: vec4<f32>, color: vec4<f32>, extra: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
struct ProfileCopy { row0: vec4<f32>, row1: vec4<f32>, };
@group(1) @binding(0) var<storage,read> markerCenters: array<vec2<f32>>;
@group(1) @binding(1) var<storage,read> profileCopies: array<ProfileCopy>;
struct VSIn { @location(0) corner: vec2<f32>, @location(1) center: vec2<f32>, };
struct CornerIn { @location(0) corner: vec2<f32>, };
struct VSOut { @builtin(position) position: vec4<f32>, @location(0) local: vec2<f32>, @location(1) @interpolate(flat) copyAlpha: f32, @location(2) @interpolate(flat) aaLocal: f32, };
fn markerLocal(corner:vec2<f32>,aa:f32)->vec2<f32>{let isSlash=u.markerType<0.5;let pad=max(0.0,u.extra.z)+aa*1.5;let ex=select(u.params.z+pad,u.params.x+pad,isSlash);let ey=select(u.params.z+pad,u.params.y+pad,isSlash);return vec2<f32>(corner.x*ex,corner.y*ey);}
fn markerOffset(corner:vec2<f32>,aa:f32)->vec2<f32>{let q=markerLocal(corner,aa);let c=0.7071067811865476;return vec2<f32>(c*(q.x-q.y),c*(q.x+q.y));}

fn toScreen(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
@vertex fn vsMain(v:VSIn)->VSOut {
    var o:VSOut;let q=markerLocal(v.corner,u.aaLocal);
    let p=v.center+markerOffset(v.corner,u.aaLocal);let screen=toScreen(p);o.position=vec4<f32>(screen.x/u.viewport.x*2.0-1.0,1.0-screen.y/u.viewport.y*2.0,0.0,1.0);o.local=q;o.copyAlpha=1.0;o.aaLocal=u.aaLocal;return o;
}
@vertex fn vsCorridor(v:CornerIn,@builtin(instance_index) iid:u32)->VSOut {
    var o:VSOut;let markerCount=max(1u,u32(u.extra.x+0.5));let mi=iid%markerCount;let ci=iid/markerCount;let cp=profileCopies[ci];
    let aa=u.aaLocal/max(0.000001,cp.row1.z);let q=markerLocal(v.corner,aa);
    let localP=markerCenters[mi]+markerOffset(v.corner,aa);let p=vec2<f32>(cp.row0.x*localP.x+cp.row0.y*localP.y,cp.row1.x*localP.x+cp.row1.y*localP.y);let screen=toScreen(p);
    o.position=vec4<f32>(screen.x/u.viewport.x*2.0-1.0,1.0-screen.y/u.viewport.y*2.0,0.0,1.0);o.local=q;o.copyAlpha=cp.row0.z;o.aaLocal=aa;return o;
}
fn markerSd(p:vec2<f32>)->f32{
    if(u.markerType<0.5){let cx=clamp(p.x,-u.params.x,u.params.x);return length(vec2<f32>(p.x-cx,p.y))-u.params.y;}
    if(u.markerType<1.5){return max(abs(p.x),abs(p.y))-u.params.z;}
    if(u.markerType<2.5){return length(p)-u.params.z;}
    let arm=u.params.z;let bar=max(0.55,arm*0.24);let dh=max(abs(p.x)-arm,abs(p.y)-bar);let dv=max(abs(p.y)-arm,abs(p.x)-bar);return min(dh,dv);
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32> {
    let aa=max(0.0001,v.aaLocal);let sd=markerSd(v.local);let mode=i32(u.extra.y+0.5);var cov=0.0;
    if(mode==1){let r=max(aa,u.extra.z);let q=max(0.0,sd)/r;cov=exp(-3.35*q*q)*(1.0-smoothstep(0.86,1.08,q));}
    else if(mode==2){let ex=max(aa,u.extra.z);cov=(1.0-smoothstep(ex,ex+aa,sd))*smoothstep(-aa,aa,sd);}
    else{cov=1.0-smoothstep(0.0,aa,sd);}
    let a=clamp(u.color.a*u.params.w*v.copyAlpha*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(u.color.rgb*a,a);
}`;
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
      format = navigator.gpu.getPreferredCanvasFormat();
      const module = device.createShaderModule({ label: 'SpiroStar profile markers WGSL', code: WGSL });
      await assertWebGPUShaderModule(module, 'SpiroStar profile markers WGSL');
      const target = {
        format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      };
      pipeline = device.createRenderPipeline({
        label: 'SpiroStar profile markers',
        layout: 'auto',
        vertex: {
          module,
          entryPoint: 'vsMain',
          buffers: [
            {
              arrayStride: 8,
              stepMode: 'vertex',
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
            },
            {
              arrayStride: 8,
              stepMode: 'instance',
              attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }],
            },
          ],
        },
        fragment: { module, entryPoint: 'fsMain', targets: [target] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
      });
      corridorPipeline = device.createRenderPipeline({
        label: 'SpiroStar Corridor profile markers',
        layout: 'auto',
        vertex: {
          module,
          entryPoint: 'vsCorridor',
          buffers: [
            {
              arrayStride: 8,
              stepMode: 'vertex',
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
            },
          ],
        },
        fragment: { module, entryPoint: 'fsMain', targets: [target] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
      });
      cornerBuffer = device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        label: 'SpiroStar profile marker corners',
      });
      device.queue.writeBuffer(cornerBuffer, 0, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
      uniformBuffer = device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'SpiroStar profile marker uniforms',
      });
      bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      corridorUniformBindGroup = device.createBindGroup({
        layout: corridorPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      ready = true;
      initializing = false;
      requestMainCanvasRender();
      return true;
    } catch (err) {
      ready = false;
      initializing = false;
      profileMarkerFail('init/pipeline', err?.message || err, err);
      return false;
    }
  }
  function resetDeviceResources() {
    try {
      context?.unconfigure?.();
    } catch (error) {
      noteSuppressedError('gpu/profile-marker-renderer#resetDeviceResources', error);
    }
    for (const b of ring)
      try {
        b?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/profile-marker-renderer#resetDeviceResources', error);
      }
    for (const b of copyRing)
      try {
        b?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/profile-marker-renderer#resetDeviceResources', error);
      }
    for (const rec of profileUniformRecordSet)
      try {
        rec?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/profile-marker-renderer#resetDeviceResources', error);
      }
    profileUniformRecordSet.clear();
    profileUniformRecords = new WeakMap();
    profileLayerSceneViews = new WeakMap();
    ring = [null, null, null];
    copyRing = [null, null, null];
    capacity = copyCapacity = 0;
    positions = copyData = null;
    corridorBindCache = new WeakMap();
    sharedCorridorBindCache = new WeakMap();
  }
  function warmup() {
    const hubReady = WebGPUDeviceHub.warmup(),
      gen = WebGPUDeviceHub.getGeneration();
    if (ready && (!hubReady || gen !== hubGeneration)) {
      ready = false;
      attempted = false;
      initializing = false;
      lost = !hubReady;
      resetDeviceResources();
    }
    if (!ready && !initializing && (!attempted || lost)) void initAsync();
    return ready && !lost && hubReady;
  }
  function ensureLogicalSize() {
    if (!ready || lost || !device) return false;
    const w = Math.max(1, mainCanvas.width | 0),
      h = Math.max(1, mainCanvas.height | 0);
    width = w;
    height = h;
    return true;
  }
  function ensureSize() {
    if (!ensureLogicalSize()) return false;
    if (!context) context = canvas.getContext('webgpu');
    if (!context) return false;
    const w = width,
      h = height;
    if (canvas.width === w && canvas.height === h) return true;
    canvas.width = w;
    canvas.height = h;
    context.configure({ device, format, alphaMode: 'premultiplied' });
    return true;
  }
  function ensureCapacity(n) {
    const desired = performanceGovernor.stickyRingCount(3, ring.length),
      grow = n > capacity || !positions || ring.some((x) => !x);
    if (grow) {
      capacity = performanceGovernor.capacityFor(n, capacity, 256, 1.7);
      positions = new Float32Array(capacity * 2);
      for (const b of ring)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/profile-marker-renderer#ensureCapacity', error);
        }
      ring = [];
      corridorBindCache = new WeakMap();
    }
    while (ring.length < desired)
      ring.push(
        device.createBuffer({
          size: capacity * 8,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          label: `SpiroStar profile marker positions ${ring.length}`,
        }),
      );
  }
  function ensureCopyCapacity(n) {
    const desired = performanceGovernor.stickyRingCount(3, copyRing.length),
      grow = n > copyCapacity || !copyData || copyRing.some((x) => !x);
    if (grow) {
      copyCapacity = performanceGovernor.capacityFor(n, copyCapacity, 32, 1.6);
      copyData = new Float32Array(copyCapacity * 8);
      for (const b of copyRing)
        try {
          b?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/profile-marker-renderer#ensureCopyCapacity', error);
        }
      copyRing = [];
      corridorBindCache = new WeakMap();
    }
    while (copyRing.length < desired)
      copyRing.push(
        device.createBuffer({
          size: Math.max(32, copyCapacity * 8 * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          label: `SpiroStar Corridor profile copies ${copyRing.length}`,
        }),
      );
  }
  function profileSharedBind(positionBuffer, copyBuffer) {
    let byCopy = sharedCorridorBindCache.get(positionBuffer);
    if (!byCopy) {
      byCopy = new WeakMap();
      sharedCorridorBindCache.set(positionBuffer, byCopy);
    }
    let bg = byCopy.get(copyBuffer);
    if (!bg) {
      bg = device.createBindGroup({
        layout: corridorPipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: positionBuffer } },
          { binding: 1, resource: { buffer: copyBuffer } },
        ],
      });
      byCopy.set(copyBuffer, bg);
      corridorBindGroups++;
    }
    return bg;
  }
  function profileCopyRecord(copies, alphas, frameCtx, footprint, layer) {
    const shared = WebGPUCorridorCopyStore.acquire(
      device,
      hubGeneration,
      frameCtx,
      copies,
      alphas,
      'graffiti',
      footprint,
      layer,
    );
    if (shared?.buffer) {
      sharedCopyReuse++;
      return { buffer: shared.buffer, k: shared.k, shared: true };
    }
    ensureCopyCapacity(copies.length);
    const k = packTunnelEffectCopyRecords(copyData, copies, alphas, frameCtx, 'graffiti', footprint, layer);
    if (!k) return { buffer: null, k: 0, shared: false };
    const slot = copyRingIndex++ % copyRing.length,
      buffer = copyRing[slot];
    device.queue.writeBuffer(buffer, 0, copyData.buffer, copyData.byteOffset, k * 8 * 4);
    corridorUploads += k * 8 * 4;
    return { buffer, k, slot, shared: false };
  }
  function buildPositions(table, count, target) {
    profileMarkerDiagnostic.geometryPreparation = 'CPU arc-length sampling -> marker-center buffer';
    const out = target || new Float32Array(count * 2),
      p = { x: 0, y: 0 };
    for (let i = 0; i < count; i++) {
      pointAtPathDistance(table, ((i + 0.5) / count) * table.total, p);
      out[i * 2] = p.x;
      out[i * 2 + 1] = p.y;
    }
    return out;
  }
  function staticRecord(table, count) {
    if (!table || table.dynamicFrame === true) return null;
    let variants = staticMarkerCache.get(table);
    if (!variants) {
      variants = new Map();
      staticMarkerCache.set(table, variants);
    }
    let rec = variants.get(count);
    if (rec && rec.generation === hubGeneration) {
      staticHits++;
      return rec;
    }
    const cpu = buildPositions(table, count);
    const buffer = device.createBuffer({
      size: Math.max(8, cpu.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'SpiroStar static profile marker positions',
    });
    device.queue.writeBuffer(buffer, 0, cpu);
    staticUploads += cpu.byteLength;
    rec = { generation: hubGeneration, buffer, count };
    variants.set(count, rec);
    staticBuilds++;
    return rec;
  }
  function preparePositionBuffer(table, count) {
    const sr = staticRecord(table, count);
    if (sr) return sr.buffer;
    ensureCapacity(count);
    const b = ring[ringIndex++ % ring.length];
    buildPositions(table, count, positions);
    device.queue.writeBuffer(b, 0, positions.buffer, positions.byteOffset, count * 8);
    dynamicUploads += count * 8;
    return b;
  }
  function sameProfileUniform(a, b) {
    for (let i = 0; i < 24; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function profileUniformRecord(layer) {
    if (!layer || typeof layer !== 'object')
      return {
        buffer: uniformBuffer,
        normalBind: bindGroup,
        corridorBind: corridorUniformBindGroup,
        snapshot: null,
        hasLast: false,
        fallback: true,
        normalBundles: null,
        corridorBundles: null,
      };
    let rec = profileUniformRecords.get(layer);
    if (rec && rec.generation === hubGeneration && rec.buffer) return rec;
    const buffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'SpiroStar resident profile uniforms',
    });
    rec = {
      buffer,
      normalBind: device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }],
      }),
      corridorBind: device.createBindGroup({
        layout: corridorPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }],
      }),
      snapshot: new Float32Array(24),
      hasLast: false,
      generation: hubGeneration,
      normalBundles: new WeakMap(),
      corridorBundles: new WeakMap(),
    };
    profileUniformRecords.set(layer, rec);
    profileUniformRecordSet.add(rec);
    profileUniformBuilds++;
    return rec;
  }
  function prepareUniforms(table, layer, alpha, ctx, prepared, count, opts = {}) {
    const type = prepared?.type || layer?.lineProfile,
      tr = ctx?.getTransform?.(),
      a = Number(tr?.a) || 1,
      b = Number(tr?.b) || 0,
      c = Number(tr?.c) || 0,
      d = Number(tr?.d) || 1,
      e = Number(tr?.e) || 0,
      f = Number(tr?.f) || 0,
      scale = Math.sqrt(Math.max(1e-12, Math.abs(a * d - b * c)));
    const baseW = Math.max(0.001, Number(prepared?.w) || Math.max(0.5, Number(layer?.strokeWidth) || 1.5)),
      w = Math.max(0.001, baseW + (Number(opts.widthDeltaLocal) || 0)),
      spacing = Math.max(2.4, Number(prepared?.spacing) || baseW * (type === 'slash' ? 1.85 : 1.55));
    const halfLen = type === 'slash' ? Math.max(w * 1.25, spacing * 0.58) : 0,
      halfWidth = type === 'slash' ? Math.max(0.65, w * 0.78) * 0.5 : 0,
      halfSize =
        type === 'circle' ? Math.max(0.9, w * 0.72) : Math.max(1.4, Math.max(w * 1.35, spacing * 0.78)) * 0.5,
      col = GPUColorCache.rgba(opts.colorOverride || layer?.strokeColor || '#ffffff'),
      globalAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
    const markerType = type === 'square' ? 1 : type === 'circle' ? 2 : type === 'cross' ? 3 : 0,
      effectMode = opts.mode === 'glow' ? 1 : opts.mode === 'outline' ? 2 : 0,
      extraLocal = Math.max(
        0,
        Number.isFinite(Number(opts.extraLocal))
          ? Number(opts.extraLocal)
          : (Number(opts.extraPx) || 0) / Math.max(0.0001, scale),
      );
    uniformF32.fill(0);
    uniformF32[0] = width;
    uniformF32[1] = height;
    uniformF32[2] = markerType;
    uniformF32[3] = Math.max(0.0001, 0.75 / Math.max(0.0001, scale));
    uniformF32[4] = a;
    uniformF32[5] = c;
    uniformF32[6] = e;
    uniformF32[8] = b;
    uniformF32[9] = d;
    uniformF32[10] = f;
    uniformF32[12] = halfLen;
    uniformF32[13] = halfWidth;
    uniformF32[14] = halfSize;
    uniformF32[15] = globalAlpha;
    uniformF32[16] = col[0];
    uniformF32[17] = col[1];
    uniformF32[18] = col[2];
    uniformF32[19] = col[3];
    uniformF32[20] = count;
    uniformF32[21] = effectMode;
    uniformF32[22] = extraLocal;
    const ur = profileUniformRecord(layer),
      changed = ur.fallback || !ur.hasLast || !sameProfileUniform(uniformF32, ur.snapshot);
    if (changed) {
      device.queue.writeBuffer(ur.buffer, 0, uniformF32);
      profileUniformUploads++;
      if (ur.snapshot) {
        ur.snapshot.set(uniformF32);
        ur.hasLast = true;
      }
    } else profileUniformUploadSkips++;
    return { alpha: globalAlpha, normalBind: ur.normalBind, corridorBind: ur.corridorBind, record: ur };
  }
  function profileLayerSceneView(texture) {
    let view = profileLayerSceneViews.get(texture);
    if (view) {
      profileLayerSceneViewHits++;
      return view;
    }
    try {
      view = texture.createView();
      profileLayerSceneViews.set(texture, view);
      profileLayerSceneViewBuilds++;
      return view;
    } catch (_) {
      return texture.createView();
    }
  }
  function normalSceneBundle(rec, positionBuffer, count) {
    if (!rec || rec.fallback || !rec.normalBundles || typeof device?.createRenderBundleEncoder !== 'function')
      return null;
    let hit = rec.normalBundles.get(positionBuffer);
    if (hit && hit.count === count && hit.bundle) {
      profileSceneBundleHits++;
      return hit;
    }
    try {
      const rbe = device.createRenderBundleEncoder({
        label: 'SpiroStar profile marker Layer Scene bundle',
        colorFormats: [format],
      });
      rbe.setPipeline(pipeline);
      rbe.setBindGroup(0, rec.normalBind);
      rbe.setVertexBuffer(0, cornerBuffer);
      rbe.setVertexBuffer(1, positionBuffer);
      rbe.draw(6, count);
      const bundle = rbe.finish();
      hit = { count, bundle, list: [bundle] };
      rec.normalBundles.set(positionBuffer, hit);
      profileSceneBundleBuilds++;
      return hit;
    } catch (_) {
      profileSceneBundleFallbacks++;
      return null;
    }
  }
  function corridorSceneBundle(rec, positionBuffer, copyBuffer, bg, count, k) {
    if (
      !rec ||
      rec.fallback ||
      !rec.corridorBundles ||
      !copyBuffer ||
      !bg ||
      typeof device?.createRenderBundleEncoder !== 'function'
    )
      return null;
    let byCopy = rec.corridorBundles.get(positionBuffer);
    if (!byCopy) {
      byCopy = new WeakMap();
      rec.corridorBundles.set(positionBuffer, byCopy);
    }
    let hit = byCopy.get(copyBuffer);
    if (hit && hit.count === count && hit.k === k && hit.bg === bg && hit.bundle) {
      profileSceneBundleHits++;
      return hit;
    }
    try {
      const rbe = device.createRenderBundleEncoder({
        label: 'SpiroStar Corridor profile marker Layer Scene bundle',
        colorFormats: [format],
      });
      rbe.setPipeline(corridorPipeline);
      rbe.setBindGroup(0, rec.corridorBind);
      rbe.setBindGroup(1, bg);
      rbe.setVertexBuffer(0, cornerBuffer);
      rbe.draw(6, count * k);
      const bundle = rbe.finish();
      hit = { count, k, bg, bundle, list: [bundle] };
      byCopy.set(copyBuffer, hit);
      profileSceneBundleBuilds++;
      return hit;
    } catch (_) {
      profileSceneBundleFallbacks++;
      return null;
    }
  }
  function composite(ctx, opts = {}) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = opts.composite || 'source-over';
    ctx.filter = 'none';
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
  }
  function render(table, layer, alpha, ctx, prepared, opts = {}) {
    if (!warmup() || !ready || lost) {
      if (attempted && !initializing && !ready)
        profileMarkerFail('ready', lastError || 'WebGPU marker renderer unavailable');
      return false;
    }
    if (!table?.total) {
      profileMarkerFail('cpu-prepare', 'marker path table is empty');
      return false;
    }
    if (!ensureSize()) {
      profileMarkerFail('presentation-canvas', 'hidden WebGPU marker canvas could not be configured');
      return false;
    }
    const type = prepared?.type || layer?.lineProfile;
    if (!['slash', 'square', 'circle', 'cross'].includes(type)) {
      profileMarkerFail('eligibility', `unsupported marker type: ${type}`);
      return false;
    }
    const count = Math.max(0, Math.round(Number(prepared?.count) || 0));
    if (!count) return true;
    try {
      profileMarkerDiagnostic.stage = 'cpu-prepare + gpu-position-upload';
      const positionBuffer = preparePositionBuffer(table, count);
      profileMarkerDiagnostic.stage = 'gpu-uniform-upload';
      const ur = prepareUniforms(table, layer, alpha, ctx, prepared, count, opts);
      if (ur.alpha <= 0.0001) return true;
      const encoder = device.createCommandEncoder({ label: 'SpiroStar profile marker encoder' }),
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
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, ur.normalBind);
      pass.setVertexBuffer(0, cornerBuffer);
      pass.setVertexBuffer(1, positionBuffer);
      pass.draw(6, count);
      pass.end();
      device.queue.submit([encoder.finish()]);
      submissions++;
      frames++;
      composite(ctx, opts);
      profileMarkerOk('draw/composite', 'webgpu', 'Canvas2D composite bridge');
      return true;
    } catch (err) {
      profileMarkerFail(profileMarkerDiagnostic.stage || 'draw/composite', err?.message || err, err);
      return false;
    }
  }
  function renderCorridor(
    table,
    layer,
    alpha,
    ctx,
    prepared,
    copies,
    alphas,
    frameCtx,
    footprint = 1,
    opts = {},
  ) {
    if (!warmup() || !ready || lost) {
      if (attempted && !initializing && !ready)
        profileMarkerFail('corridor ready', lastError || 'WebGPU marker renderer unavailable');
      return false;
    }
    if (!table?.total) {
      profileMarkerFail('corridor cpu-prepare', 'marker path table is empty');
      return false;
    }
    if (!ensureSize()) {
      profileMarkerFail(
        'corridor presentation-canvas',
        'hidden WebGPU marker canvas could not be configured',
      );
      return false;
    }
    if (!Array.isArray(copies) || !copies.length) return false;
    const type = prepared?.type || layer?.lineProfile;
    if (!['slash', 'square', 'circle', 'cross'].includes(type)) {
      profileMarkerFail('corridor eligibility', `unsupported marker type: ${type}`);
      return false;
    }
    const count = Math.max(0, Math.round(Number(prepared?.count) || 0));
    if (!count) return true;
    try {
      profileMarkerDiagnostic.stage = 'corridor cpu-prepare + gpu-position-upload';
      const positionBuffer = preparePositionBuffer(table, count);
      profileMarkerDiagnostic.stage = 'corridor gpu-uniform-upload';
      const ur = prepareUniforms(table, layer, alpha, ctx, prepared, count, opts);
      if (ur.alpha <= 0.0001) return true;
      const copy = profileCopyRecord(copies, alphas, frameCtx, footprint, layer),
        k = copy.k;
      if (!k) return true;
      const copyBuffer = copy.buffer;
      let sb;
      if (copy.shared) {
        sb = { copyBuffer, bg: profileSharedBind(positionBuffer, copyBuffer) };
      } else {
        let arr = corridorBindCache.get(positionBuffer);
        if (!arr) {
          arr = [];
          corridorBindCache.set(positionBuffer, arr);
        }
        sb = arr[copy.slot];
        if (!sb || sb.copyBuffer !== copyBuffer) {
          sb = {
            copyBuffer,
            bg: device.createBindGroup({
              layout: corridorPipeline.getBindGroupLayout(1),
              entries: [
                { binding: 0, resource: { buffer: positionBuffer } },
                { binding: 1, resource: { buffer: copyBuffer } },
              ],
            }),
          };
          arr[copy.slot] = sb;
          corridorBindGroups++;
        }
      }
      const encoder = device.createCommandEncoder({ label: 'SpiroStar Corridor profile marker encoder' }),
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
      pass.setPipeline(corridorPipeline);
      pass.setBindGroup(0, ur.corridorBind);
      pass.setBindGroup(1, sb.bg);
      pass.setVertexBuffer(0, cornerBuffer);
      pass.draw(6, count * k);
      pass.end();
      device.queue.submit([encoder.finish()]);
      submissions++;
      frames++;
      corridorDraws++;
      corridorLogicalInstances += count * k;
      composite(ctx, opts);
      profileMarkerOk('corridor draw/composite', 'webgpu', 'Canvas2D composite bridge');
      return true;
    } catch (err) {
      profileMarkerFail(profileMarkerDiagnostic.stage || 'corridor draw/composite', err?.message || err, err);
      return false;
    }
  }

  function encodeToLayerScene(targetTexture, table, layer, alpha, ctx, prepared, opts = {}) {
    if (!targetTexture || !warmup() || !ready || lost || !table?.total || !ensureLogicalSize()) return null;
    const type = prepared?.type || layer?.lineProfile;
    if (!['slash', 'square', 'circle', 'cross'].includes(type)) return null;
    const count = Math.max(0, Math.round(Number(prepared?.count) || 0));
    if (!count) return { handled: true, commandBuffer: null };
    try {
      profileMarkerDiagnostic.stage = 'layer-scene cpu-prepare + gpu-position-upload';
      const positionBuffer = preparePositionBuffer(table, count);
      profileMarkerDiagnostic.stage = 'layer-scene gpu-uniform-upload';
      const ur = prepareUniforms(table, layer, alpha, ctx, prepared, count, opts);
      if (ur.alpha <= 0.0001) return { handled: true, commandBuffer: null };
      const encoder = device.createCommandEncoder({ label: 'SpiroStar profile marker → Layer Scene' }),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: profileLayerSceneView(targetTexture), loadOp: 'load', storeOp: 'store' },
          ],
        }),
        rb = normalSceneBundle(ur.record, positionBuffer, count);
      if (rb) {
        pass.executeBundles(rb.list);
        profileSceneBundleExecutes++;
      } else {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, ur.normalBind);
        pass.setVertexBuffer(0, cornerBuffer);
        pass.setVertexBuffer(1, positionBuffer);
        pass.draw(6, count);
      }
      pass.end();
      sceneDirectFrames++;
      frames++;
      profileMarkerOk('layer-scene encode/draw', 'webgpu-layer-scene', 'deferred GPU texture');
      return { handled: true, commandBuffer: encoder.finish() };
    } catch (err) {
      profileMarkerFail(profileMarkerDiagnostic.stage || 'layer-scene encode/draw', err?.message || err, err);
      return null;
    }
  }
  function encodeCorridorToLayerScene(
    targetTexture,
    table,
    layer,
    alpha,
    ctx,
    prepared,
    copies,
    alphas,
    frameCtx,
    footprint = 1,
    opts = {},
  ) {
    if (
      !targetTexture ||
      !warmup() ||
      !ready ||
      lost ||
      !table?.total ||
      !ensureLogicalSize() ||
      !Array.isArray(copies) ||
      !copies.length
    )
      return null;
    const type = prepared?.type || layer?.lineProfile;
    if (!['slash', 'square', 'circle', 'cross'].includes(type)) return null;
    const count = Math.max(0, Math.round(Number(prepared?.count) || 0));
    if (!count) return { handled: true, commandBuffer: null };
    try {
      profileMarkerDiagnostic.stage = 'corridor layer-scene cpu-prepare + gpu-position-upload';
      const positionBuffer = preparePositionBuffer(table, count);
      profileMarkerDiagnostic.stage = 'corridor layer-scene gpu-uniform-upload';
      const ur = prepareUniforms(table, layer, alpha, ctx, prepared, count, opts);
      if (ur.alpha <= 0.0001) return { handled: true, commandBuffer: null };
      const copy = profileCopyRecord(copies, alphas, frameCtx, footprint, layer),
        k = copy.k;
      if (!k) return { handled: true, commandBuffer: null };
      const copyBuffer = copy.buffer;
      let sb;
      if (copy.shared) {
        sb = { copyBuffer, bg: profileSharedBind(positionBuffer, copyBuffer) };
      } else {
        let arr = corridorBindCache.get(positionBuffer);
        if (!arr) {
          arr = [];
          corridorBindCache.set(positionBuffer, arr);
        }
        sb = arr[copy.slot];
        if (!sb || sb.copyBuffer !== copyBuffer) {
          sb = {
            copyBuffer,
            bg: device.createBindGroup({
              layout: corridorPipeline.getBindGroupLayout(1),
              entries: [
                { binding: 0, resource: { buffer: positionBuffer } },
                { binding: 1, resource: { buffer: copyBuffer } },
              ],
            }),
          };
          arr[copy.slot] = sb;
          corridorBindGroups++;
        }
      }
      const encoder = device.createCommandEncoder({
          label: 'SpiroStar Corridor profile marker → Layer Scene',
        }),
        pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: profileLayerSceneView(targetTexture), loadOp: 'load', storeOp: 'store' },
          ],
        }),
        rb = corridorSceneBundle(ur.record, positionBuffer, copyBuffer, sb.bg, count, k);
      if (rb) {
        pass.executeBundles(rb.list);
        profileSceneBundleExecutes++;
      } else {
        pass.setPipeline(corridorPipeline);
        pass.setBindGroup(0, ur.corridorBind);
        pass.setBindGroup(1, sb.bg);
        pass.setVertexBuffer(0, cornerBuffer);
        pass.draw(6, count * k);
      }
      pass.end();
      corridorDraws++;
      corridorLogicalInstances += count * k;
      sceneDirectCorridorFrames++;
      frames++;
      profileMarkerOk('corridor layer-scene encode/draw', 'webgpu-layer-scene', 'deferred GPU texture');
      return { handled: true, commandBuffer: encoder.finish() };
    } catch (err) {
      profileMarkerFail(
        profileMarkerDiagnostic.stage || 'corridor layer-scene encode/draw',
        err?.message || err,
        err,
      );
      return null;
    }
  }
  function status() {
    warmup();
    return {
      supported: !!navigator?.gpu,
      available: ready && !lost && WebGPUDeviceHub.isReady(),
      attempted,
      initializing,
      lost,
      lastError,
      diagnostic: { ...profileMarkerDiagnostic },
      geometryPreparation: profileMarkerDiagnostic.geometryPreparation,
      width,
      height,
      submissions,
      frames,
      sceneDirectFrames,
      sceneDirectCorridorFrames,
      staticBuilds,
      staticHits,
      staticUploads,
      dynamicUploads,
      ringBuffers: ring.length,
      uniformResidency: {
        records: profileUniformRecordSet.size,
        builds: profileUniformBuilds,
        uploads: profileUniformUploads,
        uploadSkips: profileUniformUploadSkips,
        policy: 'per-layer persistent profile uniform buffer; exact upload dedup',
      },
      layerSceneResidency: {
        textureViewBuilds: profileLayerSceneViewBuilds,
        textureViewHits: profileLayerSceneViewHits,
        renderBundles: {
          supported: typeof device?.createRenderBundleEncoder === 'function',
          builds: profileSceneBundleBuilds,
          hits: profileSceneBundleHits,
          executes: profileSceneBundleExecutes,
          fallbacks: profileSceneBundleFallbacks,
        },
        policy:
          'persistent target TextureViews + per-layer/profile-buffer GPURenderBundle cache; mutable buffers remain resident',
      },
      corridor: {
        copyUploadBytes: corridorUploads,
        sharedCopyReuse,
        draws: corridorDraws,
        logicalInstances: corridorLogicalInstances,
        bindGroups: corridorBindGroups,
        copyRingBuffers: copyRing.length,
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
    render,
    renderCorridor,
    encodeToLayerScene,
    encodeCorridorToLayerScene,
    status,
  };
})();

export { WebGPUProfileMarkerRenderer };
