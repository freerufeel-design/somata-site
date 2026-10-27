'use strict';
// No physical GPU required. Verify the no-visible-copies Corridor contract and
// factual recovery status against the real 9.2.3 render modules.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
function sandbox(impl={}){
  const ctx={window:{},console:{error(){},warn(){}},performance:{now:()=>250},
    state:{tunnel:{active:true},morph:{}},runtimeState:{morph:{active:false},minimalMorph:{active:false},projectMorph:{active:false}},...impl};
  vm.createContext(ctx);return ctx;
}
// A repaint request isn't successful recovery; only a later confirmed Base draw is.
{
 const errors=[];
 const ctx=sandbox({console:{error:(...a)=>errors.push(a),warn:()=>{}}});
 vm.runInContext(read('js/render/render-diagnostics.js'),ctx);
 const bad={frameId:80,layer:{id:'corridor-A'},layerIndex:0};
 ctx.somataGpuDiagnosticError('geometry','base','GPU Corridor Base unavailable',bad,{recovered:false,recoveryPending:true});
 assert.equal(ctx.window.__somataGpuRuntimeDiagnostics().last.recovered,false);
 assert.equal(ctx.window.__somataGpuRuntimeDiagnostics().last.version,'9.2.25');
 assert.equal(ctx.window.__somataGpuRuntimeDiagnostics().pendingBaseRecoveries,1);
 assert.equal(ctx.somataGpuNoteRecovery('geometry','base',bad),false,'Same frame is not verified recovery');
 assert.equal(ctx.somataGpuNoteRecovery('geometry','base',{...bad,frameId:81}),true);
 assert.equal(ctx.window.__somataGpuRuntimeDiagnostics().recoveryCount,1);
 assert.equal(ctx.window.__somataGpuRuntimeDiagnostics().pendingBaseRecoveries,0);
 assert.equal(ctx.somataGpuNoteRecovery('geometry','base',{...bad,frameId:82}),false);
 // Repeat the same signature: the pending recovery must point at the NEW failed frame.
 ctx.somataGpuDiagnosticError('geometry','base','GPU Corridor Base unavailable',{...bad,frameId:90},{recovered:false,recoveryPending:true});
 assert.equal(ctx.somataGpuNoteRecovery('geometry','base',{...bad,frameId:89}),false);
 assert.equal(ctx.somataGpuNoteRecovery('geometry','base',{...bad,frameId:91}),true);
 assert.equal(errors.length,1,'Repeated diagnostic signatures should be deduplicated');
}
// Real Base pass: fully clipped/absent Corridor copies are an intentional empty
// frame, not a GPU submission failure. Missing visibleInstances is NOT the same.
{
 let errors=0,circles=0,telemetry=[];
 const ctx=sandbox({
   mainCtx:{globalAlpha:0,shadowBlur:1},
   SomataGeometryRoleService:{isStrict:()=>false},
   SomataLayerSceneService:{resident:()=>null},
   shouldForceCanvasBaseStroke:()=>false,
   SomataFillPassService:{begin:()=>({forceCanvasFill:false,fillPrepared:false,sceneHasAuthoritativeFill:false,needsOutOfSceneFill:false,canKeepGpuSceneOverCanvasFill:false,contract:{}}),resolve:()=>false},
   isPathFxBaseReplacementActive:()=>false,
   getResidentGpuLayerScene:()=>null,
   renderLayerGeometryCirclesPass:()=>circles++,
   renderBackendTelemetry:{mark:(...a)=>telemetry.push(a)},
   somataGpuDiagnosticError:()=>errors++,
   SomataRenderPassRegistry:{STAGES:{BASE:20},register:()=>{}},
   requestMainCanvasRender:()=>{},
 });
 vm.runInContext(read('js/render/base-pass.js'),ctx);
 const frame={frameId:1,frame:{id:1},layer:{id:'corridor-empty'},layerIndex:0,geometryPlan:{kind:'static'},visibleInstances:{copies:[]},lineDisplayEnabled:true};
 ctx.renderLayerBaseGeometryPass(frame);
 assert.equal(frame._baseStrokeCommitted,true,'Explicit empty copies count as successful empty Base');
 assert.equal(circles,1);
 assert.equal(errors,0);
 assert(telemetry.some(t=>String(t[2]).includes('no visible copies')));
}
console.log('PASS Corridor empty-frame contract; verified recovery, deduplication and version 9.2.25');
