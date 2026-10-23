'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:13000});
try{
 const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
 await h.evaluate(`(()=>{const el=document.createElement('style');el.id='somata-regression-styles';el.textContent=${JSON.stringify(css)};document.head.appendChild(el);})()`,{label:'load actual application styles',timeoutMs:12000});
 const r=await h.evaluate(`(()=>{
  document.getElementById('btnSidebarPrism').click();
  const root=document.getElementById('prismSettingsGroup');
  const inputs={};for(const id of ['prismSizeMultiplier','prismRefractionMultiplier','prismDispersionMultiplier']){
    const el=document.getElementById(id);el.value=id.includes('Refraction')?'9':id.includes('Size')?'24':'9';el.dispatchEvent(new Event('input',{bubbles:true}));inputs[id]=el.value;
  }
  const shape=document.getElementById('prismShape');const startShape=shape.value;
  document.getElementById('prismNextShape').click();const next=shape.value;
  document.getElementById('prismPrevShape').click();const back=shape.value;
  const refl=document.getElementById('prismRefraction');const opaque=document.getElementById('prismOpacity');
  const shapeRow=document.getElementById('prismShapeRow');const mode=document.querySelector('#prismSettingsGroup .prism-mode-switch');
  const first=root.querySelector('.somata-effect-control');
  const style=getComputedStyle(first);
  const rows=[...root.querySelectorAll('.somata-effect-control')].map(el=>({id:el.querySelector('input[type=range]')?.id||'',height:Math.round(el.getBoundingClientRect().height),margin:style.margin}));
  return {refractionMax:refl.max,shapeTop:shapeRow.compareDocumentPosition(mode)&Node.DOCUMENT_POSITION_FOLLOWING,diagnosticHidden:getComputedStyle(document.getElementById('prism3dLiveStatus')).display==='none',backendHidden:getComputedStyle(document.getElementById('prism3dBackendInfo')).display==='none',inputs,state:{sizeMultiplier:state.prism.sizeMultiplier,refractionMultiplier:state.prism.refractionMultiplier,dispersionMultiplier:state.prism.dispersionMultiplier,glint:state.layers[0]?.sweep?.lengthPercent??state.sweep?.lengthPercent},startShape,next,back,rootCount:rows.length,rows,maxHeight:Math.max(...rows.map(r=>r.height)),hasDeadOpacityMultiplier:!!document.getElementById('prismOpacityMultiplier'),opacityBase:opaque.max};
 })()`,{label:'8.20.12 real UI semantics',timeoutMs:14000});
 assert.equal(r.refractionMax,'16');assert(r.shapeTop);
 assert(r.diagnosticHidden&&r.backendHidden);
 assert.equal(r.startShape,'sphere');assert.equal(r.next,'lens');assert.equal(r.back,'sphere');
 assert.deepEqual(r.inputs,{prismSizeMultiplier:'24',prismRefractionMultiplier:'9',prismDispersionMultiplier:'9'});
 assert.equal(r.state.sizeMultiplier,24);assert.equal(r.state.refractionMultiplier,9);assert.equal(r.state.dispersionMultiplier,9);
 assert.equal(r.hasDeadOpacityMultiplier,false);assert.equal(r.opacityBase,'100');
 assert(r.maxHeight>0&&r.maxHeight<=65,'compact form: visible row height must be 1..65px, got '+r.maxHeight);
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 8.20.12 Chromium UI actual multipliers >8, no diagnostics, compact rows, shape navigation',JSON.stringify({rows:r.rootCount,maxHeight:r.maxHeight,defaultGlint:r.state.glint}));
}finally{await h.close();}})().catch(err=>{console.error('FAIL 8.20.12 browser UI:',err.stack||err);process.exitCode=1;});
