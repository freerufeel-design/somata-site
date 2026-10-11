// SpiroStar v517 — extracted compatibility Web Threads scene backend.
// Owns the legacy CPU-command WebGPU renderer only; GPU-native Morph Web lives separately.
window.__spiroRegisterModule?.('js/gpu/web-thread-scene-renderer');

const WebGPUWebThreadSceneRenderer = (() => {
            const FLOATS_PER_SEGMENT=10,CORRIDOR_FLOATS_PER_SEGMENT=12,CORRIDOR_SEGMENT_LIMIT_BASE=48,WEB_SEGMENT_LIMIT_BASE=64;
            const webThreadCorridorSegmentLimit=()=>CORRIDOR_SEGMENT_LIMIT_BASE*Math.max(1,(performanceGovernor.residencyScale?.()||1));
            const webThreadSegmentLimit=()=>WEB_SEGMENT_LIMIT_BASE*Math.max(1,(performanceGovernor.residencyScale?.()||1));
            let device=null,format=null,ready=false,attempted=false,initializing=false,lost=false,lastError='',hubGeneration=0;
            let width=0,height=0,cornerBuffer=null,threadTexture=null,threadTextureView=null,threadMsaaTexture=null,threadMsaaView=null,stencilTexture=null,stencilTextureView=null,compositeScratchBindGroup=null,targetViews=new WeakMap();
            let segmentCapacity=0,segmentData=null,segmentBuffers=[null,null,null],segmentCursor=0,webStaticSegments=new Map();
            let webStaticBuilds=0,webStaticHits=0,webStaticUploads=0,webStaticEvictions=0;
            let maskCapacity=0,maskBuffers=[null,null,null],maskCursor=0,maskRecords=new WeakMap(),maskRecordSet=new Set(),maskResidentBuilds=0,maskUploadSkips=0,maskUploadBytesAvoided=0;
            let maskPipeline=null,haloPipeline=null,corePipeline=null,compositePipeline=null;
            let corridorMaskPipeline=null,corridorHaloPipeline=null,corridorCorePipeline=null,corridorSegmentLayout=null,corridorCopyLayout=null;
            let corridorDynamicCapacity=0,corridorDynamicData=null,corridorDynamicBuffers=[null,null,null],corridorDynamicBinds=[null,null,null],corridorDynamicCursor=0;
            let corridorCopyCapacity=0,corridorCopyData=null,corridorCopyBuffers=[null,null,null],corridorCopyBinds=[null,null,null],corridorCopyCursor=0;
            let corridorStaticSegments=new Map(),corridorUniformData=new Float32Array(8);
            let frames=0,clippedFrames=0,openFrames=0,maskTriangles=0,segmentUploads=0,maskUploads=0,compositePasses=0,failures=0;
            let corridorFrames=0,corridorCopies=0,corridorLogicalSegments=0,corridorMaskTriangles=0,corridorCopyUploads=0,corridorDynamicUploads=0,corridorStaticUploads=0,corridorStaticBuilds=0,corridorStaticHits=0,corridorStaticEvictions=0;
            function safeDestroy(res){if(!res)return;try{res.destroy?.();}catch(err){if(!lastError)lastError=String(err?.message||err);}}
            const THREAD_WGSL=`
struct U { viewport:vec2<f32>, origin:vec2<f32>, params:vec4<f32>, };
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<storage,read> corridorSegData:array<vec4<f32>>;
@group(2) @binding(0) var<storage,read> corridorCopyData:array<vec4<f32>>;
struct Vin{
    @location(0) corner:vec2<f32>,
    @location(1) start:vec2<f32>,
    @location(2) end:vec2<f32>,
    @location(3) halfWidth:f32,
    @location(4) haloRadius:f32,
    @location(5) color:vec4<f32>,
};
struct Vout{
    @builtin(position) p:vec4<f32>,
    @location(0) local:vec2<f32>,
    @location(1) @interpolate(flat) segLen:f32,
    @location(2) @interpolate(flat) halfWidth:f32,
    @location(3) @interpolate(flat) haloRadius:f32,
    @location(4) @interpolate(flat) color:vec4<f32>,
};
@vertex fn vs(v:Vin)->Vout{
    var o:Vout;let d=v.end-v.start;let len=max(length(d),0.0001);let dir=d/len;let n=vec2<f32>(-dir.y,dir.x);
    let halo=max(0.1,u.params.z);let pad=v.halfWidth+halo+2.5;let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let q=v.start+dir*lx+n*ly;
    o.p=vec4<f32>(q.x/u.viewport.x*2.0-1.0,1.0-q.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidth=v.halfWidth;o.haloRadius=halo;o.color=vec4<f32>(v.color.rgb,clamp(v.color.a*u.params.y,0.0,1.0));return o;
}
fn corridorPoint(p:vec2<f32>,c0:vec4<f32>,c1:vec4<f32>)->vec2<f32>{
    let q=p-u.origin;return u.origin+vec2<f32>(c0.x*q.x+c0.y*q.y,c1.x*q.x+c1.y*q.y);
}
struct CorridorVin{ @location(0) corner:vec2<f32>, };
@vertex fn vsCorridor(v:CorridorVin,@builtin(instance_index) iid:u32)->Vout{
    var o:Vout;let segCount=max(1u,u32(u.params.x+0.5));let si=iid%segCount;let ci=iid/segCount;
    let s0=corridorSegData[si*3u];let s1=corridorSegData[si*3u+1u];let s2=corridorSegData[si*3u+2u];
    let c0=corridorCopyData[ci*2u];let c1=corridorCopyData[ci*2u+1u];
    let start=corridorPoint(s0.xy,c0,c1);let end=corridorPoint(s0.zw,c0,c1);let d=end-start;let len=max(length(d),0.0001);let dir=d/len;let n=vec2<f32>(-dir.y,dir.x);
    let sc=max(0.000001,abs(c1.z));let hw=max(0.001,s1.x*sc);let halo=max(0.1,u.params.z);let pad=hw+halo+2.5;let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let q=start+dir*lx+n*ly;
    let alpha=clamp(s1.y*c0.z*u.params.y,0.0,1.0);o.p=vec4<f32>(q.x/u.viewport.x*2.0-1.0,1.0-q.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidth=hw;o.haloRadius=halo;o.color=vec4<f32>(s1.z,s1.w,s2.x,alpha);return o;
}
fn distanceToSegment(v:Vout)->f32{let cx=clamp(v.local.x,0.0,v.segLen);return length(vec2<f32>(v.local.x-cx,v.local.y));}
@fragment fn fsHalo(v:Vout)->@location(0) vec4<f32>{
    let d=distanceToSegment(v);let r=max(0.001,v.haloRadius);let e=max(0.0,d-v.halfWidth);let q=e/r;
    let cov=exp(-3.15*q*q)*(1.0-smoothstep(0.82,1.04,q))*smoothstep(0.0,min(1.0,r*0.55),e);let a=clamp(v.color.a*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(v.color.rgb*a,a);
}
@fragment fn fsCore(v:Vout)->@location(0) vec4<f32>{
    let d=distanceToSegment(v);let center=min(1.0,2.0*v.halfWidth);let cov=min(center,clamp(v.halfWidth+0.5-d,0.0,1.0));let a=clamp(v.color.a*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(v.color.rgb*a,a);
}`;
            const MASK_WGSL=`
struct U { viewport:vec2<f32>, origin:vec2<f32>, params:vec4<f32>, };
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<storage,read> copyData:array<vec4<f32>>;
struct Vin{@location(0) p:vec2<f32>};struct Vout{@builtin(position) p:vec4<f32>};
@vertex fn vs(v:Vin)->Vout{var o:Vout;o.p=vec4<f32>(v.p.x/u.viewport.x*2.0-1.0,1.0-v.p.y/u.viewport.y*2.0,0.0,1.0);return o;}
@vertex fn vsCorridor(v:Vin,@builtin(instance_index) iid:u32)->Vout{let c0=copyData[iid*2u];let c1=copyData[iid*2u+1u];let q=v.p-u.origin;let p=u.origin+vec2<f32>(c0.x*q.x+c0.y*q.y,c1.x*q.x+c1.y*q.y);var o:Vout;o.p=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);return o;}
@fragment fn fs()->@location(0) vec4<f32>{return vec4<f32>(0.0);}`;
            const COMPOSITE_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;struct V{@builtin(position) p:vec4<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);return o;}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let d=textureDimensions(srcTex);let x=clamp(i32(p.x),0,i32(d.x)-1);let y=clamp(i32(p.y),0,i32(d.y)-1);return textureLoad(srcTex,vec2<i32>(x,y),0);}`;
            let uniformBuffer=null,uniformBind=null,uniformLayout=null,corridorUniformRecords=new WeakMap(),corridorUniformRecordSet=new Set(),corridorUniformBuilds=0,corridorUniformUploads=0,corridorUniformUploadSkips=0;
            let webUniformRecords=new WeakMap(),webUniformRecordSet=new Set(),webUniformBuilds=0,webUniformUploads=0,webUniformUploadSkips=0;
            const webUniformData=new Float32Array(8);
            function destroySizeResources(){safeDestroy(threadTexture);safeDestroy(threadMsaaTexture);safeDestroy(stencilTexture);threadTexture=threadMsaaTexture=stencilTexture=null;threadTextureView=threadMsaaView=stencilTextureView=compositeScratchBindGroup=null;width=height=0;}
            function destroyBuffers(){
                for(const b of segmentBuffers)safeDestroy(b);for(const b of maskBuffers)safeDestroy(b);for(const b of corridorDynamicBuffers)safeDestroy(b);for(const b of corridorCopyBuffers)safeDestroy(b);for(const rec of corridorStaticSegments.values())safeDestroy(rec?.buffer);for(const rec of webStaticSegments.values())safeDestroy(rec?.buffer);
                for(const rec of corridorUniformRecordSet)safeDestroy(rec?.buffer);corridorUniformRecordSet.clear();corridorUniformRecords=new WeakMap();
                for(const rec of webUniformRecordSet)safeDestroy(rec?.buffer);webUniformRecordSet.clear();webUniformRecords=new WeakMap();
                for(const rec of maskRecordSet)safeDestroy(rec?.buffer);maskRecordSet.clear();maskRecords=new WeakMap();
                segmentBuffers=[null,null,null];maskBuffers=[null,null,null];corridorDynamicBuffers=[null,null,null];corridorDynamicBinds=[null,null,null];corridorCopyBuffers=[null,null,null];corridorCopyBinds=[null,null,null];corridorStaticSegments=new Map();webStaticSegments=new Map();targetViews=new WeakMap();segmentCapacity=maskCapacity=corridorDynamicCapacity=corridorCopyCapacity=0;segmentData=corridorDynamicData=corridorCopyData=null;
            }
            async function initAsync(){
                if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready)return false;attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();device=shared.device;hubGeneration=shared.generation;lost=false;format=navigator.gpu.getPreferredCanvasFormat();
                    const tm=device.createShaderModule({label:'SpiroStar Web Threads scene WGSL',code:THREAD_WGSL});await assertWebGPUShaderModule(tm,'SpiroStar Web Threads scene WGSL');
                    const mm=device.createShaderModule({label:'SpiroStar Web Threads stencil WGSL',code:MASK_WGSL});await assertWebGPUShaderModule(mm,'SpiroStar Web Threads stencil WGSL');
                    const cm=device.createShaderModule({label:'SpiroStar Web Threads composite WGSL',code:COMPOSITE_WGSL});await assertWebGPUShaderModule(cm,'SpiroStar Web Threads composite WGSL');
                    uniformBuffer=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar Web Threads viewport/corridor uniforms'});
                    uniformLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]});
                    corridorSegmentLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
                    corridorCopyLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
                    uniformBind=device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer:uniformBuffer}}]});
                    const stencilFace={compare:'equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'};
                    const threadLayout=device.createPipelineLayout({bindGroupLayouts:[uniformLayout]}),corridorThreadLayout=device.createPipelineLayout({bindGroupLayouts:[uniformLayout,corridorSegmentLayout,corridorCopyLayout]});
                    const threadBuffers=[
                        {arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},
                        {arrayStride:FLOATS_PER_SEGMENT*4,stepMode:'instance',attributes:[
                            {shaderLocation:1,offset:0,format:'float32x2'},{shaderLocation:2,offset:8,format:'float32x2'},
                            {shaderLocation:3,offset:16,format:'float32'},{shaderLocation:4,offset:20,format:'float32'},
                            {shaderLocation:5,offset:24,format:'float32x4'}
                        ]}
                    ];
                    const maxBlend={color:{srcFactor:'one',dstFactor:'one',operation:'max'},alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}};
                    const target=[{format,blend:maxBlend}],depthStencil={format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',stencilFront:stencilFace,stencilBack:stencilFace,stencilReadMask:1,stencilWriteMask:0};
                    const makeThread=(entry,label)=>device.createRenderPipeline({label,layout:threadLayout,vertex:{module:tm,entryPoint:'vs',buffers:threadBuffers},fragment:{module:tm,entryPoint:entry,targets:target},primitive:{topology:'triangle-strip',cullMode:'none'},multisample:{count:4},depthStencil});
                    const makeCorridorThread=(entry,label)=>device.createRenderPipeline({label,layout:corridorThreadLayout,vertex:{module:tm,entryPoint:'vsCorridor',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:tm,entryPoint:entry,targets:target},primitive:{topology:'triangle-strip',cullMode:'none'},multisample:{count:4},depthStencil});
                    haloPipeline=makeThread('fsHalo','SpiroStar Web Threads halo → scratch');corePipeline=makeThread('fsCore','SpiroStar Web Threads core → scratch');
                    corridorHaloPipeline=makeCorridorThread('fsHalo','SpiroStar Corridor Web Threads halo → scratch');corridorCorePipeline=makeCorridorThread('fsCore','SpiroStar Corridor Web Threads core → scratch');
                    const maskLayout=device.createPipelineLayout({bindGroupLayouts:[uniformLayout]}),corridorMaskLayout=device.createPipelineLayout({bindGroupLayouts:[uniformLayout,corridorCopyLayout]});const invertFace={compare:'always',failOp:'keep',depthFailOp:'keep',passOp:'invert'};
                    const maskTarget=[{format,writeMask:0}],maskDepth={format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',stencilFront:invertFace,stencilBack:invertFace,stencilReadMask:1,stencilWriteMask:1},maskVertex=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];
                    maskPipeline=device.createRenderPipeline({label:'SpiroStar Web Threads even-odd stencil',layout:maskLayout,vertex:{module:mm,entryPoint:'vs',buffers:maskVertex},fragment:{module:mm,entryPoint:'fs',targets:maskTarget},primitive:{topology:'triangle-list',cullMode:'none'},multisample:{count:4},depthStencil:maskDepth});
                    corridorMaskPipeline=device.createRenderPipeline({label:'SpiroStar Corridor Web Threads even-odd stencil',layout:corridorMaskLayout,vertex:{module:mm,entryPoint:'vsCorridor',buffers:maskVertex},fragment:{module:mm,entryPoint:'fs',targets:maskTarget},primitive:{topology:'triangle-list',cullMode:'none'},multisample:{count:4},depthStencil:maskDepth});
                    const overBlend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
                    compositePipeline=device.createRenderPipeline({label:'SpiroStar Web Threads scratch → Layer Scene',layout:'auto',vertex:{module:cm,entryPoint:'vs'},fragment:{module:cm,entryPoint:'fs',targets:[{format,blend:overBlend}]},primitive:{topology:'triangle-list'}});
                    cornerBuffer=device.createBuffer({size:8*4,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:'SpiroStar Web Threads corners'});device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,1,1]));
                    ready=true;initializing=false;requestMainCanvasRender();return true;
                }catch(err){ready=false;initializing=false;lastError=String(err?.message||err);return false;}
            }
            function warmup(){const hub=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();if(ready&&(!hub||gen!==hubGeneration)){ready=false;attempted=false;initializing=false;lost=!hub;destroySizeResources();destroyBuffers();safeDestroy(uniformBuffer);safeDestroy(cornerBuffer);uniformBuffer=cornerBuffer=null;uniformBind=null;corridorSegmentLayout=corridorCopyLayout=null;}if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hub;}
            function ensureSize(w,h){w=Math.max(1,w|0);h=Math.max(1,h|0);if(width===w&&height===h&&threadTexture&&threadMsaaTexture&&stencilTexture)return true;destroySizeResources();width=w;height=h;threadTexture=device.createTexture({label:'SpiroStar Web Threads resolved scratch',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});threadTextureView=threadTexture.createView();threadMsaaTexture=device.createTexture({label:'SpiroStar Web Threads 4x MSAA scratch',size:[w,h,1],sampleCount:4,format,usage:GPUTextureUsage.RENDER_ATTACHMENT});threadMsaaView=threadMsaaTexture.createView();stencilTexture=device.createTexture({label:'SpiroStar Web Threads 4x parity stencil',size:[w,h,1],sampleCount:4,format:'depth24plus-stencil8',usage:GPUTextureUsage.RENDER_ATTACHMENT});stencilTextureView=stencilTexture.createView();compositeScratchBindGroup=device.createBindGroup({layout:compositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:threadTextureView}]});device.queue.writeBuffer(uniformBuffer,0,new Float32Array([w,h,0,0,0,0,0,0]));return true;}
            function ensureSegments(count){const desired=performanceGovernor.stickyRingCount(3,segmentBuffers.length),grow=count>segmentCapacity||!segmentData||segmentBuffers.some(x=>!x);if(grow){segmentCapacity=performanceGovernor.capacityFor(count,segmentCapacity,256,1.6);segmentData=new Float32Array(segmentCapacity*FLOATS_PER_SEGMENT);for(const b of segmentBuffers)safeDestroy(b);segmentBuffers=[];}while(segmentBuffers.length<desired)segmentBuffers.push(device.createBuffer({size:segmentCapacity*FLOATS_PER_SEGMENT*4,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:`SpiroStar Web Threads segments ${segmentBuffers.length}`}));}
            function ensureMask(vertexCount){const desired=performanceGovernor.stickyRingCount(3,maskBuffers.length),grow=vertexCount>maskCapacity||maskBuffers.some(x=>!x);if(grow){maskCapacity=performanceGovernor.capacityFor(vertexCount,maskCapacity,384,1.6);for(const b of maskBuffers)safeDestroy(b);maskBuffers=[];}while(maskBuffers.length<desired)maskBuffers.push(device.createBuffer({size:maskCapacity*2*4,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:`SpiroStar Web Threads mask vertices ${maskBuffers.length}`}));}
            function countSegments(commands){return GeometryKernel.inspectStrokeCommands(commands).count;}
            function packSegments(commands,target=segmentData){
                let k=0,lastCmd=null,rgba=null,a=0,hw=.5;
                for(const seg of GeometryKernel.strokeSegments(commands,'webThreadPack')){
                    const cmd=seg.command;if(cmd!==lastCmd){rgba=GPUColorCache.rgba(cmd?.strokeStyle||'#ffffff');a=Math.max(0,Math.min(1,(Number(cmd?.alpha)||0)*rgba[3]));hw=Math.max(.001,(Number(cmd?.screenLineWidth)||1)*.5);lastCmd=cmd;}
                    if(a<=.0001)continue;const o=k*FLOATS_PER_SEGMENT;target[o]=seg.ax;target[o+1]=seg.ay;target[o+2]=seg.bx;target[o+3]=seg.by;target[o+4]=hw;target[o+5]=0.1;target[o+6]=rgba[0];target[o+7]=rgba[1];target[o+8]=rgba[2];target[o+9]=a;k++;
                }return k;
            }
            function touchWebStatic(commands,rec){webStaticSegments.delete(commands);webStaticSegments.set(commands,rec);return rec;}
            function getWebSegmentRecord(commands){
                const need=countSegments(commands);if(!need)return{buffer:null,k:0,stable:false};
                if(commands?.__spiroWebStable===true){let rec=webStaticSegments.get(commands);if(rec&&rec.generation===hubGeneration&&rec.buffer){webStaticHits++;return touchWebStatic(commands,rec);}const cpu=new Float32Array(need*FLOATS_PER_SEGMENT),k=packSegments(commands,cpu);if(!k)return{buffer:null,k:0,stable:true};const bytes=k*FLOATS_PER_SEGMENT*4,buffer=device.createBuffer({size:Math.max(40,bytes),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:'SpiroStar resident Web Threads segments'});device.queue.writeBuffer(buffer,0,cpu.buffer,cpu.byteOffset,bytes);webStaticUploads+=bytes;webStaticBuilds++;rec={buffer,k,generation:hubGeneration};touchWebStatic(commands,rec);while(webStaticSegments.size>webThreadSegmentLimit()){const key=webStaticSegments.keys().next().value,old=webStaticSegments.get(key);safeDestroy(old?.buffer);webStaticSegments.delete(key);webStaticEvictions++;}return rec;}
                ensureSegments(need);const k=packSegments(commands,segmentData);if(!k)return{buffer:null,k:0,stable:false};const segSlot=segmentCursor++%segmentBuffers.length,buffer=segmentBuffers[segSlot],bytes=k*FLOATS_PER_SEGMENT*4;device.queue.writeBuffer(buffer,0,segmentData.buffer,segmentData.byteOffset,bytes);segmentUploads+=bytes;return{buffer,k,stable:false};
            }
            function packCorridorSegments(commands,target){
                let k=0,lastCmd=null,rgba=null,a=0,hw=.5;
                for(const seg of GeometryKernel.strokeSegments(commands,'webThreadCorridorPack')){
                    const cmd=seg.command;if(cmd!==lastCmd){rgba=GPUColorCache.rgba(cmd?.strokeStyle||'#ffffff');a=Math.max(0,Math.min(1,(Number(cmd?.alpha)||0)*rgba[3]));hw=Math.max(.001,(Number(cmd?.screenLineWidth)||1)*.5);lastCmd=cmd;}
                    if(a<=.0001)continue;const o=k*CORRIDOR_FLOATS_PER_SEGMENT;target[o]=seg.ax;target[o+1]=seg.ay;target[o+2]=seg.bx;target[o+3]=seg.by;target[o+4]=hw;target[o+5]=a;target[o+6]=rgba[0];target[o+7]=rgba[1];target[o+8]=rgba[2];target[o+9]=target[o+10]=target[o+11]=0;k++;
                }return k;
            }
            function touchStatic(commands,rec){corridorStaticSegments.delete(commands);corridorStaticSegments.set(commands,rec);return rec;}
            function getCorridorSegmentRecord(commands){
                const need=countSegments(commands);if(!need)return{buffer:null,bindGroup:null,k:0};
                if(commands?.__spiroWebStable===true){let rec=corridorStaticSegments.get(commands);if(rec&&rec.generation===hubGeneration&&rec.buffer){corridorStaticHits++;return touchStatic(commands,rec);}const cpu=new Float32Array(need*CORRIDOR_FLOATS_PER_SEGMENT),k=packCorridorSegments(commands,cpu);if(!k)return{buffer:null,bindGroup:null,k:0};const buffer=device.createBuffer({size:Math.max(48,k*CORRIDOR_FLOATS_PER_SEGMENT*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar static Corridor Web master segments'});device.queue.writeBuffer(buffer,0,cpu.buffer,cpu.byteOffset,k*CORRIDOR_FLOATS_PER_SEGMENT*4);const bindGroup=device.createBindGroup({layout:corridorSegmentLayout,entries:[{binding:0,resource:{buffer}}]});corridorStaticUploads+=k*CORRIDOR_FLOATS_PER_SEGMENT*4;corridorStaticBuilds++;rec={buffer,bindGroup,k,generation:hubGeneration};touchStatic(commands,rec);while(corridorStaticSegments.size>webThreadCorridorSegmentLimit()){const key=corridorStaticSegments.keys().next().value,old=corridorStaticSegments.get(key);safeDestroy(old?.buffer);corridorStaticSegments.delete(key);corridorStaticEvictions++;}return rec;}
                {const desired=performanceGovernor.stickyRingCount(3,corridorDynamicBuffers.length),grow=need>corridorDynamicCapacity||!corridorDynamicData||corridorDynamicBuffers.some(x=>!x);if(grow){corridorDynamicCapacity=performanceGovernor.capacityFor(need,corridorDynamicCapacity,256,1.6);corridorDynamicData=new Float32Array(corridorDynamicCapacity*CORRIDOR_FLOATS_PER_SEGMENT);for(const b of corridorDynamicBuffers)safeDestroy(b);corridorDynamicBuffers=[];corridorDynamicBinds=[];}while(corridorDynamicBuffers.length<desired){const buffer=device.createBuffer({size:corridorDynamicCapacity*CORRIDOR_FLOATS_PER_SEGMENT*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar dynamic Corridor Web master ${corridorDynamicBuffers.length}`});corridorDynamicBuffers.push(buffer);corridorDynamicBinds.push(device.createBindGroup({layout:corridorSegmentLayout,entries:[{binding:0,resource:{buffer}}]}));}}
                const k=packCorridorSegments(commands,corridorDynamicData);if(!k)return{buffer:null,bindGroup:null,k:0};const slot=corridorDynamicCursor++%corridorDynamicBuffers.length,buffer=corridorDynamicBuffers[slot];device.queue.writeBuffer(buffer,0,corridorDynamicData.buffer,corridorDynamicData.byteOffset,k*CORRIDOR_FLOATS_PER_SEGMENT*4);corridorDynamicUploads+=k*CORRIDOR_FLOATS_PER_SEGMENT*4;return{buffer,bindGroup:corridorDynamicBinds[slot],k};
            }
            function ensureCorridorCopyCapacity(count){const desired=performanceGovernor.stickyRingCount(3,corridorCopyBuffers.length),grow=count>corridorCopyCapacity||!corridorCopyData||corridorCopyBuffers.some(x=>!x);if(grow){corridorCopyCapacity=performanceGovernor.capacityFor(count,corridorCopyCapacity,64,1.6);corridorCopyData=new Float32Array(corridorCopyCapacity*8);for(const b of corridorCopyBuffers)safeDestroy(b);corridorCopyBuffers=[];corridorCopyBinds=[];}while(corridorCopyBuffers.length<desired){const buffer=device.createBuffer({size:corridorCopyCapacity*8*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar Corridor Web copies ${corridorCopyBuffers.length}`});corridorCopyBuffers.push(buffer);corridorCopyBinds.push(device.createBindGroup({layout:corridorCopyLayout,entries:[{binding:0,resource:{buffer}}]}));}}
            const sharedCorridorCopyBinds=new WeakMap();let sharedCorridorCopyReuse=0;
            function prepareCorridorCopies(copies,alphas,frameCtx,footprint){const shared=WebGPUCorridorCopyStore.acquire(device,hubGeneration,frameCtx,copies,alphas,'web',footprint,frameCtx?.layer);if(shared?.buffer){let bg=sharedCorridorCopyBinds.get(shared.buffer);if(!bg){bg=device.createBindGroup({layout:corridorCopyLayout,entries:[{binding:0,resource:{buffer:shared.buffer}}]});sharedCorridorCopyBinds.set(shared.buffer,bg);}sharedCorridorCopyReuse++;return{buffer:shared.buffer,bindGroup:bg,k:shared.k};}ensureCorridorCopyCapacity(copies.length);const k=packTunnelEffectCopyRecords(corridorCopyData,copies,alphas,frameCtx,'web',footprint,frameCtx?.layer);if(!k)return{buffer:null,bindGroup:null,k:0};const slot=corridorCopyCursor++%corridorCopyBuffers.length,buffer=corridorCopyBuffers[slot];device.queue.writeBuffer(buffer,0,corridorCopyData.buffer,corridorCopyData.byteOffset,k*8*4);corridorCopyUploads+=k*8*4;return{buffer,bindGroup:corridorCopyBinds[slot],k};}
            function sameF32Prefix(a,b,n){if(!a||!b||b.length<n)return false;for(let i=0;i<n;i++)if(a[i]!==b[i])return false;return true;}
            function maskRecord(frameCtx,floatCount){const key=frameCtx?.layer&&typeof frameCtx.layer==='object'?frameCtx.layer:null;if(!key)return null;let rec=maskRecords.get(key);if(rec&&rec.generation===hubGeneration&&rec.buffer&&rec.capacity>=floatCount)return rec;if(rec?.buffer){maskRecordSet.delete(rec);safeDestroy(rec.buffer);}const capacity=performanceGovernor.capacityFor(floatCount,rec?.capacity||0,768,1.6),buffer=device.createBuffer({size:Math.max(8,capacity*4),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:'SpiroStar resident Web parity mask'});rec={buffer,capacity,snapshot:new Float32Array(capacity),floatCount:0,hasLast:false,generation:hubGeneration};maskRecords.set(key,rec);maskRecordSet.add(rec);maskResidentBuilds++;return rec;}
            function uploadMask(clipGeometry,corridorCopyCount=0,frameCtx=null){const verts=clipGeometry?.vertices instanceof Float32Array?clipGeometry.vertices:null,vertexCount=verts?Math.floor(verts.length/2):0;let maskBuffer=null;if(vertexCount){const floatCount=vertexCount*2,bytes=floatCount*4,rec=maskRecord(frameCtx,floatCount);if(rec){maskBuffer=rec.buffer;const same=rec.hasLast&&rec.floatCount===floatCount&&sameF32Prefix(verts,rec.snapshot,floatCount);if(same){maskUploadSkips++;maskUploadBytesAvoided+=bytes;}else{device.queue.writeBuffer(maskBuffer,0,verts.buffer,verts.byteOffset,bytes);rec.snapshot.set(verts.subarray(0,floatCount),0);rec.floatCount=floatCount;rec.hasLast=true;maskUploads+=bytes;}}else{ensureMask(vertexCount);const slot=maskCursor++%maskBuffers.length;maskBuffer=maskBuffers[slot];device.queue.writeBuffer(maskBuffer,0,verts.buffer,verts.byteOffset,bytes);maskUploads+=bytes;}if(corridorCopyCount>0)corridorMaskTriangles+=Math.floor(vertexCount/3)*corridorCopyCount;else maskTriangles+=Math.floor(vertexCount/3);}return{maskBuffer,vertexCount};}
            function sameWebUniform(a,b){for(let i=0;i<8;i++)if(a[i]!==b[i])return false;return true;}
            function webUniformRecord(frameCtx){const key=frameCtx?.layer&&typeof frameCtx.layer==='object'?frameCtx.layer:null;if(!key||!uniformLayout)return{buffer:uniformBuffer,bindGroup:uniformBind,snapshot:null,hasLast:false,fallback:true};let rec=webUniformRecords.get(key);if(rec&&rec.generation===hubGeneration&&rec.buffer)return rec;const buffer=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar resident Web Threads uniforms'});rec={buffer,bindGroup:device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer}}]}),snapshot:new Float32Array(8),hasLast:false,generation:hubGeneration};webUniformRecords.set(key,rec);webUniformRecordSet.add(rec);webUniformBuilds++;return rec;}
            function prepareWebUniform(frameCtx,alphaScale,haloRadius){webUniformData[0]=width;webUniformData[1]=height;webUniformData[2]=0;webUniformData[3]=0;webUniformData[4]=0;webUniformData[5]=Math.max(0,Number(alphaScale)||0);webUniformData[6]=Math.max(.1,Number(haloRadius)||.1);webUniformData[7]=0;const rec=webUniformRecord(frameCtx),changed=rec.fallback||!rec.hasLast||!sameWebUniform(webUniformData,rec.snapshot);if(changed){device.queue.writeBuffer(rec.buffer,0,webUniformData);webUniformUploads++;if(rec.snapshot){rec.snapshot.set(webUniformData);rec.hasLast=true;}}else webUniformUploadSkips++;return rec;}
            function compositeScratch(encoder,targetTexture){let view=targetViews.get(targetTexture);if(!view){view=targetTexture.createView();targetViews.set(targetTexture,view);}const pass=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'load',storeOp:'store'}]});pass.setPipeline(compositePipeline);pass.setBindGroup(0,compositeScratchBindGroup);pass.draw(3);pass.end();compositePasses++;}
            function beginStencilPass(encoder,msaaView,stencilView,vertexCount){return encoder.beginRenderPass({colorAttachments:[{view:msaaView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'discard'}],depthStencilAttachment:{view:stencilView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store',stencilClearValue:vertexCount?0:1,stencilLoadOp:'clear',stencilStoreOp:'store'}});}
            function beginThreadPass(encoder,msaaView,scratchView,stencilView){return encoder.beginRenderPass({colorAttachments:[{view:msaaView,resolveTarget:scratchView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'discard'}],depthStencilAttachment:{view:stencilView,depthLoadOp:'load',depthStoreOp:'store',stencilLoadOp:'load',stencilStoreOp:'store'}});}
            function encodeToLayerScene(targetTexture,commands,clipGeometry,haloRadius,alphaScale=1,frameCtx=null,clipMode='inside'){
                if(!targetTexture||!warmup()||!ready||lost||!ensureSize(mainCanvas.width,mainCanvas.height))return null;
                try{
                    const seg=getWebSegmentRecord(commands);if(!seg?.k)return{handled:true,commandBuffer:null};const ur=prepareWebUniform(frameCtx,alphaScale,haloRadius),segBuffer=seg.buffer;
                    const {maskBuffer,vertexCount}=uploadMask(clipGeometry,0,frameCtx),encoder=device.createCommandEncoder({label:'SpiroStar Web Threads → Layer Scene'}),scratchView=threadTextureView,msaaView=threadMsaaView,stencilView=stencilTextureView;
                    const maskPass=beginStencilPass(encoder,msaaView,stencilView,vertexCount);if(vertexCount){maskPass.setPipeline(maskPipeline);maskPass.setBindGroup(0,ur.bindGroup);maskPass.setVertexBuffer(0,maskBuffer);maskPass.draw(vertexCount);}maskPass.end();
                    const stencilRef=clipMode==='outside'?0:1;const haloPass=beginThreadPass(encoder,msaaView,scratchView,stencilView);haloPass.setStencilReference(stencilRef);haloPass.setPipeline(haloPipeline);haloPass.setBindGroup(0,ur.bindGroup);haloPass.setVertexBuffer(0,cornerBuffer);haloPass.setVertexBuffer(1,segBuffer);haloPass.draw(4,seg.k);haloPass.end();compositeScratch(encoder,targetTexture);
                    const corePass=beginThreadPass(encoder,msaaView,scratchView,stencilView);corePass.setStencilReference(stencilRef);corePass.setPipeline(corePipeline);corePass.setBindGroup(0,ur.bindGroup);corePass.setVertexBuffer(0,cornerBuffer);corePass.setVertexBuffer(1,segBuffer);corePass.draw(4,seg.k);corePass.end();compositeScratch(encoder,targetTexture);
                    frames++;if(vertexCount)clippedFrames++;else openFrames++;return{handled:true,commandBuffer:encoder.finish()};
                }catch(err){failures++;lastError=String(err?.message||err);return null;}
            }
            function sameWebCorridorUniform(a,b){for(let i=0;i<8;i++)if(a[i]!==b[i])return false;return true;}
            function webCorridorUniformRecord(frameCtx){const key=frameCtx?.layer&&typeof frameCtx.layer==='object'?frameCtx.layer:null;if(!key||!uniformLayout)return{buffer:uniformBuffer,bindGroup:uniformBind,snapshot:null,hasLast:false,fallback:true};let rec=corridorUniformRecords.get(key);if(rec&&rec.generation===hubGeneration&&rec.buffer)return rec;const buffer=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar resident Corridor Web uniforms'});rec={buffer,bindGroup:device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer}}]}),snapshot:new Float32Array(8),hasLast:false,generation:hubGeneration};corridorUniformRecords.set(key,rec);corridorUniformRecordSet.add(rec);corridorUniformBuilds++;return rec;}
            function encodeCorridorToLayerScene(targetTexture,commands,clipGeometry,haloRadius,alphaScale,copies,alphas,frameCtx,footprint=1,ctx=mainCtx,clipMode='inside'){
                if(!targetTexture||!warmup()||!ready||lost||!ensureSize(mainCanvas.width,mainCanvas.height)||!Array.isArray(copies)||!copies.length)return null;
                try{
                    const seg=getCorridorSegmentRecord(commands);if(!seg?.k)return{handled:true,commandBuffer:null};const copy=prepareCorridorCopies(copies,alphas,frameCtx,footprint);if(!copy?.k)return{handled:true,commandBuffer:null};
                    const tr=ctx?.getTransform?.(),originX=Number(tr?.e)||0,originY=Number(tr?.f)||0;corridorUniformData[0]=width;corridorUniformData[1]=height;corridorUniformData[2]=originX;corridorUniformData[3]=originY;corridorUniformData[4]=seg.k;corridorUniformData[5]=Math.max(0,Number(alphaScale)||0);corridorUniformData[6]=Math.max(.1,Number(haloRadius)||.1);corridorUniformData[7]=0;const ur=webCorridorUniformRecord(frameCtx),uniformChanged=ur.fallback||!ur.hasLast||!sameWebCorridorUniform(corridorUniformData,ur.snapshot);if(uniformChanged){device.queue.writeBuffer(ur.buffer,0,corridorUniformData);corridorUniformUploads++;if(ur.snapshot){ur.snapshot.set(corridorUniformData);ur.hasLast=true;}}else corridorUniformUploadSkips++;
                    const {maskBuffer,vertexCount}=uploadMask(clipGeometry,copy.k,frameCtx),encoder=device.createCommandEncoder({label:'SpiroStar Corridor Web Threads → Layer Scene'}),scratchView=threadTextureView,msaaView=threadMsaaView,stencilView=stencilTextureView;
                    const maskPass=beginStencilPass(encoder,msaaView,stencilView,vertexCount);if(vertexCount){maskPass.setPipeline(corridorMaskPipeline);maskPass.setBindGroup(0,ur.bindGroup);maskPass.setBindGroup(1,copy.bindGroup);maskPass.setVertexBuffer(0,maskBuffer);maskPass.draw(vertexCount,copy.k);}maskPass.end();
                    const logical=seg.k*copy.k,stencilRef=clipMode==='outside'?0:1,haloPass=beginThreadPass(encoder,msaaView,scratchView,stencilView);haloPass.setStencilReference(stencilRef);haloPass.setPipeline(corridorHaloPipeline);haloPass.setBindGroup(0,ur.bindGroup);haloPass.setBindGroup(1,seg.bindGroup);haloPass.setBindGroup(2,copy.bindGroup);haloPass.setVertexBuffer(0,cornerBuffer);haloPass.draw(4,logical);haloPass.end();compositeScratch(encoder,targetTexture);
                    const corePass=beginThreadPass(encoder,msaaView,scratchView,stencilView);corePass.setStencilReference(stencilRef);corePass.setPipeline(corridorCorePipeline);corePass.setBindGroup(0,ur.bindGroup);corePass.setBindGroup(1,seg.bindGroup);corePass.setBindGroup(2,copy.bindGroup);corePass.setVertexBuffer(0,cornerBuffer);corePass.draw(4,logical);corePass.end();compositeScratch(encoder,targetTexture);
                    frames++;corridorFrames++;corridorCopies+=copy.k;corridorLogicalSegments+=logical;if(vertexCount)clippedFrames++;else openFrames++;return{handled:true,commandBuffer:encoder.finish()};
                }catch(err){failures++;lastError=String(err?.message||err);return null;}
            }
            function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost&&WebGPUDeviceHub.isReady(),attempted,initializing,lost,lastError,width,height,frames,clippedFrames,openFrames,maskTriangles,segmentUploads,maskUploads,compositePasses,failures,sceneStorage:'gpu-texture+4x-msaa-stencil',webResidency:{staticBuffers:webStaticSegments.size,staticBuilds:webStaticBuilds,staticHits:webStaticHits,staticUploadBytes:webStaticUploads,staticEvictions:webStaticEvictions,uniformRecords:webUniformRecordSet.size,uniformBuilds:webUniformBuilds,uniformUploads:webUniformUploads,uniformUploadSkips:webUniformUploadSkips,maskRecords:maskRecordSet.size,maskBuilds:maskResidentBuilds,maskUploadSkips,maskUploadBytesAvoided,policy:'stable Web segment geometry resident in VRAM; alpha/halo in per-layer uniforms; exact parity-mask upload dedup'},corridor:{frames:corridorFrames,copies:corridorCopies,logicalSegments:corridorLogicalSegments,maskTriangles:corridorMaskTriangles,copyUploadBytes:corridorCopyUploads,sharedCopyReuse:sharedCorridorCopyReuse,dynamicUploadBytes:corridorDynamicUploads,staticUploadBytes:corridorStaticUploads,staticBuilds:corridorStaticBuilds,staticHits:corridorStaticHits,staticEvictions:corridorStaticEvictions,staticBuffers:corridorStaticSegments.size,copyRingBuffers:corridorCopyBuffers.length,uniformResidency:{records:corridorUniformRecordSet.size,builds:corridorUniformBuilds,uploads:corridorUniformUploads,uploadSkips:corridorUniformUploadSkips,policy:'per-layer persistent Corridor Web uniform buffer; exact upload dedup'}},hub:WebGPUDeviceHub.status()};}
            return{warmup,isReady:()=>{warmup();return ready&&!lost;},encodeToLayerScene,encodeCorridorToLayerScene,status};
        })();
        window.__spiroWebThreadSceneGPUStatus=()=>WebGPUWebThreadSceneRenderer.status();
