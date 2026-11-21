import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importModule } from './helpers/app-env.mjs';

test('Blue key lamps hand the same lit IDs and positions to the following phase', async () => {
  await loadApp();
  const { state, runtimeState } = await importModule('js/core/state.js');
  const { createLayer } = await importModule('js/core/defaults-layers.js');
  const { SomataFeatureHost } = await importModule('js/render/feature-host.js');
  await importModule('js/render/lamp-plan.js');
  const runtime = window.SomataMorphRuntime;
  for (const mode of ['circleSlide','topology']) for (const snap of [true, false]) for (const motion of ['linear','key']) {
    const layer = Object.assign(createLayer(), {id: 'seam-'+mode+snap+motion, N:4, K:1, radius:100, rotation:0,
      rounding:65, spiralOrder:0, spiralEnabled:false, showLamps:true});
    Object.assign(layer.lamps,{positionMode:'key',snapToContour:snap,morphMotionMode:motion});
    state.layers=[layer]; state.tunnel.active=false;
    Object.assign(state.morph,{mode,unifiedMode:mode});
    let previous;
    const endpoints=[layer,{...layer,N:8,K:3,rotation:24},{...layer,N:4,K:1,rotation:70},{...layer,N:7,K:2,rotation:12}];
    for(let cycle=1;cycle<endpoints.length;cycle++){
      const a=endpoints[cycle-1], b=endpoints[cycle];
      Object.assign(runtimeState.morph,{active:true,lampCycleSerial:cycle,renderSourceLayers:[a],renderTargetLayers:[b]});
      const spec=runtime.describe({sourceLayer:a,targetLayer:b,origin:'blue',mode});
      for(const t of [0,0.25,0.5,0.75,1]){
        runtimeState.morph.progress=t;
        const f={layer:{...(t===1?b:a)},effectLayer:layer,layerIndex:0,baseAlpha:1,morphFrameActive:true,
          blueMorphProvider:{active:true,mode,geometryT:t},frame:{viewportOuterRadius:500,tunnelCopies:[]},
          visibleInstances:{copies:[{}]}};
        runtime.publish(f,runtime.samplePrimary(spec,t));
        const pts=SomataFeatureHost.query('lamps','effectPlan',f,{}).sets[0].points;
        if(t===0 && previous){
          const survivors=pts.filter(p=>p.lampSourcePresent!==false);
          assert.equal(survivors.length,a.N);
          assert.equal(survivors.length,previous.length);
          for(const p of survivors){
            const q=previous.find(q=>q.lampId===p.lampId);
            assert.ok(q,'lost '+p.lampId);
            const jump=Math.hypot(q.x-p.x,q.y-p.y);
            assert.ok(jump<0.01,'phase handoff displacement '+jump);
          }
        }
        if(t===1)previous=pts.filter(p=>p.lampTargetPresent!==false);
      }
    }
  }
});
test('a rebuilt rail inherits its last displayed centre even if its new projection is displaced', async () => {
  await loadApp();
  const {state,runtimeState}=await importModule('js/core/state.js');
  const {preserveBlueMorphLampIdentity}=await importModule('js/lamps/lamp-motion.js');
  state.layers=[{id:'test-rendered-centre'}];
  Object.assign(runtimeState.morph,{active:true,lampCycleSerial:1,progress:1});
  const at=(x,id,t)=>preserveBlueMorphLampIdentity(0,[{
    x,y:15,lampId:id,lampPresence:1,lampSourcePresent:true,lampTargetPresent:true,
  }],true,t)[0];
  const end=at(70,'previous-slot',1);
  Object.assign(runtimeState.morph,{lampCycleSerial:2,progress:0});
  const start=at(82,'next-slot',0);
  assert.equal(start.lampId,end.lampId);
  assert.equal(start.x,end.x);
  assert.equal(start.y,end.y);
  assert.equal(at(100,'next-slot',1).x,100);
});

test('phase handoff follows a bent rail through the following frames', async () => {
  await loadApp();
  const { state, runtimeState } = await importModule('js/core/state.js');
  const { preserveBlueMorphLampIdentity } = await importModule('js/lamps/lamp-motion.js');
  const rail = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false };
  state.layers = [{ id: 'bent-seam' }];
  Object.assign(runtimeState.morph, { active: true, lampCycleSerial: 1 });
  const frame = (x, y, fraction, t) => preserveBlueMorphLampIdentity(0, [{
    x, y, pathIndex: 0, lampId: 'lamp', lampSourcePresent: true, lampTargetPresent: true,
    lampContourFraction: fraction, lampAttachSegmentWindow: 0.5,
  }], true, t, [rail])[0];
  const end = frame(6, 0, 0.3, 1);
  runtimeState.morph.lampCycleSerial++;
  for (const t of [0, 0.04, 0.08, 0.12, 0.16, 0.2]) {
    const point = frame(10, 4, 0.7, t);
    assert.equal(point.lampId, end.lampId);
    if (t === 0) assert.ok(Math.hypot(point.x - end.x, point.y - end.y) < 1e-8);
    assert.ok(Math.abs(point.y) < 1e-8 || Math.abs(point.x - 10) < 1e-8);
  }
});
