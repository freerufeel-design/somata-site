'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:50,evalTimeoutMs:80000});
 try{
  const rows=await h.evaluate(`(()=>{
   const c=document.createElement('canvas');c.width=c.height=680;
   const ctx=c.getContext('2d',{willReadFrequently:true});
   const presets=[{x:0,y:0},{x:.33,y:.4},{x:.33,y:0},{x:.66,y:.4},{x:.66,y:0},{x:1,y:0}];
   const image=fn=>{
    ctx.resetTransform();ctx.clearRect(0,0,680,680);ctx.translate(340,340);
    ctx.lineWidth=2;ctx.strokeStyle='white';ctx.globalAlpha=1;
    ctx.__suppressFill=true;ctx.__suppressStroke=false;
    fn();const data=ctx.getImageData(0,0,680,680).data;
    const o=new Uint8Array(680*680);for(let i=0;i<o.length;i++)o[i]=data[i*4+3];return o;
   };
   const error=(a,b)=>{let sum=0,active=0;for(let i=0;i<a.length;i++){
    const da=Math.abs(a[i]-b[i]);sum+=da;if(a[i]>8||b[i]>8)active++;
   }return sum/Math.max(active,1);};
   const shapes=[[7,2,8,1],[8,3,10,3],[10,3,8,3],[8,1,8,1]];
   const oldMode=state.morph.mode,rows=[];
   try{for(const mode of ['circleSlide','topology','calm']){state.morph.mode=mode;
    for(const [N,K,n,k] of shapes){
     const src=createLayer('src'),dst=createLayer('dst');
     Object.assign(src,{N,K,radius:270,rotation:440.1,rounding:72,profileMode:'spline',
       splineRenderMode:'smooth',profileNodes:presets,closedLoop:true,fill:false});
     Object.assign(dst,{...src,id:'dst',N:n,K:k,rotation:440.1});
     const actual=t=>image(()=>{
      if(mode==='circleSlide')drawCircleSlideMorph(ctx,dst,src,dst,t,1,'sector');
      else drawLinearAnchorMorph(ctx,dst,src,dst,t,1,'sector');
     });
     const first=image(()=>renderLayerOrbitPaths(ctx,src));
     const end=image(()=>renderLayerOrbitPaths(ctx,dst));
     const measurements={mode,from:N+'/'+K,to:n+'/'+k,
       first:error(first,actual(0)),last:error(end,actual(1)),
       before:error(end,actual(.99999)),after:error(first,actual(.00001))};
     rows.push(measurements);
    }
   }}finally{state.morph.mode=oldMode;}
   return rows;
  })()`,{timeoutMs:75000,label:'screenshot-like spline profile near-phase pixel equality'});
  for(const r of rows){
   assert(r.first<.25,'first differs from Static: '+JSON.stringify(r));
   assert(r.last<.25,'last differs from Static: '+JSON.stringify(r));
   assert(r.before<3.0,'last moving frame jumps from final Static: '+JSON.stringify(r));
   assert(r.after<3.0,'first moving frame jumps from initial Static: '+JSON.stringify(r));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 11.0.4',rows.length,'screenshot-like profile phase boundaries:',JSON.stringify(rows.map(r=>({m:r.mode,from:r.from,to:r.to,b:r.before,a:r.after}))));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL spline profile phase continuity',e.stack||e);process.exitCode=1});
