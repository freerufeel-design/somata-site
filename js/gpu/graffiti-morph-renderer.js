// SpiroStar v515 — GPU-native topology-Morph Graffiti renderer
// Direct mode expands resident Morph points. Sampled mode consumes exact GPU Arc and a bounded
// bounded GPU-resident 3px / 8..220 arc view for pinched + all variation modes.
window.__spiroRegisterModule?.('js/gpu/graffiti-morph-renderer');

const WebGPUGraffitiMorphRenderer=(()=>{
    const DIRECT_BEZIER_SUBDIV=8,DIRECT_JOIN_VERTS=12,DIRECT_VERTS_PER_SEGMENT=DIRECT_BEZIER_SUBDIV*6+DIRECT_JOIN_VERTS;
    let device=null,format=null,generation=-1,ready=false,initializing=null,lastError='not-initialized',targetViews=new WeakMap();
    const diagnostic={stage:'idle',reason:'',lastBackend:'none',geometryPreparation:'GPU-native morph expansion',gpuDraw:false,failures:0};let lastLoggedFailure='';
    function noteFailure(stage,reason,err=null){const msg=String(reason||err?.message||err||'unknown failure');lastError=msg;diagnostic.stage=stage;diagnostic.reason=msg;diagnostic.failures++;const sig=stage+'|'+msg;if(sig!==lastLoggedFailure){lastLoggedFailure=sig;console.error(`[SpiroStar Graffiti Morph GPU] ${stage}: ${msg}`,{stage,reason:msg,geometryPreparation:diagnostic.geometryPreparation},err||'');}}
    function noteSuccess(stage){diagnostic.stage=stage;diagnostic.reason='';diagnostic.lastBackend='webgpu-layer-scene';diagnostic.gpuDraw=true;lastError='';}
    let pipelineOver=null,pipelineBehind=null,corridorPipelineOver=null,corridorPipelineBehind=null;
    let sampledPipelineOver=null,sampledPipelineBehind=null,sampledCorridorPipelineOver=null,sampledCorridorPipelineBehind=null;
    let uniformLayout=null,pathLayout=null,sampledPathLayout=null,corridorLayout=null,uniformBuffers=[],uniformBinds=[],uniformCursor=0;
    let pathBinds=new WeakMap(),sampledPathBinds=new WeakMap(),copyBinds=new WeakMap();
    const uniformData=new Float32Array(32);
    const stats={frames:0,draws:0,corridorDraws:0,logicalVertices:0,cpuMeshesAvoided:0,cpuPointTouchesAvoided:0,morphComputesFused:0,
        sampledFrames:0,sampleComputesFused:0,arcComputesFused:0,sampledLogicalVertices:0,contourGlowFrames:0,contourGlowMasks:0,failures:0,sharedCopyReuses:0,uniformBindReuses:0};

    const COMMON_HEAD=`
struct U {
    viewport:vec2<f32>, _pad0:vec2<f32>,
    row0:vec4<f32>, row1:vec4<f32>, color:vec4<f32>,
    shape:vec4<f32>, glow:vec4<f32>, variation:vec4<f32>, sampleMode:vec4<f32>
};
@group(0) @binding(0) var<uniform> u:U;
@group(2) @binding(0) var<storage,read> copyData:array<vec4<f32>>;
struct Out {
    @builtin(position) position:vec4<f32>,
    @location(0) bary:vec3<f32>,
    @location(1) @interpolate(flat) edgeMask:vec3<f32>,
    @location(2) @interpolate(flat) copyAlpha:f32,
    @location(3) side:f32,
    @location(4) @interpolate(flat) valid:f32
};
fn normalizedOrZero(v:vec2<f32>)->vec2<f32>{let l=length(v);if(l>0.000001){return v/l;}return vec2<f32>(0.0);}
fn emit(localP:vec2<f32>,bary:vec3<f32>,mask:vec3<f32>,side:f32,valid:f32,copy0:vec4<f32>,copy1:vec4<f32>,useCopy:bool)->Out{
    var p=localP;var copyAlpha=1.0;if(useCopy){p=vec2<f32>(copy0.x*p.x+copy0.y*p.y,copy1.x*p.x+copy1.y*p.y);copyAlpha=copy0.z;}
    let q=vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);
    var o:Out;o.position=vec4<f32>(q.x/max(1.0,u.viewport.x)*2.0-1.0,1.0-q.y/max(1.0,u.viewport.y)*2.0,0.0,1.0);
    o.bary=bary;o.edgeMask=mask;o.copyAlpha=copyAlpha;o.side=side;o.valid=valid;return o;
}
fn finishFragment(v:Out)->vec4<f32>{
    if(v.valid<0.5){discard;}
    let fw=max(fwidth(v.bary),vec3<f32>(0.00001));let edge=smoothstep(vec3<f32>(0.0),fw*1.15,v.bary);var cov=1.0;
    if(v.edgeMask.x>0.5){cov=min(cov,edge.x);}if(v.edgeMask.y>0.5){cov=min(cov,edge.y);}if(v.edgeMask.z>0.5){cov=min(cov,edge.z);}
    let cr=clamp(u.glow.x,0.0,1.0);let gs=max(0.0,u.glow.y);let s=abs(v.side);let sw=max(fwidth(s)*1.35,0.0005);
    let core=1.0-smoothstep(max(0.0,cr-sw),min(1.0,cr+sw),s);let denom=max(0.0001,1.0-cr);let haloT=clamp((1.0-s)/denom,0.0,1.0);let halo=(1.0-core)*pow(haloT,1.65)*gs;
    let a=clamp(u.color.a*v.copyAlpha*(core+halo)*cov,0.0,1.0);if(a<0.0001){discard;}return vec4<f32>(u.color.rgb*a,a);
}`;

    const DIRECT_WGSL=COMMON_HEAD+`
const BEZIER_SUBDIV:u32=8u;
@group(1) @binding(0) var<storage,read> cubics:array<vec4<f32>>;
@group(1) @binding(1) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(1) @binding(2) var<storage,read> pathRanges:array<vec4<u32>>;
@group(1) @binding(3) var<storage,read> pathSegmentRanges:array<vec4<u32>>;
fn cubicPoint(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;}
fn cubicTangent(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let q=1.0-t;return 3.0*q*q*(c1-p0)+6.0*q*t*(c2-c1)+3.0*t*t*(p3-c2);}
fn segmentTangent(segmentIndex:u32,t:f32)->vec2<f32>{
    let r0=cubics[segmentIndex*2u];let r1=cubics[segmentIndex*2u+1u];let p0=r0.xy;let c1=r0.zw;let c2=r1.xy;let p3=r1.zw;var tangent=cubicTangent(p0,c1,c2,p3,t);
    if(length(tangent)<0.000001){tangent=p3-p0;}if(length(tangent)<0.000001){tangent=vec2<f32>(1.0,0.0);}return normalize(tangent);
}
fn fixedNibDir(tangent:vec2<f32>)->vec2<f32>{
    let ca=cos(u.shape.y);let sa=sin(u.shape.y);let stretch=max(0.000001,u.shape.z);
    let q=vec2<f32>((ca*tangent.x+sa*tangent.y)/stretch,-sa*tangent.x+ca*tangent.y);if(length(q)<0.000001){return vec2<f32>(1.0,0.0);}return normalize(q);
}
fn fixedNibToWorld(v:vec2<f32>)->vec2<f32>{let ca=cos(u.shape.y);let sa=sin(u.shape.y);let stretch=max(0.000001,u.shape.z);return vec2<f32>(ca*stretch*v.x-sa*v.y,sa*stretch*v.x+ca*v.y);}
fn nibOffset(tangent:vec2<f32>,side:f32)->vec2<f32>{
    let baseHalf=max(0.225,u.shape.x*u.shape.w*0.5);
    if(u.glow.z<0.5){let d=fixedNibDir(tangent);return fixedNibToWorld(vec2<f32>(-d.y,d.x)*baseHalf*side);}
    // Relative-angle mode has a rotating nib frame; keep its local support exact per span.
    let angle=atan2(tangent.y,tangent.x)+u.shape.y;let ca=cos(angle);let sa=sin(angle);let majorDir=vec2<f32>(ca,sa);let minorDir=vec2<f32>(-sa,ca);let normal=vec2<f32>(-tangent.y,tangent.x);
    let a=baseHalf*u.shape.z;let b=baseHalf;let dm=dot(normal,majorDir);let dn=dot(normal,minorDir);let support=length(vec2<f32>(a*dm,b*dn));if(support<=0.000000001){return vec2<f32>(0.0);}let major=(a*a*dm)/support;let minor=(b*b*dn)/support;return (majorDir*major+minorDir*minor)*side;
}
fn ribbonPoint(segmentIndex:u32,t:f32,side:f32)->vec2<f32>{
    let r0=cubics[segmentIndex*2u];let r1=cubics[segmentIndex*2u+1u];let p=cubicPoint(r0.xy,r0.zw,r1.xy,r1.zw,t);let tangent=segmentTangent(segmentIndex,t);
    // Do not average authored corner tangents: that changed the cross-section at the end of a
    // straight span and looked exactly like Size/Rotation Variation while both toggles were off.
    // Each span keeps its own constant nib support; a separate join primitive closes boundaries.
    return p+nibOffset(tangent,side);
}
fn joinVertex(segmentIndex:u32,jv:u32,copy0:vec4<f32>,copy1:vec4<f32>,useCopy:bool)->Out{
    let metaData=segmentMeta[segmentIndex];let pathIndex=metaData.z;let ps=pathSegmentRanges[pathIndex];let localSeg=segmentIndex-ps.x;let closed=pathRanges[pathIndex].z!=0u;
    var nextIndex=segmentIndex+1u;var hasJoin=localSeg+1u<ps.y;if(!hasJoin&&closed&&ps.y>1u){nextIndex=ps.x;hasJoin=true;}
    if(!hasJoin){return emit(vec2<f32>(0.0),vec3<f32>(1.0,0.0,0.0),vec3<f32>(0.0),0.0,0.0,copy0,copy1,useCopy);}
    let r0=cubics[segmentIndex*2u];let r1=cubics[segmentIndex*2u+1u];let p=r1.zw;let d0=segmentTangent(segmentIndex,1.0);let d1=segmentTangent(nextIndex,0.0);
    if(length(d0+d1)<0.000001){return emit(vec2<f32>(0.0),vec3<f32>(1.0,0.0,0.0),vec3<f32>(0.0),0.0,0.0,copy0,copy1,useCopy);}
    let sideSign=select(1.0,-1.0,jv>=6u);let renderSide=select(-1.0,1.0,jv>=6u);let local=jv%6u;
    let inOff=nibOffset(d0,sideSign);let outOff=nibOffset(d1,sideSign);var useMiter=false;var miterOff=vec2<f32>(0.0);
    // Pointed + absolute angle follows Canvas: miter until miterLimit 2.6, then bevel.
    if(u.sampleMode.y<0.5&&u.glow.z<0.5){let n0=vec2<f32>(-fixedNibDir(d0).y,fixedNibDir(d0).x)*sideSign;let n1=vec2<f32>(-fixedNibDir(d1).y,fixedNibDir(d1).x)*sideSign;let mm=n0+n1;let ml=length(mm);if(ml>0.000001){let md=mm/ml;let den=dot(md,n1);if(abs(den)>0.000001){let half=max(0.225,u.shape.x*u.shape.w*0.5);let mlen=half/den;if(abs(mlen)/max(0.000001,half)<=2.6){miterOff=fixedNibToWorld(md*mlen);useMiter=true;}}}}
    var localP=p;var valid=1.0;var bary=vec3<f32>(1.0,0.0,0.0);let mask=vec3<f32>(1.0,0.0,0.0);
    if(useMiter){
        if(local==1u){localP=p+inOff;bary=vec3<f32>(0.0,1.0,0.0);}else if(local==2u){localP=p+miterOff;bary=vec3<f32>(0.0,0.0,1.0);}else if(local==3u){localP=p;bary=vec3<f32>(1.0,0.0,0.0);}else if(local==4u){localP=p+miterOff;bary=vec3<f32>(0.0,1.0,0.0);}else if(local==5u){localP=p+outOff;bary=vec3<f32>(0.0,0.0,1.0);}
    }else{
        if(local==0u){localP=p;}else if(local==1u){localP=p+inOff;bary=vec3<f32>(0.0,1.0,0.0);}else if(local==2u){localP=p+outOff;bary=vec3<f32>(0.0,0.0,1.0);}else{valid=0.0;}
    }
    return emit(localP,bary,mask,renderSide,valid,copy0,copy1,useCopy);
}
fn makeVertex(vid:u32,copy0:vec4<f32>,copy1:vec4<f32>,useCopy:bool)->Out{
    let vertsPerSegment=BEZIER_SUBDIV*6u+12u;let segmentIndex=vid/vertsPerSegment;let within=vid%vertsPerSegment;let baseVerts=BEZIER_SUBDIV*6u;
    if(within>=baseVerts){return joinVertex(segmentIndex,within-baseVerts,copy0,copy1,useCopy);}
    let microIndex=within/6u;let corner=within%6u;let sub=microIndex%BEZIER_SUBDIV;let t0=f32(sub)/f32(BEZIER_SUBDIV);let t1=f32(sub+1u)/f32(BEZIER_SUBDIV);
    let metaData=segmentMeta[segmentIndex];let pathIndex=metaData.z;let ps=pathSegmentRanges[pathIndex];let localSeg=segmentIndex-ps.x;let pathRange=pathRanges[pathIndex];let open=pathRange.z==0u;
    let startEdge=select(0.0,1.0,open&&localSeg==0u&&sub==0u);let endEdge=select(0.0,1.0,open&&localSeg+1u>=ps.y&&sub+1u==BEZIER_SUBDIV);
    var t=t0;var side=-1.0;var bary=vec3<f32>(1.0,0.0,0.0);var mask=vec3<f32>(0.0,1.0,startEdge);
    if(corner==1u){t=t0;side=1.0;bary=vec3<f32>(0.0,1.0,0.0);}else if(corner==2u){t=t1;side=-1.0;bary=vec3<f32>(0.0,0.0,1.0);}
    else if(corner==3u){t=t1;side=-1.0;bary=vec3<f32>(1.0,0.0,0.0);mask=vec3<f32>(1.0,endEdge,0.0);}else if(corner==4u){t=t0;side=1.0;bary=vec3<f32>(0.0,1.0,0.0);mask=vec3<f32>(1.0,endEdge,0.0);}else if(corner==5u){t=t1;side=1.0;bary=vec3<f32>(0.0,0.0,1.0);mask=vec3<f32>(1.0,endEdge,0.0);}
    return emit(ribbonPoint(segmentIndex,t,side),bary,mask,side,1.0,copy0,copy1,useCopy);
}
@vertex fn vs(@builtin(vertex_index) vid:u32)->Out{return makeVertex(vid,vec4<f32>(0.0),vec4<f32>(0.0),false);}
@vertex fn vsCorridor(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->Out{return makeVertex(vid,copyData[iid*2u],copyData[iid*2u+1u],true);}
@fragment fn fs(v:Out)->@location(0) vec4<f32>{return finishFragment(v);}`;

    const SAMPLED_WGSL=COMMON_HEAD+`
const SAMPLE_STRIDE:u32=224u;
const MAX_RENDER_SEGMENTS:u32=221u;
@group(1) @binding(0) var<storage,read> sampled:array<vec4<f32>>;
@group(1) @binding(1) var<storage,read> sampleInfo:array<vec4<f32>>;
@group(1) @binding(2) var<storage,read> pathMetrics:array<vec4<f32>>;
@group(1) @binding(3) var<storage,read> arcMeta:array<vec4<f32>>;
fn focusDistance(t0:f32,focus0:f32)->f32{let f=clamp(focus0,0.001,0.999);let t=clamp(t0,0.0,1.0);if(t<=f){return(f-t)/f;}return(t-f)/(1.0-f);}
fn rotationProgress(t0:f32,focus0:f32)->f32{let f=clamp(focus0,0.001,0.999);let t=clamp(t0,0.0,1.0);if(t<=f){return 0.5*(t/f);}return 0.5+0.5*((t-f)/(1.0-f));}
fn variationT(pathIndex:u32,localT:f32,p:vec2<f32>)->f32{
    let mode=u.sampleMode.x;let t=clamp(localT,0.0,1.0);
    // 1=perPath, 2=whole, 3=perSegment, 4=everyNth, 5=across.  Segment/group
    // cycles are logical authoring cycles supplied by the CPU as one scalar; all geometry
    // positions still come from the GPU Bézier-derived Arc.
    if(mode>1.5&&mode<2.5){let pm=pathMetrics[pathIndex];let total=max(0.000001,arcMeta[0].x);return clamp((pm.x+t*pm.y)/total,0.0,1.0);}
    if(mode>2.5&&mode<4.5){let cycles=max(1.0,u.glow.w);return fract(min(t,0.999999)*cycles);}
    if(mode>4.5){let radius=max(0.000001,u.glow.w);return clamp(0.5+p.x/(2.0*radius),0.0,1.0);}
    return t;
}
fn sampledRibbonPoint(pathIndex:u32,pointLocal:u32,side:f32)->vec2<f32>{
    let info=sampleInfo[pathIndex];let pointCount=max(1u,u32(info.x+0.5));let closed=info.w>0.5&&u.sampleMode.w<0.5;let local=min(pointLocal,pointCount-1u);
    var prevLocal=0u;var nextLocal=min(pointCount-1u,local+1u);
    if(closed){prevLocal=(local+pointCount-1u)%pointCount;nextLocal=(local+1u)%pointCount;}else{if(local>0u){prevLocal=local-1u;}if(local+1u>=pointCount){nextLocal=pointCount-1u;}}
    let base=pathIndex*SAMPLE_STRIDE;let sp=sampled[base+local];let p=sp.xy;let prev=sampled[base+prevLocal].xy;let next=sampled[base+nextLocal].xy;
    let incoming=normalizedOrZero(p-prev);let outgoing=normalizedOrZero(next-p);var tangent=incoming+outgoing;
    if(length(tangent)<0.000001){if(length(outgoing)>0.000001){tangent=outgoing;}else if(length(incoming)>0.000001){tangent=incoming;}else{tangent=vec2<f32>(1.0,0.0);}}
    tangent=normalize(tangent);let normal=vec2<f32>(-tangent.y,tangent.x);
    let t=variationT(pathIndex,sp.w,p);let d=focusDistance(t,u.variation.y);let sizeFactor=max(0.0,1.0-u.variation.x*(1.0-clamp(d,0.0,1.0)));
    let tangentAngle=select(0.0,atan2(tangent.y,tangent.x),u.glow.z>0.5);let angle=tangentAngle+u.shape.y+u.variation.z*rotationProgress(t,u.variation.w);let ca=cos(angle);let sa=sin(angle);
    let majorDir=vec2<f32>(ca,sa);let minorDir=vec2<f32>(-sa,ca);
    let baseHalf=max(0.225,u.shape.x*u.shape.w*0.5);let a=baseHalf*u.shape.z*sizeFactor;let b=baseHalf*sizeFactor;var offset=vec2<f32>(0.0);
    let dm=dot(normal,majorDir);let dn=dot(normal,minorDir);let support=length(vec2<f32>(a*dm,b*dn));if(support>0.000000001){let major=(a*a*dm)/support;let minor=(b*b*dn)/support;offset=majorDir*major+minorDir*minor;}
    if(u.sampleMode.y>0.5&&u.sampleMode.y<1.5){
        let ratio=max(2.0,u.sampleMode.z);let period=max(baseHalf*2.5,ratio*baseHalf*0.9);
        let phase=(sp.z/max(0.000001,period))*6.283185307179586;let waist=0.24+0.76*abs(cos(phase*0.5));offset=offset*waist;
    }
    return p+offset*side;
}
fn makeSampledVertex(vid:u32,copy0:vec4<f32>,copy1:vec4<f32>,useCopy:bool)->Out{
    let vertsPerPath=MAX_RENDER_SEGMENTS*6u;let pathIndex=vid/vertsPerPath;let within=vid%vertsPerPath;let localSeg=within/6u;let corner=within%6u;
    let info=sampleInfo[pathIndex];let pointCount=u32(info.x+0.5);let closed=info.w>0.5&&u.sampleMode.w<0.5;var segCount=0u;
    if(pointCount>=2u){segCount=pointCount-1u;if(closed){segCount=pointCount;}}
    let valid=select(0.0,1.0,pointCount>=2u&&localSeg<segCount);
    let a=min(localSeg,max(1u,pointCount)-1u);var b=min(a+1u,max(1u,pointCount)-1u);if(closed&&a+1u>=pointCount){b=0u;}
    let open=!closed;let startEdge=select(0.0,1.0,open&&localSeg==0u);let endEdge=select(0.0,1.0,open&&localSeg+1u>=segCount);
    var pointLocal=a;var side=-1.0;var bary=vec3<f32>(1.0,0.0,0.0);var mask=vec3<f32>(0.0,1.0,startEdge);
    if(corner==1u){pointLocal=a;side=1.0;bary=vec3<f32>(0.0,1.0,0.0);}
    else if(corner==2u){pointLocal=b;side=-1.0;bary=vec3<f32>(0.0,0.0,1.0);}
    else if(corner==3u){pointLocal=b;side=-1.0;bary=vec3<f32>(1.0,0.0,0.0);mask=vec3<f32>(1.0,endEdge,0.0);}
    else if(corner==4u){pointLocal=a;side=1.0;bary=vec3<f32>(0.0,1.0,0.0);mask=vec3<f32>(1.0,endEdge,0.0);}
    else if(corner==5u){pointLocal=b;side=1.0;bary=vec3<f32>(0.0,0.0,1.0);mask=vec3<f32>(1.0,endEdge,0.0);}
    return emit(sampledRibbonPoint(pathIndex,pointLocal,side),bary,mask,side,valid,copy0,copy1,useCopy);
}
@vertex fn vs(@builtin(vertex_index) vid:u32)->Out{return makeSampledVertex(vid,vec4<f32>(0.0),vec4<f32>(0.0),false);}
@vertex fn vsCorridor(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->Out{return makeSampledVertex(vid,copyData[iid*2u],copyData[iid*2u+1u],true);}
@fragment fn fs(v:Out)->@location(0) vec4<f32>{return finishFragment(v);}`;

    function blend(kind){if(kind==='behind')return{color:{srcFactor:'one-minus-dst-alpha',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one-minus-dst-alpha',dstFactor:'one',operation:'add'}};return{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};}
    async function initAsync(){
        if(ready&&device&&generation===WebGPUDeviceHub.getGeneration())return true;if(initializing)return initializing;
        const task=(async()=>{try{
            const shared=await WebGPUDeviceHub.acquire();device=shared.device;generation=shared.generation;format=navigator.gpu.getPreferredCanvasFormat();
            const directMod=device.createShaderModule({label:'SpiroStar GPU-native Morph Graffiti WGSL',code:DIRECT_WGSL});
            const sampledMod=device.createShaderModule({label:'SpiroStar GPU-sampled Morph Graffiti WGSL',code:SAMPLED_WGSL});
            if(typeof assertWebGPUShaderModule==='function'){await assertWebGPUShaderModule(directMod,'SpiroStar GPU-native Morph Graffiti WGSL');await assertWebGPUShaderModule(sampledMod,'SpiroStar GPU-sampled Morph Graffiti WGSL');}
            uniformLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
            pathLayout=device.createBindGroupLayout({entries:[0,1,2,3].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}))});
            sampledPathLayout=device.createBindGroupLayout({entries:[0,1,2,3].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}))});
            corridorLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
            const make=(mod,kind,corridor=false,sampled=false)=>device.createRenderPipeline({label:`SpiroStar ${sampled?'sampled ':' '}Morph Graffiti ${kind}${corridor?' corridor':''}`,
                layout:device.createPipelineLayout({bindGroupLayouts:corridor?[uniformLayout,sampled?sampledPathLayout:pathLayout,corridorLayout]:[uniformLayout,sampled?sampledPathLayout:pathLayout]}),
                vertex:{module:mod,entryPoint:corridor?'vsCorridor':'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:blend(kind)}]},primitive:{topology:'triangle-list',cullMode:'none'}});
            pipelineOver=make(directMod,'over');pipelineBehind=make(directMod,'behind');corridorPipelineOver=make(directMod,'over',true);corridorPipelineBehind=make(directMod,'behind',true);
            sampledPipelineOver=make(sampledMod,'over',false,true);sampledPipelineBehind=make(sampledMod,'behind',false,true);sampledCorridorPipelineOver=make(sampledMod,'over',true,true);sampledCorridorPipelineBehind=make(sampledMod,'behind',true,true);
            uniformBuffers=Array.from({length:64},(_,i)=>device.createBuffer({label:`SpiroStar Morph Graffiti uniforms ${i}`,size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
            uniformBinds=uniformBuffers.map(buffer=>device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer}}]}));
            uniformCursor=0;pathBinds=new WeakMap();sampledPathBinds=new WeakMap();copyBinds=new WeakMap();ready=true;lastError='';return true;
        }catch(err){ready=false;lastError=String(err?.message||err);stats.failures++;return false;}})();initializing=task;try{return await task;}finally{if(initializing===task)initializing=null;}
    }
    function warmup(){
        try{WebGPUGraffitiContourGlow?.warmup?.();}catch(_){}
        const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration():-1;
        if(ready&&gen!==generation){ready=false;device=null;pipelineOver=pipelineBehind=corridorPipelineOver=corridorPipelineBehind=null;sampledPipelineOver=sampledPipelineBehind=sampledCorridorPipelineOver=sampledCorridorPipelineBehind=null;uniformBuffers=[];uniformBinds=[];pathBinds=new WeakMap();sampledPathBinds=new WeakMap();copyBinds=new WeakMap();targetViews=new WeakMap();}
        if(!ready&&!initializing)void initAsync();return ready;
    }
    function styleParams(layer,widthOverride=null,colorOverride=null){
        const type=['round','slash','square'].includes(layer?.lineProfileGraffiti)?layer.lineProfileGraffiti:'slash';
        const shape=['pointed','blunt','pinched','round'].includes(layer?.graffitiNibShape)?layer.graffitiNibShape:'pointed';
        const nibBase=Math.max(1,Math.min(20,Number(layer?.graffitiNibLength)||10)),nibMul=Math.max(.01,Number.isFinite(Number(layer?.graffitiNibLengthMultiplier))?Number(layer.graffitiNibLengthMultiplier):1),ratio=nibBase*nibMul;
        const stretch=typeof graffitiNibStretch==='function'?graffitiNibStretch(type,ratio,shape):(type==='slash'?(shape==='pinched'?1:shape==='round'?Math.max(1,ratio*.72):shape==='blunt'?Math.max(1,ratio*.92):ratio):1);
        const widthFactor=typeof graffitiNibWidthFactor==='function'?graffitiNibWidthFactor(type,shape):((type==='square'?1.04:1)*(shape==='round'?1.06:shape==='blunt' ? .96 : 1));
        const rawAngle=Number(layer?.graffitiAngle),angle=Math.max(-90,Math.min(90,Number.isFinite(rawAngle)?rawAngle:45))*Math.PI/180;
        const sizeStrength=layer?.graffitiSizeVariationEnabled===true&&Math.max(0,Number(layer?.graffitiSizeVariation)||0)>0?Math.max(0,Math.min(1,(Number(layer?.graffitiSizeVariation)||0)/100)):0;
        const sizeFocus=Math.max(0,Math.min(1,(Number.isFinite(Number(layer?.graffitiSizeFocus))?Number(layer.graffitiSizeFocus):50)/100));
        const rawMul=Number(layer?.graffitiRotationMultiplier),rotDeg=layer?.graffitiRotationVariationEnabled===true&&Math.max(0,Number(layer?.graffitiRotationVariation)||0)>0?Math.max(0,Number(layer?.graffitiRotationVariation)||0)*Math.max(0,Number.isFinite(rawMul)?rawMul:1):0;
        const rotationFocus=Math.max(0,Math.min(1,(Number.isFinite(Number(layer?.graffitiRotationFocus))?Number(layer.graffitiRotationFocus):50)/100));
        const variationActive=sizeStrength>0||rotDeg>0;
        const rawMode=['perSegment','everyNth','across','perPath','whole'].includes(layer?.graffitiVariationMode)?layer.graffitiVariationMode:'perSegment';
        const modeCode={perPath:1,whole:2,perSegment:3,everyNth:4,across:5}[rawMode]||3;
        const n=Math.max(2,Math.round(Number(layer?.N)||4)),k=Math.max(1,Math.round(Number(layer?.K)||1));let a=n,b=k;while(b){const r=a%b;a=b;b=r;}const logicalSegments=Math.max(1,Math.round(n/Math.max(1,a)));
        const everyN=Math.max(1,Math.min(24,Math.round(Number(layer?.graffitiVariationEveryN)||2)));
        const variationAux=rawMode==='across'?Math.max(1e-3,Number(typeof getEffectiveLayerRadius==='function'?getEffectiveLayerRadius(layer,220):layer?.radius)||220):(rawMode==='everyNth'?Math.max(1,logicalSegments/everyN):logicalSegments);
        return{width:Math.max(.001,Number(widthOverride??((Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer)))||1.5),color:String(colorOverride??layer?.strokeColor??'#ffffff'),
            angle,angleMode:layer?.graffitiAngleMode==='relative'?'relative':'absolute',stretch,widthFactor,nibRatio:ratio,pinched:shape==='pinched',shapeCode:shape==='pointed'?0:(shape==='pinched'?1:2),sizeStrength,sizeFocus,rotationTotal:rotDeg*Math.PI/180,rotationFocus,variationMode:modeCode,variationAux,variationActive};
    }
    function sceneView(texture){let view=targetViews.get(texture);if(view)return view;view=texture.createView();targetViews.set(texture,view);return view;}
    function pathBind(rec){let bg=pathBinds.get(rec);if(bg)return bg;bg=device.createBindGroup({layout:pathLayout,entries:[{binding:0,resource:{buffer:rec.cubicBuffer}},{binding:1,resource:{buffer:rec.segmentMetaBuffer}},{binding:2,resource:{buffer:rec.pathRangeBuffer}},{binding:3,resource:{buffer:rec.pathSegmentRangeBuffer}}]});pathBinds.set(rec,bg);return bg;}
    function sampledPathBind(sampleRec,arcRec){
        let byArc=sampledPathBinds.get(sampleRec);if(!byArc){byArc=new WeakMap();sampledPathBinds.set(sampleRec,byArc);}let bg=byArc.get(arcRec);if(bg)return bg;
        bg=device.createBindGroup({layout:sampledPathLayout,entries:[{binding:0,resource:{buffer:sampleRec.samplePointBuffer}},{binding:1,resource:{buffer:sampleRec.sampleInfoBuffer}},{binding:2,resource:{buffer:arcRec.pathMetricsBuffer}},{binding:3,resource:{buffer:arcRec.metaBuffer}}]});byArc.set(arcRec,bg);return bg;
    }
    function copyBind(buffer){let bg=copyBinds.get(buffer);if(bg)return bg;bg=device.createBindGroup({layout:corridorLayout,entries:[{binding:0,resource:{buffer}}]});copyBinds.set(buffer,bg);return bg;}
    function uniformBind(targetCtx,style,alpha,outerWidth){
        const m=targetCtx?.getTransform?.();if(!m||!uniformBuffers.length)return null;const c=GPUColorCache.rgba(style.color);
        // Morph Graffiti core stays unexpanded. Its contour Glow rasterizes this same procedural
        // GPU ribbon to a mask and blurs it in WebGPU, avoiding support-ribbon wedges.
        const actualOuter=style.width,coreRatio=1,haloStrength=0;
        uniformData.fill(0);uniformData[0]=mainCanvas.width;uniformData[1]=mainCanvas.height;uniformData[4]=m.a;uniformData[5]=m.c;uniformData[6]=m.e;uniformData[8]=m.b;uniformData[9]=m.d;uniformData[10]=m.f;
        uniformData[12]=c[0];uniformData[13]=c[1];uniformData[14]=c[2];uniformData[15]=Math.max(0,Math.min(1,Number(alpha)||0));
        uniformData[16]=actualOuter;uniformData[17]=style.angle;uniformData[18]=style.stretch;uniformData[19]=style.widthFactor;uniformData[20]=coreRatio;uniformData[21]=haloStrength;uniformData[22]=style.angleMode==='relative'?1:0;uniformData[23]=Math.max(1e-6,Number(style.variationAux)||1);
        uniformData[24]=style.sizeStrength;uniformData[25]=style.sizeFocus;uniformData[26]=style.rotationTotal;uniformData[27]=style.rotationFocus;
        uniformData[28]=style.variationMode;uniformData[29]=style.shapeCode;uniformData[30]=style.nibRatio;uniformData[31]=style.variationActive?1:0;
        const slot=uniformCursor++%uniformBuffers.length,ub=uniformBuffers[slot];device.queue.writeBuffer(ub,0,uniformData.buffer,0,128);stats.uniformBindReuses++;return uniformBinds[slot]||null;
    }
    function canEncode(prepared){
        if(!warmup()||prepared?.gpuMorphNative!==true)return false;
        if(prepared?.gpuMorphSampled===true)return Boolean(prepared.gpuGraffitiSampleResource?.ready&&prepared.gpuMorphArcTable?._gpuMorphArcResource?.ready);
        return Boolean(prepared.gpuMorphResource?.ready&&prepared.gpuMorphResource.segmentCount>0);
    }
    function encode(targetTexture,prepared,layer,alpha,targetCtx,composite='source-over',copies=null,alphas=null,frameCtx=null,footprint=1,override=null){
        if(!targetTexture||alpha<=.001||!canEncode(prepared))return{handled:false,commandBuffer:null};
        try{
            const sampled=prepared.gpuMorphSampled===true,style={...styleParams(layer,override?.width,override?.color),layer};
            const outerWidth=style.width;
            const ub=uniformBind(targetCtx,style,alpha,outerWidth);if(!ub)return{handled:false,commandBuffer:null};
            let instanceCount=1,copyBg=null;
            if(Array.isArray(copies)&&copies.length){const shared=WebGPUCorridorCopyStore.acquire(device,generation,frameCtx,copies,alphas,'graffiti',footprint,layer);if(!shared?.buffer||!shared.k)return{handled:false,commandBuffer:null};instanceCount=shared.k;copyBg=copyBind(shared.buffer);stats.sharedCopyReuses++;}
            const enc=device.createCommandEncoder({label:`SpiroStar ${sampled?'GPU-sampled':'GPU-native'} Morph Graffiti`});
            let drawVertices=0,pathBg=null,onSubmitted=null;
            if(sampled){
                const table=prepared.gpuMorphArcTable,sampleRec=prepared.gpuGraffitiSampleResource,arcRec=table?._gpuMorphArcResource;
                if(!sampleRec?.ready||!arcRec?.ready||typeof encodeGpuGraffitiSampleResource!=='function'||!encodeGpuGraffitiSampleResource(sampleRec,table,enc,frameCtx))throw new Error('GPU Graffiti sample encode failed');
                stats.sampleComputesFused++;stats.arcComputesFused++;pathBg=sampledPathBind(sampleRec,arcRec);drawVertices=sampleRec.pathCount*GPU_GRAFFITI_SAMPLE_INTERVALS_MAX*6+sampleRec.pathCount*6;
                onSubmitted=()=>noteGpuGraffitiSampleSubmitted?.(sampleRec,table);
            }else{
                const rec=prepared.gpuMorphResource,t=typeof rec.resolveMorphT==='function'?rec.resolveMorphT(prepared.gpuMorphT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(prepared.gpuMorphT):Math.max(0,Math.min(1,Number(prepared.gpuMorphT)||0)));
                const morphReady=typeof spiroGpuPrepareMorphForLayerScene==='function'?spiroGpuPrepareMorphForLayerScene(frameCtx,rec,t,enc):(typeof rec.encodeCurrentCubics==='function'?rec.encodeCurrentCubics(enc,t):(typeof encodeSharedGpuMorphPath==='function'&&encodeSharedGpuMorphPath(enc,rec.layerIndex,t)));if(!morphReady)throw new Error('shared GPU Bézier Morph encode failed');
                stats.morphComputesFused++;pathBg=pathBind(rec);drawVertices=rec.segmentCount*DIRECT_VERTS_PER_SEGMENT;onSubmitted=()=>{if(typeof rec.encodeCurrentCubics!=='function')noteSharedGpuMorphPathSubmitted?.(rec,t,prepared.frameId);};
            }
            const pass=enc.beginRenderPass({colorAttachments:[{view:sceneView(targetTexture),loadOp:'load',storeOp:'store'}]});
            const over=composite!=='destination-over';
            pass.setPipeline(sampled?(copyBg?(over?sampledCorridorPipelineOver:sampledCorridorPipelineBehind):(over?sampledPipelineOver:sampledPipelineBehind)):(copyBg?(over?corridorPipelineOver:corridorPipelineBehind):(over?pipelineOver:pipelineBehind)));
            pass.setBindGroup(0,ub);pass.setBindGroup(1,pathBg);if(copyBg)pass.setBindGroup(2,copyBg);pass.draw(drawVertices,instanceCount,0,0);pass.end();
            stats.frames++;stats.draws++;if(copyBg)stats.corridorDraws++;stats.logicalVertices+=drawVertices*instanceCount;stats.cpuMeshesAvoided++;
            if(sampled){stats.sampledFrames++;stats.sampledLogicalVertices+=drawVertices*instanceCount;stats.cpuPointTouchesAvoided+=prepared.gpuMorphResource?.pointCount||prepared.gpuMorphArcTable?._gpuMorphArcResource?.morphRec?.pointCount||0;}
            else stats.cpuPointTouchesAvoided+=prepared.gpuMorphResource?.pointCount||0;
            noteSuccess(sampled?'sampled encode/draw':'native encode/draw');return{handled:true,commandBuffer:enc.finish(),onSubmitted};
        }catch(err){stats.failures++;noteFailure('encode/draw',err?.message||err,err);return{handled:false,commandBuffer:null};}
    }
    function encodeGlow(targetTexture,prepared,layer,maskAlpha,targetCtx,opts={},copies=null,alphas=null,frameCtx=null,footprint=1){
        const radiusPx=Math.max(.5,Number(opts?.radiusPx)||0),alphaScale=Math.max(0,Math.min(1,Number(opts?.alphaScale)||0));
        if(!targetTexture||alphaScale<=.001||!canEncode(prepared)||typeof WebGPUGraffitiContourGlow==='undefined'||!WebGPUGraffitiContourGlow.isReady?.())return{handled:false,commandBuffer:null};
        try{
            const sampled=prepared.gpuMorphSampled===true,style={...styleParams(layer,opts?.width,opts?.color),layer},maskStyle={...style,color:'#ffffff'};
            const ub=uniformBind(targetCtx,maskStyle,Math.max(0,Math.min(1,Number(maskAlpha)||0)),style.width);if(!ub)return{handled:false,commandBuffer:null};
            let instanceCount=1,copyBg=null;if(Array.isArray(copies)&&copies.length){const shared=WebGPUCorridorCopyStore.acquire(device,generation,frameCtx,copies,alphas,'graffiti',footprint,layer);if(!shared?.buffer||!shared.k)return{handled:false,commandBuffer:null};instanceCount=shared.k;copyBg=copyBind(shared.buffer);stats.sharedCopyReuses++;}
            const slot=WebGPUGraffitiContourGlow.acquire(mainCanvas.width,mainCanvas.height);if(!slot){noteFailure('contour-glow acquire','GPU contour Glow scratch textures unavailable');return{handled:false,commandBuffer:null};}
            const enc=device.createCommandEncoder({label:`Somata ${sampled?'GPU-sampled':'GPU-native'} Morph Graffiti contour Glow`});let drawVertices=0,pathBg=null,onSubmitted=null;
            if(sampled){
                const table=prepared.gpuMorphArcTable,sampleRec=prepared.gpuGraffitiSampleResource,arcRec=table?._gpuMorphArcResource;if(!sampleRec?.ready||!arcRec?.ready||typeof encodeGpuGraffitiSampleResource!=='function'||!encodeGpuGraffitiSampleResource(sampleRec,table,enc,frameCtx))throw new Error('GPU Graffiti sample encode failed for contour Glow');
                stats.sampleComputesFused++;stats.arcComputesFused++;pathBg=sampledPathBind(sampleRec,arcRec);drawVertices=sampleRec.pathCount*GPU_GRAFFITI_SAMPLE_INTERVALS_MAX*6+sampleRec.pathCount*6;onSubmitted=()=>noteGpuGraffitiSampleSubmitted?.(sampleRec,table);
            }else{
                const rec=prepared.gpuMorphResource,t=typeof rec.resolveMorphT==='function'?rec.resolveMorphT(prepared.gpuMorphT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(prepared.gpuMorphT):Math.max(0,Math.min(1,Number(prepared.gpuMorphT)||0)));
                const morphReady=typeof spiroGpuPrepareMorphForLayerScene==='function'?spiroGpuPrepareMorphForLayerScene(frameCtx,rec,t,enc):(typeof rec.encodeCurrentCubics==='function'?rec.encodeCurrentCubics(enc,t):(typeof encodeSharedGpuMorphPath==='function'&&encodeSharedGpuMorphPath(enc,rec.layerIndex,t)));if(!morphReady)throw new Error('shared GPU Bézier Morph encode failed for contour Glow');
                stats.morphComputesFused++;pathBg=pathBind(rec);drawVertices=rec.segmentCount*DIRECT_VERTS_PER_SEGMENT;onSubmitted=()=>{if(typeof rec.encodeCurrentCubics!=='function')noteSharedGpuMorphPathSubmitted?.(rec,t,prepared.frameId);};
            }
            let pass=enc.beginRenderPass({colorAttachments:[{view:slot.mask.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});const over=true;
            pass.setPipeline(sampled?(copyBg?sampledCorridorPipelineOver:sampledPipelineOver):(copyBg?corridorPipelineOver:pipelineOver));pass.setBindGroup(0,ub);pass.setBindGroup(1,pathBg);if(copyBg)pass.setBindGroup(2,copyBg);pass.draw(drawVertices,instanceCount,0,0);pass.end();
            const color=GPUColorCache.rgba(style.color);if(!WebGPUGraffitiContourGlow.encodeBlurComposite(enc,slot,targetTexture,{radiusPx,alphaScale,color,composite:opts?.composite||'source-over'}))throw new Error('GPU contour Glow blur/composite encode failed');
            stats.frames++;stats.draws++;if(copyBg)stats.corridorDraws++;stats.logicalVertices+=drawVertices*instanceCount;stats.cpuMeshesAvoided++;stats.contourGlowFrames++;stats.contourGlowMasks++;
            if(sampled){stats.sampledFrames++;stats.sampledLogicalVertices+=drawVertices*instanceCount;stats.cpuPointTouchesAvoided+=prepared.gpuMorphResource?.pointCount||prepared.gpuMorphArcTable?._gpuMorphArcResource?.morphRec?.pointCount||0;}else stats.cpuPointTouchesAvoided+=prepared.gpuMorphResource?.pointCount||0;
            noteSuccess(sampled?'sampled contour-glow encode/draw':'native contour-glow encode/draw');return{handled:true,commandBuffer:enc.finish(),onSubmitted};
        }catch(err){stats.failures++;noteFailure('contour-glow encode/draw',err?.message||err,err);return{handled:false,commandBuffer:null};}
    }
    function encodeGlowToLayerScene(targetTexture,prepared,layer,maskAlpha,targetCtx,opts={},frameCtx=null){return encodeGlow(targetTexture,prepared,layer,maskAlpha,targetCtx,opts,null,null,frameCtx,1);}
    function encodeCorridorGlowToLayerScene(targetTexture,prepared,layer,targetCtx,copies,alphas,frameCtx,footprint=1,opts={}){return encodeGlow(targetTexture,prepared,layer,1,targetCtx,opts,copies,alphas,frameCtx,footprint);}

    function encodeToLayerScene(targetTexture,prepared,layer,alpha,targetCtx,composite='source-over',override=null,frameCtx=null){return encode(targetTexture,prepared,layer,alpha,targetCtx,composite,null,null,frameCtx,1,override);}
    function encodeCorridorToLayerScene(targetTexture,prepared,layer,alpha,targetCtx,copies,alphas,frameCtx,footprint=1,composite='source-over',override=null){return encode(targetTexture,prepared,layer,alpha,targetCtx,composite,copies,alphas,frameCtx,footprint,override);}
    function status(){warmup();return{available:ready,lastError,generation,diagnostic:{...diagnostic},geometryPreparation:diagnostic.geometryPreparation,...stats,contourGlow:typeof WebGPUGraffitiContourGlow!=='undefined'?WebGPUGraffitiContourGlow.status?.()||null:null,contract:'topology/Spiral Morph Graffiti stays GPU-native: plain evaluates the shared retained cubic rail directly; pinched and all variation modes use the exact Bézier-derived GPU Arc + bounded GPU-resident sampling. Glow is exact-ribbon GPU mask blur. No strict-Spiral variation mode requires CPU geometry or Canvas presentation.'};}
    return{warmup,isReady:()=>warmup(),canEncode,encodeToLayerScene,encodeCorridorToLayerScene,encodeGlowToLayerScene,encodeCorridorGlowToLayerScene,status};
})();
window.__spiroGpuMorphGraffitiStatus=()=>WebGPUGraffitiMorphRenderer.status();
