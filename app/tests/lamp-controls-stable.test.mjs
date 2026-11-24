import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, importModule } from './helpers/app-env.mjs';
import { stablePolarProgress } from '../js/lamps/stable-motion.js';

test('stable polar travel: equal time intervals cover equal path lengths with changing radius and angle', () => {
  for (const [r0,r1,da] of [[20,300,2.8],[300,20,-2.8],[100,100,1.4],[0,200,0],[0,200,4]]) {
    const distances=[];
    const pt=t=>{const u=stablePolarProgress(t,r0,r1,da),r=r0+(r1-r0)*u;return [r*Math.cos(da*u),r*Math.sin(da*u)];};
    for(let i=0;i<20;i++){
      let d=0,p=pt(i/20);
      for(let j=1;j<=40;j++){const q=pt((i+j/40)/20);d+=Math.hypot(q[0]-p[0],q[1]-p[1]);p=q;}
      distances.push(d);
    }
    assert.ok(Math.max(...distances)/Math.min(...distances)<1.0001,`${r0},${r1},${da}: ${distances}`);
    assert.equal(stablePolarProgress(0,r0,r1,da),0);
    assert.equal(stablePolarProgress(1,r0,r1,da),1);
  }
});

test('stock lamp defaults and stable motion survive layer normalisation', async () => {
  await loadApp();
  const {state}=await importModule('js/core/state.js');
  const {createLayer,ensureLayerLampState}=await importModule('js/core/defaults-layers.js');
  const layer=createLayer();
  for(const cfg of [state.lamps,layer.lamps]){
    assert.deepEqual([cfg.brightness,cfg.radius,cfg.radiusMultiplier,cfg.softness,cfg.softnessMultiplier,cfg.morphMotionMode,cfg.snapToContour,cfg.adaptiveAudio],[100,30,2,100,1,'key',true,false]);
  }
  layer.lamps.morphMotionMode='stable'; layer.lamps.adaptiveAudio=true;
  assert.equal(ensureLayerLampState(layer).morphMotionMode,'stable');
  assert.equal(ensureLayerLampState(layer).adaptiveAudio,true);
  layer.lamps.morphMotionMode='linear';
  assert.equal(ensureLayerLampState(layer).morphMotionMode,'linear');
});

test('Master no-op on source broadcasts all lamp fields and refreshes every live Blue copy without copying other fields', async()=>{
  await loadApp();
  const {state,runtimeState}=await importModule('js/core/state.js');
  const {createLayer,getLampConfigTargets}=await importModule('js/core/defaults-layers.js');
  const {mirrorMasterLayerDiff,masterLayerSnapshot}=await importModule('js/ui/master-layer.js');
  const a=createLayer('a'),b=createLayer('b'),c=createLayer('c');
  state.layers=[a,b,c];state.activeLayerId=b.id;state.masterLayerEdit=true;
  for(const [i,l] of state.layers.entries()) Object.assign(l.lamps,{adaptiveExponentMultiplier:i+2,adaptiveStrengthMultiplier:i+1,radius:20+i,adaptiveAudio:i===1});
  const copies=()=>state.layers.map(l=>structuredClone(l));
  Object.assign(runtimeState.morph,{active:true,frameLayers:copies(),lightLayers:copies(),renderSourceLayers:copies(),renderTargetLayers:copies(),sourceVisuals:copies(),targetVisuals:copies()});
  assert.equal(getLampConfigTargets().length,3);
  for(const [field,id,value] of [['adaptiveExponentMultiplier','lampAdaptiveExponentMultiplier',3],['adaptiveStrengthMultiplier','lampAdaptiveStrengthMultiplier',2],['adaptiveAudio','lampAdaptiveAudio',true]]){
    const before=masterLayerSnapshot(b),beforeTargets=new Map([a,c].map(l=>[l.id,masterLayerSnapshot(l)]));
    assert.equal(b.lamps[field],value);
    mirrorMasterLayerDiff(before,{sourceId:b.id,beforeTargets,controlId:id,eventType:'input'});
    for(const list of [state.layers,runtimeState.morph.frameLayers,runtimeState.morph.lightLayers,runtimeState.morph.renderSourceLayers,runtimeState.morph.renderTargetLayers,runtimeState.morph.sourceVisuals,runtimeState.morph.targetVisuals]){
      assert.deepEqual(list.map(l=>l.lamps[field]),[value,value,value]);
      assert.deepEqual(list.map(l=>l.lamps.radius),[20,21,22]);
    }
  }
  state.masterLayerEdit=false;runtimeState.morph.active=false;
});

test('audio boost enters the exposure threshold only when opted in, and is attenuated after overload', async()=>{
  await loadApp();
  const {lampAdaptiveFrame,lampAdaptiveExposureFactors,lampAdaptiveAudioValue}=await importModule('js/lamps/lamp-visual.js');
  const at=(enabled,audio,baseR=10)=>{
    Object.assign(lampAdaptiveFrame,{previousArea:0,currentArea:0,viewportArea:30000,instantStatic:true});lampAdaptiveFrame.seen.clear();
    return lampAdaptiveExposureFactors({adaptiveBrightness:true,adaptiveAudio:enabled,adaptiveAdjustBrightness:true,adaptiveStrength:100,adaptiveExponent:0,adaptiveFadeSec:0},10,1,baseR,1,1,audio);
  };
  assert.equal(at(false,{size:3,brightness:4}).brightnessFactor,1);
  assert.equal(at(true,{size:1,brightness:1.1}).brightnessFactor,1);
  const load=at(true,{size:3,brightness:4});
  assert.ok(load.brightnessFactor<0.5);
  assert.equal(lampAdaptiveAudioValue(10,.5,3,false),25);
  assert.equal(lampAdaptiveAudioValue(10,.5,3,true),15);
  assert.equal(lampAdaptiveAudioValue(10,.5,.8,true),lampAdaptiveAudioValue(10,.5,.8,false));
});

test('published Blue polygon stable lamps advance uniformly on their own clock despite eased geometry', async()=>{
  await loadApp();
  const {state,runtimeState}=await importModule('js/core/state.js');
  const {createLayer}=await importModule('js/core/defaults-layers.js');
  const {SomataFeatureHost}=await importModule('js/render/feature-host.js');
  await importModule('js/render/lamp-plan.js');
  const layer=Object.assign(createLayer(),{id:'stable-reference',N:4,K:1,radius:60,radiusMultiplier:1,rotation:0,rounding:0,spiralEnabled:false,spiralOrder:0,showLamps:true});
  Object.assign(layer.lamps,{positionMode:'key',morphMotionMode:'stable',snapToContour:false});
  const b={...layer,radius:230,rotation:70};state.layers=[layer];state.activeLayerId=layer.id;state.tunnel.active=false;
  Object.assign(state.morph,{mode:'circleSlide',unifiedMode:'circleSlide'});
  Object.assign(runtimeState.morph,{active:true,lampCycleSerial:9,renderSourceLayers:[layer],renderTargetLayers:[b]});
  const runtime=window.SomataMorphRuntime,spec=runtime.describe({sourceLayer:layer,targetLayer:b,origin:'blue',mode:'circleSlide'});
  let previous=null;const lengths=[];
  for(let i=0;i<=80;i++){
    const t=i/80,eased=t*t*t;runtimeState.morph.progress=t;
    const f={layer:{...(i===80?b:layer)},effectLayer:layer,layerIndex:0,baseAlpha:1,morphFrameActive:true,blueMorphProvider:{active:true,mode:'circleSlide',geometryT:eased},frame:{viewportOuterRadius:500,tunnelCopies:[]},visibleInstances:{copies:[{}]}};
    assert.ok(runtime.publish(f,runtime.samplePrimary(spec,eased)));
    const pts=SomataFeatureHost.query('lamps','effectPlan',f,{}).sets[0].points;
    const p=previous?pts.find(p=>p.lampId===previous.lampId):pts[0]; assert.ok(p);
    if(previous) lengths.push(Math.hypot(p.x-previous.x,p.y-previous.y));previous=p;
  }
  assert.ok(Math.min(...lengths)>0.1);
  assert.ok(Math.max(...lengths)/Math.min(...lengths)<1.01,`min=${Math.min(...lengths)}, max=${Math.max(...lengths)}`);
  runtimeState.morph.active=false;
});

test('Master discovers registered controls and data attributes without another handler mapping',async()=>{
  await loadApp();
  const {SomataMasterBroadcastCore:core}=await importModule('js/ui/master-broadcast-core.js');
  const {SomataParameterRegistry:registry}=await importModule('js/core/parameter-routing.js');
  registry.register({id:'test.master.discovered',scope:'layer',ui:{mainId:'customNewControl'},morph:{frameTarget:'effect',framePath:'lamps.radiusMultiplier'}});
  assert.deepEqual(core.controlPaths('customNewControl',{lamps:{radiusMultiplier:3}}),['lamps.radiusMultiplier']);
  assert.deepEqual(core.controlPaths('customNewControl',{}),[]);
  registry.register({id:'test.master.global',scope:'layer',ui:{mainId:'globalControl'},morph:{frameTarget:'global',framePath:'lamps.radiusMultiplier'}});
  assert.deepEqual(core.controlPaths('globalControl',{lamps:{radiusMultiplier:3}}),[]);
  for(const attr of ['[data-lamp-appearance]','[data-lamp-adaptive-channel]','[data-lamp-motion]']) assert.ok(core.dataSelector.includes(attr));
  assert.deepEqual(core.controlPaths('',{lamps:{appearance:'modern'}},{lampAppearance:'modern'}),['lamps.appearance']);
});
