window.__spiroRegisterModule?.('js/render/render-layer-snapshot');

// Render-state firewall.
// The renderer never receives a writable project-layer object as its presentation layer.
// A render snapshot is cheap (one shallow object plus the handful of mutable config bags)
// and keeps normalization/fallback code from leaking writes back into state.layers.
//
// 7.7.7 adds a second boundary: once frame planning is complete, the render-local
// snapshot can be sealed. Effect passes then receive immutable geometry/style input;
// an accidental write from Web/Glow/Lightning/etc. cannot alter what later passes see.
const SomataRenderLayerSnapshot=(()=>{
    const nestedKeys=['lamps','geometryCircles','motionRotation','web','sweep','sprite','lineMotionFx','particles'];
    const stats={created:0,nestedCopies:0,sealed:0,sealedObjects:0};
    function cloneBag(value){
        if(Array.isArray(value))return value.slice();
        if(value&&typeof value==='object'&&Object.prototype.toString.call(value)==='[object Object]')return{...value};
        return value;
    }
    function create(layer){
        if(!layer||typeof layer!=='object')return layer||null;
        const out={...layer};
        for(const key of nestedKeys){
            if(!(key in out))continue;
            const next=cloneBag(out[key]);
            if(next!==out[key]){out[key]=next;stats.nestedCopies++;}
        }
        if(Array.isArray(out.profileNodes))out.profileNodes=out.profileNodes.map(p=>p&&typeof p==='object'?{...p}:p);
        if(Array.isArray(out.customSuborbits))out.customSuborbits=out.customSuborbits.slice();
        Object.defineProperty(out,'__somataRenderSource',{value:source(layer),enumerable:false,writable:false,configurable:false});
        Object.defineProperty(out,'__somataRenderSnapshot',{value:true,enumerable:false,writable:false,configurable:false});
        stats.created++;
        return out;
    }
    function canSealObject(value){
        if(!value||typeof value!=='object')return false;
        if(Array.isArray(value))return true;
        return Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null;
    }
    function deepSeal(value,seen){
        if(!canSealObject(value)||Object.isFrozen(value))return value;
        if(seen.has(value))return value;seen.add(value);
        for(const key of Object.keys(value)){
            const child=value[key];if(canSealObject(child))deepSeal(child,seen);
        }
        try{Object.freeze(value);stats.sealedObjects++;}catch(_){}
        return value;
    }
    function seal(layer){
        if(!isSnapshot(layer))return layer;
        if(Object.isFrozen(layer))return layer;
        deepSeal(layer,new WeakSet());stats.sealed++;return layer;
    }
    function source(layer){return layer?.__somataRenderSource||layer||null;}
    function isSnapshot(layer){return layer?.__somataRenderSnapshot===true;}
    function status(){return{...stats,nestedKeys:nestedKeys.slice(),contract:'Planning may normalize a render snapshot; effect execution receives the sealed snapshot. Persistent project state and later effect inputs cannot be mutated through it.'};}
    return{create,seal,source,isSnapshot,status};
})();
window.SomataRenderLayerSnapshot=SomataRenderLayerSnapshot;
window.__somataRenderLayerSnapshotStatus=()=>SomataRenderLayerSnapshot.status();
