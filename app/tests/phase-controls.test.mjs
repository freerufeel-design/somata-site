import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importModule } from './helpers/app-env.mjs';
import { readFileSync } from 'node:fs';

test('Geometry edits effective Blue duration and retains phase progress, TAP AUTO mirrors Morph', async () => {
  await loadApp();
  const { state, runtimeState } = await importModule('js/core/state.js');
  const { setSyncedBluePhaseDurationSec, syncGeometryMorphDuration } = await importModule('js/audio/tap-tempo.js');
  Object.assign(state.morph, { intervalSec: 3, intervalMultiplier: 2 });
  Object.assign(state.tapTempo, { bpm: 120, beatsPerMorph: 8, syncFullMorph: true });
  Object.assign(runtimeState.morph, { active: true, paused: false, cycleStart: 8000, progress: 0.25, phaseSerial: 17, orderRailMinimumMs: 0, boundaryPaintPending: false, returnToPhaseStart: null });
  const input = {}, sync = { checked: true }, badge = { hidden: true, classList: { toggle(_cls, hidden) { badge.hidden = hidden; } } };
  const oldGet = document.getElementById;
  document.getElementById = id => ({testMorphDuration:input,testMorphSyncWithMorph:sync,testMorphAutoBadge:badge}[id] || null);
  try {
    syncGeometryMorphDuration();
    assert.equal(input.value, '8');
    assert.equal(input.disabled, false);
    assert.equal(badge.hidden, false);
    assert.equal(setSyncedBluePhaseDurationSec(4, 10000), true);
    assert.equal(state.morph.intervalSec, 2);
    assert.equal(state.tapTempo.syncFullMorph, false);
    assert.equal(runtimeState.morph.phaseSerial, 17);
    assert.equal(runtimeState.morph.cycleStart, 9000);
    assert.equal((10000-runtimeState.morph.cycleStart)/4000, 0.25);
    syncGeometryMorphDuration();
    assert.equal(input.value,'4');
    assert.equal(badge.hidden,true);
    assert.equal(setSyncedBluePhaseDurationSec(4, 10100), false);
    assert.equal(runtimeState.morph.cycleStart,9000);
    state.tapTempo.syncFullMorph = true;
    sync.checked = false;
    syncGeometryMorphDuration();
    assert.equal(badge.hidden,true);
  } finally {document.getElementById=oldGet;runtimeState.morph.active=false;}
});

test('paused duration edit keeps the same frozen phase progress', async () => {
  const { state, runtimeState } = await importModule('js/core/state.js');
  const { setSyncedBluePhaseDurationSec } = await importModule('js/audio/tap-tempo.js');
  Object.assign(state.morph,{intervalSec:4,intervalMultiplier:1});
  state.tapTempo.syncFullMorph=false;
  Object.assign(runtimeState.morph,{active:true,paused:true,pauseStartedAt:12000,cycleStart:10000,progress:0.5,phaseSerial:23,orderRailMinimumMs:0,boundaryPaintPending:false,returnToPhaseStart:null});
  assert.equal(setSyncedBluePhaseDurationSec(6,15000),true);
  assert.equal(runtimeState.morph.cycleStart,9000);
  assert.equal(runtimeState.morph.pauseStartedAt,12000);
  assert.equal(runtimeState.morph.phaseSerial,23);
  runtimeState.morph.active=false;
  runtimeState.morph.paused=false;
});

test('explicit reset forces a straight target only for the requested layer, even without random shape morphing', async () => {
  const { state, runtimeState } = await importModule('js/core/state.js');
  const { createLayer } = await importModule('js/core/defaults-layers.js');
  const { createMorphTargetsModule } = await importModule('js/morph-runtime/blue/targets.js');
  const { createMorphInterpolationModule } = await importModule('js/morph-runtime/blue/interpolation.js');
  const a=Object.assign(createLayer(),{id:'reset',profileMode:'segments',profileNodes:[{x:0,y:0},{x:0.5,y:0.3},{x:1,y:0}],closedLoop:true,spiralEnabled:false,spiralOrder:0});
  const b={...a,id:'untouched',profileNodes:a.profileNodes.map(p=>({...p}))};
  state.layers=[a,b];state.activeLayerId=a.id;
  for(const k of Object.keys(state.morph.options)) state.morph.options[k]=false;
  state.morph.mode='circleSlide';state.morph.unifiedMode='circleSlide';state.morph.diversity=true;
  runtimeState.morph.manualProfileResetIds=new Set([a.id]);
  const targets=createMorphTargetsModule({randomInt:(a)=>a,randomChoice:a=>a[0],shuffle:a=>a,MORPH_LINE_PALETTES:[['#ffffff']],RANDOM_PALETTES:[['#ffffff']],MorphInterpolation:createMorphInterpolationModule()});
  const result=targets.buildMorphVisualTargets(state.layers);
  assert.equal(result[0].mode,'segments');
  assert.deepEqual(result[0].rawNodes,[{x:0,y:0},{x:1,y:0}]);
  assert.deepEqual(result[1].rawNodes,b.profileNodes);
  assert.deepEqual(a.profileNodes,b.profileNodes);
  assert.equal(result[0].closedLoop,true);
  assert.equal(state.morph.options.byShape,false);
  runtimeState.morph.manualProfileResetIds=null;
  assert.deepEqual(targets.buildMorphVisualTargets(state.layers)[0].rawNodes,a.profileNodes);
});

test('Blue keeps its current phase on reset click, reaches the straight line over the next full phase and commits it', async () => {
  const {state,runtimeState}=await importModule('js/core/state.js');
  const {createMorphPlaybackModule}=await importModule('js/morph-runtime/blue/playback.js');
  const {createMorphTargetsModule}=await importModule('js/morph-runtime/blue/targets.js');
  const {createMorphInterpolationModule}=await importModule('js/morph-runtime/blue/interpolation.js');
  const {MorphGeometry}=await importModule('js/geometry/morph.js');
  const {createLayer}=await importModule('js/core/defaults-layers.js');
  const {animationScheduler}=await importModule('js/core/scheduler.js');
  const original={...animationScheduler};
  const tasks=new Map(),paint=new Map();
  Object.assign(animationScheduler,{add:(k,f)=>tasks.set(k,f),afterNextPaint:(k,f)=>paint.set(k,f),remove:k=>{tasks.delete(k);paint.delete(k)},has:k=>tasks.has(k),hasAfterPaint:k=>paint.has(k),invalidate:()=>{}});
  const l=Object.assign(createLayer(),{id:'reset-lifecycle',profileMode:'segments',profileNodes:[{x:0,y:0},{x:.5,y:.3},{x:1,y:0}],spiralEnabled:false,spiralOrder:0,closedLoop:true});
  state.layers=[l];state.activeLayerId=l.id;
  state.morph.options=Object.fromEntries(Object.keys(state.morph.options).map(k=>[k,false]));
  Object.assign(state.morph,{mode:'circleSlide',unifiedMode:'circleSlide',intervalSec:3,intervalMultiplier:1,speedType:'linear',monoOrbitTransforms:false,diversity:false});
  state.tapTempo.syncFullMorph=false;state.tunnel.active=false;
  const MorphInterpolation=createMorphInterpolationModule();
  const MorphTargets=createMorphTargetsModule({randomInt:a=>a,randomChoice:a=>a[0],shuffle:a=>a,MORPH_LINE_PALETTES:[['#ffffff']],RANDOM_PALETTES:[['#ffffff']],MorphInterpolation});
  const playback=createMorphPlaybackModule({createOrangeComposition:()=>[],MorphTargets,MorphInterpolation,MorphGeometry});
  const rt=runtimeState.morph;
  const runAt=now=>{
    // Real animation logic, with the DOM/GPU paints omitted in Node.
    rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
    rt.lastEditorPaint=Infinity;rt.lastSidebarPaint=Infinity;
    playback.animateMorph(now);
  };
  const commit=()=>{const fn=paint.get('morph-cycle-boundary');assert.equal(typeof fn,'function');paint.delete('morph-cycle-boundary');fn();};
  try {
    Object.assign(rt,{active:true,paused:false,orderHoldHistory:new Map(),orbitCopyMemory:[],pendingProfileResetIds:null,manualProfileResetIds:null,manualProfileEditing:false});
    playback.prepareMorphCycle(performance.now());
    const serial=rt.phaseSerial;
    let start=rt.cycleStart;
    runAt(start+1000);
    assert.equal(playback.rebaseMorphCycle({resetProfileLayerId:l.id}),true);
    assert.equal(rt.phaseSerial,serial);
    assert.deepEqual([...rt.pendingProfileResetIds],[l.id]);
    assert.ok(l.profileNodes.some(p=>p.y>0));
    runAt(start+3001);commit();
    assert.equal(rt.phaseSerial,serial+1);
    assert.deepEqual(rt.targetProfiles[0].rawNodes,[{x:0,y:0},{x:1,y:0}]);
    assert.equal(rt.pendingProfileResetIds,null);
    assert.equal(state.morph.options.byShape,false);
    start=rt.cycleStart;
    runAt(start+1500);
    const ys=rt.frameLayers[0].profileNodes.map(p=>p.y);
    assert.ok(Math.max(...ys)>0 && Math.max(...ys)<0.2);
    runAt(start+3001);commit();
    assert.equal(rt.manualProfileResetIds,null);
    assert.deepEqual(l.profileNodes,[{x:0,y:0},{x:1,y:0}]);
    assert.equal(state.morph.options.byShape,false);
  } finally {
    rt.active=false;
    Object.assign(animationScheduler,original);
  }
});
