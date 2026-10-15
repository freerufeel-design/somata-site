window.__spiroRegisterModule?.('js/ui/master-broadcast-core');

// Pure Master-edit mechanics. No renderer, GPU, Morph, Canvas or DOM dependency belongs here.
// UI code supplies snapshots and decides which user-facing paths are semantically broadcast.
const SomataMasterBroadcastCore=(()=>{
    function clone(value){
        if(Array.isArray(value))return value.map(clone);
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]));
        return value;
    }
    function equal(a,b){
        if(Object.is(a,b))return true;
        if(Array.isArray(a)||Array.isArray(b)){
            if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
            for(let i=0;i<a.length;i++)if(!equal(a[i],b[i]))return false;
            return true;
        }
        const ao=a&&typeof a==='object',bo=b&&typeof b==='object';
        if(ao||bo){
            if(!ao||!bo)return false;
            const ak=Object.keys(a),bk=Object.keys(b);if(ak.length!==bk.length)return false;
            for(const key of ak)if(!Object.prototype.hasOwnProperty.call(b,key)||!equal(a[key],b[key]))return false;
            return true;
        }
        return false;
    }
    function collectChangedPaths(before,after,{prefix='',runtimePaths=null}={}){
        const skip=runtimePaths instanceof Set?runtimePaths:new Set(runtimePaths||[]),out=[];
        const visit=(a,b,path)=>{
            if(equal(a,b))return;
            if(Array.isArray(a)||Array.isArray(b)){if(path&&!skip.has(path))out.push(path);return;}
            const ao=a&&typeof a==='object',bo=b&&typeof b==='object';
            if(ao&&bo){
                const keys=new Set([...Object.keys(a),...Object.keys(b)]);
                for(const key of keys){
                    if(key==='raf'||key.startsWith('__'))continue;
                    const next=path?`${path}.${key}`:key;if(skip.has(next))continue;
                    visit(a[key],b[key],next);
                }
                return;
            }
            if(path&&!skip.has(path))out.push(path);
        };
        visit(before,after,prefix);return out;
    }
    function valueAt(root,path){let value=root;for(const key of String(path||'').split('.')){if(value==null)return undefined;value=value[key];}return value;}
    function applyPath(target,path,value){
        const parts=String(path||'').split('.').filter(Boolean);if(!parts.length)return target;
        let owner=target;
        for(let i=0;i<parts.length-1;i++){const key=parts[i];if(!owner[key]||typeof owner[key]!=='object'||Array.isArray(owner[key]))owner[key]={};owner=owner[key];}
        const leaf=parts[parts.length-1];if(value===undefined)delete owner[leaf];else owner[leaf]=clone(value);return target;
    }
    return{clone,equal,collectChangedPaths,valueAt,applyPath};
})();
window.SomataMasterBroadcastCore=SomataMasterBroadcastCore;
window.__somataMasterBroadcastCoreStatus=()=>({pure:true,api:['clone','equal','collectChangedPaths','valueAt','applyPath'],contract:'Master core only computes exact changed paths and applies values. It has no rendering or effect dependencies.'});
