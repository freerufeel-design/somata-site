'use strict';
// Benchmark + geometry checksum for repeated freshly cloned endpoint objects.
// This mirrors the Morph provider's creation of new endpoint snapshots for each layer/frame.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:90000});
 try{
  const result=await h.evaluate(`(()=>{
   const original={mode:state.morph.mode,fourier:state.fourierMode};
   state.morph.mode='circleSlide';state.fourierMode=false;
   const native=document.createElement('canvas').getContext('2d');
   const ctx=createGeometryGLRecordingContext(native);
   const P=[{x:0,y:0},{x:.19,y:.39},{x:.44,y:-.24},{x:.72,y:.22},{x:1,y:0}];
   const Q=[{x:0,y:0},{x:.12,y:-.26},{x:.37,y:.35},{x:.65,y:-.19},{x:.88,y:.27},{x:1,y:0}];
   const layers=Array.from({length:15},(_,i)=>{
      const s=createLayer('source-'+i),d=createLayer('target-'+i);
      Object.assign(s,{id:'source-'+i,N:8+i,K:2+(i%5),radius:180+i*1.2,radiusMultiplier:1,
       rotation:5+i,profileMode:'spline',rounding:135+i%4*10,profileNodes:P.map(n=>({...n})),
       fill:false,closedLoop:true,spiralEnabled:false,spiralOrder:0});
      Object.assign(d,s,{id:'target-'+i,N:11+i,K:4+(i%5),rotation:20+i,
       profileNodes:Q.map(n=>({...n}))});
      return {s,d};
   });
   const fresh=(x)=>({...x,profileNodes:x.profileNodes.map(p=>({...p}))});
   const frame=(count,clock, t,mutate)=>{
     const snapshots=[];let pointTotal=0;
     const started=performance.now();
     for(let i=0;i<count;i++){
        const {s,d}=layers[i];
        if(mutate && i===0)d.rounding+=1;
        const src=fresh(s),dst=fresh(d);
        ctx.__resetForBaseContext(native,true);
        drawAngularAnchorMorph(ctx,dst,src,dst,t,1,'phase','angular');
        ctx.__finishFrame();
        if(ctx.unsupported)throw Error('GPU recorder rejected geometry');
        pointTotal+=ctx.__pointCount;
        if(!clock){
          // Hash an ordered sample of the actual GPU polylines, not the source nodes.
          let h=2166136261,points=0,bx=0,by=0;
          for(const cmd of ctx.commands)for(const sp of cmd.subpaths||[])for(const p of sp.points||[]){
            const xi=Math.round(p.x*10000),yi=Math.round(p.y*10000);
            h=Math.imul(h^xi,16777619);h=Math.imul(h^yi,16777619);
            bx+=p.x;by+=p.y;points++;
          }
          snapshots.push({i,points,hash:h>>>0,sumX:Number(bx.toFixed(5)),sumY:Number(by.toFixed(5))});
        }
     }
     return {ms:performance.now()-started,pointTotal,snapshots};
   };
   try{
     const pre=(typeof window.__somataFilletCorrectionCacheStatus==='function' ? window.__somataFilletCorrectionCacheStatus():null);
     const first=frame(15,false,.2,false);
     const next=frame(15,false,.5,false);
     const repeat=frame(15,false,.2,false);
     const beforeMut=frame(1,false,.5,false);
     const afterMut=frame(1,false,.5,true);
     // restore original target for pure speed test.
     layers[0].d.rounding-=1;
     for(let j=0;j<2;j++)frame(15,true,.18+j*.2,false);
     const runs=[];
     for(let k=0;k<5;k++)runs.push(frame(15,true,.13+((k*7)%11)/15,false).ms);
     runs.sort((a,b)=>a-b);
     const post=(typeof window.__somataFilletCorrectionCacheStatus==='function' ? window.__somataFilletCorrectionCacheStatus():null);
     return {first,next,repeat,beforeMut,afterMut,median15Ms:runs[2],runs,
       cacheBefore:pre,cacheAfter:post};
   }finally{state.morph.mode=original.mode;state.fourierMode=original.fourier;}
  })()`,{label:'15 layers fresh endpoint snapshot performance and invariants',timeoutMs:85000});
  const outfile=process.env.SOMATA_STRESS_REPORT;
  if(outfile)fs.writeFileSync(outfile,JSON.stringify(result,null,2));
  assert.equal(result.first.snapshots.length,15);
  assert.equal(result.repeat.snapshots.length,15);
  assert.deepEqual(result.first.snapshots,result.repeat.snapshots,'same time shape must be identical');
  assert.notDeepEqual(result.beforeMut.snapshots,result.afterMut.snapshots,'parameter change must invalidate cache');
  if(result.cacheAfter){
    assert.ok(result.cacheAfter.hits>=30,'expected per-layer cache hits after warm-up');
    assert.ok(result.cacheAfter.size<=result.cacheAfter.max,'bounded cache limit');
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log(JSON.stringify({passed:true,median15Ms:result.median15Ms,draws15FPS:1000/result.median15Ms,
    maxCacheSize:result.cacheAfter?.max,hits:result.cacheAfter?.hits,misses:result.cacheAfter?.misses,
    builds:result.cacheAfter?.builds,points:result.first.pointTotal},null,2));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
