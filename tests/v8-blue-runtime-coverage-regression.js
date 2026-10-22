const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,m)=>{if(!x)throw Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:18000});
 try{
  const r=await h.evaluate(`(()=>{
    const routing=window.SomataMorphParameterRouting;
    state.layers=[createLayer('blue-v8-a'),createLayer('blue-v8-b'),createLayer('blue-v8-c'),createLayer('blue-v8-d')];
    state.layers.forEach(l=>{ensureLayerEffectState(l);l.web.width=1});
    const b=routing.addBinding(state.morph,state.minimalMorph,'web.width',{min:.2,max:.2});
    if(!b)return {error:'web binding not available'};
    b.enabled=true;b.min=.2;b.max=.2;
    runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.pausedByOrangeProject=false;runtimeState.morph.pausedByGreenProject=false;runtimeState.morph.geometryT=1;
    const run=(p,serial)=>{
      b.layerPercent=p;runtimeState.morph.phaseSerial=serial;routing.resetRuntime(runtimeState.morph);
      return state.layers.map((layer,i)=>{
        const frameLayer={...layer,web:{...layer.web}},effectLayer={...layer,web:{...layer.web}};
        routing.applyFrame({sourceLayer:layer,layer:frameLayer,effectLayer,layerIndex:i});
        return effectLayer.web.width;
      });
    };
    const zero=run(0,701),all=run(100,702),half=run(50,703);
    runtimeState.morph.active=false;routing.resetRuntime(runtimeState.morph);
    return{zero,all,half,authored:state.layers.map(l=>l.web.width)};
  })()`,{timeoutMs:18000,label:'Blue actual layer targeting'});
  assert(!r.error,'setup: '+r.error);
  assert(r.zero.every(x=>x===1),'0% changed an unselected layer: '+JSON.stringify(r));
  assert(r.all.every(x=>Math.abs(x-.2)<1e-8),'100% not applied: '+JSON.stringify(r));
  assert(r.half.filter(x=>Math.abs(x-.2)<1e-8).length===2&&r.half.filter(x=>x===1).length===2,'50% quota wrong: '+JSON.stringify(r));
  assert(r.authored.every(x=>x===1),'Blue modified authored state: '+JSON.stringify(r));
  assert(!uncaughtExceptions(h.events).length,'uncaught '+uncaughtExceptions(h.events).join(' | '));
  console.log('V8 BLUE RUNTIME LAYER COVERAGE PASS',JSON.stringify(r));
 }finally{await h.close();}
})().catch(e=>{console.error('V8 BLUE COVERAGE FAIL',e.stack||e);process.exit(1)});
