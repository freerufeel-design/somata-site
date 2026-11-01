'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:45,evalTimeoutMs:90000});
 try{
  const result=await h.evaluate(`(()=>{
   const draw=(pts,closed,round,quality,flags)=>{
    const native=document.createElement('canvas');native.width=native.height=520;
    const c=native.getContext('2d',{willReadFrequently:true});c.setTransform(2.1,0,0,2.1,260,260);
    c.strokeStyle='#fff';c.lineWidth=.75;c.lineJoin='round';c.lineCap='round';
    const layer={N:8,radius:105,roundingMaxRadiusDrop:30,roundingSmoothSplines:true,roundingSplineSubdivisions:quality};
    const calls=[];const proxy=new Proxy(c,{get(obj,key){const x=obj[key];return typeof x==='function'?(...args)=>{if(['moveTo','bezierCurveTo','closePath'].includes(key))calls.push([key,...args]);return x.apply(obj,args);}:x;}});
    proxy.beginPath();const used=drawUnifiedFilletPath(proxy,pts,closed,round,flags,{layer,spline:true,wholeCurveSpline:true,splineSubdivisions:quality,baseEdge:45});
    if(!used)throw Error('fillet not used');proxy.stroke();
    const rgba=c.getImageData(0,0,520,520).data,bitmap=new Uint8Array(520*520);let pixels=0;
    for(let k=0;k<bitmap.length;k++){if(rgba[k*4+3]>32){bitmap[k]=1;pixels++;}}
    return {bitmap,pixels,commands:calls.filter(v=>v[0]==='bezierCurveTo').length,first:calls[0],last:calls.at(-1)};
   };
   const compare=(a,b)=>{
    const size=520;let changed=0,unmatched=0;
    for(let k=0;k<a.bitmap.length;k++){
     if(a.bitmap[k]===b.bitmap[k])continue;
     changed++;
     const target=a.bitmap[k]?b.bitmap:a.bitmap;const x=k%size,y=(k/size)|0;
     let near=false;
     for(let dy=-2;dy<=2&&!near;dy++)for(let dx=-2;dx<=2;dx++){
      if(Math.abs(dx)+Math.abs(dy)>3)continue;
      const xx=x+dx,yy=y+dy;
      if(xx>=0&&xx<size&&yy>=0&&yy<size&&target[yy*size+xx]){near=true;break;}
     }
     if(!near)unmatched++;
    }
    return {changed,unmatched};
   };
   const shapes={
    circle:n=>Array.from({length:n},(_,i)=>{const a=2*Math.PI*i/n;return{x:100*Math.cos(a),y:100*Math.sin(a)};}),
    wave:n=>Array.from({length:n},(_,i)=>{const a=2*Math.PI*i/n,r=88+19*Math.sin(4*a)+11*Math.sin(7*a);return{x:r*Math.cos(a),y:r*Math.sin(a)};}),
    star:n=>Array.from({length:n},(_,i)=>{const a=2*Math.PI*i/n,r=90+27*Math.cos(7*a);return{x:r*Math.cos(a),y:r*Math.sin(a)};}),
    spiral:n=>Array.from({length:n},(_,i)=>{const t=i/(n-1),a=t*5*Math.PI,r=8+100*t;return{x:r*Math.cos(a),y:r*Math.sin(a)};})
   };
   let cases=0,maxChanged=0,maxUnmatched=0,maxRatio=0,commands16=0,commands8=0,phaseCases=0,maxPhaseUnmatched=0; const worst=[];
   for(const [shape,fn] of Object.entries(shapes))for(const n of [7,15,30])for(const round of [.15,.7,1.4,2]){
    const closed=shape!=='spiral',p=fn(n),flags=p.map((_,i)=>closed||i>0&&i<n-1);
    const old=draw(p,closed,round,16,flags),now=draw(p,closed,round,8,flags);
    const d=compare(old,now);cases++;worst.push({shape,n,round,...d,oldPixels:old.pixels});commands16+=old.commands;commands8+=now.commands;
    maxChanged=Math.max(maxChanged,d.changed);maxUnmatched=Math.max(maxUnmatched,d.unmatched);
    maxRatio=Math.max(maxRatio,d.changed/Math.max(1,old.pixels));
    // Neighboring nearly identical rails, including both sides of an open
    // endpoint and a just-born mini-profile: no one-frame contour relocation.
    for(const phase of [0,1]){
     const f=phase?1:-1;
     const perturb=p.map((v,i)=>({x:v.x+(i%3===0?f*1e-6:0),y:v.y+(i%4===0?f*1e-6:0)}));
     const next=draw(perturb,closed,round,8,flags);const dd=compare(now,next);
     maxPhaseUnmatched=Math.max(maxPhaseUnmatched,dd.unmatched);phaseCases++;
    }
   }
   // Time an actual spline-heavy rail with the same 8/16 options.
   const benchPoints=shapes.wave(200),benchFlags=benchPoints.map(()=>true);
   const times={};for(const quality of [16,8]){
    const arr=[];for(let i=0;i<10;i++){const start=performance.now();draw(benchPoints,true,1.0,quality,benchFlags);arr.push(performance.now()-start);}
    arr.sort((a,b)=>a-b);times[quality]=arr[5];
   }
   worst.sort((a,b)=>b.unmatched-a.unmatched);return {cases,maxChanged,maxUnmatched,maxRatio,commands16,commands8,phaseCases,maxPhaseUnmatched,times,worst:worst.slice(0,15)};
  })()`,{label:'12.1 real browser 8 vs 16 rendered spline contours',timeoutMs:80000});
  console.log('12.1 SPLINE-QUALITY RESULT',JSON.stringify(result));
  assert.equal(result.cases,48);assert.equal(result.phaseCases,96);
  assert(result.commands8<result.commands16*.7, 'segment count not reduced');
  assert(result.maxPhaseUnmatched===0,'visible jump on tiny rail perturbation');
  // 8-step is explicitly opt-in: sharp contours are allowed to differ from
  // baseline but MUST remain temporally stable. Keep track of that cost.
  assert(result.maxUnmatched>100,'stress set did not exercise a visible fidelity trade-off');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 12.1 spline quality browser comparison');
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL 12.1 spline quality:',e.stack||e);process.exitCode=1});
