// WebGPU: хранилище преобразований копий Коридора.
import './gpu-utils.js'; // initialisation order: this module runs after it
import { performanceGovernor } from '../core/scheduler.js';
import { getMotionTunnelLagRadians } from '../effects/motion.js';
import { shouldDrawTunnelEffectIndex } from '../geometry/frame-paths.js';
import { SomataCorridorCopyFrame } from '../render/corridor-copy-frame.js';
import { WebGPUBufferRecycler } from './buffer-recycler.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUCorridorCopyStore = (() => {
  let device = null,
    generation = 0,
    byLayer = new WeakMap(),
    records = new Set(),
    transformCpuByLayer = new WeakMap();
  let acquires = 0,
    hits = 0,
    builds = 0,
    uploads = 0,
    uploadBytes = 0,
    grows = 0,
    conflicts = 0,
    resets = 0,
    evictions = 0,
    rawAcquires = 0,
    rawHits = 0,
    rawBuilds = 0,
    rawUploads = 0,
    rawUploadBytes = 0,
    transformCpuBuilds = 0,
    transformCpuHits = 0;
  function reset(nextDevice = null, nextGeneration = 0) {
    for (const rec of records) {
      try {
        rec.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/corridor-copy-store#reset', error);
      }
    }
    records.clear();
    byLayer = new WeakMap();
    transformCpuByLayer = new WeakMap();
    device = nextDevice;
    generation = Number(nextGeneration) || 0;
    resets++;
  }
  function keyFor(kind, footprint) {
    return `${String(kind || 'effect')}|${Math.round(Math.max(0, Number(footprint) || 0) * 10000)}`;
  }
  function prepareTransformCpu(frameCtx, copies, alphas, owner) {
    const frameId = Number(frameCtx?.frameId ?? -1);
    let rec = transformCpuByLayer.get(owner);
    if (rec && rec.frameId === frameId && rec.copies === copies && rec.alphas === alphas) {
      transformCpuHits++;
      return rec;
    }
    const need = copies.length;
    if (!rec) rec = { frameId: -1, copies: null, alphas: null, capacity: 0, data: null };
    if (need > rec.capacity || !rec.data) {
      rec.capacity = performanceGovernor.capacityFor(need, rec.capacity, 64, 1.6);
      rec.data = new Float32Array(rec.capacity * 6);
    }
    // Style ownership does not change the focus or beta of the
    // coordinated geometry. Every pass uses the same frame angle.
    const phaseOwner = frameCtx?.layer?.__somataCoordinatedSpine === true ? frameCtx.layer : owner;
    const angles =
      frameCtx?.layer === phaseOwner && typeof SomataCorridorCopyFrame !== 'undefined'
        ? SomataCorridorCopyFrame
        : null;
    const angleBatch = angles?.peek(frameCtx) || null;
    for (let i = 0; i < need; i++) {
      const copy = copies[i],
        raw = Number(copy?.scale) || 0,
        scAbs = Math.max(0.000001, Math.abs(raw)),
        scLamp = Math.max(0.000001, raw),
        ca = Math.max(0, Math.min(1, Number(alphas?.[i] ?? 1))),
        ang =
          angleBatch && angleBatch.copies[i] === copy && angleBatch.angleVersion[i] === angleBatch.serial
            ? angleBatch.angles[i]
            : getMotionTunnelLagRadians(copy, phaseOwner),
        cs = Math.cos(ang),
        sn = Math.sin(ang),
        o = i * 6;
      rec.data[o] = scAbs;
      rec.data[o + 1] = scLamp;
      rec.data[o + 2] = cs;
      rec.data[o + 3] = sn;
      rec.data[o + 4] = ca;
      rec.data[o + 5] = 0;
    }
    rec.frameId = frameId;
    rec.copies = copies;
    rec.alphas = alphas;
    transformCpuByLayer.set(owner, rec);
    transformCpuBuilds++;
    return rec;
  }
  function acquire(deviceRef, generationRef, frameCtx, copies, alphas, kind, footprint = 1, layer = null) {
    acquires++;
    if (!deviceRef || !Array.isArray(copies) || !copies.length) return null;
    const gen = Number(generationRef) || 0;
    if (device !== deviceRef || generation !== gen) reset(deviceRef, gen);
    const owner = layer && typeof layer === 'object' ? layer : frameCtx?.layer;
    if (!owner || typeof owner !== 'object') return null;
    let variants = byLayer.get(owner);
    if (!variants) {
      variants = new Map();
      byLayer.set(owner, variants);
    }
    const key = keyFor(kind, footprint);
    let rec = variants.get(key);
    const frameId = Number(frameCtx?.frameId ?? -1),
      metrics = frameCtx?.instanceMetrics || null;
    if (rec && rec.frameId === frameId) {
      if (rec.copies === copies && rec.alphas === alphas && rec.metrics === metrics) {
        hits++;
        return rec;
      }
      conflicts++;
      return null;
    }
    if (!rec) {
      rec = {
        buffer: null,
        cpu: null,
        capacity: 0,
        k: 0,
        frameId: -1,
        copies: null,
        alphas: null,
        metrics: null,
        key,
      };
      variants.set(key, rec);
      records.add(rec);
    }
    if (copies.length > rec.capacity || !rec.cpu || !rec.buffer) {
      rec.capacity = performanceGovernor.capacityFor(copies.length, rec.capacity, 64, 1.6);
      rec.cpu = new Float32Array(rec.capacity * 8);
      const oldBuffer = rec.buffer;
      rec.buffer = WebGPUBufferRecycler.acquire(
        device,
        generation,
        Math.max(32, rec.capacity * 8 * 4),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        `SpiroStar shared Corridor copies ${key}`,
      );
      if (oldBuffer) WebGPUBufferRecycler.recycle(device, generation, oldBuffer);
      grows++;
    }
    const basis = prepareTransformCpu(frameCtx, copies, alphas, owner);
    let k = 0;
    for (let i = 0; i < copies.length; i++) {
      if (frameCtx && !shouldDrawTunnelEffectIndex(kind, i, frameCtx, footprint)) continue;
      const b = i * 6,
        ca = basis.data[b + 4];
      if (ca <= 0.0001) continue;
      const sc = basis.data[b],
        cs = basis.data[b + 2],
        sn = basis.data[b + 3],
        o = k * 8;
      rec.cpu[o] = sc * cs;
      rec.cpu[o + 1] = -sc * sn;
      rec.cpu[o + 2] = ca;
      rec.cpu[o + 3] = 0;
      rec.cpu[o + 4] = sc * sn;
      rec.cpu[o + 5] = sc * cs;
      rec.cpu[o + 6] = sc;
      rec.cpu[o + 7] = 0;
      k++;
    }
    rec.k = k;
    rec.frameId = frameId;
    rec.lastFrameId = frameId;
    rec.copies = copies;
    rec.alphas = alphas;
    rec.metrics = metrics;
    builds++;
    if (rec.k) {
      const bytes = rec.k * 8 * 4;
      device.queue.writeBuffer(rec.buffer, 0, rec.cpu.buffer, rec.cpu.byteOffset, bytes);
      uploads++;
      uploadBytes += bytes;
    }
    const limit = 48 * Math.max(1, performanceGovernor.residencyScale?.() || 1);
    if (records.size > limit) {
      let victim = null;
      for (const item of records) {
        if (item === rec) continue;
        if (!victim || Number(item.lastFrameId ?? -1) < Number(victim.lastFrameId ?? -1)) victim = item;
      }
      if (victim) {
        try {
          victim.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/corridor-copy-store#acquire', error);
        }
        victim.buffer = null;
        victim.cpu = null;
        victim.capacity = 0;
        records.delete(victim);
        evictions++;
      }
    }
    return rec;
  }

  function acquireRaw(deviceRef, generationRef, frameCtx, copies, alphas, kind = 'raw', layer = null) {
    rawAcquires++;
    if (!deviceRef || !Array.isArray(copies) || !copies.length) return null;
    const gen = Number(generationRef) || 0;
    if (device !== deviceRef || generation !== gen) reset(deviceRef, gen);
    const owner = layer && typeof layer === 'object' ? layer : frameCtx?.layer;
    if (!owner || typeof owner !== 'object') return null;
    let variants = byLayer.get(owner);
    if (!variants) {
      variants = new Map();
      byLayer.set(owner, variants);
    }
    const key = `raw|${String(kind || 'raw')}`;
    let rec = variants.get(key);
    const frameId = Number(frameCtx?.frameId ?? -1);
    if (rec && rec.frameId === frameId) {
      if (rec.copies === copies && rec.alphas === alphas) {
        rawHits++;
        return rec;
      }
      conflicts++;
      return null;
    }
    if (!rec) {
      rec = {
        buffer: null,
        cpu: null,
        capacity: 0,
        k: 0,
        frameId: -1,
        copies: null,
        alphas: null,
        metrics: null,
        key,
        raw: true,
      };
      variants.set(key, rec);
      records.add(rec);
    }
    if (copies.length > rec.capacity || !rec.cpu || !rec.buffer) {
      rec.capacity = performanceGovernor.capacityFor(copies.length, rec.capacity, 64, 1.6);
      rec.cpu = new Float32Array(rec.capacity * 8);
      const oldBuffer = rec.buffer;
      rec.buffer = WebGPUBufferRecycler.acquire(
        device,
        generation,
        Math.max(32, rec.capacity * 8 * 4),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        `SpiroStar shared Corridor raw copies ${key}`,
      );
      if (oldBuffer) WebGPUBufferRecycler.recycle(device, generation, oldBuffer);
      grows++;
    }
    const basis = prepareTransformCpu(frameCtx, copies, alphas, owner);
    let k = 0;
    for (let i = 0; i < copies.length; i++) {
      const b = i * 6,
        ca = basis.data[b + 4];
      if (ca <= 0.00001) continue;
      const sc = basis.data[b + 1],
        cs = basis.data[b + 2],
        sn = basis.data[b + 3],
        o = k * 8;
      rec.cpu[o] = sc * cs;
      rec.cpu[o + 1] = -sc * sn;
      rec.cpu[o + 2] = ca;
      rec.cpu[o + 3] = 0;
      rec.cpu[o + 4] = sc * sn;
      rec.cpu[o + 5] = sc * cs;
      rec.cpu[o + 6] = sc;
      rec.cpu[o + 7] = 0;
      k++;
    }
    rec.k = k;
    rec.frameId = frameId;
    rec.lastFrameId = frameId;
    rec.copies = copies;
    rec.alphas = alphas;
    rawBuilds++;
    if (k) {
      const bytes = k * 8 * 4;
      device.queue.writeBuffer(rec.buffer, 0, rec.cpu.buffer, rec.cpu.byteOffset, bytes);
      rawUploads++;
      rawUploadBytes += bytes;
    }
    const limit = 48 * Math.max(1, performanceGovernor.residencyScale?.() || 1);
    if (records.size > limit) {
      let victim = null;
      for (const item of records) {
        if (item === rec) continue;
        if (!victim || Number(item.lastFrameId ?? -1) < Number(victim.lastFrameId ?? -1)) victim = item;
      }
      if (victim) {
        try {
          victim.buffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/corridor-copy-store#acquireRaw', error);
        }
        victim.buffer = null;
        victim.cpu = null;
        victim.capacity = 0;
        records.delete(victim);
        evictions++;
      }
    }
    return rec;
  }
  function getTransformBasis(frameCtx, copies, alphas, layer = null) {
    if (!Array.isArray(copies) || !copies.length) return null;
    const owner = layer && typeof layer === 'object' ? layer : frameCtx?.layer;
    if (!owner || typeof owner !== 'object') return null;
    return prepareTransformCpu(frameCtx, copies, alphas, owner);
  }
  function status() {
    return {
      generation,
      residentRecords: records.size,
      residentLimit: 48 * Math.max(1, performanceGovernor.residencyScale?.() || 1),
      acquires,
      hits,
      builds,
      uploads,
      uploadBytes,
      grows,
      conflicts,
      resets,
      evictions,
      raw: {
        acquires: rawAcquires,
        hits: rawHits,
        builds: rawBuilds,
        uploads: rawUploads,
        uploadBytes: rawUploadBytes,
      },
      transformCpu: {
        builds: transformCpuBuilds,
        hits: transformCpuHits,
        layout: '6xf32-per-source-copy',
        publicApi: true,
      },
      layout: '8xf32',
      policy: 'one-upload-per-layer-frame-culling-key',
      rawPolicy: 'one-upload-per-layer-frame-raw-transform',
    };
  }
  return { acquire, acquireRaw, getTransformBasis, status, reset };
})();

export { WebGPUCorridorCopyStore };
