'use strict';
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:70,evalTimeoutMs:90000});
 try{
 const out=await h.evaluate(`(()=>{
   const out=[];const oldMode=state.morph.mode;
   const ctx=createGeometryGLRecordingContext(document.createElement('canvas').getContext('2d'));
   const src=createLayer('bench-src'),dst=createLayer('bench-dst');
   Object.assign(src,{N:9,K:4,radius:190,profileMode:'spline',rounding:145,closedLoop:true,spiralEnabled:false,spiralOrder:0,fill:false,profileNodes:[{x:0,y:0},{x:.22,y:.22},{x:.68,y:-.19},{x:1,y:0}]});
   Object.assign(dst,src,{id:'bench-dst',N:14,K:6,profileNodes:[{x:0,y:0},{x:.14,y:-.2},{x:.43,y:.35},{x:.75,y:-.1},{x:1,y:0}]});
   for(const mode of ['topology','circleSlide']){
     state.morph.mode=mode;
     for(const kind of ['medium','complex']){
       if(kind==='complex') {src.N=20;src.K=8;dst.N=23;dst.K=9;} else {src.N=9;src.K=4;dst.N=14;dst.K=6;}
       const call=(t)=>{ctx.__resetForBaseContext(null);drawAngularAnchorMorph(ctx,dst,src,dst,t,1,'phase','angular');ctx.__finishFrame();return ctx.__pointCount;};
       for(let i=0;i<20;i++)call(.1+(i%17)/22);
       const counts=[];const samples=[];
       for(let k=0;k<5;k++){
         const t0=performance.now();let points=0;
         for(let i=0;i<45;i++)points+=call(.01+(i%43)/45*.97);
         samples.push((performance.now()-t0)/45);counts.push(points/45);
       }
       samples.sort((a,b)=>a-b);
       out.push({mode,kind,medianMs:samples[2],allMs:samples,meanPoints:counts[2]});
     }
   }
   state.morph.mode=oldMode;return out;
 })()`,{label:'render cost benchmark',timeoutMs:85000});
 console.log(JSON.stringify(out,null,2));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
