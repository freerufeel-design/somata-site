'use strict';
// A non-torn Spiral spline Morph must only blend the phase-owned, exactly
// subdivided Bézier endpoint controls. Rebuilding a new spline per intermediate
// frame causes the visible end-of-cycle jump and makes the split layout unstable.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:115,evalTimeoutMs:27000});
 try{
  const results=await h.evaluate(`(()=>{
   const original=window.__spiroBuildSpiralCarrierPath;
   const output=[];
   const originalState={layers:state.layers,source:runtimeState.morph.renderSourceLayers,
     target:runtimeState.morph.renderTargetLayers,type:state.morph.spiralMorphType};
   let intermediateRebuilds=0;
   const pointFields=['p0','c1','c2','p3'];
   const flatten=segments=>segments.flatMap(q=>pointFields.flatMap(k=>[q[k].x,q[k].y]));
   const maxDiff=(a,b)=>a.length===b.length?a.reduce((v,x,i)=>Math.max(v,Math.abs(x-b[i])),0):Infinity;
   try{
    window.__spiroBuildSpiralCarrierPath=function(...args){intermediateRebuilds++;return original.apply(this,args);};
    for(const transport of ['continuous','phase','phaseCircle','minimalTurn','torn']){
     for(const mixedProfile of [false,true]){
      const a=createLayer('prepared-spline-src'),b=createLayer('prepared-spline-dst');
      Object.assign(a,{N:7,K:2,spiralEnabled:true,spiralOrder:2,spiralClosed:true,
        spiralTangential:false,spiralRoundSeams:true,radius:240,rounding:48,profileMode:'spline',
        profileNodes:[{x:0,y:0},{x:.14,y:.24},{x:.52,y:-.3},{x:1,y:0}]});
      Object.assign(b,a,{id:'prepared-spline-dst',profileMode:mixedProfile?'segments':'spline',
        profileNodes:[{x:0,y:0},{x:.1,y:-.24},{x:.3,y:.3},{x:.62,y:-.16},{x:.76,y:.21},{x:1,y:0}]});
      state.layers=[a];runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];state.morph.spiralMorphType=transport;
      // Build endpoints first, then count ONLY intermediate path reconstructions.
      const source=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,0);
      const target=WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,1);
      const baseline=intermediateRebuilds;
      const frames=[.15,.37,.62,.9,.99,.999,.9999].map(t=>({t,plan:WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(0,t)}));
      const newlyBuilt=intermediateRebuilds-baseline;
      const sf=flatten(source?.paths?.[0]||[]),tf=flatten(target?.paths?.[0]||[]);
      const errors=frames.map(({t,plan})=>{
       const actual=flatten(plan?.paths?.[0]||[]);
       if(!actual.length||actual.length!==sf.length||sf.length!==tf.length)return Infinity;
       // Same-mode spline handles are scheduled by the profile transition UI.
       // Mixed-profile handles also have independent timing;
       // knots must still move by ordinary phase interpolation.
       if(mixedProfile){let diff=0;for(let k=0;k<actual.length;k+=8){
         for(const j of [0,1,6,7])diff=Math.max(diff,Math.abs(actual[k+j]-(sf[k+j]+(tf[k+j]-sf[k+j])*t)));
        }return diff;}
       // Curvature is now on the author's profile timeline, not linear t.
       // Check that it does not introduce an internal C0 break in the rail;
       // exact profile timing/endpoint positions are tested in v10434.
       if(!actual.every(Number.isFinite))return Infinity;
       let gap=0;
       for(let k=0;k+15<actual.length;k+=8){
        gap=Math.max(gap,Math.hypot(actual[k+6]-actual[k+8],actual[k+7]-actual[k+9]));
       }
       return gap;
      });
      const endDistance=frames.map(({plan})=>maxDiff(flatten(plan?.paths?.[0]||[]),tf));
      output.push({transport,mixedProfile,prepared:frames.every(f=>f.plan?.preparedContinuousSplineRail===true),
        mapped:frames.every(f=>f.plan?.carrierMapped===true),rebuilt:newlyBuilt,
        overflow:frames.some(f=>f.plan?.carrierOverflow===true),errors,endDistance,
        sourceCount:sf.length,targetCount:tf.length});
     }
    }
   }finally{
    window.__spiroBuildSpiralCarrierPath=original;
    state.layers=originalState.layers;
    runtimeState.morph.renderSourceLayers=originalState.source;
    runtimeState.morph.renderTargetLayers=originalState.target;
    state.morph.spiralMorphType=originalState.type;
   }
   return output;
  })()`,{label:'non-torn Spiral Bézier phase ownership'});
  assert.equal(results.length,10);
  for(const r of results){
    if(r.transport==='torn'){
      assert(!r.mapped&&!r.prepared,'torn must retain separate topology transport: '+JSON.stringify(r));
      continue;
    }
    assert(r.mapped&&r.prepared&&!r.overflow&&r.sourceCount>16&&r.sourceCount===r.targetCount,
      'missing compatible phase-owned spline rail: '+JSON.stringify(r));
    assert.equal(r.rebuilt,0,'intermediate spline unexpectedly reconstructed: '+JSON.stringify(r));
    assert(r.errors.every(x=>x<1e-5),'prepared rail must keep C0 joins / anchored endpoints: '+JSON.stringify(r));
    for(let i=1;i<r.endDistance.length;i++)assert(r.endDistance[i]<=r.endDistance[i-1]+1e-6,
      'late spline moves away from its target: '+JSON.stringify(r));
    assert(r.endDistance.at(-1)<.2,'endpoint still jumps: '+JSON.stringify(r));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10427: non-torn Spiral spline phase owns prepared Bézier pair (4 transports x same/mixed profiles); torn unchanged');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL v10427',err.stack||err);process.exitCode=1;});
