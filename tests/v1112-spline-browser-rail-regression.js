'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:90,evalTimeoutMs:65000});
 try{
  const result=await h.evaluate(`(()=>{
   const p=[{x:80,y:0},{x:40,y:90},{x:-55,y:74},{x:-95,y:-25},{x:-23,y:-80},{x:75,y:-65}],flags=p.map(()=>true);
   const render=(edge,closed,amount)=>{
    const commands=[];
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    const c=new Proxy(context,{get(t,k){const v=t[k];return typeof v==='function'?(...args)=>{
     if(['moveTo','bezierCurveTo','lineTo','closePath'].includes(k))commands.push([k,...args]);
     return v.apply(t,args);
    }:v;}});
    const layer=createLayer('spline-switch-smoke');
    Object.assign(layer,{N:6,radius:edge/(2*Math.sin(Math.PI/6)),rounding:amount*100,
       roundingSmoothSplines:true,roundingMaxRadiusDrop:30,profileMode:'spline',wholeCurveSpline:true});
    splinePathForDraw(c,p,closed,amount,flags,[],true,1,0,layer);
    return commands;
   };
   let maxDiff=0,maxCommandDelta=0,checks=0;
   for(const closed of [true,false])for(const amount of [.2,1.2,2])for(const edge of [16,18,20,22,24,26,28,30,32]){
    const left=render(edge-1e-6,closed,amount),right=render(edge+1e-6,closed,amount);
    maxCommandDelta=Math.max(maxCommandDelta,Math.abs(left.length-right.length));
    if(left.length!==right.length)throw Error('Browser spline topology switched at edge '+edge);
    for(let i=0;i<left.length;i++){
     if(left[i].length!==right[i].length||left[i][0]!==right[i][0])throw Error('Browser command type switched');
     for(let j=1;j<left[i].length;j++){
      if(!Number.isFinite(left[i][j])||!Number.isFinite(right[i][j]))throw Error('Non-finite spline handle');
      maxDiff=Math.max(maxDiff,Math.abs(left[i][j]-right[i][j]));
     }
    }
    checks++;
   }
   return{checks,maxCommandDelta,maxDiff};
  })()`,{label:'11.0.12 real spline render route around base-edge sampling thresholds',timeoutMs:60000});
  assert.equal(result.checks,54);
  assert.equal(result.maxCommandDelta,0);
  assert(result.maxDiff<.001,JSON.stringify(result));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 11.0.12 browser spline routing '+JSON.stringify(result));
 } finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
