'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:125,evalTimeoutMs:100000});
 try{
  const data=await h.evaluate(`(async()=>{
   const base=createLayer('static-target');
   Object.assign(base,{visible:true,spiralEnabled:true,spiralOrder:2,spiralClosed:true,
     spiralStep:2,spiralStepLinked:false,spiralTangential:true,N:9,K:2,
     radius:175,rotation:17,rounding:145,profileMode:'spline',
     profileNodes:[{x:0,y:0},{x:.23,y:.2},{x:.65,y:-.25},{x:1,y:0}]});
   state.layers=[base];state.activeLayerId=base.id;
   state.morph.mode='topology';state.morph.spiralMorphType='phaseCircle';
   state.morph.intervalSec=.5;
   Object.assign(state.morph.options,{byShape:true,byVertices:true,bySteps:true,
      byRotation:false,bySize:false,byColor:false,byStrokeWidth:false,
      bySpiralOrder:false,bySpiralLayers:false});
   state.morph.vertexMin=5;state.morph.vertexMax=13;
   state.morph.stepMin=0;state.morph.stepMax=100;
   let rng=9135741;const oldRandom=Math.random;
   Math.random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
   const canvas=document.createElement('canvas');canvas.width=canvas.height=650;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   const bitmap=(paths,presence)=>{
     ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,650,650);
     ctx.translate(325,325);ctx.lineWidth=2.2;ctx.strokeStyle='#fff';
     for(let i=0;i<paths.length;i++){
       const seq=paths[i];if(!seq?.length)continue;
       ctx.globalAlpha=presence?Number(presence[i])||0:1;
       ctx.beginPath();ctx.moveTo(seq[0].p0.x,seq[0].p0.y);
       for(const q of seq)ctx.bezierCurveTo(q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y);
       ctx.stroke();
     }
     ctx.globalAlpha=1;const d=ctx.getImageData(0,0,650,650).data;
     const out=new Uint8Array(650*650);for(let i=0;i<out.length;i++)out[i]=d[i*4+3];return out;
   };
   const mismatch=(a,b)=>{
     let bad=0,covered=0;const w=650;
     const near=(other,i)=>{const x=i%w,y=Math.floor(i/w);
       for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
         const xx=x+dx,yy=y+dy;
         if(xx>=0&&xx<w&&yy>=0&&yy<w&&other[yy*w+xx]>20)return true;
       }return false;};
     for(let i=0;i<a.length;i++){
       if(a[i]>20||b[i]>20)covered++;
       if(a[i]>40&&!near(b,i))bad++;
       if(b[i]>40&&!near(a,i))bad++;
     }
     return bad/Math.max(1,covered);
   };
   const delta=(a,b)=>{let sum=0,used=0;for(let i=0;i<a.length;i++){
     sum+=Math.abs(a[i]-b[i]);if(a[i]>10||b[i]>10)used++;}
     return sum/Math.max(1,used);
   };
   let seen=new Set(),results=[];let prior=null;
   try{
     document.getElementById('btnMorph').click();
     const started=performance.now();
     while(results.length<4&&performance.now()-started<13000){
       await new Promise(r=>setTimeout(r,35));
       const rt=runtimeState.morph,serial=rt.lampCycleSerial;
       if(!rt.active)throw Error('Morph stopped');
       if(seen.has(serial)||!rt.renderTargetLayers?.length)continue;
       seen.add(serial);
       const p0=__somataSpiralCarrierMorphPlan(0,0),p1=__somataSpiralCarrierMorphPlan(0,1);
       if(!p0?.paths?.length||!p1?.paths?.length)throw Error('Missing prepared GPU rail');
       // A static snapshot must have raw authored profile knots, NOT the paired
       // samples used by Morph correspondence. It has no display bridge.
       const tgt=rt.renderTargetLayers[0];
       const staticTarget={...state.layers[0],...rt.targetVisuals[0],
         profileMode:rt.targetProfiles[0].mode,
         profileNodes:rt.targetProfiles[0].rawNodes.map(p=>({...p}))};
       setPreSampledSplineLayer(staticTarget,false);
       const staticPaths=buildOrbitPolylines(staticTarget);
       const statCubics=staticPaths.map(p=>p._bezierSegments||[]);
       const p1Bitmap=bitmap(p1.paths,p1.branchPresence);
       const staticBitmap=bitmap(statCubics);
       const pixelDelta=delta(p1Bitmap,staticBitmap);
       const geometricMismatch=mismatch(p1Bitmap,staticBitmap);
       const stableTarget=delta(bitmap(statCubics),bitmap(buildOrbitPolylines(staticTarget).map(p=>p._bezierSegments||[])));
       const fromNear=__somataSpiralCarrierMorphPlan(0,0.001);
       const toNear=__somataSpiralCarrierMorphPlan(0,0.999);
       const fromMotion=delta(bitmap(p0.paths,p0.branchPresence),bitmap(fromNear.paths,fromNear.branchPresence));
       const toMotion=delta(bitmap(toNear.paths,toNear.branchPresence),bitmap(p1.paths,p1.branchPresence));
       let handoff=0;
       if(prior)handoff=delta(prior,bitmap(p0.paths,p0.branchPresence));
       results.push({serial,mode:tgt.profileMode,N:tgt.N,K:tgt.K,
         locked:p1.phaseLockedEndpoints,liveRounded:p1.liveRoundedSpline,
         profileLength:tgt.profileNodes.length,rawLength:rt.targetProfiles[0].rawNodes.length,
         staticPathCount:statCubics.length,morphPathCount:p1.paths.length,
         pixelDelta,geometricMismatch,stableTarget,fromMotion,toMotion,handoff});
       prior=bitmap(p1.paths,p1.branchPresence);
       rt.cycleStart=performance.now()-rt.transitionMs-25;
     }
   }finally{Math.random=oldRandom;
     if(runtimeState.morph.active)document.getElementById('btnMorph').click();}
   return results;
  })()`,{timeoutMs:95000,label:'static target endpoint + repeated phase'});
  console.log('12.7.2 static endpoint diagnostics',JSON.stringify(data));
  assert.equal(data.length,4);
  for(const [i,v] of data.entries()){
   assert.equal(v.locked,true,'The phase must use immutable prepared cubics');
   assert.equal(v.liveRounded,false,'No mid-phase rounded spline reconstruction');
   assert.equal(v.profileLength,v.rawLength,'Target must use authored static knots');
   assert(v.stableTarget<1e-9,'Static target must be deterministic');
   assert(v.geometricMismatch<.002,`Morph target not identical to static target: ${JSON.stringify(v)}`);
   assert(v.fromMotion<3&&v.toMotion<3,`Near-boundary movement too fast: ${JSON.stringify(v)}`);
   if(i>0)assert(v.handoff<.6,`Last vs next first mismatch: ${JSON.stringify(v)}`);
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 12.7.2 static-target locked spiral interpolation');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
