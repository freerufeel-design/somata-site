window.__spiroRegisterModule?.('js/render/fill-geometry-adapter');

// Fill core knows only semantic fill requests. Geometry families register optional adapters
// for meshes or retained-scene integration. Adding/changing Spiral topology therefore does
// not require edits in fill-pass.js.
const SomataFillGeometryAdapter=(()=>{
    const providers=[];
    const stats={queries:0,hits:0,misses:0,failures:0,lastProvider:'',lastMethod:''};
    function register(name,api={},priority=0){
        const key=String(name||'').trim();if(!key||!api||typeof api!=='object')throw new Error('Fill geometry adapter requires name/api');
        const i=providers.findIndex(p=>p.name===key);const rec={name:key,api,priority:Number(priority)||0};
        if(i>=0)providers.splice(i,1);providers.push(rec);providers.sort((a,b)=>b.priority-a.priority||a.name.localeCompare(b.name));return true;
    }
    function query(method,...args){
        const m=String(method||'');stats.queries++;stats.lastMethod=m;
        for(const p of providers){const fn=p.api?.[m];if(typeof fn!=='function')continue;
            try{const v=fn(...args);if(v!==undefined&&v!==null){stats.hits++;stats.lastProvider=p.name;return v;}}
            catch(err){stats.failures++;SomataRenderDiagnostics?.diagnosticError?.('fill-adapter',m,String(err?.message||err),args[0]||null,{provider:p.name,recovered:true});}
        }
        stats.misses++;stats.lastProvider='';return null;
    }
    function status(){return{...stats,providers:providers.map(p=>({name:p.name,priority:p.priority,methods:Object.keys(p.api).filter(k=>typeof p.api[k]==='function')})),contract:'Fill core queries geometry adapters by semantic method; it never imports Spiral/Morph internals.'};}
    return{register,query,status};
})();
window.SomataFillGeometryAdapter=SomataFillGeometryAdapter;
window.__somataFillGeometryAdapterStatus=()=>SomataFillGeometryAdapter.status();

// Ordinary geometry adapter: Static and Dynamic share ONE Fill boundary source — the exact
// screen-space Line commands for this frame. Spiral/Corridor keep their specialized retained
// adapters and are deliberately excluded here.
SomataFillGeometryAdapter.register('line-carrier',{
    directMesh(frameCtx){
        if(!frameCtx||state.tunnel?.active===true)return null;
        if(typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx?.layer))return null;
        // 7.8 invariant: Fill is not allowed to rediscover topology from raw commands.
        // It consumes the already-connected authoritative FrameContour, including when
        // the visible Line itself is disabled or replaced by Graffiti/profile markers.
        let record=null;try{record=SomataFrameContourService?.get?.(frameCtx)||null;}catch(_){record=null;}
        if(!record?.commands?.length||!record?.screenPaths?.length)return null;
        return FillMeshPreparer.prepareFrameContour?.(frameCtx,record)||null;
    },
    corridorMesh(frameCtx){
        if(!frameCtx||state.tunnel?.active!==true)return null;
        if(typeof isSpiralLayer==='function'&&isSpiralLayer(frameCtx?.layer))return null;
        // Ordinary Corridor is just transformed copies of the master Line. Build Fill from
        // the SAME master FrameContour; the Fill renderer applies the same copy transforms.
        let record=null;try{record=SomataFrameContourService?.get?.(frameCtx)||null;}catch(_){record=null;}
        if(!record?.commands?.length||!record?.screenPaths?.length)return null;
        const mesh=FillMeshPreparer.prepareFrameContour?.(frameCtx,record)||null;
        if(mesh)mesh.corridorFrameContour=true;
        return mesh;
    }
},10);
