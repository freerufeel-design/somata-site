'use strict';
// Compare every emitted Bézier coordinate, width and corner bit against the
// unmodified Somata 12.6.7 implementation. Includes long non-direct rounded
// rails where repeated prefix scans were quadratic in source point count.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:75,evalTimeoutMs:60000});
 try{
  const r=await h.evaluate(`(()=>{
   state.fourierMode=false;
   const hash=(v)=>{const s=JSON.stringify(v);let h=2166136261;for(let i=0;i<s.length;i++){h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;}return h>>>0;};
   const settings=[];
   for(const n of [13,80,240,700,2100])for(const closed of [false,true])for(const rnd of [0,.001,.09,.6,1.6]){
      if(n>=700&&rnd===0)continue;
      const type=(n+Math.round(rnd*100))%3;
      settings.push({n,closed,rnd,type});
   }
   const output=[];
   for(const c of settings){
    const layer=createLayer('width-'+c.n);Object.assign(layer,{N:8,K:3,radius:200,spiralEnabled:true,spiralOrder:2.5,spiralClosed:c.closed,rounding:c.rnd*100,profileMode:c.type===0?'spline':'segments',wholeCurveSpline:c.type===0});
    const pts=Array.from({length:c.n},(_,i)=>{const t=i/(c.n-1),a=t*14*Math.PI,r=20+170*t;return{x:r*Math.cos(a),y:r*Math.sin(a),widthScale:.24+1.6*t+Math.sin(i*.1)*.03,__profileCorner:i%17===0};});
    if(c.type===2){for(let i=1;i<c.n-1;i+=31){pts[i].__spiralBezierOutTx=1.2;pts[i].__spiralBezierOutTy=0.3;}}
    if(c.closed){pts[0].__spiralClosed=true;pts[0].__spiralDelta=1.7;pts[0].__spiralTargetScale=1.3;pts[0].__spiralTangential=true;}
    const flags=pts.map((_,i)=>i%17===0);
    const cubics=__spiroBuildSpiralBezierSegments(pts,c.rnd,flags,c.type===0,c.type===0,layer);
    const repr=cubics.map(q=>[q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y,q.widthScale0,q.widthScale1,q.__profileCorner0,q.__profileCorner1]);
    output.push({key:[c.n,c.closed,c.rnd,c.type].join('-'),segments:repr.length,hash:hash(repr)});
   }
   const benchmark=[];
   const layer=createLayer('remap-speed');Object.assign(layer,{N:8,K:3,radius:200,spiralEnabled:true,profileMode:'segments',rounding:75,spiralOrder:2,spiralClosed:false});
   for(const n of [300,900,2100]){
    const pts=Array.from({length:n},(_,i)=>{let t=i/(n-1),a=t*Math.PI*14,r=20+180*t;return {x:r*Math.cos(a),y:r*Math.sin(a),widthScale:.3+t*1.4}}),flags=pts.map((p,i)=>i%17===0);
    for(let i=0;i<6;i++)__spiroBuildSpiralBezierSegments(pts,.75,flags,false,false,layer);
    const samples=[];for(let i=0;i<20;i++){const start=performance.now();__spiroBuildSpiralBezierSegments(pts,.75,flags,false,false,layer);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);benchmark.push({n,medianMs:samples[10],p90Ms:samples[18]});
   }
   return {output,benchmark};
  })()`,{timeoutMs:55000,label:'12.6.8 spiral width remap exact parity'});
  const fixture=path.join(__dirname,'fixtures/v1268-spiral-width-remap-1267.json');
  if(process.argv.includes('--emit-baseline')){fs.writeFileSync(fixture,JSON.stringify(r.output,null,2)+'\n');console.log('BASELINE saved',fixture)}
  else {const gold=JSON.parse(fs.readFileSync(fixture,'utf8'));assert.deepEqual(r.output,gold,'any spiral cubic point / width / corner changed vs unmodified 12.6.7');console.log('PASS 12.6.8: '+gold.length+' exact legacy 12.6.7 Spiral rails unchanged');}
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('CPU-only 20-sample median (not FPS):',JSON.stringify(r.benchmark));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
