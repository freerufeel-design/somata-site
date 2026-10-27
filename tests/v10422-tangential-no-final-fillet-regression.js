'use strict';
// Tangential Spiral gets no unsolicited joint smoothing. Authored Round seams
// is a separate explicit choice, and must work without reintroducing a final
// per-frame post-Morph modification of the open rail.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:17000});
 try{
  const results=await h.evaluate(`(()=>{
    const res=[];
    for(const mode of ['segments','spline'])for(const mix of [.25,1])for(const order of [-2,2]){
      const layer=createLayer('tangential-no-fillet');
      Object.assign(layer,{N:7,K:2,spiralEnabled:true,spiralOrder:order,spiralClosed:true,
        spiralTangential:true,__spiralTangentialMix:mix,spiralRoundSeams:true,
        radius:220,rounding:55,profileMode:mode,
        profileNodes:[{x:0,y:0},{x:.23,y:.24},{x:.57,y:-.13},{x:1,y:0}]});
      const get=()=>{
        const path=(buildOrbitPolylines(layer)||[])[0];
        return {points:(path?.points||[]).map(p=>({x:p.x,y:p.y,fillet:!!p.__spiralClosureFillet})),
            cubics:(path?._bezierSegments||[]).map(q=>[q.p0,q.c1,q.c2,q.p3].flatMap(v=>[v.x,v.y]))};
      };
      const on=get();layer.spiralRoundSeams=false;const off=get();
      const equalPoints=on.points.length===off.points.length&&on.points.every((p,i)=>Math.hypot(p.x-off.points[i].x,p.y-off.points[i].y)<1e-7);
      const equalCubics=on.cubics.length===off.cubics.length&&on.cubics.every((q,i)=>q.length===off.cubics[i].length&&q.every((v,j)=>Math.abs(v-off.cubics[i][j])<1e-7));
      res.push({mode,mix,order,points:on.points.length,cubics:on.cubics.length,fillets:on.points.filter(p=>p.fillet).length,equalPoints,equalCubics});
    }
    return res;
 })()`,{label:'tangential joint fillet remains strictly opt-in'});
  assert.equal(results.length,8);
  for(const x of results){assert(x.points>3&&x.cubics>2,'missing Spiral render geometry '+JSON.stringify(x));
   assert(x.fillets>0,'checked seam toggle did not round the tangential joint '+JSON.stringify(x));
   assert(!x.equalPoints&&!x.equalCubics,'checked seam toggle had no geometric effect '+JSON.stringify(x));}
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10422 tangential Spiral rounds joints only when explicitly requested (8 combinations)');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
