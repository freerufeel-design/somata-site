window.__spiroRegisterModule?.('js/render/corridor-copy-frame');
// Corridor copy appearance is derived once per *actual frame and layer*, not per
// Fill/Glow/Base scoped pass.  This is an optimization, not a second geometry.
// Calls to the existing colour and motion rules are authoritative.
const SomataCorridorFocus=(()=>{
    const clamp=(x)=>Math.max(0,Math.min(1,x));
    // Keep highlighting and rotation on exactly the same *spatial* Corridor
    // position.  copyId is a traveling identity: it changes on every completed
    // tunnel cycle, while the figure numbered from the centre does not.
    // Absolute Corridor population numbering starts at the centre, INCLUDING
    // copies currently hidden by the centre fade.  It is not the first visible
    // copy: figure #7 always refers to the seventh central-outward slot.
    const centralStart=()=>-2;
    const selectedFigure=layer=>{
        const raw=Number(layer?.spiralRotationFocusFigure);
        return Number.isFinite(raw)?Math.max(1,Math.min(256,Math.round(raw))):7;
    };
    function focusPosition(layer){
        const frame=layer?.__somataFocusFrame;
        if(frame&&Number.isFinite(frame.position))return frame.position;
        // Outside a rendering frame, use the same absolute number; never
        // recalculate it as a fraction of a transient Corridor population.
        const total=Number(layer?.__somataFocusTotal);
        const figure=Math.min(Number.isFinite(total)&&total>=1?Math.round(total):256,
            layer?.spiralManualFocus===true?selectedFigure(layer):7);
        return centralStart()+figure-1;
    }
    function resolveFrame(layer,copies,extent,zoom,viewportRadius,tunnel,population=null){
        const start=centralStart();
        if(tunnel?.active!==true||!Array.isArray(copies)||copies.length<2){
            const total=Math.max(1,Math.min(256,Math.round(Number(population?.total)||1)));
            const manual=layer?.spiralManualFocus===true;
            const figure=Math.min(total,manual?selectedFigure(layer):7);
            const data={start,total,maxIndex:total-1,index:figure-1,position:start+figure-1,figure,manual};
            if(layer)layer.__somataFocusFrame=data;
            return data;
        }
        // Interpolate the *continuous* screen-edge crossing from adjacent copy
        // radii.  Its physical position does not jump when the last visible copy
        // disappears and a new copy is recycled by the Corridor.  Zoom is
        // applied to the geometry and viewport with the same factor here.
        const factor=Math.max(.001,Number(extent)||1)*Math.max(.001,Number(zoom)||1);
        const edge=Math.max(1,Number(viewportRadius)||1)*Math.max(.001,Number(zoom)||1);
        const target=Math.log(Math.max(1e-12,edge/factor));
        let crossing=NaN,below=null,above=null,first=null,second=null,penultimate=null,last=null;
        for(const copy of copies){
            const pos=Number(copy?.position),scale=Math.abs(Number(copy?.scale));
            if(!Number.isFinite(pos)||!(scale>0))continue;
            const log=Math.log(Math.max(1e-12,scale));
            if(!first||pos<first.pos){second=first;first={pos,log};}
            else if(!second||pos<second.pos)second={pos,log};
            if(!last||pos>last.pos){penultimate=last;last={pos,log};}
            else if(!penultimate||pos>penultimate.pos)penultimate={pos,log};
            if(log<=target&&(!below||pos>below.pos))below={pos,log};
            if(log>=target&&(!above||pos<above.pos))above={pos,log};
        }
        if(below&&above){
            const weight=Math.abs(above.log-below.log)>1e-9
                ?Math.max(0,Math.min(1,(target-below.log)/(above.log-below.log))):0;
            crossing=below.pos+(above.pos-below.pos)*weight;
        }else if(below&&last&&penultimate&&Math.abs(last.log-penultimate.log)>1e-9){
            // If the edge is beyond generated virtual copies, extrapolate the
            // continuous boundary instead of following the last recycled copy.
            crossing=last.pos+(target-last.log)*(last.pos-penultimate.pos)/(last.log-penultimate.log);
        }else if(above&&first&&second&&Math.abs(second.log-first.log)>1e-9){
            crossing=first.pos+(target-first.log)*(second.pos-first.pos)/(second.log-first.log);
        }else if(below){crossing=below.pos+1;}
        else if(above){crossing=above.pos;}
        // Figure #1 is the central Corridor slot, including hidden copies.
        // Keep the chosen figure fixed if a new outer copy appears/disappears;
        // population affects only the maximum selectable figure.  The final
        // outer figure is selectable (1 through the *full* displayed total).
        const measured=Number(population?.total);
        const inferred=Math.max(1,Math.floor((Number.isFinite(crossing)?crossing:start+1)-start)+3);
        const total=Math.max(1,Math.min(256,Math.round(Number.isFinite(measured)&&measured>=1?measured:inferred)));
        const maxIndex=total-1;
        const manual=layer?.spiralManualFocus===true;
        const figure=Math.min(total,manual?selectedFigure(layer):7);
        const index=figure-1;
        const data={start,total,maxIndex,index,position:start+index,figure,manual};
        if(layer)layer.__somataFocusFrame=data;
        return data;
    }
    function strength(copy,layer){
        if(layer?.corridorFocusHighlight!==true||state?.tunnel?.active!==true)return 0;
        // Physical Corridor position (not the transient copy array index).
        // The first shown copy is index (centerHiddenCopies - 2); default 2 -> 0.
        // A one-copy wide smooth bell gives: colour -> white -> original colour.
        const pos=Number(copy?.position);
        if(!Number.isFinite(pos))return 0;
        const d=Math.abs(pos-focusPosition(layer));
        const v=clamp(1-d/1.65);
        return v*v*(3-2*v);
    }
    function tint(color,copy,layer){
        const w=strength(copy,layer);
        if(w<=1e-7||typeof color!=='string'||color==='transparent')return color;
        const m=color.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
        if(!m)return color;
        let hex=m[1];if(hex.length===3||hex.length===4)hex=hex.split('').map(ch=>ch+ch).join('');
        const alpha=hex.length===8?hex.slice(6):'';
        const base=hex.slice(0,6);
        const vals=[0,2,4].map(i=>Math.round(parseInt(base.slice(i,i+2),16)*(1-w)+255*w).toString(16).padStart(2,'0'));
        return '#'+vals.join('')+alpha;
    }
    function population(copies,layerExtent,zoom,viewportRadius,tunnel,layer=null){
        if(tunnel?.active!==true){
            const coils=layer?.spiralEnabled===true?Math.ceil(Math.abs(Number(layer.spiralOrder)||0)):0;
            return {total:1+coils,onscreen:1+coils,hidden:0,outer:0};
        }
        const hidden=Math.max(0,Math.min(32,Math.round(Number(tunnel?.centerHiddenCopies)||0)));
        const projected=Math.max(1,Number(layerExtent)||1)*Math.max(.001,Number(zoom)||1);
        let onscreen=0,outer=0;
        const seen=new Set();
        for(const c of copies||[]){
            if((Number(c?.alpha)||0)<.0025||!Number.isFinite(Number(c?.scale)))continue;
            const id=Number(c?.copyId);if(seen.has(id))continue;seen.add(id);
            if(Number(c?.centerRevealAlpha)<=.0025)continue;
            const r=projected*Math.abs(Number(c.scale));
            if(r<.18)continue;
            if(r>Math.max(1,Number(viewportRadius)||1)*Math.max(.001,Number(zoom)||1))outer++;else onscreen++;
        }
        return {total:onscreen+hidden+outer,onscreen,hidden,outer};
    }
    function countLabel(value){return `${value.total} (−${value.hidden} из центра +${value.outer} за экраном)`;}
    function counts(copies,layerExtent,zoom,viewportRadius,tunnel,layer=null){
        return countLabel(population(copies,layerExtent,zoom,viewportRadius,tunnel,layer));
    }
    return{focusPosition,resolveFrame,strength,tint,population,countLabel,counts};
})();
window.SomataCorridorFocus=SomataCorridorFocus;
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
    function strokeAt(e,copy,i){const n=index(e,copy,i);if(n>=0&&e.strokeVersion[n]===e.serial){stats.strokeHits++;return e.stroke[n];}const value=getTunnelCopyColor(e.strokeBase,copy,e.strokeProfile,e.layer);if(n>=0){e.stroke[n]=value;e.strokeVersion[n]=e.serial;}stats.strokeBuilds++;return value;}
    function fillAt(e,copy,i){const n=index(e,copy,i);if(n>=0&&e.fillVersion[n]===e.serial){stats.fillHits++;return e.fill[n];}const value=e.fillBase==='transparent'?'transparent':getTunnelCopyColor(e.fillBase,copy,e.fillProfile,e.layer);if(n>=0){e.fill[n]=value;e.fillVersion[n]=e.serial;}stats.fillBuilds++;return value;}
    function rotationAt(e,copy,i){const n=index(e,copy,i);if(n>=0&&e.angleVersion[n]===e.serial){stats.angleHits++;return e.angles[n];}const value=getMotionTunnelLagRadians(copy,e.layer);if(n>=0){e.angles[n]=value;e.angleVersion[n]=e.serial;}stats.angleBuilds++;return value;}
    function stroke(view,copy,i){const e=get(view);return e?strokeAt(e,copy,i):getTunnelCopyColor(view.tunnelBaseStrokeColor,copy,view.tunnelPaletteProfile,view.layer);}
    function fill(view,copy,i){const e=get(view);return e?fillAt(e,copy,i):(view.tunnelBaseFillColor==='transparent'?'transparent':getTunnelCopyColor(view.tunnelBaseFillColor,copy,view.tunnelFillPaletteProfile,view.layer));}
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
