'use strict';
// Reverse of 1 -> 0: Honest Spiral 0 -> 1 must gather Corridor FIRST,
// then unfold the Spiral using its original time and direct-order curve.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const near=(a,b,eps=.015)=>Math.abs(a-b)<eps;
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:23000});
  try{
    const rows=await h.evaluate(`(()=>{
      const old={layers:state.layers,active:state.activeLayerId,tunnel:state.tunnel.active,morph:runtimeState.morph.active};
      const data=[];
      const copies=[{scale:.5,alpha:1},{scale:1,alpha:1},{scale:2,alpha:1}];
      try{
        runtimeState.morph.active=false;
        for(const mode of ['honest','beautiful'])for(const corridor of [true,false]){
          const id='honest-reverse-'+mode+'-'+corridor;
          const layer={...old.layers[0],id,spiralEnabled:true,spiralOrder:0,
            spiralZeroTransitionMode:mode,testMorph:{...SomataTestMorph.config(old.layers[0]),enabled:true,duration:1}};
          state.layers=[layer];state.activeLayerId=id;state.tunnel.active=corridor;
          SomataTestMorph.updateTask();layer.spiralOrder=1;
          const frame=()=>({sourceLayer:layer,layer:{...layer},layerIndex:0});
          const init=performance.now();SomataTestMorph.applyFrame(frame(),init);
          const r=SomataTestMorph.status().transitions.find(x=>x.id===id);
          if(!r)throw Error('No manual tween');
          const introStart=r.start-200;
          const sample=(now)=>{
            const f=frame();SomataTestMorph.applyFrame(f,now);
            const out=__somataCorridorCopiesForLayer(copies,f.layer,now);
            return {order:f.layer.spiralOrder,alpha:out.map(c=>c.alpha),scale:out.map(c=>c.scale),
              intro:__somataCorridorHonestZeroIntro(id,now,f.layer)};
          };
          const points={start:sample(introStart),quarter:sample(introStart+50),
            mid:sample(introStart+100),end:sample(r.start),
            early:sample(r.start+r.duration*.075),geometryHalf:sample(r.start+r.duration*.5),
            finish:sample(r.start+r.duration+1)};
          data.push({mode,corridor,delayed:r.start>init+195,
            geometryDuration:r.duration,totalMs:r.start+r.duration-introStart,points});
          __somataCorridorStopHonestZeroIntro(id);
        }
      }finally{
        state.layers=old.layers;state.activeLayerId=old.active;state.tunnel.active=old.tunnel;
        runtimeState.morph.active=old.morph;SomataTestMorph.updateTask();
      }
      return {data,original:copies};
    })()`,{timeoutMs:22000});
    for(const row of rows.data){
      const p=row.points;
      if(row.mode==='honest'&&row.corridor){
        assert(row.delayed,'Honest 0->1 Spiral should start after gathering completes');
        assert(near(row.geometryDuration,800,.01)&&near(row.totalMs,1000,.01),
          'Both phases must fit exactly in the 1-second Geometry Duration');
        for(const k of ['start','quarter','mid','end'])assert(near(p[k].order,0,1e-7),
          `Spiral geometry moved while Corridor gathered at ${k}`);
        assert(near(p.start.scale[2],2),'Initial Corridor copies must be fully spaced');
        assert(p.quarter.scale[2]>p.mid.scale[2]&&p.mid.scale[2]>p.end.scale[2],
          'Corridor should smoothly gather, not suddenly collapse');
        assert(p.quarter.alpha[2]>p.mid.alpha[2]&&p.mid.alpha[2]>p.end.alpha[2],
          'Gathering should smoothly fade duplicate copies');
        assert(near(p.end.scale[2],1)&&p.end.alpha[2]<.002,
          'Corridor must reach a single figure before Spiral moves');
        assert(near(p.early.order,.075,1e-7),'Spiral must retain the direct order timeline');
        assert(p.early.alpha[2]>0&&p.early.alpha[2]<1,
          'Duplicates should fade in continuously when Spiral starts expanding');
        assert(near(p.geometryHalf.order,.5,1e-7)&&near(p.geometryHalf.alpha[2],1),
          'Once gathering is done, original Spiral multiplication proceeds');
        assert(near(p.finish.order,1,1e-7)&&near(p.finish.scale[2],2),
          'Final order-one Corridor should be fully restored');
      }else{
        assert(!row.delayed,'Beautiful/disabled Corridor must not acquire Honest pre-roll');
        assert.equal(p.start.intro,null,'No intro when Beautiful or Corridor is off');
      }
    }
    assert.deepEqual(rows.original,[{scale:.5,alpha:1},{scale:1,alpha:1},{scale:2,alpha:1}],
      'Corridor shared source copies were mutated');
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS Honest manual 0 -> 1: animated Corridor gathering precedes original Spiral unfolding; other modes unchanged');
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
