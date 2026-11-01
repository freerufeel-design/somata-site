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
    radius:180,rotation:17,rounding:135,profileMode:'segments',
    profileNodes:[{x:0,y:0},{x:.2,y:.2},{x:.7,y:-.22},{x:1,y:0}]});
   const second=createLayer('phase-handoff-2');
   Object.assign(second,{...layer,id:second.id,N:11,K:4,radius:145,rotation:-47,
     profileNodes:[{x:0,y:0},{x:.2,y:-.3},{x:.55,y:.35},{x:1,y:0}]});
   const third=createLayer('phase-handoff-3');
   Object.assign(third,{...layer,id:third.id,N:13,K:3,radius:120,rotation:91,
     profileNodes:[{x:0,y:0},{x:.4,y:-.2},{x:.8,y:.1},{x:1,y:0}]});
   state.layers=[layer,second,third];state.activeLayerId=layer.id;
   state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
   state.morph.intervalSec=.5;
   Object.assign(state.morph.options,{byShape:true,byVertices:true,bySteps:true,
    byRotation:false,bySize:false,byColor:false,byStrokeWidth:false,
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
   const maxGap=(a,b)=>{
     let mx=0;
     if(a.paths.length!==b.paths.length)throw Error('Path count diverged near t=0');
     for(let pi=0;pi<a.paths.length;pi++){
       if(a.paths[pi].length!==b.paths[pi].length)throw Error('Cubic count diverged near t=0');
       for(let j=0;j<a.paths[pi].length;j++)for(const name of ['p0','c1','c2','p3']){
         const p=a.paths[pi][j][name],q=b.paths[pi][j][name];
         mx=Math.max(mx,Math.hypot(p.x-q.x,p.y-q.y));
       }
     }
     return mx;
   };
   const result=[];let priorPhase=null;
   try{
    document.getElementById('btnMorph').click();
    const seen=new Set(),start=performance.now();
    while(performance.now()-start<9000&&result.length<9){
     await new Promise(resolve=>setTimeout(resolve,35));
     const rt=runtimeState.morph;
     if(!rt.active)throw Error('Blue Morph unexpectedly stopped');
     const serial=rt.lampCycleSerial;
     if(seen.has(serial)||!rt.renderSourceLayers?.length||!rt.renderTargetLayers?.length)continue;
     seen.add(serial);
     const source=rt.renderSourceLayers,target=rt.renderTargetLayers;
     const startPlans=state.layers.map((_,i)=>__somataSpiralCarrierMorphPlan(i,0));
     const tinyPlans=state.layers.map((_,i)=>__somataSpiralCarrierMorphPlan(i,.000001));
     if(startPlans.some(plan=>!plan?.paths?.length))throw Error('Missing GPU-prepared start rail');
     if(priorPhase){
      // The old GPU resource is the actual painted endpoint. Rebuilding its
      // source/target *after* a phase change can produce a different paired
      // topology and is not a valid continuity assertion.
      for(let li=0;li<state.layers.length;li++){
       const rails=source[li].__morphBoundaryRails;
       if(!Array.isArray(rails)||!rails.length)throw Error('Missing exact last-frame rail handoff L'+li+' '+JSON.stringify({source:source[li]?.spiralEnabled,target:priorPhase.target[li]?.spiralEnabled,layer:state.layers[li]?.spiralEnabled,renderLayers:rt.renderSourceLayers.map(x=>[x.id,x.spiralEnabled,Boolean(x.__morphBoundaryRails)]),serial}));
       const endPlan={paths:rails.map(r=>r.cubics),
         branchPresence:rails.map(r=>r.present===true?1:0)};
       const startPlan=startPlans[li];
       const last=priorPhase.target[li],next=source[li];
       const sameProfile=last.profileNodes?.length===next.profileNodes?.length&&
        last.profileNodes.every((p,i)=>Math.abs(p.x-next.profileNodes[i].x)<1e-9&&
         Math.abs(p.y-next.profileNodes[i].y)<1e-9);
       result.push({serial,li,nearStartGap:maxGap(startPlan,tinyPlans[li]),delta:difference(bitmap(endPlan),bitmap(startPlan)),
        endN:last.N,startN:next.N,endK:last.K,startK:next.K,
        endAngle:last.rotation,startAngle:next.rotation,sameProfile});
      }
     }
     priorPhase={source:source.map(x=>({...x,profileNodes:x.profileNodes?.map(p=>({...p}))})),
      target:target.map(x=>({...x,profileNodes:x.profileNodes?.map(p=>({...p}))}))};
     rt.cycleStart=performance.now()-rt.transitionMs-25;
    }
   }finally{Math.random=random;
    if(runtimeState.morph.active)document.getElementById('btnMorph').click();}
   return result;
  })()`,{timeoutMs:82000,label:'12.6.7 real UI consecutive spiral phase seam'});
  assert.equal(data.length,9,'Three consecutive phase seams across three layers must be checked');
  for(const seam of data){
   assert.equal(seam.endN,seam.startN,'N changed at an instantaneous boundary');
   assert.equal(seam.endK,seam.startK,'K changed at an instantaneous boundary');
   assert.equal(seam.endAngle,seam.startAngle,'Rotation changed at an instantaneous boundary');
   assert.equal(seam.sameProfile,true,'End and start profile nodes diverged');
   assert(seam.nearStartGap<.05,`Near-start sharp/rounded tip jump ${JSON.stringify(seam)}`);
   assert(seam.delta<0.5,`Visible spiral carrier teleported at phase ${seam.serial}: ${JSON.stringify(seam)}`);
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 12.7.1 3 spiral layers C0 near boundary (3x3 boundaries):',JSON.stringify(data));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
