// 9.1 repair: available input bands, new-layer bindings, TAP priority and the restored preset UI.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:400,evalTimeoutMs:18000});
  try{
    const css=fs.readFileSync(path.resolve(__dirname,'../styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);})()`);
    const result=await h.evaluate(`(()=>{
      const expected={1:['low'],2:['low','high'],3:['low','mid','high'],4:['low','mid','midHigh','high'],5:['low','lowMid','mid','midHigh','high']};
      const check=(ok,msg)=>{if(!ok)throw new Error(msg)};
      const all=[];
      for(let n=1;n<=5;n++){
        state.audioReactive.bandCount=n;
        state.audioReactive.defaultRoutesEnabled=true;
        state.audioReactive.routingInitialized=false;
        state.audioReactive.routes={master:[],layers:{}};
        state.audioReactive.routingPreset='geometryLamps';
        state.layers=[createLayer('Слой 1')];
        ensureAudioRoutingState();
        for(let i=1;i<n+3;i++){
          const layer=createUserAddedLayer('Слой '+(i+1));
          state.layers.push(layer);
          ensureAudioRoutingState();
        }
        const want=Array.from({length:n+3},(_,i)=>expected[n][i%n]);
        const actual=state.layers.map(l=>({native:l.audioNativeBand,routes:state.audioReactive.routes.layers[l.id].map(r=>r.band)}));
        check(JSON.stringify(actual.map(x=>x.native))===JSON.stringify(want),'native assignments for '+n+': '+JSON.stringify(actual));
        check(actual.every((x,i)=>x.routes.length===5&&x.routes.every(b=>b===want[i])),'default routes for '+n+': '+JSON.stringify(actual));
        syncTapUI();
        const options=[...document.getElementById('tapAutoBand').options].map(o=>o.value);
        check(JSON.stringify(options)===JSON.stringify(expected[n]),'TAP choices for '+n+': '+JSON.stringify(options));
        const bands=getActiveAudioBandKeys();
        check(JSON.stringify(bands)===JSON.stringify(expected[n]),'audio input keys mismatch '+n);
        all.push({n,bands,assigned:actual.map(x=>x.native),tap:options});
      }
      // 4 -> 5 inputs: automatically assigned routes update, but edited routes remain untouched.
      state.audioReactive.bandCount=4;
      state.layers=[createLayer('Авто 1'),createLayer('Авто 2'),createLayer('Авто 3'),createLayer('Авто 4')];
      state.audioReactive.routingInitialized=false;
      state.audioReactive.routes={master:[],layers:{}};
      ensureAudioRoutingState();
      const second=state.layers[1];
      const autoRows=state.audioReactive.routes.layers[second.id];
      autoRows[0].band='high'; // manual customization
      const previous=second.audioNativeBand;
      check(previous==='mid','expected second native to be mid');
      state.audioReactive.bandCount=5;
      synchronizeAutomaticLayerAudioBands();
      const after=autoRows.map(x=>x.band);
      check(second.audioNativeBand==='lowMid'&&after[0]==='high'&&after.slice(1).every(x=>x==='lowMid'),'manual band was replaced: '+JSON.stringify(after));
      // Preserve arbitrary legacy project bindings: no auto flag means user-owned.
      const legacy=state.layers[2],oldRows=state.audioReactive.routes.layers[legacy.id];
      legacy.audioNativeBandAuto=false;oldRows[0].band='low';
      state.audioReactive.bandCount=3;
      synchronizeAutomaticLayerAudioBands();
      check(oldRows[0].band==='low','legacy/manual route unexpectedly overwritten');
      // Standard toggle really disables connections to new layers.
      state.audioReactive.defaultRoutesEnabled=false;
      const disabled=createUserAddedLayer('Нет связей');state.layers.push(disabled);ensureAudioRoutingState();
      check(state.audioReactive.routes.layers[disabled.id].length===0,'checkbox must disable new default routes');
      state.audioReactive.defaultRoutesEnabled=true;
      // TAP combo must react to the actual Audio Input select change.
      const count=document.getElementById('audioBandCount');count.value='4';
      count.dispatchEvent(new Event('change',{bubbles:true}));
      const selection=document.getElementById('tapAutoBand');
      check([...selection.options].map(x=>x.value).join(',')==='low,mid,midHigh,high','TAP did not react to input count');
      check(![...selection.options].some(x=>x.value==='lowMid'||x.value==='combined'),'inactive inputs must not be offered');
      state.tapTempo.autoBand='lowMid';syncTapUI();
      check(state.tapTempo.autoBand==='low'&&selection.value==='low','stale TAP priority was not remapped');
      const panel=document.getElementById('audioRoutingPanel');panel.classList.remove('hidden');
      state.audioReactive.routingTarget='master';renderAudioRoutingPanel();
      const select=document.getElementById('audioRoutingPreset');
      const presetVisible=!!select.getClientRects().length&&getComputedStyle(select).display!=='none';
      check(presetVisible,'audio link preset hidden');
      check(select.options.length===4,'audio link preset options lost');
      // Simulate saved legacy projects with all layers incorrectly stuck on bass.
      state.layers.forEach(l=>{l.audioNativeBand='low';l.audioNativeBandAuto=false;});
      select.value='lamps';select.dispatchEvent(new Event('change',{bubbles:true}));
      check(state.audioReactive.routingPreset==='lamps'&&state.layers.every(l=>state.audioReactive.routes.layers[l.id].length===3),'audio link preset is not functional');
      check(state.layers.every((l,i)=>l.audioNativeBand===expected[4][i%4]),'reapplying preset should repair inherited bass-only legacy layers');
      const beforeAdd=state.layers.length;
      const addButton=document.getElementById('btnAddLayer');
      addButton.click();
      const actualLayer=state.layers[state.layers.length-1];
      const expectedBand=expected[4][beforeAdd%4];
      const actualRoutes=state.audioReactive.routes.layers[actualLayer.id]||[];
      check(actualLayer.audioNativeBand===expectedBand,'real Add Layer button assigned '+actualLayer.audioNativeBand+' rather than '+expectedBand);
      check(actualRoutes.length===3&&actualRoutes.every(r=>r.band===expectedBand),'new layer does not inherit selected lamps preset');
      return {all,after,presetVisible,preset:state.audioReactive.routingPreset,selection:[...selection.options].map(x=>x.value),added:{band:actualLayer.audioNativeBand,routes:actualRoutes.length}};
    })()`,{timeoutMs:18000});
    console.log('PASS audio frequency routing 9.1 repaired',JSON.stringify(result));
    assert.deepEqual(uncaughtExceptions(h.events),[],'unexpected uncaught browser exceptions');
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL 9.1 audio band routing',e.stack||e);process.exitCode=1;});
