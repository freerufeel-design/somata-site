'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const appA=read('js/legacy/app-a.js');
const defaults=read('js/core/defaults-layers.js');
const state=read('js/core/state.js');
const pipe=read('js/render/main-pipeline.js');
const appC=read('js/legacy/app-c.js');
const spiral=read('js/gpu/spiral-bezier-morph-renderer.js');
const arc=read('js/gpu/morph-arc-resource.js');
const sweep=read('js/render/sweep-pass.js');
const web=read('js/render/web-pass.js');
const lamps=read('js/render/lamp-morph-bridge.js');
const lampGpu=read('js/gpu/lamp-renderer.js');
const graffiti=read('js/render/graffiti-pass.js');
const particles=read('js/render/particle-pass.js');
const particleGpu=read('js/gpu/particle-renderer.js');
const pathFx=read('js/render/path-fx-pass.js');
const scheduler=read('js/render/gpu-command-scheduler.js');
const profileArc=read('js/gpu/profile-arc-marker-renderer.js');
const graph=read('js/render/render-graph.js');
const isV69=pipe.includes("version:'6.9'")||pipe.includes("version:'7.0'")||pipe.includes("version:'7.0.3'")||(pipe.includes("version:'7.2'")||pipe.includes("version:'7.2.4'"));

assert.ok(/Somata\s+7\.2/i.test(html),'UI must identify the 7.2 build');
assert.ok(appA.includes('function buildSpiralBezierSegments('),'Static Spiral needs one retained cubic builder');
assert.ok(appA.includes('ctx.__spiroGLGeometryRecorder === true'),'Static Spiral recorder must retain cubic commands even during WebGPU warmup');
assert.ok(appA.includes('__variableWidthBezierSpiral=true'),'Static Spiral base must emit retained cubic commands');
assert.ok(appA.includes("Object.defineProperty(commands,'__spiroGeometryVersion'"),'Persistent static cubic commands must carry geometry revision');
assert.ok(appA.includes('Number(rec.geometryVersion||0)===geometryVersion'),'Static Spiral GPU cubic cache must reject stale profile revisions');
assert.ok(appA.includes('supportsBezierSpiral:()=>Boolean(ready&&!lost&&bezierPipelineMax&&bezierPipelineOver)'),'Static Spiral base must have a native WebGPU Bézier renderer');
assert.ok(appA.includes('let first=(flags>=0.5&&flags<1.5)||(flags>=2.5);')&&!appA.includes('let first=flags>=0.5&&flags<1.5||flags>=2.5;'),'7.0.3 Smooth Spiral WGSL must explicitly parenthesize mixed && / || logic so the shared WebGPU pipeline compiles');
assert.ok(appA.includes('compactBezierProfile:true')&&appA.includes('__spiralBezierOutTx')&&appA.includes('_spiroHermiteMapped=hermiteCount>0'),'Segment-profile Spiral must use compact mapped Hermite→cubic Béziers instead of dense straight samples');
assert.ok(appA.includes('function spiralProfileGeometrySignature(')&&appA.includes('__spiroProfileSignature'),'Static Spiral GPU caches must be content-addressed by the actual authored profile, not revision counters alone');
assert.ok(appA.includes('__profileKeyCorner')&&appA.includes("mix(q?.kind||q?.type||'')"),'Static Spiral profile signature must include authored node metadata, not only XY');
assert.ok(arc.includes('profileSignature=typeof __spiroSpiralProfileGeometrySignature')&&arc.includes("String(old.profileSignature||'')===profileSignature"),'Shared static Spiral effect rail must rebuild immediately after any profile content change');

assert.ok(spiral.includes('equalizeCubicRailsByArc')&&spiral.includes('cubicSubsegment'),'Morph Spiral endpoints must be exact cubic subcurves on a common arc partition');
assert.ok(spiral.includes('effectCubicPipeline=device.createComputePipeline'),'Current Morph cubic controls must be generated on GPU once per rail');
assert.ok(spiral.includes('bezierVisualRail:true')&&spiral.includes('gpuOnlySpiralEffects:true'),'Morph resource must advertise the shared Bézier/GPU-only contract');
assert.ok(!spiral.includes("document.createElement('canvas')"),'Spiral Morph renderer must not own a hidden presentation canvas');
assert.ok(!spiral.includes('ctx.drawImage('),'Spiral Morph renderer must not bridge through Canvas2D');
assert.ok(spiral.includes('const radiusEps=')&&spiral.includes('globalPhaseK')&&spiral.includes('shift=globalPhaseK*TWO_PI'),'Minimal Turn must choose one radius-aware least-rotation equivalent phase for the whole retained cubic rail');
assert.ok(spiral.includes('function pairMinimalTurnSpiralPaths')&&spiral.includes('minimalTurnPathShift'),'Minimal Turn must preserve orbit order through one minimum-cost cyclic path shift');
assert.ok(spiral.includes('function minimalTurnPathPairCost')&&spiral.includes("'one cheap endpoint, huge interior spin'"),'Minimal Turn path pairing must score the whole visible orbit, not only its first angular sample');
assert.ok(spiral.includes('radialMerge:true')&&spiral.includes('_minimalPairCost')&&spiral.includes('radialSplit:true'),'Minimal Turn split/merge phases must use the whole-path cost instead of generic first-angle pairing');
assert.ok(!arc.includes('scheduledBySpiralBase')&&arc.includes('encodeCurrentCubics(encoder,t)'),'Bézier-derived Arc must encode its current cubic prerequisite in the same ordered command buffer instead of trusting an unsubmitted base-pass buffer');
assert.ok(scheduler.includes("const custom=typeof morphRec.encodeCurrentCubics==='function'")&&scheduler.includes('buildCurrentCubicsPrerequisite')&&scheduler.includes('currentCubicsCommittedFrameId'),'Direct Spiral Bézier effects must depend on an explicitly ordered/committed retained-cubic prerequisite');
assert.ok(pipe.includes('__somataSpiral70Audit')&&pipe.includes('__somataSpiral69Audit')&&pipe.includes('__somataSpiral68Audit')&&pipe.includes('mixedCanvasFallbackAllowed:!strict'),'7.0 must expose an inspectable strict Spiral GPU/Bézier runtime audit while retaining compatibility aliases');
assert.ok(appC.includes("if (getSpiralMorphType() === 'minimalTurn') degrees = ((degrees + 180) % 360 + 360) % 360 - 180;"),'Minimal Turn must also fold authored layer rotation to the shortest ±180° phase');
assert.ok(appC.includes('spiralBezierExtraGeometry')&&pipe.includes('specialSpiralExtraGeometry'),'phaseCircle/minimalTurn retained-cubic mode must cover Spiral rounding/size/rotation/order geometry changes, not only N/K/shape');
assert.ok(appC.includes('function spiralMorphUsesRetainedBezierRail()')&&appC.includes('mixedBackendSpiralBezierMode'),'All non-fade Spiral Morph types must be able to own the retained Bézier rail without forcing non-Spiral siblings off topology/calm');
assert.ok(spiral.includes("forceCartesian=morphType==='continuous'||morphType==='torn'")&&spiral.includes("morphType==='minimalTurn'?'least-turn-polar':'polar'"),'Retained Spiral Morph must preserve distinct Torn/Continuous vs Phase/PhaseCircle/MinimalTurn interpolation laws');
assert.ok(arc.includes("hasSpiralEndpoint&&typeof spiralMorphUsesRetainedBezierRail==='function'"),'Effects must select the same special retained Spiral rail for Continuous/Phase/Torn as Base');
assert.ok(appC.includes('await prepareGpuSpiralBezierMorphResources();'),'Topology/calm phase preparation must build the Spiral retained Bézier carrier beside generic non-Spiral topology resources');

assert.ok(arc.includes('function getStaticSpiralBezierResource(')&&arc.includes('staticSpiralBezierRail:true'),'Static Spiral effects must expose the same retained cubic rail');
assert.ok(arc.includes('gpuBezierDerived:true'),'Arc-distance effects must explicitly derive their GPU arc from Bézier cubics');
assert.ok(arc.includes('if(rec.hasCommittedData&&rec.lastCommittedT===t)'),'Unchanged/static Spiral GPU arc must be reusable without rebuilding every frame');
assert.ok(arc.includes('strictSpiralMorphRail')&&arc.includes('return null;'),'Special Spiral morph must wait for its retained cubic rail instead of substituting topology geometry');
assert.ok(arc.includes('styleOnlySpiralMorph')&&arc.includes('!spiralGeometryRequested'),'Style-only Spiral Morph must keep effects on the static retained cubic GPU carrier');

assert.ok(pipe.includes('function isStrictSpiralWebGPUFrame('),'Main pipeline needs a strict non-Fourier Spiral GPU mode');
assert.ok(pipe.includes("somataGpuContractError('SPIRAL_BASE_GPU_UNAVAILABLE'"),'Strict Spiral base must report a Full-WebGPU contract error rather than fall back to Canvas/WebGL');
assert.ok(pipe.includes('prepareGpuMorphGraffitiFrame(frameCtx)')&&pipe.includes('prepareGpuMorphWebFrame(frameCtx)')&&pipe.includes('prepareGpuMorphLampFrame(frameCtx)'),'Graffiti/Web/Lamps providers must request GPU-native Spiral resources');
assert.ok((pipe.match(/if\(!plan\.table&&isStrictSpiralWebGPUFrame\(frameCtx\)\)/g)||[]).length>=2,'Motion and Sprite must wait for the Spiral GPU arc rather than fall back to CPU path tables');

assert.ok(sweep.includes('prepareGpuMorphArcLightningFrame')&&sweep.includes('getGpuMorphArcTableForFrame'),'Morph Lightning must use the shared GPU Bézier-derived arc');
assert.ok(sweep.includes('prepareSharedTopologySpectralBezier')&&sweep.includes('currentGpuBezierMorphResource'),'Spectral glint/preflash must read the shared cubic buffer directly');
assert.ok(sweep.includes('Spiral Layer-Scene-only sweep warmup'),'Strict Spiral Sweep/Lightning must stop before hidden-canvas direct rendering');
assert.ok(sweep.includes('materialization suppressed'),'Strict Spiral Sweep must not materialize the shared GPU scene to Canvas while a sweep pipeline warms');
assert.ok(pipe.includes('strictSpiralProfileGpu')&&pipe.includes('Spiral profile GPU-only warmup'),'Strict Spiral Profile/Graffiti must not tear down the GPU scene into Canvas on renderer warmup/failure');
assert.ok(web.includes('Spiral Web stays WebGPU-only')&&web.includes('No Canvas/WebGL fallback allowed for Spiral Web'),'Spiral Web must not use Canvas/WebGL fallback');
assert.ok(lamps.includes('currentGpuBezierMorphResource')&&lamps.includes('getGpuMorphArcTableForFrame'),'Spiral lamps must attach to the shared Bézier-derived GPU arc');
assert.ok(lampGpu.includes('sampleMorphArcSegment')&&lampGpu.includes('gpuLampArcSegmentIndex'),'Lamp renderer keeps exact segment attachment support for non-Spiral native plans');
assert.ok(spiral.includes('sourceRawKnotFractions')&&spiral.includes('targetRawKnotFractions'),'Spiral Morph resource must preserve authored endpoint knots separately from De Casteljau equalization splits');
assert.ok(lamps.includes('Key/Corners are retained-cubic BOUNDARIES')&&lamps.includes('gpuLampArcSegmentIndex=j*subdiv'),'Spiral key/corner lamps must bind exact retained cubic boundaries during morph instead of interpolating endpoint arc fractions');
assert.ok(graffiti.includes("lastReason='shared-retained-bezier-cubics'")&&graffiti.includes('spiral-gpu-only'),'Spiral Graffiti must prefer retained cubic GPU rendering and suppress CPU fallback');
assert.ok(graffiti.includes('every variation mode is GPU-native')&&!graffiti.includes('variation-${mode}-needs-compat-plan'),'Spiral Graffiti variation modes must never request a compatibility/Canvas carrier');
assert.ok(read('js/gpu/graffiti-morph-renderer.js').includes('5=across')&&read('js/gpu/graffiti-morph-renderer.js').includes('variationAux'),'GPU Graffiti must implement per-path/whole/per-segment/every-N/across variation over the Bézier-derived Arc');
assert.ok(particles.includes('encodeToLayerScene')&&particles.includes('Spiral Layer-Scene-only particles warmup'),'Spiral particles must stay in the shared GPU Layer Scene');
assert.ok((particles.match(/isStrictSpiralWebGPUFrame\(frameCtx\)/g)||[]).length>=2,'Spiral particle normal and exception paths must both block compatibility fallback across the whole Morph handoff');

assert.ok(particleGpu.includes('if(strictSpiral){stats.morphArcCpuTablesAvoided++;return null;}'),'Strict Spiral particles must wait for the Bézier-derived GPU arc instead of materializing a CPU polyline carrier');
assert.ok(pathFx.includes('Spiral Sprite waits for WebGPU; Canvas bridge disabled')&&pathFx.includes('Spiral Path FX waits for WebGPU; Canvas Sprite bridge disabled'),'Strict Spiral moving-line/sprite effects must never cross into Canvas presentation fallbacks');


assert.ok(particleGpu.includes('retainedCubics')&&particleGpu.includes('sampleRail(si,t)')&&particleGpu.includes('exactBezierArc:true'),'Spiral particles must use the retained cubic buffer for exact GPU positions after arc lookup, not interpolate micro-chords');
assert.ok(lampGpu.includes('retainedArcCubics')&&lampGpu.includes('retainedCubicPoint')&&lampGpu.includes('binding:5,resource:{buffer:arcRec.morphRec.cubicBuffer}'),'Spiral lamps must evaluate the retained cubic directly on GPU after arc-distance lookup');
assert.ok(read('js/gpu/web-morph-renderer.js').includes('retainedCubics')&&read('js/gpu/web-morph-renderer.js').includes('retainedCubicPoint(first+lo,t)'),'Spiral Web endpoints must be evaluated from the retained cubic GPU rail rather than interpolated chord endpoints');
assert.ok(read('js/gpu/canonical-sweep-renderer.js').includes('retainedCubics')&&read('js/gpu/canonical-sweep-renderer.js').includes('retainedPoint(si,t0)'),'Moving Spiral glint must resolve clipped GPU-arc windows back onto the retained cubic instead of clipping only the chord');
assert.ok(read('js/gpu/graffiti-sample-resource.js').includes('retainedCubics')&&read('js/gpu/graffiti-sample-resource.js').includes('return retainedPoint(first+lo,u)'),'Variational Spiral Graffiti must resolve GPU arc distances back onto retained cubics instead of returning chord-interpolated points');
assert.ok(read('js/gpu/lightning-arc-renderer.js').includes('retainedCubics')&&read('js/gpu/lightning-arc-renderer.js').includes('retainedPoint(si,0.0)')&&read('js/gpu/lightning-arc-renderer.js').includes('morph.cubicBuffer'),'Spiral/Topology Lightning must raster from the retained cubic carrier rather than a separate chord-only source');
assert.ok(spiral.includes('globalPhaseK')&&spiral.includes('shift=globalPhaseK*TWO_PI'),'Minimal Turn must use one equivalent global 2pi representative for the whole retained destination rail');
assert.ok(spiral.includes('No post-DP angle clamping is allowed')||spiral.includes('no per-handle wrap branch'),'Minimal Turn must preserve exact target cubic controls instead of clamping handle angles to non-equivalent values');
assert.ok(pipe.includes('strictViolation')&&(isV69||pipe.includes('iteration:26')||pipe.includes('iteration:31')||pipe.includes('iteration:32')||pipe.includes('iteration:33')||pipe.includes('iteration:34')||pipe.includes('iteration:35')||pipe.includes('iteration:36')||pipe.includes('iteration:37')||pipe.includes('iteration:38')||pipe.includes('iteration:39'))&&pipe.includes('contracts={'),'Runtime Spiral audit must expose per-effect GPU/Bézier contracts and strict violations');
assert.ok(pipe.includes('frameCtx.geometryPlan?.sourceLayer')&&pipe.includes('rec?.specialSpiralBezierRail===true&&rec?.gpuOnlySpiralEffects===true'),'Strict Spiral detection must cover Morph endpoints and the authoritative retained Spiral resource');
assert.ok(pipe.includes('Spiral Sprite GPU-only warmup; Canvas fallback forbidden')&&pipe.includes('Spiral Fill GPU-only warmup; Canvas fill forbidden')&&pipe.includes('Spiral outline GPU-only warmup; Canvas fallback forbidden'),'Strict Spiral must hard-block Sprite/Fill/Outline Canvas fallback');
assert.ok(sweep.includes("typeof isStrictSpiralWebGPUFrame==='function'")&&web.includes("typeof isStrictSpiralWebGPUFrame==='function'")&&particles.includes("typeof isStrictSpiralWebGPUFrame==='function'")&&pathFx.includes("typeof isStrictSpiralWebGPUFrame==='function'"),'Extracted Spiral effect passes must share one endpoint-aware strict contract');
assert.ok(spiral.includes('ONE integer 2π representative')&&spiral.includes('globalPhaseK'),'Minimal Turn must keep one wrap branch across the whole unwrapped cubic rail');


assert.ok(pipe.includes("if(isStrictSpiralWebGPUFrame(frameCtx)){renderBackendTelemetry.mark('lamps','gpu','Spiral lamps GPU-only warmup')")&&particleGpu.includes("typeof isStrictSpiralWebGPUFrame==='function'?isStrictSpiralWebGPUFrame(frameCtx)"),'Lamps and Particles must keep the endpoint-aware strict Spiral policy during polygon↔Spiral morph');
assert.ok(arc.includes("if(strictSpiral)return shared?.bezierVisualRail?'':'bezier-rail-unavailable'"),'Spiral GPU Arc eligibility must trust the authoritative retained rail instead of temporary polygon frame metadata');
assert.ok(lamps.includes('gpuLampArcSegmentIndex=logicalCount*subdiv-1')&&lamps.includes('boundary identity is exact'),'Spiral key/corner lamps should attach directly to exact retained-cubic boundaries when available, avoiding interpolated arc-fraction drift');
assert.ok(!spiral.includes('endpointTravelSlack'),'Minimal Turn must not distort endpoint geometry with non-2pi angular clamps');

assert.ok(arc.includes('cubicArcLength3')&&arc.includes('0.7745966692414834'),'Spiral GPU Arc distances must use cubic Gauss-3 integration rather than chord length');
assert.ok(arc.includes('effect-group prerequisite')&&arc.includes('encodeCurrentCubics(encoder,t)'),'Spiral Arc prerequisite must encode current cubics in its own command buffer instead of trusting Base-pass scheduling');
assert.ok(scheduler.includes('buildCurrentCubicsPrerequisite')&&scheduler.includes('currentCubicsCommittedFrameId'),'Direct retained-cubic Spiral effects need one explicit ordered custom GPU prerequisite');
assert.ok(appA.includes('maxDerivative=chord*3.0')&&appA.includes('maxAngularSpan=Math.PI/4'),'Static Spiral profile edits need compact cubic handle safety and bounded angular span');
assert.ok(state.includes('spiralRotationCompensation: false'),'Rotation compensation default must remain off');

assert.ok(spiral.includes('bezierSubdiv:12')&&arc.includes('bezierSubdiv:12'),'Spiral visual/effect Arc subdivision budget must use twelve GPU micro-intervals per retained cubic for smooth Lightning/Web placement');
assert.ok(read('js/gpu/bezier-sweep-renderer.js').includes('spiroGpuPrepareMorphForLayerScene(frameCtx,prepared.gpuMorphResource'),'Strict Spiral Bézier glint must share the ordered current-cubic prerequisite instead of recomputing a private Morph rail');
assert.ok(pipe.includes("arcMetric:'gauss3-cubic'")&&pipe.includes('orderedGpuPrerequisites:true')&&pipe.includes('!c.bezier'),'Runtime Spiral audit must fail strict mode if any named effect stops being Bézier-derived');
assert.ok(spiral.includes('out.__profileCorner0=a<=1e-8')&&spiral.includes('flags|=0x40000000')&&spiral.includes('flags|=0x80000000'),'Spiral Morph must preserve authored profile-corner flags through exact De Casteljau normalization and pack them for GPU Web classification');
assert.ok(arc.includes('q?.__profileCorner0===true')&&arc.includes('0x40000000')&&arc.includes('q?.__profileCorner1===true'),'Static Spiral GPU Arc metadata must preserve authored profile corners');
for(const rel of ['js/gpu/lamp-renderer.js','js/gpu/web-morph-renderer.js','js/gpu/particle-renderer.js','js/gpu/canonical-sweep-renderer.js','js/gpu/graffiti-sample-resource.js','js/gpu/lightning-arc-renderer.js'])assert.ok(read(rel).includes('arcCorrectMicroT')&&read(rel).includes('sqrt(disc)'),'Spiral distance consumer '+rel+' must invert local arc fraction back to retained Bézier t with the cheap closed-form speed model');
assert.ok((spiral.includes('pathCartesianFallback=minimal&&(pathMaxPolarTurn>Math.PI')||spiral.includes('pathCartesianFallback=forceCartesian||(minimal&&(pathMaxPolarTurn>Math.PI'))&&spiral.includes('safeSpiralMix')&&spiral.includes('metaData.z>0.5'),'Minimal Turn must choose the >180° safety fallback once per retained path so adjacent Béziers cannot disagree at shared knots');
assert.ok(pipe.includes("arcLocalInverse:'endpoint-speed-analytic'")&&pipe.includes('minimalTurnPathContinuousFallback:true')&&pipe.includes('authoredCornerFlags:true'),'Runtime audit must expose Iter10 arc inversion, minimal-turn safety and authored-corner contracts');
assert.ok(appA.includes("getConfiguredSplinePointCount()"),'Static Spiral profile geometry signature must include spline construction density so profile edits cannot leave a stale retained rail');

assert.ok(scheduler.includes('currentCubicsRootProducerFrameId')&&scheduler.includes('rootProducerReuses')&&scheduler.includes('gpuLayerSceneDeferred===true'),'Spiral effects must reuse the ordered root LayerScene current-cubic producer instead of dispatching duplicate compute');
assert.ok(spiral.includes('currentCubicsRootProducerFrameId')&&spiral.includes('currentCubicsRootProducerT'),'Spiral Base/Glow must publish its ordered shared-current-cubic producer token');
assert.ok(appA.includes("mix(layer.lineJoinType||'rounded')")&&appA.includes('mix(layer.spiralEnabled===true?1:0)'),'Static Spiral cache signature must cover profile construction switches beyond point coordinates');
assert.ok(pipe.includes('sharedCurrentCubicProducer:true'),'Runtime Spiral audit must expose shared current-cubic producer reuse');


// Iter12: hard residency / direct static cubic / exact lamp-boundary contracts.
assert(appA.includes('6.8 iter12 — compact mapped Hermite is a PER-SPAN property'), 'static Spiral must preserve mapped Hermite Bézier per span');
assert(arc.includes('static strict Spiral goes source profile -> retained cubics -> GPU directly'), 'static Spiral GPU resource must bypass compatibility point sampling');
assert(lamps.includes('Key/Corners are retained-cubic BOUNDARIES'), 'Spiral Morph lamps must bind exact retained cubic boundaries');
assert(pipe.includes('strict Spiral Layer Scene unavailable; no fallback'), 'strict Spiral Base must forbid GPU->Canvas scene presentation');
assert(pipe.includes('strict Spiral GPU-only warmup; Canvas presentation forbidden'), 'strict Spiral Glow must forbid Canvas presentation fallback');
assert(pipe.includes('strict Spiral outline waits for resident GPU scene; Canvas composite forbidden'), 'strict Spiral Outline must forbid Canvas composite');
assert(pipe.includes('strictNoGpuCanvasRoundTrip:true'), 'Spiral audit must expose no-GPU-Canvas-roundtrip contract');
assert(spiral.includes('near-origin control has an ill-conditioned large phase'), 'Minimal Turn must guard unstable near-origin polar phase');

assert(pipe.includes('!strictSpiralGlow&&canFuseMorphGlowBase')&&pipe.includes('!strictSpiralGpu&&!spiralBezierBase'), 'strict Spiral Base/Glow must never fall through to generic Green/Topology morph geometry');
assert(lamps.includes("lastReason='strict-spiral-retained-rail-wait'")&&lamps.includes('if(strictSpiral){gpuMorphLampBridgeStats.fallbacks++'), 'strict Spiral lamps must wait for the authoritative retained rail instead of using generic topology lamps');

assert(pipe.includes('strictSpiralBatch&&!nativeFillCandidate')&&pipe.includes('if(strictSpiralFill)return false'), 'strict Spiral fill must be native GPU mesh only and must not generate/upload a Canvas fill mask');
assert(pipe.includes('topologyNative=!strictSpiralBatch')&&pipe.includes('greenProjectNative=!strictSpiralBatch'), 'strict Spiral preparation must not select generic topology/green morph backends');


// Iter13 baseline graph contract (Iter22 removes the old optional-effect start gate), no CPU shadow graph, and visible-spin minimal-turn guard.
assert(read('js/render/render-graph.js').includes('strict Spiral is a GEOMETRY/BACKEND contract')&&read('js/render/render-graph.js').includes('graph.strictSpiralGpu=strictSpiral'), 'strict Spiral render graph must not derive CPU fallback demand from transient GPU readiness');
assert(appC.includes('strict Full-GPU gate')&&appC.includes('await ensureGpuMorphArcPipelines()')&&appC.includes('MORPH_WEB_FULL_GPU_PREWARM_FAILED'), 'special Spiral phase must gate on the authoritative GPU rail/Arc while Web prepares independently without owning the Morph clock');
assert(spiral.includes('const excessiveVisibleTurn=')&&spiral.includes('visibleTurnRms'), 'Minimal Turn must have a path-wide visible-spin guard in addition to the formal pi limit');
assert(pipe.includes('strictGraphNoCpuWarmup:true')&&pipe.includes('fullGpuPrewarmGatesMorphClock:true')&&pipe.includes('baseMorphClockIndependentOfOptionalEffectWarmup:true')&&pipe.includes('webNeverGatesMorphClock:true'), 'runtime Spiral audit must expose core Full-GPU gating with non-blocking optional Web preparation');
assert(pipe.includes('strict Spiral Full WebGPU presentation failed; no fallback'), 'strict Spiral final presentation failure must remain GPU-only');


// Iter14: strict graph/presentation cleanup and deterministic minimal-turn weighting.
const graph14=read('js/render/render-graph.js');
assert(graph14.includes("strictSpiral?'gpu-native-fill':'compat'"), 'strict Spiral native fill graph must not request a sampled CPU shadow path');
assert(pipe.includes('renderFrame.strictSpiralGpuPresentRequired=false')&&pipe.includes('if(isStrictSpiralWebGPUFrame(frameCtx)&&renderFrame)renderFrame.strictSpiralGpuPresentRequired=true')&&pipe.includes('perFrameStrictPresentationLatch:true'), 'strict Spiral GPU-only presentation latch must reset every frame and cover effects-only layers');
assert(spiral.includes('first determine ONE final radius scale')&&spiral.includes('coherentOuterTurn>Math.PI*.125')&&spiral.includes('outerMaxTurn>Math.PI*.24'), 'Minimal Turn must use deterministic path-wide radius weighting and a conservative visible outer-rail fallback');
assert(pipe.includes('staticBaseRetainedBezierWebGPU:true')&&pipe.includes('strictNativeFillNoCpuShadow:true')&&pipe.includes('unifiedSpiralGpuSubdiv:12'), 'runtime audit must expose the retained-Bézier strict graph and rev3 quality subdivision contract');
assert(appA.includes('const BEZIER_SUBDIVISIONS=12'), 'static Spiral retained Bézier raster budget must match the twelve-interval Morph/Arc GPU budget');


// Iter15: hard no-compat exception guard + Arc reuse of the ordered Base cubic producer.
const isolation=read('js/render/pass-isolation.js');
assert(isolation.includes('if(strictSpiral){')&&isolation.includes('strictFallbackBlocks++')&&isolation.includes('strictSessionDisableBlocks++'), 'strict Spiral pass exceptions must never invoke compatibility/Canvas retry or poison the backend into compatibility');
assert(arc.includes('reuseOrderedCurrentCubics')&&arc.includes('orderedCurrentCubicReuses++'), 'Spiral Arc must be able to consume the already ordered Base current-cubic buffer without recomputing it');
assert(scheduler.includes('rootProducerArcReuses')&&scheduler.includes('reuseOrderedCurrentCubics:true')&&scheduler.includes('currentCubicsRootProducerFrameId'), 'GPU scheduler must detect the exact Base cubic root producer before Arc preflight');
assert(spiral.includes('outerMaxTurn')&&spiral.includes('outerTurnRms')&&spiral.includes('pathMaxRadius*.28'), 'Minimal Turn must score the visible outer retained rail explicitly');
assert(pipe.includes('arcReusesOrderedBaseCubics:true')&&pipe.includes('strictExceptionFallbackBlocked:true'), 'runtime Spiral audit must expose Iter15 performance and no-compat exception contracts');


// Iter16: final presentation is also GPU-only; CPU shadow rails are forbidden in strict Morph;
// Minimal Turn path pairing is scored on the retained Bézier geometry that actually renders.
const framePaths16=read('js/geometry/frame-paths.js');
assert(appA.includes('function discardFrameScene(frameId)')&&appA.includes('function discardFrameUnderlay(frameId)'), 'strict Spiral needs non-Canvas discard paths for failed GPU presentation');
assert(pipe.includes('strict Spiral Full WebGPU presentation failed; no fallback')&&pipe.includes('discardFrameScene?.')&&pipe.includes('discardFrameUnderlay?.'), 'strict Spiral final compositor failure must never copy GPU scene through Canvas2D');
assert(framePaths16.includes('strictSpiralBlocks++')&&framePaths16.includes("noteMorphCpuPathDemand('spiral-gpu-only'"), 'strict Spiral Morph must block legacy CPU path materialisation');
assert(spiral.includes('minimalTurnRetainedBezierPairCost')&&spiral.includes('const srcMetrics=new Map(),dstMetrics=new Map()')&&spiral.includes('buildRailArcMap(cubics)')&&spiral.includes('pairMinimalTurnSpiralPaths(srcPaths,dstPaths,srcLayer,dstLayer)'), 'Minimal Turn pairing must score and cache retained Bézier rail metrics, not only source point lists');
assert(pipe.includes('strictFinalCanvasPresentationBlocked:true')&&pipe.includes('strictMorphCpuPathFirewall:true')&&pipe.includes('minimalTurnRetainedBezierPairing:true')&&pipe.includes('mixedBackendObserved'), 'runtime Spiral audit must expose Iter16 hard backend/geometry contracts');


// Iter17: strict Spiral line-profile parity joins the same retained Bézier GPU Arc; no CPU
// marker-centre shadow path and no hidden WebGPU-canvas -> Canvas2D bridge are permitted.
assert(html.includes('js/gpu/profile-arc-marker-renderer.js'), 'Iter17 profile Arc renderer must be loaded in the 6.8 build');
assert(graph.includes("strictSpiral?'gpu-marker-bezier-arc':'gpu-marker'")&&graph.includes('strictBezierArc:strictSpiral'), 'strict Spiral line profiles must request GPU Bézier Arc capability without CPU_PATH');
assert(pipe.includes('function prepareStrictSpiralGpuProfileFrame')&&pipe.includes('gpuArcNative:true')&&pipe.includes('retainedBezier:true'), 'strict Spiral profile preparation must remain scalar-only on CPU and attach to the shared GPU Arc');
assert(pipe.includes('WebGPUProfileArcMarkerRenderer.encodeToLayerScene')&&pipe.includes('retained Bézier GPU-Arc profile markers'), 'strict Spiral profile/core/glow/outline must encode directly into the resident Layer Scene');
assert(profileArc.includes('retainedProfileCubics')&&profileArc.includes('arcCorrectProfileMicroT')&&profileArc.includes('sampleGlobalArc'), 'profile markers must evaluate the retained cubic Bézier after GPU arc lookup');
assert(profileArc.includes('No CPU path materialisation')&&!profileArc.includes('drawImage(')&&!profileArc.includes("document.createElement('canvas')"), 'strict Spiral profile marker renderer must have no Canvas presentation or CPU marker-centre bridge');
assert(scheduler.includes("if(e.profile?.prepared?.gpuArcNative===true)addArc(e.profile.prepared.table)"), 'profile marker Arc prerequisite must participate in the shared GPU scheduler');
assert(appC.includes('WebGPUProfileArcMarkerRenderer?.warmup?.()')&&!appC.includes('WebGPUProfileArcMarkerRenderer?.isReady?.()===true'), 'Spiral phase must kick profile Arc-marker warmup without blocking morph motion on readiness');
assert(spiral.includes('coherentOuterTurn')&&spiral.includes('whole-rail rotation is perceptually much worse'), 'Minimal Turn must reject coherent visible whole-spiral rotation before it becomes a large spin');
assert(pipe.includes('strictProfileMarkersGpuArc:true')&&pipe.includes('strictProfileNoCpuShadow:true')&&pipe.includes('minimalTurnCoherentOuterTurnGuard:true'), 'runtime Spiral audit must expose Iter17 marker and Minimal Turn contracts');


// Iter18: Base visibility no longer waits for optional-effect compilation; strict Final is a
// texture-only GPU presentation and effects-only/profile Spiral owns a transparent GPU root.
assert(pipe.includes('function canDeferStrictSpiralLayerSceneRoot')&&pipe.includes('Base establishes the authoritative retained-Bézier GPU LayerScene first'), 'strict Spiral Base must establish the GPU scene independently of optional effect readiness');
assert(pipe.includes("canFuseMorphGlowBase=frameCtx.lineDisplayEnabled===true")&&pipe.includes('(strictSpiralGlow||frameCtx.effectsPlan?.web?.enabled!==true)'), 'strict Spiral Glow+Base must stay one root command even when Web is enabled');
assert(appA.includes('function beginExternalLayerScene(')&&pipe.includes("beginExternalLayerScene?.(frameCtx.frameId,'strict-spiral-effects')"), 'effects-only/Profile/Graffiti Spiral must get a transparent WebGPU LayerScene root instead of a Canvas carrier');
assert(appA.includes('const lateCanvasOverlay=Boolean(strictSpiral&&frame?.strictSpiralLateCanvasOverlay===true')&&appA.includes('renderBackendTelemetry.hasMaterialization?.()===true))return false')&&appA.includes('layerSource?(lateCanvasOverlay?2:1):0'), 'strict Spiral Final must require a GPU layer source, forbid GPU->Canvas materialization, and allow only the explicit last-layer Canvas overlay');
assert(appA.includes("catch(err){lastError=String(err?.message||err);updatePresentationCss(false);return false;}"), 'strict Spiral transient final errors must hide stale GPU presentation instead of preserving an old frame');
assert(pipe.includes('strict Spiral multi-layer seal failed; no fallback')&&pipe.includes('_strictSpiralGpuFrameIncomplete=true'), 'strict Spiral multi-layer seal failure must reject the Full-GPU frame instead of materializing through Canvas2D');
assert(pipe.includes('SPIRAL_GEOMETRY_CIRCLES_GPU_UNAVAILABLE'), 'strict Spiral geometry-circle parity must report missing GPU capability instead of materializing the LayerScene to Canvas');
assert(pipe.includes('strict Spiral frame materialization firewall')&&pipe.includes('frame.strictSpiralEntryIntent===true||frame.strictSpiralGpuPresentRequired===true||isStrictSpiralWebGPUFrame(frameCtx)')&&pipe.includes("renderFrame.strictSpiralGpuPresentRequired!==true) applyTunnelScreenEdgeFeather"), 'strict Spiral must centrally block deferred-scene materialization for the entire frame and late Canvas2D vignette rasterization');
assert(spiral.includes('const coherentSpinGuard=coherentOuterTurn>Math.PI*.125')&&spiral.includes('deformation problem rather than a rotation request'), 'Minimal Turn must apply the Iter18 22.5 degree coherent anti-spin guard');
assert(pipe.includes('strictBaseIndependentOfEffectReadiness:true')&&pipe.includes('strictEffectsOnlyGpuSceneRoot:true')&&pipe.includes('strictPresentationKeepsLastGpuFrame:false')&&pipe.includes('strictCentralMaterializationFirewall:true')&&pipe.includes('strictLateCanvasOverlayComposite:true')&&pipe.includes('strictLastLayerAvoidsGpuReadback:true')&&pipe.includes('strictLateCanvasVignetteBlocked:true')&&pipe.includes('minimalTurnCoherentGuardDegrees:22.5'), 'runtime Spiral audit must expose strict scene/presentation/late-overlay/anti-spin contracts');


// Iter19: entering Spiral may not blank the viewport during asynchronous WebGPU warmup, and
// a topology-less Spiral Fill toggle may never block the retained-Bezier Base carrier.
const kernel=read('js/geometry/kernel.js');
assert(kernel.includes('const fillHasRenderableTopology=spiralEndpoint?hasStaticFillTopology:true')&&kernel.includes('runtimeState?.morph?.renderTargetLayers?.[li]')&&kernel.includes('fillSuppressedNoTopology:fillConfigured&&!fillRequested'), 'Spiral Fill must be requested only when authoritative closed Fill topology actually exists');
assert(pipe.includes('function hasStrictSpiralPresentationIntent(')&&pipe.includes('strictSpiralPreservedPreviousCanvas=false')&&pipe.includes('mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height)'), 'Spiral entry must clear stale pixels and expose Full-GPU readiness failures instead of preserving the previous frame');
assert(pipe.includes('strict Spiral retained-Bezier Base preserved while Fill unavailable')&&pipe.includes('strictSpiralFillDeferred=true'), 'even a future unsupported strict Spiral Fill must fail open for Base visibility and remain GPU-only');
assert(appC.includes('if(contourModeIsSpiral(btn.dataset.contourMode))')&&appC.includes('WebGPUStrokeRenderer?.warmup?.()')&&appC.includes('WebGPUFinalCompositeRenderer?.warmup?.()'), 'Spiral mode selection must prewarm Base and Final WebGPU pipelines at the user gesture');
assert(pipe.includes('strictTopologylessFillCannotBlockBase:true')&&pipe.includes('strictEntryPreservesPreviousFrame:false')&&pipe.includes('strictEntryPrewarmsGpu:true'), 'runtime Spiral audit must expose strict entry/prewarm contracts');

// Iter21 regression containment remains in Iter22: start from Iter19 and keep fixes narrow.
const renderRuntime21=read('js/core/render-runtime.js');
assert.ok(renderRuntime21.includes('f._strictSpiralGpuFrameIncomplete=false'), 'strict Spiral incomplete latch must reset every frame');
assert.ok(!pipe.includes('_strictSpiralMissingBase'), 'Iter20 frame-wide missing-Base latch/abort must not exist in Iter22');
assert.ok(pipe.includes('|| specialSpiralExtraGeometry'), 'Blue Morph widening must be limited to detected Spiral extra-geometry phases');
assert.ok(!pipe.includes('provider.geometryActive && provider.circleAngular && effectiveCircleMode) {'), 'Iter20 global circle-angular reroute must stay rolled back');
assert.ok(pipe.includes("strict Spiral waits for committed Base; outline-only frame suppressed"), 'strict Spiral must suppress outline-only frames without aborting the rest of the frame');
assert.ok(pipe.includes('strictSpiralCorridor?canDeferStrictSpiralLayerSceneRoot'), 'strict Spiral Corridor must open its GPU carrier independently of optional-effect readiness');
assert.ok(pipe.includes("&& !strictSpiralCorridor") || pipe.includes('&&!strictSpiralCorridor'), 'non-Spiral Corridor color/effect fallback policy must remain unchanged');
assert.ok(pipe.includes('noFrameWideMissingBaseAbort:true')&&pipe.includes('iter21RollbackBaseline:true'), 'runtime audit must expose Iter21 regression-containment contracts');


// Iter22: static strict-Spiral offscreen viewport + non-blocking optional Morph warmup.
assert.ok(appA.includes('const viewportW=Math.max(1,Number(mainCanvas?.width)||Number(layerBatchWidth)||Number(width)||1)')&&appA.includes('const viewportH=Math.max(1,Number(mainCanvas?.height)||Number(layerBatchHeight)||Number(height)||1)'), 'offscreen WebGPU stroke/Bézier uniforms must use the real main/LayerScene viewport, never a zero-sized legacy hidden canvas');
assert.ok(appA.includes('A zero viewport made valid')&&appA.includes('retained Bézier cubics disappear'), 'Iter22 static Spiral viewport regression must stay documented next to the shader uniform fix');
assert.ok(!appC.includes('const waitReady=async(kick,check,timeoutMs=1800)')&&!appC.includes('waitReady(()=>WebGPUBezierSweepRenderer'), 'Spiral morph start must not poll/wait for optional GPU effect renderers');
assert.ok(appC.includes('strict Full-GPU gate')&&appC.includes('buildGpuWebCornerResource(arc)')&&appC.includes('Web is a FullGPU consumer, but it is NOT a clock gate'), 'exact Arc must gate the authoritative rail while Web resources attach asynchronously without stopping visible Morph time');
assert.ok(!appC.includes('table.gpuMorphT=0;try{ensureGpuMorphArcTableSubmitted?.(table)'),'late optional-effect warmup must not submit a stale t=0 Arc after the morph clock has started');
assert.ok(pipe.includes('fullGpuPrewarmGatesMorphClock:true')&&pipe.includes('baseMorphClockIndependentOfOptionalEffectWarmup:true')&&pipe.includes('webNeverGatesMorphClock:true')&&pipe.includes('iter22OffscreenViewportFix:true'), 'runtime audit must expose strict core Full-GPU phase gating without Web clock ownership');


assert.ok(pipe.includes('canDeferStrictSpiralLayerSceneRoot(frameCtx,batch,false)')&&pipe.includes('if(requiresExternal&&WebGPUStrokeRenderer.canUseExternalLayerScene?.(id)!==true)'), 'Static strict Spiral internal LayerScene deferral must not depend on the external-scene writer gate');
assert.ok(pipe.includes('window.__somataReport=')&&pipe.includes('window.__somataRenderNow=')&&pipe.includes('somataSpiralSceneDiag'), 'Iter23 must expose compact console diagnostics for static Spiral presentation failures');
const schedulerCore=read('js/core/scheduler.js');
assert.ok(schedulerCore.includes('watchdogRecoveries')&&schedulerCore.includes('Somata scheduler watchdog recovery failed')&&schedulerCore.includes('lastInvalidateAt'), 'Event-driven UI invalidation must have a dormant scheduler watchdog instead of depending on Randomize/direct paint');

// Iter24: Corridor marker must be visible to both static and dynamic master builders.
const outerMarkerNeedle="Somata 6.8 Iter24 — Corridor master marker must live in the same outer scope";
assert.ok(appA.includes(outerMarkerNeedle), 'Iter24 must expose the Corridor seam marker in outer app scope');
assert.ok(appA.indexOf(outerMarkerNeedle)<appA.indexOf('function getTunnelMasterStrokeCommands(frameCtx,allowHiddenGraffitiCarrier=false)'), 'Corridor marker must be declared before the static master builder that calls it');
assert.ok(appA.includes('window.__spiroCorridorScopeProbe=')&&appA.includes('markerVisible:typeof markSpiralCorridorMaster'), 'Iter24 must expose a zero-side-effect scope probe for Corridor/Morph diagnostics');
assert.ok(appA.includes('function tunnelMasterStrokeSignature(frameCtx,allowHiddenGraffitiCarrier=false)')&&appA.includes('(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)'), '7.0.6 static Spiral Corridor must permit only the explicitly-authorized hidden Graffiti carrier');
assert.ok(pipe.includes('Graffiti hides Base and now defers its contour Glow')&&pipe.includes('base-intentionally-suppressed-by-graffiti')&&pipe.includes("beginExternalLayerScene?.(frameCtx.frameId,'strict-spiral-effects')"), 'Graffiti must receive a transparent FullGPU scene root while ordinary Base remains intentionally hidden');
assert.ok(spiral.includes("const hiddenGraffitiGlow=mode==='glow'")&&spiral.includes("frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiGlow"), '7.0.6 retained Spiral Morph must allow hidden-carrier Glow without enabling Base');
assert.ok(pipe.includes('canUseGpuOnlyCorridorLayerScene(frameCtx,hiddenGraffitiCarrier)')&&pipe.includes('canUseGpuSpiralBezierLayerScene(frameCtx,hiddenGraffitiCarrier&&frameCtx.morphFrameActive===true)'), '7.0.6 multi-layer join guard must keep Graffiti+Spiral on the resident FullGPU scene');

// Iter25: strict Spiral must recover from a transient first-frame WebGPU init failure and
// internal retained-Bézier Base publication must not depend on Final pipeline readiness.
assert.ok(appA.includes('Somata 6.8 Iter25 — WebGPU init is normally kicked during the very first Canvas')&&appA.includes('return{acquire,warmup,retry,isReady:'), 'DeviceHub must expose an explicit user-gesture retry instead of a permanent attempted latch');
assert.ok(appA.includes('function retry(){if(ready&&!lost)return true;if(initializing)return false;attempted=false;lost=false;retryCount++;void initAsync();return false;}'), 'Stroke/Final renderers must expose explicit retry from a failed one-shot init');
assert.ok(appC.includes('WebGPUDeviceHub?.retry?.()')&&appC.includes('WebGPUStrokeRenderer?.retry?.()')&&appC.includes('WebGPUFinalCompositeRenderer?.retry?.()'), 'selecting Spiral must retry the strict GPU presentation stack before warmup');
assert.ok(pipe.includes('if(requiresExternal&&WebGPUFinalCompositeRenderer.canDeferLayerScene')&&pipe.includes("requiresExternal?'ready':'internal-gpu-scene-ready'"), 'internal static Spiral LayerScene publication must not wait on Final compositor readiness; external writers keep the gate');
assert.ok(pipe.includes('window.__somataSpiralTrace=')&&(pipe.includes("version:'6.8-Iter25'")||pipe.includes("version:'6.8-Iter26'")||pipe.includes("version:'6.8-Iter27'")||pipe.includes("version:'6.8-Iter28'")||pipe.includes("version:'6.8-Iter29'")||pipe.includes("version:'6.8-Iter30'")||pipe.includes("version:'6.8-Iter31'")||pipe.includes("version:'6.8-Iter32'")||pipe.includes("version:'6.8-Iter33'")||pipe.includes("version:'6.8-Iter34'")||pipe.includes("version:'6.8-Iter35'")||pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69)), 'Iter25 must expose one compact Spiral state/geometry/GPU trace for runtime diagnosis');
assert.ok(!pipe.includes('_strictSpiralMissingBase'), 'Iter25 must not reintroduce the Iter20 frame-wide Spiral freeze latch');



// Iter29: retained Spiral Bézier buffers must grow only when required capacity grows.
// The Iter28 expression `Number(rec.capacity)||0<packed.cubicCount` treated every non-zero
// capacity as true, causing 1.6x reallocation on every Corridor repack until ArrayBuffer OOM.
assert.ok(appA.includes('const currentCapacity=Math.max(0,Number(rec?.capacity)||0);')&&appA.includes('currentCapacity<packed.cubicCount'), 'Iter29 must compare retained Bézier capacity numerically before growing');
assert.ok(!appA.includes('Number(rec.capacity)||0<packed.cubicCount'), 'Iter29 must remove the precedence-broken runaway Bézier capacity condition');
assert.ok(appA.includes('markPersistentStrokeCommands(rec.commands,sig.geometryVersion,sig.spiralProfileSignature);')&&appA.includes('Static Corridor master geometry is immutable'), 'Iter29 static Corridor master must retain one packed Bézier GPU rail across display frames');
assert.ok(appA.includes('function releaseBezierGeometryRecord(commands)')&&appA.includes('let released=releaseBezierGeometryRecord(commands)')&&appA.includes("const br=bezierGeometryCache.get(commands);if(br){br.frameId=-1"), 'Iter29 must release abandoned static Bézier records and reuse mutable recorder allocations instead of orphaning them');
assert.ok(appA.includes('window.__spiroBezierBufferProbe=')&&appA.includes('capacityPeakCubics')&&appA.includes('oversizeRejects'), 'Iter29 must expose retained Bézier allocation telemetry');
assert.ok(pipe.includes('iter29BezierCapacityComparisonFixed:true')&&pipe.includes('iter29PersistentCorridorBezierRail:true')&&pipe.includes('iter29BezierReleaseAndMutableReuse:true'), 'runtime audit must expose Iter29 retained-buffer contracts');

// Iter30: asynchronous strict-Spiral GPU readiness must schedule the frame that consumes it.
assert.ok(spiral.includes('Iter30 — async readiness is itself a render invalidation')&&spiral.includes('requestMainCanvasRender?.();'), 'Iter30 dedicated Spiral Bézier pipeline completion must invalidate presentation');
assert.ok(arc.includes('Iter30 — strict Spiral effects/profile may deliberately render nothing while Arc')&&arc.includes('requestMainCanvasRender?.();'), 'Iter30 GPU Arc pipeline completion must wake strict Spiral effects/profile');
assert.ok(profileArc.includes('Iter30 — a line profile replaces the Base carrier')&&profileArc.includes('requestMainCanvasRender?.();')&&profileArc.includes('window.__spiroProfileArcMarkerStatus='), 'Iter30 Profile Arc readiness must repaint and expose diagnostics');
assert.ok(appC.includes('Iter30 — profile/effect Spiral paths are just as authoritative as Base')&&appC.includes('warmupGpuMorphArcResource?.()')&&appC.includes('WebGPUProfileArcMarkerRenderer?.warmup?.()'), 'Iter30 Spiral gesture must prewarm Arc/profile pipelines without blocking');
assert.ok(pipe.includes('iter30GpuReadinessRepaint:true')&&pipe.includes('iter30SpiralGestureArcPrewarm:true')&&(pipe.includes("version:'6.8-Iter30'")||pipe.includes("version:'6.8-Iter31'")||pipe.includes("version:'6.8-Iter32'")||pipe.includes("version:'6.8-Iter33'")||pipe.includes("version:'6.8-Iter34'")||pipe.includes("version:'6.8-Iter35'")||pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69)), 'Iter30 runtime audit/trace must expose readiness handoff');


// Iter31: Dawn/Chromium WGSL reserves meta/target/active. A single occurrence in a shader
// declaration/member/reference can make the entire strict Spiral stack fail validation and
// prevent Final from initializing. Scan every likely WGSL template block, not just the three
// modules that happened to fail first in the reported trace.
function likelyWgslTemplateBlocks(source){
    const out=[];let i=0;
    while(i<source.length){const a=source.indexOf('`',i);if(a<0)break;let b=a+1;for(;b<source.length;b++){if(source[b]==='`'&&source[b-1]!=='\\')break;}if(b>=source.length)break;const block=source.slice(a+1,b);if(block.includes('@group')||block.includes('@vertex')||block.includes('@fragment')||block.includes('@compute')||block.includes('var<'))out.push(block);i=b+1;}return out;
}
const wgslForbidden=/\b(?:meta|target|active)\b/;
for(const name of fs.readdirSync(path.join(root,'js/gpu')).filter(n=>n.endsWith('.js'))){
    const source=read(`js/gpu/${name}`);
    for(const block of likelyWgslTemplateBlocks(source)){
        const code=block.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
        assert.ok(!wgslForbidden.test(code),`Iter31 ${name} WGSL must not use Dawn-reserved identifiers meta/target/active`);
    }
}
assert.ok(pipe.includes('iter31WgslReservedIdentifiersPurged:true')&&(pipe.includes("version:'6.8-Iter31'")||pipe.includes("version:'6.8-Iter32'")||pipe.includes("version:'6.8-Iter33'")||pipe.includes("version:'6.8-Iter34'")||pipe.includes("version:'6.8-Iter35'")||pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69)), 'Iter31 runtime audit/trace must identify the WGSL reserved-identifier recovery build');



// Iter32: profile presets must preserve the independently-authored Spiral closure mode,
// and Open Spiral must have the same finite/non-collapsed geometry guard without adding
// an auto-close bridge. Corridor/Morph renderer code is intentionally untouched.
const profilesUi=read('js/ui/profile-presets.js');
assert.ok(appC.includes('function applyProfilePresetGeometryToLayer(layer, presetKey)')&&appC.includes('const keepSpiralMode = contourModeIsSpiral(contourModeBefore);')&&appC.includes('layer.spiralClosed = spiralClosedBefore;'), 'Iter32 profile preset application must preserve spiral-closed/spiral-open instead of comparing against impossible literal spiral mode');
assert.ok(!appC.includes("const keepSpiralMode = getContourMode(layer) === 'spiral';"), 'Iter32 must remove the always-false legacy Spiral preset predicate');
assert.ok(profilesUi.includes("if (!isSpiralLayer(layer) && typeof meta?.closed === 'boolean'"), 'Iter32 preset matching must ignore ordinary closedLoop metadata while a Spiral owns closure independently');
assert.ok(appA.includes('let rawVisibleSpiralPts=spiralClosed?profileRoundedPts:mappedSpiralPts;')&&appA.includes('pts=repairSpiralEdgePoints(pts,rawVisibleSpiralPts,P,i,R,spiralOrder,spiralTangential,spiralStep,N,spiralClosed);'), 'Iter32 static Open Spiral must retain an unrounded fallback and run the finite/non-collapsed integrity guard');
assert.ok(arc.includes('window.__spiroStaticSpiralBezierStatus=')&&pipe.includes('staticBezier:window.__spiroStaticSpiralBezierStatus?.()'), 'Iter32 trace must expose the static retained Spiral rail directly');
assert.ok(appC.includes('window.__spiroSpiralProfileModeProbe=')&&pipe.includes('iter32ProfilePresetPreservesSpiralMode:true')&&pipe.includes('iter32OpenSpiralIntegrityGuard:true')&&(pipe.includes("version:'6.8-Iter32'")||pipe.includes("version:'6.8-Iter33'")||pipe.includes("version:'6.8-Iter34'")||pipe.includes("version:'6.8-Iter35'")||pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69)), 'Iter32 must expose profile/open-Spiral regression diagnostics');
assert.ok(appC.includes("changed.some(path=>path==='profileMode'||path==='profileNodes')")&&appC.includes("['spiralEnabled','spiralClosed','spiralOrder','closedLoop']"), 'Iter32 live Morph profile edits must preserve the authored Spiral contour mode across rebase');


// Iter35: exact geometry-time profile carrier + the three runtime WGSL/vertex-layout validation fixes.
assert.ok(appA.includes('_spiroRetainedCubics')&&appA.includes('spiralRetainedProfileCarrier')&&appA.includes('_bezierSegments:retainedCubics'), 'Iter35 Spiral profile paths must freeze one authoritative retained cubic carrier at geometry-build time');
assert.ok(arc.includes("Array.isArray(path?._bezierSegments)")&&spiral.includes("Array.isArray(path?._bezierSegments)"), 'Iter35 static Arc/Base and Morph endpoints must consume the path-owned carrier before rebuilding');
const webMorph35=fs.readFileSync(path.join(root,'js/gpu/web-morph-renderer.js'),'utf8');
const particle35=fs.readFileSync(path.join(root,'js/gpu/particle-renderer.js'),'utf8');
const webThreads35=fs.readFileSync(path.join(root,'js/gpu/web-thread-scene-renderer.js'),'utf8');
assert.ok(webMorph35.includes('x=x^((b+1u)*19349663u)')&&!webMorph35.includes('*73856093u^(b+1u)*'), 'Iter35 Web Morph hash must not mix multiply/XOR without WGSL parentheses');
assert.ok(particle35.includes('var p=vec2<f32>(u.v[1].x*lp.x')&&!particle35.includes('let p=vec2<f32>(u.v[1].x*lp.x'), 'Iter35 particle position must be mutable WGSL var');
assert.ok(webThreads35.includes('struct CorridorVin{ @location(0) corner:vec2<f32>')&&webThreads35.includes('vsCorridor(v:CorridorVin'), 'Iter35 Corridor Web Threads vertex interface must declare only location 0 when only the corner buffer is bound');
assert.ok(appC.includes('retainedCarrierPaths')&&appC.includes('allPathsRetained'), 'Iter35 carrier probe must validate the actual frozen GPU carrier, not a reconstructed point path');
assert.ok((pipe.includes("version:'6.8-Iter35'")||pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69))&&pipe.includes('iter35FrozenProfileCarrier:true')&&pipe.includes('iter35WgslValidationFixes:true'), 'Iter35 runtime audit/trace must expose the frozen-carrier/WGSL validation recovery');

// Iter36: static Spiral uses the same retained-cubic internal WebGPU LayerScene batch as the
// proven Corridor path. The dedicated Spiral renderer is reserved for active Morph frames.
assert.ok(pipe.includes("const spiralBezierNative=frameCtx.morphFrameActive===true&&typeof WebGPUSpiralBezierMorphRenderer"), 'Iter36 static Spiral batch preparation must not be bypassed by the dedicated Morph renderer');
assert.ok(pipe.includes("if(frameCtx.morphFrameActive===true&&!forceCanvasBase&&!forceCompatibility&&typeof WebGPUSpiralBezierMorphRenderer"), 'Iter36 static Base fallback must not re-enter the dedicated Morph renderer');
assert.ok(pipe.includes("static Spiral retained-Bézier Layer Scene"), 'Iter36 static Glow must stay inside the combined retained-cubic LayerScene batch');
assert.ok(pipe.includes("const spiralBezierGpuNative=frameCtx.morphFrameActive===true&&typeof WebGPUSpiralBezierMorphRenderer"), 'Iter36 static vector preparation must not be suppressed merely because the Morph renderer is statically eligible');
assert.ok(pipe.includes('iter36StaticSpiralInternalBezierBatch:true')&&pipe.includes('iter36DedicatedBezierReservedForMorph:true')&&(pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69)), 'Iter36 runtime audit must expose the unified static Spiral raster policy');

// Iter39: fix the actual collapsed-Spiral regression and keep Polygon's authored spline
// contract generalized through the nonlinear Spiral map.
assert.ok(appA.includes('function buildPolygonProfileSplineSamplesForSpiral('), 'Iter39 Smooth Spiral must build the same authored centripetal profile cubics as Polygon before nonlinear mapping');
assert.ok(appA.includes('directionOverride!==null&&directionOverride!==undefined')&&appA.includes('exponentOverride!==null&&exponentOverride!==undefined'), 'Iter39 optional Spiral overrides must not coerce null to numeric zero');
assert.ok(appA.includes("p0.__spiralProfileSourceCubic=hasProfileCubic")&&appA.includes("spiralPolygonProfileSplineCarrier:spiralProfileData?.polygonProfileSplineCarrier===true"), 'Iter39 retained carrier must prove that mapped cubics came from the Polygon profile spline');
assert.ok(appC.includes('window.__spiroSpiralTransformProbe=')&&appC.includes('segmentV:inspect')&&appC.includes('smoothBacktrack:inspect'), 'Iter39 diagnostics must reproduce the N=4/45-degree short-bar failure and arbitrary backtracking spline case');
assert.ok(appA.includes('const spiralStorageBuffersNeeded=9')&&appA.includes('adapter.limits?.maxStorageBuffersPerShaderStage')&&appA.includes('{maxStorageBuffersPerShaderStage:requestedStorageBuffersPerShaderStage}'), 'Iter39 must retain WebGPU ninth-storage-buffer negotiation');
assert.ok((isV69||(pipe.includes('iteration:39')&&(pipe.includes("version:'6.8-Iter39'")||pipe.includes("version:'6.8-Iter40'"))))&&pipe.includes('iter39NullOverrideSpiralTransform:true')&&pipe.includes('iter39PolygonProfileBezierGeneralization:true')&&pipe.includes('iter38StorageBufferLimitNegotiation:true'), 'Iter39 runtime audit must expose the Spiral-transform fix, spline carrier, and WebGPU-limit negotiation');


// Iter26: visible static Spiral Base must use the retained-cubic dedicated GPU renderer, not legacy batch presentation.
assert.ok(spiral.includes('function getStaticVisualResource(frameCtx)')&&spiral.includes("rec.staticVisual!==true&&!encodeEffectCubics"), 'Iter26 static Spiral must reuse its existing current-cubic GPU buffer without Morph compute');
assert.ok(spiral.includes("return'static-corridor-owned'")&&spiral.includes("getStaticSpiralBezierResource(frameCtx.layerIndex,device,generation)"), 'Iter26 must preserve the proven Corridor path while routing ordinary static Spiral to the retained Bézier rasterizer');
assert.ok(pipe.includes("frameCtx.geometryPlan?.kind!=='blue-circle-slide'&&!staticSpiral"), 'Iter26 Layer/Frame scene eligibility must accept ordinary static Spiral');

assert.ok(arc.includes('function getStaticSpiralBezierResource(layerIndex,sharedDevice=null,sharedGeneration=-1)')&&arc.includes('if(!gpuMorphArcRuntime.device)return null;'), 'Iter26 static Base rail must depend on the shared WebGPU device, not Arc compute-pipeline readiness');
assert.ok(arc.includes('cpuCubicWidthScales')&&spiral.includes('source.cpuCubicWidthScales'), 'Iter26 static retained Bézier visual must preserve authored variable-width taper');
assert.ok(pipe.includes("spiroIsCompatibilityForced('geometry')&&!isStrictSpiralWebGPUFrame(frameCtx)"), 'ordinary compatibility state must not disable strict Spiral dedicated GPU scene eligibility');


// Iter27: a live Blue Morph may never roll a just-authored sidebar edit back to the stale frame.
assert.ok(appC.includes('const morphSidebarRebaseRuntime={active:false,queued:false,pending:false')&&appC.includes('fromSidebarTransaction!==true'), 'Iter27 must defer legacy rebase calls while a sidebar authored transaction is still committing');
assert.ok(appC.includes('collectMasterChangedPaths(tx.before||{},after)')&&appC.includes('activeRebaseMorphing({preservePaths:changed,fromSidebarTransaction:true})'), 'Iter27 sidebar transaction must discover the values actually authored by the UI and pass them to the rebase');
assert.ok(appC.includes('commitCurrentBlueVisualToCanonical();')&&appC.includes('for(const [path,value] of rec.values)applyMasterPath'), 'Iter27 rebase must preserve current-frame continuity first, then restore only the authored paths before preparing the next Morph cycle');
assert.ok(pipe.includes('uiMode')&&pipe.includes('frameMode')&&(pipe.includes("version:'6.8-Iter27'")||pipe.includes("version:'6.8-Iter28'")||pipe.includes("version:'6.8-Iter29'")||pipe.includes("version:'6.8-Iter30'")||pipe.includes("version:'6.8-Iter31'")||pipe.includes("version:'6.8-Iter32'")||pipe.includes("version:'6.8-Iter33'")||pipe.includes("version:'6.8-Iter34'")||pipe.includes("version:'6.8-Iter35'")||pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69)), 'Iter27 Spiral trace must expose UI/canonical/live-Morph mode divergence directly');


// Iter28: outer Corridor builders may never touch WebGPUStrokeRenderer closure-private counters.
const outerCorridorRegion=appA.slice(appA.indexOf('const spiralCorridorMasterScopeStats={builds:0,hits:0}'), appA.indexOf('function getFrameGLStrokeCommands(frameCtx)'));
assert.ok(outerCorridorRegion.includes('const spiralCorridorMasterScopeStats={builds:0,hits:0}')&&outerCorridorRegion.includes('spiralCorridorMasterScopeStats.builds++')&&outerCorridorRegion.includes('spiralCorridorMasterScopeStats.hits++'), 'Iter28 outer Corridor master telemetry must use outer-scope counters');
assert.ok(!outerCorridorRegion.includes('corridorSpiralMasterBuilds++')&&!outerCorridorRegion.includes('corridorSpiralMasterHits++'), 'Iter28 outer Corridor builders must not reference renderer-private corridor counters');
assert.ok(appC.includes("animationScheduler.remove('morph');")&&appC.includes("animationScheduler.remove('morph-arm');")&&appC.includes('runtimeState.morph.gpuPhasePrepareSerial=(Math.max(0,Number(runtimeState.morph.gpuPhasePrepareSerial)||0)+1)>>>0;'), 'Iter28 Stop must synchronously detach morph scheduling and invalidate pending GPU phase preparation');
assert.ok(appC.includes('window.__spiroMorphStopProbe=')&&spiral.includes('compile the dedicated retained-Bézier raster pipeline before the first Spiral'), 'Iter28 must expose Stop diagnostics and idle-prewarm the Bézier raster pipeline');
assert.ok(pipe.includes('iter28CorridorOuterScopeStats:true')&&pipe.includes('iter28DeterministicMorphStop:true')&&pipe.includes('iter28IdleBezierPipelineWarmup:true'), 'runtime audit must expose Iter28 contracts');

// Iter33: profile-space spline mapping + WebGPU validation fixes.
const canonicalSweep=read('js/gpu/canonical-sweep-renderer.js');
const lightningArc=read('js/gpu/lightning-arc-renderer.js');
assert.ok(arc.includes('var q=segments[o];')&&!arc.includes('let q=segments[o];'), 'Iter33 Morph Arc finalize must mutate a WGSL var, never immutable let');
for(const [name,source] of [['legacy/app-a.js',appA],['gpu/lightning-arc-renderer.js',lightningArc],['gpu/canonical-sweep-renderer.js',canonicalSweep]]){
    assert.ok(!/createPipelineLayout\(\{bindGroupLayouts:\[[^\]]*getBindGroupLayout/.test(source),`Iter33 ${name} must not build a PipelineLayout from an auto-layout pipeline BGL`);
}
assert.ok(appA.includes('const profileSpaceSplineAlreadySampled = spiralEnabled && smoothSplineMode && splineSnapshotAlreadySampled;')&&appA.includes('profileSpaceSplineBaked:true'), 'Pre-sampled Morph spline snapshots must remain explicitly protected from double-splining');
assert.ok(appA.includes('polygonProfileSplineCarrier:true')&&appA.includes('spiralProfileSpaceSplineBaked:spiralProfileData?.profileSpaceSplineBaked===true'), 'Iter39 authored Smooth Spirals must use the Polygon profile-space cubic carrier while retaining snapshot provenance on the rail');
assert.ok(appC.includes('window.__spiroSpiralProfileRailProbe=')&&appC.includes("closedSpline:run('spiral-closed','sine')")&&appC.includes("openSpline:run('spiral-open','sine')"), 'Iter33 must expose a profile-rail probe for both closed/open Smooth Spiral paths');
assert.ok((isV69||pipe.includes('iteration:33')||pipe.includes('iteration:34')||pipe.includes('iteration:35')||pipe.includes('iteration:36')||pipe.includes('iteration:37')||pipe.includes('iteration:38')||pipe.includes('iteration:39'))&&(pipe.includes("version:'6.8-Iter33'")||pipe.includes("version:'6.8-Iter34'")||pipe.includes("version:'6.8-Iter35'")||pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69))&&pipe.includes('iter33ProfileSpaceSplineBeforeSpiralMap:true')&&pipe.includes('iter33ExplicitGpuCompositeLayouts:true')&&pipe.includes('iter33MorphArcMutableFinalize:true'), 'Iter33 runtime audit/trace contract must remain visible in later iterations');


// Iter34: final-space mapped profile cubics + valid copyExternalImage destination usage.
assert.ok(appA.includes('__spiralBezierC1X')&&appA.includes('__spiralBezierC2X')&&appA.includes('_spiroMappedControlSpans'), 'Iter34 profile map must retain direct cubic controls and the retained builder must consume them');
assert.ok(appC.includes('window.__spiroSpiralProfileCarrierProbe=')&&appC.includes("closedSegments:run('spiral-closed','pulse')")&&appC.includes("openSegments:run('spiral-open','op_chevron')"), 'Iter34 must expose a stronger mapped-control profile carrier probe');
const externalCopies=[...appA.matchAll(/copyExternalImageToTexture\(/g)].length;
assert.ok(externalCopies>=6, 'Iter34 test expects all legacy external-image copy sites to remain visible for validation');
for(const label of ['SpiroStar fill mask','SpiroStar final scene input','SpiroStar final background','SpiroStar layer scene fill mask','SpiroStar resident static Fill mask','SpiroStar Graffiti worker bitmap']){
    const i=appA.indexOf(label);assert.ok(i>=0,`Iter34 missing texture ${label}`);const near=appA.slice(i,i+360);assert.ok(near.includes('GPUTextureUsage.COPY_DST')&&near.includes('GPUTextureUsage.RENDER_ATTACHMENT'),`Iter34 ${label} must include COPY_DST + RENDER_ATTACHMENT for copyExternalImageToTexture`);
}
assert.ok((isV69||pipe.includes('iteration:34')||pipe.includes('iteration:35')||pipe.includes('iteration:36')||pipe.includes('iteration:37')||pipe.includes('iteration:38')||pipe.includes('iteration:39'))&&(pipe.includes("version:'6.8-Iter34'")||pipe.includes("version:'6.8-Iter35'")||pipe.includes("version:'6.8-Iter36'")||pipe.includes("version:'6.8-Iter37'")||pipe.includes("version:'6.8-Iter38'")||pipe.includes("version:'6.8-Iter39'")||(pipe.includes("version:'6.8-Iter40'")||isV69))&&pipe.includes('iter34MappedProfileControls:true')&&pipe.includes('iter34ExternalImageTextureUsage:true'), 'Iter34 runtime audit/trace must expose profile-carrier and texture-usage fixes');


// Somata 6.9: Morph stroke coverage, Glow, and periodic closure stay on the retained cubic rail.
assert.ok(spiral.includes("pipelineMax=makePipeline('MAX union',blendMax)")&&spiral.includes("operation:'max'")&&spiral.includes('copyPackedMultiColor'), '6.9 Morph must union same-style Bézier micro-capsules with MAX coverage instead of source-over bead accumulation');
assert.ok(pipe.includes('if(frameCtx?.morphFrameActive===true)return false;')&&pipe.includes('v69MorphLayerSceneIsolation:true'), '6.9 Morph MAX coverage must be isolated in the transparent Layer Scene before source-over frame composition');
assert.ok(spiral.includes('const CLOSURE_WGSL=')&&spiral.includes('expectedP3=rotateScale')&&spiral.includes('expectedC2=2.0*expectedP3-expectedNextC1')&&spiral.includes('pathClosureBuffer'), '6.9 continuity-preserving Spiral Morph must enforce periodic endpoint and C1-tangent closure on GPU cubics');
assert.ok(spiral.includes("morphType==='torn'||state?.morph?.mode==='fade'?0:1")&&spiral.includes('position + C1 tangent closure'), '6.9 Torn/Fade may remain discontinuous while continuity modes retain the periodic seam');
assert.ok(appC.includes('window.__spiro69MorphStrokeProbe=')&&pipe.includes('v69MorphMaxCoverageUnion:true')&&pipe.includes('v69PeriodicBezierClosure:true'), '6.9 must expose a compact Morph stroke/glow/closure diagnostic');



// Somata 6.9 rev3: retain Rev2 contracts while fixing Lightning layer/color, Spiral Web,
// high-curvature raster quality, fillet collisions and strict carrier presentation reliability.
{
    const defaults69=read('js/core/defaults-layers.js');
    const framePaths69=read('js/geometry/frame-paths.js');
    const appB69=read('js/legacy/app-b.js');
    const bezierSweep69=read('js/gpu/bezier-sweep-renderer.js');
    const canonicalSweep69=read('js/gpu/canonical-sweep-renderer.js');
    const lightningArc69=read('js/gpu/lightning-arc-renderer.js');
    const css69=read('styles/app.css');
    assert.ok(framePaths69.includes('collectSmoothCornerLampPoints(layerIndex,rawPaths,maxPoints,false)'), '6.9 Static Corner lamps must bypass temporal corner inertia');
    assert.ok(appB69.includes('e.target=animate?')&&appB69.includes('if(animate){')&&appB69.includes('lampCornerInertiaMs(getLampEvaluationConfig())'), '6.9 corner inertia must remain available only on the animated/Morph path');
    assert.ok(appC.includes("const viewportSurface=document.getElementById('mainContainer')||mainCanvas")&&appC.includes("viewportSurface.addEventListener('wheel'")&&appC.includes("viewportSurface.addEventListener('mousedown'"), '6.9 pan/wheel gestures must bind to the persistent workspace instead of a hidden presentation canvas');
    assert.ok(css69.includes('#mainContainer,')&&css69.includes('touch-action: none;'), '6.9 workspace must own touch gestures when the final GPU canvas is active');
    assert.ok(html.includes('id="sweepCoreBlendMode"')&&html.includes('id="sweepGlowBlendMode"')&&html.includes('sweep-blend-mode-row'), '6.9 Sweep UI must expose Core and Glow blend menus in one row');
    assert.ok(defaults69.includes("coreBlendMode:'normal'")&&defaults69.includes("glowBlendMode:'normal'")&&defaults69.includes('function sweepBlendGpuState(value)'), '6.9 Core/Glow blending must default to Normal and have a GPU blend-state mapping');
    for(const src of [bezierSweep69,canonicalSweep69,lightningArc69])assert.ok(src.includes('sweepBlendGpuState'), '6.9 native Sweep/Lightning renderers must compile the selectable blend modes');
    assert.ok(lightningArc69.includes("frame.stage==='precharge'")&&lightningArc69.includes('const blendMode=core?sweepCoreBlendMode(prepared.cfg):sweepGlowBlendMode(prepared.cfg)'), '6.9 rev3 Lightning precharge halo must use Glow while its colored core composites above the carrier with Core');
    assert.ok(sweep.includes('_lightningPreflashBlend:false')&&sweep.includes('_lightningPreflashCoreOnTop:true')&&sweep.includes("color:cfg.color||'#ffffff'")&&bezierSweep69.includes('coreColorGain=1'), 'Shared spectral preflash must keep the authored Glint RGB; brightness is Glow-only while Core remains color-exact');
    const microInput=(html.match(/<input id="sweepLightningMicroStrikes"[^>]*>/)||[''])[0];
    assert.ok(microInput.includes('type="number"')&&!/\smax=/.test(microInput), '6.9 microstrike count must be a number field without an upper bound');
    assert.ok(appB69.includes('function collectLightningMicroPulses')&&appB69.includes('if(n<=64)')&&appB69.includes('const k=t*(n+1)-1'), '6.9 arbitrary microstrike counts must avoid an unbounded O(N) per-frame loop');
    assert.ok(arc.includes('cpuPathKnotFractions[pi]={source:fr,target:fr,common:fr}')&&arc.includes('pathRanges:cpuPathRanges'), '6.9 static retained Spiral resource must expose the same common-knot/path-range Lamp contract as Morph');
    assert.ok(lamps.includes("morphRec?.staticSpiralBezierRail===true&&Array.isArray(knotRec.source)")&&lamps.includes('window.__spiro69StaticSpiralLampProbe='), '6.9 Static Spiral + Lamps must use a guarded retained-rail bridge instead of crashing on a Morph-only field');
    const webCorner69=read('js/gpu/web-corner-resource.js');
    assert.ok(arc.includes('if(sj===0)flags|=0x20000000')&&webCorner69.includes('logicalBoundary=(metaData.w&0x20000000u)!=0u')&&webCorner69.includes('candidate=select(logicalBoundary,marked,cornerMode)'), '6.9 rev3 Spiral Web must classify retained-cubic boundaries instead of tiny raster micro-turns');
    assert.ok(!webCorner69.includes('!arcRec.morphRec?.allClosed')&&webCorner69.includes('let closed=r.z!=0u'), '6.9 rev3 Spiral Web resource must support both open and closed retained rails');
    assert.ok(appA.includes('const maxCombined=total*(1-0.002)')&&appA.includes('spline supplies a C1 tangent handoff'), '6.9 rev3 adjacent strong fillets must retain a non-degenerate C1 spline handoff');
    assert.ok(pipe.includes("somataSpiralSceneDiag.base.stage='base-missing-full-gpu-error'")&&pipe.includes('SPIRAL_BASE_MISSING_AT_FRAME_END'), 'strict Spiral must reject effects-only transactions and report the missing Full-GPU carrier');
    assert.ok((pipe.includes("version:'7.0'")||pipe.includes("version:'7.0.3'")||pipe.includes("version:'7.2.4'")||pipe.includes('iteration:4'))&&pipe.includes('v69StaticCornerZeroInertia:true')&&pipe.includes('v69StaticSpiralLampContract:true')&&pipe.includes('v69SweepCoreGlowBlendModes:true')&&pipe.includes('v69LightningPreflashCoreOnTop:true')&&pipe.includes('v69WebLogicalBoundaryCorners:true')&&pipe.includes('v69SmoothFilletCollisionHandoff:true')&&pipe.includes('v69StrictCarrierIntegrityGuard:true'), '6.9 rev3 runtime audit must advertise the restored and reliability contracts');
}

// Somata 7.0: performance contracts must remain structural and inspectable.
assert.ok(appC.includes('usesRetainedGpuSpiralLayer')&&appC.includes('if(usesRetainedGpuSpiralLayer(idx)){reuse.length=0;return reuse;}'),'7.0 strict GPU Spiral must skip duplicate dense CPU topology preparation');
assert.ok(appC.includes('strict Full-GPU gate')&&appC.includes('Exact GPU Morph Arc resource unavailable')&&appC.includes('GPU Web corner resource unavailable'),'7.0.2 exact Arc/Web prerequisites must gate visible Blue Morph motion without any fallback renderer');
assert.ok(spiral.includes('const SUBDIV=12, ARC_SUBDIV=8')&&spiral.includes('cubicUniformStaging')&&spiral.includes('cubicComputeReuses'),'7.0 must keep visual quality while reducing effect subdivision and per-frame allocation/compute duplication');
assert.ok(spiral.includes('const srcMetrics=new Map(),dstMetrics=new Map()')&&spiral.includes('sourceRawArcMap=sourceMetrics?.map||buildRailArcMap')&&spiral.includes('sourcePathLength:sourceRawArcMap.total'),'7.0 Minimal Turn/phase preparation must reuse retained Bézier arc metrics');
const web70=read('js/gpu/web-corner-resource.js');
assert.ok(web70.includes('candidateIndexBuffer')&&web70.includes('candidateCount')&&web70.includes('let i=candidates[slot]'),'7.0 Web corner scan must compact work to logical candidates instead of every microsegment');
const bezierSweep70=read('js/gpu/bezier-sweep-renderer.js');
assert.ok(bezierSweep70.includes('uniformPairPool')&&bezierSweep70.includes('cachedBufferBind')&&bezierSweep70.includes('uniformPoolReuses'),'7.0 Bézier Sweep must pool Core/Glow uniforms and retained-buffer bind groups instead of allocating them per frame');
assert.ok(pipe.includes('retainedSpiralSkipsDenseCpuTopology:true')&&pipe.includes('optionalArcWebWarmupDoesNotGateMorphClock:true')&&pipe.includes('fullGpuPrewarmGatesMorphClock:true')&&pipe.includes('canvasFallbackForbidden:true')&&pipe.includes('fastGpuForbidden:true')&&pipe.includes('arcEffectSubdiv:8')&&pipe.includes('webCornerCandidateCompaction:true')&&pipe.includes('minimalTurnArcMetricCache:true')&&pipe.includes('bezierSweepUniformPooling:true'),'7.0.2 runtime audit must advertise strict Full-GPU stabilization');

// 7.0.1: FreezeLight is opt-in and the Morph lamp auto-layout must be complete.
assert.ok(state.includes('freezeLight: false')&&state.includes('freezeTailSec: 1.5'),'7.0.1 FreezeLight must be off by default with a finite default tail');
assert.ok(html.includes('id="lampFreezeLight"')&&html.includes('id="lampFreezeTailSec"'),'7.0.1 Lamps UI must expose FreezeLight and tail seconds');
assert.ok(lampGpu.includes('const FREEZE_WGSL=')&&lampGpu.includes('Somata FreezeLight feedback')&&lampGpu.includes('return max(current,history)'),'7.0.1 FreezeLight must use an explicit GPU feedback pass instead of accidental frame retention');
assert.ok(lampGpu.includes('binding:1,resource:{buffer:corridor?copyBuffer:dummyStorageBuffer}')&&lampGpu.includes('bindings 0,1,2,3,5'),'7.0.1 non-Corridor Morph Arc lamps must satisfy the auto-layout binding(1) requirement');
assert.ok(pipe.includes('v701FreezeLightFeedback:true')&&pipe.includes('v701LampArcBindGroupComplete:true'),'7.0.1 runtime audit must advertise FreezeLight and the lamp bind-group repair');


// 7.0.4: Graffiti Corridor keeps its hidden carrier GPU-only for Glow, never for Base.
const pipe704=read('js/render/main-pipeline.js');
const graffitiRibbon704=read('js/gpu/graffiti-ribbon-renderer.js');
assert.ok(pipe704.includes('allowHiddenGraffitiCarrier=false')&&pipe704.includes("frameCtx?.lineProfileApplication==='graffiti'")&&pipe704.includes('graffitiCarrierGlow'), '7.0.4 Corridor Graffiti must be allowed to open the resident GPU LayerScene with a hidden Glow carrier');
assert.ok(pipe704.includes('frameCtx.lineProfileStrokeOnly!==true&&canUseGpuOnlyCorridorLayerScene(frameCtx,false)'), '7.0.4 hidden Graffiti carrier must never authorize ordinary Corridor Base rendering');
assert.ok((pipe704.includes("version:'7.0.4'")||pipe704.includes("version:'7.0.5'")||pipe704.includes("version:'7.0.6'")||pipe704.includes("version:'7.0.7'")||pipe704.includes("version:'7.0.8'")||pipe704.includes("version:'7.0.9'")||pipe704.includes("version:'7.0.10'")||pipe704.includes("version:'7.0.11'")||pipe704.includes("version:'7.0.12'")||pipe704.includes("version:'7.0.13'")||(pipe704.includes("version:'7.2'")||pipe704.includes("version:'7.2.4'")))&&pipe704.includes('graffitiCorridorHiddenCarrierGlow:true')&&pipe704.includes('graffitiBaseCarrierStillSuppressed:true'), '7.0.4+ runtime audit must expose the Graffiti carrier contract');
assert.ok(graffitiRibbon704.includes('queueMicrotask(()=>{try{WebGPUGraffitiContourGlow.warmup();WebGPUGraffitiRibbonRenderer.warmup()'), 'Graffiti ribbon and contour-Glow WebGPU pipelines must prewarm outside the first authored render frame');
assert.ok(!pipe704.includes('Graffiti GPU] FALLBACK @'), '7.0.4 FullGPU diagnostics must not describe Graffiti GPU errors as fallbacks');


// 7.0.5: fused Glow -> Uniform Base pipeline switches must share explicit bind-group layouts.
assert.ok(spiral.includes("renderPipelineLayout=device.createPipelineLayout")&&spiral.includes("layout:renderPipelineLayout"),'7.0.5 Spiral Morph render variants must share one explicit pipeline layout');
assert.ok(spiral.includes("layout:renderUniformLayout")&&spiral.includes("layout:renderCubicLayout")&&spiral.includes("layout:renderCopyLayout"),'7.0.5 Spiral Morph bind groups must be created from the shared explicit layouts, not a pipeline-private auto layout');
assert.ok(!spiral.includes("layout:pipelineMax.getBindGroupLayout(0)")&&!spiral.includes("layout:pipelineMax.getBindGroupLayout(1)")&&!spiral.includes("layout:pipelineMax.getBindGroupLayout(2)"),'7.0.5 must not reuse pipelineMax auto-layout bind groups across Uniform/regular Morph pipelines');
assert.ok((pipe.includes("version:'7.0.5'")||pipe.includes("version:'7.0.6'")||pipe.includes("version:'7.0.7'")||pipe.includes("version:'7.0.8'")||pipe.includes("version:'7.0.9'")||pipe.includes("version:'7.0.10'")||pipe.includes("version:'7.0.11'")||pipe.includes("version:'7.0.12'")||pipe.includes("version:'7.0.13'")||(pipe.includes("version:'7.2'")||pipe.includes("version:'7.2.4'")))&&pipe.includes('spiralMorphSharedExplicitRenderLayout:true'),'7.0.5+ runtime audit must expose the shared Spiral Morph render-layout repair');


// 7.0.10 — Lamps/FreezeLight consume the retained Bézier rail that actually owns this frame.
const arc710=fs.readFileSync(path.join(root,'js/gpu/morph-arc-resource.js'),'utf8');
const lampBridge710=fs.readFileSync(path.join(root,'js/render/lamp-morph-bridge.js'),'utf8');
const pipe710=fs.readFileSync(path.join(root,'js/render/main-pipeline.js'),'utf8');
assert.ok(arc710.includes('function currentGpuBezierResourceForFrame(frameCtx)')&&arc710.includes('blueOwnsFrame')&&arc710.includes('getGpuMorphArcResource(frameCtx.layerIndex,frameCtx)'), '7.0.10 Arc must select the retained Bézier authority from frameCtx instead of global Morph activity');
assert.ok(lampBridge710.includes('currentGpuBezierResourceForFrame(frameCtx)')&&lampBridge710.includes('spiral-exact-gpu-arc'), '7.0.10 Spiral Lamps must bind to the frame-authoritative retained rail');
assert.ok((pipe710.includes("version:'7.0.10'")||pipe710.includes("version:'7.0.11'")||pipe710.includes("version:'7.0.12'")||pipe710.includes("version:'7.0.13'")||(pipe710.includes("version:'7.2'")||pipe710.includes("version:'7.2.4'")))&&pipe710.includes('lampArcFrameAuthoritativeRail:true')&&pipe710.includes('freezeLightSharesLampFrameAuthority:true'), '7.0.10 runtime audit must expose the Lamp Arc / FreezeLight authority repair');


// 7.0.11 — phase-circle lamps are atomic phase prerequisites and diagnostics are bounded.
const runtime711=fs.readFileSync(path.join(root,'js/core/render-runtime.js'),'utf8');
const lamp711=fs.readFileSync(path.join(root,'js/gpu/lamp-renderer.js'),'utf8');
const app711=fs.readFileSync(path.join(root,'js/legacy/app-c.js'),'utf8');
assert.ok(pipe710.includes("version:'7.0.11'")||pipe710.includes("version:'7.0.12'")||pipe710.includes("version:'7.0.13'")||(pipe710.includes("version:'7.2'")||pipe710.includes("version:'7.2.4'"))&&pipe710.includes('phaseCircleLampArcPreclockGate:true')&&pipe710.includes('fullGpuFaultRingBounded:true'),'7.0.11 runtime audit must expose phase-circle Lamp Arc gating and bounded diagnostics');
assert.ok(runtime711.includes('f._fullGpuFaults.length=0')&&runtime711.includes('f._fullGpuFaultCount=0'),'7.0.11 reused render frames must clear FullGPU faults every frame');
assert.ok(pipe710.includes('SOMATA_FULL_GPU_FRAME_FAULT_LIMIT=32')&&pipe710.includes('priorFaults=')&&pipe710.includes('.slice(-SOMATA_FULL_GPU_FRAME_FAULT_LIMIT)'),'7.0.11 FINAL diagnostics must snapshot a bounded fault ring instead of embedding the live array');
assert.ok(lamp711.includes('async function ensureReady()')&&lamp711.includes('async function ensureWebGPUReady()'),'7.0.11 lamp WebGPU initialization must be awaitable by phase preparation');
assert.ok(app711.includes('Phase-circle Lamp Arc resource unavailable/stale')&&app711.includes('await LampGPURenderer.ensureWebGPUReady()')&&app711.includes("somataGpuContractError?.('PHASE_CIRCLE_FULL_GPU_PREWARM_FAILED'"),'7.0.11 phase-circle must gate its clock on retained rail + WebGPU lamps + Exact Arc and fail closed on preparation errors');



// Corridor center shading — explicit percent control, zero remains exactly neutral, and buried copies can be delayed.
const appC713=fs.readFileSync(path.join(root,'js/legacy/app-c.js'),'utf8');
const pipe713=fs.readFileSync(path.join(root,'js/render/main-pipeline.js'),'utf8');
const html713=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.ok(appC713.includes('TUNNEL_CENTER_SHADE_DEFAULT_PERCENT = 60')&&appC713.includes('const alpha = 1 - centerShadeStrength * (1 - depthAlpha);'),'Corridor center shading must be explicit and exactly neutral at 0%');
assert.ok(appC713.includes('const centerCullAlpha = Math.max(0.0025, Number(copies?._centerCullAlpha) || 0.0025);')&&appC713.includes('if (alpha <= centerCullAlpha && fillAlpha <= centerCullAlpha && particleAlpha <= centerCullAlpha) continue;'),'Center shading must postpone visually buried line/fill/particle copies before GPU submission');
assert.ok(html713.includes('id="tunnelCenterShadePercent"')&&html713.includes('type="number"')&&html713.includes('class="tunnel-fade-unit">%</span>'),'Center shading UI must be a percentage number field with no checkbox');
assert.ok((pipe713.includes("version:'7.0.13'")||(pipe713.includes("version:'7.2'")||pipe713.includes("version:'7.2.4'")))&&pipe713.includes('corridorCenterShadeAdjustable:true')&&pipe713.includes('corridorCenterShadeGpuCull:true'),'Runtime audit must expose adjustable center shading and GPU culling');

assert.ok(pipe.includes("SOMATA_RECOVERABLE_GPU_CONTRACT_CODES=new Set(['STRICT_SPIRAL_CANVAS_PATH_TOUCHED','FINAL_FULL_GPU_PRESENT_FAILED'])"),'7.2 must classify recoverable strict-frame diagnostics separately from actual GPU errors');
assert.ok(pipe.includes('console.warn(`[Somata GPU diagnostic]'),'GPU warm-up/wait diagnostics must not enter the red error console');
assert.ok(pipe.includes('(recoverable?console.warn:console.error)(`[Somata 7.2.4 FullGPU]'),'Recoverable FullGPU frame rejections should be warnings while real GPU faults remain errors');
console.log('Somata 7.2.4 Spiral GPU/Bézier invariants: PASS');

// Graffiti Glow repair — the hidden carrier may still exist as a transparent scene/root utility,
// but it must never be used as the visible Glow source. Glow is deferred to the exact GPU ribbon.
const graffitiRibbon713=read('js/gpu/graffiti-ribbon-renderer.js');
const graffitiMorph713=read('js/gpu/graffiti-morph-renderer.js');
assert.ok(pipe.includes('Graffiti contour Glow deferred to exact GPU ribbon')&&!pipe.includes("getFrameGLStrokeCommands(frameCtx,true),radiusPx"), 'Graffiti Glow must not request the hidden thin carrier');
assert.ok(graffitiRibbon713.includes('encodeGlowToLayerScene')&&graffitiRibbon713.includes('GPU mask -> separable WebGPU blur')&&graffitiMorph713.includes('encodeGlowToLayerScene'), 'Static and Morph Graffiti must expose exact-ribbon GPU contour Glow');
assert.ok(defaults.includes('graffitiAngle: 45')&&defaults.includes('graffitiNibLength: 10')&&defaults.includes('graffitiSizeVariationEnabled: false')&&defaults.includes('graffitiSizeVariation: 0')&&defaults.includes('graffitiRotationVariationEnabled: false')&&defaults.includes('graffitiRotationVariation: 0'), 'Graffiti defaults must be 45-degree marker, nib length 10, and size/rotation variations disabled at zero');

// 7.0.8 — desktop mouse double-click on the visual workspace toggles native fullscreen.
assert.ok(appC.includes("const fullscreenWorkspace = document.getElementById('mainContainer') || mainCanvas")&&appC.includes("fullscreenWorkspace?.addEventListener('dblclick'")&&appC.includes('void toggleAppFullscreen()'), '7.0.8 visual workspace must toggle fullscreen on desktop mouse double-click');


// 7.0.9 — GPU Web is a non-blocking consumer of the Morph rail and stale corner state rebuilds.
const webBridge709=read('js/render/web-morph-bridge.js');
const webRenderer709=read('js/gpu/web-morph-renderer.js');
assert.ok(appC.includes('MORPH_WEB_FULL_GPU_PREWARM_FAILED')&&appC.includes('Crucial: Web failure does not mutate gpuPhasePreparing')&&appC.includes('WebGPUWebMorphRenderer.ensureReady'), '7.0.9 Web preparation must never leave Blue Morph clock gated');
assert.ok(webRenderer709.includes('ensureReady:()=>initAsync()'), '7.0.9 GPU Web renderer must expose awaitable prewarm readiness');
assert.ok(!webBridge709.includes("return'topology-change-needs-corner-tracking-fallback'")&&webBridge709.includes('self-deadlock'), '7.0.9 stale Web corner state must rebuild instead of blocking the new Morph topology');
assert.ok(pipe.includes('webNeverGatesMorphClock:true')&&pipe.includes('webStaleCornerStateRebuild:true')&&pipe.includes('webRendererAwaitableWarmup:true'), '7.0.9 runtime audit must expose Web/Morph stabilization');

// 7.0.12 — console effect benchmark must measure the existing FullGPU graph without adding a fallback.
const scheduler712=read('js/core/scheduler.js'), appA712=read('js/legacy/app-a.js'), pipe712=read('js/render/main-pipeline.js');
assert.ok(scheduler712.includes('__somataFxBenchStart')&&scheduler712.includes('__somataFxBenchCompare')&&scheduler712.includes('somataFxBenchmark'),'7.0.12 must expose effect benchmark console helpers');
assert.ok(appA712.includes('function setGpuTimingInterval')&&appA712.includes('setGpuTimingInterval};'),'7.0.12 final GPU renderer must allow temporary timestamp sampling interval control');
assert.ok(pipe712.includes('somataFxBenchmark?.noteFrame?.')&&pipe712.includes('effectBenchmarkConsoleProfiler:true'),'7.0.12 benchmark must sample completed FullGPU frames and expose runtime audit flag');

// Shared Glint / Lightning visual contract: one authored preflash block is used in both modes.
{
    const appBShared=read('js/legacy/app-b.js');
    const appCShared=read('js/legacy/app-c.js');
    const canonicalShared=read('js/gpu/canonical-sweep-renderer.js');
    const bezierShared=read('js/gpu/bezier-sweep-renderer.js');
    const lightningShared=read('js/gpu/lightning-arc-renderer.js');
    assert.ok(html.includes('id="sweepFlashMode"')&&html.includes('id="sweepWidthPercent"')&&html.includes('id="sweepLightningUseGlintMultiplier"')&&html.includes('id="sweepLightningGlintMultiplier"'), 'Glint and Lightning must expose one shared preflash block plus the Lightning multiplier controls');
    assert.ok(!html.includes('id="sweepLightningFlashLengthPercent"')&&!html.includes('id="sweepLightningPreGlowIntensity"')&&!html.includes('id="sweepLightningFlashOpacity"'), 'Duplicated Lightning preflash controls must not remain in the UI');
    assert.ok(defaults.includes('widthPercent:75')&&defaults.includes('lightningUseGlintMultiplier:true')&&defaults.includes('lightningGlintMultiplier:2'), 'Shared flash thickness must default to 75% and Lightning visual linking to ×2');
    assert.ok(appBShared.includes('function getLightningVisualSettings')&&appBShared.includes('base.glowSize*mult')&&appBShared.includes('base.strength*mult')&&appBShared.includes('base.brightness*mult')&&appBShared.includes('softness:base.softness'), 'Linked Lightning must multiply brightness/intensity/size while inheriting softness unchanged');
    assert.ok(appCShared.includes("'sweepFlashMode'")&&appCShared.includes("'sweepLightningUseGlintMultiplier'")&&appCShared.includes("'sweepLightningGlintMultiplier'"), 'Shared mode and Lightning link controls must be live-bound to state');
    assert.ok(canonicalShared.includes('coreOpacity')&&canonicalShared.includes('Number(visual.strength)*brightness')&&canonicalShared.includes('uniformF32[23]=1'), 'Canonical GPU Glint must apply opacity to Core and brightness to Glow only');
    assert.ok(bezierShared.includes('coreOpacity')&&bezierShared.includes('Number(visual.strength)*brightness')&&bezierShared.includes('coreColorGain=1'), 'Bézier GPU Glint must keep Core color/width independent from Glow brightness');
    assert.ok(lightningShared.includes('paGlow')&&lightningShared.includes('paCore')&&lightningShared.includes('frame.prechargeGlowIntensity*bright'), 'Lightning GPU preflash must split Glow alpha from Core opacity');
}
