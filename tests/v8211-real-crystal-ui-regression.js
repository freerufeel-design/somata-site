'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:280,evalTimeoutMs:12000});
try{
 const r=await h.evaluate(`(()=>{
  const shape=document.getElementById('prismShape');
  const initial=shape.value;
  document.getElementById('prismNextShape').click();const next=shape.value;
  document.getElementById('prismPrevShape').click();const back=shape.value;
  const ranges=['prismLightHue','prismLightIntensity','prismFillHue','prismFill'];
  for(const id of ranges){const el=document.getElementById(id);el.value='72';el.dispatchEvent(new Event('input',{bubbles:true}));}
  const m=document.getElementById('prismRefractionMultiplier');m.value='2';m.dispatchEvent(new Event('change',{bubbles:true}));
  const label=document.getElementById('prismFillText')?.textContent;
  const routes=ranges.map(id=>SomataParameterMatrix.get('prism.'+id.slice(5,6).toLowerCase()+id.slice(6))?.id);
  return {initial,next,back,label,routes,values:[state.prism.lightHue,state.prism.lightIntensity,state.prism.fillHue,state.prism.fill,state.prism.refractionMultiplier],
  prismReady:!!window.SomataAmbientPrism,sceneUnchanged:state.layers.length};
 })()`,{label:'8.20.11 interactive crystal UI',timeoutMs:14000});
 assert.equal(r.initial,'sphere');assert.equal(r.next,'lens');assert.equal(r.back,'sphere');
 assert.equal(r.label,'72');assert.deepEqual(r.values,[72,72,72,72,2]);
 assert.deepEqual(r.routes,['prism.lightHue','prism.lightIntensity','prism.fillHue','prism.fill']);
 assert(r.prismReady);assert.equal(r.sceneUnchanged,1);
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 8.20.11 real Chromium shape arrows, routed palette & fill, log numeric inputs',JSON.stringify(r));
}finally{await h.close();}})().catch(err=>{console.error('FAIL real crystal UI',err.stack||err);process.exitCode=1;});
