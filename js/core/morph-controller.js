

window.__spiroRegisterModule?.('js/core/morph-controller');

const SpiroMorphController = (() => {
    const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
    const blueRuntime = () => runtimeState?.morph || {};
    const orangeRuntime = () => runtimeState?.minimalMorph || {};
    const greenRuntime = () => runtimeState?.projectMorph || {};
    const greenOwnsFrame = () => { const rt=greenRuntime(); return rt.active===true && rt.transitionActive===true; };

    function removeBlueScheduledWork() {
        if (typeof animationScheduler === 'undefined') return;
        animationScheduler.remove('morph');
        animationScheduler.remove('morph-arm');
        animationScheduler.remove('morph-cycle-boundary');
    }

    function bumpBluePhase(reason = 'phase') {
        const rt = blueRuntime();
        rt.phaseSerial = ((Math.max(0, Number(rt.phaseSerial) || 0) + 1) >>> 0);
        rt.phaseReason = String(reason || 'phase');
        return rt.phaseSerial;
    }

    function currentBluePhaseSerial() {
        return Math.max(0, Number(blueRuntime().phaseSerial) || 0) >>> 0;
    }

    function isBluePhaseCurrent(serial) {
        return currentBluePhaseSerial() === (Math.max(0, Number(serial) || 0) >>> 0);
    }

    function clearBlueResolvedFrame() {
        const rt = blueRuntime();
        rt.frameLayers = [];
        return rt.frameLayers;
    }

    function beginBlueCycle(reason = 'prepare-cycle') {
        clearBlueResolvedFrame();
        return bumpBluePhase(reason);
    }

    function invalidateBluePhase(reason = 'invalidate', { clearFrame = true } = {}) {
        const rt = blueRuntime();
        removeBlueScheduledWork();
        rt.boundaryPaintPending = false;
        rt.exactStartPending = false;
        rt.gpuPhasePrepareSerial = ((Math.max(0, Number(rt.gpuPhasePrepareSerial) || 0) + 1) >>> 0);
        rt.gpuPhasePreparing = false;
        rt.gpuPhasePreparePromise = null;
        if (clearFrame) clearBlueResolvedFrame();
        return bumpBluePhase(reason);
    }

    function pauseBlueForOrange(now = performance.now()) {
        const rt = blueRuntime();
        if (!rt.active) return { changed:false, manualPause:false, serial:currentBluePhaseSerial() };
        const manualPause = rt.paused === true && rt.pausedByOrangeProject !== true;
        if (manualPause) {

            invalidateBluePhase('orange-priority-manual-pause', { clearFrame:false });
            rt.paused = true;
            rt.pausedByOrangeProject = false;
            rt.pauseStartedAt = Number(rt.pauseStartedAt) || now;
            return { changed:false, manualPause:true, serial:currentBluePhaseSerial() };
        }
        if (rt.paused === true && rt.pausedByOrangeProject === true) {
            return { changed:false, manualPause:false, serial:currentBluePhaseSerial() };
        }
        invalidateBluePhase('orange-priority', { clearFrame:false });
        rt.paused = true;
        rt.pausedByOrangeProject = true;
        rt.pauseStartedAt = now;
        return { changed:true, manualPause:false, serial:currentBluePhaseSerial() };
    }

    function pauseBlueForGreen(now = performance.now()) {
        const rt = blueRuntime();
        if (!rt.active) return { changed:false, manualPause:false, serial:currentBluePhaseSerial() };
        const manualPause = rt.paused === true && rt.pausedByOrangeProject !== true && rt.pausedByGreenProject !== true;
        if (manualPause) {
            invalidateBluePhase('green-priority-manual-pause', { clearFrame:false });
            rt.paused = true;
            rt.pausedByGreenProject = false;
            rt.pauseStartedAt = Number(rt.pauseStartedAt) || now;
            return { changed:false, manualPause:true, serial:currentBluePhaseSerial() };
        }
        if (rt.paused === true && rt.pausedByGreenProject === true) {
            return { changed:false, manualPause:false, serial:currentBluePhaseSerial() };
        }
        invalidateBluePhase('green-transition-priority', { clearFrame:false });
        rt.paused = true;
        rt.pausedByGreenProject = true;
        rt.pausedByOrangeProject = false;
        rt.pauseStartedAt = now;
        return { changed:true, manualPause:false, serial:currentBluePhaseSerial() };
    }

    function beginBlueRebase(now = performance.now(), reason = 'rebase') {
        const rt = blueRuntime();
        const keepManualPause = rt.paused === true && rt.pausedByOrangeProject !== true && rt.pausedByGreenProject !== true;
        invalidateBluePhase(reason);
        rt.progress = 0;
        rt.geometryT = 0;
        rt.geometryBlend = 0;
        rt.lastFrameUpdate = 0;
        rt.cycleStart = 0;
        rt.webUiHoldStart = 0;
        rt.manualProfileEditing = false;
        rt.orbitCopyMemory = [];
        rt.lightScales = [];
        rt.lightRotations = [];
        rt.lightLayers = [];
        rt.lightDrawData = [];
        rt.runtimeProfiles = [];
        rt.suppressPaletteCycleOnce = true;
        rt.paused = keepManualPause;
        rt.pausedByOrangeProject = false;
        rt.pausedByGreenProject = false;
        rt.pauseStartedAt = keepManualPause ? now : 0;
        return { keepManualPause, serial:currentBluePhaseSerial() };
    }

    function completeBlueRebase(keepManualPause, now = performance.now()) {
        const rt = blueRuntime();
        rt.paused = keepManualPause === true;
        rt.pausedByOrangeProject = false;
        rt.pausedByGreenProject = false;
        rt.pauseStartedAt = keepManualPause === true ? now : 0;
        return rt.paused;
    }

    function resolveBlueTimeline({ now, cycleStart, cycleMs, mode='circleSlide', fadePercent=0, easing }) {
        const duration = Math.max(1, Number(cycleMs) || 1);
        const elapsed = Math.max(0, Math.min(duration, (Number(now) || 0) - (Number(cycleStart) || 0)));
        const linearT = clamp01(elapsed / duration);
        let transitionLinearT = linearT;
        if (mode === 'fade') {
            const fadeFraction = clamp01((Number(fadePercent) || 0) / 100);
            if (fadeFraction <= 1e-9) transitionLinearT = 0;
            else transitionLinearT = clamp01((linearT - (1 - fadeFraction)) / fadeFraction);
        }
        const ease = typeof easing === 'function' ? easing : clamp01;
        let geometryT = Number(ease(transitionLinearT));
        if (!Number.isFinite(geometryT)) geometryT = transitionLinearT;

        if (transitionLinearT <= 1e-9) geometryT = 0;
        else if (transitionLinearT >= 1 - 1e-9) geometryT = 1;
        return { elapsed, linearT, transitionLinearT, geometryT };
    }

    function getDisplayLayerAt(index) {
        const i = Math.max(0, Math.floor(Number(index) || 0));
        const blue = blueRuntime();
        const green = greenRuntime();
        if (greenOwnsFrame()) return green.frameRenderLayers?.[i] || state?.layers?.[i] || null;
        if (orangeRuntime().transitioning === true) return null;
        if (blue.active !== true || blue.exactStartPending === true) return null;
        const canonical=state?.layers?.[i]||null;
        if (state?.morph?.mode === 'light' && state?.morph?.monoOrbitTransforms !== true) {
            const frame=blue.lightLayers?.[i] || blue.frameLayers?.[i] || null;
            if(frame&&canonical)frame.visible=canonical.visible!==false;
            return frame;
        }
        const frame=blue.frameLayers?.[i] || null;
        if(frame&&canonical)frame.visible=canonical.visible!==false;
        return frame;
    }

    function getDisplayLayers() {
        const canonical = Array.isArray(state?.layers) ? state.layers : [];
        const green = greenRuntime();
        if (greenOwnsFrame() && Array.isArray(green.frameRenderLayers) && green.frameRenderLayers.length)
            return green.frameRenderLayers;
        const blue = blueRuntime();
        if (orangeRuntime().transitioning !== true && blue.active === true && blue.exactStartPending !== true) {
            const lightMode=state?.morph?.mode==='light' && state?.morph?.monoOrbitTransforms!==true;
            const list=lightMode?blue.lightLayers:blue.frameLayers;
            if(Array.isArray(list)&&list.length===canonical.length&&list.every(Boolean)){
                for(let i=0;i<list.length;i++)if(list[i]&&canonical[i])list[i].visible=canonical[i].visible!==false;
                return list;
            }
        }
        return canonical;
    }

    function getDisplayLayerById(id) {
        if (!id || !Array.isArray(state?.layers)) return null;
        const i = state.layers.findIndex(layer => layer?.id === id);
        return i >= 0 ? getDisplayLayerAt(i) : null;
    }

    function resolveOwner() {
        if (greenOwnsFrame()) return 'green';
        if (orangeRuntime().transitioning === true) return 'orange';
        if (blueRuntime().active === true) return 'blue';
        return 'canonical';
    }

    function status() {
        const blue = blueRuntime(), orange = orangeRuntime(), green = greenRuntime();
        return {
            owner: resolveOwner(),
            blue: {
                active: blue.active === true,
                paused: blue.paused === true,
                pausedByOrange: blue.pausedByOrangeProject === true,
                pausedByGreen: blue.pausedByGreenProject === true,
                phaseSerial: currentBluePhaseSerial(),
                phaseReason: blue.phaseReason || '',
                frameLayers: blue.frameLayers?.length || 0,
                linearProgress: Number(blue.progress) || 0,
                geometryProgress: Number(blue.geometryT) || 0
            },
            orange: { active: orange.active === true, transitioning: orange.transitioning === true },
            green: { active: green.active === true, transitionActive: green.transitionActive === true, ownsFrame: greenOwnsFrame() },
            contract: 'state.layers is canonical; Blue and Green render from runtime frame layers; Orange owns an explicit commit/priority window.'
        };
    }

    return Object.freeze({
        beginBlueCycle,
        invalidateBluePhase,
        pauseBlueForOrange,
        pauseBlueForGreen,
        beginBlueRebase,
        completeBlueRebase,
        resolveBlueTimeline,
        currentBluePhaseSerial,
        isBluePhaseCurrent,
        clearBlueResolvedFrame,
        getDisplayLayerAt,
        getDisplayLayers,
        getDisplayLayerById,
        greenOwnsFrame,
        resolveOwner,
        status
    });
})();

window.SpiroMorphController = SpiroMorphController;
window.__spiroMorphArchitectureStatus = () => SpiroMorphController.status();
