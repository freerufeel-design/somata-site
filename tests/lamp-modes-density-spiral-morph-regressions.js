'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('index.html');
const appA=read('js/legacy/app-a.js');
const appB=read('js/legacy/app-b.js');
const appC=read('js/legacy/app-c.js');
const framePaths=read('js/geometry/frame-paths.js');
const bridge=read('js/render/lamp-morph-bridge.js');
const spiral=read('js/gpu/spiral-bezier-morph-renderer.js');
const staticArc=read('js/gpu/morph-arc-resource.js');
const kernel=read('js/geometry/kernel.js');
const pipeline=read('js/render/main-pipeline.js');
const scheduler=read('js/core/scheduler.js');

// User contract: Key = only logical segment/path ends. Corners = Key + logical bends,
// including bends whose visible path is smoothed by rounding/spline geometry.
assert(appA.includes('Lamp mode «Ключевое» on a Spiral means ONLY the two ends'), 'Static Spiral Key mode must be endpoint-only');
assert(!/for\s*\([^)]*lampCornerFlags[^)]*\)[\s\S]{0,180}pushPoint/.test(appA.slice(appA.indexOf('function buildLampCircumferenceAnchors'), appA.indexOf('function buildLampCircumferenceAnchors')+7000)), 'Static Spiral Key mode must not add interior lampCornerFlags');
assert(framePaths.includes('function mergeLampKeyAndCornerPoints(')&&framePaths.includes('return mergeLampKeyAndCornerPoints(keyPoints,bendPoints,maxPoints);'), 'Static Corners mode must merge Key endpoints with bend markers');
assert(appB.includes('function collectMorphKeyPointsForCornerMode(')&&(appB.match(/mergeLampKeyAndCornerPoints\(keyPoints,[^,]+,maxPoints\)/g)||[]).length>=2, 'Morph Corners mode must merge Key endpoints with bend markers in both linear/ghost and generic paths');
assert(spiral.includes("if(kind==='key')return knots.length>1?[0,1]:[0]")&&spiral.includes('const logical=path?.lampCornerFlags||[],geometric=path?.cornerFlags||[]'), 'Retained Morph Spiral metadata must keep endpoint-only Key fractions and independent logical/geometric bend fractions');
assert(staticArc.includes('keys=fr.length>1?[0,1]:[0]')&&staticArc.includes('logicalCorners[j]===true||cornerFlags[j]===true'), 'Static retained Spiral metadata must use the same Key/Corners semantics');
assert(bridge.includes('const merged=[...keyFractions,...bendFractions]'), 'Special Spiral GPU Corners mode must be Key + bends');
assert(appB.includes('logicalFlags=path?.lampCornerFlags||[]')&&appB.includes('const strength=logicalBend?1:'), 'CPU/static Corners mode must keep authored bend lamps even when visible rounding/spline removes the geometric kink');
assert(appA.includes('nearestSpiralProfileLogicalCornerFlags')&&appA.includes('keyFlags:nearestSpiralProfileLogicalCornerFlags(polygonSpline,base,authoredLogicalCorners)')&&appA.includes("layer.profileMode === 'segments' || layer.profileMode === 'spline'"), 'Smooth Spiral profiles must retain a separate authored-bend lamp channel without hardening the spline');
assert(appC.includes('lampLogicalCornerFlagsForMorphGrid')&&appC.includes('__lampLogicalCornerFlags')&&appC.includes('lampLogicalCornerFlags:Array.isArray(target?.lampLogicalCornerFlags)'), 'Blue Morph endpoint snapshots must carry logical spline-bend lamp identity across phase boundaries');

// Density regression: the special Spiral GPU route must use the same count allocator as the
// ordinary arbitrary route, and that allocator must consume the actual frame/layer config.
assert(framePaths.includes('function lampArbitraryDensityFactor(explicitConfig=null)')&&framePaths.includes("const cfg=(explicitConfig&&typeof explicitConfig==='object')?explicitConfig:getLampEvaluationConfig()"), 'Arbitrary density helper must support an explicit render-layer config');
assert(bridge.includes('allocateGpuArbitraryLampCounts(frameCtx.layer,morphRec,t,maxPoints,frameCtx?.layerLampConfig'), 'Special Spiral Arbitrary mode must pass the actual layer lamp config into density allocation');
assert(!bridge.includes('Math.round(len/48)'), 'Special Spiral Arbitrary mode must not use the old hard-coded len/48 population');

// Execute the real allocator in isolation to prove density changes the resulting population.
const ctx={
  window:{}, console,
  lampMotionRuntime:{arbitraryPathCounts:new Map()},
  lampArbitraryDensityFactor:cfg=>Math.max(0,Math.min(5,(Number(cfg?.density??100)/100)*Number(cfg?.densityMultiplier??1)))
};
vm.createContext(ctx);vm.runInContext(bridge,ctx,{filename:'lamp-morph-bridge.js'});
const layer={id:'density-regression'}, rec={pathCount:1,cpuEndpointPathLengths:new Float32Array([240,240])};
const countFor=(density,mult=1)=>ctx.allocateGpuArbitraryLampCounts(layer,rec,0.5,600,{density,densityMultiplier:mult})[0]?.count||0;
assert.strictEqual(countFor(50),5,'50% density should halve the 10-lamp base population');
assert.strictEqual(countFor(100),10,'100% density should preserve the base population');
assert.strictEqual(countFor(200),20,'200% density should double the base population');
assert.strictEqual(countFor(50,2),10,'Density multiplier must participate in Arbitrary count allocation');
assert.strictEqual(countFor(0),0,'0% Arbitrary density must produce no lamps');

// Morph freeze regression from the supplied log: dynamic Spiral Corridor Fill must not enter an
// impossible native-fill wait when the current retained rail is open/non-fillable.
assert(kernel.includes('const dynamicCorridorNative=fillRequested&&dynamic&&corridor')&&!kernel.includes('dynamicCorridorNative=fillRequested&&dynamic&&corridor&&!unsupportedFillKind&&!state.fourierMode&&!state.showRoundingGuides&&!tunnelColorShiftIsActive()&&Boolean(frameCtx.drawLayerGeometry)&&!spiralEndpoint'), 'Dynamic Spiral Corridor must remain eligible for native Fill preflight');
assert(pipeline.includes("suppressed:true,reason:'dynamic Spiral Corridor has no closed native Fill contour'")&&pipeline.includes("stage:'corridor-no-closed-fill'"), 'Open Spiral Corridor Fill must be suppressed for that frame instead of waiting forever');
assert(scheduler.includes('const staleRaf=raf')&&scheduler.includes('cancelAnimationFrame(staleRaf)'), 'Scheduler watchdog recovery must cancel the stale rAF before forced recovery');

// Cache-bust every changed runtime file so testing a replaced build cannot silently execute the
// prior hotfix from the browser HTTP cache.
for(const file of ['js/geometry/kernel.js','js/core/scheduler.js','js/legacy/app-a.js','js/geometry/frame-paths.js','js/render/lamp-morph-bridge.js']){
  assert(html.includes(`${file}?v=20261012-v7320-hf5`),`${file} must preserve the hf5 cache-buster`);
}
for(const file of ['js/gpu/morph-arc-resource.js','js/gpu/spiral-bezier-morph-renderer.js','js/render/main-pipeline.js']){
  assert(html.includes(`${file}?v=20261012-v7320-hf8`),`${file} must use the hf8 12-point topology-placement cache-buster`);
}
assert(html.includes('js/legacy/app-b.js?v=20261012-v7320-hf10'),'app-b must use the hf10 lamp-performance cache-buster');
assert(html.includes('js/legacy/app-c.js?v=20261012-v7320-hf11'),'app-c must use the hf11 fullscreen cache-buster');

console.log('Lamp modes / Arbitrary density / Spiral Morph freeze regressions: PASS');
