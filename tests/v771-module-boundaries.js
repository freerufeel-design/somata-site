const fs=require('fs'),path=require('path'),vm=require('vm');
const {ROOT,read,assert,test}=require('./lib/test-utils');
let ok=true;
const main=read('js/render/main-pipeline.js');
const web=read('js/render/web-pass.js');
const particle=read('js/render/particle-pass.js');
const pathfx=read('js/render/path-fx-pass.js');
const master=read('js/ui/master-broadcast-core.js');
const ui=read('js/app/ui-project-runtime.js');

ok=test('7.7.1 feature host is wired before render passes',()=>{
  const html=read('index.html'),a=html.indexOf('js/render/feature-host.js'),b=html.indexOf('js/render/pass-isolation.js'),c=html.indexOf('js/render/main-pipeline.js');
  assert(a>=0&&a<b&&b<c,'feature host load order is not host -> isolation -> main pipeline');
  assert(main.includes('SomataFeatureHost.run(name,frameCtx,execute)'),'main pipeline does not use feature host');
})&&ok;

ok=test('effect implementations stay outside main pipeline',()=>{
  for(const name of ['renderLayerWebPass','renderLayerGlowPass','renderLayerSweepPass','renderLayerMotionFxPass','renderLayerSpritePass','renderLayerParticlePass']){
    assert(!new RegExp(`function\\s+${name}\\s*\\(`).test(main),`${name} implementation leaked into main pipeline`);
  }
})&&ok;

ok=test('Web pass has no cross-effect renderer dependency',()=>{
  for(const token of ['WebGPULightning','SweepGPURenderer','WebGPUGraffiti','LampGPURenderer','WebGPUParticle'])assert(!web.includes(token),`Web pass depends on ${token}`);
})&&ok;

ok=test('Particle pass has no Web/Lightning/Graffiti renderer dependency',()=>{
  for(const token of ['WebGPUWeb','WebGPULightning','SweepGPURenderer','WebGPUGraffiti'])assert(!particle.includes(token),`Particle pass depends on ${token}`);
})&&ok;

ok=test('Motion/Sprite pass is isolated from Web/Lightning/Graffiti/Lamps',()=>{
  for(const token of ['WebGPUWeb','WebGPULightning','SweepGPURenderer','WebGPUGraffiti','LampGPURenderer'])assert(!pathfx.includes(token),`Path FX pass depends on ${token}`);
})&&ok;

ok=test('Master broadcast core is render-independent',()=>{
  const code=master.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|\s)\/\/.*$/gm,'');
  for(const re of [/\bWebGPU\w*/i,/\bmainCtx\b/,/\brenderLayer\w*/i,/\brequestMainCanvasRender\b/,/\bruntimeState\b/,/\bdocument\b/,/\bHTMLCanvasElement\b/])assert(!re.test(code),`Master core leaked render/UI dependency: ${re}`);
  assert(ui.includes('SomataMasterBroadcastCore.collectChangedPaths'),'UI runtime does not delegate Master path diff to pure core');
  assert(ui.includes('SomataMasterBroadcastCore.applyPath'),'UI runtime does not delegate Master path application to pure core');
})&&ok;

ok=test('feature host discards undeclared top-level writes',()=>{
  const src=read('js/render/feature-host.js');
  const sandbox={window:{__spiroRegisterModule:()=>{}},console};sandbox.window.window=sandbox.window;
  vm.createContext(sandbox);vm.runInContext(src,sandbox);
  const host=sandbox.window.SomataFeatureHost;assert(host,'feature host missing');
  host.register('unit',{outputs:['published']});
  const parent={stable:1,published:0,frame:{shared:0}};
  host.run('unit',parent,ctx=>{ctx.stable=99;ctx.privateScratch='x';ctx.published=7;ctx.frame.shared=3;});
  assert(parent.stable===1,'undeclared write leaked into parent');
  assert(parent.privateScratch===undefined,'private scratch leaked into parent');
  assert(parent.published===7,'declared output was not committed');
  assert(parent.frame.shared===3,'shared frame service must remain shared');
})&&ok;

if(!ok)process.exit(1);
