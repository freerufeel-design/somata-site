window.__spiroRegisterModule?.('js/render/geometry-policy');

// Generic geometry-family policy registry.
// Optional effects are allowed to ask semantic questions such as "is this frame strict?"
// or "why is an exact arc unavailable?". They must not import Spiral/Topology/Green
// implementation details directly. Geometry families register those answers here.
const SomataGeometryPolicy=(()=>{
    const providers=[];
    const stats={registrations:0,resolutions:0,strictQueries:0,entryQueries:0,reasonQueries:0,invocations:0,failures:0,lastProvider:'',lastMethod:''};
    function register(name,api={},priority=0){
        const key=String(name||'').trim();if(!key||!api||typeof api!=='object')throw new Error('Geometry policy requires name/api');
        const rec={name:key,api,priority:Number(priority)||0};const i=providers.findIndex(p=>p.name===key);if(i>=0)providers.splice(i,1);
        providers.push(rec);providers.sort((a,b)=>b.priority-a.priority||a.name.localeCompare(b.name));stats.registrations++;return true;
    }
    function matches(rec,frameCtx){
        const fn=rec?.api?.matches;if(typeof fn!=='function')return true;
        try{return fn(frameCtx)===true;}catch(_){stats.failures++;return false;}
    }
    function matching(frameCtx){stats.resolutions++;return providers.filter(p=>matches(p,frameCtx));}
    function isStrict(frameCtx){
        stats.strictQueries++;
        for(const p of matching(frameCtx)){const fn=p.api?.strict;if(typeof fn!=='function')continue;try{if(fn(frameCtx)===true){stats.lastProvider=p.name;stats.lastMethod='strict';return true;}}catch(_){stats.failures++;}}
        return false;
    }
    function hasStrictEntryIntent(displayLayers){
        stats.entryQueries++;
        for(const p of providers){const fn=p.api?.entryIntent;if(typeof fn!=='function')continue;try{if(fn(displayLayers)===true){stats.lastProvider=p.name;stats.lastMethod='entryIntent';return true;}}catch(_){stats.failures++;}}
        return false;
    }
    function ineligibleReason(frameCtx,consumer,fallback='geometry authority unavailable'){
        stats.reasonQueries++;
        for(const p of matching(frameCtx)){const fn=p.api?.ineligibleReason;if(typeof fn!=='function')continue;try{const v=fn(frameCtx,String(consumer||''));if(v){stats.lastProvider=p.name;stats.lastMethod='ineligibleReason';return String(v);}}catch(_){stats.failures++;}}
        return String(fallback||'geometry authority unavailable');
    }
    function invoke(frameCtx,method,...args){
        const m=String(method||'');stats.invocations++;stats.lastMethod=m;
        for(const p of matching(frameCtx)){const fn=p.api?.[m];if(typeof fn!=='function')continue;try{const v=fn(frameCtx,...args);if(v!==undefined){stats.lastProvider=p.name;return v;}}catch(err){stats.failures++;console.error?.(`[Somata geometry policy ${p.name}.${m}]`,err);}}
        return undefined;
    }
    function family(frameCtx){for(const p of matching(frameCtx)){stats.lastProvider=p.name;return p.name;}return'generic';}
    function status(){return{...stats,providers:providers.map(p=>({name:p.name,priority:p.priority,methods:Object.keys(p.api).filter(k=>typeof p.api[k]==='function')})),contract:'Effects depend on semantic geometry policy only. Geometry-family rules live in registered adapters.'};}
    return{register,isStrict,hasStrictEntryIntent,ineligibleReason,invoke,family,status};
})();
window.SomataGeometryPolicy=SomataGeometryPolicy;
window.__somataGeometryPolicyStatus=()=>SomataGeometryPolicy.status();
