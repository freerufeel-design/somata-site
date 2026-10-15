const vm=require('vm');
const {read,assert,test}=require('./lib/test-utils');
let ok=true;
const hostSrc=read('js/render/feature-host.js');
const scene=read('js/render/layer-scene-service.js');
const policy=read('js/render/compositor-policy.js');
const lifecycle=read('js/render/feature-lifecycle.js');
const fill=read('js/render/fill-pass.js');
const main=read('js/render/main-pipeline.js');
const passFiles=['base-pass.js','fill-pass.js','glow-pass.js','outline-pass.js','profile-pass.js','lamp-pass.js','path-fx-pass.js','sweep-pass.js','particle-pass.js','web-pass.js','graffiti-pass.js'];

ok=test('7.7.3 compositor policy is capability-based, not effect-aware',()=>{
  assert(policy.includes("'sceneAdmission'"),'compositor policy does not query sceneAdmission capability');
  assert(policy.includes('SomataFeatureHost?.queryAll'),'compositor policy bypasses feature capability registry');
  for(const token of ['WebGPUWeb','WebGPULightning','SweepGPURenderer','WebGPUGraffiti','WebGPUProfile','WebGPUParticle','LampGPURenderer'])assert(!policy.includes(token),`compositor policy knows concrete effect renderer ${token}`);
})&&ok;

ok=test('Layer Scene service owns mechanics only, not effect admission rules',()=>{
  for(const token of ['canBridgeWebIntoLayerScene','canBridgeSweepIntoLayerScene','canBridgeProfileIntoLayerScene','canBridgeOutlineIntoLayerScene','WebGPUWeb','WebGPULightning','SweepGPURenderer','WebGPUGraffiti','WebGPUProfile','WebGPUPathFx'])assert(!scene.includes(token),`Layer Scene service leaked effect dependency ${token}`);
  assert(scene.includes('markDeferred')&&scene.includes('markPresented')&&scene.includes('resetDeferred'),'Layer Scene state mutation API missing');
})&&ok;

ok=test('feature passes cannot mutate shared frame state directly',()=>{
  for(const f of passFiles){
    const src=read(`js/render/${f}`);
    assert(!/frameCtx\.frame(?:\?\.)?\.[A-Za-z0-9_]+\s*=/.test(src),`${f} writes frameCtx.frame directly`);
    for(const low of ['beginExternalLayerScene','deferExternalLayerScene','getExternalLayerSceneTarget','getDeferredLayerSceneTexture','queueLayerSceneEffectCommand'])assert(!src.includes(low),`${f} bypasses scene service via ${low}`);
  }
})&&ok;

ok=test('Fill consumes geometry capability and never selects Spiral renderer',()=>{
  for(const token of ['WebGPUSpiralBezierMorphRenderer','WebGPUTopologyMorphBaseRenderer','WebGPUGreenProjectMorphRenderer'])assert(!fill.includes(token),`Fill depends on concrete geometry renderer ${token}`);
  assert(fill.includes('SomataFillGeometryAdapter.query'),'Fill does not use semantic geometry adapter');
  assert(fill.includes('SomataGeometryRoleService.isStrict'),'Fill does not ask generic geometry strictness capability');
})&&ok;

ok=test('feature capability registry isolates admission knowledge inside each pass',()=>{
  const sandbox={window:{__spiroRegisterModule:()=>{}},console:{error:()=>{}}};sandbox.window.window=sandbox.window;
  vm.createContext(sandbox);vm.runInContext(hostSrc,sandbox);
  const host=sandbox.window.SomataFeatureHost;assert(host,'feature host missing');
  host.register('unit773',{outputs:[]});host.provide('unit773','sceneAdmission',(ctx,effect)=>Boolean(ctx?.ready&&effect?.enabled));
  assert(host.query('unit773','sceneAdmission',{ready:true},{enabled:true})===true,'capability query failed');
  assert(host.query('unit773','sceneAdmission',{ready:false},{enabled:true})===false,'capability result ignored');
  assert(host.query('unit773','missing',{})===undefined,'missing capability should be undefined');
  host.register('broken773',{outputs:[]});host.provide('broken773','sceneAdmission',()=>{throw new Error('boom');});
  const rows=host.queryAll('sceneAdmission',{ready:true},{enabled:true});
  const broken=rows.find(r=>r.name==='broken773');assert(broken&&broken.error==='boom','capability failure escaped feature boundary');
})&&ok;

ok=test('main pipeline remains unaware of concrete feature and geometry renderers',()=>{
  for(const token of ['WebGPUWebMorphRenderer','WebGPUWebThreadSceneRenderer','WebGPULightningArcRenderer','SweepGPURenderer','WebGPUParticleRenderer','WebGPUPathFxRenderer','WebGPUGraffitiRibbonRenderer','WebGPUGraffitiMorphRenderer','WebGPUProfileMarkerRenderer','LampGPURenderer','WebGPUSpiralBezierMorphRenderer','WebGPUTopologyMorphBaseRenderer','WebGPUGreenProjectMorphRenderer'])assert(!main.includes(token),`main pipeline depends on concrete renderer ${token}`);
  assert(main.includes('SomataFeatureLifecycle?.begin')&&main.includes('SomataFeatureLifecycle?.end'),'main pipeline does not delegate feature frame lifecycle');
  assert(lifecycle.includes("queryAll?.('frameBegin'")&&lifecycle.includes("queryAll?.('frameEnd'"),'feature lifecycle does not use capabilities');
})&&ok;

if(!ok)process.exit(1);
