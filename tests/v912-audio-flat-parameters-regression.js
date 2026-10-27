// Audio editor displays routeable parameters in a single level; no nested subsettings.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:25000});
 try{
  const out=await h.evaluate(`(()=>{
    state.audioReactive.bandCount=3;state.audioReactive.routes={master:[],layers:{}};state.audioReactive.routingInitialized=false;
    state.layers=[createLayer('Слой 1'),createLayer('Слой 2')];ensureAudioRoutingState();
    if(document.getElementById('audioRoutingPanel')?.classList.contains('hidden'))document.getElementById('btnAudioRouting').click();
    state.audioReactive.routingTarget='master';renderAudioRoutingPanel();
    const lamps=document.getElementById('audioGroupLamps');lamps.click();
    const menu=document.getElementById('audioGroupLampsMenu');
    const flatChildren=[...menu.querySelectorAll('[data-parameter-id="lamps.radiusMultiplier"]')];
    const nested=menu.querySelectorAll('details,summary,.audio-param-subsettings,[data-child-parameter]').length;
    const level=flatChildren[0]?.parentElement===menu;
    const before=(state.audioReactive.routes.master||[]).filter(r=>r.param==='lamps.radiusMultiplier').length;
    flatChildren[0]?.click();
    const after=(state.audioReactive.routes.master||[]).filter(r=>r.param==='lamps.radiusMultiplier').length;
    const key=state.layers[1]?.id;
    state.audioReactive.routingTarget=key;renderAudioRoutingPanel();
    lamps.click();
    const layerButton=document.getElementById('audioGroupLampsMenu').querySelector('[data-parameter-id="lamps.radiusMultiplier"]');
    layerButton?.click();
    const layerRoute=(state.audioReactive.routes.layers[key]||[]).find(r=>r.param==='lamps.radiusMultiplier');
    const targetBand=state.layers[1].audioNativeBand;
    // A child parameter must also be selectable from a standard route's picker.
    const pickerBtn=document.querySelector('#audioRoutingRows .audio-param-picker-button');
    pickerBtn?.click();
    const picker=document.querySelector('.audio-param-menu:not(.hidden)');
    const pickerOption=picker?.querySelector('[data-parameter-id="lamps.radiusMultiplier"]');
    const pickerFlat=!!pickerOption&&pickerOption.closest('details')===null;
    return {nested,level,flatCount:flatChildren.length,before,after,layerRoute:!!layerRoute,layerBand:layerRoute?.band,targetBand,pickerFlat,menuEntries:[...menu.querySelectorAll('.audio-param-option')].length};
  })()`,{timeoutMs:25000,label:'flat audio parameter menus'});
  assert.equal(out.nested,0,'audio group contains nested subsettings');
  assert.equal(out.level,true,'audio child parameter is not a direct menu entry');
  assert.equal(out.flatCount,1,'audio child must appear once');
  assert.equal(out.after,out.before===0?1:0,'flat route toggle must update master');
  assert.equal(out.layerRoute,true,'child cannot be assigned directly to a layer');
  assert.equal(out.layerBand,out.targetBand,'new child routing must use its layer frequency');
  assert.equal(out.pickerFlat,true,'route picker omits flat child parameter');
  assert(!uncaughtExceptions(h.events).length,'uncaught browser exceptions: '+uncaughtExceptions(h.events));
  console.log('PASS flat audio parameters 9.1',JSON.stringify(out));
 } finally{await h.close();}
})().catch(e=>{console.error('FAIL flat audio parameters 9.1',e.stack||e);process.exit(1)});
