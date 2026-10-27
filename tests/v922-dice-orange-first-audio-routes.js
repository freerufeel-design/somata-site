'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:440,evalTimeoutMs:30000});
 try{
  const res=await h.evaluate(`(()=>{
    const check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const expected={1:['low'],2:['low','high'],3:['low','mid','high'],4:['low','mid','midHigh','high'],5:['low','lowMid','mid','midHigh','high']};
    const result=[];
    const setup=(n)=>{
      if(runtimeState.minimalMorph.active)document.getElementById('btnMinimalMorph').click();
      state.layers=[createLayer('Исходный')];state.activeLayerId=state.layers[0].id;
      state.audioReactive.bandCount=n;state.audioReactive.routingPreset='geometryLamps';
      state.audioReactive.defaultRoutesEnabled=true;
      state.audioReactive.routingInitialized=false;
      state.audioReactive.routes={master:[],layers:{}};
      state.audioReactive.layerSignalEnabled={};
      state.minimalMorph.generatorStyle='standard';
      state.minimalMorph.instantSwitch=true;
      ensureAudioRoutingState();
    };
    const checkAssigned=(n,kind,count)=>{
      const wanted=Array.from({length:count},(_,i)=>expected[n][i%n]);
      const bands=state.layers.map(x=>x.audioNativeBand);
      check(state.layers.length===count,kind+' count='+state.layers.length+' expected '+count);
      check(bands.join(',')===wanted.join(','),kind+' native '+bands+' expected '+wanted);
      state.layers.forEach((layer,i)=>{
        const rows=state.audioReactive.routes.layers[layer.id]||[];
        check(rows.length===5&&rows.every(r=>r.band===wanted[i]),kind+' links at '+i+': '+rows.map(r=>r.band));
      });
      return bands;
    };
    for(let n=1;n<=5;n++){
      setup(n);
      const count=n+2;
      document.getElementById('randomLayerCount').value=String(count);
      document.getElementById('btnRandomPreset').click(); // dice: real UI
      result.push({bands:n,dice:checkAssigned(n,'dice',count)});
    }
    setup(4);
    document.getElementById('randomLayerCount').value='4';
    document.getElementById('btnMinimalMorph').click(); // enable Orange
    check(runtimeState.minimalMorph.active,'Orange did not activate');
    document.getElementById('btnRandomPreset').click(); // trigger immediate Orange generation
    const orange=checkAssigned(4,'orange',4);
    // Preserve hand-picked bands for existing slots; new fifth slot gets LOW.
    const first=state.layers[0], oldRows=state.audioReactive.routes.layers[first.id];
    oldRows[0].band='high';oldRows[1].multiplier=2.5;
    document.getElementById('randomLayerCount').value='5';
    document.getElementById('btnRandomPreset').click();
    check(state.layers.length===5,'Orange second composition has incorrect count');
    const custom=state.audioReactive.routes.layers[state.layers[0].id];
    check(custom[0].band==='high'&&custom[1].band==='low'&&custom[1].multiplier===2.5,'hand-authored connection was lost');
    check(state.layers[4].audioNativeBand==='low'&&state.audioReactive.routes.layers[state.layers[4].id].every(r=>r.band==='low'),'fifth Orange layer not mapped cyclically');
    document.getElementById('btnMinimalMorph').click();
    check(!runtimeState.minimalMorph.active,'Orange did not stop');
    setup(3);state.audioReactive.defaultRoutesEnabled=false;
    document.getElementById('randomLayerCount').value='3';
    document.getElementById('btnRandomPreset').click();
    check(state.layers.every((l,i)=>l.audioNativeBand===expected[3][i]),'unchecked no-routing incorrect native band');
    check(state.layers.slice(1).every(l=>(state.audioReactive.routes.layers[l.id]||[]).length===0),'unchecked auto routes created links for new slots');
    return {result,orange,custom:custom.map(r=>({band:r.band,multiplier:r.multiplier})),unchecked:true};
  })()`,{timeoutMs:30000});
  const direct=await h.evaluate(`(async()=>{
    state.layers=[createLayer('Прямой запуск')];state.activeLayerId=state.layers[0].id;
    state.audioReactive.bandCount=3;state.audioReactive.routingInitialized=false;
    state.audioReactive.defaultRoutesEnabled=true;state.audioReactive.routingPreset='geometryLamps';
    state.audioReactive.routes={master:[],layers:{}};ensureAudioRoutingState();
    state.minimalMorph.instantSwitch=true;
    document.getElementById('randomLayerCount').value='3';
    document.getElementById('btnMinimalMorph').click();
    await new Promise(resolve=>setTimeout(resolve,700));
    const values=state.layers.map(l=>({band:l.audioNativeBand,links:(state.audioReactive.routes.layers[l.id]||[]).map(x=>x.band)}));
    document.getElementById('btnMinimalMorph').click();
    return values;
  })()`,{timeoutMs:10000});
  assert.deepEqual(direct.map(x=>x.band),['low','mid','high'],'direct Orange button did not assign three frequencies');
  assert(direct.every(x=>x.links.length===5&&x.links.every(y=>y===x.band)),'direct Orange button routes incorrect: '+JSON.stringify(direct));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS dice/Orange new-layer native audio 1-5 inputs',JSON.stringify({res,direct}));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL dice/Orange native audio',e.stack||e);process.exitCode=1;});
