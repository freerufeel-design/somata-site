

window.__spiroRegisterModule?.('js/gpu/bezier-sweep-renderer');

const WebGPUBezierSweepRenderer=(()=>{
    const SUBDIV=12;
    const canvas=document.createElement('canvas');
    let device=null,context=null,format=null,generation=-1,ready=false,initializing=null,lastError='not-initialized';
    let cornerBuffer=null,uniformLayout=null,cubicLayout=null,copyLayout=null,identityCopyBuffer=null,identityCopyBind=null;
    let haloPipeline=null,corePipeline=null,haloCorridorPipeline=null,coreCorridorPipeline=null;
    let compositeAddPipeline=null,compositeOverPipeline=null,compositePipelines=Object.create(null),compositeLayout=null,scratchTexture=null,scratchView=null,compositeBind=null,width=0,height=0,targetViews=new WeakMap();
    let uniformPairPool=[],cubicBindCache=new WeakMap(),copyBindCache=new WeakMap();
    const stats={frames:0,deferredFrames:0,directFrames:0,cubics:0,gpuSubsegments:0,corridorFrames:0,copies:0,uniformPoolBuilds:0,uniformPoolReuses:0,cubicBindCacheHits:0,copyBindCacheHits:0,failures:0};
    const WGSL=`
struct U { head:vec4<f32>, row0:vec4<f32>, row1:vec4<f32>, style:vec4<f32>, color:vec4<f32>, sector:vec4<f32>, flags:vec4<f32> };
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<storage,read> cubicData:array<vec4<f32>>;
@group(2) @binding(0) var<storage,read> copyData:array<vec4<f32>>;
struct VOut{
 @builtin(position) position:vec4<f32>,
 @location(0) local:vec2<f32>,
 @location(1) @interpolate(flat) segLen:f32,
 @location(2) @interpolate(flat) halfWidth:f32,
 @location(3) @interpolate(flat) glowRadius:f32,
 @location(4) @interpolate(flat) alpha:f32,
 @location(5) @interpolate(flat) softness:f32,
 @location(6) @interpolate(flat) sourceA:vec2<f32>,
 @location(7) @interpolate(flat) sourceB:vec2<f32>,
 @location(8) @interpolate(flat) copyAlpha:f32
};
fn cubic(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;}
fn screenPoint(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
fn makeVertex(vid:u32,iid:u32,useCopy:bool)->VOut{
 let cubicCount=max(1u,u32(u.head.z+0.5));let perCopy=cubicCount*${SUBDIV}u;let ci=select(0u,iid/perCopy,useCopy);let unit=select(iid,iid%perCopy,useCopy);let cubicIndex=unit/${SUBDIV}u;let sub=unit%${SUBDIV}u;let b=cubicIndex*2u;
 let r0=cubicData[b];let r1=cubicData[b+1u];let p0=r0.xy;let c1=r0.zw;let c2=r1.xy;let p3=r1.zw;let t0=f32(sub)/f32(${SUBDIV});let t1=f32(sub+1u)/f32(${SUBDIV});let sa=cubic(p0,c1,c2,p3,t0);let sb=cubic(p0,c1,c2,p3,t1);var a=sa;var z=sb;var ca=1.0;var cs=1.0;
 if(useCopy){let q0=copyData[ci*2u];let q1=copyData[ci*2u+1u];a=vec2<f32>(q0.x*sa.x+q0.y*sa.y,q1.x*sa.x+q1.y*sa.y);z=vec2<f32>(q0.x*sb.x+q0.y*sb.y,q1.x*sb.x+q1.y*sb.y);ca=q0.z;cs=max(0.000001,abs(q1.z));}
 let aa=screenPoint(a);let bb=screenPoint(z);let delta=bb-aa;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);let hw=max(select(0.18,0.50,useCopy),u.style.x*cs);let gr=select(0.0,max(select(0.0,1.0,useCopy),u.style.y*cs),u.style.y>0.001);let pad=hw+gr+3.0;let corners=array<vec2<f32>,4>(vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,1.0));let c=corners[vid%4u];let tx=(c.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=c.y*pad;let p=aa+dir*lx+n*ly;
 var o:VOut;o.position=vec4<f32>(p.x/u.head.x*2.0-1.0,1.0-p.y/u.head.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidth=hw;o.glowRadius=gr;o.alpha=u.style.z;o.softness=u.style.w;o.sourceA=sa;o.sourceB=sb;o.copyAlpha=ca;return o;
}
@vertex fn vs(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->VOut{return makeVertex(vid,iid,false);}
@vertex fn vsCorridor(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->VOut{return makeVertex(vid,iid,true);}
fn sectorVisible(v:VOut)->bool{
 if(u.flags.x<0.5){return true;}
 let tau=6.28318530718;let progress=clamp(u.sector.z,0.0,1.0);let head=progress*tau;if(head<=0.000001){return false;}
 let span=clamp(u.sector.w,0.000001,tau);let tail=max(0.0,head-span);let s=clamp(v.local.x/max(0.0001,v.segLen),0.0,1.0);let p=mix(v.sourceA,v.sourceB,s)-u.sector.xy;let a=atan2(p.y,p.x);let p0=cubicData[0u].xy-u.sector.xy;let start=atan2(p0.y,p0.x);let dir=select(-1.0,1.0,u.flags.y>=0.0);let raw=select(start-a,a-start,dir>0.0);let rel=raw-floor(raw/tau)*tau;

 return rel+0.00001>=tail&&rel<=head+0.00001;
}
@fragment fn fsHalo(v:VOut)->@location(0) vec4<f32>{
 if(v.copyAlpha<=0.00001||!sectorVisible(v)){discard;}let cx=clamp(v.local.x,0.0,v.segLen);let d=length(vec2<f32>(v.local.x-cx,v.local.y));let edge=max(0.0,d-v.halfWidth);if(v.glowRadius<=0.01){discard;}let q=edge/max(0.0001,v.glowRadius);let s=clamp(v.softness,0.0,1.5);let start=mix(0.84,0.02,min(1.0,s));var glow=1.0-smoothstep(start,1.0,q);if(s>1.0){glow=pow(max(0.0,glow),mix(1.0,0.58,min(1.0,(s-1.0)*2.0)));}let aa=clamp(v.alpha*glow*v.copyAlpha,0.0,1.0);if(aa<0.00015){discard;}return vec4<f32>(u.color.rgb*aa,aa);
}
@fragment fn fsCore(v:VOut)->@location(0) vec4<f32>{
 if(v.copyAlpha<=0.00001||!sectorVisible(v)){discard;}let cx=clamp(v.local.x,0.0,v.segLen);let d=length(vec2<f32>(v.local.x-cx,v.local.y));let coverage=min(1.0,2.0*v.halfWidth)*clamp(v.halfWidth+0.5-d,0.0,1.0);let aa=clamp(v.alpha*coverage*v.copyAlpha,0.0,1.0);if(aa<0.00015){discard;}let gain=max(0.0,u.color.a);var lit=u.color.rgb*min(1.0,gain);if(gain>1.0){lit=mix(u.color.rgb,vec3<f32>(1.0),min(1.0,gain-1.0));}return vec4<f32>(lit*aa,aa);
}`;
    const COMPOSITE=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
struct V{@builtin(position) p:vec4<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);return o;}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let d=textureDimensions(srcTex);let q=vec2<i32>(clamp(i32(p.x),0,i32(d.x)-1),clamp(i32(p.y),0,i32(d.y)-1));return textureLoad(srcTex,q,0);}`;
    function maxBlend(){return{color:{srcFactor:'one',dstFactor:'one',operation:'max'},alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}};}
    async function initAsync(){
        if(ready&&device&&generation===WebGPUDeviceHub.getGeneration())return true;if(initializing)return initializing;
        const task=(async()=>{try{const shared=await WebGPUDeviceHub.acquire();device=shared.device;generation=shared.generation;format=navigator.gpu.getPreferredCanvasFormat();context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU canvas context недоступен');
            const mod=device.createShaderModule({label:'Somata Bézier Sweep WGSL',code:WGSL}),comp=device.createShaderModule({label:'Somata Bézier Sweep composite',code:COMPOSITE});if(typeof assertWebGPUShaderModule==='function'){await assertWebGPUShaderModule(mod,'Somata Bézier Sweep WGSL');await assertWebGPUShaderModule(comp,'Somata Bézier Sweep composite');}
            uniformLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});cubicLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]});copyLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
            const vertexBuffers=[];const corridorLayout=device.createPipelineLayout({bindGroupLayouts:[uniformLayout,cubicLayout,copyLayout]});const baseLayout=corridorLayout;const target={format,blend:maxBlend()};
            haloPipeline=device.createRenderPipeline({label:'Somata Bézier Sweep halo',layout:baseLayout,vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fsHalo',targets:[target]},primitive:{topology:'triangle-strip'}});corePipeline=device.createRenderPipeline({label:'Somata Bézier Sweep core',layout:baseLayout,vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fsCore',targets:[target]},primitive:{topology:'triangle-strip'}});
            haloCorridorPipeline=device.createRenderPipeline({label:'Somata Bézier Sweep halo corridor',layout:corridorLayout,vertex:{module:mod,entryPoint:'vsCorridor'},fragment:{module:mod,entryPoint:'fsHalo',targets:[target]},primitive:{topology:'triangle-strip'}});coreCorridorPipeline=device.createRenderPipeline({label:'Somata Bézier Sweep core corridor',layout:corridorLayout,vertex:{module:mod,entryPoint:'vsCorridor'},fragment:{module:mod,entryPoint:'fsCore',targets:[target]},primitive:{topology:'triangle-strip'}});
            compositeLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}}]});
            const compositePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[compositeLayout]});
            compositePipelines=Object.create(null);
            for(const mode of (typeof SWEEP_BLEND_MODES!=='undefined'?SWEEP_BLEND_MODES:['normal','screen','multiply','add','darken','lighten'])){
                compositePipelines[mode]=device.createRenderPipeline({label:`Somata Bézier Sweep ${mode} composite`,layout:compositePipelineLayout,vertex:{module:comp,entryPoint:'vs'},fragment:{module:comp,entryPoint:'fs',targets:[{format,blend:sweepBlendGpuState(mode)}]},primitive:{topology:'triangle-list'}});
            }
            compositeAddPipeline=compositePipelines.add;compositeOverPipeline=compositePipelines.normal;
            cornerBuffer=device.createBuffer({label:'Somata Bézier Sweep corners',size:32,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,1,1]));
            identityCopyBuffer=device.createBuffer({label:'Somata Bézier Sweep identity copy',size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(identityCopyBuffer,0,new Float32Array([1,0,1,0,0,1,1,0]));identityCopyBind=device.createBindGroup({layout:copyLayout,entries:[{binding:0,resource:{buffer:identityCopyBuffer}}]});
            ready=true;lastError='';try{requestMainCanvasRender?.();}catch(_){}return true;
        }catch(err){ready=false;lastError=String(err?.message||err);stats.failures++;return false;}})();initializing=task;try{return await task;}finally{if(initializing===task)initializing=null;}}
    function resetReusableResources(){for(const rec of uniformPairPool){try{rec.haloBuffer?.destroy?.();}catch(_){}try{rec.coreBuffer?.destroy?.();}catch(_){}}uniformPairPool=[];cubicBindCache=new WeakMap();copyBindCache=new WeakMap();}
    function makeUniformPair(){const haloBuffer=device.createBuffer({label:'Somata Bézier Sweep halo uniforms pooled',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),coreBuffer=device.createBuffer({label:'Somata Bézier Sweep core uniforms pooled',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),rec={generation,inUse:true,haloBuffer,coreBuffer,haloData:new Float32Array(28),coreData:new Float32Array(28),haloBind:device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer:haloBuffer}}]}),coreBind:device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer:coreBuffer}}]})};uniformPairPool.push(rec);stats.uniformPoolBuilds++;return rec;}
    function acquireUniformPair(){for(const rec of uniformPairPool)if(!rec.inUse&&rec.generation===generation){rec.inUse=true;stats.uniformPoolReuses++;return rec;}return makeUniformPair();}
    function releaseUniformPair(rec){if(rec&&rec.generation===generation)rec.inUse=false;}
    function cachedBufferBind(cache,layout,buffer,hitKey){let bind=cache.get(buffer);if(bind){stats[hitKey]=(stats[hitKey]||0)+1;return bind;}bind=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer}}]});cache.set(buffer,bind);return bind;}
    function warmup(){const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration():-1;if(ready&&gen!==generation){resetReusableResources();ready=false;device=null;scratchTexture=scratchView=compositeBind=null;width=height=0;targetViews=new WeakMap();}if(!ready&&!initializing)void initAsync();return ready;}
    function ensureSize(){if(!ready||!device)return false;const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);if(w===width&&h===height&&scratchTexture)return true;try{scratchTexture?.destroy?.();}catch(_){}width=w;height=h;canvas.width=w;canvas.height=h;context.configure({device,format,alphaMode:'premultiplied'});scratchTexture=device.createTexture({label:'Somata Bézier Sweep scratch',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});scratchView=scratchTexture.createView();compositeBind=device.createBindGroup({layout:compositeLayout,entries:[{binding:0,resource:scratchView}]});targetViews=new WeakMap();return true;}
    function targetView(texture){let v=targetViews.get(texture);if(!v){v=texture.createView();targetViews.set(texture,v);}return v;}
    function resources(prepared,ctx,cfg,lineWidth,visual,alpha,copies,alphas,frameCtx,footprint,layer){
        const external=prepared?.gpuCubicBuffer&&prepared?.gpuCubicCount>0;if(!(prepared?.cubicCount>0)&&!external)return null;const tr=ctx?.getTransform?.();if(!tr)return null;let cubicBuffer=null,ownsCubic=false;
        if(external){cubicBuffer=prepared.gpuCubicBuffer;prepared.cubicCount=prepared.gpuCubicCount;}else{if(!prepared?.cubicData)return null;cubicBuffer=device.createBuffer({label:'Somata Bézier Sweep cubic data',size:Math.max(32,Math.ceil(prepared.cubicData.byteLength/16)*16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(cubicBuffer,0,prepared.cubicData.buffer,prepared.cubicData.byteOffset,prepared.cubicData.byteLength);ownsCubic=true;}
        const cubicBind=cachedBufferBind(cubicBindCache,cubicLayout,cubicBuffer,'cubicBindCacheHits');
        let copyBind=null,copyCount=1;if(Array.isArray(copies)&&copies.length){const rec=WebGPUCorridorCopyStore.acquire(device,generation,frameCtx,copies,alphas,'sweep',footprint,layer);if(!rec?.buffer||!rec.k){if(ownsCubic)try{cubicBuffer.destroy();}catch(_){}return null;}copyCount=rec.k;copyBind=cachedBufferBind(copyBindCache,copyLayout,rec.buffer,'copyBindCacheHits');stats.corridorFrames++;stats.copies+=copyCount;}
        const sx=Math.hypot(Number(tr.a)||0,Number(tr.b)||0),sy=Math.hypot(Number(tr.c)||0,Number(tr.d)||0),scale=Math.sqrt(Math.max(1e-12,sx*sy)),rgb=GPUColorCache.rgb(cfg?.color||'#ffffff'),baseAlpha=Math.max(0,Math.min(1,Number(alpha)||0)),coreOpacity=Math.max(0,Math.min(1,Number.isFinite(Number(visual?.opacity))?Number(visual.opacity):1)),brightness=Math.max(0,Number(visual?.brightness)||0),coreColorGain=1,fullWidth=Math.max(.15,Math.abs(Number(lineWidth)||.15)*scale),halfWidth=fullWidth*.5,gr=Math.max(0,Number(visual?.glowSize)||0)*scale,haloAlpha=gr>.001&&Number(visual?.strength)>.001?Math.max(0,Math.min(32,baseAlpha*.22*Number(visual.strength)*brightness)):0,coreAlpha=baseAlpha*coreOpacity,softness=Math.max(0,Math.min(1.5,Number(visual?.softness)||0)),uniformPair=acquireUniformPair();
        const writeUniform=(isCore)=>{const f=isCore?uniformPair.coreData:uniformPair.haloData;f.fill(0);f[0]=width;f[1]=height;f[2]=prepared.cubicCount;f[3]=copyCount;f[4]=tr.a;f[5]=tr.c;f[6]=tr.e;f[8]=tr.b;f[9]=tr.d;f[10]=tr.f;f[12]=halfWidth;f[13]=isCore?0:gr;f[14]=isCore?coreAlpha:haloAlpha;f[15]=softness;f[16]=rgb[0];f[17]=rgb[1];f[18]=rgb[2];f[19]=isCore?coreColorGain:1;f[20]=Number(prepared.centerX)||0;f[21]=Number(prepared.centerY)||0;f[22]=Math.max(0,Math.min(1,Number(prepared.spectralProgress)||0));f[23]=Math.max(.000001,Math.min(Math.PI*2,Number(prepared.sectorSpanAngle)||Math.PI/4));f[24]=prepared.spectral===true?1:0;f[25]=Number(prepared.spectralDirection)<0?-1:1;const buffer=isCore?uniformPair.coreBuffer:uniformPair.haloBuffer;device.queue.writeBuffer(buffer,0,f);return{buffer,bind:isCore?uniformPair.coreBind:uniformPair.haloBind};};
        const halo=writeUniform(false),core=writeUniform(true);let released=false;return{cubicBuffer,cubicBind,copyBind,copyCount,halo,core,instances:prepared.cubicCount*SUBDIV*copyCount,destroy(){if(released)return;released=true;if(ownsCubic)try{cubicBuffer?.destroy?.();}catch(_){}releaseUniformPair(uniformPair);}};
    }
    function encodeScratch(encoder,res,kind){const core=kind==='core',pass=encoder.beginRenderPass({colorAttachments:[{view:scratchView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(res.copyBind?(core?coreCorridorPipeline:haloCorridorPipeline):(core?corePipeline:haloPipeline));pass.setBindGroup(0,core?res.core.bind:res.halo.bind);pass.setBindGroup(1,res.cubicBind);pass.setBindGroup(2,res.copyBind||identityCopyBind);pass.draw(4,res.instances);pass.end();}
    function encodeComposite(encoder,target,kind,cfg,loadOp='load'){const mode=kind==='core'?(sweepCoreBlendMode(cfg)):sweepGlowBlendMode(cfg),pass=encoder.beginRenderPass({colorAttachments:[{view:target,clearValue:{r:0,g:0,b:0,a:0},loadOp,storeOp:'store'}]});pass.setPipeline(compositePipelines[mode]||compositePipelines.normal||compositeOverPipeline);pass.setBindGroup(0,compositeBind);pass.draw(3);pass.end();}
    function encodeToLayerScene(targetTexture,prepared,ctx,cfg,lineWidth,visual,alpha,copies=null,alphas=null,frameCtx=null,footprint=1,layer=null){
        if(!targetTexture||!warmup()||!ensureSize()||!(prepared?.cubicCount||prepared?.gpuCubicCount))return null;let res=null;try{
            res=resources(prepared,ctx,cfg,lineWidth,visual,alpha,copies,alphas,frameCtx,footprint,layer);if(!res)return null;
            if(res.core&&res.halo){const enc=device.createCommandEncoder({label:prepared.spectral?'Somata Spectral Bézier Glint → Layer Scene':'Somata Precise Bézier Glint → Layer Scene'}),tv=targetView(targetTexture);
                if(prepared.gpuMorphResource){const railOk=typeof spiroGpuPrepareMorphForLayerScene==='function'?spiroGpuPrepareMorphForLayerScene(frameCtx,prepared.gpuMorphResource,prepared.gpuMorphT,enc):(typeof prepared.gpuMorphResource.encodeCurrentCubics==='function'?prepared.gpuMorphResource.encodeCurrentCubics(enc,prepared.gpuMorphT):(typeof encodeSharedGpuMorphPath==='function'&&encodeSharedGpuMorphPath(enc,prepared.gpuMorphResource.layerIndex,prepared.gpuMorphT)));if(!railOk){res.destroy();return null;}}
                if(res.halo){encodeScratch(enc,res,'halo');encodeComposite(enc,tv,'halo',cfg);}encodeScratch(enc,res,'core');encodeComposite(enc,tv,'core',cfg);stats.frames++;stats.deferredFrames++;stats.cubics+=prepared.cubicCount;stats.gpuSubsegments+=prepared.cubicCount*SUBDIV;
                return{handled:true,commandBuffer:enc.finish(),onSubmitted:()=>{try{if(prepared.gpuMorphResource){if(typeof prepared.gpuMorphResource.encodeCurrentCubics==='function'){const fid=Number(frameCtx?.frameId)||0,tt=typeof prepared.gpuMorphResource.resolveMorphT==='function'?prepared.gpuMorphResource.resolveMorphT(prepared.gpuMorphT):Math.max(0,Math.min(1,Number(prepared.gpuMorphT)||0));prepared.gpuMorphResource.currentCubicsCommittedFrameId=fid;prepared.gpuMorphResource.currentCubicsCommittedT=tt;}else noteSharedGpuMorphPathSubmitted?.(prepared.gpuMorphResource,prepared.gpuMorphT,frameCtx?.frameId);}}catch(_){}res.destroy();}};
            }return{handled:true,commandBuffer:null,onSubmitted:()=>res?.destroy?.()};
        }catch(err){res?.destroy?.();lastError=String(err?.message||err);stats.failures++;return null;}}

    function render(prepared,ctx,cfg,lineWidth,visual,alpha,copies=null,alphas=null,frameCtx=null,footprint=1,layer=null){
        if(!warmup()||!ensureSize()||!(prepared?.cubicCount||prepared?.gpuCubicCount))return false;let res=null;try{if(prepared.gpuMorphResource){if(typeof prepared.gpuMorphResource.encodeCurrentCubics==='function'){const pre=device.createCommandEncoder({label:'Somata Bézier Glint retained Morph rail prerequisite'});if(!prepared.gpuMorphResource.encodeCurrentCubics(pre,prepared.gpuMorphT))return false;device.queue.submit([pre.finish()]);}else if(typeof dispatchSharedGpuMorphPath==='function')dispatchSharedGpuMorphPath(prepared.gpuMorphResource.layerIndex,prepared.gpuMorphT);}res=resources(prepared,ctx,cfg,lineWidth,visual,alpha,copies,alphas,frameCtx,footprint,layer);if(!res)return false;const drawStage=(kind)=>{const mode=kind==='core'?(sweepCoreBlendMode(cfg)):sweepGlowBlendMode(cfg),enc=device.createCommandEncoder({label:`Somata Bézier Glint ${kind}`});encodeScratch(enc,res,kind);let p=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});// Direct path copies the already-unioned scratch to the hidden presentation canvas with Normal.

                p.setPipeline(compositePipelines.normal||compositeOverPipeline);p.setBindGroup(0,compositeBind);p.draw(3);p.end();device.queue.submit([enc.finish()]);ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation=sweepBlendCanvasOperation(mode);ctx.filter='none';ctx.drawImage(canvas,0,0);ctx.restore();};drawStage('halo');drawStage('core');device.queue.onSubmittedWorkDone().then(()=>res.destroy()).catch(()=>res.destroy());stats.frames++;stats.directFrames++;stats.cubics+=prepared.cubicCount;stats.gpuSubsegments+=prepared.cubicCount*SUBDIV;return true;}catch(err){res?.destroy?.();lastError=String(err?.message||err);stats.failures++;return false;}}
    function status(){warmup();return{available:ready,generation,lastError,width,height,subdivisionsPerCubic:SUBDIV,...stats,contract:'Somata 7.5 High/Chaotic/Spectral Glint accepts retained cubic Bézier controls from CPU sources or the shared topology-Morph GPU cubic buffer; GPU evaluates only a small fixed subdivision lattice per cubic. Core/Glow uniform buffers and external cubic/copy bind groups are pooled across frames instead of being recreated per draw. Halo and colored Core composite independently with the selected Glow/Core blend modes; Lightning preflash routes both stages through Glow. Spectral mode performs exactly one cycle-locked, seam-safe angular lap from the contour start; the sector never wraps onto already-visited geometry within the same lap.'};}
    return{warmup,isReady:()=>warmup(),encodeToLayerScene,render,status};
})();
window.__spiroBezierSweepStatus=()=>WebGPUBezierSweepRenderer.status();
