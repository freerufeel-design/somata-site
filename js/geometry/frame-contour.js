window.__spiroRegisterModule?.('js/geometry/frame-contour');

// Somata 7.8: one authoritative contour per ordinary layer/frame.
//
// The contour is not reconstructed independently by Fill/Web/Graffiti/Lightning.
// We first record the actual ordinary Line geometry for the current frame once, then
// normalize its stroke subpaths into connected contours.  The same record owns:
//   - commands: exact screen-space stroke commands used by Line/GPU batch
//   - screenPaths: connected screen-space topology used by Fill
//   - paths: connected line-command topology mapped back to layer-local space
//   - anchorPaths: semantic/key-point carrier (the 7.5 Web corner authority)
//   - visualLinePaths: the exact ordinary Line carrier used for Web distance/clipping
//
// Strict retained Spiral keeps its specialized authoritative GPU carrier; ordinary Corridor shares the master Line FrameContour.
const SomataFrameContourService=(()=>{
    const JOIN_EPS=1e-3;
    const stats={requests:0,builds:0,hits:0,ineligible:0,empty:0,points:0,paths:0,joins:0,closed:0,open:0,webViews:0,webViewHits:0,lastReason:'',lastFrameId:0};

    function frameOwner(frameCtx){let cur=frameCtx,guard=0;while(cur?.__somataFeatureParent&&guard++<8)cur=cur.__somataFeatureParent;return cur||frameCtx;}
    function isStrict(frameCtx){const owner=frameOwner(frameCtx);try{return SomataGeometryPolicy?.isStrict?.(owner)===true;}catch(_){return false;}}
    function eligibility(frameCtx){
        if(!frameCtx)return'no-frame';
        if(!frameCtx.drawLayerInstances)return'line-recorder-not-ready';
        if(isStrict(frameCtx))return'strict-spiral-gpu-carrier';
        if(typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx.layer))return'spiral-specialized-carrier';
        // Ordinary Corridor is not a different geometry family. Its visible copies are
        // transforms of one master Line carrier, so FrameContour owns that master too.
        // Only Spiral Corridor keeps the specialized retained-GPU carrier above.

        if(frameCtx.geometryPlan?.kind==='lightning')return'geometry-lightning-special-case';
        return'';
    }

    function samePoint(a,b){
        const ax=Number(a?.x),ay=Number(a?.y),bx=Number(b?.x),by=Number(b?.y);
        return Number.isFinite(ax)&&Number.isFinite(ay)&&Number.isFinite(bx)&&Number.isFinite(by)&&Math.abs(ax-bx)<=JOIN_EPS&&Math.abs(ay-by)<=JOIN_EPS;
    }
    function cleanPoints(src){
        if(!Array.isArray(src)||src.length<2)return null;const out=[];
        for(const p of src){const x=Number(p?.x),y=Number(p?.y);if(!Number.isFinite(x)||!Number.isFinite(y))return null;const q={x,y};if(Number.isFinite(Number(p?.widthScale)))q.widthScale=Number(p.widthScale);if(p?.__profileCorner===true)q.__profileCorner=true;if(p?.__profileKeyCorner===true)q.__profileKeyCorner=true;if(!out.length||!samePoint(out[out.length-1],q))out.push(q);}
        return out.length>=2?out:null;
    }
    function reverseCopy(points){const out=new Array(points.length);for(let i=0,n=points.length;i<n;i++)out[i]=points[n-1-i];return out;}
    function appendChain(a,b){for(let i=1;i<b.length;i++)a.push(b[i]);}
    function prependChain(a,b){const add=b.slice(0,-1);a.unshift(...add);}

    // Converts raw stroke subpaths into connected topology.  Importantly this may join
    // across stroke-command boundaries, but ONLY when endpoints are the same point.
    // That is how separately-stroked Bezier polygon sides become one contour without
    // inventing geometry between unrelated paths.
    function buildScreenPaths(stroke){
        const closed=[],open=[];
        for(const contour of stroke?.contours||[]){
            const pts=cleanPoints(contour?.points);if(!pts)continue;
            if(contour.closed===true){if(pts.length>2&&samePoint(pts[0],pts[pts.length-1]))pts.pop();closed.push({points:pts,closed:true,source:[contour]});}
            else open.push({points:pts,closed:false,source:[contour],used:false});
        }
        const joined=[];
        for(let i=0;i<open.length;i++){
            if(open[i].used)continue;open[i].used=true;const chain=open[i].points.slice(),source=open[i].source.slice();
            let changed=true;
            while(changed){changed=false;
                for(let j=0;j<open.length;j++){
                    const q=open[j];if(q.used)continue;const p=q.points;if(!p?.length)continue;
                    const head=chain[0],tail=chain[chain.length-1],first=p[0],last=p[p.length-1];
                    if(samePoint(tail,first)){appendChain(chain,p);q.used=true;source.push(...q.source);stats.joins++;changed=true;break;}
                    if(samePoint(tail,last)){appendChain(chain,reverseCopy(p));q.used=true;source.push(...q.source);stats.joins++;changed=true;break;}
                    if(samePoint(head,last)){prependChain(chain,p);q.used=true;source.unshift(...q.source);stats.joins++;changed=true;break;}
                    if(samePoint(head,first)){prependChain(chain,reverseCopy(p));q.used=true;source.unshift(...q.source);stats.joins++;changed=true;break;}
                }
            }
            let isClosed=chain.length>=3&&samePoint(chain[0],chain[chain.length-1]);if(isClosed)chain.pop();
            joined.push({points:chain,closed:isClosed,source});if(isClosed)stats.closed++;else stats.open++;
        }
        for(const p of closed){joined.push(p);stats.closed++;}
        return joined;
    }

    function multiply(a,b){return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
    function invert(m){const det=m[0]*m[3]-m[1]*m[2];if(!Number.isFinite(det)||Math.abs(det)<1e-12)return null;const inv=1/det;return[m[3]*inv,-m[1]*inv,-m[2]*inv,m[0]*inv,(m[2]*m[5]-m[3]*m[4])*inv,(m[1]*m[4]-m[0]*m[5])*inv];}
    function lineLocalToScreenMatrix(frameCtx){
        const t=mainCtx?.getTransform?.();const root=t?[Number(t.a)||0,Number(t.b)||0,Number(t.c)||0,Number(t.d)||0,Number(t.e)||0,Number(t.f)||0]:[1,0,0,1,0,0];
        const s=Number.isFinite(Number(frameCtx?.combinedScale))?Number(frameCtx.combinedScale):1,r=Number.isFinite(Number(frameCtx?.combinedRotationRad))?Number(frameCtx.combinedRotationRad):0,c=Math.cos(r)*s,q=Math.sin(r)*s;
        return multiply(root,[c,q,-q,c,0,0]);
    }
    function mapPoint(p,inv){const x=Number(p?.x)||0,y=Number(p?.y)||0,q={x:inv[0]*x+inv[2]*y+inv[4],y:inv[1]*x+inv[3]*y+inv[5]};if(Number.isFinite(Number(p?.widthScale)))q.widthScale=Number(p.widthScale);if(p?.__profileCorner===true)q.__profileCorner=true;if(p?.__profileKeyCorner===true)q.__profileKeyCorner=true;return q;}
    function buildLocalPaths(screenPaths,inv,frameCtx){
        const out=[];for(let i=0;i<screenPaths.length;i++){const s=screenPaths[i];if(!s?.points?.length)continue;out.push({points:s.points.map(p=>mapPoint(p,inv)),closed:s.closed===true,__frameContour:true,__screenPathIndex:i});}
        try{Object.defineProperties(out,{_frameGeometryId:{value:Number(frameGeometryRuntime?.frameId)||Number(frameCtx.frameId)||0,writable:true,configurable:true},__somataFrameContour:{value:true,writable:true,configurable:true},__somataFrameId:{value:Number(frameCtx.frameId)||0,writable:true,configurable:true}});}catch(_){out._frameGeometryId=Number(frameGeometryRuntime?.frameId)||Number(frameCtx.frameId)||0;out.__somataFrameContour=true;out.__somataFrameId=Number(frameCtx.frameId)||0;}
        return out;
    }

    function recordLineCarrier(frameCtx){
        const owner=frameOwner(frameCtx);
        // Geometry carrier existence must not depend on whether the visible Line is enabled
        // or replaced by a profile. Fill/Web still need the same underlying geometry.
        // Corridor is copies of one master Line, therefore its FrameContour MUST be built
        // from the exact same master command object later consumed by Corridor Base.
        if(state?.tunnel?.active===true){
            try{
                return owner?.geometryPlan?.dynamic===true
                    ? (getDynamicTunnelMorphMasterStrokeCommands?.(owner,true)||null)
                    : (getTunnelMasterStrokeCommands?.(owner,true)||null);
            }catch(_){return null;}
        }
        const oldVisible=owner.lineDisplayEnabled,oldStrokeOnly=owner.lineProfileStrokeOnly;
        // drawLayerInstances/drawLayerGeometry are closures over the full layer frame context.
        // Toggling only a scoped FeatureHost child does not open the carrier when Line is hidden.
        try{owner.lineDisplayEnabled=true;owner.lineProfileStrokeOnly=false;return getFrameGLStrokeCommands(owner,false)||null;}
        finally{owner.lineDisplayEnabled=oldVisible;owner.lineProfileStrokeOnly=oldStrokeOnly;}
    }

    function get(frameCtx){
        stats.requests++;const owner=frameOwner(frameCtx),fid=Number(owner?.frameId)||Number(frameCtx?.frameId)||0;
        if(owner?._frameContourRecord&&Number(owner._frameContourRecord.frameId)===fid){stats.hits++;owner._sharedFrameContourRequired=true;return owner._frameContourRecord;}
        const reason=eligibility(owner);if(reason){stats.ineligible++;stats.lastReason=reason;return null;}
        let commands=null;try{commands=recordLineCarrier(owner);}catch(_){commands=null;}
        if(!commands?.length){stats.empty++;stats.lastReason='line-commands-empty';return null;}
        const stroke=GeometryKernel?.inspectStrokeCommands?.(commands);if(!stroke||stroke.continuityRisk===true||!stroke.contours?.length){stats.empty++;stats.lastReason='line-contour-invalid';return null;}
        const screenPaths=buildScreenPaths(stroke);if(!screenPaths.length){stats.empty++;stats.lastReason='line-topology-empty';return null;}
        const matrix=lineLocalToScreenMatrix(owner),inv=invert(matrix);if(!inv){stats.empty++;stats.lastReason='line-transform-not-invertible';return null;}
        const localPaths=buildLocalPaths(screenPaths,inv,owner);if(!localPaths.length){stats.empty++;stats.lastReason='line-contour-empty';return null;}
        const pointCount=screenPaths.reduce((n,p)=>n+(p?.points?.length||0),0),rec=owner._frameContourRecord||{};
        rec.frameId=fid;rec.layerId=owner.layer?.id||null;rec.commands=commands;rec.stroke=stroke;rec.screenPaths=screenPaths;rec.paths=localPaths;rec.pointCount=pointCount;rec.pathCount=localPaths.length;rec.closedPathCount=screenPaths.filter(p=>p.closed===true).length;rec.localToScreen=matrix;rec.screenToLocal=inv;rec.authority='shared-line-command-topology';rec.pathTable=null;rec.pathTableFrameId=-1;
        // Web needs two views of the SAME shape, exactly as the proven 7.5 implementation did:
        // authored/key vertices identify corners; the exact Bezier rail defines where those
        // anchors and thread endpoints lie on the visible curve.  Keep both views on this
        // one frame record instead of letting Web reconstruct an unrelated contour.
        rec.anchorPaths=null;rec.visualLinePaths=null;rec.visualBezierPaths=null;rec.webViewFrameId=-1;
        owner._frameContourRecord=rec;owner._sharedFrameContourRequired=true;stats.builds++;stats.points+=pointCount;stats.paths+=localPaths.length;stats.lastReason='';stats.lastFrameId=fid;return rec;
    }
    function current(frameCtx){const owner=frameOwner(frameCtx),rec=owner?._frameContourRecord;return rec&&Number(rec.frameId)===Number(owner?.frameId)?rec:null;}
    function has(frameCtx){return Boolean(current(frameCtx));}
    function paths(frameCtx){return get(frameCtx)?.paths||null;}
    function screenPaths(frameCtx){return get(frameCtx)?.screenPaths||null;}
    function pathTable(frameCtx){const rec=get(frameCtx);if(!rec)return null;if(rec.pathTable&&rec.pathTableFrameId===rec.frameId)return rec.pathTable;if(typeof buildPathLengthTable!=='function')return null;rec.pathTable=buildPathLengthTable(rec.paths);rec.pathTableFrameId=rec.frameId;return rec.pathTable;}
    function webView(frameCtx){
        const rec=get(frameCtx);if(!rec)return null;const fid=Number(rec.frameId)||0;
        if(rec.webViewFrameId===fid&&Array.isArray(rec.anchorPaths)&&Array.isArray(rec.visualLinePaths)){stats.webViewHits++;return{anchorPaths:rec.anchorPaths,visualPaths:rec.visualLinePaths,record:rec};}
        let anchors=null;
        try{anchors=typeof getLayerFrameAuxiliaryPaths==='function'?(getLayerFrameAuxiliaryPaths(frameCtx)||[]):[];}catch(_){anchors=[];}
        // The visible ordinary Line in 7.8 is drawn from rec.commands/rec.paths.  Therefore
        // Web distance, clipping and thread endpoints MUST use rec.paths too.  Rebuilding a
        // second "exact Bézier" rail from authored geometry can be mathematically nicer but
        // it is not the pixels the Line renderer actually consumes, so the web drifts off Line.
        const visual=rec.paths;
        if(!Array.isArray(anchors)||!anchors.length||!Array.isArray(visual)||!visual.length)return null;
        rec.anchorPaths=anchors;rec.visualLinePaths=visual;
        // Compatibility alias for older diagnostics/tests. It no longer means a second rail.
        rec.visualBezierPaths=visual;rec.webViewFrameId=fid;stats.webViews++;
        return{anchorPaths:anchors,visualPaths:visual,record:rec};
    }
    function reset(frameCtx){const owner=frameOwner(frameCtx);if(!owner)return;owner._frameContourRecord=null;owner._sharedFrameContourRequired=false;}
    function status(){return{...stats,contract:'Somata 7.11.0 ordinary geometry: one FrameContour record owns Line/Fill/Web, including ordinary Corridor master geometry. Web uses semantic anchorPaths only to detect corners, then projects every corner and every thread endpoint onto visualLinePaths = the actual Line/Corridor-master carrier. No separately rebuilt ordinary Web rail is allowed. Strict Spiral keeps its specialized retained carrier.'};}
    return{get,current,has,paths,screenPaths,pathTable,webView,reset,eligibility,status};
})();
window.SomataFrameContourService=SomataFrameContourService;
window.__somataFrameContourStatus=()=>SomataFrameContourService.status();

// Ordinary Topology/Calm Morph effects that visually attach to the contour must use the
// exact current-frame Line/Profile carrier. Identity/transport may come from a specialised
// Morph system, but the final attachment rail is FrameContour.paths. Strict Spiral keeps
// its retained exact rail and never enters this ordinary-geometry bridge.
function useTopologyVisualProfileRail(frameCtx){
    let owner=frameCtx,guard=0;while(owner?.__somataFeatureParent&&guard++<8)owner=owner.__somataFeatureParent;
    try{
        if(!owner?.layer||SomataGeometryPolicy?.isStrict?.(owner)===true)return false;
        if(!owner.morphFrameActive||owner.greenMorphEnabled||owner.minimalFadeEnabled)return false;
        if(owner.blueMorphProvider?.mode==='fade')return false;
        return ['topology','calm'].includes(state?.morph?.mode);
    }catch(_){return false;}
}
window.useTopologyVisualProfileRail=useTopologyVisualProfileRail;

function getLayerFrameAuthoritativePaths(frameCtx){const shared=SomataFrameContourService.paths(frameCtx);if(shared?.length)return shared;return typeof getLayerFrameAuxiliaryPaths==='function'?(getLayerFrameAuxiliaryPaths(frameCtx)||[]):[];}
function getLayerFrameAuthoritativePathTable(frameCtx){const shared=SomataFrameContourService.pathTable(frameCtx);if(shared)return shared;const paths=typeof getLayerFrameAuxiliaryPaths==='function'?(getLayerFrameAuxiliaryPaths(frameCtx)||[]):[];return typeof buildPathLengthTable==='function'?buildPathLengthTable(paths):null;}
