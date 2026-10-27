'use strict';
// Compare VISIBLE Canvas2D strokes, not counts of stored profile nodes.
// Unequal spline-node counts used to pad the target with repeated terminal
// nodes, introducing a different Catmull-Rom/rounding contour at cycle end.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:35000});
 try{
  const report=await h.evaluate(`(()=>{
   const oldFourier=state.fourierMode;state.fourierMode=false;
   const output=[];
   const setup=(nodes,rounding)=>{
    const a=createLayer('visible-spline-start'),b=createLayer('visible-spline-target');
    Object.assign(a,{N:7,K:2,spiralEnabled:false,closedLoop:true,radius:220,rotation:0,rounding,
      profileMode:'spline',lineVisible:true,fill:false,profileNodes:[{x:0,y:0},{x:.17,y:.4},{x:.5,y:-.2},{x:.7,y:.13},{x:1,y:0}]});
    Object.assign(b,a,{id:'visible-spline-target',profileNodes:Array.from({length:nodes},(_,i)=>
      ({x:i/(nodes-1),y:i===0||i===nodes-1?0:Math.sin(i*2.4)*.3}))});
    return [a,b];
   };
   const paint=(fn)=>{
    const canvas=document.createElement('canvas');canvas.width=690;canvas.height=690;
    const ctx=canvas.getContext('2d');ctx.translate(345,345);ctx.strokeStyle='#ffffff';ctx.lineWidth=2;
    fn(ctx);return ctx.getImageData(0,0,690,690).data;
   };
   const diff=(a,b)=>{
    if(a.length!==b.length)return Infinity;let count=0,sum=0,max=0;
    for(let i=3;i<a.length;i+=4){const d=Math.abs(a[i]-b[i]);if(d>4)count++;sum+=d;max=Math.max(max,d);}
    return {count,mean:sum/(a.length/4),max};
   };
   try{
    for(const nodes of [3,8])for(const rounding of [0,50,120]){
     const [a,b]=setup(nodes,rounding);
     const render=(t)=>paint(ctx=>drawAngularAnchorMorph(ctx,b,a,b,t,1,'phase','angular'));
     const staticPaint=(layer)=>paint(ctx=>{
      for(const p of buildOrbitPolylines(layer)){
       ctx.beginPath();splinePathForDraw(ctx,p.points,p.closed,getRoundingStrength(layer.rounding),p.cornerFlags||[],p.bridgeRoundFlags||[]);ctx.stroke();
      }
     });
     const t0=render(0),t1=render(1),near=render(.9999),static0=staticPaint(a),static1=staticPaint(b);
     output.push({nodes,rounding,start:diff(t0,static0),end:diff(t1,static1),handoff:diff(near,t1)});
    }
   }finally{state.fourierMode=oldFourier;}
   return output;
  })()`,{label:'real Canvas2D visible Polygon spline transition'});
  assert.equal(report.length,6);
  for(const r of report){
   assert(r.start.mean<.035,'starting contour changed: '+JSON.stringify(r));
   assert(r.end.mean<.030,'final Morph contour differs from real static contour: '+JSON.stringify(r));
   assert(r.handoff.mean<.006,'last Morph frame still jumps: '+JSON.stringify(r));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10432: visible Polygon spline curve exact at 0% and 100%, smooth at 99.99% (unequal nodes, rounded profiles)');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10432',e.stack||e);process.exitCode=1;});
