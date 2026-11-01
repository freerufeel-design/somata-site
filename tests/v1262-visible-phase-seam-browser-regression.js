'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:90000});try{
 const data=await h.evaluate(`(()=>{
 const canvas=document.createElement('canvas');canvas.width=500;canvas.height=500;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const image=(p,r)=>{
  ctx.resetTransform();ctx.clearRect(0,0,500,500);ctx.translate(250,250);
  ctx.beginPath();somataDrawSplineCornerMode(ctx,p,true,r/100,{layer:{roundingShape:'hybrid',N:8,radius:150}});
  ctx.lineWidth=2;ctx.strokeStyle='#ffffff';ctx.stroke();
  const data=ctx.getImageData(0,0,500,500).data,alpha=new Uint8Array(250000);let visible=0;
  for(let i=0;i<250000;i++){alpha[i]=data[i*4+3];if(alpha[i]>4)visible++;}
  return{alpha,visible};
 };
 const delta=(a,b)=>{let sum=0,seen=0;for(let i=0;i<a.length;i++){sum+=Math.abs(a[i]-b[i]);if(a[i]>4||b[i]>4)seen++;}return sum/Math.max(1,seen)};
 const profile=(n,kind)=>Array.from({length:n},(_,i)=>{const angle=2*Math.PI*i/n;
  const r=kind===0?150:kind===1?(i%2?45:145):75+65*Math.sin(i*1.414+kind)*Math.sin(5*angle);
  return{x:r*Math.cos(angle),y:r*Math.sin(angle)};
 });
 let frames=0,worst=0,minVisible=Infinity,worstCase=null;
 for(const n of [5,8,11,24,80,160])for(const kind of [0,1,2,3,4])for(const rounding of [50,100,120,150,175,199,200]){
  const p=profile(n,kind),k=Math.max(1,Math.floor(n/3)),A=image(p,rounding);
  const B=image(p.slice(k).concat(p.slice(0,k)),rounding);
  const discrepancy=delta(A.alpha,B.alpha);
  minVisible=Math.min(minVisible,A.visible,B.visible);
  if(discrepancy>worst){worst=discrepancy;worstCase={n,kind,rounding,k};}frames++;
 }
 const circleRows=[];
 const recorder={moveTo:(...p)=>circleRows.push(['M',...p]),bezierCurveTo:(...p)=>circleRows.push(['C',...p]),lineTo:(...p)=>circleRows.push(['L',...p]),closePath:()=>circleRows.push(['Z'])};
 const dense=Array.from({length:3000},(_,i)=>{const t=2*Math.PI*i/3000,r=150+15*Math.sin(7*t);return{x:r*Math.cos(t),y:r*Math.sin(t)}});
 somataDrawSplineCornerMode(recorder,dense,true,2,{layer:{roundingShape:'hybrid',N:9,radius:165}});
 return{frames,worst,worstCase,minVisible,fullCircleSegments:circleRows.filter(v=>v[0]==='C').length};
})()`,{timeoutMs:87000,label:'12.6.2 visible source-to-next-phase index seam'});
 assert(data.minVisible>100,'contours must be visible in the browser');
 assert.equal(data.fullCircleSegments,16,'200% must take short circle path');
 assert(data.worst<1.5,'index-dependent visible phase jump '+JSON.stringify(data));
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 12.6.2 visible phase seam browser',JSON.stringify(data));
 }finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
