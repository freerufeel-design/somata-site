'use strict';
// Verify byte-for-byte GPU carrier packing and identical multi-layer Morph budgets.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:22000});
 try{
  const result=await h.evaluate(`(()=>{
    const base=state.layers[0];
    const oldLayers=state.layers;
    const rt=runtimeState.morph;
    const old={sourceVisuals:rt.sourceVisuals,targetVisuals:rt.targetVisuals,sourceProfiles:rt.sourceProfiles,targetProfiles:rt.targetProfiles};
    const oldDevice=window.morphBudgetConstrainedDevice;
    let deviceReads=0;
    window.morphBudgetConstrainedDevice=()=>{deviceReads++;return true;};
    const xyz=(points)=>new Float64Array(points.flatMap(p=>[p[0],p[1],p[2]??1]));
    const makeRecord=(closed,radial,rotates,n,shift)=>({
      sp:{cornerFlags:Array.from({length:n},(_,i)=>i%3===0)},
      dp:{cornerFlags:Array.from({length:n},(_,i)=>i%4===1)},
      n,closed,useRadial:radial,rotates,rotationDelta:rotates?1.75:0,
      referenceOffset:shift,
      srcXYZ:xyz(Array.from({length:n},(_,i)=>[i*.375-1,i*i*.13,.25+i*.1])),
      dstXYZ:xyz(Array.from({length:n},(_,i)=>[-i*.125+.5,i*.285+1,1.5-i*.03])),
      srcPolarAligned:radial?new Float64Array(Array.from({length:n*2},(_,i)=>i*.03)):null,
      dstPolarAligned:radial?new Float64Array(Array.from({length:n*2},(_,i)=>i*.05)):null
    });
    try{
      const records=[makeRecord(false,false,false,4,0),makeRecord(true,true,true,7,2),
        makeRecord(true,false,true,5,1),makeRecord(false,true,false,3,0),
        {sp:{},dp:null,n:0,closed:false}];
      const packed=flattenMorphPlanForGpu({records});
      const arrays={};
      for(const key of ['source','target','pathRanges','topology','segmentMeta','pathSegmentRanges','pathIndexData','endpointPathLengths']){
        arrays[key]=Array.from(packed[key]);
      }
      const layers=Array.from({length:16},(_,i)=>({...base,id:'qa10410-'+i,N:3+i*2,K:1+i%3,
        radius:100+i*17,rounding:i%4,spiralEnabled:i%5!==0,profileMode:i%4===0?'spline':'segments'}));
      state.layers=layers;
      rt.sourceVisuals=layers.map((l,i)=>({N:l.N,K:l.K,spiralEnabled:i%3===0,spiralOrder:i*.6,radius:l.radius}));
      rt.targetVisuals=layers.map((l,i)=>({N:l.N+3,K:2,spiralEnabled:i%4===0,spiralOrder:-i*.42,radius:l.radius+200}));
      rt.sourceProfiles=layers.map((l,i)=>({mode:l.profileMode,nodes:[{x:0,y:0},{x:.5,y:i*.03},{x:1,y:0}]}));
      rt.targetProfiles=layers.map((l,i)=>({mode:l.profileMode,nodes:[{x:0,y:0},{x:.5,y:-i*.02},{x:1,y:0}]}));
      const budgets=prepareMorphLayerSampleBudgets();
      const details=morphBudgetRuntime.last.map(r=>({budget:r.budget,spiral:r.spiral,smooth:r.smooth,
        constrained:r.constrained,source:r.source,target:r.target}));
      const firstPassReads=deviceReads;
      deviceReads=0;
      const direct=chooseMorphLayerSampleBudget(layers[1],rt.sourceVisuals[1],rt.targetVisuals[1],rt.sourceProfiles[1],rt.targetProfiles[1],1);
      const directReads=deviceReads;
      return {packed:{pointCount:packed.pointCount,pathCount:packed.pathCount,segmentCount:packed.segmentCount,arrays},
        budgets,details,firstPassReads,direct,directReads};
    }finally{
      state.layers=oldLayers;
      Object.assign(rt,old);
      window.morphBudgetConstrainedDevice=oldDevice;
    }
  })()`,{timeoutMs:22000});
  assert.equal(result.packed.pathCount,4);
  assert.equal(result.packed.pointCount,19);
  assert.equal(result.packed.segmentCount,17);
  assert.equal(result.packed.arrays.segmentMeta.length,result.packed.segmentCount*4);
  assert.equal(result.packed.arrays.endpointPathLengths.length,8);
  assert.equal(result.budgets.length,16);
  assert(result.budgets.every(x=>Number.isFinite(x)&&x>0));
  assert.equal(result.direct,result.budgets[1]);
  assert.equal(result.directReads,1,'Direct API must still inspect its own device');
  if(process.env.SOMATA_BASELINE!=='1')assert.equal(result.firstPassReads,1,'A Morph preparation phase must query constrained-device once');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+JSON.stringify({packed:result.packed,budgets:result.budgets,details:result.details}));
  console.log('PASS Somata 10.4.10 GPU packing and shared phase budget');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
