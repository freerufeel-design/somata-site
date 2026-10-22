window.__spiroRegisterModule?.('js/render/corridor-copy-frame');
// Corridor copy appearance is derived once per *actual frame and layer*, not per
// Fill/Glow/Base scoped pass.  This is an optimization, not a second geometry.
// Calls to the existing colour and motion rules are authoritative.
const SomataCorridorCopyFrame=(()=>{
    const owners=new WeakMap();
    const stats={frames:0,strokeBuilds:0,strokeHits:0,fillBuilds:0,fillHits:0,angleBuilds:0,angleHits:0};
    function ownerOf(view){let owner=view,depth=0;while(owner?.__somataFeatureParent&&depth++<8)owner=owner.__somataFeatureParent;return owner||view;}
    function get(view){
        const owner=ownerOf(view),copies=view?.visibleInstances?.copies||[];
        if(!owner||typeof owner!=='object')return null;
        let entry=owners.get(owner);
        if(!entry){entry={serial:0,stroke:[],strokeVersion:[],fill:[],fillVersion:[],angles:[],angleVersion:[],copyIndexes:new WeakMap()};owners.set(owner,entry);}
        const stroke=view.tunnelBaseStrokeColor||view.layer?.strokeColor||'#ffffff';
        const fill=view.tunnelBaseFillColor||'transparent';
        const strokeProfile=view.tunnelPaletteProfile||null,fillProfile=view.tunnelFillPaletteProfile||null;
        if(entry.frameId!==view.frameId||entry.copies!==copies||entry.layer!==view.layer||entry.strokeBase!==stroke||entry.fillBase!==fill||entry.strokeProfile!==strokeProfile||entry.fillProfile!==fillProfile){
            entry.serial++;entry.frameId=view.frameId;entry.copies=copies;entry.layer=view.layer;
            entry.strokeBase=stroke;entry.fillBase=fill;entry.strokeProfile=strokeProfile;entry.fillProfile=fillProfile;
            stats.frames++;
        }
        return entry;
    }
    function index(e,copy,i){if(Number.isInteger(i)&&i>=0&&i<e.copies.length&&e.copies[i]===copy){if(copy&&typeof copy==='object')e.copyIndexes.set(copy,i);return i;}if(copy&&typeof copy==='object'){const n=e.copyIndexes.get(copy);if(Number.isInteger(n)&&e.copies[n]===copy)return n;}const found=e.copies.indexOf(copy);if(found>=0&&copy&&typeof copy==='object')e.copyIndexes.set(copy,found);return found;}
    function strokeAt(e,copy,i){const n=index(e,copy,i);if(n>=0&&e.strokeVersion[n]===e.serial){stats.strokeHits++;return e.stroke[n];}const value=getTunnelCopyColor(e.strokeBase,copy,e.strokeProfile);if(n>=0){e.stroke[n]=value;e.strokeVersion[n]=e.serial;}stats.strokeBuilds++;return value;}
    function fillAt(e,copy,i){const n=index(e,copy,i);if(n>=0&&e.fillVersion[n]===e.serial){stats.fillHits++;return e.fill[n];}const value=e.fillBase==='transparent'?'transparent':getTunnelCopyColor(e.fillBase,copy,e.fillProfile);if(n>=0){e.fill[n]=value;e.fillVersion[n]=e.serial;}stats.fillBuilds++;return value;}
    function rotationAt(e,copy,i){const n=index(e,copy,i);if(n>=0&&e.angleVersion[n]===e.serial){stats.angleHits++;return e.angles[n];}const value=getMotionTunnelLagRadians(copy,e.layer);if(n>=0){e.angles[n]=value;e.angleVersion[n]=e.serial;}stats.angleBuilds++;return value;}
    function stroke(view,copy,i){const e=get(view);return e?strokeAt(e,copy,i):getTunnelCopyColor(view.tunnelBaseStrokeColor,copy,view.tunnelPaletteProfile);}
    function fill(view,copy,i){const e=get(view);return e?fillAt(e,copy,i):(view.tunnelBaseFillColor==='transparent'?'transparent':getTunnelCopyColor(view.tunnelBaseFillColor,copy,view.tunnelFillPaletteProfile));}
    function rotation(view,copy,i){const e=get(view);return e?rotationAt(e,copy,i):getMotionTunnelLagRadians(copy,view.layer);}
    // Reuse one frame ownership/invalidation lookup when a GPU renderer packs many copies.
    // The ...At helpers intentionally retain the same counters and cache write semantics.
    function batch(view){return get(view);}
    // Read-only fast path for late GPU passes: do not instantiate or populate a
    // second cache when no previous effect has materialised copy attributes.
    function peek(view){
        const owner=ownerOf(view),e=owner&&typeof owner==='object'?owners.get(owner):null;
        if(!e||e.frameId!==view?.frameId||e.copies!==(view?.visibleInstances?.copies||[])||e.layer!==view?.layer)return null;
        if(e.strokeBase!==(view.tunnelBaseStrokeColor||view.layer?.strokeColor||'#ffffff')||e.fillBase!==(view.tunnelBaseFillColor||'transparent')||e.strokeProfile!==(view.tunnelPaletteProfile||null)||e.fillProfile!==(view.tunnelFillPaletteProfile||null))return null;
        return e;
    }
    function status(){return{...stats,contract:'frameId + copy-array identity + layer + stroke/fill/style profile invalidation; FeatureHost parent owner; authoritative Corridor color and Motion functions retained'};}
    return{get,stroke,fill,rotation,batch,peek,strokeAt,fillAt,rotationAt,status};
})();
window.SomataCorridorCopyFrame=SomataCorridorCopyFrame;
window.__somataCorridorCopyFrameStatus=()=>SomataCorridorCopyFrame.status();
