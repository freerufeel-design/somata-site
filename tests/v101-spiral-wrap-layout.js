'use strict';
const assert=require('node:assert/strict'),fs=require('fs');
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100});
 try{
   const css=fs.readFileSync('styles/app.css','utf8');
   const result=await h.evaluate(`(()=>{
    const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.appendChild(style);
    const panel=document.getElementById('morphSettingsPanel');panel?.classList.remove('hidden');
    const bindings=document.getElementById('morphProfileBindings');bindings?.classList.remove('hidden');
    state.morph.options.bySpiralLayers=true;state.morph.options.bySpiralOrder=true;renderMorphProfileBindings();
    const row=bindings.querySelector('[data-morph-special="spiralLayers"]');
    if(!row)return {error:'no row'};
    // Test a realistic narrow dialog: internal controls must wrap rather than overlap.
    bindings.style.width='620px';bindings.style.maxWidth='620px';
    row.style.width='620px';
    const groups=[...row.querySelectorAll('.morph-spiral-compact-range')];
    const order=bindings.querySelector('[data-morph-special="spiralOrder"]');
    const orderGroups=[...(order?.querySelectorAll('.morph-spiral-compact-range')||[])];
    const rects=groups.map(el=>{let r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
    const clash=rects.some((a,i)=>rects.slice(i+1).some(b=>a.x<b.x+b.width-1&&b.x<a.x+a.width-1&&a.y<b.y+b.height-1&&b.y<a.y+a.height-1));
    const rect=row.getBoundingClientRect();
    return {count:groups.length,orderCount:orderGroups.length,clash,rects,rowWidth:rect.width,wrap:getComputedStyle(row).flexWrap};
   })()`,{timeoutMs:12000});
   assert(!result.error,JSON.stringify(result));
   assert.equal(result.count,2,'Spiral Layers: count and tangentiality');
   assert.equal(result.orderCount,1,'Separate Spiral Order has only its own range');
   assert.equal(result.clash,false,'spiral controls must never overlap');
   assert.equal(result.wrap,'wrap');
   console.log('PASS spiral configuration wrap, 620px dialog',result);
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
