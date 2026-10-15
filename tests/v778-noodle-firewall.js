const vm=require('vm');
const {read,assert,test}=require('./lib/test-utils');
let ok=true;
const main=read('js/render/main-pipeline.js');
const registry=read('js/render/pass-registry.js');
const owner=read('js/render/effect-owner-service.js');
const contract=read('js/render/compositor-contract.js');
const geom=read('js/render/geometry-executor.js');

ok=test('7.7.8 main compositor does not name optional effect pass implementations',()=>{
  for(const token of [
    'renderLayerWebPass','prepareRetainedFillSceneBeforeGlow','renderLayerGlowPass','renderLayerBaseGeometryPass',
    'renderLayerOutlinePass','renderLayerProfilePass','renderLayerLampPass','renderLayerMotionFxPass',
    'renderLayerSweepPass','renderLayerSpritePass','renderLayerParticlePass','preflightLayerPathFxReplacement',
    'stabilizeWebUnderBaseStack'
  ]) assert(!main.includes(token),`main-pipeline still owns/calls ${token}`);
  assert(main.includes('SomataRenderPassRegistry.runStage'),'main compositor does not execute generic pass stages');
  assert(main.includes('SomataRenderPassRegistry.runHooks'),'main compositor does not execute generic hooks');
})&&ok;

ok=test('7.7.8 shared render helpers no longer originate in main-pipeline',()=>{
  for(const token of ['function liveEffectOwnerForFrameLayer','function liveGraffitiStyleLayerForFrame','function isPathFxBaseReplacementActive','function shouldForceCanvasBaseStroke','function resetMainLayerGeometryPlan','function executeMainLayerGeometryPlan'])
    assert(!main.includes(token),`main-pipeline still exports leaf dependency ${token}`);
  assert(owner.includes('SomataEffectOwnerService'),'effect owner service missing');
  assert(contract.includes('SomataCompositorContract'),'compositor contract missing');
  assert(geom.includes('function executeMainLayerGeometryPlan'),'geometry executor did not take geometry execution ownership');
})&&ok;

ok=test('7.7.8 effect-owner service is renderer neutral',()=>{
  for(const token of ['WebGPU','Spiral','Lightning','Glow','FillGPURenderer','SomataRenderPassRegistry','mainCtx'])
    assert(!owner.includes(token),`effect owner service leaked ${token}`);
})&&ok;

ok=test('7.7.8 pass registration preserves physical 7.5-compatible order without main edits',()=>{
  const files={
    web:'web-pass.js',fill:'fill-pass.js',glow:'glow-pass.js',base:'base-pass.js',outline:'outline-pass.js',profile:'profile-pass.js',lamps:'lamp-pass.js',motion:'path-fx-pass.js',sweep:'sweep-pass.js',sprite:'path-fx-pass.js',particles:'particle-pass.js'
  };
  for(const [name,file] of Object.entries(files)){
    const src=read('js/render/'+file);assert(src.includes(`register?.('${name}'`),`${name} does not self-register its executable pass`);
  }
  assert(read('js/render/path-fx-pass.js').includes("registerHook?.('beforeLayer'"),'Path FX preflight is not a module-owned hook');
  assert(read('js/render/geometry-scene-routing.js').includes("registerHook?.('afterStrokeBatch'"),'Web stack stabilization is not a routing-owned hook');
})&&ok;

ok=test('7.7.8 pass registry orders plugins independently from compositor source',()=>{
  const sandbox={window:{__spiroRegisterModule:()=>{}},console};sandbox.window.window=sandbox.window;
  vm.createContext(sandbox);vm.runInContext(registry,sandbox);const r=sandbox.window.SomataRenderPassRegistry;
  const seen=[];r.register('unitB',{stage:r.STAGES.POST_BASE,order:20,run:()=>seen.push('B')});r.register('unitA',{stage:r.STAGES.POST_BASE,order:10,run:()=>seen.push('A')});
  r.runStage(r.STAGES.POST_BASE,{},row=>row.run());
  assert(seen.join(',')==='A,B','registry stage ordering is not deterministic');
})&&ok;

ok=test('7.7.8 geometry executor is not coupled to optional pass implementations or Master',()=>{
  for(const token of ['renderLayerWebPass','renderLayerGlowPass','renderLayerSweepPass','renderLayerLampPass','renderLayerParticlePass','masterLayerEdit','SomataMasterBroadcast'])
    assert(!geom.includes(token),`geometry executor leaked optional/UI dependency ${token}`);
})&&ok;

ok=test('7.7.8 main-pipeline is materially smaller and remains orchestration-only at effect boundary',()=>{
  const lines=main.split(/\n/).length;
  assert(lines<950,`main-pipeline still too large after extraction: ${lines} lines`);
  assert(!/runPass\('(web|fill|glow|base|outline|profile|lamps|motion|sweep|sprite|particles)'/.test(main),'main has a hard-coded pass list');
})&&ok;

if(!ok)process.exit(1);
