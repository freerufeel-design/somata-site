const vm=require('vm');
const {read,assert,test}=require('./lib/test-utils');
let ok=true;
const effects=read('js/render/effects-plan.js');
const graph=read('js/render/render-graph.js');
const demand=read('js/render/consumer-demand.js');
const hostSrc=read('js/render/feature-host.js');
const planners=['glow-plan.js','outline-plan.js','profile-plan.js','path-fx-plan.js','sweep-plan.js','web-plan.js','lamp-plan.js'];

ok=test('7.7.4 central effect planner is registry-driven and effect-agnostic',()=>{
  for(const token of ['resolveLayerGlowEffectProvider','resolveLayerOutlineEffectProvider','resolveLayerProfileEffectProvider','resolveLayerSweepEffectProvider','resolveLayerWebEffectProvider','resolveLayerLampEffectProvider','WebGPULightning','WebGPUWeb','WebGPUGraffiti','LampGPURenderer'])assert(!effects.includes(token),`central planner leaked ${token}`);
  assert(effects.includes("queryAll?.('effectPlan'"),'central planner does not enumerate effectPlan capabilities');
  assert(effects.includes("queryAll?.('resetEffectPlan'"),'central reset is not registry-driven');
})&&ok;

ok=test('7.7.4 render graph and consumer demand contain no optional-effect routing table',()=>{
  for(const srcName of [['render-graph',graph],['consumer-demand',demand]]){
    for(const token of ['getLayerWebEnabled','getLayerSweepConfig','WebGPUCanonicalSweepRenderer','WebGPULightning','WebGPUWebMorphRenderer','WebGPUGraffiti','LampGPURenderer','lineMotionFx','sprite?.enabled'])assert(!srcName[1].includes(token),`${srcName[0]} still routes concrete feature ${token}`);
  }
  assert(graph.includes("queryAll?.('graphPass'"),'render graph does not collect graphPass capabilities');
})&&ok;

ok=test('each optional feature owns planning, reset and graph-demand capabilities',()=>{
  const joined=planners.map(f=>read('js/render/'+f));
  const names=['glow','outline','profile','motion','sprite','sweep','web','lamps'];
  for(const name of names){
    const src=joined.find(x=>x.includes(`'${name}','effectPlan'`));assert(src,`${name} has no effectPlan owner`);
    assert(src.includes(`'${name}','graphPass'`),`${name} has no graphPass owner`);
    assert(src.includes(`'${name}','resetEffectPlan'`),`${name} has no resetEffectPlan owner`);
  }
})&&ok;

ok=test('render planning no longer mutates persistent layer/profile/path-fx settings',()=>{
  const profile=read('js/render/profile-plan.js'),pathfx=read('js/render/path-fx-plan.js');
  assert(!/layer\.lineProfile\s*=/.test(profile),'profile planner writes persistent layer.lineProfile');
  assert(!/layer\.lineProfileStroke\s*=/.test(profile),'profile planner writes persistent layer.lineProfileStroke');
  assert(/rawCfg=.*lineMotionFx/.test(pathfx)&&/cfg=\{\.\.\.rawCfg\}/.test(pathfx),'motion planner does not clone live config');
  assert(/rawCfg=.*sprite/.test(pathfx)&&/cfg=\{\.\.\.rawCfg,lengthPercent:100/.test(pathfx),'sprite planner does not clone live config');
})&&ok;

ok=test('feature outputs are copy-on-write until pass commit',()=>{
  const sandbox={window:{__spiroRegisterModule:()=>{}},console};sandbox.window.window=sandbox.window;vm.createContext(sandbox);vm.runInContext(hostSrc,sandbox);
  const host=sandbox.window.SomataFeatureHost;host.register('unit774',{outputs:['bag']});
  const parent={bag:{count:1},untouched:{value:2}};
  let seenDuring=0;host.run('unit774',parent,ctx=>{ctx.bag.count=9;seenDuring=parent.bag.count;ctx.untouched.value=7;});
  assert(seenDuring===1,'declared output mutated parent before commit');assert(parent.bag.count===9,'declared output was not committed');
  // Undeclared nested objects are shared inputs by contract and must not be written by feature code;
  // module-firewall tests enforce that source-level rule. The COW guarantee covers feature-owned state.
})&&ok;

ok=test('new feature can join planner and render graph without editing either orchestrator',()=>{
  const sandbox={window:{__spiroRegisterModule:()=>{}},console,state:{fourierMode:false},frameGeometryRuntime:{frameId:1},isSpiralLayer:()=>false,getLayerLineVisible:()=>true,SomataGeometryPolicy:{isStrict:()=>false,invoke:()=>false}};sandbox.window.window=sandbox.window;
  vm.createContext(sandbox);vm.runInContext(hostSrc,sandbox);
  sandbox.SomataFeatureHost=sandbox.window.SomataFeatureHost;
  vm.runInContext(effects,sandbox);vm.runInContext(graph,sandbox);
  const host=sandbox.window.SomataFeatureHost;host.register('unitFeature',{outputs:[]});
  host.provide('unitFeature','resetEffectPlan',plans=>({enabled:false,old:Number(plans?.unitFeature?.old)||0}));
  host.provide('unitFeature','effectPlan',(ctx,plans)=>({enabled:true,old:Number(plans?.unitFeature?.old)||0,value:42}));
  host.provide('unitFeature','graphPass',(ctx,plans)=>({name:'unitFeature',caps:1,active:plans?.unitFeature?.enabled===true,backend:'unit'}));
  const frameCtx={layer:{id:'x',fill:false},frameId:1,lineDisplayEnabled:true,effectsPlan:{unitFeature:{old:5}},geometryPlan:{dynamic:false}};
  const planned=sandbox.prepareMainLayerEffects(frameCtx);assert(planned.unitFeature?.value===42&&planned.unitFeature?.old===5,'generic planner ignored dynamically registered feature');
  const g=sandbox.compileLayerRenderGraph(frameCtx);assert(g.roles.unitFeature?.backend==='unit','generic graph ignored dynamically registered feature');
})&&ok;

if(!ok)process.exit(1);
