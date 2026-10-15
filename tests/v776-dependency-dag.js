const {read,assert,test}=require('./lib/test-utils');
let ok=true;
const main=read('js/render/main-pipeline.js');
const fill=read('js/render/fill-pass.js');
const spiralFill=read('js/render/spiral-fill-adapter.js');
const morph=read('js/render/morph-provider-service.js');
const circles=read('js/render/geometry-circles-pass.js');
const diag=read('js/render/render-diagnostics.js');
const master=read('js/ui/master-broadcast-core.js');

ok=test('7.7.6 main pipeline is an orchestrator, not owner of diagnostics/morph/circle algorithms',()=>{
  for(const token of ['function somataGpuDiagnosticError','function somataGpuContractError','function computeLayerGeometryCircles','function prepareMorphProviderFrameSnapshot','function resolveBlueMorphLayerProvider'])
    assert(!main.includes(token),`main pipeline still owns ${token}`);
  assert(main.includes('SomataMorphProviderService.prepareFrameSnapshot'),'main does not consume Morph provider service');
  assert(main.includes('SomataRenderPassRegistry.runStage'),'main does not execute generic registered render stages');
  assert(read('js/render/fill-pass.js').includes("register?.('fill'"),'Fill pass is not self-registered');
})&&ok;

ok=test('7.7.6 Fill core has no Spiral/Morph implementation knowledge',()=>{
  for(const token of ['isSpiralLayer','getGpuSpiralBezierMorphAuxPaths','blueMorphProvider','runtimeState?.morph','WebGPUSpiralBezierMorphRenderer'])
    assert(!fill.includes(token),`fill core leaked geometry-family dependency ${token}`);
  assert(fill.includes("SomataFillGeometryAdapter.query('directMesh'"),'Fill core does not query semantic geometry adapter');
  assert(fill.includes("SomataFillGeometryAdapter.query('corridorMesh'"),'Corridor Fill bypasses geometry adapter');
})&&ok;

ok=test('7.7.6 Spiral Fill coupling lives in one adapter module',()=>{
  assert(spiralFill.includes("SomataFillGeometryAdapter.register('spiral'"),'Spiral Fill adapter is not registered');
  assert(spiralFill.includes('getGpuSpiralBezierMorphAuxPaths'),'Spiral adapter does not own retained rail translation');
  assert(spiralFill.includes('prepareSpiralMorphBands'),'Spiral adapter does not own Morph Fill mesh creation');
})&&ok;

ok=test('7.7.6 Morph provider construction is isolated from optional effects',()=>{
  for(const token of ['WebGPUWeb','WebGPULightning','FillGPURenderer','WebGPUGraffiti','LampGPURenderer','ParticleRenderer'])
    assert(!morph.includes(token),`Morph provider service leaked optional renderer ${token}`);
  assert(morph.includes('resolveBlueMorphLayerProvider')&&morph.includes('resolveOrangeMorphLayerProvider')&&morph.includes('resolveGreenMorphLayerProvider'),'Morph provider service missing geometry systems');
})&&ok;

ok=test('7.7.6 geometry-circle implementation is outside main/effects',()=>{
  assert(circles.includes('computeLayerGeometryCircles')&&circles.includes('renderLayerGeometryCirclesPass'),'geometry-circle module incomplete');
  for(const token of ['WebGPUWeb','WebGPULightning','FillGPURenderer','WebGPUGraffiti','LampGPURenderer'])assert(!circles.includes(token),`geometry circles leaked optional effect ${token}`);
})&&ok;

ok=test('7.7.6 shared diagnostics are independent from main pipeline',()=>{
  assert(diag.includes('SomataRenderDiagnostics'),'render diagnostics service missing');
  assert(!diag.includes('renderPreparedMainLayer')&&!diag.includes('prepareMainRenderFrame'),'diagnostics imports compositor implementation');
  assert(!main.includes('somataGpuDiagnosticSignatures')&&!main.includes('somataFullGpuDiag'),'main still stores global diagnostic state');
})&&ok;

ok=test('Master remains completely outside the render dependency DAG',()=>{
  for(const token of ['SomataFeatureHost','SomataFillGeometryAdapter','SomataMorphProviderService','WebGPU','main-pipeline','geometryPlan'])assert(!master.includes(token),`Master leaked render dependency ${token}`);
})&&ok;

if(!ok)process.exit(1);
