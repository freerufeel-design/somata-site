const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:12000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const stop=()=>{for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel'])try{animationScheduler.remove(n)}catch(_){};if(runtimeState?.morph){runtimeState.morph.active=false;runtimeState.morph.paused=false;runtimeState.morph.frameLayers=[];runtimeState.morph.lightLayers=[];runtimeState.morph.renderSourceLayers=[];runtimeState.morph.renderTargetLayers=[];}};
      stop();state.masterLayerEdit=false;state.tunnel.active=false;
      const ls=[createLayer('master-physical-a'),createLayer('master-physical-b'),createLayer('master-physical-c')];
      for(let i=0;i<ls.length;i++){ensureLayerEffectState(ls[i]);ls[i].radius=[111,222,333][i];ls[i].glow=[4,9,16][i];ls[i].fill=i===0;ls[i].fillMatchStroke=false;ls[i].fillColor=['rgba(255,0,0,.2)','rgba(0,255,0,.4)','rgba(0,0,255,.6)'][i];}
      state.layers.splice(0,state.layers.length,...ls);state.activeLayerId=ls[0].id;updateLayerListUI();syncSidebarInputs();await sleep(20);

      document.getElementById('btnMasterLayer').click();await sleep(20);
      const masterAfterEnable=state.masterLayerEdit===true;
      const editTargetCountAfterEnable=getLayerEditTargets().length;

      // This is the real workflow that regressed: enable Master, then choose the source layer.
      const items=[...document.querySelectorAll('#layerList .layer-item')];
      items[1].click();await sleep(30);
      const afterSelect={master:state.masterLayerEdit===true,active:state.activeLayerId,button:document.getElementById('btnMasterLayer')?.getAttribute('aria-pressed'),activeRows:[...document.querySelectorAll('#layerList .layer-item.active')].length,editTargets:getLayerEditTargets().length};

      // A handler that directly iterates getLayerEditTargets() must physically fan out in
      // the same synchronous event, matching the known-good 7.3.8 Master implementation.
      const lineOpacity=document.getElementById('paramLineOpacity');lineOpacity.value='63';lineOpacity.dispatchEvent(new Event('input',{bubbles:true}));
      const lineOpacitiesImmediate=state.layers.map(l=>l.lineOpacity);

      const radius=document.getElementById('paramRadius');radius.value='247';radius.dispatchEvent(new Event('input',{bubbles:true}));await sleep(60);
      const radii=state.layers.map(l=>l.radius);
      const radiusBroadcast=window.__spiroLastMasterBroadcast?{...window.__spiroLastMasterBroadcast,paths:[...(window.__spiroLastMasterBroadcast.paths||[])]}:null;

      // Pick another source while Master remains on and broadcast another independent field.
      [...document.querySelectorAll('#layerList .layer-item')][2].click();await sleep(25);
      const afterSecondSelect={master:state.masterLayerEdit===true,active:state.activeLayerId};
      const glow=document.getElementById('paramGlow');glow.value='31';glow.dispatchEvent(new Event('input',{bubbles:true}));await sleep(60);
      const glows=state.layers.map(l=>l.glow);

      // Fill toggle must be the same exact user field on every layer.
      const fill=document.getElementById('paramEnableFill');fill.checked=true;fill.dispatchEvent(new Event('change',{bubbles:true}));await sleep(60);
      const fills=state.layers.map(l=>l.fill);

      return{masterAfterEnable,editTargetCountAfterEnable,afterSelect,lineOpacitiesImmediate,radii,radiusBroadcast,afterSecondSelect,glows,fills,inFrame:animationScheduler.stats().inFrame};
    })()`,{timeoutMs:10000,label:'7.6.11 physical Master UI'});

    assert(out.masterAfterEnable,'Master did not enable');
    assert(out.editTargetCountAfterEnable===3,`Master getLayerEditTargets is not the physical all-layer fan-out: ${out.editTargetCountAfterEnable}`);
    assert(out.afterSelect.master,'selecting a source layer switched Master OFF');
    assert(out.afterSelect.button==='true','Master button no longer reports active after source selection');
    assert(out.afterSelect.activeRows===1,'active source layer is not visibly selected while Master is on');
    assert(out.afterSelect.editTargets===3,`Master lost all-layer edit targets after source selection: ${out.afterSelect.editTargets}`);
    assert(out.lineOpacitiesImmediate.every(v=>v===63),`direct Master fan-out is not synchronous: ${JSON.stringify(out.lineOpacitiesImmediate)}`);
    assert(out.radii.every(v=>v===247),`radius was not physically broadcast to all layers: ${JSON.stringify(out.radii)}`);
    assert(out.radiusBroadcast?.paths?.includes('radius'),`radius broadcast missing: ${JSON.stringify(out.radiusBroadcast)}`);
    assert(out.afterSecondSelect.master,'selecting a second source layer switched Master OFF');
    assert(out.glows.every(v=>v===31),`glow was not physically broadcast to all layers: ${JSON.stringify(out.glows)}`);
    assert(out.fills.every(v=>v===true),`fill checkbox was not physically broadcast to all layers: ${JSON.stringify(out.fills)}`);
    assert(!out.inFrame,'scheduler left inFrame');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('MASTER PHYSICAL UI REGRESSION: PASS — Master survives source-layer selection and broadcasts real fields to every layer');
  }finally{await h.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1);});
