

window.__spiroRegisterModule?.('js/gpu/profile-arc-marker-renderer');

const WebGPUProfileArcMarkerRenderer = (() => {
    let device=null,generation=-1,format=null,ready=false,initializing=null,lastError='';
    let pipeline=null,corridorPipeline=null,cornerBuffer=null,dummyCopyBuffer=null;
    const targetViews=new WeakMap(),normalArcBinds=new WeakMap(),corridorArcBinds=new WeakMap();
    const uniformRecords=new WeakMap(),uniformRecordSet=new Set();
    const stats={frames:0,draws:0,corridorDraws:0,arcBinds:0,arcBindHits:0,corridorBindHits:0,uniformBuilds:0,uniformUploads:0,uniformUploadSkips:0,arcPrerequisiteReuses:0,errors:0};
    const uF32=new Float32Array(24);

    const WGSL=`
struct Uniforms {
    viewport: vec2<f32>, markerType: f32, aaLocal: f32,
    row0: vec4<f32>, row1: vec4<f32>, params: vec4<f32>, color: vec4<f32>, extra: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var<storage,read> morphArcSegments: array<vec4<f32>>;
@group(1) @binding(1) var<storage,read> morphArcMeta: array<vec4<f32>>;
@group(1) @binding(2) var<storage,read> retainedProfileCubics: array<vec4<f32>>;
struct ProfileCopy { row0: vec4<f32>, row1: vec4<f32>, };
@group(1) @binding(3) var<storage,read> profileCopies: array<ProfileCopy>;
struct CornerIn { @location(0) corner: vec2<f32>, };
struct VSOut { @builtin(position) position: vec4<f32>, @location(0) local: vec2<f32>, @location(1) @interpolate(flat) copyAlpha: f32, @location(2) @interpolate(flat) aaLocal: f32, };

fn cubicDerivativeProfile(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let s=1.0-t;return 3.0*s*s*(c1-p0)+6.0*s*t*(c2-c1)+3.0*t*t*(p3-c2);}
fn arcCorrectProfileMicroT(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,sub:u32,subdiv:u32,f0:f32)->f32{
    let f=clamp(f0,0.0,1.0);let sd=max(1u,subdiv);let t0=f32(sub)/f32(sd);let t1=f32(sub+1u)/f32(sd);if(f<=0.000001){return t0;}if(f>=0.999999){return t1;}
    let s0=max(0.000001,length(cubicDerivativeProfile(p0,c1,c2,p3,t0)));let s1=max(0.000001,length(cubicDerivativeProfile(p0,c1,c2,p3,t1)));let dv=s1-s0;let arcTarget=f*max(0.000001,s0+0.5*dv);let disc=max(0.000000000001,s0*s0+2.0*dv*arcTarget);let q=clamp((2.0*arcTarget)/max(0.000001,s0+sqrt(disc)),0.0,1.0);return mix(t0,t1,q);
}
fn retainedProfilePoint(globalMicro:u32,microT:f32)->vec2<f32>{
    let subdiv=max(1u,u32(u.extra.w+0.5));let logical=globalMicro/subdiv;let sub=globalMicro%subdiv;let q0=retainedProfileCubics[logical*2u];let q1=retainedProfileCubics[logical*2u+1u];let t=arcCorrectProfileMicroT(q0.xy,q0.zw,q1.xy,q1.zw,sub,subdiv,microT);let a=mix(q0.xy,q0.zw,t);let b=mix(q0.zw,q1.xy,t);let c=mix(q1.xy,q1.zw,t);return mix(mix(a,b,t),mix(b,c,t),t);
}
fn sampleGlobalArc(fraction:f32)->vec2<f32>{
    let metaData=morphArcMeta[0];let total=max(0.000001,metaData.x);let n=max(1u,u32(metaData.y+0.5));let arcTarget=clamp(fraction,0.0,0.99999994)*total;var lo=0u;var hi=n-1u;
    loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;let q=morphArcSegments[mid*2u+1u];if(q.x+q.y<arcTarget){lo=mid+1u;}else{hi=mid;}}
    let q=morphArcSegments[lo*2u+1u];let f=select(0.0,clamp((arcTarget-q.x)/q.y,0.0,1.0),q.y>0.0000001);return retainedProfilePoint(lo,f);
}
fn markerLocal(corner:vec2<f32>,aa:f32)->vec2<f32>{let isSlash=u.markerType<0.5;let pad=max(0.0,u.extra.z)+aa*1.5;let ex=select(u.params.z+pad,u.params.x+pad,isSlash);let ey=select(u.params.z+pad,u.params.y+pad,isSlash);return vec2<f32>(corner.x*ex,corner.y*ey);}
fn markerOffset(corner:vec2<f32>,aa:f32)->vec2<f32>{let q=markerLocal(corner,aa);let c=0.7071067811865476;return vec2<f32>(c*(q.x-q.y),c*(q.x+q.y));}
fn toScreen(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
fn markerOut(corner:vec2<f32>,iid:u32,useCopy:bool)->VSOut{
    var o:VSOut;let markerCount=max(1u,u32(u.extra.x+0.5));let mi=select(iid,iid%markerCount,useCopy);let ci=select(0u,iid/markerCount,useCopy);let center=sampleGlobalArc((f32(mi)+0.5)/f32(markerCount));var copyAlpha=1.0;var aa=u.aaLocal;var localP=center+markerOffset(corner,aa);
    if(useCopy){let cp=profileCopies[ci];aa=u.aaLocal/max(0.000001,cp.row1.z);localP=center+markerOffset(corner,aa);localP=vec2<f32>(cp.row0.x*localP.x+cp.row0.y*localP.y,cp.row1.x*localP.x+cp.row1.y*localP.y);copyAlpha=cp.row0.z;}
    let screen=toScreen(localP);o.position=vec4<f32>(screen.x/u.viewport.x*2.0-1.0,1.0-screen.y/u.viewport.y*2.0,0.0,1.0);o.local=markerLocal(corner,aa);o.copyAlpha=copyAlpha;o.aaLocal=aa;return o;
}
@vertex fn vsArc(v:CornerIn,@builtin(instance_index) iid:u32)->VSOut{return markerOut(v.corner,iid,false);}
@vertex fn vsArcCorridor(v:CornerIn,@builtin(instance_index) iid:u32)->VSOut{return markerOut(v.corner,iid,true);}
fn markerSd(p:vec2<f32>)->f32{
    if(u.markerType<0.5){let cx=clamp(p.x,-u.params.x,u.params.x);return length(vec2<f32>(p.x-cx,p.y))-u.params.y;}
    if(u.markerType<1.5){return max(abs(p.x),abs(p.y))-u.params.z;}
    if(u.markerType<2.5){return length(p)-u.params.z;}
    let arm=u.params.z;let bar=max(0.55,arm*0.24);let dh=max(abs(p.x)-arm,abs(p.y)-bar);let dv=max(abs(p.y)-arm,abs(p.x)-bar);return min(dh,dv);
}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let aa=max(0.0001,v.aaLocal);let sd=markerSd(v.local);let mode=i32(u.extra.y+0.5);var cov=0.0;
    if(mode==1){let r=max(aa,u.extra.z);let q=max(0.0,sd)/r;cov=exp(-3.35*q*q)*(1.0-smoothstep(0.86,1.08,q));}
    else if(mode==2){let ex=max(aa,u.extra.z);cov=(1.0-smoothstep(ex,ex+aa,sd))*smoothstep(-aa,aa,sd);}
    else{cov=1.0-smoothstep(0.0,aa,sd);}
    let a=clamp(u.color.a*u.params.w*v.copyAlpha*cov,0.0,1.0);if(a<0.00015){discard;}return vec4<f32>(u.color.rgb*a,a);
}`;

    function reset(){ready=false;pipeline=corridorPipeline=null;try{cornerBuffer?.destroy?.();}catch(_){}try{dummyCopyBuffer?.destroy?.();}catch(_){}cornerBuffer=dummyCopyBuffer=null;for(const rec of uniformRecordSet)try{rec.buffer?.destroy?.();}catch(_){}uniformRecordSet.clear();device=null;generation=-1;}
    async function ensureReady(){
        const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration?.():-1;if(ready&&device&&gen===generation)return true;if(initializing)return initializing;if(ready&&gen!==generation)reset();
        initializing=(async()=>{try{const shared=await WebGPUDeviceHub.acquire();device=shared.device;generation=shared.generation;format=navigator.gpu.getPreferredCanvasFormat();const mod=device.createShaderModule({label:'Somata Spiral profile Arc markers WGSL',code:WGSL});if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(mod,'Somata Spiral profile Arc markers WGSL');const target={format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}};pipeline=device.createRenderPipeline({label:'Somata Spiral profile Arc markers',layout:'auto',vertex:{module:mod,entryPoint:'vsArc',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:mod,entryPoint:'fsMain',targets:[target]},primitive:{topology:'triangle-list'}});corridorPipeline=device.createRenderPipeline({label:'Somata Spiral Corridor profile Arc markers',layout:'auto',vertex:{module:mod,entryPoint:'vsArcCorridor',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:mod,entryPoint:'fsMain',targets:[target]},primitive:{topology:'triangle-list'}});cornerBuffer=device.createBuffer({label:'Somata profile Arc marker corners',size:48,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));dummyCopyBuffer=device.createBuffer({label:'Somata profile Arc dummy copy',size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(dummyCopyBuffer,0,new Float32Array([1,0,1,0,0,1,1,0]));ready=true;lastError='';

            try{requestMainCanvasRender?.();}catch(_){}
            return true;}catch(err){lastError=String(err?.message||err);stats.errors++;ready=false;return false;}finally{initializing=null;}})();return initializing;
    }
    function warmup(){void ensureReady();return ready;}
    function rgba(css){if(typeof GPUColorCache!=='undefined'&&GPUColorCache.rgba)return GPUColorCache.rgba(css);const s=String(css||'#fff').trim();if(/^#[0-9a-f]{6}$/i.test(s))return[parseInt(s.slice(1,3),16)/255,parseInt(s.slice(3,5),16)/255,parseInt(s.slice(5,7),16)/255,1];return[1,1,1,1];}
    function same(a,b){for(let i=0;i<24;i++)if(a[i]!==b[i])return false;return true;}
    function uniformRecord(layer,key){let map=uniformRecords.get(layer);if(!map){map=new Map();uniformRecords.set(layer,map);}let rec=map.get(key);if(rec&&rec.generation===generation)return rec;const buffer=device.createBuffer({label:`Somata profile Arc marker uniform ${key}`,size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});rec={buffer,generation,snapshot:new Float32Array(24),hasLast:false,normalBind:device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]}),corridorBind:device.createBindGroup({layout:corridorPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]})};map.set(key,rec);uniformRecordSet.add(rec);stats.uniformBuilds++;return rec;}
    function prepareUniform(layer,alpha,ctx,prepared,count,subdiv,opts={}){const type=prepared?.type||layer?.lineProfile,tr=ctx?.getTransform?.(),a=Number(tr?.a)||1,b=Number(tr?.b)||0,c=Number(tr?.c)||0,d=Number(tr?.d)||1,e=Number(tr?.e)||0,f=Number(tr?.f)||0,scale=Math.sqrt(Math.max(1e-12,Math.abs(a*d-b*c))),baseW=Math.max(.001,Number(prepared?.w)||Math.max(.5,Number(layer?.strokeWidth)||1.5)),w=Math.max(.001,baseW+(Number(opts.widthDeltaLocal)||0)),spacing=Math.max(2.4,Number(prepared?.spacing)||baseW*(type==='slash'?1.85:1.55)),halfLen=type==='slash'?Math.max(w*1.25,spacing*.58):0,halfWidth=type==='slash'?Math.max(.65,w*.78)*.5:0,halfSize=type==='circle'?Math.max(.9,w*.72):Math.max(1.4,Math.max(w*1.35,spacing*.78))*.5,col=rgba(opts.colorOverride||layer?.strokeColor||'#ffffff'),globalAlpha=Math.max(0,Math.min(1,Number(alpha)||0)),markerType=type==='square'?1:type==='circle'?2:type==='cross'?3:0,effectMode=opts.mode==='glow'?1:opts.mode==='outline'?2:0,extraLocal=Math.max(0,Number.isFinite(Number(opts.extraLocal))?Number(opts.extraLocal):(Number(opts.extraPx)||0)/Math.max(.0001,scale));uF32.fill(0);uF32[0]=Math.max(1,Number(mainCanvas?.width)||1);uF32[1]=Math.max(1,Number(mainCanvas?.height)||1);uF32[2]=markerType;uF32[3]=Math.max(.0001,.75/Math.max(.0001,scale));uF32[4]=a;uF32[5]=c;uF32[6]=e;uF32[8]=b;uF32[9]=d;uF32[10]=f;uF32[12]=halfLen;uF32[13]=halfWidth;uF32[14]=halfSize;uF32[15]=globalAlpha;uF32[16]=col[0];uF32[17]=col[1];uF32[18]=col[2];uF32[19]=col[3];uF32[20]=count;uF32[21]=effectMode;uF32[22]=extraLocal;uF32[23]=Math.max(1,Number(subdiv)||6);const uniformKey=`${type}|${effectMode}|${Number(opts.widthDeltaLocal)||0}|${extraLocal}|${String(opts.colorOverride||'')}`;const rec=uniformRecord(layer,uniformKey);if(!rec.hasLast||!same(uF32,rec.snapshot)){device.queue.writeBuffer(rec.buffer,0,uF32);rec.snapshot.set(uF32);rec.hasLast=true;stats.uniformUploads++;}else stats.uniformUploadSkips++;return{rec,alpha:globalAlpha};}
    function view(texture){let v=targetViews.get(texture);if(v)return v;v=texture.createView();targetViews.set(texture,v);return v;}
    function arcBind(pipe,arcRec,copyBuffer){if(!arcRec?.segmentBuffer||!arcRec?.metaBuffer||!arcRec?.morphRec?.cubicBuffer)return null;if(copyBuffer===dummyCopyBuffer){let hit=normalArcBinds.get(arcRec);if(hit){stats.arcBindHits++;return hit;}hit=device.createBindGroup({layout:pipe.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:arcRec.segmentBuffer}},{binding:1,resource:{buffer:arcRec.metaBuffer}},{binding:2,resource:{buffer:arcRec.morphRec.cubicBuffer}},{binding:3,resource:{buffer:dummyCopyBuffer}}]});normalArcBinds.set(arcRec,hit);stats.arcBinds++;return hit;}let byCopy=corridorArcBinds.get(arcRec);if(!byCopy){byCopy=new WeakMap();corridorArcBinds.set(arcRec,byCopy);}let hit=byCopy.get(copyBuffer);if(hit){stats.corridorBindHits++;return hit;}hit=device.createBindGroup({layout:pipe.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:arcRec.segmentBuffer}},{binding:1,resource:{buffer:arcRec.metaBuffer}},{binding:2,resource:{buffer:arcRec.morphRec.cubicBuffer}},{binding:3,resource:{buffer:copyBuffer}}]});byCopy.set(copyBuffer,hit);stats.arcBinds++;return hit;}
    function encodeToLayerScene(targetTexture,prepared,layer,alpha,ctx,frameCtx,opts={},copies=null,alphas=null,footprint=1){
        if(!targetTexture||!warmup()||!ready||!prepared?.gpuArcNative||!prepared?.table?.gpuArcResident)return null;const type=prepared.type||layer?.lineProfile;if(!['slash','square','circle','cross'].includes(type))return null;const count=Math.max(0,Math.round(Number(prepared.count)||0));if(!count)return{handled:true,commandBuffer:null};const table=prepared.table,arcRec=table._gpuMorphArcResource;if(!arcRec?.ready)return null;
        try{const corridor=Array.isArray(copies)&&copies.length>0,pipe=corridor?corridorPipeline:pipeline;let copyBuffer=dummyCopyBuffer,copyCount=1;if(corridor){const shared=WebGPUCorridorCopyStore.acquire(device,generation,frameCtx,copies,alphas,'profile',footprint,layer);if(!shared?.buffer||!shared.k)return{handled:true,commandBuffer:null};copyBuffer=shared.buffer;copyCount=shared.k;}const ur=prepareUniform(layer,alpha,ctx,prepared,count,arcRec.subdiv||arcRec.morphRec?.bezierSubdiv||6,opts);if(ur.alpha<=.0001)return{handled:true,commandBuffer:null};const encoder=device.createCommandEncoder({label:'Somata Spiral profile Arc marker → Layer Scene'});if(typeof spiroGpuPrepareArcForLayerScene==='function'){if(!spiroGpuPrepareArcForLayerScene(frameCtx,table,encoder))return null;stats.arcPrerequisiteReuses++;}else if(typeof encodeGpuMorphArcTable==='function'&&!encodeGpuMorphArcTable(table,encoder))return null;const bg=arcBind(pipe,arcRec,copyBuffer);if(!bg)return null;const pass=encoder.beginRenderPass({colorAttachments:[{view:view(targetTexture),loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,corridor?ur.rec.corridorBind:ur.rec.normalBind);pass.setBindGroup(1,bg);pass.setVertexBuffer(0,cornerBuffer);pass.draw(6,count*copyCount);pass.end();stats.frames++;stats.draws++;if(corridor)stats.corridorDraws++;return{handled:true,commandBuffer:encoder.finish(),onSubmitted:()=>{try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}}};}catch(err){lastError=String(err?.message||err);stats.errors++;return null;}
    }
    function status(){return{available:ready,lastError,generation,...stats,contract:'strict Spiral profile markers sample the shared retained cubic Bézier GPU Arc in WGSL; marker centers are never materialized on CPU and no Canvas presentation bridge exists'};}
    return{warmup,isReady:()=>ready,encodeToLayerScene,status};
})();
window.__spiroProfileArcMarkerStatus=()=>WebGPUProfileArcMarkerRenderer.status();
