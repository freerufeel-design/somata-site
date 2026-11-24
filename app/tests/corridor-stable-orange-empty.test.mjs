import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadApp } from './helpers/app-env.mjs';
import defaults from '../../project-defaults.js';
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const diffAngle = (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b));
const nearAngle = (a,b) => assert.ok(Math.abs(diffAngle(a,b)) < 1e-8, `${a} != ${b} (mod 2π)`);

test('physical N=2 spiral copies keep their angles as Corridor grows, in both directions and across travel wraps', async () => {
  await loadApp();
  const {state,runtimeState} = await import('../js/core/state.js');
  const {createLayer} = await import('../js/core/defaults-layers.js');
  const {getMotionTunnelLagRadians, motionRuntime} = await import('../js/effects/motion.js');
  const {getTunnelCopies} = await import('../js/corridor/corridor-instances.js');
  assert.equal(state.tunnel.spiralTravelRotation, false);
  assert.equal(defaults.settings.tunnel.spiralTravelRotation, false);
  runtimeState.morph.active=false;
  state.tunnel.active=true;
  state.tunnel.spiralTravelRotation=false;
  for (const sign of [1,-1]) {
    motionRuntime.spiralTravelAngles.clear();
    const layer = {...createLayer(), id:'physical-N2', N:2,K:1,spiralEnabled:true,spiralOrder:sign};
    let previous;
    for (const travelPhase of [0,0.1,0.5,0.99999,1,1.25,1.99999,2,1.8,0.7,0,-0.1,-0.9999,-1,-1.4]) {
      state.tunnel.travelPhase=travelPhase;
      const copies=getTunnelCopies().map(c=>({...c,angle:getMotionTunnelLagRadians(c,layer)}));
      assert.ok(copies.length>2);
      for(let i=1;i<copies.length;i++) nearAngle(copies[i].angle-copies[i-1].angle,sign*Math.PI);
      if (previous) {
        const common=copies.filter(c=>previous.has(c.copyId));
        assert.ok(common.length>0);
        for (const c of common) nearAngle(c.angle,previous.get(c.copyId).angle);
      }
      previous=new Map(copies.map(c=>[c.copyId,c]));
    }
    state.tunnel.spiralTravelRotation=true;
    state.tunnel.travelPhase=0.25;
    const c=getTunnelCopies().find(c=>c.copyId===0);
    const a=getMotionTunnelLagRadians(c,layer);
    state.tunnel.travelPhase=0.5;
    const b=getMotionTunnelLagRadians(getTunnelCopies().find(c=>c.copyId===0),layer);
    nearAngle(b-a,sign*Math.PI*0.25);
    state.tunnel.spiralTravelRotation=false;
  }
  state.tunnel.active=false;
});

test('new Orange contains zero normal and special rows, without editing original profile; survives reset/save/select', async()=>{
  await loadApp();
  const store=window.SomataOrangeMorphProfiles;
  const mm={generatorStyle:'lace',mode:'loops',family:'sine',profileGroups:['loops'],intervalSec:5,defaultActive:true};
  const ro={byShape:true,orbitBindingEnabled:true,chaosStar:true,bySpiralLayers:true,bySpiralOrder:true,byVertices:true,bySteps:true,byRounding:true,bySize:true,byColor:true,shapeAdded:true,orbitsAdded:true,chaosAdded:true,spiralLayersAdded:true,spiralOrderAdded:true,cyclePalettes:true};
  const holder={value:3};
  store.ensureProfiles(mm,ro,holder.value);
  const original=store.activeProfile(mm,ro,holder.value);
  const baseline=JSON.stringify(original.config);
  const p=store.create(mm,ro,holder,'');
  const special=[['shape','byShape'],['orbits','orbitBindingEnabled'],['chaos','chaosStar'],['spiralLayers','bySpiralLayers'],['spiralOrder','bySpiralOrder']];
  function checkEmpty(){
    assert.deepEqual(store.workingBindings(mm,ro,holder.value),[]);
    for(const [kind,flag] of special){
      assert.equal(ro[flag],false);
      assert.equal(window.SomataMorphRowLifecycle.isPresent(ro,kind,ro[flag]),false);
    }
    for(const flag of ['byVertices','bySteps','byRounding','bySize','byColor']) assert.equal(ro[flag],false);
    assert.equal(mm.generatorStyle,'standard');
    assert.equal(mm.defaultActive,false);
  }
  assert.equal(p.transient,true); checkEmpty();
  assert.equal(JSON.stringify(original.config),baseline);
  assert.equal(mm.intervalSec,5);
  assert.equal(holder.value,3);
  assert.ok(store.setBinding(mm,ro,holder.value,'geometry.N',true,{min:3,max:10}));
  store.reset(mm,ro,holder); checkEmpty();
  assert.ok(store.save(mm,ro,holder.value,'Empty orange'));
  store.select(mm,ro,holder,original.id);
  assert.ok(store.workingBindings(mm,ro,holder.value).length>0);
  assert.equal(ro.byShape,true);
  store.select(mm,ro,holder,p.id); checkEmpty();
  assert.equal(JSON.stringify(original.config),baseline);
  const snap=store.persistentMinimalSnapshot(mm,ro,holder.value);
  assert.deepEqual(snap.routingBindings,[]);
});

test('Corridor rotation is an opt-in setting and empty Orange creation does not restart Orange',()=>{
  const html=read('../../index.html');
  assert.match(html,/<input id="tunnelSpiralTravelRotation" type="checkbox">/);
  assert.match(read('../js/project/project-loader.js'),/state\.tunnel\.spiralTravelRotation = tunnelSettings\.spiralTravelRotation === true/);
  assert.match(read('../js/project/project-data.js'),/spiralTravelRotation: state\.tunnel\.spiralTravelRotation === true/);
  const ui=read('../js/ui/orange-morph/routing-ui.js').split('async function createNewOrangeMorphProfile()')[1].split('function installOrangeMorphHeaderLayout')[0];
  assert.match(ui,/activeStopMinimalMorphing\(false\)/);
  assert.doesNotMatch(ui,/activeStartMinimalMorphing/);
  assert.match(ui,/syncRandomSettingsUI\(\)/);
});
