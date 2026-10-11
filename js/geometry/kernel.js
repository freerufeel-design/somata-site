// SpiroStar v500 Modular Base
// Canonical geometry kernel, Fill mesh preparation and geometry contract
window.__spiroRegisterModule?.('js/geometry/kernel');
        // v364 — GeometryKernel v4: canonical contours + canonical segment index.
        // Closed/open contour identity, bounds, winding diagnostics and Fill eligibility now
        // come from the same zero-copy topology object used by stroke segment consumers.
        // Coordinates remain owned by the historical geometry; descriptors only reference them.
        const GeometryKernel=(()=>{
            let staticCache=new WeakMap(),commandCache=new WeakMap(),dirtyCommands=new WeakSet();
            let staticBuilds=0,staticHits=0,commandBuilds=0,commandHits=0,commandInvalidations=0,commandRefreshes=0,commandRefreshFallbacks=0,segmentDescriptorsBuilt=0,contourDescriptorsBuilt=0;
            let frameViews=0,frameViewHits=0,lazyDynamicViews=0,strokeBindings=0,invalidViews=0;
            const EMPTY_CONTOURS=Object.freeze([]);
            const segmentConsumers={strokePack:0,corridorPack:0,webThreadPack:0,webThreadCorridorPack:0,sharedJoinInspect:0,other:0};
            const contourConsumers={fillPolicy:0,canvasFill:0,nativeFillPrep:0,other:0};
            const emptyStrokeMeta=()=>({
                count:0,segmentCount:0,totalLength:0,pathCount:0,subpathCount:0,pointCount:0,
                closedPathCount:0,openPathCount:0,invalidSegments:0,degenerateSegments:0,
                invalidWidths:0,protectedBrokenPaths:0,collapsedProtectedPaths:0,
                maxWidthRatio:1,sharpJoins:0,continuityRisk:false,hasClosedTopology:false,
                contours:[],fillContours:[],segments:[],sourceKind:'commands'
            });
            function describeStaticContour(path,pathIndex){
                const pts=Array.isArray(path?.points)?path.points:[],closed=path?.closed===true;
                let invalidPointCount=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,signedArea2=0;
                for(let i=0;i<pts.length;i++){
                    const p=pts[i],x=Number(p?.x),y=Number(p?.y);
                    if(!Number.isFinite(x)||!Number.isFinite(y)){invalidPointCount++;continue;}
                    if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
                    if(closed&&pts.length>2){
                        const q=pts[(i+1)%pts.length],qx=Number(q?.x),qy=Number(q?.y);
                        if(Number.isFinite(qx)&&Number.isFinite(qy))signedArea2+=x*qy-qx*y;
                    }
                }
                const finiteBounds=Number.isFinite(minX)&&Number.isFinite(minY)&&Number.isFinite(maxX)&&Number.isFinite(maxY);
                const fillEligible=closed&&pts.length>=3&&invalidPointCount===0;
                contourDescriptorsBuilt++;
                return{
                    sourceKind:'drawData',path,pathIndex,points:pts,closed,pointCount:pts.length,
                    segmentCount:Math.max(0,pts.length-1)+(closed&&pts.length>1?1:0),
                    invalidPointCount,fillEligible,signedArea2,
                    winding:signedArea2>1e-9?'ccw':(signedArea2<-1e-9?'cw':'flat'),
                    bounds:finiteBounds?{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY}:null,
                    cornerFlags:path?.cornerFlags||null,bridgeRoundFlags:path?.bridgeRoundFlags||null
                };
            }
            function summarizePaths(paths){
                let pathCount=0,pointCount=0,segmentCount=0,closedPathCount=0,openPathCount=0,invalidPointCount=0,variableWidthPointCount=0;
                const contours=[],fillContours=[];
                const list=Array.isArray(paths)?paths:[];
                for(let pathIndex=0;pathIndex<list.length;pathIndex++){
                    const path=list[pathIndex],pts=Array.isArray(path?.points)?path.points:[];if(pts.length<1)continue;
                    const contour=describeStaticContour(path,pathIndex);contours.push(contour);
                    pathCount++;pointCount+=contour.pointCount;segmentCount+=contour.segmentCount;
                    invalidPointCount+=contour.invalidPointCount;
                    if(contour.closed)closedPathCount++;else openPathCount++;
                    if(contour.fillEligible)fillContours.push(contour);
                    for(const p of pts)if(Number.isFinite(Number(p?.widthScale)))variableWidthPointCount++;
                }
                return{
                    pathCount,pointCount,segmentCount,closedPathCount,openPathCount,invalidPointCount,variableWidthPointCount,
                    contours,fillContours,fillContourCount:fillContours.length,
                    hasClosedFillTopology:fillContours.length>0&&invalidPointCount===0,sourceKind:'drawData'
                };
            }
            function inspectStaticDrawData(drawData){
                if(!drawData||typeof drawData!=='object')return summarizePaths([]);
                let rec=staticCache.get(drawData);if(rec){staticHits++;return rec;}
                const canonical=typeof getCanonicalGeometryForDrawData==='function'?getCanonicalGeometryForDrawData(drawData):null;
                if(canonical?.kernelView){
                    rec=canonical.kernelView;rec.drawData=drawData;rec.static=true;rec.canonical=canonical;
                    staticCache.set(drawData,rec);staticBuilds++;
                    if(typeof noteCanonicalGeometryConsumer==='function')noteCanonicalGeometryConsumer('GeometryKernel.inspectStaticDrawData');
                    return rec;
                }
                rec={...summarizePaths(drawData.paths),drawData,static:true};
                staticCache.set(drawData,rec);staticBuilds++;return rec;
            }
            // v383 — phase-resident Morph commands keep stable command/subpath/point object
            // identity for the whole transition.  When the topology hash is unchanged, refresh
            // the canonical descriptors in-place instead of deleting and reallocating thousands
            // of segment objects every display frame.  Any degeneracy/invalid value immediately
            // falls back to the exact full rebuild path below.
            function refreshStrokeCommands(commands,meta){
                if(!meta||commands?.__spiroPhaseResidentRecorder!==true)return null;
                const topologyHash=Number(commands.__spiroTopologyHash)||0,phaseSerial=Number(commands.__spiroPhaseSerial)||0;
                if(topologyHash!==Number(meta.topologyHash||0)||phaseSerial!==Number(meta.phaseSerial||0))return null;
                let logicalSegments=0,contourCount=0;
                for(const cmd of commands||[])for(const sp of cmd?.subpaths||[]){const pts=sp?.points||[];logicalSegments+=Math.max(0,pts.length-1)+(sp?.closed===true?1:0);contourCount++;}
                // Reuse is intentionally limited to the common all-valid topology.  A prior or
                // current degenerate segment can shift the compact valid-segment index, so rebuild.
                if(logicalSegments!==meta.segments?.length||contourCount!==meta.contours?.length||meta.invalidSegments||meta.degenerateSegments||meta.invalidWidths)return null;
                let totalLength=0,pathCount=0,subpathCount=0,pointCount=0,closedPathCount=0,openPathCount=0,maxWidthRatio=1,sharpJoins=0;
                let segCursor=0,contourCursor=0,commandIndex=0;
                for(const cmd of commands||[]){
                    const variable=cmd?.__variableWidthSpiral===true;let subpathIndex=0;
                    for(const sp of cmd?.subpaths||[]){
                        const pts=sp?.points||[],closed=sp?.closed===true,n=Math.max(0,pts.length-1)+(closed?1:0);
                        const segAlpha=Array.isArray(sp?.segmentAlphas)||ArrayBuffer.isView(sp?.segmentAlphas)?sp.segmentAlphas:null;
                        const contour=meta.contours[contourCursor++];
                        if(!contour||contour.closed!==closed)return null;
                        subpathCount++;pointCount+=pts.length;if(closed)closedPathCount++;else openPathCount++;
                        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,signedArea2=0;
                        for(let pi=0;pi<pts.length;pi++){
                            const p=pts[pi],x=Number(p?.x),y=Number(p?.y);if(!Number.isFinite(x)||!Number.isFinite(y))return null;
                            if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
                            if(closed&&pts.length>2){const q=pts[(pi+1)%pts.length],qx=Number(q?.x),qy=Number(q?.y);if(!Number.isFinite(qx)||!Number.isFinite(qy))return null;signedArea2+=x*qy-qx*y;}
                        }
                        for(let i=0;i<n;i++){
                            const a=pts[i],b=pts[(i+1)%pts.length],ax=Number(a?.x),ay=Number(a?.y),bx=Number(b?.x),by=Number(b?.y);
                            let wa=1,wb=1;if(variable){wa=Number(a?.widthScale);wb=Number(b?.widthScale);if(!Number.isFinite(wa)||!Number.isFinite(wb))return null;wa=Math.max(.02,wa);wb=Math.max(.02,wb);}
                            const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);if(!Number.isFinite(len)||len<1e-6)return null;
                            const seg=meta.segments[segCursor++];if(!seg||seg.variable!==variable)return null;
                            seg.command=cmd;seg.subpath=sp;seg.points=pts;seg.a=a;seg.b=b;seg.commandIndex=commandIndex;seg.subpathIndex=subpathIndex;seg.segmentIndex=i;
                            seg.ax=ax;seg.ay=ay;seg.bx=bx;seg.by=by;seg.dx=dx;seg.dy=dy;seg.length=len;seg.widthScaleA=wa;seg.widthScaleB=wb;seg.closed=closed;
                            seg.rawAlpha=segAlpha&&Number.isFinite(Number(segAlpha[i]))?Number(segAlpha[i]):Number(cmd?.alpha)||0;
                            totalLength+=len;if(variable)maxWidthRatio=Math.max(maxWidthRatio,wa/wb,wb/wa);
                            if(i>0){const p=pts[i-1],px=Number(p?.x),py=Number(p?.y),pax=ax-px,pay=ay-py,la=Math.hypot(pax,pay);if(la>1e-6&&((pax*dx+pay*dy)/(la*len))<-.35)sharpJoins++;}
                        }
                        contour.sourceKind='commands';contour.command=cmd;contour.subpath=sp;contour.commandIndex=commandIndex;contour.subpathIndex=subpathIndex;contour.points=pts;contour.closed=closed;contour.pointCount=pts.length;contour.segmentCount=n;contour.invalidPointCount=0;
                        contour.fillEligible=closed&&pts.length>=3;contour.signedArea2=signedArea2;contour.winding=signedArea2>1e-9?'ccw':(signedArea2<-1e-9?'cw':'flat');
                        contour.bounds=Number.isFinite(minX)?{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY}:null;
                        if(n>0)pathCount++;subpathIndex++;
                    }
                    commandIndex++;
                }
                if(segCursor!==meta.segments.length||contourCursor!==meta.contours.length)return null;
                meta.count=meta.segmentCount=segCursor;meta.totalLength=totalLength;meta.pathCount=pathCount;meta.subpathCount=subpathCount;meta.pointCount=pointCount;
                meta.closedPathCount=closedPathCount;meta.openPathCount=openPathCount;meta.invalidSegments=0;meta.degenerateSegments=0;meta.invalidWidths=0;meta.protectedBrokenPaths=0;meta.collapsedProtectedPaths=0;
                meta.maxWidthRatio=maxWidthRatio;meta.sharpJoins=sharpJoins;meta.continuityRisk=false;meta.hasClosedTopology=closedPathCount>0;meta.topologyHash=topologyHash;meta.phaseSerial=phaseSerial;meta.frameId=Number(commands.__spiroFrameId)||0;
                return meta;
            }
            function inspectStrokeCommands(commands){
                if(!commands||typeof commands!=='object')return emptyStrokeMeta();
                const hit=commandCache.get(commands);
                if(hit&&dirtyCommands.has(commands)){
                    dirtyCommands.delete(commands);const refreshed=refreshStrokeCommands(commands,hit);
                    if(refreshed){commandHits++;commandRefreshes++;return refreshed;}
                    commandCache.delete(commands);commandRefreshFallbacks++;
                }else if(hit){commandHits++;return hit;}
                let count=0,totalLength=0,pathCount=0,subpathCount=0,pointCount=0,closedPathCount=0,openPathCount=0;
                let invalidSegments=0,degenerateSegments=0,invalidWidths=0,protectedBrokenPaths=0,collapsedProtectedPaths=0,maxWidthRatio=1,sharpJoins=0;
                const segments=[],contours=[],fillContours=[];
                let commandIndex=0;
                for(const cmd of commands||[]){
                    const variable=cmd?.__variableWidthSpiral===true;
                    let subpathIndex=0;
                    for(const sp of cmd?.subpaths||[]){
                        const pts=sp?.points||[],closed=sp?.closed===true,n=Math.max(0,pts.length-1)+(closed?1:0);
                        const segAlpha=Array.isArray(sp?.segmentAlphas)||ArrayBuffer.isView(sp?.segmentAlphas)?sp.segmentAlphas:null;
                        subpathCount++;pointCount+=pts.length;if(closed)closedPathCount++;else openPathCount++;
                        let contourInvalidPoints=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,signedArea2=0,pathValid=0,pathBroken=false;
                        const visitContourPoint=(px,py)=>{
                            if(!Number.isFinite(px)||!Number.isFinite(py)){contourInvalidPoints++;return false;}
                            if(px<minX)minX=px;if(px>maxX)maxX=px;if(py<minY)minY=py;if(py>maxY)maxY=py;return true;
                        };
                        if(pts.length===1)visitContourPoint(Number(pts[0]?.x),Number(pts[0]?.y));
                        for(let i=0;i<n;i++){
                            const a=pts[i],b=pts[(i+1)%pts.length],ax=Number(a?.x),ay=Number(a?.y),bx=Number(b?.x),by=Number(b?.y);
                            const aFinite=visitContourPoint(ax,ay);
                            if(!closed&&i===n-1)visitContourPoint(bx,by);
                            if(closed&&pts.length>2&&aFinite&&Number.isFinite(bx)&&Number.isFinite(by))signedArea2+=ax*by-bx*ay;
                            let wa=1,wb=1;
                            if(variable){
                                if(!Number.isFinite(Number(a?.widthScale))||!Number.isFinite(Number(b?.widthScale))){invalidWidths++;pathBroken=true;continue;}
                                wa=Math.max(.02,Number(a.widthScale));wb=Math.max(.02,Number(b.widthScale));
                            }
                            if(!aFinite||!Number.isFinite(bx)||!Number.isFinite(by)){invalidSegments++;pathBroken=true;continue;}
                            const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);if(len<1e-6){degenerateSegments++;continue;}
                            if(variable)maxWidthRatio=Math.max(maxWidthRatio,wa/wb,wb/wa);
                            if(i>0){
                                const p=pts[i-1],px=Number(p?.x),py=Number(p?.y);
                                if(Number.isFinite(px)&&Number.isFinite(py)){
                                    const pax=ax-px,pay=ay-py,la=Math.hypot(pax,pay);
                                    if(la>1e-6&&((pax*dx+pay*dy)/(la*len))<-.35)sharpJoins++;
                                }
                            }
                            const rawAlpha=segAlpha&&Number.isFinite(Number(segAlpha[i]))?Number(segAlpha[i]):Number(cmd?.alpha)||0;
                            segments.push({
                                command:cmd,subpath:sp,points:pts,a,b,
                                commandIndex,subpathIndex,segmentIndex:i,
                                ax,ay,bx,by,dx,dy,length:len,
                                variable,widthScaleA:wa,widthScaleB:wb,
                                rawAlpha,closed
                            });
                            count++;pathValid++;totalLength+=len;
                        }
                        const finiteBounds=Number.isFinite(minX)&&Number.isFinite(minY)&&Number.isFinite(maxX)&&Number.isFinite(maxY);
                        const contour={sourceKind:'commands',command:cmd,subpath:sp,commandIndex,subpathIndex,points:pts,closed,pointCount:pts.length,segmentCount:n,
                            invalidPointCount:contourInvalidPoints,fillEligible:closed&&pts.length>=3&&contourInvalidPoints===0,signedArea2,
                            winding:signedArea2>1e-9?'ccw':(signedArea2<-1e-9?'cw':'flat'),
                            bounds:finiteBounds?{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY}:null};
                        contours.push(contour);if(contour.fillEligible)fillContours.push(contour);contourDescriptorsBuilt++;
                        if(pathValid>0)pathCount++;
                        if(cmd?.__spiralContinuityProtected===true){
                            if(pathBroken||pathValid===0)protectedBrokenPaths++;
                            if(n>0&&pathValid===0&&degenerateSegments>0)collapsedProtectedPaths++;
                        }
                        subpathIndex++;
                    }
                    commandIndex++;
                }
                const continuityRisk=protectedBrokenPaths>0||collapsedProtectedPaths>0||invalidWidths>0||invalidSegments>0;
                const meta={
                    count,segmentCount:count,totalLength,pathCount,subpathCount,pointCount,closedPathCount,openPathCount,
                    invalidSegments,degenerateSegments,invalidWidths,protectedBrokenPaths,collapsedProtectedPaths,
                    maxWidthRatio,sharpJoins,continuityRisk,hasClosedTopology:closedPathCount>0,sourceKind:'commands',
                    commands,contours,fillContours,fillContourCount:fillContours.length,segments,
                    topologyHash:Number(commands.__spiroTopologyHash)||0,phaseSerial:Number(commands.__spiroPhaseSerial)||0,frameId:Number(commands.__spiroFrameId)||0
                };
                segmentDescriptorsBuilt+=segments.length;commandCache.set(commands,meta);commandBuilds++;return meta;
            }
            function strokeSegments(commands,consumer='other'){
                const meta=inspectStrokeCommands(commands);
                const key=Object.prototype.hasOwnProperty.call(segmentConsumers,consumer)?consumer:'other';
                segmentConsumers[key]++;return meta.segments;
            }
            function staticContours(drawData,consumer='other',fillOnly=false){
                const meta=inspectStaticDrawData(drawData),key=Object.prototype.hasOwnProperty.call(contourConsumers,consumer)?consumer:'other';
                contourConsumers[key]++;return fillOnly?meta.fillContours:meta.contours;
            }
            function commandContours(commands,consumer='other',fillOnly=false){
                const meta=inspectStrokeCommands(commands),key=Object.prototype.hasOwnProperty.call(contourConsumers,consumer)?consumer:'other';
                contourConsumers[key]++;return fillOnly?meta.fillContours:meta.contours;
            }
            function invalidateCommands(commands){
                if(!commands||typeof commands!=='object')return false;
                const had=commandCache.has(commands);
                if(had&&commands.__spiroPhaseResidentRecorder===true)dirtyCommands.add(commands);
                else if(had)commandCache.delete(commands);
                if(had)commandInvalidations++;return had;
            }
            function bindStrokeCommands(frameCtx,commands){
                if(!frameCtx)return null;
                const stroke=inspectStrokeCommands(commands);
                frameCtx._geometryKernelStrokeView=stroke;
                // Some fallback/order combinations can ask for the geometry contract before
                // stroke recording. Keep that already-created zero-copy view coherent rather
                // than allocating/rebuilding a second frame view.
                if(frameCtx._geometryKernelView)frameCtx._geometryKernelView.stroke=stroke;
                if(frameCtx._geometryContract?.geometry)frameCtx._geometryContract.geometry.stroke=stroke;
                strokeBindings++;return stroke;
            }
            function frameView(frameCtx){
                if(!frameCtx)return null;if(frameCtx._geometryKernelView){frameViewHits++;return frameCtx._geometryKernelView;}
                const plan=frameCtx.geometryPlan||{};
                let view;
                if(plan.dynamic!==true){
                    const drawData=plan.sourceData||frameCtx.staticDrawData||null;
                    const canonical=frameCtx.canonicalGeometry || (typeof getCanonicalGeometryForDrawData==='function'?getCanonicalGeometryForDrawData(drawData):null);
                    view={...inspectStaticDrawData(drawData),dynamic:false,kind:String(plan.kind||'static'),stroke:frameCtx._geometryKernelStrokeView||null,canonical};
                    if(canonical&&typeof noteCanonicalGeometryConsumer==='function')noteCanonicalGeometryConsumer('GeometryKernel.frameView');
                }else{
                    // v383: dynamic Fill is exact-Canvas-only by policy, so the geometry
                    // contract does not need a second full point/contour scan before the
                    // phase-resident stroke recorder performs its canonical validation.
                    // If stroke metadata already exists, reuse it; otherwise expose a cheap
                    // lazy topology view and let bindStrokeCommands attach the authoritative one.
                    const stroke=frameCtx._geometryKernelStrokeView||null;
                    if(stroke)view={...stroke,dynamic:true,kind:String(plan.kind||'dynamic'),static:false,stroke};
                    else{view={pathCount:0,pointCount:0,segmentCount:0,closedPathCount:0,openPathCount:0,invalidPointCount:0,variableWidthPointCount:0,contours:EMPTY_CONTOURS,fillContours:EMPTY_CONTOURS,fillContourCount:0,hasClosedFillTopology:false,sourceKind:'dynamic-lazy',dynamic:true,kind:String(plan.kind||'dynamic'),static:false,stroke:null,lazy:true};lazyDynamicViews++;}
                }
                if(view.invalidPointCount>0||view.stroke?.continuityRisk===true)invalidViews++;
                frameViews++;frameCtx._geometryKernelView=view;return view;
            }
            function clearStatic(){staticCache=new WeakMap();}
            function status(){return{
                static:{builds:staticBuilds,hits:staticHits},
                stroke:{builds:commandBuilds,hits:commandHits,invalidations:commandInvalidations,refreshes:commandRefreshes,refreshFallbacks:commandRefreshFallbacks,bindings:strokeBindings,segmentDescriptorsBuilt,consumers:{...segmentConsumers}},
                contours:{descriptorsBuilt:contourDescriptorsBuilt,consumers:{...contourConsumers}},
                frame:{views:frameViews,hits:frameViewHits,lazyDynamicViews,invalidViews},
                semantic:'canonical zero-copy contours + phase-resident in-place segment refresh; dynamic Fill policy uses lazy topology view'
            };}
            return{inspectStaticDrawData,inspectStrokeCommands,strokeSegments,staticContours,commandContours,invalidateCommands,bindStrokeCommands,frameView,clearStatic,status};
        })();
        window.__spiroGeometryKernelStatus=()=>GeometryKernel.status();

        // v508 — Fill preparation moved to js/render/fill-plan.js.
        // GeometryKernel owns topology only; render planning no longer lives in this module.

        // v360 — Geometry Contract v1. Rendering backends ask one object for topology /
        // fill policy instead of independently re-deriving Spiral/Morph/fill conditions.
        // This is deliberately a view over existing geometry, not a second geometry copy.
        const geometryContractStats={built:0,reused:0,canvasExactFill:0,gpuFill:0,nativeMeshFill:0,sceneSplitForFill:0,fillOnlyPasses:0};
        function getLayerGeometryContract(frameCtx){
            if(!frameCtx)return null;
            if(frameCtx._geometryContract){geometryContractStats.reused++;return frameCtx._geometryContract;}
            const layer=frameCtx.layer||{},plan=frameCtx.geometryPlan||{},geometry=GeometryKernel.frameView(frameCtx);
            if(plan.dynamic!==true&&geometry?.drawData)GeometryKernel.staticContours(geometry.drawData,'fillPolicy',true);
            const fillAlpha=getFillOpacityUnit(layer.fillColor,DEFAULT_FILL_OPACITY_PERCENT);
            // v522.9 — Fill follows the layer's ordinary line visibility. Hiding the line is
            // a visual mute for the shape carrier, so a previously enabled Fill must not remain
            // as an orphaned polygon. Lightning may still flash independently, but it does not
            // re-enable Fill while lineVisible=false.
            const fillConfigured=getLayerLineVisible(layer)&&layer.fill===true&&fillAlpha>.00001;
            const dynamic=plan.dynamic===true,spiral=isSpiralLayer(layer);
            // A polygon<->Spiral morph can expose a temporary render layer whose own flag is
            // still polygonal while one authoritative endpoint already owns the Spiral rail.
            // Fill policy follows the complete endpoint contract, not that transient visual shell.
            const li=Math.max(0,Math.floor(Number(frameCtx.layerIndex)||0));
            const spiralEndpoint=spiral||[
                frameCtx.sourceLayer,frameCtx.geometryPlan?.sourceLayer,frameCtx.geometryPlan?.targetLayer,
                frameCtx.blueMorphProvider?.sourceLayer,frameCtx.blueMorphProvider?.targetLayer,
                runtimeState?.morph?.renderSourceLayers?.[li],runtimeState?.morph?.renderTargetLayers?.[li]
            ].some(candidate=>candidate&&isSpiralLayer(candidate));
            const unsupportedFillKind=plan.kind==='orange-fade'||plan.kind==='blue-fade'||plan.kind==='green-fade'||plan.kind==='lightning';
            const hasStaticFillTopology=dynamic?false:(Number(geometry?.fillContourCount)||0)>0&&geometry?.hasClosedFillTopology===true;
            // Somata 6.8 Iter19 — a Spiral carrier is an open canonical stroke rail even when
            // `spiralClosed` is enabled: its auto-close bridge is already baked into that rail.
            // There is therefore no separate closed polygon Fill contour. Treating the UI Fill
            // toggle as a requested polygon fill made strict Spiral wait forever for a native
            // fill mesh that cannot exist, suppressing the valid retained-Bezier Base as well.
            // Dynamic polygon morphs keep their existing Fill contract; Spiral endpoints do not
            // request Fill until an authoritative closed fill topology is actually provided.
            const fillHasRenderableTopology=spiralEndpoint?hasStaticFillTopology:true;
            const fillRequested=fillConfigured&&fillHasRenderableTopology;
            const corridor=state.tunnel?.active===true;
            // Somata 7.2.6 — dynamic Corridor Morph has an authoritative frame-resident
            // command rail.  Fill may consume its closed subpaths directly as a native GPU
            // stencil fan; dynamic no longer means "Canvas mask required".
            const dynamicCorridorNative=fillRequested&&dynamic&&corridor&&!spiralEndpoint&&!unsupportedFillKind&&!state.fourierMode&&!state.showRoundingGuides&&!tunnelColorShiftIsActive()&&Boolean(frameCtx.drawLayerGeometry);
            const nativeGpuFillEligible=fillRequested&&!spiralEndpoint&&!unsupportedFillKind&&!state.fourierMode&&!state.showRoundingGuides&&(!corridor||!tunnelColorShiftIsActive())&&(hasStaticFillTopology&&!dynamic||dynamicCorridorNative);
            const gpuMaskEligible=fillRequested&&hasStaticFillTopology&&!dynamic&&!spiralEndpoint&&!corridor&&!unsupportedFillKind&&!tunnelColorShiftIsActive()&&Boolean(frameCtx.drawLayerFillInstances);
            const contract={
                kind:String(plan.kind||'static'),
                dynamic,spiral:spiralEndpoint,corridor,
                fillConfigured,
                fillSuppressedNoTopology:fillConfigured&&!fillRequested,
                fillRequested,
                fillAlpha,
                fillStyle:layer.fillColor||layer.strokeColor||'#ffffff',
                gpuMaskEligible,nativeGpuFillEligible,dynamicCorridorNative,
                exactCanvasFillRequired:fillRequested&&!gpuMaskEligible&&!nativeGpuFillEligible,
                topologyStable:dynamic!==true,
                geometry
            };
            geometryContractStats.built++;
            frameCtx._geometryContract=contract;
            if(fillRequested)FillMeshPreparer.prepareFrame(frameCtx);
            return contract;
        }
        const fillMaskValidationStats={checks:0,accepted:0,rejectedEmpty:0,rejectedPolicy:0,gpuSuppression:0,canvasFallback:0,canvasExact:0,corridorExact:0,sceneSplit:0};
        function validatePreparedFillMask(frameCtx,canvas){
            fillMaskValidationStats.checks++;
            const contract=getLayerGeometryContract(frameCtx),w=canvas?.width|0,h=canvas?.height|0;
            if(!contract?.gpuMaskEligible){fillMaskValidationStats.rejectedPolicy++;return false;}
            if(w<1||h<1||contract.geometry?.hasClosedFillTopology!==true||(Number(contract.geometry?.fillContourCount)||0)<1||contract.geometry?.invalidPointCount>0){fillMaskValidationStats.rejectedEmpty++;return false;}
            // No getImageData/readback here. The authoritative decision is topological:
            // static canonical geometry contains at least one valid closed contour, and
            // drawLayerFillInstances completed without throwing.
            fillMaskValidationStats.accepted++;return true;
        }
        window.__spiroFillValidationStatus=()=>({...fillMaskValidationStats,geometryContract:{...geometryContractStats}});
        window.__spiroGeometryContractStatus=()=>({...geometryContractStats});
