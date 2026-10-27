

window.__spiroRegisterModule?.('js/gpu/morph-path-resource');

const GPU_TOPOLOGY_BEZIER_SUBDIV=8;
window.GPU_TOPOLOGY_BEZIER_SUBDIV=GPU_TOPOLOGY_BEZIER_SUBDIV;

const sharedGpuMorphPathRuntime={
    phaseSerial:0,
    reason:'init',
    resources:[],
    device:null,
    generation:-1,
    pipeline:null,
    cubicPipeline:null,
    bindGroupLayout:null,
    pipelineLayout:null,
    initializing:null,
    whyUnavailable:'not-prepared',
    stats:{
        phaseBuilds:0,phaseUploads:0,sourceTargetUploadBytes:0,
        pathMetadataUploadBytes:0,frameUniformUpdates:0,dispatches:0,encodedDispatches:0,
        cpuPointInterpolationsAvoided:0,resourceHits:0,resourceMisses:0,uniformAllocationsAvoided:0,
        deviceResets:0,buildErrors:0,committedSubmissions:0,committedReuseHits:0
    }
};

const SHARED_GPU_MORPH_WGSL=`
struct FrameUniforms {
    t:f32,
    calm:f32,
    pointCount:u32,
    _pad:u32,
};
@group(0) @binding(0) var<storage,read> sourcePts:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> targetPts:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> outputPts:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> frame:FrameUniforms;

@compute @workgroup_size(128)
fn morphMain(@builtin(global_invocation_id) gid:vec3<u32>) {
    let i=gid.x;
    if(i>=frame.pointCount){return;}
    let a=sourcePts[i];
    let b=targetPts[i];
    let t=frame.t;
    let rotation=b.w*(1.0-t);
    var xy:vec2<f32>;

    if(a.w>0.5){
        let r=mix(a.x,b.x,t);
        let targetAngle=b.y+rotation;
        var delta=targetAngle-a.y;
        if(frame.calm>0.5){delta=clamp(delta,-12.566370614359172,12.566370614359172);}
        let angle=a.y+delta*t;
        xy=vec2<f32>(cos(angle),sin(angle))*r;
    }else{
        let c=cos(rotation);
        let s=sin(rotation);
        let rotatedTarget=vec2<f32>(b.x*c-b.y*s,b.x*s+b.y*c);
        xy=mix(a.xy,rotatedTarget,t);
    }
    outputPts[i]=vec4<f32>(xy,mix(a.z,b.z,t),0.0);
}`;

const SHARED_GPU_MORPH_CUBIC_WGSL=`
struct CountU { count:u32, _a:u32, _b:u32, _c:u32, };
@group(0) @binding(0) var<storage,read> points:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read> pathRanges:array<vec4<u32>>;
@group(0) @binding(3) var<storage,read_write> cubics:array<vec4<f32>>;
@group(0) @binding(4) var<uniform> info:CountU;

fn clampHandle(v:vec2<f32>, maxLen:f32)->vec2<f32>{
    let l=length(v);
    if(l<=maxLen||l<1e-6){return v;}
    return v*(maxLen/l);
}
fn cross2(a:vec2<f32>,b:vec2<f32>)->f32{return a.x*b.y-a.y*b.x;}
@compute @workgroup_size(128)
fn cubicMain(@builtin(global_invocation_id) gid:vec3<u32>){
    let i=gid.x;if(i>=info.count){return;}
    let m=segmentMeta[i];let pi=m.z;let r=pathRanges[pi];
    let first=r.x;let n=r.y;let closed=r.z!=0u;
    let aIdx=m.x;let bIdx=m.y;let local=aIdx-first;
    var prevIdx=aIdx;if(local>0u){prevIdx=aIdx-1u;}
    var nextIdx=bIdx;
    if(local+2u<n){nextIdx=bIdx+1u;}else if(closed&&n>1u){nextIdx=first+((local+2u)%n);}
    if(closed&&local==0u&&n>1u){prevIdx=first+n-1u;}
    let p0=points[aIdx].xy;let p3=points[bIdx].xy;
    let prev=points[prevIdx].xy;let next=points[nextIdx].xy;
    let chord=p3-p0;let chordLen=max(length(chord),1e-5);
    let packed=m.w;var hard0=(packed&0x40000000u)!=0u;var hard1=(packed&0x80000000u)!=0u;

    let d0=p0-prev;let d1=next-p3;
    if(closed&&length(d0)>1e-5&&chordLen>1e-5&&dot(normalize(d0),normalize(chord))<0.94){hard0=true;}
    if(closed&&length(d1)>1e-5&&chordLen>1e-5&&dot(normalize(chord),normalize(d1))<0.94){hard1=true;}
    var h0=chord/3.0;var h1=chord/3.0;
    if(!hard0){h0=clampHandle((p3-prev)/6.0,chordLen*0.45);}
    if(!hard1){h1=clampHandle((next-p0)/6.0,chordLen*0.45);}

    let straight0=length(d0)<1e-5||abs(cross2(d0,chord))<=1e-4*max(1.0,length(d0)*chordLen);
    let straight1=length(d1)<1e-5||abs(cross2(chord,d1))<=1e-4*max(1.0,chordLen*length(d1));
    if(straight0&&straight1){h0=chord/3.0;h1=chord/3.0;}
    let c1=p0+h0;let c2=p3-h1;
    cubics[i*2u]=vec4<f32>(p0,c1);
    cubics[i*2u+1u]=vec4<f32>(c2,p3);
}`;

function destroySharedGpuMorphResource(rec){
    if(!rec)return;
    for(const key of ['sourceBuffer','targetBuffer','topologyMetadataBuffer','pathRangeBuffer','segmentMetaBuffer','pathSegmentRangeBuffer','pathIndexBuffer','outputBuffer','uniformBuffer','cubicBuffer','cubicUniformBuffer']){
        try{rec[key]?.destroy?.();}catch(_){}
        rec[key]=null;
    }
    rec.ready=false;
}

function invalidateSharedGpuMorphPathResources(reason='morph-phase'){
    if(typeof invalidateGpuMorphArcResources==='function')invalidateGpuMorphArcResources(reason);
    sharedGpuMorphPathRuntime.phaseSerial=(sharedGpuMorphPathRuntime.phaseSerial+1)>>>0;
    sharedGpuMorphPathRuntime.reason=String(reason||'morph-phase');
    for(const rec of sharedGpuMorphPathRuntime.resources)destroySharedGpuMorphResource(rec);
    sharedGpuMorphPathRuntime.resources=[];
    sharedGpuMorphPathRuntime.whyUnavailable='phase-invalidated';
}

function flattenMorphPlanForGpu(plan){
    const records=plan?.records||[];
    let pointCount=0,pathCount=0,segmentCount=0;
    for(const rec of records)if(rec?.sp&&rec?.dp&&rec.n>0){pointCount+=rec.n;pathCount++;segmentCount+=rec.closed?rec.n:Math.max(0,rec.n-1);}
    const source=new Float32Array(pointCount*4);
    const target=new Float32Array(pointCount*4);
    const pathRanges=new Uint32Array(pathCount*4);
    const topology=new Float32Array(pathCount*4);

    const segmentMeta=new Uint32Array(segmentCount*4); // aPoint,bPoint,pathIndex,packed key flags
    const pathSegmentRanges=new Uint32Array(pathCount*4); // firstSegment,count,firstPoint,pointCount
    const pathIndexData=new Uint32Array(segmentCount);

    const endpointPathLengths=new Float32Array(pathCount*2); // source,target
    let pointWrite=0,pathWrite=0,segmentWrite=0;
    for(const rec of records){
        if(!rec?.sp||!rec?.dp||!(rec.n>0)||!rec.srcXYZ||!rec.dstXYZ)continue;
        const start=pointWrite,segmentStart=segmentWrite,sourceCornerFlags=Array.isArray(rec.sp?.cornerFlags)?rec.sp.cornerFlags:null,targetCornerFlags=Array.isArray(rec.dp?.cornerFlags)?rec.dp.cornerFlags:null;
        for(let i=0;i<rec.n;i++){
            const so=i*3,go=pointWrite*4;
            if(rec.useRadial&&rec.srcPolarAligned&&rec.dstPolarAligned){
                const po=i*2;
                source[go]=rec.srcPolarAligned[po];
                source[go+1]=rec.srcPolarAligned[po+1];
                source[go+2]=rec.srcXYZ[so+2];
                source[go+3]=1;
                target[go]=rec.dstPolarAligned[po];
                target[go+1]=rec.dstPolarAligned[po+1];
                target[go+2]=rec.dstXYZ[so+2];
                target[go+3]=rec.rotates?rec.rotationDelta:0;
            }else{
                source[go]=rec.srcXYZ[so];
                source[go+1]=rec.srcXYZ[so+1];
                source[go+2]=rec.srcXYZ[so+2];
                source[go+3]=0;
                target[go]=rec.dstXYZ[so];
                target[go+1]=rec.dstXYZ[so+1];
                target[go+2]=rec.dstXYZ[so+2];
                target[go+3]=rec.rotates?rec.rotationDelta:0;
            }
            pointWrite++;
        }
        const localSegments=rec.closed?rec.n:Math.max(0,rec.n-1);
        let sourceLen=0,targetLen=0;
        // Segment lengths and metadata refer to the same ordered segment walk.
        // Keep their arithmetic and accumulation order unchanged in one pass.
        for(let si=0;si<localSegments;si++){
            const next=(si+1)%rec.n,mo=segmentWrite*4;
            const sj=si*3,sn=next*3;
            sourceLen+=Math.hypot(rec.srcXYZ[sn]-rec.srcXYZ[sj],rec.srcXYZ[sn+1]-rec.srcXYZ[sj+1]);
            targetLen+=Math.hypot(rec.dstXYZ[sn]-rec.dstXYZ[sj],rec.dstXYZ[sn+1]-rec.dstXYZ[sj+1]);

            const keyStart=Boolean(sourceCornerFlags?.[si]===true||targetCornerFlags?.[si]===true);
            const keyEnd=Boolean(sourceCornerFlags?.[next]===true||targetCornerFlags?.[next]===true);
            const packed=((pathWrite&0x00ffffff)|(keyStart?0x40000000:0)|(keyEnd?0x80000000:0))>>>0;
            segmentMeta[mo]=start+si;segmentMeta[mo+1]=start+next;segmentMeta[mo+2]=pathWrite;segmentMeta[mo+3]=packed;
            pathIndexData[segmentWrite]=packed;segmentWrite++;
        }
        endpointPathLengths[pathWrite*2]=sourceLen;endpointPathLengths[pathWrite*2+1]=targetLen;
        const ro=pathWrite*4;
        pathRanges[ro]=start;pathRanges[ro+1]=rec.n;pathRanges[ro+2]=rec.closed?1:0;pathRanges[ro+3]=pathWrite;
        pathSegmentRanges[ro]=segmentStart;pathSegmentRanges[ro+1]=localSegments;pathSegmentRanges[ro+2]=start;pathSegmentRanges[ro+3]=rec.n;
        topology[ro]=rec.useRadial?1:0;topology[ro+1]=rec.rotates?1:0;topology[ro+2]=Number(rec.referenceOffset)||0;topology[ro+3]=Number(rec.rotationDelta)||0;
        pathWrite++;
    }
    return{source,target,pathRanges,topology,segmentMeta,pathSegmentRanges,pathIndexData,endpointPathLengths,pointCount,pathCount,segmentCount};
}

async function ensureSharedGpuMorphPipeline(){
    if(sharedGpuMorphPathRuntime.pipeline&&sharedGpuMorphPathRuntime.device&&sharedGpuMorphPathRuntime.generation===WebGPUDeviceHub.getGeneration())return true;
    if(sharedGpuMorphPathRuntime.initializing)return sharedGpuMorphPathRuntime.initializing;
    const task=(async()=>{
        try{
            if(typeof WebGPUDeviceHub==='undefined')throw new Error('WebGPUDeviceHub unavailable');
            const shared=await WebGPUDeviceHub.acquire();
            const device=shared.device,generation=shared.generation;
            if(sharedGpuMorphPathRuntime.device!==device||sharedGpuMorphPathRuntime.generation!==generation){
                for(const rec of sharedGpuMorphPathRuntime.resources)destroySharedGpuMorphResource(rec);
                sharedGpuMorphPathRuntime.resources=[];
                sharedGpuMorphPathRuntime.deviceResets=(sharedGpuMorphPathRuntime.deviceResets||0)+1;
                sharedGpuMorphPathRuntime.stats.deviceResets++;
            }
            const module=device.createShaderModule({label:'SpiroStar shared GPU Morph WGSL',code:SHARED_GPU_MORPH_WGSL});
            if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(module,'SpiroStar shared GPU Morph WGSL');
            const bindGroupLayout=device.createBindGroupLayout({label:'SpiroStar shared GPU Morph BGL',entries:[
                {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
                {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
                {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
                {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}
            ]});
            const pipelineLayout=device.createPipelineLayout({label:'SpiroStar shared GPU Morph layout',bindGroupLayouts:[bindGroupLayout]});
            const pipeline=device.createComputePipeline({label:'SpiroStar shared GPU Morph compute',layout:pipelineLayout,compute:{module,entryPoint:'morphMain'}});
            const cubicModule=device.createShaderModule({label:'SpiroStar shared GPU Morph cubic WGSL',code:SHARED_GPU_MORPH_CUBIC_WGSL});
            if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(cubicModule,'SpiroStar shared GPU Morph cubic WGSL');
            const cubicPipeline=device.createComputePipeline({label:'SpiroStar shared GPU Morph cubic compute',layout:'auto',compute:{module:cubicModule,entryPoint:'cubicMain'}});
            sharedGpuMorphPathRuntime.device=device;
            sharedGpuMorphPathRuntime.generation=generation;
            sharedGpuMorphPathRuntime.bindGroupLayout=bindGroupLayout;
            sharedGpuMorphPathRuntime.pipelineLayout=pipelineLayout;
            sharedGpuMorphPathRuntime.pipeline=pipeline;
            sharedGpuMorphPathRuntime.cubicPipeline=cubicPipeline;
            sharedGpuMorphPathRuntime.whyUnavailable='';
            return true;
        }catch(err){
            sharedGpuMorphPathRuntime.whyUnavailable=String(err?.message||err);
            sharedGpuMorphPathRuntime.stats.buildErrors++;
            return false;
        }
    })();
    sharedGpuMorphPathRuntime.initializing=task;
    try{return await task;}finally{if(sharedGpuMorphPathRuntime.initializing===task)sharedGpuMorphPathRuntime.initializing=null;}
}

async function buildSharedGpuMorphResource(layerIndex,plan,phaseSerial){
    if(!plan?.records?.length)return null;
    if(!(await ensureSharedGpuMorphPipeline()))return null;
    if(phaseSerial!==sharedGpuMorphPathRuntime.phaseSerial)return null;
    const device=sharedGpuMorphPathRuntime.device;
    const flat=flattenMorphPlanForGpu(plan);
    if(!flat.pointCount)return null;
    const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
    const make=(label,bytes,use=usage)=>device.createBuffer({label,size:Math.max(16,Math.ceil(bytes/16)*16),usage:use});
    const sourceBuffer=make(`SpiroStar Morph source L${layerIndex}`,flat.source.byteLength);
    const targetBuffer=make(`SpiroStar Morph target L${layerIndex}`,flat.target.byteLength);
    const topologyMetadataBuffer=make(`SpiroStar Morph topology L${layerIndex}`,flat.topology.byteLength);
    const pathRangeBuffer=make(`SpiroStar Morph ranges L${layerIndex}`,flat.pathRanges.byteLength);
    const segmentMetaBuffer=make(`SpiroStar Morph segment metadata L${layerIndex}`,flat.segmentMeta.byteLength);
    const pathSegmentRangeBuffer=make(`SpiroStar Morph segment ranges L${layerIndex}`,flat.pathSegmentRanges.byteLength);
    const pathIndexBuffer=make(`SpiroStar Morph path indices L${layerIndex}`,flat.pathIndexData.byteLength);
    const outputBuffer=make(`SpiroStar Morph output L${layerIndex}`,flat.pointCount*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
    const uniformBuffer=make(`SpiroStar Morph uniform L${layerIndex}`,16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const cubicBuffer=make(`SpiroStar Morph retained cubics L${layerIndex}`,Math.max(1,flat.segmentCount)*32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
    const cubicUniformBuffer=make(`SpiroStar Morph cubic count L${layerIndex}`,16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(cubicUniformBuffer,0,new Uint32Array([flat.segmentCount,0,0,0]));
    device.queue.writeBuffer(sourceBuffer,0,flat.source.buffer,flat.source.byteOffset,flat.source.byteLength);
    device.queue.writeBuffer(targetBuffer,0,flat.target.buffer,flat.target.byteOffset,flat.target.byteLength);
    device.queue.writeBuffer(topologyMetadataBuffer,0,flat.topology.buffer,flat.topology.byteOffset,flat.topology.byteLength);
    device.queue.writeBuffer(pathRangeBuffer,0,flat.pathRanges.buffer,flat.pathRanges.byteOffset,flat.pathRanges.byteLength);
    if(flat.segmentMeta.byteLength)device.queue.writeBuffer(segmentMetaBuffer,0,flat.segmentMeta.buffer,flat.segmentMeta.byteOffset,flat.segmentMeta.byteLength);
    if(flat.pathSegmentRanges.byteLength)device.queue.writeBuffer(pathSegmentRangeBuffer,0,flat.pathSegmentRanges.buffer,flat.pathSegmentRanges.byteOffset,flat.pathSegmentRanges.byteLength);
    if(flat.pathIndexData.byteLength)device.queue.writeBuffer(pathIndexBuffer,0,flat.pathIndexData.buffer,flat.pathIndexData.byteOffset,flat.pathIndexData.byteLength);
    const bindGroup=device.createBindGroup({label:`SpiroStar Morph bind L${layerIndex}`,layout:sharedGpuMorphPathRuntime.bindGroupLayout,entries:[
        {binding:0,resource:{buffer:sourceBuffer}},
        {binding:1,resource:{buffer:targetBuffer}},
        {binding:2,resource:{buffer:outputBuffer}},
        {binding:3,resource:{buffer:uniformBuffer}}
    ]});
    const cubicBindGroup=device.createBindGroup({label:`SpiroStar Morph cubic bind L${layerIndex}`,layout:sharedGpuMorphPathRuntime.cubicPipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:outputBuffer}},
        {binding:1,resource:{buffer:segmentMetaBuffer}},
        {binding:2,resource:{buffer:pathRangeBuffer}},
        {binding:3,resource:{buffer:cubicBuffer}},
        {binding:4,resource:{buffer:cubicUniformBuffer}}
    ]});
    let allClosed=true;const topologySignatureParts=[];
    for(let pi=0;pi<flat.pathCount;pi++){const o=pi*4,n=flat.pathRanges[o+1]>>>0,closed=(flat.pathRanges[o+2]>>>0)!==0;allClosed=allClosed&&closed;topologySignatureParts.push(`${n}:${closed?1:0}`);}
    const rec={
        layerIndex,phaseSerial,generation:sharedGpuMorphPathRuntime.generation,sourceBuffer,targetBuffer,topologyMetadataBuffer,pathRangeBuffer,segmentMetaBuffer,pathSegmentRangeBuffer,pathIndexBuffer,outputBuffer,uniformBuffer,bindGroup,cubicBuffer,cubicUniformBuffer,cubicBindGroup,
        pointCount:flat.pointCount,pathCount:flat.pathCount,segmentCount:flat.segmentCount,topologyMode:plan.radialEnabled?'mixed/radial':'cartesian',
        allClosed,topologySignature:topologySignatureParts.join('|'),cpuPathRanges:flat.pathRanges,cpuPathSegmentRanges:flat.pathSegmentRanges,cpuSegmentMeta:flat.segmentMeta,cpuPathIndexData:flat.pathIndexData,cpuEndpointPathLengths:flat.endpointPathLengths,
        sourceVersion:Number(runtimeState.morph?.lampCycleSerial)||0,targetVersion:Number(runtimeState.morph?.lampCycleSerial)||0,
        sampleBudget:Number(runtimeState.morph?._sampleBudgets?.[layerIndex])||0,
        railVariant:String(plan?.variant||'canonical'),
        exactVisualRail:String(plan?.variant||'canonical')==='stableRounded',
        bezierVisualRail:true,bezierSubdiv:GPU_TOPOLOGY_BEZIER_SUBDIV,
        ready:true,lastT:NaN,lastDispatchFrame:-1,
        hasCommittedData:false,lastCommittedT:NaN,lastCommittedFrame:-1,
        uniformStaging:new ArrayBuffer(16)
    };
    rec.uniformF32=new Float32Array(rec.uniformStaging);rec.uniformU32=new Uint32Array(rec.uniformStaging);
    sharedGpuMorphPathRuntime.stats.phaseUploads++;
    sharedGpuMorphPathRuntime.stats.sourceTargetUploadBytes+=flat.source.byteLength+flat.target.byteLength;
    sharedGpuMorphPathRuntime.stats.pathMetadataUploadBytes+=flat.topology.byteLength+flat.pathRanges.byteLength+flat.segmentMeta.byteLength+flat.pathSegmentRanges.byteLength+flat.pathIndexData.byteLength;
    return rec;
}

async function prepareSharedGpuMorphPathResources(){
    const phaseSerial=sharedGpuMorphPathRuntime.phaseSerial;
    sharedGpuMorphPathRuntime.stats.phaseBuilds++;
    if(state?.morph?.mode==='circleSlide'){
        sharedGpuMorphPathRuntime.whyUnavailable='circle-slide uses angular phase plan; CPU compatibility path remains lazy';
        return [];
    }
    const canonical=runtimeState?.morph?._frameInterpolationPlans||[];
    const plans=canonical.map((plan,index)=>{
        if(!plan)return plan;
        try{
            if(typeof shouldUseStableSmoothRoundedMorph==='function'&&shouldUseStableSmoothRoundedMorph(index)&&
               typeof getStableSmoothRoundedEndpointRails==='function'&&typeof getMorphFrameInterpolationPlan==='function'){
                const src=getStableSmoothRoundedEndpointRails(index,'source');
                const dst=getStableSmoothRoundedEndpointRails(index,'target');
                if(src?.length&&dst?.length)return getMorphFrameInterpolationPlan(index,src,dst,'stableRounded');
            }
        }catch(err){
            sharedGpuMorphPathRuntime.whyUnavailable=`stable visual rail L${index}: ${String(err?.message||err)}`;
        }
        return plan;
    });
    const built=await Promise.all(plans.map((plan,index)=>buildSharedGpuMorphResource(index,plan,phaseSerial)));
    if(phaseSerial!==sharedGpuMorphPathRuntime.phaseSerial)return [];
    sharedGpuMorphPathRuntime.resources=built;
    return built;
}

function getSharedGpuMorphPathResource(layerIndex){
    const rec=sharedGpuMorphPathRuntime.resources?.[layerIndex]||null;
    if(rec?.ready&&rec.phaseSerial===sharedGpuMorphPathRuntime.phaseSerial&&rec.generation===sharedGpuMorphPathRuntime.generation&&sharedGpuMorphPathRuntime.generation===WebGPUDeviceHub.getGeneration()){sharedGpuMorphPathRuntime.stats.resourceHits++;return rec;}
    sharedGpuMorphPathRuntime.stats.resourceMisses++;return null;
}

function writeSharedGpuMorphFrameUniform(rec,t){
    const u=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(t):Math.max(0,Math.min(1,Number(t)||0))),fv=rec.uniformF32||(rec.uniformF32=new Float32Array(rec.uniformStaging||(rec.uniformStaging=new ArrayBuffer(16)))),uv=rec.uniformU32||(rec.uniformU32=new Uint32Array(fv.buffer));
    fv[0]=u;fv[1]=state?.morph?.mode==='calm'?1:0;uv[2]=rec.pointCount;uv[3]=0;
    sharedGpuMorphPathRuntime.device.queue.writeBuffer(rec.uniformBuffer,0,fv.buffer,0,16);
    sharedGpuMorphPathRuntime.stats.frameUniformUpdates++;sharedGpuMorphPathRuntime.stats.uniformAllocationsAvoided++;
    return u;
}
function encodeSharedGpuMorphPath(encoder,layerIndex,t){
    const rec=getSharedGpuMorphPathResource(layerIndex),pipeline=sharedGpuMorphPathRuntime.pipeline;
    if(!rec||!encoder||!pipeline)return null;
    const u=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(t):Math.max(0,Math.min(1,Number(t)||0)));

    if(rec.hasCommittedData&&rec.lastCommittedT===u){
        rec.lastT=u;rec.lastDispatchFrame=Number(renderRuntime?.frameId)||0;
        sharedGpuMorphPathRuntime.stats.committedReuseHits++;return rec;
    }
    writeSharedGpuMorphFrameUniform(rec,u);
    const pass=encoder.beginComputePass({label:`SpiroStar Morph compute pass L${layerIndex}`});
    pass.setPipeline(pipeline);pass.setBindGroup(0,rec.bindGroup);pass.dispatchWorkgroups(Math.ceil(rec.pointCount/128));pass.end();
    if(rec.segmentCount>0&&sharedGpuMorphPathRuntime.cubicPipeline){
        const cubicPass=encoder.beginComputePass({label:`SpiroStar Morph retained cubic pass L${layerIndex}`});
        cubicPass.setPipeline(sharedGpuMorphPathRuntime.cubicPipeline);cubicPass.setBindGroup(0,rec.cubicBindGroup);cubicPass.dispatchWorkgroups(Math.ceil(rec.segmentCount/128));cubicPass.end();
    }
    rec.lastT=u;rec.lastDispatchFrame=Number(renderRuntime?.frameId)||0;sharedGpuMorphPathRuntime.stats.encodedDispatches++;sharedGpuMorphPathRuntime.stats.cpuPointInterpolationsAvoided+=rec.pointCount;return rec;
}
function noteSharedGpuMorphPathSubmitted(recOrLayer,t=null,frameId=null){
    const rec=typeof recOrLayer==='number'?getSharedGpuMorphPathResource(recOrLayer):recOrLayer;
    if(!rec?.ready)return false;
    const u=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(t??rec.lastT):Math.max(0,Math.min(1,Number(t??rec.lastT)||0)));
    rec.hasCommittedData=true;rec.lastCommittedT=u;rec.lastCommittedFrame=Math.max(0,Number(frameId??renderRuntime?.frameId)||0);
    sharedGpuMorphPathRuntime.stats.committedSubmissions++;return true;
}
function buildSharedGpuMorphPrerequisiteCommand(layerIndex,t,frameId=null){
    const rec=getSharedGpuMorphPathResource(layerIndex),device=sharedGpuMorphPathRuntime.device;if(!rec?.ready||!device)return null;
    const u=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(t):Math.max(0,Math.min(1,Number(t)||0))),fid=Math.max(0,Number(frameId??renderRuntime?.frameId)||0);
    if(rec.hasCommittedData&&rec.lastCommittedT===u)return{ready:true,committed:true,rec,t:u,commandBuffer:null,onSubmitted:null};
    try{
        const encoder=device.createCommandEncoder({label:`SpiroStar scheduled Morph prerequisite L${layerIndex}`});
        if(!encodeSharedGpuMorphPath(encoder,layerIndex,u))return null;
        return{ready:true,committed:false,rec,t:u,commandBuffer:encoder.finish(),onSubmitted:()=>noteSharedGpuMorphPathSubmitted(rec,u,fid)};
    }catch(err){sharedGpuMorphPathRuntime.whyUnavailable=String(err?.message||err);return null;}
}
function dispatchSharedGpuMorphPath(layerIndex,t){
    const device=sharedGpuMorphPathRuntime.device;if(!device)return null;
    const encoder=device.createCommandEncoder({label:`SpiroStar Morph compute L${layerIndex}`}),rec=encodeSharedGpuMorphPath(encoder,layerIndex,t);if(!rec)return null;
    device.queue.submit([encoder.finish()]);noteSharedGpuMorphPathSubmitted(rec,t);sharedGpuMorphPathRuntime.stats.dispatches++;return rec;
}

window.__spiroGpuMorphPathStatus=()=>({
    active:sharedGpuMorphPathRuntime.resources.some(r=>r?.ready),
    phaseSerial:sharedGpuMorphPathRuntime.phaseSerial,reason:sharedGpuMorphPathRuntime.reason,
    backend:sharedGpuMorphPathRuntime.pipeline?'webgpu-compute':'cpu/legacy',
    whyGpuMorphUnavailable:sharedGpuMorphPathRuntime.whyUnavailable,
    resources:sharedGpuMorphPathRuntime.resources.map(r=>r?{
        layerIndex:r.layerIndex,ready:r.ready,pointCount:r.pointCount,pathCount:r.pathCount,segmentCount:r.segmentCount,topologyMode:r.topologyMode,
        sampleBudget:r.sampleBudget,railVariant:r.railVariant,exactVisualRail:r.exactVisualRail===true,bezierVisualRail:r.bezierVisualRail===true,bezierSubdiv:r.bezierSubdiv,phaseSerial:r.phaseSerial,lastT:r.lastT,lastDispatchFrame:r.lastDispatchFrame,hasCommittedData:r.hasCommittedData,lastCommittedT:r.lastCommittedT,lastCommittedFrame:r.lastCommittedFrame
    }:null),
    stats:{...sharedGpuMorphPathRuntime.stats}
});
