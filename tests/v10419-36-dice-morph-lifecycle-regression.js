'use strict';
// The dice changes the composition; it must not stop either independently
// running Morph engine. Blue must also acquire the new layers after a dice roll.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:22000});
 try{
  const rows=await h.evaluate(`(async()=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const dice=()=>document.getElementById('btnRandomPreset').click();
   const capture=label=>({label,blue:runtimeState.morph.active===true,
    orange:runtimeState.minimalMorph.active===true,
    paused:runtimeState.morph.paused===true,
    blueScheduler:animationScheduler.has('morph'),
    layerIds:state.layers.map(l=>l.id),
    frameCount:runtimeState.morph.frameLayers?.length||0,
    btnBlue:document.getElementById('btnMorph').classList.contains('active'),
    btnOrange:document.getElementById('btnMinimalMorph').classList.contains('active')});
   // Baseline: dice alone does not launch either morph.
   dice();await sleep(60);
   const noMorph=capture('no-morph');
   // Blue only: after repeated dice rolls it keeps playing and targets current IDs.
   document.getElementById('btnMorph').click();await sleep(300);
   const blueBefore=capture('blue-before');
   dice();await sleep(280);const blueAfter=capture('blue-after');
   dice();await sleep(280);const blueAgain=capture('blue-again');
   // An explicit user pause is not a request for the dice to resume Morph.
   const pauseOnSpace=document.getElementById('morphPauseOnSpace');
   pauseOnSpace.checked=true;pauseOnSpace.dispatchEvent(new Event('change',{bubbles:true}));
   document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));
   await sleep(40);
   const pausedBefore=capture('paused-before');
   dice();await sleep(180);const pausedAfter=capture('paused-after');
   document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));
   await sleep(200);const resumed=capture('blue-resumed');
   // Orange only: dice starts a fresh Orange transition without stopping Orange.
   document.getElementById('btnMorph').click();await sleep(70);
   state.minimalMorph.instantSwitch=true;
   const instant=document.getElementById('minimalMorphInstant');
   if(instant){instant.checked=true;instant.dispatchEvent(new Event('change',{bubbles:true}));}
   document.getElementById('btnMinimalMorph').click();await sleep(280);
   dice();await sleep(280);const orangeAfter=capture('orange-after');
   // Concurrent Blue+Orange: dice preserves both playback owners.
   document.getElementById('btnMorph').click();await sleep(280);
   dice();await sleep(320);const bothAfter=capture('both-after');
   if(runtimeState.morph.active)document.getElementById('btnMorph').click();
   if(runtimeState.minimalMorph.active)document.getElementById('btnMinimalMorph').click();
   return [noMorph,blueBefore,blueAfter,blueAgain,pausedBefore,pausedAfter,resumed,orangeAfter,bothAfter];
  })()`,{timeoutMs:22000,label:'dice must preserve Blue and Orange'});
  const [none,pre,blue,again,pausedBefore,pausedAfter,resumed,orange,both]=rows;
  assert(!none.blue&&!none.orange,'dice turned on a stopped Morph: '+JSON.stringify(none));
  assert(pre.blue&&pre.btnBlue,'Blue did not start: '+JSON.stringify(pre));
  for(const x of [blue,again]){
   assert(x.blue&&x.btnBlue&&!x.paused&&x.blueScheduler,'dice stopped or stalled Blue: '+JSON.stringify(x));
   assert.notDeepEqual(x.layerIds,pre.layerIds,'dice did not replace authored scene');
  }
  assert(pausedBefore.blue&&pausedBefore.paused&&pausedAfter.blue&&pausedAfter.paused&&!pausedAfter.blueScheduler,'dice lost manual Blue pause: '+JSON.stringify({pausedBefore,pausedAfter}));
  assert(resumed.blue&&!resumed.paused&&resumed.blueScheduler,'Blue cannot resume after dice: '+JSON.stringify(resumed));
  assert(orange.orange&&orange.btnOrange,'dice stopped Orange: '+JSON.stringify(orange));
  assert(both.blue&&both.orange&&both.btnBlue&&both.btnOrange,'dice stopped concurrent Morphs: '+JSON.stringify(both));
  assert.deepEqual(uncaughtExceptions(h.events),[],'Browser errors');
  console.log('PASS dice preserves Blue and Orange Morph owners',JSON.stringify(rows.map(({layerIds,...rest})=>({...rest,layers:layerIds.length}))));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL dice preserves Morph owners',e.stack||e);process.exitCode=1;});
