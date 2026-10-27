const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300,evalTimeoutMs:20000});
 const originalCount=uncaughtExceptions(h.events).length;
 try{
  const result=await h.evaluate(`(()=>{
   const polygon=createLayer('polygon-standard-test');polygon.spiralEnabled=false;polygon.spiralOrder=0;
   const source=createLayer('spiral-standard-test');Object.assign(source,{spiralEnabled:true,spiralOrder:1,spiralClosed:true,spiralTangential:true,spiralRoundSeams:false,N:12,K:1,spiralStep:2,spiralStepLinked:false,radius:220,profileMode:'segments',closedLoop:false,rotation:7,
   profileNodes:[{x:0,y:0},{x:.2,y:.32},{x:.55,y:-.26},{x:1,y:0}]});
   const target={...source,id:'spiral-standard-target',N:19,K:5,spiralStep:5,radius:260,rotation:117,profileNodes:source.profileNodes.map(p=>({...p}))};
   state.morph.slideType='sector';state.morph.spiralMorphType='phaseCircle';state.morph.mode='circleSlide';
   state.layers=[source];state.activeLayerId=source.id;
   runtimeState.morph.renderSourceLayers=[source];runtimeState.morph.renderTargetLayers=[target];
   const plan=__somataSpiralMorphCpuPlan(0);
   const samples=[0,.25,.5,.75,1].map(t=>{
      const v=__somataSpiralCarrierMorphPlan(0,t);
      return {t,frame:v?.carrierFrames?.[0]||null};
   });
   state.tunnel.active=true;state.tunnel.centerHiddenCopies=3;state.tunnel.minScale=.055;
   const shade=WebGPUSpiralBezierMorphRenderer.debugCenterShadeSpec({layer:source});
   const sampleShades=[0,.2,.4,.6,.8,1].map(t=>WebGPUSpiralBezierMorphRenderer.debugCenterShadeAlpha(shade.startRadius+(shade.endRadius-shade.startRadius)*t,shade));
   state.tunnel.centerHiddenCopies=0;const noShade=WebGPUSpiralBezierMorphRenderer.debugCenterShadeSpec({layer:source});
   state.tunnel.centerHiddenCopies=3;state.tunnel.active=false;const noCorridor=WebGPUSpiralBezierMorphRenderer.debugCenterShadeSpec({layer:source});
   SomataTestMorph.syncUI();
   return {polygonSlide:getEffectiveCircleSlideType(polygon,polygon),spiralSlide:getEffectiveCircleSlideType(source,target),
       transport:plan?.spiralTransport,slide:plan?.spiralSlideType,paths:plan?.pathCount,cubics:plan?.cubicCount,samples,
       uiSpiralOptions:[...document.getElementById('morphSpiralMorphType').options].map(o=>o.value),
       staticSlide:document.getElementById('testMorphSpiralSlide').value,
       staticSpiralVisible:!document.getElementById('testMorphSpiralSlide').classList.contains('hidden'),
       staticPolygonHidden:document.getElementById('testMorphSlide').classList.contains('hidden'),
       shade,noShade,noCorridor,sampleShades};
  })()`,{timeoutMs:20000,label:'Spiral standard slide / center shade'});
  assert(result.polygonSlide==='sector','polygon slider was overwritten by Spiral');
  assert(result.spiralSlide==='phase','Spiral phaseCircle must use spiral phase correspondence');
  assert(result.transport==='phaseCircle'&&result.slide==='phaseCircle','phaseCircle must keep target N and K transport');
  assert(result.paths>0&&result.cubics>0,'retained Spiral rail missing');
  assert(JSON.stringify(result.uiSpiralOptions)===JSON.stringify(['torn','continuous','phase','minimalTurn','phaseCircle']),'Spiral selector modes are not independent');
  assert(result.staticSlide==='phaseCircle'&&result.staticSpiralVisible&&result.staticPolygonHidden,'static spiral animation does not use the authored transport');
  const first=result.samples[0]?.frame,last=result.samples.at(-1)?.frame;
  assert(first&&last,'carrier frames missing');
  assert(Math.abs(first.N-12)<1e-7&&Math.abs(last.N-19)<1e-7,'N endpoints changed');
  assert(Math.abs(first.step-1)<1e-7&&Math.abs(last.step-5)<1e-7,'Canonical K endpoints no longer reached');
  assert(result.samples.every(x=>x.frame&&Number.isFinite(x.frame.delta)), 'carrier phase is not finite');
  assert(result.shade.enabled===true&&result.shade.endRadius>result.shade.startRadius, 'spiral gradient disabled');
  assert(result.sampleShades.every((v,i,a)=>i===0||v>=a[i-1]-1e-10), 'center alpha is discontinuous');
  assert(result.sampleShades[0]===0&&result.sampleShades.at(-1)===1,'center shade endpoints invalid');
  assert(!result.noShade.enabled&&!result.noCorridor.enabled,'center shading remains on when disabled');
  assert(uncaughtExceptions(h.events).length===originalCount,'uncaught browser exception');
  console.log('PASS v928 Spiral phase-circle sliding / canonical K and N / center gradient',JSON.stringify(result));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v928',e.stack||e.message);process.exit(1)});
