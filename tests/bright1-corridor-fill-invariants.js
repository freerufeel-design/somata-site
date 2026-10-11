'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pipeline=read('js/render/main-pipeline.js');
const appA=read('js/legacy/app-a.js');
const defaults=JSON.parse(read('default.plist'));

function findBright1(x){
  if(Array.isArray(x)){for(const v of x){const r=findBright1(v);if(r)return r;}return null;}
  if(x&&typeof x==='object'){
    if(x.name==='ярко1'&&x.project)return x.project;
    for(const v of Object.values(x)){const r=findBright1(v);if(r)return r;}
  }
  return null;
}
const bright=findBright1(defaults);
assert.ok(bright,'ярко1 preset must exist');
assert.strictEqual(bright.settings?.tunnel?.active,true,'ярко1 regression trigger requires active Tunnel/Corridor');
const layers=bright.layers||[];
assert.strictEqual(layers.length,3,'ярко1 regression fixture should keep its 3-layer structure');
const fillLayers=layers.filter(l=>l?.fill===true);
assert.strictEqual(fillLayers.length,1,'ярко1 should have one authored Fill layer');
assert.ok(Number(fillLayers[0]?.glow)>0,'ярко1 Fill layer must keep Glow enabled to cover the resident-scene conflict');

assert.ok(pipeline.includes("WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId)"),'Corridor Fill must detect an already-resident Layer Scene');
assert.ok(pipeline.includes("queueLayerSceneEffectCommand(frameCtx,4,rec.commandBuffer,'corridor-native-fill')"),'Corridor Fill must join resident scene between Glow and Base');
assert.ok(pipeline.includes('joinedResident:Boolean(resident?.texture)'),'Corridor Fill diagnostics should expose resident-scene joining');
assert.ok(pipeline.includes("frame.strictSpiralEntryIntent===true||frame.strictSpiralGpuPresentRequired===true||isStrictSpiralWebGPUFrame(frameCtx)"),'Materialization firewall must protect the entire strict-Spiral frame');
assert.ok(appA.includes("gpuPathFxRequired()||state?.tunnel?.active===true||frame?.strictSpiralEntryIntent===true||frame?.strictSpiralGpuPresentRequired===true"),'Corridor/strict GPU scenes must bypass stale FrameGraph cooldown');
console.log('Bright1 Corridor Fill invariants OK');
