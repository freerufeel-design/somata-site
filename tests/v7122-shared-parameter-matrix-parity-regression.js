const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:25000});
 try{
  const result=await h.evaluate(`(async()=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   document.getElementById('btnMorphSettings')?.click();await sleep(25);syncMorphProfileUI();
   document.getElementById('btnRandomSettings')?.click();await sleep(25);syncOrangeMorphProfileUI();
   if(document.getElementById('audioRoutingPanel')?.classList.contains('hidden'))document.getElementById('btnAudioRouting')?.click();await sleep(25);
   const matrix=window.SomataParameterMatrix,expected=matrix.all().map(d=>d.id);
   const audioKeys=new Set([...SomataParameterRegistry.audioDefinitions(),...matrix.audioDefinitions(),...(SomataParameterRegistry.audioCompatibilityDefinitions?.()||[])].map(d=>d.key));
   const expectedAudio=[];for(const root of matrix.all()){if(audioKeys.has(root.id))expectedAudio.push(root.id);for(const child of matrix.descendants(root.id))if(audioKeys.has(child.id))expectedAudio.push(child.id);}
   const groups=matrix.groups(),observed={blue:[],orange:[],audio:[]};
   const collect=(root,attr)=>{
    let pairs=[];
    for(const group of groups){
      const b=[...document.querySelectorAll(root+' .audio-route-group-btn')].find(el=>(el.dataset[attr]||el.textContent).includes(group));
      if(!b)continue;
      b.click();
      const popup=document.querySelector((root==='#morphRoutingGroups'?'.audio-route-group-menu[data-morph-routing-group-menu="1"]:not(.hidden)': '.audio-route-group-menu[data-orange-routing-group-menu="1"]:not(.hidden)'));
      pairs.push(...[...(popup?.querySelectorAll('.audio-param-option')||[])].map(el=>el.dataset.parameterId));
    }
    return pairs.filter(Boolean);
   };
   observed.blue=collect('#morphRoutingGroups','morphRoutingGroup');
   observed.orange=collect('#orangeMorphRoutingGroups','orangeGroup');
   const audioRoot=document.getElementById('audioRoutingPanel');
   for(const group of groups){
    const b=[...audioRoot.querySelectorAll('.audio-routing-tools .audio-route-group-btn')].find(el=>el.textContent.includes(group));
    if(!b)continue;
    b.click();const m=document.getElementById(b.id+'Menu')||document.querySelector('#'+({Геометрия:'audioGroupGeometryMenu',Линия:'audioGroupLineMenu',Граффити:'audioGroupGraffitiMenu',Спирали:'audioGroupSpiralMenu'}[group]||''));
    const menu=m||b.closest('.audio-route-group')?.querySelector('.audio-route-group-menu');
    observed.audio.push(...[...(menu?.querySelectorAll('.audio-param-option')||[])].map(el=>el.dataset.parameterId).filter(Boolean));
   }
   const orbitInput=document.querySelector('#orangeMorphBindings [data-orange-setting="orbitCount"] input');
   const before=Number(orbitInput?.value);
   orbitInput.value='29';orbitInput.dispatchEvent(new Event('change',{bubbles:true}));
   const capped=Number(state.randomOptions.orbitPercentMin);
   const freshOrbitInput=document.querySelector('#orangeMorphBindings [data-orange-setting="orbitCount"] input');const rangeInputs=[...document.querySelectorAll('#orangeMorphBindings [data-orange-setting="orbitCount"] input')];rangeInputs[0].value='0';rangeInputs[1].value='0';rangeInputs[1].dispatchEvent(new Event('change',{bubbles:true}));
   const defaultRestored=Number(state.randomOptions.orbitPercentMin);
   const fill=matrix.get('layer.fillColor');
   return {groups,expected,expectedAudio,observed,orbit:{before,capped,defaultRestored},fillChildren:matrix.subcontrols(fill.id),fillRange:matrix.subcontrolDefinitions(fill.id).find(x=>x.id==='layer.fillColor.fillLayers'),blueFillLimit:document.getElementById('morphFillLayersMax')?.max,orangeFillLimit:document.querySelector('#orangeMorphBindings .morph-route-dependent-range input')?.max,sharedNumeric:matrix.get('layer.strokeWidth'),specials:matrix.special.map(d=>({id:d.id,min:d.min,max:d.max,audioSupported:d.audioSupported})),loaded:!!window.__somataParameterMatrixStatus};
  })()`,{timeoutMs:25000,label:'matrix parity browser'});
  for(const engine of ['blue','orange'])assert(JSON.stringify(result.observed[engine])===JSON.stringify(result.expected),engine+' menu differs from the matrix: '+JSON.stringify(result.observed[engine])+' versus '+JSON.stringify(result.expected));
  assert(JSON.stringify(result.observed.audio)===JSON.stringify(result.expectedAudio),'flat audio menu mismatch: '+JSON.stringify({len:[result.observed.audio.length,result.expectedAudio.length],missing:result.expectedAudio.filter(x=>!result.observed.audio.includes(x)),extra:result.observed.audio.filter(x=>!result.expectedAudio.includes(x)),differentAt:result.observed.audio.findIndex((x,i)=>result.expectedAudio[i]!==x)}));
  assert(result.orbit.before===100&&result.orbit.capped===29&&result.orbit.defaultRestored===1,'Orange orbit constraints: '+JSON.stringify(result.orbit));
  assert(result.fillChildren.join('|').includes('Гармония цвета заливки')&&result.fillChildren.includes('Число залитых слоёв'),'shared Fill subsettings missing');
  assert(result.fillRange?.min===0&&result.fillRange?.max===1&&result.blueFillLimit==='1','Fill numeric schema/range mismatched: '+JSON.stringify(result.fillRange)+' / '+result.blueFillLimit);
  assert(result.specials.find(d=>d.id==='geometry.orbits')?.max===100,'orbit range must be 1–100%');
  assert(result.loaded,'matrix status missing');
  assert(!uncaughtExceptions(h.events).length,'browser uncaught exceptions: '+uncaughtExceptions(h.events));
  console.log('7.11.12 SHARED PARAMETER MATRIX PARITY: PASS',JSON.stringify({counts:{shared:result.expected.length,blue:result.observed.blue.length,orange:result.observed.orange.length,audio:result.observed.audio.length},orbit:result.orbit}));
 }finally{await h.close();}
})().catch(e=>{console.error('7.11.12 SHARED PARAMETER MATRIX PARITY: FAIL',e.stack||e);process.exit(1)});
