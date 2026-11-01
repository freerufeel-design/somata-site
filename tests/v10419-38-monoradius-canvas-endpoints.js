'use strict';
// Regress actual native Canvas paths, because Canvas's canonical endpoint
// blend must not be scaled a second time after the Mono Radius fit.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:125,evalTimeoutMs:60000});
 try {
 const rows=await h.evaluate(`(()=>{
  const saved={fourier:state.fourierMode,mode:state.morph.mode,guide:state.showRoundingGuides};
  const cn=document.createElement('canvas');cn.width=cn.height=580;
  const ctx=cn.getContext('2d',{willReadFrequently:true});
  const paint=draw=>{
   ctx.resetTransform();ctx.clearRect(0,0,580,580);ctx.translate(290,290);
   ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.lineJoin='round';draw();
   const a=ctx.getImageData(0,0,580,580).data;
   const alpha=new Uint8Array(a.length/4);let outer=0;
   for(let i=0;i<alpha.length;i++){const b=a[i*4+3];alpha[i]=b;
    if(b>64)outer=Math.max(outer,Math.hypot(i%580-290,Math.floor(i/580)-290));}
   return{alpha,outer};
  };
  const diff=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length;};
  const rows=[];
  try {
   state.fourierMode=false;state.showRoundingGuides=false;
   for(const profileMode of ['segments','spline'])
    for(const rounding of [0,60,120])
     for(const movement of ['linear','angular']){
      state.morph.mode=movement==='linear'?'topoCircle':'circleSlide';
      const src=createLayer('mono-native-src'),dst=createLayer('mono-native-dst');
      Object.assign(src,{N:7,K:2,radius:184,rounding,roundingMode:'monoradius',profileMode,
       profileNodes:[{x:0,y:0},{x:.23,y:.4},{x:.61,y:-.22},{x:1,y:0}],
       closedLoop:true,spiralEnabled:false,fill:false});
      Object.assign(dst,src,{N:11,K:3,rotation:25});
      const initial=paint(()=>renderLayerOrbitPaths(ctx,src)),terminal=paint(()=>renderLayerOrbitPaths(ctx,dst));
      const frame=t=>paint(()=>movement==='linear'
       ?MorphRendering.drawLinearAnchorMorph(ctx,src,src,dst,t,1,'phase')
       :MorphRendering.drawCircleSlideMorph(ctx,src,src,dst,t,1,'phase'));
      const first=frame(0),middle=frame(.5),last=frame(1);
      rows.push({profileMode,rounding,movement,
       begin:diff(initial.alpha,first.alpha),end:diff(terminal.alpha,last.alpha),
       outerStart:first.outer,outerMiddle:middle.outer,outerEnd:last.outer});
     }
  }finally{state.fourierMode=saved.fourier;state.morph.mode=saved.mode;state.showRoundingGuides=saved.guide;}
  return rows;
 })()`,{timeoutMs:58000,label:'Mono Radius real Canvas2D endpoints and intermediate sizing'});
 const bad=rows.filter(r=>r.begin>0.025||r.end>0.025||
   Math.abs(r.outerMiddle-184)>2||Math.abs(r.outerStart-184)>2||Math.abs(r.outerEnd-184)>2);
 if(bad.length)console.error('MonoRadius Canvas failures:',bad);
 assert.equal(bad.length,0, 'Mono Radius should fit base circle and match Static endpoints');
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('MONORADIUS CANVAS ENDPOINTS: PASS',rows.length,'segment/spline, linear/angular, rounded/unrounded scenarios');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL Mono Radius Canvas endpoints',e.stack||e);process.exitCode=1});
