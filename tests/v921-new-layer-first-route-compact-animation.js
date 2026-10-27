// 9.2.1 — first-time native audio routing and compact three-row animation UI.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:450,evalTimeoutMs:25000});
 try{
  const css=fs.readFileSync(path.resolve(__dirname,'../styles/app.css'),'utf8');
  await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s)})()`);
  const result=await h.evaluate(`(()=>{
    const check=(b,msg)=>{if(!b)throw Error(msg)};
    const expected={1:['low'],2:['low','high'],3:['low','mid','high'],4:['low','mid','midHigh','high'],5:['low','lowMid','mid','midHigh','high']};
    const sequences=[];
    for(let n=1;n<=5;n++){
      state.layers=[createLayer('Первый')];
      state.audioReactive.bandCount=n;
      state.audioReactive.routingPreset='geometryLamps';
      state.audioReactive.defaultRoutesEnabled=true;
      state.audioReactive.routes={master:[],layers:{}};
      state.audioReactive.routingInitialized=false;
      // Real Add Layer buttons, without opening audio settings or reapplying presets.
      for(let i=1;i<n+2;i++)document.getElementById('btnAddLayer').click();
      const bands=state.layers.map(l=>l.audioNativeBand);
      const want=state.layers.map((l,i)=>expected[n][i%n]);
      check(bands.join(',')===want.join(','),'first assignment '+n+': '+bands+' expected '+want);
      state.layers.forEach((l,i)=>check((state.audioReactive.routes.layers[l.id]||[]).length===5&&state.audioReactive.routes.layers[l.id].every(x=>x.band===want[i]),'wrong default links for '+i+' with '+n+' bands'));
      sequences.push({n,bands});
    }
    // Duplicating the last layer in a three-band project used to keep its old band.
    state.layers=[createLayer('Первый')];
    state.audioReactive.bandCount=3;
    state.audioReactive.routingInitialized=false;
    state.audioReactive.routes={master:[],layers:{}};
    ensureAudioRoutingState();
    document.getElementById('btnAddLayer').click();
    // Copy a layer on mid, while the new slot must be on high.
    const mid=state.layers[1],sourceRows=state.audioReactive.routes.layers[mid.id];
    sourceRows[0].multiplier=2.75;
    sourceRows[1].band='low'; // custom frequency must survive duplication
    document.getElementById('btnDuplicateLayer').click();
    const copy=state.layers[2],copied=state.audioReactive.routes.layers[copy.id];
    check(copy.audioNativeBand==='high','duplicate native was '+copy.audioNativeBand);
    check(copied[0].band==='high'&&copied[0].multiplier===2.75,'duplicate should retarget automatic band, preserve gain');
    check(copied[1].band==='low','explicitly customized source band must remain low');
    // Switching a live band-count should update automatic routes without a manual preset reset.
    state.audioReactive.bandCount=4;
    ensureAudioRoutingState();
    check(copy.audioNativeBand==='midHigh','duplicate did not follow the new automatic mapping: '+JSON.stringify({native:copy.audioNativeBand,auto:copy.audioNativeBandAuto,layers:state.layers.map(l=>l.audioNativeBand),routes:copied.map(r=>r.band)}));
    check(copied[0].band==='midHigh'&&copied[1].band==='low','live remap damaged an individually edited route');
    // Checkbox still controls whether automatic links are inserted.
    state.audioReactive.defaultRoutesEnabled=false;
    document.getElementById('btnAddLayer').click();
    const empty=state.layers.at(-1);check((state.audioReactive.routes.layers[empty.id]||[]).length===0,'unchecked create-new-links created bindings');
    state.audioReactive.defaultRoutesEnabled=true;
    // Real geometry animation controls must fit in three horizontal rows.
    document.getElementById('btnSidebarShape').click();
    const enabled=document.getElementById('testMorphEnabled');if(!enabled.checked)enabled.click();
    const control=document.getElementById('testMorphControls');
    const visible=()=>[...control.querySelectorAll('.test-morph-row')].filter(e=>getComputedStyle(e).display!=='none');
    const measure=()=>visible().map(row=>{const label=row.querySelector('label'),field=[...row.querySelectorAll('select,input')].find(el=>getComputedStyle(el).display!=='none');const a=label.getBoundingClientRect(),b=field.getBoundingClientRect();return {name:label.textContent,labelRight:a.right,fieldLeft:b.left,fieldRight:b.right,rowRight:row.getBoundingClientRect().right,top:a.top,fieldTop:b.top,height:row.getBoundingClientRect().height};});
    const normal=measure();
    check(normal.length===3,'normal animation has '+normal.length+' rows');
    check(normal.every(r=>r.fieldLeft>=r.labelRight-1 && r.fieldRight<=r.rowRight+1 && Math.abs(r.top-r.fieldTop)<15 && r.height<=34),'horizontal rows malformed '+JSON.stringify(normal));
    const animLayer=state.layers.find(x=>x.id===state.activeLayerId);
    animLayer.spiralEnabled=true;
    SomataTestMorph.syncUI();
    const spiral=measure();
    check(spiral.length===3,'spiral animation has '+spiral.length+' rows');
    check(spiral[0].name==='Тип морфинга','spiral first row changed unexpectedly');
    check(spiral[1].name==='Слайдинг спирали','spiral sliding control is not second row');
    check(spiral.every(r=>r.fieldLeft>=r.labelRight-1 && r.fieldRight<=r.rowRight+1),'spiral rows overflowed');
    return {sequences,duplicate:{native:copy.audioNativeBand,bands:copied.map(x=>x.band)},normal,spiral};
  })()`,{timeoutMs:25000,label:'new layer audio + three-row animation'});
  assert.equal(result.normal.length,3);assert.equal(result.spiral.length,3);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 9.2.1 new-layer routing and compact animation',JSON.stringify(result));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL 9.2.1',e.stack||e);process.exitCode=1;});
