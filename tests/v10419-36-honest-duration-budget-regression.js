'use strict';
// Two ordered stages, both directions, exactly one Geometry Animation duration.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:30000});
 try{
  const rows=await h.evaluate(`(()=>{
   const old={layers:state.layers,active:state.activeLayerId,tunnel:state.tunnel.active,
     morph:runtimeState.morph.active};
   const records=[];
   try{
    runtimeState.morph.active=false;state.tunnel.active=true;
    for(const duration of [.1,1,4.5])for(const forward of [true,false]){
     const from=forward?1:0,to=forward?0:1;
     const id='budget-'+duration+'-'+from+'-'+to;
     const layer={...old.layers[0],id,spiralEnabled:true,spiralOrder:from,
       spiralZeroTransitionMode:'honest',testMorph:{enabled:true,duration}};
     state.layers=[layer];state.activeLayerId=id;SomataTestMorph.updateTask();
     layer.spiralOrder=to;
     const frame=(at)=>{
       const f={sourceLayer:layer,layer:{...layer},layerIndex:0};
       SomataTestMorph.applyFrame(f,at);
       return {order:f.layer.spiralOrder,
         intro:__somataCorridorHonestZeroIntro(id,at,f.layer),
         outro:__somataCorridorHonestZeroOutro(id,at)};
     };
     const begin=performance.now();frame(begin);
     const r=SomataTestMorph.status().transitions.find(x=>x.id===id);
     if(!r)throw Error('Missing Geometry animation '+id);
     const total=duration*1000,geometry=r.duration,corridor=r.corridorMs;
     const t0=forward?r.start:r.start-corridor;
     const p0=frame(t0),p10=frame(t0+total*.1),p20=frame(t0+total*.2),
       p50=frame(t0+total*.5),p80=frame(t0+total*.8),
       p90=frame(t0+total*.9),p100=frame(t0+total);
     const configuredPhase=SomataTestMorph.phase(layer,t0+total*.5);
     records.push({duration,forward,geometry,corridor,totalDuration:r.totalDuration,
       phaseDuration:configuredPhase.duration,p0,p10,p20,p50,p80,p90,p100});
     __somataCorridorStopHonestZeroOutro(id);
     __somataCorridorStopHonestZeroIntro(id);
    }
    return records;
   }finally{
    state.layers=old.layers;state.activeLayerId=old.active;state.tunnel.active=old.tunnel;
    runtimeState.morph.active=old.morph;SomataTestMorph.updateTask();
   }
  })()`,{timeoutMs:30000});
  const near=(a,b,eps=2e-5)=>Math.abs(a-b)<eps;
  assert.equal(rows.length,6);
  for(const r of rows){
   const T=r.duration*1000;
   assert(near(r.totalDuration,T)&&near(r.phaseDuration,T),
     'Geometry duration control must remain source of truth');
   assert(near(r.geometry,T*.8)&&near(r.corridor,T*.2),
     'Both phases must be budgeted inside one interval');
   assert(near(r.geometry+r.corridor,T));
   if(r.forward){
    assert(near(r.p0.order,1)&&near(r.p50.order,.375)&&near(r.p80.order,0),
      'Forward Spiral must finish at 80% with the exact direct-order trajectory');
    assert.equal(r.p50.outro,null,'Postlude must not begin before order zero');
    assert(r.p80.outro?.progress<.001);
    assert(near(r.p90.order,0)&&near(r.p90.outro?.progress,.5),
      'Corridor multiplication must be animated during the remaining 20%');
    assert(near(r.p100.order,0)&&near(r.p100.outro?.progress,1),
      'Multiplication must finish by the configured deadline');
   }else{
    assert(near(r.p0.order,0)&&near(r.p10.order,0)&&near(r.p20.order,0),
      'Reverse Corridor must gather before Spiral moves');
    assert(near(r.p10.intro?.progress,.5),
      'Reverse Corridor must animate instead of disappearing abruptly');
    assert(near(r.p50.order,.375)&&near(r.p80.order,.75),
      'Reverse Spiral must use the remaining 80% with its direct order curve');
    assert(near(r.p100.order,1)&&r.p100.intro===null,
      'Reverse must complete at configured time without an extra phase');
   }
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS Honest Geometry Duration 0.1s / 1s / 4.5s includes both ordered Corridor phases in each direction');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
