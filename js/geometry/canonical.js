// SpiroStar v505 — Canonical Geometry boundary.
// One stable geometry object owns the authored/static path representation for a layer version.
// Render/effect consumers should derive from this object instead of independently rebuilding paths.
window.__spiroRegisterModule?.('js/geometry/canonical');

const canonicalGeometryCache = new WeakMap();
const canonicalGeometryByPaths = new WeakMap();
const canonicalGeometryByDrawData = new WeakMap();
const canonicalGeometryStats = {
    builds:0,
    hits:0,
    pathTableBuilds:0,
    pathTableHits:0,
    boundsBuilds:0,
    consumers:Object.create(null),
    lastBuild:null
};

function computeCanonicalPathSummary(paths, canonical){
    const out=canonical?.summary || {
        pathCount:0,closedPathCount:0,openPathCount:0,pointCount:0,segmentCount:0,
        invalidPointCount:0,variableWidthPointCount:0,fillContourCount:0,hasClosedFillTopology:false,
        minX:0,minY:0,maxX:0,maxY:0,width:0,height:0,maxRadius:1
    };
    const contours=canonical?.contours || [];
    const fillContours=canonical?.fillContours || [];
    let contourWrite=0,fillWrite=0;
    let pathCount=0,closed=0,open=0,pointCount=0,segmentCount=0,invalidPointCount=0,variableWidthPointCount=0;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,maxRadiusSq=0;
    const list=Array.isArray(paths)?paths:[];
    for(let pi=0;pi<list.length;pi++){
        const path=list[pi],pts=Array.isArray(path?.points)?path.points:[];if(!pts.length)continue;
        const isClosed=path?.closed===true;
        let c=contours[contourWrite];
        if(!c)c=contours[contourWrite]={};
        let cMinX=Infinity,cMinY=Infinity,cMaxX=-Infinity,cMaxY=-Infinity,cInvalid=0,signedArea2=0;
        pathCount++;if(isClosed)closed++;else open++;
        pointCount+=pts.length;
        const cSegments=Math.max(0,isClosed?pts.length:pts.length-1);segmentCount+=cSegments;
        for(let i=0;i<pts.length;i++){
            const p=pts[i],x=Number(p?.x),y=Number(p?.y);
            if(Number.isFinite(Number(p?.widthScale)))variableWidthPointCount++;
            if(!Number.isFinite(x)||!Number.isFinite(y)){cInvalid++;invalidPointCount++;continue;}
            if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
            if(x<cMinX)cMinX=x;if(x>cMaxX)cMaxX=x;if(y<cMinY)cMinY=y;if(y>cMaxY)cMaxY=y;
            const rr=x*x+y*y;if(rr>maxRadiusSq)maxRadiusSq=rr;
            if(isClosed&&pts.length>2){
                const q=pts[(i+1)%pts.length],qx=Number(q?.x),qy=Number(q?.y);
                if(Number.isFinite(qx)&&Number.isFinite(qy))signedArea2+=x*qy-qx*y;
            }
        }
        const finiteBounds=Number.isFinite(cMinX)&&Number.isFinite(cMinY)&&Number.isFinite(cMaxX)&&Number.isFinite(cMaxY);
        const fillEligible=isClosed&&pts.length>=3&&cInvalid===0;
        c.sourceKind='canonical';c.path=path;c.pathIndex=pi;c.points=pts;c.closed=isClosed;c.pointCount=pts.length;
        c.segmentCount=cSegments;c.invalidPointCount=cInvalid;c.fillEligible=fillEligible;c.signedArea2=signedArea2;
        c.winding=signedArea2>1e-9?'ccw':(signedArea2<-1e-9?'cw':'flat');
        c.bounds=finiteBounds?{minX:cMinX,minY:cMinY,maxX:cMaxX,maxY:cMaxY,width:cMaxX-cMinX,height:cMaxY-cMinY}:null;
        c.cornerFlags=path?.cornerFlags||null;c.bridgeRoundFlags=path?.bridgeRoundFlags||null;
        contours[contourWrite++]=c;if(fillEligible)fillContours[fillWrite++]=c;
    }
    contours.length=contourWrite;fillContours.length=fillWrite;
    if(!Number.isFinite(minX)){minX=minY=maxX=maxY=0;}
    out.pathCount=pathCount;out.closedPathCount=closed;out.openPathCount=open;
    out.pointCount=pointCount;out.segmentCount=segmentCount;out.invalidPointCount=invalidPointCount;out.variableWidthPointCount=variableWidthPointCount;
    out.fillContourCount=fillWrite;out.hasClosedFillTopology=fillWrite>0&&invalidPointCount===0;
    out.minX=minX;out.minY=minY;out.maxX=maxX;out.maxY=maxY;
    out.width=Math.max(0,maxX-minX);out.height=Math.max(0,maxY-minY);
    out.maxRadius=Math.max(1,Math.sqrt(maxRadiusSq));
    if(canonical){canonical.contours=contours;canonical.fillContours=fillContours;}
    canonicalGeometryStats.boundsBuilds++;
    return out;
}

function getCanonicalLayerGeometry(layer){
    if(!layer || (typeof layer!=='object'&&typeof layer!=='function'))return null;
    // Keep the old value-based signature as a compatibility checksum while v504's
    // versioned invalidation is still being rolled through every legacy editor path.
    const geometryKey=typeof layerGeometrySignature==='function'?String(layerGeometrySignature(layer)):'';
    const versions=typeof getLayerVersions==='function'?getLayerVersions(layer):null;
    const geometryVersion=Math.max(0,Number(versions?.geometry)||0);
    let canonical=canonicalGeometryCache.get(layer)||null;
    if(canonical&&canonical.geometryKey===geometryKey&&canonical.geometryVersion===geometryVersion){
        canonicalGeometryStats.hits++;
        return canonical;
    }

    const drawData=typeof buildLegacyLayerDrawData==='function'
        ? buildLegacyLayerDrawData(layer)
        : (typeof getCachedLayerDrawData==='function'?getCachedLayerDrawData(layer):null);
    const paths=drawData?.paths||[];
    // v536 — a structurally identical playlist target may arrive as a fresh layer object
    // while reusing the exact shared drawData/paths built during the hold-phase prewarm.
    // Carry immutable summary/topology/path-table work across that object boundary instead
    // of walking every point and rebuilding arc-length tables on the first target frame.
    const priorCanonical=(drawData&&typeof drawData==='object')?drawData.canonicalGeometry:null;
    const reusablePrior=priorCanonical&&priorCanonical.geometryKey===geometryKey&&priorCanonical.paths===paths?priorCanonical:null;
    if(!canonical){
        canonical={
            layer:null,layerId:null,geometryKey:'',geometryVersion:0,versionToken:'',
            drawData:null,paths:null,summary:{},bounds:null,topology:null,contours:[],fillContours:[],kernelView:null,
            pathTable:null,pathTablePaths:null,pathTableGeometryKey:'',
            profileMode:'',splineRenderMode:'',rounding:0,
            static:true,dynamic:false,createdAt:0,buildSerial:0
        };
        canonicalGeometryCache.set(layer,canonical);
    }
    canonical.layer=layer;
    canonical.layerId=layer?.id??null;
    canonical.geometryKey=geometryKey;
    canonical.geometryVersion=geometryVersion;
    canonical.versionToken=typeof getLayerVersionToken==='function'?getLayerVersionToken(layer,['geometry']):`geometry:${geometryVersion}`;
    canonical.drawData=drawData;
    canonical.paths=paths;
    canonical.profileMode=String(layer?.profileMode||'');
    canonical.splineRenderMode=typeof normalizeSplineRenderMode==='function'?normalizeSplineRenderMode(layer?.splineRenderMode):String(layer?.splineRenderMode||'');
    canonical.rounding=Number(layer?.rounding)||0;
    canonical.static=true;canonical.dynamic=false;
    canonical.createdAt=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    canonical.buildSerial=(Number(canonical.buildSerial)||0)+1;

    let summary;
    if(reusablePrior?.summary){
        summary={...reusablePrior.summary};
        canonical.contours=reusablePrior.contours||[];
        canonical.fillContours=reusablePrior.fillContours||[];
        canonicalGeometryStats.hits++;
    }else{
        summary=computeCanonicalPathSummary(paths,canonical);
    }
    canonical.summary=summary;
    canonical.bounds={minX:summary.minX,minY:summary.minY,maxX:summary.maxX,maxY:summary.maxY,width:summary.width,height:summary.height};
    canonical.topology={pathCount:summary.pathCount,closedPathCount:summary.closedPathCount,openPathCount:summary.openPathCount,pointCount:summary.pointCount,segmentCount:summary.segmentCount};
    canonical.kernelView={
        pathCount:summary.pathCount,pointCount:summary.pointCount,segmentCount:summary.segmentCount,
        closedPathCount:summary.closedPathCount,openPathCount:summary.openPathCount,
        invalidPointCount:summary.invalidPointCount,variableWidthPointCount:summary.variableWidthPointCount,
        contours:canonical.contours,fillContours:canonical.fillContours,fillContourCount:summary.fillContourCount,
        hasClosedFillTopology:summary.hasClosedFillTopology,sourceKind:'canonical',static:true,canonical
    };
    // Preserve the existing draw-data contract while making the canonical owner discoverable.
    if(drawData){
        drawData.canonicalGeometry=canonical;
        // Keep old maxRadius/pointCount authoritative if some special generator supplied them,
        // otherwise fill them from the shared summary.
        if(!(Number(drawData.maxRadius)>0))drawData.maxRadius=summary.maxRadius;
        if(!(Number(drawData.pointCount)>=0))drawData.pointCount=summary.pointCount;
    }
    if(reusablePrior?.pathTable&&reusablePrior.pathTablePaths===paths&&reusablePrior.pathTableGeometryKey===geometryKey){
        canonical.pathTable=reusablePrior.pathTable;canonical.pathTablePaths=paths;canonical.pathTableGeometryKey=geometryKey;
        canonicalGeometryStats.pathTableHits++;
    }else{
        canonical.pathTable=null;canonical.pathTablePaths=null;canonical.pathTableGeometryKey='';
    }
    if(paths&&typeof paths==='object')canonicalGeometryByPaths.set(paths,canonical);
    if(drawData&&typeof drawData==='object')canonicalGeometryByDrawData.set(drawData,canonical);

    canonicalGeometryStats.builds++;
    canonicalGeometryStats.lastBuild={layerId:canonical.layerId,geometryVersion,paths:summary.pathCount,points:summary.pointCount,segments:summary.segmentCount};
    return canonical;
}

function ensureCanonicalPathTable(canonicalOrLayer){
    const canonical=(canonicalOrLayer&&canonicalOrLayer.paths&&canonicalOrLayer.drawData)
        ? canonicalOrLayer
        : getCanonicalLayerGeometry(canonicalOrLayer);
    if(!canonical)return typeof buildPathLengthTable==='function'?buildPathLengthTable([]):{segs:[],total:0};
    if(canonical.pathTable&&canonical.pathTablePaths===canonical.paths&&canonical.pathTableGeometryKey===canonical.geometryKey){
        canonicalGeometryStats.pathTableHits++;
        return canonical.pathTable;
    }
    const table=typeof buildPathLengthTable==='function'?buildPathLengthTable(canonical.paths||[]):{segs:[],total:0};
    canonical.pathTable=table;canonical.pathTablePaths=canonical.paths;canonical.pathTableGeometryKey=canonical.geometryKey;
    if(table&&typeof table==='object')table.canonicalGeometry=canonical;
    canonicalGeometryStats.pathTableBuilds++;
    return table;
}

function getCanonicalGeometryForPaths(paths){return paths&&typeof paths==='object'?canonicalGeometryByPaths.get(paths)||null:null;}
function getCanonicalGeometryForDrawData(drawData){return drawData&&typeof drawData==='object'?canonicalGeometryByDrawData.get(drawData)||drawData.canonicalGeometry||null:null;}
function getCanonicalLayerDrawData(layer){return getCanonicalLayerGeometry(layer)?.drawData||null;}
function noteCanonicalGeometryConsumer(name){
    const key=String(name||'unknown');
    canonicalGeometryStats.consumers[key]=(Number(canonicalGeometryStats.consumers[key])||0)+1;
}
function invalidateCanonicalLayerGeometry(layer){
    if(!layer||typeof layer!=='object')return false;
    return canonicalGeometryCache.delete(layer);
}

window.__spiroCanonicalGeometryStatus=()=>({
    ...canonicalGeometryStats,
    consumers:{...canonicalGeometryStats.consumers},
    active:(()=>{
        const layer=state?.layers?.find?.(l=>l?.id===state?.activeLayerId)||state?.layers?.[0]||null;
        const c=layer?getCanonicalLayerGeometry(layer):null;
        return c?{layerId:c.layerId,geometryVersion:c.geometryVersion,versionToken:c.versionToken,profileMode:c.profileMode,splineRenderMode:c.splineRenderMode,summary:{...c.summary},hasPathTable:Boolean(c.pathTable)}:null;
    })()
});
window.__spiroGetCanonicalGeometry=getCanonicalLayerGeometry;
window.__spiroEnsureCanonicalPathTable=ensureCanonicalPathTable;
