'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{
 const b=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:7000});
 try{
  const r=await b.evaluate(`(()=>{
   const button3=document.querySelector('[data-prism-mode="3d"]'),button2=document.querySelector('[data-prism-mode="2d"]');
   const start={enabled:state.prism.enabled,mode:state.prism.mode,shape:state.prism.shape,checked:document.getElementById('prismEnabled').checked};
   document.getElementById('btnSidebarPrism').click();
   button3.click();
   const in3={mode:state.prism.mode,pressed:button3.getAttribute('aria-pressed'),spriteHidden:document.getElementById('prism2dControls').hidden};
   // On unsupported GPU, preserve the chosen 3D mode instead of drawing 2D.
   document.getElementById('prismEnabled').click();
   SomataAmbientPrism.render(performance.now());
   const unsupported={mode:state.prism.mode,spriteDisplay:document.getElementById('prismOverlayCanvas').style.display};
   document.getElementById('prismEnabled').click();button2.click();
   const back={mode:state.prism.mode,pressed:button2.getAttribute('aria-pressed'),spriteHidden:document.getElementById('prism2dControls').hidden};
   return {start,in3,unsupported,back};
  })()`);
  assert.equal(r.start.enabled,false);assert.equal(r.start.mode,'3d');assert.equal(r.start.checked,false);assert.equal(r.start.shape,'sphere');
  assert.deepEqual(r.in3,{mode:'3d',pressed:'true',spriteHidden:true});
  assert.deepEqual(r.unsupported,{mode:'3d',spriteDisplay:'none'});
  assert.deepEqual(r.back,{mode:'2d',pressed:'true',spriteHidden:false});
  assert.deepEqual(uncaughtExceptions(b.events),[]);
  console.log('PASS 8.20.5 browser',JSON.stringify(r));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1)});
