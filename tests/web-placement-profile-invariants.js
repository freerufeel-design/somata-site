'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const corner=read('js/gpu/web-corner-resource.js');
const web=read('js/gpu/web-morph-renderer.js');
const bridge=read('js/render/web-morph-bridge.js');
const pipe=read('js/render/main-pipeline.js');
const appA=read('js/legacy/app-a.js');
const appC=read('js/legacy/app-c.js');
const morph=read('js/geometry/morph.js');
const framePaths=read('js/geometry/frame-paths.js');
const budget=read('js/geometry/morph-budget.js');
const arc=read('js/gpu/morph-arc-resource.js');

assert.ok(corner.includes('(GPU_WEB_MAX_CORNERS+1)*4')&&corner.includes('cornerIndices[220u]=isActive'), 'Web corner buffer must carry an explicit active-corner sentinel beside the 220 compacted indices');
assert.ok(corner.includes('let activeCorners=cornerIndices[220u]')&&corner.includes('if(cornerSlot>=activeCorners){return;}'), 'Indirect Web thread dispatch must reject surplus workgroup lanes before reading a compacted corner index');
assert.ok(corner.includes('m.cpuPathCornerFractions||[]')&&corner.includes('pathHasAuthored')&&corner.includes('cornerCandidate=select(logicalBoundary,authored,pathHasAuthored)')&&corner.includes('candidate=select(logicalBoundary,cornerCandidate,cornerMode)'), 'Corners placement must use authored profile corner fractions per path when present and angular logical-boundary detection when absent');
assert.ok(corner.includes('arcTarget=select(smooth01')&&corner.includes('GPU_WEB_CORNER_SPAN_WGSL')&&corner.includes('localSpan=max(0.0,cornerState[si].z)')&&corner.includes('localSpan*frac*dm'), 'Corners placement must preserve the historical full-target/neighbour-detected-corner span semantics on the canonical GPU Arc');
assert.ok(!bridge.includes('corridor-crosslink-web-uses-exact-gpu-raster-fallback'), 'selfIntersectionCorridor must not be rejected from the native WebGPU Web bridge');
assert.ok(bridge.includes('currentGpuBezierResourceForFrame(frameCtx)'), 'Native Web must accept the canonical retained resource for static Spiral as well as Morph Spiral');
assert.ok(web.includes('@group(1) @binding(3) var<storage,read> cornerIndices')&&web.includes('vsCrossCorridor')&&web.includes("prepared.placementMode==='selfIntersectionCorridor'"), 'Corridor cross-links must be encoded inside the native WebGPU Web renderer from compacted canonical corners');
assert.ok(web.includes('activeCorners=min(cornerIndices[220u],64u)')&&web.includes('pass.draw(4,64*(copyCount-1))'), 'Native Corridor cross-links must preserve the historical 64-corner safety cap');
assert.ok(pipe.includes('const residentRoot=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId)')&&!pipe.includes('if(frameCtx.frame.gpuLayerSceneDeferred===true||WebGPUStrokeRenderer.getFrameSceneTexture?.(frameCtx.frameId))return true;'), 'Strict Spiral Layer Scene ownership must be based on the resident scratch record, not a stale frame-wide boolean');
assert.ok(pipe.indexOf("strictSpiralRootPreflight")<pipe.indexOf('// v393 ordering guard'), 'Strict Spiral must open its resident Layer Scene before the multi-layer ordering gate can reject Fill/Web/Corridor consumers');
assert.ok(appA.includes("function useSmoothSplinePath(layer")&&appA.includes("return layer?.profileMode === 'spline';"), 'Spline profile mode itself must select the continuous cubic renderer');
assert.ok(morph.includes("const renderMode=profileMode==='spline'?'smooth':normalizeSplineRenderMode(splineRenderMode)")&&morph.includes("const smoothSplineRenderer = options.profileMode === 'spline';"), 'Morph must force spline profiles through continuous spline geometry regardless of stale splineRenderMode');
assert.ok(framePaths.includes("if(srcMode==='spline'&&dstMode==='spline')return true;")&&budget.includes("const smooth=mode==='spline';"), 'Morph endpoint preparation and topology budget must treat spline mode as intrinsically smooth');
assert.ok(arc.includes("const smooth=layer?.profileMode==='spline'&&path?.spiralProfileSplineBaked!==true"), 'Static retained Spiral Arc must derive its cubic carrier from spline profileMode without a discrete-mode downgrade');
assert.ok(appC.includes("if(mode==='spline')layer.splineRenderMode='smooth'")||appC.includes("profileMode==='spline'"), 'Profile editing must migrate spline selections to the smooth compatibility value');
assert.ok(['webIndirectActiveCornerGuard:true','webCornersAuthoredAngularFallback:true','webAuthoredCornerFractionsOnly:true','webCornerExactCubicTangents:true','webPeriodicSelfIntersectionUsesNeighbourSpan:true','webCorridorCrosslinksNative:true','splineProfileModeAuthoritative:true','strictSpiralResidentRootRecordAuthority:true'].every(flag=>pipe.includes(flag)), 'Runtime audit must expose the repaired Web placement, native Corridor cross-link, spline authority, and resident-root contracts');

console.log('Web placement / profile invariants OK');
