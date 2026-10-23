# Somata 9.0.8 — GPU stall protection (experimental)

Based on Somata 9.0.7, without changes to effects' visual geometry, playlists or current lightning routing.

## Changes

1. WebGPUBufferRecycler: one outstanding `queue.onSubmittedWorkDone()` fence; process retired resources in batches and arm a subsequent batch only after completion. No premature destruction/reuse of a submitted GPU buffer.
2. Frame backpressure: when GPU pending fence and retired pool grows to 96 MiB or 192 buffers, pause new `renderMainCanvas` GPU frames until GPU catches up. The old image can remain frozen while this protective guard is active. Scheduler/Morph state can advance, so a frame skip is intentional.
3. Recovery: on fence completion the queued resources are promoted/pruned and a fresh render is requested. Guard skips reduce further growth in this recycler; they are not a hard global VRAM cap because other GPU services also own textures and buffers.
4. Governor: avoid pressure-driven VRAM cache growth when GPU timings indicate a GPU bottleneck.
5. General GPU queue watchdog: independent fence probe every 2 seconds; stop preparing frames when the driver takes over 10 seconds to retire GPU submissions, even if recycler backlog is small.
6. Device loss: time-limited cooldown and a circuit breaker after five consecutive losses. A reload is needed after repeated unrecoverable device losses.
7. Added deterministic, fault-injected regression testing the specific GPU queue-stall failure.

## Limits

- This build reduces the risk of feedback loops under GPU saturation; it cannot guarantee a driver/system will never hang.
- The recycler guard does not bound independently allocated WebGPU textures, cross-renderer buffers, system RAM or all GPU work.
- Must be soak-tested on the target NVIDIA hardware. Test 2–4 h with Spiral + Corridor + Morph + Lightning and record actual VRAM/FPS/GPU errors, and review Windows Reliability Monitor.

## Tests

Run `node tests/run-all.js` and `node tests/v908-gpu-stall-backpressure-regression.js`. No test outcome should be assumed without a completed run.
