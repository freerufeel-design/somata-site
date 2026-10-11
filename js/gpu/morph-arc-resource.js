// SpiroStar v512 — GPU Morph Segment / Arc Resource
// Exact dynamic segment lengths + cumulative arc coordinates are computed on GPU from
// retained GPU Bézier Morph rail. Sprite/Moving Line can therefore consume topology Morph
// without materializing CPU {x,y} paths or walking O(N) segments on the main thread.
window.__spiroRegisterModule?.('js/gpu/morph-arc-resource');

const GPU_MORPH_ARC_WORKGROUP=256;
const gpuMorphArcRuntime={
    device:null,generation:-1,initializing:null,ready:false,lastError:'not-initialized',
    pipelines:null,resources:new WeakMap(),resourceSet:new Set(),
    stats:{tableRequests:0,frameCacheHits:0,eligibleRequests:0,resourceBuilds:0,resourceHits:0,resourceMisses:0,warmupFallbacks:0,framesEncoded:0,frameDataReuses:0,morphEncodes:0,segmentBuildDispatches:0,scanDispatches:0,scanOffsetDispatches:0,pathMetricDispatches:0,finalizeDispatches:0,cpuPathBuildsAvoided:0,cpuSegmentWalksAvoided:0,deviceResets:0,unsupportedFrames:0,committedSubmissions:0,committedReuseHits:0,encodedButUncommitted:0,orderedCurrentCubicReuses:0},lastDecision:{eligible:false,reason:'not-requested'}
};

// Somata 6.8: static non-Fourier Spiral effects use the same GPU Bézier→Arc carrier
// as Spiral Morph. The compact cubic buffer is rebuilt only when the layer geometry
// revision changes; no per-frame CPU point sampling is involved.
let staticSpiralBezierResources=new WeakMap();
const staticSpiralBezierResourceSet=new Set();

const GPU_MORPH_ARC_BUILD_WGSL=`
struct CountU { count:u32, subdiv:u32, _b:u32, _c:u32, };
@group(0) @binding(0) var<storage,read> cubics:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read_write> lengths:array<f32>;
@group(0) @binding(2) var<storage,read_write> segments:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> info:CountU;
fn cubicPoint(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;
}
fn cubicDerivative(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let q=1.0-t;return 3.0*q*q*(c1-p0)+6.0*q*t*(c2-c1)+3.0*t*t*(p3-c2);
}
fn cubicArcLength3(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,a:f32,b:f32)->f32{
    // 3-point Gauss-Legendre. Same micro-segment count, substantially better distance metric
    // than chord length on tight Spiral turns, so lamps/particles/web keep true arc placement
    // without increasing the retained rail density.
    let m=(a+b)*0.5;let h=(b-a)*0.5;let x=0.7745966692414834;
    let v0=length(cubicDerivative(p0,c1,c2,p3,m));
    let v1=length(cubicDerivative(p0,c1,c2,p3,m-h*x));
    let v2=length(cubicDerivative(p0,c1,c2,p3,m+h*x));
    return max(1e-7,h*((8.0/9.0)*v0+(5.0/9.0)*(v1+v2)));
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
    let i=gid.x;if(i>=info.count){return;}
    let subdiv=max(1u,info.subdiv);let logical=i/subdiv;let sub=i%subdiv;
    let r0=cubics[logical*2u];let r1=cubics[logical*2u+1u];
    let t0=f32(sub)/f32(subdiv);let t1=f32(sub+1u)/f32(subdiv);
    let a=cubicPoint(r0.xy,r0.zw,r1.xy,r1.zw,t0);let b=cubicPoint(r0.xy,r0.zw,r1.xy,r1.zw,t1);let len=cubicArcLength3(r0.xy,r0.zw,r1.xy,r1.zw,t0,t1);
    lengths[i]=len;segments[i*2u]=vec4<f32>(a,b);segments[i*2u+1u]=vec4<f32>(0.0,len,0.0,0.0);
}`;

const GPU_MORPH_ARC_SCAN_WGSL=`
struct CountU { count:u32, blockCount:u32, _b:u32, _c:u32, };
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
        if(lid<d){let ai=offset*(2u*lid+1u)-1u;let bi=offset*(2u*lid+2u)-1u;let t=temp[ai];temp[ai]=temp[bi];temp[bi]=temp[bi]+t;}
    }
    workgroupBarrier();if(gid<info.count){outputData[gid]=temp[lid];}
}`;

const GPU_MORPH_ARC_ADD_WGSL=`
struct CountU { count:u32, _a:u32, _b:u32, _c:u32, };
@group(0) @binding(0) var<storage,read_write> childPrefix:array<f32>;
@group(0) @binding(1) var<storage,read> parentPrefix:array<f32>;
@group(0) @binding(2) var<uniform> info:CountU;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x;if(i>=info.count){return;}childPrefix[i]=childPrefix[i]+parentPrefix[i/256u];}`;

const GPU_MORPH_ARC_PATH_WGSL=`
struct CountU { count:u32, _a:u32, _b:u32, _c:u32, };
@group(0) @binding(0) var<storage,read> segments:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> prefix:array<f32>;
@group(0) @binding(2) var<storage,read> pathRanges:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read_write> pathMetrics:array<vec4<f32>>;
@group(0) @binding(4) var<uniform> info:CountU;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
    let p=gid.x;if(p>=info.count){return;}let r=pathRanges[p];let first=r.x;let n=r.y;
    if(n==0u){pathMetrics[p]=vec4<f32>(0.0);return;}
    let last=first+n-1u;let start=prefix[first];let total=(prefix[last]+segments[last*2u+1u].y)-start;
    pathMetrics[p]=vec4<f32>(start,total,0.0,0.0);
}`;

const GPU_MORPH_ARC_FINALIZE_WGSL=`
struct CountU { count:u32, _a:u32, _b:u32, _c:u32, };
@group(0) @binding(0) var<storage,read_write> segments:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> prefix:array<f32>;
@group(0) @binding(2) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read> pathMetrics:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read_write> metaData:array<vec4<f32>>;
@group(0) @binding(5) var<uniform> info:CountU;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
    let i=gid.x;if(i>=info.count){return;}let m=segmentMeta[i];let pm=pathMetrics[m.z];let o=i*2u+1u;var q=segments[o];
    q.x=prefix[i];q.z=pm.x;q.w=pm.y;segments[o]=q;
    if(i+1u==info.count){metaData[0]=vec4<f32>(prefix[i]+q.y,f32(info.count),0.0,0.0);}
}`;

function gpuMorphArcDestroy(rec){
    if(!rec)return;for(const b of rec.ownedBuffers||[])try{b?.destroy?.();}catch(_){}rec.ownedBuffers=[];rec.ready=false;
}
function invalidateGpuMorphArcResources(reason='morph-phase'){
    for(const rec of gpuMorphArcRuntime.resourceSet)gpuMorphArcDestroy(rec);
    gpuMorphArcRuntime.resourceSet.clear();gpuMorphArcRuntime.resources=new WeakMap();gpuMorphArcRuntime.lastError=String(reason||'morph-phase');
}
function destroyStaticSpiralBezierResource(rec){if(!rec)return;for(const b of [rec.cubicBuffer,rec.segmentMetaBuffer,rec.pathRangeBuffer,rec.pathSegmentRangeBuffer])try{b?.destroy?.();}catch(_){}rec.ready=false;staticSpiralBezierResourceSet.delete(rec);}
function invalidateStaticSpiralBezierResources(){for(const rec of staticSpiralBezierResourceSet)destroyStaticSpiralBezierResource(rec);staticSpiralBezierResourceSet.clear();staticSpiralBezierResources=new WeakMap();}
function gpuMorphArcResetDevice(device,generation){
    invalidateGpuMorphArcResources('device-reset');invalidateStaticSpiralBezierResources();gpuMorphArcRuntime.device=device;gpuMorphArcRuntime.generation=generation;gpuMorphArcRuntime.ready=false;gpuMorphArcRuntime.pipelines=null;gpuMorphArcRuntime.stats.deviceResets++;
}
function gpuMorphArcBuffer(device,label,bytes,usage){return device.createBuffer({label,size:Math.max(16,Math.ceil(Math.max(4,bytes)/16)*16),usage});}
function gpuMorphArcWriteCount(device,label,count,blockCount=0){
    const b=gpuMorphArcBuffer(device,label,16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),u=new Uint32Array([Math.max(0,count)>>>0,Math.max(0,blockCount)>>>0,0,0]);device.queue.writeBuffer(b,0,u);return b;
}
function gpuMorphArcWriteBuildInfo(device,label,count,subdiv){
    const b=gpuMorphArcBuffer(device,label,16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),u=new Uint32Array([Math.max(0,count)>>>0,Math.max(1,subdiv)>>>0,0,0]);device.queue.writeBuffer(b,0,u);return b;
}
async function ensureGpuMorphArcPipelines(){
    const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration():-1;
    if(gpuMorphArcRuntime.ready&&gpuMorphArcRuntime.device&&gpuMorphArcRuntime.generation===gen)return true;
    if(gpuMorphArcRuntime.initializing)return gpuMorphArcRuntime.initializing;
    const task=(async()=>{try{
        if(typeof WebGPUDeviceHub==='undefined')throw new Error('WebGPUDeviceHub unavailable');const shared=await WebGPUDeviceHub.acquire(),device=shared.device,generation=shared.generation;
        if(gpuMorphArcRuntime.device!==device||gpuMorphArcRuntime.generation!==generation)gpuMorphArcResetDevice(device,generation);
        const compile=async(label,code)=>{const mod=device.createShaderModule({label,code});if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(mod,label);return device.createComputePipeline({label,layout:'auto',compute:{module:mod,entryPoint:'main'}});};
        gpuMorphArcRuntime.pipelines={
            build:await compile('SpiroStar Morph Arc build',GPU_MORPH_ARC_BUILD_WGSL),
            scan:await compile('SpiroStar Morph Arc scan',GPU_MORPH_ARC_SCAN_WGSL),
            add:await compile('SpiroStar Morph Arc add offsets',GPU_MORPH_ARC_ADD_WGSL),
            path:await compile('SpiroStar Morph Arc path metrics',GPU_MORPH_ARC_PATH_WGSL),
            finalize:await compile('SpiroStar Morph Arc finalize',GPU_MORPH_ARC_FINALIZE_WGSL)
        };gpuMorphArcRuntime.ready=true;gpuMorphArcRuntime.lastError='';
        // Iter30 — strict Spiral effects/profile may deliberately render nothing while Arc
        // pipelines compile. Publish readiness by scheduling a fresh frame instead of waiting
        // for the next random sidebar/animation event.
        try{requestMainCanvasRender?.();}catch(_){}
        return true;
    }catch(err){gpuMorphArcRuntime.ready=false;gpuMorphArcRuntime.lastError=String(err?.message||err);return false;}})();
    gpuMorphArcRuntime.initializing=task;try{return await task;}finally{if(gpuMorphArcRuntime.initializing===task)gpuMorphArcRuntime.initializing=null;}
}
function warmupGpuMorphArcResource(){if(gpuMorphArcRuntime.ready)return true;if(!gpuMorphArcRuntime.initializing)void ensureGpuMorphArcPipelines();return false;}

function buildGpuMorphArcResource(morphRec){
    if(!morphRec?.ready||!morphRec.segmentCount||!morphRec.cubicBuffer||!gpuMorphArcRuntime.ready)return null;
    let hit=gpuMorphArcRuntime.resources.get(morphRec);if(hit?.ready&&hit.generation===gpuMorphArcRuntime.generation){gpuMorphArcRuntime.stats.resourceHits++;return hit;}
    const device=gpuMorphArcRuntime.device,p=gpuMorphArcRuntime.pipelines,logicalSegmentCount=morphRec.segmentCount,subdiv=Math.max(1,Number(morphRec.arcSubdiv)||Number(morphRec.bezierSubdiv)||Number(window.GPU_TOPOLOGY_BEZIER_SUBDIV)||8),n=logicalSegmentCount*subdiv,pathCount=morphRec.pathCount,owned=[];
    const own=(label,bytes,usage)=>{const b=gpuMorphArcBuffer(device,label,bytes,usage);owned.push(b);return b;};
    // Effects that need distance work on a compact fixed micro-rail derived from the same
    // retained cubics as the visible topology stroke. No CPU curve sampling happens per frame.
    const logicalMeta=morphRec.cpuSegmentMeta||new Uint32Array(logicalSegmentCount*4),logicalPathRanges=morphRec.cpuPathSegmentRanges||new Uint32Array(pathCount*4);
    const expandedMeta=new Uint32Array(n*4),expandedPathIndex=new Uint32Array(n),expandedPathRanges=new Uint32Array(pathCount*4);
    for(let li=0;li<logicalSegmentCount;li++){
        const mo=li*4,pi=logicalMeta[mo+2]>>>0,packed=logicalMeta[mo+3]>>>0;
        for(let sj=0;sj<subdiv;sj++){
            const mi=li*subdiv+sj,o=mi*4;
            let flags=pi&0x00ffffff;
            // 6.9 rev3: Web must classify construction corners at retained-cubic boundaries,
            // not at every tiny Bézier microsegment (whose local turn is intentionally small).
            if(sj===0)flags|=0x20000000;
            if(sj===0&&(packed&0x40000000)!==0)flags|=0x40000000;
            if(sj===subdiv-1&&(packed&0x80000000)!==0)flags|=0x80000000;
            flags>>>=0;expandedMeta[o]=mi;expandedMeta[o+1]=mi+1;expandedMeta[o+2]=pi;expandedMeta[o+3]=flags;expandedPathIndex[mi]=flags;
        }
    }
    const logicalPathDefs=morphRec.cpuPathRanges||null;
    for(let pi=0;pi<pathCount;pi++){const o=pi*4;expandedPathRanges[o]=(logicalPathRanges[o]>>>0)*subdiv;expandedPathRanges[o+1]=(logicalPathRanges[o+1]>>>0)*subdiv;
        // Arc consumers need only first/count in xy. z is reserved here as the exact closed flag
        // so open Spiral rails never wrap their first corner to the last segment.
        expandedPathRanges[o+2]=logicalPathDefs?((logicalPathDefs[o+2]>>>0)?1:0):(morphRec.allClosed===true?1:0);expandedPathRanges[o+3]=0;}
    const segmentMetaBuffer=own(`SpiroStar Morph Arc bezier segment metadata L${morphRec.layerIndex}`,expandedMeta.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const pathIndexBuffer=own(`SpiroStar Morph Arc bezier path indices L${morphRec.layerIndex}`,expandedPathIndex.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const pathSegmentRangeBuffer=own(`SpiroStar Morph Arc bezier path ranges L${morphRec.layerIndex}`,expandedPathRanges.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(segmentMetaBuffer,0,expandedMeta);device.queue.writeBuffer(pathIndexBuffer,0,expandedPathIndex);device.queue.writeBuffer(pathSegmentRangeBuffer,0,expandedPathRanges);
    const lengthsBuffer=own(`SpiroStar Morph Arc lengths L${morphRec.layerIndex}`,n*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const segmentBuffer=own(`SpiroStar Morph Arc canonical bezier microsegments L${morphRec.layerIndex}`,n*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const pathMetricsBuffer=own(`SpiroStar Morph Arc path metrics L${morphRec.layerIndex}`,Math.max(1,pathCount)*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const metaBuffer=own(`SpiroStar Morph Arc frame metadata L${morphRec.layerIndex}`,16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const buildUniform=gpuMorphArcWriteBuildInfo(device,'SpiroStar Morph Arc build count',n,subdiv);owned.push(buildUniform);
    const buildBind=device.createBindGroup({layout:p.build.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:morphRec.cubicBuffer}},{binding:1,resource:{buffer:lengthsBuffer}},{binding:2,resource:{buffer:segmentBuffer}},{binding:3,resource:{buffer:buildUniform}}
    ]});
    const levels=[];let count=n,input=lengthsBuffer,levelIndex=0;
    while(true){
        const blocks=Math.max(1,Math.ceil(count/GPU_MORPH_ARC_WORKGROUP)),output=own(`SpiroStar Morph Arc prefix L${morphRec.layerIndex}.${levelIndex}`,count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),blockSums=own(`SpiroStar Morph Arc block sums L${morphRec.layerIndex}.${levelIndex}`,blocks*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),uniform=gpuMorphArcWriteCount(device,`SpiroStar Morph Arc scan count ${levelIndex}`,count,blocks);owned.push(uniform);
        const bind=device.createBindGroup({layout:p.scan.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}},{binding:2,resource:{buffer:blockSums}},{binding:3,resource:{buffer:uniform}}]});
        levels.push({count,blocks,input,output,blockSums,uniform,bind,addBind:null,addUniform:null});
        if(blocks<=1)break;input=blockSums;count=blocks;levelIndex++;
    }
    for(let i=levels.length-2;i>=0;i--){const child=levels[i],parent=levels[i+1],u=gpuMorphArcWriteCount(device,`SpiroStar Morph Arc add count ${i}`,child.count);owned.push(u);child.addUniform=u;child.addBind=device.createBindGroup({layout:p.add.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:child.output}},{binding:1,resource:{buffer:parent.output}},{binding:2,resource:{buffer:u}}]});}
    const pathUniform=gpuMorphArcWriteCount(device,'SpiroStar Morph Arc path count',pathCount);owned.push(pathUniform);
    const pathBind=device.createBindGroup({layout:p.path.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:segmentBuffer}},{binding:1,resource:{buffer:levels[0].output}},{binding:2,resource:{buffer:pathSegmentRangeBuffer}},{binding:3,resource:{buffer:pathMetricsBuffer}},{binding:4,resource:{buffer:pathUniform}}]});
    const finalUniform=gpuMorphArcWriteCount(device,'SpiroStar Morph Arc finalize count',n);owned.push(finalUniform);
    const finalBind=device.createBindGroup({layout:p.finalize.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:segmentBuffer}},{binding:1,resource:{buffer:levels[0].output}},{binding:2,resource:{buffer:segmentMetaBuffer}},{binding:3,resource:{buffer:pathMetricsBuffer}},{binding:4,resource:{buffer:metaBuffer}},{binding:5,resource:{buffer:finalUniform}}]});
    const table={segs:[],total:1,segmentCount:n,logicalSegmentCount,pathCount,dynamicFrame:true,frameId:-1,gpuArcResident:true,gpuBezierDerived:true,gpuCanonicalSegmentBuffer:segmentBuffer,gpuPathIndexBuffer:pathIndexBuffer,gpuArcMetaBuffer:metaBuffer,gpuPathMetricsBuffer:pathMetricsBuffer,gpuPathSegmentRangeBuffer:pathSegmentRangeBuffer,_gpuMorphArcResource:null};
    const rec={morphRec,generation:gpuMorphArcRuntime.generation,segmentCount:n,logicalSegmentCount,subdiv,pathCount,cpuExpandedMeta:expandedMeta,lengthsBuffer,segmentBuffer,segmentMetaBuffer,pathIndexBuffer,pathSegmentRangeBuffer,pathMetricsBuffer,metaBuffer,levels,buildBind,pathBind,finalBind,ownedBuffers:owned,table,ready:true,lastEncodedFrame:-1,lastEncodedT:NaN,lastCommittedFrame:-1,lastCommittedT:NaN,hasCommittedData:false};table._gpuMorphArcResource=rec;
    gpuMorphArcRuntime.resources.set(morphRec,rec);gpuMorphArcRuntime.resourceSet.add(rec);gpuMorphArcRuntime.stats.resourceBuilds++;return rec;
}
function staticSpiralCubicLength(q){
    const p0=q?.p0||{},c1=q?.c1||{},c2=q?.c2||{},p3=q?.p3||{};
    const speed=(t)=>{const u=1-t,dx=3*u*u*((Number(c1.x)||0)-(Number(p0.x)||0))+6*u*t*((Number(c2.x)||0)-(Number(c1.x)||0))+3*t*t*((Number(p3.x)||0)-(Number(c2.x)||0)),dy=3*u*u*((Number(c1.y)||0)-(Number(p0.y)||0))+6*u*t*((Number(c2.y)||0)-(Number(c1.y)||0))+3*t*t*((Number(p3.y)||0)-(Number(c2.y)||0));return Math.hypot(dx,dy);};
    const x=.7745966692414834;return Math.max(1e-9,(8/18)*speed(.5)+(5/18)*(speed(.5-.5*x)+speed(.5+.5*x)));
}
function getStaticSpiralBezierResource(layerIndex,sharedDevice=null,sharedGeneration=-1){
    if(state?.fourierMode===true)return null;
    if(sharedDevice&&(gpuMorphArcRuntime.device!==sharedDevice||gpuMorphArcRuntime.generation!==sharedGeneration))gpuMorphArcResetDevice(sharedDevice,sharedGeneration);
    if(!gpuMorphArcRuntime.device)return null;
    const layer=state?.layers?.[Number(layerIndex)||0];if(!layer||typeof isSpiralLayer!=='function'||!isSpiralLayer(layer))return null;
    const geometryVersion=Math.max(0,Number((typeof getLayerVersions==='function'?getLayerVersions(layer)?.geometry:layer?._geometryVersion))||0),profileSignature=typeof __spiroSpiralProfileGeometrySignature==='function'?String(__spiroSpiralProfileGeometrySignature(layer)||''):'',old=staticSpiralBezierResources.get(layer);
    if(old?.ready&&old.generation===gpuMorphArcRuntime.generation&&old.geometryVersion===geometryVersion&&String(old.profileSignature||'')===profileSignature)return old;
    if(old){const arc=gpuMorphArcRuntime.resources.get(old);if(arc){gpuMorphArcDestroy(arc);gpuMorphArcRuntime.resourceSet.delete(arc);gpuMorphArcRuntime.resources.delete(old);}destroyStaticSpiralBezierResource(old);}
    let source=[];try{source=typeof buildOrbitPolylines==='function'?(buildOrbitPolylines(layer)||[]):[];}catch(_){source=[];}if(!source.length)return null;
    // 6.8 iter12 — static strict Spiral goes source profile -> retained cubics -> GPU directly.
    // Do not build the six-samples-per-cubic compatibility view merely to read `_bezierSegments`
    // back out of it; that was needless CPU allocation on every profile invalidation.
    const paths=[];let cubicCount=0;const roundBase=Math.max(0,Math.min(2,Number(typeof getRoundingStrength==='function'?getRoundingStrength(layer?.rounding):layer?.rounding)||0));
    for(const path of source){
        const pts=path?.points||[];if(pts.length<2)continue;
        const round=path?.spiralProfileRoundingBaked===true?0:roundBase;
        const smooth=layer?.profileMode==='spline'&&typeof normalizeSplineRenderMode==='function'&&normalizeSplineRenderMode(layer?.splineRenderMode)==='smooth'&&path?.spiralProfileSplineBaked!==true;
        let cubics=[];try{
            if(Array.isArray(path?._bezierSegments)&&path._bezierSegments.length)cubics=path._bezierSegments;
            else if(Array.isArray(pts?._spiroRetainedCubics)&&pts._spiroRetainedCubics.length)cubics=pts._spiroRetainedCubics;
            else if(typeof __spiroBuildSpiralBezierSegments==='function')cubics=__spiroBuildSpiralBezierSegments(pts,round,path?.cornerFlags||[],smooth)||[];
        }catch(_){cubics=[];}
        if(!cubics.length)continue;paths.push({path,cubics,closed:path?.closed===true});cubicCount+=cubics.length;
    }
    if(!cubicCount)return null;
    const cubicData=new Float32Array(cubicCount*8),cpuCubicWidthScales=new Float32Array(cubicCount*2),cpuSegmentMeta=new Uint32Array(cubicCount*4),cpuPathSegmentRanges=new Uint32Array(paths.length*4),cpuPathRanges=new Uint32Array(paths.length*4),cpuEndpointPathLengths=new Float32Array(paths.length*2),cpuPathKnotFractions=new Array(paths.length);let ci=0,pointBase=0;
    for(let pi=0;pi<paths.length;pi++){const rec=paths[pi],first=ci,lengths=[],total=rec.cubics.reduce((sum,q)=>{const l=staticSpiralCubicLength(q);lengths.push(l);return sum+l;},0)||1,fr=[0];let acc=0;for(const q of rec.cubics){const o=ci*8;cubicData[o]=Number(q.p0.x)||0;cubicData[o+1]=Number(q.p0.y)||0;cubicData[o+2]=Number(q.c1.x)||0;cubicData[o+3]=Number(q.c1.y)||0;cubicData[o+4]=Number(q.c2.x)||0;cubicData[o+5]=Number(q.c2.y)||0;cubicData[o+6]=Number(q.p3.x)||0;cubicData[o+7]=Number(q.p3.y)||0;cpuCubicWidthScales[ci*2]=Math.max(.02,Number(q.widthScale0)||1);cpuCubicWidthScales[ci*2+1]=Math.max(.02,Number(q.widthScale1)||1);const mo=ci*4;let flags=0;if(q?.__profileCorner0===true)flags|=0x40000000;if(q?.__profileCorner1===true)flags|=0x80000000;cpuSegmentMeta[mo]=pointBase+(ci-first);cpuSegmentMeta[mo+1]=pointBase+(ci-first)+1;cpuSegmentMeta[mo+2]=pi;cpuSegmentMeta[mo+3]=flags>>>0;acc+=lengths[ci-first];fr.push(Math.min(1,acc/total));ci++;}fr[fr.length-1]=1;const po=pi*4,n=rec.cubics.length;cpuPathSegmentRanges[po]=first;cpuPathSegmentRanges[po+1]=n;cpuPathSegmentRanges[po+2]=pointBase;cpuPathSegmentRanges[po+3]=n+1;cpuPathRanges[po]=pointBase;cpuPathRanges[po+1]=n+1;cpuPathRanges[po+2]=rec.closed?1:0;cpuPathRanges[po+3]=pi;cpuEndpointPathLengths[pi*2]=total;cpuEndpointPathLengths[pi*2+1]=total;cpuPathKnotFractions[pi]={source:fr,target:fr,common:fr};pointBase+=n+1;}
    const buffer=gpuMorphArcBuffer(gpuMorphArcRuntime.device,`Somata static Spiral current cubics L${layerIndex}`,cubicData.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);gpuMorphArcRuntime.device.queue.writeBuffer(buffer,0,cubicData);
    const segmentMetaBuffer=gpuMorphArcBuffer(gpuMorphArcRuntime.device,`Somata static Spiral segment metadata L${layerIndex}`,cpuSegmentMeta.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),pathRangeBuffer=gpuMorphArcBuffer(gpuMorphArcRuntime.device,`Somata static Spiral path ranges L${layerIndex}`,cpuPathRanges.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),pathSegmentRangeBuffer=gpuMorphArcBuffer(gpuMorphArcRuntime.device,`Somata static Spiral path segment ranges L${layerIndex}`,cpuPathSegmentRanges.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    gpuMorphArcRuntime.device.queue.writeBuffer(segmentMetaBuffer,0,cpuSegmentMeta);gpuMorphArcRuntime.device.queue.writeBuffer(pathRangeBuffer,0,cpuPathRanges);gpuMorphArcRuntime.device.queue.writeBuffer(pathSegmentRangeBuffer,0,cpuPathSegmentRanges);
    const rec={layerIndex:Number(layerIndex)||0,layer,generation:gpuMorphArcRuntime.generation,geometryVersion,profileSignature,ready:true,cubicBuffer:buffer,cubicCount,segmentCount:cubicCount,pathCount:paths.length,pointCount:pointBase,bezierSubdiv:12,arcSubdiv:8,bezierVisualRail:true,cpuCubicWidthScales,staticSpiralBezierRail:true,specialSpiralBezierRail:true,gpuOnlySpiralEffects:true,cpuSegmentMeta,cpuPathSegmentRanges,cpuPathRanges,pathRanges:cpuPathRanges,cpuEndpointPathLengths,cpuPathKnotFractions,segmentMetaBuffer,pathRangeBuffer,pathSegmentRangeBuffer,allClosed:paths.every(p=>p.closed),resolveMorphT:()=>0,encodeCurrentCubics:()=>true};
    staticSpiralBezierResources.set(layer,rec);staticSpiralBezierResourceSet.add(rec);return rec;
}
// Iter32 — inspect the already-built static retained rail without forcing a rebuild.
// Useful for distinguishing Open-Spiral geometry/resource failures from presentation failures.
window.__spiroStaticSpiralBezierStatus=(layerIndex=null)=>{
    let li=Number.isFinite(Number(layerIndex))?Math.max(0,Math.floor(Number(layerIndex))):-1;
    if(li<0){try{li=Math.max(0,(state?.layers||[]).findIndex(l=>l?.id===state?.activeLayerId));}catch(_){li=0;}}
    const layer=state?.layers?.[li]||null,rec=layer?staticSpiralBezierResources.get(layer):null;
    return{layerIndex:li,mode:layer&&typeof getContourMode==='function'?getContourMode(layer):null,spiralClosed:layer?.spiralClosed!==false,ready:rec?.ready===true,generation:Number(rec?.generation)||0,geometryVersion:Number(rec?.geometryVersion)||0,profileSignature:String(rec?.profileSignature||''),cubicCount:Number(rec?.cubicCount)||0,pathCount:Number(rec?.pathCount)||0,pointCount:Number(rec?.pointCount)||0,allClosed:rec?.allClosed===true};
};
function currentGpuBezierMorphResource(layerIndex){
    const li=Number(layerIndex)||0,morphActive=runtimeState?.morph?.active===true||state?.morph?.active===true;
    if(morphActive){
        const src=runtimeState?.morph?.renderSourceLayers?.[li]||null,dst=runtimeState?.morph?.renderTargetLayers?.[li]||null,base=state?.layers?.[li]||null;
        const hasSpiralEndpoint=Boolean(src?.spiralEnabled===true||dst?.spiralEnabled===true||base?.spiralEnabled===true);
        const specialMode=Boolean(state?.morph?.mode==='circleSlide'||(typeof spiralMorphUsesCircleRebuild==='function'&&spiralMorphUsesCircleRebuild())||(hasSpiralEndpoint&&typeof spiralMorphUsesRetainedBezierRail==='function'&&spiralMorphUsesRetainedBezierRail()));
        const o=state?.morph?.options||{},spiralGeometryRequested=Boolean(o.byVertices||o.bySteps||o.byShape||state?.morph?.monoOrbitTransforms||o.byRounding||o.bySize||o.byRotation||o.bySpiralOrder||o.bySpiralLayers);
        // Somata 6.8 Iter40: every active retained-Bézier Spiral Morph has exactly one visual
        // carrier: WebGPUSpiralBezierMorphRenderer's retained current-cubic buffer.  Never
        // substitute the generic topology rail while that resource is warming; doing so makes
        // lamps/web/lightning/graffiti visibly leave the Spiral for one or more frames.
        const strictSpiralMorphRail=Boolean(hasSpiralEndpoint&&specialMode&&spiralGeometryRequested&&state?.fourierMode!==true);
        if(strictSpiralMorphRail){
            const special=typeof WebGPUSpiralBezierMorphRenderer!=='undefined'?WebGPUSpiralBezierMorphRenderer.getResource?.(li):null;
            if(special?.ready&&special?.bezierVisualRail&&special?.specialSpiralBezierRail)return special;
            try{WebGPUSpiralBezierMorphRenderer?.warmup?.();}catch(_){ }
            return null;
        }
        // If Blue Morph only changes visual/style properties, Spiral geometry is static.
        // Keep effects on the exact static retained cubic instead of declaring them ineligible.
        if(hasSpiralEndpoint&&!spiralGeometryRequested&&state?.fourierMode!==true)return getStaticSpiralBezierResource(li);
        const shared=typeof getSharedGpuMorphPathResource==='function'?getSharedGpuMorphPathResource(li):null;if(shared?.ready)return shared;
        return null;
    }
    return getStaticSpiralBezierResource(li);
}
// 7.0.10 — frame-authoritative retained Bézier selection.  Effects must consume the
// exact rail that owns BASE in this display frame, not infer it from global Morph activity.
// A globally active/preparing/paused Morph can coexist with a static Spiral frame; using
// runtimeState.morph.active alone made Lamps ask for a Morph rail that did not own the frame.
function currentGpuBezierResourceForFrame(frameCtx){
    if(!frameCtx)return null;
    const li=Number(frameCtx.layerIndex)||0;
    const blueOwnsFrame=Boolean(frameCtx.morphFrameActive===true&&frameCtx.greenMorphEnabled!==true&&frameCtx.minimalFadeEnabled!==true&&frameCtx.blueMorphProvider?.mode!=='fade'&&frameCtx.geometryProvider===frameCtx.blueMorphProvider&&frameCtx.geometryPlan?.kind==='blue-circle-slide');
    if(blueOwnsFrame){
        const special=typeof WebGPUSpiralBezierMorphRenderer!=='undefined'?WebGPUSpiralBezierMorphRenderer.getResource?.(li):null;
        if(special?.ready&&special?.bezierVisualRail&&special?.specialSpiralBezierRail)return special;
        try{WebGPUSpiralBezierMorphRenderer?.warmup?.();}catch(_){}
        return null;
    }
    const layer=frameCtx.layer||state?.layers?.[li]||null;
    if(state?.fourierMode!==true&&layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(layer))return getStaticSpiralBezierResource(li);
    // During a handoff the temporary render layer can be polygonal while the retained Spiral
    // rail still owns BASE. Only accept that special rail when this frame actually advertises it.
    if(frameCtx.morphFrameActive===true){
        const special=typeof WebGPUSpiralBezierMorphRenderer!=='undefined'?WebGPUSpiralBezierMorphRenderer.getResource?.(li):null;
        if(special?.ready&&special?.bezierVisualRail&&special?.specialSpiralBezierRail)return special;
    }
    const shared=typeof getSharedGpuMorphPathResource==='function'?getSharedGpuMorphPathResource(li):null;
    return shared?.ready?shared:null;
}
function getGpuMorphArcResource(layerIndex,frameCtx=null){
    const morphRec=frameCtx?currentGpuBezierResourceForFrame(frameCtx):currentGpuBezierMorphResource(layerIndex);if(!morphRec){gpuMorphArcRuntime.stats.resourceMisses++;return null;}
    const rec=buildGpuMorphArcResource(morphRec);if(!rec)gpuMorphArcRuntime.stats.resourceMisses++;return rec;
}
function gpuMorphArcIneligibleReason(frameCtx){
    if(!frameCtx?.layer)return'no-frame';
    if(frameCtx.geometryPlan?.kind==='lightning')return'lightning-geometry';
    if(state?.fourierMode===true)return'fourier';
    // Somata 6.8 iter8: the retained Spiral rail is the geometry authority throughout the
    // whole polygon<->Spiral handoff. The temporary frame layer/provider may still look like a
    // polygon for part of the transition; rejecting on that metadata made Lamps/Glint/Web/
    // Graffiti/Particles disappear exactly while the visible base was already the Spiral rail.
    const spiral=l=>Boolean(l&&typeof isSpiralLayer==='function'&&isSpiralLayer(l));
    const strictSpiral=typeof isStrictSpiralWebGPUFrame==='function'?isStrictSpiralWebGPUFrame(frameCtx):Boolean(spiral(frameCtx.layer)||spiral(frameCtx.sourceLayer)||spiral(frameCtx.geometryPlan?.sourceLayer)||spiral(frameCtx.geometryPlan?.targetLayer));
    const shared=currentGpuBezierResourceForFrame(frameCtx);
    if(strictSpiral)return shared?.bezierVisualRail?'':'bezier-rail-unavailable';
    const spiralLayer=spiral(frameCtx.layer),staticSpiral=spiralLayer&&!frameCtx.morphFrameActive;
    const styleOnlySpiralMorph=spiralLayer&&frameCtx.morphFrameActive&&frameCtx?.blueMorphProvider?.geometryActive!==true;
    if(!staticSpiral&&!styleOnlySpiralMorph){
        if(!frameCtx?.morphFrameActive)return'morph-inactive';
        if(!frameCtx?.blueMorphProvider?.geometryActive)return'blue-geometry-inactive';
        if(frameCtx.geometryProvider!==frameCtx.blueMorphProvider)return'another-geometry-provider';
    }
    if(!shared?.bezierVisualRail)return'bezier-rail-unavailable';
    return'';
}
function isGpuMorphArcEligible(frameCtx){return gpuMorphArcIneligibleReason(frameCtx)==='';}
function noteGpuMorphArcDecision(frameCtx,eligible,reason,segmentCount=0){
    const d=gpuMorphArcRuntime.lastDecision;d.eligible=eligible===true;d.reason=String(reason||'');d.layerIndex=Number(frameCtx?.layerIndex)||0;d.frameId=Number(frameCtx?.frameId)||Number(frameGeometryRuntime?.frameId)||0;d.segmentCount=Math.max(0,Number(segmentCount)||0);return d;
}
function getGpuMorphArcTableForFrame(frameCtx){
    if(!frameCtx)return null;gpuMorphArcRuntime.stats.tableRequests++;
    const fid=Number(frameCtx.frameId)||Number(frameGeometryRuntime?.frameId)||0;
    if(frameCtx._gpuMorphArcDecisionFrameId===fid){gpuMorphArcRuntime.stats.frameCacheHits++;return frameCtx._gpuMorphArcTable||null;}
    frameCtx._gpuMorphArcDecisionFrameId=fid;frameCtx._gpuMorphArcTable=null;
    const reason=gpuMorphArcIneligibleReason(frameCtx);noteGpuMorphArcDecision(frameCtx,!reason,reason||'gpu-morph-arc');
    if(reason){gpuMorphArcRuntime.stats.unsupportedFrames++;return null;}gpuMorphArcRuntime.stats.eligibleRequests++;
    if(!warmupGpuMorphArcResource()){gpuMorphArcRuntime.stats.warmupFallbacks++;noteGpuMorphArcDecision(frameCtx,false,'resource-warming');return null;}
    const rec=getGpuMorphArcResource(frameCtx.layerIndex,frameCtx);if(!rec){noteGpuMorphArcDecision(frameCtx,false,'frame-authority-resource-unavailable');return null;}
    const rawT=frameCtx.blueMorphProvider?.geometryT ?? frameCtx.geometryPlan?.progress,t=typeof rec.morphRec?.resolveMorphT==='function'?rec.morphRec.resolveMorphT(rawT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(rawT):Math.max(0,Math.min(1,Number(rawT)||0))),table=rec.table;
    table.frameId=fid;table.gpuMorphT=t;table.total=1; // non-zero readiness sentinel; exact total lives in gpuArcMetaBuffer.
    frameCtx._gpuMorphArcTable=table;noteGpuMorphArcDecision(frameCtx,true,'gpu-morph-arc',rec.segmentCount);return table;
}
function getGpuMorphArcResourceForFrame(frameCtx){
    const table=getGpuMorphArcTableForFrame(frameCtx);return table?._gpuMorphArcResource||null;
}
function encodeGpuMorphArcTable(table,encoder,options=null){
    const rec=table?._gpuMorphArcResource;if(!rec?.ready||!encoder)return false;const frameId=Math.max(0,Number(table.frameId)||0),t=typeof rec.morphRec?.resolveMorphT==='function'?rec.morphRec.resolveMorphT(table.gpuMorphT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));
    // v512 correctness contract: only a SUBMITTED resource may be reused across independent
    // command encoders. v511 marked the resource resident at encode-time; that is unsafe when
    // another effect owns a different command buffer which may be submitted first. A fused
    // consumer can still encode compute + draw into one encoder, while cross-consumer reuse is
    // allowed only after noteGpuMorphArcTableSubmitted().
    if(rec.hasCommittedData&&rec.lastCommittedT===t){rec.lastEncodedFrame=frameId;rec.lastEncodedT=t;gpuMorphArcRuntime.stats.frameDataReuses++;gpuMorphArcRuntime.stats.committedReuseHits++;return true;}
    // Correctness first: an encoded/scheduled write in another command buffer is NOT a safe
    // dependency. Only a submitted+committed Arc may be reused above. Otherwise encode the exact
    // current cubic rail in this encoder before building segment/arc data.
    // Iter9 correctness: a current-cubic write recorded by the Base pass may live in a
    // different deferred command buffer and is NOT a dependency of this encoder yet. Build the
    // retained Spiral cubics in this Arc prerequisite itself. The scheduler then queues this one
    // prerequisite ahead of every Arc consumer, so Lightning/Lamps/Web/Particles all see the same
    // submitted rail and we still compute it only once for the effect group.
    // Iter15: if the retained Spiral Base command buffer is already the ordered root producer
    // of these exact current cubics in the same deferred LayerScene queue, Arc must consume that
    // buffer instead of dispatching the polar current-cubic compute a second time. WebGPU queue
    // order is the dependency; no CPU wait/readback is introduced. Independent encoders still
    // encode their own rail exactly as before.
    const reuseOrderedCurrentCubics=options?.reuseOrderedCurrentCubics===true;
    if(reuseOrderedCurrentCubics)gpuMorphArcRuntime.stats.orderedCurrentCubicReuses++;
    else{const railEncoded=typeof rec.morphRec?.encodeCurrentCubics==='function'?rec.morphRec.encodeCurrentCubics(encoder,t):(typeof encodeSharedGpuMorphPath==='function'&&encodeSharedGpuMorphPath(encoder,rec.morphRec.layerIndex,t));if(!railEncoded)return false;gpuMorphArcRuntime.stats.morphEncodes++;}
    const p=gpuMorphArcRuntime.pipelines;
    let pass=encoder.beginComputePass({label:`SpiroStar Morph Arc build L${rec.morphRec.layerIndex}`});pass.setPipeline(p.build);pass.setBindGroup(0,rec.buildBind);pass.dispatchWorkgroups(Math.ceil(rec.segmentCount/256));pass.end();gpuMorphArcRuntime.stats.segmentBuildDispatches++;
    for(const level of rec.levels){pass=encoder.beginComputePass({label:'SpiroStar Morph Arc scan'});pass.setPipeline(p.scan);pass.setBindGroup(0,level.bind);pass.dispatchWorkgroups(level.blocks);pass.end();gpuMorphArcRuntime.stats.scanDispatches++;}
    for(let i=rec.levels.length-2;i>=0;i--){const level=rec.levels[i];pass=encoder.beginComputePass({label:'SpiroStar Morph Arc add block offsets'});pass.setPipeline(p.add);pass.setBindGroup(0,level.addBind);pass.dispatchWorkgroups(Math.ceil(level.count/256));pass.end();gpuMorphArcRuntime.stats.scanOffsetDispatches++;}
    pass=encoder.beginComputePass({label:'SpiroStar Morph Arc path metrics'});pass.setPipeline(p.path);pass.setBindGroup(0,rec.pathBind);pass.dispatchWorkgroups(Math.ceil(Math.max(1,rec.pathCount)/128));pass.end();gpuMorphArcRuntime.stats.pathMetricDispatches++;
    pass=encoder.beginComputePass({label:'SpiroStar Morph Arc finalize'});pass.setPipeline(p.finalize);pass.setBindGroup(0,rec.finalBind);pass.dispatchWorkgroups(Math.ceil(rec.segmentCount/256));pass.end();gpuMorphArcRuntime.stats.finalizeDispatches++;
    rec.lastEncodedFrame=frameId;rec.lastEncodedT=t;gpuMorphArcRuntime.stats.framesEncoded++;gpuMorphArcRuntime.stats.encodedButUncommitted++;gpuMorphArcRuntime.stats.cpuPathBuildsAvoided++;gpuMorphArcRuntime.stats.cpuSegmentWalksAvoided+=rec.segmentCount;return true;
}

function isGpuMorphArcTableCommitted(table){
    const rec=table?._gpuMorphArcResource;if(!rec?.ready)return false;
    const t=typeof rec.morphRec?.resolveMorphT==='function'?rec.morphRec.resolveMorphT(table.gpuMorphT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));
    return rec.hasCommittedData===true&&rec.lastCommittedT===t;
}
window.isGpuMorphArcTableCommitted=isGpuMorphArcTableCommitted;
function noteGpuMorphArcTableSubmitted(table){
    const rec=table?._gpuMorphArcResource;if(!rec?.ready)return false;
    const frameId=Math.max(0,Number(table.frameId)||0),t=typeof rec.morphRec?.resolveMorphT==='function'?rec.morphRec.resolveMorphT(table.gpuMorphT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));
    rec.hasCommittedData=true;rec.lastCommittedFrame=frameId;rec.lastCommittedT=t;
    if(typeof rec.morphRec?.encodeCurrentCubics!=='function'){try{noteSharedGpuMorphPathSubmitted?.(rec.morphRec,t,frameId);}catch(_){}}
    gpuMorphArcRuntime.stats.committedSubmissions++;return true;
}
function buildGpuMorphArcPrerequisiteCommand(table,options=null){
    const rec=table?._gpuMorphArcResource;if(!rec?.ready||!gpuMorphArcRuntime.device)return null;
    const frameId=Math.max(0,Number(table.frameId)||0),t=typeof rec.morphRec?.resolveMorphT==='function'?rec.morphRec.resolveMorphT(table.gpuMorphT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));
    if(rec.hasCommittedData&&rec.lastCommittedT===t)return{ready:true,committed:true,table,commandBuffer:null,onSubmitted:null};
    try{
        const encoder=gpuMorphArcRuntime.device.createCommandEncoder({label:`SpiroStar scheduled Morph Arc prerequisite L${rec.morphRec?.layerIndex??0}`});
        if(!encodeGpuMorphArcTable(table,encoder,options))return null;
        return{ready:true,committed:false,table,commandBuffer:encoder.finish(),onSubmitted:()=>noteGpuMorphArcTableSubmitted(table)};
    }catch(err){gpuMorphArcRuntime.lastError=String(err?.message||err);return null;}
}

function ensureGpuMorphArcTableSubmitted(table){
    const rec=table?._gpuMorphArcResource;if(!rec?.ready||!gpuMorphArcRuntime.device)return false;
    const t=typeof rec.morphRec?.resolveMorphT==='function'?rec.morphRec.resolveMorphT(table.gpuMorphT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));
    if(rec.hasCommittedData&&rec.lastCommittedT===t){gpuMorphArcRuntime.stats.committedReuseHits++;return true;}
    try{
        const encoder=gpuMorphArcRuntime.device.createCommandEncoder({label:`SpiroStar Morph Arc prerequisite L${rec.morphRec?.layerIndex??0}`});
        if(!encodeGpuMorphArcTable(table,encoder))return false;
        gpuMorphArcRuntime.device.queue.submit([encoder.finish()]);
        noteGpuMorphArcTableSubmitted(table);return true;
    }catch(err){gpuMorphArcRuntime.lastError=String(err?.message||err);return false;}
}

window.__spiroGpuMorphArcStatus=()=>({ready:gpuMorphArcRuntime.ready,generation:gpuMorphArcRuntime.generation,lastError:gpuMorphArcRuntime.lastError,lastDecision:{...gpuMorphArcRuntime.lastDecision},resourceCount:gpuMorphArcRuntime.resourceSet.size,staticSpiralResources:staticSpiralBezierResourceSet.size,stats:{...gpuMorphArcRuntime.stats},resources:[...gpuMorphArcRuntime.resourceSet].map(r=>({layerIndex:r.morphRec?.layerIndex,segmentCount:r.segmentCount,logicalSegmentCount:r.logicalSegmentCount,subdiv:r.subdiv,pathCount:r.pathCount,scanLevels:r.levels.length,lastEncodedFrame:r.lastEncodedFrame,lastEncodedT:r.lastEncodedT,lastCommittedFrame:r.lastCommittedFrame,lastCommittedT:r.lastCommittedT,hasCommittedData:r.hasCommittedData})),contract:'topology/Spiral Morph arc-distance consumers derive a fixed GPU micro-rail from the same retained cubic carrier; each effect-group prerequisite encodes its exact current cubics in the same command buffer, then uses Gauss-3 cubic arc lengths + GPU prefix scan. Independent command buffers never trust merely scheduled writes; no CPU morph point materialization, no CPU arc walk, no GPU readback.'});
