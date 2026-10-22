const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,m)=>{if(!v)throw Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:24000});
 try {
  const o=await h.evaluate(`(async()=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const p=window.SomataParameterCoverage,ids=[1,2,3,4,5];
   const selected=[p.select({},ids).size,p.select({layerPercent:0},ids).size,p.select({layerPercent:40},ids).size];
   document.getElementById('btnMorphSettings').click();await sleep(40);syncMorphProfileUI();
   const blue=[...document.querySelectorAll('#morphProfileBindings .morph-binding-row')];
   const missingBlue=blue.filter(x=>!x.querySelector('.morph-route-layer-percent')).map(x=>x.textContent.trim().slice(0,30));
   const blueField=blue.find(x=>x.querySelector('.morph-route-compact-picker button')?.textContent?.includes('Размер'))?.querySelector('.morph-route-layer-percent');
   if(blueField){blueField.value='0';blueField.dispatchEvent(new Event('change',{bubbles:true}));}
   const blueStored=window.SomataMorphParameterRouting.workingBindings(state.morph,state.minimalMorph).find(x=>x.parameter==='layer.radius')?.layerPercent;
   document.getElementById('btnRandomSettings').click();await sleep(40);syncOrangeMorphProfileUI();
   const orange=[...document.querySelectorAll('#orangeMorphBindings .morph-binding-row')];
   const missingOrange=orange.filter(x=>!x.querySelector('.morph-route-layer-percent')).map(x=>x.textContent.trim().slice(0,30));
   const orangeField=orange.find(x=>x.dataset.orangeParam==='geometry.N')?.querySelector('.morph-route-layer-percent');
   if(orangeField){orangeField.value='40';orangeField.dispatchEvent(new Event('change',{bubbles:true}));}
   const bindings=window.SomataOrangeMorphProfiles.workingBindings(state.minimalMorph,state.randomOptions,state.randomLayerCount);
   const orangeStored=bindings.find(b=>b.parameter==='geometry.N')?.layerPercent;
   Object.assign(state.tunnel,{active:true,colorShiftEnabled:true,colorShiftDegrees:90,colorShiftCumulative:false,paletteLagEnabled:true});
   const palette={colors:['#ff0000','#0000ff'],index:0};
   const colors=[0,.25,.5,.75,1].map(position=>getTunnelCopyColor('#ff0000',{position,copyId:0,colorIndex:0},palette));
   state.tunnel.active=false;
   return {selected,blueCount:blue.length,orangeCount:orange.length,missingBlue,missingOrange,blueStored,orangeStored,colors};
  })()`,{timeoutMs:24000,label:'V8 corridors and morph UI'});
  assert(o.selected.join(',')==='5,0,2','quota '+JSON.stringify(o));
  assert(o.blueCount>0&&o.orangeCount>0&&!o.missingBlue.length&&!o.missingOrange.length,'UI rows '+JSON.stringify(o));
  assert(o.blueStored===0&&o.orangeStored===40,'parameter persistence '+JSON.stringify(o));
  assert(o.colors[0]==='#ff0000'&&o.colors[2]==='#800080'&&o.colors[4]==='#0000ff','palette blending '+JSON.stringify(o));
  assert(!uncaughtExceptions(h.events).length,'uncaught '+uncaughtExceptions(h.events).join(' | '));
  console.log('V8 COVERAGE + CORRIDOR PASS',JSON.stringify(o));
 }finally{await h.close();}
})().catch(e=>{console.error('V8 FAIL',e.stack||e);process.exit(1)});
