'use strict';
// Independent GPU 3D optical mesh: live background upload, draw, modes and defaults.
// This tests GPU COMMANDS with a validating fake device, not physical pixels.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const html=read('index.html'),app=read('js/app/ambient-prism.js'),state=read('js/core/state.js');
assert(/prism:\s*\{enabled:false,mode:'3d',source2d:'sprite'/.test(state),'new projects must start with figure off, 3D');
assert(/id="prismEnabled" type="checkbox"(?! checked)/.test(html),'figure unchecked');
assert(html.includes('data-prism-mode="2d"')&&html.includes('data-prism-mode="3d"'));
assert(html.includes('prismSpriteFile'),'2D upload UI');
assert(app.includes('WebGPU не готов')&&app.includes("pr.mode==='3d'"));
assert(!app.includes('WebGL2'),'3D user text must describe WebGPU');
const calls=[];
const shared={generation:1},device={
 createShaderModule({code}){assert(code.includes('@vertex fn vs')&&code.includes('@fragment fn fs'));assert(code.includes('opticalUv')&&code.includes('uvR')&&code.includes('uvG')&&code.includes('uvB'));calls.push('WGSL');return {getCompilationInfo:async()=>({messages:[]})};},
 createRenderPipeline({vertex,depthStencil,primitive}){assert.equal(vertex.buffers[0].arrayStride,24);assert.equal(depthStencil.depthWriteEnabled,true);assert.equal(primitive.topology,'triangle-list');calls.push('pipeline');return {getBindGroupLayout:()=>({})};},
 createBuffer({size,usage}){assert(size>0&&usage>0);return{size};},
 createTexture({size,format}){calls.push(`texture:${format}`);assert(size[0]>0);return{createView:()=>({}),destroy(){}};},
 createSampler:()=>({}),createBindGroup:()=>({}),
 createCommandEncoder:()=>({beginRenderPass({depthStencilAttachment,colorAttachments}){assert(depthStencilAttachment&&colorAttachments.length===1);return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},draw(n){assert(n>0);calls.push('draw:'+n);},end(){}};},finish(){return {};}}),
 queue:{writeBuffer(b,o,v){assert(v.byteLength>0);calls.push('upload');},copyExternalImageToTexture(src,dst,sz){assert(src.source.width>0&&sz[0]>0);calls.push('scene');},submit(a){assert(a.length===1);calls.push('submit');},onSubmittedWorkDone(){return Promise.resolve();}}
};
shared.device=device;
const nodes=new Map();const rootEl={getBoundingClientRect(){return{width:860,height:560};},appendChild(c){nodes.set(c.id,c);c.isConnected=true;}};
nodes.set('mainContainer',rootEl);
let webgpuCalls=0,webglCalls=0;
const fakeCanvas=()=>({id:'',style:{},width:0,height:0,isConnected:false,setAttribute(){},getContext(type){if(type==='2d')return{setTransform(){},fillRect(){},drawImage(){},set fillStyle(x){}};
    if(type==='webgl2')webglCalls++;assert.equal(type,'webgpu');webgpuCalls++;return{configure(config){assert(config.device===device&&config.alphaMode==='premultiplied');},getCurrentTexture:()=>({createView:()=>({})})};}});
const window={__spiroRegisterModule(){},devicePixelRatio:1,requestAnimationFrame(){}},ctx={window,document:{getElementById:id=>nodes.get(id)||null,createElement:type=>{assert.equal(type,'canvas');return fakeCanvas();}},
    navigator:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},WebGPUDeviceHub:{acquire:async()=>shared,getGeneration:()=>1},
    GPUBufferUsage:{UNIFORM:1,COPY_DST:2,VERTEX:4},GPUTextureUsage:{RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_DST:4},
    performance:{now:()=>2000},Float32Array,Uint8Array,Map,Math,Number,Promise};
vm.runInNewContext(read('js/app/prism-3d-layer.js'),ctx,{filename:'prism-3d-layer.js'});
(async()=>{
 const engine=window.SomataPrism3D,scene={width:860,height:560},base={size:260,refraction:18,dispersion:65,opacity:75,speed:0,positionX:0,positionY:0,tiltX:0,tiltY:0};
 assert.equal(engine.render({enabled:false},scene),true);assert.equal(webgpuCalls,0,'disabled must not even create the WebGPU context');
 assert.equal(engine.render({enabled:true,shape:'sphere',...base},scene),false,'first call async GPU warmup');
 await new Promise(r=>setTimeout(r,0));
 assert.equal(engine.status().backend,'WebGPU-3D',JSON.stringify(engine.status()));
 for(const shape of ['sphere','lens','cube','dodecahedron','skull','cross']){
     assert(engine.meshFor(shape).triangles>0);
     assert.equal(engine.render({enabled:true,shape,...base},scene),true,`${shape} render`);
     assert.equal(engine.status().mesh,shape);
 }
 assert.equal(engine.status().frames,6);
 // A failed background transfer must NOT hide the actual GPU mesh.
 const previousCopy=device.queue.copyExternalImageToTexture;
 let fallbackWrites=0;
 device.queue.copyExternalImageToTexture=()=>{throw Error('simulated driver copy failure');};
 device.queue.writeTexture=()=>{fallbackWrites++};
 const didFallback=engine.render({enabled:true,shape:'sphere',...base},scene);assert.equal(didFallback,true);
 assert.equal(engine.status().canvasVisible,true);assert.equal(engine.status().sceneUploaded,false);
 assert.equal(engine.status().sceneOrigin,'fallback');assert.equal(fallbackWrites,1);
 device.queue.copyExternalImageToTexture=previousCopy;
 assert(calls.filter(s=>s==='scene').length===6&&calls.filter(s=>s==='submit').length===7,'must upload backdrop and GPU-submit for each mesh');
 assert.equal(webglCalls,0,'no WebGL fallback whatsoever');
 assert.equal(webgpuCalls,1,'dedicated WebGPU canvas context');
 engine.hide();assert.equal(nodes.get('prism3dLayerCanvas').style.display,'none');
 assert.equal(engine.status().sceneUploaded,false);
 console.log('PASS 8.20.5 WebGPU 3D',JSON.stringify({meshes:6,submissions:7,sceneUploads:6,webglCalls,defaultEnabled:false,defaultMode:'3d'}));
})().catch(e=>{console.error(e);process.exitCode=1});
