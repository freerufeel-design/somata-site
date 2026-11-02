'use strict';
const assert=require('node:assert/strict');
const {read}=require('./lib/test-utils');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');

(async()=>{
  const h=await createBrowserHarness({loadDelayMs:160,evalTimeoutMs:12000});
  try{
    // The normal browser harness skips stylesheets. Load the shipped CSS to
    // assert the real visible/interactive layout as well as the DOM state.
    const before=await h.evaluate(`(()=>{
      const style=document.createElement('style');style.textContent=${JSON.stringify(read('styles/app.css'))};document.head.appendChild(style);
      // Present the exact existing playlist hue row at a known viewport position.
      const row=document.querySelector('.playlist-global-hue-control');
      row.style.cssText='position:fixed;left:30px;top:50px;width:390px;height:70px;z-index:20000;background:#0f172a';
      document.body.appendChild(row);
      document.getElementById('btnMorphSettings')?.click();
      document.getElementById('btnAddMorphParameter')?.click();
      const search=document.getElementById('morphParameterSearch');
      search.value='Общее смещение цвета';search.dispatchEvent(new Event('input',{bubbles:true}));
      const option=[...document.querySelectorAll('#morphParameterOptions .morph-param-option')].find(e=>e.textContent.includes('Общее смещение цвета'));
      if(!option)throw new Error('Cannot find Hue in Blue Morph parameter picker');
      option.click();
      const base=document.getElementById('playlistPaletteHueOffset'),host=base.closest('.generic-morph-range-host'),range=[...host.querySelectorAll('.blue-morph-dual')];
      const rect=host.getBoundingClientRect(),b=range[1],hi=Number(b.value),max=Number(b.max),min=Number(b.min);
      const thumbX=rect.left+5+((hi-min)/(max-min))*(rect.width-10);
      const y=rect.top+rect.height/2;
      const info=()=>({active:runtimeState.morph.active,live:host.classList.contains('morph-live'),mode:host.dataset.sliderMode,
        originalHidden:base.getAttribute('aria-hidden'),currentVisibility:getComputedStyle(base).visibility,
        range:range.map(e=>({value:Number(e.value),disabled:e.disabled,display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility})),
        binding:{...window.SomataMorphParameterRouting.workingBindings(state.morph,state.minimalMorph).find(e=>e.parameter==='palette.hueOffset')}});
      window.__hueIdleProbe={info,host};return {state:info(),hit:document.elementFromPoint(thumbX,y)?.className,thumbX,y};
    })()`,{timeoutMs:12000});
    assert.equal(before.state.active,false,'This regression must run with Morph stopped');
    assert.equal(before.state.live,true,'Blue hue interval must show immediately after being added');
    assert.equal(before.state.mode,'morph-range');
    assert.equal(before.state.originalHidden,'true');
    assert.equal(before.state.currentVisibility,'hidden');
    assert(before.state.range.every(i=>!i.disabled&&i.display==='block'&&i.visibility==='visible'),'The blue pair must be visible and enabled');
    assert(String(before.hit).includes('blue-morph-dual-max'),'Upper blue thumb is not hit-testable');
    // Real mouse drag on the high thumb, not a programmatic input event.
    const x=before.thumbX,y=before.y;
    const mouse=async(type,x,y,extra={})=>h.call('Input.dispatchMouseEvent',{type,x,y,button:'left',...extra});
    await mouse('mouseMoved',x,y);
    await mouse('mousePressed',x,y,{clickCount:1});
    await mouse('mouseMoved',x+60,y,{buttons:1});
    await mouse('mouseReleased',x+60,y,{clickCount:1});
    const after=await h.evaluate(`(()=>{const v=window.__hueIdleProbe.info();window.SomataMorphParameterRoutingUI.setActive('palette.hueOffset',false);const stopped=window.__hueIdleProbe.info();return{dragged:v,disabled:stopped}})()`);
    assert(after.dragged.binding.max>before.state.binding.max+25,'Dragging blue max thumb did not update Morph range');
    assert.equal(after.dragged.binding.min,before.state.binding.min,'Drag should not change blue minimum');
    assert.equal(after.disabled.live,false,'Turning route off should restore single slider');
    assert.equal(after.disabled.originalHidden,null,'Original slider should be accessible again');
    assert(after.disabled.range.every(i=>i.disabled),'Inactive Morph thumbs should be disabled');
    assert.deepEqual(uncaughtExceptions(h.events),[],'Unexpected browser exception');
    console.log('PASS Blue hue idle slider: picker addition, CSS-visible dual thumbs, pointer drag, route disabled restoration',JSON.stringify({before:before.state,after}));
  } finally {await h.close();}
})().catch(e=>{console.error('FAIL Blue hue idle slider:',e.stack||e);process.exitCode=1;});
