'use strict';
// The Polygon CPU contour must not switch to a different renderer when the
// "segments ↔ spline" transition progress crosses the .5 mode-label boundary.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:20000});
 try{
  const results=await h.evaluate(`(()=>{
   const points=[{x:0,y:0},{x:35,y:65},{x:90,y:-32},{x:140,y:55},{x:190,y:0}];
   const record=()=>{const lines=[];return{lines,moveTo(x,y){lines.push(['M',x,y]);},lineTo(x,y){lines.push(['L',x,y]);},bezierCurveTo(...x){lines.push(['B',...x]);},closePath(){lines.push(['Z']);}};};
   const out=[];
   for(const closed of [false,true]){
    for(const blend of [.49,.50,.51]){
     const mode=blend<.5?'segments':'spline';
     const ctx=record();drawMorphPathQuality(ctx,points,closed,0,mode,blend,true,'discrete',[],[]);
     const bs=ctx.lines.filter(x=>x[0]==='B');
     out.push({closed,blend,beziers:bs.length,first:bs[0]?.slice(1)||null});
    }
    const ctx=record();drawMorphPathQuality(ctx,points,closed,0,'segments',0,false,'discrete',[],[]);
    out.push({closed,pureDiscrete:ctx.lines.filter(x=>x[0]==='B').length});
   }
   return out;
  })()`,{label:'real profile-mode midpoint geometry with discrete renderer preference'});
  for(const closed of [false,true]){
   const frames=results.filter(r=>r.closed===closed&&Number.isFinite(r.blend));
   assert.equal(frames.length,3);
   assert(frames.every(f=>f.beziers>0&&f.first),'mixed spline loses Bézier path before the midpoint: '+JSON.stringify(frames));
   const adjacent=(a,b)=>a.first.reduce((m,v,i)=>Math.max(m,Math.abs(v-b.first[i])),0);
   assert(adjacent(frames[0],frames[1])<4&&adjacent(frames[1],frames[2])<4,
    'profile changes geometry path abruptly at midpoint: '+JSON.stringify(frames));
   assert.equal(results.find(r=>r.closed===closed&&r.pureDiscrete!==undefined)?.pureDiscrete,0,
    'ordinary discrete segment profile must remain unchanged');
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10433: segments↔spline morph keeps interpolating Bézier controls through the 50% midpoint; authored discrete rendering intact');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10433',e.stack||e);process.exitCode=1;});
