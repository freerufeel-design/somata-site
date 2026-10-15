const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const ui=await h.evaluate(`(()=>{
      const def=[...SomataEffectStackOrder.DEFAULT_ORDER];
      SomataEffectStackOrder.set(def);__somataRenderEffectOrderSettings?.();
      document.getElementById('btnProjectMenu')?.click();document.getElementById('btnFileSettingsToggle')?.click();
      const keys=()=>[...document.querySelectorAll('#effectOrderList .effect-order-row')].map(x=>x.dataset.effectKey);
      const before=keys();const web=document.querySelector('.effect-order-row[data-effect-key="web"]'),fill=document.querySelector('.effect-order-row[data-effect-key="fill"]');
      let dragSupported=false;
      try{
        const dt=new DataTransfer();
        web.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
        fill.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
        fill.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
        web.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:dt}));
        dragSupported=true;
      }catch(_){dragSupported=false;}
      const after=keys();const saved=captureMenuSettings();SomataEffectStackOrder.set(def);__somataRenderEffectOrderSettings?.();applyMenuSettings(saved);const restored=keys();
      document.getElementById('btnResetEffectOrder')?.click();const reset=keys();
      return{def,before,after,restored,savedOrder:saved.effectOrder,reset,dragSupported,stateOrder:[...(state.effectOrder||[])]};
    })()`);
    assert(JSON.stringify(ui.before)===JSON.stringify(ui.def),'File → Settings list does not show default artistic order');
    assert(ui.dragSupported,'browser did not support the real drag/drop interaction used by the menu');
    assert(ui.after[0]==='web'&&ui.after[1]==='fill',`dragging Web below Fill did not change order: ${JSON.stringify(ui.after)}`);
    assert(JSON.stringify(ui.savedOrder)===JSON.stringify(ui.after),'effect order was not captured in File/project menu settings');
    assert(JSON.stringify(ui.restored)===JSON.stringify(ui.after),'saved effect order was not restored through menu settings');
    assert(JSON.stringify(ui.reset)===JSON.stringify(ui.def),'Reset did not restore default order');
    assert(JSON.stringify(ui.stateOrder)===JSON.stringify(ui.def),'reset order was not committed to state');

    const run=async(dynamic,order)=>h.evaluate(`(async()=>{
      const desired=${JSON.stringify(order)};SomataEffectStackOrder.set(desired);__somataRenderEffectOrderSettings?.();
      const l=createLayer('effect-order-${dynamic?'morph':'static'}-'+Math.random());Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:180,rounding:35,fill:true,fillColor:'#224466aa',strokeWidth:3,strokeColor:'#33aaff'});ensureLayerEffectState(l);l.showWeb=true;l.web.placementMode='corners';l.web.distance=60;state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn?.click();
      if(${dynamic?'true':'false'}){btn?.click();await new Promise(r=>setTimeout(r,140));}
      beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);
      const old={ensure:SomataLayerSceneService.ensure,queue:SomataLayerSceneService.queue,fillEncode:FillGPURenderer.encodeMeshIsolatedCommandToTexture,webStatus:WebGPUWebThreadSceneRenderer.status,webReady:WebGPUWebThreadSceneRenderer.isReady,webEncode:WebGPUWebThreadSceneRenderer.encodeToLayerScene,morphEncode:WebGPUWebMorphRenderer.encodeToLayerScene,morphCorridor:WebGPUWebMorphRenderer.encodeCorridorToLayerScene};
      const queued=[];let fillTriangles=0,webEncoded=0;
      try{
        SomataLayerSceneService.ensure=(ctx)=>{ctx.frame.gpuLayerSceneDeferred=true;return{texture:{createView(){return{};}}};};
        SomataLayerSceneService.queue=(ctx,phase,commandBuffer,label)=>{queued.push({phase,label,kind:commandBuffer?.kind||''});return true;};
        FillGPURenderer.encodeMeshIsolatedCommandToTexture=(texture,ctx,mesh)=>{fillTriangles=Number(mesh?.fanTriangleCount)||0;return{handled:true,commandBuffer:{kind:'fill'}};};
        WebGPUWebThreadSceneRenderer.status=()=>({available:true,initializing:false,lastError:''});WebGPUWebThreadSceneRenderer.isReady=()=>true;
        WebGPUWebThreadSceneRenderer.encodeToLayerScene=(texture,commands)=>{webEncoded=commands?.length||0;return{handled:true,commandBuffer:{kind:'web'}};};
        WebGPUWebMorphRenderer.encodeToLayerScene=()=>{webEncoded=1;return{handled:true,commandBuffer:{kind:'web-morph'}};};
        WebGPUWebMorphRenderer.encodeCorridorToLayerScene=()=>{webEncoded=1;return{handled:true,commandBuffer:{kind:'web-morph-corridor'}};};
        const fillResult=prepareRetainedFillSceneBeforeGlow(c);renderLayerWebPass(c);
        const out={dynamic:c.geometryPlan?.dynamic===true,morphFrame:c.morphFrameActive===true,fillHandled:fillResult?.handled===true,fillTriangles,webHandled:c._webPassHandled===true,webEncoded,queued:queued.slice(),phases:{fill:somataEffectPhase('fill'),web:somataEffectPhase('web')},order:SomataEffectStackOrder.current()};
        if(runtimeState.morph.active)btn?.click();
        return out;
      } finally {
        SomataLayerSceneService.ensure=old.ensure;SomataLayerSceneService.queue=old.queue;FillGPURenderer.encodeMeshIsolatedCommandToTexture=old.fillEncode;WebGPUWebThreadSceneRenderer.status=old.webStatus;WebGPUWebThreadSceneRenderer.isReady=old.webReady;WebGPUWebThreadSceneRenderer.encodeToLayerScene=old.webEncode;WebGPUWebMorphRenderer.encodeToLayerScene=old.morphEncode;WebGPUWebMorphRenderer.encodeCorridorToLayerScene=old.morphCorridor;
        if(runtimeState.morph.active)btn?.click();
      }
    })()`,{timeoutMs:30000,label:'effect order static/morph scenario'});

    const def=ui.def,swapped=['web','fill',...def.filter(x=>x!=='web'&&x!=='fill')];
    const results=[];
    for(const dynamic of [false,true])for(const order of [def,swapped])results.push(await run(dynamic,order));
    for(const r of results){
      assert(r.fillHandled&&r.fillTriangles>0,`Fill did not produce/queue real mesh in ${r.morphFrame?'Morph':'Static'}: ${JSON.stringify(r)}`);
      assert(r.webHandled&&r.webEncoded>0,`Web did not reach GPU command path in ${r.morphFrame?'Morph':'Static'}: ${JSON.stringify(r)}`);
      const fq=r.queued.find(x=>String(x.label).startsWith('fill')),wq=r.queued.find(x=>String(x.label).startsWith('web'));
      assert(fq&&wq,`Fill/Web commands were not both queued: ${JSON.stringify(r.queued)}`);
      assert(fq.phase===r.phases.fill&&wq.phase===r.phases.web,`queued phases are not driven by central effect order: ${JSON.stringify(r)}`);
      const fillBeforeWeb=r.order.indexOf('fill')<r.order.indexOf('web');
      assert(fillBeforeWeb?(fq.phase<wq.phase):(wq.phase<fq.phase),`phase order disagrees with user stack: ${JSON.stringify(r)}`);
      if(r.morphFrame)assert(r.dynamic,'active Morph did not use dynamic geometry');
    }
    SomataEffectStackOrderReset=await h.evaluate(`(()=>{SomataEffectStackOrder.set([...SomataEffectStackOrder.DEFAULT_ORDER]);__somataRenderEffectOrderSettings?.();return SomataEffectStackOrder.current()})()`);
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 configurable effect order in File settings + Static/Morph Fill/Web',results);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 configurable effect-order regression:',e.stack||e.message);process.exit(1)});
