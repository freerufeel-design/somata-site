const vm=require('vm');
const {read,assert,test}=require('./lib/test-utils');
let ok=true;
function sandboxFor(src){const sandbox={window:{__spiroRegisterModule:()=>{}},console};sandbox.window.window=sandbox.window;vm.createContext(sandbox);vm.runInContext(src,sandbox);return sandbox;}

ok=test('7.7.7 feature scratch state is private by default',()=>{
  const s=sandboxFor(read('js/render/feature-host.js')),host=s.window.SomataFeatureHost;
  host.register('blind',{outputs:[]});host.register('reader',{reads:['_secret'],outputs:[]});
  const parent={_secret:{value:7}};let blind='unset',seen=null;
  host.run('blind',parent,ctx=>{blind=ctx._secret;ctx._secret={value:99};});
  assert(blind===undefined,'private scratch leaked through feature boundary');
  assert(parent._secret.value===7,'blind feature mutated private scratch');
  host.run('reader',parent,ctx=>{seen=ctx._secret?.value;});
  assert(seen===7,'declared scratch read was not available');
})&&ok;

ok=test('7.7.7 effect plan view cannot rewrite another pass plan',()=>{
  const s=sandboxFor(read('js/render/feature-host.js')),host=s.window.SomataFeatureHost;
  host.register('planOwner',{plans:['mine'],outputs:[]});
  const parent={effectsPlan:{mine:{enabled:true,value:3},other:{enabled:true}}};
  host.run('planOwner',parent,ctx=>{try{ctx.effectsPlan.mine.enabled=false;ctx.effectsPlan.mine.value=99;}catch(_){};});
  assert(parent.effectsPlan.mine.enabled===true&&parent.effectsPlan.mine.value===3,'feature mutated parent plan');
})&&ok;

ok=test('7.7.7 sealed render layer is immutable inside effect execution',()=>{
  const s=sandboxFor(read('js/render/render-layer-snapshot.js')),api=s.window.SomataRenderLayerSnapshot;
  const source={id:'L1',rounding:42,fill:true,fillColor:'#123456',geometryCircles:{enabled:true,keyPoints:false},web:{enabled:true,width:2},profileNodes:[{x:0,y:0},{x:1,y:.2}]};
  const view=api.create(source);api.seal(view);
  try{view.rounding=0;view.fill=false;view.geometryCircles.keyPoints=true;view.web.width=9;view.profileNodes[0].x=88;}catch(_){}
  assert(view.rounding===42&&view.fill===true,'sealed top-level geometry/style mutated');
  assert(view.geometryCircles.keyPoints===false&&view.web.width===2,'sealed nested feature config mutated');
  assert(view.profileNodes[0].x===0,'sealed profile geometry mutated');
  assert(source.rounding===42&&source.web.width===2,'project source was affected');
})&&ok;

ok=test('7.7.7 optional effects depend on semantic geometry policy, not Spiral strict globals',()=>{
  const files=['main-pipeline.js','render-graph.js','geometry-circles-pass.js','outline-pass.js','outline-plan.js','profile-pass.js','profile-plan.js','path-fx-plan.js','lamp-pass.js','lamp-plan.js','layer-scene-service.js','stroke-batch-service.js','sweep-plan.js','particle-pass.js'];
  for(const f of files){const src=read(`js/render/${f}`);assert(!src.includes('isStrictSpiralWebGPUFrame'),`${f} still imports Spiral strict policy directly`);}
  const policy=read('js/render/geometry-policy.js'),spiral=read('js/render/spiral-geometry-policy.js');
  assert(policy.includes('SomataGeometryPolicy')&&policy.includes('register(name,api'), 'generic geometry policy registry missing');
  assert(spiral.includes("SomataGeometryPolicy.register('spiral'"),'Spiral policy is not an adapter');
})&&ok;

ok=test('7.7.7 compositor no longer selects Spiral scene routes directly',()=>{
  const main=read('js/render/main-pipeline.js');
  for(const token of ['hasStrictSpiralPresentationIntent','ensureStrictSpiralEffectLayerSceneRoot','canUseGpuSpiralBezierFrameScene','canUseGpuSpiralBezierLayerScene'])assert(!main.includes(token),`main compositor still owns ${token}`);
  assert(main.includes("SomataGeometryPolicy.invoke(frameCtx,'ensureEffectSceneRoot')"),'main does not use geometry policy port');
})&&ok;

ok=test('7.7.7 Particles do not borrow the Lamp renderer',()=>{
  const src=read('js/render/particle-pass.js');
  assert(!src.includes('LampGPURenderer'),'Particles still depend on LampGPURenderer');
  assert(src.includes('WebGPUParticleRenderer'),'Particles do not own their GPU renderer');
})&&ok;

ok=test('7.7.7 Particle GPU renderer does not import Spiral policy directly',()=>{
  const src=read('js/gpu/particle-renderer.js');
  assert(!src.includes('isStrictSpiralWebGPUFrame'),'Particle renderer still imports Spiral strict helper');
  assert(src.includes('SomataGeometryPolicy'),'Particle renderer does not use semantic geometry policy');
})&&ok;


ok=test('7.7.7 geometry role dispatcher is renderer-agnostic and families are adapters',()=>{
  const svc=read('js/render/geometry-role-service.js');
  for(const token of ['WebGPUSpiralBezierMorphRenderer','WebGPUGreenProjectMorphRenderer','WebGPUTopologyMorphBaseRenderer','isSpiralLayer'])assert(!svc.includes(token),`geometry role dispatcher imports concrete backend ${token}`);
  assert(svc.includes('function register(name,api')&&svc.includes('SomataGeometryRoleService'),'geometry role registry missing');
  const spiral=read('js/render/spiral-role-adapter.js'),green=read('js/render/green-role-adapter.js'),topology=read('js/render/topology-role-adapter.js');
  assert(spiral.includes("SomataGeometryRoleService.register('spiral'")&&green.includes("SomataGeometryRoleService.register('green'")&&topology.includes("SomataGeometryRoleService.register('topology'"),'geometry family adapter registration missing');
  assert(!spiral.includes('WebGPUGreenProjectMorphRenderer')&&!spiral.includes('WebGPUTopologyMorphBaseRenderer'),'Spiral adapter imports another geometry family');
  assert(!green.includes('WebGPUSpiralBezierMorphRenderer')&&!green.includes('WebGPUTopologyMorphBaseRenderer'),'Green adapter imports another geometry family');
  assert(!topology.includes('WebGPUSpiralBezierMorphRenderer')&&!topology.includes('WebGPUGreenProjectMorphRenderer'),'Topology adapter imports another geometry family');
})&&ok;

ok=test('7.7.7 generic geometry policy is loaded before GPU consumers',()=>{
  const html=read('index.html'),policy=html.indexOf('js/render/geometry-policy.js'),particle=html.indexOf('js/gpu/particle-renderer.js'),arc=html.indexOf('js/gpu/morph-arc-resource.js');
  assert(policy>=0&&policy<particle&&policy<arc,'semantic geometry policy loads after GPU consumers');
})&&ok;

ok=test('7.7.7 Master remains outside render/GPU/effect modules',()=>{
  const master=read('js/ui/master-broadcast-core.js');
  for(const token of ['SomataGeometryPolicy','SomataFeatureHost','WebGPU','renderLayer','effectsPlan','geometryPlan','Spiral','Lightning','Glow'])assert(!master.includes(token),`Master leaked dependency ${token}`);
})&&ok;

if(!ok)process.exit(1);
