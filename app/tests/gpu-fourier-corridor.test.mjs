import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importModule } from './helpers/app-env.mjs';
import { FOURIER_WGSL } from '../js/gpu/fourier-compute.js';

const code = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
async function setup() {
  const { state, somataWithFourierLayer } = await importModule('js/core/state.js');
  const { WebGPUStrokeRenderer } = await importModule('js/gpu/stroke-renderer.js');
  const { gpuFourierCorridorIneligible, recordGpuFourierCommands } = await importModule('js/render/stroke-command-cache.js');
  const { getCachedLayerDrawData } = await importModule('js/effects/motion.js');
  const { renderLayerOrbitPaths } = await importModule('js/render/spiral-stroke.js');
  const layer = { ...state.layers[0], N:4,K:1,radius:100,roundingCornerType:'fourier',rounding:90,
    strokeColor:'#ffffff', spiralEnabled:false,spiralOrder:0,closedLoop:true,fill:false,spiralFillEnabled:false,geometryCircles:{enabled:false} };
  return {state,layer,somataWithFourierLayer,WebGPUStrokeRenderer,gpuFourierCorridorIneligible,recordGpuFourierCommands,getCachedLayerDrawData,renderLayerOrbitPaths};
}

test('Fourier Corridor is only eligible with no CPU/extra contour consumers, including feature-scoped views', async()=>{
  const {state,layer,WebGPUStrokeRenderer,gpuFourierCorridorIneligible:check}=await setup();
  const old={active:state.tunnel.active,colorShiftEnabled:state.tunnel.colorShiftEnabled,paletteLagEnabled:state.tunnel.paletteLagEnabled};
  const ready=WebGPUStrokeRenderer.fourierComputeReady, guides=state.showRoundingGuides;
  try {
    Object.assign(state.tunnel,{active:true,colorShiftEnabled:false,paletteLagEnabled:false});state.showRoundingGuides=false;
    WebGPUStrokeRenderer.fourierComputeReady=()=>true;
    const frame={layer,lineDisplayEnabled:true,geometryPlan:{kind:'static'},renderGraph:{passes:[{name:'base'}]},effectsPlan:{}};
    assert.equal(check(frame),'');
    assert.equal(check({...frame,renderGraph:{passes:[{name:'base'}],needsExactArc:true}}),'additional-contour-consumer');
    assert.equal(check({...frame,renderGraph:{passes:[{name:'base'},{name:'web'}]}}),'additional-contour-consumer');
    assert.equal(check(frame,{fillRequested:true}),'fill-or-geometry-circles');
    assert.equal(check({...frame,_sharedFrameContourRequired:true}),'shared-cpu-carrier');
    assert.equal(check({...frame,__somataFeatureParent:{effectsPlan:{lamps:{enabled:true}}}}),'effect-enabled');
    assert.equal(check({...frame,geometryPlan:{kind:'green-morph'}}),'special-geometry-route');
    state.tunnel.paletteLagEnabled=true;assert.equal(check(frame),'mixed-cpu-corridor');state.tunnel.paletteLagEnabled=false;
    WebGPUStrokeRenderer.fourierComputeReady=()=>false;assert.equal(check(frame),'compute-warming-or-unavailable');
  } finally {Object.assign(state.tunnel,old);state.showRoundingGuides=guides;WebGPUStrokeRenderer.fourierComputeReady=ready;}
});

test('actual static polygon and spiral record one descriptor master independently of copy count; CPU state restored',async()=>{
  const {state,layer,somataWithFourierLayer,recordGpuFourierCommands,getCachedLayerDrawData,renderLayerOrbitPaths}=await setup();
  const previous=state.tunnel.active;state.tunnel.active=true;
  try {
    for(const order of [0,1,-1]) {
      const l={...layer,spiralEnabled:order!==0,spiralOrder:order,spiralClosed:true};
      const data=getCachedLayerDrawData(l);
      let draws=0;
      const frame={layer:l,baseAlpha:.43,tunnelBaseStrokeColor:'#ffffff',strokeWidth:2,
        drawLayerGeometry(rec,alpha){draws++;assert.equal(this.baseAlpha,1);rec.globalAlpha=this.baseAlpha*alpha;somataWithFourierLayer(l,()=>renderLayerOrbitPaths(rec,l,data));},
        drawLayerInstances(){throw Error('must not record copies');}};
      const master=recordGpuFourierCommands(frame,true);
      assert.ok(master?.length,`missing master for order ${order}`);
      assert.equal(draws,1);assert.equal(frame.baseAlpha,.43);
      assert.ok(master.every(c=>c.alpha===1 && c.subpaths.every(p=>p.gpuFourier && p.points.length===0)));
      assert.equal(master.flatMap(c=>c.subpaths).length,data.paths.filter(p=>p.points.length>=2).length);
      frame.drawLayerGeometry=()=>{throw Error('recording failure');};
      assert.equal(recordGpuFourierCommands(frame,true),null);assert.equal(frame.baseAlpha,.43);
    }
  } finally {state.tunnel.active=previous;}
});

test('Corridor passes Fourier encoder to indexed instance draw and uses independent sampled arc prefix',()=>{
  const renderer=code('js/gpu/stroke-renderer.js');
  assert.match(renderer,/fourier \? prepareResidentFourierBatch\(commands, fourierEncoder\)/);
  assert.match(renderer,/if \(fourier && !indexed\) return false/);
  assert.match(renderer,/fourierEncoder,\s*\);/);
  assert.match(renderer,/const encoder = existingEncoder \|\| device.createCommandEncoder/);
  assert.match(renderer,/pass\.draw\(6, rec\.segmentCount \* copyCount\)/);
  assert.match(FOURIER_WGSL,/distance \+= length\(wave\[i\]\.xy-wave\[i-1u\]\.xy\)/);
  assert.match(FOURIER_WGSL,/wave\[i\]\.w = distance;[\s\S]*workgroupBarrier\(\);[\s\S]*output\[group\.x\*288u\+i\] = wave\[i\]/);
  assert.match(code('js/render/gpu-dispatch.js'),/gpuFourier:true, copyCacheVariant:'fourier-base'/);
  assert.match(code('js/render/geometry-scene-routing.js'),/gpuFourier:true,[\s\S]*copyCacheVariant:'fourier-layer-scene-base'/);
});
