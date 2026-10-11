// SpiroStar v515 — GPU Graffiti Arc Sampler
// Reproduces legacy sampleGraffitiRange() for topology Morph without materializing CPU paths.
// One workgroup owns one contour: exact Morph Arc -> <=221 sampled points + sampled cumulative arc.
// This bounded representation is shared by pinched and perPath/whole variation Graffiti.
window.__spiroRegisterModule?.('js/gpu/graffiti-sample-resource');

const GPU_GRAFFITI_SAMPLE_INTERVALS_MAX=220;
const GPU_GRAFFITI_SAMPLE_STRIDE=224;

const gpuGraffitiSampleRuntime={
    device:null,generation:-1,initializing:null,ready:false,lastError:'not-initialized',
    pipeline:null,resources:new WeakMap(),resourceSet:new Set(),
    stats:{requests:0,resourceBuilds:0,resourceHits:0,encodes:0,reuses:0,submissions:0,arcPrerequisites:0,
        cpuResamplesAvoided:0,cpuPointMaterializationsAvoided:0,deviceResets:0}
};

const GPU_GRAFFITI_SAMPLE_WGSL=`
const STRIDE:u32=224u;
const MAX_INTERVALS:u32=220u;
@group(0) @binding(0) var<storage,read> segments:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> pathSegmentRanges:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read> pathMetrics:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> pathRanges:array<vec4<u32>>;
@group(0) @binding(4) var<storage,read_write> sampled:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> sampleInfo:array<vec4<f32>>;
@group(0) @binding(6) var<storage,read> retainedCubics:array<vec4<f32>>;
struct SampleU { subdiv:u32, exactBezier:u32, _a:u32, _b:u32, };
@group(0) @binding(7) var<uniform> info:SampleU;

var<workgroup> wx:array<f32,256>;
var<workgroup> wy:array<f32,256>;
var<workgroup> scan:array<f32,256>;

fn cubicPoint(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{
    let z=1.0-t;return z*z*z*p0+3.0*z*z*t*c1+3.0*z*t*t*c2+t*t*t*p3;
}

fn cubicDerivativeArc(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let s=1.0-t;return 3.0*s*s*(c1-p0)+6.0*s*t*(c2-c1)+3.0*t*t*(p3-c2);}
fn arcCorrectMicroT(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,sub:u32,subdiv:u32,f0:f32)->f32{
    let f=clamp(f0,0.0,1.0);let sd=max(1u,subdiv);let t0=f32(sub)/f32(sd);let t1=f32(sub+1u)/f32(sd);if(f<=0.000001){return t0;}if(f>=0.999999){return t1;}
    let s0=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t0)));let s1=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t1)));let dv=s1-s0;let arcTarget=f*max(0.000001,s0+0.5*dv);
    // Integral of the local linear-speed model has a closed-form inverse. Rationalized root
    // avoids cancellation and is cheaper than iterative Newton correction in particle/Web loads.
    let disc=max(0.000000000001,s0*s0+2.0*dv*arcTarget);let q=clamp((2.0*arcTarget)/max(0.000001,s0+sqrt(disc)),0.0,1.0);return mix(t0,t1,q);
}
fn retainedPoint(globalMicro:u32,microT:f32)->vec2<f32>{
    if(info.exactBezier==0u){let g=segments[globalMicro*2u];return mix(g.xy,g.zw,microT);}
    let subdiv=max(1u,info.subdiv);let logical=globalMicro/subdiv;let sub=globalMicro%subdiv;
    let q0=retainedCubics[logical*2u];let q1=retainedCubics[logical*2u+1u];let t=arcCorrectMicroT(q0.xy,q0.zw,q1.xy,q1.zw,sub,subdiv,microT);
    return cubicPoint(q0.xy,q0.zw,q1.xy,q1.zw,t);
}
fn sampleAt(first:u32,count:u32,pathStart:f32,pathTotal:f32,d0:f32)->vec2<f32>{
    if(count==0u){return vec2<f32>(0.0);}
    let d=clamp(d0,0.0,max(0.0,pathTotal-0.000000001));
    var lo=0u;var hi=count-1u;
    loop{
        if(lo>=hi){break;}
        let mid=(lo+hi)/2u;
        let q=segments[(first+mid)*2u+1u];
        let end=(q.x-pathStart)+q.y;
        if(end<d){lo=mid+1u;}else{hi=mid;}
    }
    let q=segments[(first+lo)*2u+1u];
    let localStart=q.x-pathStart;
    let u=select(0.0,clamp((d-localStart)/q.y,0.0,1.0),q.y>0.000000001);
    return retainedPoint(first+lo,u);
}

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wid:vec3<u32>,@builtin(local_invocation_id) lid3:vec3<u32>){
    let pathIndex=wid.x;let lid=lid3.x;
    let sr=pathSegmentRanges[pathIndex];let pm=pathMetrics[pathIndex];let pr=pathRanges[pathIndex];
    let first=sr.x;let segCount=sr.y;let total=pm.y;let closed=pr.z!=0u;
    var intervals=0u;var pointCount=0u;var renderSegments=0u;
    if(segCount>0u&&total>0.000001){
        intervals=min(MAX_INTERVALS,max(8u,u32(ceil(total/3.0))));
        pointCount=intervals+1u;
        renderSegments=select(intervals,pointCount,closed);
    }
    if(lid<pointCount){
        let d=min(max(0.0,total-0.0000001),total*(f32(lid)/f32(max(1u,intervals))));
        let p=sampleAt(first,segCount,pm.x,total,d);wx[lid]=p.x;wy[lid]=p.y;
    }else{wx[lid]=0.0;wy[lid]=0.0;}
    workgroupBarrier();

    var edge=0.0;
    if(lid>0u&&lid<pointCount){edge=distance(vec2<f32>(wx[lid-1u],wy[lid-1u]),vec2<f32>(wx[lid],wy[lid]));}
    scan[lid]=edge;workgroupBarrier();
    var offset=1u;
    loop{
        if(offset>=256u){break;}
        var add=0.0;if(lid>=offset){add=scan[lid-offset];}
        workgroupBarrier();scan[lid]=scan[lid]+add;workgroupBarrier();offset=offset<<1u;
    }
    let openTotal=select(0.0,scan[pointCount-1u],pointCount>0u);
    if(lid<pointCount){
        let arc=scan[lid];let localT=select(0.0,arc/openTotal,openTotal>0.000001);
        sampled[pathIndex*STRIDE+lid]=vec4<f32>(wx[lid],wy[lid],arc,localT);
    }
    if(lid==0u){sampleInfo[pathIndex]=vec4<f32>(f32(pointCount),f32(renderSegments),openTotal,select(0.0,1.0,closed));}
}`;

function destroyGpuGraffitiSampleResource(rec){
    if(!rec)return;for(const b of rec.ownedBuffers||[])try{b?.destroy?.();}catch(_){}
    rec.ownedBuffers=[];rec.ready=false;
}
function resetGpuGraffitiSampleDevice(device,generation){
    if(gpuGraffitiSampleRuntime.device===device&&gpuGraffitiSampleRuntime.generation===generation)return;
    for(const rec of gpuGraffitiSampleRuntime.resourceSet)destroyGpuGraffitiSampleResource(rec);
    gpuGraffitiSampleRuntime.resources=new WeakMap();gpuGraffitiSampleRuntime.resourceSet.clear();
    gpuGraffitiSampleRuntime.device=device;gpuGraffitiSampleRuntime.generation=generation;gpuGraffitiSampleRuntime.pipeline=null;
    gpuGraffitiSampleRuntime.ready=false;gpuGraffitiSampleRuntime.stats.deviceResets++;
}
async function ensureGpuGraffitiSamplePipeline(){
    const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration():-1;
    if(gpuGraffitiSampleRuntime.ready&&gpuGraffitiSampleRuntime.device&&gpuGraffitiSampleRuntime.generation===gen)return true;
    if(gpuGraffitiSampleRuntime.initializing)return gpuGraffitiSampleRuntime.initializing;
    const task=(async()=>{try{
        if(typeof WebGPUDeviceHub==='undefined')throw new Error('WebGPUDeviceHub unavailable');
        const shared=await WebGPUDeviceHub.acquire();resetGpuGraffitiSampleDevice(shared.device,shared.generation);
        const mod=shared.device.createShaderModule({label:'SpiroStar GPU Graffiti arc sampler WGSL',code:GPU_GRAFFITI_SAMPLE_WGSL});
        if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(mod,'SpiroStar GPU Graffiti arc sampler WGSL');
        gpuGraffitiSampleRuntime.pipeline=shared.device.createComputePipeline({label:'SpiroStar GPU Graffiti arc sampler',layout:'auto',compute:{module:mod,entryPoint:'main'}});
        gpuGraffitiSampleRuntime.ready=true;gpuGraffitiSampleRuntime.lastError='';return true;
    }catch(err){gpuGraffitiSampleRuntime.ready=false;gpuGraffitiSampleRuntime.lastError=String(err?.message||err);return false;}})();
    gpuGraffitiSampleRuntime.initializing=task;try{return await task;}finally{if(gpuGraffitiSampleRuntime.initializing===task)gpuGraffitiSampleRuntime.initializing=null;}
}
function warmupGpuGraffitiSampleResource(){if(gpuGraffitiSampleRuntime.ready)return true;if(!gpuGraffitiSampleRuntime.initializing)void ensureGpuGraffitiSamplePipeline();return false;}

function buildGpuGraffitiSampleResource(arcRec){
    if(!arcRec?.ready||!arcRec.pathCount||!gpuGraffitiSampleRuntime.ready)return null;
    let hit=gpuGraffitiSampleRuntime.resources.get(arcRec);
    if(hit?.ready&&hit.generation===gpuGraffitiSampleRuntime.generation){gpuGraffitiSampleRuntime.stats.resourceHits++;return hit;}
    const device=gpuGraffitiSampleRuntime.device,pathCount=arcRec.pathCount,owned=[];
    const make=(label,bytes)=>{const b=device.createBuffer({label,size:Math.max(16,Math.ceil(bytes/16)*16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(b);return b;};
    const samplePointBuffer=make(`SpiroStar Graffiti sampled points L${arcRec.morphRec?.layerIndex??0}`,pathCount*GPU_GRAFFITI_SAMPLE_STRIDE*16);
    const sampleInfoBuffer=make(`SpiroStar Graffiti sampled info L${arcRec.morphRec?.layerIndex??0}`,pathCount*16);
    const sampleUniform=device.createBuffer({label:`SpiroStar Graffiti exact cubic info L${arcRec.morphRec?.layerIndex??0}`,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});owned.push(sampleUniform);
    device.queue.writeBuffer(sampleUniform,0,new Uint32Array([Math.max(1,Number(arcRec.subdiv)||1),arcRec.morphRec?.cubicBuffer?1:0,0,0]));
    const bind=device.createBindGroup({layout:gpuGraffitiSampleRuntime.pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:arcRec.segmentBuffer}},
        {binding:1,resource:{buffer:arcRec.pathSegmentRangeBuffer}},
        {binding:2,resource:{buffer:arcRec.pathMetricsBuffer}},
        {binding:3,resource:{buffer:arcRec.morphRec.pathRangeBuffer}},
        {binding:4,resource:{buffer:samplePointBuffer}},
        {binding:5,resource:{buffer:sampleInfoBuffer}},
        {binding:6,resource:{buffer:arcRec.morphRec.cubicBuffer}},
        {binding:7,resource:{buffer:sampleUniform}}
    ]});
    const rec={arcRec,generation:gpuGraffitiSampleRuntime.generation,pathCount,samplePointBuffer,sampleInfoBuffer,bind,ownedBuffers:owned,
        ready:true,lastEncodedFrame:-1,lastEncodedT:NaN,lastCommittedFrame:-1,lastCommittedT:NaN,hasCommittedData:false};
    gpuGraffitiSampleRuntime.resources.set(arcRec,rec);gpuGraffitiSampleRuntime.resourceSet.add(rec);gpuGraffitiSampleRuntime.stats.resourceBuilds++;return rec;
}
function getGpuGraffitiSampleResourceForFrame(frameCtx){
    gpuGraffitiSampleRuntime.stats.requests++;
    if(!frameCtx||typeof getGpuMorphArcTableForFrame!=='function')return null;
    const table=getGpuMorphArcTableForFrame(frameCtx);if(!table)return null;
    if(!warmupGpuGraffitiSampleResource())return null;
    const arcRec=table._gpuMorphArcResource,resource=buildGpuGraffitiSampleResource(arcRec);if(!resource)return null;
    return{table,resource};
}
function encodeGpuGraffitiSampleResource(rec,table,encoder,frameCtx=null){
    if(!rec?.ready||!table||!encoder)return false;
    const frameId=Math.max(0,Number(table.frameId)||0),t=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));
    if(rec.hasCommittedData&&rec.lastCommittedT===t){rec.lastEncodedFrame=frameId;rec.lastEncodedT=t;gpuGraffitiSampleRuntime.stats.reuses++;return true;}
    const arcReady=typeof spiroGpuPrepareArcForLayerScene==='function'?spiroGpuPrepareArcForLayerScene(frameCtx,table,encoder):(typeof encodeGpuMorphArcTable==='function'&&encodeGpuMorphArcTable(table,encoder));if(!arcReady)return false;
    gpuGraffitiSampleRuntime.stats.arcPrerequisites++;
    const pass=encoder.beginComputePass({label:`SpiroStar Graffiti arc sampler L${rec.arcRec?.morphRec?.layerIndex??0}`});
    pass.setPipeline(gpuGraffitiSampleRuntime.pipeline);pass.setBindGroup(0,rec.bind);pass.dispatchWorkgroups(rec.pathCount);pass.end();
    rec.lastEncodedFrame=frameId;rec.lastEncodedT=t;gpuGraffitiSampleRuntime.stats.encodes++;
    gpuGraffitiSampleRuntime.stats.cpuResamplesAvoided+=rec.pathCount;gpuGraffitiSampleRuntime.stats.cpuPointMaterializationsAvoided+=rec.pathCount*(GPU_GRAFFITI_SAMPLE_INTERVALS_MAX+1);
    return true;
}
function noteGpuGraffitiSampleSubmitted(rec,table){
    if(!rec?.ready||!table)return false;
    const frameId=Math.max(0,Number(table.frameId)||0),t=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));
    rec.hasCommittedData=true;rec.lastCommittedFrame=frameId;rec.lastCommittedT=t;
    try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}
    gpuGraffitiSampleRuntime.stats.submissions++;return true;
}
window.__spiroGpuGraffitiSampleStatus=()=>({ready:gpuGraffitiSampleRuntime.ready,generation:gpuGraffitiSampleRuntime.generation,lastError:gpuGraffitiSampleRuntime.lastError,
    stride:GPU_GRAFFITI_SAMPLE_STRIDE,maxIntervals:GPU_GRAFFITI_SAMPLE_INTERVALS_MAX,stats:{...gpuGraffitiSampleRuntime.stats},
    resources:[...gpuGraffitiSampleRuntime.resourceSet].map(r=>({layerIndex:r.arcRec?.morphRec?.layerIndex,pathCount:r.pathCount,lastCommittedT:r.lastCommittedT,hasCommittedData:r.hasCommittedData})),
    contract:'exact topology/Spiral Morph arc is sampled on GPU with legacy 3px / 8..220 interval policy, but every resolved distance is evaluated back on the shared retained cubic Bézier rail; sampled cumulative arc remains GPU-resident; no CPU path, chord-final-position or Canvas carrier.'});
