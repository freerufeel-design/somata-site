'use strict';const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:90000});try{const out=await h.evaluate(`(()=>{
const ctx={moveTo(){},bezierCurveTo(){},lineTo(){},closePath(){}};
const layer=createLayer('live-corner-bench');Object.assign(layer,{N:5,K:2,radius:180,rounding:150,roundingMaxRadiusDrop:30});
const out=[];
for(const n of [12,40,80,160,300]){
 const p=Array.from({length:n},(_,i)=>{const a=2*Math.PI*i/n,r=i%2?90:150;return {x:r*Math.cos(a),y:r*Math.sin(a)}});
 const flags=p.map(()=>false);let samples=[];
 for(let repeat=0;repeat<6;repeat++){
 const t0=performance.now();drawMorphPathQuality(ctx,p,true,1.5,'segments',null,false,'smooth',flags,[],false,1,1,layer);samples.push(performance.now()-t0);}
 out.push({n,median:samples.sort((a,b)=>a-b)[3],samples});
}
return out;
})()`,{label:'live corner drawing time',timeoutMs:85000});console.log('LIVE CORNER BENCH',JSON.stringify(out));}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
