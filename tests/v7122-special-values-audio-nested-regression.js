const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:25000});
 try{
 const out=await h.evaluate(`(async()=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   document.getElementById('btnMorphSettings')?.click();await sleep(20);syncMorphProfileUI();
   const blueShape=JSON.stringify(state.morph.shapeOptions||{});
   const bp=document.querySelector('#morphProfileBindings [data-morph-special="orbits"]');
   const blueInputs=[...(bp?.querySelectorAll('input[type=number]:not(.morph-route-layer-percent)')||[])];
   const blueRange={min:blueInputs.map(x=>x.min),max:blueInputs.map(x=>x.max)};
   if(blueInputs.length===2){blueInputs[0].value='3';blueInputs[1].value='19';blueInputs[1].dispatchEvent(new Event('change',{bubbles:true}));}
   const blueSaved=[state.morph.orbitPercentMin,state.morph.orbitPercentMax];
   document.getElementById('btnRandomSettings')?.click();await sleep(20);syncOrangeMorphProfileUI();
   const orow=document.querySelector('#orangeMorphBindings [data-orange-special="shape"]');
   const select=orow?.querySelector('select');if(select){select.value='sine';select.dispatchEvent(new Event('change',{bubbles:true}));}
   const independent={blue:JSON.stringify(state.morph.shapeOptions||{})===blueShape,orangeFamily:state.minimalMorph.family,orangeOrbit:state.randomOptions.orbitPercentMax,blueSaved};
   // Morph once through actual Orange generator to ensure Chaos is not an inert checkbox.
   document.querySelector('#orangeMorphRoutingGroups .audio-route-group-btn[data-orange-group="Геометрия"]')?.click();
   let menu=document.querySelector('.audio-route-group-menu[data-orange-routing-group-menu="1"]:not(.hidden)');
   menu?.querySelector('[data-parameter-id="geometry.chaos"]')?.click();
   const chaosEnabled=state.randomOptions.chaosStar===true;
   document.getElementById('btnRandomPreset')?.click();await sleep(80);
   const chaosGenerated=(state.layers||[]).some(l=>l.chaosStar===true);
   // Unselect Chaos safely through the same menu.
   await sleep(45);
   menu=document.querySelector('.audio-route-group-menu[data-orange-routing-group-menu="1"]:not(.hidden)');
   if(!menu){document.querySelector('#orangeMorphRoutingGroups .audio-route-group-btn[data-orange-group="Геометрия"]')?.click();menu=document.querySelector('.audio-route-group-menu[data-orange-routing-group-menu="1"]:not(.hidden)');}
   menu?.querySelector('[data-parameter-id="geometry.chaos"]')?.click();
   const chaosDisabled=state.randomOptions.chaosStar!==true;
   // Audio popup must expose the exact nested settings and allow real numeric sub-route creation.
   if(document.getElementById('audioRoutingPanel')?.classList.contains('hidden'))document.getElementById('btnAudioRouting')?.click();await sleep(40);
   state.audioReactive.routingTarget='master';renderAudioRoutingPanel();
   document.getElementById('audioGroupLamps')?.click();await sleep(10);
   const nest=document.querySelector('#audioGroupLampsMenu .audio-param-subsettings[data-parent-parameter="lamps.radius"]');
   const button=nest?.querySelector('[data-child-parameter="lamps.radiusMultiplier"]');
   const nestedFound=!!button&&!button.disabled;
   button?.click();await sleep(10);
   const childAdded=(state.audioReactive?.routes?.master||[]).some(x=>x.param==='lamps.radiusMultiplier');
   // Numeric Orbit audio routing touches only the per-frame layer, not saved Orange/Blue settings.
   state.audioReactive.active=true;state.audioReactive.levels=[1,1,1,1,1];state.audioReactive.effectsAmplitudeStrength=100;state.audioReactive.effectsAmplitudeMultiplier=1;
   state.audioReactive.routes.master.push({id:'test-orbits',param:'geometry.orbits',band:'combined',strength:100,multiplier:1,enabled:true,derivative:false,signalMode:'add'});
   const frame={layer:{...state.layers[0],N:12,K:4,customSuborbits:null},effectLayer:{},layerIndex:0};
   window.applySharedAudioParameterFrameRouting(frame);
   const audioOrbits=frame.layer.customSuborbits;
   const orangeStayed=state.randomOptions.orbitPercentMax;
   state.audioReactive.active=false;
   // Factory reset must forget the opt-in 1..100% Blue override, not keep an old profile value.
   document.getElementById('btnResetMorphDefaults')?.click();
   const factoryBlueOrbit=[state.morph.orbitCountMin??null,state.morph.orbitCountMax??null];
   return {blueRange,independent,chaosEnabled,chaosGenerated,chaosDisabled,nestedFound,childAdded,audioOrbits,orangeStayed,factoryBlueOrbit};
 })()`,{timeoutMs:25000,label:'special values and audio nested links'});
 assert(JSON.stringify(out.blueRange.max)==='["100","100"]','blue orbit input range differs: '+JSON.stringify(out));
 assert(JSON.stringify(out.independent.blueSaved)==='[3,19]'&&out.independent.blue,'blue range values or independence lost: '+JSON.stringify(out));
 assert(out.independent.orangeFamily==='sine','Orange family did not change independently: '+JSON.stringify(out));
 assert(out.chaosEnabled&&out.chaosGenerated&&out.chaosDisabled,'Orange chaos toggle did not reach generator: '+JSON.stringify(out));
 assert(out.nestedFound&&out.childAdded,'nested audio route not selectable: '+JSON.stringify(out));
 assert(out.audioOrbits===null||(Number.isInteger(out.audioOrbits)&&out.audioOrbits>=1&&out.audioOrbits<=4),'audio orbit route must remain within geometric bounds (null=100%): '+JSON.stringify(out));
 assert(out.orangeStayed===100,'audio changed Orange independent preset: '+JSON.stringify(out));
 assert(JSON.stringify(out.factoryBlueOrbit)==='[null,null]','factory reset retained opt-in Blue orbit range: '+JSON.stringify(out));
 assert(!uncaughtExceptions(h.events).length,'uncaught '+uncaughtExceptions(h.events).join(' | '));
 console.log('7.11.12 SPECIAL VALUES + AUDIO NESTED: PASS',JSON.stringify(out));
 }finally{await h.close();}
})().catch(err=>{console.error('7.11.12 SPECIAL VALUES + AUDIO NESTED: FAIL',err.stack||err);process.exit(1)});
