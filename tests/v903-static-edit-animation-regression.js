'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,msg)=>{if(!x)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:450,evalTimeoutMs:12000});
 try{
  const r=await h.evaluate(`(()=>{
    const choose=document.getElementById('btnSidebarShape');choose?.click();
    const layer=state.layers.find(x=>x.id===state.activeLayerId),toggle=document.getElementById('testMorphEnabled');
    if(toggle.checked){toggle.click();} // start from a known disabled control
    const original={radius:layer.radius,N:layer.N,K:layer.K,rotation:layer.rotation};
    toggle.click();
    const enabled=layer.testMorph?.enabled===true;
    const f=(now)=>{
      const l=SomataRenderLayerSnapshot.create(layer),ctx={layer:l,sourceLayer:layer,
        blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false},
        minimalFadeEnabled:false,greenMorphEnabled:false,geometryMorphEnabled:false};
      const result=SomataTestMorph.applyFrame(ctx,now);
      return {result,N:l.N,K:l.K,radius:l.radius,rotation:l.rotation,kind:ctx.geometryProvider?.kind||'static'};
    };
    const now=performance.now(),still0=f(now),still1=f(now+5000);
    const idle=!SomataTestMorph.status().active&&!animationScheduler.has('geometry-test-morph');
    const slider=document.getElementById('paramRadius');
    slider.value=String(original.radius+40);slider.dispatchEvent(new Event('input',{bubbles:true}));
    const changeAt=performance.now(),a=f(changeAt),b=f(changeAt+500),c=f(changeAt+1500),d=f(changeAt+3500);
    const settled=!SomataTestMorph.status().active&&!animationScheduler.has('geometry-test-morph');
    const authored=layer.radius===original.radius+40;
    const noAuto=still0.result===false&&still1.result===false&&still0.radius===original.radius&&still1.radius===original.radius;
    const tween=a.result===true&&a.radius < b.radius&&b.radius < c.radius&&Math.abs(c.radius-layer.radius)<.0001;
    const stable=d.result===false&&Math.abs(d.radius-layer.radius)<.0001;
    // Explicit Fade must use the normal Blue fade carrier; Circle mode uses Blue CircleSlide.
    const mode=document.getElementById('testMorphMode');mode.value='fade';mode.dispatchEvent(new Event('change',{bubbles:true}));
    const input=document.getElementById('numN');input.value=String(Math.min(30,original.N+2));input.dispatchEvent(new Event('change',{bubbles:true}));
    const nStart=performance.now(),n0=f(nStart),n1=f(nStart+500),n2=f(nStart+1500);
    const topology=n0.kind==='blue-fade'&&n1.kind==='blue-fade'&&n1.N===original.N&&n2.N===layer.N;
    // Master/Blue/Orange/Green may own frames; our static animator must not compete.
    layer.radius+=20;const skipCtx={layer:SomataRenderLayerSnapshot.create(layer),sourceLayer:layer,
      blueMorphProvider:{active:true},minimalFadeEnabled:false,greenMorphEnabled:false};
    const skip=SomataTestMorph.applyFrame(skipCtx,performance.now())===false;
    toggle.click();
    return {enabled,noAuto,idle,authored,tween,stable,settled,topology,skip,
      samples:{still0,still1,a,b,c,d,n0,n1,n2},ending:SomataTestMorph.status().active};
  })()`,{timeoutMs:15000,label:'static parameter edit animation'});
  for(const k of ['enabled','noAuto','idle','authored','tween','stable','settled','topology','skip'])assert(r[k],k+': '+JSON.stringify(r));
  assert(r.ending===false,'static transition active after disabled');
  assert(!uncaughtExceptions(h.events).length,'browser exception: '+uncaughtExceptions(h.events));
  console.log('PASS v903 static edit animation',JSON.stringify(r));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v903 static edit animation',e.stack||e);process.exit(1)});
