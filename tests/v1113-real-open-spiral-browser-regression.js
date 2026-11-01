'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:55000});
 try{
  const r=await h.evaluate(`(()=>{
    const make=(n,t)=>Array.from({length:n},(_,i)=>{const s=i/(n-1),a=s*4.5*Math.PI+t*.03,r=12+100*s;return{x:r*Math.cos(a),y:r*Math.sin(a)}});
    const routes=['polyline','profile-spline','whole-spline'];let tests=0,maxError=0;
    for(const route of routes)for(const amount of [.5,1,1.5,2])for(const phase of [0,.000001,.5,.999999,1]){
      const pts=make(8,phase),flags=pts.map((_,i)=>i>0&&i<pts.length-1),commands=[];
      const canvas=document.createElement('canvas'),original=canvas.getContext('2d');
      const ctx=new Proxy(original,{get(target,key){const v=target[key];return typeof v==='function'?(...args)=>{if(['moveTo','bezierCurveTo','lineTo','closePath'].includes(key))commands.push([key,...args]);return v.apply(target,args);}:v;}});
      const layer=createLayer('endpoint-safety');
      Object.assign(layer,{N:8,radius:120,rounding:amount*100,roundingMaxRadiusDrop:30,roundingSmoothSplines:route==='whole-spline'});
      if(route==='polyline')roundPolylineForDraw(ctx,pts,false,amount,flags,null,false,null,layer);
      else splinePathForDraw(ctx,pts,false,amount,flags,[],route==='whole-spline',1,0,layer);
      if(!commands.length||commands[0][0]!=='moveTo')throw Error('Missing open contour start: '+route);
      const last=commands.filter(c=>c[0]==='bezierCurveTo'||c[0]==='lineTo').at(-1);
      if(!last)throw Error('Missing cubic: '+route);
      const start=commands[0],sx=start[1],sy=start[2],ex=last.at(-2),ey=last.at(-1);
      const error=Math.max(Math.hypot(sx-pts[0].x,sy-pts[0].y),Math.hypot(ex-pts.at(-1).x,ey-pts.at(-1).y));
      if(!Number.isFinite(error)||error>1e-7)throw Error(route+' at '+amount+' phase '+phase+': endpoint drift '+error);
      if(commands.some(c=>c[0]==='closePath'))throw Error('Open path was closed');
      if(commands.some(c=>c.slice(1).some(v=>!Number.isFinite(v))))throw Error('Nonfinite cubic handle');
      maxError=Math.max(maxError,error);tests++;
    }
    return {tests,maxError};
  })()`,{label:'11.0.13 actual browser open spiral anchors',timeoutMs:50000});
  assert.equal(r.tests,60);assert(r.maxError<1e-7);assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 11.0.13 browser open spiral rendering: '+JSON.stringify(r));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
