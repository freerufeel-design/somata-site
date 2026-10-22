const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,m)=>{if(!v)throw Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:25000});
 try{
  const r=await h.evaluate(`(()=>{
    if(runtimeState.minimalMorph?.active)activeStopMinimalMorphing?.(false);
    if(runtimeState.morph?.active)activeStopMorphing?.(false);
    state.layers=[createLayer('v8-a'),createLayer('v8-b'),createLayer('v8-c'),createLayer('v8-d')];
    state.layers.forEach((l,i)=>{l.N=7+i;l.K=2;l.radius=180+i*5;l.strokeColor='#123456';l.customSuborbits=null;});
    state.randomLayerCount=4;state.minimalMorph.generatorStyle='standard';
    const b=window.SomataOrangeMorphProfiles.workingBindings(state.minimalMorph,state.randomOptions,4).find(x=>x.parameter==='geometry.N');
    b.enabled=true;b.min=21;b.max=21;b.layerPercent=0;
    const raw=state.layers.map(x=>x.N);
    document.getElementById('randomLayerCount').value='4';
    document.getElementById('btnRandomPreset').click();
    const firstIds=state.layers.map(x=>x.id);const none=state.layers.map(x=>x.N);
    state.layers.forEach((x,i)=>x.N=raw[i]);
    window.SomataOrangeMorphProfiles.setCoverage(state.minimalMorph,state.randomOptions,4,'geometry.N',100);
    document.getElementById('btnRandomPreset').click();
    const secondIds=state.layers.map(x=>x.id);const all=state.layers.map(x=>x.N);
    state.layers.forEach((x,i)=>x.N=raw[i]);
    window.SomataOrangeMorphProfiles.setCoverage(state.minimalMorph,state.randomOptions,4,'geometry.N',50);
    document.getElementById('btnRandomPreset').click();
    const half=state.layers.map(x=>x.N);
    return{raw,none,all,half,firstIds,secondIds,binding:{...b},live:window.SomataOrangeMorphProfiles.workingBindings(state.minimalMorph,state.randomOptions,4).find(x=>x.parameter==='geometry.N')};
  })()`,{timeoutMs:24000,label:'Orange real output mask'});
  console.log('V8 REAL COVERAGE',JSON.stringify(r));
  assert(JSON.stringify(r.none)===JSON.stringify(r.raw),'0% must retain source');
  assert(r.all.every(n=>n===21),'100% must modify all layers');
  assert(r.half.filter((n,i)=>n!==r.raw[i]).length===2,'50% must modify exactly 2 layers');
  assert(!uncaughtExceptions(h.events).length,'uncaught '+uncaughtExceptions(h.events).join(' | '));
  console.log('V8 ACTUAL COVERAGE: PASS');
 }finally{await h.close();}
})().catch(e=>{console.error('V8 ACTUAL COVERAGE: FAIL',e.stack||e);process.exit(1)});
