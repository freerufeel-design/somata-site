window.__spiroRegisterModule?.('js/app/test-morph');
// Static authored state is never modified. This overlay acts only on the
// mutable per-frame geometry snapshot, before the shared geometry/effect passes.
// The phase modes are a test path, not a replacement for Blue's GPU morph engine.
const SomataTestMorph=(()=>{
    const defaults=Object.freeze({enabled:false,mode:'circleSlide',slide:'phase',spiralType:'phaseCircle',duration:1});
    const runtime=new Map();let applied=0,last=null;
    const clamp=(v,min,max,def)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):def));
    const selectLayer=()=>state.layers?.find(layer=>layer?.id===state.activeLayerId)||state.layers?.[0]||null;
    function config(layer){
        if(!layer)return {...defaults};
        return layer.testMorph&&typeof layer.testMorph==='object'?{...defaults,...layer.testMorph}:{...defaults};
    }
    function spiral(layer){return layer?.spiralEnabled===true||Math.abs(Number(layer?.spiralOrder)||0)>1e-8;}
    function phase(layer,now=performance.now()){
        const cfg=config(layer),duration=clamp(cfg.duration,.1,60,1)*1000;
        let r=runtime.get(layer.id);
        if(!r){r={start:now};runtime.set(layer.id,r);}
        const x=((now-r.start)/duration%2+2)%2;
        const raw=x<=1?x:2-x;
        let u=raw;
        if(cfg.slide==='sector')u=u*u*(3-2*u);
        else if(cfg.slide==='minimal')u=.5-.5*Math.cos(u*Math.PI);
        return {progress:raw,eased:u,duration};
    }
    function applyFrame(frameCtx,now){
        const layer=frameCtx?.layer,source=frameCtx?.sourceLayer||layer,cfg=config(source);
        if(!layer||cfg.enabled!==true||!source)return false;
        // Blue/Orange/Green remain authoritative when active. No two owners for a frame.
        if(frameCtx.blueMorphProvider?.active||frameCtx.minimalFadeEnabled||frameCtx.greenMorphEnabled)return false;
        const {progress,eased:u}=phase(source,now),e=Math.sin(u*Math.PI);
        const n=Math.max(2,Math.round(Number(source.N)||4)),k=Math.max(1,Math.round(Number(source.K)||1));
        if(spiral(source)){
            const type=['torn','continuous','phase','phaseCircle','minimalTurn','topology'].includes(cfg.spiralType)?cfg.spiralType:'phaseCircle';
            if(type==='torn'||type==='topology')layer.K=k+(u>=.5?1:0);
            if(type==='phase')layer.K=k+Math.round(e);
            if(type==='phaseCircle'){
                layer.N=n+Math.round(e*2);layer.K=k+Math.round(e);
            }
            // Keep strict Spiral in its retained carrier: no CPU path substitution.
            if(type!=='torn'&&type!=='topology'){
                layer.spiralStepLinked=false;
                const original=clamp(source.spiralStep,.001,100,Math.max(.001,k));
                layer.spiralStep=original*(1+.12*e);
            }
            if(type==='minimalTurn'||type==='continuous')layer.rotation=(Number(source.rotation)||0)+80*e;
        }else{
            const mode=cfg.mode;
            if(mode==='topology'){
                layer.N=n+Math.round(2*e);layer.K=k+Math.round(e);
                layer.rotation=(Number(source.rotation)||0)+36*e;
            }else if(mode==='calm'){
                layer.radius=Math.max(1,(Number(source.radius)||150)*(1+.14*e));
                layer.rotation=(Number(source.rotation)||0)+28*e;
            }else if(mode==='fade'){
                layer.opacity=clamp(source.opacity,0,100,100)*(1-.85*e);
                layer.N=n+(u>=.5?2:0);
            }else if(mode==='light'){
                layer.N=n+Math.round(2*u);layer.K=k+Math.round(u);
            }else{
                // Circle-slide preserves the same canonical static profile at both endpoints.
                layer.rotation=(Number(source.rotation)||0)+120*e;
                layer.K=k+Math.round(e);
            }
        }
        applied++;last={layerId:source.id,progress,mode:spiral(source)?cfg.spiralType:cfg.mode,sourceN:n,renderN:layer.N,sourceK:k,renderK:layer.K,renderRotation:layer.rotation};
        return true;
    }
    function anyActive(){return (state.layers||[]).some(l=>config(l).enabled===true);}
    function tick(){if(!anyActive())return false;requestMainCanvasRender();return true;}
    function updateTask(){
        if(anyActive()){
            if(!animationScheduler.has('geometry-test-morph'))animationScheduler.add('geometry-test-morph',tick);
        }else animationScheduler.remove('geometry-test-morph');
        requestMainCanvasRender();
    }
    function syncUI(){
        const layer=selectLayer(),cfg=config(layer),enabled=document.getElementById('testMorphEnabled');
        if(enabled)enabled.checked=cfg.enabled===true;
        const group=document.getElementById('testMorphControls');group?.classList.toggle('hidden',cfg.enabled!==true);
        const isSpiral=spiral(layer);
        group?.querySelector('.test-morph-spiral-row')?.classList.toggle('hidden',!isSpiral);
        for(const id of ['testMorphMode','testMorphSlide']){
            const el=document.getElementById(id);el?.closest('.control-row')?.classList.toggle('hidden',isSpiral);
            if(el)el.value=cfg[id==='testMorphMode'?'mode':'slide'];
        }
        const spiralSelect=document.getElementById('testMorphSpiralType');if(spiralSelect)spiralSelect.value=cfg.spiralType;
        const duration=document.getElementById('testMorphDuration');if(duration)duration.value=String(cfg.duration);
    }
    function change(key,val){
        const current=selectLayer();if(!current)return;
        // A layer-local option, propagated by Master without altering any other geometry setting.
        const targets=state.masterLayerEdit===true?state.layers:[current];
        for(const layer of targets){const previous=config(layer);layer.testMorph={...previous,[key]:val};runtime.delete(layer.id);}
        updateTask();syncUI();
    }
    function init(){
        const options=[['testMorphEnabled','enabled',el=>el.checked],['testMorphMode','mode',el=>el.value],
            ['testMorphSlide','slide',el=>el.value],['testMorphSpiralType','spiralType',el=>el.value],
            ['testMorphDuration','duration',el=>clamp(el.value,.1,60,1)]];
        for(const [id,key,read] of options){const el=document.getElementById(id);if(!el)continue;
            const handler=()=>change(key,read(el));el.addEventListener('change',handler);
            if(key==='duration')el.addEventListener('input',handler);
        }
        syncUI();updateTask();
    }
    window.addEventListener('load',init);
    return Object.freeze({applyFrame,syncUI,updateTask,config,phase,status:()=>({active:anyActive(),applied,last})});
})();
window.SomataTestMorph=SomataTestMorph;
