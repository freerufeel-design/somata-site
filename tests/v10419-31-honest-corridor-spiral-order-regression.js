'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const near=(a,b,eps=1e-7)=>Math.abs(a-b)<=eps;
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:18000});
 try{
  const r=await h.evaluate(`(()=>{
   const plan=window.SomataSpiralZeroTransition.plan;
   const times=[0,.15,.3,.4,.5,.6,.7,.85,1];
   const matrix=[];
   for(const mode of ['honest','beautiful'])for(const [from,to] of [[3,0],[0,3],[-2,0],[0,-2],[2,-3]]){
    const rows=times.map(t=>({t,...plan(mode,from,to,t,true)}));
    matrix.push({mode,from,to,rows});
   }
   const plain={honest:plan('honest',3,0,.25,false),beautiful:plan('beautiful',3,0,.25,false),
     nonzero:plan('honest',-2,3,.5,true)};
   const gpu=[];const tunnelBeforeGpu=state.tunnel.active;state.tunnel.active=true;
   for(const mode of ['honest','beautiful'])for(const [from,to] of [[3,0],[0,3]]){
    const sourceLayer={spiralEnabled:true,spiralOrder:from,spiralZeroTransitionMode:mode};
    const targetLayer={spiralEnabled:true,spiralOrder:to};
    for(const t of times){gpu.push({mode,from,to,t,result:WebGPUSpiralBezierMorphRenderer.debugResolveEffectT(
      {sourceLayer,targetLayer,staticEdit:false},t)});}
   }
   state.tunnel.active=tunnelBeforeGpu;
   const savedLayers=state.layers,savedActive=state.activeLayerId;
   const layer={...savedLayers[0],id:'honest-regression-31'},saved={tunnel:state.tunnel.active};
   state.layers=[layer];state.activeLayerId=layer.id;
   const animations=[];
   try{
    state.tunnel.active=true;
    layer.spiralEnabled=true;layer.spiralOrder=3;layer.spiralZeroTransitionMode='honest';
    layer.testMorph={...SomataTestMorph.config(layer),enabled:true,duration:.6};
    SomataTestMorph.updateTask();
    for(const [from,to] of [[3,0],[0,3]]){
     layer.spiralOrder=to;
     const frame=()=>({sourceLayer:layer,layer:{...layer},layerIndex:0});
     SomataTestMorph.applyFrame(frame(),performance.now());
     const active=__somataCorridorOrderChangeActive(layer.id),transition=SomataTestMorph.status().transitions.find(r=>r.id===layer.id);
     const samples=[];
     if(transition){
      for(const t of [.15,.5,.85]){
       const ctx=frame();
       SomataTestMorph.applyFrame(ctx,transition.start+t*transition.duration);
       samples.push({t,order:ctx.layer.spiralOrder,active:__somataCorridorOrderChangeActive(layer.id)});
      }
      // Commit the exact endpoint for the next edit.
      SomataTestMorph.applyFrame(frame(),transition.start+transition.duration+1);
     }
     animations.push({from,to,active,transition:!!transition,samples});
    }
   }finally{
    state.layers=savedLayers;state.activeLayerId=savedActive;
    state.tunnel.active=saved.tunnel;SomataTestMorph.updateTask();
   }
   return {matrix,plain,gpu,animations};
  })()`,{timeoutMs:17000});
  for(const c of r.matrix){
   const rows=c.rows,endpoint=(at)=>c.from+(c.to-c.from)*at;
   if(c.from!==0&&c.to!==0){
    assert(rows.every(x=>!x.choreographed&&near(x.population,1)),`nonzero crossing unexpectedly staged: ${c.mode}`);
    continue;
   }
   assert(rows.every(x=>x.choreographed),`missing corridor choreography ${c.mode}`);
   if(c.mode==='beautiful'){
     assert(near(rows[1].order,c.from),`Beautiful must gather before changing shape ${c.from}->${c.to}`);
     assert(near(rows[2].order,c.from),`Beautiful gather seam mismatch`);
     assert(near(rows[6].order,c.to)&&near(rows[7].order,c.to),`Beautiful must disperse after changing shape`);
   }else{
     for(const row of rows)assert(near(row.order,endpoint(row.t)),`Honest must stay linear like 10.4.19.29 at t=${row.t}`);
   }
   assert(near(rows[3].population,0)&&near(rows[4].population,0)&&near(rows[5].population,0),
     `Blue Corridor population curve must be retained for both modes`);
   assert(near(rows[4].order,endpoint(.5)),`halfway shape ${c.mode} ${c.from}->${c.to}`);
   assert(near(rows[0].population,1)&&near(rows[8].population,1),`copy endpoints ${c.mode}`);
   assert(near(rows[0].order,c.from)&&near(rows[8].order,c.to),`shape endpoints ${c.mode}`);
  }
  assert(near(r.plain.honest.order,2.25)&&near(r.plain.beautiful.order,2.53125),
    'Non-Corridor Honest linear and Beautiful smooth modes must stay separate');
  assert.equal(r.plain.nonzero.choreographed,false);
  for(const row of r.gpu){
   const matching=r.matrix.find(x=>x.mode===row.mode&&x.from===row.from&&x.to===row.to);
   const target=matching.rows.find(x=>x.t===row.t);
   assert(near(row.result,(target.order-row.from)/(row.to-row.from),1e-5),`GPU rail desynced ${JSON.stringify(row)}`);
  }
  assert.equal(r.animations.length,2);
  for(const a of r.animations){
   assert(!a.active&&a.transition,`Honest Animation must not fold Corridor copies ${a.from}->${a.to}`);
   assert.equal(a.samples.length,3);
   for(const sample of a.samples)assert(near(sample.order,a.from+(a.to-a.from)*sample.t),
     `Honest Animation must use direct order like 10.4.19.29 at t=${sample.t}`);
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 10.4.19.33 Honest reference direct geometry + GPU + uncollapsed Animation (both directions)');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
