// SpiroStar v513 — Dedicated WebGPU Graffiti ribbon renderer
// Extracted from legacy/app-a so Graffiti GPU backend can evolve independently.
window.__spiroRegisterModule?.('js/gpu/graffiti-ribbon-renderer');


// Somata 7.0.13 Graffiti contour Glow repair — the halo is a GPU post-process of the
// exact calligraphic ribbon mask.  It therefore follows nib width/angle/variation/joins
// instead of glowing a hidden thin centreline.  The mask and both blur passes remain in
// WebGPU textures; there is no Canvas2D blur/readback path here.
const WebGPUGraffitiContourGlow=(()=>{
    const SLOT_COUNT=32,BLUR_TAPS=12;
    let device=null,format=null,generation=-1,ready=false,initializing=null,lastError='not-initialized';
    let bindLayout=null,pipelineBlur=null,pipelineOver=null,pipelineBehind=null,pipelineOverStencil=null,pipelineBehindStencil=null,pipelineModes=Object.create(null),pipelineModesStencil=Object.create(null),sampler=null,slots=[],cursor=0;
    const stats={frames:0,blurPasses:0,composites:0,textureBuilds:0,failures:0};
    let lastLoggedFailure='';
    function fail(stage,reason,err=null,extra=null){
        const msg=String(reason||err?.message||err||'unknown failure');lastError=msg;stats.failures++;
        const sig=String(stage)+'|'+msg;if(sig!==lastLoggedFailure){lastLoggedFailure=sig;console.error(`[Somata Graffiti Contour Glow GPU] ERROR @ ${stage}: ${msg}`,{stage,reason:msg,gpuOnly:true,noCanvasFallback:true,...(extra||{})},err||'');}
    }
    const WGSL=`
struct U { invSize:vec2<f32>, dir:vec2<f32>, radius:f32, alpha:f32, _pad:vec2<f32>, color:vec4<f32> };
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSamp:sampler;
@group(0) @binding(2) var<uniform> u:U;
struct V { @builtin(position) pos:vec4<f32>, @location(0) uv:vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vid:u32)->V{
    var pos=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let p=pos[vid];var o:V;o.pos=vec4<f32>(p,0.0,1.0);o.uv=vec2<f32>(p.x*0.5+0.5,0.5-p.y*0.5);return o;
}
fn blurredAlpha(uv0:vec2<f32>)->f32{
    var sum=0.0;var wsum=0.0;let r=max(0.0,u.radius);
    for(var i:i32=-${BLUR_TAPS};i<=${BLUR_TAPS};i=i+1){
        let q=f32(i)/f32(${BLUR_TAPS});let soft=u._pad.x;var zScale=select(2.45,mix(3.35,1.25,min(1.0,max(0.0,soft))),soft>=0.0);if(soft>1.0){zScale=mix(zScale,0.92,min(1.0,(soft-1.0)*2.0));}let z=q*zScale;let w=exp(-0.5*z*z);
        let uv=clamp(uv0+u.dir*u.invSize*(r*q),vec2<f32>(0.0),vec2<f32>(1.0));
        sum+=textureSampleLevel(srcTex,srcSamp,uv,0.0).a*w;wsum+=w;
    }
    return sum/max(0.000001,wsum);
}
@fragment fn fsBlur(v:V)->@location(0) vec4<f32>{let a=blurredAlpha(v.uv);return vec4<f32>(a,a,a,a);}
@fragment fn fsComposite(v:V)->@location(0) vec4<f32>{let a=clamp(blurredAlpha(v.uv)*u.alpha,0.0,1.0);if(a<0.0001){discard;}return vec4<f32>(u.color.rgb*a,a);}`;
    function blend(kind){if(kind==='behind')return{color:{srcFactor:'one-minus-dst-alpha',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one-minus-dst-alpha',dstFactor:'one',operation:'add'}};return{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};}
    async function initAsync(){
        if(ready&&device&&generation===WebGPUDeviceHub.getGeneration())return true;if(initializing)return initializing;
        const task=(async()=>{try{
            const shared=await WebGPUDeviceHub.acquire();device=shared.device;generation=shared.generation;format=navigator.gpu.getPreferredCanvasFormat();
            const mod=device.createShaderModule({label:'Somata Graffiti contour Glow blur WGSL',code:WGSL});if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(mod,'Somata Graffiti contour Glow blur WGSL');
            bindLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
            const layout=device.createPipelineLayout({bindGroupLayouts:[bindLayout]});
            pipelineBlur=device.createRenderPipeline({label:'Somata Graffiti Glow horizontal blur',layout,vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fsBlur',targets:[{format}]},primitive:{topology:'triangle-list'}});
            const stencilFace={compare:'equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},stencilState={format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',stencilFront:stencilFace,stencilBack:stencilFace,stencilReadMask:1,stencilWriteMask:0};
            const makeComposite=(kind,blendState=blend(kind),withStencil=false)=>device.createRenderPipeline({label:`Somata Graffiti Glow composite ${kind}${withStencil?' stencil':''}`,layout,vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fsComposite',targets:[{format,blend:blendState}]},primitive:{topology:'triangle-list'},...(withStencil?{depthStencil:stencilState}:{})});
            pipelineOver=makeComposite('over');pipelineBehind=makeComposite('behind');pipelineOverStencil=makeComposite('over',blend('over'),true);pipelineBehindStencil=makeComposite('behind',blend('behind'),true);pipelineModes=Object.create(null);pipelineModesStencil=Object.create(null);
            if(typeof sweepBlendGpuState==='function'){for(const mode of (typeof SWEEP_BLEND_MODES!=='undefined'?SWEEP_BLEND_MODES:['normal','screen','multiply','add','darken','lighten'])){const bs=sweepBlendGpuState(mode);pipelineModes[mode]=makeComposite(`mode-${mode}`,bs);pipelineModesStencil[mode]=makeComposite(`mode-${mode}`,bs,true);}}
            sampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
            slots=Array.from({length:SLOT_COUNT},()=>({w:0,h:0,mask:null,scratch:null,uniformH:null,uniformV:null}));cursor=0;ready=true;lastError='';return true;
        }catch(err){ready=false;fail('init/pipeline',err?.message||err,err);return false;}})();initializing=task;try{return await task;}finally{if(initializing===task)initializing=null;}
    }
    function destroySlot(slot){for(const t of [slot?.mask,slot?.scratch])try{t?.destroy?.();}catch(_){}for(const b of [slot?.uniformH,slot?.uniformV])try{b?.destroy?.();}catch(_){}if(slot){slot.mask=slot.scratch=slot.uniformH=slot.uniformV=null;slot.w=slot.h=0;}}
    function warmup(){const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration():-1;if(ready&&gen!==generation){for(const s of slots)destroySlot(s);slots=[];device=null;ready=false;pipelineBlur=pipelineOver=pipelineBehind=pipelineOverStencil=pipelineBehindStencil=null;pipelineModes=Object.create(null);pipelineModesStencil=Object.create(null);bindLayout=null;sampler=null;}if(!ready&&!initializing)void initAsync();return ready;}
    function acquire(width,height){
        if(!warmup())return null;const w=Math.max(1,Math.round(Number(width)||1)),h=Math.max(1,Math.round(Number(height)||1)),slot=slots[cursor++%slots.length];
        if(!slot)return null;if(slot.w!==w||slot.h!==h||!slot.mask||!slot.scratch){destroySlot(slot);slot.w=w;slot.h=h;const usage=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING;slot.mask=device.createTexture({label:'Somata Graffiti Glow contour mask',size:[w,h,1],format,usage});slot.scratch=device.createTexture({label:'Somata Graffiti Glow blur scratch',size:[w,h,1],format,usage});slot.uniformH=device.createBuffer({label:'Somata Graffiti Glow H uniforms',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});slot.uniformV=device.createBuffer({label:'Somata Graffiti Glow V uniforms',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});stats.textureBuilds++;}
        return slot;
    }
    function writeUniform(buffer,w,h,dx,dy,radius,alpha,color,softness=-1){const u=new Float32Array(12);u[0]=1/Math.max(1,w);u[1]=1/Math.max(1,h);u[2]=dx;u[3]=dy;u[4]=Math.max(.01,Number(radius)||0);u[5]=Math.max(0,Math.min(1,Number(alpha)||0));u[6]=Number.isFinite(Number(softness))?Number(softness):-1;u[8]=Number(color?.[0])||0;u[9]=Number(color?.[1])||0;u[10]=Number(color?.[2])||0;u[11]=1;device.queue.writeBuffer(buffer,0,u);}
    function encodeBlurComposite(encoder,slot,targetTexture,opts={}){
        if(!encoder||!slot?.mask||!slot?.scratch||!targetTexture||!warmup())return false;
        try{
            const radius=Math.max(.5,Number(opts.radiusPx)||.5),alpha=Math.max(0,Math.min(1,Number(opts.alphaScale)||0)),color=opts.color||[1,1,1,1];
            const softness=Number.isFinite(Number(opts.softness))?Math.max(0,Math.min(1.5,Number(opts.softness))):-1;writeUniform(slot.uniformH,slot.w,slot.h,1,0,radius,1,[1,1,1,1],softness);writeUniform(slot.uniformV,slot.w,slot.h,0,1,radius,alpha,color,softness);
            const hbg=device.createBindGroup({layout:bindLayout,entries:[{binding:0,resource:slot.mask.createView()},{binding:1,resource:sampler},{binding:2,resource:{buffer:slot.uniformH}}]});
            const vbg=device.createBindGroup({layout:bindLayout,entries:[{binding:0,resource:slot.scratch.createView()},{binding:1,resource:sampler},{binding:2,resource:{buffer:slot.uniformV}}]});
            let pass=encoder.beginRenderPass({colorAttachments:[{view:slot.scratch.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});pass.setPipeline(pipelineBlur);pass.setBindGroup(0,hbg);pass.draw(3);pass.end();
            const useStencil=Boolean(opts.stencilView),desc={colorAttachments:[{view:targetTexture.createView(),loadOp:'load',storeOp:'store'}]};if(useStencil)desc.depthStencilAttachment={view:opts.stencilView,depthLoadOp:'load',depthStoreOp:'discard',stencilLoadOp:'load',stencilStoreOp:'store'};
            pass=encoder.beginRenderPass(desc);if(useStencil)pass.setStencilReference(Math.max(0,Number(opts.stencilReference)||0));const blendMode=typeof normalizeSweepBlendMode==='function'?normalizeSweepBlendMode(opts.blendMode):String(opts.blendMode||'normal');const compositePipe=useStencil?(opts.composite==='destination-over'?pipelineBehindStencil:(pipelineModesStencil[blendMode]||pipelineOverStencil)):(opts.composite==='destination-over'?pipelineBehind:(pipelineModes[blendMode]||pipelineOver));pass.setPipeline(compositePipe);pass.setBindGroup(0,vbg);pass.draw(3);pass.end();
            stats.frames++;stats.blurPasses+=2;stats.composites++;return true;
        }catch(err){fail('encode/blur-composite',err?.message||err,err,{radiusPx:opts.radiusPx});return false;}
    }
    function status(){warmup();return{available:ready,gpuOnly:true,lastError,generation,...stats,policy:'exact Graffiti ribbon / contour -> GPU mask -> separable WebGPU blur -> GPU Layer Scene; optional stencil-clipped composite; no thin-line carrier and no Canvas blur'};}
    return{warmup,isReady:()=>warmup(),acquire,encodeBlurComposite,status,fail};
})();
window.__spiroGraffitiContourGlowGPUStatus=()=>WebGPUGraffitiContourGlow.status();

// v522.13 — native closed Graffiti core ribbon.
// Closed contours include the last->first span. Core stays unexpanded; Glow is generated
// from this exact ribbon as a GPU mask + separable GPU blur, avoiding geometric halo wedges.
const WebGPUGraffitiRibbonRenderer=(()=>{
    const overlayCanvas=document.getElementById('graffitiGpuOverlayCanvas');
    let overlayContext=null,overlayCurrentTexture=null,overlayConfiguredGeneration=-1,overlayFrameId=-1,overlayClearedFrame=-1,overlayUsedFrame=-1,overlayFrames=0,overlayDraws=0;
    let device=null,format=null,pipelineOver=null,pipelineBehind=null,corridorPipelineOver=null,corridorPipelineBehind=null,layout=null,corridorLayout=null,uniformBuffers=[],uniformCursor=0;
    let vertexSlots=[],vertexCapacity=0,vertexData=null,vertexSlotCursor=0,vertexSlotGrows=0;
    let corridorCopyBuffers=[],corridorCopyData=null,corridorCopyCapacity=0,corridorCopyCursor=0,corridorCopyBindGroups=[],sharedCorridorCopyBinds=new WeakMap(),sharedCorridorCopyReuse=0;
    let attempted=false,initializing=false,ready=false,lost=false,lastError='',hubGeneration=0,targetViews=new WeakMap();
    const diagnostic={stage:'idle',reason:'',lastBackend:'none',cpuPrepare:'CPU ribbon mesh',gpuUpload:false,gpuDraw:false,presentation:'none',failures:0,lastFailureAt:0,lastSuccessAt:0};
    let lastLoggedFailure='';
    function noteFailure(stage,reason,err=null,extra=null){
        const msg=String(reason||err?.message||err||'unknown failure');lastError=msg;diagnostic.stage=String(stage||'unknown');diagnostic.reason=msg;diagnostic.failures++;diagnostic.lastFailureAt=performance.now();
        const sig=diagnostic.stage+'|'+msg;if(sig!==lastLoggedFailure){lastLoggedFailure=sig;console.error(`[SpiroStar Graffiti GPU] ${diagnostic.stage}: ${msg}`,{stage:diagnostic.stage,reason:msg,cpuPrepare:diagnostic.cpuPrepare,lastBackend:diagnostic.lastBackend,...(extra||{})},err||'');}
    }
    function noteSuccess(stage,backend='webgpu-layer-scene',presentation='gpu-texture'){
        diagnostic.stage=stage;diagnostic.reason='';diagnostic.lastBackend=backend;diagnostic.gpuUpload=true;diagnostic.gpuDraw=true;diagnostic.presentation=presentation;diagnostic.lastSuccessAt=performance.now();lastError='';
    }
    const uniformData=new Float32Array(16);
    const stats={frames:0,draws:0,uploads:0,uploadBytes:0,vertices:0,failures:0,glowFrames:0,glowPasses:0,glowVertices:0,contourGlowFrames:0,contourGlowMasks:0,corridorFrames:0,corridorDraws:0,corridorCopies:0,corridorLogicalVertices:0,corridorCopyUploadBytes:0};
    const WGSL=`
struct U { viewport: vec2<f32>, _pad: vec2<f32>, row0: vec4<f32>, row1: vec4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<storage,read> copyData:array<vec4<f32>>;
struct In { @location(0) p:vec2<f32>, @location(1) bary:vec3<f32>, @location(2) edgeMask:vec3<f32>, @location(3) side:f32 };
struct Out { @builtin(position) position:vec4<f32>, @location(0) bary:vec3<f32>, @location(1) @interpolate(flat) edgeMask:vec3<f32>, @location(2) @interpolate(flat) copyAlpha:f32, @location(3) side:f32 };
fn emit(p:vec2<f32>,v:In,copyAlpha:f32)->Out{
    let q=vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);
    var o:Out;o.position=vec4<f32>(q.x/max(1.0,u.viewport.x)*2.0-1.0,1.0-q.y/max(1.0,u.viewport.y)*2.0,0.0,1.0);o.bary=v.bary;o.edgeMask=v.edgeMask;o.copyAlpha=copyAlpha;o.side=v.side;return o;
}
@vertex fn vs(v:In)->Out{return emit(v.p,v,1.0);}
@vertex fn vsCorridor(v:In,@builtin(instance_index) iid:u32)->Out{
    let c0=copyData[iid*2u];let c1=copyData[iid*2u+1u];
    let p=vec2<f32>(c0.x*v.p.x+c0.y*v.p.y,c1.x*v.p.x+c1.y*v.p.y);
    return emit(p,v,c0.z);
}
@fragment fn fs(v:Out)->@location(0) vec4<f32>{
    let fw=max(fwidth(v.bary),vec3<f32>(0.00001));
    let edge=smoothstep(vec3<f32>(0.0),fw*1.15,v.bary);
    var cov=1.0;
    if(v.edgeMask.x>0.5){cov=min(cov,edge.x);}if(v.edgeMask.y>0.5){cov=min(cov,edge.y);}if(v.edgeMask.z>0.5){cov=min(cov,edge.z);}
    // row0.w = core/outer width ratio; row1.w = halo strength. v522.13 feeds
    // coreRatio=1 and haloStrength=0: the ribbon is core-only; Glow is a separate GPU pass.
    let cr=clamp(u.row0.w,0.0,1.0);let gs=max(0.0,u.row1.w);let s=abs(v.side);
    let sw=max(fwidth(s)*1.35,0.0005);
    let core=1.0-smoothstep(max(0.0,cr-sw),min(1.0,cr+sw),s);
    let denom=max(0.0001,1.0-cr);let haloT=clamp((1.0-s)/denom,0.0,1.0);
    let halo=(1.0-core)*pow(haloT,1.65)*gs;
    let a=clamp(u.color.a*v.copyAlpha*(core+halo)*cov,0.0,1.0);if(a<0.0001){discard;}return vec4<f32>(u.color.rgb*a,a);
}`;
    function blend(kind){if(kind==='behind')return{color:{srcFactor:'one-minus-dst-alpha',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one-minus-dst-alpha',dstFactor:'one',operation:'add'}};return{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};}
    async function initAsync(){
        if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready)return false;attempted=true;initializing=true;lastError='';
        try{const shared=await WebGPUDeviceHub.acquire();device=shared.device;hubGeneration=shared.generation;lost=false;format=navigator.gpu.getPreferredCanvasFormat();
            const module=device.createShaderModule({label:'SpiroStar variable Graffiti ribbon WGSL',code:WGSL});await assertWebGPUShaderModule(module,'SpiroStar variable Graffiti ribbon WGSL');
            layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
            corridorLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
            const pl=device.createPipelineLayout({bindGroupLayouts:[layout]});
            const corridorPl=device.createPipelineLayout({bindGroupLayouts:[layout,corridorLayout]});
            const vb=[{arrayStride:36,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x3'},{shaderLocation:2,offset:20,format:'float32x3'},{shaderLocation:3,offset:32,format:'float32'}]}];
            const make=(kind)=>device.createRenderPipeline({label:`SpiroStar variable Graffiti ribbon ${kind}`,layout:pl,vertex:{module,entryPoint:'vs',buffers:vb},fragment:{module,entryPoint:'fs',targets:[{format,blend:blend(kind)}]},primitive:{topology:'triangle-list',cullMode:'none'}});
            const makeCorridor=(kind)=>device.createRenderPipeline({label:`SpiroStar Corridor variable Graffiti ribbon ${kind}`,layout:corridorPl,vertex:{module,entryPoint:'vsCorridor',buffers:vb},fragment:{module,entryPoint:'fs',targets:[{format,blend:blend(kind)}]},primitive:{topology:'triangle-list',cullMode:'none'}});
            pipelineOver=make('over');pipelineBehind=make('behind');corridorPipelineOver=makeCorridor('over');corridorPipelineBehind=makeCorridor('behind');
            // Deferred effect command buffers can coexist until the final frame submit.
            // A wide uniform ring prevents later queue.writeBuffer calls from mutating
            // parameters referenced by earlier Graffiti/Outline command buffers.
            uniformBuffers=Array.from({length:64},(_,i)=>device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar variable Graffiti uniforms ${i}`}));uniformCursor=0;
            corridorCopyCapacity=64;corridorCopyData=new Float32Array(corridorCopyCapacity*8);corridorCopyBuffers=Array.from({length:12},(_,i)=>device.createBuffer({size:corridorCopyCapacity*8*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar Corridor variable Graffiti copies ${i}`}));corridorCopyBindGroups=new Array(corridorCopyBuffers.length).fill(null);corridorCopyCursor=0;
            ready=true;initializing=false;return true;
        }catch(err){ready=false;initializing=false;stats.failures++;noteFailure('init/pipeline',err?.message||err,err);return false;}
    }
    function warmup(){try{WebGPUGraffitiContourGlow.warmup?.();}catch(_){}const hubReady=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();if(ready&&(!hubReady||gen!==hubGeneration)){ready=false;attempted=false;initializing=false;lost=!hubReady;for(const b of uniformBuffers)try{b?.destroy?.();}catch(_){}for(const slot of vertexSlots)try{slot?.buffer?.destroy?.();}catch(_){}for(const b of corridorCopyBuffers)try{b?.destroy?.();}catch(_){}uniformBuffers=[];vertexSlots=[];vertexSlotCursor=0;corridorCopyBuffers=[];corridorCopyBindGroups=[];corridorCopyCapacity=0;corridorCopyData=null;corridorCopyCursor=0;sharedCorridorCopyBinds=new WeakMap();targetViews=new WeakMap();vertexCapacity=0;vertexData=null;pipelineOver=pipelineBehind=corridorPipelineOver=corridorPipelineBehind=null;layout=corridorLayout=null;}if(!ready&&!initializing&&(!attempted||hubReady))initAsync();return ready&&!lost;}
    // Contour Glow doubled the number of deferred Graffiti draws per layer. The old three-buffer
    // ring could therefore be overwritten before the frame-wide queue.submit() (3 layers = 6
    // writes), which produced intermittent missing/incorrect core centres. Never reuse a vertex
    // buffer inside the same render frame. Across frames queue ordering makes reuse safe.
    function graffitiGpuFrameId(){return Math.max(1,Number(renderRuntime?.frameId)||Number(frameGeometryRuntime?.frameId)||1);}
    function ensureVertexCapacity(floatCount){
        if(floatCount<=vertexCapacity&&vertexData)return;
        const next=performanceGovernor.capacityFor(floatCount,vertexCapacity,4096,1.6);vertexCapacity=next;vertexData=new Float32Array(vertexCapacity);
        const old=vertexSlots;vertexSlots=[];vertexSlotCursor=0;
        for(const slot of old)if(slot?.buffer)WebGPUBufferRecycler.recycle(device,hubGeneration,slot.buffer);
    }
    function acquireFrameSafeVertexBuffer(floatCount){
        ensureVertexCapacity(floatCount);const frameId=graffitiGpuFrameId();
        const n=vertexSlots.length;
        for(let attempt=0;attempt<n;attempt++){
            const idx=(vertexSlotCursor+attempt)%n,slot=vertexSlots[idx];
            if(slot&&slot.lastFrameId!==frameId){slot.lastFrameId=frameId;vertexSlotCursor=(idx+1)%Math.max(1,n);return slot.buffer;}
        }
        const buffer=WebGPUBufferRecycler.acquire(device,hubGeneration,vertexCapacity*4,GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,`SpiroStar frame-safe Graffiti vertices ${vertexSlots.length}`);
        if(!buffer)return null;vertexSlots.push({buffer,lastFrameId:frameId});vertexSlotGrows++;vertexSlotCursor=0;return buffer;
    }
    function styleParams(layer,widthOverride=null,colorOverride=null){const type=['round','slash','square'].includes(layer?.lineProfileGraffiti)?layer.lineProfileGraffiti:'slash',nibShape=['pointed','blunt','pinched','round'].includes(layer?.graffitiNibShape)?layer.graffitiNibShape:'pointed',nibBase=Math.max(1,Math.min(20,Number(layer?.graffitiNibLength)||10)),nibMul=Math.max(.01,Number.isFinite(Number(layer?.graffitiNibLengthMultiplier))?Number(layer.graffitiNibLengthMultiplier):1),rawAngle=Number(layer?.graffitiAngle),angle=Math.max(-90,Math.min(90,Number.isFinite(rawAngle)?rawAngle:45))*Math.PI/180,sizeStrength=layer?.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer?.graffitiSizeVariation)||0)>0?Math.max(0,Math.min(1,(Number(layer?.graffitiSizeVariation)||0)/100)):0,sizeFocus=Math.max(0,Math.min(1,(Number.isFinite(Number(layer?.graffitiSizeFocus))?Number(layer.graffitiSizeFocus):50)/100)),rawMul=Number(layer?.graffitiRotationMultiplier),rotDeg=layer?.graffitiRotationVariationEnabled===true&&Math.max(0,Number(layer?.graffitiRotationVariation)||0)>0?Math.max(0,Number(layer?.graffitiRotationVariation)||0)*Math.max(0,Number.isFinite(rawMul)?rawMul:1):0,rotFocus=Math.max(0,Math.min(1,(Number.isFinite(Number(layer?.graffitiRotationFocus))?Number(layer.graffitiRotationFocus):50)/100));return{type,nibShape,nibRatio:nibBase*nibMul,angle,angleMode:layer?.graffitiAngleMode==='relative'?'relative':'absolute',sizeStrength,sizeFocus,rotationTotal:rotDeg*Math.PI/180,rotationFocus:rotFocus,width:Math.max(.001,Number(widthOverride??((Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer)))||1.5),color:String(colorOverride??layer?.strokeColor??'#ffffff')};}
    function sceneView(texture){let view=targetViews.get(texture);if(view)return view;view=texture.createView();targetViews.set(texture,view);return view;}
    function canEncode(layer,prepared){if(!prepared?.gpuRibbonEligible||!Array.isArray(prepared.graffitiPlan)||!prepared.graffitiPlan.length)return false;return !prepared.graffitiPlan.some(item=>!item?.vary||!item.path?.points||item.path.points.length<2);}
    function makeUniformBindGroup(m,color,alpha,coreRatio=1,haloStrength=0){
        if(!uniformBuffers.length)return null;const ub=uniformBuffers[uniformCursor++%uniformBuffers.length];
        uniformData.fill(0);uniformData[0]=mainCanvas.width;uniformData[1]=mainCanvas.height;uniformData[4]=m.a;uniformData[5]=m.c;uniformData[6]=m.e;uniformData[7]=Math.max(0,Math.min(1,Number(coreRatio)||0));uniformData[8]=m.b;uniformData[9]=m.d;uniformData[10]=m.f;uniformData[11]=Math.max(0,Number(haloStrength)||0);uniformData[12]=color[0];uniformData[13]=color[1];uniformData[14]=color[2];uniformData[15]=Math.max(0,Math.min(1,Number(alpha)||0))*color[3];
        device.queue.writeBuffer(ub,0,uniformData);return device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:ub}}]});
    }
    function meshBatch(prepared,s,width){
        diagnostic.cpuPrepare='CPU ribbon mesh (path -> variable-width triangles + stable joins)';
        const meshes=[];let floats=0,prev=null;
        for(const item of prepared.graffitiPlan){
            if(prev&&item?.bridgeFromPrevious!==false&&prev?.bridgeToNext!==false&&typeof buildGraffitiVariableRibbonBridgeMesh==='function'){const bridge=buildGraffitiVariableRibbonBridgeMesh(prev,item,width,s.type,s.angle,s.nibRatio,s.nibShape,s.sizeStrength,s.sizeFocus,s.rotationTotal,s.rotationFocus,s.angleMode);if(bridge?.length){meshes.push(bridge);floats+=bridge.length;}}
            const mesh=getCachedGraffitiVariableRibbonMesh(item.path,width,s.type,s.angle,s.nibRatio,s.nibShape,s.sizeStrength,s.sizeFocus,s.rotationTotal,s.rotationFocus,item.meta,s.angleMode);if(!mesh?.length)return null;meshes.push(mesh);floats+=mesh.length;prev=item;
        }
        return{meshes,floats,vertices:floats/9};
    }
    function encodeToLayerScene(targetTexture,prepared,layer,alpha,targetCtx,composite='source-over',override=null){
        if(!targetTexture||alpha<=.001||!canEncode(layer,prepared)||!warmup())return{handled:false,commandBuffer:null};
        try{
            const s=styleParams(layer,override?.width,override?.color),m=targetCtx?.getTransform?.();if(!m)return{handled:false,commandBuffer:null};
            const c=GPUColorCache.rgba(s.color),glow=Math.max(0,(Number(layer?.glow)||0)*getLayerGlowMultiplier(layer)),gi=Math.max(0,((Number.isFinite(Number(layer?.glowIntensity))?Number(layer.glowIntensity):40)/100)*getLayerGlowIntensityMultiplier(layer));
            const sx=Math.hypot(Number(m.a)||0,Number(m.b)||0),sy=Math.hypot(Number(m.c)||0,Number(m.d)||0),screenScale=Math.sqrt(Math.max(1e-8,sx*sy));
            const blurPx=Math.max(0,glow*.55*gi),localBlur=blurPx/screenScale;
            // Core ribbon never expands to carry Glow. The contour Glow path rasterizes this exact
            // same ribbon to a GPU mask and blurs the mask, so corners do not grow support wedges.
            const outerWidth=s.width,coreRatio=1,haloStrength=0;
            diagnostic.stage='cpu-ribbon-mesh';const batch=meshBatch(prepared,s,outerWidth);if(!batch){noteFailure('cpu-ribbon-mesh','ribbon mesh preparation returned empty');return{handled:false,commandBuffer:null};}
            const total=batch.floats;if(!total)return{handled:true,commandBuffer:null};diagnostic.stage='gpu-vertex-buffer';ensureVertexCapacity(total);
            let floatOffset=0;for(const mesh of batch.meshes){vertexData.set(mesh,floatOffset);floatOffset+=mesh.length;}
            const vb=acquireFrameSafeVertexBuffer(total);if(!vb){noteFailure('gpu-vertex-buffer','frame-safe Graffiti vertex buffer unavailable');return{handled:false,commandBuffer:null};}diagnostic.stage='gpu-upload';device.queue.writeBuffer(vb,0,vertexData.buffer,0,total*4);stats.uploads++;stats.uploadBytes+=total*4;
            diagnostic.stage='gpu-command-encode';const enc=device.createCommandEncoder({label:'SpiroStar variable Graffiti analytic Glow -> Layer Scene'}),pass=enc.beginRenderPass({colorAttachments:[{view:sceneView(targetTexture),loadOp:'load',storeOp:'store'}]});
            pass.setPipeline(composite==='destination-over'?pipelineBehind:pipelineOver);pass.setVertexBuffer(0,vb);
            const baseAlpha=Math.max(0,Math.min(1,Number(alpha)||0)),bg=makeUniformBindGroup(m,c,baseAlpha,coreRatio,haloStrength);if(!bg){pass.end();return{handled:false,commandBuffer:null};}
            pass.setBindGroup(0,bg);pass.draw(batch.vertices,1,0,0);stats.draws++;stats.vertices+=batch.vertices;if(haloStrength>0){stats.glowFrames++;stats.glowPasses++;stats.glowVertices+=batch.vertices;}
            pass.end();stats.frames++;noteSuccess('encode/draw','webgpu-layer-scene','deferred GPU texture');return{handled:true,commandBuffer:enc.finish()};
        }catch(err){stats.failures++;noteFailure(diagnostic.stage||'encode/draw',err?.message||err,err,{target:'layer-scene'});return{handled:false,commandBuffer:null};}
    }
    function encodeGlowToLayerScene(targetTexture,prepared,layer,maskAlpha,targetCtx,opts={}){
        const radiusPx=Math.max(.5,Number(opts?.radiusPx)||0),alphaScale=Math.max(0,Math.min(1,Number(opts?.alphaScale)||0));
        if(!targetTexture||alphaScale<=.001||!canEncode(layer,prepared)||!warmup()||!WebGPUGraffitiContourGlow.isReady?.())return{handled:false,commandBuffer:null};
        try{
            const s=styleParams(layer,opts?.width,opts?.color),m=targetCtx?.getTransform?.();if(!m)return{handled:false,commandBuffer:null};
            diagnostic.stage='contour-glow cpu-ribbon-mesh';const batch=meshBatch(prepared,s,s.width);if(!batch){noteFailure(diagnostic.stage,'ribbon contour mask preparation returned empty');return{handled:false,commandBuffer:null};}
            const total=batch.floats;if(!total)return{handled:true,commandBuffer:null};ensureVertexCapacity(total);let floatOffset=0;for(const mesh of batch.meshes){vertexData.set(mesh,floatOffset);floatOffset+=mesh.length;}
            const vb=acquireFrameSafeVertexBuffer(total);if(!vb){noteFailure('contour-glow gpu-vertex-buffer','frame-safe Graffiti Glow vertex buffer unavailable');return{handled:false,commandBuffer:null};}device.queue.writeBuffer(vb,0,vertexData.buffer,0,total*4);stats.uploads++;stats.uploadBytes+=total*4;
            const slot=WebGPUGraffitiContourGlow.acquire(mainCanvas.width,mainCanvas.height);if(!slot){noteFailure('contour-glow acquire','GPU contour Glow scratch textures unavailable');return{handled:false,commandBuffer:null};}
            const enc=device.createCommandEncoder({label:'Somata Graffiti exact ribbon contour Glow'}),pass=enc.beginRenderPass({colorAttachments:[{view:slot.mask.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
            pass.setPipeline(pipelineOver);pass.setVertexBuffer(0,vb);const bg=makeUniformBindGroup(m,[1,1,1,1],Math.max(0,Math.min(1,Number(maskAlpha)||0)),1,0);if(!bg){pass.end();return{handled:false,commandBuffer:null};}pass.setBindGroup(0,bg);pass.draw(batch.vertices,1,0,0);pass.end();
            const color=GPUColorCache.rgba(s.color);if(!WebGPUGraffitiContourGlow.encodeBlurComposite(enc,slot,targetTexture,{radiusPx,alphaScale,color,composite:opts?.composite||'source-over'})){noteFailure('contour-glow blur','GPU contour blur/composite encode failed');return{handled:false,commandBuffer:null};}
            stats.contourGlowFrames++;stats.contourGlowMasks++;stats.glowFrames++;stats.glowPasses++;stats.glowVertices+=batch.vertices;noteSuccess('contour-glow encode/draw','webgpu-layer-scene','deferred GPU texture');return{handled:true,commandBuffer:enc.finish()};
        }catch(err){stats.failures++;noteFailure(diagnostic.stage||'contour-glow encode',err?.message||err,err,{target:'layer-scene'});return{handled:false,commandBuffer:null};}
    }

    function ensureCorridorCopyCapacity(count){
        if(count<=corridorCopyCapacity&&corridorCopyBuffers.length===12&&corridorCopyBuffers.every(Boolean)&&corridorCopyData)return;
        corridorCopyCapacity=performanceGovernor.capacityFor(count,corridorCopyCapacity,64,1.6);
        corridorCopyData=new Float32Array(corridorCopyCapacity*8);
        for(const b of corridorCopyBuffers)try{b?.destroy?.();}catch(_){}
        corridorCopyBuffers=Array.from({length:12},(_,i)=>device.createBuffer({size:Math.max(32,corridorCopyCapacity*8*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar Corridor variable Graffiti copies ${i}`}));
        corridorCopyBindGroups=new Array(corridorCopyBuffers.length).fill(null);corridorCopyCursor=0;
    }
    function canEncodeCorridor(layer,prepared){return canEncode(layer,prepared)&&warmup()&&Boolean(corridorPipelineOver&&corridorLayout);}
    function encodeCorridorToLayerScene(targetTexture,prepared,layer,baseAlpha,targetCtx,copies,alphas,frameCtx,footprint=1,composite='source-over',override=null){
        if(!targetTexture||baseAlpha<=.001||!Array.isArray(copies)||!copies.length||!canEncodeCorridor(layer,prepared))return{handled:false,commandBuffer:null};
        try{
            const s=styleParams(layer,override?.width,override?.color),m=targetCtx?.getTransform?.();if(!m)return{handled:false,commandBuffer:null};
            const sharedCopy=WebGPUCorridorCopyStore.acquire(device,hubGeneration,frameCtx,copies,alphas,'graffiti',footprint,layer);let k=0,copyBuffer=null,copyBg=null;
            if(sharedCopy?.buffer){k=sharedCopy.k;copyBuffer=sharedCopy.buffer;copyBg=sharedCorridorCopyBinds.get(copyBuffer);if(!copyBg){copyBg=device.createBindGroup({layout:corridorLayout,entries:[{binding:0,resource:{buffer:copyBuffer}}]});sharedCorridorCopyBinds.set(copyBuffer,copyBg);}sharedCorridorCopyReuse++;}
            else{ensureCorridorCopyCapacity(copies.length);k=packTunnelEffectCopyRecords(corridorCopyData,copies,alphas,frameCtx,'graffiti',footprint,layer);if(k){const copySlot=corridorCopyCursor++%corridorCopyBuffers.length;copyBuffer=corridorCopyBuffers[copySlot];device.queue.writeBuffer(copyBuffer,0,corridorCopyData.buffer,corridorCopyData.byteOffset,k*8*4);stats.corridorCopyUploadBytes+=k*8*4;copyBg=corridorCopyBindGroups[copySlot];if(!copyBg){copyBg=device.createBindGroup({layout:corridorLayout,entries:[{binding:0,resource:{buffer:copyBuffer}}]});corridorCopyBindGroups[copySlot]=copyBg;}}}
            if(!k)return{handled:true,commandBuffer:null};
            const c=GPUColorCache.rgba(s.color),glow=Math.max(0,(Number(layer?.glow)||0)*getLayerGlowMultiplier(layer)),gi=Math.max(0,((Number.isFinite(Number(layer?.glowIntensity))?Number(layer.glowIntensity):40)/100)*getLayerGlowIntensityMultiplier(layer));
            const sx=Math.hypot(Number(m.a)||0,Number(m.b)||0),sy=Math.hypot(Number(m.c)||0,Number(m.d)||0),screenScale=Math.sqrt(Math.max(1e-8,sx*sy));
            const blurPx=Math.max(0,glow*.55*gi),localBlur=blurPx/screenScale;
            const outerWidth=s.width,coreRatio=1,haloStrength=0;
            diagnostic.stage='corridor cpu-ribbon-mesh';const batch=meshBatch(prepared,s,outerWidth);if(!batch){noteFailure('corridor cpu-ribbon-mesh','ribbon mesh preparation returned empty');return{handled:false,commandBuffer:null};}const total=batch.floats;if(!total)return{handled:true,commandBuffer:null};diagnostic.stage='corridor gpu-vertex-buffer';ensureVertexCapacity(total);
            let floatOffset=0;for(const mesh of batch.meshes){vertexData.set(mesh,floatOffset);floatOffset+=mesh.length;}
            const vb=acquireFrameSafeVertexBuffer(total);if(!vb){noteFailure('corridor gpu-vertex-buffer','frame-safe Corridor Graffiti vertex buffer unavailable');return{handled:false,commandBuffer:null};}diagnostic.stage='corridor gpu-upload';device.queue.writeBuffer(vb,0,vertexData.buffer,0,total*4);stats.uploads++;stats.uploadBytes+=total*4;
            diagnostic.stage='corridor gpu-command-encode';const enc=device.createCommandEncoder({label:'SpiroStar Corridor analytic Graffiti Glow -> Layer Scene'}),pass=enc.beginRenderPass({colorAttachments:[{view:sceneView(targetTexture),loadOp:'load',storeOp:'store'}]});
            pass.setPipeline(composite==='destination-over'?corridorPipelineBehind:corridorPipelineOver);pass.setBindGroup(1,copyBg);pass.setVertexBuffer(0,vb);
            const a=Math.max(0,Math.min(1,Number(baseAlpha)||0)),bg=makeUniformBindGroup(m,c,a,coreRatio,haloStrength);if(!bg){pass.end();return{handled:false,commandBuffer:null};}
            pass.setBindGroup(0,bg);pass.draw(batch.vertices,k,0,0);stats.draws++;stats.vertices+=batch.vertices;stats.corridorDraws++;stats.corridorLogicalVertices+=batch.vertices*k;if(haloStrength>0){stats.glowPasses++;stats.glowVertices+=batch.vertices*k;stats.glowFrames++;}
            pass.end();stats.frames++;stats.corridorFrames++;stats.corridorCopies+=k;noteSuccess('corridor encode/draw','webgpu-layer-scene','deferred GPU texture');return{handled:true,commandBuffer:enc.finish()};
        }catch(err){stats.failures++;noteFailure(diagnostic.stage||'corridor encode/draw',err?.message||err,err,{target:'layer-scene'});return{handled:false,commandBuffer:null};}
    }
    function encodeCorridorGlowToLayerScene(targetTexture,prepared,layer,targetCtx,copies,alphas,frameCtx,footprint=1,opts={}){
        const radiusPx=Math.max(.5,Number(opts?.radiusPx)||0),alphaScale=Math.max(0,Math.min(1,Number(opts?.alphaScale)||0));
        if(!targetTexture||alphaScale<=.001||!Array.isArray(copies)||!copies.length||!canEncodeCorridor(layer,prepared)||!WebGPUGraffitiContourGlow.isReady?.())return{handled:false,commandBuffer:null};
        try{
            const s=styleParams(layer,opts?.width,opts?.color),m=targetCtx?.getTransform?.();if(!m)return{handled:false,commandBuffer:null};
            const sharedCopy=WebGPUCorridorCopyStore.acquire(device,hubGeneration,frameCtx,copies,alphas,'graffiti',footprint,layer);let k=0,copyBuffer=null,copyBg=null;
            if(sharedCopy?.buffer){k=sharedCopy.k;copyBuffer=sharedCopy.buffer;copyBg=sharedCorridorCopyBinds.get(copyBuffer);if(!copyBg){copyBg=device.createBindGroup({layout:corridorLayout,entries:[{binding:0,resource:{buffer:copyBuffer}}]});sharedCorridorCopyBinds.set(copyBuffer,copyBg);}sharedCorridorCopyReuse++;}
            else{ensureCorridorCopyCapacity(copies.length);k=packTunnelEffectCopyRecords(corridorCopyData,copies,alphas,frameCtx,'graffiti',footprint,layer);if(k){const copySlot=corridorCopyCursor++%corridorCopyBuffers.length;copyBuffer=corridorCopyBuffers[copySlot];device.queue.writeBuffer(copyBuffer,0,corridorCopyData.buffer,corridorCopyData.byteOffset,k*8*4);stats.corridorCopyUploadBytes+=k*8*4;copyBg=corridorCopyBindGroups[copySlot];if(!copyBg){copyBg=device.createBindGroup({layout:corridorLayout,entries:[{binding:0,resource:{buffer:copyBuffer}}]});corridorCopyBindGroups[copySlot]=copyBg;}}}
            if(!k)return{handled:true,commandBuffer:null};
            diagnostic.stage='corridor contour-glow cpu-ribbon-mesh';const batch=meshBatch(prepared,s,s.width);if(!batch){noteFailure(diagnostic.stage,'ribbon contour mask preparation returned empty');return{handled:false,commandBuffer:null};}const total=batch.floats;if(!total)return{handled:true,commandBuffer:null};ensureVertexCapacity(total);
            let floatOffset=0;for(const mesh of batch.meshes){vertexData.set(mesh,floatOffset);floatOffset+=mesh.length;}const vb=acquireFrameSafeVertexBuffer(total);if(!vb){noteFailure('corridor contour-glow gpu-vertex-buffer','frame-safe Corridor Graffiti Glow vertex buffer unavailable');return{handled:false,commandBuffer:null};}device.queue.writeBuffer(vb,0,vertexData.buffer,0,total*4);stats.uploads++;stats.uploadBytes+=total*4;
            const slot=WebGPUGraffitiContourGlow.acquire(mainCanvas.width,mainCanvas.height);if(!slot){noteFailure('corridor contour-glow acquire','GPU contour Glow scratch textures unavailable');return{handled:false,commandBuffer:null};}
            const enc=device.createCommandEncoder({label:'Somata Corridor Graffiti exact ribbon contour Glow'}),pass=enc.beginRenderPass({colorAttachments:[{view:slot.mask.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});pass.setPipeline(corridorPipelineOver);pass.setBindGroup(1,copyBg);pass.setVertexBuffer(0,vb);
            const bg=makeUniformBindGroup(m,[1,1,1,1],1,1,0);if(!bg){pass.end();return{handled:false,commandBuffer:null};}pass.setBindGroup(0,bg);pass.draw(batch.vertices,k,0,0);pass.end();
            const color=GPUColorCache.rgba(s.color);if(!WebGPUGraffitiContourGlow.encodeBlurComposite(enc,slot,targetTexture,{radiusPx,alphaScale,color,composite:opts?.composite||'source-over'})){noteFailure('corridor contour-glow blur','GPU contour blur/composite encode failed');return{handled:false,commandBuffer:null};}
            stats.contourGlowFrames++;stats.contourGlowMasks++;stats.glowFrames++;stats.glowPasses++;stats.glowVertices+=batch.vertices*k;noteSuccess('corridor contour-glow encode/draw','webgpu-layer-scene','deferred GPU texture');return{handled:true,commandBuffer:enc.finish()};
        }catch(err){stats.failures++;noteFailure(diagnostic.stage||'corridor contour-glow encode',err?.message||err,err,{target:'layer-scene'});return{handled:false,commandBuffer:null};}
    }

    function configureOverlay(width,height){
        if(!warmup()||!overlayCanvas)return false;
        try{
            if(!overlayContext)overlayContext=overlayCanvas.getContext('webgpu');
            if(!overlayContext)throw new Error('WebGPU Graffiti overlay context unavailable');
            const w=Math.max(1,Math.round(Number(width)||mainCanvas.width||1)),h=Math.max(1,Math.round(Number(height)||mainCanvas.height||1));
            if(overlayCanvas.width!==w)overlayCanvas.width=w;if(overlayCanvas.height!==h)overlayCanvas.height=h;
            if(overlayConfiguredGeneration!==hubGeneration){overlayContext.configure({device,format,alphaMode:'premultiplied'});overlayConfiguredGeneration=hubGeneration;}
            return true;
        }catch(err){noteFailure('overlay/configure',err?.message||err,err);return false;}
    }
    function beginOverlayFrame(frameId,width,height,active){
        overlayFrameId=Math.max(0,Number(frameId)||0);overlayClearedFrame=-1;overlayUsedFrame=-1;overlayCurrentTexture=null;
        if(overlayCanvas)overlayCanvas.style.display='none';
        if(!active)return false;
        return configureOverlay(width,height);
    }
    function clearOverlayForFrame(){
        if(overlayClearedFrame===overlayFrameId)return true;
        if(!configureOverlay(mainCanvas.width,mainCanvas.height))return false;
        try{const tex=overlayCurrentTexture=overlayContext.getCurrentTexture(),enc=device.createCommandEncoder({label:'SpiroStar GPU Graffiti overlay clear'}),pass=enc.beginRenderPass({colorAttachments:[{view:tex.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});pass.end();device.queue.submit([enc.finish()]);overlayClearedFrame=overlayFrameId;overlayFrames++;return true;}catch(err){noteFailure('overlay/clear',err?.message||err,err);return false;}
    }
    function drawToOverlay(prepared,layer,alpha,targetCtx,composite='source-over',override=null){
        if(!clearOverlayForFrame())return{handled:false,commandBuffer:null};
        try{const tex=overlayCurrentTexture||overlayContext.getCurrentTexture(),rec=encodeToLayerScene(tex,prepared,layer,alpha,targetCtx,composite,override);if(rec?.handled){if(rec.commandBuffer)device.queue.submit([rec.commandBuffer]);overlayUsedFrame=overlayFrameId;overlayDraws++;if(overlayCanvas)overlayCanvas.style.display='block';noteSuccess('overlay/draw','webgpu-overlay','WebGPU canvas');}return rec;}catch(err){noteFailure('overlay/draw',err?.message||err,err);return{handled:false,commandBuffer:null};}
    }
    function drawCorridorToOverlay(prepared,layer,baseAlpha,targetCtx,copies,alphas,frameCtx,footprint=1,composite='source-over',override=null){
        if(!clearOverlayForFrame())return{handled:false,commandBuffer:null};
        try{const tex=overlayCurrentTexture||overlayContext.getCurrentTexture(),rec=encodeCorridorToLayerScene(tex,prepared,layer,baseAlpha,targetCtx,copies,alphas,frameCtx,footprint,composite,override);if(rec?.handled){if(rec.commandBuffer)device.queue.submit([rec.commandBuffer]);overlayUsedFrame=overlayFrameId;overlayDraws++;if(overlayCanvas)overlayCanvas.style.display='block';noteSuccess('corridor overlay/draw','webgpu-overlay','WebGPU canvas');}return rec;}catch(err){noteFailure('corridor overlay/draw',err?.message||err,err);return{handled:false,commandBuffer:null};}
    }
    function drawGlowToOverlay(prepared,layer,maskAlpha,targetCtx,opts={}){
        if(!clearOverlayForFrame())return{handled:false,commandBuffer:null};
        try{const tex=overlayCurrentTexture||overlayContext.getCurrentTexture(),rec=encodeGlowToLayerScene(tex,prepared,layer,maskAlpha,targetCtx,opts);if(rec?.handled){if(rec.commandBuffer)device.queue.submit([rec.commandBuffer]);overlayUsedFrame=overlayFrameId;overlayDraws++;if(overlayCanvas)overlayCanvas.style.display='block';noteSuccess('contour-glow overlay/draw','webgpu-overlay','WebGPU canvas');}return rec;}catch(err){noteFailure('contour-glow overlay/draw',err?.message||err,err);return{handled:false,commandBuffer:null};}
    }
    function drawCorridorGlowToOverlay(prepared,layer,targetCtx,copies,alphas,frameCtx,footprint=1,opts={}){
        if(!clearOverlayForFrame())return{handled:false,commandBuffer:null};
        try{const tex=overlayCurrentTexture||overlayContext.getCurrentTexture(),rec=encodeCorridorGlowToLayerScene(tex,prepared,layer,targetCtx,copies,alphas,frameCtx,footprint,opts);if(rec?.handled){if(rec.commandBuffer)device.queue.submit([rec.commandBuffer]);overlayUsedFrame=overlayFrameId;overlayDraws++;if(overlayCanvas)overlayCanvas.style.display='block';noteSuccess('corridor contour-glow overlay/draw','webgpu-overlay','WebGPU canvas');}return rec;}catch(err){noteFailure('corridor contour-glow overlay/draw',err?.message||err,err);return{handled:false,commandBuffer:null};}
    }

    // Effects rendered after Graffiti (Glint/Lightning) must target this exact overlay texture
    // when the Graffiti core itself had to use the WebGPU overlay. Drawing them to mainCanvas
    // would put them physically underneath the overlay despite a later logical render pass.
    function getActiveOverlayTarget(frameId=overlayFrameId){
        const fid=Math.max(0,Number(frameId)||0);if(!warmup()||fid!==overlayFrameId||overlayUsedFrame!==fid||!overlayContext||!overlayCurrentTexture)return null;
        return{texture:overlayCurrentTexture,frameId:fid};
    }
    function submitOverlayEffect(rec,label='post-graffiti-effect'){
        if(!rec?.handled)return false;
        try{if(rec.commandBuffer)device.queue.submit([rec.commandBuffer]);rec.onSubmitted?.();overlayUsedFrame=overlayFrameId;overlayDraws++;if(overlayCanvas)overlayCanvas.style.display='block';noteSuccess(`overlay/${label}`,'webgpu-overlay','WebGPU canvas');return true;}
        catch(err){noteFailure(`overlay/${label}`,err?.message||err,err);return false;}
    }
    function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost,lastError,diagnostic:{...diagnostic},geometryPreparation:'CPU ribbon mesh; WebGPU rasterization',...stats,vertexResidency:{slots:vertexSlots.length,slotGrows:vertexSlotGrows,capacityFloats:vertexCapacity,policy:'no same-frame vertex-buffer reuse before deferred queue.submit'},sharedCorridorCopyReuse,overlay:{active:overlayCanvas?.style?.display!=='none',frames:overlayFrames,draws:overlayDraws,frameId:overlayUsedFrame},policy:'GPU-only Graffiti: deferred Layer Scene first, transparent WebGPU overlay fallback; no Canvas2D Graffiti fallback',contourGlow:WebGPUGraffitiContourGlow.status?.()||null,meshCache:{...graffitiVariableRibbonMeshCacheStats}};}
    return{warmup,isReady:()=>warmup(),canEncode,canEncodeCorridor,encodeToLayerScene,encodeCorridorToLayerScene,encodeGlowToLayerScene,encodeCorridorGlowToLayerScene,beginOverlayFrame,drawToOverlay,drawCorridorToOverlay,drawGlowToOverlay,drawCorridorGlowToOverlay,getActiveOverlayTarget,submitOverlayEffect,status};
})();
window.__spiroGraffitiRibbonGPUStatus=()=>WebGPUGraffitiRibbonRenderer.status();
// 7.0.4 — start FullGPU Graffiti pipeline compilation during application boot so the
// first authored Graffiti frame does not discover the pipeline lazily inside the render loop.
// This is prewarm only: no Canvas/WebGL/Fast-GPU renderer is selected if initialization fails.
try{queueMicrotask(()=>{try{if(typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed()){WebGPUGraffitiContourGlow.warmup();WebGPUGraffitiRibbonRenderer.warmup();}}catch(_){}});}catch(_){}
