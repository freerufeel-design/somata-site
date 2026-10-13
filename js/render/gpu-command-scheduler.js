

window.__spiroRegisterModule?.('js/render/gpu-command-scheduler');

const spiroGpuCommandSchedulerRuntime={
    frames:0,commands:0,prerequisiteCommands:0,morphPrerequisites:0,arcPrerequisites:0,
    morphScheduledReuses:0,arcScheduledReuses:0,committedReuses:0,rootProducerReuses:0,
    layerCallbacksTransferred:0,frameSceneCallbackBatches:0,submittedCallbacks:0,
    duplicateComputeAvoided:0,rootProducerArcReuses:0,lastFrameId:0,last:null
};

function spiroGpuSchedulerFrame(frameCtxOrFrame){
    const frame=frameCtxOrFrame?.frame||frameCtxOrFrame;if(!frame)return null;
    const fid=Number(frame.id)||Number(frame.frameId)||Number(frameGeometryRuntime?.frameId)||0;
    let s=frame._spiroGpuCommandSchedule;
    if(!s||s.frameId!==fid){
        s={frameId:fid,morph:new WeakMap(),arc:new WeakMap(),labels:[],commandCount:0,prerequisiteCount:0};
        frame._spiroGpuCommandSchedule=s;spiroGpuCommandSchedulerRuntime.frames++;spiroGpuCommandSchedulerRuntime.lastFrameId=fid;
    }
    return s;
}
function spiroGpuSchedulerQueue(frameCtxOrFrame){
    const frame=frameCtxOrFrame?.frame||frameCtxOrFrame;if(!frame)return null;
    if(!Array.isArray(frame.gpuLayerSceneEffectCommands))frame.gpuLayerSceneEffectCommands=[];
    return frame.gpuLayerSceneEffectCommands;
}
function spiroGpuScheduleLayerSceneCommand(frameCtx,phase,commandBuffer,label='effect',onSubmitted=null,meta=null){
    if(!commandBuffer)return true;const frame=frameCtx?.frame||frameCtx,q=spiroGpuSchedulerQueue(frame);if(!q)return false;
    const item={phase:Number(phase)||0,commandBuffer,label:String(label||'effect'),onSubmitted:typeof onSubmitted==='function'?onSubmitted:null,meta:meta||null};
    let i=q.length;while(i>0&&Number(q[i-1]?.phase)>item.phase)i--;q.splice(i,0,item);
    const s=spiroGpuSchedulerFrame(frame);if(s){s.commandCount++;s.labels.push(item.label);if(meta?.prerequisite){s.prerequisiteCount++;spiroGpuCommandSchedulerRuntime.prerequisiteCommands++;}}
    spiroGpuCommandSchedulerRuntime.commands++;return true;
}
function spiroGpuScheduledTokenMatches(token,frameId,t){return Boolean(token&&token.frameId===frameId&&token.t===t);}

function spiroGpuEnsureMorphPrerequisite(frameCtx,morphRec,t,phase=1){
    if(!frameCtx?.frame?.gpuLayerSceneDeferred||!morphRec?.ready)return false;
    const s=spiroGpuSchedulerFrame(frameCtx),fid=s?.frameId||Number(frameCtx.frameId)||0,u=typeof morphRec?.resolveMorphT==='function'?morphRec.resolveMorphT(t):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(t):Math.max(0,Math.min(1,Number(t)||0)));if(!s)return false;
    const custom=typeof morphRec.encodeCurrentCubics==='function';

    if(custom&&frameCtx.frame.gpuLayerSceneDeferred===true&&Number(morphRec.currentCubicsRootProducerFrameId)===fid&&Math.abs((Number(morphRec.currentCubicsRootProducerT)||0)-u)<1e-12){s.morph.set(morphRec,{frameId:fid,t:u,rootProducer:true});spiroGpuCommandSchedulerRuntime.rootProducerReuses++;spiroGpuCommandSchedulerRuntime.duplicateComputeAvoided++;return true;}
    if(custom&&Number(morphRec.currentCubicsCommittedFrameId)===fid&&Math.abs((Number(morphRec.currentCubicsCommittedT)||0)-u)<1e-12){spiroGpuCommandSchedulerRuntime.committedReuses++;return true;}
    if(!custom&&morphRec.hasCommittedData&&morphRec.lastCommittedT===u){spiroGpuCommandSchedulerRuntime.committedReuses++;return true;}
    const hit=s.morph.get(morphRec);if(spiroGpuScheduledTokenMatches(hit,fid,u)){spiroGpuCommandSchedulerRuntime.morphScheduledReuses++;spiroGpuCommandSchedulerRuntime.duplicateComputeAvoided++;return true;}
    let pre=null;
    if(custom&&typeof morphRec.buildCurrentCubicsPrerequisite==='function')pre=morphRec.buildCurrentCubicsPrerequisite(fid,u);
    else if(!custom&&typeof buildSharedGpuMorphPrerequisiteCommand==='function')pre=buildSharedGpuMorphPrerequisiteCommand(morphRec.layerIndex,u,fid);
    if(!pre?.ready)return false;
    if(pre.commandBuffer&&!spiroGpuScheduleLayerSceneCommand(frameCtx,phase,pre.commandBuffer,`prereq-morph-L${morphRec.layerIndex}`,pre.onSubmitted,{prerequisite:'morph',resource:morphRec}))return false;
    s.morph.set(morphRec,{frameId:fid,t:u});spiroGpuCommandSchedulerRuntime.morphPrerequisites++;return true;
}

function spiroGpuEnsureArcPrerequisite(frameCtx,table,phase=2){
    const rec=table?._gpuMorphArcResource;if(!frameCtx?.frame?.gpuLayerSceneDeferred||!rec?.ready)return false;
    const s=spiroGpuSchedulerFrame(frameCtx),fid=s?.frameId||Number(frameCtx.frameId)||0,t=typeof rec.morphRec?.resolveMorphT==='function'?rec.morphRec.resolveMorphT(table.gpuMorphT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table.gpuMorphT):Math.max(0,Math.min(1,Number(table.gpuMorphT)||0)));if(!s)return false;
    if(rec.hasCommittedData&&rec.lastCommittedT===t){spiroGpuCommandSchedulerRuntime.committedReuses++;return true;}
    const hit=s.arc.get(rec);if(spiroGpuScheduledTokenMatches(hit,fid,t)){spiroGpuCommandSchedulerRuntime.arcScheduledReuses++;spiroGpuCommandSchedulerRuntime.duplicateComputeAvoided++;return true;}
    if(typeof buildGpuMorphArcPrerequisiteCommand!=='function')return false;

    const morphRec=rec.morphRec,orderedRoot=Boolean(typeof morphRec?.encodeCurrentCubics==='function'&&frameCtx.frame.gpuLayerSceneDeferred===true&&Number(morphRec.currentCubicsRootProducerFrameId)===fid&&Math.abs((Number(morphRec.currentCubicsRootProducerT)||0)-t)<1e-12);
    const pre=buildGpuMorphArcPrerequisiteCommand(table,orderedRoot?{reuseOrderedCurrentCubics:true}:null);if(!pre?.ready)return false;
    if(orderedRoot){spiroGpuCommandSchedulerRuntime.rootProducerArcReuses++;spiroGpuCommandSchedulerRuntime.duplicateComputeAvoided++;}
    if(pre.commandBuffer&&!spiroGpuScheduleLayerSceneCommand(frameCtx,phase,pre.commandBuffer,`prereq-arc-L${rec.morphRec?.layerIndex??0}`,pre.onSubmitted,{prerequisite:'arc',resource:rec}))return false;
    s.arc.set(rec,{frameId:fid,t});

    if(rec.morphRec)s.morph.set(rec.morphRec,{frameId:fid,t});
    spiroGpuCommandSchedulerRuntime.arcPrerequisites++;return true;
}

function spiroGpuPrepareMorphForLayerScene(frameCtx,morphRec,t,consumerEncoder){

    if(spiroGpuEnsureMorphPrerequisite(frameCtx,morphRec,t))return true;
    if(typeof morphRec?.encodeCurrentCubics==='function'){
        const tt=typeof morphRec.resolveMorphT==='function'?morphRec.resolveMorphT(t):Math.max(0,Math.min(1,Number(t)||0));
        return Boolean(consumerEncoder&&morphRec.encodeCurrentCubics(consumerEncoder,tt));
    }
    return Boolean(consumerEncoder&&typeof encodeSharedGpuMorphPath==='function'&&encodeSharedGpuMorphPath(consumerEncoder,morphRec?.layerIndex,t));
}
function spiroGpuPrepareArcForLayerScene(frameCtx,table,consumerEncoder){
    if(spiroGpuEnsureArcPrerequisite(frameCtx,table))return true;
    return Boolean(consumerEncoder&&typeof encodeGpuMorphArcTable==='function'&&encodeGpuMorphArcTable(table,consumerEncoder));
}

function spiroGpuPreflightLayerPrerequisites(frameCtx){
    if(!frameCtx?.frame?.gpuLayerSceneDeferred)return{active:false,arc:0,morph:0};
    const e=frameCtx.effectsPlan||{},arcTables=[],morphItems=[];
    const addArc=(table)=>{if(table?._gpuMorphArcResource)arcTables.push(table);};
    const addGraffiti=(prepared)=>{if(prepared?.gpuMorphNative!==true)return;if(prepared.gpuMorphSampled===true)addArc(prepared.gpuMorphArcTable);else if(prepared.gpuMorphResource?.ready)morphItems.push({rec:prepared.gpuMorphResource,t:prepared.gpuMorphT});};
    addGraffiti(e.outline?.profilePrepared);addGraffiti(e.profile?.prepared);if(e.profile?.prepared?.gpuArcNative===true)addArc(e.profile.prepared.table);
    addArc(e.sweep?.frameData?.prepared?.table);addArc(e.web?.frameData?.gpuMorphArcTable);
    for(const set of e.lamps?.sets||[])if(set?.gpuLampNative===true)addArc(set.gpuPrepared?.gpuMorphArcTable);
    const seenArc=new WeakSet();let arc=0,morph=0;
    for(const table of arcTables){const rec=table?._gpuMorphArcResource;if(!rec||seenArc.has(rec))continue;seenArc.add(rec);if(spiroGpuEnsureArcPrerequisite(frameCtx,table))arc++;}
    const seenMorph=new WeakSet();for(const item of morphItems){const rec=item.rec;if(!rec||seenMorph.has(rec))continue;seenMorph.add(rec);if(spiroGpuEnsureMorphPrerequisite(frameCtx,rec,item.t))morph++;}
    const s=spiroGpuSchedulerFrame(frameCtx);spiroGpuCommandSchedulerRuntime.last={frameId:s?.frameId||0,layerIndex:Number(frameCtx.layerIndex)||0,arc,morph,queueLength:spiroGpuSchedulerQueue(frameCtx)?.length||0};
    return{active:true,arc,morph};
}

function transferLayerSceneEffectCallbacksToFrameScene(frame){
    const q=Array.isArray(frame?.gpuLayerSceneEffectCommands)?frame.gpuLayerSceneEffectCommands:null;if(!q?.length)return 0;
    let dst=frame.gpuFrameSceneSubmitCallbacks;if(!Array.isArray(dst))dst=frame.gpuFrameSceneSubmitCallbacks=[];
    let n=0;for(const item of q){if(typeof item?.onSubmitted==='function'){dst.push(item.onSubmitted);item.onSubmitted=null;n++;}}
    if(n){spiroGpuCommandSchedulerRuntime.layerCallbacksTransferred+=n;spiroGpuCommandSchedulerRuntime.frameSceneCallbackBatches++;}return n;
}
function notifyFrameSceneEffectCommandsSubmitted(frame){
    const q=Array.isArray(frame?.gpuFrameSceneSubmitCallbacks)?frame.gpuFrameSceneSubmitCallbacks:null;if(!q?.length)return 0;let n=0;
    for(const cb of q){try{cb?.();n++;}catch(_){}}q.length=0;spiroGpuCommandSchedulerRuntime.submittedCallbacks+=n;return n;
}
function clearFrameSceneEffectCallbacks(frame){const q=frame?.gpuFrameSceneSubmitCallbacks;if(Array.isArray(q))q.length=0;}
window.__spiroGpuCommandSchedulerStatus=()=>({...spiroGpuCommandSchedulerRuntime,last:spiroGpuCommandSchedulerRuntime.last,contract:'Capability RenderGraph -> executable ordered GPU prerequisites; strict Spiral reuses the already ordered Base current-cubic root for Arc when possible, otherwise emits one explicit prerequisite; one Exact-Arc compute per resource+t per deferred frame; cross-layer submit callbacks survive frame-scene sealing.'});
