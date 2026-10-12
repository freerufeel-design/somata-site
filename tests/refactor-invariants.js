'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const near=(a,b,eps=1e-12)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);

function testMorphController(){
  const runtimeState={
    morph:{active:true,frameLayers:[{id:'a',x:5}],lightLayers:[],phaseSerial:0,progress:0,geometryT:0,exactStartPending:false,paused:false,pausedByOrangeProject:false,pausedByGreenProject:false},
    minimalMorph:{active:true,transitioning:false},
    projectMorph:{active:false,transitionActive:false,frameRenderLayers:[]}
  };
  const state={layers:[{id:'a',x:1}],morph:{mode:'circleSlide',monoOrbitTransforms:false}};
  const removed=[];
  const context={window:{},runtimeState,state,performance:{now:()=>1000},animationScheduler:{remove:key=>removed.push(key)},console};
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('js/core/morph-controller.js'),context);
  const C=context.window.SpiroMorphController;
  for(let i=0;i<=20;i++){
    const u=i/20;
    const t=C.resolveBlueTimeline({now:1000+u*1000,cycleStart:1000,cycleMs:1000,easing:x=>x});
    near(t.linearT,u); near(t.geometryT,u);
  }
  const fade=C.resolveBlueTimeline({now:1900,cycleStart:1000,cycleMs:1000,mode:'fade',fadePercent:20,easing:x=>x});
  near(fade.transitionLinearT,.5); near(fade.geometryT,.5);
  assert.strictEqual(C.getDisplayLayers(),runtimeState.morph.frameLayers);
  const visible=runtimeState.morph.frameLayers[0];
  C.pauseBlueForOrange(1200);
  assert.strictEqual(runtimeState.morph.frameLayers[0],visible,'Orange pause must preserve the resolved Blue frame until commit/rebase');
  assert.equal(runtimeState.morph.pausedByOrangeProject,true);
  runtimeState.morph.paused=false; runtimeState.morph.pausedByOrangeProject=false;
  runtimeState.projectMorph.active=true;
  runtimeState.projectMorph.frameRenderLayers=[{id:'g',x:9},{id:'g2',x:10}];
  // Enabled Green playlist playback must not hide Blue during its hold period.
  assert.strictEqual(C.getDisplayLayers(),runtimeState.morph.frameLayers);
  runtimeState.projectMorph.transitionActive=true;
  assert.strictEqual(C.getDisplayLayers(),runtimeState.projectMorph.frameRenderLayers);
  assert.equal(C.getDisplayLayerAt(1).x,10);
  runtimeState.projectMorph.transitionActive=false;
  const beforeCanonical=state.layers[0];
  const blueFrame=runtimeState.morph.frameLayers[0];
  C.pauseBlueForGreen(1400);
  assert.strictEqual(state.layers[0],beforeCanonical,'Green pause must not mutate canonical state');
  assert.strictEqual(runtimeState.morph.frameLayers[0],blueFrame,'Green pause must preserve the captured Blue frame');
  assert.equal(runtimeState.morph.pausedByGreenProject,true);
}

function testPersistentWriteBoundaries(){
  const app=read('js/legacy/app-c.js');
  let a=app.indexOf('            const animateMorph =');
  let b=app.indexOf('\n            const ',a+30);
  const blue=app.slice(a,b);
  assert.ok(a>=0&&b>a,'animateMorph block not found');
  assert.ok(!blue.includes('state.layers='),'Blue rAF must not replace canonical layers');
  assert.ok(!blue.includes('state.playlistPaletteHueOffset='),'Blue rAF must not rewrite canonical global Hue');
  a=app.indexOf('        function applyProjectMorphFrame(');
  b=app.indexOf('\n        function ',a+30);
  const green=app.slice(a,b);
  assert.ok(a>=0&&b>a,'applyProjectMorphFrame block not found');
  assert.ok(!green.includes('state.layers='),'Green rAF must not replace canonical layers');
  assert.ok(!green.includes('state.lamps='),'Green rAF must keep global lamp frame in runtime state');

  const greenPauseStart=app.indexOf('        function quiesceProjectLocalMorphForGreen');
  const greenPauseEnd=app.indexOf('\n        function snapshotCurrentVisibleProjectForGreen',greenPauseStart);
  const greenPause=app.slice(greenPauseStart,greenPauseEnd);
  assert.ok(!greenPause.includes('activeStopMorphing(false)'),'Green transition must not commit Blue intermediate state into canonical layers');
  assert.ok(greenPause.includes('pauseBlueForGreen'),'Green transition must runtime-pause Blue after snapshot');
  const greenBeginStart=app.indexOf('        function beginNextProjectMorphTransition');
  const greenBeginEnd=app.indexOf('\n        function projectMorphAnimationTick',greenBeginStart);
  const greenBegin=app.slice(greenBeginStart,greenBeginEnd);
  assert.ok(greenBegin.includes('pmRt.transitionActive=false'),'A Green project period must begin in non-owning hold mode');
  assert.ok(greenBegin.includes('transitionStartsImmediately'),'Only an immediate Green transition may take ownership at project start');
  const greenActivateStart=app.indexOf('        function activateProjectMorphTransition');
  const greenActivateEnd=app.indexOf('\n        function beginNextProjectMorphTransition',greenActivateStart);
  const greenActivate=app.slice(greenActivateStart,greenActivateEnd);
  const snapshotAt=greenActivate.indexOf('snapshotCurrentVisibleProjectForGreen()');
  const prepareAt=greenActivate.indexOf('prepareProjectMorphGeometry');
  const ownAt=greenActivate.indexOf('pmRt.transitionActive=true');
  const pauseAt=greenActivate.indexOf('quiesceProjectLocalMorphForGreen');
  assert.ok(snapshotAt>=0&&prepareAt>snapshotAt&&ownAt>prepareAt&&pauseAt>ownAt,'Green must snapshot intermediate Blue, prepare it, acquire ownership, then pause Blue');

  const defaults=read('js/core/defaults-layers.js');
  a=defaults.indexOf('function withLampConfig');
  b=defaults.indexOf('window.__spiroLampConfigContextStatus',a);
  assert.ok(a>=0&&b>a,'withLampConfig block not found');
  assert.ok(!defaults.slice(a,b).includes('state.lamps='),'Lamp evaluation context must not impersonate persistent state');
}

function testScriptManifest(){
  const html=read('index.html');
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map(m=>m[1].split(/[?#]/,1)[0]);
  assert.ok(scripts.includes('js/core/morph-controller.js'),'Morph controller is missing from index.html');
  assert.ok(scripts.indexOf('js/core/state.js')<scripts.indexOf('js/core/morph-controller.js'),'State must load before Morph controller');
  assert.ok(scripts.indexOf('js/core/morph-controller.js')<scripts.indexOf('js/legacy/app-c.js'),'Morph controller must load before morph lifecycle');
  for(const rel of scripts){assert.ok(fs.existsSync(path.join(root,rel)),`Missing script: ${rel}`);}
}

testMorphController();
testPersistentWriteBoundaries();
testScriptManifest();


// Somata 6.7 regression: several plain Spiral Morph layers stay in the global GPU frame
// scene, the largest visible Spiral is the counter-rotation reference, and Minimal Turn
// uses phase-circle Spiral semantics plus minimum-motion closed-polygon correspondence.
{
  const html=read('index.html');
  const appA=read('js/legacy/app-a.js');
  const appC=read('js/legacy/app-c.js');
  const pipe=read('js/render/main-pipeline.js');
  const spiral=read('js/gpu/spiral-bezier-morph-renderer.js');
  const morph=read('js/geometry/morph.js');
  assert.ok(html.includes('<option value="minimalTurn">Минимальный поворот</option>'),'Minimal Turn Spiral Morph UI option missing');
  assert.ok(appC.includes("'minimalTurn'")&&appC.includes("function getEffectiveCircleSlideType(){return getSpiralMorphType()==='minimalTurn'?'minimal'"),'Minimal Turn must switch closed polygon circle-slide correspondence to minimum motion');
  assert.ok(morph.includes("minimalTurnSpiral ? 'minimalSpiral' : 'phase'"),'Minimal Turn Spiral must keep the phase-circle open-seam rail');
  assert.ok(morph.includes('circleMoveCost')&&morph.includes('allowReverse?[false,true]:[false]'),'Minimum-motion polygon mapping must compare physical circular travel and reversed closed-loop traversal');
  assert.ok(morph.includes("minimalTurnMode && slideType === 'minimal' ? 'minimal'"),'Minimal Turn must keep minimum correspondence even when polygon orbit topology changes');
  assert.ok(appA.includes('function getExternalFrameSceneTarget(frameId=0)')&&appA.includes('function deferExternalFrameScene(commandBuffer,frameId'), 'Direct global GPU Frame Scene API missing');
  assert.ok(appA.includes('function canUseFrameScene(frameId=0)')&&appA.includes('ensureLayerBatchSize(mainCanvas.width,mainCanvas.height)'), 'Direct Frame Scene must bootstrap its textures even when Spiral bypasses the ordinary layer batch');
  assert.ok(pipe.includes('function canUseGpuSpiralBezierFrameScene(frameCtx)'),'Direct Spiral Frame Scene eligibility missing');
  assert.ok(pipe.includes('const spiralBezierGpuNative=')&&pipe.includes('topologyGpuLazy||greenProjectGpuNative||spiralBezierGpuNative'),'GPU-native Spiral Morph must skip per-frame Canvas vector-master recording');
  assert.ok(pipe.includes('function resolveGpuSpiralBezierSceneRoute(frameCtx')&&pipe.includes('deferFrameScene:route.deferFrameScene'),'Spiral renderer must preserve direct Frame Scene residency through the unified scene-route contract');
  assert.ok(spiral.includes("const SUBDIV=12"),'Spiral GPU cubic subdivision budget must keep the original 12-step topology-morph visual budget');
  assert.ok(spiral.includes('equalizeCubicRailsByArc')&&spiral.includes('splitRailAtFractions')&&spiral.includes('cubicSubsegment'),'Spiral 6.8 endpoint normalization must use a common arc partition with exact De Casteljau cubic subdivision');
  assert.ok(spiral.includes("deferExternalFrameScene?.(cmd,frameCtx.frameId,'spiral-bezier-morph')"),'Spiral command buffers must be able to target the global Frame Scene directly');
  assert.ok(appC.includes('spiralRotationCompensationAnchorRadius')&&appC.includes('radius>anchor.radius'),'Rotation compensation must select the largest visible Spiral layer');
  assert.ok(appC.includes('estimateSpiralOuterTipRotationDeltaDegrees'),'Largest Spiral compensation must follow the outer rail-tip angular speed');
  assert.ok(spiral.includes("function replaceResources(nextResources,reason='phase-swap')"),'Spiral phase resources must support atomic replacement');
  assert.ok(!spiral.includes("retireCurrentResources('prepare-phase');"),'Next Spiral phase must not evict the visible GPU endpoint before preparation finishes');
  assert.ok(spiral.includes('runtimeState.morph?.gpuPhasePreparing===true&&Number(rec?.phaseSerial)!==currentPhaseSerial'),'Old Spiral GPU phase must remain drawable during async phase preparation');
  assert.ok(!spiral.includes('MorphGeometry.resampleMorphTopology(path?.points')&&spiral.includes('exactEndpointCubics:true'),'Spiral endpoint Morph rail must not be rebuilt from a point-resampled spline');
  assert.ok(spiral.includes('alignMinimalTurnPolarAngles')&&spiral.includes('globalPhaseK')&&spiral.includes('shift=globalPhaseK*TWO_PI')&&!spiral.includes('endpointTravelSlack'),'Minimal Turn must preserve the exact target retained cubic rail while choosing one least-rotation equivalent global 2π phase');
  assert.ok(appC.includes('runtimeState.morph.gpuPhaseHandoffT=Math.max(0,Math.min(1,handoff))'),'Morph lifecycle must capture the exact visible phase handoff fraction');
}



// Corridor center shading is explicit, project-persistent, and can conservatively cull buried GPU copies.
{
  const appC713=read('js/legacy/app-c.js');
  const pipe713=read('js/render/main-pipeline.js');
  const html713=read('index.html');
  assert(appC713.includes('TUNNEL_CENTER_SHADE_DEFAULT_PERCENT = 60')&&appC713.includes('const alpha = 1 - centerShadeStrength * (1 - depthAlpha);'), 'Corridor center shading must blend from a truly neutral 0% state');
  assert(appC713.includes('return 0.0025 + 0.04 * s * s;')&&appC713.includes('copies below its perceptual contribution threshold are born later'), 'Corridor center shading must drive conservative deep-copy GPU culling');
  assert(html713.includes('id="tunnelCenterShadePercent"')&&html713.includes('value="60"')&&html713.includes('Затенение центра'), 'Corridor settings must expose a percent-only center shading field with a nonzero default');
  assert(pipe713.includes('corridorCenterShadeAdjustable:true')&&pipe713.includes('corridorCenterShadeGpuCull:true'), 'Runtime audit must expose center shading and its GPU culling contract');
}

console.log('SpiroStar refactor invariants: PASS');

// v6.3.1 regression: Circle Slide consumers must not re-ease the controller-resolved
// timeline while collapsing profile amplitude. This was visible in the playlist project
// “Multi”, where spline/zigzag profiles made Linear speed look non-linear.
{
  const fs=require('fs'), path=require('path');
  const morphSrc=fs.readFileSync(path.join(__dirname,'..','js','geometry','morph.js'),'utf8');
  if(/collapseProfile\s*\?\s*smooth01\s*\(/.test(morphSrc)) throw new Error('Circle Slide collapse envelope still re-eases linear morph progress');
  if(!/const collapse01\s*=/.test(morphSrc)) throw new Error('Linear Circle Slide collapse envelope missing');
}

// v6.3.3 regression: background controls must remain available from the bottom-right
// right-click menu, and transparent desktop must bypass the opaque Final compositor.
{
  const html=read('index.html');
  const app=read('js/legacy/app-c.js');
  const finalGpu=read('js/legacy/app-a.js');
  const pipeline=read('js/render/main-pipeline.js');
  for(const id of ['btnChooseBackgroundImageMenu','btnClearBackgroundImageMenu','paramTransparentDesktop']){
    assert.ok(html.includes(`id="${id}"`),`Missing background UI control: ${id}`);
  }
  assert.ok(app.includes("openViewportBackgroundImagePicker()"),'Background picker helper missing');
  assert.ok(app.includes("input.value = ''"),'Background picker must allow choosing the same file twice');
  assert.ok(app.includes('refreshViewportBackgroundPresentation()'),'Background set/reset must invalidate presentation');
  assert.ok(app.includes('transparentDesktop: state.transparentDesktop === true'),'Transparent desktop must persist in project settings');
  assert.ok(finalGpu.includes('state.transparentDesktop===true||renderBackendTelemetry.blocksGpuScene()'),'Transparent desktop must bypass opaque Final compositor/deferred path');
  assert.ok(pipeline.includes("transparentDesktop ? 'transparent' : state.bgColor"),'Main workspace background must become transparent');
}

// Graffiti marker angle regression: missing mode is Absolute, Relative explicitly follows
// the path tangent, and right-click on the Lines tool toggles Graffiti <-> Point.
{
  const html=read('index.html');
  const defaults=read('js/core/defaults-layers.js');
  const appB=read('js/legacy/app-b.js');
  const appC=read('js/legacy/app-c.js');
  const ribbon=read('js/gpu/graffiti-ribbon-renderer.js');
  const morph=read('js/gpu/graffiti-morph-renderer.js');
  assert.ok(html.includes('id="graffitiAngleMode"'),'Graffiti angle mode selector missing');
  assert.ok(html.includes('<option value="absolute" selected>Абсолютный</option>'),'Absolute must be the UI default');
  assert.ok(defaults.includes("graffitiAngleMode: 'absolute'"),'New layers must default to absolute Graffiti angle');
  assert.ok(defaults.includes("setLayerMainLineMode(owner,on?'graffiti':'point')"),'Graffiti quick toggle must switch explicitly between Graffiti and Point');
  assert.ok(appC.includes("else if(mode==='lines')toggleSidebarFeatureWithMemory('graffiti')"),'Lines right-click/long-press must toggle Graffiti');
  assert.ok(defaults.includes('graffitiSizeVariationEnabled: false'),'Graffiti taper variation must be disabled by default');
  assert.ok(defaults.includes('graffitiSizeVariation: 0'),'Graffiti taper amount must be zero by default');
  assert.ok(html.includes('id="graffitiSizeVariation" type="range" min="0" max="100" step="1" value="0"'),'Graffiti taper UI must start at zero');
  assert.ok(appB.includes("const tangentAngle=angleMode==='relative'?Math.atan2(ty,tx):0"),'CPU Graffiti ribbon must distinguish relative and absolute angles');
  assert.ok(ribbon.includes('item.meta,s.angleMode'),'Static GPU Graffiti mesh must receive the angle mode');
  assert.ok(morph.includes("uniformData[22]=style.angleMode==='relative'?1:0"),'Morph GPU uniform must receive the angle mode');
  assert.ok(morph.includes('select(0.0,atan2(tangent.y,tangent.x),u.glow.z>0.5)'),'Morph GPU angle must only add tangent in Relative mode');
  assert.ok(appC.includes("l.graffitiAngleMode) ? l.graffitiAngleMode : 'absolute'"),'Imported projects without a valid angle mode must normalize to Absolute');
}


// Somata 6.4 mobile/project persistence regression: playlist projects must carry the
// complete persistent config boundary, mobile save must not revoke the Blob immediately,
// camera pan must be viewport-normalized, and spiral Morph must have a constrained tier.
{
  const app=read('js/legacy/app-c.js');
  const budget=read('js/geometry/morph-budget.js');
  for(const token of [
    'const persistentTunnel = cloneData(state.tunnel)',
    'const persistentMorph = cloneData(state.morph)',
    'const persistentMinimalMorph = cloneData(state.minimalMorph)',
    'const persistentTapTempo = cloneData(state.tapTempo)',
    'const persistentAudioReactive = cloneData(state.audioReactive)'
  ]) assert.ok(app.includes(token),`Persistent project section snapshot missing: ${token}`);
  assert.ok(app.includes('defaultActive: state.tunnel.defaultActive === true'),'Corridor default-active flag must be serialized');
  assert.ok(app.includes('defaultActive: state.morph.defaultActive === true'),'Blue Morph default-active flag must be serialized');
  assert.ok(app.includes('defaultActive: state.minimalMorph.defaultActive === true'),'Orange Morph default-active flag must be serialized');
  assert.ok(app.includes("projectData?.settings?.tunnel?.defaultActive === true"),'Playlist project switch must read Corridor default-active');
  assert.ok(app.includes("projectData?.settings?.morph?.defaultActive === true"),'Playlist project switch must read Morph default-active');
  const playlistLoaderStart=app.indexOf('        async function loadPlaylistDocument');
  const playlistLoaderEnd=app.indexOf('\n        async function openPlaylist',playlistLoaderStart);
  const playlistLoaderBlock=app.slice(playlistLoaderStart,playlistLoaderEnd);
  assert.ok(playlistLoaderBlock.includes("mergePersistentProjectSection('projectMorph', parsed?.projectMorph)"),'Shared playlist loader must restore complete persistent Green Morph config');
  assert.ok((app.match(/await loadPlaylistDocument\(/g)||[]).length>=3,'Manual picker, fallback input, and default playlist must share the same complete playlist loader');
  assert.ok(app.includes('normalizedPanX: panX / width')&&app.includes('normalizedPanY: panY / height'),'Project camera must persist viewport-relative pan');
  assert.ok(app.includes('Legacy projects stored desktop CSS-pixel pan without a viewport reference'),'Legacy desktop pan must be neutralized on compact mobile viewport');
  assert.ok(app.includes("typeof navigator?.share === 'function'"),'Mobile plist save must prefer native Share/Files');
  assert.ok(app.includes('URL.revokeObjectURL(url)')&&app.includes('},30000)'),'Download fallback must keep Blob URL alive for Safari');
  const saveStart=app.indexOf('        async function savePlaylistToDisk');
  const saveEnd=app.indexOf('\n        async function loadPlaylistProjectByIndex',saveStart);
  const saveBlock=app.slice(saveStart,saveEnd);
  assert.ok(!saveBlock.includes('setTimeout(()=>URL.revokeObjectURL(url),0)'),'Playlist Blob URL must not be revoked immediately');
  assert.ok(saveBlock.includes("saveBlobToDevice(blob,filename,'Somata playlist')"),'Playlist fallback must use the mobile-safe save helper');
  assert.ok(!app.includes('function syncAfterProjectLoad() {\n            state.masterLayerEdit=false'),'Project load must preserve saved master-layer edit state');
  assert.ok(budget.includes('function morphBudgetConstrainedDevice()'),'Adaptive constrained-device Spiral Morph budget missing');
  assert.ok(budget.includes("constrained?(info.smooth?480:240)"),'Mobile Spiral Morph budget cap missing');

  // Execute the state boundary itself: every runtime-only field must be non-enumerable,
  // because buildProjectData clones the enumerable persistent section wholesale.
  const stateContext={window:{matchMedia:()=>({matches:false}),__spiroRegisterModule:()=>{}},console};
  vm.createContext(stateContext);
  vm.runInContext(read('js/core/state.js'),stateContext);
  const boundary=vm.runInContext(`Object.fromEntries(Object.keys(STATE_RUNTIME_FIELDS).map(section=>[section,(STATE_RUNTIME_FIELDS[section]||[]).filter(key=>Object.prototype.propertyIsEnumerable.call(state[section]||{},key))]))`,stateContext);
  for(const [section,leaks] of Object.entries(boundary)) assert.deepStrictEqual(Array.from(leaks),[],`Runtime fields leaked into persistent ${section}: ${leaks.join(',')}`);
}

// Somata 6.5 regression: ordinary Smooth Spiral must retain cubic Bézier control points
// until the WebGPU vertex stage instead of doing the old 10–32-point CPU tessellation.
{
  const app=read('js/legacy/app-a.js');
  const html=read('index.html');
  assert.ok(html.includes('<title>Somata 7.3.20</title>'),'Somata 7.2.8 title missing');
  assert.ok(app.includes('function buildSmoothSpiralBezierSegments('),'Smooth Spiral cubic source builder missing');
  assert.ok(app.includes("ctx.__spiroNativeBezierSpiral === true"),'Smooth Spiral must gate the native Bézier recording path');
  assert.ok(app.includes('__recordVariableWidthBezierSpiral(segments,baseWidth)'),'Recorder-side compact Bézier command path missing');
  assert.ok(app.includes('var<storage,read> cubicData: array<vec4<f32>>'),'WebGPU Bézier storage buffer missing');
  assert.ok(app.includes('let start=cubic(g0.xy,g0.zw,g1.xy,g1.zw,t0)'),'Bézier must be evaluated in the WebGPU vertex shader');
  assert.ok(app.includes('pass.draw(6,rec.cubicCount*BEZIER_SUBDIVISIONS)'),'GPU draw must expand cubics without CPU point tessellation');
  assert.ok(app.includes('packBezierSpiralCommands(commands,rec?.cpuData)'),'Dynamic Bézier staging buffer must be reused');
  assert.ok(app.includes("this.__spiroNativeBezierSpiral=nativeWebGPU&&((state.tunnel?.active===true)?WebGPUStrokeRenderer.supportsBezierSpiralCorridor?.()===true:WebGPUStrokeRenderer.supportsBezierSpiral?.()===true)"),'Somata 6.8 Spiral Corridor must retain the cubic Bézier carrier on WebGPU');
  assert.ok(app.includes('if(state.fourierMode)return []'),'Fourier must retain the compatibility sampler in 6.5');
  assert.ok(app.includes('smoothSpiralBezier:{available:Boolean(bezierPipelineMax&&bezierPipelineOver)'),'Bézier telemetry missing');
  assert.ok(app.includes('bezierBufferRecords.clear();bezierGeometryCache=new WeakMap()'),'Bézier GPU resources must be reset after device loss');
}


// Somata 6.6 regression: Spiral Morph defaults, counter-rotation and phase continuity.
{
  const stateSrc=read('js/core/state.js');
  const app=read('js/legacy/app-c.js');
  const motion=read('js/effects/motion.js');
  const morph=read('js/geometry/morph.js');
  const html=read('index.html');
  assert.ok(stateSrc.includes("spiralMorphType: 'phaseCircle'"),'Phase-circle Spiral Morph must be the state default');
  assert.ok(stateSrc.includes('spiralRotationCompensation: false'),'Spiral rotation compensation must default off');
  assert.ok(html.includes('id="morphSpiralMorphType"')&&html.includes('<option value="phaseCircle" selected>Фазово-окружностный</option>'),'Phase-circle selector default missing');
  assert.ok(html.includes('id="morphSpiralRotationCompensation" type="checkbox"')&&!html.includes('id="morphSpiralRotationCompensation" type="checkbox" checked'),'Rotation compensation checkbox must default off');
  assert.ok(html.includes('morph-spiral-row-primary')&&html.includes('morph-spiral-row-secondary'),'Spiral Morph settings must be split into two rows');
  assert.ok(app.includes("morphSpiralRotationCompensation: state.morph.spiralRotationCompensation === true"),'Rotation compensation UI sync missing');
  assert.ok(app.includes("spiralRotationCompensation: state.morph.spiralRotationCompensation === true"),'Rotation compensation persistence missing');
  assert.ok(motion.includes('function getSpiralMorphRotationCompensationRadians()'),'Canvas counter-rotation helper missing');
  assert.ok(motion.includes('return -degrees*Math.PI/180'),'Canvas must rotate opposite the accumulated spiral-layer rotation');
  assert.ok(morph.includes('const preserveSpiralPhaseEndpoints ='),'Spiral phase endpoint-order continuity guard missing');
  assert.ok(morph.includes("? (minimalTurnSpiral ? 'minimalSpiral' : 'phase')"),'Spiral phase continuity must preserve endpoint order, including Minimal Turn');
  assert.ok(morph.includes('options.spiralDirectionOverride=sdir+(tdir-sdir)*geometryT'),'Signed spiral winding must interpolate continuously');
  assert.ok(morph.includes('options.spiralExponentOverride=Math.max(0,Math.abs(so)+(Math.abs(to)-Math.abs(so))*geometryT)'),'Spiral radial exponent must interpolate independently of winding sign');
}

// Somata 6.6 hotfix: stopping Spiral Morph must not leave detached edge profiles.
{
  const appA=read('js/legacy/app-a.js');
  const appC=read('js/legacy/app-c.js');
  assert.ok(appA.includes('const dir = Number.isFinite(rawDirection) ? Math.max(-1, Math.min(1, rawDirection)) : 1;'),'Morph spiral direction must remain continuous instead of quantising to -1/0/+1');
  assert.ok(appC.includes('layer.closedLoop = layer.spiralEnabled ? false : (visual.closedLoop !== false);'),'Spiral boundary commit must restore non-spiral contour closure');
  assert.ok(appC.includes('sourceSpiralOn !== targetSpiralOn'),'Spiral frame transition must explicitly handle closure when Spiral mode toggles');
  assert.ok(appC.includes("invalidateLayerGeometry(layer,'morph-stop-restore')"),'Morph Stop must invalidate restored static geometry');
}

// Somata 6.6 performance hotfix: Spiral Morph must stay GPU-resident through the
// Layer/Frame Scene, and Stop must park GPU resources while rolling back to canonical state.
{
  const appA=read('js/legacy/app-a.js');
  const appC=read('js/legacy/app-c.js');
  const pipe=read('js/render/main-pipeline.js');
  const spiral=read('js/gpu/spiral-bezier-morph-renderer.js');
  assert.ok(appA.includes('function getExternalLayerSceneTarget(frameId=0)'),'Shared GPU Layer Scene target API missing');
  assert.ok(pipe.includes('function canUseGpuSpiralBezierLayerScene(frameCtx,allowHiddenGraffitiCarrier=false)'),'Spiral Morph Layer Scene eligibility missing');
  assert.ok(pipe.includes('function resolveGpuSpiralBezierSceneRoute(frameCtx,allowHiddenGraffitiCarrier=false)')&&pipe.includes('resident&&canUseGpuSpiralBezierLayerScene(frameCtx,allowHiddenGraffitiCarrier)')&&pipe.includes('return{deferLayerScene:true,deferFrameScene:false,resident:true}'),'Spiral Morph must join an already-resident shared Layer Scene before considering a new external root or direct Frame Scene');
  assert.ok(spiral.includes("deferExternalLayerScene?.(cmd,frameCtx.frameId,'spiral-bezier-morph')"),'Spiral Morph must defer its command buffer into the shared GPU scene');
  assert.ok(spiral.includes('rec.copyBuffer'),'Spiral Morph Corridor/copy data must be per-layer resident for deferred submission');
  assert.ok(spiral.includes('rec.uniformBase')&&spiral.includes('rec.uniformGlow'),'Deferred Spiral Morph uniforms must be per-layer resident');
  assert.ok(spiral.includes('function park(reason=\'stopped\')'),'Cheap Stop GPU resource park missing');
  assert.ok(appC.includes("parkGpuSpiralBezierMorphResources?.('stop-stable-rollback')"),'Stop must park GPU resources instead of destroying them synchronously');
  assert.ok(!appC.slice(appC.indexOf('const stopMorphing ='),appC.indexOf('activeStopMorphing = stopMorphing')).includes("invalidateGpuSpiralBezierMorphResources?.('stop')"),'Stop must not synchronously destroy Spiral GPU resources');
  assert.ok(spiral.includes('stats.auxHits++'),'Repeated CPU auxiliary path requests in the same Morph frame must be cached');
  assert.ok(spiral.includes("const hiddenGraffitiGlow=mode==='glow'")&&spiral.includes("frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiGlow"),'Graffiti must hide Base without making Spiral carrier Glow ineligible');
  assert.ok(pipe.includes('base-intentionally-suppressed-by-graffiti')&&pipe.includes('Base intentionally replaced by GPU Graffiti'),'Graffiti Base replacement must be an intentional FullGPU contract, not a Base failure');
  assert.ok(pipe.includes('Graffiti hides Base and now defers its contour Glow')&&pipe.includes("beginExternalLayerScene?.(frameCtx.frameId,'strict-spiral-effects')"),'Graffiti contour Glow must receive a transparent FullGPU LayerScene root before the Profile pass');
  assert.ok(appA.includes('function tunnelMasterStrokeSignature(frameCtx,allowHiddenGraffitiCarrier=false)')&&appA.includes('(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)'),'Static Corridor master must allow the hidden Graffiti carrier only when explicitly requested');
  assert.ok(pipe.includes('canUseGpuOnlyCorridorLayerScene(frameCtx,hiddenGraffitiCarrier)')&&pipe.includes('canUseGpuSpiralBezierLayerScene(frameCtx,hiddenGraffitiCarrier&&frameCtx.morphFrameActive===true)'),'Multi-layer FullGPU join guard must recognize the hidden Graffiti Spiral carrier instead of stalling before Glow');
}

// Somata 6.6 regression: Spiral layer-count limits are Morph-only, and canvas
// rotation compensation is explicitly mode-specific.
{
  const app=read('js/legacy/app-c.js');
  const motion=read('js/effects/motion.js');
  assert.ok(app.includes("return runtimeState?.morph?.active === true &&\n                (state.morph?.options?.bySpiralLayers === true || state.morph?.options?.bySpiralOrder === true);"),
    'Spiral Morph options must not constrain manual spiral authoring while Morph is stopped');
  assert.ok(app.includes("runtimeState?.morph?.active !== true || state.morph.options.bySpiralLayers !== true"),
    'Spiral layer min/max target selection must be gated by active Morph playback');
  assert.ok(app.includes("if(type==='torn')")&&app.includes("if(type==='continuous')")&&app.includes("if(type==='phaseCircle')")&&app.includes("if(type==='minimalTurn')")&&app.includes("if(type==='phase')"),
    'Rotation compensation must have distinct policies for all Spiral Morph modes');
  assert.ok(app.includes('estimateCirclePlanRotationDeltaDegrees(sourceLayer,targetLayer)'),
    'Phase-circle compensation must derive its angular component from the circle correspondence plan');
  assert.ok(app.includes('sx+=Math.cos(d);sy+=Math.sin(d);count++;'),
    'Phase-circle compensation must use a circular mean across the +/-180 degree seam');
  assert.ok(app.includes('spiralHalfStepPhaseDegrees(sourceLayer)')&&app.includes('spiralHalfStepPhaseDegrees(targetLayer)'),
    'Phase compensation must include spiral step-phase drift');
  assert.ok(app.includes('commitSpiralMorphRotationCompensationProgress(1);'),
    'Completed phase compensation must accumulate across phase boundaries');
  assert.ok(app.includes('commitSpiralMorphRotationCompensationProgress(Number.isFinite(Number(runtimeState.morph.geometryT))'),
    'Rebased phases must preserve the current fraction of rotation compensation');
  assert.ok(!motion.includes("morph?.options?.byRotation!==true"),
    'Spiral compensation must not be disabled when explicit layer-rotation morphing is off');
  assert.ok(motion.includes('const degrees=base+phase*t;'),
    'Canvas counter-rotation must combine completed-phase and current-phase compensation');
}

// Local Glow/Graffiti regression: Blue Morph must not own Glow, and Graffiti Glow
// must prefer the exact already-prepared ribbon paths instead of an independent carrier.
{
  const app=read('js/legacy/app-c.js');
  const pipe=read('js/render/main-pipeline.js');
  assert.ok(app.includes("if(root==='glow'||root==='glowMultiplier'||root==='glowIntensity'||root==='glowIntensityMultiplier')return false;"),
    'Glow controls must remain live/authored while Blue Morph runs');
  assert.ok(app.includes('glow: Math.max(0, Number(layer.glow) || 0),'),
    'Blue Morph targets must preserve authored Glow instead of randomizing it');
  assert.ok(!app.includes('snap.glow = srcV.glow + (dstV.glow - srcV.glow) * t;')&&!app.includes('layer.glow = srcV.glow + (dstV.glow - srcV.glow) * t;'),
    'Blue Morph frame updates must not interpolate Glow');
  const commitStart=app.indexOf('const BLUE_FRAME_COMMIT_KEYS=Object.freeze([');
  const commitEnd=app.indexOf(']);',commitStart);
  assert.ok(commitStart>=0&&commitEnd>commitStart&&!app.slice(commitStart,commitEnd).includes("'glow'"),
    'Blue Morph boundary commit must not own Glow');
  const ribbon=read('js/gpu/graffiti-ribbon-renderer.js');
  assert.ok(ribbon.includes('const WebGPUGraffitiContourGlow=(()=>{')&&ribbon.includes('exact Graffiti ribbon / contour -> GPU mask -> separable WebGPU blur'),
    'Graffiti Glow must be a GPU blur of the exact ribbon mask');
  assert.ok(ribbon.includes('function encodeGlowToLayerScene(')&&ribbon.includes('function encodeCorridorGlowToLayerScene('),
    'Static/Corridor Graffiti contour Glow encoders missing');
  assert.ok(pipe.includes('Graffiti contour Glow deferred to exact GPU ribbon')&&pipe.includes('exact Graffiti ribbon contour Glow'),
    'Graffiti Glow must be encoded beside the exact profile ribbon');
  assert.ok(!pipe.includes('function getGraffitiProfileLockedGlowCommands(frameCtx)')&&!pipe.includes('Graffiti profile-locked analytic glow'),
    'Historical thin-centreline Graffiti Glow fallback must stay removed');
}

// Local Graffiti defaults/reset/variation/corner regression: authored defaults stay neutral
// except for the requested 45° marker angle. Zero/off variation must not switch geometry into
// a segmented variation path. The plain pointed nib must reproduce the legacy Canvas nib-space
// stroke: constant support along each straight span and miterLimit 2.6 -> bevel on sharp joins.
{
  const html=read('index.html');
  const defaults=read('js/core/defaults-layers.js');
  const appB=read('js/legacy/app-b.js');
  const appC=read('js/legacy/app-c.js');
  const morphGraffiti=read('js/gpu/graffiti-morph-renderer.js');
  const graffitiPass=read('js/render/graffiti-pass.js');
  const renderGraph=read('js/render/render-graph.js');
  assert.ok(defaults.includes('graffitiAngle: 45,'),'Graffiti marker angle must default to 45°');
  assert.ok(defaults.includes('graffitiNibLength: 10,'),'Graffiti stroke length must default to 10');
  assert.ok(defaults.includes('graffitiSizeVariationEnabled: false,')&&defaults.includes('graffitiSizeVariation: 0,'),'Graffiti size variation must default off at 0');
  assert.ok(defaults.includes('graffitiRotationVariationEnabled: false,')&&defaults.includes('graffitiRotationVariation: 0,'),'Graffiti rotation variation must default off at 0');
  assert.ok(html.includes('id="graffitiAngle" type="range" min="-90" max="90" step="1" value="45"'),'Graffiti angle slider launch value must be 45°');
  assert.ok(html.includes('id="graffitiNibLength" type="range" min="1" max="20" step="0.25" value="10"'),'Graffiti stroke-length slider launch value must be 10');
  assert.ok(html.includes('data-reset-scope="graffitiAngle"')&&html.includes('data-reset-scope="graffitiNibLength"'),'Graffiti angle and stroke length must have independent reset scopes');
  assert.ok(appC.includes("label.closest('[data-reset-scope]')||label.closest('.control-row,.tunnel-setting,.morph-setting-row')"),'Double-click reset must prefer explicit local scopes');
  assert.ok(appB.includes("if(typeof layer.graffitiSizeVariationEnabled!=='boolean')layer.graffitiSizeVariationEnabled=false;")&&appB.includes("if(typeof layer.graffitiRotationVariationEnabled!=='boolean')layer.graffitiRotationVariationEnabled=false;"),'Legacy/missing Graffiti variation toggles must normalize off');
  assert.ok(appB.includes("layer?.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer?.graffitiSizeVariation)||0)>0")||appB.includes("layer.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer.graffitiSizeVariation)||0)>0"),'Static Graffiti must only activate size variation for a nonzero authored amount');
  assert.ok(graffitiPass.includes('sizeVariation=layer.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer.graffitiSizeVariation)||0)>0'),'Morph Graffiti sampler must stay on the plain path for zero/off size variation');
  assert.ok(renderGraph.includes('graffitiSizeVariation=layer?.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer?.graffitiSizeVariation)||0)>0'),'Render graph must not request variation geometry for a zero size amount');
  assert.ok(appB.includes("if(mode==='perSegment'||mode==='everyNth')")&&appB.includes("if(mode==='across')")&&appB.includes("if(mode==='whole')")&&appB.includes('// perPath: one complete variation cycle for each contour.'),'Graffiti size variation must preserve distinct per-segment/every-N/across/per-path/whole mode plans');
  assert.ok(appB.includes('chain:chainId')&&read('js/gpu/graffiti-ribbon-renderer.js').includes('buildGraffitiVariableRibbonBridgeMesh(prev,item'),'Split segment/group variation pieces must be re-joined without corner gaps');
  assert.ok(appB.includes('function buildGraffitiPlainPointedRibbonMesh(')&&appB.includes('miterLimit=2.6')&&appB.includes('Canvas miterLimit fallback is bevel'),'Static pointed Graffiti must use constant-width nib-space stroke joins with the legacy miter limit');
  assert.ok(appB.includes("if(nibShape==='pointed'&&angleMode!=='relative'&&Math.abs(Number(sizeStrength)||0)<=1e-9&&Math.abs(Number(rotationTotal)||0)<=1e-9)"),'Zero/off pointed Graffiti must take the neutral plain-nib geometry path');
  assert.ok(!morphGraffiti.includes('both neighbouring spans must use the same averaged tangent')&&morphGraffiti.includes('Do not average authored corner tangents')&&morphGraffiti.includes('abs(mlen)/max(0.000001,half)<=2.6'),'Morph Graffiti must keep per-span nib support neutral and close authored joins with the same miter-limit rule');

  const helperStart=appB.indexOf('        function buildGraffitiPlainPointedRibbonMesh(');
  const helperEnd=appB.indexOf('\n        function buildGraffitiVariableRibbonMesh(',helperStart);
  assert.ok(helperStart>=0&&helperEnd>helperStart,'Graffiti plain pointed mesh helper source not found');
  const sandbox={Math,Float32Array,Float64Array,graffitiNibStretch:()=>10,graffitiNibWidthFactor:()=>1};vm.createContext(sandbox);vm.runInContext(appB.slice(helperStart,helperEnd),sandbox);
  const square={closed:true,points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]};
  const mesh=sandbox.buildGraffitiPlainPointedRibbonMesh(square,2,'slash',Math.PI/4,10,'pointed');
  assert.ok(mesh&&mesh.length===60*9,'45°/ratio-10 square must apply the legacy 2.6 miter limit (two miter joins + two bevel fallbacks) without tapering straight spans');
  const stride=9,l0=[mesh[0],mesh[1]],l1=[mesh[2*stride],mesh[2*stride+1]];
  assert.ok(Math.abs((l0[0]-0)-(l1[0]-100))<1e-5&&Math.abs((l0[1]-0)-(l1[1]-0))<1e-5,'Zero variation must keep identical support at both ends of a straight segment');
}


// Somata 7.0.13 GPU purity regression: contour Glow adds a second deferred Graffiti draw,
// so vertex uploads must never alias inside one frame. Corridor Fill and GPU lamps may not
// silently fall back to Canvas while their GPU modes are requested.
{
  const ribbon=read('js/gpu/graffiti-ribbon-renderer.js');
  const fillPlan=read('js/render/fill-plan.js');
  const kernel=read('js/geometry/kernel.js');
  const pipe=read('js/render/main-pipeline.js');
  const appA=read('js/legacy/app-a.js');
  assert.ok(ribbon.includes('acquireFrameSafeVertexBuffer')&&ribbon.includes('slot.lastFrameId!==frameId')&&ribbon.includes('no same-frame vertex-buffer reuse before deferred queue.submit'),
    'Graffiti Glow+core deferred draws must use frame-safe vertex-buffer residency');
  assert.ok(fillPlan.includes("if (!layer?.fill || plan.dynamic === true || isSpiralLayer(layer))")&&!fillPlan.includes("isSpiralLayer(layer) || state.tunnel?.active === true"),
    'Static Corridor Fill must be eligible for native GPU stencil preparation');
  assert.ok(kernel.includes('nativeGpuFillEligible')&&kernel.includes('exactCanvasFillRequired:fillRequested&&!gpuMaskEligible&&!nativeGpuFillEligible'),
    'Geometry contract must recognize native WebGPU Corridor Fill instead of demanding Canvas');
  assert.ok(appA.includes("if(mesh?.fanData?.length)")&&appA.includes('encodeCorridorCommandToTexture')&&appA.includes('webgpu-mesh-corridor-layer-scene'),
    'Native Fill renderer must consume the current canonical fan plan and encode Corridor copies into the Layer Scene');
  assert.ok(pipe.includes("'corridor-native-fill'")&&pipe.includes('Canvas fallback blocked; waiting for native WebGPU Fill'),
    'Corridor Fill must wait diagnostically for WebGPU instead of falling through to Canvas');
  assert.ok(pipe.includes("const gpuRequested=!forceCpuLamps&&drawPlan.config?.webgl!==false&&drawPlan.config?.rasterized!==true")&&pipe.includes("'GPU lamps unavailable; Canvas fallback blocked'"),
    'Requested GPU lamps must not silently fall back to Canvas');
  assert.ok(!pipe.includes("renderBackendTelemetry.mark('lamps','canvas','Canvas lamp fallback'"),
    'Historical Canvas lamp fallback must remain removed from GPU-requested lamp rendering');
}

// Compact authored-size controls: pixel sliders stay precise (<= 50 base units) and
// use explicit right-side multipliers for larger effective values. Geometry N uses
// the same interaction model with a 30-vertex base slider while canonical N remains 2..120.
{
  const html=read('index.html');
  const defaults=read('js/core/defaults-layers.js');
  const appB=read('js/legacy/app-b.js');
  const appC=read('js/legacy/app-c.js');
  const pathFx=read('js/gpu/path-fx-renderer.js');
  const particleGpu=read('js/gpu/particle-renderer.js');
  for(const id of ['lineMotionFxAmplitude','lineMotionFxWavelength','lampRadius','sweepGlow','sweepLightningGlow','particleSpiralRadius','paramStrokeWidth']){
    const m=html.match(new RegExp(`id="${id}"[^>]*max="([0-9.]+)"`));
    assert.ok(m&&Number(m[1])<=50,`${id} base slider must be <= 50`);
  }
  assert.ok(html.includes('id="lineMotionFxAmplitudeMultiplier"')&&html.includes('id="lineMotionFxWavelengthMultiplier"'),'Line Motion pixel controls need right-side multipliers');
  assert.ok(html.includes('id="particleSpiralRadiusMultiplier"'),'Particle Z radius needs a right-side multiplier');
  assert.ok(html.includes('id="paramN" min="2" max="30"')&&html.includes('id="paramNMultiplier"')&&html.includes('id="valNEffective"'),'Geometry N must use 2..30 base + multiplier + effective readout');
  assert.ok(defaults.includes('amplitudeMultiplier:1')&&defaults.includes('wavelengthPx:36, wavelengthMultiplier:2'),'Line Motion defaults must preserve the historical effective 72 px wavelength through compact controls');
  assert.ok(pathFx.includes('mc.amplitudeMultiplier')&&pathFx.includes('mc.wavelengthMultiplier'),'GPU Path FX must use effective base × multiplier values');
  assert.ok(defaults.includes('spiralRadiusMultiplier:1')&&particleGpu.includes('cfg.spiralRadiusPx*cfg.spiralRadiusMultiplier'),'GPU particles must use compact Z radius base × multiplier');
  assert.ok(appB.includes('if(c.glow>50)')&&appB.includes('if(c.lightningGlow>50)')&&appB.includes('if(base>50){const effective=base*mult'),'Legacy large Glow/lamp values must migrate without changing effective size');
  assert.ok(appC.includes('function syncGeometryNControl(')&&appC.includes('geometryNEffectiveFromBase'),'Geometry N compact UI must map back to canonical effective vertex count');
}

// Spectral Glint must make exactly one seam-safe lap per authored cycle / Lightning preflash.
// It may not run from an independent wall-clock angular-speed phase or wrap the active sector
// through the start seam onto geometry that was already visited during the same lap.
{
  const sweepPass=read('js/render/sweep-pass.js');
  const appB=read('js/legacy/app-b.js');
  const bezier=read('js/gpu/bezier-sweep-renderer.js');
  assert.ok(sweepPass.includes('spectralCycleLocked:true')&&sweepPass.includes('spectralProgress:progress'),
    'Retained-GPU Spectral Glint must carry cycle-locked progress');
  assert.ok(sweepPass.includes('prepareSharedTopologySpectralBezier(frameCtx,cfg,now,true,lightningVector.prechargeT)')&&sweepPass.includes('prepareSharedTopologySpectralBezier(frameCtx,cfg,now,false,phase)'),
    'Spectral standalone and Lightning preflash must use their own normalized cycle progress');
  assert.ok(appB.includes('buildBezierGlintPrepared(frameCtx,lightningPaths,spectralCfg,data.lightningVector.prechargeT'),
    'CPU-retained Spectral Lightning path must follow precharge progress instead of wall-clock time');
  assert.ok(!appB.includes("*.001*speedDeg*Math.PI/180")&&!sweepPass.includes("*.001*speedDeg*Math.PI/180"),
    'Spectral position must not be derived from absolute wall-clock degrees/second');
  assert.ok(bezier.includes('let tail=max(0.0,head-span)')&&bezier.includes('Deliberately no modulo-wrap of [tail, head]'),
    'WebGPU Spectral mask must clamp at the cycle seam instead of wrapping onto visited geometry');
}


// Graffiti Glint/Lightning ordering + profile contract.  Shared Glint/preflash must use the
// exact Graffiti ribbon (including Marker Angle) and all post-profile effects must remain above
// a Graffiti WebGPU overlay instead of falling back to the lower main canvas.
{
  const sweep=read('js/render/sweep-pass.js');
  const ribbon=read('js/gpu/graffiti-ribbon-renderer.js');
  const appB=read('js/legacy/app-b.js');
  assert.ok(sweep.includes('makeGraffitiSweepPrepared')&&sweep.includes('WebGPUGraffitiRibbonRenderer.encodeToLayerScene')&&sweep.includes('{width:vis.width,color:vis.color}'),
    'Graffiti Glint core must be rasterized by the exact Graffiti ribbon renderer with the authored sweep width/color');
  assert.ok(sweep.includes('encodeGlowToLayerScene')&&sweep.includes('radiusPx:vis.glowSize')&&sweep.includes('softness:vis.softness'),
    'Graffiti Glint Glow must be generated from the same ribbon contour and preserve Glow size/softness');
  assert.ok(sweep.includes('GRAFFITI_SWEEP_GLOW_PHASE=40,GRAFFITI_SWEEP_CORE_PHASE=41'),
    'Graffiti Glint must composite after Graffiti Glow/core phases 19/20');
  assert.ok(ribbon.includes('getActiveOverlayTarget')&&ribbon.includes('submitOverlayEffect')&&sweep.includes('renderSweepOnActiveGraffitiOverlay'),
    'Glint/Lightning must join the active Graffiti WebGPU overlay when Graffiti is physically above mainCanvas');
  assert.ok(ribbon.includes('overlayCurrentTexture')&&ribbon.includes('item?.bridgeFromPrevious!==false'),
    'Post-Graffiti effects must share one stable overlay texture and disjoint Glint pieces must not receive accidental ribbon bridges');
  assert.ok(appB.includes('cubicBreaks=new Uint8Array')&&appB.includes('cubicBreaks,cubicCount:cubics.length'),
    'Bézier Glint must preserve contour breaks when rebuilt as a calligraphic Graffiti profile');
}
