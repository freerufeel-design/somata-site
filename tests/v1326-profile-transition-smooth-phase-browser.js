'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:45000});
 try{
  const report=await h.evaluate(`(()=>{
   const old={mode:state.morph.mode,speed:state.morph.speedType,
    transition:state.morph.profileModeTransition,pct:state.morph.profileModeTransitionPercent};
   state.morph.mode='circleSlide';state.morph.speedType='linear';
   const pts=[{x:0,y:0},{x:20,y:50},{x:40,y:35},{x:55,y:-45},{x:90,y:40},{x:115,y:0}];
   const flags=[false,false,false,true,false,false],noFlags=pts.map(()=>false);
   const layer={profileMode:'spline',rounding:0,roundingMode:'standard',N:6,radius:150,wholeCurveSpline:false,spiralEnabled:false};
   const record=run=>{const rows=[],ctx={
    moveTo:(...x)=>rows.push(['M',...x]),lineTo:(...x)=>rows.push(['L',...x]),
    bezierCurveTo:(...x)=>rows.push(['C',...x]),closePath:()=>rows.push(['Z'])
   };run(ctx);return rows;};
   const test=(round,closed,cornerFlags,mode,blend)=>record(c=>drawMorphPathQuality(c,pts,closed,round,mode,blend,true,'smooth',cornerFlags,[],false,0,false,layer));
   const source=(round,closed,cornerFlags)=>record(c=>roundPolylineForDraw(c,pts,closed,round,cornerFlags,null,false,null,layer));
   const target=(round,closed,cornerFlags)=>record(c=>splinePathForDraw(c,pts,closed,round,cornerFlags,[],false,1,0,layer));
   let exactEndpoints=0,partialCurves=0,finite=true,maxEndpointDelta=0,roundedEndMatches=0;
   const maxDiff=(a,b)=>a.length===b.length&&a.every((q,i)=>q.length===b[i].length&&q[0]===b[i][0])
    ?Math.max(0,...a.map((q,i)=>Math.max(0,...q.slice(1).map((x,j)=>Math.abs(x-b[i][j+1]))))):Infinity;
   for(const closed of [false,true]) for(const corners of [flags,noFlags]){
    const src=source(0,closed,corners),dst=target(0,closed,corners);
    const a=test(0,closed,corners,'segments',0),b=test(0,closed,corners,'spline',1);
    if(JSON.stringify(src)!==JSON.stringify(a)||JSON.stringify(dst)!==JSON.stringify(b))throw Error('endpoint mismatch closed='+closed+' flags='+corners.includes(true));
    exactEndpoints+=2;
    const half=test(0,closed,corners,'segments',.5),almost=test(0,closed,corners,'segments',.9999);
    if(!half.some(q=>q[0]==='C')||JSON.stringify(half)===JSON.stringify(dst))throw Error('middle profile does not morph');
    const d=maxDiff(almost,dst);maxEndpointDelta=Math.max(maxEndpointDelta,d);
    if(d>0.02)throw Error('terminal jump '+d+' '+closed);
    for(const c of [...a,...half,...almost,...b])if(c.slice(1).some(x=>!Number.isFinite(x)))finite=false;
    partialCurves++;
    // The approved Spline+ is retained for both positive-rounding endpoints.
    const sa=source(.65,closed,corners),sb=target(.65,closed,corners);
    const ma=test(.65,closed,corners,'segments',0),mb=test(.65,closed,corners,'spline',1);
    if(JSON.stringify(sa)!==JSON.stringify(ma)||JSON.stringify(sb)!==JSON.stringify(mb))
      throw Error('rounded Spline+ endpoint changed');
    roundedEndMatches+=2;
   }
   const clocks={};
   for(const [name,pct] of [['phase',20],['start',20],['end',20],['startZero',0],['endZero',0],['startFull',100],['endFull',100]]){
    state.morph.profileModeTransition=name.startsWith('start')?'start':name.startsWith('end')?'end':'phase';
    state.morph.profileModeTransitionPercent=pct;
    const samples=[0,.01,.1,.2,.5,.8,.9,.99,1].map(t=>morphSplineBlend('segments','spline',t));
    const reverse=[0,.01,.1,.2,.5,.8,.9,.99,1].map(t=>morphSplineBlend('spline','segments',t));
    if(samples.some((v,i)=>Math.abs(v+reverse[i]-1)>1e-9))throw Error('directional asymmetry '+name);
    if(samples.some((v,i)=>i>0&&v+1e-9<samples[i-1]))throw Error('nonmonotone '+name);
    clocks[name]=samples;
   }
   if(Math.abs(clocks.phase[4]-.5)>1e-10||Math.abs(clocks.start[2]-.5)>1e-10||Math.abs(clocks.end[6]-.5)>1e-10)
     throw Error('midpoint phase window incorrect');
   if(clocks.start[3]!==1||clocks.end[5]!==0||clocks.startZero[0]!==1||clocks.endZero[7]!==0)
     throw Error('phase window boundary incorrect');
   if(Math.abs(clocks.startFull[3]-clocks.phase[3])>1e-12||Math.abs(clocks.endFull[6]-clocks.phase[6])>1e-12)
     throw Error('100% window differs from whole phase');
   state.morph.mode=old.mode;state.morph.speedType=old.speed;
   state.morph.profileModeTransition=old.transition;state.morph.profileModeTransitionPercent=old.pct;
   return {exactEndpoints,partialCurves,roundedEndMatches,maxEndpointDelta,finite,clocks};
  })()`,{label:'Spline mixed-profile phase windows and bidirectional continuity',timeoutMs:45000});
  assert.equal(report.exactEndpoints,8);
  assert.equal(report.roundedEndMatches,8);
  assert.equal(report.partialCurves,4);
  assert(report.finite&&report.maxEndpointDelta<.02);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS bidirectional Segments/Spline smooth phase windows, exact endpoints, unrounded joins, preserved rounded Spline+',JSON.stringify(report));
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
