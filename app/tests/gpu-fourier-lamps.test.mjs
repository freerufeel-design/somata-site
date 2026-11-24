import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FOURIER_LAMP_WGSL,fourierLampPlanEligible,fourierLampSingleRail} from '../js/gpu/fourier-lamp-carrier.js';
import {importModule} from './helpers/app-env.mjs';
const code=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function fixture(){
 const cfg={positionMode:'arbitrary',snapToContour:true,morphMotionMode:'linear',extinguishIntersections:false};
 const set={config:cfg,points:[{pathIndex:0,lampAttachFraction:.3,lampId:'arb:0:0'}]};
 const frame={frameId:10,layer:{},lineDisplayEnabled:true,geometryPlan:{kind:'static'},staticDrawData:{paths:[{}]},renderGraph:{passes:[{name:'base'},{name:'lamps'}],needsCpuPath:true},effectsPlan:{lamps:{enabled:true,sets:[set],instances:{copies:[{}]}}}};
 return {frame,cfg,set};
}
test('only compatible snapped arbitrary static lamps can share the Fourier contour',()=>{
 const {frame,cfg,set}=fixture();const state={tunnel:{active:false},lamps:{}};
 assert.equal(fourierLampPlanEligible(frame,state,true),true);
 assert.equal(fourierLampPlanEligible(frame,state,false),false);
 for(const [key,value] of [['snapToContour',false],['positionMode','key'],['morphMotionMode','key'],['extinguishIntersections',true],['webgl',false]]){
  const old=cfg[key];cfg[key]=value;assert.equal(fourierLampPlanEligible(frame,state,true),false,key);cfg[key]=old;
 }
 for(const key of ['morphFrameActive','geometryMorphEnabled','greenMorphEnabled','minimalFadeEnabled','forcedLampMorph']){
  frame[key]=true;assert.equal(fourierLampPlanEligible(frame,state,true),false,key);frame[key]=false;
 }
 state.tunnel.active=true;assert.equal(fourierLampPlanEligible(frame,state,true),false);state.tunnel.active=false;
 state.lamps.freezeRain=true;assert.equal(fourierLampPlanEligible(frame,state,true),false);state.lamps.freezeRain=false;
 set.points[0].pathIndex=1;assert.equal(fourierLampPlanEligible(frame,state,true),false);set.points[0].pathIndex=0;
 frame.staticDrawData.paths.push({});assert.equal(fourierLampPlanEligible(frame,state,true),false);
});
test('recorded rail must have one contour and a similarity transform for invariant arc fractions',()=>{
 const rail={rail:{outCount:288,closed:true},matrix:[0,2,-2,0,100,200]};const subpath={gpuFourier:rail,points:[]};
 assert.equal(fourierLampSingleRail([{subpaths:[subpath]}]),rail);
 assert.equal(fourierLampSingleRail([{subpaths:[subpath,subpath]}]),null);
 rail.matrix=[2,0,0,3,0,0];assert.equal(fourierLampSingleRail([{subpaths:[subpath]}]),null);
 rail.matrix=[1,0,1,1,0,0];assert.equal(fourierLampSingleRail([{subpaths:[subpath]}]),null);
});
test('stroke graph permits only the narrow lamp consumer and retains existing fallback',async()=>{
 const {frame}=fixture();const {state}=await importModule('js/core/state.js');const {LampGPURenderer}=await importModule('js/gpu/lamp-renderer.js');const {WebGPUStrokeRenderer}=await importModule('js/gpu/stroke-renderer.js');const {gpuFourierBatchIneligible:check}=await importModule('js/render/stroke-batch-service.js');
 const old=[state.tunnel.active,state.showRoundingGuides,state.lamps.freezeRain,state.lamps.freezeLight,LampGPURenderer.isWebGPUReady,WebGPUStrokeRenderer.fourierComputeReady];
 try{state.tunnel.active=state.showRoundingGuides=state.lamps.freezeRain=state.lamps.freezeLight=false;LampGPURenderer.isWebGPUReady=WebGPUStrokeRenderer.fourierComputeReady=()=>true;
 assert.equal(check(frame,[{role:'base'}],{},false,false),'');
 frame.renderGraph.passes.push({name:'web'});assert.equal(check(frame,[{role:'base'}],{},false,false),'additional-contour-consumer');frame.renderGraph.passes.pop();
 frame.effectsPlan.lamps.sets[0].config.positionMode='key';assert.equal(check(frame,[{role:'base'}],{},false,false),'additional-contour-consumer');
 }finally{[state.tunnel.active,state.showRoundingGuides,state.lamps.freezeRain,state.lamps.freezeLight,LampGPURenderer.isWebGPUReady,WebGPUStrokeRenderer.fourierComputeReady]=old;}
});
test('one prerequisite and same resident GPUBuffer feed stroke and lamp vertex shaders, no readback',()=>{
 const stroke=code('js/gpu/stroke-renderer.js'), lamp=code('js/gpu/lamp-renderer.js'), pass=code('js/render/lamp-pass.js');
 assert.match(stroke,/device\.queue\.submit\(\[fourierPrerequisite\.finish\(\)\]\)/);
 assert.match(stroke,/fourierLampCarrier: lampRail \? \{device, buffer:rec\.pointBuffer/);
 assert.match(lamp,/buffer: fourier \? fourier\.buffer : arcRec\.segmentBuffer/);
 assert.match(lamp,/if\(u\.root1\.w < -0\.5\)\{return sampleFourierLamp\(anchor\.y\);\}/);
 assert.match(FOURIER_LAMP_WGSL,/distance\(last\.xy,first\.xy\)/);
 assert.match(FOURIER_LAMP_WGSL,/morphArcSegments\[mid\]\.w<arcTarget/);
 assert.match(pass,/queued\) \{ renderBackendTelemetry\.mark\('lamps','gpu','GPU Fourier shared contour lamps'\); continue;/);
 assert.doesNotMatch(FOURIER_LAMP_WGSL,/mapAsync|copyBufferToBuffer/);
});
test('actual static Fourier polygon produces matching single rail and stable arbitrary lamp identities',async()=>{
 const {state,somataWithFourierLayer}=await importModule('js/core/state.js');
 const {withLampConfig}=await importModule('js/core/defaults-layers.js');
 const {getCachedLayerDrawData}=await importModule('js/effects/motion.js');
 const {collectStaticLampPoints}=await importModule('js/geometry/frame-paths.js');
 const {renderLayerOrbitPaths}=await importModule('js/render/spiral-stroke.js');
 const {createGeometryGLRecordingContext}=await importModule('js/render/gl-recording-context.js');
 const layer={...state.layers[0],id:'fourier-lamp-regression',N:4,K:1,radius:100,roundingCornerType:'fourier',rounding:90,strokeColor:'#ffffff',spiralEnabled:false,spiralOrder:0,closedLoop:true,fill:false,spiralFillEnabled:false};
 const cfg={...state.lamps,positionMode:'arbitrary',morphMotionMode:'linear',snapToContour:true,extinguishIntersections:false,density:100,densityMultiplier:1};
 const data=getCachedLayerDrawData(layer);assert.equal(data.paths.length,1);
 somataWithFourierLayer(layer,()=>withLampConfig(cfg,()=>{
  const lamps=collectStaticLampPoints(layer,data,240);assert.ok(lamps.length>0);
  const rec=createGeometryGLRecordingContext(null);rec.__somataGpuFourierRecording=true;rec.strokeStyle='#ffffff';rec.lineCap=rec.lineJoin='round';renderLayerOrbitPaths(rec,layer,data);
  const rail=fourierLampSingleRail(rec.commands);assert.ok(rail);assert.equal(rail.rail.closed,Boolean(data.paths[0].closed));
  assert.ok(lamps.every(p=>p.pathIndex===0 && Number.isFinite(p.lampAttachFraction) && p.lampId.startsWith('arb:0:')));
  assert.deepEqual(collectStaticLampPoints(layer,data,240).map(p=>[p.lampId,p.lampAttachFraction]),lamps.map(p=>[p.lampId,p.lampAttachFraction]));
 }));
});
