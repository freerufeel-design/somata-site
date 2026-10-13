

window.__spiroRegisterModule?.('js/gpu/canonical-sweep-renderer');

        const WebGPUCanonicalSweepRenderer = (() => {
            const canvas=document.createElement('canvas');
            let device=null,context=null,format=null,cornerBuffer=null,uniformBuffer=null,dummyCubicBuffer=null,uniformLayout=null,segmentLayout=null,copyLayout=null,sceneCompositeLayout=null,haloPipeline=null,corePipeline=null,haloCorridorPipeline=null,coreCorridorPipeline=null,uniformBind=null,corridorUniformBind=null,sceneScratchTexture=null,sceneScratchView=null,sceneCompositePipeline=null,sceneCoreCompositePipeline=null,sceneCompositePipelines=Object.create(null),sceneCompositeBindGroup=null,sceneCoreCompositeBindGroup=null,targetViews=new WeakMap();
            let attempted=false,initializing=false,ready=false,lost=false,lastError='',hubGeneration=0,width=0,height=0,submissions=0,frames=0,sceneDirectFrames=0,sceneDirectCorridorFrames=0,sceneCompositePasses=0;
            let segmentBindCache=new WeakMap();
            let uniformRecords=new WeakMap(),uniformRecordSet=new Set(),uniformRecordBuilds=0,uniformUploads=0,uniformUploadSkips=0;
            let copyCapacity=0,copyRing=[null,null,null],copyBind=[null,null,null],copyData=null,copyRingIndex=0,sharedCopyBindCache=new WeakMap(),sharedCopyReuse=0;
            let corridorUploads=0,corridorDraws=0,corridorLogicalInstances=0,corridorCopies=0,corridorCulled=0,gpuArcTables=0,gpuArcPrerequisiteFailures=0;
            const uniformF32=new Float32Array(32);
            const WGSL=`
struct Uniforms { viewport:vec2<f32>, mode:f32, segCount:f32, row0:vec4<f32>, row1:vec4<f32>, p0:vec4<f32>, p1:vec4<f32>, color:vec4<f32>, extra:vec4<f32>, };
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(1) @binding(0) var<storage,read> segData:array<vec4<f32>>;
@group(1) @binding(1) var<storage,read> retainedCubics:array<vec4<f32>>;
@group(2) @binding(0) var<storage,read> copyData:array<vec4<f32>>;
struct Vin{@location(0) corner:vec2<f32>,};
struct ClipResult{a:vec2<f32>,b:vec2<f32>,isActive:f32,};
struct Vout{@builtin(position) position:vec4<f32>,@location(0) local:vec2<f32>,@location(1) @interpolate(flat) segLen:f32,@location(2) @interpolate(flat) halfWidth:f32,@location(3) @interpolate(flat) glowRadius:f32,@location(4) @interpolate(flat) isActive:f32,@location(5) @interpolate(flat) copyAlpha:f32,};
fn posmod(x:f32,m:f32)->f32{return x-floor(x/m)*m;}

fn cubicDerivativeArc(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let s=1.0-t;return 3.0*s*s*(c1-p0)+6.0*s*t*(c2-c1)+3.0*t*t*(p3-c2);}
fn arcCorrectMicroT(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,sub:u32,subdiv:u32,f0:f32)->f32{
    let f=clamp(f0,0.0,1.0);let sd=max(1u,subdiv);let t0=f32(sub)/f32(sd);let t1=f32(sub+1u)/f32(sd);if(f<=0.000001){return t0;}if(f>=0.999999){return t1;}
    let s0=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t0)));let s1=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t1)));let dv=s1-s0;let arcTarget=f*max(0.000001,s0+0.5*dv);

    let disc=max(0.000000000001,s0*s0+2.0*dv*arcTarget);let q=clamp((2.0*arcTarget)/max(0.000001,s0+sqrt(disc)),0.0,1.0);return mix(t0,t1,q);
}
fn retainedPoint(si:u32,microT:f32)->vec2<f32>{
    let g=segData[si*2u];if(u.extra.w<0.5){return mix(g.xy,g.zw,microT);}let subdiv=max(1u,u32(u.extra.y+0.5));let logical=si/subdiv;let sub=si%subdiv;let q0=retainedCubics[logical*2u];let q1=retainedCubics[logical*2u+1u];let t=arcCorrectMicroT(q0.xy,q0.zw,q1.xy,q1.zw,sub,subdiv,microT);let a=mix(q0.xy,q0.zw,t);let b=mix(q0.zw,q1.xy,t);let c=mix(q1.xy,q1.zw,t);return mix(mix(a,b,t),mix(b,c,t),t);
}
fn clipSegment(si:u32,slot:u32)->ClipResult{
    let s0=segData[si*2u];let s1=segData[si*2u+1u];let lastIndex=max(1u,u32(u.segCount+0.5))-1u;let lastMeta=segData[lastIndex*2u+1u];let wholeTotal=max(0.000001,lastMeta.x+lastMeta.y);let mode=i32(u.mode+0.5);let sl=max(0.000001,s1.y);
    var total=wholeTotal;var ss=s1.x;var wrapped=true;var phase=u.p0.y-floor(u.p0.y);
    if(mode==1){total=max(0.000001,s1.w);ss=s1.x-s1.z;}
    if(mode>=2){
        let subdiv=max(1u,u32(u.extra.y+0.5));let logical=si/subdiv;let nth=max(2u,u32(u.extra.z+0.5));
        if(mode==3&&logical%nth!=0u){return ClipResult(vec2<f32>(0.0),vec2<f32>(0.0),0.0);}
        let first=logical*subdiv;let last=min(lastIndex,first+subdiv-1u);let fm=segData[first*2u+1u];let lm=segData[last*2u+1u];let start=fm.x;
        total=max(0.000001,(lm.x+lm.y)-start);ss=s1.x-start;wrapped=false;phase=1.0-abs(2.0*phase-1.0);
    }
    let sweepLen=min(total,max(0.000001,total*u.p0.z));var ia=0.0;var ib=0.0;var valid=false;
    if(wrapped){let ws=posmod(phase*total-sweepLen*0.5,total);let we=ws+sweepLen;if(slot==0u){ia=ws;ib=min(total,we);valid=ib>ia;}else if(we>total){ia=0.0;ib=we-total;valid=ib>ia;}}
    else{let center=phase*total;ia=max(0.0,center-sweepLen*0.5);ib=min(total,center+sweepLen*0.5);valid=slot==0u&&ib>ia;}
    let oa=max(ss,ia);let ob=min(ss+sl,ib);valid=valid&&ob>oa+0.000001;if(!valid){return ClipResult(vec2<f32>(0.0),vec2<f32>(0.0),0.0);}
    let t0=clamp((oa-ss)/sl,0.0,1.0);let t1=clamp((ob-ss)/sl,0.0,1.0);return ClipResult(retainedPoint(si,t0),retainedPoint(si,t1),1.0);
}
fn screenPoint(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
fn makeVertex(v:Vin,p0:vec2<f32>,p1:vec2<f32>,hw:f32,gr:f32,alpha:f32,isActive:f32)->Vout{
    var o:Vout;if(isActive<0.5){o.position=vec4<f32>(-3.0,-3.0,0.0,1.0);o.local=vec2<f32>(0.0);o.segLen=1.0;o.halfWidth=hw;o.glowRadius=gr;o.isActive=0.0;o.copyAlpha=0.0;return o;}
    let delta=p1-p0;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);let pad=hw+gr+3.0;let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let p=p0+dir*lx+n*ly;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidth=hw;o.glowRadius=gr;o.isActive=1.0;o.copyAlpha=alpha;return o;
}
@vertex fn vsMain(v:Vin,@builtin(instance_index) iid:u32)->Vout{
    let si=iid/2u;let slot=iid%2u;if(si>=u32(u.segCount+0.5)){return makeVertex(v,vec2<f32>(0.0),vec2<f32>(0.0),u.p0.w,u.p1.x,0.0,0.0);}let q=clipSegment(si,slot);return makeVertex(v,screenPoint(q.a),screenPoint(q.b),u.p0.w,u.p1.x,1.0,q.isActive);
}
@vertex fn vsCorridor(v:Vin,@builtin(instance_index) iid:u32)->Vout{
    let perCopy=max(1u,u32(u.segCount+0.5)*2u);let ci=iid/perCopy;let unit=iid%perCopy;let si=unit/2u;let slot=unit%2u;if(si>=u32(u.segCount+0.5)){return makeVertex(v,vec2<f32>(0.0),vec2<f32>(0.0),u.p0.w,u.p1.x,0.0,0.0);}
    let q=clipSegment(si,slot);let c0=copyData[ci*2u];let c1=copyData[ci*2u+1u];let local0=vec2<f32>(c0.x*q.a.x+c0.y*q.a.y,c1.x*q.a.x+c1.y*q.a.y);let local1=vec2<f32>(c0.x*q.b.x+c0.y*q.b.y,c1.x*q.b.x+c1.y*q.b.y);let sc=max(0.000001,abs(c1.z));
    return makeVertex(v,screenPoint(local0),screenPoint(local1),u.p0.w*sc,u.p1.x*sc,c0.z,q.isActive);
}
fn coverage(v:Vout)->vec2<f32>{let cx=clamp(v.local.x,0.0,v.segLen);let d=length(vec2<f32>(v.local.x-cx,v.local.y));let centerCoverage=min(1.0,2.0*v.halfWidth);let core=min(centerCoverage,clamp(v.halfWidth+0.5-d,0.0,1.0));let edge=max(0.0,d-v.halfWidth);var glow=0.0;if(v.glowRadius>0.01){let q=edge/max(0.0001,v.glowRadius);let s=clamp(u.extra.x,0.0,1.5);let start=mix(0.84,0.02,min(1.0,s));glow=1.0-smoothstep(start,1.0,q);if(s>1.0){glow=pow(max(0.0,glow),mix(1.0,0.58,min(1.0,(s-1.0)*2.0)));}}return vec2<f32>(core,glow);}
@fragment fn fsHalo(v:Vout)->@location(0) vec4<f32>{if(v.isActive<0.5||v.copyAlpha<=0.00001){discard;}let c=coverage(v);let a=clamp(max(0.0,u.p1.z*c.y*v.copyAlpha),0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(u.color.rgb*a,a);}
@fragment fn fsCore(v:Vout)->@location(0) vec4<f32>{if(v.isActive<0.5||v.copyAlpha<=0.00001){discard;}let c=coverage(v);let a=clamp(max(0.0,u.p1.y*c.x*v.copyAlpha),0.0,1.0);if(a<0.00015){discard;}let gain=max(0.0,u.color.a);var lit=u.color.rgb*min(1.0,gain);if(gain>1.0){lit=mix(u.color.rgb,vec3<f32>(1.0),min(1.0,gain-1.0));}return vec4<f32>(lit*a,a);}`;
            const SCENE_COMPOSITE_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
struct V{@builtin(position) p:vec4<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);return o;}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let d=textureDimensions(srcTex);let x=clamp(i32(p.x),0,i32(d.x)-1);let y=clamp(i32(p.y),0,i32(d.y)-1);return textureLoad(srcTex,vec2<i32>(x,y),0);}
`;
            async function initAsync(){
                if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready)return false;attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();device=shared.device;hubGeneration=shared.generation;lost=false;context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU canvas context недоступен');format=navigator.gpu.getPreferredCanvasFormat();
                    const module=device.createShaderModule({label:'SpiroStar canonical sweep WGSL',code:WGSL});await assertWebGPUShaderModule(module,'SpiroStar canonical sweep WGSL');
                    const target={format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}},vbuf=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];

                    uniformLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
                    segmentLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]});
                    copyLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
                    const normalLayout=device.createPipelineLayout({bindGroupLayouts:[uniformLayout,segmentLayout]}),corridorLayout=device.createPipelineLayout({bindGroupLayouts:[uniformLayout,segmentLayout,copyLayout]});
                    haloPipeline=device.createRenderPipeline({label:'SpiroStar canonical sweep halo',layout:normalLayout,vertex:{module,entryPoint:'vsMain',buffers:vbuf},fragment:{module,entryPoint:'fsHalo',targets:[target]},primitive:{topology:'triangle-strip',cullMode:'none'}});
                    corePipeline=device.createRenderPipeline({label:'SpiroStar canonical sweep core',layout:normalLayout,vertex:{module,entryPoint:'vsMain',buffers:vbuf},fragment:{module,entryPoint:'fsCore',targets:[target]},primitive:{topology:'triangle-strip',cullMode:'none'}});
                    haloCorridorPipeline=device.createRenderPipeline({label:'SpiroStar Corridor canonical sweep halo',layout:corridorLayout,vertex:{module,entryPoint:'vsCorridor',buffers:vbuf},fragment:{module,entryPoint:'fsHalo',targets:[target]},primitive:{topology:'triangle-strip',cullMode:'none'}});
                    coreCorridorPipeline=device.createRenderPipeline({label:'SpiroStar Corridor canonical sweep core',layout:corridorLayout,vertex:{module,entryPoint:'vsCorridor',buffers:vbuf},fragment:{module,entryPoint:'fsCore',targets:[target]},primitive:{topology:'triangle-strip',cullMode:'none'}});
                    const compositeModule=device.createShaderModule({label:'SpiroStar canonical sweep scene composite WGSL',code:SCENE_COMPOSITE_WGSL});await assertWebGPUShaderModule(compositeModule,'SpiroStar canonical sweep scene composite WGSL');
                    sceneCompositeLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}}]});
                    const sceneLayout=device.createPipelineLayout({bindGroupLayouts:[sceneCompositeLayout]});
                    sceneCompositePipelines=Object.create(null);
                    for(const mode of (typeof SWEEP_BLEND_MODES!=='undefined'?SWEEP_BLEND_MODES:['normal','screen','multiply','add','darken','lighten'])){
                        sceneCompositePipelines[mode]=device.createRenderPipeline({label:`SpiroStar canonical sweep ${mode} → Layer Scene`,layout:sceneLayout,vertex:{module:compositeModule,entryPoint:'vs'},fragment:{module:compositeModule,entryPoint:'fs',targets:[{format,blend:sweepBlendGpuState(mode)}]},primitive:{topology:'triangle-list'}});
                    }
                    sceneCompositePipeline=sceneCompositePipelines.add;sceneCoreCompositePipeline=sceneCompositePipelines.normal;
                    cornerBuffer=device.createBuffer({size:32,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,label:'SpiroStar canonical sweep corners'});device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,1,1]));dummyCubicBuffer=device.createBuffer({size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar canonical sweep dummy cubic'});device.queue.writeBuffer(dummyCubicBuffer,0,new Float32Array(8));
                    uniformBuffer=device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar canonical sweep uniforms'});uniformBind=device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer:uniformBuffer}}]});corridorUniformBind=device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer:uniformBuffer}}]});
                    ready=true;initializing=false;requestMainCanvasRender();return true;
                }catch(err){ready=false;initializing=false;lastError=String(err?.message||err);return false;}
            }
            function resetDeviceResources(){
                try{context?.unconfigure?.();}catch(_){}try{sceneScratchTexture?.destroy?.();}catch(_){}try{dummyCubicBuffer?.destroy?.();}catch(_){}dummyCubicBuffer=null;sceneScratchTexture=sceneScratchView=null;sceneCompositeBindGroup=sceneCoreCompositeBindGroup=null;targetViews=new WeakMap();for(const b of copyRing)try{b?.destroy?.();}catch(_){}copyRing=[null,null,null];copyBind=[null,null,null];copyCapacity=0;copyData=null;copyRingIndex=0;segmentBindCache=new WeakMap();sharedCopyBindCache=new WeakMap();
                for(const rec of uniformRecordSet)try{rec?.buffer?.destroy?.();}catch(_){}uniformRecordSet.clear();uniformRecords=new WeakMap();
            }
            function warmup(){const hubReady=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();if(ready&&(!hubReady||gen!==hubGeneration)){ready=false;attempted=false;initializing=false;lost=!hubReady;resetDeviceResources();}if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hubReady;}
            function ensureSize(){if(!ready||lost||!device||!context)return false;const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);if(width===w&&height===h&&canvas.width===w&&canvas.height===h&&sceneScratchTexture)return true;canvas.width=w;canvas.height=h;width=w;height=h;context.configure({device,format,alphaMode:'premultiplied'});try{sceneScratchTexture?.destroy?.();}catch(_){}sceneScratchTexture=device.createTexture({label:'SpiroStar canonical sweep scene scratch',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});sceneScratchView=sceneScratchTexture.createView();sceneCompositeBindGroup=device.createBindGroup({layout:sceneCompositeLayout,entries:[{binding:0,resource:sceneScratchView}]});sceneCoreCompositeBindGroup=device.createBindGroup({layout:sceneCompositeLayout,entries:[{binding:0,resource:sceneScratchView}]});return true;}
            function ensureCopyCapacity(n){
                if(n<=copyCapacity&&copyRing.every(Boolean)&&copyData)return;copyCapacity=performanceGovernor.capacityFor(n,copyCapacity,32,1.6);copyData=new Float32Array(copyCapacity*8);
                for(const b of copyRing)try{b?.destroy?.();}catch(_){}copyRing=[0,1,2].map(i=>device.createBuffer({size:Math.max(32,copyCapacity*8*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:`SpiroStar Corridor canonical sweep copies ${i}`}));copyBind=copyRing.map(buffer=>device.createBindGroup({layout:copyLayout,entries:[{binding:0,resource:{buffer}}]}));
            }
            function prepareCorridorCopyRecord(copies,alphas,frameCtx,footprint){
                const shared=WebGPUCorridorCopyStore.acquire(device,hubGeneration,frameCtx,copies,alphas,'sweep',footprint,frameCtx?.layer);
                if(shared?.buffer){let bg=sharedCopyBindCache.get(shared.buffer);if(!bg){bg=device.createBindGroup({layout:haloCorridorPipeline.getBindGroupLayout(2),entries:[{binding:0,resource:{buffer:shared.buffer}}]});sharedCopyBindCache.set(shared.buffer,bg);}sharedCopyReuse++;return{buffer:shared.buffer,bindGroup:bg,k:shared.k};}
                ensureCopyCapacity(copies.length);const k=packTunnelEffectCopyRecords(copyData,copies,alphas,frameCtx,'sweep',footprint,frameCtx?.layer);if(!k)return{buffer:null,bindGroup:null,k:0};const slot=copyRingIndex++%copyRing.length,buffer=copyRing[slot];device.queue.writeBuffer(buffer,0,copyData.buffer,copyData.byteOffset,k*8*4);corridorUploads+=k*8*4;return{buffer,bindGroup:copyBind[slot],k};
            }
            function segmentBind(rec,table,corridor=false){
                if(!rec?.buffer)return null;let pair=segmentBindCache.get(rec.buffer);if(!pair){pair={normal:null,corridor:null,cubic:null};segmentBindCache.set(rec.buffer,pair);}const cubic=table?._gpuMorphArcResource?.morphRec?.cubicBuffer||dummyCubicBuffer;if(pair.cubic!==cubic){pair.normal=null;pair.corridor=null;pair.cubic=cubic;}const key=corridor?'corridor':'normal';if(!pair[key])pair[key]=device.createBindGroup({layout:(corridor?haloCorridorPipeline:haloPipeline).getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:rec.buffer}},{binding:1,resource:{buffer:cubic}}]});return pair[key];
            }
            function sameSweepUniform(a,b){for(let i=0;i<32;i++)if(a[i]!==b[i])return false;return true;}
            function sweepUniformRecord(table,cfg,owner=null){
                const key=owner&&typeof owner==='object'?owner:(cfg&&typeof cfg==='object'?cfg:(table&&typeof table==='object'?table:null));
                if(!key)return{buffer:uniformBuffer,normalBind:uniformBind,corridorBind:corridorUniformBind,snapshot:null,hasLast:false,fallback:true};
                let rec=uniformRecords.get(key);
                if(rec&&rec.generation===hubGeneration&&rec.buffer)return rec;
                const buffer=device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:'SpiroStar resident canonical sweep uniforms'});
                rec={buffer,normalBind:device.createBindGroup({layout:haloPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}),corridorBind:device.createBindGroup({layout:haloCorridorPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}),snapshot:new Float32Array(32),hasLast:false,generation:hubGeneration};
                uniformRecords.set(key,rec);uniformRecordSet.add(rec);uniformRecordBuilds++;return rec;
            }
            function prepareUniforms(table,rec,ctx,cfg,phase,lineWidth,visual,alpha,lenFracOverride,owner=null){
                const tr=ctx?.getTransform?.(),a=Number(tr?.a)||1,b=Number(tr?.b)||0,c=Number(tr?.c)||0,d=Number(tr?.d)||1,e=Number(tr?.e)||0,f=Number(tr?.f)||0;
                const scale=Math.sqrt(Math.max(1e-12,Math.abs(a*d-b*c))),baseAlpha=Math.max(0,Math.min(1,Number(alpha)||0)),coreOpacity=Math.max(0,Math.min(1,Number.isFinite(Number(visual?.opacity))?Number(visual.opacity):1));
                const brightness=Math.max(0,Number(visual?.brightness)||0);
                const hw=Math.max(.075,Math.abs(Number(lineWidth)||.15)*scale*.5),gr=Math.max(0,Number(visual?.glowSize)||0)*scale;
                const ca=baseAlpha*coreOpacity,ga=gr>.001&&Number(visual?.strength)>.001?Math.max(0,Math.min(32,baseAlpha*.22*Number(visual.strength)*brightness)):0;
                const softness=Math.max(0,Math.min(1.5,Number(visual?.softness)||0)),rgb=GPUColorCache.rgb(cfg?.color||'#ffffff'),lenFrac=Math.max(.01,Math.min(1,Number.isFinite(Number(lenFracOverride))?Number(lenFracOverride):audioApplyNumeric('sweep.length',Number(cfg?.lengthPercent)||18,-1)/100));
                uniformF32.fill(0);uniformF32[0]=width;uniformF32[1]=height;uniformF32[2]=cfg?.mode==='perPath'?1:(cfg?.mode==='perSegment'?2:(cfg?.mode==='everyNth'?3:0));uniformF32[3]=rec.count;uniformF32[4]=a;uniformF32[5]=c;uniformF32[6]=e;uniformF32[8]=b;uniformF32[9]=d;uniformF32[10]=f;uniformF32[12]=table.total;uniformF32[13]=((Number(phase)||0)%1+1)%1;uniformF32[14]=lenFrac;uniformF32[15]=hw;uniformF32[16]=gr;uniformF32[17]=ca;uniformF32[18]=ga;uniformF32[20]=rgb[0];uniformF32[21]=rgb[1];uniformF32[22]=rgb[2];uniformF32[23]=1;uniformF32[24]=softness;uniformF32[25]=Math.max(1,Number(table?._gpuMorphArcResource?.subdiv)||1);uniformF32[26]=Math.max(2,Math.round(Number(cfg?.everyN)||2));uniformF32[27]=table?._gpuMorphArcResource?.morphRec?.cubicBuffer?1:0;
                const ur=sweepUniformRecord(table,cfg,owner),changed=ur.fallback||!ur.hasLast||!sameSweepUniform(uniformF32,ur.snapshot);if(changed){device.queue.writeBuffer(ur.buffer,0,uniformF32);uniformUploads++;if(ur.snapshot){ur.snapshot.set(uniformF32);ur.hasLast=true;}}else uniformUploadSkips++;return{alpha:baseAlpha,normalBind:ur.normalBind,corridorBind:ur.corridorBind};
            }
            function composite(ctx,mode='lighter'){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation=mode;ctx.filter='none';ctx.drawImage(canvas,0,0);ctx.restore();}
            function canUse(cfg,_tunnelActive=false){warmup();return ready&&!lost&&cfg?.effectType!=='lightning'&&cfg?.mode!=='across'&&['whole','perPath','perSegment','everyNth'].includes(cfg?.mode);}
            function ensureArcTableReady(table,frameCtx=null,encoder=null){if(!table?._gpuMorphArcResource)return true;gpuArcTables++;if(frameCtx?.frame?.gpuLayerSceneDeferred&&encoder&&typeof spiroGpuPrepareArcForLayerScene==='function'&&spiroGpuPrepareArcForLayerScene(frameCtx,table,encoder))return true;if(typeof ensureGpuMorphArcTableSubmitted==='function'&&ensureGpuMorphArcTableSubmitted(table))return true;gpuArcPrerequisiteFailures++;return false;}
            function layerSceneView(texture){let view=targetViews.get(texture);if(view)return view;view=texture.createView();targetViews.set(texture,view);return view;}
            function render(table,ctx,cfg,phase,lineWidth,visual,alpha,lenFracOverride,uniformOwner=null){
                if(!canUse(cfg,false)||!table?.total||!ensureSize())return false;
                try{if(!ensureArcTableReady(table))return false;const rec=WebGPUCanonicalPathStore.acquire(table,device,hubGeneration);if(!rec?.count)return true;const ur=prepareUniforms(table,rec,ctx,cfg,phase,lineWidth,visual,alpha,lenFracOverride,uniformOwner);if(ur.alpha<=.0001)return true;const sb=segmentBind(rec,table,false),stage=(core,mode)=>{const encoder=device.createCommandEncoder({label:core?'SpiroStar canonical sweep core':'SpiroStar canonical sweep halo'}),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(core?corePipeline:haloPipeline);pass.setBindGroup(0,ur.normalBind);pass.setBindGroup(1,sb);pass.setVertexBuffer(0,cornerBuffer);pass.draw(4,rec.count*2);pass.end();device.queue.submit([encoder.finish()]);submissions++;composite(ctx,mode);};stage(false,sweepBlendCanvasOperation(sweepGlowBlendMode(cfg)));stage(true,sweepBlendCanvasOperation(sweepCoreBlendMode(cfg)));frames++;return true;}catch(err){lastError=String(err?.message||err);return false;}
            }
            function renderCorridor(table,ctx,cfg,phase,lineWidth,visual,baseAlpha,lenFracOverride,copies,alphas,frameCtx,footprint=1,uniformOwner=null){
                if(!canUse(cfg,true)||!table?.total||!ensureSize()||!Array.isArray(copies)||!copies.length)return false;
                try{
                    if(!ensureArcTableReady(table))return false;const rec=WebGPUCanonicalPathStore.acquire(table,device,hubGeneration);if(!rec?.count)return true;const ur=prepareUniforms(table,rec,ctx,cfg,phase,lineWidth,visual,baseAlpha,lenFracOverride,uniformOwner);if(ur.alpha<=.0001)return true;const copy=prepareCorridorCopyRecord(copies,alphas,frameCtx,footprint),k=copy.k;corridorCulled+=Math.max(0,copies.length-k);
                    if(!k)return true;const sb=segmentBind(rec,table,true),stage=(core,mode)=>{const encoder=device.createCommandEncoder({label:core?'SpiroStar Corridor canonical sweep core':'SpiroStar Corridor canonical sweep halo'}),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(core?coreCorridorPipeline:haloCorridorPipeline);pass.setBindGroup(0,ur.corridorBind);pass.setBindGroup(1,sb);pass.setBindGroup(2,copy.bindGroup);pass.setVertexBuffer(0,cornerBuffer);pass.draw(4,rec.count*2*k);pass.end();device.queue.submit([encoder.finish()]);submissions++;composite(ctx,mode);};stage(false,sweepBlendCanvasOperation(sweepGlowBlendMode(cfg)));stage(true,sweepBlendCanvasOperation(sweepCoreBlendMode(cfg)));frames++;corridorDraws++;corridorCopies+=k;corridorLogicalInstances+=rec.count*2*k;return true;
                }catch(err){lastError=String(err?.message||err);return false;}
            }

            function encodeToLayerScene(targetTexture,table,ctx,cfg,phase,lineWidth,visual,alpha,lenFracOverride,uniformOwner=null,frameCtx=null){
                if(!targetTexture||!canUse(cfg,false)||!table?.total||!ensureSize())return null;
                try{const encoder=device.createCommandEncoder({label:'SpiroStar canonical sweep → Layer Scene'});if(!ensureArcTableReady(table,frameCtx,encoder))return null;const rec=WebGPUCanonicalPathStore.acquire(table,device,hubGeneration);if(!rec?.count)return{handled:true,commandBuffer:null};const ur=prepareUniforms(table,rec,ctx,cfg,phase,lineWidth,visual,alpha,lenFracOverride,uniformOwner);if(ur.alpha<=.0001)return{handled:true,commandBuffer:null};const sb=segmentBind(rec,table,false);
                    let pass;const tv=layerSceneView(targetTexture),stage=(core)=>{pass=encoder.beginRenderPass({colorAttachments:[{view:sceneScratchView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(core?corePipeline:haloPipeline);pass.setBindGroup(0,ur.normalBind);pass.setBindGroup(1,sb);pass.setVertexBuffer(0,cornerBuffer);pass.draw(4,rec.count*2);pass.end();pass=encoder.beginRenderPass({colorAttachments:[{view:tv,loadOp:'load',storeOp:'store'}]});const blendMode=core?(sweepCoreBlendMode(cfg)):sweepGlowBlendMode(cfg);pass.setPipeline(sceneCompositePipelines[blendMode]||sceneCompositePipelines.normal||sceneCoreCompositePipeline);pass.setBindGroup(0,core?sceneCoreCompositeBindGroup:sceneCompositeBindGroup);pass.draw(3);pass.end();sceneCompositePasses++;};stage(false);stage(true);sceneDirectFrames++;frames++;return{handled:true,commandBuffer:encoder.finish()};
                }catch(err){lastError=String(err?.message||err);return null;}
            }
            function encodeCorridorToLayerScene(targetTexture,table,ctx,cfg,phase,lineWidth,visual,baseAlpha,lenFracOverride,copies,alphas,frameCtx,footprint=1,uniformOwner=null){
                if(!targetTexture||!canUse(cfg,true)||!table?.total||!ensureSize()||!Array.isArray(copies)||!copies.length)return null;
                try{const encoder=device.createCommandEncoder({label:'SpiroStar Corridor canonical sweep → Layer Scene'});if(!ensureArcTableReady(table,frameCtx,encoder))return null;const rec=WebGPUCanonicalPathStore.acquire(table,device,hubGeneration);if(!rec?.count)return{handled:true,commandBuffer:null};const ur=prepareUniforms(table,rec,ctx,cfg,phase,lineWidth,visual,baseAlpha,lenFracOverride,uniformOwner);if(ur.alpha<=.0001)return{handled:true,commandBuffer:null};const copy=prepareCorridorCopyRecord(copies,alphas,frameCtx,footprint),k=copy.k;corridorCulled+=Math.max(0,copies.length-k);if(!k)return{handled:true,commandBuffer:null};
                    const sb=segmentBind(rec,table,true);
                    let pass;const tv=layerSceneView(targetTexture),stage=(core)=>{pass=encoder.beginRenderPass({colorAttachments:[{view:sceneScratchView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(core?coreCorridorPipeline:haloCorridorPipeline);pass.setBindGroup(0,ur.corridorBind);pass.setBindGroup(1,sb);pass.setBindGroup(2,copy.bindGroup);pass.setVertexBuffer(0,cornerBuffer);pass.draw(4,rec.count*2*k);pass.end();pass=encoder.beginRenderPass({colorAttachments:[{view:tv,loadOp:'load',storeOp:'store'}]});const blendMode=core?(sweepCoreBlendMode(cfg)):sweepGlowBlendMode(cfg);pass.setPipeline(sceneCompositePipelines[blendMode]||sceneCompositePipelines.normal||sceneCoreCompositePipeline);pass.setBindGroup(0,core?sceneCoreCompositeBindGroup:sceneCompositeBindGroup);pass.draw(3);pass.end();sceneCompositePasses++;};stage(false);stage(true);corridorDraws++;corridorCopies+=k;corridorLogicalInstances+=rec.count*2*k;sceneDirectCorridorFrames++;frames++;return{handled:true,commandBuffer:encoder.finish()};
                }catch(err){lastError=String(err?.message||err);return null;}
            }
            function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost&&WebGPUDeviceHub.isReady(),attempted,initializing,lost,lastError,width,height,submissions,frames,sceneDirectFrames,sceneDirectCorridorFrames,sceneCompositePasses,gpuArcTables,gpuArcPrerequisiteFailures,pathStore:WebGPUCanonicalPathStore.status(),uniformResidency:{records:uniformRecordSet.size,builds:uniformRecordBuilds,uploads:uniformUploads,uploadSkips:uniformUploadSkips,policy:'per-effect persistent uniform buffer; exact upload dedup'},corridor:{copyUploadBytes:corridorUploads,sharedCopyReuse,draws:corridorDraws,copies:corridorCopies,logicalInstances:corridorLogicalInstances,culled:corridorCulled,copyRingBuffers:copyRing.length},hub:WebGPUDeviceHub.status()};}
            return{warmup,isReady:()=>{warmup();return ready&&!lost;},canUse,render,renderCorridor,encodeToLayerScene,encodeCorridorToLayerScene,status};
        })();
        window.__spiroCanonicalSweepGPUStatus=()=>WebGPUCanonicalSweepRenderer.status();
