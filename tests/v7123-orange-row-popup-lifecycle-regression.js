// Orange UI: shared row descriptions and exactly one live parameter popup across rerenders.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,m)=>{if(!x)throw Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:19000});
 try {
  const result=await h.evaluate(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const panel=document.getElementById('randomSettingsPanel');
    if(panel.classList.contains('hidden'))document.getElementById('btnRandomSettings').click();
    await sleep(20);syncOrangeMorphProfileUI();
    const groups=document.getElementById('orangeMorphRoutingGroups');
    const geo=[...groups.querySelectorAll('.audio-route-group-btn')].find(b=>b.dataset.orangeGroup==='Геометрия');
    if(!geo)throw Error('Geometry menu absent');
    geo.click();
    const popup=()=>[...document.querySelectorAll('.audio-route-group-menu[data-orange-routing-group-menu="1"]:not(.hidden)')];
    const count=()=>({total:document.querySelectorAll('.audio-route-group-menu[data-orange-routing-group-menu="1"]').length,visible:popup().length,portaled:document.querySelectorAll('#audioViewportPopupPortal .audio-route-group-menu[data-orange-routing-group-menu="1"]').length});
    const before=count(),selected=[];
    for(const id of ['geometry.N','geometry.K','layer.radius','layer.rounding','geometry.N']){
      const current=popup();if(current.length!==1)throw Error('Popup lost after parameter mutation '+id+': '+JSON.stringify(count()));
      const option=current[0].querySelector('.audio-param-option[data-parameter-id="'+id+'"]');
      if(!option)throw Error('Cannot find '+id);
      option.click();selected.push({id,...count(),panelOpen:!panel.classList.contains('hidden')});
    }
    const after=count();
    const matrix=window.SomataParameterMatrix,meta=matrix.rowLayout('geometry.orbits');
    const orange=document.querySelector('#orangeMorphBindings [data-orange-special="orbits"]');
    let blue=document.querySelector('#morphProfileBindings [data-morph-special="orbits"]');
    if(!blue){
       document.getElementById('btnMorphSettings').click();await sleep(10);syncMorphProfileUI();
       blue=document.querySelector('#morphProfileBindings [data-morph-special="orbits"]');
    }
    const structure=row=>row?({root:row.classList.contains('morph-special-config-row'),checkbox:!!row.querySelector('input[type="checkbox"]'),icon:!!row.querySelector('.morph-route-row-icon'),name:row.querySelector('.morph-special-config-name')?.textContent,range:!!row.querySelector('.morph-route-inline-range'),numbers:[...row.querySelectorAll('.morph-route-inline-range input[type="number"]')].map(el=>({min:el.min,max:el.max,step:el.step,value:el.value})),remove:!!row.querySelector('.morph-binding-remove')}):null;
    const original=structure(orange),reference=structure(blue);
    const inputs=[...orange.querySelectorAll('.morph-route-inline-range input[type="number"]')];
    inputs[0].value='25';inputs[1].value='75';inputs[1].dispatchEvent(new Event('change',{bubbles:true}));
    const stateAfter={min:state.randomOptions.orbitPercentMin,max:state.randomOptions.orbitPercentMax,stored:window.SomataOrangeMorphProfiles?.isDirty?.(state.minimalMorph,state.randomOptions,state.randomLayerCount)};
    const rendered=[...document.querySelectorAll('#orangeMorphBindings [data-orange-special="orbits"] .morph-route-inline-range input[type="number"]')].map(i=>i.value);
    // Profile change to its own current draft must not produce a duplicate popup.
    return {before,selected,after,original,reference,meta:{kind:meta.kind,control:meta.control,max:meta.max,widgets:meta.widgets},stateAfter,rendered,orangeRows:document.querySelectorAll('#orangeMorphBindings [data-orange-special="orbits"]').length};
  })()`,{timeoutMs:19000,label:'Orange popup lifecycle'});
  assert(result.before.visible===1,`Initial menu didn't open: ${JSON.stringify(result.before)}`);
  assert(result.selected.every(x=>x.visible===1&&x.portaled===1&&x.panelOpen),`Orange menu is duplicated/closed or panel hidden after adding: ${JSON.stringify(result.selected)}`);
  assert(result.after.visible===1&&result.after.portaled===1,'Extra popup remained after multiple selections '+JSON.stringify(result.after));
  assert(result.original&&result.reference,'Orbit row missing in either editor '+JSON.stringify(result));
  for(const k of ['root','checkbox','icon','name','range','remove'])assert(result.original[k]===result.reference[k],`Orbit row ${k} differs in Blue and Orange: `+JSON.stringify(result));
  assert(result.original.numbers.length===2&&result.reference.numbers.length===2,'Orbit must use a two-number range in both Morph modes');
  assert(result.original.numbers.every(x=>x.max==='100'&&x.min==='1')&&result.meta.control==='range','Orbit max/control matrix mismatch');
  assert(result.stateAfter.min===25&&result.stateAfter.max===75,'Orange orbit range did not persist: '+JSON.stringify(result.stateAfter));
  assert(result.orangeRows===1,'Duplicate orbit row rendered');
  assert(!uncaughtExceptions(h.events).length,'Browser uncaught exceptions: '+uncaughtExceptions(h.events).join(' | '));
  console.log('7.11.13 ORANGE SHARED ROW + POPUP LIFECYCLE: PASS',JSON.stringify({selected:result.selected,orbit:result.stateAfter}));
 } finally {await h.close()}
})().catch(e=>{console.error('7.11.13 ORANGE SHARED ROW + POPUP LIFECYCLE: FAIL',e.stack||e);process.exit(1)});
