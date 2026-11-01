'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:15000});
 try{
  const css=fs.readFileSync(path.join(h.ROOT,'styles','app.css'),'utf8');
  await h.evaluate(`(()=>{let s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`);
  const data=await h.evaluate(`(async()=>{
   const panel=document.getElementById('morphSettingsPanel');panel.classList.remove('hidden');
   const row=document.getElementById('morphFadeDurationRow'),slider=document.getElementById('morphFadePercent'),number=document.getElementById('morphFadePercentValue');
   const picker=document.getElementById('morphMode'),compat=document.querySelector('#morphSettingsPanel .morph-compat-grid');
   const to=mode=>{picker.value=mode;picker.dispatchEvent(new Event('change',{bubbles:true}));
      return{mode:state.morph.mode,visibleClass:row.classList.contains('is-visible'),
       width:row.getBoundingClientRect().width,height:row.getBoundingClientRect().height,
       display:getComputedStyle(row).display,computedMaxHeight:getComputedStyle(row).maxHeight};};
   const initial=to('topology'),fade=to('fade');
   await new Promise(r=>setTimeout(r,350));
   fade.height=row.getBoundingClientRect().height; fade.computedMaxHeight=getComputedStyle(row).maxHeight;
   const data={initial,fade,rowParent:row.parentElement.id,sliderInCompat:compat?.contains(slider),
     sliderMin:slider.min,sliderMax:slider.max,sliderStep:slider.step,sliderValue:slider.value,
     phase:{}};
   for(const value of [0,1,50,100]){slider.value=String(value);slider.dispatchEvent(new Event('input',{bubbles:true}));
    const at25=SpiroMorphController.resolveBlueTimeline({now:250,cycleStart:0,cycleMs:1000,mode:'fade',fadePercent:state.morph.fadePercent,easing:x=>x});
    const at75=SpiroMorphController.resolveBlueTimeline({now:750,cycleStart:0,cycleMs:1000,mode:'fade',fadePercent:state.morph.fadePercent,easing:x=>x});
    const at100=SpiroMorphController.resolveBlueTimeline({now:1000,cycleStart:0,cycleMs:1000,mode:'fade',fadePercent:state.morph.fadePercent,easing:x=>x});
    data.phase[value]={state:state.morph.fadePercent,number:number.value,at25:at25.geometryT,at75:at75.geometryT,at100:at100.geometryT};}
   data.after=to('circleSlide');
   return data;
  })()`,{label:'Real DOM Fade slider + cycle progress'});
  assert.equal(data.initial.visibleClass,false);
  assert.equal(data.fade.visibleClass,true);
  assert(data.fade.width>50&&data.fade.height>0,'Fade slider is hidden by CSS or compat layout: '+JSON.stringify(data));
  assert.equal(data.sliderInCompat,false);
  assert.equal(data.rowParent,'morphParameterRoutingPanel');
  assert.equal(data.sliderMin,'0');assert.equal(data.sliderMax,'100');assert.equal(data.sliderStep,'1');
  for(const p of [0,1,50,100]){assert.equal(data.phase[p].state,p);assert.equal(data.phase[p].number,String(p));}
  assert.equal(data.phase[0].at25,0);assert.equal(data.phase[0].at75,0);assert.equal(data.phase[0].at100,0);
  assert.equal(data.phase[50].at25,0);assert.equal(data.phase[50].at75,.5);assert.equal(data.phase[50].at100,1);
  assert.equal(data.phase[100].at25,.25);assert.equal(data.phase[100].at75,.75);assert.equal(data.phase[100].at100,1);
  assert.equal(data.after.visibleClass,false);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10419.32 Fade UI outside hidden compatibility grid; Fade only; 0 instant, 50 half-phase, 100 full-phase');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v10419.32 Fade UI',err.stack||err);process.exitCode=1;});
