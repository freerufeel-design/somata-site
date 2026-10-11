// SpiroStar v524 — independent contour particles, WebGPU-only raster/animation.
window.__spiroRegisterModule?.('js/gpu/particle-renderer');
const WebGPUParticleRenderer=(()=>{
    const canvas=document.getElementById('particleGpuOverlayCanvas');
    let device=null,context=null,format='bgra8unorm',pipeline=null,greenBuildPipeline=null,greenScanPipeline=null,greenAddPipeline=null,greenFinalPipeline=null,dummyCubicBuffer=null,ready=false,initializing=false,attempted=false,lost=false,hubGeneration=-1,lastError='';
    let width=0,height=0,frameId=0,frameActive=false,queue=[],lastAttemptAt=0,targetViews=new WeakMap();
    const segmentResources=new WeakMap(),resourceSet=new Set(),greenResources=new WeakMap(),greenResourceSet=new Set(),uniformByKey=new Map();
    const stats={frames:0,draws:0,particles:0,sceneFrames:0,sceneDraws:0,sceneParticles:0,sceneGreenArcEncodes:0,sceneGreenArcReuses:0,sceneBlueArcReuses:0,sceneBundleBuilds:0,sceneBundleHits:0,sceneBundleExecutes:0,overlayBundleExecutes:0,overlayFrames:0,segmentsUploaded:0,bytesUploaded:0,resourceBuilds:0,greenResourceBuilds:0,greenSharedEndpointReuses:0,bindBuilds:0,bindReuses:0,morphArcFrames:0,morphArcCpuTablesAvoided:0,greenMorphFrames:0,greenMorphCpuTablesAvoided:0,greenComputeDispatches:0,greenBuildDispatches:0,greenScanDispatches:0,greenScanOffsetDispatches:0,greenFinalizeDispatches:0,greenArcEncodes:0,greenArcCommittedReuses:0,greenUniformUploadSkips:0,blueArcFusedEncodes:0,blueArcFusedSubmissions:0,blueArcMainSceneReuses:0,uniformAllocationsAvoided:0,errors:0,skipped:0};
    const lastDecision={reason:'idle',layerIndex:-1};
    const WGSL=`
struct U { v: array<vec4<f32>, 11> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage,read> segs: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> arcMeta: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> retainedCubics: array<vec4<f32>>;

fn hash11(x:f32)->f32 { return fract(sin(x*127.1+311.7)*43758.5453123); }
fn rgba(idx:u32)->vec4<f32> { return u.v[5u+min(idx,3u)]; }
struct RailSample { p: vec2<f32>, tangent: vec2<f32> };
fn cubicPoint(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
  let a=mix(p0,c1,t);let b=mix(c1,c2,t);let c=mix(c2,p3,t);return mix(mix(a,b,t),mix(b,c,t),t);
}
fn cubicTangent(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
  let s=1.0-t;return 3.0*s*s*(c1-p0)+6.0*s*t*(c2-c1)+3.0*t*t*(p3-c2);
}

fn cubicDerivativeArc(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let s=1.0-t;return 3.0*s*s*(c1-p0)+6.0*s*t*(c2-c1)+3.0*t*t*(p3-c2);}
fn arcCorrectMicroT(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,sub:u32,subdiv:u32,f0:f32)->f32{
    let f=clamp(f0,0.0,1.0);let sd=max(1u,subdiv);let t0=f32(sub)/f32(sd);let t1=f32(sub+1u)/f32(sd);if(f<=0.000001){return t0;}if(f>=0.999999){return t1;}
    let s0=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t0)));let s1=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t1)));let dv=s1-s0;let arcTarget=f*max(0.000001,s0+0.5*dv);
    // Integral of the local linear-speed model has a closed-form inverse. Rationalized root
    // avoids cancellation and is cheaper than iterative Newton correction in particle/Web loads.
    let disc=max(0.000000000001,s0*s0+2.0*dv*arcTarget);let q=clamp((2.0*arcTarget)/max(0.000001,s0+sqrt(disc)),0.0,1.0);return mix(t0,t1,q);
}
fn sampleRail(si:u32,t0:f32)->RailSample{
  let g=segs[si*2u];var out:RailSample;out.p=mix(g.xy,g.zw,t0);out.tangent=g.zw-g.xy;
  if(u.v[10].z>0.5){let subdiv=max(1u,u32(u.v[10].y+0.5));let logical=si/subdiv;let sub=si%subdiv;let q0=retainedCubics[logical*2u];let q1=retainedCubics[logical*2u+1u];let t=arcCorrectMicroT(q0.xy,q0.zw,q1.xy,q1.zw,sub,subdiv,t0);out.p=cubicPoint(q0.xy,q0.zw,q1.xy,q1.zw,t);out.tangent=cubicTangent(q0.xy,q0.zw,q1.xy,q1.zw,t);}
  return out;
}
fn find_segment(dist:f32)->vec4<f32>{
  let n=max(1u,u32(u.v[0].z));
  var lo:u32=0u; var hi:u32=n;
  // Segment starts are monotonic arc lengths. Binary search keeps particle cost
  // logarithmic even for dense spline/spiral rails instead of O(N) per instance.
  for(var k:u32=0u;k<20u;k=k+1u){
    if(lo>=hi){break;}
    let mid=(lo+hi)/2u; let b=segs[mid*2u+1u];
    let st=b.x; let en=st+max(1e-6,b.y);
    if(dist<st){hi=mid;}else if(dist>en){lo=mid+1u;}else{
      let ln=max(1e-6,b.y); return vec4<f32>(f32(mid),clamp((dist-st)/ln,0.0,1.0),ln,1.0);
    }
  }
  let i=min(n-1u,lo); let b=segs[i*2u+1u]; let ln=max(1e-6,b.y);
  return vec4<f32>(f32(i),clamp((dist-b.x)/ln,0.0,1.0),ln,1.0);
}
struct VO { @builtin(position) pos: vec4<f32>, @location(0) q: vec2<f32>, @location(1) metaData: vec4<f32>, @location(2) col: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->VO{
  let corners=array<vec2<f32>,4>(vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,1.0));
  let q=corners[vid]; let count=max(1.0,u.v[0].w); let total=max(1e-5,arcMeta[0].x); let time=u.v[3].x; let speed=u.v[3].z; let seed=hash11(f32(iid)+17.0);
  let mode=u32(u.v[4].x+0.5); let style=u32(u.v[4].y+0.5); let segCount=max(1u,u32(u.v[0].z));
  var si:u32=0u; var t:f32=0.0; var envelope:f32=1.0; var helix:f32=0.0;
  if(mode==1u){
    si=iid%segCount; let ph=fract(time*(0.035+speed*0.11)+seed); let towardEnd=((iid&1u)==0u); t=select(1.0-ph,ph,towardEnd); envelope=pow(max(0.0,sin(3.14159265*ph)),0.72);
  }else{
    let ph=fract((f32(iid)+0.5)/count + time*(0.008+speed*0.055) + seed*0.021);
    let hit=find_segment(ph*total); si=u32(hit.x+0.5); t=hit.y;
    if(mode==2u){ let turns=max(0.0,u.v[10].x); helix=time*(2.2+speed*8.5)+seed*6.2831853+ph*6.2831853*turns; envelope=0.65+0.35*(0.5+0.5*cos(helix)); }
  }
  let a=segs[si*2u]; let b=segs[si*2u+1u]; if(u.v[9].w>0.5){envelope=envelope*clamp(b.z,0.0,1.0);} let rail=sampleRail(si,t);let lp=rail.p;
  var p=vec2<f32>(u.v[1].x*lp.x+u.v[1].y*lp.y+u.v[1].z,u.v[2].x*lp.x+u.v[2].y*lp.y+u.v[2].z);
  let la=rail.tangent; var td=vec2<f32>(u.v[1].x*la.x+u.v[1].y*la.y,u.v[2].x*la.x+u.v[2].y*la.y); td=normalize(select(vec2<f32>(1.0,0.0),td,length(td)>1e-6)); let nn=vec2<f32>(-td.y,td.x);
  if(mode==2u){ p=p+nn*sin(helix)*u.v[4].z; }
  let scatter=max(0.0,u.v[9].y); if(scatter>0.0){let h1=hash11(seed*97.0+f32(iid)*1.13)-0.5;let h2=hash11(seed*173.0+f32(iid)*2.17)-0.5;p=p+nn*h1*2.0*scatter+td*h2*0.7*scatter;}
  let tw=clamp(u.v[4].w,0.0,1.0); let twWave=0.5+0.5*sin(time*(5.0+seed*4.0)+seed*31.0); let twinkleSize=mix(1.0,0.72+0.28*twWave,tw); let twinkleAlpha=mix(1.0,0.12+0.88*twWave,tw);
  let depth=select(1.0,0.68+0.48*(0.5+0.5*cos(helix)),mode==2u);
  let sizeVar=max(0.0,u.v[9].z);let sizeRand=max(0.12,1.0+(hash11(seed*313.0+7.0)*2.0-1.0)*sizeVar);let featherScale=select(1.0,0.58,style==3u);let size=max(0.35,u.v[3].y)*twinkleSize*depth*(0.78+0.44*seed)*sizeRand*featherScale; if(style==3u){p=p+nn*q.x*size*0.62+td*q.y*size;}else{p=p+q*size;}
  let ndc=vec2<f32>(p.x/u.v[0].x*2.0-1.0,1.0-p.y/u.v[0].y*2.0);
  var o:VO;o.pos=vec4<f32>(ndc,0.0,1.0);o.q=q;o.metaData=vec4<f32>(f32(style),seed,envelope*depth*twinkleAlpha,u.v[3].w);o.col=rgba(iid%4u);return o;
}
@fragment fn fs(i:VO)->@location(0) vec4<f32>{
  let q=i.q; let r=length(q); let style=u32(i.metaData.x+0.5); let seed=i.metaData.y; var a=0.0; var rgb=i.col.rgb;
  if(style==0u){
    let cross=max(exp(-18.0*abs(q.x))*exp(-2.3*abs(q.y)),exp(-18.0*abs(q.y))*exp(-2.3*abs(q.x))); let core=1.0-smoothstep(0.18,0.85,r); a=max(core,cross); rgb=mix(i.col.rgb,vec3<f32>(1.0),0.65);
  }else if(style==1u){
    let rr=length(vec2<f32>(q.x*1.25,(q.y+0.14)*0.78)); a=1.0-smoothstep(0.42,1.0,rr); let hot=1.0-smoothstep(0.0,0.72,rr); rgb=mix(i.col.rgb,vec3<f32>(1.0,0.92,0.55),hot);
  }else if(style==2u){
    let diamond=abs(q.x)+abs(q.y); a=1.0-smoothstep(0.55,1.0,diamond); a=max(a,exp(-14.0*abs(q.x))*0.65+exp(-14.0*abs(q.y))*0.65); rgb=mix(i.col.rgb,vec3<f32>(1.0),0.22);
  }else if(style==3u){
    let bend=q.x-0.12*sin((q.y+1.0)*2.4+seed*4.0); let taper=clamp((1.05-q.y)*0.58,0.18,1.0); let body=(1.0-smoothstep(0.34,0.82,length(vec2<f32>(bend*2.45,q.y*0.72))))*taper; let shaft=exp(-34.0*abs(bend))*step(abs(q.y),0.98); let barbs=(0.5+0.5*cos((q.y+seed)*22.0))*exp(-8.0*abs(bend))*0.18; a=max(body*0.78,max(shaft,barbs)); rgb=mix(i.col.rgb,vec3<f32>(1.0),0.72);
  }else if(style==4u){
    let eye=1.0-smoothstep(0.72,0.92,length(vec2<f32>(q.x,q.y*1.75))); let iris=1.0-smoothstep(0.20,0.48,r); let pupil=1.0-smoothstep(0.08,0.20,r); rgb=mix(vec3<f32>(0.96),i.col.rgb,iris); rgb=mix(rgb,vec3<f32>(0.015),pupil); a=eye;
  }else{
    let wob=0.08*sin(atan2(q.y,q.x)*5.0+seed*13.0); a=1.0-smoothstep(0.50+wob,1.0,r); rgb=mix(i.col.rgb,vec3<f32>(0.93,0.72,1.0),0.32*(1.0-r));
  }
  a=clamp(a*i.metaData.z*i.metaData.w,0.0,1.0); if(a<0.004){discard;} return vec4<f32>(rgb*a,a);
}`;
    // v529 — Green project Morph particle carrier.
    // Segment interpolation and arc construction are fully parallel.  The former v528 kernel
    // used one GPU invocation that serially walked every green-Morph segment; dense spirals
    // therefore still created a long compute tail even though the CPU was idle.
    const GREEN_BUILD_WGSL=`
struct G { t:f32, parameterT:f32, count:u32, _pad:u32 };
@group(0) @binding(0) var<uniform> g:G;
@group(0) @binding(1) var<storage,read> src:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> outSeg:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> lengths:array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;if(i>=g.count){return;}
  let b=i*5u;let s0=src[b];let s1=src[b+1u];let al=src[b+3u];
  let t=clamp(g.t,0.0,1.0);let pt=clamp(g.parameterT,0.0,1.0);
  let a=mix(s0.xy,s1.xy,t);let z=mix(s0.zw,s1.zw,t);
  let vis=clamp(mix(al.x,al.y,pt)*mix(al.z,al.w,pt),0.0,1.0);
  // Keep arc distance geometric, not visibility-weighted. Fading a segment must change
  // particle alpha, not renormalise the whole contour and slide every other particle.
  let ln=length(z-a);
  outSeg[i*2u]=vec4<f32>(a,z);
  outSeg[i*2u+1u]=vec4<f32>(0.0,ln,vis,0.0);
  lengths[i]=ln;
}`;
    const GREEN_SCAN_WGSL=`
struct CountU { count:u32, blockCount:u32, _b:u32, _c:u32 };
@group(0) @binding(0) var<storage,read> inputData:array<f32>;
@group(0) @binding(1) var<storage,read_write> outputData:array<f32>;
@group(0) @binding(2) var<storage,read_write> blockSums:array<f32>;
@group(0) @binding(3) var<uniform> info:CountU;
var<workgroup> temp:array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid3:vec3<u32>,@builtin(workgroup_id) wid3:vec3<u32>){
  let lid=lid3.x;let gid=wid3.x*256u+lid;
  var v=0.0;if(gid<info.count){v=inputData[gid];}temp[lid]=v;workgroupBarrier();
  var offset=1u;
  for(var d=128u;d>0u;d=d>>1u){
    workgroupBarrier();
    if(lid<d){let ai=offset*(2u*lid+1u)-1u;let bi=offset*(2u*lid+2u)-1u;temp[bi]=temp[bi]+temp[ai];}
    offset=offset<<1u;
  }
  workgroupBarrier();
  if(lid==0u){if(wid3.x<info.blockCount){blockSums[wid3.x]=temp[255u];}temp[255u]=0.0;}
  for(var d=1u;d<256u;d=d<<1u){
    offset=offset>>1u;workgroupBarrier();
    if(lid<d){let ai=offset*(2u*lid+1u)-1u;let bi=offset*(2u*lid+2u)-1u;let q=temp[ai];temp[ai]=temp[bi];temp[bi]=temp[bi]+q;}
  }
  workgroupBarrier();if(gid<info.count){outputData[gid]=temp[lid];}
}`;
    const GREEN_ADD_WGSL=`
struct CountU { count:u32, _a:u32, _b:u32, _c:u32 };
@group(0) @binding(0) var<storage,read_write> childPrefix:array<f32>;
@group(0) @binding(1) var<storage,read> parentPrefix:array<f32>;
@group(0) @binding(2) var<uniform> info:CountU;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;if(i>=info.count){return;}childPrefix[i]=childPrefix[i]+parentPrefix[i/256u];
}`;
    const GREEN_FINAL_WGSL=`
struct CountU { count:u32, _a:u32, _b:u32, _c:u32 };
@group(0) @binding(0) var<storage,read_write> outSeg:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> prefix:array<f32>;
@group(0) @binding(2) var<storage,read_write> metaData:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> info:CountU;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
  let i=gid.x;if(i>=info.count){return;}let o=i*2u+1u;var q=outSeg[o];q.x=prefix[i];outSeg[o]=q;
  if(i+1u==info.count){metaData[0]=vec4<f32>(max(prefix[i]+q.y,0.00001),f32(info.count),0.0,0.0);}
}`;
    function destroyRec(rec){try{rec?.buffer?.destroy?.();}catch(_){}try{rec?.metaBuffer?.destroy?.();}catch(_){}}
    function destroyGreenRec(rec){if(!rec)return;for(const key of ['buffer','metaBuffer','uniformBuffer','lengthsBuffer'])try{rec[key]?.destroy?.();}catch(_){}if(rec.ownsSource!==false)try{rec.sourceBuffer?.destroy?.();}catch(_){}for(const level of rec.levels||[]){for(const key of ['output','blockSums','uniform','addUniform'])try{level[key]?.destroy?.();}catch(_){}}try{rec.finalUniform?.destroy?.();}catch(_){}greenResourceSet.delete(rec);}
    function reset(){try{dummyCubicBuffer?.destroy?.();}catch(_){}dummyCubicBuffer=null;for(const r of resourceSet)destroyRec(r);resourceSet.clear();for(const r of greenResourceSet)destroyGreenRec(r);greenResourceSet.clear();for(const r of uniformByKey.values())try{r.buffer?.destroy?.();}catch(_){}uniformByKey.clear();targetViews=new WeakMap();try{context?.unconfigure?.();}catch(_){}pipeline=greenBuildPipeline=greenScanPipeline=greenAddPipeline=greenFinalPipeline=context=null;width=height=0;}
    async function initAsync(){
        if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready&&!lost)return false;attempted=true;lastAttemptAt=performance.now();initializing=true;lastError='';
        try{
            const shared=await WebGPUDeviceHub.acquire();device=shared.device;hubGeneration=shared.generation;format=navigator.gpu.getPreferredCanvasFormat();context=canvas?.getContext?.('webgpu');if(!context)throw new Error('particle WebGPU overlay unavailable');
            const mod=device.createShaderModule({label:'SpiroStar particle WGSL',code:WGSL});if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(mod,'SpiroStar particle WGSL');
            pipeline=device.createRenderPipeline({label:'SpiroStar particles',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-strip'}});
            dummyCubicBuffer=device.createBuffer({label:'SpiroStar particle dummy cubic',size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(dummyCubicBuffer,0,new Float32Array(8));
            const compileGreen=async(label,code)=>{const m=device.createShaderModule({label,code});if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(m,label);return device.createComputePipeline({label,layout:'auto',compute:{module:m,entryPoint:'main'}});};
            greenBuildPipeline=await compileGreen('SpiroStar green particle arc build',GREEN_BUILD_WGSL);
            greenScanPipeline=await compileGreen('SpiroStar green particle arc scan',GREEN_SCAN_WGSL);
            greenAddPipeline=await compileGreen('SpiroStar green particle arc add offsets',GREEN_ADD_WGSL);
            greenFinalPipeline=await compileGreen('SpiroStar green particle arc finalize',GREEN_FINAL_WGSL);
            ready=true;lost=false;requestMainCanvasRender?.();return true;
        }catch(err){ready=false;lastError=String(err?.message||err);stats.errors++;return false;}finally{initializing=false;}
    }
    function warmup(){const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration?.():-1;if(ready&&gen!==hubGeneration){ready=false;attempted=false;lost=true;reset();}const retryDue=attempted&&!ready&&!initializing&&(performance.now()-lastAttemptAt>1200);if(!ready&&!initializing&&(!attempted||lost||retryDue)){if(retryDue)attempted=false;lost=false;void initAsync();}return ready&&!lost;}
    function ensureSize(w,h){if(!warmup())return false;w=Math.max(1,w|0);h=Math.max(1,h|0);if(width!==w||height!==h||canvas.width!==w||canvas.height!==h){width=w;height=h;canvas.width=w;canvas.height=h;context.configure({device,format,alphaMode:'premultiplied'});}return true;}
    function beginOverlayFrame(fid,w,h,active){frameId=Number(fid)||0;queue.length=0;frameActive=active===true;if(!canvas)return false;if(!frameActive){canvas.style.display='none';return false;}const ok=ensureSize(w,h);canvas.style.display='none';return ok;}
    function hex(style){const s=String(style||'').trim();const m=/^#([0-9a-f]{6})$/i.exec(s);if(m){const n=parseInt(m[1],16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1];}try{return GPUColorCache.rgba(style||'#fff');}catch(_){return[1,1,1,1];}}
    function effectColors(cfg,layer,lineColorOverride=null){
        if(cfg.colorMode==='line'){const c=hex(lineColorOverride||layer?.strokeColor||'#fff');return[c,c,c,c];}
        if(cfg.colorMode==='palette'){
            let colors=[];try{colors=getPlaylistPaletteColors(cfg.paletteKey)||[];}catch(_){}if(colors.length){const out=[];for(let i=0;i<4;i++)out.push(hex(colors[Math.floor(i*Math.max(1,colors.length-1)/3)]||colors[0]));return out;}
        }
        const map={stardust:['#ffffff','#f8fafc','#e0f2fe','#ffffff'],flame:['#ffffff','#ffe066','#ff8a1f','#ff2d0a'],laser:['#fff7c2','#f9a8d4','#a7f3d0','#ffffff'],feather:['#ffffff','#f8fafc','#e2e8f0','#ffffff'],eye:['#38bdf8','#22d3ee','#60a5fa','#ffffff'],plasma:['#f0abfc','#c084fc','#8b5cf6','#6d28d9']};return(map[cfg.style]||map.stardust).map(hex);
    }
    function segmentResource(table){
        if(!(table?.gpuSegmentData instanceof Float32Array)||!(table.segmentCount>0))return null;let rec=segmentResources.get(table),need=Math.max(32,Math.ceil(table.segmentCount*8*4/16)*16);
        if(!rec||rec.generation!==hubGeneration||rec.capacity<need){if(rec)destroyRec(rec);rec={buffer:device.createBuffer({label:'particle contour segments',size:need,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),metaBuffer:device.createBuffer({label:'particle contour arc meta',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),capacity:need,version:-1,generation:hubGeneration,metaStaging:new Float32Array(4)};segmentResources.set(table,rec);resourceSet.add(rec);stats.resourceBuilds++;}
        const version=Number(table.gpuSegmentVersion)||0;if(rec.version!==version){const bytes=Math.max(0,Number(table.gpuSegmentFloatCount)||table.segmentCount*8)*4;device.queue.writeBuffer(rec.buffer,0,table.gpuSegmentData.buffer,table.gpuSegmentData.byteOffset,bytes);rec.metaStaging[0]=Math.max(.0001,Number(table.total)||.0001);device.queue.writeBuffer(rec.metaBuffer,0,rec.metaStaging);rec.version=version;stats.segmentsUploaded+=table.segmentCount;stats.bytesUploaded+=bytes;}
        rec.identity=rec;rec.count=table.segmentCount;return rec;
    }
    function makeGreenCountUniform(label,count,blocks=0){
        const buffer=device.createBuffer({label,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        device.queue.writeBuffer(buffer,0,new Uint32Array([Math.max(0,count)>>>0,Math.max(0,blocks)>>>0,0,0]));return buffer;
    }
    function greenSegmentResource(frameCtx){
        if(frameCtx?.geometryPlan?.kind!=='green-morph'||!greenBuildPipeline||!greenScanPipeline||!greenAddPipeline||!greenFinalPipeline)return null;
        const plan=frameCtx?.greenMorphProvider?.gpuGeometryPlan;if(!plan?.pairs?.length)return null;
        let rec=greenResources.get(plan);if(rec?.generation===hubGeneration){rec.t=Math.max(0,Math.min(1,Number(frameCtx.greenMorphProvider?.progress)||0));rec.parameterT=Math.max(0,Math.min(1,Number(frameCtx.greenMorphProvider?.parameterProgress??rec.t)||0));return rec;}
        if(rec)destroyGreenRec(rec);
        // Prefer the immutable endpoint buffer already owned by the green base renderer.  If it
        // is not ready yet, build the identical payload locally as a compatibility fallback.
        const sharedEndpoint=(typeof WebGPUGreenProjectMorphRenderer!=='undefined'&&typeof WebGPUGreenProjectMorphRenderer.acquireEndpointResource==='function')?WebGPUGreenProjectMorphRenderer.acquireEndpointResource(plan):null;
        const useShared=Boolean(sharedEndpoint?.buffer&&sharedEndpoint.generation===hubGeneration&&Number(sharedEndpoint.count)>0);
        let count=useShared?Math.max(0,Number(sharedEndpoint.count)||0):0,data=null,sourceBuffer=null;
        if(useShared){
            sourceBuffer=sharedEndpoint.buffer;stats.greenSharedEndpointReuses++;
        }else{
            const arr=[];
            for(const pair of plan.pairs||[]){const src=pair.src||[],dst=pair.dst||[],n=Math.min(src.length,dst.length);if(n<2)continue;const closedSrc=pair.srcClosed===true,closedDst=pair.dstClosed===true,bothClosed=closedSrc&&closedDst,sw=Number.isFinite(Number(pair.sourceWeight))?Number(pair.sourceWeight):1,tw=Number.isFinite(Number(pair.targetWeight))?Number(pair.targetWeight):1,map=i=>bothClosed?(((pair.reverse?pair.offset-i:i+pair.offset)%n+n)%n):(pair.reverse?n-1-i:i);const emit=(ia,ib,ca=1,cb=1)=>{const ja=map(ia),jb=map(ib),a=src[ia],b=src[ib],c=dst[ja],d=dst[jb];arr.push(Number(a.x)||0,Number(a.y)||0,Number(b.x)||0,Number(b.y)||0,Number(c.x)||0,Number(c.y)||0,Number(d.x)||0,Number(d.y)||0,Math.max(.02,Number(a.widthScale)||1),Math.max(.02,Number(b.widthScale)||1),Math.max(.02,Number(c.widthScale)||1),Math.max(.02,Number(d.widthScale)||1),sw,tw,ca,cb,0,0,0,0);count++;};for(let i=0;i<n-1;i++)emit(i,i+1,1,1);if(closedSrc||closedDst)emit(n-1,0,closedSrc?1:0,closedDst?1:0);}
            if(!count)return null;
            data=new Float32Array(arr);sourceBuffer=device.createBuffer({label:'green particle source segments',size:Math.ceil(data.byteLength/16)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(sourceBuffer,0,data.buffer,data.byteOffset,data.byteLength);stats.bytesUploaded+=data.byteLength;
        }
        if(!count)return null;
        const buffer=device.createBuffer({label:'green particle current arc',size:Math.max(32,count*32),usage:GPUBufferUsage.STORAGE});
        const metaBuffer=device.createBuffer({label:'green particle arc meta',size:16,usage:GPUBufferUsage.STORAGE});
        const uniformBuffer=device.createBuffer({label:'green particle arc uniform',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        const lengthsBuffer=device.createBuffer({label:'green particle arc lengths',size:Math.max(16,Math.ceil(count*4/16)*16),usage:GPUBufferUsage.STORAGE});
        const uniformBytes=new ArrayBuffer(16),uf=new Float32Array(uniformBytes),uu=new Uint32Array(uniformBytes);
        const buildBind=device.createBindGroup({layout:greenBuildPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniformBuffer}},{binding:1,resource:{buffer:sourceBuffer}},{binding:2,resource:{buffer}},{binding:3,resource:{buffer:lengthsBuffer}}]});
        const levels=[];let levelCount=count,input=lengthsBuffer,levelIndex=0;
        while(true){
            const blocks=Math.max(1,Math.ceil(levelCount/256));
            const output=device.createBuffer({label:`green particle arc prefix ${levelIndex}`,size:Math.max(16,Math.ceil(levelCount*4/16)*16),usage:GPUBufferUsage.STORAGE});
            const blockSums=device.createBuffer({label:`green particle arc sums ${levelIndex}`,size:Math.max(16,Math.ceil(blocks*4/16)*16),usage:GPUBufferUsage.STORAGE});
            const uniform=makeGreenCountUniform(`green particle arc scan info ${levelIndex}`,levelCount,blocks);
            const bind=device.createBindGroup({layout:greenScanPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}},{binding:2,resource:{buffer:blockSums}},{binding:3,resource:{buffer:uniform}}]});
            levels.push({count:levelCount,blocks,input,output,blockSums,uniform,bind,addUniform:null,addBind:null});
            if(blocks<=1)break;input=blockSums;levelCount=blocks;levelIndex++;
        }
        for(let i=levels.length-2;i>=0;i--){
            const child=levels[i],parent=levels[i+1],addUniform=makeGreenCountUniform(`green particle arc add info ${i}`,child.count);
            child.addUniform=addUniform;child.addBind=device.createBindGroup({layout:greenAddPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:child.output}},{binding:1,resource:{buffer:parent.output}},{binding:2,resource:{buffer:addUniform}}]});
        }
        const finalUniform=makeGreenCountUniform('green particle arc final info',count);
        const finalBind=device.createBindGroup({layout:greenFinalPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}},{binding:1,resource:{buffer:levels[0].output}},{binding:2,resource:{buffer:metaBuffer}},{binding:3,resource:{buffer:finalUniform}}]});
        rec={sourceBuffer,ownsSource:!useShared,buffer,metaBuffer,uniformBuffer,lengthsBuffer,uniformBytes,uf,uu,count,generation:hubGeneration,identity:null,greenMorph:true,t:0,parameterT:0,lastUniformT:NaN,lastUniformParameterT:NaN,hasCommittedData:false,lastCommittedT:NaN,lastCommittedParameterT:NaN,buildBind,levels,finalUniform,finalBind};rec.identity=rec;
        greenResources.set(plan,rec);greenResourceSet.add(rec);stats.greenResourceBuilds++;rec.t=Math.max(0,Math.min(1,Number(frameCtx.greenMorphProvider?.progress)||0));rec.parameterT=Math.max(0,Math.min(1,Number(frameCtx.greenMorphProvider?.parameterProgress??rec.t)||0));return rec;
    }
    function prepareGreenSegmentResource(rec){if(!rec?.greenMorph)return;const t=rec.t,pt=rec.parameterT;if(rec.lastUniformT===t&&rec.lastUniformParameterT===pt){stats.greenUniformUploadSkips++;return;}rec.uf[0]=t;rec.uf[1]=pt;rec.uu[2]=rec.count>>>0;rec.uu[3]=0;device.queue.writeBuffer(rec.uniformBuffer,0,rec.uniformBytes);rec.lastUniformT=t;rec.lastUniformParameterT=pt;}
    async function awaitParticleRendererReady(timeoutMs=3000){
        if(ready&&!lost)return true;
        const started=performance.now();
        if(!initializing){const ok=await initAsync();if(ok)return true;}
        while(initializing&&performance.now()-started<Math.max(250,Number(timeoutMs)||3000))await new Promise(resolve=>setTimeout(resolve,0));
        return ready&&!lost;
    }
    // v535 — build Green particle Arc buffer hierarchies before the Green transition clock.
    // Compute itself remains frame-driven on GPU; this only removes one-time allocation and
    // bind-group construction from the first visible moving frame.
    async function prewarmGreenPlans(plans){
        if(!globalThis.navigator?.gpu)return false;
        if(!await awaitParticleRendererReady())return false;
        let built=0;
        for(const plan of Array.isArray(plans)?plans:[]){
            if(!plan?.pairs?.length)continue;
            try{
                const rec=greenSegmentResource({geometryPlan:{kind:'green-morph'},greenMorphProvider:{gpuGeometryPlan:plan,progress:0,parameterProgress:0}});
                if(rec)built++;
            }catch(_){}
        }
        return built>0;
    }
    function uniformResource(key){let rec=uniformByKey.get(key);if(rec?.generation===hubGeneration)return rec;if(rec)try{rec.buffer.destroy();}catch(_){}rec={buffer:device.createBuffer({label:`particle uniforms ${key}`,size:176,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),generation:hubGeneration,bindBySegment:new WeakMap(),bundleBySegment:new WeakMap(),staging:new Float32Array(44)};uniformByKey.set(key,rec);return rec;}
    function gpuParticleSource(frameCtx){
        // Green advanced/smooth project Morph keeps particles fully GPU-native too. The current
        // arc is evaluated by a compute pass immediately before the particle render pass.
        try{const green=greenSegmentResource(frameCtx);if(green){prepareGreenSegmentResource(green);stats.greenMorphFrames++;stats.greenMorphCpuTablesAvoided++;return green;}}catch(_){}
        // v528: topology Morph already owns an exact GPU arc/segment buffer. Particles can
        // consume it directly instead of forcing getLayerFramePathFxTable() to materialize the
        // same dynamic rail on the CPU every display frame. The compute prerequisite is submitted
        // once and the particle pass only reads the resident buffers.
        try{
            const table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null;
            const arc=table?._gpuMorphArcResource;
            if(table?.gpuArcResident===true&&arc?.ready&&typeof encodeGpuMorphArcTable==='function'){
                stats.morphArcFrames++;stats.morphArcCpuTablesAvoided++;
                // v529: do not submit Morph Arc as a prerequisite here.  Keep the exact arc table
                // with the particle item and encode interpolation + prefix scan into the same
                // command buffer as the particle render pass.  This removes a queue-submit boundary
                // from every Blue Morph + Particles frame while preserving strict GPU ordering.
                return{buffer:arc.segmentBuffer,metaBuffer:arc.metaBuffer,identity:arc,count:arc.segmentCount,morphArc:true,morphArcTable:table,cubicBuffer:arc.morphRec?.cubicBuffer||null,bezierSubdiv:Math.max(1,Number(arc.subdiv)||1),exactBezierArc:true};
            }
        }catch(_){}
        const strictSpiral=typeof isStrictSpiralWebGPUFrame==='function'?isStrictSpiralWebGPUFrame(frameCtx):Boolean(state?.fourierMode!==true&&[frameCtx?.layer,frameCtx?.geometryPlan?.sourceLayer,frameCtx?.geometryPlan?.targetLayer].some(l=>l&&typeof isSpiralLayer==='function'&&isSpiralLayer(l)));
        if(strictSpiral){stats.morphArcCpuTablesAvoided++;return null;}
        let table=null;try{table=getLayerFramePathFxTable(frameCtx);}catch(_){return null;}
        return segmentResource(table);
    }
    function particleBundle(ur,identity,bind,count){
        if(!ur?.bundleBySegment||!identity||typeof device?.createRenderBundleEncoder!=='function')return null;let hit=ur.bundleBySegment.get(identity);if(hit&&hit.count===count&&hit.bind===bind&&hit.bundle){stats.sceneBundleHits++;return hit;}
        try{const rbe=device.createRenderBundleEncoder({label:'SpiroStar particle bundle',colorFormats:[format]});rbe.setPipeline(pipeline);rbe.setBindGroup(0,bind);rbe.draw(4,count);const bundle=rbe.finish();hit={count,bind,bundle,list:[bundle]};ur.bundleBySegment.set(identity,hit);stats.sceneBundleBuilds++;return hit;}catch(_){return null;}
    }
    function particleCopyDescriptors(frameCtx){
        const copies=frameCtx?.visibleInstances?.copies,alphas=frameCtx?.visibleInstances?.particleAlphas||frameCtx?.visibleInstances?.alphas,tunnelActive=typeof state!=='undefined'&&state?.tunnel?.active===true;
        if(tunnelActive){if(!Array.isArray(copies)||!copies.length)return[];const out=[];for(let i=0;i<copies.length;i++){const alpha=Math.max(0,Math.min(1,Number(alphas?.[i]??1)||0));if(alpha>.0001)out.push({copy:copies[i],index:i,alpha});}return out;}
        return[{copy:null,index:-1,alpha:Math.max(0,Math.min(1,Number(alphas?.[0]??1)||0))}];
    }
    function prepareLayerItem(frameCtx,ctx,requireOverlay=false,copyDesc=null,sharedRec=null){
        const cfg=normalizeParticleConfig(frameCtx?.layer?.particles);if((requireOverlay&&!frameActive)||!ready||!cfg.enabled||frameCtx?.layer?.visible===false){stats.skipped++;return null;}const rec=sharedRec||gpuParticleSource(frameCtx);if(!rec)return null;
        ctx.save();try{if(copyDesc?.copy){applyMotionTunnelLag(ctx,copyDesc.copy,frameCtx.layer);const copyScale=Number(copyDesc.copy.scale);ctx.scale(Number.isFinite(copyScale)?copyScale:1,Number.isFinite(copyScale)?copyScale:1);}applyLayerFrameEffectTransform(ctx,frameCtx);}catch(_){}const tr=ctx.getTransform();ctx.restore();
        const lineColor=copyDesc?.copy&&cfg.colorMode==='line'&&typeof getTunnelCopyColor==='function'?getTunnelCopyColor(frameCtx.tunnelBaseStrokeColor||frameCtx.layer?.strokeColor||'#ffffff',copyDesc.copy,frameCtx.tunnelPaletteProfile):null;
        const colors=effectColors(cfg,frameCtx.layer,lineColor),baseKey=frameCtx.layer?.id||`layer-${frameCtx.layerIndex}`,key=copyDesc?.copy?`${baseKey}|corridor:${copyDesc.index}`:baseKey,ur=uniformResource(key),u=ur.staging,mode={flow:0,cornerFade:1,spiralZ:2}[cfg.mode]??0,style={stardust:0,flame:1,laser:2,feather:3,eye:4,plasma:5}[cfg.style]??0;u.fill(0);stats.uniformAllocationsAvoided++;
        const viewportW=Math.max(1,Number(mainCanvas?.width)||width||1),viewportH=Math.max(1,Number(mainCanvas?.height)||height||1),dpr=Math.max(.1,Number(frameCtx?.frame?.dpr)||1),density=Math.max(0,Math.min(8192,Math.round(cfg.density*cfg.densityMultiplier))),speed=Math.max(0,cfg.speedPercent*cfg.speedMultiplier/100),copyAlpha=Math.max(0,Math.min(1,Number(copyDesc?.alpha??1)||0));
        u[0]=viewportW;u[1]=viewportH;u[2]=rec.count;u[3]=density;u[4]=Number(tr.a)||1;u[5]=Number(tr.c)||0;u[6]=Number(tr.e)||0;u[8]=Number(tr.b)||0;u[9]=Number(tr.d)||1;u[10]=Number(tr.f)||0;
        u[12]=(Number(frameCtx?.frame?.now)||performance.now())/1000;u[13]=cfg.sizePx*dpr;u[14]=speed;u[15]=(cfg.opacity/100)*copyAlpha;u[16]=mode;u[17]=style;u[18]=cfg.spiralRadiusPx*cfg.spiralRadiusMultiplier*dpr;u[19]=cfg.twinkle/100;
        for(let i=0;i<4;i++)u.set(colors[i]||colors[0],[20,24,28,32][i]);u[37]=Math.min(280,(cfg.scatter/100)*cfg.scatterMultiplier*Math.max(10,cfg.sizePx*8)*dpr);u[38]=Math.min(3,(cfg.sizeVariation/100)*cfg.sizeVariationMultiplier);u[39]=rec.greenMorph?1:0;u[40]=cfg.spiralTurns;u[41]=Math.max(1,Number(rec.bezierSubdiv)||1);u[42]=rec.exactBezierArc===true&&rec.cubicBuffer?1:0;
        device.queue.writeBuffer(ur.buffer,0,u);const identity=rec.identity||rec;let bind=ur.bindBySegment?.get(identity);if(!bind){bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ur.buffer}},{binding:1,resource:{buffer:rec.buffer}},{binding:2,resource:{buffer:rec.metaBuffer}},{binding:3,resource:{buffer:rec.cubicBuffer||dummyCubicBuffer}}]});ur.bindBySegment?.set(identity,bind);stats.bindBuilds++;}else stats.bindReuses++;const count=u[3]|0,bundle=particleBundle(ur,identity,bind,count);
        return{bind,bundle,count,greenRec:rec.greenMorph?rec:null,morphArcTable:rec.morphArcTable||null,rec,copyIndex:copyDesc?.index??-1};
    }
    function prepareLayerItems(frameCtx,ctx,requireOverlay=false){
        const cfg=normalizeParticleConfig(frameCtx?.layer?.particles);if((requireOverlay&&!frameActive)||!ready||!cfg.enabled||frameCtx?.layer?.visible===false){stats.skipped++;return[];}const rec=gpuParticleSource(frameCtx);if(!rec)return[];const items=[];for(const desc of particleCopyDescriptors(frameCtx)){const item=prepareLayerItem(frameCtx,ctx,requireOverlay,desc,rec);if(item)items.push(item);}return items;
    }
    function queueLayer(frameCtx,ctx){
        const items=prepareLayerItems(frameCtx,ctx,true);if(!items.length)return false;for(const item of items)queue.push(item);const rec=items[0].rec;lastDecision.reason=items.length>1?'queued-corridor':(rec.greenMorph?'queued-green-gpu-arc':(rec.morphArc?'queued-gpu-morph-arc':'queued'));lastDecision.layerIndex=frameCtx.layerIndex;return true;
    }
    function encodeGreenArc(rec,enc){
        let pass=enc.beginComputePass({label:'green Morph particle arc build'});pass.setPipeline(greenBuildPipeline);pass.setBindGroup(0,rec.buildBind);pass.dispatchWorkgroups(Math.ceil(rec.count/256));pass.end();stats.greenBuildDispatches++;stats.greenComputeDispatches++;
        for(const level of rec.levels){pass=enc.beginComputePass({label:'green Morph particle arc scan'});pass.setPipeline(greenScanPipeline);pass.setBindGroup(0,level.bind);pass.dispatchWorkgroups(level.blocks);pass.end();stats.greenScanDispatches++;stats.greenComputeDispatches++;}
        for(let i=rec.levels.length-2;i>=0;i--){const level=rec.levels[i];pass=enc.beginComputePass({label:'green Morph particle arc add offsets'});pass.setPipeline(greenAddPipeline);pass.setBindGroup(0,level.addBind);pass.dispatchWorkgroups(Math.ceil(level.count/256));pass.end();stats.greenScanOffsetDispatches++;stats.greenComputeDispatches++;}
        pass=enc.beginComputePass({label:'green Morph particle arc finalize'});pass.setPipeline(greenFinalPipeline);pass.setBindGroup(0,rec.finalBind);pass.dispatchWorkgroups(Math.ceil(rec.count/256));pass.end();stats.greenFinalizeDispatches++;stats.greenComputeDispatches++;
    }
    function layerSceneView(texture){let view=targetViews.get(texture);if(view)return view;view=texture.createView();targetViews.set(texture,view);return view;}
    function encodeToLayerScene(targetTexture,frameCtx,ctx){
        if(!targetTexture||!warmup())return{handled:false,commandBuffer:null};const items=prepareLayerItems(frameCtx,ctx,false);if(!items.length)return{handled:false,commandBuffer:null};
        try{
            const enc=device.createCommandEncoder({label:`SpiroStar particles -> Layer Scene L${Number(frameCtx?.layerIndex)||0}`}),callbacks=[],greenSeen=new Set(),morphSeen=new Set();
            for(const item of items){const rec=item.greenRec;if(rec&&!greenSeen.has(rec)){greenSeen.add(rec);const sameCommitted=rec.hasCommittedData&&rec.lastCommittedT===rec.t&&rec.lastCommittedParameterT===rec.parameterT;if(sameCommitted){stats.greenArcCommittedReuses++;stats.sceneGreenArcReuses++;}else{encodeGreenArc(rec,enc);stats.greenArcEncodes++;stats.sceneGreenArcEncodes++;callbacks.push(()=>{rec.hasCommittedData=true;rec.lastCommittedT=rec.t;rec.lastCommittedParameterT=rec.parameterT;});}}const table=item.morphArcTable;if(table&&!morphSeen.has(table)){morphSeen.add(table);const committed=typeof isGpuMorphArcTableCommitted==='function'&&isGpuMorphArcTableCommitted(table);const ok=committed?true:(typeof spiroGpuPrepareArcForLayerScene==='function'?spiroGpuPrepareArcForLayerScene(frameCtx,table,enc):encodeGpuMorphArcTable(table,enc));if(!ok)return{handled:false,commandBuffer:null};if(committed||frameCtx?.frame?.gpuLayerSceneDeferred){stats.blueArcMainSceneReuses++;stats.sceneBlueArcReuses++;}else callbacks.push(()=>{try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}});}}
            const pass=enc.beginRenderPass({colorAttachments:[{view:layerSceneView(targetTexture),loadOp:'load',storeOp:'store'}]});let pipelineSet=false,total=0;for(const item of items){if(item.bundle?.list){pass.executeBundles(item.bundle.list);stats.sceneBundleExecutes++;}else{if(!pipelineSet){pass.setPipeline(pipeline);pipelineSet=true;}pass.setBindGroup(0,item.bind);pass.draw(4,item.count);}total+=item.count;}pass.end();
            stats.frames++;stats.draws+=items.length;stats.particles+=total;stats.sceneFrames++;stats.sceneDraws+=items.length;stats.sceneParticles+=total;lastDecision.reason=items.length>1?'layer-scene-corridor':(items[0].greenRec?'layer-scene-green-gpu-arc':(items[0].morphArcTable?'layer-scene-blue-gpu-arc':'layer-scene'));lastDecision.layerIndex=frameCtx?.layerIndex??-1;
            const onSubmitted=callbacks.length?()=>{for(const cb of callbacks)try{cb();}catch(_){}}:null;return{handled:true,commandBuffer:enc.finish(),onSubmitted};
        }catch(err){lastError=String(err?.message||err);stats.errors++;return{handled:false,commandBuffer:null,reason:lastError};}
    }
    function flush(){
        if(!frameActive||!ready||!context){if(canvas)canvas.style.display='none';queue.length=0;return false;}if(!queue.length){if(canvas)canvas.style.display='none';lastDecision.reason='layer-scene/no-overlay';return true;}
        try{
            const enc=device.createCommandEncoder({label:'particle overlay frame'}),computed=new Set(),greenEncoded=new Set(),blueArcSeen=new Set(),blueArcReady=new Set();
            for(const item of queue){
                const rec=item.greenRec;if(rec&&!computed.has(rec)){computed.add(rec);const sameCommitted=rec.hasCommittedData&&rec.lastCommittedT===rec.t&&rec.lastCommittedParameterT===rec.parameterT;if(sameCommitted){stats.greenArcCommittedReuses++;}else{encodeGreenArc(rec,enc);greenEncoded.add(rec);stats.greenArcEncodes++;}}
                const table=item.morphArcTable;if(table&&!blueArcSeen.has(table)){blueArcSeen.add(table);if(typeof isGpuMorphArcTableCommitted==='function'&&isGpuMorphArcTableCommitted(table)){blueArcReady.add(table);stats.blueArcMainSceneReuses++;}else if(encodeGpuMorphArcTable(table,enc)){blueArcReady.add(table);stats.blueArcFusedEncodes++;}}
            }
            const pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});let pipelineSet=false;for(const item of queue){if(item.morphArcTable&&!blueArcReady.has(item.morphArcTable))continue;if(item.bundle?.list){pass.executeBundles(item.bundle.list);stats.overlayBundleExecutes++;}else{if(!pipelineSet){pass.setPipeline(pipeline);pipelineSet=true;}pass.setBindGroup(0,item.bind);pass.draw(4,item.count);}stats.draws++;stats.particles+=item.count;}pass.end();device.queue.submit([enc.finish()]);
            for(const rec of greenEncoded){rec.hasCommittedData=true;rec.lastCommittedT=rec.t;rec.lastCommittedParameterT=rec.parameterT;}
            if(blueArcReady.size){for(const table of blueArcReady)try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}stats.blueArcFusedSubmissions+=blueArcReady.size;}
            stats.frames++;stats.overlayFrames++;canvas.style.display=queue.length?'block':'none';queue.length=0;lastDecision.reason='webgpu-overlay';return true;
        }catch(err){lastError=String(err?.message||err);stats.errors++;canvas.style.display='none';queue.length=0;return false;}
    }
    function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost,attempted,initializing,lastError,lastDecision:{...lastDecision},stats:{...stats},contract:'Particle motion, corridor copies, twinkle alpha, visual-Z helix, scatter, size variation, procedural sprite shading and rasterization are WebGPU-instanced. When a deferred Layer Scene exists, particles render directly into that scene and share its ordered command submission; the transparent overlay is now only a compatibility path. Topology blue Morph reuses the exact resident GPU Arc, and advanced/smooth green Morph evaluates current arc + cumulative lengths with a parallel same-frame GPU prefix scan. No CPU dynamic rail is materialised.'};}
    return{warmup,isReady:()=>warmup(),prewarmGreenPlans,beginOverlayFrame,encodeToLayerScene,queueLayer,flush,status};
})();
window.__spiroParticleGPUStatus=()=>WebGPUParticleRenderer.status();
