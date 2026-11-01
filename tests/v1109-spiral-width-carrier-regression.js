'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:40,evalTimeoutMs:55000});try{
 const data=await h.evaluate(`(()=>{
  const raw=Array.from({length:11},(_,i)=>({x:10*i+1.4*i*i,y:24*Math.sin(.6*i),widthScale:Math.exp(-.22*i)}));
  const flags=raw.map((_,i)=>i>0&&i<raw.length-1);
  const widthAt=(cubics,f)=>{
   const arc=[0],step=q=>{let len=0,p=q.p0;for(let i=1;i<=12;i++){const t=i/12,u=1-t,v={x:u*u*u*q.p0.x+3*u*u*t*q.c1.x+3*u*t*t*q.c2.x+t*t*t*q.p3.x,y:u*u*u*q.p0.y+3*u*u*t*q.c1.y+3*u*t*t*q.c2.y+t*t*t*q.p3.y};len+=Math.hypot(v.x-p.x,v.y-p.y);p=v;}return len;};
   for(const q of cubics)arc.push(arc.at(-1)+step(q));
   const x=f*arc.at(-1);let i=0;while(i<cubics.length-1&&arc[i+1]<x)i++;
   const t=Math.max(0,Math.min(1,(x-arc[i])/Math.max(1e-9,arc[i+1]-arc[i]))),q=cubics[i];
   return Math.exp(Math.log(q.widthScale0)*(1-t)+Math.log(q.widthScale1)*t);
  };
  let maximum=0;const values=[];
  for(const levels of [[0,.000001],[.000999,.001001],[.119999,.120001]]){
   const a=window.__spiroBuildSpiralBezierSegments(raw,levels[0],flags,false),b=window.__spiroBuildSpiralBezierSegments(raw,levels[1],flags,false);
   let step=0;for(let j=0;j<=20;j++){const f=j/20;step=Math.max(step,Math.abs(widthAt(a,f)-widthAt(b,f)));}
   maximum=Math.max(maximum,step);values.push({levels,step,segmentsA:a.length,segmentsB:b.length});
  }
  return {maximum,values};
 })()`,{timeoutMs:50000,label:'preserve authored spiral width on fillet topology changes'});
 assert(data.maximum<.06,`Spiral stroke width changes at fillet boundary: ${JSON.stringify(data)}`);
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 11.0.9 width interpolation is arc-station anchored: '+JSON.stringify(data));
}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
