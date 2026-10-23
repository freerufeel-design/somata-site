'use strict';
// Reproduces the Dawn validation error reported by the NVIDIA user:
// "Destination texture needs to have CopyDst and RenderAttachment usage."
// The WebGPU copyExternalImageToTexture destination needs BOTH bits, or the
// app falsely reports a connected scene while presenting an un-refracted ball.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../js/app/prism-3d-layer.js'),'utf8');
const TU={RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_DST:4};
let sceneCopies=0,invalidCopies=0,blackFallbacks=0,passes=0,submits=0;
const captures=[];
const device={
 createShaderModule(){return{getCompilationInfo:async()=>({messages:[]})};},
 createRenderPipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
 createBuffer:()=>({}),
 createTexture(desc){
   const tex={desc,createView:()=>({}),destroy(){}};
   if(desc.label==='Somata optical scene capture')captures.push(tex);
   return tex;
 },
 createSampler:()=>({}),createBindGroup:()=>({}),
 createCommandEncoder(){return{beginRenderPass(){return{setPipeline(){},setBindGroup(){},setVertexBuffer(){},draw(n){assert(n>0);passes++;},end(){}};},finish:()=>({})};},
 queue:{
   writeBuffer(){},writeTexture(){blackFallbacks++;},
   copyExternalImageToTexture(src,dst,size){
     assert(src.source,'2D capture source must exist');assert.deepEqual(Array.from(size),[800,600]);
     const flags=dst.texture?.desc?.usage||0;
     if((flags & (TU.COPY_DST | TU.RENDER_ATTACHMENT))!==(TU.COPY_DST|TU.RENDER_ATTACHMENT)){
       invalidCopies++;
       throw Error('Destination texture needs to have CopyDst and RenderAttachment usage.');
     }
     sceneCopies++;
   },
   submit(){submits++;},onSubmittedWorkDone:async()=>{}
 }
};
const nodes=new Map();
const container={getBoundingClientRect:()=>({width:800,height:600}),appendChild(el){el.isConnected=true;nodes.set(el.id,el);}};
nodes.set('mainContainer',container);
const scene={id:'mainCanvas',width:800,height:600};nodes.set('mainCanvas',scene);
function makeCanvas(){return{id:'',width:0,height:0,style:{},isConnected:false,setAttribute(){},getContext(kind){
 if(kind==='webgpu')return{configure(){},getCurrentTexture(){return{createView:()=>({})};}};
 if(kind==='2d')return{setTransform(){},fillRect(){},drawImage(el){assert.equal(el,scene);}};
 throw Error(kind);
}};}
const context={window:{__spiroRegisterModule(){},devicePixelRatio:1},navigator:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},
 document:{getElementById:id=>nodes.get(id)||null,createElement:makeCanvas},
 WebGPUDeviceHub:{acquire:async()=>({device,generation:1}),getGeneration:()=>1},
 GPUBufferUsage:{UNIFORM:1,COPY_DST:2,VERTEX:4},GPUTextureUsage:TU,
 performance:{now:()=>1000},Float32Array,Uint8Array,Math,Map,Promise};
vm.runInNewContext(src,context,{filename:'prism-3d-layer.js'});
(async()=>{
 const engine=context.window.SomataPrism3D;
 const cfg={enabled:true,shape:'sphere',size:260,refraction:20,dispersion:40,opacity:65,speed:0};
 assert.equal(engine.render(cfg,scene),false,'first render starts async GPU warmup');
 await new Promise(r=>setTimeout(r,0));
 assert.equal(engine.render(cfg,scene),true);
 assert.equal(engine.render({...cfg,refraction:42},scene),true);
 const state=engine.status();
 assert.equal(state.opticalReady,true,'optical material, not fallback basic shader');
 assert.equal(state.sceneUploaded,true,'real 2D scene sent to refraction shader');
 assert.equal(state.sceneOrigin,'mainCanvas');
 assert.equal(state.sceneError,'');
 assert.equal(state.canvasVisible,true);
 assert.equal(invalidCopies,0,'copyExternalImageToTexture may not throw Dawn validation errors');
 assert.equal(blackFallbacks,0,'must not silently substitute a flat dark texture');
 assert.equal(sceneCopies,2,'successive frames must upload the real scene');
 assert.equal(passes,2);assert.equal(submits,2);
 assert.equal(captures.length,1,'capture texture reused across frames');
 assert.ok((captures[0].desc.usage & (TU.COPY_DST|TU.RENDER_ATTACHMENT|TU.TEXTURE_BINDING))===
           (TU.COPY_DST|TU.RENDER_ATTACHMENT|TU.TEXTURE_BINDING),'scene texture needs all three usage flags');
 console.log('PASS 8.20.8 WebGPU external scene upload: COPY_DST|RENDER_ATTACHMENT|TEXTURE_BINDING, live refraction input, no fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
