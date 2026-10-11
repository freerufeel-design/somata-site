// v508 — Linear Fill Plan.
// Static fill preparation is O(N): no pairwise self-intersection scan and no ear-clipping.
// Every closed contour is represented as oriented edge wedges for GPU stencil evaluation.
// One plan covers the whole layer, so overlapping contours are composited exactly once.
var FillMeshPreparer = (() => {
    let cache = new WeakMap();
    let evictedMeshes = [];
    const MAX_VARIANTS_PER_DRAW_DATA = 16;
    const EPS = 1e-8;
    let builds = 0, hits = 0, contoursSeen = 0, degenerateContours = 0;
    let variantEvictions = 0, preparedFrames = 0, skippedFrames = 0;
    let sourcePoints = 0, emittedEdges = 0, fanBytes = 0, linearPlans = 0;

    function samePoint(a, b) {
        return Math.abs(Number(a?.x) - Number(b?.x)) <= EPS && Math.abs(Number(a?.y) - Number(b?.y)) <= EPS;
    }

    function cleanContourPoints(points) {
        if (!Array.isArray(points) || points.length < 3) return null;
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const p = points[i], x = Number(p?.x), y = Number(p?.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            if (!out.length || !samePoint(out[out.length - 1], p)) out.push(p);
        }
        if (out.length > 2 && samePoint(out[0], out[out.length - 1])) out.pop();
        return out.length >= 3 ? out : null;
    }

    function renderedContourPoints(layer, contour) {
        const path = contour?.path;
        if (!path?.points?.length) return null;
        const sampler = createLampRenderedPathSampler();
        const rounding = getRoundingStrength(layer?.rounding);
        if (useSmoothSplinePath(layer, rounding, path)) {
            splinePathForDraw(sampler, path.points, true, rounding, path.cornerFlags || [], path.bridgeRoundFlags || []);
        } else {
            roundPolylineForDraw(sampler, path.points, true, rounding, path.cornerFlags || []);
        }
        return cleanContourPoints(sampler.points.length >= 3 ? sampler.points : path.points);
    }

    function keyFor(layer) {
        return [
            Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(layer?.rounding) || 0)).toFixed(4),
            String(layer?.profileMode || 'segments'),
            normalizeSplineRenderMode(layer?.splineRenderMode),
            state.fourierMode ? 1 : 0
        ].join('|');
    }

    function prepareStatic(drawData, layer) {
        if (!drawData || typeof drawData !== 'object') return null;
        const key = keyFor(layer);
        let variants = cache.get(drawData);
        if (!variants) { variants = new Map(); cache.set(drawData, variants); }
        const cached = variants.get(key);
        if (cached) { hits++; return cached; }

        const canonical = GeometryKernel.inspectStaticDrawData(drawData);
        const records = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let totalPoints = 0, rejected = 0;

        // Pass 1: render/clean each contour and compute one layer-wide outside anchor.
        for (const contour of canonical.fillContours || []) {
            contoursSeen++;
            const points = renderedContourPoints(layer, contour);
            if (!points || points.length < 3) {
                degenerateContours++; rejected++;
                records.push({ contour, status: 'degenerate', pointCount: 0, points: null });
                continue;
            }
            for (let i = 0; i < points.length; i++) {
                const p = points[i], x = Number(p.x), y = Number(p.y);
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            totalPoints += points.length;
            records.push({ contour, status: 'stencil-edge-fan', pointCount: points.length, points });
        }

        let fanData = null, fanTriangleCount = 0, anchor = null;
        const validRecords = records.filter(r => r.status === 'stencil-edge-fan');
        if (validRecords.length && Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
            const span = Math.max(1, maxX - minX, maxY - minY);
            // One anchor for all contours preserves a single global stencil field.
            anchor = { x: minX - span * 2 - 1, y: minY - span * 2 - 1 };
            fanData = new Float32Array(totalPoints * 6);
            let o = 0;
            for (const rec of validRecords) {
                const points = rec.points;
                rec.fanOffset = o / 2;
                rec.fanTriangleOffset = fanTriangleCount;
                for (let i = 0; i < points.length; i++) {
                    const a = points[i], b = points[(i + 1) % points.length];
                    if (samePoint(a, b)) continue;
                    fanData[o++] = anchor.x; fanData[o++] = anchor.y;
                    fanData[o++] = Number(a.x); fanData[o++] = Number(a.y);
                    fanData[o++] = Number(b.x); fanData[o++] = Number(b.y);
                    fanTriangleCount++;
                }
                rec.fanTriangleCount = fanTriangleCount - rec.fanTriangleOffset;
                rec.points = null; // release object rail; GPU plan is the canonical fill representation.
            }
            if (o !== fanData.length) fanData = fanData.slice(0, o);
        }

        builds++; linearPlans++; sourcePoints += totalPoints; emittedEdges += fanTriangleCount;
        fanBytes += fanData?.byteLength || 0;
        const complete = validRecords.length > 0 && rejected === 0 && fanTriangleCount > 0;
        const result = {
            key, drawData, records, anchor, fanData, fanTriangleCount,
            meshable: validRecords.length,
            stencilRequired: validRecords.length,
            rejected,
            totalVertices: totalPoints,
            totalTriangles: fanTriangleCount,
            complete,
            nativeComplete: complete,
            preparationComplexity: 'O(N)',
            semantic: 'canonical linear stencil Fill: all contours share one stencil field and one color composite'
        };

        variants.set(key, result);
        while (variants.size > MAX_VARIANTS_PER_DRAW_DATA) {
            const oldestKey = variants.keys().next().value;
            const oldPlan = variants.get(oldestKey);
            variants.delete(oldestKey);
            if (oldPlan) { evictedMeshes.push(oldPlan); variantEvictions++; }
        }
        return result;
    }

    function prepareFrame(frameCtx) {
        const layer = frameCtx?.layer, plan = frameCtx?.geometryPlan || {};
        if (!layer?.fill || plan.dynamic === true || isSpiralLayer(layer)) {
            skippedFrames++; return null;
        }
        const drawData = plan.sourceData || frameCtx.staticDrawData;
        if (!drawData) { skippedFrames++; return null; }
        const fillPlan = prepareStatic(drawData, layer);
        frameCtx._fillMeshShadow = fillPlan;
        preparedFrames++;
        return fillPlan;
    }

    function canUseNative(frameCtx) {
        const fillPlan = frameCtx?._fillMeshShadow || prepareFrame(frameCtx), plan = frameCtx?.geometryPlan || {};
        return Boolean(fillPlan?.nativeComplete && fillPlan.fanTriangleCount > 0 && plan.dynamic !== true &&
            !isSpiralLayer(frameCtx?.layer) && !state.fourierMode && !state.showRoundingGuides);
    }

    function takeEvicted() { const out = evictedMeshes; evictedMeshes = []; return out; }
    function reset() { cache = new WeakMap(); evictedMeshes = []; }
    function status() {
        return {
            builds, hits, contoursSeen, degenerateContours, variantEvictions,
            maxVariantsPerDrawData: MAX_VARIANTS_PER_DRAW_DATA,
            preparedFrames, skippedFrames, sourcePoints, emittedEdges, fanBytes, linearPlans,
            classificationPasses: 0, earClippingPasses: 0,
            mode: 'linear-stencil-all', complexity: 'O(N)',
            semantic: 'all static closed contours -> one GPU stencil field -> one layer color composite'
        };
    }
    return { prepareStatic, prepareFrame, canUseNative, takeEvicted, status, reset };
})();

window.__spiroFillMeshPreparationStatus = () => FillMeshPreparer.status();
window.__spiroNativeFillPolicy = () => ({
    enabled: true,
    simpleStaticContours: true,
    selfIntersectionWindingStencil: true,
    selfIntersectionEvenOddStencil: true,
    selfIntersectionPolicy: 'native GPU stencil; no CPU intersection classification',
    defaultFillRule: 'evenodd',
    requiresNativeComplete: true,
    preparationComplexity: 'O(N)',
    excludes: ['dynamic-morph', 'spiral', 'fourier', 'rounding-guides'],
    fallbackOrder: ['native-webgpu-stencil', 'exact-rule-mask->webgpu', 'exact-rule-mask->webgl2', 'exact-canvas-fill'],
    layerSceneResident: true,
    visibleSemantics: 'source-over, premultiplied, 4x MSAA; one composite per layer'
});
