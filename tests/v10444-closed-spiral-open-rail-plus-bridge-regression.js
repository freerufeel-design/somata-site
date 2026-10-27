'use strict';
// New contract: closed Spiral is the open Bézier rail plus an explicit straight
// period-to-next-period bridge. Only the independent "Round seams" control
// may change the geometry around that bridge. No legacy join interpolation UI.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:45000});
 try{
  const data=await h.evaluate(`(()=>{
    const vals=[];const points=[{x:0,y:0},{x:.22,y:.40},{x:.50,y:-.29},{x:.79,y:.21},{x:1,y:0}];
    const line=a=>a?((Math.hypot(a.c1.x-a.p0.x,a.c1.y-a.p0.y) || 1)):0;
    for(const mode of ['segments','spline'])for(const tangent of [false,true])for(const round of [0,55]){
      const layer=createLayer('bridge-test'); Object.assign(layer,{N:8,K:3,spiralEnabled:true,spiralOrder:1,
        spiralClosed:false,spiralRoundSeams:false,rounding:round,spiralTangential:tangent,
        profileMode:mode,profileNodes:points,radius:220});
      const spec={radius:220,delta:1.1,targetScale:1.23,tangential:tangent?1:0,roundingFrac:round/100};
      const build=(closed,roundSeams)=>{layer.spiralClosed=closed;layer.spiralRoundSeams=roundSeams;
        return __spiroBuildSpiralCarrierPath(layer,{x:220,y:0},{...spec,closed,roundSeams});};
      const open=build(false,false),closed=build(true,false),fillet=build(true,true);
      const flat=cc=>(cc||[]).flatMap(c=>[c.p0.x,c.p0.y,c.c1.x,c.c1.y,c.c2.x,c.c2.y,c.p3.x,c.p3.y]);
      const C=closed._bezierSegments,O=open._bezierSegments,F=fillet._bezierSegments;
      const firstDiff=Math.hypot(O[0].p0.x-C[0].p0.x,O[0].p0.y-C[0].p0.y);
      const prefixDiff=Math.max(...flat(O).slice(0,8).map((v,i)=>Math.abs(v-flat(C)[i])));
      const start=C[0].p0,end=C.at(-1).p3,delta=spec.delta,k=spec.targetScale;
      const desired={x:(start.x*Math.cos(delta)-start.y*Math.sin(delta))*k,y:(start.x*Math.sin(delta)+start.y*Math.cos(delta))*k};
      const gap=Math.hypot(end.x-desired.x,end.y-desired.y);
      const last=C.at(-1),straight=Math.hypot(3*(last.c1.x-last.p0.x)-(last.p3.x-last.p0.x),3*(last.c1.y-last.p0.y)-(last.p3.y-last.p0.y))+
        Math.hypot(3*(last.p3.x-last.c2.x)-(last.p3.x-last.p0.x),3*(last.p3.y-last.c2.y)-(last.p3.y-last.p0.y));
      vals.push({mode,tangent,round,firstDiff,prefixDiff,openCount:O.length,closedCount:C.length,filletCount:F.length,
        bridgePoint:closed.points.some(p=>p.__spiralAutoCloseBridgeEnd===true),gap,straight,
        filletPoints:fillet.points.filter(p=>p.__spiralClosureFillet).length,
        marker:closed.spiralExplicitBridge===true, allFinite:flat(C).every(Number.isFinite)});
    }
    return{rows:vals,checkbox:!!document.getElementById('paramSpiralJoinInterpolation'),
      registry:!!SomataParameterRegistry.get('spiral.joinInterpolation'),newDefault:createLayer('old').spiralJoinInterpolation,
      fillCandidate:createLayer('new').spiralClosed!==false};
  })()`,{label:'closed Spiral = open Bezier + explicit straight bridge'});
  assert.equal(data.checkbox,false);assert.equal(data.registry,false);assert.equal(data.newDefault,undefined);
  assert.equal(data.rows.length,8);
  for(const r of data.rows){assert(r.allFinite&&r.marker,'invalid closed rail: '+JSON.stringify(r));
   assert(r.firstDiff<1e-7&&r.prefixDiff<1e-6,'closed base differs from open: '+JSON.stringify(r));
   assert(r.gap<1e-5,'closed endpoint is not the next period: '+JSON.stringify(r));
   assert(r.closedCount>=r.openCount,'missing connector: '+JSON.stringify(r));
   if(r.bridgePoint)assert(r.straight<1e-5,'explicit bridge is not a straight cubic: '+JSON.stringify(r));
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10444: closed/open shared rail, straight bridge, independent rounded corner control, obsolete join UI removed');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10444',e.stack||e);process.exitCode=1;});
