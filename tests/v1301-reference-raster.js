'use strict';
const fs=require('node:fs');
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:90000});
 try{
 const result=await h.evaluate(`(()=>{
    const W=640, canvas=document.createElement('canvas');canvas.width=canvas.height=W;
    const nativeCtx=canvas.getContext('2d',{willReadFrequently:true});
    const gpu=createGeometryGLRecordingContext(nativeCtx);
    const P=[{x:0,y:0},{x:.22,y:.22},{x:.68,y:-.19},{x:1,y:0}];
    const Q=[{x:0,y:0},{x:.14,y:-.2},{x:.43,y:.35},{x:.75,y:-.1},{x:1,y:0}];
    const src=createLayer('ref-a'),dst=createLayer('ref-b');
    const old=state.morph.mode;const out=[];
    try{
     for(const mode of ['topology','calm','circleSlide']){
      state.morph.mode=mode;
      for(const size of ['medium','complex']){
       for(const rounding of [65,145,200]){
        Object.assign(src,{N:size==='medium'?9:20,K:size==='medium'?4:8,radius:185,rounding,profileMode:'spline',closedLoop:true,spiralEnabled:false,spiralOrder:0,fill:false,profileNodes:P});
        Object.assign(dst,src,{id:'ref-b',N:size==='medium'?14:23,K:size==='medium'?6:9,profileNodes:Q});
        for(const t of [0,.0001,.01,.08,.25,.5,.78,.92,.99,.9999,1]){
         gpu.__resetForBaseContext(null);
         drawAngularAnchorMorph(gpu,dst,src,dst,t,1,'phase','angular');gpu.__finishFrame();
         nativeCtx.setTransform(1,0,0,1,0,0);nativeCtx.clearRect(0,0,W,W);
         nativeCtx.translate(W/2,W/2);nativeCtx.scale(.65,.65);
         nativeCtx.strokeStyle='#fff';nativeCtx.lineWidth=1.7;nativeCtx.lineCap='round';nativeCtx.lineJoin='round';
         for(const cmd of gpu.commands){
          for(const sp of cmd.subpaths||[]){
            const pts=sp.points;if(!pts?.length)continue;
            nativeCtx.beginPath();nativeCtx.moveTo(pts[0].x,pts[0].y);
            for(let i=1;i<pts.length;i++)nativeCtx.lineTo(pts[i].x,pts[i].y);
            if(sp.closed)nativeCtx.closePath();nativeCtx.stroke();
          }
         }
         const rgba=nativeCtx.getImageData(0,0,W,W).data,ink=[];
         for(let i=0;i<W*W;i++)if(rgba[4*i+3]>=90)ink.push(i);
         out.push({mode,size,rounding,t,points:gpu.__pointCount,ink});
        }
       }
      }
     }
    }finally{state.morph.mode=old;}
    return {width:W,frames:out};
 })()`,{label:'Somata13 GPU recorder raster parity',timeoutMs:85000});
 if(process.env.OUTPUT_JSON)fs.writeFileSync(process.env.OUTPUT_JSON,JSON.stringify(result));
 console.log('frames',result.frames.length,'inkTotal',result.frames.reduce((s,f)=>s+f.ink.length,0));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
