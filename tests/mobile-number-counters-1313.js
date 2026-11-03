'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const shot=async(h,exp)=>JSON.parse(await h.evaluate('JSON.stringify('+exp+')'));
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:110,evalTimeoutMs:20000});
 try {
  const initial=await shot(h,`(()=>({morph:state.morph.slideType,animation:SomataTestMorph.config(state.layers[0]).slide,selected:document.getElementById('morphSlideType').value,animationUI:document.getElementById('testMorphSlide').value,log:document.getElementById('testMorphDuration').dataset.logStep,min:document.getElementById('testMorphDuration').min,max:document.getElementById('testMorphDuration').max}))()`);
  assert.equal(initial.morph,'minimal');assert.equal(initial.animation,'minimal');assert.equal(initial.selected,'minimal');assert.equal(initial.animationUI,'minimal');assert.equal(initial.log,'time');assert.equal(initial.min,'0.1');assert.equal(initial.max,'60');
  // Existing explicit user preference remains available, no coercion.
  await h.evaluate(`(()=>{state.morph.slideType='sector';syncMorphSettingsUI();})()`);
  assert.equal(await h.evaluate(`document.getElementById('morphSlideType').value`),'sector');
  await h.evaluate(`(()=>{state.morph.slideType='minimal';syncMorphSettingsUI();})()`);
  const wheel=await shot(h,`(()=>{const el=document.getElementById('testMorphDuration');el.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));return {value:el.value,state:SomataTestMorph.config(state.layers[0]).duration}})()`);
  assert.equal(wheel.value,'2',JSON.stringify(wheel));assert.equal(wheel.state,2,JSON.stringify(wheel));
  // Clear is legal while typing, despite min>0 and aggressive live synchronization.
  const edit=await shot(h,`(()=>{const el=document.getElementById('testMorphDuration');el.focus();el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));const blank=el.value;const stateDuring=SomataTestMorph.config(state.layers[0]).duration;el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));return {blank,stateDuring,after:el.value,stateAfter:SomataTestMorph.config(state.layers[0]).duration}})()`);
  assert.equal(edit.blank,'');assert.equal(edit.stateDuring,2);assert.equal(edit.after,'5');assert.equal(edit.stateAfter,5);
  const zero=await shot(h,`(()=>{const el=document.getElementById('testMorphDuration');el.focus();el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));const interim=el.value;const stateDuring=SomataTestMorph.config(state.layers[0]).duration;el.value='0.5';el.dispatchEvent(new Event('input',{bubbles:true}));return {interim,stateDuring,after:el.value,stateAfter:SomataTestMorph.config(state.layers[0]).duration}})()`);
  assert.equal(zero.interim,'0');assert.equal(zero.stateDuring,5);assert.equal(zero.after,'0.5');assert.equal(zero.stateAfter,.5);
  const invalid=await shot(h,`(()=>{const el=document.getElementById('testMorphDuration');el.focus();el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.blur();return {value:el.value,state:SomataTestMorph.config(state.layers[0]).duration}})()`);
  assert.equal(invalid.value,'0.5');assert.equal(invalid.state,.5);
  const limit=await shot(h,`(()=>{const el=document.getElementById('testMorphDuration');el.value='60';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('wheel',{bubbles:true}));el.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,bubbles:true,cancelable:true}));return {value:el.value,state:SomataTestMorph.config(state.layers[0]).duration}})()`);
  assert.equal(limit.value,'60',JSON.stringify(limit));
  // Non-logarithmic counter uses its native step and hover wheel.
  const linear=await shot(h,`(()=>{let e=document.createElement('input');e.type='number';e.id='testCounter1313';e.min='1';e.step='2';e.value='3';document.body.appendChild(e);e.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));const v=e.value;e.remove();return {value:v}})()`);
  assert.equal(linear.value,'5');
  for(const width of [320,390,760]){
   await h.call('Emulation.setDeviceMetricsOverride',{width,height:780,deviceScaleFactor:1,mobile:true});
   await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
   await h.evaluate(`(()=>{const e=document.getElementById('testMorphDuration');e.value='5';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:81,pointerType:'touch',button:0,clientY:300,clientX:100}));})()`);
   await h.sleep(410);
   await h.evaluate(`(()=>{const e=document.getElementById('testMorphDuration');e.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:81,pointerType:'touch',button:0,clientY:228,clientX:100}));e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:81,pointerType:'touch',button:0,clientY:228,clientX:100}));})()`);
   const touch=await shot(h,`(()=>({value:document.getElementById('testMorphDuration').value,stored:SomataTestMorph.config(state.layers[0]).duration,active:document.getElementById('testMorphDuration').classList.contains('somata-number-is-scrubbing'),height:document.documentElement.scrollWidth}))()`);
   assert.equal(touch.value,'9',JSON.stringify({width,touch}));assert.equal(touch.stored,9,JSON.stringify({width,touch}));assert.equal(touch.active,false);
   await h.evaluate(`document.getElementById('testMorphDuration').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:82,pointerType:'touch',button:0,clientY:300}))`);
   await h.sleep(80);
   await h.evaluate(`document.getElementById('testMorphDuration').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:82,pointerType:'touch',button:0,clientY:300}))`);
   assert.equal(await h.evaluate(`document.getElementById('testMorphDuration').value`),'9');
  }
  const errors=uncaughtExceptions(h.events);
  assert.deepEqual(errors,[]);
  console.log('PASS numeric animation + defaults + empty editing + pointer scrub + hover wheel',JSON.stringify({initial,wheel,edit,zero,invalid,limit,linear,devices:[320,390,760]}));
 } finally {await h.close();}
})().catch(err=>{console.error('FAIL 13.1.3 number counters',err.stack||err);process.exitCode=1;});
