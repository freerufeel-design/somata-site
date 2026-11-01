const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350,evalTimeoutMs:30000});
 try{
 const out=await h.evaluate(`(()=>{
   const selects=['morphSpiralMorphType','testMorphSpiralType','testMorphSpiralSlide'];
   const options=selects.map(id=>[id,...Array.from(document.getElementById(id).options,o=>o.value)]);
   const mk=(N,K)=>{const l=createLayer('check'+N+K);Object.assign(l,{N,K,customSuborbits:1,spiralEnabled:true,spiralOrder:1,spiralStep:K,spiralStepLinked:false,spiralClosed:true,spiralRoundSeams:false,spiralTangential:false,profileNodes:[{x:0,y:0},{x:1,y:0}],profileMode:'segments',radius:200,rounding:0});return l};
   const source=mk(12,2),target=mk(15,5);
   const cases={};
   for(const type of ['continuous','phaseCircle','fadeSpiral','torn']){
     state.morph.spiralMorphType=type;state.morph.mode='circleSlide';
     runtimeState.morph.renderSourceLayers=[source];runtimeState.morph.renderTargetLayers=[target];
     const info=__spiroSpiralMorphModeStatus(),plan=__somataSpiralMorphCpuPlan(0);
     cases[type]={info:{locksN:info.locksN,locksK:info.locksK,keepsContinuity:info.keepsContinuity,transport:info.topologyTransport},pathCount:plan.pathCount,merge:plan.topologyMergeSplitCount,carrierMapped:plan.carrierMapped,metric:plan.interpolationMetric};
     if(type==='fadeSpiral'){
       const alpha=[];let segment=0;
       for(let pi=0;pi<plan.pathCount;pi++){
         alpha.push([plan.data[segment*24+20],plan.data[segment*24+21]]);
         segment+=plan.cpuPathSegmentRanges[pi*4+1];
       }
       cases[type].alpha=alpha;
       let maxGeom=0;
       for(let i=0;i<plan.cubicCount;i++){
         const o=i*24;
         for(let c=0;c<8;c++){
           maxGeom=Math.max(maxGeom,Math.abs(plan.data[o+c]-plan.data[o+8+c]));
         }
       }
       cases[type].maxGeomDiff=maxGeom;
     }
   }
   // With fixed N and K but edited radius the rails remain fully present.
   const a=mk(20,4),b=mk(20,4);b.radius=240;
   state.morph.spiralMorphType='continuous';runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
   const fixed=__somataSpiralMorphCpuPlan(0);
   return {options,cases,fixed:{pathCount:fixed.pathCount,merge:fixed.topologyMergeSplitCount,carrierMapped:fixed.carrierMapped},legacyNfo:(()=>{state.morph.spiralMorphType='nfoNoClone';return __spiroSpiralMorphModeStatus().type;})()};
 })()`,{timeoutMs:26000});
 for(const arr of out.options)assert(JSON.stringify(arr.slice(1))===JSON.stringify(['continuous','phaseCircle','fadeSpiral','torn']),`options ${arr}`);
 assert(out.cases.continuous.info.locksN&&out.cases.continuous.info.locksK,'fixed N/K unlocked');
 assert(!out.cases.phaseCircle.info.locksN&&!out.cases.phaseCircle.info.locksK,'clone mode locks N/K');
 assert(out.cases.phaseCircle.carrierMapped&&out.cases.phaseCircle.merge>0,'clone/merge absent');
 assert(!out.cases.fadeSpiral.carrierMapped&&out.cases.fadeSpiral.metric==='opacity-crossfade','fade uses carrier mixing');
 const alpha=out.cases.fadeSpiral.alpha;
 assert(alpha.length===out.cases.fadeSpiral.pathCount,'fade alpha path mismatch');
 assert(alpha.some(x=>x[0]===1&&x[1]===0)&&alpha.some(x=>x[0]===0&&x[1]===1),'fade does not crossfade presence');
 assert(alpha.every(x=>x[0]!==x[1]),'fade unexpectedly retains a doubly visible moving branch');
 assert(out.cases.fadeSpiral.maxGeomDiff<1e-5,`fade moves its endpoint geometry (${out.cases.fadeSpiral.maxGeomDiff})`);
 assert(out.fixed.merge===0&&out.fixed.carrierMapped,'fixed N/K does not preserve rail');
 assert(out.legacyNfo==='phaseCircle','legacy NFO not migrated');
 assert(!uncaughtExceptions(h.events).length,'uncaught exceptions '+uncaughtExceptions(h.events).join(' | '));
 console.log('SOMATA 13.0.21 SPIRAL SLIDING: PASS',JSON.stringify(out,null,2));
 }finally{await h.close();}
})().catch(e=>{console.error('SOMATA 13.0.21 SPIRAL SLIDING: FAIL',e.stack||e);process.exit(1)});
