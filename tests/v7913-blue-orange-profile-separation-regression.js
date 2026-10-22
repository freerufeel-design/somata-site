const fs=require('fs');const path=require('path');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
 const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),css=fs.readFileSync(path.join(ROOT,'styles/app.css'),'utf8');
 assert(/btnNewMorphProfile[\s\S]*?<svg/.test(html)&&/btnSaveMorphProfile[\s\S]*?<svg/.test(html),'Blue page/diskette icons missing');
 assert(/btnNewOrangeMorphProfile[\s\S]*?<svg/.test(html)&&/btnSaveOrangeMorphProfile[\s\S]*?<svg/.test(html),'Orange page/diskette icons missing');
 assert(html.indexOf('id="btnRandomPreset"')>html.indexOf('class="random-nav"') && html.indexOf('id="btnRandomPreset"')<html.indexOf('id="randomSettingsPanel"'),'orange composition button is not on the main random-nav before Orange settings');
 assert(css.includes('morph-order-mode-prominent')&&css.includes('orange-routing-groups'),'visible order / Orange routing styles missing');
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000});const base=uncaughtExceptions(h.events).length;
 try{
  const r=await h.evaluate(`(async()=>{
   const blue=window.SomataMorphParameterRouting,orange=window.SomataOrangeMorphProfiles;
   blue.ensureProfiles(state.morph,state.minimalMorph);orange.ensureProfiles(state.minimalMorph,state.randomOptions,state.randomLayerCount);
   document.getElementById('btnMorphSettings')?.click();await new Promise(r=>setTimeout(r,25));syncMorphProfileUI();
   document.getElementById('btnRandomSettings')?.click();await new Promise(r=>setTimeout(r,25));syncRandomSettingsUI();syncOrangeMorphProfileUI();
   const registryGroups=window.SomataParameterRegistry.sharedRoutingGroups();
   const orangeGroups=[...document.querySelectorAll('#orangeMorphRoutingGroups .audio-route-group-btn')].map(b=>b.dataset.orangeGroup);
   const blueGeom=[...document.querySelectorAll('#morphRoutingGroups .audio-param-option')];
   const geomDefs=window.SomataParameterRegistry.sharedRoutingDefinitions().filter(d=>(d.morph?.group||d.group)==='Геометрия').map(d=>[d.id,d.label]);
   const legacyLeft={size:!!document.querySelector('.morph-sidebar-section #morphBySize'),vertices:!!document.querySelector('.morph-sidebar-section #morphByVertices'),steps:!!document.querySelector('.morph-sidebar-section #morphBySteps')};
   const initial={blueTypes:(state.morph.profiles||[]).map(p=>p.type),orangeProfiles:(state.minimalMorph.profiles||[]).map(p=>[p.id,p.name]),orangeGroupsComplete:registryGroups.every(g=>orangeGroups.includes(g)),legacyLeft,geomDefs,orderVisible:!!document.querySelector('#morphParameterRoutingPanel .morph-order-mode-prominent')};
   const oldPrompt=window.prompt;let promptCalls=0;window.prompt=()=>{promptCalls++;return 'Orange Test';};document.getElementById('btnNewOrangeMorphProfile')?.click();await new Promise(r=>setTimeout(r,10));
   const created=orange.activeProfile(state.minimalMorph,state.randomOptions,state.randomLayerCount);const transientAtCreate=created?.transient===true,promptCallsAfterCreate=promptCalls,blueCount=(state.morph.profiles||[]).length,orangeCount=(state.minimalMorph.profiles||[]).length;
   const bySize=document.getElementById('randomBySize');bySize.checked=!bySize.checked;bySize.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,5));
   const dirty=orange.isDirty(state.minimalMorph,state.randomOptions,state.randomLayerCount);const projectBefore=buildProjectData();const savedBefore=projectBefore.settings.minimalMorph.profiles.find(p=>p.id===created.id)?.config?.randomOptions?.bySize;
   document.getElementById('btnSaveOrangeMorphProfile')?.click();await new Promise(r=>setTimeout(r,5));window.prompt=oldPrompt;const clean=!orange.isDirty(state.minimalMorph,state.randomOptions,state.randomLayerCount);const projectAfter=buildProjectData();const savedAfter=projectAfter.settings.minimalMorph.profiles.find(p=>p.id===created.id)?.config?.randomOptions?.bySize;
   // actual drag using the handle in Free mode on Blue Standard
   blue.selectProfile(state.morph,state.minimalMorph,'standard');document.getElementById('btnMorphSettings')?.click();await new Promise(r=>setTimeout(r,15));syncMorphProfileUI();document.getElementById('btnMorphOrderFree')?.click();await new Promise(r=>setTimeout(r,5));
   const before=[...document.querySelectorAll('#morphProfileBindings .morph-binding-row[data-morph-parameter]')].map(x=>x.dataset.morphParameter);let dragged=false;
   if(before.length>1){const rows=[...document.querySelectorAll('#morphProfileBindings .morph-binding-row[data-morph-parameter]')],hnd=rows[0].querySelector('.morph-route-drag-handle'),target=rows[1],dt=new DataTransfer();hnd.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt,clientY:target.getBoundingClientRect().bottom-1}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,clientY:target.getBoundingClientRect().bottom-1}));hnd.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));await new Promise(r=>setTimeout(r,5));const after=[...document.querySelectorAll('#morphProfileBindings .morph-binding-row[data-morph-parameter]')].map(x=>x.dataset.morphParameter);dragged=JSON.stringify(before)!==JSON.stringify(after);}
   return{initial,created:{id:created.id,name:created.name,transientAtCreate,promptCallsAfterCreate,promptCallsAfterSave:promptCalls,blueCount,orangeCount,dirty,clean,savedBefore,savedAfter,currentBySize:state.randomOptions.bySize},dragged};
  })()`,{timeoutMs:18000,label:'7.9.13 Blue Orange profile separation'});
  assert(r.initial.blueTypes.every(t=>t==='standard'),'Orange profile still lives in Blue profile list');
  assert(r.initial.orangeProfiles.some(x=>x[0]==='orange-standard'),'Orange system profile missing');
  assert(r.initial.orangeGroupsComplete,'Orange group vocabulary lost registry groups');
  assert(!r.initial.legacyLeft.size&&!r.initial.legacyLeft.vertices&&!r.initial.legacyLeft.steps,'Size/N/K legacy controls still visible in left sidebar');
  for(const [id,labels] of [['geometry.N',['Вершины · N','Количество вершин N']],['geometry.K',['Шаг · K','Шаг соединения K']],['layer.radius',['Размер']]])assert(r.initial.geomDefs.some(x=>x[0]===id&&labels.includes(x[1])),'Blue Geometry row missing '+id);
  assert(r.initial.orderVisible,'Blue order control not visible');
  assert(r.created.orangeCount>=2&&r.created.blueCount>=1&&r.created.transientAtCreate&&r.created.promptCallsAfterCreate===0&&r.created.promptCallsAfterSave===1&&r.created.name==='Orange Test'&&r.created.dirty&&r.created.clean,'Orange profile transient create/save lifecycle failed');
  assert(r.created.savedBefore!==r.created.currentBySize&&r.created.savedAfter===r.created.currentBySize,'Orange draft leaked before Save or failed to persist after Save');
  assert(r.dragged,'Blue row did not reorder by actual drag handle');
  const errs=uncaughtExceptions(h.events).slice(base);assert(!errs.length,'uncaught: '+errs.join(' | '));console.log('7.9.13 BLUE/ORANGE PROFILE SEPARATION REGRESSION: PASS',r);
 }finally{await h.close()}
}
main().catch(e=>{console.error('FAIL 7.9.13:',e.stack||e.message);process.exit(1)});
