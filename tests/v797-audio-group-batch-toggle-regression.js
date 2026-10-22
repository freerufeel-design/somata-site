const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const core=read('js/app/geometry-gpu-core.js'),css=read('styles/app.css');
  assert(core.includes('audio-group-active')&&core.includes('audio-group-idle')&&core.includes('audioGroupCount')&&core.includes('audioGroupActive'),'Audio group tri-state implementation missing');
  assert(css.includes('.audio-route-group-btn.audio-group-active')&&css.includes('rgba(74,222,128')&&css.includes('.audio-route-group-btn.audio-group-idle')&&css.includes('rgba(250,204,21'),'Audio green/yellow group styles missing');
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      document.getElementById('btnAudioRouting')?.click();
      state.audioReactive.routingTarget='master';
      const routes=ensureAudioRoutingState();
      routes.master=[];
      const defs=window.SomataParameterRegistry.audioDefinitions().filter(d=>d.group==='Паутина').slice(0,2);
      const webButton=()=>document.getElementById('audioGroupWeb');
      const snapshot=()=>{const b=webButton(),relevant=ensureAudioRoutingState().master.filter(r=>defs.some(d=>(d.key||d.parameterId||d.id)===r.param));return{active:b.classList.contains('audio-group-active'),idle:b.classList.contains('audio-group-idle'),count:Number(b.dataset.audioGroupCount||0),activeCount:Number(b.dataset.audioGroupActive||0),values:relevant.map(r=>r.enabled!==false)};};
      renderAudioRoutingPanel();
      // Add two links through the real group menu.
      for(const def of defs){
        webButton().click();
        const menu=document.getElementById('audioGroupWebMenu');
        const option=[...menu.querySelectorAll('button')].find(x=>x.textContent.trim()===def.label);
        option?.click();
      }
      renderAudioRoutingPanel();
      const s0=snapshot();
      webButton().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));const s1=snapshot();
      webButton().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));const s2=snapshot();
      const rows=[...document.querySelectorAll('#audioMasterGlobalRows .audio-route-row')].filter(r=>defs.some(d=>r.querySelector('.audio-param-picker-button')?.textContent.includes(d.label)));
      const cb0=rows[0]?.querySelector('input[type=checkbox]');if(cb0){cb0.checked=false;cb0.dispatchEvent(new Event('change',{bubbles:true}));}const s3=snapshot();
      const rows2=[...document.querySelectorAll('#audioMasterGlobalRows .audio-route-row')].filter(r=>defs.some(d=>r.querySelector('.audio-param-picker-button')?.textContent.includes(d.label)));
      const cb1=rows2.find(r=>r.querySelector('input[type=checkbox]')?.checked)?.querySelector('input[type=checkbox]');if(cb1){cb1.checked=false;cb1.dispatchEvent(new Event('change',{bubbles:true}));}const s4=snapshot();
      routes.master=[];renderAudioRoutingPanel();const s5=snapshot();

      // A different layer must not tint the Master group.
      const layer=state.layers[0];state.audioReactive.routingTarget=layer.id;
      const layerRows=routes.layers[layer.id]||(routes.layers[layer.id]=[]);layerRows.length=0;
      layerRows.push(createAudioRoute('mid',defs[0].key||defs[0].parameterId||defs[0].id,100,1,true,false,'add'));
      renderAudioRoutingPanel();const layerState=snapshot();
      state.audioReactive.routingTarget='master';renderAudioRoutingPanel();const masterAfterLayer=snapshot();
      return{s0,s1,s2,s3,s4,s5,layerState,masterAfterLayer,ids:defs.map(d=>d.key||d.parameterId||d.id)};
    })()`,{timeoutMs:15000,label:'7.9.7 Audio group tri-state'});
    assert(out.s0.active&&!out.s0.idle&&out.s0.count===2&&out.s0.activeCount===2&&out.s0.values.every(Boolean),'active Audio group is not green: '+JSON.stringify(out.s0));
    assert(!out.s1.active&&out.s1.idle&&out.s1.activeCount===0&&out.s1.values.every(v=>v===false),'first RMB did not disable all / yellow Audio group: '+JSON.stringify(out.s1));
    assert(out.s2.active&&!out.s2.idle&&out.s2.activeCount===2&&out.s2.values.every(Boolean),'second RMB did not enable all / green Audio group: '+JSON.stringify(out.s2));
    assert(out.s3.active&&!out.s3.idle&&out.s3.activeCount===1,'Audio group must stay green while any link is active: '+JSON.stringify(out.s3));
    assert(!out.s4.active&&out.s4.idle&&out.s4.activeCount===0,'Audio group must turn yellow when links exist but all are inactive: '+JSON.stringify(out.s4));
    assert(!out.s5.active&&!out.s5.idle&&out.s5.count===0,'empty Audio group must be neutral: '+JSON.stringify(out.s5));
    assert(out.layerState.active&&out.layerState.count===1,'selected layer Audio group did not reflect its own route: '+JSON.stringify(out.layerState));
    assert(!out.masterAfterLayer.active&&!out.masterAfterLayer.idle&&out.masterAfterLayer.count===0,'layer route leaked into Master group status: '+JSON.stringify(out.masterAfterLayer));
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'uncaught browser exceptions: '+errors.join(' | '));
    console.log('7.9.7 AUDIO GROUP RMB BATCH TOGGLE + GREEN/YELLOW/NEUTRAL STATUS: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('7.9.7 AUDIO GROUP RMB BATCH TOGGLE + GREEN/YELLOW/NEUTRAL STATUS: FAIL',e.stack||e);process.exit(1)});
