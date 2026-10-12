'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const css=read('styles/app.css');
const state=read('js/core/state.js');
const defaults=read('js/core/defaults-layers.js');
const appB=read('js/legacy/app-b.js');
const appC=read('js/legacy/app-c.js');
const gpu=read('js/gpu/lamp-renderer.js');

// UI contract: Rain remains a separate effect. Direction defaults to 180° = down,
// the slider snaps by 5°, and an independent exact numeric field accepts manual entry.
for(const id of ['lampFreezeLight','lampFreezeTailSec','lampFreezeHardness','lampFreezeRain','lampFreezeRainDegrees','lampFreezeRainDegreesNumber','lampFreezeRainSource','lampFreezeRainSpeed','lampFreezeRainTailSec','lampFreezeRainHardness']){
  assert(html.includes(`id="${id}"`),`Missing lamp trail control ${id}`);
}
assert(html.indexOf('id="lampFreezeRain"')>html.indexOf('id="lampFreezeLight"'),'FreezeLight Rain must appear below ordinary FreezeLight');
assert(html.includes('0° — вверх, 90° — вправо, 180° — вниз, 270° — влево'),'Rain direction convention must explicitly define 180° as down');
assert(/id="lampFreezeRainDegrees"[^>]*min="0"[^>]*max="355"[^>]*step="5"[^>]*value="180"/.test(html),'Rain direction slider must snap in 5-degree steps from the 180-degree default');
assert(/id="lampFreezeRainDegreesNumber"[^>]*type="number"[^>]*step="1"[^>]*value="180"/.test(html),'Rain direction must also allow exact manual numeric entry');
assert(html.includes('<option value="core" selected>Только core</option>')&&html.includes('<option value="lamp">Вся лампа</option>'),'Rain source selector must default to core and offer whole-lamp glow');
assert(/id="lampFreezeRainSpeed"[^>]*min="0"[^>]*max="100"[^>]*value="50"/.test(html),'Rain speed must default to 50%');
assert(css.includes('.lamp-freeze-rain-toggle')&&css.includes('.lamp-rain-angle-control'),'Rain controls need dedicated styling');

// Project/layer state and old-project migration defaults.
for(const token of ["freezeHardness: 50","freezeRain: false","freezeRainDirectionVersion: 2","freezeRainDegrees: 180","freezeRainSource: 'core'","freezeRainSpeed: 50","freezeRainTailSec: 1.5","freezeRainHardness: 50"]){
  assert(state.includes(token),`Missing state default ${token}`);
}
for(const token of ['hadRainDirectionVersion','legacyRainDegrees','owner.lamps.freezeRainDirectionVersion=2','owner.lamps.freezeRainDegrees','owner.lamps.freezeRainSource','owner.lamps.freezeRainSpeed','owner.lamps.freezeRainTailSec','owner.lamps.freezeRainHardness']){
  assert(defaults.includes(token),`Layer normalizer must migrate/default ${token}`);
}
assert(defaults.includes('owner.lamps.freezeRainDegrees=legacyRainDegrees+90'),'Legacy hf5 angle semantics must migrate 90° down to the new 180° down convention');
for(const token of ['state.lamps.freezeHardness','state.lamps.freezeRain=settings.lamps.freezeRain===true','migratedRainDegrees','state.lamps.freezeRainDirectionVersion=2','state.lamps.freezeRainSource','state.lamps.freezeRainSpeed','state.lamps.freezeRainTailSec','state.lamps.freezeRainHardness']){
  assert(appC.includes(token),`Project loader must migrate ${token}`);
}

// The two effects are independently switchable/resettable and are not nested behind each other.
assert(appC.includes("LampGPURenderer?.resetFreezeTrail?.()"),'Ordinary FreezeLight must reset only its own history');
assert(appC.includes("LampGPURenderer?.resetFreezeRain?.()"),'FreezeLight Rain must reset only its own history');
assert(appC.includes("document.getElementById('lampFreezeRainDegreesNumber')?.addEventListener('change'"),'Manual degrees field must commit changes');
assert(appC.includes("document.getElementById('lampFreezeRainSource')?.addEventListener('change'"),'Rain source selector must update state');
assert(appC.includes("document.getElementById('lampFreezeRainSpeed')?.addEventListener('input'"),'Rain speed control must update live');
assert(gpu.includes('function freezeLightEnabled()')&&gpu.includes('function freezeRainEnabled()')&&gpu.includes('function lampTrailEnabled()'),'GPU backend must model two independent enable flags');
assert(gpu.includes('freezeHistoryTextures=[null,null]')&&gpu.includes('rainHistoryTextures=[null,null]'),'Ordinary and rain trails need independent ping-pong histories');
assert(gpu.includes('Somata FreezeLight + Rain independent combine'),'When both are enabled, histories must combine only at final presentation');
assert(gpu.includes('Somata FreezeLight Rain + live lamp combine'),'Core-only Rain must be composited with the full live lamp instead of replacing it');
assert(gpu.includes('rainCurrentCombineBindGroups'),'Rain-only presentation must combine live full lamps with the independently filtered Rain history');
assert(gpu.includes('resetFreezeTrail,resetFreezeRain'),'Facade must expose independent history resets');

// Rain advection: 180 degrees maps down under the new 0-up/90-right convention.
assert(gpu.includes('let src=vec2<f32>(p.xy)-vec2<f32>(fu.shiftX,fu.shiftY);'),'Rain must advect prior history rather than changing ordinary FreezeLight');
assert(gpu.includes('const rad=(freezeRainDegrees()-90)*Math.PI/180,travel=freezeRainTravelPx(dt);'),'Rain direction must use the 180°-down convention');
function direction(deg){const r=(deg-90)*Math.PI/180;return [Math.cos(r),Math.sin(r)];}
let [dx,dy]=direction(180);assert(Math.abs(dx)<1e-12&&dy>0.999999,'180° must point down');
[dx,dy]=direction(0);assert(Math.abs(dx)<1e-12&&dy<-.999999,'0° must point up');
[dx,dy]=direction(90);assert(dx>.999999&&Math.abs(dy)<1e-12,'90° must point right');
[dx,dy]=direction(270);assert(dx<-.999999&&Math.abs(dy)<1e-12,'270° must point left');
assert(gpu.includes('const rainStarting=rainEnabled&&!rainHistoryValid')&&gpu.includes('signatureChanged||rainStarting'),'Enabling Rain on a static scene must still build its initial streak');

// Speed law: 0 = stationary, 50 = the previous nominal velocity, 100 = instant off-screen transport.
assert(gpu.includes('function freezeRainTravelPx(dt)'),'Rain speed must have its own travel law');
assert(gpu.includes('if(p<=0)return 0;'),'0% Rain speed must not advect history');
assert(gpu.includes('p/(1-p)'),'Rain speed must rise hyperbolically above/below the 50% reference');
assert(gpu.includes('if(p>=1)return Math.hypot(width,height)+Math.max(width,height);'),'100% Rain speed must be an immediate off-screen displacement');
function speedFactor(percent){const p=Math.max(0,Math.min(100,percent))/100;if(p<=0)return 0;if(p>=1)return Infinity;return p/(1-p);}
assert.strictEqual(speedFactor(0),0,'0% speed must be stationary');
assert(Math.abs(speedFactor(50)-1)<1e-12,'50% speed must preserve the old Rain velocity');
assert(speedFactor(75)>speedFactor(50),'75% must be faster than the old velocity');
assert.strictEqual(speedFactor(100),Infinity,'100% represents the instantaneous endpoint');

// Core vs whole-lamp source. Core masking only affects the feedback seed; presentation restores the live full lamp.
assert(gpu.includes('coreOnly:f32'),'Trail uniform must carry the core-only mode without adding another CPU geometry pass');
assert(gpu.includes('let coreMask=smoothstep(0.42,0.82,clamp(currentSample.a,0.0,1.0));'),'Core mode must reject the low-alpha outer glow');
assert(gpu.includes("rainUniformData[6]=freezeRainSource()==='core'?1:0"),'Core must be the GPU default/source switch');
assert(gpu.includes("function freezeRainSource(){return state?.lamps?.freezeRainSource==='lamp'?'lamp':'core';}"),'Unknown/old projects must default Rain source to core');

// Hardness semantics in the shader: 50% is linear, 0% hides historical pixels,
// 100% keeps uniform opacity until the configured hard time cutoff.
assert(gpu.includes('if(abs(h-0.5)<=0.0001){return remain;}'),'50% hardness must be exactly linear');
assert(gpu.includes('if(age>=tail||h<=0.000001){return 0.0;}'),'0% hardness / expired history must be invisible');
assert(gpu.includes('if(k>=0.9999){return 1.0;}'),'100% hardness must keep uniform historical opacity until cutoff');
function envelope(age,tailSec,hardness){
  const tail=Math.max(0.0001,tailSec),h=Math.max(0,Math.min(1,hardness));
  if(age<=0.000001)return 1;
  if(age>=tail||h<=0.000001)return 0;
  const remain=Math.max(0,1-age/tail);
  if(Math.abs(h-.5)<=.0001)return remain;
  if(h<.5){const k=Math.max(0,Math.min(1,(.5-h)*2)),amplitude=1-k,exponent=1+(6*k)/(1.25-k);return amplitude*Math.pow(remain,exponent);}
  const k=Math.max(0,Math.min(1,(h-.5)*2));if(k>=.9999)return 1;
  const exponent=(1-k)/(1+4*k);return Math.pow(remain,Math.max(.0001,exponent));
}
assert.strictEqual(envelope(.5,1,0),0,'0% hardness must have no visible history');
assert(Math.abs(envelope(.25,1,.5)-.75)<1e-12,'50% hardness must be linear at 25% age');
assert(Math.abs(envelope(.5,1,.5)-.5)<1e-12,'50% hardness must be linear at 50% age');
assert.strictEqual(envelope(.75,1,1),1,'100% hardness must stay uniform before the deadline');
assert.strictEqual(envelope(1,1,1),0,'100% hardness must still hard-cut at tail length');
assert(envelope(.5,1,.25)<.5,'Below 50% must bend below the linear fade');
assert(envelope(.5,1,.75)>.5,'Above 50% must bend above the linear fade');

// UI sync: independent rows remain enabled by their own checkboxes, including new controls.
assert(appB.includes('const freezeOn=c.freezeLight===true')&&appB.includes('const rainOn=c.freezeRain===true'),'UI enable/disable state must be independent');
for(const id of ['lampFreezeRainDegreesNumber','lampFreezeRainSource','lampFreezeRainSpeed'])assert(appB.includes(id),`${id} must be synchronized/disabled with Rain`);

// All runtime assets changed by this hotfix must bypass hf5 browser cache.
for(const file of ['js/core/state.js','js/core/defaults-layers.js','js/gpu/lamp-renderer.js']){
  assert(html.includes(`${file}?v=20261012-v7320-hf9`),`${file} must preserve hf9 cache-buster`);
}
assert(html.includes('styles/app.css?v=20261012-v7320-hf11'),'Fullscreen CSS must use hf11 cache-buster');
assert(html.includes('js/legacy/app-c.js?v=20261012-v7320-hf11'),'Fullscreen runtime must use hf11 cache-buster');
assert(html.includes('js/legacy/app-b.js?v=20261012-v7320-hf10'),'Lamp renderer bridge must use hf10 cache-buster');

console.log('FreezeLight Rain / hardness / direction / source / speed invariants: PASS');
