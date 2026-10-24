const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,msg)=>{if(!v)throw new Error(msg);};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:14000});
 const prior=uncaughtExceptions(h.events).length;
 try{
  const result=await h.evaluate(`(()=>{
   const mk=(id,n,k)=>{const l=createLayer(id);Object.assign(l,{N:n,K:k,spiralEnabled:true,spiralClosed:true,spiralTangential:true,spiralRoundSeams:true,spiralStep:2.75,spiralStepLinked:false,spiralOrder:3,radius:240,rounding:60,profileMode:'spline',profileNodes:[{x:0,y:0},{x:.15,y:.22},{x:.51,y:-.15},{x:.82,y:.28},{x:1,y:0}]});return l;};
   const s=mk('closure-9010-s',13,5),t=mk('closure-9010-t',13,5);
   state.morph.mode='circleSlide';state.morph.spiralMorphType='topology';
   runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[t];
   const plan=__somataSpiralMorphCpuPlan(0);
   if(!plan)return {err:'no plan'};
   const wrong=[],rows=[];
   for(let p=0;p<plan.pathCount;p++){
    const o=p*4,first=plan.cpuPathSegmentRanges[o],n=plan.cpuPathSegmentRanges[o+1],pointFirst=plan.cpuPathRanges[o],pointLength=plan.cpuPathRanges[o+1];
    const closeFirst=plan.pathRanges[o],closeLength=plan.pathRanges[o+1];
    const valid=closeFirst===first&&closeLength===n&&closeFirst+closeLength<=plan.cubicCount;
    if(!valid)wrong.push(p);
    rows.push({p,first,n,pointFirst,pointLength,closeFirst,closeLength});
   }
   return{pathCount:plan.pathCount,cubicCount:plan.cubicCount,wrong,rows:rows.slice(0,3),
      closeFlags:Array.from({length:plan.pathCount},(_,i)=>plan.cpuPathClosure[i*8+6]),subdiv:plan.bezierSubdiv};
  })()`,{timeoutMs:13000,label:'spiral closure address test'});
  assert(!result.err,result.err||'plan invalid');
  assert(result.pathCount>=8,'no multi-branch spiral');
  assert(result.closeFlags.some(n=>n>0.5),'closed spiral expected');
  assert(result.wrong.length===0,`GPU closure shader receives point offsets instead of cubic offsets for paths ${result.wrong.join(', ')}`);
  assert(result.subdiv===8,'unexpected spiral raster subdivision setting');
  assert(uncaughtExceptions(h.events).length===prior,'uncaught JS error');
  console.log('PASS Spiral GPU closure cubic ranges',JSON.stringify(result));
 } finally{await h.close();}
})().catch(e=>{console.error('FAIL Spiral GPU closure cubic ranges',e.stack||e);process.exit(1);});
