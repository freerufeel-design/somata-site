'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:60,evalTimeoutMs:20000});try{
 const out=await h.evaluate(`(()=>{
   const points=[{x:0,y:0},{x:120,y:0},{x:120.15,y:.05},{x:120,y:100},{x:0,y:100}];
   const flags=points.map(()=>true);
   const draw=(amount,mix)=>{
     const commands=[];const ctx={moveTo(x,y){commands.push(['M',x,y]);},lineTo(x,y){commands.push(['L',x,y]);},bezierCurveTo(a,b,c,d,x,y){commands.push(['C',a,b,c,d,x,y]);},closePath(){commands.push(['Z']);}};
     splinePathForDraw(ctx,points,true,amount,flags,[],false,1,mix);
     return commands;
   };
   const a=draw(.85,0),b=draw(.85,1),flat=draw(0,0),flatLive=draw(0,1);
   let displacement=0;
   for(let i=0;i<Math.min(a.length,b.length);i++){
      if(a[i].length!==b[i].length||a[i][0]!==b[i][0])return{error:'command topology changed'};
      for(let j=1;j<a[i].length;j++)displacement=Math.max(displacement,Math.abs(a[i][j]-b[i][j]));
   }
   return {displacement,cmds:a.length,sameZero:JSON.stringify(flat)===JSON.stringify(flatLive),finite:b.flatMap(c=>c.slice(1)).every(Number.isFinite)};
 })()`,{label:'short-lived spline edge fillet shoulders'});
 assert(!out.error,JSON.stringify(out));
 assert(out.finite,'fillet contains invalid coordinates');
 assert(out.sameZero,'no rounding must remain independent of live seam mode');
 assert(out.displacement>1,'short edge must not eliminate the long-side fillet: '+JSON.stringify(out));
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS asymmetric live spline segment: unrounded geometry unchanged, distinct long-side fillet, finite cubic controls; max shoulder shift',out.displacement.toFixed(2),'px');
 }finally{await h.close();}})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
