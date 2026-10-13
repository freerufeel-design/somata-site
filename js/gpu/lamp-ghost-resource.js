

window.__spiroRegisterModule?.('js/gpu/lamp-ghost-resource');

const GPU_LAMP_GHOST_MAX=260;
const gpuLampGhostRuntime={
    resources:new WeakMap(),resourceSet:new Set(),eligibility:new WeakMap(),device:null,generation:-1,lastError:'',
    stats:{requests:0,builds:0,hits:0,phasePointVisits:0,envelopeLines:0,envelopeSegments:0,frameEvaluations:0,
        nearestKeyScansAvoided:0,cpuPathBuildsAvoided:0,gpuUploads:0,gpuUploadBytes:0,fallbacks:0}
};

function gpuLampGhostSamplePath(path,fraction){
    const pts=path?.points||[],n=pts.length;if(!n)return null;if(n===1)return{x:Number(pts[0]?.x)||0,y:Number(pts[0]?.y)||0};
    let f=Number(fraction)||0;if(path?.closed){f=((f%1)+1)%1;const z=f*n,i0=Math.floor(z)%n,i1=(i0+1)%n,u=z-Math.floor(z),a=pts[i0],b=pts[i1];return{x:(Number(a?.x)||0)+((Number(b?.x)||0)-(Number(a?.x)||0))*u,y:(Number(a?.y)||0)+((Number(b?.y)||0)-(Number(a?.y)||0))*u};}
    f=Math.max(0,Math.min(1,f));if(f>=1-1e-15){const p=pts[n-1];return{x:Number(p?.x)||0,y:Number(p?.y)||0};}const z=f*(n-1),i0=Math.min(n-2,Math.floor(z)),i1=i0+1,u=z-i0,a=pts[i0],b=pts[i1];return{x:(Number(a?.x)||0)+((Number(b?.x)||0)-(Number(a?.x)||0))*u,y:(Number(a?.y)||0)+((Number(b?.y)||0)-(Number(a?.y)||0))*u};
}
function gpuLampGhostSamplePackedXYZ(xyz,n,closed,fraction){
    if(!(xyz instanceof Float64Array)||n<=0)return null;if(n===1)return{x:xyz[0],y:xyz[1]};let f=Number(fraction)||0;
    if(closed){f=((f%1)+1)%1;const z=f*n,i0=Math.floor(z)%n,i1=(i0+1)%n,u=z-Math.floor(z),a=i0*3,b=i1*3;return{x:xyz[a]+(xyz[b]-xyz[a])*u,y:xyz[a+1]+(xyz[b+1]-xyz[a+1])*u};}
    f=Math.max(0,Math.min(1,f));if(f>=1-1e-15){const o=(n-1)*3;return{x:xyz[o],y:xyz[o+1]};}const z=f*(n-1),i0=Math.min(n-2,Math.floor(z)),i1=i0+1,u=z-i0,a=i0*3,b=i1*3;return{x:xyz[a]+(xyz[b]-xyz[a])*u,y:xyz[a+1]+(xyz[b+1]-xyz[a+1])*u};
}
function gpuLampGhostNearestDistance(point,keys){
    if(!point||!Array.isArray(keys)||!keys.length)return Infinity;const x=Number(point.x)||0,y=Number(point.y)||0;let best=Infinity;
    for(const p of keys){const dx=x-(Number(p?.x)||0),dy=y-(Number(p?.y)||0),d=dx*dx+dy*dy;if(d<best)best=d;}
    return Number.isFinite(best)?Math.sqrt(best):Infinity;
}

function buildGpuLampGhostReceiverEnvelope(p0,p1,keys){
    const list=Array.isArray(keys)?keys:[];if(!p0||!p1||!list.length)return[];const vx=(Number(p1.x)||0)-(Number(p0.x)||0),vy=(Number(p1.y)||0)-(Number(p0.y)||0),px=Number(p0.x)||0,py=Number(p0.y)||0,lines=[];
    for(let i=0;i<list.length;i++){const q=list[i],x=Number(q?.x)||0,y=Number(q?.y)||0;lines.push({m:-2*(vx*x+vy*y),b:x*x+y*y-2*(px*x+py*y),x,y,index:i});}
    lines.sort((a,b)=>b.m-a.m||a.b-b.b||a.index-b.index);const unique=[];
    for(const l of lines){const last=unique[unique.length-1];if(last&&Math.abs(last.m-l.m)<=1e-12*Math.max(1,Math.abs(last.m),Math.abs(l.m))){if(l.b<last.b-1e-12||(Math.abs(l.b-last.b)<=1e-12&&l.index<last.index))unique[unique.length-1]=l;}else unique.push(l);}
    const hull=[],starts=[];
    for(const line of unique){let start=-Infinity;while(hull.length){const prev=hull[hull.length-1],den=prev.m-line.m;start=Math.abs(den)<=1e-20?(line.b<prev.b?-Infinity:Infinity):(line.b-prev.b)/den;if(start<=starts[starts.length-1]+1e-12){hull.pop();starts.pop();continue;}break;}if(!hull.length)start=-Infinity;hull.push(line);starts.push(start);}
    const out=[];for(let i=0;i<hull.length;i++){const from=Math.max(0,starts[i]),to=Math.min(1,i+1<hull.length?starts[i+1]:Infinity);if(to>=0&&from<=1&&to>=from-1e-12)out.push({from,to,x:hull[i].x,y:hull[i].y,index:hull[i].index});}
    gpuLampGhostRuntime.stats.envelopeLines+=list.length;gpuLampGhostRuntime.stats.envelopeSegments+=out.length;return out;
}
function gpuLampGhostEnvelopeReceiver(envelope,t){
    const e=Array.isArray(envelope)?envelope:[];if(!e.length)return null;const u=Math.max(0,Math.min(1,Number(t)||0));let lo=0,hi=e.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(e[mid].from<=u+1e-12)lo=mid;else hi=mid-1;}return e[lo]||e[0];
}
function gpuLampGhostEnvelopeDistance(envelope,t,point){const r=gpuLampGhostEnvelopeReceiver(envelope,t);return r?Math.hypot((Number(point?.x)||0)-r.x,(Number(point?.y)||0)-r.y):Infinity;}

function gpuLampGhostPlanForFrame(frameCtx){
    const li=Number(frameCtx?.layerIndex)||0,srcGeom=runtimeState?.morph?.sourceGeometry?.[li]||[],dstGeom=runtimeState?.morph?.targetGeometry?.[li]||[];if(!srcGeom.length||!dstGeom.length||typeof getMorphFrameInterpolationPlan!=='function')return null;
    const plan=getMorphFrameInterpolationPlan(li,srcGeom,dstGeom,'canonical');if(!plan?.records?.length)return null;return plan;
}
function gpuMorphGhostLampIneligibleReason(frameCtx){
    if(!frameCtx?.layer)return'no-frame';if(!frameCtx.morphFrameActive||frameCtx.greenMorphEnabled||frameCtx.minimalFadeEnabled)return'not-blue-topology-morph';if(frameCtx.blueMorphProvider?.mode==='fade')return'fade-provider';if(!['topology','calm'].includes(state?.morph?.mode))return'morph-mode-needs-compat';
    if(typeof gpuMorphLampPositionMode==='function'&&gpuMorphLampPositionMode(frameCtx)!=='key')return'not-key-lamps';const cfg=frameCtx.layerLampConfig||ensureLayerLampState?.(frameCtx.layer)||state.lamps||{};if((cfg?.morphMotionMode||'linear')!=='ghost')return'not-ghost-motion';
    if(typeof gpuMorphArcIneligibleReason==='function'){const r=gpuMorphArcIneligibleReason(frameCtx);if(r)return r;}
    const plan=gpuLampGhostPlanForFrame(frameCtx);if(!plan)return'phase-plan-unavailable';const active=plan.records.filter(r=>r?.sp&&r?.dp&&r.n>1);if(!active.length)return'no-phase-paths';

    if(active.some(r=>r.useRadial||r.rotates))return'nonlinear-ghost-trajectory';

    const layer=frameCtx.layer,serial=Math.max(0,Number(runtimeState?.morph?.lampCycleSerial)||0),planSerial=Number(plan.serial)||0,hit=gpuLampGhostRuntime.eligibility.get(layer);
    if(hit&&hit.serial===serial&&hit.planSerial===planSerial)return hit.reason;
    let reason='';try{const li=frameCtx.layerIndex,base=layer,src=runtimeState.morph.renderSourceLayers?.[li]||{...base,...(runtimeState.morph.sourceVisuals?.[li]||{})},dst=runtimeState.morph.renderTargetLayers?.[li]||{...base,...(runtimeState.morph.targetVisuals?.[li]||{})},anchors=pairMorphPaths(buildTopologyLampAnchorPaths(src),buildTopologyLampAnchorPaths(dst));if(anchors.length!==active.length)reason='profile-layout-needs-compat';}catch(_){reason='anchor-layout-unavailable';}
    gpuLampGhostRuntime.eligibility.set(layer,{serial,planSerial,reason});return reason;
}
function canUseGpuMorphGhostLampsFrame(frameCtx){return gpuMorphGhostLampIneligibleReason(frameCtx)==='';}

function destroyGpuLampGhostResource(rec){if(!rec)return;try{rec.gpuBuffer?.destroy?.();}catch(_){}rec.gpuBuffer=null;rec.gpuReady=false;}
function buildGpuLampGhostResource(frameCtx,maxPoints=GPU_LAMP_GHOST_MAX){
    const layer=frameCtx?.layer;if(!layer)return null;const serial=Math.max(0,Number(runtimeState?.morph?.lampCycleSerial)||0),plan=gpuLampGhostPlanForFrame(frameCtx);if(!plan)return null;let hit=gpuLampGhostRuntime.resources.get(layer);
    if(hit&&hit.serial===serial&&hit.maxPoints===maxPoints&&hit.planSerial===plan.serial){gpuLampGhostRuntime.stats.hits++;return hit;}if(hit)destroyGpuLampGhostResource(hit);
    const all=[],layerKey=String(layer?.id||frameCtx.layerIndex),records=plan.records.filter(r=>r?.sp&&r?.dp&&r.n>1);let pathIndex=0;
    for(const rec of records){const sp=rec.sp,dp=rec.dp,sourceCount=sp?.points?.length||0,targetCount=dp?.points?.length||0;if(!sourceCount||!targetCount){pathIndex++;continue;}const slots=buildLampTopologyPhaseSlots(sourceCount,targetCount,rec.closed),sourceKeys=sp.points||[],targetKeys=dp.points||[];
        for(const slot of slots){const f=slot.fraction,p0=gpuLampGhostSamplePackedXYZ(rec.srcXYZ,rec.n,rec.closed,f),p1=gpuLampGhostSamplePackedXYZ(rec.dstXYZ,rec.n,rec.closed,f),sourcePoint=gpuLampGhostSamplePath(sp,f),targetPoint=gpuLampGhostSamplePath(dp,f);if(!p0||!p1||!sourcePoint||!targetPoint)continue;const phaseKey=Math.round(f*1000000);all.push({pathIndex,vertexIndex:all.length,fraction:f,p0,p1,sourcePoint,targetPoint,sourcePresent:slot.sourcePresent===true,targetPresent:slot.targetPresent===true,sourceKeys,targetKeys,lampId:`geom:${pathIndex}:${phaseKey}`,lampSeed:lampHash32(`${layerKey}:geom:${pathIndex}:${phaseKey}`)});}
        pathIndex++;
    }
    gpuLampGhostRuntime.stats.phasePointVisits+=all.length;const selected=capGpuLampTopologyRecords(all,maxPoints);if(!selected.length)return null;
    for(let i=0;i<selected.length;i++){const r=selected[i];r.identityIndex=i;if(!r.sourcePresent&&r.targetPresent){r.referenceDistance=gpuLampGhostNearestDistance(r.sourcePoint,r.targetKeys);r.receiverEnvelope=buildGpuLampGhostReceiverEnvelope(r.p0,r.p1,r.targetKeys);}else if(r.sourcePresent&&!r.targetPresent){r.referenceDistance=gpuLampGhostNearestDistance(r.targetPoint,r.sourceKeys);r.receiverEnvelope=buildGpuLampGhostReceiverEnvelope(r.p0,r.p1,r.sourceKeys);}else{r.referenceDistance=0;r.receiverEnvelope=[];}delete r.sourceKeys;delete r.targetKeys;}
    const flat=new Float32Array(selected.length*12);for(let i=0;i<selected.length;i++){const r=selected[i],o=i*12;flat[o]=r.p0.x;flat[o+1]=r.p0.y;flat[o+2]=r.p1.x;flat[o+3]=r.p1.y;flat[o+4]=0;flat[o+5]=0;flat[o+6]=r.sourcePresent?1:0;flat[o+7]=r.targetPresent?1:0;flat[o+8]=r.pathIndex;flat[o+9]=r.vertexIndex;flat[o+10]=0;flat[o+11]=0;}
    hit={layer,layerIndex:frameCtx.layerIndex,serial,planSerial:plan.serial,maxPoints,records:selected,flat,count:selected.length,gpuBuffer:null,gpuGeneration:-1,gpuReady:false};gpuLampGhostRuntime.resources.set(layer,hit);gpuLampGhostRuntime.resourceSet.add(hit);gpuLampGhostRuntime.stats.builds++;void ensureGpuLampGhostBuffer(hit);return hit;
}
async function ensureGpuLampGhostBuffer(rec){
    if(!rec?.flat?.length||typeof WebGPUDeviceHub==='undefined')return false;const gen=WebGPUDeviceHub.getGeneration?.()??-1;if(rec.gpuReady&&rec.gpuBuffer&&rec.gpuGeneration===gen)return true;
    try{const shared=await WebGPUDeviceHub.acquire(),device=shared.device;if(rec.gpuBuffer)try{rec.gpuBuffer.destroy();}catch(_){}rec.gpuBuffer=device.createBuffer({label:`Spiro Ghost lamp identity L${rec.layerIndex}`,size:Math.max(16,Math.ceil(rec.flat.byteLength/16)*16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(rec.gpuBuffer,0,rec.flat.buffer,rec.flat.byteOffset,rec.flat.byteLength);rec.gpuGeneration=shared.generation;rec.gpuReady=true;gpuLampGhostRuntime.device=device;gpuLampGhostRuntime.generation=shared.generation;gpuLampGhostRuntime.stats.gpuUploads++;gpuLampGhostRuntime.stats.gpuUploadBytes+=rec.flat.byteLength;return true;}catch(err){gpuLampGhostRuntime.lastError=String(err?.message||err);rec.gpuReady=false;return false;}
}
function evaluateGpuLampGhostResource(rec,t){
    if(!rec?.records?.length)return[];const u=Math.max(0,Math.min(1,Number(t)||0)),out=new Array(rec.records.length);
    for(let i=0;i<rec.records.length;i++){const r=rec.records[i],x=r.p0.x+(r.p1.x-r.p0.x)*u,y=r.p0.y+(r.p1.y-r.p0.y)*u,p={x,y},travel=lampEndpointTravelProgress(r.sourcePoint.x,r.sourcePoint.y,x,y,r.targetPoint.x,r.targetPoint.y,u);let presence=0;
        if(r.sourcePresent&&r.targetPresent)presence=1;else if(!r.sourcePresent&&r.targetPresent){const ref=Number(r.referenceDistance);if(!Number.isFinite(ref))presence=travel;else if(ref<=1e-6)presence=1;else presence=Math.max(0,Math.min(1,1-gpuLampGhostEnvelopeDistance(r.receiverEnvelope,u,p)/ref));}
        else if(r.sourcePresent&&!r.targetPresent){const ref=Number(r.referenceDistance);if(!Number.isFinite(ref))presence=1-travel;else if(ref<=1e-6)presence=1-travel;else presence=Math.max(0,Math.min(1,1-gpuLampGhostEnvelopeDistance(r.receiverEnvelope,u,p)/ref));}
        out[i]={x,y,gpuLampBaseX:x,gpuLampBaseY:y,lampIdentityIndex:r.identityIndex,pathIndex:r.pathIndex,vertexIndex:r.vertexIndex,lampPresence:presence,lampNearestKeyPresence:presence,lampTravelProgress:travel,lampSourcePresent:r.sourcePresent,lampTargetPresent:r.targetPresent,lampId:r.lampId,lampSeed:r.lampSeed};
    }
    gpuLampGhostRuntime.stats.frameEvaluations+=out.length;gpuLampGhostRuntime.stats.nearestKeyScansAvoided+=out.length;return out;
}
function prepareGpuMorphGhostLampFrame(frameCtx,maxPoints=GPU_LAMP_GHOST_MAX){
    gpuLampGhostRuntime.stats.requests++;const reason=gpuMorphGhostLampIneligibleReason(frameCtx);if(reason){gpuLampGhostRuntime.stats.fallbacks++;gpuLampGhostRuntime.lastError=reason;return null;}const rec=buildGpuLampGhostResource(frameCtx,maxPoints);if(!rec)return null;void ensureGpuLampGhostBuffer(rec);const t=Math.max(0,Math.min(1,Number(frameCtx.blueMorphProvider?.geometryT)||0));let points=evaluateGpuLampGhostResource(rec,t);

    if(typeof dedupeLampPoints==='function')points=dedupeLampPoints(points,maxPoints);
    points=preserveBlueMorphLampIdentity(frameCtx.layerIndex,points);if(!points.length)return null;gpuLampGhostRuntime.stats.cpuPathBuildsAvoided++;return{gpuLampNative:true,gpuLampNativeKind:rec.gpuReady?'topology-ghost':'bounded-ghost',gpuLampTopologyResource:rec,gpuMorphT:t,frameId:Number(frameCtx.frameId)||0,attachmentPoints:points,attachmentCount:points.length};
}
window.__spiroGpuLampGhostStatus=()=>({generation:gpuLampGhostRuntime.generation,lastError:gpuLampGhostRuntime.lastError,stats:{...gpuLampGhostRuntime.stats},resources:[...gpuLampGhostRuntime.resourceSet].map(r=>({layerIndex:r.layerIndex,serial:r.serial,count:r.count,gpuReady:r.gpuReady,envelopeSegments:r.records.reduce((n,x)=>n+(x.receiverEnvelope?.length||0),0)})),contract:'Cartesian Topology/Calm Ghost lamps use exact phase-built nearest-key lower envelopes. Display work is bounded <=260 and never materializes the CPU Morph path; radial/rotating trajectories retain exact compatibility fallback.'});
