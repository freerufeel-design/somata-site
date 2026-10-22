window.__spiroRegisterModule?.('js/render/feature-host');

// Somata 7.7.7 feature boundary.
// A feature is a guest of the renderer. It receives:
//   * an isolated top-level frame view,
//   * only the effect plans it explicitly declares,
//   * only the cross-feature outputs it explicitly declares as readable.
// Declared outputs are copy-on-write and are committed only after a successful pass.
// If a pass throws, every write made by that pass is discarded.
const SomataFeatureHost=(()=>{
    const specs=new Map();
    // Capabilities are registered at module startup. Cache dispatch by capability
    // and invalidate whenever modules register or replace a provider.
    const providersByCapability=new Map();
    let dispatchRebuilds=0,dispatchHits=0;
    function providersFor(cap){
        let rows=providersByCapability.get(cap);
        if(rows){dispatchHits++;return rows;}
        rows=[];for(const spec of specs.values()){
            const provider=spec.capabilities?.get(cap);
            if(typeof provider==='function')rows.push({name:spec.name,provider});
        }
        providersByCapability.set(cap,rows);dispatchRebuilds++;return rows;
    }
    // Output contracts change only at registration, not on every frame/pass.
    // Keep the union ready for scoped passes instead of rebuilding it per run.
    let globalOutputsCache=new Set();
    const stats={runs:0,isolatedRuns:0,committedWrites:0,discardedWrites:0,failedDiscards:0,failures:0,capabilityQueries:0,capabilityMisses:0,capabilityFailures:0,scratchMasked:0,lastFeature:'',lastDiscarded:[]};
    function toSet(v){return new Set(Array.isArray(v)?v.map(String):[]);}
    function register(name,spec={}){
        const key=String(name||'').trim();if(!key)throw new Error('Feature name required');
        const prev=specs.get(key);
        const outputs=spec.outputs!==undefined?toSet(spec.outputs):(prev?.outputs||new Set());
        const reads=spec.reads!==undefined?toSet(spec.reads):(prev?.reads||new Set());
        const plans=spec.plans!==undefined?toSet(spec.plans):(prev?.plans||new Set());
        specs.set(key,{name:key,domain:String(spec.domain||prev?.domain||'effect'),outputs,reads,plans,capabilities:prev?.capabilities||new Map()});
        providersByCapability.clear();
        globalOutputsCache=new Set();
        for(const feature of specs.values())for(const prop of feature.outputs)globalOutputsCache.add(prop);
        return true;
    }
    function has(name){return specs.has(String(name||''));}
    function provide(name,capability,provider){
        const key=String(name||''),cap=String(capability||'');if(!key||!cap||typeof provider!=='function')throw new Error('Feature capability provider required');
        if(!specs.has(key))register(key,{});specs.get(key).capabilities.set(cap,provider);
        providersByCapability.delete(cap);return true;
    }
    function queryRecord(name,capability,...args){
        const key=String(name||''),cap=String(capability||''),spec=specs.get(key),provider=spec?.capabilities?.get(cap);stats.capabilityQueries++;
        if(typeof provider!=='function'){stats.capabilityMisses++;return{name:key,capability:cap,value:undefined,error:null,missing:true};}
        try{return{name:key,capability:cap,value:provider(...args),error:null,missing:false};}
        catch(err){stats.capabilityFailures++;const message=String(err?.message||err);console.error?.(`[Somata feature capability ${key}.${cap}]`,err);return{name:key,capability:cap,value:undefined,error:message,missing:false};}
    }
    function query(name,capability,...args){return queryRecord(name,capability,...args).value;}
    function queryAll(capability,...args){
        const cap=String(capability||''),out=[];
        for(const {name,provider} of providersFor(cap)){
            stats.capabilityQueries++;
            try{out.push({name,value:provider(...args),error:null});}
            catch(err){stats.capabilityFailures++;out.push({name,value:undefined,error:String(err?.message||err)});console.error?.(`[Somata feature capability ${name}.${cap}]`,err);}
        }return out;
    }
    function cloneOwnedOutput(value){
        if(Array.isArray(value))return value.slice();
        if(value instanceof Map)return new Map(value);
        if(value instanceof Set)return new Set(value);
        if(value&&typeof value==='object'&&Object.prototype.toString.call(value)==='[object Object]')return{...value};
        return value;
    }
    function allOutputNames(){return globalOutputsCache;}
    function scopedPlans(parentPlans,spec){
        const out=Object.create(null);if(!parentPlans||typeof parentPlans!=='object')return Object.freeze(out);
        for(const key of spec.plans)if(Object.prototype.hasOwnProperty.call(parentPlans,key)){
            const value=parentPlans[key];
            // The feature gets a shallow immutable plan view. Large prepared geometry stays
            // shared by reference, but the pass cannot rewrite the plan object seen by a
            // later feature.
            if(Array.isArray(value))out[key]=Object.freeze(value.slice());
            else if(value&&typeof value==='object'&&Object.prototype.toString.call(value)==='[object Object]')out[key]=Object.freeze({...value});
            else out[key]=value;
        }
        return Object.freeze(out);
    }
    function run(name,parent,runner){
        const key=String(name||''),spec=specs.get(key);
        if(!spec||!parent||typeof parent!=='object'||typeof runner!=='function')return runner?.(parent);
        const child=Object.create(parent);
        // Effect plans are not a shared bag anymore. A feature can see only plans declared
        // in its registration, so adding/changing one effect cannot silently change another.
        if('effectsPlan' in parent)Object.defineProperty(child,'effectsPlan',{value:scopedPlans(parent.effectsPlan,spec),writable:false,enumerable:true,configurable:true});

        const globalOutputs=allOutputNames();
        // Mask every feature-owned output by default. Cross-feature reads are opt-in.
        for(const prop of globalOutputs){
            if(spec.outputs.has(prop)){
                Object.defineProperty(child,prop,{value:cloneOwnedOutput(parent[prop]),writable:true,enumerable:true,configurable:true});
            }else if(spec.reads.has(prop)){
                Object.defineProperty(child,prop,{value:parent[prop],writable:true,enumerable:true,configurable:true});
            }else{
                Object.defineProperty(child,prop,{value:undefined,writable:true,enumerable:false,configurable:true});
            }
        }
        // 7.7.7 scratch firewall: underscore-prefixed frame state is private unless the
        // feature explicitly declares it as an input/output. Previously such fields leaked
        // through the prototype chain and created invisible cross-effect dependencies.
        for(const prop of Object.keys(parent)){
            if(!prop.startsWith('_')||globalOutputs.has(prop))continue;
            if(spec.outputs.has(prop))Object.defineProperty(child,prop,{value:cloneOwnedOutput(parent[prop]),writable:true,enumerable:true,configurable:true});
            else if(spec.reads.has(prop))Object.defineProperty(child,prop,{value:parent[prop],writable:true,enumerable:true,configurable:true});
            else{Object.defineProperty(child,prop,{value:undefined,writable:true,enumerable:false,configurable:true});stats.scratchMasked++;}
        }
        Object.defineProperties(child,{
            __somataFeatureName:{value:key,enumerable:false},
            __somataFeatureParent:{value:parent,enumerable:false}
        });
        stats.runs++;stats.isolatedRuns++;stats.lastFeature=key;
        let result,success=false,thrown=null;
        try{result=runner(child);success=!(result&&typeof result==='object'&&result.ok===false);if(!success)stats.failures++;}
        catch(err){stats.failures++;thrown=err;}
        finally{
            const own=Object.keys(child),discarded=[];
            for(const prop of own){
                if(success&&spec.outputs.has(prop)){
                    parent[prop]=child[prop];stats.committedWrites++;
                }else if(prop!=='effectsPlan'){
                    discarded.push(prop);stats.discardedWrites++;if(!success&&spec.outputs.has(prop))stats.failedDiscards++;
                }
            }
            stats.lastDiscarded=discarded.slice(0,24);
        }
        if(thrown)throw thrown;
        return result;
    }
    function status(){return{...stats,dispatchRebuilds,dispatchHits,features:[...specs.values()].map(s=>({name:s.name,domain:s.domain,outputs:[...s.outputs],reads:[...s.reads],plans:[...s.plans],capabilities:[...(s.capabilities?.keys?.()||[])]})),contract:'Feature passes get scoped immutable plan views, explicit cross-feature outputs, and an underscore scratch firewall. Undeclared writes are discarded; failed passes commit nothing.'};}
    return{register,has,provide,queryRecord,query,queryAll,run,status};
})();

window.SomataFeatureHost=SomataFeatureHost;
window.__somataFeatureHostStatus=()=>SomataFeatureHost.status();
