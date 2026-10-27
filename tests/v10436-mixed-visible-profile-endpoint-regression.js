'use strict';
// An animated spline<->segments Morph must approach the REAL rounded target
// contour, not a temporary Catmull-Rom approximation of it. Compare visible
// Canvas2D pixels at the endpoint and just before it.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:35000});
 try{
  const output=await h.evaluate(`(()=>{
   const old={fourier:state.fourierMode,phase:state.morph.profileModeTransition,percent:state.morph.profileModeTransitionPercent};
   state.fourierMode=false;state.morph.profileModeTransition='phase';state.morph.profileModeTransitionPercent=100;
   const paint=fn=>{const c=document.createElement('canvas');c.width=700;c.height=700;
    const ctx=c.getContext('2d');ctx.translate(350,350);ctx.lineWidth=2;ctx.strokeStyle='#fff';fn(ctx);
    return ctx.getImageData(0,0,700,700).data;};
   const diff=(a,b)=>{let sum=0,count=0;for(let i=3;i<a.length;i+=4){const d=Math.abs(a[i]-b[i]);sum+=d;if(d>5)count++;}return {mean:sum/(a.length/4),count};};
   const out=[];
   try{
    for(const [srcMode,dstMode] of [['spline','segments'],['segments','spline']])for(const rounding of [0,30,60]){
     const a=createLayer('mixed-src'),b=createLayer('mixed-dst');
     Object.assign(a,{N:7,K:2,profileMode:srcMode,spiralEnabled:false,closedLoop:true,
      radius:220,rounding,fill:false,profileNodes:[{x:0,y:0},{x:.2,y:.5},{x:.46,y:-.4},{x:.7,y:.3},{x:1,y:0}]});
     Object.assign(b,a,{id:'mixed-dst',profileMode:dstMode,
      profileNodes:[{x:0,y:0},{x:.22,y:-.4},{x:.48,y:.5},{x:.7,y:-.2},{x:1,y:0}]});
     const anim=t=>paint(ctx=>drawAngularAnchorMorph(ctx,b,a,b,t,1,'phase','angular'));
     const stat=paint(ctx=>{for(const p of buildOrbitPolylines(b)){
       ctx.beginPath();const round=getRoundingStrength(b.rounding);
       if(useSmoothSplinePath(b,round,p))splinePathForDraw(ctx,p.points,p.closed,round,p.cornerFlags||[],p.bridgeRoundFlags||[]);
       else roundPolylineForDraw(ctx,p.points,p.closed,round,p.cornerFlags||[]);ctx.stroke();
     }});
     const end=anim(1),near=anim(.9999);
     out.push({srcMode,dstMode,rounding,end:diff(end,stat),near:diff(near,end)});
    }
   }finally{state.fourierMode=old.fourier;state.morph.profileModeTransition=old.phase;state.morph.profileModeTransitionPercent=old.percent;}
   return out;
  })()`,{label:'real mixed Polygon spline/segments endpoint'});
  assert.equal(output.length,6);
  for(const row of output){
   assert(row.end.mean<0.28,'Morph endpoint replaced by unrelated static curve: '+JSON.stringify(row));
   assert(row.near.mean<0.18,'Last interpolated frame jumps to its endpoint: '+JSON.stringify(row));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10436: mixed spline/segments morph continuously approaches the actual static rounded endpoint');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10436',e.stack||e);process.exitCode=1;});
