'use strict';
// Catch a second join/closure repair in the static GPU resource after the
// animated Spiral rail has already arrived at its baked, visible end shape.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:110,evalTimeoutMs:26000});
 try{
  const results=await h.evaluate(`(()=>{
   if(typeof GPUBufferUsage==='undefined')window.GPUBufferUsage={STORAGE:128,COPY_DST:8,UNIFORM:64};
   let captured=null;
   const fake={createBuffer(d){return {label:d.label,size:d.size,destroy(){}};},
      queue:{writeBuffer(b,o,data){if(b.label.startsWith('Somata static Spiral current cubics'))captured=Array.from(new Float32Array(data.buffer,data.byteOffset,data.byteLength/4));}}};
   const cases=[];runtimeState.morph.active=false;
   for(const profileMode of ['segments','spline'])for(const spiralClosed of [false,true])for(const rounding of [0,35,75]){
     const l=createLayer('v10426-'+cases.length);
     Object.assign(l,{visible:true,N:9,K:2,spiralEnabled:true,spiralOrder:2.5,
       spiralClosed,spiralTangential:true,spiralRoundSeams:true,
       profileMode,rounding,radius:231,
       profileNodes:[{x:0,y:0},{x:.18,y:.4},{x:.49,y:-.3},{x:.78,y:.2},{x:1,y:0}]});
     state.layers=[l];captured=null;
     const paths=buildOrbitPolylines(l)||[],original=paths.flatMap(p=>(p._bezierSegments||[]).flatMap(q=>
        [q.p0.x,q.p0.y,q.c1.x,q.c1.y,q.c2.x,q.c2.y,q.p3.x,q.p3.y]));
     const gpu=getStaticSpiralBezierResource(0,fake,10426);
     let error=Infinity;
     if(captured&&captured.length===original.length){error=0;for(let i=0;i<original.length;i++)error=Math.max(error,Math.abs(captured[i]-Math.fround(original[i])));}
     cases.push({profileMode,spiralClosed,rounding,count:gpu?.cubicCount,expected:original.length/8,
       captured:captured?.length||0,error});
   }
   return cases;
  })()`,{label:'baked Spiral static GPU resource parity'});
  assert.equal(results.length,12);
  for(const c of results){
    assert(c.count>2&&c.count===c.expected,'wrong static Spiral segment count: '+JSON.stringify(c));
    assert(c.error<1e-6,'extra static GPU rounding after animated Morph: '+JSON.stringify(c));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10426 static GPU Spiral uses the baked Morph-end Bézier controls without re-rounding (12 cases)');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10426',e.stack||e);process.exitCode=1});
