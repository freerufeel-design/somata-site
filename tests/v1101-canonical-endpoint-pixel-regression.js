'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:90,evalTimeoutMs:90000});
 try{
 const cases=await h.evaluate(`(()=>{
  const oldMode=state.morph.mode,oldFourier=state.fourierMode,results=[];
  state.fourierMode=false;
  const a=[{x:0,y:0},{x:.16,y:.42},{x:.4,y:-.22},{x:.66,y:.38},{x:1,y:0}];
  const b=[{x:0,y:0},{x:.22,y:-.32},{x:.52,y:.46},{x:.8,y:-.2},{x:1,y:0}];
  const c=document.createElement('canvas');c.width=c.height=450;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  const paint=fn=>{ctx.resetTransform();ctx.clearRect(0,0,450,450);ctx.translate(225,225);
   ctx.globalAlpha=1;ctx.lineWidth=2.5;ctx.lineCap='round';ctx.strokeStyle='#ffffff';ctx.fillStyle='#ffffff';ctx.__suppressFill=true;
   fn();const rgba=ctx.getImageData(0,0,450,450).data,x=new Uint8Array(450*450);
   for(let i=0;i<x.length;i++)x[i]=rgba[4*i+3];return x;};
  const difference=(x,y)=>{let sum=0,area=0,max=0;for(let i=0;i<x.length;i++){
   const n=Math.abs(x[i]-y[i]);sum+=n;if(x[i]>8||y[i]>8)area++;max=Math.max(max,n);
  }return{mean:sum/x.length,contourMean:sum/Math.max(1,area),max,area};};
  const specs=[
   {profile0:'segments',profile1:'segments',n0:7,n1:10,round0:0,round1:0},
   {profile0:'segments',profile1:'segments',n0:7,n1:10,round0:85,round1:55},
   {profile0:'spline',profile1:'spline',n0:7,n1:10,round0:80,round1:65},
   {profile0:'segments',profile1:'spline',n0:7,n1:10,round0:75,round1:85},
   {profile0:'spline',profile1:'segments',n0:10,n1:7,round0:85,round1:72},
   {profile0:'spline',profile1:'spline',n0:7,n1:7,round0:88,round1:66,wholeCurve:true},
   {profile0:'segments',profile1:'segments',n0:7,n1:7,round0:40,round1:94,mono:true},
  ];
  try{for(const mode of ['topology','calm','circleSlide'])for(const spec of specs){
   state.morph.mode=mode;
   const src=createLayer('src'),dst=createLayer('dst');
   Object.assign(src,{N:spec.n0,K:2,radius:150,rotation:0,rounding:spec.round0,roundingMode:spec.mono?'monoradius':'standard',
    profileMode:spec.profile0,profileNodes:a.map(p=>({...p})),closedLoop:true,fill:false,spiralEnabled:false,
    wholeCurveSpline:spec.wholeCurve===true});
   Object.assign(dst,src,{id:'dst',N:spec.n1,K:spec.n1===7?2:3,rotation:spec.n0!==spec.n1?16:0,
    rounding:spec.round1,profileMode:spec.profile1,profileNodes:b.map(p=>({...p}))});
   const staticFrom=paint(()=>renderLayerOrbitPaths(ctx,src));
   const staticTo=paint(()=>renderLayerOrbitPaths(ctx,dst));
   const draw=t=>paint(()=>{
    const layer={...dst,rounding:src.rounding+(dst.rounding-src.rounding)*t};
    if(mode==='circleSlide')drawCircleSlideMorph(ctx,layer,src,dst,t,1,'phase');
    else drawLinearAnchorMorph(ctx,layer,src,dst,t,1,'phase');
   });
   const first=draw(0),last=draw(1),nearFirst=draw(.0005),nearLast=draw(.9995);
   results.push({mode,...spec,first:difference(staticFrom,first),last:difference(staticTo,last),
    nearFirst:difference(staticFrom,nearFirst),nearLast:difference(staticTo,nearLast),
    move:difference(staticFrom,draw(.5))});
  }}finally{state.morph.mode=oldMode;state.fourierMode=oldFourier;}
  return results;
 })()`,{timeoutMs:90000,label:'canonical static and dynamic 10.4 endpoints'});
 for(const x of cases){
  console.log(`${x.mode} ${x.profile0}->${x.profile1} N${x.n0}->${x.n1} round ${x.round0}->${x.round1} static t=0:${x.first.contourMean.toFixed(3)} t=1:${x.last.contourMean.toFixed(3)} near 1:${x.nearLast.contourMean.toFixed(3)}`);
  assert(x.first.contourMean<.25,'Static to animation first frame mismatch '+JSON.stringify(x));
  assert(x.last.contourMean<.25,'Animation last frame to Static mismatch '+JSON.stringify(x));
  assert(x.nearFirst.contourMean<3,'Near-start visible snap '+JSON.stringify(x));
  assert(x.nearLast.contourMean<3,'Near-end visible snap '+JSON.stringify(x));
 }
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log(`PASS ${cases.length} endpoint sets, matching Static with unchanged 10.4 motion`);
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL:',e.stack||e);process.exitCode=1});
