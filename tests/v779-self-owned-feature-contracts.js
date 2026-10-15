const {read,assert,test}=require('./lib/test-utils');
let ok=true;
const host=read('js/render/feature-host.js');
const main=read('js/render/main-pipeline.js');
const owners={
  base:'base-plan.js',fill:'fill-pass.js',web:'web-plan.js',glow:'glow-plan.js',outline:'outline-plan.js',
  profile:'profile-plan.js',lamps:'lamp-plan.js',motion:'path-fx-plan.js',sprite:'path-fx-plan.js',sweep:'sweep-plan.js',particles:'particle-pass.js'
};
ok=test('7.7.9 feature host is a generic kernel with no built-in feature catalog',()=>{
  assert(!host.includes("SomataFeatureHost.register('base'"),'host still owns base feature contract');
  for(const name of Object.keys(owners))assert(!host.includes(`register('${name}'`),`host still owns ${name} contract`);
  for(const token of ['Lightning','Spiral','Glow','Fill','WebGPU','Graffiti','Particles','Lamps'])assert(!host.includes(token),`generic host leaked domain token ${token}`);
})&&ok;
ok=test('7.7.9 every render feature owns and registers its own isolation contract',()=>{
  for(const [name,file] of Object.entries(owners)){
    const src=read('js/render/'+file);
    assert(src.includes(`SomataFeatureHost.register('${name}'`),`${name} contract is not owned by ${file}`);
  }
})&&ok;
ok=test('7.7.9 compositor does not schedule Path FX by inspecting Motion/Sprite controls',()=>{
  assert(!main.includes('ensureGpuPathFxAnimation'),'main still schedules Path FX directly');
  assert(!main.includes('lineMotionFx?.enabled'),'main still inspects Motion enable state for scheduler ownership');
  const fx=read('js/render/path-fx-plan.js');
  assert(fx.includes("provide('motion','frameBegin'"),'Motion does not own its frame lifecycle demand');
  assert(fx.includes("provide('sprite','frameBegin'"),'Sprite does not own its frame lifecycle demand');
})&&ok;
ok=test('7.7.9 adding/changing a feature requires no edit to host or pass registry catalog',()=>{
  const registry=read('js/render/pass-registry.js');
  for(const name of Object.keys(owners)){
    assert(!new RegExp(`register\\('${name}'`).test(registry),`pass registry hard-codes ${name}`);
  }
  assert(host.includes('function register(name,spec={})'),'generic feature register API missing');
  assert(registry.includes('function register(name,spec={})'),'generic pass register API missing');
})&&ok;
if(!ok)process.exit(1);
