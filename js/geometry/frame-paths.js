

window.__spiroRegisterModule?.('js/geometry/frame-paths');

        const persistentRoundedPathsCache = new WeakMap();

        const persistentHighPrecisionGlintCache = new WeakMap();

        const persistentExactLightningCache = new WeakMap();
        const persistentPathTableCache = new WeakMap();
        const persistentSinglePathTableCache = new WeakMap();

        const dynamicPathTableReuseCache = new WeakMap();
        const persistentGraffitiPlanCache = new WeakMap();
        const persistentWebClipCache = new WeakMap();
        const persistentWebCornerCache = new WeakMap();
        const persistentWebVectorCache = new WeakMap();
        const effectCullStats = { graffiti:0, sweep:0, web:0 };

        const frameGeometryRuntime = {
            active:false,
            frameId:0,
            circlePaths:new Map(),

            pathTables:new Map(),
            singlePathTables:new Map(),
            roundedPaths:new Map(),
            stats:{ morphBuilds:0, morphHits:0, circleBuilds:0, circleHits:0, circlePathReuses:0, pathTableBuilds:0, pathTableHits:0, pathTableObjectReuses:0 }
        };
        const morphFrameOutputPools = new Map();
        const circleFrameOutputPools = new Map();

        function frameMorphCacheKey(layerIndex,t){
            const li=Number.isFinite(Number(layerIndex))?Number(layerIndex):-1;
            const tt=Number.isFinite(Number(t))?Number(t):0;
            return `${li}|${tt}`;
        }

        const morphFrameFastSlots=[];
        function getMorphFrameFastSlot(layerIndex,variant='canonical'){
            let bucket=morphFrameFastSlots[layerIndex];
            if(!bucket){bucket={};morphFrameFastSlots[layerIndex]=bucket;}
            let slot=bucket[variant];
            if(!slot)slot=bucket[variant]={frameId:-1,t:NaN,cycleSerial:-1,result:null};
            return slot;
        }
        function getMorphFrameFastHit(layerIndex,t,variant='canonical'){
            if(!frameGeometryRuntime.active)return null;
            const slot=getMorphFrameFastSlot(layerIndex,variant);
            const cycleSerial=Number(runtimeState.morph?.lampCycleSerial)||0;
            if(slot.frameId===frameGeometryRuntime.frameId&&slot.t===t&&slot.cycleSerial===cycleSerial&&slot.result){
                frameGeometryRuntime.stats.morphHits++;return slot.result;
            }
            return null;
        }
        function setMorphFrameFastResult(layerIndex,t,result,variant='canonical'){
            if(!frameGeometryRuntime.active)return result;
            const slot=getMorphFrameFastSlot(layerIndex,variant);
            slot.frameId=frameGeometryRuntime.frameId;slot.t=t;slot.cycleSerial=Number(runtimeState.morph?.lampCycleSerial)||0;slot.result=result;
            return result;
        }

        const morphCpuPathDemandRuntime={
            requests:0,topologyRequests:0,circleRequests:0,chaosCircleRequests:0,
            emptyResults:0,pointsMaterialized:0,strictSpiralBlocks:0,purposes:Object.create(null),last:null
        };
        function noteMorphCpuPathDemand(kind,purpose,layerIndex,t,paths){
            const list=Array.isArray(paths)?paths:[];
            let points=0;for(const path of list)points+=(path?.points?.length||0);
            morphCpuPathDemandRuntime.requests++;
            if(kind==='circle')morphCpuPathDemandRuntime.circleRequests++;
            else if(kind==='chaos-circle')morphCpuPathDemandRuntime.chaosCircleRequests++;
            else morphCpuPathDemandRuntime.topologyRequests++;
            if(!list.length)morphCpuPathDemandRuntime.emptyResults++;
            morphCpuPathDemandRuntime.pointsMaterialized+=points;
            const key=String(purpose||'legacy');
            morphCpuPathDemandRuntime.purposes[key]=(morphCpuPathDemandRuntime.purposes[key]||0)+1;
            morphCpuPathDemandRuntime.last={kind,purpose:key,layerIndex:Number(layerIndex)||0,t:Number(t)||0,pathCount:list.length,pointCount:points,frameId:frameGeometryRuntime.frameId};
            return list;
        }
        function getCurrentMorphCpuPaths(layerIndex,t,purpose='legacy'){
            if(!runtimeState.morph?.active)return noteMorphCpuPathDemand('topology',purpose,layerIndex,t,[]);

            const sl=runtimeState.morph?.renderSourceLayers?.[layerIndex],dl=runtimeState.morph?.renderTargetLayers?.[layerIndex],strictSpiral=state?.fourierMode!==true&&[sl,dl].some(l=>l&&typeof isSpiralLayer==='function'&&isSpiralLayer(l));

            const retainedGpuReady=strictSpiral&&typeof currentGpuBezierMorphResource==='function'&&currentGpuBezierMorphResource(layerIndex)?.ready===true;
            if(strictSpiral&&retainedGpuReady){morphCpuPathDemandRuntime.strictSpiralBlocks++;return noteMorphCpuPathDemand('spiral-gpu-only',purpose,layerIndex,t,[]);}
            if(state.morph?.mode==='circleSlide'){
                const chaos=typeof isChaosCircleMorphPair==='function'&&isChaosCircleMorphPair(layerIndex);
                let paths=[];

                if(!chaos&&typeof getGpuSpiralBezierMorphAuxPaths==='function'){
                    const fast=getGpuSpiralBezierMorphAuxPaths(layerIndex,t);
                    if(Array.isArray(fast)&&fast.length)return noteMorphCpuPathDemand('circle',purpose,layerIndex,t,fast);
                }
                if(chaos&&typeof buildCurrentChaosCircleMorphPaths==='function')paths=buildCurrentChaosCircleMorphPaths(layerIndex,t)||[];
                else if(typeof buildCurrentCircleMorphPaths==='function')paths=buildCurrentCircleMorphPaths(layerIndex,t)||[];
                return noteMorphCpuPathDemand(chaos?'chaos-circle':'circle',purpose,layerIndex,t,paths);
            }
            return noteMorphCpuPathDemand('topology',purpose,layerIndex,t,buildCurrentMorphPaths(layerIndex,t)||[]);
        }
        window.__spiroMorphCpuFallbackStatus=()=>({
            ...morphCpuPathDemandRuntime,purposes:{...morphCpuPathDemandRuntime.purposes},
            last:morphCpuPathDemandRuntime.last?{...morphCpuPathDemandRuntime.last}:null,
            contract:'Strict non-Fourier Spiral Morph keeps the retained cubic WebGPU rail authoritative; auxiliary CPU path materialization is blocked.'
        });

        function createEffectPieceScratch() {
            return { pieces:[], piecePool:[], pieceCursor:0, infos:[], infoPool:[], infoCursor:0 };
        }
        function resetEffectPieceScratch(scratch) {
            scratch.pieces.length=0; scratch.pieceCursor=0;
            scratch.infos.length=0; scratch.infoCursor=0;
            return scratch;
        }
        function acquireEffectPiece(scratch) {
            const index=scratch.pieceCursor++;
            let pts=scratch.piecePool[index];
            if(!pts){ pts=[]; pts._pointPool=[]; scratch.piecePool[index]=pts; }
            pts.length=0;
            return pts;
        }
        function effectPointAt(pts,index,table,distance) {
            const pool=pts._pointPool || (pts._pointPool=[]);
            let out=pool[index];
            if(!out) out=pool[index]={x:0,y:0};
            pointAtPathDistance(table,distance,out);
            pts[index]=out;
            return out;
        }
        function effectXYAt(pts,index,x,y) {
            const pool=pts._pointPool || (pts._pointPool=[]);
            let out=pool[index];
            if(!out) out=pool[index]={x:0,y:0};
            out.x=x; out.y=y; pts[index]=out;
            return out;
        }
        function acquireEffectInfo(scratch,table,start,pi=-1) {
            const index=scratch.infoCursor++;
            let info=scratch.infoPool[index];
            if(!info) info=scratch.infoPool[index]={table:null,start:0,pi:-1};
            info.table=table; info.start=start; info.pi=pi;
            scratch.infos.push(info);
            return info;
        }
        const sweepGeometryScratch=createEffectPieceScratch();
        sweepGeometryScratch.data={};
        const sweepSegmentScratch={segments:[],pool:[]};
        const webDrawScratch={corners:[],cornerPool:[],seen:new Set(),pointA:{x:0,y:0},pointB:{x:0,y:0},nearest:{distance:0,x:0,y:0}};
        let sweepPreparedFrame=null;
        let webCornersPreparedFrame=null;
        const lightningDynamicScratchByLayer=new WeakMap();

        const layerFrameEffectContextPool=[];
        function acquireLayerFrameEffectContext(layerIndex){
            let ctx=layerFrameEffectContextPool[layerIndex];
            if(!ctx){
                ctx={
                    layerIndex:-1,frameId:-1,now:0,layer:null,staticDrawData:null,canonicalGeometry:null,frame:null,runtime:null,
                    auxiliaryPaths:null,auxiliaryPathsReady:false,roundedPaths:null,roundedPathsReady:false,
                    rawPathTable:null,rawPathTableReady:false,roundedPathTable:null,roundedPathTableReady:false,
                    profilePrepared:null,profilePreparedReady:false,sweepPrepared:null,sweepPreparedReady:false,
                    webPrepared:null,webPreparedReady:false,lampInstances:null,lampInstancesReady:false,
                    minimalSourceLayer:null,minimalTargetLayer:null,morphFrameActive:false,lightMorphEnabled:false,forcedLampMorph:false,greenLampDisplay:false,
                    lampDisplayEnabled:false,greenMorphEnabled:false,greenFadeEnabled:false,greenFadeT:0,greenFramePaths:null,greenSourcePaths:null,greenTargetPaths:null,greenSourceLayer:null,greenTargetLayer:null,
                    minimalFadeEnabled:false,circleAngularMorphEnabled:false,topologyMorphEnabled:false,geometryMorphEnabled:false,lineDisplayEnabled:false,lightningFlashAlpha:0,glow:0,
                    frameVectorMaster:null,frameVectorMasterScale:1,tunnelCanUseMaster:false,drawLayerGeometry:null,drawLayerInstances:null,drawLayerFillInstances:null,
                    instanceMetrics:[],consumerDemand:{roles:{}},
                    geometryPlan:{},effectsPlan:{},
                    _baseStrokeCommitted:false,_baseFillCommitted:false,_fusedMorphBackend:'',
                    layerLampConfig:null,lightningStroke:null,lineCap:'round',lineJoin:'round',miterLimit:6,prepared:false
                };
                layerFrameEffectContextPool[layerIndex]=ctx;
            }
            ctx.layerIndex=layerIndex;ctx.frameId=frameGeometryRuntime.frameId;ctx.now=0;ctx.layer=null;ctx.staticDrawData=null;ctx.canonicalGeometry=null;
            ctx.frame=renderRuntime.frame;ctx.runtime=renderRuntime;
            ctx.auxiliaryPaths=null;ctx.auxiliaryPathsReady=false;ctx.roundedPaths=null;ctx.roundedPathsReady=false;
            ctx.rawPathTable=null;ctx.rawPathTableReady=false;ctx.roundedPathTable=null;ctx.roundedPathTableReady=false;
            ctx.profilePrepared=null;ctx.profilePreparedReady=false;ctx.sweepPrepared=null;ctx.sweepPreparedReady=false;

            ctx._geometryCircleFrameData=undefined;
            // GPU stroke commands are frame-resident for dynamic geometry. The context itself is
            // pooled, so clear the previous frame carrier before Fill/Base planning starts. Static
            // commands still keep their own persistent cache inside getFrameGLStrokeCommands().
            ctx._glStrokeCommands=null;ctx._glStrokeCommandFrameId=-1;ctx._glStrokeCommandHiddenGraffitiCarrier=false;
            ctx._frameContourRecord=null;
            ctx.webPrepared=null;ctx.webPreparedReady=false;ctx.lampInstances=null;ctx.lampInstancesReady=false;
            ctx.minimalSourceLayer=null;ctx.minimalTargetLayer=null;ctx.morphFrameActive=false;ctx.lightMorphEnabled=false;ctx.forcedLampMorph=false;ctx.greenLampDisplay=false;
            ctx.lampDisplayEnabled=false;ctx.greenMorphEnabled=false;ctx.greenFadeEnabled=false;ctx.greenFadeT=0;ctx.greenFramePaths=null;ctx.greenSourcePaths=null;ctx.greenTargetPaths=null;ctx.greenSourceLayer=null;ctx.greenTargetLayer=null;
            ctx.minimalFadeEnabled=false;ctx.circleAngularMorphEnabled=false;ctx.topologyMorphEnabled=false;ctx.geometryMorphEnabled=false;ctx.lineDisplayEnabled=false;ctx.lightningFlashAlpha=0;ctx.glow=0;
            ctx.frameVectorMaster=null;ctx.frameVectorMasterScale=1;ctx.tunnelCanUseMaster=false;ctx.drawLayerGeometry=null;ctx.drawLayerInstances=null;ctx.drawLayerFillInstances=null;
            if(!Array.isArray(ctx.instanceMetrics))ctx.instanceMetrics=[];else ctx.instanceMetrics.length=0;
            resetMainLayerGeometryPlan(ctx.geometryPlan || (ctx.geometryPlan={}));
            resetLayerEffectsPlan(ctx.effectsPlan || (ctx.effectsPlan={}));

            ctx._baseStrokeCommitted=false;ctx._baseFillCommitted=false;ctx._fillBelowWebResolved=false;ctx._fillRenderedBelowWeb=false;ctx._suppressLateFillForWeb=false;ctx._fusedMorphBackend='';
            ctx.layerLampConfig=null;ctx.lightningStroke=null;ctx.lineCap='round';ctx.lineJoin='round';ctx.miterLimit=6;ctx.prepared=false;
            return ctx;
        }
        function getLayerFrameAuxiliaryPaths(ctx){
            if(!ctx)return[];
            if(!ctx.auxiliaryPathsReady){
                ctx.auxiliaryPaths=getAuxiliaryLayerPaths(ctx.layerIndex,ctx.layer,ctx.staticDrawData||undefined)||[];
                ctx.auxiliaryPathsReady=true;
            }
            return ctx.auxiliaryPaths||[];
        }
        function getLayerFrameRoundedPaths(ctx){
            if(!ctx)return[];
            if(!ctx.roundedPathsReady){
                ctx.roundedPaths=prepareWebVisiblePaths(getLayerFrameAuxiliaryPaths(ctx),ctx.layer)||[];
                ctx.roundedPathsReady=true;
            }
            return ctx.roundedPaths||[];
        }
        function getLayerFramePathTable(ctx,rounded=false){
            if(!ctx)return buildPathLengthTable([]);
            if(rounded){
                if(!ctx.roundedPathTableReady){ctx.roundedPathTable=buildPathLengthTable(getLayerFrameRoundedPaths(ctx));ctx.roundedPathTableReady=true;}
                return ctx.roundedPathTable;
            }
            if(!ctx.rawPathTableReady){
                const paths=getLayerFrameAuxiliaryPaths(ctx);
                if(ctx.canonicalGeometry&&paths===ctx.canonicalGeometry.paths&&typeof ensureCanonicalPathTable==='function'){
                    ctx.rawPathTable=ensureCanonicalPathTable(ctx.canonicalGeometry);
                    if(typeof noteCanonicalGeometryConsumer==='function')noteCanonicalGeometryConsumer('frameRawPathTable');
                }else ctx.rawPathTable=buildPathLengthTable(paths);
                ctx.rawPathTableReady=true;
            }
            return ctx.rawPathTable;
        }

        const pathFxTypedTableStats={builds:0,staticHits:0,frameHits:0,grows:0,segmentsWritten:0,objectSegmentsAvoided:0};
        function ensurePathFxTypedCapacity(table,needed){
            const current=Math.max(0,Number(table?._capacity)||0);if(current>=needed&&table.gpuSegmentData&&table.gpuPathIndexData)return table;
            const next=typeof performanceGovernor?.capacityFor==='function'?performanceGovernor.capacityFor(needed,current,256,1.7):Math.max(256,needed,current?Math.ceil(current*1.7):0);
            table._capacity=next;table.gpuSegmentData=new Float32Array(Math.max(8,next*8));table.gpuPathIndexData=new Uint32Array(Math.max(1,next));pathFxTypedTableStats.grows++;return table;
        }
        function buildPathFxTypedTable(paths,table=null,frameId=0){
            const list=Array.isArray(paths)?paths:[];table=table&&typeof table==='object'?table:{segs:[],total:0};
            let estimate=0;for(const path of list){const n=path?.points?.length||0;if(n>1)estimate+=path?.closed===true?n:n-1;}
            ensurePathFxTypedCapacity(table,estimate);
            const data=table.gpuSegmentData,index=table.gpuPathIndexData;let total=0,write=0,pathCount=0;
            for(let pi=0;pi<list.length;pi++){
                const path=list[pi],pts=path?.points||[];if(pts.length<2)continue;
                const closed=path?.closed===true,count=closed?pts.length:pts.length-1,pathStart=total,segmentStart=write,cornerFlags=Array.isArray(path?.cornerFlags)?path.cornerFlags:null;
                for(let i=0;i<count;i++){
                    const a=pts[i],j=(i+1)%pts.length,b=pts[j],ax=Number(a?.x)||0,ay=Number(a?.y)||0,bx=Number(b?.x)||0,by=Number(b?.y)||0,dx=bx-ax,dy=by-ay,len=Math.sqrt(dx*dx+dy*dy);if(!(len>1e-6))continue;
                    const o=write*8;data[o]=ax;data[o+1]=ay;data[o+2]=bx;data[o+3]=by;data[o+4]=total;data[o+5]=len;
                    const keyStart=Boolean(cornerFlags?.[i]===true||a?.__profileKeyCorner===true||a?.__profileCorner===true),keyEnd=Boolean(cornerFlags?.[j]===true||b?.__profileKeyCorner===true||b?.__profileCorner===true);
                    index[write]=((pi&0x00ffffff)|(keyStart?0x40000000:0)|(keyEnd?0x80000000:0))>>>0;total+=len;write++;
                }
                const pathLength=total-pathStart;if(pathLength>1e-6){for(let si=segmentStart;si<write;si++){const o=si*8;data[o+6]=pathStart;data[o+7]=pathLength;}pathCount++;}
            }
            table.segs.length=0;table.total=total;table.segmentCount=write;table.pathCount=pathCount;table.dynamicFrame=true;table.frameId=Math.max(0,Number(frameId)||0);
            table.gpuSegmentFloatCount=write*8;table.gpuPathIndexCount=write;table.gpuSegmentVersion=(Math.max(0,Number(table.gpuSegmentVersion)||0)+1)>>>0;table.gpuPathIndexVersion=(Math.max(0,Number(table.gpuPathIndexVersion)||0)+1)>>>0;
            table._rangeReadyFrameId=-1;table._rangeReadySegmentCount=-1;table._rangeReadyTotal=-1;
            pathFxTypedTableStats.builds++;pathFxTypedTableStats.segmentsWritten+=write;pathFxTypedTableStats.objectSegmentsAvoided+=write;return table;
        }

        function getLayerFrameAuthoritativePathFxTable(ctx){
            if(!ctx)return buildPathLengthTable([]);
            let owner=ctx,guard=0;while(owner?.__somataFeatureParent&&guard++<8)owner=owner.__somataFeatureParent;
            const fid=Number(owner.frameId)||Number(frameGeometryRuntime.frameId)||0;
            if(owner._authoritativePathFxTableFrameId===fid&&owner._authoritativePathFxTable){pathFxTypedTableStats.frameHits++;return owner._authoritativePathFxTable;}
            let paths=null;try{paths=SomataFrameContourService?.paths?.(owner)||null;}catch(_){paths=null;}
            if(!Array.isArray(paths)||!paths.length)return getLayerFramePathFxTable(owner);
            owner._authoritativePathFxTable=buildPathFxTypedTable(paths,owner._authoritativePathFxTable,fid);
            owner._authoritativePathFxTableFrameId=fid;owner._authoritativePathFxSourcePaths=paths;
            return owner._authoritativePathFxTable;
        }
        window.getLayerFrameAuthoritativePathFxTable=getLayerFrameAuthoritativePathFxTable;

        function getLayerFramePathFxTable(ctx){
            if(!ctx)return buildPathLengthTable([]);
            const fid=Number(ctx.frameId)||Number(frameGeometryRuntime.frameId)||0;
            if(ctx._pathFxTableFrameId===fid&&ctx._pathFxTable){pathFxTypedTableStats.frameHits++;return ctx._pathFxTable;}
            const layer=ctx.layer,round=getRoundingStrength(layer?.rounding);
            const needsSpline=layer?.profileMode==='spline';
            const paths=needsSpline?buildHighPrecisionGlintPaths(ctx):getLayerFrameRoundedPaths(ctx);
            const dynamic=isCurrentFrameDynamicPathList(paths)||ctx.geometryPlan?.dynamic===true||Boolean(runtimeState.morph?.active&&state.morph?.mode!=='light');
            const geomVersion=typeof getLayerVersions==='function'?Number(getLayerVersions(layer)?.geometry)||0:Number(layer?._geometryVersion)||0;
            if(!dynamic&&ctx._pathFxTable&&ctx._pathFxSourcePaths===paths&&ctx._pathFxGeometryVersion===geomVersion){ctx._pathFxTable.frameId=fid;ctx._pathFxTableFrameId=fid;pathFxTypedTableStats.staticHits++;return ctx._pathFxTable;}
            ctx._pathFxPaths=paths;ctx._pathFxTable=buildPathFxTypedTable(paths||[],ctx._pathFxTable,fid);ctx._pathFxSourcePaths=paths;ctx._pathFxGeometryVersion=geomVersion;ctx._pathFxTableFrameId=fid;
            return ctx._pathFxTable;
        }
        window.__spiroPathFxTypedCarrierStatus=()=>({...pathFxTypedTableStats,contract:'Sprite/Moving Line path metrics are typed-only; no JS segment objects and no second GPU packing walk.'});
        function isCurrentFrameDynamicPathList(paths){
            return Boolean(paths && Number(paths._frameGeometryId)===frameGeometryRuntime.frameId);
        }
        function getTunnelEffectScreenScale(copy,frameCtx){
            if(!state.tunnel.active)return Math.max(.001,Math.abs(Number(frameCtx?.combinedScale)||1)*Math.max(.001,Number(state.zoom)||1));
            return Math.max(.000001,Math.abs(Number(copy?.scale)||0)*Math.abs(Number(frameCtx?.combinedScale)||1)*Math.max(.001,Number(state.zoom)||1));
        }

        function shouldDrawTunnelEffectCopy(kind,copy,frameCtx,localFootprint=1){
            if(!state.tunnel.active||kind==='sweep')return true; // Preserve moving glint on every visible Corridor copy, even tiny ones.
            const screenScale=getTunnelEffectScreenScale(copy,frameCtx);
            const footprintPx=Math.max(0,Number(localFootprint)||0)*screenScale;
            const radiusPx=Math.max(0,Number(frameCtx?.layerExtent)||0)*Math.max(.001,Number(frameCtx?.audioScale)||1)*Math.max(.001,Number(state.zoom)||1)*Math.abs(Number(copy?.scale)||0);
            let keep=true;
            if(kind==='web') keep=radiusPx>=1.35 && footprintPx>=.16;
            else if(kind==='sweep') keep=radiusPx>=1.15 && footprintPx>=.16;
            else keep=radiusPx>=1.05 && footprintPx>=.18;
            if(!keep && Object.prototype.hasOwnProperty.call(effectCullStats,kind))effectCullStats[kind]++;
            return keep;
        }

        function shouldDrawTunnelEffectIndex(kind,index,frameCtx,localFootprint=1){
            if(!state.tunnel.active||kind==='sweep')return true; // Copy visibility/alpha is handled by the draw and GPU-pack stages.
            const m=frameCtx?.instanceMetrics?.[index];if(!m)return shouldDrawTunnelEffectCopy(kind,frameCtx?.visibleInstances?.copies?.[index],frameCtx,localFootprint);
            const footprintPx=Math.max(0,Number(localFootprint)||0)*m.screenScale;let keep=true;
            if(kind==='web')keep=m.radiusPx>=1.35&&footprintPx>=.16;else if(kind==='sweep')keep=m.radiusPx>=1.15&&footprintPx>=.16;else keep=m.radiusPx>=1.05&&footprintPx>=.18;
            if(!keep&&Object.prototype.hasOwnProperty.call(effectCullStats,kind))effectCullStats[kind]++;return keep;
        }

        function packTunnelEffectCopyRecords(target,copies,alphas,frameCtx,kind,footprint=1,layer=null){
            let k=0;const src=Array.isArray(copies)?copies:[];
            for(let i=0;i<src.length;i++){
                if(frameCtx&&!shouldDrawTunnelEffectIndex(kind,i,frameCtx,footprint))continue;
                const ca=Math.max(0,Math.min(1,Number(alphas?.[i]??1)));if(ca<=.0001)continue;
                const copy=src[i],sc=Math.max(.000001,Math.abs(Number(copy?.scale)||0)),ang=getMotionTunnelLagRadians(copy,layer||frameCtx?.layer),cs=Math.cos(ang),sn=Math.sin(ang),o=k*8;
                target[o]=sc*cs;target[o+1]=-sc*sn;target[o+2]=ca;target[o+3]=0;target[o+4]=sc*sn;target[o+5]=sc*cs;target[o+6]=sc;target[o+7]=0;k++;
            }
            return k;
        }

        function applyLayerFrameEffectTransform(targetCtx,ctx){
            if(!ctx)return;
            if(ctx.hasCombinedRotation)targetCtx.rotate(ctx.combinedRotationRad);
            if(ctx.hasCombinedScale)targetCtx.scale(ctx.combinedScale,ctx.combinedScale);
        }

        function getLightningDynamicScratch(layer) {
            let scratch=lightningDynamicScratchByLayer.get(layer);
            if(!scratch){ scratch=createEffectPieceScratch(); scratch.data={}; scratch.frameId=-1; lightningDynamicScratchByLayer.set(layer,scratch); }
            if(scratch.frameId!==frameGeometryRuntime.frameId){ resetEffectPieceScratch(scratch); scratch.frameId=frameGeometryRuntime.frameId; }
            return scratch;
        }
        function beginFrameGeometryRuntime(){
            frameGeometryRuntime.active=true;
            frameGeometryRuntime.frameId++;
            frameGeometryRuntime.circlePaths.clear();
            frameGeometryRuntime.pathTables.clear();
            frameGeometryRuntime.singlePathTables.clear();
            frameGeometryRuntime.roundedPaths.clear();
        }
        function endFrameGeometryRuntime(){ frameGeometryRuntime.active=false; }
        function getFrameOutputPool(poolMap, layerIndex){
            let out=poolMap.get(layerIndex);
            if(!out){ out=[]; poolMap.set(layerIndex,out); }
            out.length=0;
            return out;
        }
        function buildPathLengthTable(paths) {
            const list=Array.isArray(paths)?paths:[];
            const canonicalOwner=typeof getCanonicalGeometryForPaths==='function'?getCanonicalGeometryForPaths(list):null;
            if(canonicalOwner?.pathTable&&canonicalOwner.pathTablePaths===list&&canonicalOwner.pathTableGeometryKey===canonicalOwner.geometryKey){
                if(frameGeometryRuntime.active)frameGeometryRuntime.stats.pathTableHits++;
                if(typeof noteCanonicalGeometryConsumer==='function')noteCanonicalGeometryConsumer('buildPathLengthTable-hit');
                return canonicalOwner.pathTable;
            }
            const dynamicFrame=isCurrentFrameDynamicPathList(list);
            const persistentEligible=Boolean(list && typeof list==='object' && !dynamicFrame);
            if(persistentEligible){
                const persistentHit=persistentPathTableCache.get(list);
                if(persistentHit){
                    if(canonicalOwner&&!dynamicFrame){
                        canonicalOwner.pathTable=persistentHit;canonicalOwner.pathTablePaths=list;canonicalOwner.pathTableGeometryKey=canonicalOwner.geometryKey;
                        persistentHit.canonicalGeometry=canonicalOwner;
                        if(typeof noteCanonicalGeometryConsumer==='function')noteCanonicalGeometryConsumer('buildPathLengthTable-persistent-hit');
                    }
                    if(frameGeometryRuntime.active)frameGeometryRuntime.stats.pathTableHits++;
                    return persistentHit;
                }
            }
            if(frameGeometryRuntime.active){
                if(list.length===1 && Array.isArray(list[0]?.points)){
                    const variants=frameGeometryRuntime.singlePathTables.get(list[0].points);
                    const cached=variants?.get(list[0].closed===true?'closed':'open');
                    if(cached){ frameGeometryRuntime.stats.pathTableHits++; return cached; }
                }else if(list && typeof list==='object'){
                    const cached=frameGeometryRuntime.pathTables.get(list);
                    if(cached){ frameGeometryRuntime.stats.pathTableHits++; return cached; }
                }
            }

            let table=null,segs=null,reused=false;
            if(dynamicFrame && list && typeof list==='object'){

                const reuseOwner=(list.length===1 && Array.isArray(list[0]?.points)) ? list[0].points : list;
                table=dynamicPathTableReuseCache.get(reuseOwner)||null;
                if(table){segs=table.segs;reused=true;}
                else {table={segs:[],total:0};segs=table.segs;dynamicPathTableReuseCache.set(reuseOwner,table);}
            } else {
                table={segs:[],total:0};segs=table.segs;
            }

            let total=0,write=0,pathCount=0;
            for(let pi=0;pi<list.length;pi++){
                const path=list[pi],pts=path?.points||[]; if(pts.length<2) continue;
                const count=path.closed?pts.length:pts.length-1,pathStart=total;
                for(let i=0;i<count;i++){
                    const a=pts[i],b=pts[(i+1)%pts.length],dx=(b.x-a.x),dy=(b.y-a.y),len=Math.sqrt(dx*dx+dy*dy);
                    if(len>1e-6){
                        let seg=segs[write];
                        if(!seg)seg=segs[write]={a:null,b:null,start:0,len:0,pathIndex:0,localStart:0,keyStart:false,keyEnd:false,pathClosed:false};
                        const j=(i+1)%pts.length,cornerFlags=Array.isArray(path?.cornerFlags)?path.cornerFlags:null;
                        seg.a=a;seg.b=b;seg.start=total;seg.len=len;seg.pathIndex=pi;seg.localStart=total-pathStart;
                        seg.keyStart=Boolean(cornerFlags?.[i]===true||a?.__profileKeyCorner===true||a?.__profileCorner===true);
                        seg.keyEnd=Boolean(cornerFlags?.[j]===true||b?.__profileKeyCorner===true||b?.__profileCorner===true);
                        seg.pathClosed=path?.closed===true;
                        total+=len;write++;
                    }
                }
                if(total-pathStart>1e-6)pathCount++;
            }
            segs.length=write;table.total=total;table.segmentCount=write;table.pathCount=pathCount;
            // Invalidate derived Web block bounds even if the same pooled table is rebuilt twice in one frame.
            table._webProjectionRevision=(Number(table._webProjectionRevision)||0)+1;
            table.dynamicFrame=dynamicFrame;table.frameId=dynamicFrame?frameGeometryRuntime.frameId:0;

            table._rangeReadyFrameId=-1;table._rangeReadySegmentCount=-1;table._rangeReadyTotal=-1;
            if(persistentEligible)persistentPathTableCache.set(list,table);
            if(canonicalOwner&&!dynamicFrame){
                canonicalOwner.pathTable=table;canonicalOwner.pathTablePaths=list;canonicalOwner.pathTableGeometryKey=canonicalOwner.geometryKey;
                table.canonicalGeometry=canonicalOwner;
                if(typeof noteCanonicalGeometryConsumer==='function')noteCanonicalGeometryConsumer('buildPathLengthTable-build');
            }
            if(frameGeometryRuntime.active){
                frameGeometryRuntime.stats.pathTableBuilds++;
                if(reused)frameGeometryRuntime.stats.pathTableObjectReuses++;
                if(list.length===1 && Array.isArray(list[0]?.points)){
                    let variants=frameGeometryRuntime.singlePathTables.get(list[0].points);
                    if(!variants){ variants=new Map(); frameGeometryRuntime.singlePathTables.set(list[0].points,variants); }
                    variants.set(list[0].closed===true?'closed':'open',table);
                } else if(list && typeof list==='object') frameGeometryRuntime.pathTables.set(list,table);
            }
            return table;
        }
        function ensurePathLengthRanges(table){
            if(!table)return{ranges:[],byPath:[]};
            const fid=table.dynamicFrame===true?Math.max(0,Number(table.frameId)||0):-2,segCount=Math.max(0,Number(table.segmentCount)||table.segs?.length||0),total=Number(table.total)||0;
            const ranges=Array.isArray(table.pathRanges)?table.pathRanges:(table.pathRanges=[]),byPath=Array.isArray(table.pathRangeByIndex)?table.pathRangeByIndex:(table.pathRangeByIndex=[]);
            if(table._rangeReadyFrameId===fid&&table._rangeReadySegmentCount===segCount&&table._rangeReadyTotal===total)return{ranges,byPath};
            byPath.length=0;let rw=0,i=0;const segs=table.segs||[];
            while(i<segs.length){
                const first=segs[i],pi=Math.max(0,Number(first?.pathIndex)||0),start=Number(first?.start)||0,segmentStart=i;let end=start;
                while(i<segs.length&&Math.max(0,Number(segs[i]?.pathIndex)||0)===pi){const seg=segs[i];end=(Number(seg.start)||0)+(Number(seg.len)||0);i++;}
                const length=Math.max(0,end-start);if(length<=1e-9)continue;
                let r=ranges[rw];if(!r)r=ranges[rw]={pathIndex:0,start:0,length:0,segmentStart:0,segmentCount:0};
                r.pathIndex=pi;r.start=start;r.length=length;r.segmentStart=segmentStart;r.segmentCount=i-segmentStart;byPath[pi]=r;rw++;
            }
            ranges.length=rw;table._rangeReadyFrameId=fid;table._rangeReadySegmentCount=segCount;table._rangeReadyTotal=total;return{ranges,byPath};
        }
        function buildSinglePathLengthTable(path,persistent=true){
            if(!path||!Array.isArray(path.points)||path.points.length<2)return {segs:[],total:0};
            if(persistent&&typeof path==='object'){
                let variants=persistentSinglePathTableCache.get(path);const key=path.closed===true?'closed':'open';const hit=variants?.get(key);
                if(hit){if(frameGeometryRuntime.active)frameGeometryRuntime.stats.pathTableHits++;return hit;}
                const table=buildPathLengthTable([path]);if(!variants){variants=new Map();persistentSinglePathTableCache.set(path,variants);}variants.set(key,table);return table;
            }
            return buildPathLengthTable([path]);
        }

        function pointAtPathDistance(table,distance,out=null) {
            const target=out || {x:0,y:0};
            if(!table?.segs?.length){ target.x=0; target.y=0; return target; }
            const d=Math.max(0,Math.min(table.total-1e-9,distance));
            let lo=0,hi=table.segs.length-1;
            while(lo<hi){const mid=(lo+hi)>>1;if(table.segs[mid].start+table.segs[mid].len<d)lo=mid+1;else hi=mid;}
            const seg=table.segs[lo],u=Math.max(0,Math.min(1,(d-seg.start)/seg.len));
            target.x=seg.a.x+(seg.b.x-seg.a.x)*u;
            target.y=seg.a.y+(seg.b.y-seg.a.y)*u;
            return target;
        }

        function stableContourLampFractions(seedKey,count) {
            const seed=lampHash32(String(seedKey));
            const offset=lampSeedUnit(seed,31);
            const phi=0.6180339887498949;
            const arr=new Array(Math.max(0,count|0));
            for(let i=0;i<arr.length;i++)arr[i]=(offset+(i+.5)*phi)%1;
            return arr;
        }
        function lampArbitraryDensityFactor(explicitConfig=null) {

            const cfg=(explicitConfig&&typeof explicitConfig==='object')?explicitConfig:getLampEvaluationConfig();
            const pct=Math.max(0,Math.min(200,Number(cfg?.density??100)))/100;
            const mult=Math.max(0,Math.min(5,Number(cfg?.densityMultiplier??1)));
            return Math.max(0,Math.min(5,pct*mult));
        }
        function stableArbitraryLampCountForPath(layer,path,pathIndex,maxPoints=600){
            const layerKey=String(layer?.id||layer?.name||'layer');
            const key=`${layerKey}:path:${pathIndex}`;
            let baseCount=lampMotionRuntime.arbitraryPathCounts.get(key);
            if(!Number.isFinite(baseCount)){
                const table=buildSinglePathLengthTable(path,false);
                baseCount=table.total>0?Math.max(2,Math.min(maxPoints,Math.round(table.total/24))):0;
                if(baseCount>0)lampMotionRuntime.arbitraryPathCounts.set(key,baseCount);
            }
            const density=lampArbitraryDensityFactor();
            if(density<=.0001||!(baseCount>0))return 0;
            return Math.max(1,Math.min(maxPoints,Math.round(baseCount*density)));
        }
        function collectArbitraryContourLampPoints(layer,paths,maxPoints=600){
            const out=[];const layerKey=String(layer?.id||layer?.name||'layer');
            const candidates=[];
            for(let pathIndex=0;pathIndex<(paths?.length||0);pathIndex++){
                const path=paths[pathIndex];if(!path?.points?.length||path.points.length<2)continue;
                const table=buildSinglePathLengthTable(path,false);if(!(table.total>0))continue;
                const desired=stableArbitraryLampCountForPath(layer,path,pathIndex,maxPoints);if(!desired)continue;
                candidates.push({pathIndex,path,table,desired,count:0,remainder:0});
            }
            if(!candidates.length||maxPoints<=0)return out;

            if(candidates.length<=maxPoints){for(const c of candidates)c.count=1;}
            else{

                for(let i=0;i<maxPoints;i++)candidates[Math.floor(i*candidates.length/maxPoints)].count=1;
            }
            let used=candidates.reduce((n,c)=>n+c.count,0),remain=Math.max(0,maxPoints-used);
            if(remain>0){
                const weights=candidates.map(c=>Math.max(0,c.desired-c.count));
                const total=weights.reduce((a,b)=>a+b,0);
                if(total>0){
                    let assigned=0;
                    for(let i=0;i<candidates.length;i++){
                        const raw=remain*weights[i]/total,whole=Math.min(weights[i],Math.floor(raw));
                        candidates[i].count+=whole;candidates[i].remainder=raw-whole;assigned+=whole;
                    }
                    let left=remain-assigned;
                    const order=candidates.map((c,i)=>i).sort((a,b)=>candidates[b].remainder-candidates[a].remainder);
                    for(const i of order){if(left<=0)break;const c=candidates[i];if(c.count<c.desired){c.count++;left--;}}
                }
            }
            for(const c of candidates){
                if(!c.count)continue;
                const seedKey=`lamp|${layerKey}|path:${c.pathIndex}`;
                const fractions=stableContourLampFractions(seedKey,c.count);
                for(let i=0;i<fractions.length;i++){
                    const f=fractions[i],p=pointAtPathDistance(c.table,f*c.table.total);
                    out.push({...p,pathIndex:c.pathIndex,lampAttachFraction:f,lampColorPhase:f,lampId:`arb:${c.pathIndex}:${i}`,lampSeed:lampHash32(`${seedKey}:${i}`)});
                }
            }
            return out;
        }
        function collectArbitraryStaticLampPoints(layer, prepared=null, maxPoints=600) {
            const drawData=prepared || getCachedLayerDrawData(layer);
            const rawPaths=drawData.paths||[];
            const paths=isLampContourAttachmentEnabled() ? buildLampRenderedAttachmentPaths(rawPaths,layer) : rawPaths;
            return collectArbitraryContourLampPoints(layer,paths,maxPoints);
        }
        function mergeLampKeyAndCornerPoints(keyPoints,cornerPoints,maxPoints=260){
            const out=[],seen=new Set();
            const makeKey=(p)=>{
                const pi=Number.isInteger(p?.pathIndex)?p.pathIndex:-1;
                const f=Number.isFinite(Number(p?.lampAttachFraction))?Number(p.lampAttachFraction):
                    (Number.isFinite(Number(p?.lampContourFraction))?Number(p.lampContourFraction):NaN);
                if(Number.isFinite(f))return `p:${pi}:f:${Math.round(f*1000000)}`;
                const vi=Number.isInteger(p?.vertexIndex)?p.vertexIndex:null;
                if(vi!==null)return `p:${pi}:v:${vi}`;
                return `xy:${Math.round((Number(p?.x)||0)*1000)}:${Math.round((Number(p?.y)||0)*1000)}`;
            };
            const add=(p)=>{
                if(!p||out.length>=maxPoints)return;
                const k=makeKey(p);if(seen.has(k))return;seen.add(k);out.push(p);
            };

            for(const p of keyPoints||[])add(p);
            for(const p of cornerPoints||[])add(p);
            return out;
        }
        function collectStaticLampPoints(layer, prepared=null, maxPoints=240) {
            const mode=getLampEvaluationConfig()?.positionMode||'key';
            if(mode==='arbitrary') return collectArbitraryStaticLampPoints(layer,prepared,Math.max(600,maxPoints));
            if(mode==='circumference') return buildLampCircumferenceAnchors(layer,prepared,maxPoints,true);
            if(mode==='corners') {
                const drawData=prepared || getCachedLayerDrawData(layer);
                const layerIndex=Math.max(0,getRuntimeLayerIndex(layer));
                const rawPaths=drawData?.paths||[];

                let bendPoints=collectSmoothCornerLampPoints(layerIndex,rawPaths,maxPoints,false);
                if(isLampContourAttachmentEnabled()){
                    const visiblePaths=buildLampRenderedAttachmentPaths(rawPaths,layer);
                    bendPoints=projectLampPointsToCurrentPolygon(bendPoints,visiblePaths,layer,true);
                }
                // Corner mode is exclusive: key-point lamps belong to the Key mode and
                // must not be duplicated underneath/alongside bend lamps.
                return capLampPointList(bendPoints,maxPoints);
            }
            return buildLampCircumferenceAnchors(layer,prepared,maxPoints);
        }

        const stableSmoothRoundedMorphRailCache={serial:-1,source:[],target:[]};
        function createStableSplineRailSampler(stepsPerCubic=3){
            const points=[];let current=null;
            const push=(x,y)=>{
                const p={x:Number(x)||0,y:Number(y)||0};
                const q=points[points.length-1];
                if(!q||Math.abs(p.x-q.x)>1e-9||Math.abs(p.y-q.y)>1e-9)points.push(p);
                current=p;
            };
            return {
                points,
                moveTo(x,y){push(x,y);},
                lineTo(x,y){push(x,y);},
                bezierCurveTo(c1x,c1y,c2x,c2y,x,y){
                    if(!current){push(x,y);return;}
                    const p0={...current},p1={x:Number(c1x)||0,y:Number(c1y)||0},p2={x:Number(c2x)||0,y:Number(c2y)||0},p3={x:Number(x)||0,y:Number(y)||0};
                    const steps=Math.max(2,Math.round(Number(stepsPerCubic)||3));
                    for(let i=1;i<=steps;i++){
                        const t=i/steps,u=1-t,uu=u*u,tt=t*t;
                        push(uu*u*p0.x+3*uu*t*p1.x+3*u*tt*p2.x+tt*t*p3.x,
                             uu*u*p0.y+3*uu*t*p1.y+3*u*tt*p2.y+tt*t*p3.y);
                    }
                },
                quadraticCurveTo(cx,cy,x,y){
                    if(!current){push(x,y);return;}
                    const p0={...current},p1={x:Number(cx)||0,y:Number(cy)||0},p2={x:Number(x)||0,y:Number(y)||0};
                    const steps=Math.max(2,Math.round(Number(stepsPerCubic)||3));
                    for(let i=1;i<=steps;i++){const t=i/steps,u=1-t;push(u*u*p0.x+2*u*t*p1.x+t*t*p2.x,u*u*p0.y+2*u*t*p1.y+t*t*p2.y);}
                },
                closePath(){}
            };
        }
        function shouldUseStableSmoothRoundedMorph(layerIndex){
            if(!runtimeState.morph?.active)return false;
            const srcMode=runtimeState.morph.sourceProfiles?.[layerIndex]?.mode || 'segments';
            const dstMode=runtimeState.morph.targetProfiles?.[layerIndex]?.mode || srcMode;
            const layer=state.layers?.[layerIndex];

            const sv=runtimeState.morph.sourceVisuals?.[layerIndex]||{};
            const tv=runtimeState.morph.targetVisuals?.[layerIndex]||{};
            if(sv.spiralEnabled===true||tv.spiralEnabled===true||isSpiralLayer(layer))return false;

            if(state.morph?.monoOrbitTransforms===true)return false;

            if(srcMode==='spline'&&dstMode==='spline')return true;
            if(srcMode==='segments'&&dstMode==='segments'){
                const sr=getRoundingStrength(sv.rounding ?? layer?.rounding);
                const tr=getRoundingStrength(tv.rounding ?? layer?.rounding);
                return Math.max(sr,tr)>.001;
            }
            return false;
        }
        function sampleStableSmoothRoundedEndpointPath(path,roundingFrac,profileMode='spline',splineRenderMode='smooth'){
            const pts=path?.points||[];
            if(pts.length<2)return {points:copyMorphPointArray(pts),closed:Boolean(path?.closed),cornerFlags:[],bridgeRoundFlags:[],_stableRoundedSplineRail:true};
            const sampler=createStableSplineRailSampler(6),round=Math.max(0,Math.min(2,Number(roundingFrac)||0));
            if(profileMode==='spline')
                splinePathForDraw(sampler,pts,Boolean(path.closed),round,path.cornerFlags||[],path.bridgeRoundFlags||[]);
            else
                roundPolylineForDraw(sampler,pts,Boolean(path.closed),round,path.cornerFlags||[]);
            const raw=sampler.points.length>1?sampler.points:pts;

            const count=Math.max(48,Math.min(960,Math.max(pts.length||0,raw.length||0)));
            return {
                points:resampleMorphTopology(raw,count,Boolean(path.closed),null),
                closed:Boolean(path.closed),cornerFlags:[],bridgeRoundFlags:[],
                _stableRoundedSplineRail:true
            };
        }
        function getStableSmoothRoundedEndpointRails(layerIndex,side){
            const serial=Math.max(0,Number(runtimeState.morph?.lampCycleSerial)||0);
            if(stableSmoothRoundedMorphRailCache.serial!==serial){
                stableSmoothRoundedMorphRailCache.serial=serial;
                stableSmoothRoundedMorphRailCache.source.length=0;
                stableSmoothRoundedMorphRailCache.target.length=0;
            }
            const bucket=side==='target'?stableSmoothRoundedMorphRailCache.target:stableSmoothRoundedMorphRailCache.source;
            if(bucket[layerIndex])return bucket[layerIndex];
            const paths=(side==='target'?runtimeState.morph.targetGeometry:runtimeState.morph.sourceGeometry)?.[layerIndex]||[];
            const visual=(side==='target'?runtimeState.morph.targetVisuals:runtimeState.morph.sourceVisuals)?.[layerIndex]||{};
            const profile=(side==='target'?runtimeState.morph.targetProfiles:runtimeState.morph.sourceProfiles)?.[layerIndex]||{};
            const layer=state.layers?.[layerIndex];
            const round=getRoundingStrength(visual.rounding ?? layer?.rounding);
            const mode=profile.mode||layer?.profileMode||'segments';
            const rails=paths.map(path=>sampleStableSmoothRoundedEndpointPath(path,round,mode,layer?.splineRenderMode));
            bucket[layerIndex]=rails;
            return rails;
        }
        function buildCurrentStableSmoothRoundedMorphPaths(layerIndex,t){
            const tt=Number.isFinite(Number(t))?Number(t):0;
            const fastHit=getMorphFrameFastHit(layerIndex,tt,'stableRounded');
            if(fastHit)return fastHit;
            const sourcePaths=getStableSmoothRoundedEndpointRails(layerIndex,'source');
            const targetPaths=getStableSmoothRoundedEndpointRails(layerIndex,'target');
            if(!sourcePaths.length||!targetPaths.length)return [];
            const result=frameGeometryRuntime.active?getFrameOutputPool(morphFrameOutputPools,layerIndex):[];
            if(typeof getMorphFrameInterpolationPlan==='function'&&typeof interpolateMorphFramePlan==='function'){
                const plan=getMorphFrameInterpolationPlan(layerIndex,sourcePaths,targetPaths,'stableRounded');
                interpolateMorphFramePlan(plan,tt,result,true);
            }else{
                const pairs=pairMorphPaths(sourcePaths,targetPaths);
                const radial=Boolean(state.morph.options.byVertices||state.morph.options.bySteps||state.morph.monoOrbitTransforms);
                const chaosCalm=state.morph.mode==='calm'&&isChaosCircleMorphPair(layerIndex);
                let write=0;
                for(const pair of pairs){
                    const sp=pair.src,dp=pair.dst;if(!sp&&!dp)continue;
                    const closed=Boolean((sp&&dp)?(sp.closed&&dp.closed):(dp||sp).closed);
                    let base=null;
                    if(sp&&dp){
                        const srcPts=sp.points||[],dstPts=dp.points||[];if(!srcPts.length||!dstPts.length)continue;
                        let morphDst=dp;
                        if(pair.radialMerge||pair.radialSplit){
                            const sa=pathReferenceAngle(sp),da=pathReferenceAngle(dp);
                            morphDst=rotateMorphPath(dp,signedAngleDelta(da,sa)*(1-tt));
                        }
                        const morphDstPts=morphDst.points||[];
                        const n=Math.max(srcPts.length,morphDstPts.length);
                        const useRadial=closed&&(chaosCalm||(radial&&(pair.radialMerge||pair.radialSplit)));
                        const srcPolar=useRadial?unwrapPolarPath(srcPts):null,dstPolar=useRadial?unwrapPolarPath(morphDstPts):null;
                        let scratch=pair._stableRoundedFrameScratch;
                        if(!scratch||scratch.length!==n)scratch=pair._stableRoundedFrameScratch=Array.from({length:n},()=>({x:0,y:0}));
                        const referenceOffset=getMorphReferenceVertexOffset(pair,morphDstPts.length,closed,state.layers[layerIndex]?.N);
                        for(let i=0;i<n;i++){
                            const si=i%srcPts.length,di=(i+referenceOffset)%morphDstPts.length,o=scratch[i];
                            if(useRadial){
                                const a=srcPolar[si],b=dstPolar[di],rr=a.radius+(b.radius-a.radius)*tt,aa=interpolateMorphPolarAngle(a.angle,b.angle,tt);
                                o.x=rr*Math.cos(aa);o.y=rr*Math.sin(aa);
                            }else{
                                const a=srcPts[si],b=morphDstPts[di];o.x=a.x+(b.x-a.x)*tt;o.y=a.y+(b.y-a.y)*tt;
                            }
                            o.widthScale=1;
                        }
                        base=scratch;
                    }else base=(sp?.points||dp?.points||[]);
                    if(base?.length>1){
                        let item=result[write];if(!item)item=result[write]={};
                        item.points=base;item.closed=closed;item.cornerFlags=[];item.bridgeRoundFlags=[];
                        item._src=sp||null;item._dst=dp||null;item._stableRoundedSplineRail=true;write++;
                    }
                }
                result.length=write;
            }
            if(frameGeometryRuntime.active){result._frameGeometryId=frameGeometryRuntime.frameId;frameGeometryRuntime.stats.morphBuilds++;setMorphFrameFastResult(layerIndex,tt,result,'stableRounded');}
            return result;
        }

        let canonicalLampMorphPathDepth = 0;
        function buildCurrentMorphPathsForLamps(layerIndex,t){
            canonicalLampMorphPathDepth++;
            try { return buildCurrentMorphPaths(layerIndex,t); }
            finally { canonicalLampMorphPathDepth=Math.max(0,canonicalLampMorphPathDepth-1); }
        }

        function buildCurrentMorphPaths(layerIndex, t) {
            if(canonicalLampMorphPathDepth===0 && shouldUseStableSmoothRoundedMorph(layerIndex)) return buildCurrentStableSmoothRoundedMorphPaths(layerIndex,t);
            const tt=Number.isFinite(Number(t))?Number(t):0;
            const fastHit=getMorphFrameFastHit(layerIndex,tt,'canonical');
            if(fastHit)return fastHit;
            const sourcePaths=runtimeState.morph.sourceGeometry?.[layerIndex] || [];
            const targetPaths=runtimeState.morph.targetGeometry?.[layerIndex] || [];
            if(!sourcePaths.length || !targetPaths.length) return [];
            const result=frameGeometryRuntime.active ? getFrameOutputPool(morphFrameOutputPools,layerIndex) : [];
            if(typeof getMorphFrameInterpolationPlan==='function'&&typeof interpolateMorphFramePlan==='function'){
                const plan=getMorphFrameInterpolationPlan(layerIndex,sourcePaths,targetPaths,'canonical');
                interpolateMorphFramePlan(plan,tt,result,false);
            }else{
                const pairs=pairMorphPaths(sourcePaths,targetPaths);
                const radial=Boolean(state.morph.options.byVertices || state.morph.options.bySteps || state.morph.monoOrbitTransforms);
                const chaosCalm=state.morph.mode==='calm' && isChaosCircleMorphPair(layerIndex);
                let write=0;
                for(const pair of pairs){
                    const sp=pair.src, dp=pair.dst; if(!sp&&!dp) continue;
                    const closed=Boolean((sp&&dp)?(sp.closed&&dp.closed):(dp||sp).closed);
                    let base=null;
                    if(sp&&dp){
                        const srcPts=sp.points||[], dstPts=dp.points||[]; if(!srcPts.length||!dstPts.length) continue;
                        let morphDst=dp;
                        if(pair.radialMerge||pair.radialSplit){
                            const sa=pathReferenceAngle(sp),da=pathReferenceAngle(dp);
                            morphDst=rotateMorphPath(dp,signedAngleDelta(da,sa)*(1-tt));
                        }
                        const morphDstPts=morphDst.points||[];
                        const n=Math.max(srcPts.length,morphDstPts.length);
                        const useRadial=closed&&(chaosCalm || (radial&&(pair.radialMerge||pair.radialSplit)));
                        const srcPolar=useRadial?unwrapPolarPath(srcPts):null,dstPolar=useRadial?unwrapPolarPath(morphDstPts):null;
                        let scratch=pair._frameScratch;
                        if(!scratch||scratch.length!==n)scratch=pair._frameScratch=Array.from({length:n},()=>({x:0,y:0}));
                        const referenceOffset=getMorphReferenceVertexOffset(pair,morphDstPts.length,closed,state.layers[layerIndex]?.N);
                        for(let i=0;i<n;i++){
                            const si=i%srcPts.length,di=(i+referenceOffset)%morphDstPts.length,o=scratch[i];
                            if(useRadial){
                                const a=srcPolar[si],b=dstPolar[di],rr=a.radius+(b.radius-a.radius)*tt,aa=interpolateMorphPolarAngle(a.angle,b.angle,tt);
                                o.x=rr*Math.cos(aa);o.y=rr*Math.sin(aa);
                                o.widthScale=(Number(srcPts[si]?.widthScale)||1)+((Number(morphDstPts[di]?.widthScale)||1)-(Number(srcPts[si]?.widthScale)||1))*tt;
                            }else{
                                const a=srcPts[si],b=morphDstPts[di];
                                o.x=a.x+(b.x-a.x)*tt;o.y=a.y+(b.y-a.y)*tt;
                                o.widthScale=(Number(a.widthScale)||1)+((Number(b.widthScale)||1)-(Number(a.widthScale)||1))*tt;
                            }
                        }
                        base=scratch;
                    }else base=(sp?.rawPoints||sp?.points||dp?.rawPoints||dp?.points||[]);
                    if(base?.length>1){
                        let item=result[write];if(!item)item=result[write]={};
                        item.points=base; item.closed=closed; item.cornerFlags=(sp?.cornerFlags||dp?.cornerFlags||[]);
                        item._src=sp||null; item._dst=dp||null;write++;
                    }
                }
                result.length=write;
            }
            if(frameGeometryRuntime.active){
                result._frameGeometryId=frameGeometryRuntime.frameId;
                frameGeometryRuntime.stats.morphBuilds++;
                setMorphFrameFastResult(layerIndex,tt,result,'canonical');
            }
            return result;
        }
