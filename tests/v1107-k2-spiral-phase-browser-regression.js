'use strict';
// Approximation of the screenshot's N=4 K=2 rotation=167°, with explicit
// static/morph image equality at both phase boundaries and their neighbors.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:90000});
 try{
 const rows=await h.evaluate(`(()=>{
 const original=state.morph.mode,ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
 ctx.canvas.width=720;ctx.canvas.height=720;
 const paint=fn=>{ctx.resetTransform();ctx.clearRect(0,0,720,720);ctx.translate(360,360);ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.globalAlpha=1;ctx.__suppressFill=true;ctx.__suppressStroke=false;fn();const px=ctx.getImageData(0,0,720,720).data,a=new Uint8Array(720*720);for(let i=0;i<a.length;i++)a[i]=px[i*4+3];return a;};
 const err=(a,b)=>{let total=0,count=0;for(let i=0;i<a.length;i++){total+=Math.abs(a[i]-b[i]);if(a[i]>8||b[i]>8)count++;}return total/Math.max(1,count)};
 const rows=[];
 try{for(const profile of ['segments','spline'])for(const mode of ['topology','calm','circleSlide'])for(const round of [40,100,150,200]){
   state.morph.mode=mode;
   const src=createLayer('k2-src'),dst=createLayer('k2-dst');
   Object.assign(src,{N:4,K:2,radius:229.6,rotation:167,rounding:round,profileMode:profile,
     profileNodes:[{x:0,y:0},{x:.25,y:.4},{x:.5,y:-.4},{x:.75,y:.3},{x:1,y:0}],
     spiralEnabled:false,closedLoop:true,fill:false});
   Object.assign(dst,src,{id:'k2-dst',N:5,K:2,rotation:210});
   const first=paint(()=>renderLayerOrbitPaths(ctx,src)),last=paint(()=>renderLayerOrbitPaths(ctx,dst));
   const move=t=>paint(()=>{if(mode==='circleSlide')drawCircleSlideMorph(ctx,dst,src,dst,t,1,'phase');else drawLinearAnchorMorph(ctx,dst,src,dst,t,1,'phase');});
   rows.push({profile,mode,round,first:err(first,move(0)),nearFirst:err(first,move(.00001)),nearLast:err(last,move(.99999)),last:err(last,move(1))});
 }}finally{state.morph.mode=original;}
 return rows;
})()`,{timeoutMs:85000,label:'11.0.7 screenshot-like N4 K2 phase boundaries'});
 for(const r of rows){assert(r.first<.25,'initial jump '+JSON.stringify(r));assert(r.last<.25,'terminal jump '+JSON.stringify(r));assert(r.nearFirst<4,'near initial '+JSON.stringify(r));assert(r.nearLast<4,'near terminal '+JSON.stringify(r));}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log(`PASS 11.0.7: ${rows.length} N4/K2 phase-boundary browser cases, all at 40/100/150/200%, 3 modes, segment/spline`);
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL 11.0.7 screenshot-like K2',e.stack||e);process.exitCode=1});
