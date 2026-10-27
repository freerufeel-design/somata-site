'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const code=fs.readFileSync(path.resolve(__dirname,'../js/gpu/sweep-lamp-blend.js'),'utf8');
const shaders=[],passes=[],copies=[];
const fakeDevice={
 createBindGroupLayout:x=>x,createPipelineLayout:x=>x,
 createShaderModule:x=>{shaders.push(x);return x},
 createRenderPipeline:x=>x,
 createTexture:x=>({desc:x,createView(){return{texture:this}},destroy(){}}),
 createBindGroup:x=>x
};
const makeTexture=name=>({name,createView(){return {name}}});
const fakeEncoder={
 copyTextureToTexture:(a,b,c)=>copies.push({a,b,c}),
 beginRenderPass:d=>{const row={d,actions:[]};passes.push(row);return{
   setPipeline:p=>row.actions.push('pipe:'+p.label),
   setBindGroup:()=>row.actions.push('bind'),
   setStencilReference:r=>row.actions.push('stencil:'+r),
   draw:n=>row.actions.push('draw:'+n),end:()=>row.actions.push('end')
 }}
};
const ctx={fakeDevice,fakeEncoder,makeTexture,window:{},GPUShaderStage:{FRAGMENT:2},GPUTextureUsage:{COPY_DST:4,TEXTURE_BINDING:8}};
vm.createContext(ctx);vm.runInContext(code,ctx);
for(const mode of ['color-dodge','difference','color']){
 const ok=vm.runInContext(`SomataSweepLampBlend.encode(fakeEncoder,fakeDevice,'rgba8unorm',makeTexture('src'),makeTexture('dst'),'${mode}',{width:320,height:240})`,ctx);
 assert.equal(ok,true);
}
assert.equal(copies.length,3);assert.equal(passes.length,3);
assert(shaders.length>=3);for(const x of shaders)assert(x.code.includes('textureLoad')&&x.code.includes('setLum'));
assert(passes.every(p=>p.actions.some(a=>a.startsWith('draw'))));
assert.equal(ctx.window.__spiroRegisterModule,undefined);
console.log('PASS exact GPU blend command encodes for Color Dodge / Difference / Color with backdrop copies');
