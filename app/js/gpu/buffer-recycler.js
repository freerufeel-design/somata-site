// WebGPU: переиспользование буферов.
import './device-hub.js'; // initialisation order: this module runs after it
import { renderRuntime } from '../core/render-runtime.js';
import { performanceGovernor, requestMainCanvasRender } from '../core/scheduler.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUBufferRecycler = (() => {
  let device = null,
    generation = 0,
    ready = [],
    retired = [];
  let readyBytes = 0,
    retiredBytes = 0,
    acquires = 0,
    hits = 0,
    misses = 0,
    recycles = 0,
    promotions = 0,
    destroys = 0,
    prunes = 0,
    resets = 0;
  let fenceRequests = 0,
    fencedBuffers = 0,
    largestFenceBatch = 0,
    fenceFailures = 0;
  let pendingFence = null,
    pendingSince = 0,
    stalledFrames = 0,
    stallWarnings = 0,
    lastWarningAt = -30000,
    throttleActive = false;
  const PRESSURE_BYTES = 96 * 1024 * 1024,
    PRESSURE_BUFFERS = 192,
    STALL_WARNING_MS = 10000;
  const nowMs = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const currentFrame = () => Math.max(0, Number(renderRuntime?.frameId) || 0);
  const align256 = (n) => Math.max(256, Math.ceil(Math.max(1, Number(n) || 1) / 256) * 256);
  function destroyRec(rec) {
    if (!rec || rec.dead) return;
    rec.dead = true;
    try {
      rec.buffer?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/buffer-recycler#destroyRec', error);
    }
    destroys++;
  }
  function clearArrays() {
    for (const rec of ready) destroyRec(rec);
    for (const rec of retired) destroyRec(rec);
    ready = [];
    retired = [];
    readyBytes = 0;
    retiredBytes = 0;
  }
  function reset(nextDevice = null, nextGeneration = 0) {
    clearArrays();
    device = nextDevice;
    generation = Number(nextGeneration) || 0;
    pendingFence = null;
    pendingSince = 0;
    throttleActive = false;
    resets++;
  }
  function sync(dev, gen) {
    const g = Number(gen) || 0;
    if (device !== dev || generation !== g) reset(dev, g);
    return !!device;
  }
  function limits() {
    const scale = Math.max(1, performanceGovernor.residencyScale?.() || 1);
    return { count: 32 * scale, bytes: 48 * 1024 * 1024 * scale };
  }
  function removeRetired(rec) {
    const i = retired.indexOf(rec);
    if (i >= 0) {
      retired.splice(i, 1);
      retiredBytes = Math.max(0, retiredBytes - rec.size);
    }
  }
  function prune() {
    const lim = limits();
    while (ready.length > lim.count || readyBytes > lim.bytes) {
      let idx = 0;
      for (let i = 1; i < ready.length; i++)
        if ((ready[i].lastUsedFrame || 0) < (ready[idx].lastUsedFrame || 0)) idx = i;
      const [rec] = ready.splice(idx, 1);
      readyBytes = Math.max(0, readyBytes - rec.size);
      destroyRec(rec);
      prunes++;
    }
  }

  function armRetired() {
    if (!device || pendingFence) return;
    const now = currentFrame(),
      eligible = [];
    for (const rec of retired) {
      if (!rec.dead && !rec.armed && now - rec.retireFrame >= 2) {
        rec.armed = true;
        eligible.push(rec);
      }
    }
    if (!eligible.length) return;
    const owner = device,
      ownerGeneration = generation;
    let done;
    try {
      done = owner.queue?.onSubmittedWorkDone?.();
    } catch (_) {
      done = null;
    }
    if (!done || typeof done.then !== 'function') {
      fenceFailures++;
      for (const rec of eligible) {
        removeRetired(rec);
        destroyRec(rec);
      }
      return;
    }
    fenceRequests++;
    fencedBuffers += eligible.length;
    largestFenceBatch = Math.max(largestFenceBatch, eligible.length);
    pendingSince = nowMs();
    const marker = { owner, ownerGeneration };
    pendingFence = marker;
    Promise.resolve(done)
      .then(
        () => {
          for (const rec of eligible) {
            if (rec.dead) continue;
            removeRetired(rec);
            if (device !== owner || generation !== ownerGeneration) {
              destroyRec(rec);
              continue;
            }
            rec.lastUsedFrame = currentFrame();
            ready.push(rec);
            readyBytes += rec.size;
            promotions++;
          }
          if (device === owner && generation === ownerGeneration) prune();
        },
        () => {
          fenceFailures++;
          for (const rec of eligible) {
            removeRetired(rec);
            destroyRec(rec);
          }
        },
      )
      .finally(() => {
        if (pendingFence !== marker) return;
        pendingFence = null;
        pendingSince = 0;
        throttleActive = false;
        armRetired();
        try {
          requestMainCanvasRender();
        } catch (error) {
          noteSuppressedError('gpu/buffer-recycler#armRetired', error);
        }
      });
  }
  function shouldThrottle() {
    armRetired();
    const over = retiredBytes >= PRESSURE_BYTES || retired.length >= PRESSURE_BUFFERS;

    throttleActive = !!(pendingFence && over);
    if (throttleActive) {
      stalledFrames++;
      const elapsed = nowMs() - pendingSince;
      if (elapsed >= STALL_WARNING_MS && nowMs() - lastWarningAt >= STALL_WARNING_MS) {
        lastWarningAt = nowMs();
        stallWarnings++;
        try {
          console.warn('[Somata GPU backpressure] Rendering paused; GPU completion fence is delayed.', {
            retiredBytes,
            retiredBuffers: retired.length,
            pendingMs: Math.round(elapsed),
          });
        } catch (error) {
          noteSuppressedError('gpu/buffer-recycler#shouldThrottle', error);
        }
      }
    }
    return throttleActive;
  }
  function acquire(dev, gen, size, usage, label = 'SpiroStar recycled GPU buffer') {
    acquires++;
    if (!sync(dev, gen)) return null;
    armRetired();
    const need = align256(size),
      use = Number(usage) || 0;
    let best = -1,
      bestSize = Infinity;
    for (let i = 0; i < ready.length; i++) {
      const rec = ready[i];
      if (rec.dead || rec.usage !== use || rec.size < need) continue;
      if (rec.size < bestSize) {
        best = i;
        bestSize = rec.size;
      }
    }
    if (best >= 0) {
      const [rec] = ready.splice(best, 1);
      readyBytes = Math.max(0, readyBytes - rec.size);
      rec.lastUsedFrame = currentFrame();
      hits++;
      return rec.buffer;
    }
    misses++;
    return device.createBuffer({ size: need, usage: use, label });
  }
  function recycle(dev, gen, buffer) {
    if (!buffer) return false;
    if (!sync(dev, gen)) {
      try {
        buffer.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/buffer-recycler#recycle', error);
      }
      return false;
    }
    const size = Math.max(0, Number(buffer.size) || 0),
      usage = Number(buffer.usage) || 0;
    if (!size || !usage) {
      try {
        buffer.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/buffer-recycler#recycle', error);
      }
      return false;
    }
    const rec = {
      buffer,
      size,
      usage,
      device,
      generation,
      retireFrame: currentFrame(),
      lastUsedFrame: currentFrame(),
      armed: false,
      dead: false,
    };
    retired.push(rec);
    retiredBytes += size;
    recycles++;
    armRetired();
    return true;
  }
  function status() {
    armRetired();
    const lim = limits();
    return {
      generation,
      readyBuffers: ready.length,
      retiredBuffers: retired.length,
      readyBytes,
      retiredBytes,
      limitBuffers: lim.count,
      limitBytes: lim.bytes,
      pressureBytes: PRESSURE_BYTES,
      pressureBuffers: PRESSURE_BUFFERS,
      throttleActive,
      pendingFence: !!pendingFence,
      pendingFenceMs: pendingFence ? Math.round(nowMs() - pendingSince) : 0,
      stalledFrames,
      stallWarnings,
      acquires,
      hits,
      misses,
      recycles,
      promotions,
      destroys,
      prunes,
      resets,
      fenceRequests,
      fencedBuffers,
      largestFenceBatch,
      fenceFailures,
      policy:
        'single in-flight GPU fence; bounded new frame submissions under retired-buffer pressure; never destroy pending buffers',
    };
  }
  return { acquire, recycle, reset, status, shouldThrottle };
})();
window.__somataGpuBufferRecycler = WebGPUBufferRecycler;

export { WebGPUBufferRecycler };
