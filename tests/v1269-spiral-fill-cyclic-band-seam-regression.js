'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:90,evalTimeoutMs:20000});
 try{
  const data=await h.evaluate(`(()=>{
   const layer=createLayer('cyclic-fill');
   Object.assign(layer,{spiralEnabled:true,spiralClosed:true,spiralFillEnabled:true,fill:true,N:4,K:1,spiralOrder:1});
   const frameCtx={layer,frameId:1};
   const branches=Array.from({length:4},(_,i)=>({pairIndex:i,sourceBranchIndex:i,targetBranchIndex:i,sourceBranchCount:4,targetBranchCount:4,alpha:1,points:[{x:10*i,y:0},{x:10*i,y:4},{x:10*i+1,y:6}]}));
   const sample=offset=>{
    branches.forEach((p,i)=>{p.branchPhase=((i/4+offset)%1+1)%1;});
    frameCtx.frameId++;
    const mesh=FillMeshPreparer.prepareSpiralMorphBands(frameCtx,branches);
    if(!mesh?.nativeComplete)throw Error('Missing fill mesh');
    const count=mesh.fanFloatCount||0, a=Array.from(mesh.fanData.slice(0,count));
    const pairs=[];
    const triPerBand=6; // 3 pts per branch, two branches = 6 edges.
    for(let i=0;i<count;i+=triPerBand*6){
     const span=a.slice(i,i+triPerBand*6),xs=[];
     for(let j=2;j<span.length;j+=6)xs.push(Math.floor(span[j]/10));
     pairs.push([...new Set(xs)].sort((a,b)=>a-b).join(','));
    }
    return pairs.sort().join('|');
   };
   const direct={zero:sample(0),shift1:sample(.1),shift6:sample(.6),shift9:sample(.9)};
   const oldTunnel=state.tunnel.active;
   let corridor;
   try{
    state.tunnel.active=true;layer.spiralFillType='interwinding';
    frameCtx.visibleInstances={copies:[{scale:1,position:0}],alphas:[1],fillAlphas:[1]};
    const corr=offset=>{
     branches.forEach((p,i)=>{p.branchPhase=((i/4+offset)%1+1)%1;});
     frameCtx.frameId++;
     const mesh=FillMeshPreparer.prepareInterwindingCorridor(frameCtx,branches);
     if(!mesh?.nativeComplete)throw Error('Missing interwinding Fill mesh');
     const count=mesh.fanFloatCount||0,a=Array.from(mesh.fanData.slice(0,count)),pairs=[];
     for(let i=0;i<count;i+=36){const span=a.slice(i,i+36),xs=[];for(let j=2;j<span.length;j+=6)xs.push(Math.floor(span[j]/10));pairs.push([...new Set(xs)].sort((a,b)=>a-b).join(','));}
     return pairs.sort().join('|');
    };
    corridor={zero:corr(0),shift1:corr(.1),shift6:corr(.6),shift9:corr(.9)};
   }finally{state.tunnel.active=oldTunnel;}
   return{...direct,corridor};
  })()`,{timeoutMs:15000,label:'cyclic Spiral Fill band seam'});
  console.log('fill cyclic pairing:',JSON.stringify(data));
  assert.equal(data.zero,data.shift1,'Pairing changed after small phase');
  assert.equal(data.zero,data.shift6,'Pairing changed when branch zero crossed phase origin');
  assert.equal(data.zero,data.shift9,'Pairing changed again after another shift');
  assert.equal(data.corridor.zero,data.corridor.shift1,'Corridor pairing changed');
  assert.equal(data.corridor.zero,data.corridor.shift6,'Corridor pairing changed');
  assert.equal(data.corridor.zero,data.corridor.shift9,'Corridor pairing changed');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS cyclic Spiral Fill pairing stability');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
