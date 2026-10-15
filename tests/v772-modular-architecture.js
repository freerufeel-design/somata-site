const vm=require('vm');
const {read,assert,test}=require('./lib/test-utils');
let ok=true;
const main=read('js/render/main-pipeline.js');
const glow=read('js/render/glow-pass.js');
const base=read('js/render/base-pass.js');
const fill=read('js/render/fill-pass.js');
const web=read('js/render/web-pass.js');
const sweep=read('js/render/sweep-pass.js');
const particle=read('js/render/particle-pass.js');
const outline=read('js/render/outline-pass.js');
const profile=read('js/render/profile-pass.js');
const lamp=read('js/render/lamp-pass.js');
const scene=read('js/render/layer-scene-service.js');
const geom=read('js/render/geometry-role-service.js');
const master=read('js/ui/master-broadcast-core.js');
const spiralAdapter=read('js/render/spiral-role-adapter.js');
const topologyAdapter=read('js/render/topology-role-adapter.js');
const greenAdapter=read('js/render/green-role-adapter.js');

ok=test('7.7.2 compositor services load before feature passes',()=>{
  const html=read('index.html');
  const service=Math.min(html.indexOf('js/render/layer-scene-service.js'),html.indexOf('js/render/geometry-role-service.js'));
  const pass=Math.min(html.indexOf('js/render/base-pass.js'),html.indexOf('js/render/web-pass.js'),html.indexOf('js/render/glow-pass.js'));
  const mainIndex=html.indexOf('js/render/main-pipeline.js');
  assert(service>=0&&service<pass&&pass<mainIndex,'service -> pass -> main load order broken');
  for(const f of ['effects-plan.js','fill-pass.js','base-pass.js','outline-pass.js','profile-pass.js','lamp-pass.js','profile-sweep-adapter.js'])assert(html.includes(`js/render/${f}`),`missing ${f} from index`);
})&&ok;

ok=test('main pipeline is an orchestrator, not an effect implementation bucket',()=>{
  for(const name of ['renderLayerBaseGeometryPass','renderLayerGlowPass','renderLayerOutlinePass','renderLayerProfilePass','renderLayerLampPass','renderLayerSweepPass','renderLayerWebPass','renderLayerParticlePass','renderLayerMotionFxPass','renderLayerSpritePass']){
    assert(!new RegExp(`function\\s+${name}\\s*\\(`).test(main),`${name} implementation leaked into main pipeline`);
  }
  for(const name of ['resolveLayerGlowEffectProvider','resolveLayerOutlineEffectProvider','resolveLayerProfileEffectProvider','resolveLayerSweepEffectProvider','resolveLayerWebEffectProvider','resolveLayerLampEffectProvider'])assert(!main.includes(`function ${name}`),`${name} provider leaked into main pipeline`);
  for(const stage of ['FILL','OVER_FILL','GLOW','BASE','POST_BASE'])assert(main.includes(`runRegisteredStage(SomataRenderPassRegistry.STAGES.${stage})`),`main pipeline does not orchestrate ${stage} registry stage`);
})&&ok;

ok=test('feature passes cannot open or queue Layer Scenes behind each other',()=>{
  const files={glow,fill,base,outline,profile,web,sweep,particle};
  for(const [name,src] of Object.entries(files)){
    for(const token of ['beginExternalLayerScene','deferExternalLayerScene','queueLayerSceneEffectCommand','getDeferredLayerSceneTexture','getExternalLayerSceneTarget'])assert(!src.includes(token),`${name} bypasses Layer Scene service via ${token}`);
    if(/LayerScene|gpuLayerSceneDeferred|SomataLayerSceneService/.test(src))assert(src.includes('SomataLayerSceneService'),`${name} touches Layer Scene state without the scene capability`);
  }
  for(const [name,src] of [['main',main],['geometry-role',geom]])for(const token of ['beginExternalLayerScene','deferExternalLayerScene','queueLayerSceneEffectCommand','getDeferredLayerSceneTexture','getExternalLayerSceneTarget'])assert(!src.includes(token),`${name} leaks low-level Layer Scene primitive ${token}`);
  assert(scene.includes('beginExternalLayerScene')&&scene.includes('queueLayerSceneEffectCommand')&&scene.includes('getExternalLayerSceneTarget'),'scene service does not exclusively own scene open/target/queue implementation');
})&&ok;

ok=test('Glow and Base do not know concrete Spiral/Topology/Green renderers',()=>{
  for(const [name,src] of [['glow',glow],['base',base]])for(const token of ['WebGPUSpiralBezierMorphRenderer','WebGPUTopologyMorphBaseRenderer','WebGPUGreenProjectMorphRenderer'])assert(!src.includes(token),`${name} depends on concrete geometry renderer ${token}`);
  assert(glow.includes('SomataGeometryRoleService.renderGlow'),'Glow does not consume semantic geometry role');
  assert(base.includes('SomataGeometryRoleService.renderBase'),'Base does not consume semantic geometry role');
  for(const token of ['WebGPUSpiralBezierMorphRenderer','WebGPUTopologyMorphBaseRenderer','WebGPUGreenProjectMorphRenderer'])assert(!geom.includes(token),`semantic geometry dispatcher imports concrete renderer ${token}`);
  assert(spiralAdapter.includes('WebGPUSpiralBezierMorphRenderer'),'Spiral adapter does not own the Spiral renderer');
  assert(topologyAdapter.includes('WebGPUTopologyMorphBaseRenderer'),'Topology adapter does not own the Topology renderer');
  assert(greenAdapter.includes('WebGPUGreenProjectMorphRenderer'),'Green adapter does not own the Green renderer');
})&&ok;

ok=test('Base does not select Fill backends',()=>{
  for(const token of ['FillGPURenderer','FillMeshPreparer','tryRenderLayerFillGPU','noteFillRuntime','fillMaskValidationStats'])assert(!base.includes(token),`Base leaked Fill implementation ${token}`);
  assert(base.includes('SomataFillPassService.begin')&&base.includes('SomataFillPassService.resolve'),'Base does not consume Fill contract');
  assert(fill.includes('const SomataFillPassService'),'Fill service missing');
})&&ok;

ok=test('Sweep does not know the Graffiti implementation',()=>{
  for(const token of ['WebGPUGraffitiRibbonRenderer','renderGraffitiProfileSweep','renderSweepOnActiveGraffitiOverlay','isGraffitiSweepCarrier'])assert(!sweep.includes(token),`Sweep depends on profile implementation ${token}`);
  assert(sweep.includes('SomataProfileSweepAdapter'),'Sweep profile adapter missing');
})&&ok;

ok=test('Web and Particles have no foreign effect renderer dependencies',()=>{
  for(const token of ['WebGPULightning','SweepGPURenderer','WebGPUGraffiti','LampGPURenderer','WebGPUParticle'])assert(!web.includes(token),`Web depends on ${token}`);
  for(const token of ['WebGPUWeb','WebGPULightning','SweepGPURenderer','WebGPUGraffiti'])assert(!particle.includes(token),`Particles depend on ${token}`);
})&&ok;

ok=test('Master core stays outside rendering and GPU',()=>{
  const code=master.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'');
  for(const re of [/\bWebGPU\w*/i,/\bmainCtx\b/,/\brenderLayer\w*/i,/\brequestMainCanvasRender\b/,/\bruntimeState\b/,/\bdocument\b/,/\bHTMLCanvasElement\b/])assert(!re.test(code),`Master core leaked dependency: ${re}`);
})&&ok;

ok=test('feature host still drops undeclared top-level writes',()=>{
  const src=read('js/render/feature-host.js'),sandbox={window:{__spiroRegisterModule:()=>{}},console};sandbox.window.window=sandbox.window;
  vm.createContext(sandbox);vm.runInContext(src,sandbox);const host=sandbox.window.SomataFeatureHost;assert(host,'feature host missing');
  host.register('unit772',{outputs:['published']});const parent={stable:1,published:0,frame:{shared:0}};
  host.run('unit772',parent,ctx=>{ctx.stable=99;ctx.privateScratch='x';ctx.published=7;ctx.frame.shared=3;});
  assert(parent.stable===1&&parent.privateScratch===undefined,'feature-local scratch leaked');
  assert(parent.published===7,'declared output not committed');assert(parent.frame.shared===3,'shared compositor service unexpectedly cloned');
})&&ok;

if(!ok)process.exit(1);
