'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../js/app/prism-3d-layer.js'),'utf8');
let submits=0,draws=0,sceneCopies=0,basicShader=0;
const device={
 createShaderModule({label,code}){if(label.includes('basic')){basicShader++;assert(code.includes('pow(1.0-clamp'));}
     return {getCompilationInfo:async()=>({messages:label.includes('optical 3D shader')?[{type:'error',message:'injected optical compilation failure'}]:[]})};},
 createRenderPipeline:({fragment})=>({getBindGroupLayout:()=>({})}),
 createBuffer:()=>({}),createTexture:()=>({createView(){return{};},destroy(){}}),createSampler:()=>({}),
 createBindGroup({entries}){assert.equal(entries.length,1,'basic shader has only a uniform binding');return{};},
 createCommandEncoder(){return{beginRenderPass(){return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},draw(count){assert(count>0);draws++;},end(){}};},finish(){return{};}};},
 queue:{writeBuffer(){},copyExternalImageToTexture(){sceneCopies++;},submit(){submits++;},onSubmittedWorkDone(){return Promise.resolve();}}
};
const nodes=new Map(),container={getBoundingClientRect:()=>({width:840,height:620}),appendChild(x){x.isConnected=true;nodes.set(x.id,x);}};
nodes.set('mainContainer',container);
const fakeCanvas=()=>({id:'',width:0,height:0,style:{},isConnected:false,setAttribute(){},getContext(kind){
 if(kind==='webgpu')return{configure(){},getCurrentTexture(){return{createView(){return{}}}}};
 if(kind==='2d')return{fillRect(){},drawImage(){},setTransform(){}};
 throw Error(kind);
}});
const scope={window:{__spiroRegisterModule(){},devicePixelRatio:1,requestAnimationFrame(){}},navigator:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},
 document:{getElementById:id=>nodes.get(id)||null,createElement:kind=>fakeCanvas()},
 WebGPUDeviceHub:{acquire:async()=>({device,generation:1}),getGeneration:()=>1},
 GPUBufferUsage:{UNIFORM:1,COPY_DST:2,VERTEX:4},GPUTextureUsage:{RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_DST:4},
 performance:{now:()=>1000},Float32Array,Uint8Array,Map,Math,Promise};
vm.runInNewContext(src,scope,{filename:'prism-3d-layer.js'});
(async()=>{const e=scope.window.SomataPrism3D,cfg={enabled:true,shape:'sphere',size:260,refraction:18,dispersion:55,opacity:63,speed:0};
 assert.equal(e.render(cfg,{width:840,height:620}),false);await new Promise(r=>setTimeout(r,0));
 assert.equal(e.render(cfg,{width:840,height:620}),true);
 assert.equal(e.status().opticalReady,false);assert.match(e.status().opticalError,/injected optical compilation failure/);
 assert.equal(e.status().sceneOrigin,'basic-webgpu-glass');assert.equal(e.status().canvasVisible,true);
 assert.equal(basicShader,1);assert.equal(submits,1);assert.equal(draws,1);assert.equal(sceneCopies,0);
 console.log('PASS 8.20.6 basic WebGPU sphere survives optical shader compilation failure');
})().catch(e=>{console.error(e);process.exitCode=1});
