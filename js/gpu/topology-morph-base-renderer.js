

window.__spiroRegisterModule?.('js/gpu/topology-morph-base-renderer');

const WebGPUTopologyMorphBaseRenderer = (() => {
    const BEZIER_SUBDIV=8;
    const canvas=document.createElement('canvas');
    let device=null,context=null,format=null,pipeline=null,cornerBuffer=null,uniformBuffers=[],uniformBinds=[],uniformCursor=0;
    let copyBuffer=null,copyCapacity=0,copyBind=null,copyPackedFrameId=-1,copyPackedLayer=null,copyPackedCount=0;
    let attempted=false,initializing=false,ready=false,lost=false,lastError='not-initialized',lastLoggedError='',hubGeneration=-1,width=0,height=0;
    let segmentBindCache=new WeakMap(),renderBundleCache=new WeakMap();
    const uniformBytes=new ArrayBuffer(64),uniformF32=new Float32Array(uniformBytes),uniformU32=new Uint32Array(uniformBytes);
    let copyData=new Float32Array(0);
    const stats={frames:0,baseFrames:0,glowFrames:0,fusedGlowBaseFrames:0,corridorFrames:0,spiralFrames:0,variableWidthSegments:0,draws:0,segments:0,copies:0,cpuPathBuildsAvoided:0,arcBuildsAvoided:0,copyPackReuses:0,uniformBindReuses:0,bundleBuilds:0,bundleHits:0,bundleExecutes:0,bundleFallbacks:0,submissionsAvoided:0,canvasCompositesAvoided:0,fallbacks:0,uploads:0,errors:0};
    const lastDecision={eligible:false,reason:'not-requested',mode:'base',layerIndex:-1,frameId:-1};

    const WGSL=`
struct U {
    viewport:vec2<f32>,
    segCount:u32,
    copyCount:u32,
    row0:vec4<f32>,
    row1:vec4<f32>,
    params:vec4<f32>,
};
const SUBDIV:u32=8u;
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<storage,read> cubicData:array<vec4<f32>>;
@group(1) @binding(1) var<storage,read> morphPts:array<vec4<f32>>;
@group(1) @binding(2) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(2) @binding(0) var<storage,read> copyData:array<vec4<f32>>;
struct Vin { @location(0) corner:vec2<f32>, };
struct Vout {
    @builtin(position) position:vec4<f32>,
    @location(0) local:vec2<f32>,
    @location(1) @interpolate(flat) segLen:f32,
    @location(2) @interpolate(flat) halfWidth0:f32,
    @location(3) @interpolate(flat) halfWidth1:f32,
    @location(4) @interpolate(flat) glowRadius:f32,
    @location(5) @interpolate(flat) alpha:f32,
    @location(6) @interpolate(flat) color:vec4<f32>,
};
fn cubicPoint(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;
}
fn screenPoint(p:vec2<f32>)->vec2<f32>{
    return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);
}
@vertex fn vsMain(v:Vin,@builtin(instance_index) iid:u32)->Vout{
    var o:Vout;
    let logical=max(1u,u.segCount);let microPerCopy=logical*SUBDIV;let unit=iid%microPerCopy;let ci=iid/microPerCopy;
    let si=unit/SUBDIV;let sub=unit%SUBDIV;let t0=f32(sub)/f32(SUBDIV);let t1=f32(sub+1u)/f32(SUBDIV);
    let r0=cubicData[si*2u];let r1=cubicData[si*2u+1u];let p0=r0.xy;let c1c=r0.zw;let c2c=r1.xy;let p3=r1.zw;
    let a0=cubicPoint(p0,c1c,c2c,p3,t0);let b0=cubicPoint(p0,c1c,c2c,p3,t1);
    let sm=segmentMeta[si];let pa=morphPts[sm.x];let pb=morphPts[sm.y];let c0=copyData[ci*3u];let c1=copyData[ci*3u+1u];let c2=copyData[ci*3u+2u];
    let a=vec2<f32>(c0.x*a0.x+c0.y*a0.y,c1.x*a0.x+c1.y*a0.y);
    let b=vec2<f32>(c0.x*b0.x+c0.y*b0.y,c1.x*b0.x+c1.y*b0.y);
    let sp0=screenPoint(a);let sp1=screenPoint(b);let d=sp1-sp0;let len=max(length(d),0.0001);let dir=d/len;let normal=vec2<f32>(-dir.y,dir.x);
    let sc=max(0.000001,abs(c0.w));let ws0=mix(pa.z,pb.z,t0);let ws1=mix(pa.z,pb.z,t1);let hw0=max(0.18,u.params.x*sc*max(0.02,ws0));let hw1=max(0.18,u.params.x*sc*max(0.02,ws1));let gr=max(0.0,u.params.y*sc);let pad=max(hw0,hw1)+gr+2.0;
    let tx=(v.corner.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let p=sp0+dir*lx+normal*ly;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    o.local=vec2<f32>(lx,ly);o.segLen=len;o.halfWidth0=hw0;o.halfWidth1=hw1;o.glowRadius=gr;o.alpha=c0.z;o.color=vec4<f32>(c1.z,c1.w,c2.x,c2.y);return o;
}
@fragment fn fsMain(v:Vout)->@location(0) vec4<f32>{
    if(v.alpha<=0.00001||v.color.a<=0.00001){discard;}
    let cx=clamp(v.local.x,0.0,v.segLen);let q=cx/max(0.0001,v.segLen);let halfWidth=mix(v.halfWidth0,v.halfWidth1,q);let d=length(vec2<f32>(v.local.x-cx,v.local.y));
    var coverage=0.0;
    if(u.params.w>0.00001&&v.glowRadius>0.01){
        let edge=max(0.0,d-halfWidth);let z=edge/max(0.55,v.glowRadius*0.44);
        coverage=exp(-z*z*1.65)*(1.0-smoothstep(v.glowRadius*0.76,v.glowRadius+2.0,edge))*u.params.w;
    }else{
        coverage=clamp(halfWidth+0.75-d,0.0,1.0)*u.params.z;
    }
    let a=clamp(coverage*v.alpha*v.color.a,0.0,1.0);if(a<0.0001){discard;}
    return vec4<f32>(v.color.rgb*a,a);
}`;

    function resetGpu(){
        try{context?.unconfigure?.();}catch(_){}
        try{cornerBuffer?.destroy?.();}catch(_){}for(const b of uniformBuffers)try{b?.destroy?.();}catch(_){}try{copyBuffer?.destroy?.();}catch(_){}
        cornerBuffer=null;uniformBuffers=[];uniformBinds=[];uniformCursor=0;copyBuffer=null;copyBind=null;copyCapacity=0;copyPackedFrameId=-1;copyPackedLayer=null;copyPackedCount=0;copyData=new Float32Array(0);segmentBindCache=new WeakMap();renderBundleCache=new WeakMap();pipeline=null;context=null;format=null;width=0;height=0;
    }
    async function initAsync(){
        if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready&&!lost)return false;
        attempted=true;initializing=true;lastError='';
        try{
            if(typeof WebGPUDeviceHub==='undefined')throw new Error('WebGPUDeviceHub unavailable');
            const shared=await WebGPUDeviceHub.acquire();device=shared.device;hubGeneration=shared.generation;lost=false;
            context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU topology Morph canvas context unavailable');
            format=navigator.gpu.getPreferredCanvasFormat();
            const module=device.createShaderModule({label:'SpiroStar topology Morph base WGSL',code:WGSL});
            if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(module,'SpiroStar topology Morph base WGSL');
            const blend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
            pipeline=device.createRenderPipeline({label:'SpiroStar topology Morph base',layout:'auto',vertex:{module,entryPoint:'vsMain',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module,entryPoint:'fsMain',targets:[{format,blend}]},primitive:{topology:'triangle-strip',cullMode:'none'}});
            cornerBuffer=device.createBuffer({label:'SpiroStar topology Morph corners',size:32,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
            device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,1,1]));
            uniformBuffers=Array.from({length:32},(_,i)=>device.createBuffer({label:`SpiroStar topology Morph uniforms ${i}`,size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
            uniformBinds=uniformBuffers.map(buffer=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}));uniformCursor=0;
            ready=true;lastError='';try{requestMainCanvasRender?.();}catch(_){}return true;
        }catch(err){ready=false;lastError=String(err?.message||err);stats.errors++;if(lastLoggedError!==`init:${lastError}`){lastLoggedError=`init:${lastError}`;console.warn('[SpiroStar Topology Morph GPU] init:',err);}return false;}
        finally{initializing=false;}
    }
    function warmup(){
        const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration?.():-1;
        if(ready&&gen!==hubGeneration){ready=false;attempted=false;lost=true;resetGpu();}
        if(!ready&&!initializing&&(!attempted||lost)){lost=false;void initAsync();}
        if(typeof warmupGpuMorphArcResource==='function')warmupGpuMorphArcResource();
        return ready&&!lost;
    }
    function ensureSize(){
        if(!warmup())return false;const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);
        if(width===w&&height===h&&canvas.width===w&&canvas.height===h)return true;
        width=w;height=h;canvas.width=w;canvas.height=h;context.configure({device,format,alphaMode:'premultiplied'});return true;
    }
    function reason(frameCtx,mode='base'){
        if(!frameCtx)return'frame-missing';
        if(!frameCtx.topologyMorphEnabled||!frameCtx.morphFrameActive)return'not-topology-morph';
        if(frameCtx.geometryProvider!==frameCtx.blueMorphProvider)return'another-geometry-provider';
        if(frameCtx.geometryPlan?.kind!=='blue-prepared')return'geometry-kind-'+String(frameCtx.geometryPlan?.kind||'unknown');
        if(frameCtx.geometryPlan?.kind==='lightning')return'lightning';
        if(state?.morph?.mode==='circleSlide')return'circle-slide';
        if(state?.showRoundingGuides)return'rounding-guides';
        if(frameCtx.lineProfileStrokeOnly)return'profile-replaces-base';
        if(mode==='base'&&!frameCtx.lineDisplayEnabled)return'line-hidden';
        if(state?.fourierMode===true)return'fourier';
        const shared=typeof getSharedGpuMorphPathResource==='function'?getSharedGpuMorphPathResource(frameCtx.layerIndex):null;
        if(!shared?.bezierVisualRail)return'bezier-rail-unavailable';
        return'';
    }
    function isEligible(frameCtx,mode='base'){
        const r=reason(frameCtx,mode);lastDecision.eligible=!r;lastDecision.reason=r||'gpu-topology-base';lastDecision.mode=mode;lastDecision.layerIndex=Number(frameCtx?.layerIndex)||0;lastDecision.frameId=Number(frameCtx?.frameId)||0;return !r;
    }
    function ensureCopyCapacity(n){
        const need=Math.max(1,n|0);if(copyBuffer&&copyCapacity>=need)return true;
        const cap=Math.max(8,1<<Math.ceil(Math.log2(need)));try{copyBuffer?.destroy?.();}catch(_){}
        copyCapacity=cap;copyData=new Float32Array(cap*12);renderBundleCache=new WeakMap();copyBuffer=device.createBuffer({label:'SpiroStar topology Morph copies',size:copyData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});copyBind=device.createBindGroup({layout:pipeline.getBindGroupLayout(2),entries:[{binding:0,resource:{buffer:copyBuffer}}]});copyPackedFrameId=-1;copyPackedLayer=null;copyPackedCount=0;return true;
    }
    function segmentBind(rec){
        let bg=segmentBindCache.get(rec);if(bg)return bg;bg=device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:rec.cubicBuffer}},{binding:1,resource:{buffer:rec.outputBuffer}},{binding:2,resource:{buffer:rec.segmentMetaBuffer}}]});segmentBindCache.set(rec,bg);return bg;
    }
    function colorRgba(style){
        try{return GPUColorCache.rgba(style||'#ffffff');}catch(_){return[1,1,1,1];}
    }
    function packCopies(frameCtx){
        const fid=Number(frameCtx?.frameId)||Number(frameCtx?.frame?.id)||0,layerKey=frameCtx?.layer||null;
        if(copyBuffer&&copyPackedFrameId===fid&&copyPackedLayer===layerKey){stats.copyPackReuses++;return copyPackedCount;}
        const copies=state.tunnel?.active===true?frameCtx.visibleInstances?.copies:[{scale:1,copyId:0,position:0}],alphas=state.tunnel?.active===true?frameCtx.visibleInstances?.alphas:[1];
        const src=Array.isArray(copies)&&copies.length?copies:[{scale:1}],countMax=src.length;ensureCopyCapacity(countMax);let k=0;
        for(let i=0;i<countMax;i++){

            const ca=Math.max(0,Math.min(1,Number(alphas?.[i]??1)));if(ca<=.0001)continue;
            const copy=src[i]||{},sc=state.tunnel?.active===true?Math.max(.000001,Math.abs(Number(copy.scale)||0)):1;
            const ang=state.tunnel?.active===true&&typeof getMotionTunnelLagRadians==='function'?getMotionTunnelLagRadians(copy,frameCtx.layer):0,cs=Math.cos(ang),sn=Math.sin(ang);
            const style=state.tunnel?.active===true&&typeof getTunnelCopyColor==='function'?getTunnelCopyColor(frameCtx.tunnelBaseStrokeColor,copy,frameCtx.tunnelPaletteProfile):(frameCtx.lightningStroke||frameCtx.layer?.strokeColor||'#ffffff');
            const c=colorRgba(style),o=k*12;
            copyData[o]=sc*cs;copyData[o+1]=-sc*sn;copyData[o+2]=ca;copyData[o+3]=sc;
            copyData[o+4]=sc*sn;copyData[o+5]=sc*cs;copyData[o+6]=c[0];copyData[o+7]=c[1];
            copyData[o+8]=c[2];copyData[o+9]=c[3];copyData[o+10]=0;copyData[o+11]=0;k++;
        }
        if(k)device.queue.writeBuffer(copyBuffer,0,copyData.buffer,0,k*12*4);stats.uploads+=k*12*4;copyPackedFrameId=fid;copyPackedLayer=layerKey;copyPackedCount=k;return k;
    }
    function prepareUniforms(frameCtx,segmentCount,copyCount,ctx,mode,opts){
        const tr=ctx.getTransform(),a=Number(tr.a)||1,b=Number(tr.b)||0,c=Number(tr.c)||0,d=Number(tr.d)||1,e=Number(tr.e)||0,f=Number(tr.f)||0;
        const matrixScale=Math.sqrt(Math.max(1e-12,Math.abs(a*d-b*c))),combined=Math.max(.001,Math.abs(Number(frameCtx.combinedScale)||1)),outerScale=matrixScale/combined;
        const halfWidth=Math.max(.18,Math.max(.001,Number(frameCtx.strokeWidth)||1.5)*outerScale*.5);
        const glowRadius=mode==='glow'?Math.max(.5,Number(opts?.radiusPx)||0):0;
        const coreAlpha=mode==='base'?Math.max(0,Math.min(1,Number(opts?.alphaScale??1)))*Math.max(0,Math.min(1,Number(frameCtx.baseAlpha)||0)):0;
        const glowAlpha=mode==='glow'?Math.max(0,Math.min(1,Number(opts?.alphaScale??1)))*Math.max(0,Math.min(1,Number(frameCtx.baseAlpha)||0)):0;
        uniformF32.fill(0);uniformF32[0]=width;uniformF32[1]=height;uniformU32[2]=Math.max(0,segmentCount)>>>0;uniformU32[3]=Math.max(0,copyCount)>>>0;
        uniformF32[4]=a;uniformF32[5]=c;uniformF32[6]=e;uniformF32[8]=b;uniformF32[9]=d;uniformF32[10]=f;
        uniformF32[12]=halfWidth;uniformF32[13]=glowRadius;uniformF32[14]=coreAlpha;uniformF32[15]=glowAlpha;const slot=uniformCursor++%uniformBuffers.length,buffer=uniformBuffers[slot];device.queue.writeBuffer(buffer,0,uniformBytes);stats.uploads+=64;stats.uniformBindReuses++;return{bind:uniformBinds[slot],slot};
    }

    function renderBundleFor(rec,instanceCount,uniformRows,label){
        if(typeof device?.createRenderBundleEncoder!=='function')return null;
        let cache=renderBundleCache.get(rec);
        if(!cache||cache.copyBind!==copyBind){cache={copyBind,items:new Map()};renderBundleCache.set(rec,cache);}
        const key=`${instanceCount}|${uniformRows.map(row=>row.slot).join(':')}`;let hit=cache.items.get(key);
        if(hit){stats.bundleHits++;return hit;}
        try{
            const rbe=device.createRenderBundleEncoder({label,colorFormats:[format]});
            rbe.setPipeline(pipeline);rbe.setBindGroup(1,segmentBind(rec));rbe.setBindGroup(2,copyBind);rbe.setVertexBuffer(0,cornerBuffer);
            for(const row of uniformRows){rbe.setBindGroup(0,row.bind);rbe.draw(4,instanceCount);}
            const bundle=rbe.finish();hit={bundle,list:[bundle]};cache.items.set(key,hit);stats.bundleBuilds++;return hit;
        }catch(_){stats.bundleFallbacks++;return null;}
    }
    function composite(ctx){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.drawImage(canvas,0,0);ctx.restore();}

    function renderGlowAndBase(frameCtx,targetCtx,opts={}){
        if(!isEligible(frameCtx,'glow')||!isEligible(frameCtx,'base')||!ensureSize()){stats.fallbacks++;return false;}
        const rec=typeof getSharedGpuMorphPathResource==='function'?getSharedGpuMorphPathResource(frameCtx.layerIndex):null;
        if(!rec?.ready){lastDecision.reason='gpu-morph-path-not-ready';stats.fallbacks++;return false;}
        try{
            const t=typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(frameCtx.blueMorphProvider?.geometryT??frameCtx.geometryPlan?.progress):Math.max(0,Math.min(1,Number(frameCtx.blueMorphProvider?.geometryT??frameCtx.geometryPlan?.progress)||0));
            targetCtx.save();applyLayerFrameEffectTransform(targetCtx,frameCtx);const copyCount=packCopies(frameCtx);if(!copyCount){targetCtx.restore();return true;}
            const glowUniform=prepareUniforms(frameCtx,rec.segmentCount,copyCount,targetCtx,'glow',{radiusPx:Math.max(.5,Number(opts?.radiusPx)||0),alphaScale:Math.max(0,Math.min(1,Number(opts?.glowAlphaScale??1)))});
            const baseUniform=prepareUniforms(frameCtx,rec.segmentCount,copyCount,targetCtx,'base',{alphaScale:Math.max(0,Math.min(1,Number(opts?.baseAlphaScale??1)))});targetCtx.restore();
            const enc=device.createCommandEncoder({label:'SpiroStar topology Morph fused Glow+Base'});
            if(typeof encodeSharedGpuMorphPath!=='function'||!encodeSharedGpuMorphPath(enc,frameCtx.layerIndex,t)){lastDecision.reason='gpu-morph-compute-encode-failed';stats.fallbacks++;return false;}
            const pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
            const bundled=renderBundleFor(rec,rec.segmentCount*BEZIER_SUBDIV*copyCount,[glowUniform,baseUniform],'SpiroStar topology Morph fused bundle');
            if(bundled){pass.executeBundles(bundled.list);stats.bundleExecutes++;}
            else{pass.setPipeline(pipeline);pass.setBindGroup(1,segmentBind(rec));pass.setBindGroup(2,copyBind);pass.setVertexBuffer(0,cornerBuffer);pass.setBindGroup(0,glowUniform.bind);pass.draw(4,rec.segmentCount*BEZIER_SUBDIV*copyCount);pass.setBindGroup(0,baseUniform.bind);pass.draw(4,rec.segmentCount*BEZIER_SUBDIV*copyCount);}
            pass.end();
            device.queue.submit([enc.finish()]);try{noteSharedGpuMorphPathSubmitted?.(rec,t,frameCtx.frameId);}catch(_){}composite(targetCtx);
            const logical=rec.segmentCount*copyCount;stats.frames++;stats.glowFrames++;stats.baseFrames++;stats.fusedGlowBaseFrames++;stats.draws+=2;stats.segments+=logical*2;stats.copies+=copyCount;stats.cpuPathBuildsAvoided+=(Number(rec.pointCount)||rec.segmentCount);stats.arcBuildsAvoided+=rec.segmentCount;stats.submissionsAvoided++;stats.canvasCompositesAvoided++;
            if(typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer)){stats.spiralFrames++;stats.variableWidthSegments+=logical*2;}if(state.tunnel?.active===true)stats.corridorFrames++;lastDecision.reason='webgpu-fused-glow-base';return true;
        }catch(err){lastError=String(err?.message||err);lastDecision.reason=lastError;stats.errors++;stats.fallbacks++;return false;}
    }
    function render(frameCtx,targetCtx,opts={}){
        const mode=opts.mode==='glow'?'glow':'base';if(!isEligible(frameCtx,mode)){stats.fallbacks++;return false;}if(!ensureSize()){stats.fallbacks++;return false;}
        const rec=typeof getSharedGpuMorphPathResource==='function'?getSharedGpuMorphPathResource(frameCtx.layerIndex):null;
        if(!rec?.ready){lastDecision.reason='gpu-morph-path-not-ready';stats.fallbacks++;return false;}
        try{
            const t=typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(frameCtx.blueMorphProvider?.geometryT??frameCtx.geometryPlan?.progress):Math.max(0,Math.min(1,Number(frameCtx.blueMorphProvider?.geometryT??frameCtx.geometryPlan?.progress)||0));
            targetCtx.save();applyLayerFrameEffectTransform(targetCtx,frameCtx);const copyCount=packCopies(frameCtx);if(!copyCount){targetCtx.restore();return true;}
            const frameUniform=prepareUniforms(frameCtx,rec.segmentCount,copyCount,targetCtx,mode,opts);targetCtx.restore();
            const enc=device.createCommandEncoder({label:`SpiroStar topology Morph ${mode}`});
            if(typeof encodeSharedGpuMorphPath!=='function'||!encodeSharedGpuMorphPath(enc,frameCtx.layerIndex,t)){lastDecision.reason='gpu-morph-compute-encode-failed';stats.fallbacks++;return false;}
            const pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
            const bundled=renderBundleFor(rec,rec.segmentCount*BEZIER_SUBDIV*copyCount,[frameUniform],`SpiroStar topology Morph ${mode} bundle`);if(bundled){pass.executeBundles(bundled.list);stats.bundleExecutes++;}else{pass.setPipeline(pipeline);pass.setBindGroup(0,frameUniform.bind);pass.setBindGroup(1,segmentBind(rec));pass.setBindGroup(2,copyBind);pass.setVertexBuffer(0,cornerBuffer);pass.draw(4,rec.segmentCount*BEZIER_SUBDIV*copyCount);}pass.end();device.queue.submit([enc.finish()]);try{noteSharedGpuMorphPathSubmitted?.(rec,t,frameCtx.frameId);}catch(_){}
            composite(targetCtx);lastError='';lastLoggedError='';lastDecision.reason=(typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer))?'webgpu-variable-width-spiral':'webgpu';stats.frames++;stats.draws++;stats.segments+=rec.segmentCount*copyCount;stats.copies+=copyCount;stats.cpuPathBuildsAvoided+=Number(rec.pointCount)||rec.segmentCount;stats.arcBuildsAvoided+=rec.segmentCount;if(typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer)){stats.spiralFrames++;stats.variableWidthSegments+=rec.segmentCount*copyCount;}if(mode==='glow')stats.glowFrames++;else stats.baseFrames++;if(state.tunnel?.active===true)stats.corridorFrames++;return true;
        }catch(err){lastError=String(err?.message||err);lastDecision.reason=lastError;stats.errors++;stats.fallbacks++;if(lastLoggedError!==`draw:${lastError}`){lastLoggedError=`draw:${lastError}`;console.warn('[SpiroStar Topology Morph GPU] draw:',err);}return false;}
    }
    function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost&&(typeof WebGPUDeviceHub==='undefined'||WebGPUDeviceHub.isReady?.()!==false),attempted,initializing,lost,lastError,width,height,rasterBackend:'webgpu',presentation:'canvas2d-bridge',lastDecision:{...lastDecision},stats:{...stats},contract:'topology Morph base/glow reads one retained cubic per logical topology edge from SharedGpuMorphPath and evaluates it on WebGPU; straight/hard edges remain exact degenerate cubics, while Spiral/smooth rails share the same curved carrier as effects. Arc construction is reserved for effects that need arc distance. v531 fuses Glow+Base into one WebGPU submit/composite when no Fill/Web ordering barrier exists; v534 caches render bundles for stable pipeline/bind/vertex/draw state so rAF usually only updates resident uniforms and executes a bundle.'};}
    return{warmup,isReady:()=>warmup(),isEligible,reason,render,renderGlowAndBase,status};
})();
window.__spiroTopologyMorphGpuStatus=()=>WebGPUTopologyMorphBaseRenderer.status();
window.__spiroTopologyMorphRenderStatus=()=>{
    const s=WebGPUTopologyMorphBaseRenderer.status();
    try{console.info('[SpiroStar Topology Morph GPU]',s);}catch(_){}
    return s;
};
