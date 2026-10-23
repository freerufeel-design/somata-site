'use strict';
// A visible GPU-only Corridor/Line overlay MUST be sampled by the glass,
// and Snell refraction must be an offset from the ACTUAL fragment screen UV.
// This scenario fails in 8.20.8, whose shader sampled a world-space hit and
// whose capture uploaded only one of the displayed 2D surfaces.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../js/app/prism-3d-layer.js'),'utf8');
const optical=src.split('const WGSL=`')[1]?.split('`;')[0]||'';
assert.match(optical,/let fragmentUv = input\.clipPosition\.xy \/ u\.viewport\.xy/,
    'zero-refraction UV is the live output pixel');
assert.match(optical,/let straightUv = projectToScene\(pos, entering\)/,
    'compare the bending against a straight ray, not an absolute world UV');
assert.match(optical,/let refractedUv = projectToScene\(exitPos, normalize\(outgoing\)\)/,
    'two-interface Snell exit ray is still respected');
assert.match(optical,/fragmentUv \+ boundedPx \/ u\.viewport\.xy/,
    'refracted lookup must be anchored to the same screen pixel');
assert.match(optical,/refr < 0\.001[\s\S]*?textureSample\(sceneTex, sceneSampler, fragmentUv\)/,
    'no refraction produces an exact 1:1 screen sample');
assert.match(optical,/let maxPixels = max\(/,'bound grazing-ray displacement');

const drawn=[];let copies=0,uniforms=[],renders=0;
const dpr=1;
const rootRect={left:500,top:30,width:800,height:600};
const root={id:'mainContainer',style:{},getBoundingClientRect:()=>rootRect,appendChild(el){el.isConnected=true;nodes.set(el.id,el);}};
function surface(id,display,rect,extra={}){
 return {id,width:800,height:600,style:{display,opacity:'1',visibility:'visible',...extra},getBoundingClientRect:()=>rect||rootRect};
}
const main=surface('mainCanvas','block',rootRect,{visibility:'hidden'});
const final=surface('finalGpuCanvas','block',rootRect);
const pathFX=surface('pathFxOverlayCanvas','block',{left:600,top:70,width:300,height:200},{opacity:'0.75'});
const graffiti=surface('graffitiGpuOverlayCanvas','none',rootRect);
const particle=surface('particleGpuOverlayCanvas','none',rootRect);
const ambient=surface('ambientOverlayCanvas','block',rootRect,{mixBlendMode:'screen'});
const nodes=new Map([[root.id,root],...[main,final,pathFX,graffiti,particle,ambient].map(x=>[x.id,x])]);
function fakeCanvas(){return{id:'',width:0,height:0,style:{},isConnected:false,setAttribute(){},getContext(kind){
 if(kind==='webgpu')return{configure(){},getCurrentTexture:()=>({createView:()=>({})})};
 if(kind==='2d')return{setTransform(){},fillRect(){},drawImage(el,dx,dy,dw,dh){
  drawn.push({id:el.id,x:dx,y:dy,w:dw,h:dh,opacity:this.globalAlpha,blend:this.globalCompositeOperation});
 }};
 throw Error('unexpected Canvas context '+kind);
}};}
const device={
 createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
 createRenderPipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
 createBuffer:()=>({}),createTexture:()=>({createView:()=>({}),destroy(){}}),createSampler:()=>({}),createBindGroup:()=>({}),
 createCommandEncoder:()=>({beginRenderPass:()=>({setPipeline(){},setBindGroup(){},setVertexBuffer(){},draw(n){assert(n>0);renders++;},end(){}}),finish:()=>({})}),
 queue:{writeBuffer(b,o,data){if(data instanceof Float32Array&&data.length===32)uniforms.push(data);},
  copyExternalImageToTexture({source},dest,size){assert(source);assert.deepEqual(Array.from(size),[800,600]);copies++;},
  writeTexture(){assert.fail('Do not use fallback black texture');},submit(){},onSubmittedWorkDone:async()=>{}}
};
const scope={window:{__spiroRegisterModule(){},devicePixelRatio:dpr,requestAnimationFrame(){}},
 navigator:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},
 document:{getElementById:id=>nodes.get(id)||null,createElement:()=>fakeCanvas()},
 getComputedStyle:el=>el.id==='mainContainer'?{backgroundColor:'rgb(5, 9, 20)'}:el.style,
 WebGPUDeviceHub:{acquire:async()=>({device,generation:1}),getGeneration:()=>1},
 GPUBufferUsage:{UNIFORM:1,COPY_DST:2,VERTEX:4},GPUTextureUsage:{RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_DST:4},
 performance:{now:()=>1000},Float32Array,Uint8Array,Math,Map,Promise};
vm.runInNewContext(src,scope);
(async()=>{
 const engine=scope.window.SomataPrism3D;
 const cfg={enabled:true,shape:'sphere',size:260,refraction:25,dispersion:50,opacity:55,speed:0};
 assert.equal(engine.render(cfg,final),false);
 await new Promise(r=>setTimeout(r,0));
 assert.equal(engine.render(cfg,final),true);
 assert.equal(copies,1,'one composed snapshot uploaded');
 assert.equal(renders,1,'sphere drawn');
 assert.deepEqual(drawn.map(x=>x.id),['finalGpuCanvas','pathFxOverlayCanvas','ambientOverlayCanvas'],
   'composite the final base + independently presented Line/Corridor + ambient, excluding invisible canvases');
 assert.deepEqual([drawn[1].x,drawn[1].y,drawn[1].w,drawn[1].h],[100,40,300,200],
   'transformed/smaller canvas maps into optical texture at its real viewport coordinates');
 assert.equal(drawn[1].opacity,.75);
 assert.equal(drawn[2].blend,'screen');
 const st=engine.status();
 assert.equal(st.sceneUploaded,true);
 assert.equal(st.opticalReady,true);
 assert.equal(st.sceneOrigin,'finalGpuCanvas+pathFxOverlayCanvas+ambientOverlayCanvas');
 // Disabling a deferred surface must drop it from capture on the NEXT frame.
 pathFX.style.display='none';drawn.length=0;
 assert.equal(engine.render(cfg,final),true);
 assert.deepEqual(drawn.map(x=>x.id),['finalGpuCanvas','ambientOverlayCanvas']);
 assert.equal(engine.status().sceneOrigin,'finalGpuCanvas+ambientOverlayCanvas');
 assert.equal(copies,2);
 console.log('PASS 8.20.9 screen-anchored Snell RGB and composited visible WebGPU/2D overlay pixels');
})().catch(e=>{console.error(e);process.exitCode=1;});
