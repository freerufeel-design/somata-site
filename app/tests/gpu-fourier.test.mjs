import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importModule } from './helpers/app-env.mjs';
import { packGpuFourierRails, FOURIER_GPU_POINTS, FOURIER_WGSL, warmupGpuFourier, encodeGpuFourier } from '../js/gpu/fourier-compute.js';

const identity=[1,0,0,1,0,0];
const polygon=[{x:100,y:0,widthScale:0},{x:0,y:100,widthScale:.5},{x:-100,y:0,widthScale:2},{x:0,y:-100,widthScale:1}];
const open=[{x:-200,y:10,widthScale:0},{x:0,y:100,widthScale:.5},{x:200,y:-30,widthScale:2}];
async function setup() {
  const { somataWithFourierLayer }=await importModule('js/core/state.js');
  const { prepareGpuFourierRail,buildFourierWavePoints,drawFourierPath }=await importModule('js/geometry/fourier.js');
  const scope=(rounding,fn)=>somataWithFourierLayer({roundingCornerType:'fourier',rounding},fn);
  return {scope,prepareGpuFourierRail,buildFourierWavePoints,drawFourierPath};
}
// Independent JS transcription of the shader, consuming exactly the packed
// f32 data (not a WebGPU execution test). Used to check signs, indexing,
// reference centering, open reflection, harmonic weights, widths and fit.
function emulate(input, job) {
  const o=job*400, v=i=>Array.from(input.subarray(o+i*4,o+i*4+4));
  const [power,cutoff,h,closed]=v(0), [cx,cy,r,a0]=v(1), m=v(2), sh=v(3);
  const base=Array.from({length:96},(_,i)=>v(i+4)), tau=Math.PI*2, n=closed?96:190;
  const smooth=x=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
  const b=smooth(power/.25), circle=u=>[cx+r*Math.cos(a0+tau*u),cy+r*Math.sin(a0+tau*u)];
  const mix=(a,b,t)=>a+(b-a)*t;
  const cs=[];
  for(let k=-h;k<=h;k++) {
    let re=0,im=0;
    if(power>0) for(let j=0;j<n;j++) {
      const [x,y]=base[j<96?j:190-j], a=-tau*k*j/n, c=Math.cos(a),s=Math.sin(a);
      re+=(x-cx)*c-(y-cy)*s;im+=(x-cx)*s+(y-cy)*c;
    }
    const order=Math.abs(k), a=Math.PI*(order-1)/cutoff;
    const weight=order<=1?1:smooth(cutoff-order+1)*Math.max(0,Math.sin(a)/a);
    cs.push([re*weight/n,im*weight/n]);
  }
  const wave=Array.from({length:288},(_,i)=>{
    const u=i/(closed?288:287), t=closed?u:u/2;let x=0,y=0;
    for(let j=0;j<cs.length;j++) {const [re,im]=cs[j],a=tau*(j-h)*t,c=Math.cos(a),s=Math.sin(a);x+=re*c-im*s;y+=re*s+im*c;}
    const [qx,qy]=circle(u), wf=u*(closed?96:95), wi=Math.floor(wf)%96;
    return [mix(qx,x+cx,b),mix(qy,y+cy,b),mix(base[wi][2],base[(wi+1)%96][2],wf-Math.floor(wf))];
  });
  if(!closed && b>0) {
    const start=circle(0),end=circle(1),d0=[0,1].map(j=>mix(start[j],base[0][j],b)-wave[0][j]),d1=[0,1].map(j=>mix(end[j],base[95][j],b)-wave[287][j]);
    for(let i=0;i<288;i++) for(let j=0;j<2;j++) wave[i][j]+=mix(d0[j],d1[j],i/287);
  }
  const actual=Math.max(...wave.map(p=>Math.hypot(p[0]-cx,p[1]-cy))),scale=closed&&actual>r*1e-8?r/actual:1;
  return wave.map(([x,y,w])=>{x=cx+(x-cx)*scale;y=cy+(y-cy)*scale;return {x:m[0]*x+m[2]*y+sh[0],y:m[1]*x+m[3]*y+sh[1],widthScale:sh[2]?w:1};});
}
test('resident Fourier descriptor uses the original CPU grid and reference; multiple rails stay independent',async()=>{
  const {scope,prepareGpuFourierRail,buildFourierWavePoints}=await setup();
  for(const rounding of [10,11,22,49,100,174,175,190,199,200]) scope(rounding,()=>{
    const inputs=[[polygon,true],[open,false]];
    const descriptors=inputs.map(([p,closed])=>({rail:prepareGpuFourierRail(p,closed),matrix:identity,variable:true}));
    const packed=packGpuFourierRails(descriptors);
    assert.equal(packed.length,800);
    for(let i=0;i<inputs.length;i++) {
      const [p,closed]=inputs[i],expected=buildFourierWavePoints(p,closed),actual=emulate(packed,i);
      assert.equal(actual.length,FOURIER_GPU_POINTS);
      assert.equal(expected.length,actual.length);
      assert.ok(Math.max(...actual.map((p,j)=>Math.hypot(p.x-expected[j].x,p.y-expected[j].y)))<.001);
      assert.ok(Math.max(...actual.map((p,j)=>Math.abs(p.widthScale-expected[j].widthScale)))<.00001);
    }
  });
});
test('sharp band, collapsed rails and prepared CPU contours do not enter GPU route',async()=>{
  const {scope,prepareGpuFourierRail,buildFourierWavePoints}=await setup();
  for(const r of [0,.01,1,9.99]) scope(r,()=>assert.equal(prepareGpuFourierRail(polygon,true),null));
  scope(100,()=>{
    assert.equal(prepareGpuFourierRail([{x:0,y:0},{x:0,y:0}],false),null);
    assert.equal(prepareGpuFourierRail(buildFourierWavePoints(polygon,true),true),null);
  });
});
test('descriptor-only recording avoids CPU reconstruction and keeps normal Canvas behavior',async()=>{
  const {scope,drawFourierPath}=await setup();
  const {createGeometryGLRecordingContext}=await importModule('js/render/gl-recording-context.js');
  scope(100,()=>{
    const rec=createGeometryGLRecordingContext(null);
    rec.__somataGpuFourierRecording=true;
    rec.beginPath();drawFourierPath(rec,polygon,true);rec.stroke();
    rec.beginPath();drawFourierPath(rec,open,false);rec.stroke();
    assert.equal(rec.commands.length,2);
    assert.equal(rec.commands[0].subpaths[0].points.length,0);
    assert.equal(rec.commands[0].subpaths[0].gpuFourier.rail.closed,true);
    assert.equal(rec.commands[1].subpaths[0].gpuFourier.rail.closed,false);
    const plain=createGeometryGLRecordingContext(null);
    plain.beginPath();drawFourierPath(plain,polygon,true);plain.stroke();
    assert.equal(plain.commands[0].subpaths[0].gpuFourier,null);
    assert.ok(plain.commands[0].subpaths[0].points.length>=280);
  });
});
test('GPU encoding binds output as storage and dispatches a group for every rail without readback',async()=>{
  const {scope,prepareGpuFourierRail}=await setup();
  const calls=[];globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4};
  const device={limits:{maxComputeWorkgroupsPerDimension:65535,maxStorageBufferBindingSize:1e8,maxBufferSize:1e8},
    createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
    createBuffer:desc=>desc,queue:{writeBuffer:()=>calls.push('upload')},createBindGroup:arg=>arg};
  await new Promise(resolve=>{assert.equal(warmupGpuFourier(device,resolve),false);});
  assert.equal(warmupGpuFourier(device),true);
  const enc={beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups:n=>calls.push(n),end:()=>calls.push('end')})};
  const rails=scope(100,()=>[polygon,open].map(p=>({rail:prepareGpuFourierRail(p,false),matrix:identity})));
  const out=encodeGpuFourier(device,enc,rails);
  assert.equal(out.size,2*288*16);assert.deepEqual(calls,['upload',2,'end']);
  assert.match(FOURIER_WGSL,/workgroupBarrier\(\)/);
  const renderer=readFileSync(new URL('../js/gpu/stroke-renderer.js',import.meta.url),'utf8');
  assert.match(renderer,/prepareResidentFourierBatch\(commands, encoder\)/);
  assert.match(renderer,/binding: 1, resource: \{ buffer: rec.pointBuffer \}/);
});
test('only a base-only frame without other contour consumers can select resident Fourier',async()=>{
  const {gpuFourierBatchIneligible}=await importModule('js/render/stroke-batch-service.js');
  const {WebGPUStrokeRenderer}=await importModule('js/gpu/stroke-renderer.js');
  const {state}=await importModule('js/core/state.js');
  const original=WebGPUStrokeRenderer.fourierComputeReady;
  const oldTunnel=state.tunnel.active, oldGuides=state.showRoundingGuides;
  try {
    state.tunnel.active=false;state.showRoundingGuides=false;
    WebGPUStrokeRenderer.fourierComputeReady=()=>true;
    const frame={frameId:10,layer:{},lineDisplayEnabled:true,geometryPlan:{kind:'static'},renderGraph:{passes:[{name:'base'}]},effectsPlan:{}};
    const check=(f=frame,contract={},shared=false)=>gpuFourierBatchIneligible(f,[{role:'base'}],contract,shared,false);
    assert.equal(check(),'');
    assert.equal(check(frame,{fillRequested:true}),'fill-or-geometry-circles');
    assert.equal(check(frame,{},true),'shared-cpu-carrier');
    assert.equal(check({...frame,renderGraph:{passes:[{name:'base'},{name:'lamps'}]}}),'additional-contour-consumer');
    assert.equal(check({...frame,effectsPlan:{web:{enabled:true}}}),'effect-enabled');
    assert.equal(check({...frame,geometryPlan:{kind:'green-morph'}}),'special-geometry-route');
    state.tunnel.active=true;assert.equal(check(),'line-policy');state.tunnel.active=false;
    WebGPUStrokeRenderer.fourierComputeReady=()=>false;assert.equal(check(),'compute-warming-or-unavailable');
  } finally {WebGPUStrokeRenderer.fourierComputeReady=original;state.tunnel.active=oldTunnel;state.showRoundingGuides=oldGuides;}
});
