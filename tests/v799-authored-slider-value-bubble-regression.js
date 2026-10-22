const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const ui=read('js/app/ui-project-runtime.js'),css=read('styles/app.css');
  assert(ui.includes('standard-slider-value-bubble')&&ui.includes('bindStandardSliderBubbleDelegation'),'authored slider bubble implementation missing');
  assert(css.includes('.standard-slider-value-bubble'),'authored slider bubble styles missing');
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      runtimeState.morph.active=false;syncBlueMorphParameterDecorations?.();
      const el=document.getElementById('paramRadius');if(!el)throw new Error('missing paramRadius');
      const host=el.closest('.blue-morph-range-host');
      const before=Number(el.value);el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,clientX:1,clientY:1}));await new Promise(r=>requestAnimationFrame(r));
      let bubble=document.querySelector('.standard-slider-value-bubble');
      const focused={exists:!!bubble,visible:bubble?.classList.contains('visible'),text:bubble?.textContent||'',position:bubble?getComputedStyle(bubble).position:'',hostMode:host?.dataset.sliderMode||''};
      const next=Math.min(Number(el.max),before+Math.max(1,Number(el.step)||1));el.value=String(next);el.dispatchEvent(new Event('input',{bubbles:true}));
      bubble=document.querySelector('.standard-slider-value-bubble');const updated={text:bubble?.textContent||'',visible:bubble?.classList.contains('visible'),left:bubble?.style.left||'',top:bubble?.style.top||''};
      el.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,clientX:1,clientY:1}));
      // A non-routing engine/settings range must get the same delegated bubble if present.
      const every=[...document.querySelectorAll('input[type="range"]')].find(x=>!x.classList.contains('blue-morph-dual')&&!x.closest('.blue-morph-range-host')&&x.getBoundingClientRect().width>0);
      let generic=null;if(every){every.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,clientX:1,clientY:1}));await new Promise(r=>requestAnimationFrame(r));bubble=document.querySelector('.standard-slider-value-bubble');generic={id:every.id||'',visible:bubble?.classList.contains('visible'),text:bubble?.textContent||''};every.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,clientX:1,clientY:1}));}
      return{before,next,focused,updated,generic};
    })()`,{timeoutMs:15000,label:'7.9.9 authored slider bubbles'});
    assert(out.focused.exists&&out.focused.visible&&out.focused.text,'ordinary authored slider bubble did not appear: '+JSON.stringify(out));
    assert(out.focused.hostMode==='value','test slider was not in normal non-Morph mode: '+JSON.stringify(out.focused));
    assert(out.updated.visible&&out.updated.text===String(out.next)&&out.updated.left.endsWith('px')&&out.updated.top.endsWith('px'),'ordinary bubble did not follow/update value: '+JSON.stringify(out.updated));
    if(out.generic)assert(out.generic.visible&&out.generic.text,'delegated bubble failed on a non-Morph-wrapped range: '+JSON.stringify(out.generic));
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.9 AUTHORED / NON-MORPH SLIDER VALUE BUBBLES: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.9.9 AUTHORED / NON-MORPH SLIDER VALUE BUBBLES: FAIL',e.stack||e);process.exit(1)});
