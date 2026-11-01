// Verifies the single algorithm UI, import migration, radius policy and live Morph slider.
'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:40000});try{
 const result=await h.evaluate(`(()=>{
  const absent=['[data-rounding-shape]','#paramRoundingShape','#paramRoundingSplineSubdivisions','#paramFastFilletSweep','#paramRoundingMaxRadiusDrop','#paramRoundingSmoothSplines'].map(q=>[q,!!document.querySelector(q)]);
  const label=document.querySelector('#roundingContainer')?.textContent||'';
  const policy=Array.from(document.querySelectorAll('.rounding-mode-btn')).map(e=>e.dataset.roundingMode);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const original=clone(state.layers[0]);
  const legacy=clone(original);legacy.roundingShape='contour';legacy.rounding=150;
  // The two official file import paths must migrate both old algorithms.
  applyShapeFile({format:'SpiroStarShapes',layers:[legacy]});
  const shapeMode=state.layers[0].roundingShape;
  const payload=buildProjectData();payload.layers[0].roundingShape='spline';
  applyLoadedProject(payload,{preserveFullMorph:false,preserveMinimalMorph:false,applyProjectDefaultModes:false});
  const projectMode=state.layers[0].roundingShape;
  const layer=state.layers[0],idx=0,slider=document.getElementById('paramRounding');
  if(!runtimeState.morph.active)document.getElementById('btnMorph').click();
  const rt=runtimeState.morph,start=rt.cycleStart,rows=[];
  for(const amount of [25,50,100,150,200]){
   slider.value=String(amount);slider.dispatchEvent(new Event('input',{bubbles:true}));
   rows.push({amount,now:layer.rounding,src:rt.renderSourceLayers?.[idx]?.rounding,dst:rt.renderTargetLayers?.[idx]?.rounding,cycle:rt.cycleStart});
  }
  return {absent,labelIncludesSplinePlus:label.includes('Spline+'),policy,shapeMode,projectMode,rows,start,morphActive:rt.active};
 })()`,{label:'single Spline+ UI and legacy import',timeoutMs:40000});
 console.log('ONE_SPLINE_PLUS',JSON.stringify(result));
 assert(result.absent.every(([,present])=>present===false),'retired options still visible');
 assert(result.labelIncludesSplinePlus);
 assert.deepEqual(result.policy,['standard','monoradius']);
 assert.equal(result.shapeMode,'hybrid');assert.equal(result.projectMode,'hybrid');
 assert(result.morphActive);
 for(const x of result.rows){assert.equal(x.now,x.amount);assert.equal(x.src,x.amount);assert.equal(x.dst,x.amount);assert.equal(x.cycle,result.start);}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS only Spline+ UI, legacy shape/project migration, live Morph parameter continuity');
 }finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
