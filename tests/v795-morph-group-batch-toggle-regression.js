const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const ui=read('js/app/ui-project-runtime.js'),css=read('styles/app.css');
  assert(ui.includes("btn.addEventListener('contextmenu'")&&ui.includes('morph-group-active')&&ui.includes('morph-group-idle'),'Morph group RMB/state implementation missing');
  assert(css.includes('.audio-route-group-btn.morph-group-active')&&css.includes('rgba(74,222,128')&&css.includes('.audio-route-group-btn.morph-group-idle')&&css.includes('rgba(250,204,21'),'green/yellow group styles missing');
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      document.getElementById('btnMorphSettings')?.click();
      const routing=window.SomataMorphParameterRouting,defs=window.SomataParameterRegistry.morphable().filter(d=>d.group==='Паутина').slice(0,2),profile=routing.activeProfile(state.morph,state.minimalMorph);
      for(const d of defs){routing.removeBinding(state.morph,state.minimalMorph,d.id);routing.addBinding(state.morph,state.minimalMorph,d.id,{min:Number.isFinite(Number(d.min))?Number(d.min):0,max:Number.isFinite(Number(d.max))?Number(d.max):1});}
      syncMorphProfileUI();
      const group=()=>[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].find(b=>b.textContent.includes('Паутина'));
      const snapshot=()=>{const b=group(),p=routing.activeProfile(state.morph,state.minimalMorph),bindings=p.bindings.filter(x=>defs.some(d=>d.id===x.parameter));return{active:b.classList.contains('morph-group-active'),idle:b.classList.contains('morph-group-idle'),count:Number(b.dataset.morphGroupCount||0),activeCount:Number(b.dataset.morphGroupActive||0),values:bindings.map(x=>x.enabled!==false)};};
      const s0=snapshot();
      group().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));const s1=snapshot();
      group().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));const s2=snapshot();
      const first=document.querySelector('#morphProfileBindings .morph-route-row[data-morph-parameter="'+defs[0].id+'"] input[type=checkbox]');first.checked=false;first.dispatchEvent(new Event('change',{bubbles:true}));const s3=snapshot();
      const second=document.querySelector('#morphProfileBindings .morph-route-row[data-morph-parameter="'+defs[1].id+'"] input[type=checkbox]');second.checked=false;second.dispatchEvent(new Event('change',{bubbles:true}));const s4=snapshot();
      routing.removeBinding(state.morph,state.minimalMorph,defs[0].id);routing.removeBinding(state.morph,state.minimalMorph,defs[1].id);syncMorphProfileUI();const s5=snapshot();
      state.morph.options.byOpacity=true;state.morph.options.byStrokeWidth=true;state.morph.options.byColor=true;routing.syncActiveLegacyBindings(state.morph,state.minimalMorph);syncMorphProfileUI();
      const lineGroup=()=>[...document.querySelectorAll('#morphRoutingGroups .audio-route-group-btn')].find(b=>b.textContent.includes('Линия'));
      const legacySnapshot=()=>({active:lineGroup().classList.contains('morph-group-active'),idle:lineGroup().classList.contains('morph-group-idle'),byOpacity:state.morph.options.byOpacity,byStrokeWidth:state.morph.options.byStrokeWidth,byColor:state.morph.options.byColor});
      const l0=legacySnapshot();lineGroup().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));const l1=legacySnapshot();lineGroup().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));const l2=legacySnapshot();
      return{s0,s1,s2,s3,s4,s5,l0,l1,l2,ids:defs.map(d=>d.id)};
    })()`);
    assert(out.s0.active&&!out.s0.idle&&out.s0.count===2&&out.s0.activeCount===2&&out.s0.values.every(Boolean),'added active group is not green: '+JSON.stringify(out.s0));
    assert(!out.s1.active&&out.s1.idle&&out.s1.activeCount===0&&out.s1.values.every(v=>v===false),'first RMB did not disable all / yellow group: '+JSON.stringify(out.s1));
    assert(out.s2.active&&!out.s2.idle&&out.s2.activeCount===2&&out.s2.values.every(Boolean),'second RMB did not re-enable all / green group: '+JSON.stringify(out.s2));
    assert(out.s3.active&&!out.s3.idle&&out.s3.activeCount===1,'group must stay green while any added route is active: '+JSON.stringify(out.s3));
    assert(!out.s4.active&&out.s4.idle&&out.s4.activeCount===0,'group must turn yellow when added routes exist but all are inactive: '+JSON.stringify(out.s4));
    assert(!out.s5.active&&!out.s5.idle&&out.s5.count===0,'empty group must return to neutral state: '+JSON.stringify(out.s5));
    assert(out.l0.active&&out.l0.byOpacity&&out.l0.byStrokeWidth&&out.l0.byColor,'legacy Line group setup failed: '+JSON.stringify(out.l0));
    assert(out.l1.idle&&!out.l1.byOpacity&&!out.l1.byStrokeWidth&&!out.l1.byColor,'RMB did not disable legacy Blue Line options together: '+JSON.stringify(out.l1));
    assert(out.l2.active&&out.l2.byOpacity&&out.l2.byStrokeWidth&&out.l2.byColor,'second RMB did not restore legacy Blue Line options: '+JSON.stringify(out.l2));
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.5 MORPH GROUP RMB BATCH TOGGLE + GREEN/YELLOW STATUS: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.9.5 MORPH GROUP RMB BATCH TOGGLE + GREEN/YELLOW STATUS: FAIL',e.stack||e);process.exit(1)});
