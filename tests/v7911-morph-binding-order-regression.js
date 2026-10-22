const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const ui=fs.readFileSync(path.join(ROOT,'js/app/ui-project-runtime.js'),'utf8');
  const core=fs.readFileSync(path.join(ROOT,'js/core/parameter-routing.js'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const css=fs.readFileSync(path.join(ROOT,'styles/app.css'),'utf8');
  assert(html.includes('btnMorphOrderType')&&html.includes('btnMorphOrderFree'),'Morph order mode controls missing');
  assert(core.includes('workingOrderMode')&&core.includes('reorderBinding')&&core.includes('freeOrderInitialized'),'Morph order persistence API missing');
  assert(ui.includes('application/x-somata-morph-binding')&&ui.includes('morph-drag-forbidden'),'future layer-transfer drag payload / forbidden same-list drag missing');
  assert(css.includes('cursor:not-allowed')&&css.includes('morph-drag-before')&&css.includes('morph-order-mode-btn.active'),'Morph drag/order visual states missing');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const routing=window.SomataMorphParameterRouting;
      routing.ensureProfiles(state.morph,state.minimalMorph);
      document.getElementById('btnMorphSettings')?.click();await new Promise(r=>setTimeout(r,25));syncMorphProfileUI();
      const rows=()=>[...document.querySelectorAll('#morphProfileBindings .morph-binding-row[data-morph-parameter]')].map(r=>r.dataset.morphParameter);
      const standard=routing.activeProfile(state.morph,state.minimalMorph);
      const initial={mode:routing.workingOrderMode(state.morph,state.minimalMorph,standard),rows:rows(),typeButton:document.getElementById('btnMorphOrderType')?.classList.contains('active'),orderVisible:!!document.querySelector('#morphParameterRoutingPanel .morph-order-mode-prominent'),handles:[...document.querySelectorAll('#morphProfileBindings .morph-binding-row[data-morph-parameter]')].every(r=>r.draggable===false&&r.querySelector('.morph-route-drag-handle')?.draggable===true)};

      document.getElementById('btnMorphOrderFree')?.click();await new Promise(r=>setTimeout(r,5));
      const freeStart={mode:routing.workingOrderMode(state.morph,state.minimalMorph,standard),rows:rows()};
      const list=routing.workingBindings(state.morph,state.minimalMorph,standard),first=list[0]?.parameter,last=list[list.length-1]?.parameter;
      const moved=first&&last&&first!==last?routing.reorderBinding(state.morph,state.minimalMorph,first,last,'after'):false;renderMorphProfileBindings();syncMorphProfileDirtyUI();
      const manual={moved,rows:rows(),dirty:routing.isActiveProfileDirty(state.morph,state.minimalMorph)};
      document.getElementById('btnSaveMorphProfile')?.click();await new Promise(r=>setTimeout(r,5));
      const saved={mode:standard.orderMode,rows:standard.bindings.map(b=>b.parameter),dirty:routing.isActiveProfileDirty(state.morph,state.minimalMorph)};

      document.getElementById('btnMorphOrderType')?.click();await new Promise(r=>setTimeout(r,5));
      const typed={mode:routing.workingOrderMode(state.morph,state.minimalMorph,standard),rows:rows(),underlying:routing.workingBindings(state.morph,state.minimalMorph,standard).map(b=>b.parameter),blocked:routing.reorderBinding(state.morph,state.minimalMorph,last,first,'before')===false,dirty:routing.isActiveProfileDirty(state.morph,state.minimalMorph)};
      document.getElementById('btnResetMorphProfile')?.click();await new Promise(r=>setTimeout(r,5));
      const reset={mode:routing.workingOrderMode(state.morph,state.minimalMorph,standard),rows:rows(),dirty:routing.isActiveProfileDirty(state.morph,state.minimalMorph)};

      const fresh=routing.createProfile(state.morph,state.minimalMorph,'standard','Order Test');
      const defs=window.SomataParameterRegistry.morphable().filter(d=>d.morph?.legacy!==true&&['number','integer','angle','multiplier'].includes(d.type)&&morphCompoundVisibleDefinition(d));
      const a=defs.find(d=>d.group==='Паутина')||defs[0],b=defs.find(d=>d.group==='Геометрия'&&d.id!==a?.id)||defs.find(d=>d.id!==a?.id);
      for(const d of [a,b])if(d)routing.addBinding(state.morph,state.minimalMorph,d.id,{min:Number.isFinite(Number(d.min))?Number(d.min):0,max:Number.isFinite(Number(d.max))?Number(d.max):1});
      syncMorphProfileUI();
      const freshState={mode:routing.workingOrderMode(state.morph,state.minimalMorph,fresh),savedMode:fresh.orderMode,added:[a?.id,b?.id].filter(Boolean),rows:rows()};
      return{initial,freeStart,manual,saved,typed,reset,freshState};
    })()`,{timeoutMs:15000,label:'7.9.11 Morph binding order'});

    assert(out.initial.mode==='type'&&out.initial.typeButton&&out.initial.orderVisible&&out.initial.handles,'system Standard order selector/drag handle is not visible or ready: '+JSON.stringify(out.initial));
    assert(JSON.stringify(out.freeStart.rows)===JSON.stringify(out.initial.rows),'first Standard switch to Free changed the stable visible order before any drag');
    if(out.manual.moved){assert(out.manual.dirty&&out.manual.rows[0]!==out.initial.rows[0],'free reorder did not change draft order');}
    assert(out.saved.mode==='free'&&!out.saved.dirty,'manual free order was not explicitly saved');
    assert(out.typed.mode==='type'&&out.typed.blocked&&out.typed.dirty,'type mode must forbid same-list ordering while remaining a draft change');
    assert(JSON.stringify(out.typed.underlying)===JSON.stringify(out.saved.rows),'type sorting destroyed stored free/manual order');
    assert(out.reset.mode==='free'&&!out.reset.dirty&&JSON.stringify(out.reset.rows)===JSON.stringify(out.saved.rows),'Reset did not restore saved free/manual order');
    assert(out.freshState.mode==='free'&&out.freshState.savedMode==='free','new Standard profile must default to addition/free order');
    assert(JSON.stringify(out.freshState.rows)===JSON.stringify(out.freshState.added),'new profile does not preserve order of addition');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.11 MORPH BINDING ORDER / DND REGRESSION: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.9.11 Morph binding order regression:',e.stack||e.message);process.exit(1);});
