'use strict';
// Real Canvas2D pixel-sequence test for optional topoCircle smoothing; it must
// not merely agree at t=0/1, but reduce the maximum per-time visual motion
// compared with the original linear-time control-point interpolation.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:120000});
 try{
  const cases=await h.evaluate(`(()=>{
   const prev={mode:state.morph.mode,speed:state.morph.speedType,transition:state.morph.profileModeTransition,
    pct:state.morph.profileModeTransitionPercent,fourier:state.fourierMode},clock=mixedProfileGeometryClock;
   state.morph.mode='topoCircle';state.morph.speedType='linear';state.morph.profileModeTransition='phase';
   state.morph.profileModeTransitionPercent=100;state.fourierMode=false;
   const canvas=document.createElement('canvas');canvas.width=360;canvas.height=360;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   const P=[{x:0,y:0},{x:.18,y:.48},{x:.51,y:-.29},{x:.74,y:.31},{x:1,y:0}];
   const Q=[{x:0,y:0},{x:.14,y:-.31},{x:.4,y:.48},{x:.69,y:-.23},{x:1,y:0}];
   const times=[...Array.from({length:41},(_,i)=>i/1000),...Array.from({length:96},(_,i)=>(i+5)/100)];
   const draw=(a,b,t)=>{
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,360,360);ctx.translate(180,180);
    ctx.strokeStyle='white';ctx.lineWidth=1.5;ctx.lineJoin='round';
    drawAngularAnchorMorph(ctx,b,a,b,t,1,'phase','linear');
    const d=ctx.getImageData(0,0,360,360).data,alpha=new Uint8Array(d.length/4);
    for(let i=0;i<alpha.length;i++)alpha[i]=d[4*i+3];return alpha;
   };
   const results=[];
   try{
    for(const mode of ['segments','spline'])for(const round of [0,55,120]){
     const a=createLayer('v10456-source'),b=createLayer('v10456-target');
     Object.assign(a,{N:7,K:2,radius:135,rotation:0,fill:false,closedLoop:true,
      spiralEnabled:false,rounding:round,profileMode:mode,
      wholeCurveSpline:mode==='spline',profileNodes:P.map(p=>({...p}))});
     Object.assign(b,{N:9,K:3,radius:145,rotation:12,fill:false,closedLoop:true,
      spiralEnabled:false,rounding:round,profileMode:mode==='spline'?'segments':'spline',
      wholeCurveSpline:mode==='segments',profileNodes:Q.map(p=>({...p}))});
     const scans=[];
     for(const originalTiming of [true,false]){
      mixedProfileGeometryClock=originalTiming?((t)=>t):clock;
      let previous=null,prevT=0,peak=0,sum=0;
      for(const t of times){const pixels=draw(a,b,t);
       if(previous){let delta=0;for(let i=0;i<pixels.length;i++)delta+=Math.abs(pixels[i]-previous[i]);
        const rate=delta/(pixels.length*(t-prevT));peak=Math.max(peak,rate);sum+=rate;}
       previous=pixels;prevT=t;
      }
      scans.push({peak,mean:sum/(times.length-1)});
     }
     results.push({mode,round,linear:scans[0].peak,smooth:scans[1].peak,
      improvement:1-scans[1].peak/scans[0].peak});
    }
   }finally{
    mixedProfileGeometryClock=clock;state.morph.mode=prev.mode;state.morph.speedType=prev.speed;
    state.morph.profileModeTransition=prev.transition;
    state.morph.profileModeTransitionPercent=prev.pct;state.fourierMode=prev.fourier;
   }
   return results;
  })()`,{label:'Canvas mixed-profile optical speed',timeoutMs:120000});
  assert.equal(cases.length,6);
  for(const c of cases)assert(c.smooth<c.linear*.98,
   'mixed-profile speed remains visibly spiky: '+JSON.stringify(c));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10456: Canvas first/whole/final phase pixel rates improved for 6 scenarios '+JSON.stringify(cases));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10456',e.stack||e);process.exitCode=1;});
