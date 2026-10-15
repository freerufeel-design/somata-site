window.__spiroRegisterModule?.('js/render/pass-registry');

// Ordered pass registry. main-pipeline owns frame orchestration, not effect names.
// Each feature module registers its executable pass here. A new effect can be added
// without editing main-pipeline.js; ordering is expressed as a stable stage + order.
const SomataRenderPassRegistry=(()=>{
    const rows=new Map();
    const hooks=new Map();
    const stats={registrations:0,runs:0,hookRuns:0,failures:0,last:[]};
    const STAGES=Object.freeze({UNDERLAY:10,FILL:20,OVER_FILL:25,GLOW:30,BASE:40,POST_BASE:50});
    function register(name,spec={}){
        const key=String(name||'').trim();if(!key)throw new Error('render pass name required');
        if(typeof spec.run!=='function')throw new Error(`render pass ${key} requires run()`);
        rows.set(key,Object.freeze({name:key,stage:Number(spec.stage)||STAGES.POST_BASE,order:Number(spec.order)||0,run:spec.run,fallback:typeof spec.fallback==='function'?spec.fallback:null}));
        stats.registrations=rows.size;return true;
    }
    function registerHook(stage,name,run){
        const s=String(stage||''),key=String(name||'');if(!s||!key||typeof run!=='function')throw new Error('render hook requires stage/name/run');
        let list=hooks.get(s);if(!list){list=[];hooks.set(s,list);}const i=list.findIndex(x=>x.name===key);const row=Object.freeze({name:key,run});if(i>=0)list[i]=row;else list.push(row);return true;
    }
    function stage(stage){return [...rows.values()].filter(r=>r.stage===stage).sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name));}
    function runStage(stageId,frameCtx,invoke){
        const list=stage(stageId),out=[];for(const row of list){stats.runs++;try{out.push(invoke(row,frameCtx));stats.last.push(row.name);}catch(err){stats.failures++;throw err;}}stats.last=stats.last.slice(-24);return out;
    }
    function runHooks(stageName,frameCtx,invoke){
        const list=hooks.get(String(stageName||''))||[],out=[];for(const row of list){stats.hookRuns++;out.push(invoke(row,frameCtx));}return out;
    }
    function status(){return{...stats,stages:{...STAGES},passes:[...rows.values()].map(({name,stage,order})=>({name,stage,order})),hooks:[...hooks.entries()].map(([stage,list])=>({stage,names:list.map(x=>x.name)})),contract:'main-pipeline executes stages/hooks generically; feature modules own their pass function and registration.'};}
    return{STAGES,register,registerHook,stage,runStage,runHooks,status};
})();
window.SomataRenderPassRegistry=SomataRenderPassRegistry;
window.__somataRenderPassRegistryStatus=()=>SomataRenderPassRegistry.status();

// Artistic effect-stack order. Execution/preparation stages stay stable, while every
// GPU Layer Scene command receives a phase derived from this single source of truth.
// This prevents the same frame from having one order in main-pipeline and another in
// the deferred GPU command queue.
const SomataEffectStackOrder=(()=>{
    const DEFAULT_ORDER=Object.freeze(['fill','web','geometry','lamps','sweep','pathfx','particles']);
    const LABELS=Object.freeze({
        fill:'Заливка',
        web:'Паутина',
        geometry:'Геометрия · Glow / Line / Profile / Graffiti',
        lamps:'Лампы',
        sweep:'Sweep / Glint / Lightning',
        pathfx:'Motion / Sprite',
        particles:'Частицы'
    });
    const valid=new Set(DEFAULT_ORDER);
    function appState(){try{return typeof state!=='undefined'?state:(globalThis.state||null);}catch(_){return globalThis.state||null;}}
    function normalize(raw){
        const out=[],seen=new Set();
        for(const key of Array.isArray(raw)?raw:[]){const k=String(key||'');if(valid.has(k)&&!seen.has(k)){seen.add(k);out.push(k);}}
        for(const k of DEFAULT_ORDER)if(!seen.has(k))out.push(k);
        return out;
    }
    function current(){
        const st=appState(),out=normalize(st?.effectOrder);
        if(st)st.effectOrder=out.slice();
        return out;
    }
    function set(raw){const st=appState(),out=normalize(raw);if(st)st.effectOrder=out.slice();return out.slice();}
    function rank(key){const i=current().indexOf(String(key||''));return i>=0?i:DEFAULT_ORDER.length;}
    // Keep prerequisite compute commands at phases 1..9. Artistic commands live at
    // 100+ and have ample room for deterministic sub-order inside a group.
    function phase(key,offset=0){return 100+rank(key)*100+(Number(offset)||0);}
    function before(a,b){return rank(a)<rank(b);}
    function entries(){return current().map((key,index)=>({key,label:LABELS[key]||key,index,phase:phase(key)}));}
    function isDefault(){const o=current();return o.length===DEFAULT_ORDER.length&&o.every((k,i)=>k===DEFAULT_ORDER[i]);}
    function fullFrameCtx(frameCtx){
        // FeatureHost intentionally scopes effectsPlan for each pass.  Artistic ordering,
        // however, is a frame-wide compositor decision and MUST see the complete plan.
        // Walk back to the parent frame view so Fill/Web/Geometry cannot make conflicting
        // fusion decisions from different scoped feature views.
        let cur=frameCtx,guard=0;
        while(cur?.__somataFeatureParent&&guard++<8)cur=cur.__somataFeatureParent;
        return cur||frameCtx;
    }
    function activeGroups(frameCtx){
        const source=fullFrameCtx(frameCtx),e=source?.effectsPlan||{},out=new Set();
        let fillRequested=false;try{fillRequested=typeof getLayerGeometryContract==='function'&&getLayerGeometryContract(source)?.fillRequested===true;}catch(_){}
        if(fillRequested)out.add('fill');
        if(e.web?.enabled===true)out.add('web');
        const geometryActive=source?.lineDisplayEnabled===true||e.glow?.enabled===true||source?.lineProfileStrokeOnly===true||source?.lineProfileApplication==='graffiti';
        if(geometryActive)out.add('geometry');
        if(e.lamps?.enabled===true)out.add('lamps');
        if(e.sweep?.enabled===true)out.add('sweep');
        if(e.motion?.enabled===true||e.sprite?.enabled===true)out.add('pathfx');
        const effectLayer=source?.effectLayer||source?.layer;
        const particlesEnabled=e.particles?.enabled===true||effectLayer?.particles?.enabled===true;
        if(particlesEnabled)out.add('particles');
        return out;
    }
    function plan(frameCtx){
        const order=current(),active=activeGroups(frameCtx),activeOrder=order.filter(k=>active.has(k));
        const fillRequested=active.has('fill'),webActive=active.has('web'),geometryActive=active.has('geometry');
        const source=fullFrameCtx(frameCtx),fillType=typeof getLayerFillType==='function'?getLayerFillType(source?.effectLayer||source?.layer):'normal';
        const fi=activeOrder.indexOf('fill'),gi=activeOrder.indexOf('geometry');
        // Only the two legacy one-frame Fill modes may fuse into Geometry. Accumulation
        // owns persistent history and Fade owns a post-process, so both require a real
        // independent Fill compositor command even when Web is disabled.
        const fillCanFuse=fillRequested&&fillType==='normal'&&!webActive&&frameCtx?.lineDisplayEnabled===true&&geometryActive&&fi>=0&&gi===fi+1;
        const standaloneFill=fillRequested&&!fillCanFuse;
        const fillRank=rank('fill'),minActiveRank=activeOrder.length?Math.min(...activeOrder.map(rank)):fillRank;
        const fillCanSeedRoot=standaloneFill&&fillRank===minActiveRank;
        const geometryRank=rank('geometry');
        const lateBeforeGeometry=['lamps','sweep','pathfx','particles'].some(k=>active.has(k)&&rank(k)<geometryRank);
        // Fill/Web execute before Base and can seed the ordered scene themselves. A neutral
        // root is needed only when a later technical pass has been artistically moved below
        // Geometry and neither Fill nor Web will seed the scene first.
        const preBaseSeed=webActive||standaloneFill;
        const requiresEarlyScene=lateBeforeGeometry&&!preBaseSeed;
        return{order:order.slice(),active:[...active],activeOrder,defaultOrder:isDefault(),fillRequested,webActive,geometryActive,fillType,fillCanFuse,standaloneFill,fillCanSeedRoot,requiresEarlyScene};
    }
    function status(){return{defaultOrder:[...DEFAULT_ORDER],order:current(),entries:entries(),contract:'bottom-to-top artistic order drives every deferred Layer Scene phase; preparation stages remain dependency-safe; default inactive combinations keep their legacy fast path'};}
    return{DEFAULT_ORDER,LABELS,normalize,current,set,rank,phase,before,entries,isDefault,activeGroups,plan,status};
})();
window.SomataEffectStackOrder=SomataEffectStackOrder;
window.somataEffectPhase=(group,offset=0)=>SomataEffectStackOrder.phase(group,offset);
window.__somataEffectStackStatus=()=>SomataEffectStackOrder.status();

