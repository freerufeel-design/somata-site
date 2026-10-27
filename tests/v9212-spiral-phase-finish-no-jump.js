const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:25000});
 try{
  const out=await h.evaluate(`(()=>{
   const mk=(id,n,k,order=1)=>{const x=createLayer(id);Object.assign(x,{visible:true,spiralEnabled:true,spiralClosed:true,spiralRoundSeams:true,spiralTangential:true,spiralStepLinked:false,spiralStep:k,spiralOrder:order,N:n,K:k,radius:220,rotation:45,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.25,y:.1},{x:.75,y:-.1},{x:1,y:0}]});return x;};
   state.tunnel.active=true;state.tunnel.spacingStrength=1;state.morph.mode='circleSlide';
   const results=[];
   for(const [mode,sourceN,targetN,sourceK,targetK,order] of [['continuous',7,7,1,1,1],['phase',7,7,1,3,1],['minimalTurn',7,10,1,1,1],['phaseCircle',7,10,1,3,1],['phaseCircle',7,11,1,3,2],['phaseCircle',11,7,3,1,-1]]){
    const s=mk('final-s',sourceN,sourceK,order),d=mk('final-d',targetN,targetK,order);
    state.layers=[s];state.activeLayerId=s.id;
    state.morph.spiralMorphType=mode;
    const rt=runtimeState.morph;
    rt.renderSourceLayers=[s];rt.renderTargetLayers=[d];rt.active=true;
    const copies=[{copyId:-2,position:-2,scale:.7},{copyId:0,position:0,scale:1},{copyId:1,position:1,scale:1.17},{copyId:5,position:5,scale:2.21}];
    const get=(l)=>copies.map(c=>getMotionTunnelLagRadians(c,l));
    rt.geometryT=.999999;rt.progress=.999999;const near=get(s);
    rt.geometryT=1;rt.progress=1;const final=get(s);
    rt.active=false;const staticTarget=get(d);
    rt.active=true;rt.geometryT=.5;rt.progress=.5;const mid=get(s);
    const plan=__somataSpiralCarrierMorphPlan(0,.5);
    results.push({mode,sourceN,targetN,sourceK,targetK,order,near,final,staticTarget,mid,
      deltaMid:plan?.carrierFrames?.[0]?.delta,hasCarrier:!!plan?.carrierMapped});
   }
   runtimeState.morph.active=false;
   const originals=[{scale:1.2,stepRatio:1.1,copyId:0},{scale:1.8,stepRatio:1.1,copyId:1}];
   originals._stepRatio=1.1; originals._logStepRatio=Math.log(1.1);
   const raised=spiralCorridorCopiesForLayer(originals,mk('radial',7,1,2));
   return{results,radial:{original:originals[1].scale,raised:raised[1].scale,step:raised._stepRatio,identical:raised===originals,
                  originalUnchanged:originals._stepRatio===1.1},phaseEnabled:getSpiralMorphType()};
  })()`,{timeoutMs:24000,label:'spiral endpoint phase at t=100% and static handoff'});
  const results=out.results;
  assert(!out.radial.identical&&out.radial.originalUnchanged,'radial order modified shared copies');
  assert(Math.abs(out.radial.raised-3.24)<1e-10&&Math.abs(out.radial.step-1.21)<1e-10,'spiral order copy scales are not shared across passes');
  for(const x of results){
   assert(x.hasCarrier,`${x.mode}: carrier missing`);
   const max=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
   assert(max(x.final,x.staticTarget)<1e-7,`${x.mode}: phase jumps at 100% when morph ends ${max(x.final,x.staticTarget)}`);
   assert(max(x.near,x.final)<.0002,`${x.mode}: phase jumps before 100% ${max(x.near,x.final)}`);
   assert(Math.abs((x.mid[2]-x.mid[1])-x.deltaMid)<1e-7,`${x.mode}: copy phase is not the carrier phase at middle`);
  }
  assert(!uncaughtExceptions(h.events).length,'uncaught exceptions');
  console.log('PASS 9.2.12 spiral final-to-static handoff',results.map(x=>({mode:x.mode,src:x.sourceN,dst:x.targetN,k:x.targetK,order:x.order,finalDelta:x.final[2]-x.final[1]})));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL spiral final-to-static handoff',e.stack||e);process.exit(1)});
