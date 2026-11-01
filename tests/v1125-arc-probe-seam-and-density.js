'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:50,evalTimeoutMs:60000});
 try{
  const stats=await h.evaluate(`(()=>{
   let seed=4311;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)|0)>>>0)/4294967296;
   const layer=createLayer('arc-probe-seam-density');Object.assign(layer,{N:5,K:2,radius:100});
   let count=0,maxDiff=0;
   for(let q=0;q<150;q++){
    const n=8+Math.floor(rnd()*45),p=[];
    for(let i=0;i<n;i++){const a=2*Math.PI*i/n,r=80+12*Math.sin(i*3)+18*(rnd()-.5);p.push({x:r*Math.cos(a),y:r*Math.sin(a)});}
    if(q%3===0){const j=Math.floor(rnd()*n);p[j]={x:p[(j+1)%n].x+(rnd()-.5)*1e-6,y:p[(j+1)%n].y+(rnd()-.5)*1e-6};}
    const original=completeLiveMorphCornerFlags(p,true,p.map(()=>false),[],layer);
    const byShift=Math.floor(rnd()*n),shifted=p.slice(byShift).concat(p.slice(0,byShift));
    const shiftedFlags=completeLiveMorphCornerFlags(shifted,true,shifted.map(()=>false),[],layer);
    for(let i=0;i<n;i++){
     const x=Number(original[(i+byShift)%n])||0,y=Number(shiftedFlags[i])||0;
     maxDiff=Math.max(maxDiff,Math.abs(x-y));count++;
    }
   }
   const dense=[];
   for(const n of [1000,2000,5000]){
    const points=Array.from({length:n},(_,i)=>{
     const a=i*2*Math.PI/n;
     return {x:115*Math.cos(a)+8*Math.cos(41*a),y:95*Math.sin(a)+8*Math.sin(41*a)};
    });
    const flags=points.map(()=>false),times=[];
    for(let z=0;z<10;z++){
     const st=performance.now();const f=completeLiveMorphCornerFlags(points,true,flags,[],layer);
     if(!f||f.length!==n)throw Error('invalid flags at '+n);
     times.push(performance.now()-st);
    }
    times.sort((a,b)=>a-b);dense.push({n,medianMs:times[5]});
   }
   return {count,maxDiff,dense};
  })()`,{label:'arc probe cyclic seam/dense performance',timeoutMs:55000});
  assert(stats.maxDiff<1e-8,'closed seam changed live corner strengths: '+JSON.stringify(stats));
  assert(stats.dense.every(d=>d.medianMs<100),'unbounded recovery cost: '+JSON.stringify(stats.dense));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS arc-probe seam invariance '+stats.count+' corner strengths, max difference '+stats.maxDiff+'; dense profiling '+JSON.stringify(stats.dense));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL:',e.stack||e);process.exitCode=1});
