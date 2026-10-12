'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pipeline=read('js/render/main-pipeline.js');
const appA=read('js/legacy/app-a.js');
const defaults=JSON.parse(read('default.plist'));

function fillAlpha(color){const m=String(color||'').match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/);return m?parseInt(m[1],16)/255:1;}
function findCorridorFillGlowFixture(x){
  if(Array.isArray(x)){for(const v of x){const r=findCorridorFillGlowFixture(v);if(r)return r;}return null;}
  if(x&&typeof x==='object'){
    if(x.project){
      const project=x.project;
      const tunnel=project.settings?.tunnel||{};
      const fillLayers=(project.layers||[]).filter(l=>l?.visible!==false&&l?.lineVisible!==false&&l?.fill===true&&fillAlpha(l?.fillColor)>0.00001&&Number(l?.glow)>0);
      if((tunnel.active===true||tunnel.defaultActive===true)&&fillLayers.length)return {name:x.name,project,fillLayers};
    }
    for(const v of Object.values(x)){const r=findCorridorFillGlowFixture(v);if(r)return r;}
  }
  return null;
}
const fixture=findCorridorFillGlowFixture(defaults);
assert.ok(fixture,'Playlist must contain a Corridor + Fill + Glow regression fixture');
assert.ok(fixture.project.settings?.tunnel?.active===true||fixture.project.settings?.tunnel?.defaultActive===true,'Regression fixture requires Tunnel/Corridor');
assert.ok(fixture.fillLayers.length>=1,'Regression fixture requires authored Fill');
assert.ok(fixture.fillLayers.some(l=>Number(l?.glow)>0),'Regression fixture requires Fill + Glow on the same layer');

assert.ok(pipeline.includes("WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId)"),'Corridor Fill must detect an already-resident Layer Scene');
assert.ok(pipeline.includes('function canAttachNativeCorridorFillToLayerScene(frameCtx,contract=null)'),'Corridor Fill + Glow must have an explicit native GPU preflight before opening the resident scene');
assert.ok(pipeline.includes("if(contract?.fillRequested===true&&!canAttachNativeCorridorFillToLayerScene(frameCtx,contract))return false;"),'Fill-requested Corridor layers must no longer categorically reject the GPU-only Layer Scene path');
assert.ok(pipeline.includes('frameCtx._corridorNativeFillPreflight=mesh')&&pipeline.includes('const mesh=frameCtx?._corridorNativeFillPreflight||frameCtx?._fillMeshShadow'),'The exact preflighted native Fill mesh must be reused when Fill joins the scene');
assert.ok(pipeline.includes("queueLayerSceneEffectCommand(frameCtx,4,rec.commandBuffer,'corridor-native-fill')"),'Corridor Fill must join resident scene between Glow and Base');
assert.ok(pipeline.includes('function getResidentGpuLayerScene(frameCtx)')&&pipeline.includes('const residentScene=getResidentGpuLayerScene(frameCtx);')&&pipeline.includes('if(residentScene?.texture)return true;'),'Corridor eligibility must treat any same-frame resident GPU Layer Scene as attachable instead of demanding a second external scene');
assert.ok(pipeline.includes("queueLayerSceneEffectCommand(frameCtx,3,rec.commandBuffer,'corridor-glow')")&&pipeline.includes("queueLayerSceneEffectCommand(frameCtx,4,rec.commandBuffer,'corridor-native-fill')")&&pipeline.includes("queueLayerSceneEffectCommand(frameCtx,5,rec.commandBuffer,'corridor-base')"),'Resident Corridor scene ordering must remain Glow -> Fill -> Base entirely on GPU');
assert.ok(pipeline.includes("const sceneAlreadyActive=Boolean(residentBeforeCorridorBase?.texture)")&&pipeline.includes("!sceneAlreadyActive"),'Corridor Base must preserve an existing resident scene instead of clearing or replacing it');
assert.ok(pipeline.includes('joinedResident:Boolean(resident?.texture)'),'Corridor Fill diagnostics should expose resident-scene joining');
assert.ok(pipeline.includes("frame.strictSpiralEntryIntent===true||frame.strictSpiralGpuPresentRequired===true||isStrictSpiralWebGPUFrame(frameCtx)"),'Materialization firewall must protect the entire strict-Spiral frame');
assert.ok(appA.includes("gpuPathFxRequired()||state?.tunnel?.active===true||frame?.strictSpiralEntryIntent===true||frame?.strictSpiralGpuPresentRequired===true"),'Corridor/strict GPU scenes must bypass stale FrameGraph cooldown');
assert.ok(pipeline.includes('corridorNativeFillPreflightSceneRoot:true')&&pipeline.includes('corridorResidentGlowFillBase:true'),'Runtime audit must expose the 7.2.8 resident Corridor Fill contract');
console.log(`Corridor Fill resident-scene invariants OK (${fixture.name})`);
