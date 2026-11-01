'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:50,evalTimeoutMs:90000});try{
 const data=await h.evaluate(`(()=>{
  const blend=window.__spiroBlendCarrierCubics;
  const cub=(p0,c1,c2,p3)=>({p0,c1,c2,p3,widthScale0:1,widthScale1:1});
  const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  const point=(q,t)=>{const u=1-t;return {x:u*u*u*q.p0.x+3*u*u*t*q.c1.x+3*u*t*t*q.c2.x+t*t*t*q.p3.x,y:u*u*u*q.p0.y+3*u*u*t*q.c1.y+3*u*t*t*q.c2.y+t*t*t*q.p3.y};};
  const sample=(path)=>{const out=[];for(const q of path)for(let i=0;i<=32;i++)out.push(point(q,i/32));return out;};
  const d=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,s=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/Math.max(1e-12,dx*dx+dy*dy)));return Math.hypot(p.x-a.x-s*dx,p.y-a.y-s*dy);};
  const haus=(a,b)=>{const one=(x,y)=>{let max=0;for(let i=0;i<x.length;i+=Math.max(1,Math.floor(x.length/320))){let m=Infinity;for(let j=1;j<y.length;j++)m=Math.min(m,d(x[i],y[j-1],y[j]));max=Math.max(max,m);}return max;};return Math.max(one(a,b),one(b,a));};
  let maxEndpoint=0,maxTiny=0,checks=0,allFinite=true,maxSegments=0;
  for(let n=2;n<=25;n++)for(const variant of [0,1,2,3]){
   const src=[],dst=[];const pts=Array.from({length:n+1},(_,i)=>({x:i*11,y:30*Math.sin(.55*i+variant*.3)}));
   for(let i=0;i<n;i++){
    const a=pts[i],b=pts[i+1];src.push(cub(a,{x:a.x+2,y:a.y+25*Math.cos(i*.7)},{x:b.x-2,y:b.y-15*Math.cos(i*.8)},b));
    const mid=lerp(a,b,.5);mid.y+=7*Math.sin(variant+i*.8);
    dst.push(cub(a,lerp(a,mid,.4),lerp(a,mid,.8),mid));
    dst.push(cub(mid,lerp(mid,b,.3),lerp(mid,b,.7),b));
   }
   const aa=sample(src),bb=sample(dst),lo=blend(src,dst,0),hi=blend(src,dst,1),near=blend(src,dst,1e-6);
   maxSegments=Math.max(maxSegments,lo.length);
   const endpoint=Math.max(haus(aa,sample(lo)),haus(bb,sample(hi)));
   maxEndpoint=Math.max(maxEndpoint,endpoint);
   maxTiny=Math.max(maxTiny,haus(sample(lo),sample(near)));
   for(const q of lo.concat(hi,near))allFinite=allFinite&&[q.p0,q.c1,q.c2,q.p3].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
   checks++;
  }
  return {checks,maxEndpoint,maxTiny,maxSegments,allFinite};
 })()`,{timeoutMs:85000,label:'exact geometry endpoints on variable subdivision count'});
 assert(data.allFinite,'nonfinite controls in blended contour');
 assert(data.maxEndpoint<.12,`blend endpoints do not preserve source geometry: ${data.maxEndpoint}`);
 assert(data.maxTiny<.03,`tiny mix changed geometry abruptly: ${data.maxTiny}`);
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS 11.0.9 exact Bézier blend '+JSON.stringify(data));
}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
