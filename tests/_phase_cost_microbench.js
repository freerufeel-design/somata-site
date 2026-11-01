'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:90000});
 try{
  const out=await h.evaluate(`(()=>{
   const old={mode:state.morph.mode,fourier:state.fourierMode};state.fourierMode=false;state.morph.mode='circleSlide';
   const P=[{x:0,y:0},{x:.15,y:.45},{x:.4,y:-.25},{x:.72,y:.18},{x:1,y:0}];
   const Q=[{x:0,y:0},{x:.12,y:-.36},{x:.32,y:.2},{x:.56,y:-.27},{x:.8,y:.3},{x:1,y:0}];
   const canvas=document.createElement('canvas');canvas.width=canvas.height=900;
   const native=canvas.getContext('2d',{willReadFrequently:false});native.translate(450,450);
   const ctx=createGeometryGLRecordingContext(native);
   const cases=[];
   for(const conf of [{srcN:7,dstN:12,srcK:2,dstK:4},{srcN:12,dstN:19,srcK:4,dstK:7}]){
    const src=createLayer('prof-s'),dst=createLayer('prof-d');
    Object.assign(src,{N:conf.srcN,K:conf.srcK,radius:180,rotation:9,profileMode:'spline',rounding:145,profileNodes:P,fill:false,closedLoop:true,spiralEnabled:false,spiralOrder:0});
    Object.assign(dst,src,{id:'prof-d',N:conf.dstN,K:conf.dstK,rotation:30,profileNodes:Q});
    const tarr=[.13,.27,.51,.73,.91];
    // Warm all caches, JIT, and GPU-geometry record buffers
    for(let k=0;k<40;k++){
     ctx.__resetForBaseContext(native,true);
     MorphRendering.drawCircleSlideMorph(ctx,dst,src,dst,tarr[k%tarr.length],1,'phase');ctx.__finishFrame();
    }
    let total=0,count=0,points=0,commands=0,min=Infinity,max=0;
    for(let k=0;k<120;k++){
     const t=tarr[k%tarr.length];
     ctx.__resetForBaseContext(native,true);
     const start=performance.now();
     MorphRendering.drawCircleSlideMorph(ctx,dst,src,dst,t,1,'phase');ctx.__finishFrame();
     const elapsed=performance.now()-start;
     total+=elapsed;min=Math.min(min,elapsed);max=Math.max(max,elapsed);
     points+=ctx.__pointCount;commands+=ctx.commands.length;count++;
    }
    cases.push({config:conf,msPerDraw:total/count,minMs:min,maxMs:max,pointsPerDraw:points/count,commandsPerDraw:commands/count});
   }
   state.fourierMode=old.fourier;state.morph.mode=old.mode;
   return {cases,recorderStats:__spiroTunnelStrokeRecorderStatus?.()||null};
  })()`,{timeoutMs:85000,label:'phase stroke path CPU microbenchmark'});
  console.log('SOMATA_PHASE_BENCH',JSON.stringify(out));
  const errs=uncaughtExceptions(h.events);if(errs.length)console.error('WARN',errs.slice(0,2));
 }finally{await h.close();}
})().catch(e=>{console.error('ERROR',e.stack||e);process.exitCode=1});
