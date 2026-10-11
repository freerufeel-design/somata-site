// SpiroStar v512 — Web Threads render pass
// Extracted from main pipeline so Web geometry/clip/backend changes stay isolated.
window.__spiroRegisterModule?.('js/render/web-pass');

// v329 — Web Threads use the same two-dimensional Corridor instancing as base geometry.
// The CPU generates one current Web vector for the master contour; WebGPU expands it across
// Corridor copies.  A union clip path preserves the exact v261 inside-contour semantics, so
// concave contours do not gain threads outside their authored shape.
const webGpuCorridorStats={frames:0,masterBuilds:0,stableCommandHits:0,stableCommandStores:0,coreDraws:0,haloDraws:0,copies:0,clipUnions:0,fallbacks:0,lastBackend:'none',lastReason:''};
function getPreparedWebBranches(prepared){
    if(!prepared)return[];
    const out=[];if(prepared.insideEnabled===true)out.push('inside');if(prepared.outsideStraightEnabled===true)out.push('outsideStraight');if(prepared.outsideArcEnabled===true)out.push('outsideArc');
    if(!out.length&&prepared.region==='inside')out.push('inside');else if(!out.length&&prepared.region==='outside')out.push('outsideArc');else if(!out.length&&prepared.region==='combined')out.push('inside','outsideArc');
    return out;
}
function getFrameWebGPUCommands(frameCtx,effect,branch='inside'){
    const prepared=effect?.frameData;if(!prepared)return null;
    prepared._gpuThreadCommandsByBranch=prepared._gpuThreadCommandsByBranch||Object.create(null);
    prepared._gpuThreadCommandsFrameByBranch=prepared._gpuThreadCommandsFrameByBranch||Object.create(null);
    if(prepared._gpuThreadCommandsFrameByBranch[branch]===frameCtx.frameId)return prepared._gpuThreadCommandsByBranch[branch]||null;
    prepared._gpuThreadCommandsFrameByBranch[branch]=frameCtx.frameId;prepared._gpuThreadCommandsByBranch[branch]=null;
    const recBase=mainCtx;recBase.save();
    try{
        applyLayerFrameEffectTransform(recBase,frameCtx);
        const tr=recBase.getTransform(),sig=[branch,tr.a,tr.b,tr.c,tr.d,tr.e,tr.f,Number(prepared.renderWidth||prepared.width)||0,String(prepared.color||''),String(prepared.cfg?.type||'bevel'),String(prepared.style||prepared.cfg?.style||'web')];
        const persistent=prepared.persistentVectorRecord,cache=persistent?.gpuCommandCaches?.[branch];
        if(!prepared.transition&&!prepared.oscillating&&cache){
            const old=cache.sig;let same=Array.isArray(old)&&old.length===sig.length;
            if(same)for(let i=0;i<sig.length;i++){if(typeof sig[i]==='number'){if(Math.abs(Number(old[i])-sig[i])>1e-9){same=false;break;}}else if(old[i]!==sig[i]){same=false;break;}}
            if(same&&cache.commands?.length){prepared._gpuThreadCommandsByBranch[branch]=cache.commands;webGpuCorridorStats.stableCommandHits++;return cache.commands;}
        }
        const rec=createGeometryGLRecordingContext(recBase);
        try{drawWebThreadsAnimated(rec,effect.paths,frameCtx.layer,1,effect.frameData,true,branch);}catch(_){return null;}
        if(rec.unsupported||!rec.commands?.length)return null;
        prepared._gpuThreadCommandsByBranch[branch]=rec.commands;webGpuCorridorStats.masterBuilds++;
        if(!prepared.transition&&!prepared.oscillating&&prepared.animating!==true&&persistent){try{Object.defineProperty(rec.commands,'__spiroWebStable',{value:true,configurable:true});}catch(_){rec.commands.__spiroWebStable=true;}persistent.gpuCommandCaches=persistent.gpuCommandCaches||Object.create(null);persistent.gpuCommandCaches[branch]={sig,commands:rec.commands};webGpuCorridorStats.stableCommandStores++;}
        return rec.commands;
    }finally{recBase.restore();}
}
function buildFrameWebCorridorClip(frameCtx,effect,branch='inside'){
    const prepared=effect?.frameData,source=branch==='inside'?(prepared?.insideClipPath||prepared?.clipPath):(prepared?.outsideClipPath||prepared?.clipPath);
    if(!source)return {supported:true,path:null};
    prepared._gpuThreadClipByBranch=prepared._gpuThreadClipByBranch||Object.create(null);const hit=prepared._gpuThreadClipByBranch[branch];if(hit?.frameId===frameCtx.frameId)return hit.result||{supported:false,path:null};
    if(typeof Path2D!=='function'||typeof Path2D.prototype?.addPath!=='function'){const result={supported:false,path:null};prepared._gpuThreadClipByBranch[branch]={frameId:frameCtx.frameId,result};return result;}
    try{
        const union=new Path2D(),copies=frameCtx.visibleInstances?.copies||[],alphas=frameCtx.visibleInstances?.alphas||[];
        let added=0;
        for(let i=0;i<copies.length;i++){
            if(Math.max(0,Number(alphas[i]??1))<=.0001||!shouldDrawTunnelEffectIndex('web',i,frameCtx,effect.footprint))continue;
            const copy=copies[i];mainCtx.save();
            try{
                applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);applyLayerFrameEffectTransform(mainCtx,frameCtx);
                union.addPath(source,mainCtx.getTransform());added++;
            }finally{mainCtx.restore();}
        }
        webGpuCorridorStats.clipUnions++;const result={supported:true,path:added?union:null};prepared._gpuThreadClipByBranch[branch]={frameId:frameCtx.frameId,result};return result;
    }catch(_){const result={supported:false,path:null};prepared._gpuThreadClipByBranch[branch]={frameId:frameCtx.frameId,result};return result;}
}
function buildFrameWebSceneStencilGeometry(frameCtx,effect){
    const prepared=effect?.frameData;if(!prepared)return{supported:false,vertices:null};
    if(!prepared.insideClipPath&&!prepared.outsideClipPath&&!prepared.clipPath)return{supported:true,vertices:null};
    if(prepared._gpuSceneStencilFrameId===frameCtx.frameId)return prepared._gpuSceneStencilGeometry||{supported:false,vertices:null};
    prepared._gpuSceneStencilFrameId=frameCtx.frameId;
    const paths=prepared.visualPaths||[];let edgeCount=0;for(const p of paths)if(p?.closed===true&&p?.points?.length>=3)edgeCount+=p.points.length;
    if(!edgeCount)return prepared._gpuSceneStencilGeometry={supported:true,vertices:null};
    mainCtx.save();let tr;try{applyLayerFrameEffectTransform(mainCtx,frameCtx);tr=mainCtx.getTransform();}catch(_){mainCtx.restore();return prepared._gpuSceneStencilGeometry={supported:false,vertices:null};}mainCtx.restore();
    const tx=(p)=>({x:tr.a*(Number(p?.x)||0)+tr.c*(Number(p?.y)||0)+tr.e,y:tr.b*(Number(p?.x)||0)+tr.d*(Number(p?.y)||0)+tr.f});
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;const transformed=[];
    for(const path of paths){if(path?.closed!==true||path?.points?.length<3){transformed.push(null);continue;}const pts=path.points.map(tx);transformed.push(pts);for(const p of pts){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}}
    if(!Number.isFinite(minX)||!Number.isFinite(minY))return prepared._gpuSceneStencilGeometry={supported:true,vertices:null};
    const span=Math.max(1,maxX-minX,maxY-minY),anchorX=minX-span-1024,anchorY=minY-span-1024,vertices=new Float32Array(edgeCount*6);let o=0;
    for(const pts of transformed){if(!pts)continue;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];vertices[o++]=anchorX;vertices[o++]=anchorY;vertices[o++]=a.x;vertices[o++]=a.y;vertices[o++]=b.x;vertices[o++]=b.y;}}
    return prepared._gpuSceneStencilGeometry={supported:true,vertices:o===vertices.length?vertices:vertices.slice(0,o)};
}

function compositeWebGPUThreadsWithClip(clipResult){
    mainCtx.save();
    try{
        mainCtx.setTransform(1,0,0,1,0,0);
        if(clipResult?.path){try{mainCtx.clip(clipResult.path,'evenodd');}catch(_){mainCtx.clip(clipResult.path);}}
        return WebGPUStrokeRenderer.composite(mainCtx,'source-over');
    }finally{mainCtx.restore();}
}
function tryRenderCorridorWebThreadsGPU(frameCtx,effect){
    if(effect?.tunnelActive!==true||!WebGPUStrokeRenderer.isReady()||!GeometryGPURenderer.isAvailable())return false;
    const branches=getPreparedWebBranches(effect?.frameData);if(!branches.length)return false;
    // The instanced union clip is exact for the inside branch. Outside parity regions from
    // multiple scaled copies can overlap, so outer branches deliberately use the per-copy
    // GPU path below instead of risking XOR artefacts.
    if(branches.some(branch=>branch!=='inside'))return false;
    const copies=frameCtx.visibleInstances?.copies||[];if(!copies.length)return true;
    let renderedAny=false;
    for(const branch of branches){
        const clipResult=buildFrameWebCorridorClip(frameCtx,effect,branch);if(!clipResult.supported)return false;
        const commands=getFrameWebGPUCommands(frameCtx,effect,branch);if(!commands?.length)continue;
        const opt=buildCorridorGPUOptions(frameCtx,{copyCacheVariant:`web-${branch}`,deferComposite:true,composite:'source-over',dynamicSegments:commands.__spiroWebStable!==true,colorForCopy:()=>effect.frameData?.color||'#ffffff',weightForCopy:(copy,alpha,index)=>shouldDrawTunnelEffectIndex('web',index,frameCtx,effect.footprint)?1:0});
        const coreOk=GeometryGPURenderer.renderCorridor(commands,copies,mainCtx,opt);if(!coreOk)return false;
        if(!compositeWebGPUThreadsWithClip(clipResult))return false;webGpuCorridorStats.coreDraws++;renderedAny=true;
        const haloPx=Math.max(.1,Number(effect.frameData?.haloRadius)||Math.min(6,Math.max(.03,Number(effect.frameData?.renderWidth||effect.frameData?.width)||.6)*2.4)*(Number(frameCtx.frame?.dpr)||1));
        if(LineEffectsGPURenderer.isAvailable()){
            const haloOk=LineEffectsGPURenderer.renderCorridor(commands,copies,mainCtx,{...opt,effectMode:'halo',radiusPx:haloPx,alphaScale:1});
            if(haloOk){compositeWebGPUThreadsWithClip(clipResult);webGpuCorridorStats.haloDraws++;}
        }
    }
    if(!renderedAny)return false;
    webGpuCorridorStats.frames++;webGpuCorridorStats.copies+=copies.length;webGpuCorridorStats.lastBackend='webgl2-corridor';webGpuCorridorStats.lastReason='deferred WebGPU Corridor Web bypassed for correctness';return true;
}
window.__spiroWebGPUThreadStatus=()=>({...webGpuCorridorStats,stroke:WebGPUStrokeRenderer.status(),scene:WebGPUWebThreadSceneRenderer.status()});


// v522.16 — optional corridor cross-links. The historical/self-intersection web remains
// unchanged; this mode adds light connections between the same stable corner anchors on
// adjacent corridor copies. Geometry is tiny (corners × visible copies) and is GPU-rasterized
// through GeometryGPURenderer when available, with Canvas only as an exact fallback.
function renderWebCorridorCrossLinks(frameCtx,effect){
    const data=effect?.frameData,cfg=data?.cfg||frameCtx?.layer?.web;if(effect?.tunnelActive!==true||cfg?.placementMode!=='selfIntersectionCorridor')return false;
    const branchFlags={inside:data?.insideEnabled===true,outsideStraight:data?.outsideStraightEnabled===true,outsideArc:data?.outsideArcEnabled===true};
    const corners=(data?.corners||[]).filter(c=>c?.concave===true?branchFlags.outsideStraight:(branchFlags.inside||branchFlags.outsideArc));if(!corners.length)return false;
    const copies=frameCtx.visibleInstances?.copies||[],alphas=frameCtx.visibleInstances?.alphas||[];if(copies.length<2)return false;
    const transforms=[];
    for(let i=0;i<copies.length;i++){
        mainCtx.save();try{applyMotionTunnelLag(mainCtx,copies[i],frameCtx.layer);mainCtx.scale(copies[i].scale,copies[i].scale);applyLayerFrameEffectTransform(mainCtx,frameCtx);transforms.push(mainCtx.getTransform());}finally{mainCtx.restore();}
    }
    const dpr=Math.max(1,Number(frameCtx.frame?.dpr)||1),width=Math.max(.03,Number(data?.renderWidth||data?.width)||.6)*dpr,color=data?.color||'#ffffff';
    const draw=(ctx)=>{
        ctx.lineWidth=width;ctx.strokeStyle=color;ctx.lineCap='round';ctx.lineJoin='round';
        const limit=Math.min(64,corners.length);
        for(let ci=0;ci<limit;ci++){
            const c=corners[ci];
            for(let i=0;i<transforms.length-1;i++){
                const a=Math.max(0,Math.min(1,Number(alphas[i]??1))),b=Math.max(0,Math.min(1,Number(alphas[i+1]??1))),aa=Math.min(a,b)*.42;if(aa<=.002)continue;
                const m0=transforms[i],m1=transforms[i+1],x=Number(c.x)||0,y=Number(c.y)||0;
                const x0=m0.a*x+m0.c*y+m0.e,y0=m0.b*x+m0.d*y+m0.f,x1=m1.a*x+m1.c*y+m1.e,y1=m1.b*x+m1.d*y+m1.f;
                ctx.globalAlpha=aa;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
            }
        }
    };
    mainCtx.save();mainCtx.setTransform(1,0,0,1,0,0);
    try{
        if(typeof GeometryGPURenderer!=='undefined'&&GeometryGPURenderer.isAvailable?.()){
            const rec=createGeometryGLRecordingContext(mainCtx);try{draw(rec);}catch(_){return false;}if(!rec.unsupported&&rec.commands?.length&&GeometryGPURenderer.render(rec.commands,mainCtx)){GeometryGPURenderer.composite?.(mainCtx);return true;}
        }
        draw(mainCtx);return true;
    }finally{mainCtx.restore();}
}

function renderLayerWebPass(frameCtx) {
    const strictSpiralGpu=typeof isStrictSpiralWebGPUFrame==='function'?isStrictSpiralWebGPUFrame(frameCtx):Boolean(frameCtx?.layer&&typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer)&&state?.fourierMode!==true);
    if(frameCtx?._webRenderedUnderBase===true)return;
    const effect=frameCtx.effectsPlan?.web;if(!effect?.enabled)return;
    const {layer,baseAlpha,visibleInstances}=frameCtx;
    // v517 native topology-Morph Web remains the zero-CPU-geometry fast path for the
    // simple inside branch. Multi-branch/oscillating/visibility-transition cases use
    // the exact command path below, but are still rasterized by WebGPU/WebGL2.
    if(effect.frameData?.gpuMorphWebNative===true){
        if(frameCtx.frame?.gpuLayerSceneDeferred){
            const scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId);let rec=null;
            if(scene?.texture){mainCtx.save();applyLayerFrameEffectTransform(mainCtx,frameCtx);rec=effect.tunnelActive===true?WebGPUWebMorphRenderer.encodeCorridorToLayerScene(scene.texture,effect.frameData,mainCtx,baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint):WebGPUWebMorphRenderer.encodeToLayerScene(scene.texture,effect.frameData,mainCtx,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),frameCtx);mainCtx.restore();}
            if(rec?.handled){webGpuCorridorStats.lastBackend='webgpu-morph-scene';webGpuCorridorStats.lastReason='';renderBackendTelemetry.mark('web','gpu','shared GPU-topology Web');if(rec.commandBuffer){const phase=strictSpiralGpu?4.5:40;queueLayerSceneEffectCommand(frameCtx,phase,rec.commandBuffer,effect.tunnelActive===true?'web-morph-corridor':'web-morph',rec.onSubmitted);}return;}
        }
        if(strictSpiralGpu){webGpuCorridorStats.lastBackend='webgpu-wait';webGpuCorridorStats.lastReason='Spiral GPU-only Web resource unavailable';renderBackendTelemetry.mark('web','gpu','Spiral Web GPU-only warmup');somataGpuContractError?.('SPIRAL_WEB_GPU_RESOURCE_UNAVAILABLE',frameCtx,{stage:'morph-native',bridge:window.__spiroGpuMorphWebBridgeStatus?.()||null,arc:window.__spiroGpuMorphArcStatus?.()||null,corner:window.__spiroGpuWebCornerStatus?.()||null,renderer:window.__spiroGpuMorphWebStatus?.()||null});return;}
        materializeGpuMorphWebCpuFallback(frameCtx,effect,'gpu-web-render-failed');if(!effect.frameData?.enabled||!effect.paths?.length)return;
    }

    const branches=getPreparedWebBranches(effect.frameData);if(!branches.length)return;
    if(frameCtx.frame?.gpuLayerSceneDeferred){
        const clip=buildFrameWebSceneStencilGeometry(frameCtx,effect),scene=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId);
        let anyCommands=false,allHandled=true,queued=0;
        if(effect.tunnelActive!==true&&clip?.supported&&scene?.texture){
            for(let bi=0;bi<branches.length;bi++){
                const branch=branches[bi],commands=getFrameWebGPUCommands(frameCtx,effect,branch);if(!commands?.length)continue;anyCommands=true;
                const haloPx=Math.max(.1,Number(effect.frameData?.haloRadius)||Math.min(6,Math.max(.03,Number(effect.frameData?.renderWidth||effect.frameData?.width)||.6)*2.4)*(Number(frameCtx.frame?.dpr)||1));
                const clipMode=(branch==='inside'||!clip?.vertices?.length)?'inside':'outside';
                const rec=WebGPUWebThreadSceneRenderer.encodeToLayerScene(scene.texture,commands,clip,haloPx,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),frameCtx,clipMode);
                if(!rec?.handled){allHandled=false;break;}if(rec.commandBuffer){queueLayerSceneEffectCommand(frameCtx,40+bi*.01,rec.commandBuffer,`web-${branch}`);queued++;}
            }
            if(allHandled&&(anyCommands||!(effect.frameData?.corners?.length))){webGpuCorridorStats.lastBackend='webgpu-scene';webGpuCorridorStats.lastReason='';renderBackendTelemetry.mark('web','gpu','deferred GPU web');return;}
        }
        if(strictSpiralGpu){webGpuCorridorStats.lastBackend='webgpu-wait';webGpuCorridorStats.lastReason='Spiral Web stays WebGPU-only';somataGpuContractError?.('SPIRAL_WEB_LAYER_SCENE_ENCODE_FAILED',frameCtx,{branches});return;}
        if(!materializeDeferredLayerScene(frameCtx))return;
    }

    if(strictSpiralGpu){webGpuCorridorStats.lastBackend='webgpu-wait';webGpuCorridorStats.lastReason='No Canvas/WebGL fallback allowed for Spiral Web';renderBackendTelemetry.mark('web','gpu','Spiral Web GPU-only path');somataGpuContractError?.('SPIRAL_WEB_NO_FULL_GPU_PATH',frameCtx,{branches});return;}
    if(tryRenderCorridorWebThreadsGPU(frameCtx,effect)){renderBackendTelemetry.mark('web','gpu','WebGL2 Corridor web (correctness fallback from deferred WebGPU)');if(effect.frameData?.cfg?.placementMode==='selfIntersectionCorridor')renderWebCorridorCrossLinks(frameCtx,effect);return;}
    if(effect.tunnelActive===true&&WebGPUStrokeRenderer.isReady())webGpuCorridorStats.fallbacks++;
    const glReady=GeometryGPURenderer.isAvailable();let usedGpu=false,usedCanvas=false;
    for(let wi=0;wi<visibleInstances.copies.length;wi++){
        const copy=visibleInstances.copies[wi],a=visibleInstances.alphas[wi];if(!shouldDrawTunnelEffectIndex('web',wi,frameCtx,effect.footprint))continue;
        mainCtx.save();if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
        for(const branch of branches){
            mainCtx.save();let renderedGL=false;
            const clipPath=branch==='inside'?(effect.frameData?.insideClipPath||effect.frameData?.clipPath):(effect.frameData?.outsideClipPath||effect.frameData?.clipPath);
            if(glReady){
                const rec=createGeometryGLRecordingContext(mainCtx);try{drawWebThreadsAnimated(rec,effect.paths,layer,baseAlpha*a,effect.frameData,true,branch);}catch(_){ }
                if(!rec.unsupported&&rec.commands?.length){
                    if(clipPath){try{mainCtx.clip(clipPath,'evenodd');}catch(_err){mainCtx.clip(clipPath);}}
                    const haloPx=Math.max(.1,Number(effect.frameData?.haloRadius)||Math.min(6,Math.max(.03,Number(effect.frameData?.renderWidth||effect.frameData?.width)||.6)*2.4)*(Number(frameCtx.frame?.dpr)||1));
                    if(LineEffectsGPURenderer.isAvailable())LineEffectsGPURenderer.render(rec.commands,mainCtx,{mode:'halo',radiusPx:haloPx,alphaScale:1,composite:'source-over'});
                    renderedGL=GeometryGPURenderer.render(rec.commands,mainCtx);
                }
            }
            if(!renderedGL){usedCanvas=true;drawWebThreadsAnimated(mainCtx,effect.paths,layer,baseAlpha*a,effect.frameData,true,branch);}else usedGpu=true;
            mainCtx.restore();
        }
        mainCtx.restore();
    }
    if(usedGpu){webGpuCorridorStats.lastBackend='webgl2';webGpuCorridorStats.lastReason='';renderBackendTelemetry.mark('web','gpu','GPU web');}
    if(usedCanvas){webGpuCorridorStats.lastBackend=usedGpu?'mixed':'canvas';webGpuCorridorStats.lastReason='GPU Web fallback unavailable for one or more branches';renderBackendTelemetry.mark('web','canvas','Canvas web fallback',true);}
    if(effect.frameData?.cfg?.placementMode==='selfIntersectionCorridor')renderWebCorridorCrossLinks(frameCtx,effect);
}
