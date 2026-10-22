// Somata 8.19.2: Blue/Orange palette allocation, UI routing and palette authority.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(value,message)=>{if(!value)throw Error(message)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:20000});
 try{
  const result=await h.evaluate(`(()=>{
   const palette='standard',raw=getPlaylistPaletteColors(palette),n=new Set(raw.map(v=>v.toLowerCase())).size;
   if(n<3)throw Error('Test palette too short');
   const ordered=selectMorphLayerPaletteColors(palette,2*n+2,{fixed:true});
   const shuffled=Array.from({length:12},()=>selectMorphLayerPaletteColors(palette,2*n+2,{fixed:false}));
   const noRepeats=shuffled.every(colors=>new Set(colors.slice(0,n)).size===n && new Set(colors.slice(n,2*n)).size===n);
   const randomOrder=shuffled.some(colors=>colors.slice(0,n).some((c,i)=>c!==raw[i]));
   const contiguous=shuffled.every(colors=>colors[n-1]!==colors[n]);
   const noNovelColors=shuffled.every(colors=>colors.every(c=>raw.includes(c)));
   const fixedOrder=ordered.every((c,i)=>c===raw[i%n]);
   const defaults={blueFixed:state.morph.fixedColors===true,orangeFixed:state.randomOptions.fixedColors===true,sync:morphPaletteSyncEnabled()};
   const layout=window.SomataParameterMatrix?.rowLayout?.('layer.strokeColor');
   const matrixHasControls=layout?.widgets?.includes('Фиксированные цвета')&&layout?.widgets?.includes('Синхронизировать между морфингами');
   const bluePanel=document.getElementById('morphSettingsPanel'),wasBlueHidden=bluePanel?.classList.contains('hidden');
   bluePanel?.classList.remove('hidden');renderMorphProfileBindings();
   const blueMatrix=Array.from(document.querySelectorAll('#morphProfileBindings .morph-route-inline-check')).map(n=>n.textContent.trim());
   const orangeMatrix=Array.from(document.querySelectorAll('#orangeMorphBindings .morph-route-inline-check')).map(n=>n.textContent.trim());
   if(wasBlueHidden)bluePanel.classList.add('hidden');
   const matrixUI=blueMatrix.includes('Фиксированные цвета')&&blueMatrix.includes('Синхронизировать между морфингами')&&orangeMatrix.includes('Фиксированные цвета')&&orangeMatrix.includes('Синхронизировать между морфингами');
   const old={blue:state.morph.lineColorPalette,orange:state.randomOptions.lineColorPalette,sync:state.morph.syncPalettesBetweenMorphs,orangeActive:runtimeState.minimalMorph.active,cycle:state.morph.cyclePalettes,fixed:state.morph.fixedColors,orangeFixed:state.randomOptions.fixedColors};
   let selectionBlue,selectionOrange,independent,orangePriority,syncedFlag,mirrorUI,profileValues;
   try{
     chooseMorphPaletteInUI('blue','pastel');selectionBlue=state.morph.lineColorPalette==='pastel'&&state.randomOptions.lineColorPalette==='pastel';
     chooseMorphPaletteInUI('yellow','acid');selectionOrange=state.morph.lineColorPalette==='acid'&&state.randomOptions.lineColorPalette==='acid';
     const disabled=document.getElementById('morphSyncPalettes');disabled.checked=false;disabled.dispatchEvent(new Event('change',{bubbles:true}));
     chooseMorphPaletteInUI('blue','fire');independent=state.morph.lineColorPalette==='fire'&&state.randomOptions.lineColorPalette==='acid';
     const enabled=document.getElementById('randomSyncPalettes');enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));
     syncedFlag=state.morph.lineColorPalette===state.randomOptions.lineColorPalette&&state.morph.syncPalettesBetweenMorphs===true;
     state.morph.cyclePalettes=true;
     runtimeState.minimalMorph.active=true;
     state.randomOptions.lineColorPalette='ice';state.morph.lineColorPalette='pastel';
     cyclePlaylistPaletteForContext('blue');
     orangePriority=state.morph.lineColorPalette==='ice'&&state.randomOptions.lineColorPalette==='ice';
     runtimeState.minimalMorph.active=false;
     const blueFixed=document.getElementById('morphFixedColors');blueFixed.checked=true;blueFixed.dispatchEvent(new Event('change',{bubbles:true}));
     const orangeFixed=document.getElementById('randomFixedColors');orangeFixed.checked=true;orangeFixed.dispatchEvent(new Event('change',{bubbles:true}));
     mirrorUI=state.morph.fixedColors===true&&state.randomOptions.fixedColors===true&&document.getElementById('morphSyncPalettes').checked===true&&document.getElementById('randomSyncPalettes').checked===true;
     profileValues=window.SomataMorphParameterRouting.captureStandardConfig(state.morph).fixedColors===true&&state.randomOptions.fixedColors===true;
   }finally{
     runtimeState.minimalMorph.active=old.orangeActive;state.morph.lineColorPalette=old.blue;state.randomOptions.lineColorPalette=old.orange;state.morph.syncPalettesBetweenMorphs=old.sync;state.morph.cyclePalettes=old.cycle;state.morph.fixedColors=old.fixed;state.randomOptions.fixedColors=old.orangeFixed;
     syncMorphSettingsUI();syncRandomSettingsUI();
   }
   return {palette,n,noRepeats,randomOrder,contiguous,noNovelColors,fixedOrder,defaults,matrixHasControls,matrixUI,selectionBlue,selectionOrange,independent,syncedFlag,orangePriority,mirrorUI,profileValues};
  })()`,{timeoutMs:18000,label:'morph palette allocation and synchronization'});
  for(const [k,v] of Object.entries(result))if(['noRepeats','randomOrder','contiguous','noNovelColors','fixedOrder','matrixHasControls','matrixUI','selectionBlue','selectionOrange','independent','syncedFlag','orangePriority','mirrorUI','profileValues'].includes(k))assert(v,`${k} failed: ${JSON.stringify(result)}`);
  assert(result.defaults.blueFixed===false&&result.defaults.orangeFixed===false&&result.defaults.sync===true,'Wrong new-project palette defaults');
  assert(uncaughtExceptions(h.events).length===0,'Uncaught browser exceptions: '+uncaughtExceptions(h.events).join(' | '));
  console.log('V8192 MORPH PALETTE RANDOM/FIXED/SYNC: PASS',JSON.stringify(result));
 }finally{await h.close();}
})().catch(err=>{console.error('V8192 MORPH PALETTE RANDOM/FIXED/SYNC: FAIL',err.stack||err);process.exitCode=1});
