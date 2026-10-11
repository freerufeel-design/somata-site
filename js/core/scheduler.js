// SpiroStar v500 Modular Base
// Single-rAF scheduler, performance governor, profiler and invalidation
window.__spiroRegisterModule?.('js/core/scheduler');
        // One browser rAF owns all continuous animation sources and the heavy canvas paint.
        // Individual subsystems register lightweight state-update tasks here instead of
        // starting independent requestAnimationFrame loops. Event-driven invalidations use
        // the same scheduler, so several updates in one display frame still produce one paint.
        const animationScheduler = (() => {
            const tasks = new Map();
            const afterPaint = new Map();
            let raf = 0;
            let renderPending = false;
            let inFrame = false;
            let frameCount = 0;
            let paintCount = 0;
            let paintErrors = 0;
            let lastPaintError = '';
            let lastTickAt = 0;
            let lastInvalidateAt = 0;
            let watchdogTimer = 0;
            let watchdogRecoveries = 0;
            let watchdogLastRecoveryAt = 0;
            let lastScheduledPaintAt = 0;
            let invalidateCount = 0;
            // v191: reuse the task-name snapshot instead of allocating Array.from(tasks.entries())
            // on every animation frame. Tasks may mutate the map while callbacks run.
            const taskSnapshot = [];
            const afterPaintSnapshot = [];

            // Somata 7.2.4 freeze diagnostics. A visible Morph hitch must leave a concise,
            // copyable record in the in-app console instead of only being inferred from FPS.
            // We measure the scheduler gap, every animation task, the main paint, GPU-prewarm
            // holds and (when Chromium exposes it) Long Tasks. Thresholds are intentionally
            // high enough to ignore normal 60/120 Hz jitter but low enough to catch a visible
            // multi-frame freeze.
            const MORPH_TASK_NAMES=new Set(['morph','minimalMorph','project-morph']);
            const MORPH_FREEZE_GAP_MS=100;
            const MORPH_FREEZE_WORK_MS=50;
            const MORPH_FREEZE_LONG_TASK_MS=100;
            const morphFreezeHistory=[];
            let morphFreezeCount=0;
            let lastMorphFreezeAt=-1e9;
            let lastMorphFreezeKey='';
            let lastVisibilityResumeAt=performance.now();
            let lastTaskTiming={name:'',ms:0,at:0};
            let lastPaintTiming={ms:0,at:0};
            let lastTickDurationMs=0;

            const hasMorphActivity=()=>{for(const name of MORPH_TASK_NAMES)if(tasks.has(name))return true;return false;};
            const roundFreezeMs=v=>Number((Math.max(0,Number(v)||0)).toFixed(1));
            const safeFreezeRead=fn=>{try{return typeof fn==='function'?fn():null;}catch(_){return null;}};
            const compactMorphFreezeContext=()=>safeFreezeRead(window.__somataMorphFreezeContext)||null;
            const compactFreezePasses=()=>{
                const perf=safeFreezeRead(window.__spiroPerfSnapshot),rows=Array.isArray(perf?.topPasses)?perf.topPasses.slice(0,3):[];
                return rows.map(row=>({name:String(row?.name||''),ms:roundFreezeMs(row?.ms)}));
            };
            const reportMorphFreeze=(code,detail={})=>{
                if(!hasMorphActivity()&&detail?.force!==true)return null;
                if(document.visibilityState==='hidden')return null;
                const at=performance.now();
                // Do not report the giant rAF gap produced by returning from another tab/window.
                if(at-lastVisibilityResumeAt<350&&code==='MORPH_RAF_GAP')return null;
                const durationMs=roundFreezeMs(detail?.durationMs);
                const governor=safeFreezeRead(window.__spiroPerformanceGovernorStatus)||{};
                const fullGpu=safeFreezeRead(window.__somataFullGpuDiagnostics)||{};
                const gpuRuntime=safeFreezeRead(window.__somataGpuRuntimeDiagnostics)||{};
                const recentFullGpu=Number(fullGpu?.lastAt)>0&&at-Number(fullGpu.lastAt)<1200?fullGpu.last:null;
                const recentGpuRuntime=Number(gpuRuntime?.lastAt)>0&&at-Number(gpuRuntime.lastAt)<1200?gpuRuntime.last:null;
                const task=String(detail?.task||'');
                const key=`${code}|${task}|${recentFullGpu?.code||''}|${recentGpuRuntime?.stage||''}`;
                // One incident may be observed by both our timers and PerformanceObserver.
                // Keep the most specific first record and suppress near-identical duplicates.
                if(at-lastMorphFreezeAt<250)return null;
                if(key===lastMorphFreezeKey&&at-lastMorphFreezeAt<1400)return null;

                let certainty='measured';
                let cause='';
                if(code==='MORPH_GPU_PREPARE_WAIT'){
                    cause=`WebGPU resources for ${detail?.morphKind||'Morph'} are still preparing; progress has been held for ${durationMs} ms.`;
                }else if(code==='MORPH_TASK_SLOW'){
                    cause=`CPU animation task ${task||'unknown'} occupied the main thread for ${durationMs} ms.`;
                }else if(code==='MORPH_RENDER_SLOW'){
                    cause=`renderMainCanvas occupied the main thread / driver submission path for ${durationMs} ms.`;
                    if(String(governor?.bottleneck||'')==='gpu'&&Number(governor?.emaGpuMs)>0)cause+=` GPU timing also reports ${roundFreezeMs(governor.emaGpuMs)} ms (GPU-bound).`;
                }else if(code==='MORPH_AFTER_PAINT_SLOW'){
                    cause=`After-paint Morph step ${task||'unknown'} took ${durationMs} ms (phase commit/preparation on the main thread).`;
                }else if(code==='MORPH_SCHEDULER_WATCHDOG'){
                    cause=`A requested Morph render did not receive a browser rAF for about ${durationMs} ms; the scheduler watchdog forced recovery.`;
                }else if(code==='MORPH_MAIN_THREAD_LONG_TASK'){
                    cause=`The browser reported a Long Task blocking the main thread for ${durationMs} ms during Morph.`;
                }else if(code==='MORPH_RAF_GAP'){
                    certainty='likely';
                    if(lastPaintTiming.ms>=MORPH_FREEZE_WORK_MS&&at-lastPaintTiming.at<1200){
                        cause=`The browser delivered the next Morph frame ${durationMs} ms late; the previous main render took ${roundFreezeMs(lastPaintTiming.ms)} ms.`;
                    }else if(lastTaskTiming.ms>=MORPH_FREEZE_WORK_MS&&at-lastTaskTiming.at<1200){
                        cause=`The browser delivered the next Morph frame ${durationMs} ms late; the previous task ${lastTaskTiming.name||'unknown'} took ${roundFreezeMs(lastTaskTiming.ms)} ms.`;
                    }else if(recentFullGpu?.code){
                        cause=`The Morph frame gap was ${durationMs} ms. A FullGPU frame was rejected at the same time (${recentFullGpu.code}); GPU presentation/warm-up is a likely contributor.`;
                    }else if(recentGpuRuntime?.stage){
                        cause=`The Morph frame gap was ${durationMs} ms. GPU path ${recentGpuRuntime.feature||'unknown'} was waiting/failing at ${recentGpuRuntime.stage}: ${recentGpuRuntime.reason||'no reason supplied'}.`;
                    }else if(String(governor?.bottleneck||'')==='gpu'&&Number(governor?.emaGpuMs)>0){
                        cause=`The Morph frame gap was ${durationMs} ms and GPU timing indicates a GPU/driver bottleneck (${roundFreezeMs(governor.emaGpuMs)} ms EMA).`;
                    }else{
                        certainty='unknown';
                        cause=`No rAF reached the Morph scheduler for ${durationMs} ms. No slow Somata task/render or recent GPU fault was measured; likely browser main-thread scheduling, GC, another script, driver synchronisation, or system load.`;
                    }
                }else{
                    certainty='unknown';
                    cause=String(detail?.cause||`Morph freeze detected (${code}).`);
                }

                const payload={
                    code:String(code||'MORPH_FREEZE'),durationMs,cause,certainty,
                    task:task||undefined,
                    morph:compactMorphFreezeContext(),
                    scheduler:{lastTickDurationMs:roundFreezeMs(lastTickDurationMs),lastTask:lastTaskTiming.name||null,lastTaskMs:roundFreezeMs(lastTaskTiming.ms),lastPaintMs:roundFreezeMs(lastPaintTiming.ms),watchdogRecoveries},
                    performance:{emaFps:Number(governor?.emaFps)||0,emaRenderMs:Number(governor?.emaRenderMs)||0,emaGpuMs:Number(governor?.emaGpuMs)||0,bottleneck:governor?.bottleneck||'unknown',topCpuPasses:compactFreezePasses()},
                    recentGpu:recentFullGpu?{type:'FullGPU',code:recentFullGpu.code,frameId:recentFullGpu.frameId}:recentGpuRuntime?{type:'GPU-path',feature:recentGpuRuntime.feature,stage:recentGpuRuntime.stage,reason:recentGpuRuntime.reason}:null
                };
                morphFreezeCount++;
                const rec={at:roundFreezeMs(at),...payload};morphFreezeHistory.push(rec);if(morphFreezeHistory.length>32)morphFreezeHistory.shift();
                lastMorphFreezeAt=at;lastMorphFreezeKey=key;
                // error-overlay.js mirrors this dedicated warning into the bottom in-app
                // console, while DevTools keeps the structured payload for deeper inspection.
                console.warn('[Somata Morph Freeze]',payload);
                try{window.__somataDiagNote?.('morph.freeze',`${payload.code}: ${payload.cause}`);}catch(_){ }
                return payload;
            };
            document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState!=='hidden')lastVisibilityResumeAt=performance.now();});

            const armRenderWatchdog = () => {
                if (watchdogTimer || !renderPending) return;
                const armedFrame = frameCount;
                watchdogTimer = setTimeout(() => {
                    watchdogTimer = 0;
                    if (!renderPending || inFrame) return;
                    // Background tabs intentionally throttle rAF. Do not turn the recovery guard
                    // into a hidden-tab animation loop; visibilitychange below restarts scheduling.
                    if (document.visibilityState === 'hidden') { raf = 0; return; }
                    // Iter23 — a UI invalidation must not depend forever on one stale/lost rAF.
                    // Under normal animation the rAF fires long before this guard. Only when no
                    // scheduler tick happened after the invalidation do we recover synchronously.
                    if (frameCount !== armedFrame) { schedule(); return; }
                    raf = 0;
                    watchdogRecoveries++;
                    watchdogLastRecoveryAt = performance.now();
                    if(hasMorphActivity())reportMorphFreeze('MORPH_SCHEDULER_WATCHDOG',{durationMs:Math.max(120,watchdogLastRecoveryAt-lastInvalidateAt),task:'scheduler-watchdog'});
                    try { tick(watchdogLastRecoveryAt); }
                    catch (err) { console.error('Somata scheduler watchdog recovery failed', err); }
                }, 120);
            };

            const schedule = () => {
                if (!raf) raf = requestAnimationFrame(tick);
                if (renderPending) armRenderWatchdog();
            };

            // v503: the scheduler must never get permanently stuck in `inFrame=true`.
            // In the monolith a rare uncaught error in a late render/finalize hook was mostly
            // masked by direct renderMainCanvas() calls from the profile editor. After the split,
            // most controls correctly use requestMainCanvasRender(); if one scheduled paint threw,
            // `inFrame` could remain true forever and all later invalidations would update state
            // without scheduling a new frame. Changing/resetting the spline still appeared to fix
            // everything because those controls use a direct synchronous paint.
            const tick = (now) => {
                const tickStartedAt=performance.now();
                const tickNow=Number(now)||tickStartedAt;
                const previousTickAt=lastTickAt;
                const tickGapMs=previousTickAt>0?Math.max(0,tickNow-previousTickAt):0;
                raf = 0;
                if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = 0; }
                lastTickAt = tickNow;
                if(tickGapMs>=MORPH_FREEZE_GAP_MS&&hasMorphActivity())reportMorphFreeze('MORPH_RAF_GAP',{durationMs:tickGapMs});
                inFrame = true;
                frameCount++;
                try {
                    // Snapshot iteration lets a task safely register/remove another task.
                    // Keep the backing array and refill it to avoid a short-lived entries array
                    // every display frame while morph/tunnel/audio tasks are active.
                    taskSnapshot.length = 0;
                    for (const name of tasks.keys()) taskSnapshot.push(name);
                    for (let ti = 0; ti < taskSnapshot.length; ti++) {
                        const name = taskSnapshot[ti];
                        const fn = tasks.get(name);
                        if (typeof fn !== 'function') continue;
                        let keep = true;
                        const taskStartedAt=performance.now();
                        try {
                            keep = fn(now) !== false;
                        } catch (err) {
                            keep = false;
                            console.error(`Animation task failed: ${name}`, err);
                        }
                        const taskMs=performance.now()-taskStartedAt;
                        lastTaskTiming={name,ms:taskMs,at:performance.now()};
                        if(taskMs>=MORPH_FREEZE_WORK_MS&&hasMorphActivity())reportMorphFreeze('MORPH_TASK_SLOW',{durationMs:taskMs,task:name});
                        if (!keep) tasks.delete(name);
                    }

                    const shouldPaint = renderPending;
                    renderPending = false;
                    if (shouldPaint) {
                        // v522.10 — module bootstrap is synchronous, but an rAF requested by an
                        // early module may fire before main-pipeline.js has declared renderMainCanvas.
                        // Keep the invalidation pending instead of treating bootstrap as a render
                        // failure; afterPaint callbacks must wait for an actual paint as well.
                        if (window.__spiroAppBootComplete !== true || typeof renderMainCanvas !== 'function') {
                            renderPending = true;
                        } else {
                            try {
                                const paintStartedAt=performance.now();
                                renderMainCanvas();
                                const paintMs=performance.now()-paintStartedAt;
                                lastPaintTiming={ms:paintMs,at:performance.now()};
                                if(paintMs>=MORPH_FREEZE_WORK_MS&&hasMorphActivity())reportMorphFreeze('MORPH_RENDER_SLOW',{durationMs:paintMs,task:'renderMainCanvas'});
                                paintCount++;
                                lastScheduledPaintAt = performance.now();
                            } catch (err) {
                                paintErrors++;
                                lastPaintError = String(err?.stack || err?.message || err || 'render error');
                                console.error('Scheduled main-canvas paint failed', err);
                            }
                        }
                        if (!renderPending && afterPaint.size) {
                            afterPaintSnapshot.length=0;
                            for(const entry of afterPaint.entries())afterPaintSnapshot.push(entry);
                            afterPaint.clear();
                            for(let ai=0;ai<afterPaintSnapshot.length;ai++){
                                const name=afterPaintSnapshot[ai][0],fn=afterPaintSnapshot[ai][1];
                                const afterStartedAt=performance.now();
                                try { fn(now); }
                                catch (err) { console.error(`After-paint task failed: ${name}`, err); }
                                const afterMs=performance.now()-afterStartedAt;
                                if(afterMs>=MORPH_FREEZE_WORK_MS&&hasMorphActivity())reportMorphFreeze('MORPH_AFTER_PAINT_SLOW',{durationMs:afterMs,task:name});
                            }
                        }
                    }
                } finally {
                    // This finally is the real v503 fix: future UI invalidations remain live even
                    // if a render backend/finalizer unexpectedly throws once.
                    lastTickDurationMs=performance.now()-tickStartedAt;
                    inFrame = false;
                    if (tasks.size || renderPending || afterPaint.size) schedule();
                }
            };

            return {
                add(name, fn) {
                    if (!name || typeof fn !== 'function') return;
                    tasks.set(name, fn);
                    if (!inFrame) schedule();
                },
                remove(name) {
                    tasks.delete(name);
                    afterPaint.delete(name);
                },
                afterNextPaint(name, fn) {
                    if (!name || typeof fn !== 'function') return;
                    afterPaint.set(name, fn);
                    renderPending = true;
                    // Schedule even from inside a frame. Normally the current tick will satisfy
                    // the request; the extra rAF is harmless and also acts as a recovery path if
                    // the current tick aborts in browser/backend code.
                    schedule();
                },
                invalidate() {
                    renderPending = true;
                    lastInvalidateAt = performance.now();
                    invalidateCount++;
                    // v503 self-healing invalidation: never rely on the `inFrame` flag to decide
                    // whether a future frame exists. schedule() already deduplicates by `raf`.
                    // Iter23 adds a dormant 120 ms watchdog only for a genuinely stalled rAF.
                    schedule();
                },
                consumeRenderRequest() { renderPending = false; },
                dropRenderRequest() { renderPending = false; },
                has(name) { return tasks.has(name); },
                isMorphActive() { return hasMorphActivity(); },
                reportMorphFreeze(code,detail={}) { return reportMorphFreeze(code,detail); },
                freezeStats() { return {count:morphFreezeCount,thresholds:{gapMs:MORPH_FREEZE_GAP_MS,workMs:MORPH_FREEZE_WORK_MS,longTaskMs:MORPH_FREEZE_LONG_TASK_MS},last:morphFreezeHistory.at(-1)||null,history:morphFreezeHistory.slice()}; },
                stats() { return { activeTasks: tasks.size, frameCount, paintCount, paintErrors, lastPaintError, inFrame, rafPending: Boolean(raf), renderPending, lastTickAt, lastInvalidateAt, lastScheduledPaintAt, invalidateCount, watchdogArmed:Boolean(watchdogTimer), watchdogRecoveries, watchdogLastRecoveryAt, lastTickDurationMs:roundFreezeMs(lastTickDurationMs), morphFreezeCount }; }
            };
        })();
        window.__somataMorphFreezeDiagnostics=()=>animationScheduler.freezeStats();
        window.__somataReportMorphFreeze=(code,detail={})=>animationScheduler.reportMorphFreeze(code,detail);
        // Chromium's Long Task observer catches blocking work outside Somata's own scheduler
        // (GC, another script, browser work). Scheduler/task timings remain authoritative when
        // they identify a more specific culprit; the reporter suppresses duplicate observations.
        try{
            if(typeof PerformanceObserver==='function'&&Array.isArray(PerformanceObserver.supportedEntryTypes)&&PerformanceObserver.supportedEntryTypes.includes('longtask')){
                const morphLongTaskObserver=new PerformanceObserver(list=>{
                    if(!animationScheduler.isMorphActive())return;
                    for(const entry of list.getEntries()){
                        const ms=Number(entry?.duration)||0;
                        if(ms>=100)animationScheduler.reportMorphFreeze('MORPH_MAIN_THREAD_LONG_TASK',{durationMs:ms,task:String(entry?.name||'browser-long-task')});
                    }
                });
                morphLongTaskObserver.observe({entryTypes:['longtask']});
                window.__somataMorphLongTaskObserver=morphLongTaskObserver;
            }
        }catch(_){ }

        // Somata 6.8 Iter23 — minimal, copy/paste-friendly console diagnostics. Keep a tiny
        // fixed ring so button/startup failures can be reported without enabling verbose logging.
        const somataDiagEvents = [];
        function somataDiagPush(type, detail='') {
            const rec={t:Number(performance.now().toFixed(1)),type:String(type||'event'),detail:String(detail||'')};
            somataDiagEvents.push(rec);if(somataDiagEvents.length>48)somataDiagEvents.shift();return rec;
        }
        window.addEventListener?.('error',e=>somataDiagPush('error',e?.error?.stack||e?.message||'window error'));
        window.addEventListener?.('unhandledrejection',e=>somataDiagPush('rejection',e?.reason?.stack||e?.reason?.message||e?.reason||'unhandled rejection'));
        window.__somataSchedulerDiag=()=>({scheduler:animationScheduler.stats(),events:somataDiagEvents.slice()});
        window.__somataDiagEvents=()=>somataDiagEvents.slice();
        window.__somataDiagNote=(type,detail)=>somataDiagPush(type,detail);
        window.__somataClearDiag=()=>{somataDiagEvents.length=0;return true;};
        document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState!=='hidden')animationScheduler.invalidate();});
        document.addEventListener?.('click',e=>{
            const el=e?.target?.closest?.('button,input,select,[role="button"]')||e?.target;
            if(!el)return;const key=el.id||el.getAttribute?.('data-action')||el.getAttribute?.('name')||el.className||el.tagName;
            somataDiagPush('click',String(key||'control').slice(0,160));
        },true);

        // v386 — quality-preserving performance governor with three GPU-residency pressure
        // tiers. Browsers still do not expose dedicated VRAM reliably, so no VRAM size is
        // guessed. Sustained <60 FPS keeps more buffers/bind groups resident; critical pressure
        // can widen cache/ring residency to 8x when reported system memory is ample/unknown.
        // Geometry quality, DPR, sampling and effect count are never reduced.
        const performanceGovernor = (() => {
            const targetFps=60,enterFps=57.5,deepFps=52,criticalFps=45,exitFps=59.25;
            const deviceMemoryGb=Math.max(0,Number(navigator.deviceMemory)||0);
            let lastFrameAt=0,emaFps=targetFps,emaRenderMs=0,emaGpuMs=0,gpuSamples=0,gpuSampleErrors=0,lowSince=0,deepSince=0,criticalSince=0,highSince=0,pressureLevel=0,activations=0,deactivations=0,deepActivations=0,criticalActivations=0;
            function setLevel(next){next=Math.max(0,Math.min(3,next|0));if(next===pressureLevel)return;if(next>pressureLevel){activations++;if(next===2)deepActivations++;if(next===3)criticalActivations++;}else deactivations++;pressureLevel=next;}
            function noteFrame(now,renderMs){
                const t=Number(now)||performance.now(),ms=Math.max(0,Number(renderMs)||0);
                if(ms>0)emaRenderMs=emaRenderMs?emaRenderMs*.90+ms*.10:ms;
                if(lastFrameAt>0){
                    const dt=t-lastFrameAt;
                    if(dt>0&&dt<250){
                        const fps=Math.min(240,1000/dt);emaFps=emaFps*.90+fps*.10;
                        if(emaFps<enterFps){
                            highSince=0;if(!lowSince)lowSince=t;
                            if(pressureLevel===0&&t-lowSince>1200&&(deviceMemoryGb===0||deviceMemoryGb>=6))setLevel(1);
                            if(emaFps<deepFps){if(!deepSince)deepSince=t;if(pressureLevel<2&&t-deepSince>2200&&(deviceMemoryGb===0||deviceMemoryGb>=8))setLevel(2);}else deepSince=0;
                            if(emaFps<criticalFps){if(!criticalSince)criticalSince=t;if(pressureLevel<3&&t-criticalSince>3500&&(deviceMemoryGb===0||deviceMemoryGb>=12))setLevel(3);}else criticalSince=0;
                        }else if(emaFps>exitFps){
                            lowSince=0;deepSince=0;criticalSince=0;if(!highSince)highSince=t;if(pressureLevel>0&&t-highSince>4000)setLevel(0);
                        }else{lowSince=0;deepSince=0;criticalSince=0;highSince=0;}
                    }else{lowSince=0;deepSince=0;criticalSince=0;highSince=0;}
                }
                lastFrameAt=t;
            }
            function noteGpuFrame(ms){
                ms=Number(ms);if(Number.isFinite(ms)&&ms>0&&ms<250){emaGpuMs=emaGpuMs?emaGpuMs*.85+ms*.15:ms;gpuSamples++;}else gpuSampleErrors++;
            }
            const cacheScale=()=>pressureLevel===3?8:(pressureLevel===2?4:(pressureLevel===1?2:1));
            const bottleneck=()=>{
                if(!(emaGpuMs>0))return 'unknown';const budget=1000/targetFps;
                if(emaGpuMs>=budget*.90)return 'gpu';
                if(emaRenderMs>0&&emaRenderMs>=emaGpuMs*1.35)return 'cpu-driver';
                return 'mixed';
            };
            // v396 — when real GPU timestamps show spare GPU time but the frame is still below
            // 60 FPS, the bottleneck is predominantly CPU/driver/upload-side. In that case spend
            // even more VRAM on rotating dynamic buffers (up to 12x at critical pressure) instead
            // of reusing the same allocation too aggressively. GPU-bound frames keep the proven
            // 2x/4x/8x residency policy so memory growth cannot masquerade as a shader-speed fix.
            const ringScale=()=>{const base=cacheScale();if(pressureLevel===0)return 1;return bottleneck()==='cpu-driver'?Math.min(12,Math.ceil(base*(pressureLevel===3?1.5:1.25))):base;};
            // v535 — frame-rate-independent dynamic ring residency.  Earlier builds let an FPS
            // pressure transition enlarge dozens of WebGPU rings in the middle of an otherwise
            // smooth Morph.  The extra residency was useful, but creating those buffers/bindings
            // on the first slow frame could itself become the visible hitch.  Choose a modest
            // in-flight ring class once from the browser's coarse device-memory hint and keep it
            // stable for the whole session.  FPS may still tune cache retention/capacity growth,
            // but it no longer changes the number of rotating GPU objects while animation runs.
            const residencyRingScale=()=>((deviceMemoryGb===0||deviceMemoryGb>=8)?2:1);
            const ringCount=(base=3)=>{const n=Math.max(1,Math.round(Math.max(1,Number(base)||1)));return n+(residencyRingScale()>1?1:0);};
            // Rings remain sticky across all effects.  This makes Blue/Green Morph, Web, Lightning,
            // lamps and particles immune to FPS-governor ring-topology changes.
            const stickyRingCount=(base=3,current=0)=>Math.max(Math.max(1,Math.floor(Number(current)||0)),ringCount(base));
            const growthFactor=()=>pressureLevel===3?3.0:(pressureLevel===2?2.4:(pressureLevel===1?2.0:1.6));
            const minDynamicCapacity=(base=256)=>{
                base=Math.max(1,Number(base)||1);if(pressureLevel===0)return base;
                if(base<=64)return pressureLevel===3?base*8:(pressureLevel===2?base*4:base*2);
                return pressureLevel===3?Math.max(base*4,2048):(pressureLevel===2?Math.max(base*2,1024):Math.max(Math.ceil(base*1.5),512));
            };
            const capacityFor=(needed,current,base=256,normalGrowth=1.6)=>Math.max(Math.max(0,Number(needed)||0),Math.ceil(Math.max(minDynamicCapacity(base),Math.max(0,Number(current)||0)*(pressureLevel>0?growthFactor():normalGrowth))));
            const preferGpuResidency=()=>pressureLevel>0;
            const level=()=>pressureLevel;
            const status=()=>({targetFps,emaFps:Number(emaFps.toFixed(2)),emaRenderMs:Number(emaRenderMs.toFixed(2)),emaGpuMs:Number(emaGpuMs.toFixed(3)),gpuSamples,gpuSampleErrors,bottleneck:bottleneck(),aggressive:pressureLevel>0,pressureLevel,cacheScale:cacheScale(),ringScale:ringScale(),residencyRingScale:residencyRingScale(),dynamicRingCount:ringCount(3),stickyDynamicRings:true,frameRateIndependentRings:true,growthFactor:growthFactor(),preferGpuResidency:preferGpuResidency(),deviceMemoryGb:deviceMemoryGb||null,activations,deactivations,deepActivations,criticalActivations,criticalFps,qualityReduction:false});
            return{noteFrame,noteGpuFrame,cacheScale,residencyScale:residencyRingScale,ringScale,ringCount,stickyRingCount,growthFactor,minDynamicCapacity,capacityFor,preferGpuResidency,level,status};
        })();
        window.__spiroPerformanceGovernorStatus=()=>performanceGovernor.status();
        window.__spiroAnimationStats = () => animationScheduler.stats();
        window.__spiroPerfSnapshot = () => {
            const passes=renderPassProfiler.snapshot();
            const frameCount=Math.max(1,Number(renderRuntime.frameId)||Number(frameGeometryRuntime.frameId)||1);
            const topPasses=Object.entries(passes.ema||{}).filter(([,v])=>Number.isFinite(Number(v))).sort((a,b)=>Number(b[1])-Number(a[1])).map(([name,ms])=>({name,ms:Number(Number(ms).toFixed(3))}));
            return {
                renderMs:Number(renderPerf?.lastRenderMs)||0,
                animation:animationScheduler.stats(),
                geometry:{...frameGeometryRuntime.stats},
                geometryRates:{
                    circleBuildsPerFrame:Number((frameGeometryRuntime.stats.circleBuilds/frameCount).toFixed(3)),
                    pathTableBuildsPerFrame:Number((frameGeometryRuntime.stats.pathTableBuilds/frameCount).toFixed(3)),
                    pathTableObjectReusesPerFrame:Number((frameGeometryRuntime.stats.pathTableObjectReuses/frameCount).toFixed(3))
                },
                tunnelCopies:Number(tunnelCopyScratch?.length)||0,
                dpr:Number(canvasViewport?.dpr)||1,
                layers:Number(state.layers?.length)||0,
                effectCull:{...effectCullStats},
                passes,
                topPasses,
                glowCache:{...staticGlowCacheStats},
                performanceGovernor:performanceGovernor.status(),
                renderRuntime:{frameId:renderRuntime.frameId,active:renderRuntime.active}
            };
        };
        window.__spiroPerfReport = () => {
            const s=window.__spiroPerfSnapshot();
            return {
                renderMs:Number(s.renderMs.toFixed(2)),
                layers:s.layers,tunnelCopies:s.tunnelCopies,dpr:s.dpr,
                topPasses:s.topPasses.slice(0,10),
                geometryRates:s.geometryRates,
                geometry:s.geometry,
                glowCache:s.glowCache,
                effectCull:s.effectCull
            };
        };


        // Somata 7.0.12 — effect benchmark console profiler. It intentionally measures the
        // existing FullGPU graph instead of adding another render path. CPU pass timings are
        // sampled every frame while a benchmark is active; whole-frame GPU timestamp-query is
        // temporarily sampled more often, and GPU subsystem counters are diffed start -> stop.
        const somataFxBenchmark = (()=>{
            const history=[];let active=null,last=null;
            const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
            const pct=(arr,p)=>{if(!arr.length)return 0;const s=arr.slice().sort((a,b)=>a-b),i=Math.min(s.length-1,Math.max(0,Math.ceil(p*s.length)-1));return s[i]||0;};
            const avg=(arr)=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
            const safe=(fn)=>{try{return typeof fn==='function'?fn():null;}catch(_){return null;}};
            const subsystemSnapshot=()=>({
                arc:safe(globalThis.__spiroGpuMorphArcStatus),
                web:safe(globalThis.__spiroGpuMorphWebStatus),
                webCorner:safe(globalThis.__spiroGpuWebCornerStatus),
                lightning:safe(globalThis.__spiroGpuLightningArcStatus),
                lamp:safe(globalThis.__spiroLampGPUStatus)||safe(globalThis.__spiroGpuLampStatus),
                final:safe(globalThis.__spiroFinalGPUStatus),
                governor:safe(globalThis.__spiroPerformanceGovernorStatus)
            });
            const flatten=(value,prefix='',out={})=>{if(value==null)return out;if(typeof value==='number'&&Number.isFinite(value)){out[prefix]=value;return out;}if(typeof value!=='object')return out;for(const [k,v] of Object.entries(value)){const key=prefix?`${prefix}.${k}`:k;if(typeof v==='number'&&Number.isFinite(v))out[key]=v;else if(v&&typeof v==='object'&&!Array.isArray(v))flatten(v,key,out);}return out;};
            const delta=(a,b)=>{const aa=flatten(a),bb=flatten(b),out={};for(const [k,v] of Object.entries(bb)){if(Number.isFinite(aa[k])){const d=v-aa[k];if(d!==0)out[k]=d;}}return out;};
            const compactDelta=(d,keys)=>{const out={};for(const key of keys){for(const [k,v] of Object.entries(d||{}))if(k===key||k.endsWith('.'+key))out[k]=v;}return out;};
            function setGpuInterval(v){try{return globalThis.WebGPUFinalCompositeRenderer?.setGpuTimingInterval?.(v);}catch(_){return null;}}
            function start(label='run',seconds=8){
                if(active)stop('restarted');seconds=clamp(Number(seconds)||8,2,60);const now=performance.now(),final=safe(globalThis.__spiroFinalGPUStatus),gpu=final?.frameGraph?.gpuTiming||{};
                active={label:String(label||'run'),seconds,startAt:now,lastFrameAt:0,frames:0,renderMs:[],frameMs:[],gpuMs:[],gpuSampleCount:Number(gpu.samples)||0,passSums:Object.create(null),passFrames:0,startSubsystems:subsystemSnapshot(),oldSampleEvery:renderPassProfiler.sampleEvery,oldGpuInterval:Number(gpu.interval)||24,autoStop:false};
                renderPassProfiler.sampleEvery=1;setGpuInterval(4);console.info(`[Somata FX Bench] START ${active.label} — ${seconds.toFixed(1)}s`);return status();
            }
            function noteFrame(now=performance.now(),renderMs=0){if(!active)return;const a=active;a.frames++;a.renderMs.push(Math.max(0,Number(renderMs)||0));if(a.lastFrameAt>0){const dt=now-a.lastFrameAt;if(dt>0&&dt<500)a.frameMs.push(dt);}a.lastFrameAt=now;
                const snap=renderPassProfiler.snapshot(),passes=snap.last||{};if(Object.keys(passes).length){for(const [k,v] of Object.entries(passes))if(Number.isFinite(Number(v)))a.passSums[k]=(a.passSums[k]||0)+Number(v);a.passFrames++;}
                const final=safe(globalThis.__spiroFinalGPUStatus),gt=final?.frameGraph?.gpuTiming||{};const count=Number(gt.samples)||0;if(count>a.gpuSampleCount&&Number(gt.lastMs)>0){a.gpuSampleCount=count;a.gpuMs.push(Number(gt.lastMs));}
                if(!a.autoStop&&now-a.startAt>=a.seconds*1000){a.autoStop=true;queueMicrotask(()=>{try{stop('timer');}catch(_){}});}
            }
            function stop(reason='manual'){
                if(!active)return last;const a=active;active=null;renderPassProfiler.sampleEvery=a.oldSampleEvery;setGpuInterval(a.oldGpuInterval);const endAt=performance.now(),elapsed=Math.max(1,endAt-a.startAt),endSubsystems=subsystemSnapshot(),deltas={};for(const key of ['arc','web','webCorner','lightning','lamp','final'])deltas[key]=delta(a.startSubsystems[key],endSubsystems[key]);
                const passAvg={};for(const [k,v] of Object.entries(a.passSums))passAvg[k]=v/Math.max(1,a.passFrames);const topPasses=Object.entries(passAvg).sort((x,y)=>y[1]-x[1]).slice(0,12).map(([name,ms])=>({name,ms:Number(ms.toFixed(3))}));
                const gpuAvg=avg(a.gpuMs),renderAvg=avg(a.renderMs),frameAvg=avg(a.frameMs),observedFps=1000/(frameAvg||elapsed/Math.max(1,a.frames));let bottleneck='unknown';if(gpuAvg>0){if(gpuAvg>=Math.max(12,renderAvg*.75))bottleneck='GPU';else if(renderAvg>=gpuAvg*1.5)bottleneck='CPU/driver/encoding';else bottleneck='mixed';}
                last={label:a.label,reason,seconds:Number((elapsed/1000).toFixed(2)),frames:a.frames,fps:Number(observedFps.toFixed(2)),frameMs:{avg:Number(frameAvg.toFixed(3)),p95:Number(pct(a.frameMs,.95).toFixed(3)),max:Number((a.frameMs.length?Math.max(...a.frameMs):0).toFixed(3))},renderMs:{avg:Number(renderAvg.toFixed(3)),p95:Number(pct(a.renderMs,.95).toFixed(3)),max:Number((a.renderMs.length?Math.max(...a.renderMs):0).toFixed(3))},gpuMs:{samples:a.gpuMs.length,avg:Number(gpuAvg.toFixed(3)),p95:Number(pct(a.gpuMs,.95).toFixed(3)),max:Number((a.gpuMs.length?Math.max(...a.gpuMs):0).toFixed(3))},bottleneck,topCpuPasses:topPasses,deltas,hotDeltas:{arc:compactDelta(deltas.arc,['framesEncoded','frameDataReuses','morphEncodes','segmentBuildDispatches','scanDispatches','scanOffsetDispatches','pathMetricDispatches','finalizeDispatches','committedReuseHits','committedSubmissions']),web:compactDelta(deltas.web,['frames','draws','indirectDraws','logicalThreadSlots','roundingThreadSlots','cornerComputes','arcComputes','corridorFrames','corridorCopies','bundleExecutes']),webCorner:compactDelta(deltas.webCorner,['areaDispatches','classifyDispatches','cornerScanDispatches','cornerScanOffsetDispatches','cornerScatterDispatches','cornerFinalizeDispatches','threadCompactDispatches','threadCompactIndirectDispatches','indirectFinalizeDispatches','resourceBuilds','resourceHits']),lightning:compactDelta(deltas.lightning,['frames','draws','strokeDraws','logicalSegments','arcEncodes','arcReuses','corridorFrames','corridorCopies','bundleExecutes']),final:compactDelta(deltas.final,['submissions','mergedCommandBuffers','materializations','preflightRejects'])},governor:endSubsystems.governor};history.push(last);if(history.length>16)history.shift();
                console.group(`[Somata FX Bench] ${last.label}`);console.table([{label:last.label,fps:last.fps,renderAvg:last.renderMs.avg,renderP95:last.renderMs.p95,gpuAvg:last.gpuMs.avg,gpuP95:last.gpuMs.p95,gpuSamples:last.gpuMs.samples,bottleneck:last.bottleneck}]);console.table(last.topCpuPasses);console.log('Hot GPU counter deltas',last.hotDeltas);console.log('Full report',last);console.groupEnd();return last;
            }
            function status(){return active?{active:true,label:active.label,elapsedSec:Number(((performance.now()-active.startAt)/1000).toFixed(2)),targetSec:active.seconds,frames:active.frames,gpuSamples:active.gpuMs.length}:{active:false,last};}
            function compare(){const rows=history.map(r=>({label:r.label,fps:r.fps,renderAvg:r.renderMs.avg,renderP95:r.renderMs.p95,gpuAvg:r.gpuMs.avg,gpuP95:r.gpuMs.p95,gpuSamples:r.gpuMs.samples,bottleneck:r.bottleneck,webThreads:Object.values(r.hotDeltas?.web||{}).reduce((a,b)=>a+(Number(b)||0),0),lightningSegments:Object.values(r.hotDeltas?.lightning||{}).reduce((a,b)=>a+(Number(b)||0),0)}));console.table(rows);return history.slice();}
            return{start,stop,noteFrame,status,compare,last:()=>last,history:()=>history.slice()};
        })();
        window.__somataFxBenchStart=(label='run',seconds=8)=>somataFxBenchmark.start(label,seconds);
        window.__somataFxBenchStop=()=>somataFxBenchmark.stop('manual');
        window.__somataFxBenchStatus=()=>somataFxBenchmark.status();
        window.__somataFxBenchLast=()=>somataFxBenchmark.last();
        window.__somataFxBenchCompare=()=>somataFxBenchmark.compare();

        window.__spiroGreenFadeSnapshot = () => ({
            transitionType:state.projectMorph?.transitionType||'smooth',
            active:runtimeState.projectMorph?.active===true,
            progress:Number(runtimeState.projectMorph?.progress)||0,
            fadeProgress:Number(runtimeState.projectMorph?.fadeProgress)||0,
            sourceIndex:Number(runtimeState.projectMorph?.sourceIndex),
            targetIndex:Number(runtimeState.projectMorph?.targetIndex),
            sourceGeometryLayers:Array.isArray(runtimeState.projectMorph?.sourceGeometry)?runtimeState.projectMorph.sourceGeometry.length:0,
            targetGeometryLayers:Array.isArray(runtimeState.projectMorph?.targetGeometry)?runtimeState.projectMorph.targetGeometry.length:0,
            frameGeometryLayers:Array.isArray(runtimeState.projectMorph?.frameGeometry)?runtimeState.projectMorph.frameGeometry.length:0,
            configSide:(Number(runtimeState.projectMorph?.fadeProgress)||0)<.5?'source':'target'
        });
        const renderPerf = {
            lastBgColor: null,
            lastGridVisible: null,
            lastInfoText: null,
            rendering: false,
            lastErrorAt: 0,
            lastRenderMs: 0,
            lastPaintAt: 0,
            fpsWindowStart: 0,
            fpsLastFrameAt: 0,
            fpsFrames: 0,
            lastFpsText: ''
        };


        // v210 — sampled pass profiler. One frame out of ten is timed so profiling
        // does not become a meaningful part of the frame budget itself.
        const renderPassProfiler = {
            sampleEvery:10, frameSerial:0, active:false, frameStart:0,
            current:Object.create(null), last:Object.create(null), ema:Object.create(null), samples:0,
            beginFrame(){this.frameSerial++;this.active=(this.frameSerial%Math.max(1,this.sampleEvery))===0;if(this.active){this.current=Object.create(null);this.frameStart=performance.now();}},
            begin(){return this.active?performance.now():0;},
            end(name,start){if(!this.active||!start)return;this.current[name]=(this.current[name]||0)+(performance.now()-start);},
            finish(){if(!this.active)return;this.current.total=performance.now()-this.frameStart;this.last={...this.current};this.samples++;for(const [k,v] of Object.entries(this.current)){const p=Number(this.ema[k]);this.ema[k]=Number.isFinite(p)?p*.82+v*.18:v;}},
            snapshot(){return {sampleEvery:this.sampleEvery,samples:this.samples,last:{...this.last},ema:{...this.ema}};}
        };
        window.__spiroPassProfiler=renderPassProfiler;

        // v210 — O(1) lookups for hot effect helpers. The lookup is rebuilt only when
        // the layer array/id order changes, not for every lamp/web query.
        const layerLookupRuntime={layersRef:null,ids:[],byId:new Map(),indexById:new Map(),indexByObject:new WeakMap()};
        function refreshLayerLookup(force=false){
            const layers=(typeof SpiroMorphController!=='undefined'&&typeof SpiroMorphController.getDisplayLayers==='function')
                ? SpiroMorphController.getDisplayLayers()
                : (Array.isArray(state.layers)?state.layers:[]);
            let changed=force||layerLookupRuntime.layersRef!==layers||layerLookupRuntime.ids.length!==layers.length;
            if(!changed){for(let i=0;i<layers.length;i++){if(layerLookupRuntime.ids[i]!==(layers[i]?.id||'')){changed=true;break;}}}
            if(!changed)return layerLookupRuntime;
            layerLookupRuntime.layersRef=layers;layerLookupRuntime.ids.length=layers.length;layerLookupRuntime.byId.clear();layerLookupRuntime.indexById.clear();layerLookupRuntime.indexByObject=new WeakMap();
            for(let i=0;i<layers.length;i++){const layer=layers[i],id=layer?.id||'';layerLookupRuntime.ids[i]=id;if(!layer)continue;if(id){layerLookupRuntime.byId.set(id,layer);layerLookupRuntime.indexById.set(id,i);}if(typeof layer==='object')layerLookupRuntime.indexByObject.set(layer,i);}
            return layerLookupRuntime;
        }
        function getRuntimeLayerIndex(layer){if(!layer)return-1;const rt=refreshLayerLookup();const direct=rt.indexByObject.get(layer);if(Number.isInteger(direct))return direct;if(layer.id&&rt.indexById.has(layer.id))return rt.indexById.get(layer.id);return-1;}
        function getRuntimeLayerById(id){return id?refreshLayerLookup().byId.get(id)||null:null;}

        applyFpsVisibility(showFpsCounter, false);
        applyVignetteVisibility(showVignette, false);
        showFpsSettingEl?.addEventListener('change', (e) => { e.stopPropagation(); applyFpsVisibility(e.target.checked === true, true); capturePlaylistOverridesFromCurrent(); });
        showVignetteSettingEl?.addEventListener('change', (e) => { e.stopPropagation(); applyVignetteVisibility(e.target.checked === true, true); });

        if (typeof ResizeObserver !== 'undefined' && mainContainerEl) {
            const mainResizeObserver = new ResizeObserver((entries) => {
                const rect = entries?.[0]?.contentRect;
                if (!rect) return;
                const w = Math.max(1, Math.round(rect.width));
                const h = Math.max(1, Math.round(rect.height));
                if (w === canvasViewport.w && h === canvasViewport.h) return;
                canvasViewport.w = w;
                canvasViewport.h = h;
                requestMainCanvasRender();
            });
            mainResizeObserver.observe(mainContainerEl);
        }

        mainCanvas.addEventListener?.('contextlost', (event) => {
            event.preventDefault?.();
            renderPerf.rendering = false;
            animationScheduler.dropRenderRequest();
            console.warn('Main canvas context lost; waiting for restore.');
        });
        mainCanvas.addEventListener?.('contextrestored', () => {
            renderPerf.rendering = false;
            renderPerf.lastBgColor = null;
            renderPerf.lastGridVisible = null;
            requestMainCanvasRender();
        });

        function requestMainCanvasRender() {
            // Event-driven paints and continuous animation share the same display-frame owner.
            animationScheduler.invalidate();
        }

