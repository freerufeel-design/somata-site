// WebGPU: общее устройство и восстановление после потери.
import './webgl-geometry-renderer.js'; // initialisation order: this module runs after it
import { requestMainCanvasRender } from '../core/scheduler.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUDeviceHub = (() => {
  let adapter = null,
    device = null,
    pending = null,
    attempted = false,
    ready = false,
    lost = false,
    lastError = '',
    generation = 0;

  let acquireCount = 0,
    lostCount = 0,
    uncapturedErrorCount = 0,
    lastUncapturedError = '',
    adapterInfo = null,
    timestampQuerySupported = false,
    timestampQueryEnabled = false;

  let resourceLifetimeFaults = 0,
    forcedRecoveries = 0,
    faultBurstStartedAt = 0,
    faultBurstCount = 0,
    forcedRecoveryGeneration = -1;
  // Avoid fast loss/reacquire loops when a GPU driver repeatedly resets.
  let consecutiveLosses = 0,
    recoveryAfter = 0,
    recoveryCircuitOpen = false,
    lastAcquiredAt = 0;
  // Queue progress probe also catches stalled GPU work that does not use the recycler.
  let queueProbe = null,
    queueProbeAt = 0,
    nextQueueProbeAt = 0,
    queueProbeFailures = 0,
    queueWatchdogTrips = 0,
    lastQueueWarningAt = -30000;
  const QUEUE_STALL_MS = 10000,
    QUEUE_PROBE_INTERVAL_MS = 2000;

  const spiralStorageBuffersNeeded = 9;
  let adapterStorageBuffersPerShaderStage = 0,
    requestedStorageBuffersPerShaderStage = 0;
  async function acquire() {
    if (ready && !lost && device) return { adapter, device, generation };
    if (pending) return pending;
    if (recoveryCircuitOpen)
      throw new Error('WebGPU recovery disabled after repeated device losses; reload to retry');
    if (performance.now() < recoveryAfter) throw new Error('WebGPU recovery cooling down');
    if (attempted && !ready && !lost) throw new Error(lastError || 'WebGPU device unavailable');
    attempted = true;
    lost = false;
    lastError = '';
    const task = (async () => {
      try {
        if (!globalThis.isSecureContext) throw new Error('WebGPU требует secure context');
        if (!navigator?.gpu) throw new Error('WebGPU не поддерживается');
        if (typeof GPUBufferUsage === 'undefined' || typeof GPUShaderStage === 'undefined')
          throw new Error('WebGPU constants unavailable');
        adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('WebGPU adapter недоступен');
        try {
          const info = adapter.info || (await adapter.requestAdapterInfo?.());
          if (info)
            adapterInfo = {
              vendor: String(info.vendor || ''),
              architecture: String(info.architecture || ''),
              device: String(info.device || ''),
              description: String(info.description || ''),
            };
        } catch (error) {
          noteSuppressedError('gpu/device-hub#acquire', error);
        }
        timestampQuerySupported = adapter.features?.has?.('timestamp-query') === true;
        timestampQueryEnabled = false;
        adapterStorageBuffersPerShaderStage = Math.max(
          0,
          Number(adapter.limits?.maxStorageBuffersPerShaderStage) || 0,
        );
        requestedStorageBuffersPerShaderStage =
          adapterStorageBuffersPerShaderStage >= spiralStorageBuffersNeeded ? spiralStorageBuffersNeeded : 0;
        const requiredLimits =
          requestedStorageBuffersPerShaderStage > 0
            ? { maxStorageBuffersPerShaderStage: requestedStorageBuffersPerShaderStage }
            : undefined;
        const baseDeviceDescriptor = requiredLimits ? { requiredLimits } : {};
        if (timestampQuerySupported) {
          try {
            device = await adapter.requestDevice({
              ...baseDeviceDescriptor,
              requiredFeatures: ['timestamp-query'],
            });
            timestampQueryEnabled = device.features?.has?.('timestamp-query') === true;
          } catch (_) {
            device = await adapter.requestDevice(baseDeviceDescriptor);
            timestampQueryEnabled = false;
          }
        } else device = await adapter.requestDevice(baseDeviceDescriptor);
        acquireCount++;
        generation++;
        ready = true;
        lost = false;
        faultBurstStartedAt = 0;
        faultBurstCount = 0;
        lastAcquiredAt = performance.now();
        queueProbe = null;
        queueProbeAt = 0;
        nextQueueProbeAt = 0;

        try {
          requestMainCanvasRender();
        } catch (error) {
          noteSuppressedError('gpu/device-hub#acquire', error);
        }
        const ownGeneration = generation;
        const onUncaptured = (ev) => {
          if (generation !== ownGeneration) return;
          uncapturedErrorCount++;
          lastUncapturedError = String(
            ev?.error?.message || ev?.message || ev?.error || 'WebGPU uncaptured error',
          );
          lastError = lastUncapturedError;
          try {
            ev?.preventDefault?.();
          } catch (error) {
            noteSuppressedError('gpu/device-hub#onUncaptured', error);
          }
          try {
            console.error('[Somata WebGPU uncaptured]', lastUncapturedError, ev?.error || '');
          } catch (error) {
            noteSuppressedError('gpu/device-hub#onUncaptured', error);
          }
          if (
            /used in submit while destroyed|associated with \[Device\].*cannot be used with \[Device\]/i.test(
              lastUncapturedError,
            )
          ) {
            resourceLifetimeFaults++;
            const now = performance.now();
            if (!faultBurstStartedAt || now - faultBurstStartedAt > 1000) {
              faultBurstStartedAt = now;
              faultBurstCount = 0;
            }
            faultBurstCount++;

            if (faultBurstCount >= 3 && forcedRecoveryGeneration !== ownGeneration) {
              forcedRecoveryGeneration = ownGeneration;
              forcedRecoveries++;
              const badDevice = device;
              setTimeout(() => {
                if (generation !== ownGeneration || device !== badDevice) return;
                try {
                  badDevice?.destroy?.();
                } catch (error) {
                  noteSuppressedError('gpu/device-hub#onUncaptured', error);
                }
              }, 0);
            }
          }
        };
        try {
          if (device.addEventListener) device.addEventListener('uncapturederror', onUncaptured);
          else device.onuncapturederror = onUncaptured;
        } catch (error) {
          noteSuppressedError('gpu/device-hub#acquire', error);
        }
        device.lost.then((info) => {
          if (generation !== ownGeneration) return;
          ready = false;
          lost = true;
          attempted = false;
          pending = null;
          generation++;
          lostCount++;
          queueProbe = null;
          queueProbeAt = 0;
          nextQueueProbeAt = 0;
          if (performance.now() - lastAcquiredAt > 120000) consecutiveLosses = 0;
          consecutiveLosses++;
          recoveryAfter =
            performance.now() + Math.min(60000, 5000 * Math.pow(2, Math.min(4, consecutiveLosses - 1)));
          if (consecutiveLosses >= 5) recoveryCircuitOpen = true;
          lastError = `device lost${info?.message ? `: ${info.message}` : ''}`;
          try {
            console.error('[Somata WebGPU device lost]', {
              reason: info?.reason || 'unknown',
              message: info?.message || '',
              generation: ownGeneration,
            });
          } catch (error) {
            noteSuppressedError('gpu/device-hub#acquire', error);
          }
          requestMainCanvasRender();
        });
        return { adapter, device, generation };
      } catch (err) {
        ready = false;
        lastError = String(err?.message || err);
        throw err;
      }
    })();
    pending = task;
    task
      .finally(() => {
        if (pending === task) pending = null;
      })
      .catch(() => {});
    return task;
  }
  function shouldThrottle() {
    if (!ready || lost || !device) return false;
    const t = performance.now();
    if (!queueProbe && t >= nextQueueProbeAt) {
      const marker = { generation },
        owner = device;
      let done = null;
      try {
        done = owner.queue?.onSubmittedWorkDone?.();
      } catch (_) {
        queueProbeFailures++;
      }
      nextQueueProbeAt = t + QUEUE_PROBE_INTERVAL_MS;
      if (done && typeof done.then === 'function') {
        queueProbe = marker;
        queueProbeAt = t;
        Promise.resolve(done).then(
          () => {
            if (queueProbe !== marker) return;
            const wasStalled = performance.now() - queueProbeAt >= QUEUE_STALL_MS;
            queueProbe = null;
            queueProbeAt = 0;
            if (wasStalled)
              try {
                requestMainCanvasRender();
              } catch (error) {
                noteSuppressedError('gpu/device-hub#shouldThrottle', error);
              }
          },
          () => {
            if (queueProbe !== marker) return;
            queueProbeFailures++;
            queueProbe = null;
            queueProbeAt = 0;
          },
        );
      }
    }
    const stalled = !!queueProbe && t - queueProbeAt >= QUEUE_STALL_MS;
    if (stalled && t - lastQueueWarningAt >= QUEUE_STALL_MS) {
      lastQueueWarningAt = t;
      queueWatchdogTrips++;
      try {
        console.warn(
          '[Somata GPU queue stalled] Pausing new GPU frames until the driver completes submitted work.',
          { pendingMs: Math.round(t - queueProbeAt), generation },
        );
      } catch (error) {
        noteSuppressedError('gpu/device-hub#shouldThrottle', error);
      }
    }
    return stalled;
  }
  function warmup() {
    if (
      !ready &&
      !pending &&
      (!attempted || lost) &&
      !recoveryCircuitOpen &&
      performance.now() >= recoveryAfter
    )
      void acquire().catch(() => {});
    return ready && !lost;
  }

  function retry() {
    if (ready && !lost) return true;
    if (pending) return false;
    attempted = false;
    lost = false;
    lastError = '';
    recoveryCircuitOpen = false;
    recoveryAfter = 0;
    consecutiveLosses = 0;
    void acquire().catch(() => {});
    return false;
  }
  function status() {
    warmup();
    return {
      supported: !!navigator?.gpu,
      secure: !!globalThis.isSecureContext,
      attempted,
      initializing: !!pending,
      available: ready && !lost,
      lost,
      lastError,
      generation,
      acquireCount,
      lostCount,
      consecutiveLosses,
      recoveryCooldownMs: Math.max(0, Math.round(recoveryAfter - performance.now())),
      recoveryCircuitOpen,
      queueProbePending: !!queueProbe,
      queueProbeMs: queueProbe ? Math.max(0, Math.round(performance.now() - queueProbeAt)) : 0,
      queueWatchdogTrips,
      queueProbeFailures,
      uncapturedErrorCount,
      lastUncapturedError,
      resourceLifetimeFaults,
      forcedRecoveries,
      adapterInfo,
      timestampQuerySupported,
      timestampQueryEnabled,
      spiralStorageBuffersNeeded,
      adapterStorageBuffersPerShaderStage,
      requestedStorageBuffersPerShaderStage,
      deviceStorageBuffersPerShaderStage: Number(device?.limits?.maxStorageBuffersPerShaderStage) || 0,
    };
  }
  return {
    acquire,
    warmup,
    retry,
    shouldThrottle,
    isReady: () => ready && !lost,
    getGeneration: () => generation,
    hasTimestampQuery: () => ready && !lost && timestampQueryEnabled,
    status,
  };
})();

export { WebGPUDeviceHub };
