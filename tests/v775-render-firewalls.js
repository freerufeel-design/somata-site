const vm=require('vm');
const {read,assert,test}=require('./lib/test-utils');
let ok=true;
const hostSrc=read('js/render/feature-host.js');
const snapshotSrc=read('js/render/render-layer-snapshot.js');
const main=read('js/render/main-pipeline.js');
const master=read('js/ui/master-broadcast-core.js');
const batch=read('js/render/stroke-batch-service.js');

function sandboxFor(src){
  const sandbox={window:{__spiroRegisterModule:()=>{}},console};sandbox.window.window=sandbox.window;vm.createContext(sandbox);vm.runInContext(src,sandbox);return sandbox;
}

ok=test('7.7.5 render layer snapshot protects persistent project state',()=>{
  const s=sandboxFor(snapshotSrc),api=s.window.SomataRenderLayerSnapshot;
  const source={id:'L1',fillMatchStroke:false,lineProfile:'round',geometryCircles:{enabled:true,keyPoints:false},web:{enabled:false,width:2},profileNodes:[{x:0,y:0},{x:1,y:0}]};
  const view=api.create(source);view.fillMatchStroke=true;view.lineProfile='slash';view.geometryCircles.keyPoints=true;view.web.width=9;view.profileNodes[0].x=7;
  assert(source.fillMatchStroke===false,'top-level render write leaked to project layer');
  assert(source.lineProfile==='round','profile normalization leaked to project layer');
  assert(source.geometryCircles.keyPoints===false,'nested geometry config leaked to project layer');
  assert(source.web.width===2,'nested effect config leaked to project layer');
  assert(source.profileNodes[0].x===0,'profile point mutation leaked to project layer');
  assert(api.source(view)===source&&api.isSnapshot(view),'snapshot source identity lost');
})&&ok;

ok=test('7.7.5 failed feature pass commits no partial outputs',()=>{
  const s=sandboxFor(hostSrc),host=s.window.SomataFeatureHost;
  host.register('unitFail',{outputs:['owned'],plans:['mine']});
  const parent={owned:{value:1},effectsPlan:{mine:{enabled:true},foreign:{enabled:true}}};
  let threw=false;try{host.run('unitFail',parent,ctx=>{ctx.owned.value=99;throw new Error('boom');});}catch(_){threw=true;}
  assert(threw,'feature exception did not escape host boundary to pass isolation');
  assert(parent.owned.value===1,'failed pass committed a partial output');
  assert(host.status().failedDiscards>=1,'failed output discard was not counted');
})&&ok;

ok=test('7.7.5 feature sees only declared effect plans',()=>{
  const s=sandboxFor(hostSrc),host=s.window.SomataFeatureHost;
  host.register('unitPlans',{plans:['mine'],outputs:[]});
  const parent={effectsPlan:{mine:{value:1},foreign:{value:2}}};let seen=null;
  host.run('unitPlans',parent,ctx=>{seen={mine:ctx.effectsPlan.mine?.value,foreign:ctx.effectsPlan.foreign};});
  assert(seen.mine===1,'declared plan missing');assert(seen.foreign===undefined,'foreign effect plan leaked across feature boundary');
})&&ok;

ok=test('7.7.5 cross-feature outputs are opt-in reads',()=>{
  const s=sandboxFor(hostSrc),host=s.window.SomataFeatureHost;
  host.register('producer',{outputs:['token']});host.register('blind',{outputs:[]});host.register('reader',{reads:['token'],outputs:[]});
  const parent={token:7};let blind=null,read=null;
  host.run('blind',parent,ctx=>{blind=ctx.token;ctx.token=99;});
  assert(blind===undefined&&parent.token===7,'undeclared cross-feature output was visible or mutable');
  host.run('reader',parent,ctx=>{read=ctx.token;ctx.token=33;});
  assert(read===7&&parent.token===7,'declared read was not read-only at commit boundary');
})&&ok;

ok=test('7.7.5 main pipeline snapshots render layers and isolates Fill/Base passes',()=>{
  assert(main.includes('SomataRenderLayerSnapshot?.create?.(renderLayerSource)'),'render layer is not detached from project state');
  assert(main.includes('SomataRenderPassRegistry.runStage'),'main does not execute passes through registry boundary');
  assert(read('js/render/fill-pass.js').includes("register?.('fill'"),'Fill pass is not registry-owned');
  assert(read('js/render/base-pass.js').includes("register?.('base'"),'Base pass is not registry-owned');
  assert(!main.includes('renderLayerBaseGeometryPass'),'Base implementation leaked back into compositor');
})&&ok;


ok=test('7.7.5 central stroke batch is capability-driven, not effect-aware',()=>{
  assert(!/effectsPlan\??\.?[A-Za-z0-9_]+/.test(batch),'stroke batch directly reads a concrete effect plan');
  for(const token of ['FillGPURenderer','FillMeshPreparer','WebGPUWeb','WebGPULightning','WebGPUGraffiti','LampGPURenderer'])assert(!batch.includes(token),`stroke batch leaked concrete feature renderer ${token}`);
  assert(batch.includes("queryAll?.('strokeBatchSpec'")&&batch.includes("queryAll?.('strokeBatchDemand'")&&batch.includes("queryAll?.('strokeBatchScene'"),'stroke batch does not collect declared capabilities');
  assert(!/effectsPlan\??\.?[A-Za-z0-9_]+/.test(main),'main pipeline reads concrete effect plans');
})&&ok;
ok=test('Master remains outside render dependency graph',()=>{
  for(const token of ['WebGPU','SomataFeatureHost','renderLayer','geometryPlan','effectsPlan','mainCtx'])assert(!master.includes(token),`Master leaked render dependency ${token}`);
})&&ok;

if(!ok)process.exit(1);
