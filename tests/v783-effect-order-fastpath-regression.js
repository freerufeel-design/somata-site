const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
async function main(){
  const pipeline=read('js/render/main-pipeline.js'),registry=read('js/render/pass-registry.js'),fill=read('js/render/fill-pass.js'),spiral=read('js/render/spiral-fill-adapter.js'),gpu=read('js/app/geometry-gpu-core.js');
  assert(/requiresEarlyScene/.test(registry)&&/fillCanFuse/.test(registry)&&/standaloneFill/.test(registry),'effect-order fast-path planner missing');
  assert(!/ensure\?\.\(frameCtx,'effect-stack-root'\)/.test(pipeline),'main pipeline still opens an unconditional Layer Scene root');
  assert(/effectOrderPlan\?\.requiresEarlyScene===true/.test(pipeline),'main pipeline does not gate the neutral root by actual order demand');
  assert(/plan\?\.standaloneFill!==true/.test(fill),'ordinary Fill does not return to the fused stroke-batch fast path');
  assert(/queueAsRoot\(frameCtx,somataEffectPhase\('fill'\)/.test(fill),'Corridor Fill cannot seed the Layer Scene without a redundant clear root');
  assert(/queueAsRoot\(frameCtx,somataEffectPhase\('fill'\)/.test(spiral),'retained Spiral Fill cannot seed the Layer Scene without a redundant clear root');
  assert(/preserveTarget=false/.test(gpu)&&/\(first&&!preserveTarget\)\?'clear':'load'/.test(gpu),'ordered Fill cannot preserve lower scene content');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(async()=>{
      const make=(web=false)=>{const l=createLayer('fast-'+Math.random());Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:180,rounding:20,fill:true,fillColor:'#224466aa',strokeWidth:3,strokeColor:'#33aaff'});ensureLayerEffectState(l);l.showWeb=web;l.web.placementMode='corners';state.showWeb=web;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);return l;};
      SomataEffectStackOrder.set([...SomataEffectStackOrder.DEFAULT_ORDER]);
      make(false);beginFrameGeometryRuntime();let f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;let c=prepareMainLayerFrame(f,0);
      const defaultNoWeb=SomataEffectStackOrder.plan(c);
      let ensureCalls=0;const oldEnsure=SomataLayerSceneService.ensure;SomataLayerSceneService.ensure=(...a)=>{ensureCalls++;return oldEnsure(...a);};
      let directFill;try{directFill=prepareRetainedFillSceneBeforeGlow(c);}finally{SomataLayerSceneService.ensure=oldEnsure;}

      make(true);beginFrameGeometryRuntime();f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;c=prepareMainLayerFrame(f,0);const withWeb=SomataEffectStackOrder.plan(c);

      make(false);SomataEffectStackOrder.set(['geometry','fill','web','lamps','sweep','pathfx','particles']);beginFrameGeometryRuntime();f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;c=prepareMainLayerFrame(f,0);const customFill=SomataEffectStackOrder.plan(c);

      SomataEffectStackOrder.set(['lamps','geometry','fill','web','sweep','pathfx','particles']);
      const lateBelow=SomataEffectStackOrder.plan({lineDisplayEnabled:true,effectsPlan:{lamps:{enabled:true}},layer:{fill:false},effectLayer:{particles:{enabled:false}}});
      SomataEffectStackOrder.set([...SomataEffectStackOrder.DEFAULT_ORDER]);
      return{defaultNoWeb,directFill,ensureCalls,withWeb,customFill,lateBelow};
    })()`);
    assert(result.defaultNoWeb.fillCanFuse===true&&result.defaultNoWeb.standaloneFill===false,'default Fill+Line without Web did not select fused fast path');
    assert(result.defaultNoWeb.requiresEarlyScene===false,'default Fill+Line requested an unnecessary early Layer Scene');
    assert(result.ensureCalls===0,`default no-Web Fill opened Layer Scene ${result.ensureCalls} time(s)`);
    assert(result.directFill?.reason==='ordinary Line batch owns Fill','default Fill did not stay owned by ordinary Line batch');
    assert(result.withWeb.standaloneFill===true,'Web+Fill no longer selects ordered standalone Fill');
    assert(result.customFill.standaloneFill===true,'custom Fill/Geometry order was incorrectly fused');
    assert(result.lateBelow.requiresEarlyScene===true,'custom late-pass-below-Geometry order failed to request neutral scene root');
    const uncaught=uncaughtExceptions(h.events).slice(baseline);assert(!uncaught.length,`uncaught browser errors: ${JSON.stringify(uncaught)}`);
    console.log('PASS 7.8.3 effect-order fast path: default no-Web Fill avoids Layer Scene; Web/custom order retains ordered compositor',result);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 effect-order fast-path regression:',e);process.exit(1)});
