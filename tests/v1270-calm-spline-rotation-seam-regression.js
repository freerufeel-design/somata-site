'use strict';
// Real Blue Morph clicks, six consecutive phase switches, and rasterized GPU
// Bézier preparation. This failed on 12.6.6 with differences of 67–134 due to
// loss of the actual target spiral render snapshot at the phase boundary.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:85000});
 try{
  const data=await h.evaluate(`(async()=>{
   const layer=createLayer('phase-handoff');
   Object.assign(layer,{visible:true,spiralEnabled:true,spiralOrder:2,spiralClosed:true,
    spiralStep:2,spiralStepLinked:false,spiralTangential:true,N:9,K:2,
    radius:180,rotation:17,rounding:140,profileMode:'spline',
    profileNodes:[{x:0,y:0},{x:.2,y:.2},{x:.7,y:-.22},{x:1,y:0}]});
   state.layers=[layer];state.activeLayerId=layer.id;
   state.morph.mode='calm';state.morph.spiralMorphType='phaseCircle';
   state.morph.intervalSec=.5;
   Object.assign(state.morph.options,{byShape:true,byVertices:true,bySteps:true,
    byRotation:true,bySize:false,byColor:false,byStrokeWidth:false,
    bySpiralOrder:false,bySpiralLayers:false});
   state.morph.vertexMin=5;state.morph.vertexMax=13;
   state.morph.stepMin=0;state.morph.stepMax=100;
   let rng=123456789;
   const random=Math.random;
   Math.random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
   const canvas=document.createElement('canvas');canvas.width=canvas.height=520;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   const bitmap=p=>{
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,520,520);
    ctx.translate(260,260);ctx.strokeStyle='#fff';ctx.lineWidth=2;
    for(const [i,seq] of (p?.paths||[]).entries()){
     if(!seq?.length)continue;
     ctx.globalAlpha=p.branchPresence?.[i]??1;
     ctx.beginPath();ctx.moveTo(seq[0].p0.x,seq[0].p0.y);
     for(const q of seq)ctx.bezierCurveTo(q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y);
     ctx.stroke();
    }
    ctx.globalAlpha=1;
    const im=ctx.getImageData(0,0,520,520).data;
    const alpha=new Uint8Array(520*520);
    for(let i=0;i<alpha.length;i++)alpha[i]=im[i*4+3];
    return alpha;
   };
   const difference=(a,b)=>{
    let sum=0,covered=0;
    for(let i=0;i<a.length;i++){
     sum+=Math.abs(a[i]-b[i]);if(a[i]>10||b[i]>10)covered++;
    }
    return sum/Math.max(1,covered);
   };
   const result=[];let priorPhase=null;
   try{
    document.getElementById('btnMorph').click();
    const seen=new Set(),start=performance.now();
    while(performance.now()-start<9000&&result.length<3){
     await new Promise(resolve=>setTimeout(resolve,35));
     const rt=runtimeState.morph;
     if(!rt.active)throw Error('Blue Morph unexpectedly stopped');
     const serial=rt.lampCycleSerial;
     if(seen.has(serial)||!rt.renderSourceLayers?.length||!rt.renderTargetLayers?.length)continue;
     seen.add(serial);
     const source=rt.renderSourceLayers,target=rt.renderTargetLayers;
     const startPlan=__somataSpiralCarrierMorphPlan(0,0);
     if(!startPlan?.paths?.length)throw Error('Missing GPU-prepared start rail');
     if(priorPhase){
      // The old GPU resource is the actual painted endpoint. Rebuilding its
      // source/target *after* a phase change can produce a different paired
      // topology and is not a valid continuity assertion.
      const rails=source[0].__morphBoundaryRails;
      if(!Array.isArray(rails)||!rails.length)throw Error('Missing exact last-frame rail handoff');
      const endPlan={paths:rails.map(r=>r.cubics),
        branchPresence:rails.map(r=>r.present===true?1:0),
        pathCount:rails.length,cubicCount:rails.reduce((n,r)=>n+r.cubics.length,0)};
      const last=priorPhase.target[0],next=source[0];
      const sameProfile=last.profileNodes?.length===next.profileNodes?.length&&
       last.profileNodes.every((p,i)=>Math.abs(p.x-next.profileNodes[i].x)<1e-9&&
        Math.abs(p.y-next.profileNodes[i].y)<1e-9);
      result.push({serial,delta:difference(bitmap(endPlan),bitmap(startPlan)),prevPaths:endPlan.pathCount,nextPaths:startPlan.pathCount,prevCubics:endPlan.cubicCount,nextCubics:startPlan.cubicCount,prevAlpha:endPlan.branchPresence,nextAlpha:startPlan.branchPresence,prevFirstPoint:endPlan.paths?.[0]?.[0]?.p0,nextFirstPoint:startPlan.paths?.[0]?.[0]?.p0,
       endN:last.N,startN:next.N,endK:last.K,startK:next.K,
       endAngle:last.rotation,startAngle:next.rotation,sameProfile});
     }
     priorPhase={source:source.map(x=>({...x,profileNodes:x.profileNodes?.map(p=>({...p}))})),
      target:target.map(x=>({...x,profileNodes:x.profileNodes?.map(p=>({...p}))}))};
     rt.cycleStart=performance.now()-rt.transitionMs-25;
    }
   }finally{Math.random=random;
    if(runtimeState.morph.active)document.getElementById('btnMorph').click();}
   return result;
  })()`,{timeoutMs:82000,label:'12.6.7 real UI consecutive spiral phase seam'});
  assert.equal(data.length,3,'Three consecutive phase seams must be checked');
  for(const seam of data){
   assert.equal(seam.endN,seam.startN,'N changed at an instantaneous boundary');
   assert.equal(seam.endK,seam.startK,'K changed at an instantaneous boundary');
   assert.equal(seam.endAngle,seam.startAngle,'Rotation changed at an instantaneous boundary');
   assert.equal(seam.sameProfile,true,'End and start profile nodes diverged');
   assert(seam.delta<0.5,`Visible spiral carrier teleported at phase ${seam.serial}: ${JSON.stringify(seam)}`);
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 12.7.0 calm spline/rotation C0 (3 boundaries):',JSON.stringify(data));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
