'use strict';
// Regression for the real optical pipeline: double @builtin(position) silently
// pushed the whole foreground into the opaque blue backup in 8.20.6.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../js/app/prism-3d-layer.js'),'utf8');
const shader=src.split('const WGSL=`')[1]?.split('`;')[0];
assert(shader,'optical shader must exist');
const vertexOut=shader.match(/struct VertexOutput\s*\{([^}]+)\}/)?.[1]||'';
const fragment=shader.match(/@fragment fn fs\(([^)]*)\)/)?.[1]||'';
assert.equal((vertexOut.match(/@builtin\(position\)/g)||[]).length,1,'vertex output has one position');
assert.equal((fragment.match(/@builtin\(position\)/g)||[]).length,0,'fragment input MUST NOT redeclare position');
assert.match(shader,/input\.clipPosition\.xy\s*\/\s*u\.viewport\.xy/,'sample background at actual fragment coordinates');
assert.match(shader,/refract\(entering, surfaceN, 1\.0 \/ ior\)/,'entering surface Snell');
assert.match(shader,/refract\(inside, -exitN, ior\)/,'exiting surface Snell');
assert.match(shader,/textureSample\(sceneTex, sceneSampler, uvR\)/,'red channel optical sample');
assert.match(shader,/textureSample\(sceneTex, sceneSampler, uvG\)/,'green channel optical sample');
assert.match(shader,/textureSample\(sceneTex, sceneSampler, uvB\)/,'blue channel optical sample');
let submits=0,draws=0,copies=0,basic=0,good=0,uniforms=[],binds=[],errors=[];
const device={
 createShaderModule({label,code}){if(label.includes('basic'))basic++; else {good++;assert.match(code,/opticalUv/);}
  return{getCompilationInfo:async()=>({messages:[]})};},
 createRenderPipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
 createBuffer:()=>({}),createTexture:()=>({createView(){return{};},destroy(){}}),createSampler:()=>({}),
 createBindGroup({entries}){binds.push(entries.length);return{};},
 createCommandEncoder(){return{beginRenderPass(){return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},draw(n){assert(n>0);draws++;},end(){}};},finish(){return{};}};},
 queue:{writeBuffer(buffer,offset,data){if(data instanceof Float32Array&&data.length===32)uniforms.push(Array.from(data));},
  writeTexture(){throw Error('optical mode should capture the actual scene');},
  copyExternalImageToTexture(){copies++;},submit(){submits++;},onSubmittedWorkDone(){return Promise.resolve();}}
};
const nodes=new Map(),container={getBoundingClientRect:()=>({width:800,height:600}),appendChild(x){x.isConnected=true;nodes.set(x.id,x);}};
nodes.set('mainContainer',container);
const source={id:'mainCanvas',width:800,height:600,style:{}};
nodes.set('mainCanvas',source);
const fakeCanvas=()=>({id:'',width:0,height:0,style:{},isConnected:false,setAttribute(){},getContext(kind){
 if(kind==='webgpu')return{configure(){},getCurrentTexture(){return{createView(){return{}}}}};
 if(kind==='2d')return{fillRect(){},drawImage(x){assert.equal(x,source);},setTransform(){}};
 throw Error(kind);
}});
const scope={window:{__spiroRegisterModule(){},devicePixelRatio:1,requestAnimationFrame(){}},navigator:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},
 document:{getElementById:id=>nodes.get(id)||null,createElement:()=>fakeCanvas()},
 WebGPUDeviceHub:{acquire:async()=>({device,generation:1}),getGeneration:()=>1},
 GPUBufferUsage:{UNIFORM:1,COPY_DST:2,VERTEX:4},GPUTextureUsage:{RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_DST:4},
 performance:{now:()=>1000},Float32Array,Uint8Array,Map,Math,Promise};
vm.runInNewContext(src,scope,{filename:'prism-3d-layer.js'});
(async()=>{
 const engine=scope.window.SomataPrism3D;
 const base={enabled:true,shape:'sphere',size:300,refraction:18,dispersion:50,opacity:30,speed:0,lightHue:120,lightIntensity:50,fillHue:240,fill:15};
 assert.equal(engine.render(base,source),false);
 await new Promise(r=>setTimeout(r,0));
 assert.equal(engine.render(base,source),true);
 const a=engine.status();
 assert.equal(a.opticalReady,true,'real optical WebGPU pipeline selected');
 assert.equal(a.opticalError,'','no fallback error');
 assert.equal(a.sceneUploaded,true,'background really uploaded');
 assert.equal(a.sceneOrigin,'mainCanvas');
 assert.equal(a.canvasVisible,true);
 assert.equal(good,1);assert.equal(basic,0,'must not use fake blue material');
 assert.equal(binds[0],3,'optical pipeline must bind uniform + backdrop + sampler');
 const first=uniforms.at(-1);
 assert.equal(first[20],18);assert.equal(first[21],.5);
 assert(Math.abs(first[28]-1/3)<1e-5);assert(Math.abs(first[29]-.5)<1e-5);assert(Math.abs(first[30]-2/3)<1e-5);assert(Math.abs(first[31]-.15)<1e-5);
 assert.equal(engine.render({...base,refraction:35,dispersion:90,lightHue:300,lightIntensity:80,fillHue:60,fill:65},source),true);
 const second=uniforms.at(-1);
 assert.equal(second[20],35);assert.ok(Math.abs(second[21]-.9)<1e-5);
 assert.ok(Math.abs(second[22]-.3)<1e-5);
 assert(Math.abs(second[28]-5/6)<1e-5);assert(Math.abs(second[29]-.8)<1e-5);assert(Math.abs(second[30]-1/6)<1e-5);assert(Math.abs(second[31]-.65)<1e-5);
 assert.equal(draws,2);assert.equal(submits,2);assert.equal(copies,2);
 assert.deepEqual(errors,[]);
 console.log('PASS 8.20.7 valid optical WGSL inputs, Snell RGB sampling, live scene capture and slider updates');
})().catch(e=>{console.error(e);process.exitCode=1});
