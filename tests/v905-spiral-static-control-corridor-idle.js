'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
function assert(v,s){if(!v)throw Error(s)}
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350,evalTimeoutMs:20000});
 try{
  const data=await h.evaluate(`(async()=>{
   document.getElementById('btnSidebarShape')?.click();
   const layer=state.layers.find(l=>l.id===state.activeLayerId);
   Object.assign(layer,{spiralEnabled:false,spiralOrder:0});
   const toggle=document.getElementById('testMorphEnabled');if(toggle.checked)toggle.click();toggle.click();
   SomataTestMorph.syncUI();
   const row=document.getElementById('testMorphSpiralSlide');
   const hiddenPolygon=row.classList.contains('hidden');
   layer.spiralEnabled=true;layer.spiralOrder=2;SomataTestMorph.syncUI();
   const visibleSpiral=!row.classList.contains('hidden');
   const select=document.getElementById('testMorphSpiralSlide');
   const vals=[...select.options].map(x=>x.value);
   select.value='minimalTurn';select.dispatchEvent(new Event('change',{bubbles:true}));
   const persisted=layer.testMorph?.spiralType;
   SomataTestMorph.syncUI();const remains=select.value;
   const snap=()=>({sourceLayer:layer,layer:SomataRenderLayerSnapshot.create(layer),blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}});
   const t=performance.now();SomataTestMorph.applyFrame(snap(),t+2500);
   const before=SomataTestMorph.status();
   const n=layer.N;layer.N=n+2;SomataTestMorph.applyFrame(snap(),t+2600);
   const half=snap();SomataTestMorph.applyFrame(half,t+3100);
   const faded=SomataTestMorph.status().last;
   const final=snap();SomataTestMorph.applyFrame(final,t+5000);
   const idle=!SomataTestMorph.status().active&&!animationScheduler.has('geometry-test-morph');
   // Phase-stationary Corridor must not enqueue a full repaint every rAF.
   const speed=state.tunnel.speedStrength;
   state.tunnel.speedStrength=0;
   document.getElementById('btnTunnel')?.click();
   // Corridor entry is intentionally animated for a finite duration.
   await new Promise(r=>setTimeout(r,1100));
   await new Promise(r=>setTimeout(r,170));
   const x=__somataCorridorTickStatus();
   await new Promise(r=>setTimeout(r,260));
   const y=__somataCorridorTickStatus();
   document.getElementById('btnTunnel')?.click();state.tunnel.speedStrength=speed;
   toggle.click();
   return {hiddenPolygon,visibleSpiral,vals,persisted,remains,spiralState:faded,opacity:half.layer.opacity,
    exactAtMid:half.layer.N===n+2,idle,corridorIdleInvalidations:y.motionInvalidations-x.motionInvalidations,corridorIdleSkips:y.idleSkips-x.idleSkips,before:before.active};
  })()`,{timeoutMs:20000});
  assert(data.hiddenPolygon&&data.visibleSpiral,'Spiral transport selector not conditional');
  assert(JSON.stringify(data.vals)===JSON.stringify(['torn','continuous','phase','minimalTurn','phaseCircle']),'Blue spiral type parity');
  assert(data.persisted==='minimalTurn'&&data.remains==='minimalTurn','selector not bound to authored layer');
  assert(data.spiralState.spiralType==='minimalTurn'&&data.spiralState.topologyEndpointFade,'strict Spiral transition mode/status');
  assert(data.exactAtMid&&data.idle,'Spiral geometry did not settle at exact endpoint');
  assert(data.corridorIdleInvalidations<=2&&data.corridorIdleSkips>=2,'stationary Corridor invalidated every tick: '+JSON.stringify(data));
  assert(!uncaughtExceptions(h.events).length,'uncaught browser error');
  console.log('PASS v905 spiral UI routing + static endpoint + idle Corridor',JSON.stringify(data));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v905',e.stack||e);process.exit(1)});
