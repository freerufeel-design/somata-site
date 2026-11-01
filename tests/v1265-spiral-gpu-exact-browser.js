'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createBrowserHarness}=require('./lib/browser-harness.js');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:70000});
 try{
 const r=await h.evaluate(`(()=>{
 let count=0;const hashes=[];const perf=[];
 const hashValues=(v)=>{let h=2166136261>>>0;const s=JSON.stringify(v);for(let j=0;j<s.length;j++){h^=s.charCodeAt(j);h=Math.imul(h,16777619)>>>0;}return h>>>0;};
 const measure=(fn)=>{for(let i=0;i<12;i++)fn();const times=[];for(let r=0;r<9;r++){const start=performance.now();for(let i=0;i<12;i++)fn();times.push((performance.now()-start)/12);}times.sort((a,b)=>a-b);return times[4];};
 const make=(n,variant,closed)=>Array.from({length:n},(_,i)=>{const t=i/(n-1),ang=t*(8+variant*2)*Math.PI,rad=20+145*t+((variant===2)?20*Math.sin(i*1.13):0);return{x:rad*Math.cos(ang),y:rad*Math.sin(ang),widthScale:1-.64*t};});
 for(const n of [190,600,2000])for(const closed of [false,true])for(const variant of [0,1,2])for(const round of [0,.1,.5,1,1.0001,1.5,2]){
  const pts=make(n,variant,closed),layer=createLayer('perf');Object.assign(layer,{N:8,K:2,radius:180,spiralEnabled:true,spiralOrder:2.75,spiralClosed:closed,rounding:round*100,profileMode:'spline',wholeCurveSpline:true});
  const result=[];const ctx={moveTo(...a){result.push(['M',...a])},lineTo(...a){result.push(['L',...a])},bezierCurveTo(...a){result.push(['C',...a])},closePath(){result.push(['Z'])}};
  somataDrawSplineCornerMode(ctx,pts,closed,round,{layer});
  const cubics=__spiroBuildSpiralBezierSegments(pts,round,[],true,true,layer);
  const key=[n,closed,variant,round].join('-');
  hashes.push({key,drawHash:hashValues(result),gpuHash:hashValues(cubics.map(c=>[c.p0,c.c1,c.c2,c.p3,c.widthScale0,c.widthScale1,c.__profileCorner0,c.__profileCorner1])),drawLen:result.length,gpuLen:cubics.length});count++;
  if((variant===0)&&(n===600||n===2000)&&(round===.5||round===1.5)){
    const quiet={moveTo(){},lineTo(){},bezierCurveTo(){},closePath(){}};
    const direct=()=>somataDrawSplineCornerMode(quiet,pts,closed,round,{layer});
    const gpu=()=>__spiroBuildSpiralBezierSegments(pts,round,[],true,true,layer);
    perf.push({n,closed,round,drawMs:measure(direct),gpuMs:measure(gpu)});
  }
 }
 return{count,hashes,perf};
})()`,{timeoutMs:65000,label:'spiral 12.6.5 comparison and measurements'});
 const gold=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/v1264-spiral-gpu-display-baseline.json'),'utf8'));assert.deepEqual(r.hashes,gold.hashes);console.log('PASS 12.6.5: '+r.count+' exact Chromium visible + GPU spiral parity cases');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
