'use strict';
// Real Canvas2D handoff regression for LINEAR Polygon Morph. The original
// 10.4.19.24 interpolated rounded polylines with a different solver from Static,
// causing 14–21 px endpoint jumps. It also rasterized divided spline cubics
// differently from the undivided authored target. Test the visible output,
// including the last near-end frame, for segments/local spline/whole spline.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:60000});
 try{
  const result=await h.evaluate(`(()=>{
   const saved={fourier:state.fourierMode,transition:state.morph.profileModeTransition};
   const P=[{x:0,y:0},{x:.17,y:.42},{x:.48,y:-.32},{x:.72,y:.26},{x:1,y:0}],
    Q=[{x:0,y:0},{x:.15,y:-.34},{x:.44,y:.48},{x:.68,y:-.21},{x:1,y:0}],
    U=Array.from({length:8},(_,i)=>({x:i/7,y:(i===0||i===7)?0:Math.sin(i*2.4)*.3}));
   const canvas=document.createElement('canvas');canvas.width=580;canvas.height=580;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   const paint=draw=>{ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,580,580);
    ctx.translate(290,290);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.lineJoin='round';
    draw();const raw=ctx.getImageData(0,0,580,580).data,alpha=new Uint8Array(raw.length/4);
    for(let i=0;i<alpha.length;i++)alpha[i]=raw[4*i+3];return alpha;};
   const diff=(a,b)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;};
   const cases=[];
   try{
    state.fourierMode=false;state.morph.profileModeTransition='phase';
    for(const knots of [5,8])for(const profile of ['segments','spline-local','spline-whole'])
     for(const rounding of [0,55,120]){
      const src=createLayer('linear-src'),dst=createLayer('linear-dst');
      const spline=profile!=='segments',whole=profile==='spline-whole';
      Object.assign(src,{N:7,K:2,spiralEnabled:false,closedLoop:true,radius:180,rotation:0,rounding,
       profileMode:spline?'spline':'segments',wholeCurveSpline:whole,lineVisible:true,fill:false,profileNodes:P});
      Object.assign(dst,src,{id:'linear-dst',profileNodes:knots===5?Q:U});
      const morph=t=>paint(()=>drawAngularAnchorMorph(ctx,dst,src,dst,t,1,'phase','linear'));
      const staticDraw=layer=>paint(()=>{for(const path of buildOrbitPolylines(layer)){
       ctx.beginPath();const r=getRoundingStrength(layer.rounding);
       if(useSmoothSplinePath(layer,r,path))splinePathForDraw(ctx,path.points,path.closed,r,path.cornerFlags||[],path.bridgeRoundFlags||[],layer.wholeCurveSpline===true);
       else roundPolylineForDraw(ctx,path.points,path.closed,r,path.cornerFlags||[]);
       ctx.stroke();
      }});
      const a=staticDraw(src),z=staticDraw(dst),f0=morph(0),mid=morph(.5),p95=morph(.95),p995=morph(.995),p9999=morph(.9999),f1=morph(1);
      // A geometry recorder must never receive an extra alpha-blended path.
      // Only the native Canvas2D rasterizer needs the terminal antialias blend.
      let strokes=0,curves=0;
      const rec={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},
       bezierCurveTo(){curves++;},closePath(){},stroke(){strokes++;},fill(){},set globalAlpha(v){}};
      drawAngularAnchorMorph(rec,dst,src,dst,.9999,1,'phase','linear');
      cases.push({knots,profile,rounding,start:diff(a,f0),end:diff(z,f1),near:diff(z,p9999),
       mid:diff(mid,z),lastDelta:diff(p9999,f1),late:diff(p95,z),preLast:diff(p995,z),strokes,curves});
     }
   }finally{state.fourierMode=saved.fourier;state.morph.profileModeTransition=saved.transition;}
   return cases;
  })()`,{label:'18 real Canvas2D linear Morph endpoint/late-frame comparisons',timeoutMs:60000});
  assert.equal(result.length,18);
  for(const r of result){
   assert(r.start<.001&&r.end<.001,'Morph endpoints differ from authored Static: '+JSON.stringify(r));
   assert(r.near<.020&&r.lastDelta<.020,'terminal visible jump: '+JSON.stringify(r));
   assert(r.mid>.02,'Morph geometry did not change: '+JSON.stringify(r));
   assert(r.strokes===1,'canonical geometry recorder received a duplicate contour: '+JSON.stringify(r));
   assert(Number.isFinite(r.late)&&Number.isFinite(r.preLast),'nonfinite late frame: '+JSON.stringify(r));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10449: 18 rounded linear Polygon Morph scenarios: segment/local/whole spline, endpoint and terminal pixel parity');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10449',e.stack||e);process.exitCode=1;});
