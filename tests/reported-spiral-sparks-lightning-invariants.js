'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('js/legacy/app-c.js');
const appB=read('js/legacy/app-b.js');
const policy=read('js/core/backend-policy.js');
const framePaths=read('js/geometry/frame-paths.js');
const pipeline=read('js/render/main-pipeline.js');
const sweep=read('js/render/sweep-pass.js');
const lightning=read('js/gpu/lightning-arc-renderer.js');
const lamps=read('js/render/lamp-morph-bridge.js');
const web=read('js/render/web-morph-bridge.js');
const webPass=read('js/render/web-pass.js');
const selfTest=read('js/core/self-test.js');

assert(app.includes('phaseSourceProfileHandoff'),'Spiral phase boundaries must preserve the exact visible paired profile');
assert(app.includes('sourceAlreadySampled = false')&&app.includes('targetAlreadySampled = false'),'Paired circle profiles must distinguish already-sampled phase handoff data');
assert(app.includes('phaseHandoff: true')&&app.includes("alreadySampled: mode === 'spline'"),'Next Spiral phase must consume the exact sampled endpoint without a second arc resample');
assert(app.includes('preserveSourceGrid = false')&&app.includes('if (preserveSourceGrid && a.length >= 2)'),'Phase pairing must support an immutable source grid after a visible Spiral boundary');
assert(app.includes('source.phaseHandoff === true'),'Only an actual phase handoff may enable immutable-source pairing');
assert(app.includes('sourceNodes.map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}))')&&app.includes('targetNodes.map(p=>({x:Number(p?.x)||0,y:Number(p?.y)||0}))'),'Render-layer snapshots must detach profileNodes from authoritative Morph source/target grids');
assert(app.includes('const commitResolvedSpiral = isSpiralLayerMorphEnabled() ||')&&app.includes('spiralMorphUsesCorridorPhase()'),'Spiral boundary commit must include Corridor-driven step morphs even when Spiral layer/order morph options are disabled');
assert(app.includes('layer.spiralStep = normalizeSpiralStep(visual.spiralStep ?? visual.K ?? layer.K ?? 1, visual)')&&app.includes('layer.spiralStepLinked = visual.spiralStepLinked !== false'),'Spiral boundary commit must preserve the exact visible target step/link state');
assert(app.includes('layer.spiralTangential = visual.spiralTangential === true')&&app.includes('layer.spiralRoundSeams = visual.spiralRoundSeams !== false'),'Spiral boundary commit must copy target topology flags exactly instead of sticky OR/AND merging');
assert(app.includes("__somataDegradeGpuBackend?.('PHASE_CIRCLE_GPU_PREWARM_FAILED'"),'Critical Spiral GPU preparation failure must degrade to CPU instead of freezing Morph forever');
assert(framePaths.includes('somataCpuBackendForced')&&framePaths.includes('CPU reference backend materialises the canonical Circle/Spiral path'),'Runtime CPU fallback must be allowed to materialize canonical Spiral paths');

assert(policy.includes('somataGpuFeatureWaits')&&policy.includes('somataGpuFeatureWaitOrFallback'),'Optional GPU effects need a bounded warm-up/fallback policy');
assert(policy.includes('somataDegradeGpuBackend(`optional GPU'),'Stalled optional GPU effects must degrade the complete strict scene to CPU');
assert(sweep.includes("gpuOptionalFeatureWait(frameCtx,'lightning'")&&sweep.includes('lightning-arc-render-wait'),'Exact Lightning preparation/render must participate in bounded failover');
assert(lamps.includes("somataGpuFeatureWaitOrFallback('lamps'")&&pipeline.includes("somataGpuFeatureWaitOrFallback('lamps'"),'Spiral Lamps must fail over after bounded GPU warm-up in both prepare and render stages');
assert(web.includes("somataGpuFeatureWaitOrFallback('web'")&&webPass.includes("somataGpuFeatureWaitOrFallback('web'"),'Spiral Web must fail over after bounded GPU warm-up in both prepare and render stages');

assert(lightning.includes('const EXACT_BEZIER_RASTER_SUBDIV=6'),'Exact Lightning needs additional retained-Bézier raster subdivision');
assert(lightning.includes("return String(prepared?.cfg?.lightningPrecision||'exact').toLowerCase()==='simple'?1:EXACT_BEZIER_RASTER_SUBDIV"),'Simple Lightning may keep the one-chord fast path while exact uses Bézier subdivision');
assert(lightning.includes('retainedPoint(si,f0)')&&lightning.includes('retainedPoint(si,f1)'),'Exact Lightning vertices must be evaluated from the authoritative retained Bézier at subsegment endpoints');
assert(lightning.includes('arcRec.segmentCount*rasterSubdiv*copyCount'),'Exact Lightning draw instance count must include Bézier raster subdivision');
assert(sweep.includes('Exact precision evaluates six retained Bézier subsegments'),'Runtime bridge contract must document the exact-vs-simple geometry distinction');
assert(appB.includes('return (pct/100)*mult;')&&!appB.includes('return (pct/100)*mult*0.25;'),'Lightning rate controls must not hide the old quarter-speed scale that made Sparks appear stalled');
assert(app.includes("reason:'morph-start-arm-timeout'")&&app.includes('setTimeout(() =>')&&app.includes('startArmSerial'),'Blue Morph startup must have a bounded independent scheduler-arm fallback');
assert(selfTest.includes('__somataReportedSpiralSparksSmokeTest')&&selfTest.includes('Spiral phase ${boundaryGaps.length} source-grid jump')&&selfTest.includes('Искры exact Lightning made no visible contribution'),'Release self-test must exercise the reported Spiral/Sparks regressions on real playlist fixtures');

console.log('Reported Spiral / Sparks / exact Lightning regressions: PASS');
