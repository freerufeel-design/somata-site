// Real Chromium reference parity: compare numeric Lamps attachment output to 8.13.0.
// The reference lives in fixtures and is never loaded in production.
const fs=require('fs'),path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const reference=fs.readFileSync(path.join(__dirname,'fixtures/v813-lamp-projection-reference.js'),'utf8');
const assert=(x,msg)=>{if(!x)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:22000});
 try{
  const r=await h.evaluate(`(()=>{
    ${reference}
    const active=frameGeometryRuntime.active;
    try{
      frameGeometryRuntime.active=true;
      const cases=[{n:2,closed:false},{n:47,closed:true},{n:48,closed:true},{n:49,closed:false},{n:128,closed:false},{n:512,closed:true},{n:2048,closed:true},{n:2048,closed:false},{n:4096,closed:true}];
      let matched=0;
      for(let shapeIndex=0;shapeIndex<cases.length;shapeIndex++){
        const {n,closed}=cases[shapeIndex];
        let pts=Array.from({length:n},(_,i)=>({x:Math.sin(i*.063)*(50+i*.04)+i*.008,y:Math.cos(i*.037)*(60+i*.015)}));
        if(shapeIndex===3)pts=pts.map((p,i)=>i%5===0?{x:0,y:0}:p);
        const rail={points:pts,closed};
        for(let j=0;j<48;j++){
          const anchor={x:Math.sin(j*.71)*160,y:Math.cos(j*.9)*180};
          const fraction=j%3===0?0:j%3===1?.97:j/50;
          const a=referenceNearestLampFractionOnPathStable(anchor,rail,fraction);
          const b=nearestLampFractionOnPathStable(anchor,rail,fraction);
          if(JSON.stringify(a)!==JSON.stringify(b))throw Error('stable mismatch '+shapeIndex+' '+j);
          const c=referenceNearestLampFractionOnPathSegmentBound(anchor,rail,fraction,.07);
          const d=nearestLampFractionOnPathSegmentBound(anchor,rail,fraction,.07);
          if(JSON.stringify(c)!==JSON.stringify(d))throw Error('window mismatch '+shapeIndex+' '+j);
          matched+=2;
        }
      }
      // Benchmark the projection itself using the same already cached length table.
      const points=Array.from({length:4096},(_,i)=>({x:Math.sin(i*.01)*200+i*.02,y:Math.cos(i*.011)*200}));
      const rail={points,closed:true},anchors=Array.from({length:80},(_,i)=>({x:Math.sin(i*.33)*220,y:Math.cos(i*.39)*225}));
      function bench(fn){const ms=[];for(let rep=0;rep<5;rep++){const st=performance.now();for(let i=0;i<anchors.length;i++)fn(anchors[i],rail,(i*17%83)/83);ms.push(performance.now()-st);}ms.sort((a,b)=>a-b);return ms[2];}
      const oldMs=bench(referenceNearestLampFractionOnPathStable),newMs=bench(nearestLampFractionOnPathStable);
      const oldWindow=bench(referenceNearestLampFractionOnPathSegmentBound),newWindow=bench(nearestLampFractionOnPathSegmentBound);
      return {matched,oldMs,newMs,oldWindow,newWindow,boot:window.__spiroAppBootComplete===true};
    } finally{frameGeometryRuntime.active=active;}
  })()`,{timeoutMs:19000,label:'lamp contour projection'});
  assert(r.boot&&r.matched===864,'missing comparisons '+r.matched);
  // Timing is diagnostic only: short browser measurements are noisy on CI.
  assert(uncaughtExceptions(h.events).length===0,'uncaught: '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS 8.14 Lamps Static/Morph contour projection',JSON.stringify(r));
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL 8.14 lamp projection',err.stack||err);process.exitCode=1});
