

window.__spiroRegisterModule?.('js/gpu/green-project-morph-renderer');

const WebGPUGreenProjectMorphRenderer=(()=>{
    const canvas=document.createElement('canvas');
    let device=null,context=null,format=null,pipeline=null,cornerBuffer=null,uniformBuffers=[],uniformBinds=[],uniformCursor=0;
    let copyBuffer=null,copyCapacity=0,copyBind=null,copyData=new Float32Array(0);
    let attempted=false,initializing=false,ready=false,lost=false,lastError='',hubGeneration=-1,width=0,height=0;
    const resourceCache=new WeakMap(),resourceSet=new Set(),bindCache=new WeakMap();let renderBundleCache=new WeakMap();
    const uniformBytes=new ArrayBuffer(80),uf=new Float32Array(uniformBytes),uu=new Uint32Array(uniformBytes);
    const stats={frames:0,baseFrames:0,glowFrames:0,fusedGlowBaseFrames:0,crossfadeFrames:0,segments:0,copies:0,resourceBuilds:0,resourceBytes:0,uniformBindReuses:0,copyPackReuses:0,bundleBuilds:0,bundleHits:0,bundleExecutes:0,bundleFallbacks:0,submissionsAvoided:0,canvasCompositesAvoided:0,uploads:0,fallbacks:0,errors:0};
    const lastDecision={eligible:false,reason:'not-requested',layerIndex:-1,mode:'base'};

    const WGSL=`
struct U{
 viewport:vec2<f32>, segCount:u32, copyCount:u32,
 row0:vec4<f32>, row1:vec4<f32>,
 params0:vec4<f32>, // t, baseHalfWidth, glowRadius, coreAlpha
 params1:vec4<f32>, // glowAlpha, dprScale, parameterT, 0
};
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<storage,read> segData:array<vec4<f32>>;
@group(2) @binding(0) var<storage,read> copyData:array<vec4<f32>>;
struct O{
 @builtin(position) pos:vec4<f32>,
 @location(0) local:vec2<f32>,
 @location(1) @interpolate(flat) segLen:f32,
 @location(2) @interpolate(flat) hw0:f32,
 @location(3) @interpolate(flat) hw1:f32,
 @location(4) @interpolate(flat) glow:f32,
 @location(5) @interpolate(flat) alpha:f32,
 @location(6) @interpolate(flat) color:vec4<f32>,
};
fn screenPoint(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
@vertex fn vs(@location(0) corner:vec2<f32>,@builtin(instance_index) iid:u32)->O{
 var o:O;let n=max(1u,u.segCount);let si=iid%n;let ci=iid/n;let b=si*5u;
 let s0=segData[b];let s1=segData[b+1u];let sw=segData[b+2u];let al=segData[b+3u];
 let t=clamp(u.params0.x,0.0,1.0);let parameterT=clamp(u.params1.z,0.0,1.0);
 let a0=mix(s0.xy,s1.xy,t);let b0=mix(s0.zw,s1.zw,t);
 let cp0=copyData[ci*3u];let cp1=copyData[ci*3u+1u];let cp2=copyData[ci*3u+2u];
 let a=vec2<f32>(cp0.x*a0.x+cp0.y*a0.y,cp1.x*a0.x+cp1.y*a0.y);
 let bb=vec2<f32>(cp0.x*b0.x+cp0.y*b0.y,cp1.x*b0.x+cp1.y*b0.y);
 let p0=screenPoint(a);let p1=screenPoint(bb);let dv=p1-p0;let len=max(length(dv),.0001);let dir=dv/len;let normal=vec2<f32>(-dir.y,dir.x);
 let sc=max(.000001,abs(cp0.w));let w0=max(.02,mix(sw.x,sw.z,t));let w1=max(.02,mix(sw.y,sw.w,t));
 let hw0=max(.15,u.params0.y*sc*w0);let hw1=max(.15,u.params0.y*sc*w1);let glow=max(0.0,u.params0.z*sc);let pad=max(hw0,hw1)+glow+2.0;
 let tx=(corner.x+1.0)*.5;let lx=mix(-pad,len+pad,tx);let ly=corner.y*pad;let p=p0+dir*lx+normal*ly;
 let pairAlpha=mix(al.x,al.y,parameterT);let segAlpha=mix(al.z,al.w,parameterT);
 o.pos=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.hw0=hw0;o.hw1=hw1;o.glow=glow;o.alpha=cp0.z*pairAlpha*segAlpha;o.color=vec4<f32>(cp1.z,cp1.w,cp2.x,cp2.y);return o;
}
@fragment fn fs(v:O)->@location(0) vec4<f32>{
 if(v.alpha<=.00001||v.color.a<=.00001){discard;}let x=clamp(v.local.x,0.0,v.segLen);let q=x/max(.0001,v.segLen);let hw=mix(v.hw0,v.hw1,q);let d=length(vec2<f32>(v.local.x-x,v.local.y));var cov=0.0;
 if(u.params1.x>0.00001&&v.glow>.01){let edge=max(0.0,d-hw);let z=edge/max(.55,v.glow*.44);cov=exp(-z*z*1.65)*(1.0-smoothstep(v.glow*.76,v.glow+2.0,edge))*u.params1.x;}else{cov=clamp(hw+.8-d,0.0,1.0)*u.params0.w;}
 let a=clamp(cov*v.alpha*v.color.a,0.0,1.0);if(a<.0001){discard;}return vec4<f32>(v.color.rgb*a,a);
}`;

    function destroyRec(rec){if(!rec)return;try{rec.buffer?.destroy?.();}catch(_){}resourceSet.delete(rec);}
    function reset(){try{context?.unconfigure?.();}catch(_){}for(const r of resourceSet)destroyRec(r);resourceSet.clear();try{cornerBuffer?.destroy?.();}catch(_){}for(const b of uniformBuffers)try{b?.destroy?.();}catch(_){}try{copyBuffer?.destroy?.();}catch(_){}cornerBuffer=copyBuffer=null;uniformBuffers=[];uniformBinds=[];uniformCursor=0;copyBind=pipeline=context=null;renderBundleCache=new WeakMap();copyCapacity=0;copyData=new Float32Array(0);copyPackedFrameId=-1;copyPackedLayer=null;copyPackedCount=0;width=height=0;}
    async function initAsync(){if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready&&!lost)return false;attempted=true;initializing=true;lastError='';try{const shared=await WebGPUDeviceHub.acquire();device=shared.device;hubGeneration=shared.generation;format=navigator.gpu.getPreferredCanvasFormat();context=canvas.getContext('webgpu');if(!context)throw new Error('green Morph WebGPU canvas unavailable');const mod=device.createShaderModule({label:'SpiroStar green project Morph WGSL',code:WGSL});if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(mod,'SpiroStar green project Morph WGSL');const blend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};pipeline=device.createRenderPipeline({label:'SpiroStar green project Morph',layout:'auto',vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend}]},primitive:{topology:'triangle-strip'}});cornerBuffer=device.createBuffer({label:'green Morph corners',size:32,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,1,1]));uniformBuffers=Array.from({length:32},(_,i)=>device.createBuffer({label:`green Morph uniforms ${i}`,size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));uniformBinds=uniformBuffers.map(buffer=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}));uniformCursor=0;ready=true;lost=false;requestMainCanvasRender?.();return true;}catch(err){ready=false;lastError=String(err?.message||err);stats.errors++;return false;}finally{initializing=false;}}
    function warmup(){const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration?.():-1;if(ready&&gen!==hubGeneration){ready=false;attempted=false;lost=true;reset();}if(!ready&&!initializing&&(!attempted||lost)){lost=false;void initAsync();}return ready&&!lost;}
    function ensureSize(){if(!warmup())return false;const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);if(width===w&&height===h&&canvas.width===w&&canvas.height===h)return true;width=w;height=h;canvas.width=w;canvas.height=h;context.configure({device,format,alphaMode:'premultiplied'});return true;}
    function reason(frameCtx){if(!frameCtx?.greenMorphEnabled)return'not-green-morph';if(!['green-morph','green-fade'].includes(frameCtx.geometryPlan?.kind))return'not-green-geometry';if(!frameCtx.greenMorphProvider?.gpuGeometryPlan?.pairs?.length)return'green-plan-missing';if(frameCtx.lineProfileStrokeOnly)return'profile-replaces-base';if(state.showRoundingGuides)return'rounding-guides';return'';}
    function isEligible(frameCtx){const r=reason(frameCtx);lastDecision.eligible=!r;lastDecision.reason=r||'gpu-green-project-morph';lastDecision.layerIndex=Number(frameCtx?.layerIndex)||0;return !r;}
    function buildResource(plan){let rec=resourceCache.get(plan);if(rec&&rec.generation===hubGeneration)return rec;if(rec)destroyRec(rec);const arr=[];let count=0;for(const pair of plan.pairs||[]){const src=pair.src||[],dst=pair.dst||[],n=Math.min(src.length,dst.length);if(n<2)continue;const closedSrc=pair.srcClosed===true,closedDst=pair.dstClosed===true;const sw=Number.isFinite(Number(pair.sourceWeight))?Number(pair.sourceWeight):1,tw=Number.isFinite(Number(pair.targetWeight))?Number(pair.targetWeight):1;const bothClosed=closedSrc&&closedDst;const map=(i)=>bothClosed?(((pair.reverse?pair.offset-i:i+pair.offset)%n+n)%n):(pair.reverse?n-1-i:i);const emit=(ia,ib,closeA=1,closeB=1)=>{const ja=map(ia),jb=map(ib),a=src[ia],b=src[ib],c=dst[ja],d=dst[jb];arr.push(Number(a.x)||0,Number(a.y)||0,Number(b.x)||0,Number(b.y)||0,Number(c.x)||0,Number(c.y)||0,Number(d.x)||0,Number(d.y)||0,Math.max(.02,Number(a.widthScale)||1),Math.max(.02,Number(b.widthScale)||1),Math.max(.02,Number(c.widthScale)||1),Math.max(.02,Number(d.widthScale)||1),sw,tw,closeA,closeB,0,0,0,0);count++;};for(let i=0;i<n-1;i++)emit(i,i+1,1,1);if(closedSrc||closedDst)emit(n-1,0,closedSrc?1:0,closedDst?1:0);}if(!count)return null;const data=new Float32Array(arr),buffer=device.createBuffer({label:'green project Morph segments',size:Math.ceil(data.byteLength/16)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,data.buffer,data.byteOffset,data.byteLength);rec={buffer,count,generation:hubGeneration,bytes:data.byteLength};resourceCache.set(plan,rec);resourceSet.add(rec);stats.resourceBuilds++;stats.resourceBytes+=data.byteLength;return rec;}
    function bindFor(rec){let bg=bindCache.get(rec);if(bg)return bg;bg=device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:rec.buffer}}]});bindCache.set(rec,bg);return bg;}
    function ensureCopyCapacity(n){const need=Math.max(1,n|0);if(copyBuffer&&copyCapacity>=need)return;const cap=Math.max(8,1<<Math.ceil(Math.log2(need)));try{copyBuffer?.destroy?.();}catch(_){}copyCapacity=cap;copyData=new Float32Array(cap*12);renderBundleCache=new WeakMap();copyBuffer=device.createBuffer({label:'green Morph copies',size:copyData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});copyBind=device.createBindGroup({layout:pipeline.getBindGroupLayout(2),entries:[{binding:0,resource:{buffer:copyBuffer}}]});copyPackedFrameId=-1;copyPackedLayer=null;copyPackedCount=0;}
    function rgba(style){try{return GPUColorCache.rgba(style||'#fff');}catch(_){return[1,1,1,1];}}
    function packCopies(frameCtx,styleLayer=null){const layer=styleLayer||frameCtx.layer,fid=Number(frameCtx?.frameId)||Number(frameCtx?.frame?.id)||0;if(copyBuffer&&copyPackedFrameId===fid&&copyPackedLayer===layer){stats.copyPackReuses++;return copyPackedCount;}const copies=state.tunnel?.active===true?frameCtx.visibleInstances?.copies:[{scale:1}],alphas=state.tunnel?.active===true?frameCtx.visibleInstances?.alphas:[1],src=Array.isArray(copies)&&copies.length?copies:[{scale:1}];ensureCopyCapacity(src.length);let k=0;for(let i=0;i<src.length;i++){const ca=Math.max(0,Math.min(1,Number(alphas?.[i]??1)));if(ca<=.0001)continue;const copy=src[i]||{},sc=state.tunnel?.active===true?Math.max(.000001,Math.abs(Number(copy.scale)||0)):1,ang=state.tunnel?.active===true&&typeof getMotionTunnelLagRadians==='function'?getMotionTunnelLagRadians(copy,layer):0,cs=Math.cos(ang),sn=Math.sin(ang),baseColor=layer?.strokeColor||frameCtx.tunnelBaseStrokeColor||'#fff',style=state.tunnel?.active===true&&typeof getTunnelCopyColor==='function'?getTunnelCopyColor(baseColor,copy,frameCtx.tunnelPaletteProfile):baseColor,c=rgba(style),o=k*12;copyData[o]=sc*cs;copyData[o+1]=-sc*sn;copyData[o+2]=ca;copyData[o+3]=sc;copyData[o+4]=sc*sn;copyData[o+5]=sc*cs;copyData[o+6]=c[0];copyData[o+7]=c[1];copyData[o+8]=c[2];copyData[o+9]=c[3];copyData[o+10]=copyData[o+11]=0;k++;}if(k){device.queue.writeBuffer(copyBuffer,0,copyData.buffer,0,k*48);stats.uploads+=k*48;}copyPackedFrameId=fid;copyPackedLayer=layer;copyPackedCount=k;return k;}
    function prepareUniform(frameCtx,rec,k,targetCtx,mode,opts){targetCtx.save();applyLayerFrameEffectTransform(targetCtx,frameCtx);const tr=targetCtx.getTransform();targetCtx.restore();const a=Number(tr.a)||1,b=Number(tr.b)||0,c=Number(tr.c)||0,d=Number(tr.d)||1,e=Number(tr.e)||0,f=Number(tr.f)||0,matrixScale=Math.sqrt(Math.max(1e-12,Math.abs(a*d-b*c))),combined=Math.max(.001,Math.abs(Number(frameCtx.combinedScale)||1)),outer=matrixScale/combined,morphT=Number.isFinite(Number(opts?.morphTOverride))?Number(opts.morphTOverride):Number(frameCtx.greenMorphProvider?.progress)||0,parameterT=Number.isFinite(Number(opts?.parameterTOverride))?Number(opts.parameterTOverride):(Number.isFinite(Number(frameCtx.greenMorphProvider?.parameterProgress))?Number(frameCtx.greenMorphProvider.parameterProgress):morphT),strokeWidth=Number.isFinite(Number(opts?.strokeWidthOverride))?Number(opts.strokeWidthOverride):(Number(frameCtx.strokeWidth)||1.5),baseAlpha=Number.isFinite(Number(opts?.baseAlphaOverride))?Number(opts.baseAlphaOverride):(Number(frameCtx.baseAlpha)||0);uf.fill(0);uf[0]=width;uf[1]=height;uu[2]=rec.count>>>0;uu[3]=k>>>0;uf[4]=a;uf[5]=c;uf[6]=e;uf[8]=b;uf[9]=d;uf[10]=f;uf[12]=Math.max(0,Math.min(1,morphT));uf[13]=Math.max(.15,strokeWidth*outer*.5);uf[14]=mode==='glow'?Math.max(.5,Number(opts?.radiusPx)||0):0;uf[15]=mode==='base'?Math.max(0,Math.min(1,baseAlpha))*Math.max(0,Math.min(1,Number(opts?.alphaScale??1))):0;uf[16]=mode==='glow'?Math.max(0,Math.min(1,baseAlpha))*Math.max(0,Math.min(1,Number(opts?.alphaScale??1))):0;uf[17]=Number(frameCtx.frame?.dpr)||1;uf[18]=Math.max(0,Math.min(1,parameterT));const slot=uniformCursor++%uniformBuffers.length,buffer=uniformBuffers[slot];device.queue.writeBuffer(buffer,0,uniformBytes);stats.uploads+=80;stats.uniformBindReuses++;return{bind:uniformBinds[slot],slot};}

    function renderBundleFor(rec,instanceCount,uniformRows,label){if(typeof device?.createRenderBundleEncoder!=='function')return null;let cache=renderBundleCache.get(rec);if(!cache||cache.copyBind!==copyBind){cache={copyBind,items:new Map()};renderBundleCache.set(rec,cache);}const key=`${instanceCount}|${uniformRows.map(row=>row.slot).join(':')}`;let hit=cache.items.get(key);if(hit){stats.bundleHits++;return hit;}try{const rbe=device.createRenderBundleEncoder({label,colorFormats:[format]});rbe.setPipeline(pipeline);rbe.setBindGroup(1,bindFor(rec));rbe.setBindGroup(2,copyBind);rbe.setVertexBuffer(0,cornerBuffer);for(const row of uniformRows){rbe.setBindGroup(0,row.bind);rbe.draw(4,instanceCount);}const bundle=rbe.finish();hit={bundle,list:[bundle]};cache.items.set(key,hit);stats.bundleBuilds++;return hit;}catch(_){stats.bundleFallbacks++;return null;}}
    function composite(ctx){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';ctx.drawImage(canvas,0,0);ctx.restore();}
    function renderPass(frameCtx,targetCtx,rec,mode,opts,styleLayer=null){const k=packCopies(frameCtx,styleLayer);if(!k)return true;const frameUniform=prepareUniform(frameCtx,rec,k,targetCtx,mode,opts);const enc=device.createCommandEncoder({label:`green project Morph ${mode}`}),pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});const bundled=renderBundleFor(rec,rec.count*k,[frameUniform],`green project Morph ${mode} bundle`);if(bundled){pass.executeBundles(bundled.list);stats.bundleExecutes++;}else{pass.setPipeline(pipeline);pass.setBindGroup(0,frameUniform.bind);pass.setBindGroup(1,bindFor(rec));pass.setBindGroup(2,copyBind);pass.setVertexBuffer(0,cornerBuffer);pass.draw(4,rec.count*k);}pass.end();device.queue.submit([enc.finish()]);composite(targetCtx);stats.segments+=rec.count*k;stats.copies+=k;return true;}
    function endpointOptions(frameCtx,opts,layer,t,weight){const mul=typeof getLayerStrokeWidthMultiplier==='function'?getLayerStrokeWidthMultiplier(layer):1,visible=layer?.visible!==false,opacity=visible?Math.max(0,Math.min(1,Number(layer?.opacity??100)/100)):0;return{...opts,morphTOverride:t,parameterTOverride:t,strokeWidthOverride:Math.max(.001,(Number(layer?.strokeWidth)||1.5)*mul),baseAlphaOverride:opacity,alphaScale:Math.max(0,Math.min(1,Number(opts?.alphaScale??1)))*Math.max(0,Math.min(1,weight))};}

    function renderGlowAndBase(frameCtx,targetCtx,opts={}){
        lastDecision.mode='glow+base';if(!isEligible(frameCtx)||frameCtx.geometryPlan?.kind==='green-fade'||!ensureSize()){stats.fallbacks++;return false;}
        try{
            const provider=frameCtx.greenMorphProvider,plan=provider.gpuGeometryPlan,rec=buildResource(plan);if(!rec){stats.fallbacks++;return false;}const k=packCopies(frameCtx,frameCtx.layer);if(!k)return true;
            const glowUniform=prepareUniform(frameCtx,rec,k,targetCtx,'glow',{...opts,radiusPx:Math.max(.5,Number(opts?.radiusPx)||0),alphaScale:Math.max(0,Math.min(1,Number(opts?.glowAlphaScale??1)))});
            const baseUniform=prepareUniform(frameCtx,rec,k,targetCtx,'base',{...opts,alphaScale:Math.max(0,Math.min(1,Number(opts?.baseAlphaScale??1)))});
            const enc=device.createCommandEncoder({label:'green project Morph fused Glow+Base'}),pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
            const bundled=renderBundleFor(rec,rec.count*k,[glowUniform,baseUniform],'green project Morph fused bundle');if(bundled){pass.executeBundles(bundled.list);stats.bundleExecutes++;}else{pass.setPipeline(pipeline);pass.setBindGroup(1,bindFor(rec));pass.setBindGroup(2,copyBind);pass.setVertexBuffer(0,cornerBuffer);pass.setBindGroup(0,glowUniform.bind);pass.draw(4,rec.count*k);pass.setBindGroup(0,baseUniform.bind);pass.draw(4,rec.count*k);}pass.end();device.queue.submit([enc.finish()]);composite(targetCtx);
            stats.frames++;stats.glowFrames++;stats.baseFrames++;stats.fusedGlowBaseFrames++;stats.segments+=rec.count*k*2;stats.copies+=k;stats.submissionsAvoided++;stats.canvasCompositesAvoided++;lastDecision.reason='webgpu-fused-glow-base';return true;
        }catch(err){lastError=String(err?.message||err);lastDecision.reason=lastError;stats.errors++;stats.fallbacks++;return false;}
    }
    function render(frameCtx,targetCtx,opts={}){const mode=opts.mode==='glow'?'glow':'base';lastDecision.mode=mode;if(!isEligible(frameCtx)||!ensureSize()){stats.fallbacks++;return false;}try{const provider=frameCtx.greenMorphProvider,plan=provider.gpuGeometryPlan,rec=buildResource(plan);if(!rec){stats.fallbacks++;return false;}if(frameCtx.geometryPlan?.kind==='green-fade'){const t=Math.max(0,Math.min(1,Number(provider.progress)||0)),src=provider.sourceLayer||frameCtx.layer,dst=provider.targetLayer||frameCtx.layer;if(t<.9999)renderPass(frameCtx,targetCtx,rec,mode,endpointOptions(frameCtx,opts,src,0,1-t),src);if(t>.0001)renderPass(frameCtx,targetCtx,rec,mode,endpointOptions(frameCtx,opts,dst,1,t),dst);stats.crossfadeFrames++;}else renderPass(frameCtx,targetCtx,rec,mode,opts,frameCtx.layer);stats.frames++;if(mode==='glow')stats.glowFrames++;else stats.baseFrames++;lastDecision.reason='webgpu';return true;}catch(err){lastError=String(err?.message||err);lastDecision.reason=lastError;stats.errors++;stats.fallbacks++;return false;}}

    function acquireEndpointResource(plan){if(!plan?.pairs?.length||!warmup())return null;try{return buildResource(plan);}catch(_){return null;}}
    async function awaitGreenRendererReady(timeoutMs=3000){
        if(ready&&!lost)return true;
        const started=performance.now();
        if(!initializing){const ok=await initAsync();if(ok)return true;}
        while(initializing&&performance.now()-started<Math.max(250,Number(timeoutMs)||3000))await new Promise(resolve=>setTimeout(resolve,0));
        return ready&&!lost;
    }

    async function prewarmPlans(plans){
        if(!globalThis.navigator?.gpu)return false;
        if(!await awaitGreenRendererReady())return false;
        let built=0;
        try{
            for(const plan of Array.isArray(plans)?plans:[]){
                if(!plan?.pairs?.length)continue;
                const rec=buildResource(plan);if(!rec)continue;bindFor(rec);built++;
            }
            return built>0;
        }catch(err){lastError=String(err?.message||err);return false;}
    }
    function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost,attempted,initializing,lastError,lastDecision:{...lastDecision},stats:{...stats},contract:'green project Morph keeps endpoint correspondence CPU-side once; geometryT and linear parameterT are independent GPU uniforms (no hidden second easing); advanced/smooth XY + variable-width interpolation rasterize on WebGPU; v531 fuses Glow+Base into one submit/composite when no Fill/Web ordering barrier exists; auxiliary effects may reuse the same immutable endpoint GPU buffer; v534 render bundles retain stable pipeline/bind/vertex/draw encoding across display frames'};}
    return{warmup,isReady:()=>warmup(),isEligible,reason,render,renderGlowAndBase,acquireEndpointResource,prewarmPlans,status};
})();
window.__spiroGreenProjectMorphGPUStatus=()=>WebGPUGreenProjectMorphRenderer.status();
