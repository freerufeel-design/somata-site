'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120});try{
 const r=await h.evaluate(`(()=>{
  const points=Array.from({length:16},(_,i)=>{const a=2*Math.PI*i/16,r=i%2?100:220;return{x:r*Math.cos(a),y:r*Math.sin(a)};});
  let prev=null,maxStep=0,sizes=new Set(),minx=Infinity,maxx=-Infinity;
  for(let percent=1;percent<=100;percent++){
   const path=buildRoundedMorphPolylinePoints(points,true,percent/100,[]);
   sizes.add(path.length);for(const p of path){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('non-finite');minx=Math.min(minx,p.x);maxx=Math.max(maxx,p.x);}
   if(prev){for(let i=0;i<path.length;i++)maxStep=Math.max(maxStep,Math.hypot(path[i].x-prev[i].x,path[i].y-prev[i].y));}
   prev=path.map(p=>({...p}));
  }
  return{samples:[...sizes],maxStep,minx,maxx};
 })()`);
 if(r.samples.length!==1||r.samples[0]<96||r.maxStep>10)throw Error('Rounding stepped/discontinuous: '+JSON.stringify(r));
 if(uncaughtExceptions(h.events).length)throw Error('browser errors');
 console.log('PASS continuous rounded morph sampling (no 68% point-count jump)',r);
 }finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exit(1)});
