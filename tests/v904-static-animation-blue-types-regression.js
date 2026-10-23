'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,m)=>{if(!v)throw Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350,evalTimeoutMs:15000});
 try {
  const r=await h.evaluate(`(()=>{
    document.getElementById('btnSidebarShape')?.click();
    const l=state.layers.find(x=>x.id===state.activeLayerId);
    const toggle=document.getElementById('testMorphEnabled');if(!toggle.checked)toggle.click();
    const mode=document.getElementById('testMorphMode');
    const sample=(now)=>{const frame={sourceLayer:l,layer:SomataRenderLayerSnapshot.create(l),blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}};
      const active=SomataTestMorph.applyFrame(frame,now);return{kind:frame.geometryProvider?.kind||'static',active,source:frame.geometryProvider?.sourceLayer,target:frame.geometryProvider?.targetLayer,
      sourceData:frame.geometryProvider?.sourceData,targetData:frame.geometryProvider?.targetData,slideType:frame.geometryProvider?.slideTypeOverride};};
    const result=[];const types=['circleSlide','topology','calm','fade','light'];
    for(const type of types){
      mode.value=type;mode.dispatchEvent(new Event('change',{bubbles:true}));
      l.radius=(Number(l.radius)||200)+10;
      const t=performance.now(),a=sample(t),b=sample(t+200),c=sample(t+3000);
      const expected=type==='circleSlide'?'blue-circle-slide':(type==='fade'||type==='light'?'blue-fade':'blue-anchor-linear');
      result.push({type,kind:a.kind,expected,endpointReuse:a.source===b.source&&a.target===b.target&&a.sourceData===b.sourceData&&a.targetData===b.targetData,
       settled:!SomataTestMorph.status().active&&c.active===true});
    }
    const slide=document.getElementById('testMorphSlide');slide.value='minimal';slide.dispatchEvent(new Event('change',{bubbles:true}));
    mode.value='circleSlide';mode.dispatchEvent(new Event('change',{bubbles:true}));
    l.radius+=15;const slid=sample(performance.now());
    const end=sample(performance.now()+10000);
    toggle.click();return{result,slideType:slid.slideType,ended:!SomataTestMorph.status().active&&!animationScheduler.has('geometry-test-morph'),end:end.kind};
  })()`,{timeoutMs:15000});
  assert(r.result.length===5,'mode count');
  for(const x of r.result)assert(x.kind===x.expected&&x.endpointReuse&&x.settled,'static mode mismatch: '+JSON.stringify(x));
  assert(r.slideType==='minimal','slide type not routed into geometry provider');
  assert(r.ended,'animated edit did not terminate');
  assert(!uncaughtExceptions(h.events).length,'browser exception');
  console.log('PASS v904 Blue Morph geometry strategies and endpoint geometry reuse',JSON.stringify(r));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v904',e.stack||e);process.exit(1)});
