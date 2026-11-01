'use strict';
// Opt-in topoCircle reproduces the experimental 10.4.19.29 clock.
// Old modes intentionally retain their selected speed (tested in v10457).
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:90000});
 try{
  const r=await h.evaluate(`(()=>{
   const old={mode:state.morph.mode,speed:state.morph.speedType,transition:state.morph.profileModeTransition,
    percent:state.morph.profileModeTransitionPercent,fourier:state.fourierMode};
   state.fourierMode=false;state.morph.mode='topoCircle';state.morph.speedType='linear';
   state.morph.profileModeTransition='phase';state.morph.profileModeTransitionPercent=100;
   const P=[{x:0,y:0},{x:.18,y:.48},{x:.51,y:-.29},{x:.74,y:.31},{x:1,y:0}];
   const Q=[{x:0,y:0},{x:.14,y:-.31},{x:.4,y:.48},{x:.69,y:-.23},{x:1,y:0}];
   function record(a,b,t,movement){
    const coords=[];let opacity=1;const stack=[];
    const ctx={__suppressStroke:true,__suppressFill:true,globalAlpha:1,
     save(){stack.push(this.globalAlpha);},restore(){this.globalAlpha=stack.pop();},
     beginPath(){},moveTo(x,y){coords.push(x,y);},lineTo(x,y){coords.push(x,y);},
     bezierCurveTo(x1,y1,x2,y2,x,y){coords.push(x1,y1,x2,y2,x,y);},
     quadraticCurveTo(x1,y1,x,y){coords.push(x1,y1,x,y);},closePath(){},stroke(){},fill(){}};
    drawAngularAnchorMorph(ctx,b,a,b,t,1,'phase',movement);return coords;
   }
   const distance=(a,b)=>{
    if(a.length!==b.length)throw Error('Morph changed command topology within a phase: '+a.length+' -> '+b.length);
    let d=0;for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i]+b[i]))throw Error('nonfinite control');d=Math.max(d,Math.abs(a[i]-b[i]));}return d;
   };
   const data=[];
   try{
    for(const mode of ['segments','spline'])for(const round of [0,55,120])for(const movement of ['linear','angular'])for(const changeN of [false,true]){
     const a=createLayer('v10455-a'),b=createLayer('v10455-b');
     Object.assign(a,{N:7,K:2,radius:180,rotation:0,rounding:round,fill:false,
      spiralEnabled:false,closedLoop:true,profileMode:mode,wholeCurveSpline:mode==='spline',profileNodes:P.map(p=>({...p}))});
     Object.assign(b,{N:changeN?9:7,K:changeN?3:2,radius:190,rotation:12,rounding:round,fill:false,
      spiralEnabled:false,closedLoop:true,profileMode:mode==='spline'?'segments':'spline',
      wholeCurveSpline:mode==='segments',profileNodes:Q.map(p=>({...p}))});
     const samples=[.001,.002,.499,.5,.501,.998,.999];
     const v=samples.map(t=>record(a,b,t,movement));
     const early=distance(v[0],v[1]),mid=distance(v[3],v[4]),late=distance(v[5],v[6]);
     data.push({mode,round,movement,changeN,early,mid,late,earlyRatio:early/mid,lateRatio:late/mid});
    }
   } finally {
    state.morph.mode=old.mode;state.morph.speedType=old.speed;state.morph.profileModeTransition=old.transition;
    state.morph.profileModeTransitionPercent=old.percent;state.fourierMode=old.fourier;
   }
   return data;
  })()`,{label:'Bezier velocity at Blue Morph cycle seams',timeoutMs:90000});
  assert.equal(r.length,24);
  for(const v of r){
   assert(v.mid>1e-7,'interior motion absent: '+JSON.stringify(v));
   assert(v.earlyRatio<.14&&v.lateRatio<.14,
    'topoCircle opt-in mode lacks experimental geometric easing: '+JSON.stringify(v));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  const maxEarly=Math.max(...r.map(v=>v.earlyRatio)),maxLate=Math.max(...r.map(v=>v.lateRatio));
  console.log('PASS v10455: 24 geometric spline↔segment cases, opt-in experimental timing only; maximum edge/mid speed ratios '+maxEarly.toFixed(4)+' / '+maxLate.toFixed(4));
 } finally{await h.close();}
})().catch(e=>{console.error('FAIL v10455',e.stack||e);process.exitCode=1;});
