const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:280,evalTimeoutMs:16000});
  const base=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const mk=(id,N,K,rotation,radius)=>{const l=createLayer(id);Object.assign(l,{visible:true,lineVisible:true,N,K,radius,rotation,rounding:72,lineJoinType:'rounded',profileMode:'spline',profileNodes:[{x:0,y:0},{x:.14,y:.42},{x:.37,y:-.31},{x:.68,y:.36},{x:1,y:0}],spiralEnabled:true,spiralOrder:3,spiralStep:2.75,spiralStepLinked:false,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true,customSuborbits:null,chaosStar:false});return l;};
      const s=mk('perf-s',17,5,0,230),d=mk('perf-d',19,6,47,260);
      state.morph.spiralMorphType='phaseCircle';state.morph.mode='circleSlide';
      runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];
      const a=__spiroSpiralCarrierProfilePrepStatus?.()||{};
      const plan=__somataSpiralCarrierMorphPlan(0,.37);
      const b=__spiroSpiralCarrierProfilePrepStatus?.()||{};
      const bench=__somataSpiralCarrierAdvanceBench?.(0,24)||null;
      const spec=__spiroGetSpiralCarrierSpec(s,0),args={radius:spec.radius,delta:spec.delta,targetScale:spec.targetScale,tangential:spec.tangential,closed:spec.closed,roundSeams:spec.roundSeams,roundingFrac:getRoundingStrength(s.rounding),profileNodes:s.profileNodes,branchIndex:0};
      const raw=__spiroBuildSpiralCarrierPath(s,spec.anchor,args),prepared=__spiroPrepareSpiralCarrierProfile(s,args),fast=__spiroBuildSpiralCarrierPath(s,spec.anchor,{...args,preparedProfile:prepared});
      const ca=raw?._bezierSegments||[],cb=fast?._bezierSegments||[];let exactDelta=ca.length===cb.length?0:Infinity;
      if(Number.isFinite(exactDelta))for(let i=0;i<ca.length;i++)for(const k of ['p0','c1','c2','p3'])exactDelta=Math.max(exactDelta,Math.hypot((Number(ca[i]?.[k]?.x)||0)-(Number(cb[i]?.[k]?.x)||0),(Number(ca[i]?.[k]?.y)||0)-(Number(cb[i]?.[k]?.y)||0)));
      return{pathCount:plan?.pathCount||0,cubicCount:plan?.cubicCount||0,exact:plan?.exactSubdivisionOnly===true,arc:plan?.arcEqualizedRecords||0,prepDelta:(b.prepares||0)-(a.prepares||0),reuseDelta:(b.reuses||0)-(a.reuses||0),exactDelta,bench,status:__somataSpiralBezierMorphStatus?.()||null};
    })()`,{timeoutMs:14000,label:'7.7 spiral performance path'});
    assert(out.pathCount>=17,'heavy Spiral plan did not create expected paths');
    assert(out.cubicCount>0&&out.exact&&out.arc===0,'exact carrier rail contract regressed');
    assert(out.prepDelta===1,`profile prepared ${out.prepDelta} times for one layer/frame instead of once`);
    assert(out.reuseDelta>=1,`prepared profile was not reused by the explicit carrier builder: ${out.reuseDelta}`);
    assert((out.status?.stats?.carrierRotationalReuses||0)>=out.pathCount-1,`rotational sibling reuse did not engage: ${out.status?.stats?.carrierRotationalReuses||0}/${out.pathCount-1}`);
    assert(out.exactDelta<1e-10,`prepared-profile fast path changed exact carrier cubics: ${out.exactDelta}`);
    assert(out.bench&&out.bench.cubicCount===out.cubicCount&&out.bench.bytesPerRail===out.cubicCount*32,'carrier advance benchmark/rail byte accounting invalid');
    assert(/exact|retained|Bézier/i.test(String(out.status?.contract||'')),'Spiral renderer contract no longer promises exact retained Bézier geometry');
    const exc=uncaughtExceptions(h.events).slice(base);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.7 SPIRAL PERFORMANCE PATH: PASS',out);
  } finally {await h.close();}
})().catch(e=>{console.error('FAIL 7.7 spiral performance path:',e.stack||e.message);process.exit(1)});
