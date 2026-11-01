'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:20000});
 try{
  const result=await h.evaluate(`(()=>{
   const layer=createLayer('spiral-copy-budget');state.layers=[layer];state.activeLayerId=layer.id;
   layer.N=14.98;layer.K=5;layer.customSuborbits=2;layer.radius=216.8;layer.spiralEnabled=true;layer.spiralOrder=1;layer.spiralClosed=true;
   state.tunnel.active=true;state.tunnel.spacingStrength=3;state.tunnel.spacingMultiplier=1;state.tunnel.travelPhase=.35;
   const cases=[];
   for(const outer of [24,2,0]){
    state.tunnel.spiralOuterCopies=outer;
    for(const travel of [.01,.25,.35,.5,.75,.99,1.01]){
     state.tunnel.travelPhase=travel;
     const raw=getTunnelCopies().map(c=>({...c}));
     const visible=prepareTunnelVisibleInstances(raw,215,1,950,1,layer.id,performance.now(),layer);
     cases.push({outer,travel,raw:raw.length,visible:visible.copies.length,focusPopulation:SomataCorridorFocus.population(visible.focusCopies,215,1,950,state.tunnel,layer),scales:visible.copies.map(c=>c.scale),alphas:visible.alphas.slice(),fill:visible.fillAlphas.slice(),particle:visible.particleAlphas.slice(),positions:visible.copies.map(c=>c.position)});
    }
   }
   state.tunnel.spiralOuterCopies=2;
   state.tunnel.travelPhase=.35;
   const raw=getTunnelCopies().map(c=>({...c}));
   layer.spiralEnabled=false;
   const polygon=prepareTunnelVisibleInstances(raw,215,1,950,1,layer.id,performance.now(),layer);
   state.tunnel.spiralOuterCopies=24;
   const polygonUncapped=prepareTunnelVisibleInstances(raw,215,1,950,1,layer.id,performance.now(),layer);
   layer.spiralEnabled=true;
   state.tunnel.spiralOuterCopies=2;
   syncTunnelSettingsUI();
   const control=document.getElementById('tunnelSpiralOuterCopies');
   return {cases,polygonCount:polygon.copies.length,polygonUncappedCount:polygonUncapped.copies.length,controlValue:control.value,viewHtml:control.outerHTML};
  })()`,{timeoutMs:20000});
  for(const outer of [0,2,24]){
   const rows=result.cases.filter(x=>x.outer===outer);assert.equal(rows.length,7);
   for(const r of rows){assert.equal(r.visible,r.alphas.length);assert(r.alphas.every(a=>a>=0&&a<=1));assert(r.alphas.every((a,i)=>Math.abs(a-r.fill[i])<1e-12&&Math.abs(a-r.particle[i])<1e-12),'Base/Fill/Particles must fade together');}
  }
  for(let i=0;i<7;i++){
   const full=result.cases[i],capped=result.cases[7+i],strict=result.cases[14+i];
   assert(full.visible>=capped.visible&&capped.visible>=strict.visible,'monotonic copy budget');
   assert.deepEqual(capped.focusPopulation,full.focusPopulation,'logical focus count must NOT change with GPU copy budget');
   assert.deepEqual(strict.focusPopulation,full.focusPopulation,'0 outer budget must not renumber rotation focus');
   // Every surviving copy keeps exactly its old transform and alpha, except
   // for the intended smooth outer fade.
   for(let j=0;j<capped.visible;j++){
    const pos=capped.positions[j],ix=full.positions.findIndex(p=>Math.abs(p-pos)<1e-8);
    assert(ix>=0,'surviving copy must be original authored Corridor copy');
    assert(capped.alphas[j]<=full.alphas[ix]+1e-10,'outer budget must never increase copy alpha');
   }
  }
  assert.equal(result.polygonCount,result.polygonUncappedCount,'nonspiral Corridor unchanged');
  assert.equal(result.controlValue,'2','UI budget reflects live state');
  console.log('PASS 13.0.18 smooth distant spiral copy budget',JSON.stringify({at035:result.cases.filter(x=>x.travel===.35).map(x=>({outer:x.outer,raw:x.raw,visible:x.visible})),polygonCopyCount:result.polygonCount,uiControl:result.controlValue}));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
