'use strict';
const assert=require('node:assert/strict');const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:75,evalTimeoutMs:50000});try{
 const r=await h.evaluate(`(()=>{
 const results=[];
 const recorder={moveTo(){},lineTo(){},bezierCurveTo(){},closePath(){}};
 for(const n of [300,1500,3000]){
  const pts=Array.from({length:n},(_,i)=>{const t=i*Math.PI*2/n,r=120*(1+.2*Math.cos(5*t));return{x:r*Math.cos(t),y:r*Math.sin(t)}});
  const layer={roundingShape:'hybrid',N:8,radius:120,roundingMaxRadiusDrop:30};
  const flags=Array(n).fill(true);
  const methods={unified:()=>somataDrawSplineCornerMode(recorder,pts,true,.8,{baseSplineBlend:1,layer}),spline:()=>somataDrawSplineCornerMode(recorder,pts,true,.8,{baseSplineBlend:1,layer:{...layer,roundingShape:'spline'}}),contour:()=>drawUnifiedFilletPath(recorder,pts,true,.8,flags,{layer:{...layer,roundingShape:'contour'},maxRadiusDrop:30})};
  for(const [name,fn] of Object.entries(methods)){
   for(let j=0;j<5;j++)fn();const times=[];
   for(let j=0;j<12;j++){const begin=performance.now();fn();times.push(performance.now()-begin);}
   times.sort((a,b)=>a-b);results.push({n,mode:name,medianMs:(times[5]+times[6])/2});
  }
 }
 const n=512,pts=Array.from({length:n},(_,i)=>{const t=i*2*Math.PI/n,r=120*(1+.23*Math.cos(7*t));return{x:r*Math.cos(t),y:r*Math.sin(t)}});
 const shape=(v)=>{const rows=[];const rec={moveTo:(...args)=>rows.push(['M',...args]),bezierCurveTo:(...args)=>rows.push(['C',...args]),closePath:()=>rows.push(['Z'])};somataDrawSplineCornerMode(rec,pts,true,v,{baseSplineBlend:0,layer:{roundingShape:'hybrid',N:8,radius:120,roundingMaxRadiusDrop:30}});return rows;};
 const near=shape(1.999999),end=shape(2),nearCs=near.filter(r=>r[0]==='C'),endCs=end.filter(r=>r[0]==='C');
 const maxRadialErr=(rows)=>{let max=0,prev={x:rows[0][1],y:rows[0][2]},radius=120*(1+.23);
 for(const c of rows.filter(r=>r[0]==='C')){const p0=prev,p1={x:c[1],y:c[2]},p2={x:c[3],y:c[4]},p3={x:c[5],y:c[6]};for(let i=0;i<=8;i++){const t=i/8,v=1-t,x=v*v*v*p0.x+3*v*v*t*p1.x+3*v*t*t*p2.x+t*t*t*p3.x,y=v*v*v*p0.y+3*v*v*t*p1.y+3*v*t*t*p2.y+t*t*t*p3.y;max=Math.max(max,Math.abs(Math.hypot(x,y)-radius));}prev=p3;}return max;};
 return{results,nearSegments:nearCs.length,endSegments:endCs.length,nearRadialError:maxRadialErr(near),endRadialError:maxRadialErr(end)};
 })()`,{timeoutMs:48000,label:'unified 12.5 CPU geometry micro-benchmark'});
 console.log('BENCHMARK',JSON.stringify(r));
 assert.equal(r.endSegments,16);assert.equal(r.nearSegments,512);
 assert(r.nearRadialError<1,'near 200% must be near the same circle');assert(r.endRadialError<.015);
 for(const n of [300,1500,3000]){const arr=r.results.filter(x=>x.n===n);assert(arr.length===3);assert(arr[0].medianMs<Math.max(1.0,arr[2].medianMs*1.5),`unified too slow vs contour n=${n}`);}
 assert.deepEqual(uncaughtExceptions(h.events),[]);console.log('PASS fast cubic rail and direct 200% circle');
 }finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
