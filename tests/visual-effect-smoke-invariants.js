'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const self=read('js/core/self-test.js');
const appB=read('js/legacy/app-b.js');
const appC=read('js/legacy/app-c.js');

assert(self.includes('window.__somataVisualEffectSmokeTest=async'),'Pixel-differential visual smoke API must be exposed');
assert(self.includes('window.__somataUiInvalidationSmokeTest=async'),'Real DOM invalidation smoke API must be exposed');
assert(self.includes('function pixelDiff(')&&self.includes('changedPixels'),'Visual smoke must compare final Canvas pixels, not only telemetry');
for(const token of ["{feature:'base',project:'Радуга'}","{feature:'fill',project:'Радуга'}","{feature:'glow',project:'Радуга'}","{feature:'lamps',project:'Радуга'}","{feature:'sweep',project:'Радуга'}","{feature:'motionRotation',project:'Радуга'}","{feature:'web',project:'Мозголом',warmFrames:40}","{feature:'geometryCircles',project:'Мозголом'}","{feature:'spiral',project:'Мозголом'}","{feature:'corridor',project:'цветок'}"])
  assert(self.includes(token),`Visual smoke fixture missing: ${token}`);
assert(self.includes('runtimeState?.morph?.frameLayers')&&self.includes("test.feature==='web'"),'Web visual smoke must isolate the real Blue-Morph resolved frame');
assert(self.includes("setContourMode(layer,'closed')")&&self.includes('spiralOrder=0'),'Spiral visual disable must use canonical non-Spiral topology semantics');
assert(self.includes("sourceFill=runtimeState?.morph?.sourceVisuals")&&self.includes('Blue Morph rebase did not capture disabled Fill'),'Fill UI smoke must validate authored source rebasing, not demand that Morph targets stay disabled');
assert(appC.includes("invalidateLayerProperties(layer,['glow'],'ui-glow')"),'Glow UI must bump versioned style invalidation');
assert(appC.includes("invalidateLayerProperties(layer,['fill','fillColor'],'ui-fill-enabled')"),'Fill UI must bump versioned style invalidation');
assert(appB.includes("invalidateLayerEffect(owner,'web-switch')"),'Web UI switch must bump effect version so Blue frame copies resync');
assert(appB.includes("invalidateLayerEffect(layer,'web-switch-boundary')"),'Queued Web type changes must invalidate at Morph boundaries');
console.log('Visual effect / UI invalidation smoke invariants: PASS');
