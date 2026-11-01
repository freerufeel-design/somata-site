'use strict';
// Exact reproducer for the old all-or-nothing live-corner gate at t=.0001
// and t=.9999. Compare pixel geometry on the *same* unmoved carrier; a large
// difference cannot be attributed to the Morph movement.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:90000});
 try{
  const data=await h.evaluate(`(()=>{
   const cv=document.createElement('canvas');cv.width=550;cv.height=550;
   const ctx=cv.getContext('2d',{willReadFrequently:true});
   const layer=createLayer('phase-gate-test');Object.assign(layer,{N:4,K:2,radius:100,rounding:150,roundingMaxRadiusDrop:30});
   const polygon=[{x:-180,y:-80},{x:-70,y:-110},{x:-50,y:50},{x:80,y:90},{x:110,y:-90},{x:180,y:120}];
   const micro=[{x:100,y:0},{x:100+.000001,y:.000002},{x:100+.000003,y:.000005},{x:0,y:100},{x:-100,y:0},{x:0,y:-100}];
   const spiral=Array.from({length:23},(_,i)=>{const a=i*Math.PI*3.7/22,r=20+3.6*i;return {x:r*Math.cos(a),y:r*Math.sin(a)};});
   const phases=[0,.00000001,.00008,.000099,.0001,.000101,.00012,.0005,.004,.015,.034999,.035001,.5,.964999,.965001,.996,.9995,.99988,.999899,.999901,.99992,.99999999,1];
   const draw=(p,profile,closed,t)=>{
    ctx.clearRect(0,0,550,550);ctx.save();ctx.translate(275,275);ctx.beginPath();
    drawMorphPathQuality(ctx,p,closed,1.5,profile,null,false,'smooth',[],[],false,1,morphFilletRecoveryMix(t),layer);
    ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.restore();
    const d=ctx.getImageData(0,0,550,550).data;
    return Uint8Array.from({length:550*550},(_,i)=>d[i*4+3]);
   };
   const compare=(a,b)=>{let diff=0,pixels=0;for(let i=0;i<a.length;i++){
    const e=Math.abs(a[i]-b[i]);diff+=e;if(e>40)pixels++;}
    return {mean:diff/Math.max(1,a.length),pixels};};
   const results=[];
   for(const [name,p,closed] of [['polygon',polygon,true],['micro',micro,true],['spiral',spiral,false]])
    for(const profile of ['segments','spline']){
     const imgs=phases.map(t=>draw(p,profile,closed,t));
     const steps=imgs.slice(1).map((im,i)=>({from:phases[i],to:phases[i+1],...compare(imgs[i],im)}));
     results.push({name,profile,steps,firstLast:compare(imgs[0],imgs.at(-1))});
    }
   return results;
  })()`,{timeoutMs:85000,label:'11.0.8 live-corner gate continuous contour'});
  let maxNearGate=0,maxBoundary=0;
  for(const r of data){
   assert.equal(r.firstLast.pixels,0,'same authored contour at phase 0 and 1');
   for(const s of r.steps){
    if(Math.abs(s.from-.0001)<.00003||Math.abs(s.from-.9999)<.00003){maxNearGate=Math.max(maxNearGate,s.mean);assert(s.mean<.2,`visible gate pop ${JSON.stringify({r:r.name,profile:r.profile,s})}`);}
    if((s.from>.0349&&s.to<.0351)||(s.from>.9649&&s.to<.9651)){assert(s.mean<.2,`blend-to-exact join pop ${JSON.stringify({r:r.name,profile:r.profile,s})}`);}
    if(s.from<.000001||s.to>.999999){maxBoundary=Math.max(maxBoundary,s.mean);assert(s.mean<.12,`first/last frame pop ${JSON.stringify({r:r.name,profile:r.profile,s})}`);}
   }
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log(`PASS 11.0.8: ${data.length} held-geometry browser scenarios, 23 phase samples; near old gate max mean ${maxNearGate.toFixed(5)}, phase ends ${maxBoundary.toFixed(5)}`);
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL phase recovery',e.stack||e);process.exitCode=1});
