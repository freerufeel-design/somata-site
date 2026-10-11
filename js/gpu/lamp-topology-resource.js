// SpiroStar v520 — phase-resident Lamp Topology Identity Resource
// Key lamps no longer rediscover the full Morph polygon every display frame.  One immutable
// physical-lamp lineage is built per Morph phase, capped to the historical display population,
// then evaluated in O(lamps<=260).  Dynamic/Smooth key positions can additionally be evaluated
// directly by the Lamp WGSL from a resident endpoint buffer.  True Linear keeps its historical
// split/merge gates on the CPU control plane, but no longer performs an O(N) path traversal/frame.
window.__spiroRegisterModule?.('js/gpu/lamp-topology-resource');

const GPU_LAMP_TOPOLOGY_MAX=260;
const gpuLampTopologyRuntime={
    resources:new WeakMap(),resourceSet:new Set(),device:null,generation:-1,initializing:null,lastError:'',
    stats:{requests:0,builds:0,hits:0,phasePointVisits:0,frameEvaluations:0,cpuPathBuildsAvoided:0,gpuUploads:0,gpuUploadBytes:0,gpuEvaluableFrames:0,linearBoundedFrames:0,deviceResets:0}
};

function capGpuLampTopologyRecords(records,maxPoints=GPU_LAMP_TOPOLOGY_MAX){
    if(!Array.isArray(records)||records.length<=maxPoints)return records||[];
    const out=[],step=records.length/maxPoints;for(let i=0;i<maxPoints;i++)out.push(records[Math.floor(i*step)]);return out;
}
function gpuLampTopologyPhaseSerial(){return Math.max(0,Number(runtimeState?.morph?.lampCycleSerial)||0);}
function gpuLampTopologyRotatePoint(p,angle){const c=Math.cos(angle),s=Math.sin(angle),x=Number(p?.x)||0,y=Number(p?.y)||0;return{x:x*c-y*s,y:x*s+y*c};}
function gpuLampTopologyInterpolateRecord(rec,u){
    u=Math.max(0,Math.min(1,Number(u)||0));const sp=rec.sourcePoint||{x:0,y:0};
    const mt=gpuLampTopologyRotatePoint(rec.morphTargetPoint||rec.targetPoint||sp,(Number(rec.rotationDelta)||0)*(1-u));
    let x=0,y=0;
    if(rec.useRadial){
        const sr=Math.hypot(Number(sp.x)||0,Number(sp.y)||0),tr=Math.hypot(Number(mt.x)||0,Number(mt.y)||0),sa=Math.atan2(Number(sp.y)||0,Number(sp.x)||0),ta=Math.atan2(Number(mt.y)||0,Number(mt.x)||0);
        let delta=ta-sa;if(state?.morph?.mode==='calm')delta=Math.max(-Math.PI*4,Math.min(Math.PI*4,delta));const rr=sr+(tr-sr)*u,aa=sa+delta*u;x=rr*Math.cos(aa);y=rr*Math.sin(aa);
    }else{x=(Number(sp.x)||0)+((Number(mt.x)||0)-(Number(sp.x)||0))*u;y=(Number(sp.y)||0)+((Number(mt.y)||0)-(Number(sp.y)||0))*u;}
    return{x,y};
}

function buildGpuLampOrdinaryKeyRecords(frameCtx,maxPoints=GPU_LAMP_TOPOLOGY_MAX){
    const layerIndex=frameCtx.layerIndex,base=frameCtx.layer,src=runtimeState.morph.renderSourceLayers?.[layerIndex]||{...base,...(runtimeState.morph.sourceVisuals?.[layerIndex]||{})},dst=runtimeState.morph.renderTargetLayers?.[layerIndex]||{...base,...(runtimeState.morph.targetVisuals?.[layerIndex]||{})};
    if(!src||!dst)return[];const srcPaths=buildTopologyLampAnchorPaths(src),dstPaths=buildTopologyLampAnchorPaths(dst);if(!srcPaths.length||!dstPaths.length)return[];
    const pairs=pairMorphPaths(srcPaths,dstPaths),radial=Boolean(state.morph.options.byVertices||state.morph.options.bySteps||state.morph.monoOrbitTransforms),chaosCalm=state.morph.mode==='calm'&&isChaosCircleMorphPair(layerIndex),all=[];
    for(let pathIndex=0;pathIndex<pairs.length;pathIndex++){
        const pair=pairs[pathIndex],sp=pair.src,dp=pair.dst;if(!sp&&!dp)continue;
        if(sp&&dp){
            const srcPts=sp.points||[],dstPts=dp.points||[];if(!srcPts.length||!dstPts.length)continue;const n=Math.max(srcPts.length,dstPts.length),closed=Boolean(sp.closed&&dp.closed),referenceOffset=getMorphReferenceVertexOffset(pair,dstPts.length,closed,dst?.N||src?.N||base?.N),rotationDelta=(pair.radialMerge||pair.radialSplit)?signedAngleDelta(pathReferenceAngle(dp),pathReferenceAngle(sp)):0,useRadial=closed&&(chaosCalm||(radial&&(pair.radialMerge||pair.radialSplit)));
            for(let i=0;i<n;i++){
                const sourcePathPresent=pair.sourcePathPresent!==false,targetPathPresent=pair.targetPathPresent!==false,sourcePresent=sourcePathPresent&&i<srcPts.length,targetPresent=targetPathPresent&&i<dstPts.length,di=((i+referenceOffset)%dstPts.length+dstPts.length)%dstPts.length;
                const sourcePoint=sourcePresent?srcPts[i]:sampleLampClosedAnchor(srcPts,dstPts.length?di/dstPts.length:i/Math.max(1,n));
                const targetPoint=targetPresent?dstPts[di]:sampleLampClosedAnchor(dstPts,srcPts.length?i/srcPts.length:i/Math.max(1,n));
                all.push({kind:'topology',pathIndex,vertexIndex:i,sourcePoint:{x:Number(sourcePoint?.x)||0,y:Number(sourcePoint?.y)||0},targetPoint:{x:Number(targetPoint?.x)||0,y:Number(targetPoint?.y)||0},morphTargetPoint:{x:Number(targetPoint?.x)||0,y:Number(targetPoint?.y)||0},rotationDelta,useRadial,sourcePresent,targetPresent,lampId:`key:${pathIndex}:${i}`,lampSeed:lampHash32(`${base?.id||layerIndex}:key:${pathIndex}:${i}`)});
            }
        }else{
            const pts=(sp||dp)?.points||[],sourcePresent=Boolean(sp)&&pair.sourcePathPresent!==false,targetPresent=Boolean(dp)&&pair.targetPathPresent!==false;
            for(let i=0;i<pts.length;i++){const p=pts[i];all.push({kind:'topology',pathIndex,vertexIndex:i,sourcePoint:{x:Number(p?.x)||0,y:Number(p?.y)||0},targetPoint:{x:Number(p?.x)||0,y:Number(p?.y)||0},morphTargetPoint:{x:Number(p?.x)||0,y:Number(p?.y)||0},rotationDelta:0,useRadial:false,sourcePresent,targetPresent,lampId:`key:${pathIndex}:${i}`,lampSeed:lampHash32(`${base?.id||layerIndex}:key:${pathIndex}:${i}`)});}
        }
    }
    gpuLampTopologyRuntime.stats.phasePointVisits+=all.length;return capGpuLampTopologyRecords(all,maxPoints);
}

function buildGpuLampLinearKeyRecords(frameCtx,maxPoints=GPU_LAMP_TOPOLOGY_MAX){
    const layerIndex=frameCtx.layerIndex,base=frameCtx.layer,src=runtimeState.morph.renderSourceLayers?.[layerIndex]||{...base,...(runtimeState.morph.sourceVisuals?.[layerIndex]||{})},dst=runtimeState.morph.renderTargetLayers?.[layerIndex]||{...base,...(runtimeState.morph.targetVisuals?.[layerIndex]||{})};if(!base||!src||!dst)return[];
    const layerKey=String(base?.id||layerIndex),plan=getStableTopologyLinearLampPlan(layerIndex,src,dst,base,layerKey);if(!plan?.paths?.length)return[];
    const radial=Boolean(state.morph.options.byVertices||state.morph.options.bySteps||state.morph.monoOrbitTransforms),chaosCalm=state.morph.mode==='calm'&&isChaosCircleMorphPair(layerIndex),all=[];
    for(const pathRec of plan.paths){
        const {pathIndex,dp,srcPts,finalDstPts,alignedFinal,lineage,referenceOffset,closed,sourceKeys,targetKeys,sourceAttachFractions,targetAttachFractions,sourceAttachPoints,targetAttachPoints,sourceAttachSegmentRefs,targetAttachSegmentRefs,sourceAttachRenderParams,targetAttachRenderParams}=pathRec;
        const rotationDelta=(pathRec.radialMerge||pathRec.radialSplit)?signedAngleDelta(pathRec.targetReferenceAngle,pathRec.sourceReferenceAngle):0,useRadial=closed&&(chaosCalm||(radial&&(pathRec.radialMerge||pathRec.radialSplit)));
        for(let i=0;i<lineage.length;i++){
            const slot=lineage[i],si=Math.max(0,slot.sourceIndex),ti=Math.max(0,slot.targetIndex),sourcePoint=sourceKeys[si],targetPoint=targetKeys[ti];if(!sourcePoint||!targetPoint)continue;
            const morphTargetPoint=alignedFinal[ti]||targetPoint;let sourceAttach=Number(sourceAttachFractions?.[si]),targetAttach=Number(targetAttachFractions?.[ti]);if(!Number.isFinite(sourceAttach))sourceAttach=closed?si/Math.max(1,sourceKeys.length):(sourceKeys.length<=1?0:si/(sourceKeys.length-1));if(!Number.isFinite(targetAttach))targetAttach=closed?ti/Math.max(1,targetKeys.length):(targetKeys.length<=1?0:ti/(targetKeys.length-1));
            all.push({kind:'linear',pathIndex,vertexIndex:i,slotIndex:i,sourcePoint:{x:Number(sourcePoint.x)||0,y:Number(sourcePoint.y)||0},targetPoint:{x:Number(targetPoint.x)||0,y:Number(targetPoint.y)||0},morphTargetPoint:{x:Number(morphTargetPoint.x)||0,y:Number(morphTargetPoint.y)||0},rotationDelta,useRadial,closed,sourcePresent:pathRec.sourcePathPresent&&slot.sourcePresent,targetPresent:pathRec.targetPathPresent&&slot.targetPresent,sourceAttach,targetAttach,sourceAttachPoint:sourceAttachPoints?.[si]||sourcePoint,targetAttachPoint:targetAttachPoints?.[ti]||targetPoint,sourceSegmentRef:sourceAttachSegmentRefs?.[si]||null,targetSegmentRef:targetAttachSegmentRefs?.[ti]||null,sourceRenderParam:sourceAttachRenderParams?.[si],targetRenderParam:targetAttachRenderParams?.[ti],sourceKeys,targetKeys,layerKey,stableGateKey:`topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`,lampId:`linear:topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`,lampSeed:lampHash32(`${layerKey}:linear:topo:${pathIndex}:${slot.sourceIndex}->${slot.targetIndex}:${i}`)});
        }
    }
    gpuLampTopologyRuntime.stats.phasePointVisits+=all.length;return capGpuLampTopologyRecords(all,maxPoints);
}

function buildGpuLampTopologyResource(frameCtx,maxPoints=GPU_LAMP_TOPOLOGY_MAX){
    const layer=frameCtx?.layer;if(!layer)return null;const serial=gpuLampTopologyPhaseSerial(),motion=(frameCtx?.layerLampConfig||ensureLayerLampState?.(layer)||state.lamps||{}).morphMotionMode||'linear';let hit=gpuLampTopologyRuntime.resources.get(layer);
    if(hit&&hit.serial===serial&&hit.motion===motion&&hit.maxPoints===maxPoints){gpuLampTopologyRuntime.stats.hits++;return hit;}
    const records=motion==='linear'?buildGpuLampLinearKeyRecords(frameCtx,maxPoints):buildGpuLampOrdinaryKeyRecords(frameCtx,maxPoints);if(!records.length)return null;
    const flat=new Float32Array(records.length*12);for(let i=0;i<records.length;i++){const r=records[i],o=i*12;flat[o]=r.sourcePoint.x;flat[o+1]=r.sourcePoint.y;flat[o+2]=r.morphTargetPoint.x;flat[o+3]=r.morphTargetPoint.y;flat[o+4]=r.rotationDelta;flat[o+5]=r.useRadial?1:0;flat[o+6]=r.sourcePresent?1:0;flat[o+7]=r.targetPresent?1:0;flat[o+8]=r.pathIndex;flat[o+9]=r.vertexIndex;flat[o+10]=0;flat[o+11]=0;r.identityIndex=i;}
    hit={layer,layerIndex:frameCtx.layerIndex,serial,motion,maxPoints,records,flat,count:records.length,gpuBuffer:null,gpuGeneration:-1,gpuReady:false};gpuLampTopologyRuntime.resources.set(layer,hit);gpuLampTopologyRuntime.resourceSet.add(hit);gpuLampTopologyRuntime.stats.builds++;void ensureGpuLampTopologyBuffer(hit);return hit;
}
async function ensureGpuLampTopologyBuffer(rec){
    if(!rec?.flat?.length||typeof WebGPUDeviceHub==='undefined')return false;const gen=WebGPUDeviceHub.getGeneration?.()??-1;if(rec.gpuReady&&rec.gpuBuffer&&rec.gpuGeneration===gen)return true;
    try{const shared=await WebGPUDeviceHub.acquire(),device=shared.device;if(rec.gpuBuffer)try{rec.gpuBuffer.destroy();}catch(_){}rec.gpuBuffer=device.createBuffer({label:`Spiro Lamp topology identity L${rec.layerIndex}`,size:Math.max(16,Math.ceil(rec.flat.byteLength/16)*16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(rec.gpuBuffer,0,rec.flat.buffer,rec.flat.byteOffset,rec.flat.byteLength);rec.gpuGeneration=shared.generation;rec.gpuReady=true;gpuLampTopologyRuntime.device=device;gpuLampTopologyRuntime.generation=shared.generation;gpuLampTopologyRuntime.stats.gpuUploads++;gpuLampTopologyRuntime.stats.gpuUploadBytes+=rec.flat.byteLength;return true;}catch(err){gpuLampTopologyRuntime.lastError=String(err?.message||err);rec.gpuReady=false;return false;}
}
function evaluateGpuLampTopologyResource(rec,t){
    if(!rec?.records?.length)return[];const u=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(t):Math.max(0,Math.min(1,Number(t)||0))),out=new Array(rec.records.length);
    for(let i=0;i<rec.records.length;i++){
        const r=rec.records[i];let pos;
        if(r.kind==='linear'){
            const fixed=isLampContourAttachmentEnabled?.()?interpolateLampSegmentRefs(r.sourceSegmentRef,r.targetSegmentRef,u,r.sourceAttachPoint||r.sourcePoint,r.targetAttachPoint||r.targetPoint):null;pos=fixed?{x:Number(fixed.x)||0,y:Number(fixed.y)||0}:gpuLampTopologyInterpolateRecord(r,u);
            let delta=r.targetAttach-r.sourceAttach;if(r.closed)delta=((delta+.5)%1+1)%1-.5;let attach=r.sourceAttach+delta*u;attach=r.closed?((attach%1)+1)%1:Math.max(0,Math.min(1,attach));
            const presence=lampLinearSplitMergePresence(r.sourcePresent,r.targetPresent,pos,r.sourcePoint,r.targetPoint,r.sourceKeys,r.targetKeys,u,r.layerKey,r.stableGateKey);
            out[i]={x:pos.x,y:pos.y,gpuLampBaseX:pos.x,gpuLampBaseY:pos.y,lampIdentityIndex:r.identityIndex,pathIndex:r.pathIndex,vertexIndex:r.vertexIndex,lampPresence:presence,lampTravelProgress:u,lampSourcePresent:r.sourcePresent,lampTargetPresent:r.targetPresent,lampAttachFraction:attach,lampId:r.lampId,lampSeed:r.lampSeed};
        }else{
            pos=gpuLampTopologyInterpolateRecord(r,u);out[i]={x:pos.x,y:pos.y,gpuLampBaseX:pos.x,gpuLampBaseY:pos.y,lampIdentityIndex:r.identityIndex,pathIndex:r.pathIndex,vertexIndex:r.vertexIndex,lampPresence:lampTopologyPresence(r.sourcePresent,r.targetPresent,u),lampTravelProgress:u,lampSourcePresent:r.sourcePresent,lampTargetPresent:r.targetPresent,lampId:r.lampId,lampSeed:r.lampSeed};
        }
    }
    gpuLampTopologyRuntime.stats.frameEvaluations+=out.length;if(rec.motion==='linear')gpuLampTopologyRuntime.stats.linearBoundedFrames++;else gpuLampTopologyRuntime.stats.gpuEvaluableFrames++;return out;
}
function gpuMorphKeyLampIneligibleReason(frameCtx){
    if(!frameCtx?.layer)return'no-frame';if(!frameCtx.morphFrameActive||frameCtx.greenMorphEnabled||frameCtx.minimalFadeEnabled)return'not-blue-topology-morph';if(frameCtx.blueMorphProvider?.mode==='fade')return'fade-provider';if(!['topology','calm'].includes(state?.morph?.mode))return'morph-mode-needs-compat';
    if(typeof gpuMorphLampPositionMode==='function'&&gpuMorphLampPositionMode(frameCtx)!=='key')return'not-key-lamps';const cfg=frameCtx.layerLampConfig||ensureLayerLampState?.(frameCtx.layer)||state.lamps||{},motion=cfg.morphMotionMode||'linear';if(motion==='ghost')return'ghost-needs-compat-visibility';
    if(typeof gpuMorphArcIneligibleReason==='function'){const r=gpuMorphArcIneligibleReason(frameCtx);if(r)return r;}return'';
}
function canUseGpuMorphKeyLampsFrame(frameCtx){return gpuMorphKeyLampIneligibleReason(frameCtx)==='';}
function prepareGpuMorphKeyLampFrame(frameCtx,maxPoints=GPU_LAMP_TOPOLOGY_MAX){
    gpuLampTopologyRuntime.stats.requests++;const reason=gpuMorphKeyLampIneligibleReason(frameCtx);if(reason){gpuLampTopologyRuntime.lastError=reason;return null;}const rec=buildGpuLampTopologyResource(frameCtx,maxPoints);if(!rec)return null;void ensureGpuLampTopologyBuffer(rec);
    const t=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(frameCtx.blueMorphProvider?.geometryT):Math.max(0,Math.min(1,Number(frameCtx.blueMorphProvider?.geometryT)||0)));let points=evaluateGpuLampTopologyResource(rec,t);points=preserveBlueMorphLampIdentity(frameCtx.layerIndex,points);if(!points.length)return null;
    gpuLampTopologyRuntime.stats.cpuPathBuildsAvoided++;return{gpuLampNative:true,gpuLampNativeKind:(rec.motion==='linear'?'bounded-key':(rec.gpuReady?'topology-key':'bounded-key')),gpuLampTopologyResource:rec,gpuMorphT:t,frameId:Number(frameCtx.frameId)||0,attachmentPoints:points,attachmentCount:points.length};
}
window.__spiroGpuLampTopologyStatus=()=>({generation:gpuLampTopologyRuntime.generation,lastError:gpuLampTopologyRuntime.lastError,stats:{...gpuLampTopologyRuntime.stats},resources:[...gpuLampTopologyRuntime.resourceSet].map(r=>({layerIndex:r.layerIndex,serial:r.serial,motion:r.motion,count:r.count,gpuReady:r.gpuReady,gpuGeneration:r.gpuGeneration})),contract:'Key topology Morph builds/caps physical lamp identity once per phase. Display frames evaluate <=260 identities; Dynamic/Smooth may interpolate resident endpoints in Lamp WGSL, True Linear keeps bounded split/merge gate math. Ghost is owned by the separate v521 phase-envelope resource.'});
