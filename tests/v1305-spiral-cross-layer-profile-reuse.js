'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:45000});
 try{
  const r=await h.evaluate(`(()=>{
    const base=createLayer('s1305');Object.assign(base,{spiralEnabled:true,spiralOrder:3,profileMode:'spline',N:18,K:5,spiralStep:2.75,spiralStepLinked:false,rounding:145,profileNodes:[{x:0,y:0},{x:.14,y:.42},{x:.37,y:-.31},{x:.68,y:.36},{x:1,y:0}]});
    const inputs=Array.from({length:15},(_,i)=>({...base,id:'spiral-'+i,rotation:i*23,radius:160+i*7,profileNodes:base.profileNodes.map(p=>({...p}))}));
    const before=__spiroSpiralCarrierProfilePrepStatus();let results=[];
    let st=performance.now();for(const layer of inputs){results.push(__spiroPrepareSpiralCarrierProfile(layer,{profileNodes:layer.profileNodes,roundingFrac:1.45,forceSharedProfile:true}));}const ms=performance.now()-st;
    const after=__spiroSpiralCarrierProfilePrepStatus();
    const varied={...inputs[0],profileNodes:inputs[0].profileNodes.map(p=>({...p}))}; varied.profileNodes[2].y+=.001;
    const unique=__spiroPrepareSpiralCarrierProfile(varied,{profileNodes:varied.profileNodes,roundingFrac:1.45,forceSharedProfile:true});
    const changed=__spiroSpiralCarrierProfilePrepStatus();
    const profileEqual=results.every(r=>r.profilePts.length===results[0].profilePts.length&&r.profilePts.every((p,i)=>p.x===results[0].profilePts[i].x&&p.y===results[0].profilePts[i].y));
    const copies=inputs.map((layer,i)=>__spiroBuildSpiralCarrierPath(layer,{x:layer.radius*Math.cos(i*.2),y:layer.radius*Math.sin(i*.2)}, {radius:layer.radius,delta:1.1,targetScale:1.35,tangential:.5,closed:true,roundSeams:true,roundingFrac:1.45,preparedProfile:results[i]}));
    return {ms,prepares:after.prepares-before.prepares,hits:after.sharedHits-before.sharedHits,uniquePrep:changed.prepares-after.prepares,profileEqual,paths:copies.length,finite:copies.every(p=>p?.points?.length>=2&&p.points.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y))),sharedEntries:after.sharedEntries};
  })()`,{timeoutMs:45000});
  assert.equal(r.prepares,1,'identical authored Spiral profiles should prepare once across 15 layers');
  assert.equal(r.hits,14);
  assert.equal(r.uniquePrep,1,'edited profile must invalidate its entry');
  assert(r.profileEqual&&r.finite&&r.paths===15,JSON.stringify(r));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS Spiral 15 layers shared profile + edit invalidation',r);
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
