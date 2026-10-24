window.__spiroRegisterModule?.('js/app/test-morph');
// Static edit transitions (v9.0.5).
// "Animate" is NOT a continuously running geometry oscillator. It interpolates
// only after the authored geometry is edited, and stops at the exact new authored
// state. Blue/Orange/Green remain the authoritative owners during Morph.
const SomataTestMorph=(()=>{
    const defaults=Object.freeze({enabled:false,mode:'circleSlide',slide:'sector',spiralType:'phaseCircle',duration:1});
    const SPIRAL_TYPES=new Set(['torn','continuous','phase','phaseCircle','minimalTurn','topology']);
    const realKeys=['N','K','radius','radiusMultiplier','rotation','rounding','spiralStep','spiralOrder',
        'spiralLayers','spiralTurns','spiralOffset','spiralStartRadius','spiralEndRadius',
        'spiralWidth','spiralAngle','spiralPhase','profileOffset','splineTension'];
    const structuralKeys=['N','K','customSuborbits','spiralEnabled','spiralClosed','profileMode','profileNodes',
        'splineRenderMode','chaosStar','chaosClosures','spiralStepLinked'];
    const observedKeys=[...new Set([...realKeys,...structuralKeys])];
    const dynamic=new Map();let applied=0,last=null;
    const clamp=(v,min,max,def)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):def));
    const selectLayer=()=>state.layers?.find(layer=>layer?.id===state.activeLayerId)||state.layers?.[0]||null;
    function config(layer){return layer?.testMorph&&typeof layer.testMorph==='object'?{...defaults,...layer.testMorph}:{...defaults};}
    const copy=v=>Array.isArray(v)?v.map(copy):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)])):v;
    function capture(layer){const v={};for(const key of observedKeys)v[key]=copy(layer?.[key]);return v;}
    const same=(a,b)=>observedKeys.every(k=>JSON.stringify(a?.[k])===JSON.stringify(b?.[k]));
    const differs=(a,b,k)=>JSON.stringify(a?.[k])!==JSON.stringify(b?.[k]);
    const mix=(a,b,t)=>a+(b-a)*t;
    function easing(t,cfg){
        // Slide selection controls geometric correspondence (just as in Blue).
        // Time easing is independent from that choice.
        return t*t*(3-2*t);
    }
    function sample(from,to,t,cfg){
        const u=easing(clamp(t,0,1,0),cfg),out={};
        for(const key of observedKeys){
            const a=from?.[key],b=to?.[key];
            if(realKeys.includes(key)&&!['N','K'].includes(key)&&typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)){
                out[key]=mix(a,b,u);
            }else if(key==='profileNodes'&&Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((p,i)=>p&&b[i]&&Number.isFinite(+p.x)&&Number.isFinite(+p.y)&&Number.isFinite(+b[i].x)&&Number.isFinite(+b[i].y))){
                out[key]=a.map((p,i)=>({...p,x:mix(+p.x,+b[i].x,u),y:mix(+p.y,+b[i].y,u)}));
            }else out[key]=copy(t>=1?b:a);
        }
        return out;
    }
    function hasStructuralChange(a,b){return structuralKeys.some(k=>differs(a,b,k));}
    function anyActive(){return [...dynamic.values()].some(r=>r.active===true);}
    function tick(){if(!anyActive())return false;requestMainCanvasRender();return true;}
    function syncTask(){if(anyActive()){
        if(!animationScheduler.has('geometry-test-morph'))animationScheduler.add('geometry-test-morph',tick);
    }else animationScheduler.remove('geometry-test-morph');}
    function seed(layer){if(!layer)return;dynamic.set(layer.id,{observed:capture(layer),visual:capture(layer),active:false});}
    function applyFrame(frameCtx,now=performance.now()){
        const source=frameCtx?.sourceLayer||frameCtx?.layer,layer=frameCtx?.layer;
        if(!source||!layer)return false;
        const cfg=config(source),id=source.id;
        if(cfg.enabled!==true){dynamic.delete(id);syncTask();return false;}
        // Never compete with Blue, Orange or Green. Discard any stale static tween.
        if(frameCtx.blueMorphProvider?.active||frameCtx.minimalFadeEnabled||frameCtx.greenMorphEnabled||
           frameCtx.orangeMorphProvider?.active||frameCtx.greenMorphProvider?.active){seed(source);syncTask();return false;}
        let r=dynamic.get(id),target=capture(source);
        if(!r){seed(source);return false;} // Enabling the checkbox must not move geometry.
        if(!same(target,r.observed)){
            const start=r.visual||r.observed;
            r={observed:target,from:copy(start),to:copy(target),visual:copy(start),start:now,
                duration:clamp(cfg.duration,.1,60,1)*1000,active:true};
            // Endpoint identities are stable through the whole tween. Otherwise
            // getCachedLayerDrawData receives fresh objects every frame and heavy
            // Spiral/Polygon geometry is rebuilt despite unchanged endpoints.
            r.fromEndpoint={...source,...r.from};r.toEndpoint={...source,...r.to};
            dynamic.set(id,r);
            syncTask();
        }
        if(!r.active)return false;
        const t=clamp((now-r.start)/r.duration,0,1,0),u=easing(t,cfg);
        const visual=sample(r.from,r.to,t,cfg);
        r.visual=visual;
        // For polygon N/K changes, interpolate between exact endpoint geometries
        // using the SAME Blue fade carrier as normal Morph. Avoid creating fractional
        // vertex counts or rebuilding an approximation of strict Spiral on the CPU.
        const isSpiral=[source,r.from,r.to].some(v=>v?.spiralEnabled===true||Math.abs(Number(v?.spiralOrder)||0)>1e-8);
        const structural=hasStructuralChange(r.from,r.to);
        const mode=['topology','calm','circleSlide','fade','light'].includes(cfg.mode)?cfg.mode:'circleSlide';
        const geometryChanged=observedKeys.some(k=>differs(r.from,r.to,k));
        // Real-time Spiral static edits use the retained GPU Blue Spiral transport.
        // No ongoing oscillator: a finite edit starts only when source parameters change.
        const resolvedSpiralType=SPIRAL_TYPES.has(cfg.spiralType)?cfg.spiralType:'phaseCircle';
        const useContinuousSpiralFade=Boolean(isSpiral&&structural&&resolvedSpiralType==='continuous');
        const editPair=isSpiral&&geometryChanged&&!useContinuousSpiralFade?{sourceLayer:r.fromEndpoint,targetLayer:r.toEndpoint,
            spiralType:resolvedSpiralType,mode,progress:u}:null;
        const gpuEditReady=Boolean(editPair&&typeof WebGPUSpiralBezierMorphRenderer!=='undefined'&&
            WebGPUSpiralBezierMorphRenderer.beginStaticEdit?.(frameCtx.layerIndex,editPair));
        if(gpuEditReady){
            frameCtx.spiralEditMorph=editPair;
            frameCtx.geometryProvider={kind:'blue-circle-slide',active:true,geometryActive:true,progress:u,
                sourceLayer:r.fromEndpoint,targetLayer:r.toEndpoint,
                sourceProfileMode:r.fromEndpoint.profileMode,targetProfileMode:r.toEndpoint.profileMode,
                slideTypeOverride:cfg.slide};
            frameCtx.geometryMorphEnabled=true;
            frameCtx.topologyMorphEnabled=structural;
        }
        // Keep a finite authored edit tween; the *geometry* transition for polygons
        // uses exactly the same executors as Blue. For strict Spiral do not invent
        // a CPU carrier: its exact WebGPU rail remains authoritative.
        if(geometryChanged&&!isSpiral&&typeof getCachedLayerDrawData==='function'){
            const a=r.fromEndpoint,b=r.toEndpoint;
            if(!r.sourceData)r.sourceData=getCachedLayerDrawData(a);
            if(!r.targetData)r.targetData=getCachedLayerDrawData(b);
            const provider={active:true,geometryActive:true,progress:u,slideTypeOverride:cfg.slide,
                sourceLayer:a,targetLayer:b,
                sourceData:r.sourceData,targetData:r.targetData,
                sourceProfileMode:a.profileMode,targetProfileMode:b.profileMode};
            if(mode==='fade'||mode==='light')provider.kind='blue-fade';
            else if(mode==='circleSlide')provider.kind='blue-circle-slide';
            else provider.kind='blue-anchor-linear';
            frameCtx.geometryProvider=provider;
            frameCtx.geometryMorphEnabled=true;
            frameCtx.topologyMorphEnabled=structural;
        }
        for(const key of observedKeys){if(key in visual)layer[key]=copy(visual[key]);}
        // Strict Spiral topology cannot be rebuilt through a generic CPU Morph.
        // Until the exact retained GPU edit-pair is supported, switch endpoint
        // topology at zero opacity, not during a visibly abrupt jump. Both halves
        // are rendered by the existing exact static Spiral backend.
        if(isSpiral&&structural&&(useContinuousSpiralFade||!gpuEditReady)&&t<1){
            // Exact Spiral static-edit topology is a two-endpoint GPU render,
            // not a freshly reconstructed intermediate on every Corridor frame.
            // During fade both structural AND numeric geometry must stay at the
            // original/target endpoints; otherwise Corridor rematerializes the
            // exact Spiral rail on every frame for invisible interpolants.
            const fraction=u<.5?1-2*u:2*u-1;
            const endpoint=u<.5?r.from:r.to;
            for(const key of observedKeys)if(key in endpoint)layer[key]=copy(endpoint[key]);
            const opacity=Number(endpoint.opacity??layer.opacity);
            layer.opacity=(Number.isFinite(opacity)?opacity:100)*Math.max(0,Math.min(1,fraction));
            // A second user edit during the fade must start from the exact
            // endpoint currently on screen, not from an invisible mixed path.
            r.visual=copy(endpoint);
        }
        if(t>=1){r.active=false;r.visual=copy(r.to);syncTask();}
        applied++;
        last={layerId:id,progress:t,eased:u,mode:cfg.mode,spiralType:cfg.spiralType,transitioning:t<1,
            sourceN:r.from.N,renderN:layer.N,targetN:r.to.N,sourceK:r.from.K,renderK:layer.K,targetK:r.to.K,
            renderRotation:layer.rotation,structural,mode,strictSpiral:isSpiral,
            topologyEndpointFade:isSpiral&&structural&&(useContinuousSpiralFade||!gpuEditReady),retainedGpuEdit:gpuEditReady,
            forcedContinuousFade:useContinuousSpiralFade===true};
        return true;
    }
    function phase(layer,now=performance.now()){
        const r=dynamic.get(layer?.id),cfg=config(layer);
        const progress=r?.active?clamp((now-r.start)/r.duration,0,1,0):1;
        return {progress,eased:easing(progress,cfg),duration:r?.duration||clamp(cfg.duration,.1,60,1)*1000};
    }
    function syncUI(){
        const layer=selectLayer(),cfg=config(layer),enabled=document.getElementById('testMorphEnabled');
        if(enabled)enabled.checked=cfg.enabled===true;
        const group=document.getElementById('testMorphControls');group?.classList.toggle('hidden',cfg.enabled!==true);
        // Spiral has an independent transport choice, identical to the Blue Morph
        // catalogue. Only reveal it for the currently selected Spiral geometry.
        const spiral=Boolean(layer&&(layer.spiralEnabled===true||Math.abs(Number(layer.spiralOrder)||0)>1e-8));
        document.getElementById('testMorphSpiralRow')?.classList.toggle('hidden',cfg.enabled!==true||!spiral);
        const spiralInput=document.getElementById('testMorphSpiralType');if(spiralInput)spiralInput.value=SPIRAL_TYPES.has(cfg.spiralType)?cfg.spiralType:'phaseCircle';
        const mode=document.getElementById('testMorphMode');if(mode)mode.value=cfg.mode;
        const slide=document.getElementById('testMorphSlide');if(slide)slide.value=cfg.slide;
        const duration=document.getElementById('testMorphDuration');if(duration)duration.value=String(cfg.duration);
    }
    function updateTask(){
        for(const layer of state.layers||[]){if(config(layer).enabled!==true){dynamic.delete(layer.id);continue;}
            if(!dynamic.has(layer.id))seed(layer);
        }
        const ids=new Set((state.layers||[]).map(l=>l.id));
        for(const id of dynamic.keys())if(!ids.has(id))dynamic.delete(id);
        syncTask();requestMainCanvasRender();
    }
    function change(key,val){
        const current=selectLayer();if(!current)return;
        const targets=state.masterLayerEdit===true?state.layers:[current];
        for(const layer of targets){const previous=config(layer);layer.testMorph={...previous,[key]:val};
            if(key==='enabled'){if(val===true)seed(layer);else dynamic.delete(layer.id);}
        }
        updateTask();syncUI();
    }
    function init(){
        const options=[['testMorphEnabled','enabled',el=>el.checked],
            ['testMorphMode','mode',el=>el.value],
            ['testMorphSpiralType','spiralType',el=>SPIRAL_TYPES.has(el.value)?el.value:'phaseCircle'],
            ['testMorphSlide','slide',el=>el.value],
            ['testMorphDuration','duration',el=>clamp(el.value,.1,60,1)]];
        for(const [id,key,read] of options){const el=document.getElementById(id);if(!el)continue;
            const handler=()=>change(key,read(el));el.addEventListener('change',handler);
            if(key==='duration')el.addEventListener('input',handler);
        }
        // Shape UI is frequently re-rendered after a topology switch. Observe
        // only the two geometry controls; do not install a render-loop observer.
        for(const id of ['paramSpiralOrder','paramSpiralEnabled']){
            const el=document.getElementById(id);
            el?.addEventListener('change',()=>queueMicrotask(syncUI));
        }
        syncUI();updateTask();
    }
    window.addEventListener('load',init);
    return Object.freeze({applyFrame,syncUI,updateTask,config,phase,status:()=>({active:anyActive(),applied,last,transitions:[...dynamic].filter(([,r])=>r.active).map(([id,r])=>({id,from:r.from,to:r.to,start:r.start,duration:r.duration}))})});
})();
window.SomataTestMorph=SomataTestMorph;
