// SpiroStar v519 — GPU Morph Lamp attachment bridge
// Arbitrary lamps already own stable contour-local (pathIndex,fraction,seed) identity. Keep that
// bounded attachment/style population on CPU, but resolve every display-frame position from the
// resident exact Morph Arc on GPU. Key/Ghost own phase identity resources. Corner lamps use an
// allocation-light packed MorphFrame topology carrier while retaining the historical CPU identity/inertia state machine.
window.__spiroRegisterModule?.('js/render/lamp-morph-bridge');

const gpuMorphLampBridgeStats={requests:0,hits:0,fallbacks:0,attachmentsBuilt:0,cpuPathBuildsAvoided:0,cpuArcWalksAvoided:0,lastReason:'not-requested'};

function gpuMorphLampPositionMode(frameCtx){
    const cfg=frameCtx?.layerLampConfig||frameCtx?.effectsPlan?.lamps?.baseConfig||(typeof ensureLayerLampState==='function'?ensureLayerLampState(frameCtx?.layer):null)||state?.lamps||{};
    const mode=cfg?.positionMode||state?.lamps?.positionMode||'key';return mode==='circumference'?'key':mode;
}
function gpuMorphArbitraryLampIneligibleReason(frameCtx,requireReady=true){
    if(!frameCtx?.layer)return'no-frame';
    if(!frameCtx.morphFrameActive||frameCtx.greenMorphEnabled||frameCtx.minimalFadeEnabled)return'not-blue-topology-morph';
    if(frameCtx.blueMorphProvider?.mode==='fade')return'fade-provider';
    if(gpuMorphLampPositionMode(frameCtx)!=='arbitrary')return'position-mode-needs-compat-identity';
    if(typeof gpuMorphArcIneligibleReason==='function'){const r=gpuMorphArcIneligibleReason(frameCtx);if(r)return r;}
    if(requireReady){
        if(typeof LampGPURenderer==='undefined'||!LampGPURenderer.isWebGPUReady?.())return'lamp-gpu-warming';
        if(typeof warmupGpuMorphArcResource==='function'&&!warmupGpuMorphArcResource())return'gpu-morph-arc-warming';
    }
    return'';
}
function canUseGpuMorphArbitraryLampsFrame(frameCtx,requireReady=true){return gpuMorphArbitraryLampIneligibleReason(frameCtx,requireReady)==='';}

function allocateGpuArbitraryLampCounts(layer,morphRec,t,maxPoints=600){
    const lengths=morphRec?.cpuEndpointPathLengths,pathCount=Math.max(0,Number(morphRec?.pathCount)||0),layerKey=String(layer?.id||layer?.name||'layer');
    if(!lengths||!pathCount)return[];
    const density=typeof lampArbitraryDensityFactor==='function'?lampArbitraryDensityFactor():1,candidates=[];
    for(let pathIndex=0;pathIndex<pathCount;pathIndex++){
        const key=`${layerKey}:path:${pathIndex}`;let base=lampMotionRuntime?.arbitraryPathCounts?.get?.(key);
        if(!Number.isFinite(base)){
            const a=Math.max(0,Number(lengths[pathIndex*2])||0),b=Math.max(0,Number(lengths[pathIndex*2+1])||0),len=a+(b-a)*Math.max(0,Math.min(1,Number(t)||0));
            base=len>0?Math.max(2,Math.min(maxPoints,Math.round(len/24))):0;
            if(base>0)try{lampMotionRuntime.arbitraryPathCounts.set(key,base);}catch(_){}
        }
        const desired=density<=.0001||!(base>0)?0:Math.max(1,Math.min(maxPoints,Math.round(base*density)));
        if(desired)candidates.push({pathIndex,desired,count:0,remainder:0});
    }
    if(!candidates.length||maxPoints<=0)return candidates;
    if(candidates.length<=maxPoints){for(const c of candidates)c.count=1;}else for(let i=0;i<maxPoints;i++)candidates[Math.floor(i*candidates.length/maxPoints)].count=1;
    let used=candidates.reduce((n,c)=>n+c.count,0),remain=Math.max(0,maxPoints-used);
    if(remain>0){
        const weights=candidates.map(c=>Math.max(0,c.desired-c.count)),total=weights.reduce((a,b)=>a+b,0);
        if(total>0){let assigned=0;for(let i=0;i<candidates.length;i++){const raw=remain*weights[i]/total,whole=Math.min(weights[i],Math.floor(raw));candidates[i].count+=whole;candidates[i].remainder=raw-whole;assigned+=whole;}
            let left=remain-assigned;const order=candidates.map((c,i)=>i).sort((a,b)=>candidates[b].remainder-candidates[a].remainder);for(const i of order){if(left<=0)break;const c=candidates[i];if(c.count<c.desired){c.count++;left--;}}}
    }
    return candidates;
}
function buildGpuArbitraryLampAttachmentPoints(frameCtx,morphRec,t,maxPoints=600){
    const layer=frameCtx.layer,layerKey=String(layer?.id||layer?.name||'layer'),out=[],counts=allocateGpuArbitraryLampCounts(layer,morphRec,t,maxPoints);
    for(const c of counts){if(!c.count)continue;const seedKey=`lamp|${layerKey}|path:${c.pathIndex}`,fractions=stableContourLampFractions(seedKey,c.count);for(let i=0;i<fractions.length;i++){
        const f=fractions[i];out.push({x:0,y:0,pathIndex:c.pathIndex,lampAttachFraction:f,lampColorPhase:f,lampId:`arb:${c.pathIndex}:${i}`,lampSeed:lampHash32(`${seedKey}:${i}`)});
    }}
    return out;
}
function prepareGpuMorphArbitraryLampFrame(frameCtx,maxPoints=600){
    gpuMorphLampBridgeStats.requests++;if(!frameCtx)return null;
    const reason=gpuMorphArbitraryLampIneligibleReason(frameCtx,true);if(reason){gpuMorphLampBridgeStats.fallbacks++;gpuMorphLampBridgeStats.lastReason=reason;return null;}
    const table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null,arcRec=table?._gpuMorphArcResource,morphRec=arcRec?.morphRec;
    if(!table||!arcRec?.ready||!morphRec?.ready){gpuMorphLampBridgeStats.fallbacks++;gpuMorphLampBridgeStats.lastReason='gpu-arc-resource-unavailable';return null;}
    const rawT=table.gpuMorphT??frameCtx.blueMorphProvider?.geometryT,t=typeof morphRec.resolveMorphT==='function'?morphRec.resolveMorphT(rawT):(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(rawT):Math.max(0,Math.min(1,Number(rawT)||0))),points=buildGpuArbitraryLampAttachmentPoints(frameCtx,morphRec,t,maxPoints);
    if(!points.length){gpuMorphLampBridgeStats.fallbacks++;gpuMorphLampBridgeStats.lastReason='no-attachments';return null;}
    const prepared={gpuLampNative:true,gpuMorphArcTable:table,gpuMorphArcResource:arcRec,gpuMorphResource:morphRec,gpuMorphT:t,frameId:Number(frameCtx.frameId)||Number(frameGeometryRuntime?.frameId)||0,attachmentPoints:points,attachmentCount:points.length};
    gpuMorphLampBridgeStats.hits++;gpuMorphLampBridgeStats.attachmentsBuilt+=points.length;gpuMorphLampBridgeStats.cpuPathBuildsAvoided++;gpuMorphLampBridgeStats.cpuArcWalksAvoided+=Math.max(0,Number(morphRec.segmentCount)||0);gpuMorphLampBridgeStats.lastReason='arbitrary-contour-fractions-on-gpu-arc';return prepared;
}
function spiralMorphFractionIdentityAtT(records,pathIndex,t,{forceEndpoints=false}={}){
    const rec=records?.[pathIndex]||{},src=Array.isArray(rec.source)?rec.source:[],dst=Array.isArray(rec.target)?rec.target:[];
    if(!src.length&&!dst.length)return[];
    // Key/Corner identity belongs to authored endpoint markers. Counts may change between
    // endpoints, so interpolate an ordinal identity lattice while positions are still sampled
    // from the CURRENT exact Arc. Technical De Casteljau cuts never become lamp identities.
    const sample=(arr,q)=>{if(!arr.length)return NaN;if(arr.length===1)return Math.max(0,Math.min(1,Number(arr[0])||0));const x=q*(arr.length-1),i=Math.min(arr.length-2,Math.floor(x)),u=x-i;return Math.max(0,Math.min(1,(Number(arr[i])||0)+((Number(arr[i+1])||0)-(Number(arr[i])||0))*u));};
    const count=Math.max(forceEndpoints?2:1,src.length,dst.length),tt=Math.max(0,Math.min(1,Number(t)||0)),out=[];
    for(let i=0;i<count;i++){
        const q=count===1?.5:i/Math.max(1,count-1),a=sample(src,q),b=sample(dst,q);
        const v=Number.isFinite(a)&&Number.isFinite(b)?a+(b-a)*tt:(Number.isFinite(a)?a:b);
        if(Number.isFinite(v))out.push(Math.max(0,Math.min(1,v)));
    }
    if(forceEndpoints&&out.length){out[0]=0;out[out.length-1]=1;}
    return out;
}
function spiralMorphKnotFractionsAtT(morphRec,pathIndex,t){return spiralMorphFractionIdentityAtT(morphRec?.cpuPathKnotFractions,pathIndex,t,{forceEndpoints:true});}
function gpuMorphSpecialSpiralLampFrame(frameCtx,maxPoints=600){
    const morphRec=typeof currentGpuBezierResourceForFrame==='function'?currentGpuBezierResourceForFrame(frameCtx):(typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx?.layerIndex):null);
    if(!morphRec?.specialSpiralBezierRail||!morphRec?.ready)return null;
    const table=typeof getGpuMorphArcTableForFrame==='function'?getGpuMorphArcTableForFrame(frameCtx):null,arcRec=table?._gpuMorphArcResource;
    if(!table?.gpuArcResident||!arcRec?.ready)return null;
    const mode=gpuMorphLampPositionMode(frameCtx),ranges=morphRec.cpuPathSegmentRanges,pathCount=Math.max(0,Number(morphRec.pathCount)||0),points=[];
    if(!ranges||!pathCount)return null;
    const rawT=table.gpuMorphT??frameCtx.blueMorphProvider?.geometryT,t=typeof morphRec.resolveMorphT==='function'?morphRec.resolveMorphT(rawT):Math.max(0,Math.min(1,Number(rawT)||0));
    const layerKey=String(frameCtx?.layer?.id||frameCtx?.layerIndex||'layer');
    // 6.8 — Key/Corners attach to the actual cumulative arc position of retained cubic
    // boundaries. Uniform j/N fractions are wrong as soon as neighbouring cubics have
    // different lengths (the usual case on a spiral), and visibly move lamps off their knots.
    for(let pi=0;pi<pathCount;pi++){
        let fractions=[];
        if(mode==='arbitrary'){
            const desired=Math.max(2,Math.min(48,Math.round(((Number(morphRec.cpuEndpointPathLengths?.[pi*2])||0)+(Number(morphRec.cpuEndpointPathLengths?.[pi*2+1])||0))/48)||8));
            fractions=stableContourLampFractions(`spiral|${layerKey}|${pi}`,desired);
            for(let j=0;j<fractions.length&&points.length<maxPoints;j++){const f=Math.max(0,Math.min(1,Number(fractions[j])||0));points.push({x:0,y:0,pathIndex:pi,lampAttachFraction:f,lampColorPhase:f,lampId:`spiral:${mode}:${pi}:${j}`,lampSeed:lampHash32(`spiral:${layerKey}:${mode}:${pi}:${j}`)});}
        }else if(mode==='key'){
            // 7.3.7 — Key identity comes ONLY from authored key markers. Technical
            // De Casteljau equalization cuts and geometric corner flags are deliberately excluded.
            // The identity fraction can travel during Morph, while the final XY is sampled from
            // the current exact retained-cubic Arc.
            const records=morphRec?.cpuPathLampKeyFractions;
            fractions=spiralMorphFractionIdentityAtT(records,pi,t,{forceEndpoints:true});
            const periodic=Boolean(morphRec?.cpuPathPeriodic?.[pi]>>>0),omitSharedSeam=periodic&&state?.tunnel?.active===true;
            for(let j=0;j<fractions.length&&points.length<maxPoints;j++){
                if(omitSharedSeam&&j===fractions.length-1)continue;
                const f=Math.max(0,Math.min(1,Number(fractions[j])||0));
                points.push({x:0,y:0,pathIndex:pi,lampAttachFraction:f,lampColorPhase:f,lampId:`spiral:key:${pi}:${j}`,lampSeed:lampHash32(`spiral:${layerKey}:key:${pi}:${j}`)});
            }
        }else{
            // Corners are different: a lamp must sit on the CURRENT exact retained-knot bend,
            // not on an interpolation of source/target arc fractions. The common De Casteljau
            // partition is allowed only as a coordinate system; a boundary becomes a Corner
            // identity only when authored corner metadata reaches that boundary.
            const knotRec=morphRec?.cpuPathKnotFractions?.[pi]||{},common=Array.isArray(knotRec.common)?knotRec.common:[];
            const logicalFirst=Math.max(0,Number(morphRec?.cpuPathSegmentRanges?.[pi*4])||0),logicalCount=Math.max(0,Number(morphRec?.cpuPathSegmentRanges?.[pi*4+1])||0),subdiv=Math.max(1,Number(arcRec?.subdiv)||1),meta=morphRec?.cpuSegmentMeta;
            const boundaryIsCorner=(j)=>{let corner=false;if(meta&&j<logicalCount)corner=corner||Boolean((meta[(logicalFirst+j)*4+3]>>>0)&0x40000000);if(meta&&j>0)corner=corner||Boolean((meta[(logicalFirst+j-1)*4+3]>>>0)&0x80000000);return corner;};
            const boundaryCount=Math.min(common.length,logicalCount+1);
            for(let j=0;j<boundaryCount&&points.length<maxPoints;j++){
                if(!boundaryIsCorner(j))continue;const f=Math.max(0,Math.min(1,Number(common[j])||0));
                const p={x:0,y:0,pathIndex:pi,lampAttachFraction:f,lampColorPhase:f,lampId:`spiral:corners:${pi}:${j}`,lampSeed:lampHash32(`spiral:${layerKey}:corners:${pi}:${j}`)};
                // Lamp WGSL interprets segmentIndex as LOCAL to this path and adds the path's
                // micro-rail offset itself. Pinning the boundary directly keeps lamps on bends.
                if(logicalCount>0){if(j>=logicalCount){p.gpuLampArcSegmentIndex=logicalCount*subdiv-1;p.gpuLampArcSegmentT=1;}else{p.gpuLampArcSegmentIndex=j*subdiv;p.gpuLampArcSegmentT=0;}}
                points.push(p);
            }
        }
        if(points.length>=maxPoints)break;
    }
    // A smooth Spiral may legitimately have no authored bend markers. In Corners mode that
    // is an authoritative empty result, not an Arc warmup failure; returning the empty GPU
    // frame prevents the strict FullGPU contract from reporting a false resource error.
    if(!points.length&&mode!=='corners')return null;
    return{gpuLampNative:true,gpuLampNativeKind:'arc',gpuMorphArcTable:table,gpuMorphArcResource:arcRec,gpuMorphResource:morphRec,gpuMorphT:t,frameId:Number(frameCtx.frameId)||0,attachmentPoints:points,attachmentCount:points.length};
}
function prepareGpuMorphLampFrame(frameCtx){
    if(typeof spiroIsCompatibilityForced==='function'&&spiroIsCompatibilityForced('lamps')){gpuMorphLampBridgeStats.fallbacks++;gpuMorphLampBridgeStats.lastReason='pass-isolation-compatibility';return null;}
    try{
        const strictSpiral=typeof isStrictSpiralWebGPUFrame==='function'&&isStrictSpiralWebGPUFrame(frameCtx),authoritative=strictSpiral?(typeof currentGpuBezierResourceForFrame==='function'?currentGpuBezierResourceForFrame(frameCtx):(typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx?.layerIndex):null)):null;
        // Iter12: during polygon↔Spiral / Spiral↔Spiral morph there is exactly ONE geometry
        // authority. If its retained cubic rail is still warming, lamps wait; they must never
        // silently bind to the generic topology Morph resource for one frame.
        if(strictSpiral&&(!authoritative?.ready||authoritative?.specialSpiralBezierRail!==true)){gpuMorphLampBridgeStats.fallbacks++;gpuMorphLampBridgeStats.lastReason='strict-spiral-retained-rail-wait';try{requestMainCanvasRender?.();}catch(_){}return null;}
        const special=gpuMorphSpecialSpiralLampFrame(frameCtx,600);if(special){gpuMorphLampBridgeStats.hits++;gpuMorphLampBridgeStats.lastReason='spiral-exact-gpu-arc';return special;}
        if(strictSpiral){gpuMorphLampBridgeStats.fallbacks++;gpuMorphLampBridgeStats.lastReason='strict-spiral-arc-wait';return null;}
        const mode=gpuMorphLampPositionMode(frameCtx);
        if(mode==='key'){
            const cfg=frameCtx?.layerLampConfig||ensureLayerLampState?.(frameCtx?.layer)||state?.lamps||{},motion=cfg?.morphMotionMode||'linear';
            if(motion==='ghost'&&typeof prepareGpuMorphGhostLampFrame==='function'){
                const ghost=prepareGpuMorphGhostLampFrame(frameCtx,260);if(ghost){gpuMorphLampBridgeStats.hits++;gpuMorphLampBridgeStats.lastReason=`ghost-${ghost.gpuLampNativeKind||'identity'}`;return ghost;}
            }
            if(typeof prepareGpuMorphKeyLampFrame==='function'){
                const key=prepareGpuMorphKeyLampFrame(frameCtx,260);if(key){gpuMorphLampBridgeStats.hits++;gpuMorphLampBridgeStats.lastReason=`key-${key.gpuLampNativeKind||'identity'}`;return key;}
            }
        }
        if(mode==='arbitrary')return prepareGpuMorphArbitraryLampFrame(frameCtx,600);
        if(mode==='corners'&&typeof prepareGpuMorphCornerLampFrame==='function'){
            const corners=prepareGpuMorphCornerLampFrame(frameCtx,260);if(corners){gpuMorphLampBridgeStats.hits++;gpuMorphLampBridgeStats.lastReason='corners-packed-topology';return corners;}
        }
        return null;
    }catch(err){
        // Native lamp preparation is optional. A resource/runtime error must wake the proven
        // compatibility collector rather than abort the entire LayerFrame preparation.
        gpuMorphLampBridgeStats.fallbacks++;gpuMorphLampBridgeStats.lastReason=`native-preparation-error:${String(err?.message||err)}`;
        try{spiroPassIsolationNoteFailure?.('lamps',err,frameCtx);}catch(_){}
        return null;
    }
}
function canUseGpuMorphLampFrame(frameCtx,requireReady=true){
    if(typeof spiroIsCompatibilityForced==='function'&&spiroIsCompatibilityForced('lamps'))return false;
    try{
        const strictSpiral=typeof isStrictSpiralWebGPUFrame==='function'&&isStrictSpiralWebGPUFrame(frameCtx),specialRec=typeof currentGpuBezierResourceForFrame==='function'?currentGpuBezierResourceForFrame(frameCtx):(typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(frameCtx?.layerIndex):null);
        if(strictSpiral&&specialRec?.specialSpiralBezierRail!==true)return false;
        if(specialRec?.specialSpiralBezierRail===true){if(typeof warmupGpuMorphArcResource==='function')warmupGpuMorphArcResource();return Boolean(specialRec?.ready&&typeof LampGPURenderer!=='undefined'&&LampGPURenderer.isWebGPUReady?.());}
        const mode=gpuMorphLampPositionMode(frameCtx);
        if(mode==='key'){
            const cfg=frameCtx?.layerLampConfig||ensureLayerLampState?.(frameCtx?.layer)||state?.lamps||{},motion=cfg?.morphMotionMode||'linear';
            if(motion==='ghost'&&typeof canUseGpuMorphGhostLampsFrame==='function')return canUseGpuMorphGhostLampsFrame(frameCtx);
            if(typeof canUseGpuMorphKeyLampsFrame==='function')return canUseGpuMorphKeyLampsFrame(frameCtx);
        }
        if(mode==='arbitrary')return canUseGpuMorphArbitraryLampsFrame(frameCtx,requireReady);
        if(mode==='corners'&&typeof canUseGpuMorphCornerLampsFrame==='function')return canUseGpuMorphCornerLampsFrame(frameCtx);
        return false;
    }catch(err){try{spiroPassIsolationNoteFailure?.('lamps',err,frameCtx);}catch(_){}return false;}
}
window.__spiroGpuMorphLampBridgeStatus=()=>({...gpuMorphLampBridgeStats,topology:typeof __spiroGpuLampTopologyStatus==='function'?__spiroGpuLampTopologyStatus():null,ghost:typeof __spiroGpuLampGhostStatus==='function'?__spiroGpuLampGhostStatus():null,corners:typeof __spiroGpuLampCornerStatus==='function'?__spiroGpuLampCornerStatus():null,contract:'topology Morph Lamps are capability-routed before CPU geometry: Arbitrary uses stable contour fractions + shared Exact Arc; Key uses phase-resident topology identity; Cartesian Ghost uses exact phase nearest-key envelopes with bounded <=260 display evaluation; Corners consume packed MorphFrame endpoints and preserve the historical nearest-fraction identity/inertia state without CPU Morph path objects.'});

window.__spiro69StaticSpiralLampProbe=()=>{
    const rows=[];
    try{
        for(let li=0;li<(state?.layers?.length||0);li++){
            const layer=state.layers[li];if(typeof isSpiralLayer==='function'&&!isSpiralLayer(layer))continue;
            const rec=typeof currentGpuBezierMorphResource==='function'?currentGpuBezierMorphResource(li):null;
            const knots=rec?.cpuPathKnotFractions||[];
            rows.push({layerIndex:li,staticRail:rec?.staticSpiralBezierRail===true,ready:rec?.ready===true,pathCount:Number(rec?.pathCount)||0,hasPathRanges:Boolean(rec?.pathRanges),commonKnots:knots.map(k=>Array.isArray(k?.common)?k.common.length:(Array.isArray(k?.source)?k.source.length:0)),lampGpuReady:typeof LampGPURenderer!=='undefined'&&LampGPURenderer.isWebGPUReady?.()===true});
        }
    }catch(err){return{pass:false,error:String(err?.message||err),rows};}
    return{pass:rows.every(r=>r.ready&&r.staticRail&&r.hasPathRanges&&r.commonKnots.every(n=>n>0)),rows,bridge:typeof __spiroGpuMorphLampBridgeStatus==='function'?__spiroGpuMorphLampBridgeStatus():null};
};
