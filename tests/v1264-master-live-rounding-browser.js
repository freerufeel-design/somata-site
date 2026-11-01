'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:45000});
 try{
  const result=await h.evaluate(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const ls=[createLayer('rounding-a'),createLayer('rounding-b'),createLayer('rounding-c')];
    ls.forEach((l,i)=>{l.N=6+i;l.K=2;l.rounding=10*i;l.roundingMode='standard';l.spiralEnabled=false;});
    state.layers.splice(0,state.layers.length,...ls);state.activeLayerId=ls[0].id;
    state.masterLayerEdit=false;updateLayerListUI();syncSidebarInputs();
    document.getElementById('btnMasterLayer').click();
    const input=document.getElementById('paramRounding');
    const checks=[];
    for(const value of [0,45,100,150,200]){
      input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
      checks.push({value,values:state.layers.map(l=>l.rounding)});
    }
    if(!runtimeState.morph.active)document.getElementById('btnMorph').click();
    const rt=runtimeState.morph,cycleStart=rt.cycleStart;
    const live=[];
    for(const value of [25,75,125,175]){
      input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));
      const arrays=['renderSourceLayers','renderTargetLayers','sourceLayers','targetLayers','frameLayers','lightLayers'];
      live.push({value,values:state.layers.map(l=>l.rounding),snapshots:arrays.map(key=>({name:key,values:(rt[key]||[]).slice(0,3).map(v=>v?.rounding)})),cycle:rt.cycleStart});
    }
    // Master edits one physical radius policy for all layers.
    const mono=document.querySelector('.rounding-mode-btn[data-rounding-mode="monoradius"]');
    mono.click();await sleep(60);
    const monoPolicies=state.layers.map(l=>l.roundingMode);
    const uiMono=document.getElementById('paramRoundingMode').value;
    return {checks,live,cycleStart,monoPolicies,uiMono,master:state.masterLayerEdit,active:rt.active};
  })()`,{label:'12.6.4 physical Master live rounding',timeoutMs:44000});
  assert(result.master);assert(result.active);
  for(const x of result.checks)assert(x.values.every(v=>v===x.value),'Master missed immediate layer update '+JSON.stringify(x));
  for(const x of result.live){
   assert(x.values.every(v=>v===x.value),'Master missed live layer update '+JSON.stringify(x));
   assert.equal(x.cycle,result.cycleStart,'live Master restarted Morph cycle');
   for(const snap of x.snapshots)for(const v of snap.values)if(v!=null)assert.equal(v,x.value,`stale ${snap.name} snapshot`);
  }
  assert(result.monoPolicies.every(x=>x==='monoradius'));assert.equal(result.uiMono,'monoradius');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 12.6.4: Master updates rounding across three live Morph layers immediately without phase restart; radius policy broadcasts');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
