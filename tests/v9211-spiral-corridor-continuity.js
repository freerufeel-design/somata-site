const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:30000});
 try{
  const result=await h.evaluate(`(()=>{
    const source=createLayer('spiral-seam-test');Object.assign(source,{visible:true,spiralEnabled:true,spiralClosed:true,spiralTangential:true,spiralRoundSeams:true,N:10,K:1,spiralStep:1,spiralStepLinked:false,spiralOrder:1,rotation:45,radius:220,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.25,y:.10},{x:.75,y:-.12},{x:1,y:0}]});
    const target={...source,id:'spiral-seam-target',N:17,K:3,spiralStep:3};state.layers=[source];state.activeLayerId=source.id;state.tunnel.active=true;
    state.morph.mode='circleSlide';runtimeState.morph.renderSourceLayers=[source];runtimeState.morph.renderTargetLayers=[target];runtimeState.morph.active=true;runtimeState.morph.geometryT=.5;
    const results={};for(const type of ['continuous','phase','minimalTurn','phaseCircle']){
     state.morph.spiralMorphType=type;results[type]=[0,.125,.25,.5,.75,.875,1].map(t=>__somataSpiralCorridorSeamProbe(0,t));
    }
    source.spiralOrder=2;target.spiralOrder=2;
    state.morph.spiralMorphType='phaseCircle';results.order2=[0,.3,.6,1].map(t=>__somataSpiralCorridorSeamProbe(0,t));
    source.spiralOrder=-1;target.spiralOrder=-1;
    results.reverse=[0,.2,.5,.8,1].map(t=>__somataSpiralCorridorSeamProbe(0,t));
    source.spiralOrder=1;target.spiralOrder=1;
    source.N=19;source.K=4;source.spiralStep=4;
    target.N=7;target.K=1;target.spiralStep=1;
    results.reduce=[0,.15,.4,.6,.85,1].map(t=>__somataSpiralCorridorSeamProbe(0,t));
    return{results,phaseFlag:spiralMorphUsesCorridorPhase()};
  })()`,{timeoutMs:30000,label:'actual adjacent spiral corridor copy seam'});
  console.log('COPY SEAM MATRIX',JSON.stringify(Object.fromEntries(Object.entries(result.results).map(([k,v])=>[k,v.map(x=>[+x.seam.toFixed(2),+x.phaseDelta.toFixed(3),+x.actualCopyDelta.toFixed(3)])]))));
  for(const [mode,steps] of Object.entries(result.results))for(let i=0;i<steps.length;i++){
    const c=steps[i];assert(c&&!c.carrierOverflow&&c.pathSegments>0&&c.sharedTransform,`${mode} @${i}: shared-copy carrier did not build`);
    assert(Number.isFinite(c.seam)&&c.seam<.008,`${mode} @${i}: noncontinuous Corridor seam (${c.seam}): ${JSON.stringify(c)}`);
    assert(Math.abs(c.actualCopyDelta-c.phaseDelta)<1e-8,`${mode} @${i}: angular phase disagrees with carrier`);
    assert(Math.abs(c.actualCopyRatio-c.radialRatio)<1e-8,`${mode} @${i}: spiral step ratio disagrees with carrier`);
  }
  assert(uncaughtExceptions(h.events).length===0,'uncaught browser exception');
  console.log('PASS 9.2.12 shared Corridor copy seam',JSON.stringify(Object.fromEntries(Object.entries(result.results).map(([k,v])=>[k,{samples:v.length,maxSeam:Math.max(...v.map(a=>a.seam)),maxAngle:Math.max(...v.map(a=>Math.abs(a.actualCopyDelta)))}]))));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL 9.2.12',e.stack||e.message);process.exit(1)});
