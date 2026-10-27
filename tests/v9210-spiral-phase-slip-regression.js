const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:24000});
 try{
  const exceptionsBefore=uncaughtExceptions(h.events).length;
  const v=await h.evaluate(`(()=>{
    const source=createLayer('phase-outer-anchor-src');Object.assign(source,{visible:true,spiralEnabled:true,spiralOrder:1,spiralClosed:true,spiralTangential:true,spiralRoundSeams:true,N:12,K:2,spiralStep:2,spiralStepLinked:false,rotation:0,radius:220,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.30,y:.18},{x:.70,y:-.13},{x:1,y:0}]});
    const target={...source,id:'phase-outer-anchor-dst',K:5,spiralStep:5};
    state.layers=[source];state.activeLayerId=source.id;
    state.morph.mode='circleSlide';runtimeState.morph.renderSourceLayers=[source];runtimeState.morph.renderTargetLayers=[target];
    const options=[...document.getElementById('morphSpiralMorphType').options].map(o=>o.value);
    const staticOptions=[...document.getElementById('testMorphSpiralSlide').options].map(o=>o.value);
    const phaseSamples=[0,.125,.25,.5,.75,1].map(t=>[0,.25,.5,.75,1].map(depth=>__somataSpiralPhaseTransport(2,5,12,1,t,depth)));
    const phaseNegative=__somataSpiralPhaseTransport(2,5,12,-1,.75,1);
    state.morph.spiralMorphType='phase';
    const phaseCarrierFrames=[0,.125,.25,.5,.75,1].map(t=>{const carrier=__somataSpiralCarrierMorphPlan(0,t);const a=carrier?.carrierFrames?.[0]||null;const paths=carrier?.paths||[];let maxSeam=0;for(const path of paths)for(let i=0;i+1<path.length;i++)maxSeam=Math.max(maxSeam,Math.hypot(path[i].p3.x-path[i+1].p0.x,path[i].p3.y-path[i+1].p0.y));return{anchor:a?.anchor,delta:a?.delta,maxSeam,overflow:carrier?.carrierOverflow};});
    const spiralSlideModes={};
    for(const type of options){
      state.morph.spiralMorphType=type;
      const plan=__somataSpiralMorphCpuPlan(0);
      let seams=0,finite=Boolean(plan),presenceBoth=true;
      if(plan){const F=24,xy=(r,a)=>({x:r*Math.cos(a),y:r*Math.sin(a)});
      for(let i=0;i<plan.cubicCount;i++)for(let k=0;k<F;k++)if(!Number.isFinite(plan.data[i*F+k]))finite=false;
      for(let i=0;i<plan.cubicCount;i++)if(!(plan.data[i*F+20]>.5&&plan.data[i*F+21]>.5))presenceBoth=false;
      const pos=(j,k,t)=>{const o=j*F,so=o+2*k,doff=o+8+2*k,sr=plan.data[so],sa=plan.data[so+1],dr=plan.data[doff],da=plan.data[doff+1];if(plan.data[o+22]>.5){const a=xy(sr,sa),b=xy(dr,da);return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}return xy(sr+(dr-sr)*t,sa+(da-sa)*t);};
      for(let pi=0;pi<plan.pathCount;pi++){const a=plan.cpuPathSegmentRanges[pi*4],n=plan.cpuPathSegmentRanges[pi*4+1];for(let j=0;j<n-1;j++)for(const t of [0,.25,.5,.75,1]){const x=pos(a+j,3,t),y=pos(a+j+1,0,t);seams=Math.max(seams,Math.hypot(x.x-y.x,x.y-y.y));}}
      }
      const framed=plan?.carrierMapped?__somataSpiralCarrierMorphPlan(0,.5):null;
      spiralSlideModes[type]={finite,seams,paths:plan?.pathCount,cubics:plan?.cubicCount,exactSubdivisionOnly:plan?.exactSubdivisionOnly,presenceBoth,carrierMapped:plan?.carrierMapped,overflow:framed?.carrierOverflow,frame:framed?.carrierFrames?.[0]||null,uiMode:getSpiralSlideType(),angleMode:getEffectiveCircleSlideType(source,target)};
    }
    // Exact authored K when N changes, with branch correspondence and intermediate phase.
    target.N=18;runtimeState.morph.renderTargetLayers=[target];state.morph.spiralMorphType='phaseCircle';
    const combinedPlan=__somataSpiralMorphCpuPlan(0);
    const combinedTopology={paths:combinedPlan?.pathCount,mergeSplit:combinedPlan?.topologyMergeSplitCount,stable:combinedPlan?.stableSpiralPairing};
    const combined=[0,.25,.5,.75,1].map(t=>__somataSpiralCarrierMorphPlan(0,t)?.carrierFrames?.[0]||null);
    state.morph.spiralMorphType='minimalTurn';
    const constantPlan=__somataSpiralMorphCpuPlan(0);
    const constantTopology={paths:constantPlan?.pathCount,mergeSplit:constantPlan?.topologyMergeSplitCount,stable:constantPlan?.stableSpiralPairing};
    const constant=[0,.25,.5,.75,1].map(t=>__somataSpiralCarrierMorphPlan(0,t)?.carrierFrames?.[0]||null);
    const old=state.morph.spiralMorphType;state.morph.spiralMorphType='topology';const migrated= getSpiralMorphType();state.morph.spiralMorphType=old;
    SomataTestMorph.syncUI();
    const polygon={...source,spiralEnabled:false};
    return {options,staticOptions,phaseSamples,phaseCarrierFrames,phaseNegative,spiralSlideModes,combined,combinedTopology,constant,constantTopology,migrated,polygonSlide:getEffectiveCircleSlideType(polygon,polygon),blueSlide:getSpiralSlideType(),redundant:!!document.getElementById('morphSpiralSlideType'),staticHidden:document.getElementById('testMorphSpiralRow').classList.contains('hidden')};
  })()`,{timeoutMs:24000,label:'Spiral 9.2.10 phase winding/branch tests'});
  assert(JSON.stringify(v.options)===JSON.stringify(['torn','continuous','phase','minimalTurn','phaseCircle']),'spiral selector has unsupported or missing modes');
  assert(JSON.stringify(v.staticOptions)===JSON.stringify(v.options),'static spiral modes do not match Blue Spiral choices');
  assert(!v.redundant&&v.staticHidden,'redundant Spiral slider still overrides transport');
  assert(v.migrated==='phaseCircle','legacy topology mode was not migrated');
  assert(v.polygonSlide==='sector','polygon sliding changed');
  for(const [type,p] of Object.entries(v.spiralSlideModes)){
    assert(p.finite&&p.cubics>0&&p.paths>0,`${type}: missing/nonfinite cubics`);
    assert(p.uiMode===type,`${type}: mode desynchronization`);
    assert(p.seams<1e-2,`${type}: spiral Bézier path visibly broken (seam ${p.seams})`);
    if(type==='phase'||type==='phaseCircle'||type==='minimalTurn')assert(p.presenceBoth,`${type}: rail disappears`);
    if(type==='torn')assert(p.exactSubdivisionOnly, 'Torn uses arc resampling rather than exact Bézier subdivision');
    if(type==='phase')assert(p.carrierMapped&&!p.overflow,'phase requires exact retained phase-carrier path');
    if(type==='phase')assert(Math.abs(p.frame?.N-12)<1e-8&&Math.abs(p.frame?.step-3.5)<1e-8,'phase did not vary step with fixed N');
    if(type==='continuous')assert(!p.carrierMapped||Math.abs(p.frame?.step-3.5)<1e-8,'continuous mode snaps instead of transporting explicitly mismatched target K');
  }
  for(let ti=0;ti<v.phaseSamples.length;ti++){
    const a=v.phaseSamples[ti];assert(Math.abs(a[0].rotationSinceSource)<1e-12,'outermost spiral anchor rotates');
    for(let di=1;di<a.length;di++)assert(a[di].rotationSinceSource>=a[di-1].rotationSinceSource-1e-12,'inner shells do not rotate progressively faster');
    if(ti)assert(a.at(-1).rotationSinceSource>=v.phaseSamples[ti-1].at(-1).rotationSinceSource,'phase jumps backward over time');
  }
  assert(v.phaseNegative.rotationSinceSource<0,'negative spiral direction reversed incorrectly');
  const anchored=v.phaseCarrierFrames[0].anchor;assert(anchored,'actual phase carrier missing');
  for(const f of v.phaseCarrierFrames){assert(f&&!f.overflow&&f.maxSeam<1e-3,'phase carrier has gaps or failed to build');assert(Math.hypot(f.anchor.x-anchored.x,f.anchor.y-anchored.y)<1e-7,'actual outer spiral anchor shifted when K changed');}
  assert(v.combinedTopology?.stable&&v.constantTopology?.stable, 'branch pairing was not stable during N changes');
  assert(v.combinedTopology?.mergeSplit>0&&v.constantTopology?.mergeSplit>0,'branch merge/split was not constructed during N change');
  assert(v.combined.every(x=>x&&Number.isFinite(x.delta)),'phaseCircle frame unavailable');
  assert(Math.abs(v.combined[0].N-12)<1e-6&&Math.abs(v.combined.at(-1).N-18)<1e-6,'phaseCircle did not reach authored N');
  assert(Math.abs(v.combined[0].step-2)<1e-6&&Math.abs(v.combined.at(-1).step-5)<1e-6,'phaseCircle did not reach authored K/step');
  assert(v.constant.every((x,i)=>x&&Math.abs(x.step-(2+3*[0,.25,.5,.75,1][i]))<1e-6),'manually mismatched constant-step target K snapped at boundary');
  assert(Math.abs(v.constant.at(-1).N-18)<1e-6,'constant-step mode did not reach authored N');
  assert(uncaughtExceptions(h.events).length===exceptionsBefore,'uncaught browser exception');
  console.log('PASS 9.2.10 spiral phase/outer-anchor winding, five transports, topology migration',JSON.stringify({modes:Object.keys(v.spiralSlideModes),phaseSamples:v.phaseSamples.length,seams:Object.fromEntries(Object.entries(v.spiralSlideModes).map(([k,p])=>[k,p.seams])),combinedTopology:v.combinedTopology,constantTopology:v.constantTopology,phaseMaxSeam:Math.max(...v.phaseCarrierFrames.map(x=>x.maxSeam)),combinedEnd:v.combined.at(-1),constantEnd:v.constant.at(-1)}));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL 9.2.10 spiral phase regression',e.stack||e.message);process.exit(1)});
