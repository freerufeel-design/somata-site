// 7.12.0 Orange Fill control parity and independent persisted profile-specific orbit overrides
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,m)=>{if(!ok)throw new Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350,evalTimeoutMs:30000});
 try{
  const r=await h.evaluate(`(async()=>{
   const store=window.SomataOrangeMorphProfiles;
   store.ensureProfiles(state.minimalMorph,state.randomOptions,state.randomLayerCount);
   const oldProfile=state.minimalMorph.activeProfileId;
   setOrangeParameterRouteActive('layer.fillColor',true);
   renderOrangeMorphBindings();
   const row=()=>document.querySelector('#orangeMorphBindings [data-orange-param="layer.fillColor"]');
   const controls=()=>({palette:!!row()?.querySelector('.morph-route-palette-select select'),harmony:!!row()?.querySelector('.morph-route-harmony-select select'),
    count:row()?.querySelectorAll('.morph-route-dependent-range input').length||0,
    orbit:document.querySelector('#orangeMorphBindings [data-orange-setting="orbitCount"] input')?.value});
   const first=controls();
   const harm=row().querySelector('.morph-route-harmony-select select');
   harm.value='triadic';harm.dispatchEvent(new Event('change',{bubbles:true}));
   const counts=row().querySelectorAll('.morph-route-dependent-range input');
   counts[0].value='1';counts[1].value='1';counts[1].dispatchEvent(new Event('change',{bubbles:true}));
   const orbit=document.querySelector('#orangeMorphBindings [data-orange-setting="orbitCount"] input');
   orbit.value='44';orbit.dispatchEvent(new Event('change',{bubbles:true}));
   const after={...controls(), harmony:state.randomOptions.fillHarmony,fillMin:state.randomOptions.fillLayersMin,fillMax:state.randomOptions.fillLayersMax,orbitPercent:state.randomOptions.orbitPercentMin};
   const selectProfile=(id)=>{const holder={get value(){return state.randomLayerCount},set value(v){state.randomLayerCount=v}};store.select(state.minimalMorph,state.randomOptions,holder,id);renderOrangeMorphBindings();};
   selectProfile('orange-stained-glass');
   const other={...controls(),harmony:state.randomOptions.fillHarmony,fillMin:state.randomOptions.fillLayersMin,fillMax:state.randomOptions.fillLayersMax,orbitPercent:state.randomOptions.orbitPercentMin};
   selectProfile(oldProfile);
   const restored={...controls(),harmony:state.randomOptions.fillHarmony,fillMin:state.randomOptions.fillLayersMin,fillMax:state.randomOptions.fillLayersMax,orbitPercent:state.randomOptions.orbitPercentMin};
   // Generate the real Orange composition in a running app, not an inert UI-only toggle.
   const oldByShape=state.randomOptions.byShape;
   document.getElementById('btnRandomPreset').click();
   const live=(state.layers||[]).map(l=>({n:l.N,k:l.K,orbit:l.customSuborbits,fill:l.fill,harmony:l.fillColor,spiral:l.spiralEnabled}));
   return {first,after,other,restored,live,boot:window.__spiroAppBootComplete===true};
  })()`,{label:'Orange Fill/Orbit parity',timeoutMs:30000});
  assert(r.boot,'App did not boot');
  assert(r.first.palette&&r.first.harmony&&r.first.count===2&&r.first.orbit==='100','Three Fill controls + orbit default missing: '+JSON.stringify(r.first));
  assert(r.after.harmony==='triadic'&&r.after.fillMin===1&&r.after.fillMax===1&&r.after.orbitPercent===44,'Orange settings not persisted or clamped: '+JSON.stringify(r.after));
  assert(r.other.harmony==='native'&&r.other.fillMin===0&&r.other.fillMax===1&&r.other.orbitPercent===100,'Orange presets should have independent defaults: '+JSON.stringify(r.other));
  assert(r.restored.harmony==='triadic'&&r.restored.fillMax===1&&r.restored.orbitPercent===44,'Switching profiles lost Orange draft: '+JSON.stringify(r.restored));
  assert(r.live.length>0,'No generated Orange layers');
  assert(r.live.filter(x=>x.fill).length<=1,'More than one Orange layer filled');
  assert(r.live.every(x=>x.orbit===null||x.orbit>=1&&x.orbit<=Math.max(1,(function gcd(a,b){return b?gcd(b,a%b):a})(x.n,x.k))),'Orbit override exceeds cap');
  assert(!uncaughtExceptions(h.events).length,'Console runtime exception: '+uncaughtExceptions(h.events));
  console.log('PASS 7.12.0 Orange Fill controls / orbit percentage / profile isolation',r);
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL 7.12.0',e.stack||e);process.exitCode=1});
