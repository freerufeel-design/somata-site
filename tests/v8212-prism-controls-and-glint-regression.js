'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html'),shader=read('js/app/prism-3d-layer.js'),ambient=read('js/app/ambient-prism.js'),css=read('styles/app.css');
const state=read('js/core/state.js'),defaults=read('js/core/defaults-layers.js'),routing=read('js/core/parameter-routing.js'),matrix=read('js/core/parameter-matrix.js');
assert(/syncMusic: true, lengthPercent: 3\b/.test(state),'fresh layer default 3%');
assert(/lengthPercent:3, widthPercent:75/.test(defaults),'normalized layer default 3%');
assert(html.includes('id="sweepLengthText" class="text-mono">3%</span>'));
assert(html.includes('id="sweepLength" type="range" min="1" max="100" step="1" value="3"'));
const factory=JSON.parse(read('default.plist'));
let sweepCount=0;
function count(v){if(Array.isArray(v)){for(const c of v)count(c);}else if(v&&typeof v==='object'){if(v.sweep&&typeof v.sweep==='object'){sweepCount++;assert(Number(v.sweep.lengthPercent)>=1);}for(const c of Object.values(v))count(c);}}
count(factory);assert(sweepCount>=1);
// User authored values are not globally replaced on project load.
assert(defaults.includes('Number.isFinite(Number(cfg.lengthPercent))?Number(cfg.lengthPercent):3'));
const start=html.indexOf('<div id="prismSettingsGroup"'),end=html.indexOf('<div id="geometrySettingsGroup"',start),fragment=html.slice(start,end);
assert(start>=0&&end>start);
assert(fragment.indexOf('id="prismShapeRow"')<fragment.indexOf('class="prism-mode-switch"'),'shape picker at top');
assert(fragment.includes('id="prism3dLiveStatus" hidden'),'no visible diagnostic');
assert(fragment.includes('id="prism3dBackendInfo" hidden'));
assert(css.includes('8.20.12: independent figure controls use compact'));
const baseRefraction=fragment.match(/<input id="prismRefraction"[^>]+>/)[0];
assert(/max="16"/.test(baseRefraction),'refraction base 0..16');
for(const id of ['Size','Refraction','Dispersion','Speed','PositionX','PositionY','TiltX','TiltY']){
 const input=fragment.match(new RegExp(`<input id="prism${id}Multiplier"[^>]+>`))?.[0];
 assert(input,'unbounded multiplier '+id);assert(!/\smax=/.test(input),'upper clamp removed '+id);
}
for(const id of ['Opacity','LightHue','FillHue','LightIntensity','Fill']){
 assert(!fragment.includes(`id="prism${id}Multiplier"`),'bounded value has no dead multiplier '+id);
 assert(fragment.includes(`id="prism${id}"`));
}
assert(!/const size=Math\.min\(800/.test(shader),'no 800-pixel size cap');
assert(!/let refr = clamp\(u\.optics\.x, 0\.0, 60\.0\)/.test(shader),'no 60 refraction cap');
assert(shader.includes('let refr = max(u.optics.x, 0.0);'));
assert(shader.includes('Math.max(0,(Number(cfg.dispersion)||0)/100)'),'GPU dispersion beyond 100%');
assert(!shader.includes('Math.min(1,Math.max(0,(Number(cfg.dispersion)||0)/100))'));
const ctx={window:{__spiroRegisterModule(){}},Math,Set,Map,Array,Object,Number,String};vm.runInNewContext(routing+'\n'+matrix,ctx);
const reg=ctx.window.SomataParameterRegistry,mat=ctx.window.SomataParameterMatrix;
for(const id of ['prism.size','prism.refraction','prism.dispersion','prism.opacity','prism.fill'])assert(mat.get(id),'matrix '+id);
for(const id of ['prism.refractionMultiplier','prism.dispersionMultiplier','prism.sizeMultiplier'])assert(mat.get(id),'matrix multiplier '+id);
for(const id of ['prism.opacityMultiplier','prism.fillMultiplier','prism.lightIntensityMultiplier'])assert(!mat.get(id),'removed dead route '+id);
assert.equal(reg.get('prism.refraction').max,16);
// Execute the actual GPU path with an injected device and capture the uniform words.
let uniforms=[];
const gpuDevice={
 createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
 createRenderPipeline:()=>({getBindGroupLayout:()=>({})}),
 createBuffer:()=>({destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),
 createSampler:()=>({}),createBindGroup:()=>({}),
 createCommandEncoder:()=>({beginRenderPass:()=>({setPipeline(){},setBindGroup(){},setVertexBuffer(){},draw(){},end(){}}),finish:()=>({})}),
 queue:{writeBuffer(buffer,offset,data){if(data instanceof Float32Array&&data.length===32)uniforms.push(Array.from(data));},copyExternalImageToTexture(){},submit(){},onSubmittedWorkDone:()=>Promise.resolve()}
};
const nodes=new Map(),main={id:'mainContainer',getBoundingClientRect:()=>({width:850,height:650}),appendChild(x){nodes.set(x.id,x);x.isConnected=true;}};nodes.set(main.id,main);
const fakeCanvas=()=>({id:'',width:0,height:0,style:{},isConnected:false,setAttribute(){},getContext(kind){if(kind==='webgpu')return{configure(){},getCurrentTexture(){return{createView(){return{}}}}};if(kind==='2d')return{fillRect(){},drawImage(){},setTransform(){},clearRect(){}};throw Error(kind);}});
const fake={window:{__spiroRegisterModule(){},devicePixelRatio:1},navigator:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},document:{getElementById:id=>nodes.get(id)||null,createElement:()=>fakeCanvas()},WebGPUDeviceHub:{acquire:async()=>({device:gpuDevice,generation:1}),getGeneration:()=>1},GPUBufferUsage:{UNIFORM:1,COPY_DST:2,VERTEX:4},GPUTextureUsage:{RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_DST:4},performance:{now:()=>1000},Float32Array,Uint8Array,Map,Math,Promise};
vm.runInNewContext(shader,fake);
(async()=>{
 const e=fake.window.SomataPrism3D;
 const cfg={enabled:true,shape:'sphere',size:260*24,refraction:16*9,dispersion:55*9,opacity:63,lightHue:192,lightIntensity:55,fillHue:194,fill:9,speed:0};
 const scene={width:850,height:650};
 assert.equal(e.render(cfg,scene),false);
 await new Promise(r=>setTimeout(r,0));
 assert.equal(e.render(cfg,scene),true);
 assert(uniforms.length>=1);const u=uniforms.at(-1);
 assert(u[18]>6,'size multiplier ×24 reaches GPU without 800 cap');
 assert.equal(u[20],144,'refraction ×9 reaches GPU');
 assert(Math.abs(u[21]-4.95)<.00001,'dispersion ×9 reaches GPU');
 assert(Math.abs(u[22]-.63)<.00001,'native opacity 63%');
 console.log('PASS 8.20.12 compact UI, default 3% glint, no dead bounded multipliers, unlimited WebGPU optics uniforms');
})().catch(e=>{console.error(e);process.exitCode=1;});
