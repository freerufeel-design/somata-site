'use strict';
// Regression: seam rounding has NO independent default/minimum. The checkbox
// permits ONLY the current vertex-rounding strength (0% means sharp corners),
// while preserving the unified open-rail + closed-bridge geometry.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:45000});
 try{
  const result=await h.evaluate(`(()=>{
   const out=[];const nodes=[{x:0,y:0},{x:.16,y:.44},{x:.48,y:-.32},{x:.79,y:.25},{x:1,y:0}];
   for(const mode of ['segments','spline'])for(const tangential of [false,true])for(const rounding of [0,20,55,100]){
     const l=createLayer('connector');Object.assign(l,{N:8,K:3,spiralEnabled:true,spiralOrder:1,spiralClosed:true,spiralRoundSeams:false,
       profileMode:mode,rounding,spiralTangential:tangential,profileNodes:nodes,radius:235});
     const params={radius:235,delta:1.12,targetScale:1.23,tangential:tangential?1:0,roundingFrac:rounding/100,closed:true};
     const build=enabled=>__spiroBuildSpiralCarrierPath(l,{x:235,y:0},{...params,roundSeams:enabled});
     const unrounded=build(false),rounded=build(true);
     const offAgain=build(false);
     const flatten=a=>(a||[]).flatMap(c=>[c.p0.x,c.p0.y,c.c1.x,c.c1.y,c.c2.x,c.c2.y,c.p3.x,c.p3.y]);
     const equal=(a,b)=>a.length===b.length&&a.every((n,i)=>Math.abs(n-b[i])<1e-8);
     const off=flatten(unrounded._bezierSegments),on=flatten(rounded._bezierSegments),off2=flatten(offAgain._bezierSegments);
     const markers=rounded.points.filter(p=>p.__spiralClosureFillet).length;
     const f=rounded._bezierSegments[0].p0,e=rounded._bezierSegments.at(-1).p3;
     const sharpBridgeStart=unrounded.points.at(-2);
     const filletStart=rounded.points.find(p=>p.__spiralClosureFillet==='bridge-start');
     const localCut=filletStart&&sharpBridgeStart?Math.hypot(filletStart.x-sharpBridgeStart.x,filletStart.y-sharpBridgeStart.y):null;
     const {delta,targetScale:k}=params,expected={x:(f.x*Math.cos(delta)-f.y*Math.sin(delta))*k,y:(f.x*Math.sin(delta)+f.y*Math.cos(delta))*k};
     out.push({mode,tangential,rounding,offCount:off.length,onCount:on.length,markers,changed:!equal(off,on),offStable:equal(off,off2),localCut,
       bridgePresent:unrounded.spiralExplicitBridge===true,endpointError:Math.hypot(e.x-expected.x,e.y-expected.y),
       finite:on.every(Number.isFinite),offMarkerCount:unrounded.points.filter(p=>p.__spiralClosureFillet).length});
   }
   return out;
  })()`,{label:'seam fillet checkbox controls only closed connector geometry'});
  assert.equal(result.length,16);
  for(const x of result){
   assert(x.bridgePresent&&x.finite&&x.offStable,'base closed-rail mutated: '+JSON.stringify(x));
   assert.equal(x.offMarkerCount,0,'disabled checkbox inserted fillet: '+JSON.stringify(x));
   if(x.rounding===0){
     assert.equal(x.markers,0,'0% rounding must not add seam fillets: '+JSON.stringify(x));
     assert.equal(x.changed,false,'0% rounding must be geometrically identical on/off: '+JSON.stringify(x));
     assert.equal(x.onCount,x.offCount,'0% rounding must not subdivide connector: '+JSON.stringify(x));
   }else{
     assert(x.markers>=8&&x.changed&&x.onCount>x.offCount,'nonzero vertex rounding did not affect checked seam: '+JSON.stringify(x));
   }
   assert(x.endpointError<1e-5,'connector endpoint no longer matches next spiral period: '+JSON.stringify(x));
  }
  for(const mode of ['segments','spline'])for(const tangential of [false,true]){
    const subset=result.filter(x=>x.mode===mode&&x.tangential===tangential);
    const cuts=subset.filter(x=>x.localCut!==null);
    if(cuts.length>=2){
       for(let i=1;i<cuts.length;i++)assert(cuts[i].localCut>=cuts[i-1].localCut-1e-6,
         'seam cut should follow increasing vertex rounding: '+JSON.stringify(cuts));
    }
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10446: seam fillets follow vertex rounding (including 0%=sharp) across segments/spline and tangential modes');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10446',e.stack||e);process.exitCode=1;});
