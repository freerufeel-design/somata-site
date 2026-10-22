const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:40000});
 try{
  const data=await h.evaluate(`(async()=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   const matrix=window.SomataParameterMatrix;
   const steps={sweep:matrix.stepFor('sweep.length'),fill:matrix.stepFor('layer.fillOpacity'),angle:matrix.stepFor('layer.rotation'),mult:matrix.stepFor('lamps.radiusMultiplier')};
   // Enable a real Orange effect route, not a direct layer edit.
   const source=state.layers[0];source.showLamps=true;
   ensureLayerEffectState(source);ensureLayerLampState(source).radius=89;
   const added=window.SomataOrangeParameterRoutingUI.setActive('lamps.radius',true);
   const rangeSet=window.SomataOrangeMorphProfiles.setRange(state.minimalMorph,state.randomOptions,state.randomLayerCount,'lamps.radius',17,17);
   const chosen=getOrangeMorphBindings().find(b=>b.parameter==='lamps.radius');
   const instant=document.getElementById('minimalMorphInstant');instant.checked=true;instant.dispatchEvent(new Event('change',{bubbles:true}));state.minimalMorph.instantSwitch=true;
   const original=state.layers[0].id;
   document.getElementById('btnMinimalMorph').click();await wait(320);
   const live=state.layers[0];
   const during={id:live?.id,radius:live?.lamps?.radius,added,rangeSet,chosen,orange:runtimeState.minimalMorph.active};
   document.getElementById('btnMinimalMorph').click();await wait(100);
   const instantStop={id:state.layers[0].id,active:runtimeState.minimalMorph.active,radius:state.layers[0].lamps?.radius};
   // Fade stop while target has not committed should leave its last committed source.
   instant.checked=false;instant.dispatchEvent(new Event('change',{bubbles:true}));state.minimalMorph.instantSwitch=false;state.minimalMorph.fadeSec=30;const fadeInput=document.getElementById('minimalMorphFade');fadeInput.value='30';fadeInput.dispatchEvent(new Event('change',{bubbles:true}));
   const fadeStart=state.layers[0].id;
   document.getElementById('btnMinimalMorph').click();await wait(300);
   const fadeInProgress=runtimeState.minimalMorph.transitioning;
   document.getElementById('btnMinimalMorph').click();await wait(70);
   const fadeStop={id:state.layers[0].id,active:runtimeState.minimalMorph.active,started:fadeStart,wasTransitioning:fadeInProgress};
   state.tunnel.active=true;state.tunnel.colorShiftEnabled=false;state.tunnel.paletteLagEnabled=true;state.tunnel.colorShiftCumulative=false;
   const lagActive=tunnelColorShiftIsActive(),palette={index:0,colors:['#ff0000','#00ff00','#0000ff']};
   const copies=[{copyId:0,colorIndex:0},{copyId:1,colorIndex:1},{copyId:2,colorIndex:2},{copyId:3,colorIndex:3}];
   const shifted=copies.map(c=>getTunnelCopyColor('#ff000080',c,palette));
   // Explicit Fixed Colors restores the original static-like palette cycle 0,1,2,0,1,2,0,1.
   state.tunnel.active=false;
   state.randomOptions.lineColorPalette='rgb';state.randomOptions.cyclePalettes=false;state.randomOptions.fixedColors=true;
   window.SomataOrangeParameterRoutingUI.setActive('layer.strokeColor',true);
   state.randomLayerCount=8;document.getElementById('randomLayerCount').value='8';
   const rgb=getPlaylistPaletteColors('rgb').map(x=>String(x).toLowerCase());
   document.getElementById('btnRandomPreset').click();await wait(40);
   const layerColors=state.layers.map(l=>String(l.strokeColor||'').toLowerCase());
   const all=matrix.all();
   return {steps,during,instantStop,original,fadeStop,lagActive,shifted,rgb,layerColors,matrixCount:all.length};
  })()`,{timeoutMs:40000,label:'Orange sampled effect, instant/fade stop, palette lag without cumulative'});
  assert(data.during.added&&data.during.rangeSet&&data.during.chosen,'Cannot enable Orange effect route: '+JSON.stringify(data.during));
  assert(data.during.radius===17,'Orange lamps.radius sample overwritten by source effect: '+JSON.stringify(data.during));
  assert(data.during.id!==data.original,'Orange did not regenerate composition');
  assert(data.instantStop.id===data.during.id&&!data.instantStop.active,'Instant stop restored old composition: '+JSON.stringify(data.instantStop));
  assert(data.fadeStop.wasTransitioning&&data.fadeStop.id===data.fadeStop.started&&!data.fadeStop.active,'Incomplete Fade did not preserve last committed scene: '+JSON.stringify(data.fadeStop));
  assert(data.steps.sweep.step===1&&data.steps.fill.step===1&&data.steps.mult.mode==='logarithmic','Shared step policy incorrect: '+JSON.stringify(data.steps));
  assert(data.lagActive&&data.shifted.join('|')==='#ff000080|#00ff0080|#0000ff80|#ff000080','Noncumulative palette lag or opacity incorrect: '+JSON.stringify(data.shifted));
  assert(data.rgb.length===3&&data.layerColors.length===8&&data.layerColors.every((color,i)=>color===data.rgb[i%3]),'Orange palette did not wrap over three colours: '+JSON.stringify({rgb:data.rgb,colors:data.layerColors}));
  assert(data.matrixCount===85,'Shared matrix count changed: '+data.matrixCount);
  const errors=uncaughtExceptions(h.events);assert(!errors.length,'Uncaught errors '+errors.slice(0,3).join(' | '));
  console.log('7.11.16 ORANGE ROUTING / STEP / STOP / CORRIDOR LAG: PASS',data);
 }finally{await h.close()}
})().catch(e=>{console.error('7.11.16 ORANGE ROUTING / STEP / STOP / CORRIDOR LAG: FAIL',e.stack||e);process.exit(1)});
