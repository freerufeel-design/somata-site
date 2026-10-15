const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const kernel=read('js/geometry/kernel.js');
  const graph=read('js/render/render-graph.js');
  const gpu=read('js/app/geometry-gpu-core.js');
  const scene=read('js/render/layer-scene-service.js');
  const ui=read('js/app/ui-project-runtime.js');
  assert(kernel.includes("let fillConfigured=layer.fill===true&&fillAlpha>.00001"),'Fill contract still depends on Line visibility');
  assert(graph.includes('const fill=layer.fill===true;'),'RenderGraph Fill still depends on Line visibility');
  assert(gpu.includes("rec.strokeStyle=String(frameCtx.lightningStroke||frameCtx.layer?.strokeColor||'#ffffff')"),'Line recorder has no explicit frame style');
  assert(scene.includes('try{r.warmup?.();}catch(_){}'),'Layer Scene does not own WebGPU stroke warmup');
  assert(ui.includes('function togglePaletteFillWithMemory()'),'Palette Fill toggle missing');
  assert(ui.includes('memory.fillMorphRange={min,max}'),'Morph Fill range memory missing');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:420,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const original={layers:state.layers,activeLayerId:state.activeLayerId,master:state.masterLayerEdit,showLines:state.showLines,morphMin:state.morph.fillLayersMin,morphMax:state.morph.fillLayersMax,morphFill:state.morph.options.byFillColor};
      const result={};
      try{
        const layers=[createLayer('fill-a'),createLayer('fill-b'),createLayer('fill-c')];
        state.layers=layers;state.activeLayerId=layers[0].id;state.masterLayerEdit=true;state.showLines=true;
        layers[0].fill=true;layers[1].fill=false;layers[2].fill=true;
        layers.forEach(l=>{l.lineVisible=true;l.fillColor='#44ccff66';l.strokeColor='#ff33aa';});
        syncSidebarInputs();
        const palette=document.getElementById('btnSidebarPalette');
        const shape=document.getElementById('btnSidebarShape');
        const right=(el)=>el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
        right(palette);result.staticOff=layers.map(l=>l.fill===true);
        right(palette);result.staticRestore=layers.map(l=>l.fill===true);
        right(shape);result.linesAfterShape=layers.map(l=>l.lineVisible!==false);result.fillAfterShape=layers.map(l=>l.fill===true);

        // The Line carrier must not inherit an ambient black Canvas2D style.
        const oldTransform=mainCtx.getTransform();mainCtx.save();mainCtx.setTransform(1,0,0,1,0,0);mainCtx.strokeStyle='#000000';
        const frameCtx={frameId:777,frame:{id:777},layer:layers[0],layerIndex:0,strokeWidth:3,lineCap:'round',lineJoin:'round',miterLimit:6,combinedScale:1,combinedRotationRad:0,geometryPlan:{kind:'static',dynamic:false},drawLayerInstances:(rec)=>{rec.beginPath();rec.moveTo(10,10);rec.lineTo(80,20);rec.stroke();}};
        const commands=getFrameGLStrokeCommands(frameCtx,false);result.recordedStroke=commands?.[0]?.strokeStyle||null;mainCtx.restore();mainCtx.setTransform(oldTransform);

        // Geometry contract keeps Fill even when Line is hidden.
        const fc={layer:layers[0],layerIndex:0,geometryPlan:{kind:'blue-circle-slide',dynamic:true},drawLayerInstances:()=>{},frame:{id:778},frameId:778};
        layers[0].lineVisible=false;layers[0].fill=true;fc._geometryKernelView={fillContourCount:1,hasClosedFillTopology:true,invalidPointCount:0};
        const oldFrameView=GeometryKernel.frameView;GeometryKernel.frameView=()=>fc._geometryKernelView;
        try{const c=getLayerGeometryContract(fc);result.fillIndependent={configured:c.fillConfigured,requested:c.fillRequested};}finally{GeometryKernel.frameView=oldFrameView;}

        // Manual 3-layer Morph setting must be remembered across Palette OFF/ON.
        state.morph.options.byFillColor=true;state.morph.fillLayersMin=3;state.morph.fillLayersMax=3;
        const minEl=document.getElementById('morphFillLayersMin'),maxEl=document.getElementById('morphFillLayersMax');
        if(minEl){minEl.value='3';minEl.dispatchEvent(new Event('change',{bubbles:true}));}
        if(maxEl){maxEl.value='3';maxEl.dispatchEvent(new Event('change',{bubbles:true}));}
        // Use the public toggle while forcing the same active-mode branch used by real Morph.
        const wasActive=runtimeState.morph.active;runtimeState.morph.active=true;
        const oldRequest=window.requestMainCanvasRender;window.requestMainCanvasRender=()=>{};
        // rebase can run with the real application state; wait one task between toggles.
        __somataTogglePaletteFill();result.morphOff={min:state.morph.fillLayersMin,max:state.morph.fillLayersMax,option:state.morph.options.byFillColor};
        __somataTogglePaletteFill();result.morphRestore={min:state.morph.fillLayersMin,max:state.morph.fillLayersMax,option:state.morph.options.byFillColor,memory:__somataPaletteFillStatus().morph.remembered};
        runtimeState.morph.active=wasActive;window.requestMainCanvasRender=oldRequest;

        // Layer Scene ensure must warm the renderer before probing external-scene readiness.
        const r=WebGPUStrokeRenderer,ow=r.warmup,oc=r.canUseExternalLayerScene,ob=r.beginExternalLayerScene,og=r.getDeferredLayerSceneTexture;
        let order=[];
        try{
          r.warmup=()=>{order.push('warmup');return false;};r.getDeferredLayerSceneTexture=()=>null;r.canUseExternalLayerScene=()=>{order.push('probe');return false;};r.beginExternalLayerScene=()=>false;
          SomataLayerSceneService.ensure({frameId:900,frame:{id:900}},'web-regression');
          result.sceneOrder=order.slice();
        }finally{r.warmup=ow;r.canUseExternalLayerScene=oc;r.beginExternalLayerScene=ob;r.getDeferredLayerSceneTexture=og;}
        return result;
      }finally{
        state.layers=original.layers;state.activeLayerId=original.activeLayerId;state.masterLayerEdit=original.master;state.showLines=original.showLines;state.morph.fillLayersMin=original.morphMin;state.morph.fillLayersMax=original.morphMax;state.morph.options.byFillColor=original.morphFill;
      }
    })()`,{timeoutMs:12000,label:'palette fill/web/color regression'});
    assert(JSON.stringify(out.staticOff)==='[false,false,false]','Palette right-click did not disable static Fill: '+JSON.stringify(out));
    assert(JSON.stringify(out.staticRestore)==='[true,false,true]','Palette right-click did not restore remembered static Fill: '+JSON.stringify(out));
    assert(JSON.stringify(out.linesAfterShape)==='[false,false,false]','Geometry right-click did not hide Line: '+JSON.stringify(out));
    assert(JSON.stringify(out.fillAfterShape)==='[true,false,true]','Geometry Line toggle incorrectly changed Fill: '+JSON.stringify(out));
    assert(String(out.recordedStroke).toLowerCase()==='#ff33aa','Line carrier inherited ambient black style: '+JSON.stringify(out));
    assert(out.fillIndependent?.configured===true&&out.fillIndependent?.requested===true,'Fill contract still requires visible Line: '+JSON.stringify(out));
    assert(out.morphOff?.min===0&&out.morphOff?.max===0&&out.morphOff?.option===true,'Morph Fill OFF did not become 0 layers: '+JSON.stringify(out));
    assert(out.morphRestore?.min===3&&out.morphRestore?.max===3&&out.morphRestore?.option===true,'Morph Fill did not restore manually remembered 3 layers: '+JSON.stringify(out));
    assert(out.sceneOrder?.[0]==='warmup'&&out.sceneOrder?.[1]==='probe','Web Layer Scene probes before warmup: '+JSON.stringify(out));
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(!exc.length,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.7.9 PALETTE FILL / WEB / LINE COLOR: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('SOMATA 7.7.9 PALETTE FILL / WEB / LINE COLOR: FAIL',e.stack||e);process.exit(1)});
