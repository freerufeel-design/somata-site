'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:50000});try{
 const result=await h.evaluate(`(()=>{
  const el=document.getElementById('paramFastFilletSweep');
  const layer=createLayer('fast-sweep-live');Object.assign(layer,{N:6,K:2,radius:100,rounding:150,roundingMaxRadiusDrop:30});
  const canvas=document.createElement('canvas');canvas.width=540;canvas.height=540;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const draw=(mode,phase,fast)=>{
   window.__somataFastFilletSweep=fast;
   const n=900,p=Array.from({length:n},(_,i)=>{const a=i*2*Math.PI/n,r=82+18*Math.sin(6*a+phase*0.02);return {x:r*Math.cos(a)+phase*.001,y:r*Math.sin(a)-phase*.001};});
   ctx.save();ctx.clearRect(0,0,540,540);ctx.translate(270,270);ctx.scale(2.1,2.1);
   ctx.beginPath();
   const started=performance.now();
   drawMorphPathQuality(ctx,p,true,1.5,mode,null,false,'smooth',p.map(()=>true),[],false,1,morphFilletRecoveryMix(phase),layer);
   const elapsed=performance.now()-started;
   ctx.strokeStyle='white';ctx.lineWidth=1;ctx.stroke();ctx.restore();
   const pix=ctx.getImageData(0,0,540,540).data;let count=0;for(let i=3;i<pix.length;i+=4)if(pix[i]>60)count++;
   return {count,elapsed};
  };
  const out=[];for(const phase of [0,.000001,.025,.5,.975,.999999,1]){
   for(const mode of ['segments','spline']){
    const old=draw(mode,phase,false),fast=draw(mode,phase,true);
    out.push({mode,phase,old,fast});
   }
  }
  window.__somataFastFilletSweep=false;
  return out;
 })()`,{timeoutMs:45000,label:'live Morph with experimental cubic sweep'});
 for(const r of result){assert(r.old.count>0,`blank original ${JSON.stringify(r)}`);assert(r.fast.count>0,`blank accelerated ${JSON.stringify(r)}`);assert(Math.abs(r.old.count-r.fast.count)<80,`visible outline changed ${JSON.stringify(r)}`);}
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 12.2 live browser: '+result.length+' full Morph path scenarios at phase 0/1, spline/segments, fast/reference; max stroke-pixel delta '+Math.max(...result.map(r=>Math.abs(r.old.count-r.fast.count))));
}finally{await h.close();}})().catch(e=>{console.error('FAIL 12.2 live browser:',e.stack||e);process.exitCode=1});
