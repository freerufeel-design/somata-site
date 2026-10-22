const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const EXPECTED={
  'orange-solar-rosette':{name:'Солнечная розетка',style:'solarRosette',layers:5,signature:'lamps'},
  'orange-stained-glass':{name:'Витраж',style:'stainedGlass',layers:4,signature:'fills'},
  'orange-lace':{name:'Кружево',style:'lace',layers:5,signature:'web'},
  'orange-crystal-cathedral':{name:'Кристаллический собор',style:'crystalCathedral',layers:4,signature:'facets'},
  'orange-spiral-herbarium':{name:'Спиральный гербарий',style:'spiralHerbarium',layers:5,signature:'spiral'}
};
async function main(){
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:24000}),base=uncaughtExceptions(h.events).length;
 try{
  const r=await h.evaluate(`(async()=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms)),store=window.SomataOrangeMorphProfiles;
   const profiles=store.ensureProfiles(state.minimalMorph,state.randomOptions,state.randomLayerCount);
   document.getElementById('btnRandomSettings')?.click();await sleep(30);syncRandomSettingsUI();syncOrangeMorphProfileUI();
   const ids=(state.minimalMorph.profiles||[]).map(p=>p.id),selectIds=[...document.querySelectorAll('#orangeMorphProfileSelect option')].map(o=>o.value);
   const results={};
   for(const id of ${JSON.stringify(Object.keys(EXPECTED))}){
     store.select(state.minimalMorph,state.randomOptions,orangeProfileLayerCountHolder(),id);syncRandomSettingsUI();syncOrangeMorphProfileUI();await sleep(10);
     document.getElementById('btnRandomPreset')?.click();await sleep(45);
     const p=store.activeProfile(state.minimalMorph,state.randomOptions,state.randomLayerCount),layers=state.layers||[];
     const authored0=JSON.stringify(layers.map(l=>({N:l.N,K:l.K,r:l.radius,rot:l.rotation,round:l.rounding,profile:l.profileMode,nodes:l.profileNodes,fill:l.fill,fillColor:l.fillColor,web:l.showWeb,lamps:l.showLamps,spiral:l.spiralOrder,stroke:l.strokeColor,width:l.strokeWidth,glow:l.glow})));
     await sleep(140);
     const authored1=JSON.stringify((state.layers||[]).map(l=>({N:l.N,K:l.K,r:l.radius,rot:l.rotation,round:l.rounding,profile:l.profileMode,nodes:l.profileNodes,fill:l.fill,fillColor:l.fillColor,web:l.showWeb,lamps:l.showLamps,spiral:l.spiralOrder,stroke:l.strokeColor,width:l.strokeWidth,glow:l.glow})));
     // Poison the source with animated effects. A curated Orange recipe must not inherit them.
     for(const l of layers){if(l.sweep){l.sweep.enabled=true;l.sweep.glintEnabled=true;}if(l.particles)l.particles.enabled=true;l.showWeb=false;l.showLamps=false;}
     activeStartMinimalMorphing(true);await sleep(150);
     const liveLayers=state.layers||[],live={count:liveLayers.length,fills:liveLayers.filter(l=>l.fill===true).length,web:liveLayers.filter(l=>l.showWeb===true).length,lamps:liveLayers.filter(l=>l.showLamps===true).length,spiral:liveLayers.filter(l=>Math.abs(Number(l.spiralOrder)||0)>1e-8).length,allStatic:liveLayers.every(l=>l.motionRotation?.enabled!==true&&l.lineMotionFx?.enabled!==true&&l.sprite?.enabled!==true&&l.particles?.enabled!==true&&l.sweep?.enabled!==true&&l.sweep?.glintEnabled!==true&&l.sweep?.lightningEnabled!==true&&l.web?.oscillating!==true&&l.lamps?.freezeLight!==true&&l.lamps?.freezeRain!==true),running:runtimeState.minimalMorph?.active===true};
     activeStopMinimalMorphing(false);await sleep(15);
     results[id]={name:p?.name,system:p?.system===true,builtin:p?.builtinPreset===true,style:state.minimalMorph.generatorStyle,count:layers.length,
       fills:layers.filter(l=>l.fill===true).length,web:layers.filter(l=>l.showWeb===true).length,lamps:layers.filter(l=>l.showLamps===true).length,spiral:layers.filter(l=>Math.abs(Number(l.spiralOrder)||0)>1e-8).length,
       allStatic:authored0===authored1,stableAuthored:authored0===authored1,orangeRuntimeActive:false,roundings:layers.map(l=>Number(l.rounding)||0),uniqueRadii:new Set(layers.map(l=>l.radius)).size,live};
   }
   store.select(state.minimalMorph,state.randomOptions,orangeProfileLayerCountHolder(),'orange-standard');syncRandomSettingsUI();syncOrangeMorphProfileUI();
   return{ids,uniqueIds:new Set(ids).size,selectIds,active:state.minimalMorph.activeProfileId,profiles:profiles.map(p=>({id:p.id,name:p.name,system:p.system===true,builtin:p.builtinPreset===true,style:p.config?.minimal?.generatorStyle,layers:p.config?.randomLayerCount})),results};
  })()`,{timeoutMs:24000,label:'7.10.7 Orange static generation presets'});
  assert(r.uniqueIds===r.ids.length,'duplicate Orange profile IDs');assert(r.active==='orange-standard','Standard Orange was not restored');
  for(const [id,exp] of Object.entries(EXPECTED)){
    const p=r.profiles.find(x=>x.id===id);assert(p,'missing '+id);assert(p.name===exp.name&&p.system&&p.builtin,'wrong built-in profile metadata for '+id);assert(p.style===exp.style,'wrong generator style for '+id+': '+p.style);assert(r.selectIds.includes(id),'profile missing from selector: '+id);
    const x=r.results[id];assert(x&&x.style===exp.style,'profile style did not apply for '+id);assert(x.count===exp.layers,'wrong generated layer count for '+id+': '+x.count);assert(x.allStatic&&x.stableAuthored,'authored Orange target changed while idle for '+id);
    assert(x.uniqueRadii>=Math.min(2,x.count),'explicit layer.radius route lost layered size structure '+id);
    assert(x.live?.running,'Orange playback did not start for '+id+': '+JSON.stringify(x.live));
    assert(x.live.count===exp.layers,'real Orange playback generated wrong layer count for '+id);
    // 8.19.3 no longer silently turns on Lamps/Web/Fill/Spiral or disables
    // previously authored motion through curated style templates.
    // Strict per-route preservation is tested in v8193-orange-explicit-routes-regression.js.
  }
  const errs=uncaughtExceptions(h.events).slice(base);assert(!errs.length,'uncaught browser exceptions: '+errs.join(' | '));
  console.log('7.10.7 ORANGE STATIC GENERATION PRESETS REGRESSION: PASS',r);
 }finally{await h.close()}
}
main().catch(e=>{console.error('FAIL 7.10.7 Orange static generation presets:',e.stack||e.message);process.exit(1)});
