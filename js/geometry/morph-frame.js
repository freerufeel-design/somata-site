// SpiroStar v507 — Morph/Spiral Hot Path
// Per-cycle topology interpolation plans with aligned packed endpoint storage.
//
// v506 removed per-frame target rotation objects and polar-object allocation.
// v507 goes one step further: source/target points are aligned ONCE per phase into
// contiguous Float64Array payloads. Display frames therefore avoid modulo/index remaps
// and almost all source/target object-property reads. The reusable object view remains
// only as the compatibility boundary for legacy/render consumers.
window.__spiroRegisterModule?.('js/geometry/morph-frame');

// SpiroStar 5.2 — morph speed contract.
// Topology/Calm historically feed the selected easing result directly into geometry.
// Anticipate/Overshoot intentionally leave [0,1]; clamping them here turns several speed
// presets into near-linear motion. Other morph families retain the conservative [0,1] range.
function morphInterpolationTForCurrentMode(value){
    const n=Number(value);
    if(!Number.isFinite(n))return 0;
    const mode=state?.morph?.mode;
    return (mode==='topology'||mode==='calm') ? n : Math.max(0,Math.min(1,n));
}
window.morphInterpolationTForCurrentMode=morphInterpolationTForCurrentMode;

const morphFramePipelineRuntime = {
    serial: 0,
    reason: 'init',
    layers: [],
    stats: {
        planBuilds: 0,
        planHits: 0,
        frameInterpolations: 0,
        radialPointUpdates: 0,
        cartesianPointUpdates: 0,
        avoidedRotatedPointObjects: 0,
        avoidedPolarPointObjects: 0,
        alignedPackedPoints: 0,
        moduloLookupsAvoided: 0,
        endpointObjectReadsAvoided: 0,
        drawPlanUses: 0
    }
};

function resetMorphFramePipelineStats(){
    const s=morphFramePipelineRuntime.stats;
    for(const k of Object.keys(s))s[k]=0;
    return s;
}

function invalidateMorphFrameInterpolationPlans(reason='morph-cycle'){
    if(typeof invalidateSharedGpuMorphPathResources==='function')invalidateSharedGpuMorphPathResources(reason);
    morphFramePipelineRuntime.serial=(morphFramePipelineRuntime.serial+1)>>>0;
    morphFramePipelineRuntime.reason=String(reason||'morph-cycle');
    morphFramePipelineRuntime.layers.length=0;
    if(runtimeState?.morph){
        runtimeState.morph._frameInterpolationSerial=morphFramePipelineRuntime.serial;
        runtimeState.morph._frameInterpolationPlans=[];
    }
    return morphFramePipelineRuntime.serial;
}

function ensurePackedMorphPolar(points,reuse=null){
    const pts=Array.isArray(points)?points:[];
    const need=pts.length*2;
    let out=(reuse instanceof Float64Array && reuse.length===need)?reuse:new Float64Array(need);
    let previousAngle=0;
    for(let i=0;i<pts.length;i++){
        const p=pts[i]||{};
        const x=Number(p.x)||0,y=Number(p.y)||0;
        const radius=Math.hypot(x,y);
        let angle=radius>1e-7?Math.atan2(y,x):previousAngle;
        if(i>0){
            while(angle-previousAngle>Math.PI)angle-=Math.PI*2;
            while(angle-previousAngle<-Math.PI)angle+=Math.PI*2;
        }
        previousAngle=angle;
        out[i*2]=radius;out[i*2+1]=angle;
    }
    return out;
}

function getMorphFramePlanBucket(layerIndex){
    const key=Number.isFinite(Number(layerIndex))?Number(layerIndex):-1;
    let bucket=morphFramePipelineRuntime.layers[key];
    if(!bucket){bucket={};morphFramePipelineRuntime.layers[key]=bucket;}
    return bucket;
}

function packAlignedMorphEndpoints(rec){
    const {srcPts,dstPts,n,referenceOffset,rotates,useRadial}=rec;
    if(!srcPts?.length||!dstPts?.length||!n)return rec;
    const srcLen=srcPts.length,dstLen=dstPts.length,offset=referenceOffset||0;
    const srcXYZ=new Float64Array(n*3),dstXYZ=new Float64Array(n*3);
    let srcPolarAligned=null,dstPolarAligned=null;
    if(useRadial){srcPolarAligned=new Float64Array(n*2);dstPolarAligned=new Float64Array(n*2);}
    const srcPolar=rec.srcPolar,dstPolar=rec.dstPolar;
    for(let i=0;i<n;i++){
        const si=i%srcLen,di=(i+offset)%dstLen;
        const a=srcPts[si]||{},b=dstPts[di]||{};
        const o=i*3;
        srcXYZ[o]=Number(a.x)||0;srcXYZ[o+1]=Number(a.y)||0;srcXYZ[o+2]=Number(a.widthScale)||1;
        dstXYZ[o]=Number(b.x)||0;dstXYZ[o+1]=Number(b.y)||0;dstXYZ[o+2]=rotates?1:(Number(b.widthScale)||1);
        if(useRadial&&srcPolar&&dstPolar){
            const p=i*2;
            srcPolarAligned[p]=srcPolar[si*2];srcPolarAligned[p+1]=srcPolar[si*2+1];
            dstPolarAligned[p]=dstPolar[di*2];dstPolarAligned[p+1]=dstPolar[di*2+1];
        }
    }
    rec.srcXYZ=srcXYZ;rec.dstXYZ=dstXYZ;rec.srcPolarAligned=srcPolarAligned;rec.dstPolarAligned=dstPolarAligned;
    morphFramePipelineRuntime.stats.alignedPackedPoints+=n;
    // Each display-frame point previously performed two modulo operations and several
    // object property reads. Keep explicit counters so perf diagnostics can prove the hot
    // path is using the aligned phase resource.
    morphFramePipelineRuntime.stats.moduloLookupsAvoided+=n*2;
    morphFramePipelineRuntime.stats.endpointObjectReadsAvoided+=n*6;
    return rec;
}

function buildMorphFrameInterpolationPlan(layerIndex,sourcePaths,targetPaths,variant='canonical',options=null){
    const src=Array.isArray(sourcePaths)?sourcePaths:[];
    const dst=Array.isArray(targetPaths)?targetPaths:[];
    const pairs=(src.length&&dst.length)?pairMorphPaths(src,dst):[];
    const opt=options&&typeof options==='object'?options:{};
    const defaultRadial=Boolean(state?.morph?.options?.byVertices||state?.morph?.options?.bySteps||state?.morph?.monoOrbitTransforms);
    const radialEnabled=opt.forceRadial===true?true:(opt.forceRadial===false?false:defaultRadial);
    const chaosCalm=state?.morph?.mode==='calm'&&isChaosCircleMorphPair(layerIndex);
    const vertexCountHint=Math.max(0,Math.round(Number(opt.vertexCountHint ?? state?.layers?.[layerIndex]?.N)||0));
    const records=[];
    for(let pi=0;pi<pairs.length;pi++){
        const pair=pairs[pi];
        const sp=pair?.src||null,dp=pair?.dst||null;
        const srcPts=sp?.points||[],dstPts=dp?.points||[];
        const closed=Boolean((sp&&dp)?(sp.closed&&dp.closed):(dp||sp)?.closed);
        const rotates=Boolean(sp&&dp&&(pair.radialMerge||pair.radialSplit));
        const rotationDelta=rotates?signedAngleDelta(pathReferenceAngle(dp),pathReferenceAngle(sp)):0;
        const useRadial=Boolean(sp&&dp&&closed&&(chaosCalm||(radialEnabled&&(pair.radialMerge||pair.radialSplit))));
        const n=sp&&dp?Math.max(srcPts.length,dstPts.length):Math.max(srcPts.length,dstPts.length);
        const referenceOffset=(sp&&dp&&dstPts.length)
            ?getMorphReferenceVertexOffset(pair,dstPts.length,closed,vertexCountHint||state?.layers?.[layerIndex]?.N)
            :0;
        const rec={
            pair,sp,dp,srcPts,dstPts,closed,rotates,rotationDelta,useRadial,n,referenceOffset,
            srcPolar:null,dstPolar:null,srcXYZ:null,dstXYZ:null,srcPolarAligned:null,dstPolarAligned:null,
            scratch:[],variant
        };
        if(useRadial){
            rec.srcPolar=ensurePackedMorphPolar(srcPts,rec.srcPolar);
            rec.dstPolar=ensurePackedMorphPolar(dstPts,rec.dstPolar);
            morphFramePipelineRuntime.stats.avoidedPolarPointObjects+=srcPts.length+dstPts.length;
        }
        if(rotates)morphFramePipelineRuntime.stats.avoidedRotatedPointObjects+=dstPts.length;
        if(sp&&dp)packAlignedMorphEndpoints(rec);
        records.push(rec);
    }
    const plan={
        serial:morphFramePipelineRuntime.serial,
        layerIndex,variant,sourcePaths:src,targetPaths:dst,pairs,records,
        mode:state?.morph?.mode||'',
        lampCycleSerial:Number(runtimeState?.morph?.lampCycleSerial)||0,
        radialEnabled,chaosCalm,vertexCountHint,
        optionKey:`r:${radialEnabled?1:0}|v:${vertexCountHint}`,
        drawResult:[]
    };
    morphFramePipelineRuntime.stats.planBuilds++;
    return plan;
}

function getMorphFrameInterpolationPlan(layerIndex,sourcePaths,targetPaths,variant='canonical',options=null){
    const bucket=getMorphFramePlanBucket(layerIndex);
    const opt=options&&typeof options==='object'?options:{};
    const defaultRadial=Boolean(state?.morph?.options?.byVertices||state?.morph?.options?.bySteps||state?.morph?.monoOrbitTransforms);
    const radialEnabled=opt.forceRadial===true?true:(opt.forceRadial===false?false:defaultRadial);
    const vertexCountHint=Math.max(0,Math.round(Number(opt.vertexCountHint ?? state?.layers?.[layerIndex]?.N)||0));
    const optionKey=`r:${radialEnabled?1:0}|v:${vertexCountHint}`;
    const cacheKey=`${variant}|${optionKey}`;
    let plan=bucket[cacheKey];
    const serial=morphFramePipelineRuntime.serial;
    if(plan&&plan.serial===serial&&plan.sourcePaths===sourcePaths&&plan.targetPaths===targetPaths&&
       plan.mode===(state?.morph?.mode||'')&&plan.lampCycleSerial===(Number(runtimeState?.morph?.lampCycleSerial)||0)&&plan.optionKey===optionKey){
        morphFramePipelineRuntime.stats.planHits++;
        return plan;
    }
    plan=buildMorphFrameInterpolationPlan(layerIndex,sourcePaths,targetPaths,variant,{...opt,forceRadial:radialEnabled,vertexCountHint});
    bucket[cacheKey]=plan;
    if(runtimeState?.morph){
        const list=runtimeState.morph._frameInterpolationPlans||(runtimeState.morph._frameInterpolationPlans=[]);
        if(variant==='canonical')list[layerIndex]=plan;
    }
    return plan;
}

function prepareMorphFrameInterpolationPlans(){
    const source=runtimeState?.morph?.sourceGeometry||[];
    const target=runtimeState?.morph?.targetGeometry||[];
    const count=Math.max(source.length,target.length,state?.layers?.length||0);
    for(let i=0;i<count;i++){
        const src=source[i]||[],dst=target[i]||[];
        if(src.length&&dst.length)getMorphFrameInterpolationPlan(i,src,dst,'canonical');
    }
    return runtimeState?.morph?._frameInterpolationPlans||[];
}

function ensureMorphScratchPoints(rec,count){
    const out=Array.isArray(rec.scratch)?rec.scratch:(rec.scratch=[]);
    while(out.length<count)out.push({x:0,y:0,widthScale:1});
    if(out.length>count)out.length=count;
    return out;
}

function interpolateMorphFramePlan(plan,t,result,stableRounded=false){
    const u=morphInterpolationTForCurrentMode(t);
    const out=Array.isArray(result)?result:[];
    let write=0;
    if(!plan?.records?.length){out.length=0;return out;}
    for(let ri=0;ri<plan.records.length;ri++){
        const rec=plan.records[ri],sp=rec.sp,dp=rec.dp;
        if(!sp&&!dp)continue;
        let base=null;
        if(sp&&dp){
            const n=rec.n;
            if(!n)continue;
            const scratch=ensureMorphScratchPoints(rec,n);
            // Tag the mutable rail with the frame that owns its current numeric contents.
            // Spiral preprocessing uses this to cache expensive spline tessellation only
            // within the same display frame while still allowing persistent static caches.
            scratch._frameGeometryId=frameGeometryRuntime?.active?frameGeometryRuntime.frameId:0;
            const rotation=rec.rotates?rec.rotationDelta*(1-u):0;
            const c=rec.rotates?Math.cos(rotation):1;
            const s=rec.rotates?Math.sin(rotation):0;
            const srcXYZ=rec.srcXYZ,dstXYZ=rec.dstXYZ;
            if(rec.useRadial&&rec.srcPolarAligned&&rec.dstPolarAligned){
                const aPolar=rec.srcPolarAligned,bPolar=rec.dstPolarAligned;
                for(let i=0;i<n;i++){
                    const p=i*2,o3=i*3,o=scratch[i];
                    const ar=aPolar[p],aa0=aPolar[p+1];
                    const br=bPolar[p],ba0=bPolar[p+1]+rotation;
                    const rr=ar+(br-ar)*u;
                    // Inline interpolateMorphPolarAngle(): function-call overhead is visible
                    // on 100k-point topology morphs. Calm's ±2-turn contract is preserved.
                    let ad=ba0-aa0;
                    if(plan.mode==='calm'){const lim=Math.PI*4;if(ad>lim)ad=lim;else if(ad<-lim)ad=-lim;}
                    const aa=aa0+ad*u;
                    o.x=rr*Math.cos(aa);o.y=rr*Math.sin(aa);
                    o.widthScale=stableRounded?1:(srcXYZ[o3+2]+(dstXYZ[o3+2]-srcXYZ[o3+2])*u);
                }
                morphFramePipelineRuntime.stats.radialPointUpdates+=n;
            }else if(srcXYZ&&dstXYZ){
                for(let i=0;i<n;i++){
                    const p=i*3,o=scratch[i];
                    const ax=srcXYZ[p],ay=srcXYZ[p+1];
                    let bx=dstXYZ[p],by=dstXYZ[p+1];
                    if(rec.rotates){const rx=bx*c-by*s;by=bx*s+by*c;bx=rx;}
                    o.x=ax+(bx-ax)*u;o.y=ay+(by-ay)*u;
                    o.widthScale=stableRounded?1:(srcXYZ[p+2]+(dstXYZ[p+2]-srcXYZ[p+2])*u);
                }
                morphFramePipelineRuntime.stats.cartesianPointUpdates+=n;
            }else{
                // Defensive compatibility path for plans created by older code in the same
                // browsing session. A fresh v507 plan always has aligned packed endpoints.
                const srcPts=rec.srcPts,dstPts=rec.dstPts,srcLen=srcPts.length,dstLen=dstPts.length,offset=rec.referenceOffset||0;
                for(let i=0;i<n;i++){
                    const si=i%srcLen,di=(i+offset)%dstLen,o=scratch[i],a=srcPts[si],b=dstPts[di];
                    let bx=Number(b?.x)||0,by=Number(b?.y)||0;if(rec.rotates){const rx=bx*c-by*s;by=bx*s+by*c;bx=rx;}
                    o.x=(Number(a?.x)||0)+(bx-(Number(a?.x)||0))*u;o.y=(Number(a?.y)||0)+(by-(Number(a?.y)||0))*u;
                    o.widthScale=stableRounded?1:((Number(a?.widthScale)||1)+((rec.rotates?1:(Number(b?.widthScale)||1))-(Number(a?.widthScale)||1))*u);
                }
                morphFramePipelineRuntime.stats.cartesianPointUpdates+=n;
            }
            base=scratch;
        }else{
            base=sp?.rawPoints||sp?.points||dp?.rawPoints||dp?.points||[];
        }
        if(base?.length>1){
            let item=out[write];if(!item)item=out[write]={};
            item.points=base;
            item.closed=rec.closed;
            item.cornerFlags=stableRounded?[]:(sp?.cornerFlags||dp?.cornerFlags||[]);
            item.bridgeRoundFlags=stableRounded?[]:(sp?.bridgeRoundFlags||dp?.bridgeRoundFlags||[]);
            item._src=sp||null;item._dst=dp||null;
            // Carry baked Spiral metadata through the frame view. Segment-profile rounding
            // is already in source/target geometry and must not be recomputed downstream.
            item.spiralProfileRoundingBaked=Boolean(sp?.spiralProfileRoundingBaked&&dp?.spiralProfileRoundingBaked);
            item.spiralProfileSplineBaked=Boolean(sp?.spiralProfileSplineBaked&&dp?.spiralProfileSplineBaked);
            item.spiralContinuityProtected=Boolean(sp?.spiralContinuityProtected||dp?.spiralContinuityProtected);
            if(stableRounded)item._stableRoundedSplineRail=true;else delete item._stableRoundedSplineRail;
            write++;
        }
    }
    out.length=write;
    out._frameGeometryId=frameGeometryRuntime?.active?frameGeometryRuntime.frameId:0;
    morphFramePipelineRuntime.stats.frameInterpolations++;
    return out;
}

// Compatibility helper for direct drawMorphGeometry() callers. It lets older render
// paths consume the same prepared phase plan instead of re-running pairMorphPaths(),
// rotateMorphPath() and polar unwrap logic in their own draw loop.
function interpolateMorphForDirectDraw(layer,sourcePaths,targetPaths,t,radial=false,variant='direct-draw'){
    const idx=Math.max(-1,Array.isArray(state?.layers)?state.layers.indexOf(layer):-1);
    const plan=getMorphFrameInterpolationPlan(idx,sourcePaths,targetPaths,variant,{forceRadial:Boolean(radial),vertexCountHint:layer?.N});
    morphFramePipelineRuntime.stats.drawPlanUses++;
    return interpolateMorphFramePlan(plan,t,plan.drawResult,false);
}

window.__spiroMorphFramePipelineStatus=()=>({
    serial:morphFramePipelineRuntime.serial,
    reason:morphFramePipelineRuntime.reason,
    layerPlans:morphFramePipelineRuntime.layers.map((bucket,index)=>bucket?{
        layerIndex:index,
        variants:Object.keys(bucket),
        records:Object.fromEntries(Object.entries(bucket).map(([k,v])=>[k,v?.records?.length||0]))
    }:null).filter(Boolean),
    stats:{...morphFramePipelineRuntime.stats}
});
