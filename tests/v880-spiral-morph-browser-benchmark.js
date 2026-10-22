const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:22000});try{
const out=await h.evaluate(`(()=>{
 const mk=(id,spiral,N,K,rotation)=>{const l=createLayer(id);Object.assign(l,{visible:true,lineVisible:true,N,K,radius:175,rotation,rounding:80,lineJoinType:'rounded',profileMode:'spline',profileNodes:[{x:0,y:0},{x:.14,y:.42},{x:.37,y:-.31},{x:.68,y:.36},{x:1,y:0}],spiralEnabled:spiral,spiralOrder:3,spiralStep:2.75,spiralStepLinked:false,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true,chaosStar:false});return l;};
 const result=[];
 for(const scenario of [{name:'spiral-to-spiral',src:true,dst:true},{name:'spiral-to-polygon',src:true,dst:false}]){
  const s=mk('v880-src',scenario.src,18,5,0),d=mk('v880-dst',scenario.dst,21,7,48);
  state.morph.spiralMorphType='phaseCircle';state.morph.mode='circleSlide';
  runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];
  const before=performance.now();let first=__somataSpiralCarrierMorphPlan(0,.3),end=performance.now();
  // A second call is intentionally distinct: renderer may reuse the previous path resource.
  const second=__somataSpiralCarrierMorphPlan(0,.35);
  result.push({name:scenario.name,firstMs:end-before,arc:first?.arcEqualizedRecords??null,cubics:first?.cubicCount??null,paths:first?.pathCount??null,secondCubics:second?.cubicCount??null});
 }
 return result;
})()`,{timeoutMs:22000,label:'8.8 live retained spiral Morph'});
if(uncaughtExceptions(h.events).length)throw Error('Uncaught exception: '+uncaughtExceptions(h.events).join(' | '));
console.log('MORPH_BENCH_JSON '+JSON.stringify(out));
if(!out.some(r=>r.cubics>0))throw Error('No active spiral plan');
}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
