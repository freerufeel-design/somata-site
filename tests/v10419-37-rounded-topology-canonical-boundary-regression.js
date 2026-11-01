'use strict';
// A rounded polygon must begin and end on the exact authored Static contour
// even when N/K or orbit multiplicity differs. Original moving-anchor traces
// remain covered by v10481-preserve-morph-anchor-motion.js.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:70000});
 try{
  const rows=await h.evaluate(`(()=>{
   const cn=document.createElement('canvas');cn.width=560;cn.height=560;
   const ctx=cn.getContext('2d',{willReadFrequently:true});
   const paint=fn=>{
    ctx.resetTransform();ctx.clearRect(0,0,560,560);ctx.translate(280,280);
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.lineJoin='round';fn();
    const rgba=ctx.getImageData(0,0,560,560).data,alpha=new Uint8Array(rgba.length/4);
    for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];return alpha;
   };
   const error=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length;};
   const P=[{x:0,y:0},{x:.17,y:.45},{x:.5,y:-.3},{x:.8,y:.22},{x:1,y:0}];
   const Q=[{x:0,y:0},{x:.18,y:-.26},{x:.46,y:.34},{x:.75,y:-.19},{x:1,y:0}];
   const oldMode=state.morph.mode,oldFourier=state.fourierMode;
   const rows=[];
   try{
    state.fourierMode=false;
    for(const mode of ['topology','calm','circleSlide','topoCircle'])
     for(const [n0,k0,n1,k1] of [[7,2,10,3],[12,4,8,2],[7,2,7,2]])
      for(const [round0,round1] of [[72,72],[0,72],[72,0]])
       for(const mono of [false,true]){
        state.morph.mode=mode;
        const a=createLayer('rounded-boundary-a'),b=createLayer('rounded-boundary-b');
        Object.assign(a,{N:n0,K:k0,radius:175,rotation:5,rounding:round0,
         roundingMode:mono?'monoradius':'standard',profileMode:'segments',
         profileNodes:P,closedLoop:true,fill:false,spiralEnabled:false});
        Object.assign(b,a,{N:n1,K:k1,rounding:round1,
         profileNodes:n0===n1&&k0===k1?Q.slice(1):Q});
        const frame=t=>{
         const lay={...b,rounding:interpolateMorphRounding(round0,round1,t)};
         return paint(()=>drawAngularAnchorMorph(ctx,lay,a,b,t,1,'phase',mode==='circleSlide'?'angular':'linear'));
        };
        const initial=paint(()=>renderLayerOrbitPaths(ctx,a)),terminal=paint(()=>renderLayerOrbitPaths(ctx,b));
        const first=frame(0),last=frame(1),nearFirst=frame(.000001),nearLast=frame(.999999),middle=frame(.5);
        rows.push({mode,n0,k0,n1,k1,round0,round1,mono,
         e0:error(initial,first),e1:error(terminal,last),
         near0:error(initial,nearFirst),near1:error(terminal,nearLast),
         motion:error(initial,middle)});
       }
   }finally{state.morph.mode=oldMode;state.fourierMode=oldFourier;}
   return rows;
  })()`,{timeoutMs:65000,label:'rounded topology endpoints on real Canvas2D'});
  assert.equal(rows.length,72);
  for(const q of rows){
   assert(q.e0<.15&&q.e1<.15,'Static/Morph rounded endpoint mismatch: '+JSON.stringify(q));
   assert(q.near0<.15&&q.near1<.15,'rounded first/last rendered frame jumps: '+JSON.stringify(q));
   assert(q.motion>.05,'rounded Morph stopped moving: '+JSON.stringify(q));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 72 rounded topology handoffs: original first/last, near endpoints, Mono Radius, four modes');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL rounded topology boundary',err.stack||err);process.exitCode=1});
