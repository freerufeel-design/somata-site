'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const {read}=require('./lib/test-utils');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:45000});
 try{
  const r=await h.evaluate(`(()=>{
   const initial={
     switchPresent:!!document.getElementById('lineLayerModeControl')||document.querySelectorAll('[data-line-layer-mode]').length>0,
     paletteKeys:getPlaylistPaletteKeys(),
     record:JSON.parse(JSON.stringify(getPlaylistPaletteRecord('dichrom'))),
     stops:getPlaylistPaletteColorsAtHueOffset('dichrom',0)
   };
   // Test the actual playlist editor and all morph palette selectors.
   renderPlaylistPaletteStudio();renderPlaylistPaletteButtons();renderPaletteQuickMenu();
   const row=document.querySelector('#playlistPaletteStudioList [data-palette-key="dichrom"]');
   const paletteInBlue=[...document.querySelectorAll('#morphLinePalette select option')].some(el=>el.value==='dichrom');
   const paletteInYellow=[...document.querySelectorAll('#minimalMorphLinePalette select option')].some(el=>el.value==='dichrom');
   const quick=[...document.querySelectorAll('#paletteQuickMenu .palette-quick-item')].some(el=>el.textContent.includes('Дихром'));
   if(!row)throw new Error('Missing Dichrom editor entry');
   row.querySelector('.palette-studio-head').click();
   const edit=document.querySelector('#playlistPaletteStudioList [data-palette-key="dichrom"]');
   const sliders=[...edit.querySelectorAll('.palette-key-segment')];
   const input=sliders[1].querySelector('input[type=color]');
   input.value='#123abc';input.dispatchEvent(new Event('input',{bubbles:true}));
   const edited=[...getPlaylistPaletteRecord('dichrom').keyColors];
   const saved=JSON.parse(JSON.stringify(ensurePlaylistColorPalettes()));
   const restored=normalizePlaylistColorPalettes(saved).dichrom;
   const legacy=normalizePlaylistColorPalettes({standard:factoryPlaylistPaletteRecord('standard')}).dichrom;
   // Load a project that was explicitly saved in the retired segmented mode.
   const oldLayer={...createLayer(),id:'regression-uniform',name:'Migrated',lineLayerMode:'segmented',spiralLineType:'segmented'};
   applyLoadedProject({layers:[oldLayer],settings:{}});
   const loaded=state.layers[0];
   const normalized={lineLayerMode:loaded.lineLayerMode,spiralLineType:loaded.spiralLineType};
   // Defensive render check: an intermediate renderer must never re-read the
   // legacy mode, even if a temporary frame layer still contains that alias.
   loaded.lineLayerMode='segmented';loaded.spiralLineType='segmented';
   syncSidebarInputs();
   const synced={lineLayerMode:loaded.lineLayerMode,spiralLineType:loaded.spiralLineType};
   return {initial,paletteInBlue,paletteInYellow,quick,studio:!!row,sliders:sliders.length,edited,restored:restored.keyColors,legacy:legacy.keyColors,normalized,synced};
  })()`,{timeoutMs:45000,label:'Dichrom editor, saved palette, legacy segmented migration'});
  assert(!r.initial.switchPresent,'retired segmented toggle is still in the UI');
  assert(r.initial.paletteKeys.includes('dichrom'),'factory palette was not registered');
  assert.equal(r.initial.record.name,'Дихром');
  assert.deepEqual(r.initial.record.keyColors,['#ffffff','#00ff00','#000000']);
  assert.equal(r.initial.record.multiplier,2);
  assert.equal(r.initial.stops.length,5,'multiplier 2 should add two in-between colors');
  assert(r.paletteInBlue && r.paletteInYellow && r.quick && r.studio,'Dichrom missing from editor or morph menus');
  assert.equal(r.sliders,3);
  assert.equal(r.edited[1],'#123abc','edited color did not persist in editor record');
  assert.equal(r.restored[1],'#123abc','edited color lost during save/restore normalization');
  assert.deepEqual(r.legacy,['#ffffff','#00ff00','#000000'],'Dichrom must be added to old playlist files');
  assert.deepEqual(r.normalized,{lineLayerMode:'uniform',spiralLineType:'uniform'},'loading segmented project must migrate both aliases');
  assert.deepEqual(r.synced,{lineLayerMode:'uniform',spiralLineType:'uniform'},'active layer must remain in uniform mode');
  assert(read('js/render/main-pipeline.js').includes("frameCtx.lineLayerMode='uniform'"),'Main pipeline must not use saved segmented mode');
  assert(read('js/app/geometry-gpu-core.js').includes("function commandLineLayerMode(commands){return 'uniform';}"),'GPU command mode must be uniformly blended');
  assert.equal((read('js/gpu/spiral-bezier-morph-renderer.js').match(/const segmented=false/g)||[]).length,2,'Spiral GPU Morph passes must use uniform mode');
  assert.deepEqual(uncaughtExceptions(h.events),[],'browser exceptions');
  console.log('PASS Dichrom palette/editor/Blue/Orange/restore, migration to permanently uniform line blending:',JSON.stringify(r));
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL Dichrom/uniform line mode:',err.stack||err);process.exitCode=1;});
