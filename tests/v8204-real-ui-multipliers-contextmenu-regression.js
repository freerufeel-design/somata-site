'use strict';
const assert=require('assert').strict;const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:400,evalTimeoutMs:17000});try{
 const r=await h.evaluate(`(()=>{
  const btnA=document.getElementById('btnSidebarAmbient'),btnP=document.getElementById('btnSidebarPrism');
  const initialPrism=state.prism.enabled===false;
  const context=id=>document.getElementById(id).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
  context('btnSidebarPrism');const off=state.prism.enabled===true;
  context('btnSidebarPrism');const on=state.prism.enabled===false;
  const rain=document.getElementById('ambientRainEnabled');rain.checked=true;rain.dispatchEvent(new Event('change',{bubbles:true}));
  const rainOn=state.ambient.rain.enabled===true;
  context('btnSidebarAmbient');const ambientOff=state.ambient.rain.enabled===false;
  context('btnSidebarAmbient');const ambientOn=state.ambient.rain.enabled===true;
  const dm=document.getElementById('ambientRainDensityMultiplier');dm.value='4';dm.dispatchEvent(new Event('change',{bubbles:true}));
  const rm=document.getElementById('prismSizeMultiplier');rm.value='2';rm.dispatchEvent(new Event('input',{bubbles:true}));
  const changes=state.ambient.rain.densityMultiplier===4&&state.prism.sizeMultiplier===2;
  const blue=state.morph.normalizeSizes===true;
  const descendants=SomataParameterMatrix.descendants('ambient.rain.density').map(d=>d.id);
  return {initialPrism,off,on,rainOn,ambientOff,ambientOn,changes,blue,descendants,groupButtons:!!document.getElementById('audioGroupAmbient')&&!!document.getElementById('audioGroupPrism'),valueTypes:[typeof state.prism.sizeMultiplier,typeof state.ambient.rain.densityMultiplier]};
 })()`,{timeoutMs:18000,label:'8.20.4 controls and real right click'});
 for(const key of ['initialPrism','off','on','rainOn','ambientOff','ambientOn','changes','blue','groupButtons'])assert.equal(r[key],true,`${key}: ${JSON.stringify(r)}`);
 assert(r.descendants.includes('ambient.rain.densityMultiplier'));assert.deepEqual(r.valueTypes,['number','number']);
 assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS 8.20.4 REAL UI',JSON.stringify(r));
 }finally{await h.close();}})().catch(e=>{console.error('FAIL 8.20.4 REAL UI',e.stack||e);process.exit(1)});
