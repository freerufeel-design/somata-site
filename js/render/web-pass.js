window.__spiroRegisterModule?.('js/render/web-pass');

const webGpuCorridorStats={frames:0,commandBuilds:0,commandHits:0,crossLinkFrames:0,failures:0,lastBackend:'none',lastReason:''};
function getPreparedWebBranches(prepared){if(!prepared)return[];const out=[];if(prepared.insideEnabled===true)out.push('inside');if(prepared.outsideStraightEnabled===true)out.push('outsideStraight');if(prepared.outsideArcEnabled===true)out.push('outsideArc');if(!out.length&&prepared.region==='inside')out.push('inside');else if(!out.length&&prepared.region==='outside')out.push('outsideArc');else if(!out.length&&prepared.region==='combined')out.push('inside','outsideArc');return out;}
function getFrameWebGPUCommands(frameCtx,effect,branch='inside'){
    const prepared=effect?.frameData;if(!prepared)return null;prepared._gpuThreadCommandsByBranch=prepared._gpuThreadCommandsByBranch||Object.create(null);prepared._gpuThreadCommandsFrameByBranch=prepared._gpuThreadCommandsFrameByBranch||Object.create(null);
    if(prepared._gpuThreadCommandsFrameByBranch[branch]===frameCtx.frameId){webGpuCorridorStats.commandHits++;return prepared._gpuThreadCommandsByBranch[branch]||null;}
    prepared._gpuThreadCommandsFrameByBranch[branch]=frameCtx.frameId;prepared._gpuThreadCommandsByBranch[branch]=null;mainCtx.save();
    try{applyLayerFrameEffectTransform(mainCtx,frameCtx);const rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,effect.paths,frameCtx.layer,1,effect.frameData,true,branch);if(rec.unsupported||!rec.commands?.length)return null;try{Object.defineProperty(rec.commands,'__spiroWebStable',{value:prepared.transition==null&&prepared.oscillating!==true&&prepared.animating!==true,configurable:true});}catch(_){}prepared._gpuThreadCommandsByBranch[branch]=rec.commands;webGpuCorridorStats.commandBuilds++;return rec.commands;}catch(err){webGpuCorridorStats.failures++;webGpuCorridorStats.lastReason=String(err?.message||err);return null;}finally{mainCtx.restore();}
}
function buildFrameWebSceneStencilGeometry(frameCtx,effect){
    const prepared=effect?.frameData;if(!prepared)return{supported:false,vertices:null};if(!prepared.insideClipPath&&!prepared.outsideClipPath&&!prepared.clipPath)return{supported:true,vertices:null};if(prepared._gpuSceneStencilFrameId===frameCtx.frameId)return prepared._gpuSceneStencilGeometry||{supported:false,vertices:null};prepared._gpuSceneStencilFrameId=frameCtx.frameId;
    const paths=prepared.visualPaths||[];let edgeCount=0;for(const p of paths)if(p?.closed===true&&p?.points?.length>=3)edgeCount+=p.points.length;if(!edgeCount)return prepared._gpuSceneStencilGeometry={supported:true,vertices:null};
    mainCtx.save();let tr;try{applyLayerFrameEffectTransform(mainCtx,frameCtx);tr=mainCtx.getTransform();}catch(_){return prepared._gpuSceneStencilGeometry={supported:false,vertices:null};}finally{mainCtx.restore();}
    const tx=p=>({x:tr.a*(Number(p?.x)||0)+tr.c*(Number(p?.y)||0)+tr.e,y:tr.b*(Number(p?.x)||0)+tr.d*(Number(p?.y)||0)+tr.f});let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;const transformed=[];
    for(const path of paths){if(path?.closed!==true||path?.points?.length<3){transformed.push(null);continue;}const pts=path.points.map(tx);transformed.push(pts);for(const p of pts){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}}
    if(!Number.isFinite(minX)||!Number.isFinite(minY))return prepared._gpuSceneStencilGeometry={supported:true,vertices:null};const span=Math.max(1,maxX-minX,maxY-minY),anchorX=minX-span-1024,anchorY=minY-span-1024,vertices=new Float32Array(edgeCount*6);let o=0;
    for(const pts of transformed){if(!pts)continue;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];vertices[o++]=anchorX;vertices[o++]=anchorY;vertices[o++]=a.x;vertices[o++]=a.y;vertices[o++]=b.x;vertices[o++]=b.y;}}
    return prepared._gpuSceneStencilGeometry={supported:true,vertices:o===vertices.length?vertices:vertices.slice(0,o)};
}
function queueWebCorridorCrossLinks(frameCtx,effect,sceneTexture,phase=somataEffectPhase('web',.4)){
    const data=effect?.frameData,cfg=data?.cfg||frameCtx?.layer?.web;if(effect?.tunnelActive!==true||cfg?.placementMode!=='selfIntersectionCorridor')return true;const flags={inside:data?.insideEnabled===true,outsideStraight:data?.outsideStraightEnabled===true,outsideArc:data?.outsideArcEnabled===true};const corners=(data?.corners||[]).map((c,i)=>{const m=data?.cornerMetrics?.[i];return m?{...c,x:m.x,y:m.y,visualPathIndex:m.pathIndex}:c;}).filter(c=>c?.concave===true?flags.outsideStraight:(flags.inside||flags.outsideArc));const copies=frameCtx.visibleInstances?.copies||[],alphas=frameCtx.visibleInstances?.alphas||[];if(!corners.length||copies.length<2)return true;
    const transforms=[];for(let i=0;i<copies.length;i++){mainCtx.save();try{applyMotionTunnelLag(mainCtx,copies[i],frameCtx.layer);mainCtx.scale(copies[i].scale,copies[i].scale);applyLayerFrameEffectTransform(mainCtx,frameCtx);transforms.push(mainCtx.getTransform());}finally{mainCtx.restore();}}
    mainCtx.save();try{mainCtx.setTransform(1,0,0,1,0,0);const rec=createGeometryGLRecordingContext(mainCtx),width=Math.max(.03,Number(data?.renderWidth||data?.width)||.6),color=data?.color||'#ffffff';rec.lineWidth=width;rec.strokeStyle=color;rec.lineCap='round';rec.lineJoin='round';const limit=Math.min(64,corners.length);for(let ci=0;ci<limit;ci++){const c=corners[ci],x=Number(c.x)||0,y=Number(c.y)||0;for(let i=0;i<transforms.length-1;i++){const a=Math.max(0,Math.min(1,Number(alphas[i]??1))),b=Math.max(0,Math.min(1,Number(alphas[i+1]??1))),aa=Math.min(a,b)*.42;if(aa<=.002)continue;const m0=transforms[i],m1=transforms[i+1];rec.globalAlpha=aa;rec.beginPath();rec.moveTo(m0.a*x+m0.c*y+m0.e,m0.b*x+m0.d*y+m0.f);rec.lineTo(m1.a*x+m1.c*y+m1.e,m1.b*x+m1.d*y+m1.f);rec.stroke();}}if(rec.unsupported||!rec.commands?.length)return true;const halo=Math.max(.1,Math.min(6,width*2.4)*(Number(frameCtx.frame?.dpr)||1)),out=WebGPUWebThreadSceneRenderer.encodeToLayerScene(sceneTexture,rec.commands,{supported:true,vertices:null},halo,1,frameCtx,'inside');if(!out?.handled)return false;if(out.commandBuffer)SomataLayerSceneService.queue(frameCtx,phase,out.commandBuffer,'web-corridor-crosslinks');webGpuCorridorStats.crossLinkFrames++;return true;}finally{mainCtx.restore();}
}
// 7.8.3 bugfix: ordinary Web keeps the exact current FrameContour as its source,
// but restores the resilient 7.3.20 presentation ladder.  A WebGPU scene/renderer
// warm-up miss must not make an otherwise valid Web disappear.  Strict Spiral is
// deliberately excluded: its retained Bézier rail remains GPU-only and exact.
function renderWebCorridorCrossLinksFallback(frameCtx,effect){
    const data=effect?.frameData,cfg=data?.cfg||frameCtx?.layer?.web;if(effect?.tunnelActive!==true||cfg?.placementMode!=='selfIntersectionCorridor')return false;
    const branchFlags={inside:data?.insideEnabled===true,outsideStraight:data?.outsideStraightEnabled===true,outsideArc:data?.outsideArcEnabled===true};
    const corners=(data?.corners||[]).map((c,i)=>{const m=data?.cornerMetrics?.[i];return m?{...c,x:m.x,y:m.y}:c;}).filter(c=>c?.concave===true?branchFlags.outsideStraight:(branchFlags.inside||branchFlags.outsideArc));if(!corners.length)return false;
    const copies=frameCtx.visibleInstances?.copies||[],alphas=frameCtx.visibleInstances?.alphas||[];if(copies.length<2)return false;
    const transforms=[];for(let i=0;i<copies.length;i++){mainCtx.save();try{applyMotionTunnelLag(mainCtx,copies[i],frameCtx.layer);mainCtx.scale(copies[i].scale,copies[i].scale);applyLayerFrameEffectTransform(mainCtx,frameCtx);transforms.push(mainCtx.getTransform());}finally{mainCtx.restore();}}
    const dpr=Math.max(1,Number(frameCtx.frame?.dpr)||1),width=Math.max(.03,Number(data?.renderWidth||data?.width)||.6)*dpr,color=data?.color||'#ffffff';
    const draw=(ctx)=>{ctx.lineWidth=width;ctx.strokeStyle=color;ctx.lineCap='round';ctx.lineJoin='round';const limit=Math.min(64,corners.length);for(let ci=0;ci<limit;ci++){const c=corners[ci];for(let i=0;i<transforms.length-1;i++){const a=Math.max(0,Math.min(1,Number(alphas[i]??1))),b=Math.max(0,Math.min(1,Number(alphas[i+1]??1))),aa=Math.min(a,b)*.42;if(aa<=.002)continue;const m0=transforms[i],m1=transforms[i+1],x=Number(c.x)||0,y=Number(c.y)||0,x0=m0.a*x+m0.c*y+m0.e,y0=m0.b*x+m0.d*y+m0.f,x1=m1.a*x+m1.c*y+m1.e,y1=m1.b*x+m1.d*y+m1.f;ctx.globalAlpha=aa;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();}}};
    mainCtx.save();mainCtx.setTransform(1,0,0,1,0,0);try{if(typeof GeometryGPURenderer!=='undefined'&&GeometryGPURenderer.isAvailable?.()){const rec=createGeometryGLRecordingContext(mainCtx);try{draw(rec);}catch(_){return false;}if(!rec.unsupported&&rec.commands?.length&&GeometryGPURenderer.render(rec.commands,mainCtx)){GeometryGPURenderer.composite?.(mainCtx);return true;}}draw(mainCtx);return true;}finally{mainCtx.restore();}
}
function renderOrdinaryWebFallback(frameCtx,effect,reason='gpu-web-unavailable'){
    if(!frameCtx||!effect||SomataGeometryPolicy.isStrict(frameCtx))return false;
    const branches=getPreparedWebBranches(effect.frameData);if(!branches.length)return false;
    // Preserve anything already queued below Web (Fill by default) before drawing the
    // Canvas/WebGL fallback.  This is the same correctness principle used by 7.3.20.
    if(frameCtx.frame?.gpuLayerSceneDeferred&&!materializeDeferredLayerScene(frameCtx))return false;
    const {layer,baseAlpha,visibleInstances}=frameCtx,copies=visibleInstances?.copies||[],alphas=visibleInstances?.alphas||[];
    const glReady=(typeof somataGpuBackendAllowed!=='function'||somataGpuBackendAllowed())&&typeof GeometryGPURenderer!=='undefined'&&GeometryGPURenderer.isAvailable?.();
    let usedGpu=false,usedCanvas=false,drewAny=false;
    for(let wi=0;wi<copies.length;wi++){
        const copy=copies[wi],a=Math.max(0,Math.min(1,Number(alphas[wi]??1)));if(a<=.0001||!shouldDrawTunnelEffectIndex('web',wi,frameCtx,effect.footprint))continue;
        mainCtx.save();try{
            if(effect.tunnelActive){applyMotionTunnelLag(mainCtx,copy,frameCtx.layer);mainCtx.scale(copy.scale,copy.scale);}applyLayerFrameEffectTransform(mainCtx,frameCtx);
            for(const branch of branches){
                const masterCommands=getFrameWebGPUCommands(frameCtx,effect,branch);if(!masterCommands?.length)continue;drewAny=true;
                mainCtx.save();try{
                    const clipPath=branch==='inside'?(effect.frameData?.insideClipPath||effect.frameData?.clipPath):(effect.frameData?.outsideClipPath||effect.frameData?.clipPath);let renderedGL=false;
                    if(glReady){const rec=createGeometryGLRecordingContext(mainCtx);try{drawWebThreadsAnimated(rec,effect.paths,layer,baseAlpha*a,effect.frameData,true,branch);}catch(_){}if(!rec.unsupported&&rec.commands?.length){if(clipPath){try{mainCtx.clip(clipPath,'evenodd');}catch(_){mainCtx.clip(clipPath);}}const haloPx=Math.max(.1,Number(effect.frameData?.haloRadius)||Math.min(6,Math.max(.03,Number(effect.frameData?.renderWidth||effect.frameData?.width)||.6)*2.4)*(Number(frameCtx.frame?.dpr)||1));if(typeof LineEffectsGPURenderer!=='undefined'&&LineEffectsGPURenderer.isAvailable?.())LineEffectsGPURenderer.render(rec.commands,mainCtx,{mode:'halo',radiusPx:haloPx,alphaScale:1,composite:'source-over'});renderedGL=GeometryGPURenderer.render(rec.commands,mainCtx);}}
                    if(renderedGL)usedGpu=true;else{if(clipPath){try{mainCtx.clip(clipPath,'evenodd');}catch(_){mainCtx.clip(clipPath);}}drawWebThreadsAnimated(mainCtx,effect.paths,layer,baseAlpha*a,effect.frameData,true,branch);usedCanvas=true;}
                }finally{mainCtx.restore();}
            }
        }finally{mainCtx.restore();}
    }
    if(effect.frameData?.cfg?.placementMode==='selfIntersectionCorridor'&&effect.tunnelActive===true)renderWebCorridorCrossLinksFallback(frameCtx,effect);
    if(!drewAny)return false;
    frameCtx._webPassHandled=true;webGpuCorridorStats.frames++;webGpuCorridorStats.lastBackend=usedGpu?(usedCanvas?'mixed-fallback':'webgl2-fallback'):'canvas-fallback';webGpuCorridorStats.lastReason=String(reason||'gpu-web-unavailable');renderBackendTelemetry.mark('web',usedGpu?'gpu':'canvas',usedGpu?'Web fallback (WebGL2)':'Web fallback (Canvas)',true);return true;
}

function renderLayerWebPass(frameCtx){
    if(frameCtx)frameCtx._webPassHandled=false;
    const effect=frameCtx.effectsPlan?.web;if(!effect?.enabled)return;const {baseAlpha,visibleInstances}=frameCtx,strict=SomataGeometryPolicy.isStrict(frameCtx);
    const ordinaryOrdered=state.tunnel?.active!==true&&!strict,fillContract=ordinaryOrdered?getLayerGeometryContract(frameCtx):null;
    if(fillContract?.fillRequested===true&&frameCtx._fillBelowWebResolved!==true){webGpuCorridorStats.lastBackend='gpu-wait';webGpuCorridorStats.lastReason='Fill ordering pass has not resolved yet';try{requestMainCanvasRender?.();}catch(_){}return;}
    const scene=SomataLayerSceneService.ensure(frameCtx,'web-effect');
    if(!frameCtx.frame?.gpuLayerSceneDeferred||!scene?.texture){
        if(!strict&&renderOrdinaryWebFallback(frameCtx,effect,'Layer Scene unavailable'))return;
        webGpuCorridorStats.failures++;webGpuCorridorStats.lastBackend='gpu-wait';webGpuCorridorStats.lastReason='Layer Scene unavailable';somataGpuDiagnosticError?.('web','layer-scene','GPU Layer Scene unavailable; Web skipped for this frame and will retry on the next repaint',frameCtx,{fallback:strict?'wait-for-exact-spiral-web':'ordinary-web-fallback-failed',recovered:!strict});try{requestMainCanvasRender?.();}catch(_){}return;
    }
    if(effect.frameData?.gpuMorphWebNative===true){
        mainCtx.save();let out=null;try{applyLayerFrameEffectTransform(mainCtx,frameCtx);out=effect.tunnelActive===true?WebGPUWebMorphRenderer.encodeCorridorToLayerScene(scene.texture,effect.frameData,mainCtx,baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint):WebGPUWebMorphRenderer.encodeToLayerScene(scene.texture,effect.frameData,mainCtx,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),frameCtx);}finally{mainCtx.restore();}
        if(out?.handled){frameCtx._webPassHandled=true;if(out.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('web'),out.commandBuffer,effect.tunnelActive?'web-morph-corridor':'web-morph',out.onSubmitted);webGpuCorridorStats.frames++;webGpuCorridorStats.lastBackend='webgpu-morph';webGpuCorridorStats.lastReason='';renderBackendTelemetry.mark('web','gpu','GPU Morph Web');return;}
        somataGpuDiagnosticError?.('web','morph','GPU Morph Web resource unavailable',frameCtx,{status:window.__spiroGpuMorphWebStatus?.()||null});try{requestMainCanvasRender?.();}catch(_){}return;
    }
    const threadStatus=WebGPUWebThreadSceneRenderer.status?.()||{};
    if(threadStatus.available!==true){try{WebGPUWebThreadSceneRenderer.warmup?.();requestMainCanvasRender?.();}catch(_){}if(renderOrdinaryWebFallback(frameCtx,effect,threadStatus.initializing===true?'Web Thread renderer warming':'Web Thread renderer unavailable'))return;webGpuCorridorStats.lastBackend='gpu-warmup';webGpuCorridorStats.lastReason=threadStatus.initializing===true?'Web Thread renderer initializing':'Web Thread renderer unavailable';if(threadStatus.initializing!==true&&threadStatus.lastError)somataGpuDiagnosticError?.('web','renderer-init',threadStatus.lastError,frameCtx,{status:threadStatus,fallback:'ordinary-web-fallback-failed',recovered:true});return;}
    const branches=getPreparedWebBranches(effect.frameData),clip=buildFrameWebSceneStencilGeometry(frameCtx,effect);if(!clip?.supported){if(renderOrdinaryWebFallback(frameCtx,effect,'GPU Web clip geometry unavailable'))return;somataGpuDiagnosticError?.('web','clip','GPU Web clip geometry unavailable',frameCtx);try{requestMainCanvasRender?.();}catch(_){}return;}
    const records=[];let encodeFailed=false;
    for(let bi=0;bi<branches.length;bi++){
        const branch=branches[bi],commands=getFrameWebGPUCommands(frameCtx,effect,branch);if(!commands?.length)continue;const halo=Math.max(.1,Number(effect.frameData?.haloRadius)||Math.min(6,Math.max(.03,Number(effect.frameData?.renderWidth||effect.frameData?.width)||.6)*2.4)*(Number(frameCtx.frame?.dpr)||1)),clipMode=(branch==='inside'||!clip?.vertices?.length)?'inside':'outside';mainCtx.save();let out=null;try{applyLayerFrameEffectTransform(mainCtx,frameCtx);out=effect.tunnelActive===true?WebGPUWebThreadSceneRenderer.encodeCorridorToLayerScene(scene.texture,commands,clip,halo,baseAlpha,visibleInstances.copies,visibleInstances.alphas,frameCtx,effect.footprint,mainCtx,clipMode):WebGPUWebThreadSceneRenderer.encodeToLayerScene(scene.texture,commands,clip,halo,baseAlpha*Math.max(0,Math.min(1,Number(visibleInstances.alphas?.[0]??1))),frameCtx,clipMode);}finally{mainCtx.restore();}
        if(!out?.handled){encodeFailed=true;webGpuCorridorStats.failures++;webGpuCorridorStats.lastReason=`branch ${branch} encode failed`;break;}records.push({branch,bi,out});
    }
    if(encodeFailed){if(renderOrdinaryWebFallback(frameCtx,effect,webGpuCorridorStats.lastReason))return;somataGpuDiagnosticError?.('web','encode',webGpuCorridorStats.lastReason,frameCtx,{status:WebGPUWebThreadSceneRenderer.status?.()||null});try{requestMainCanvasRender?.();}catch(_){}return;}
    if(records.length){for(const rec of records)if(rec.out.commandBuffer)SomataLayerSceneService.queue(frameCtx,somataEffectPhase('web',rec.bi*.01),rec.out.commandBuffer,`web-${rec.branch}`);if(queueWebCorridorCrossLinks(frameCtx,effect,scene.texture,somataEffectPhase('web',.4))){frameCtx._webPassHandled=true;webGpuCorridorStats.frames++;webGpuCorridorStats.lastBackend='webgpu-scene';webGpuCorridorStats.lastReason='';renderBackendTelemetry.mark('web','gpu','GPU Web');return;}}
    // Empty GPU record is not a renderer failure when the selected mode legitimately has
    // no threads, but if the prepared ordinary geometry does have commands, present them
    // through the proven fallback rather than silently dropping the effect.
    if(!strict&&renderOrdinaryWebFallback(frameCtx,effect,'GPU Web produced no queued records'))return;
    renderBackendTelemetry.mark('web','gpu','GPU Web skipped; no visible thread records',true);try{requestMainCanvasRender?.();}catch(_){}
}
window.__spiroWebPassStatus=()=>({...webGpuCorridorStats,gpuOnly:false,ordinaryFallback:true,strictSpiralGpuOnly:true,renderer:WebGPUWebThreadSceneRenderer.status?.()||null});

SomataFeatureHost.provide('web','sceneAdmission',(frameCtx)=>{
    const effect=frameCtx?.effectsPlan?.web;if(!effect?.enabled)return true;
    if(!SomataGeometryPolicy.isStrict(frameCtx))return true;
    return{admit:Boolean(effect.frameData&&WebGPUWebThreadSceneRenderer.isReady()),reason:'Strict Spiral Web Layer Scene renderer unavailable'};
});

window.SomataRenderPassRegistry?.register?.('web',{stage:window.SomataRenderPassRegistry.STAGES.OVER_FILL,order:10,run:renderLayerWebPass});
