'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,s)=>{if(!v)throw Error(s)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350,evalTimeoutMs:15000});
 try{
  const out=await h.evaluate(`(()=>{
    document.getElementById('btnSidebarShape')?.click();
    const layer=state.layers.find(l=>l.id===state.activeLayerId);
    Object.assign(layer,{spiralEnabled:true,spiralClosed:true,spiralOrder:3,opacity:80});
    const toggle=document.getElementById('testMorphEnabled');if(toggle.checked)toggle.click();toggle.click();
    const f=now=>{const snap=SomataRenderLayerSnapshot.create(layer),ctx={layer:snap,sourceLayer:layer,blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}};
       const active=SomataTestMorph.applyFrame(ctx,now);return{active,N:snap.N,opacity:snap.opacity,kind:ctx.geometryProvider?.kind||'static',diag:SomataTestMorph.status().last};};
    const before=f(performance.now()+2000);
    const startN=layer.N;const field=document.getElementById('numN');field.value=String(startN+2);field.dispatchEvent(new Event('change',{bubbles:true}));
    const t=performance.now(),init=f(t),early=f(t+100),mid=f(t+500),late=f(t+900),done=f(t+1500),rest=f(t+1700);
    toggle.click();return{before,early,mid,late,done,rest,startN,targetN:layer.N,pending:animationScheduler.has('geometry-test-morph')};
  })()`,{timeoutMs:14000});
  assert(!out.before.active&&out.before.opacity===80,'enabling animation moved spiral');
  assert(out.early.N===out.startN&&out.early.opacity<80&&out.early.opacity>0,'exact initial spiral state not faded');
  assert(out.mid.opacity<=.01&&out.mid.diag.topologyEndpointFade===true,'spiral topology must switch only while invisible');
  assert(out.late.N===out.targetN&&out.late.opacity>0&&out.late.opacity<80,'exact target spiral state not faded in');
  assert(out.done.N===out.targetN&&out.done.opacity===80&&out.rest.active===false&&!out.pending,'spiral did not settle at static authored geometry');
  assert([out.early,out.mid,out.late].every(x=>x.kind==='static'),'strict spiral edit must not invoke generic CPU morph carrier');
  assert(!uncaughtExceptions(h.events).length,'browser exception');
  console.log('PASS v904 strict Spiral endpoint topology fade and static idle',JSON.stringify(out));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v904 strict Spiral static edits',e.stack||e);process.exit(1)});
