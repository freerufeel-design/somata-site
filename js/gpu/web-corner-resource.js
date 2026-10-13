

window.__spiroRegisterModule?.('js/gpu/web-corner-resource');

const GPU_WEB_MAX_CORNERS=220;
const GPU_WEB_MAX_THREADS_PER_CORNER=96;
const GPU_WEB_MAX_THREAD_SLOTS=GPU_WEB_MAX_CORNERS*GPU_WEB_MAX_THREADS_PER_CORNER;
const GPU_WEB_CORNER_WG=256;
const gpuWebCornerZeroCounter=new Uint32Array(1);
const gpuWebCornerRuntime={
    device:null,generation:-1,ready:false,initializing:null,lastError:'not-initialized',pipelines:null,
    resources:new WeakMap(),resourceSet:new Set(),layerStates:new Map(),
    stats:{requests:0,builds:0,hits:0,encodes:0,areaDispatches:0,classifyDispatches:0,cornerCompactDispatches:0,cornerScanDispatches:0,cornerScanOffsetDispatches:0,cornerScatterDispatches:0,cornerFinalizeDispatches:0,cornerSpanDispatches:0,threadCompactDispatches:0,threadCompactIndirectDispatches:0,indirectFinalizeDispatches:0,threadGeometryBuilds:0,exactThreadArcSamples:0,
        stateReuses:0,stateBuilds:0,submissions:0,cpuCornerScansAvoided:0,cpuArcSearchesAvoided:0,cpuThreadBuildsAvoided:0,deviceResets:0}
};

const GPU_WEB_AREA_WGSL=`
@group(0) @binding(0) var<storage,read> segments:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> pathSegmentRanges:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read_write> orientation:array<f32>;
var<workgroup> partial:array<f32,256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid:vec3<u32>,@builtin(local_invocation_id) lid3:vec3<u32>){
    let p=wid.x;let lid=lid3.x;let r=pathSegmentRanges[p];let first=r.x;let n=r.y;var sum=0.0;
    var j=lid;loop{if(j>=n){break;}let g=segments[(first+j)*2u];sum+=g.x*g.w-g.z*g.y;j+=256u;}
    partial[lid]=sum;workgroupBarrier();var step=128u;loop{if(step==0u){break;}if(lid<step){partial[lid]+=partial[lid+step];}workgroupBarrier();step=step>>1u;}
    if(lid==0u){orientation[p]=select(-1.0,1.0,partial[0]>=0.0);}
}`;

const GPU_WEB_CLASSIFY_WGSL=`
struct U{
 threshold:f32,margin:f32,nowMs:f32,count:f32,copyCount:f32,spacing:f32,depthFrac:f32,depthMul:f32,
 jitter:f32,oscillating:f32,oscPhase:f32,oscStrength:f32,subdiv:f32,hasAuthoredCorners:f32,_b:f32,_c:f32
};
@group(0) @binding(0) var<storage,read> segments:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read> pathSegmentRanges:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> orientation:array<f32>;
@group(0) @binding(4) var<storage,read_write> flags:array<u32>;
@group(0) @binding(5) var<storage,read_write> cornerState:array<vec4<f32>>;
@group(0) @binding(6) var<uniform> u:U;

@group(0) @binding(7) var<storage,read> candidates:array<u32>;
@group(0) @binding(8) var<storage,read> retainedCubics:array<vec4<f32>>;
fn smooth01(x0:f32)->f32{let x=clamp(x0,0.0,1.0);return x*x*x*(x*(x*6.0-15.0)+10.0);}
fn safeVec(v:vec2<f32>,fallback:vec2<f32>)->vec2<f32>{return select(fallback,v,length(v)>0.000001);}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
    let slot=gid.x;let count=u32(u.count+0.5);if(slot>=count){return;}
    let packedCandidate=candidates[slot];let authored=(packedCandidate&0x80000000u)!=0u;let pathHasAuthored=(packedCandidate&0x40000000u)!=0u;let i=packedCandidate&0x3fffffffu;
    let metaData=segmentMeta[i];let cornerMode=u.depthFrac<0.0;let logicalBoundary=(metaData.w&0x20000000u)!=0u;

    let cornerCandidate=select(logicalBoundary,authored,pathHasAuthored);let candidate=select(logicalBoundary,cornerCandidate,cornerMode);
    let pi=metaData.z;let r=pathSegmentRanges[pi];let first=r.x;let n=max(1u,r.y);let local=i-first;let topology=r.w;let ordinaryClosed=topology==1u;let subdiv=max(1u,u32(u.subdiv+0.5));let logical=i/subdiv;let firstLogical=first/subdiv;let logicalCount=max(1u,n/subdiv);let localLogical=logical-firstLogical;

    var canMeasure=localLogical>0u||ordinaryClosed;var prevLogical=logical;
    if(localLogical>0u){prevLogical=logical-1u;}else if(ordinaryClosed){prevLogical=firstLogical+logicalCount-1u;}
    let cq0=retainedCubics[logical*2u];let pq1=retainedCubics[prevLogical*2u+1u];let p=cq0.xy;
    var vin=p-pq1.xy;var vout=cq0.zw-p;

    let prevG=segments[(select(i,prevLogical*subdiv+(subdiv-1u),canMeasure))*2u];let g=segments[i*2u];
    vin=safeVec(vin,p-prevG.xy);vout=safeVec(vout,g.zw-p);
    let il=length(vin);let ol=length(vout);var arcTarget=0.0;
    if(canMeasure&&candidate&&il>=0.0001&&ol>=0.0001){let dotv=clamp(dot(vin,vout)/(il*ol),-1.0,1.0);let turn=acos(dotv)*57.29577951308232;let cross=vin.x*vout.y-vin.y*vout.x;let sideOk=select(abs(cross)>0.0000001,cross*orientation[pi]>0.0000001,ordinaryClosed);
        if(turn>=u.threshold-u.margin&&sideOk){arcTarget=select(smooth01((turn-(u.threshold-u.margin))/(u.margin*1.5)),1.0,cornerMode);}}

    var inSpan=0.0;var outSpan=0.0;
    if(local+subdiv<=n){for(var sj=0u;sj<subdiv;sj=sj+1u){outSpan+=segments[(i+sj)*2u+1u].y;}}
    if(local>=subdiv){for(var sj=0u;sj<subdiv;sj=sj+1u){inSpan+=segments[(i-subdiv+sj)*2u+1u].y;}}
    else if(ordinaryClosed&&n>=subdiv){for(var sj=0u;sj<subdiv;sj=sj+1u){inSpan+=segments[(first+n-subdiv+sj)*2u+1u].y;}}
    var st=cornerState[i];st.z=min(inSpan,outSpan);if(st.y<=0.0){st.y=u.nowMs;}else{let rawDt=max(0.0,(u.nowMs-st.y)/1000.0);let dt=select(rawDt,0.0,rawDt>1.25);let k=1.0-exp(-dt*8.5);st.x=st.x+(arcTarget-st.x)*k;st.y=u.nowMs;}cornerState[i]=st;
    flags[slot]=select(0u,1u,st.x>0.001||arcTarget>0.001);
}`;

const GPU_WEB_CORNER_SCAN_WGSL=`
struct CountU{count:u32,blockCount:u32,_b:u32,_c:u32};
@group(0) @binding(0) var<storage,read> inputData:array<u32>;
@group(0) @binding(1) var<storage,read_write> outputData:array<u32>;
@group(0) @binding(2) var<storage,read_write> blockSums:array<u32>;
@group(0) @binding(3) var<uniform> info:CountU;
var<workgroup> temp:array<u32,256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid3:vec3<u32>,@builtin(workgroup_id) wid3:vec3<u32>){
    let lid=lid3.x;let gid=wid3.x*256u+lid;var v=0u;if(gid<info.count){v=inputData[gid];}temp[lid]=v;workgroupBarrier();
    var offset=1u;
    for(var d=128u;d>0u;d=d>>1u){
        workgroupBarrier();
        if(lid<d){let ai=offset*(2u*lid+1u)-1u;let bi=offset*(2u*lid+2u)-1u;temp[bi]=temp[bi]+temp[ai];}
        offset=offset<<1u;
    }
    workgroupBarrier();
    if(lid==0u){if(wid3.x<info.blockCount){blockSums[wid3.x]=temp[255u];}temp[255u]=0u;}
    for(var d=1u;d<256u;d=d<<1u){
        offset=offset>>1u;workgroupBarrier();
        if(lid<d){let ai=offset*(2u*lid+1u)-1u;let bi=offset*(2u*lid+2u)-1u;let q=temp[ai];temp[ai]=temp[bi];temp[bi]=temp[bi]+q;}
    }
    workgroupBarrier();if(gid<info.count){outputData[gid]=temp[lid];}
}`;
const GPU_WEB_CORNER_ADD_WGSL=`
struct CountU{count:u32,_a:u32,_b:u32,_c:u32};
@group(0) @binding(0) var<storage,read_write> childPrefix:array<u32>;
@group(0) @binding(1) var<storage,read> parentPrefix:array<u32>;
@group(0) @binding(2) var<uniform> info:CountU;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i>=info.count){return;}childPrefix[i]=childPrefix[i]+parentPrefix[i/256u];}
`;
const GPU_WEB_CORNER_SCATTER_WGSL=`
struct U{threshold:f32,margin:f32,nowMs:f32,count:f32,copyCount:f32,spacing:f32,depthFrac:f32,depthMul:f32};
@group(0) @binding(0) var<storage,read> flags:array<u32>;
@group(0) @binding(1) var<storage,read> prefix:array<u32>;
@group(0) @binding(2) var<storage,read_write> indices:array<u32>;
@group(0) @binding(3) var<uniform> u:U;
@group(0) @binding(4) var<storage,read> candidates:array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
    let i=gid.x;let count=u32(u.count+0.5);if(i>=count||flags[i]==0u){return;}let slot=prefix[i];if(slot<220u){indices[slot]=candidates[i]&0x3fffffffu;}
}`;
const GPU_WEB_CORNER_FINALIZE_WGSL=`
struct U{threshold:f32,margin:f32,nowMs:f32,count:f32,copyCount:f32,spacing:f32,depthFrac:f32,depthMul:f32};
@group(0) @binding(0) var<storage,read> flags:array<u32>;
@group(0) @binding(1) var<storage,read> prefix:array<u32>;
@group(0) @binding(2) var<storage,read_write> cornerIndices:array<u32>;
@group(0) @binding(3) var<uniform> u:U;
@group(0) @binding(4) var<storage,read_write> threadDispatch:array<u32>;
@compute @workgroup_size(1)
fn main(){
    let count=u32(u.count+0.5);var total=0u;if(count>0u){let last=count-1u;total=prefix[last]+flags[last];}
    let isActive=min(220u,total);cornerIndices[220u]=isActive;
    let slots=isActive*96u;threadDispatch[0]=max(1u,(slots+255u)/256u);threadDispatch[1]=1u;threadDispatch[2]=1u;
}
`;

const GPU_WEB_CORNER_SPAN_WGSL=`
struct U{
 threshold:f32,margin:f32,nowMs:f32,count:f32,copyCount:f32,spacing:f32,depthFrac:f32,depthMul:f32,
 jitter:f32,oscillating:f32,oscPhase:f32,oscStrength:f32,subdiv:f32,hasAuthoredCorners:f32,_b:f32,_c:f32
};
@group(0) @binding(0) var<storage,read> segments:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read> pathSegmentRanges:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> cornerIndices:array<u32>;
@group(0) @binding(4) var<storage,read_write> cornerState:array<vec4<f32>>;
@group(0) @binding(5) var<uniform> u:U;
fn anchorDistance(si:u32)->f32{let q=segments[si*2u+1u];return q.x-q.z;}
fn fallbackLogicalSpan(si:u32,pi:u32)->f32{
 let r=pathSegmentRanges[pi];let subdiv=max(1u,u32(u.subdiv+0.5));let local=si-r.x;let wrap=r.z!=0u||r.w==2u;var inSpan=0.0;var outSpan=0.0;
 if(local+subdiv<=r.y){for(var j=0u;j<subdiv;j=j+1u){outSpan+=segments[(si+j)*2u+1u].y;}}
 if(local>=subdiv){for(var j=0u;j<subdiv;j=j+1u){inSpan+=segments[(si-subdiv+j)*2u+1u].y;}}
 else if(wrap&&r.y>=subdiv){for(var j=0u;j<subdiv;j=j+1u){inSpan+=segments[(r.x+r.y-subdiv+j)*2u+1u].y;}}
 if(inSpan>0.000001&&outSpan>0.000001){return min(inSpan,outSpan);}return max(inSpan,outSpan);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let slot=gid.x;let cornerCount=min(220u,cornerIndices[220u]);if(slot>=cornerCount){return;}let si=cornerIndices[slot];let pi=segmentMeta[si].z;let r=pathSegmentRanges[pi];let q=segments[si*2u+1u];let total=max(0.000001,q.w);let anchor=anchorDistance(si);let wrap=r.z!=0u||r.w==2u;
 var before=1e30;var after=1e30;var minAnchor=1e30;var maxAnchor=-1e30;var peers=0u;
 for(var j=0u;j<cornerCount;j=j+1u){if(j==slot){continue;}let sj=cornerIndices[j];if(segmentMeta[sj].z!=pi){continue;}let d=anchorDistance(sj);minAnchor=min(minAnchor,d);maxAnchor=max(maxAnchor,d);peers=peers+1u;if(d<anchor-0.00001){before=min(before,anchor-d);}else if(d>anchor+0.00001){after=min(after,d-anchor);}}
 if(wrap&&peers>0u){if(before>1e20&&maxAnchor>-1e20){before=anchor+(total-maxAnchor);}if(after>1e20&&minAnchor<1e20){after=(total-anchor)+minAnchor;}}
 var span=min(before,after);if(span>1e20||span<=0.000001){span=fallbackLogicalSpan(si,pi);}span=min(total*0.499,max(0.0,span));var st=cornerState[si];st.z=span;cornerState[si]=st;
}
`;

const GPU_WEB_THREAD_COMPACT_WGSL=`

struct U{
 threshold:f32,margin:f32,nowMs:f32,count:f32,
 copyCount:f32,spacing:f32,depthFrac:f32,depthMul:f32,
 jitter:f32,oscillating:f32,oscPhase:f32,oscStrength:f32,
 subdiv:f32,_a:f32,_b:f32,_c:f32
};
@group(0) @binding(0) var<storage,read> segments:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read> pathSegmentRanges:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> cornerIndices:array<u32>;
@group(0) @binding(4) var<storage,read> cornerState:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read> retainedCubics:array<vec4<f32>>;
@group(0) @binding(6) var<storage,read_write> threadGeometry:array<vec4<f32>>;
@group(0) @binding(7) var<storage,read_write> threadCounter:array<atomic<u32>>;
@group(0) @binding(8) var<uniform> u:U;
fn smooth01(x0:f32)->f32{let x=clamp(x0,0.0,1.0);return x*x*x*(x*(x*6.0-15.0)+10.0);}
fn hashSigned(a:u32,b:u32,c:u32,d:u32)->f32{var x=(a+1u)*73856093u;x=x^((b+1u)*19349663u);x=x^((c+1u)*83492791u);x=x^((d+1u)*2654435761u);x=x^(x>>16u);x=x*2246822519u;x=x^(x>>13u);x=x*3266489917u;x=x^(x>>16u);return(f32(x)/4294967295.0)*2.0-1.0;}
fn cubicDerivativeArc(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let s=1.0-t;return 3.0*s*s*(c1-p0)+6.0*s*t*(c2-c1)+3.0*t*t*(p3-c2);}
fn arcCorrectMicroT(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,sub:u32,subdiv:u32,f0:f32)->f32{
 let f=clamp(f0,0.0,1.0);let sd=max(1u,subdiv);let t0=f32(sub)/f32(sd);let t1=f32(sub+1u)/f32(sd);if(f<=0.000001){return t0;}if(f>=0.999999){return t1;}
 let s0=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t0)));let s1=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t1)));let dv=s1-s0;let arcTarget=f*max(0.000001,s0+0.5*dv);let disc=max(0.000000000001,s0*s0+2.0*dv*arcTarget);let q=clamp((2.0*arcTarget)/max(0.000001,s0+sqrt(disc)),0.0,1.0);return mix(t0,t1,q);
}
fn retainedCubicPoint(globalMicro:u32,microT:f32)->vec2<f32>{let subdiv=max(1u,u32(u.subdiv+0.5));let logical=globalMicro/subdiv;let sub=globalMicro%subdiv;let q0=retainedCubics[logical*2u];let q1=retainedCubics[logical*2u+1u];let t=arcCorrectMicroT(q0.xy,q0.zw,q1.xy,q1.zw,sub,subdiv,microT);let a=mix(q0.xy,q0.zw,t);let b=mix(q0.zw,q1.xy,t);let c=mix(q1.xy,q1.zw,t);return mix(mix(a,b,t),mix(b,c,t),t);}
fn periodicMultiplier(pathIndex:u32)->vec2<f32>{let r=pathSegmentRanges[pathIndex];let subdiv=max(1u,u32(u.subdiv+0.5));let firstLogical=r.x/subdiv;let lastLogical=(r.x+max(1u,r.y)-1u)/subdiv;let fq0=retainedCubics[firstLogical*2u];let lq1=retainedCubics[lastLogical*2u+1u];var a=fq0.xy;var b=lq1.zw;if(dot(a,a)<0.0000000001){a=fq0.zw;b=2.0*lq1.zw-lq1.xy;}let den=max(0.0000000001,dot(a,a));return vec2<f32>(dot(b,a)/den,(b.y*a.x-b.x*a.y)/den);}
fn applyPeriodicTurn(p:vec2<f32>,m:vec2<f32>,turn:i32)->vec2<f32>{if(turn>0){return vec2<f32>(m.x*p.x-m.y*p.y,m.y*p.x+m.x*p.y);}if(turn<0){let den=max(0.0000000001,dot(m,m));return vec2<f32>((m.x*p.x+m.y*p.y)/den,(-m.y*p.x+m.x*p.y)/den);}return p;}
fn samplePath(pathIndex:u32,localD0:f32)->vec2<f32>{
 let r=pathSegmentRanges[pathIndex];let first=r.x;let n=max(1u,r.y);let topology=r.w;let q0=segments[first*2u+1u];let total=max(0.000001,q0.w);var d=localD0;var turn:i32=0;
 if(topology==0u){d=clamp(d,0.0,max(0.0,total-0.0000001));}else{let wrap=floor(d/total);turn=i32(wrap);d=d-wrap*total;if(d<0.0){d+=total;turn=turn-1;}}
 let arcTarget=q0.z+min(total-0.0000001,d);var lo=0u;var hi=n-1u;loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;let q=segments[(first+mid)*2u+1u];if(q.x+q.y<arcTarget){lo=mid+1u;}else{hi=mid;}}let q=segments[(first+lo)*2u+1u];let t=select(0.0,clamp((arcTarget-q.x)/q.y,0.0,1.0),q.y>0.0000001);var p=retainedCubicPoint(first+lo,t);if(topology==2u&&turn!=0){p=applyPeriodicTurn(p,periodicMultiplier(pathIndex),turn);}return p;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let slot=gid.x;if(slot>=21120u){return;}let cornerSlot=slot/96u;let activeCorners=cornerIndices[220u];

    if(cornerSlot>=activeCorners){return;}let ti=slot%96u;let si=cornerIndices[cornerSlot];let sm=segmentMeta[si];let pi=sm.z;let r=pathSegmentRanges[pi];let q=segments[si*2u+1u];let anchor=segments[si*2u].xy;let localAnchor=q.x-q.z;let total=max(0.000001,q.w);let frac=clamp(abs(u.depthFrac),0.0,1.0);let dm=max(0.0,u.depthMul);let cornerMode=u.depthFrac<0.0;let localSpan=max(0.0,cornerState[si].z);let ordinaryClosed=r.w==1u;let spanMax=min(total*0.499,localSpan*frac*dm);let closedSelfMax=min(total*0.499,total*0.25*frac*dm);var localMax=select(spanMax,closedSelfMax,!cornerMode&&ordinaryClosed);

 if(localMax<1.0){return;}let maxCount=max(1u,min(96u,u32(floor(localMax/max(0.0001,u.spacing)))));if(ti>=maxCount){return;}let growth=clamp(cornerState[si].x,0.0,1.0);let tg=smooth01(growth*f32(maxCount)-f32(ti));if(tg<=0.001){return;}
 let ordinal=si-r.x;let rnd=hashSigned(pi,ordinal,ti,137u);let asym=rnd*u.jitter;let base=min(localMax,u.spacing*f32(ti+1u));var da=max(0.25,min(localMax,base*(1.0+asym*0.55)))*tg;var db=max(0.25,min(localMax,base*(1.0-asym*0.55)))*tg;let wave=sin(u.oscPhase+hashSigned(pi,ordinal,ti,911u)*3.14159265);
 if(u.oscillating>0.5&&u.oscStrength>0.0){let slide=min(0.78,0.035+0.245*u.oscStrength)*wave;da=max(0.25,min(localMax,da*(1.0+slide)));db=max(0.25,min(localMax,db*(1.0-slide)));}
 let a=samplePath(pi,localAnchor-da);let b=samplePath(pi,localAnchor+db);var ctrl=anchor;if(u.oscillating>0.5&&u.oscStrength>0.0){let d=b-a;let dl=max(0.001,length(d));let n=vec2<f32>(-d.y/dl,d.x/dl);let amp=min(144.0,max(0.25,u.spacing*(0.25+1.75*u.oscStrength)));ctrl=anchor+n*amp*wave*tg;}
 let w=atomicAdd(&threadCounter[0],1u);if(w<21120u){threadGeometry[w*2u]=vec4<f32>(a,ctrl);threadGeometry[w*2u+1u]=vec4<f32>(b,1.0,0.0);}
}`;

const GPU_WEB_INDIRECT_WGSL=`
struct U{threshold:f32,margin:f32,nowMs:f32,count:f32,copyCount:f32,spacing:f32,depthFrac:f32,depthMul:f32};
@group(0) @binding(0) var<storage,read_write> threadCounter:array<atomic<u32>>;
@group(0) @binding(1) var<storage,read_write> indirect:array<u32>;
@group(0) @binding(2) var<uniform> u:U;
fn put(base:u32,instances:u32){indirect[base]=4u;indirect[base+1u]=instances;indirect[base+2u]=0u;indirect[base+3u]=0u;}
@compute @workgroup_size(1)
fn main(){let n=min(21120u,atomicLoad(&threadCounter[0]));let copies=max(1u,u32(u.copyCount+0.5));put(0u,n);put(4u,n*12u);put(8u,n*copies);put(12u,n*12u*copies);}
`;

function gpuWebCornerAcquireBuffer(size,usage,label){
    const r=globalThis.__somataGpuBufferRecycler;
    if(r?.acquire&&gpuWebCornerRuntime.device)return r.acquire(gpuWebCornerRuntime.device,gpuWebCornerRuntime.generation,size,usage,label);
    return gpuWebCornerRuntime.device.createBuffer({label,size:Math.max(16,size),usage});
}
function gpuWebCornerRecycleBuffer(buffer){
    if(!buffer)return false;const r=globalThis.__somataGpuBufferRecycler;
    if(r?.recycle&&gpuWebCornerRuntime.device)return r.recycle(gpuWebCornerRuntime.device,gpuWebCornerRuntime.generation,buffer);
    try{buffer.destroy?.();}catch(_){}return true;
}
function gpuWebCornerDestroy(rec){if(!rec)return;for(const b of rec.ownedBuffers||[])try{b?.destroy?.();}catch(_){}rec.ownedBuffers=[];rec.ready=false;}
function gpuWebCornerReset(device,generation){
    if(gpuWebCornerRuntime.device===device&&gpuWebCornerRuntime.generation===generation)return;
    for(const rec of gpuWebCornerRuntime.resourceSet)gpuWebCornerDestroy(rec);gpuWebCornerRuntime.resources=new WeakMap();gpuWebCornerRuntime.resourceSet.clear();
    for(const st of gpuWebCornerRuntime.layerStates.values())try{st.buffer?.destroy?.();}catch(_){}gpuWebCornerRuntime.layerStates.clear();
    gpuWebCornerRuntime.device=device;gpuWebCornerRuntime.generation=generation;gpuWebCornerRuntime.ready=false;gpuWebCornerRuntime.pipelines=null;gpuWebCornerRuntime.stats.deviceResets++;
}
async function ensureGpuWebCornerPipelines(){
    const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration():-1;if(gpuWebCornerRuntime.ready&&gpuWebCornerRuntime.device&&gpuWebCornerRuntime.generation===gen)return true;if(gpuWebCornerRuntime.initializing)return gpuWebCornerRuntime.initializing;
    const task=(async()=>{try{const shared=await WebGPUDeviceHub.acquire();gpuWebCornerReset(shared.device,shared.generation);const d=shared.device;
        const area=d.createShaderModule({label:'SpiroStar Web corner area WGSL',code:GPU_WEB_AREA_WGSL}),
            cls=d.createShaderModule({label:'SpiroStar Web corner classify WGSL',code:GPU_WEB_CLASSIFY_WGSL}),
            scan=d.createShaderModule({label:'SpiroStar Web corner scan WGSL',code:GPU_WEB_CORNER_SCAN_WGSL}),
            add=d.createShaderModule({label:'SpiroStar Web corner add WGSL',code:GPU_WEB_CORNER_ADD_WGSL}),
            scatter=d.createShaderModule({label:'SpiroStar Web corner scatter WGSL',code:GPU_WEB_CORNER_SCATTER_WGSL}),
            fin=d.createShaderModule({label:'SpiroStar Web corner finalize WGSL',code:GPU_WEB_CORNER_FINALIZE_WGSL}),
            span=d.createShaderModule({label:'SpiroStar Web 6.7 corner span WGSL',code:GPU_WEB_CORNER_SPAN_WGSL}),
            thr=d.createShaderModule({label:'SpiroStar Web active thread compact WGSL',code:GPU_WEB_THREAD_COMPACT_WGSL}),
            ind=d.createShaderModule({label:'SpiroStar Web indirect finalize WGSL',code:GPU_WEB_INDIRECT_WGSL});
        if(typeof assertWebGPUShaderModule==='function'){await assertWebGPUShaderModule(area,'SpiroStar Web corner area WGSL');await assertWebGPUShaderModule(cls,'SpiroStar Web corner classify WGSL');await assertWebGPUShaderModule(scan,'SpiroStar Web corner scan WGSL');await assertWebGPUShaderModule(add,'SpiroStar Web corner add WGSL');await assertWebGPUShaderModule(scatter,'SpiroStar Web corner scatter WGSL');await assertWebGPUShaderModule(fin,'SpiroStar Web corner finalize WGSL');await assertWebGPUShaderModule(span,'SpiroStar Web 6.7 corner span WGSL');await assertWebGPUShaderModule(thr,'SpiroStar Web active thread compact WGSL');await assertWebGPUShaderModule(ind,'SpiroStar Web indirect finalize WGSL');}
        gpuWebCornerRuntime.pipelines={
            area:d.createComputePipeline({label:'SpiroStar Web path orientation',layout:'auto',compute:{module:area,entryPoint:'main'}}),
            classify:d.createComputePipeline({label:'SpiroStar Web corner classify',layout:'auto',compute:{module:cls,entryPoint:'main'}}),
            cornerScan:d.createComputePipeline({label:'SpiroStar Web corner scan',layout:'auto',compute:{module:scan,entryPoint:'main'}}),
            cornerAdd:d.createComputePipeline({label:'SpiroStar Web corner add offsets',layout:'auto',compute:{module:add,entryPoint:'main'}}),
            cornerScatter:d.createComputePipeline({label:'SpiroStar Web corner scatter',layout:'auto',compute:{module:scatter,entryPoint:'main'}}),
            cornerFinalize:d.createComputePipeline({label:'SpiroStar Web corner finalize',layout:'auto',compute:{module:fin,entryPoint:'main'}}),
            cornerSpan:d.createComputePipeline({label:'SpiroStar Web 6.7 corner span',layout:'auto',compute:{module:span,entryPoint:'main'}}),
            threadCompact:d.createComputePipeline({label:'SpiroStar Web active thread compact',layout:'auto',compute:{module:thr,entryPoint:'main'}}),
            indirect:d.createComputePipeline({label:'SpiroStar Web indirect finalize',layout:'auto',compute:{module:ind,entryPoint:'main'}})
        };gpuWebCornerRuntime.ready=true;gpuWebCornerRuntime.lastError='';try{requestMainCanvasRender?.();}catch(_){}return true;
    }catch(err){gpuWebCornerRuntime.ready=false;gpuWebCornerRuntime.lastError=String(err?.message||err);return false;}})();gpuWebCornerRuntime.initializing=task;try{return await task;}finally{if(gpuWebCornerRuntime.initializing===task)gpuWebCornerRuntime.initializing=null;}
}
function warmupGpuWebCornerResource(){if(gpuWebCornerRuntime.ready)return true;if(!gpuWebCornerRuntime.initializing)void ensureGpuWebCornerPipelines();return false;}

function gpuWebCornerStateFor(morphRec,countOverride=null){
    const d=gpuWebCornerRuntime.device,key=Number(morphRec.layerIndex)||0,count=Math.max(1,Number(countOverride)||morphRec.segmentCount),sig=`${String(morphRec.topologySignature||morphRec.segmentCount)}|bez:${count}|state6`;let st=gpuWebCornerRuntime.layerStates.get(key);
    if(st&&st.generation===gpuWebCornerRuntime.generation&&st.signature===sig&&st.count===count&&st.buffer){gpuWebCornerRuntime.stats.stateReuses++;return st;}
    if(st?.buffer)gpuWebCornerRecycleBuffer(st.buffer);const buffer=gpuWebCornerAcquireBuffer(Math.max(16,count*16),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,`SpiroStar Web corner growth L${key}`);
    st={buffer,signature:sig,count,generation:gpuWebCornerRuntime.generation};gpuWebCornerRuntime.layerStates.set(key,st);gpuWebCornerRuntime.stats.stateBuilds++;return st;
}
function gpuWebCountUniform(device,label,count,blocks=0,owned=null){
    const b=device.createBuffer({label,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(b,0,new Uint32Array([Math.max(0,count)>>>0,Math.max(0,blocks)>>>0,0,0]));if(owned)owned.push(b);return b;
}
function buildGpuWebCornerResource(arcRec){
    if(!arcRec?.ready||!arcRec.morphRec?.ready||!gpuWebCornerRuntime.ready)return null;let hit=gpuWebCornerRuntime.resources.get(arcRec);if(hit?.ready&&hit.generation===gpuWebCornerRuntime.generation){gpuWebCornerRuntime.stats.hits++;return hit;}
    const d=gpuWebCornerRuntime.device,p=gpuWebCornerRuntime.pipelines,m=arcRec.morphRec,segmentCount=arcRec.segmentCount,owned=[];const make=(label,bytes,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST)=>{const b=d.createBuffer({label,size:Math.max(16,Math.ceil(bytes/16)*16),usage});owned.push(b);return b;};

    const logicalCount=Math.max(1,Number(arcRec.logicalSegmentCount)||segmentCount),subdiv=Math.max(1,Number(arcRec.subdiv)||1),logicalMeta=m.cpuSegmentMeta||new Uint32Array(logicalCount*4),candidateList=[];

    const authoredLogical=new Set(),pathHasAuthored=new Set(),pathRanges=m.cpuPathSegmentRanges||new Uint32Array((m.pathCount||0)*4),cornerFractions=m.cpuPathCornerFractions||[],knotFractions=m.cpuPathKnotFractions||[];
    for(let pi=0;pi<(m.pathCount||0);pi++){
        const po=pi*4,firstLogical=pathRanges[po]>>>0,n=pathRanges[po+1]>>>0,common=Array.from(knotFractions[pi]?.common||[]),auth=[...(cornerFractions[pi]?.source||[]),...(cornerFractions[pi]?.target||[])];
        if(!auth.length||common.length<2)continue;let mappedAny=false;
        for(const fv0 of auth){const fv=Math.max(0,Math.min(1,Number(fv0)||0));let best=-1,bestErr=1e9;for(let j=1;j<Math.min(n,common.length-1);j++){const err=Math.abs((Number(common[j])||0)-fv);if(err<bestErr){bestErr=err;best=j;}}if(best>0&&best<n&&bestErr<2e-5){authoredLogical.add(firstLogical+best);mappedAny=true;}}
        if(mappedAny)pathHasAuthored.add(pi);
    }
    let hasAuthoredCornerMarkers=authoredLogical.size>0;
    for(let li=0;li<logicalCount;li++){const pi=logicalMeta[li*4+2]>>>0,first=li*subdiv,authored=authoredLogical.has(li),has=pathHasAuthored.has(pi);candidateList.push((first&0x3fffffff)|(has?0x40000000:0)|(authored?0x80000000:0));}
    const candidateData=new Uint32Array(candidateList),candidateCount=Math.max(1,candidateData.length),candidateIndexBuffer=make(`SpiroStar Web corner candidates L${m.layerIndex}`,candidateCount*4);d.queue.writeBuffer(candidateIndexBuffer,0,candidateData);
    const orientationBuffer=make(`SpiroStar Web orientation L${m.layerIndex}`,m.pathCount*4),flagsBuffer=make(`SpiroStar Web corner flags L${m.layerIndex}`,candidateCount*4),cornerIndexBuffer=make(`SpiroStar Web corner indices L${m.layerIndex}`,(GPU_WEB_MAX_CORNERS+1)*4),threadGeometryBuffer=make(`Somata 7.4.30 Web master thread geometry L${m.layerIndex}`,GPU_WEB_MAX_THREAD_SLOTS*32),threadCountBuffer=make(`SpiroStar Web thread counter L${m.layerIndex}`,16),threadDispatchBuffer=make(`SpiroStar Web thread compact dispatch L${m.layerIndex}`,16,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST),indirectBuffer=make(`SpiroStar Web indirect args L${m.layerIndex}`,64,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST),uniformBuffer=make(`SpiroStar Web corner uniforms L${m.layerIndex}`,64,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),state=gpuWebCornerStateFor(m,segmentCount);
    const areaBind=d.createBindGroup({layout:p.area.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:arcRec.segmentBuffer}},{binding:1,resource:{buffer:arcRec.pathSegmentRangeBuffer}},{binding:2,resource:{buffer:orientationBuffer}}]});
    const classifyBind=d.createBindGroup({layout:p.classify.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:arcRec.segmentBuffer}},{binding:1,resource:{buffer:arcRec.segmentMetaBuffer}},{binding:2,resource:{buffer:arcRec.pathSegmentRangeBuffer}},{binding:3,resource:{buffer:orientationBuffer}},{binding:4,resource:{buffer:flagsBuffer}},{binding:5,resource:{buffer:state.buffer}},{binding:6,resource:{buffer:uniformBuffer}},{binding:7,resource:{buffer:candidateIndexBuffer}},{binding:8,resource:{buffer:m.cubicBuffer}}]});
    const scanLevels=[];let scanCount=candidateCount,input=flagsBuffer,levelIndex=0;
    while(true){
        const blocks=Math.max(1,Math.ceil(scanCount/GPU_WEB_CORNER_WG)),output=make(`SpiroStar Web corner prefix L${m.layerIndex}.${levelIndex}`,scanCount*4),blockSums=make(`SpiroStar Web corner sums L${m.layerIndex}.${levelIndex}`,blocks*4),info=gpuWebCountUniform(d,`SpiroStar Web corner scan info ${levelIndex}`,scanCount,blocks,owned);
        const bind=d.createBindGroup({layout:p.cornerScan.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}},{binding:2,resource:{buffer:blockSums}},{binding:3,resource:{buffer:info}}]});
        scanLevels.push({count:scanCount,blocks,input,output,blockSums,info,bind,addInfo:null,addBind:null});if(blocks<=1)break;input=blockSums;scanCount=blocks;levelIndex++;
    }
    for(let i=scanLevels.length-2;i>=0;i--){const child=scanLevels[i],parent=scanLevels[i+1],info=gpuWebCountUniform(d,`SpiroStar Web corner add info ${i}`,child.count,0,owned);child.addInfo=info;child.addBind=d.createBindGroup({layout:p.cornerAdd.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:child.output}},{binding:1,resource:{buffer:parent.output}},{binding:2,resource:{buffer:info}}]});}
    const cornerScatterBind=d.createBindGroup({layout:p.cornerScatter.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:flagsBuffer}},{binding:1,resource:{buffer:scanLevels[0].output}},{binding:2,resource:{buffer:cornerIndexBuffer}},{binding:3,resource:{buffer:uniformBuffer}},{binding:4,resource:{buffer:candidateIndexBuffer}}]});
    const cornerFinalizeBind=d.createBindGroup({layout:p.cornerFinalize.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:flagsBuffer}},{binding:1,resource:{buffer:scanLevels[0].output}},{binding:2,resource:{buffer:cornerIndexBuffer}},{binding:3,resource:{buffer:uniformBuffer}},{binding:4,resource:{buffer:threadDispatchBuffer}}]});
    const cornerSpanBind=d.createBindGroup({layout:p.cornerSpan.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:arcRec.segmentBuffer}},{binding:1,resource:{buffer:arcRec.segmentMetaBuffer}},{binding:2,resource:{buffer:arcRec.pathSegmentRangeBuffer}},{binding:3,resource:{buffer:cornerIndexBuffer}},{binding:4,resource:{buffer:state.buffer}},{binding:5,resource:{buffer:uniformBuffer}}]});
    const threadCompactBind=d.createBindGroup({layout:p.threadCompact.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:arcRec.segmentBuffer}},{binding:1,resource:{buffer:arcRec.segmentMetaBuffer}},{binding:2,resource:{buffer:arcRec.pathSegmentRangeBuffer}},{binding:3,resource:{buffer:cornerIndexBuffer}},{binding:4,resource:{buffer:state.buffer}},{binding:5,resource:{buffer:arcRec.morphRec.cubicBuffer}},{binding:6,resource:{buffer:threadGeometryBuffer}},{binding:7,resource:{buffer:threadCountBuffer}},{binding:8,resource:{buffer:uniformBuffer}}]});
    const indirectBind=d.createBindGroup({layout:p.indirect.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:threadCountBuffer}},{binding:1,resource:{buffer:indirectBuffer}},{binding:2,resource:{buffer:uniformBuffer}}]});
    const rec={arcRec,morphRec:m,segmentCount,candidateCount,hasAuthoredCornerMarkers,generation:gpuWebCornerRuntime.generation,orientationBuffer,flagsBuffer,candidateIndexBuffer,cornerIndexBuffer,threadGeometryBuffer,threadCountBuffer,threadDispatchBuffer,indirectBuffer,uniformBuffer,stateBuffer:state.buffer,areaBind,classifyBind,scanLevels,cornerScatterBind,cornerFinalizeBind,cornerSpanBind,threadCompactBind,indirectBind,ownedBuffers:owned,uniformData:new Float32Array(16),ready:true,lastFrame:-1,lastT:NaN};gpuWebCornerRuntime.resources.set(arcRec,rec);gpuWebCornerRuntime.resourceSet.add(rec);gpuWebCornerRuntime.stats.builds++;return rec;
}
function getGpuWebCornerResourceForFrame(frameCtx){
    gpuWebCornerRuntime.stats.requests++;if(!frameCtx||typeof getGpuMorphArcTableForFrame!=='function')return null;const table=getGpuMorphArcTableForFrame(frameCtx);if(!table?.gpuArcResident||!warmupGpuWebCornerResource())return null;const arcRec=table._gpuMorphArcResource,resource=buildGpuWebCornerResource(arcRec);return resource?{table,resource}:null;
}
function encodeGpuWebCornerResource(rec,table,encoder,threshold=60,nowMs=0,spacing=10,depthPercent=20,depthMultiplier=1,copyCount=1,frameCtx=null,cornerMode=false,jitterStrength=0,oscillating=false,oscillationPhase=0,oscillationStrength=0){
    if(!rec?.ready||!table||!encoder)return false;const arcReady=typeof spiroGpuPrepareArcForLayerScene==='function'?spiroGpuPrepareArcForLayerScene(frameCtx,table,encoder):(typeof encodeGpuMorphArcTable==='function'&&encodeGpuMorphArcTable(table,encoder));if(!arcReady)return false;
    const u=rec.uniformData;u.fill(0);u[0]=Math.max(1,Math.min(179,Number(threshold)||60));u[1]=8;u[2]=Math.max(0,Number(nowMs)||0);u[3]=rec.candidateCount;u[4]=Math.max(1,Number(copyCount)||1);u[5]=Math.max(.1,Number(spacing)||10);{const frac=Math.max(0,Math.min(1,(Number(depthPercent)||0)/100));u[6]=cornerMode===true?-(frac+1e-7):frac;}u[7]=Math.max(0,Number(depthMultiplier)||0);u[8]=Math.max(0,Number(jitterStrength)||0);u[9]=oscillating===true?1:0;u[10]=Number(oscillationPhase)||0;u[11]=Math.min(8,Math.max(0,Number(oscillationStrength)||0));u[12]=Math.max(1,Number(rec.arcRec?.subdiv)||1);u[13]=rec.hasAuthoredCornerMarkers===true?1:0;gpuWebCornerRuntime.device.queue.writeBuffer(rec.uniformBuffer,0,u.buffer,0,64);gpuWebCornerRuntime.device.queue.writeBuffer(rec.threadCountBuffer,0,gpuWebCornerZeroCounter.buffer,0,4);
    let pass=encoder.beginComputePass({label:`SpiroStar Web orientation L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.area);pass.setBindGroup(0,rec.areaBind);pass.dispatchWorkgroups(rec.morphRec.pathCount);pass.end();gpuWebCornerRuntime.stats.areaDispatches++;
    pass=encoder.beginComputePass({label:`SpiroStar Web corner classify L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.classify);pass.setBindGroup(0,rec.classifyBind);pass.dispatchWorkgroups(Math.ceil(rec.candidateCount/GPU_WEB_CORNER_WG));pass.end();gpuWebCornerRuntime.stats.classifyDispatches++;
    for(const level of rec.scanLevels){pass=encoder.beginComputePass({label:`SpiroStar Web corner prefix L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.cornerScan);pass.setBindGroup(0,level.bind);pass.dispatchWorkgroups(level.blocks);pass.end();gpuWebCornerRuntime.stats.cornerScanDispatches++;gpuWebCornerRuntime.stats.cornerCompactDispatches++;}
    for(let i=rec.scanLevels.length-2;i>=0;i--){const level=rec.scanLevels[i];pass=encoder.beginComputePass({label:`SpiroStar Web corner prefix offsets L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.cornerAdd);pass.setBindGroup(0,level.addBind);pass.dispatchWorkgroups(Math.ceil(level.count/GPU_WEB_CORNER_WG));pass.end();gpuWebCornerRuntime.stats.cornerScanOffsetDispatches++;gpuWebCornerRuntime.stats.cornerCompactDispatches++;}
    pass=encoder.beginComputePass({label:`SpiroStar Web corner scatter L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.cornerScatter);pass.setBindGroup(0,rec.cornerScatterBind);pass.dispatchWorkgroups(Math.ceil(rec.candidateCount/GPU_WEB_CORNER_WG));pass.end();gpuWebCornerRuntime.stats.cornerScatterDispatches++;gpuWebCornerRuntime.stats.cornerCompactDispatches++;
    pass=encoder.beginComputePass({label:`SpiroStar Web corner finalize L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.cornerFinalize);pass.setBindGroup(0,rec.cornerFinalizeBind);pass.dispatchWorkgroups(1);pass.end();gpuWebCornerRuntime.stats.cornerFinalizeDispatches++;gpuWebCornerRuntime.stats.cornerCompactDispatches++;
    pass=encoder.beginComputePass({label:`Somata 7.4.30 Web 6.7 corner span L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.cornerSpan);pass.setBindGroup(0,rec.cornerSpanBind);pass.dispatchWorkgroups(Math.ceil(GPU_WEB_MAX_CORNERS/64));pass.end();gpuWebCornerRuntime.stats.cornerSpanDispatches++;
    pass=encoder.beginComputePass({label:`Somata 7.4.30 Web master thread geometry L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.threadCompact);pass.setBindGroup(0,rec.threadCompactBind);if(typeof pass.dispatchWorkgroupsIndirect!=='function'){pass.end();return false;}pass.dispatchWorkgroupsIndirect(rec.threadDispatchBuffer,0);pass.end();gpuWebCornerRuntime.stats.threadCompactIndirectDispatches++;gpuWebCornerRuntime.stats.threadCompactDispatches++;gpuWebCornerRuntime.stats.threadGeometryBuilds++;
    pass=encoder.beginComputePass({label:`SpiroStar Web indirect finalize L${rec.morphRec.layerIndex}`});pass.setPipeline(gpuWebCornerRuntime.pipelines.indirect);pass.setBindGroup(0,rec.indirectBind);pass.dispatchWorkgroups(1);pass.end();gpuWebCornerRuntime.stats.indirectFinalizeDispatches++;
    rec.lastFrame=Math.max(0,Number(table.frameId)||0);rec.lastT=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));gpuWebCornerRuntime.stats.encodes++;gpuWebCornerRuntime.stats.cpuCornerScansAvoided+=rec.segmentCount;gpuWebCornerRuntime.stats.cpuArcSearchesAvoided+=GPU_WEB_MAX_CORNERS;gpuWebCornerRuntime.stats.cpuThreadBuildsAvoided+=GPU_WEB_MAX_THREAD_SLOTS;gpuWebCornerRuntime.stats.exactThreadArcSamples+=2*GPU_WEB_MAX_THREAD_SLOTS;return true;
}
function noteGpuWebCornerSubmitted(rec,table){if(!rec?.ready||!table)return false;try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}gpuWebCornerRuntime.stats.submissions++;return true;}
window.__spiroGpuWebCornerStatus=()=>({ready:gpuWebCornerRuntime.ready,generation:gpuWebCornerRuntime.generation,lastError:gpuWebCornerRuntime.lastError,maxCorners:GPU_WEB_MAX_CORNERS,maxThreadsPerCorner:GPU_WEB_MAX_THREADS_PER_CORNER,maxThreadSlots:GPU_WEB_MAX_THREAD_SLOTS,stats:{...gpuWebCornerRuntime.stats},contract:'Somata 7.4.30 canonical Web resource: retained-cubic exact Arc remains the truth, while active-thread compaction samples that truth exactly twice per visible thread and stores one resident master {A,Control,B} record. Raster/Corridor copies reuse that record; no per-vertex Arc search.'});
