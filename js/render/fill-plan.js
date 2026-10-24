window.__spiroRegisterModule?.('js/render/fill-plan');


var FillMeshPreparer = (() => {
    let cache = new WeakMap();
    let dynamicCache = new WeakMap();
    let frameContourCache = new WeakMap();
    let spiralMorphCache = new WeakMap();
    let spiralInterwindingCache = new WeakMap();
    let evictedMeshes = [];
    const MAX_VARIANTS_PER_DRAW_DATA = 16;
    const EPS = 1e-8;
    let builds = 0, hits = 0, contoursSeen = 0, degenerateContours = 0;
    let variantEvictions = 0, preparedFrames = 0, skippedFrames = 0;
    let sourcePoints = 0, emittedEdges = 0, fanBytes = 0, linearPlans = 0;
    let dynamicBuilds = 0, dynamicReuses = 0, dynamicSourcePoints = 0, dynamicEdges = 0, dynamicFanBytes = 0;

    function samePoint(a, b) {
        return Math.abs(Number(a?.x) - Number(b?.x)) <= EPS && Math.abs(Number(a?.y) - Number(b?.y)) <= EPS;
    }

    function cleanContourPoints(points) {
        if (!Array.isArray(points) || points.length < 3) return null;
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const p = points[i], x = Number(p?.x), y = Number(p?.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            if (!out.length || !samePoint(out[out.length - 1], p)) out.push(p);
        }
        if (out.length > 2 && samePoint(out[0], out[out.length - 1])) out.pop();
        return out.length >= 3 ? out : null;
    }

    function renderedContourPoints(layer, contour) {
        if(contour?.spiralBand===true&&Array.isArray(contour?.points))return cleanContourPoints(contour.points);
        const path = contour?.path;
        if (!path?.points?.length) return null;
        const sampler = createLampRenderedPathSampler();
        const rounding = getRoundingStrength(layer?.rounding);
        if (useSmoothSplinePath(layer, rounding, path)) {
            splinePathForDraw(sampler, path.points, true, rounding, path.cornerFlags || [], path.bridgeRoundFlags || []);
        } else {
            roundPolylineForDraw(sampler, path.points, true, rounding, path.cornerFlags || []);
        }
        return cleanContourPoints(sampler.points.length >= 3 ? sampler.points : path.points);
    }


    function sampleSpiralBranchPath(path) {
        const cubics=Array.isArray(path?._bezierSegments)?path._bezierSegments:null;
        if(cubics?.length){
            const out=[];
            const evalCubic=(seg,t)=>{const q=1-t,p0=seg.p0,c1=seg.c1,c2=seg.c2,p3=seg.p3;return{x:q*q*q*p0.x+3*q*q*t*c1.x+3*q*t*t*c2.x+t*t*t*p3.x,y:q*q*q*p0.y+3*q*q*t*c1.y+3*q*t*t*c2.y+t*t*t*p3.y};};
            const subdiv=8;
            for(let si=0;si<cubics.length;si++){const seg=cubics[si];if(!seg?.p0||!seg?.p3)continue;for(let j=0;j<subdiv;j++){if(si>0&&j===0)continue;out.push(evalCubic(seg,j/subdiv));}if(si===cubics.length-1)out.push(evalCubic(seg,1));}
            return cleanContourPoints(out.length>=2?out:path?.points||[]);
        }
        const pts=(path?.points||[]).filter(p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))).map(p=>({x:Number(p.x),y:Number(p.y)}));
        return pts.length>=2?pts:null;
    }

    function getSpiralBandPaths(drawData, layer) {
        if(!isSpiralLayer(layer)||layer?.spiralClosed===false||layer?.spiralFillEnabled!==true)return null;
        const paths=(drawData?.paths||[]).filter(p=>p?.closed!==true&&Array.isArray(p?.points)&&p.points.length>=2);
        if(paths.length<2||paths.length%2!==0)return null;
        const sorted=paths.slice().sort((a,b)=>{const ai=Number(a?.spiralBranchIndex),bi=Number(b?.spiralBranchIndex);if(Number.isFinite(ai)&&Number.isFinite(bi))return ai-bi;return (Number(a?.orbitIndex)||0)-(Number(b?.orbitIndex)||0);});
        return sorted;
    }

    function hasSpiralBandTopology(drawData, layer) {
        const paths=getSpiralBandPaths(drawData,layer);
        return Boolean(paths&&paths.length>=2&&paths.length%2===0);
    }

    function buildSpiralBandContours(drawData, layer) {
        const paths=getSpiralBandPaths(drawData,layer);
        if(!paths)return null;
        const contours=[];
        for(let i=0;i<paths.length;i+=2){
            const a=sampleSpiralBranchPath(paths[i]),b=sampleSpiralBranchPath(paths[i+1]);
            if(!a||!b||a.length<2||b.length<2)continue;
            const points=[];for(const p of a)points.push({x:Number(p.x),y:Number(p.y)});for(let j=b.length-1;j>=0;j--)points.push({x:Number(b[j].x),y:Number(b[j].y)});
            const clean=cleanContourPoints(points);if(clean?.length>=3)contours.push({path:{points:clean,closed:true},points:clean,closed:true,fillEligible:true,spiralBand:true,pairIndex:i/2});
        }
        return contours.length*2===paths.length?contours:null;
    }

    // Transform does not depend on the source point.  A Spiral/Corridor fill may
    // project tens of thousands of points per frame: compute scale/sin/cos once
    // per copy, rather than calling the Morph phase resolver for *every point*.
    // Preserve the exact arithmetic order of the original point mapping.
    function transformSpiralFillPoint(p,transform){
        const {sc,c,sn}=transform,x=Number(p?.x)||0,y=Number(p?.y)||0;
        return{x:(c*x-sn*y)*sc,y:(sn*x+c*y)*sc};
    }
    function branchDelta(path){
        const meta=path?.points?.[0],d=Number(meta?.__spiralDelta);if(Number.isFinite(d))return d;
        const pts=path?.points||[];if(pts.length<2)return 0;
        const a=pts[0],b=pts[pts.length-1];let q=Math.atan2(Number(b.y)||0,Number(b.x)||0)-Math.atan2(Number(a.y)||0,Number(a.x)||0);
        while(q>Math.PI)q-=Math.PI*2;while(q<=-Math.PI)q+=Math.PI*2;return q;
    }
    function buildFanMeshFromBands(layer,bands,frameCtx,semantic,flags={}){
        if(!bands?.length)return null;
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,totalEdges=0,totalPoints=0;
        const cleanBands=[];
        for(const raw of bands){const pts=cleanContourPoints(raw);if(!pts||pts.length<3)return null;cleanBands.push(pts);totalPoints+=pts.length;totalEdges+=pts.length;for(const q of pts){const x=Number(q.x),y=Number(q.y);if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}}
        if(!totalEdges||!Number.isFinite(minX)||!Number.isFinite(minY)||!Number.isFinite(maxX)||!Number.isFinite(maxY))return null;
        let entry=spiralInterwindingCache.get(layer);if(!entry){entry={capacityFloats:0,storage:null,mesh:{dynamic:true,dynamicScreenSpace:false,revision:0,frameId:-1,fanData:null,fanFloatCount:0,fanTriangleCount:0,complete:false,nativeComplete:false,records:[]}};spiralInterwindingCache.set(layer,entry);}
        const need=totalEdges*6;if(!entry.storage||entry.capacityFloats<need){let cap=Math.max(384,entry.capacityFloats||0);while(cap<need)cap=Math.ceil(cap*1.6);entry.capacityFloats=cap;entry.storage=new Float32Array(cap);}
        const span=Math.max(1,maxX-minX,maxY-minY),anchorX=minX-span*2-1,anchorY=minY-span*2-1,out=entry.storage;let o=0;
        for(const pts of cleanBands)for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];if(samePoint(a,b))continue;out[o++]=anchorX;out[o++]=anchorY;out[o++]=Number(a.x);out[o++]=Number(a.y);out[o++]=Number(b.x);out[o++]=Number(b.y);}
        const mesh=entry.mesh;mesh.fanData=entry.storage;mesh.fanFloatCount=o;mesh.fanTriangleCount=Math.floor(o/6);mesh.complete=mesh.fanTriangleCount>0;mesh.nativeComplete=mesh.complete;mesh.frameId=Number(frameCtx?.frameId)||0;mesh.revision=(mesh.revision+1)>>>0||1;mesh.anchor={x:anchorX,y:anchorY};mesh.totalVertices=totalPoints;mesh.totalTriangles=mesh.fanTriangleCount;mesh.spiralBandCount=cleanBands.length;mesh.spiralBandFill=true;mesh.semantic=semantic;Object.assign(mesh,flags);frameCtx._fillMeshShadow=mesh;return mesh;
    }
    function prepareInterwindingCorridor(frameCtx,auxPaths=null){
        const layer=frameCtx?.layer;
        if(!layer?.fill||layer?.spiralFillEnabled!==true||layer?.spiralFillType!=='interwinding'||layer?.spiralClosed===false||!isSpiralLayer(layer)||state?.tunnel?.active!==true)return null;
        let paths;
        if(Array.isArray(auxPaths)&&auxPaths.length){
            paths=auxPaths.filter(p=>Array.isArray(p?.points)&&p.points.length>=2&&Number(p?.alpha??1)>.00001).slice();
            const phase=(p,i)=>Number.isFinite(Number(p?.branchPhase))?((Number(p.branchPhase)%1)+1)%1:(Number.isFinite(Number(p?.spiralBranchIndex))?Number(p.spiralBranchIndex):i)/Math.max(1,paths.length);
            paths.forEach((p,i)=>p.__interwindSort=phase(p,i));paths.sort((a,b)=>(Number(a.__interwindSort)||0)-(Number(b.__interwindSort)||0));
        }else{
            const drawData=frameCtx?.geometryPlan?.sourceData||frameCtx?.staticDrawData;paths=getSpiralBandPaths(drawData,layer);
        }
        if(!paths||paths.length<2||paths.length%2!==0)return null;
        const samples=paths.map(sampleSpiralBranchPath);if(samples.some(p=>!p||p.length<2))return null;
        const sourceCopies=Array.isArray(frameCtx?.visibleInstances?.copies)?frameCtx.visibleInstances.copies:[];
        const sourceAlphas=frameCtx?.visibleInstances?.fillAlphas||frameCtx?.visibleInstances?.alphas||[];
        const copies=sourceCopies.map((copy,i)=>({copy,alpha:Number(sourceAlphas[i]??1)})).filter(r=>r.alpha>.0005&&Number(r.copy?.scale)>0).sort((a,b)=>Number(b.copy.scale)-Number(a.copy.scale));
        if(!copies.length)return null;
        const n=paths.length,TWO=Math.PI*2;
        const transforms=copies.map(r=>{
            const copy=r.copy,sc=Math.max(.000001,Math.abs(Number(copy?.scale)||1));
            let ang=0;try{ang=typeof getMotionTunnelLagRadians==='function'?(Number(getMotionTunnelLagRadians(copy,layer))||0):0;}catch(_){}
            return{sc,c:Math.cos(ang),sn:Math.sin(ang),ang};
        });
        const branchDeltas=paths.map(branchDelta);
        const rails=[];
        for(let seed=0;seed<n;seed++){
            const rail=[];let idx=seed;
            for(let ci=0;ci<copies.length;ci++){
                const pts=samples[idx],transform=transforms[ci];
                for(let pi=0;pi<pts.length;pi++){const q=transformSpiralFillPoint(pts[pi],transform);if(!rail.length||pi>0||Math.hypot(q.x-rail[rail.length-1].x,q.y-rail[rail.length-1].y)>1e-7)rail.push(q);}
                if(ci+1<copies.length){const d=branchDeltas[idx],shift=Math.round((d+transforms[ci].ang-transforms[ci+1].ang)*n/TWO);idx=((idx+shift)%n+n)%n;}
            }
            rails.push(rail);
        }
        const bands=[];for(let i=0;i<n;i+=2){const a=rails[i],b=rails[i+1];if(!a?.length||!b?.length)return null;const pts=[];for(const q of a)pts.push(q);for(let j=b.length-1;j>=0;j--)pts.push(b[j]);bands.push(pts);}
        return buildFanMeshFromBands(layer,bands,frameCtx,'interwinding Spiral Fill: neighboring rails are continued through Corridor periods before stencil fill',{spiralInterwindingFill:true,corridorBaked:true});
    }

    function keyFor(layer) {
        return [
            Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(layer?.rounding) || 0)).toFixed(4),
            String(layer?.profileMode || 'segments'),
            normalizeSplineRenderMode(layer?.splineRenderMode),
            state.fourierMode ? 1 : 0
        ].join('|');
    }

    function prepareStatic(drawData, layer) {
        if (!drawData || typeof drawData !== 'object') return null;
        const key = keyFor(layer);
        let variants = cache.get(drawData);
        if (!variants) { variants = new Map(); cache.set(drawData, variants); }
        const cached = variants.get(key);
        if (cached) { hits++; return cached; }

        const canonical = GeometryKernel.inspectStaticDrawData(drawData);
        const spiralBandContours=buildSpiralBandContours(drawData,layer);
        const sourceContours=spiralBandContours||canonical.fillContours||[];
        const records = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let totalPoints = 0, rejected = 0;

        for (const contour of sourceContours) {
            contoursSeen++;
            const points = renderedContourPoints(layer, contour);
            if (!points || points.length < 3) {
                degenerateContours++; rejected++;
                records.push({ contour, status: 'degenerate', pointCount: 0, points: null });
                continue;
            }
            for (let i = 0; i < points.length; i++) {
                const p = points[i], x = Number(p.x), y = Number(p.y);
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            totalPoints += points.length;
            records.push({ contour, status: 'stencil-edge-fan', pointCount: points.length, points });
        }

        let fanData = null, fanTriangleCount = 0, anchor = null;
        const validRecords = records.filter(r => r.status === 'stencil-edge-fan');
        if (validRecords.length && Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
            const span = Math.max(1, maxX - minX, maxY - minY);

            anchor = { x: minX - span * 2 - 1, y: minY - span * 2 - 1 };
            fanData = new Float32Array(totalPoints * 6);
            let o = 0;
            for (const rec of validRecords) {
                const points = rec.points;
                rec.fanOffset = o / 2;
                rec.fanTriangleOffset = fanTriangleCount;
                for (let i = 0; i < points.length; i++) {
                    const a = points[i], b = points[(i + 1) % points.length];
                    if (samePoint(a, b)) continue;
                    fanData[o++] = anchor.x; fanData[o++] = anchor.y;
                    fanData[o++] = Number(a.x); fanData[o++] = Number(a.y);
                    fanData[o++] = Number(b.x); fanData[o++] = Number(b.y);
                    fanTriangleCount++;
                }
                rec.fanTriangleCount = fanTriangleCount - rec.fanTriangleOffset;
                rec.points = null; // release object rail; GPU plan is the canonical fill representation.
            }
            if (o !== fanData.length) fanData = fanData.slice(0, o);
        }

        builds++; linearPlans++; sourcePoints += totalPoints; emittedEdges += fanTriangleCount;
        fanBytes += fanData?.byteLength || 0;
        const complete = validRecords.length > 0 && rejected === 0 && fanTriangleCount > 0;
        const result = {
            key, drawData, records, anchor, fanData, fanTriangleCount,
            meshable: validRecords.length,
            stencilRequired: validRecords.length,
            rejected,
            totalVertices: totalPoints,
            totalTriangles: fanTriangleCount,
            complete,
            nativeComplete: complete,
            preparationComplexity: 'O(N)',
            spiralBandFill:Boolean(spiralBandContours),
            spiralBandCount:spiralBandContours?.length||0,
            semantic: spiralBandContours ? 'closed even Spiral: alternating neighboring branch-pairs -> closed stencil bands' : 'canonical linear stencil Fill: all contours share one stencil field and one color composite'
        };

        variants.set(key, result);
        while (variants.size > MAX_VARIANTS_PER_DRAW_DATA) {
            const oldestKey = variants.keys().next().value;
            const oldPlan = variants.get(oldestKey);
            variants.delete(oldestKey);
            if (oldPlan) { evictedMeshes.push(oldPlan); variantEvictions++; }
        }
        return result;
    }

    function prepareFrame(frameCtx) {
        const layer = frameCtx?.layer, plan = frameCtx?.geometryPlan || {};
        if (!layer?.fill || plan.dynamic === true) {
            skippedFrames++; return null;
        }
        const drawData = plan.sourceData || frameCtx.staticDrawData;
        if (!drawData || (isSpiralLayer(layer) && !hasSpiralBandTopology(drawData,layer))) { skippedFrames++; return null; }
        const fillPlan = prepareStatic(drawData, layer);
        frameCtx._fillMeshShadow = fillPlan;
        preparedFrames++;
        return fillPlan;
    }

    function canUseNative(frameCtx) {
        const fillPlan = frameCtx?._fillMeshShadow || prepareFrame(frameCtx), plan = frameCtx?.geometryPlan || {};
        return Boolean(fillPlan?.nativeComplete && fillPlan.fanTriangleCount > 0 && plan.dynamic !== true &&
            (!isSpiralLayer(frameCtx?.layer) || fillPlan?.spiralBandFill===true) && !state.fourierMode && !state.showRoundingGuides);
    }

    function prepareSpiralMorphBands(frameCtx, auxPaths) {
        const layer=frameCtx?.layer;
        if(!layer?.fill||layer?.spiralFillEnabled!==true||layer?.spiralClosed===false||!isSpiralLayer(layer)||!Array.isArray(auxPaths)||auxPaths.length<2)return null;
        // The static Spiral edit renderer owns its own exact endpoint pair.
        // Do not fall back to unrelated Blue endpoints while an edit is active.
        const sourceLayer=frameCtx?.spiralEditMorph?.sourceLayer||frameCtx?.blueMorphProvider?.sourceLayer||frameCtx?.sourceLayer||frameCtx?.geometryPlan?.sourceLayer||null;
        const targetLayer=frameCtx?.spiralEditMorph?.targetLayer||frameCtx?.blueMorphProvider?.targetLayer||frameCtx?.geometryPlan?.targetLayer||null;
        const sourceClosed=sourceLayer?.spiralEnabled===true?sourceLayer.spiralClosed!==false:true;
        const targetClosed=targetLayer?.spiralEnabled===true?targetLayer.spiralClosed!==false:true;
        if(!sourceClosed||!targetClosed)return null;
        const srcN=Math.max(2,Math.round(Number(sourceLayer?.N)||auxPaths.length));
        const dstN=Math.max(2,Math.round(Number(targetLayer?.N)||auxPaths.length));
        // Alternating bands are unambiguous through Morph only while both endpoint branch counts are even.
        if((srcN&1)!==0||(dstN&1)!==0)return null;
        const paths=auxPaths.filter(p=>Array.isArray(p?.points)&&p.points.length>=2&&Number(p?.alpha??1)>.00001).slice();
        if(paths.length<2||paths.length%2!==0)return null;
        const phaseKey=(p,idx)=>{
            if(Number.isFinite(Number(p?.branchPhase)))return ((Number(p.branchPhase)%1)+1)%1;
            const a=Number(p?.sourceBranchIndex),b=Number(p?.targetBranchIndex),sn=Math.max(1,Number(p?.sourceBranchCount)||srcN),dn=Math.max(1,Number(p?.targetBranchCount)||dstN);
            if(Number.isFinite(a)&&Number.isFinite(b)){
                const sa=((a/sn)%1+1)%1,db=((b/dn)%1+1)%1;let d=db-sa;d=((d+.5)%1+1)%1-.5;
                return ((sa+d*.5)%1+1)%1;
            }
            if(Number.isFinite(a))return ((a/sn)%1+1)%1;
            if(Number.isFinite(b))return ((b/dn)%1+1)%1;
            return idx/Math.max(1,paths.length);
        };
        paths.forEach((p,i)=>{p.__fillSortKey=phaseKey(p,i);});
        paths.sort((a,b)=>(Number(a.__fillSortKey)||0)-(Number(b.__fillSortKey)||0));

        let totalEdges=0,totalPoints=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        const bands=[];
        for(let i=0;i<paths.length;i+=2){
            const ap=paths[i].points,bp=paths[i+1].points,pts=[];
            for(const q of ap)pts.push(q);for(let j=bp.length-1;j>=0;j--)pts.push(bp[j]);
            const clean=cleanContourPoints(pts);if(!clean||clean.length<3)return null;
            bands.push(clean);totalPoints+=clean.length;totalEdges+=clean.length;
            for(const q of clean){const x=Number(q.x),y=Number(q.y);if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
        }
        if(!totalEdges||!Number.isFinite(minX)||!Number.isFinite(minY)||!Number.isFinite(maxX)||!Number.isFinite(maxY))return null;
        let entry=spiralMorphCache.get(layer);
        if(!entry){entry={capacityFloats:0,storage:null,mesh:{dynamic:true,dynamicScreenSpace:false,spiralBandFill:true,revision:0,frameId:-1,fanData:null,fanFloatCount:0,fanTriangleCount:0,complete:false,nativeComplete:false,records:[],semantic:'dynamic retained Spiral alternating branch-pair Fill'}};spiralMorphCache.set(layer,entry);}
        const need=totalEdges*6;if(!entry.storage||entry.capacityFloats<need){let cap=Math.max(192,entry.capacityFloats||0);while(cap<need)cap=Math.ceil(cap*1.6);entry.capacityFloats=cap;entry.storage=new Float32Array(cap);}
        const span=Math.max(1,maxX-minX,maxY-minY),anchorX=minX-span*2-1,anchorY=minY-span*2-1,out=entry.storage;let o=0;
        for(const pts of bands)for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];if(samePoint(a,b))continue;out[o++]=anchorX;out[o++]=anchorY;out[o++]=Number(a.x);out[o++]=Number(a.y);out[o++]=Number(b.x);out[o++]=Number(b.y);}
        const mesh=entry.mesh;mesh.fanData=entry.storage;mesh.fanFloatCount=o;mesh.fanTriangleCount=Math.floor(o/6);mesh.complete=mesh.fanTriangleCount>0;mesh.nativeComplete=mesh.complete;mesh.frameId=Number(frameCtx?.frameId)||0;mesh.revision=(mesh.revision+1)>>>0||1;mesh.anchor={x:anchorX,y:anchorY};mesh.totalVertices=totalPoints;mesh.totalTriangles=mesh.fanTriangleCount;mesh.spiralBandCount=bands.length;
        frameCtx._fillMeshShadow=mesh;return mesh;
    }

    // Convert the actual Line stroke commands into closed Fill contours.
    // A sharp profile can be emitted as several open Bezier subpaths inside ONE stroke command.
    // Visually those subpaths are one polygonal contour because every segment ends exactly where
    // the next one starts. Fill must therefore stitch that command back into the same boundary
    // instead of requiring every individual segment to carry `closed:true`.
    //
    // Important: stitching never crosses stroke-command boundaries. Separate commands can be
    // different orbits / alpha carriers and must not be invented into one contour.
    const LINE_JOIN_EPS = 1e-3; // screen-space px; only endpoint continuity, not proximity filling.
    function lineJoinSamePoint(a,b){
        const ax=Number(a?.x),ay=Number(a?.y),bx=Number(b?.x),by=Number(b?.y);
        return Number.isFinite(ax)&&Number.isFinite(ay)&&Number.isFinite(bx)&&Number.isFinite(by)&&Math.abs(ax-bx)<=LINE_JOIN_EPS&&Math.abs(ay-by)<=LINE_JOIN_EPS;
    }
    function normalizedLinePoints(points){
        if(!Array.isArray(points)||points.length<2)return null;
        const out=[];
        for(const p of points){
            const x=Number(p?.x),y=Number(p?.y);if(!Number.isFinite(x)||!Number.isFinite(y))return null;
            const q={x,y};if(!out.length||!lineJoinSamePoint(out[out.length-1],q))out.push(q);
        }
        return out.length>=2?out:null;
    }
    function collectLineCarrierContours(commands){
        const contours=[];
        if(!Array.isArray(commands))return contours;
        const commitOpen=(chain)=>{
            if(!chain||chain.length<3||!lineJoinSamePoint(chain[0],chain[chain.length-1]))return;
            const pts=chain.slice();if(lineJoinSamePoint(pts[0],pts[pts.length-1]))pts.pop();
            const clean=cleanContourPoints(pts);if(clean?.length>=3)contours.push(clean.map(p=>({x:Number(p.x),y:Number(p.y)})));
        };
        for(const cmd of commands){
            let chain=null;
            const flush=()=>{commitOpen(chain);chain=null;};
            for(const sp of cmd?.subpaths||[]){
                const pts=normalizedLinePoints(sp?.points);if(!pts)continue;
                if(sp?.closed===true){
                    flush();const clean=cleanContourPoints(pts);if(clean?.length>=3)contours.push(clean.map(p=>({x:Number(p.x),y:Number(p.y)})));continue;
                }
                if(!chain){chain=pts.slice();continue;}
                const tail=chain[chain.length-1],first=pts[0],last=pts[pts.length-1];
                if(lineJoinSamePoint(tail,first)){
                    for(let i=1;i<pts.length;i++)chain.push(pts[i]);
                }else if(lineJoinSamePoint(tail,last)){
                    for(let i=pts.length-2;i>=0;i--)chain.push(pts[i]);
                }else{
                    flush();chain=pts.slice();
                }
            }
            flush();
        }
        return contours;
    }


    // Somata 7.8: ordinary Fill consumes the already-connected FrameContour.
    // No second topology reconstruction is allowed here.  screenPaths are the exact
    // screen-space points owned by the same Line carrier that the visible Line uses.
    function prepareFrameContour(frameCtx, record) {
        const layer=frameCtx?.layer,paths=record?.screenPaths;
        if(!layer||!Array.isArray(paths)||!paths.length)return null;
        const isDynamic=frameCtx?.geometryPlan?.dynamic===true,fid=Number(frameCtx?.frameId)||0;
        let entry=frameContourCache.get(layer);
        if(!entry){
            entry={record:null,frameId:-1,capacityFloats:0,storage:null,mesh:{
                dynamic:isDynamic,dynamicScreenSpace:true,frameContourFill:true,lineCarrierFill:true,revision:0,frameId:-1,fanData:null,fanFloatCount:0,
                fanTriangleCount:0,complete:false,nativeComplete:false,records:[],preparationComplexity:'O(N)',
                semantic:'Fill boundary = shared FrameContour screenPaths; no independent geometry reconstruction'
            }};frameContourCache.set(layer,entry);
        }else if(entry.record===record&&entry.frameId===fid&&entry.mesh.nativeComplete){
            dynamicReuses++;frameCtx._fillMeshShadow=entry.mesh;return entry.mesh;
        }
        const contours=[];let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,totalEdges=0,totalPoints=0;
        for(const path of paths){
            if(path?.closed!==true)continue;const pts=cleanContourPoints(path.points);if(!pts?.length)continue;contours.push(pts);totalPoints+=pts.length;
            for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],ax=Number(a.x),ay=Number(a.y),bx=Number(b.x),by=Number(b.y);
                if(ax<minX)minX=ax;if(ax>maxX)maxX=ax;if(ay<minY)minY=ay;if(ay>maxY)maxY=ay;if(!samePoint(a,b))totalEdges++;}
        }
        const mesh=entry.mesh;mesh.dynamic=isDynamic;mesh.frameId=fid;mesh.contourCount=contours.length;mesh.totalVertices=totalPoints;
        if(!totalEdges||!Number.isFinite(minX)||!Number.isFinite(minY)||!Number.isFinite(maxX)||!Number.isFinite(maxY)){
            mesh.fanFloatCount=0;mesh.fanTriangleCount=0;mesh.complete=false;mesh.nativeComplete=false;mesh.totalTriangles=0;mesh.revision=(mesh.revision+1)>>>0||1;entry.record=record;entry.frameId=fid;frameCtx._fillMeshShadow=mesh;return mesh;
        }
        const need=totalEdges*6;if(!entry.storage||entry.capacityFloats<need){let cap=Math.max(96,entry.capacityFloats||0);while(cap<need)cap=Math.ceil(cap*1.6);entry.capacityFloats=cap;entry.storage=new Float32Array(cap);}
        const span=Math.max(1,maxX-minX,maxY-minY),anchorX=minX-span*2-1,anchorY=minY-span*2-1,out=entry.storage;let o=0;
        for(const pts of contours)for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];if(samePoint(a,b))continue;out[o++]=anchorX;out[o++]=anchorY;out[o++]=Number(a.x);out[o++]=Number(a.y);out[o++]=Number(b.x);out[o++]=Number(b.y);}
        mesh.fanData=entry.storage;mesh.fanFloatCount=o;mesh.fanTriangleCount=Math.floor(o/6);mesh.complete=mesh.fanTriangleCount>0;mesh.nativeComplete=mesh.complete;mesh.revision=(mesh.revision+1)>>>0||1;mesh.anchor={x:anchorX,y:anchorY};mesh.totalTriangles=mesh.fanTriangleCount;
        entry.record=record;entry.frameId=fid;frameCtx._fillMeshShadow=mesh;dynamicBuilds++;dynamicSourcePoints+=totalPoints;dynamicEdges+=mesh.fanTriangleCount;dynamicFanBytes+=o*4;return mesh;
    }

    function prepareLineCarrierCommands(frameCtx, commands) {
        const layer = frameCtx?.layer;
        if (!layer || !Array.isArray(commands) || !commands.length) return null;
        const isDynamic=frameCtx?.geometryPlan?.dynamic===true;
        let entry = dynamicCache.get(layer);
        if (!entry) {
            entry = { frameId:-1, commands:null, dynamic:null, capacityFloats:0, storage:null, mesh:{
                dynamic:isDynamic, dynamicScreenSpace:true, lineCarrierFill:true, revision:0, frameId:-1, fanData:null, fanFloatCount:0,
                fanTriangleCount:0, complete:false, nativeComplete:false, records:[], preparationComplexity:'O(N)',
                semantic:'Fill boundary = exact frame-resident Line command contour; open Bezier segments are stitched only by shared endpoints'
            }};
            dynamicCache.set(layer, entry);
        } else if (entry.commands === commands && entry.dynamic === isDynamic && entry.mesh.nativeComplete && (!isDynamic || entry.frameId === Number(frameCtx.frameId))) {
            dynamicReuses++;entry.mesh.frameId=Number(frameCtx.frameId)||0;frameCtx._fillMeshShadow = entry.mesh;return entry.mesh;
        }

        const contours=collectLineCarrierContours(commands);
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,totalEdges=0,totalPoints=0;
        for(const pts of contours){
            totalPoints+=pts.length;
            for(let i=0;i<pts.length;i++){
                const a=pts[i],b=pts[(i+1)%pts.length],ax=Number(a.x),ay=Number(a.y),bx=Number(b.x),by=Number(b.y);
                if(ax<minX)minX=ax;if(ax>maxX)maxX=ax;if(ay<minY)minY=ay;if(ay>maxY)maxY=ay;
                if(Math.abs(ax-bx)>EPS||Math.abs(ay-by)>EPS)totalEdges++;
            }
        }
        const mesh=entry.mesh;mesh.dynamic=isDynamic;mesh.dynamicScreenSpace=true;mesh.lineCarrierFill=true;
        if(!totalEdges||!Number.isFinite(minX)||!Number.isFinite(minY)||!Number.isFinite(maxX)||!Number.isFinite(maxY)){
            mesh.fanFloatCount=0;mesh.fanTriangleCount=0;mesh.complete=false;mesh.nativeComplete=false;mesh.totalVertices=0;mesh.totalTriangles=0;mesh.contourCount=0;
            mesh.frameId=Number(frameCtx.frameId)||0;mesh.revision=(mesh.revision+1)>>>0||1;
            entry.frameId=mesh.frameId;entry.commands=commands;entry.dynamic=isDynamic;frameCtx._fillMeshShadow=mesh;return mesh;
        }
        const need=totalEdges*6;
        if(!entry.storage||entry.capacityFloats<need){
            let cap=Math.max(96,entry.capacityFloats||0);while(cap<need)cap=Math.ceil(cap*1.6);
            entry.capacityFloats=cap;entry.storage=new Float32Array(cap);
        }
        const span=Math.max(1,maxX-minX,maxY-minY),anchorX=minX-span*2-1,anchorY=minY-span*2-1;
        const out=entry.storage;let o=0;
        for(const pts of contours){
            for(let i=0;i<pts.length;i++){
                const a=pts[i],b=pts[(i+1)%pts.length],ax=Number(a.x),ay=Number(a.y),bx=Number(b.x),by=Number(b.y);
                if(Math.abs(ax-bx)<=EPS&&Math.abs(ay-by)<=EPS)continue;
                out[o++]=anchorX;out[o++]=anchorY;out[o++]=ax;out[o++]=ay;out[o++]=bx;out[o++]=by;
            }
        }
        mesh.fanData=entry.storage;mesh.fanFloatCount=o;mesh.fanTriangleCount=Math.floor(o/6);
        mesh.complete=mesh.fanTriangleCount>0;mesh.nativeComplete=mesh.complete;
        mesh.frameId=Number(frameCtx.frameId)||0;mesh.revision=(mesh.revision+1)>>>0||1;
        mesh.anchor={x:anchorX,y:anchorY};mesh.totalVertices=totalPoints;mesh.totalTriangles=mesh.fanTriangleCount;mesh.contourCount=contours.length;
        entry.frameId=mesh.frameId;entry.commands=commands;entry.dynamic=isDynamic;frameCtx._fillMeshShadow=mesh;
        dynamicBuilds++;dynamicSourcePoints+=totalPoints;dynamicEdges+=mesh.fanTriangleCount;dynamicFanBytes+=o*4;
        return mesh;
    }

    // Compatibility name for Corridor and older tests/call-sites. Dynamic callers now use the
    // same implementation as Static; only the supplied frame geometry decides what the mesh is.
    function prepareDynamicCommands(frameCtx,commands){
        if(frameCtx?.geometryPlan?.dynamic!==true)return null;
        return prepareLineCarrierCommands(frameCtx,commands);
    }

    function takeEvicted() { const out = evictedMeshes; evictedMeshes = []; return out; }
    function reset() { cache = new WeakMap(); dynamicCache = new WeakMap(); frameContourCache = new WeakMap(); spiralMorphCache = new WeakMap(); spiralInterwindingCache = new WeakMap(); evictedMeshes = []; }
    function status() {
        return {
            builds, hits, contoursSeen, degenerateContours, variantEvictions,
            maxVariantsPerDrawData: MAX_VARIANTS_PER_DRAW_DATA,
            preparedFrames, skippedFrames, sourcePoints, emittedEdges, fanBytes, linearPlans,
            dynamicBuilds,dynamicReuses,dynamicSourcePoints,dynamicEdges,dynamicFanBytes,
            classificationPasses: 0, earClippingPasses: 0,
            mode: 'linear-stencil-all', complexity: 'O(N)',
            semantic: 'ordinary Static + Dynamic + Corridor Fill use the exact shared Line/master FrameContour; strict Spiral retains its native adapter'
        };
    }
    return { prepareStatic, prepareFrame, prepareFrameContour, prepareLineCarrierCommands, prepareDynamicCommands, collectLineCarrierContours, prepareSpiralMorphBands, prepareInterwindingCorridor, canUseNative, hasSpiralBandTopology, buildSpiralBandContours, takeEvicted, status, reset };
})();

window.__spiroFillMeshPreparationStatus = () => FillMeshPreparer.status();
window.__spiroNativeFillPolicy = () => ({
    enabled: true,
    simpleStaticContours: true,
    selfIntersectionWindingStencil: true,
    selfIntersectionEvenOddStencil: true,
    selfIntersectionPolicy: 'native GPU stencil; no CPU intersection classification',
    defaultFillRule: 'evenodd',
    requiresNativeComplete: true,
    preparationComplexity: 'O(N)',
    excludes: ['fade/lightning geometry', 'open/odd-branch spiral', 'fourier', 'rounding-guides'],
    fallbackOrder: ['native-webgpu-stencil', 'exact-rule-mask->webgpu', 'exact-rule-mask->webgl2', 'exact-canvas-fill'],
    layerSceneResident: true,
    visibleSemantics: 'source-over, premultiplied, 4x MSAA; one composite per layer'
});
