const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const ui=read('js/app/ui-project-runtime.js'),core=read('js/app/geometry-gpu-core.js'),css=read('styles/app.css');
  assert(ui.includes('parameter-routing-context-menu')&&ui.includes('SomataMorphParameterRoutingUI')&&ui.includes('morph-slider-value-bubble'),'unified routing frame / bubble implementation missing');
  assert(core.includes('SomataAudioParameterRoutingUI')&&core.includes('setAudioParameterRoutingActive'),'Audio routing bridge missing');
  for(const token of ['parameter-routing-neutral','parameter-routing-morph','parameter-routing-audio','parameter-routing-both'])assert(css.includes(token),'missing routing visual state '+token);
  assert(css.includes('linear-gradient(135deg')&&css.includes('#a21c50')===false /* accent is JS-side */,'combined gradient routing fill missing');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const R=window.SomataParameterRegistry,def=R.get('web.width'),el=document.getElementById(def.ui.mainId),host=el.closest('.blue-morph-range-host')||el;
      const all=R.morphable();let capable=0,ranges=0,wrapped=0;
      for(const d of all){const input=document.getElementById(d.ui.mainId),visual=input?.closest('.blue-morph-range-host')||input;if(visual?.classList.contains('parameter-routing-capable'))capable++;if(input?.type==='range'){ranges++;if(input.closest('.blue-morph-range-host'))wrapped++;}}
      // deterministic empty state
      const profile=SomataMorphParameterRouting.activeProfile(state.morph,state.minimalMorph);let binding=(profile.bindings||[]).find(b=>b.parameter===def.id);if(binding)binding.enabled=false;
      SomataAudioParameterRoutingUI.setActive(def.id,false);window.__syncParameterRoutingDecorations();
      const cls=()=>({neutral:host.classList.contains('parameter-routing-neutral'),morph:host.classList.contains('parameter-routing-morph'),audio:host.classList.contains('parameter-routing-audio'),both:host.classList.contains('parameter-routing-both')});
      const s0=cls();

      // RMB on the empty part of the routing frame opens a multi-select menu.
      const rect=host.getBoundingClientRect();host.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:rect.left+2,clientY:rect.top+2}));
      let menu=document.getElementById('parameterRoutingContextMenu');
      const menu0={exists:!!menu,hidden:menu?.classList.contains('hidden'),text:menu?.textContent||'',checks:[...menu?.querySelectorAll?.('.parameter-routing-popup-option')||[]].map(b=>({kind:b.className,checked:b.getAttribute('aria-checked')}))};
      let morphButton=menu?.querySelector('.routing-morph'),audioButton=[...menu?.querySelectorAll('.parameter-routing-target-bubble')||[]].find(b=>b.textContent.trim()==='1');morphButton?.click();const s1=cls();const menuStillOpen1=!document.getElementById('parameterRoutingContextMenu')?.classList.contains('hidden');
      menu=document.getElementById('parameterRoutingContextMenu');audioButton=[...menu?.querySelectorAll('.parameter-routing-target-bubble')||[]].find(b=>b.textContent.trim()==='1');audioButton?.click();const s2=cls();const menuStillOpen2=!document.getElementById('parameterRoutingContextMenu')?.classList.contains('hidden');
      menu=document.getElementById('parameterRoutingContextMenu');morphButton=menu?.querySelector('.routing-morph');morphButton?.click();const s3=cls();
      menu=document.getElementById('parameterRoutingContextMenu');audioButton=[...menu?.querySelectorAll('.parameter-routing-target-bubble')||[]].find(b=>b.textContent.trim()==='1');audioButton?.click();const s4=cls();

      // Re-enable Morph via the same popup, then a running Blue Morph must replace the ordinary range with dual handles.
      menu=document.getElementById('parameterRoutingContextMenu');morphButton=menu?.querySelector('.routing-morph');morphButton?.click();
      const authoredValue=el.value;runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.pausedByOrangeProject=false;runtimeState.morph.pausedByGreenProject=false;syncBlueMorphParameterDecorations();window.__syncParameterRoutingDecorations();
      const dual=[...host.querySelectorAll('.blue-morph-dual')],live={host:host.classList.contains('morph-live'),dual:dual.map(x=>!x.disabled),currentHidden:el.getAttribute('aria-hidden')};
      const low=dual[0];if(low){const min=Number(low.min),max=Number(low.max);low.focus();low.value=String(min+(max-min)*.31);low.dispatchEvent(new Event('input',{bubbles:true}));}
      const bubble=host.querySelector('.morph-slider-value-bubble');const bubbleState={exists:!!bubble,visible:bubble?.classList.contains('visible'),text:bubble?.textContent||'',left:bubble?.style.left||'',authoredUnchanged:el.value===authoredValue};
      runtimeState.morph.active=false;syncBlueMorphParameterDecorations();window.__syncParameterRoutingDecorations();
      return{total:all.length,capable,ranges,wrapped,s0,s1,s2,s3,s4,menu0,menuStillOpen1,menuStillOpen2,live,bubbleState,morphState:SomataMorphParameterRoutingUI.state(def.id),audioState:SomataAudioParameterRoutingUI.state(def.id)};
    })()`,{timeoutMs:15000,label:'7.9.8 routing frames + dual Morph slider'});

    assert(out.total>=100&&out.capable===out.total,'not every morphable parameter received a routing frame: '+JSON.stringify(out));
    assert(out.ranges>0&&out.wrapped===out.ranges,'not every routable range is dual-slider capable: '+JSON.stringify({ranges:out.ranges,wrapped:out.wrapped}));
    assert(out.s0.neutral&&!out.s0.morph&&!out.s0.audio&&!out.s0.both,'empty route must be weak-white neutral: '+JSON.stringify(out.s0));
    assert(out.menu0.exists&&!out.menu0.hidden&&out.menu0.text.includes('Аудиосвязь')&&out.menu0.text.includes('Синий морфинг')&&out.menu0.text.includes('1')&&out.menu0.text.includes('М')&&out.menu0.checks.length===2&&out.menu0.checks.some(c=>c.kind.includes('routing-morph'))&&out.menu0.checks.some(c=>c.kind.includes('routing-orange')),'RMB routing target-bubble popup missing: '+JSON.stringify(out.menu0));
    assert(out.s1.morph&&!out.s1.audio&&!out.s1.both,'Morph-only field did not become blue: '+JSON.stringify(out.s1));
    assert(out.s2.both&&!out.s2.morph&&!out.s2.audio,'Morph+Audio field did not become combined gradient: '+JSON.stringify(out.s2));
    assert(out.s3.audio&&!out.s3.morph&&!out.s3.both,'Audio-only field did not become burgundy: '+JSON.stringify(out.s3));
    assert(out.s4.neutral,'disabling both routes did not restore neutral field: '+JSON.stringify(out.s4));
    assert(out.menuStillOpen1&&out.menuStillOpen2,'multi-select popup closed after first choice');
    assert(out.live.host&&out.live.dual.every(Boolean)&&out.live.currentHidden==='true','running Blue Morph did not replace normal range with dual Morph handles: '+JSON.stringify(out.live));
    assert(out.bubbleState.exists&&out.bubbleState.visible&&out.bubbleState.text&&out.bubbleState.left.includes('%'),'Morph slider value bubble did not follow active handle: '+JSON.stringify(out.bubbleState));
    assert(out.bubbleState.authoredUnchanged,'editing Morph range mutated authored slider value');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.8 ROUTING FIELD STATES + MULTI-SELECT RMB + DUAL MORPH SLIDER BUBBLE: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.9.8 ROUTING FIELD STATES + MULTI-SELECT RMB + DUAL MORPH SLIDER BUBBLE: FAIL',e.stack||e);process.exit(1)});
