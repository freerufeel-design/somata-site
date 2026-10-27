'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
let t=0,rep=0,warm=0,geo=0,errors=[],telemetry=[];
const ctx={window:{},console:{error(...v){errors.push(v)}},performance:{now:()=>t},state:{tunnel:{active:false}},
  WebGPUStrokeRenderer:{warmup:()=>warm++},GeometryGPURenderer:{warmup:()=>geo++},
  requestMainCanvasRender:()=>rep++,renderBackendTelemetry:{mark:(...a)=>telemetry.push(a)},
  SomataRenderPassRegistry:{STAGES:{BASE:20},register(){}},
  SomataRenderDiagnostics:{noteRecovery(){}},SomataFeatureHost:{provide(){}},mainCtx:{},SomataLayerSceneService:{resident(){return null}},
};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'js/render/base-pass.js'),'utf8'),ctx);
const f={frameId:1,layer:{id:'electro-a'}};
for(let i=0;i<80;i++){f.frameId=i+1;t=i*12;ctx.deferTransientBaseBatchMiss(f,'WebGPU stroke batch was not created');}
assert(warm<=6,'GPU warmup called on every frame');assert(rep<=7,'Base retry caused unbounded repaint loop');
assert.equal(vm.runInContext("somataBaseBatchMisses.size",ctx),1);
// Sweep errors must not be reported as successful recovery or repaint each layer/frame.
vm.runInContext(fs.readFileSync(path.join(root,'js/render/sweep-pass.js'),'utf8'),ctx);
for(let i=0;i<40;i++){t=1000+i*8;ctx.reportSweepGpuIssue({frameId:30+i,layerIndex:2},'layer-scene-not-ready','scene missing');}
assert(rep<=9,'Sweep failures caused repaint storm');
console.log('PASS 9.2.4 GPU repaint throttle and no repeated per-frame warmup',{warm,rep,errors:errors.length});
