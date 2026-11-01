'use strict';
// Honest Spiral 1 -> 0 must finish its original geometry before Corridor spreads.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:25000});
  try{
    const out=await h.evaluate(`(async()=>{
      const original=state.layers,activeId=state.activeLayerId;
      const oldTunnel=state.tunnel.active,oldMorph=runtimeState.morph.active;
      const base=original[0];
      const copies=[{scale:.5,stepRatio:1.1,alpha:1},{scale:1,stepRatio:1.1,alpha:1},{scale:2,stepRatio:1.1,alpha:1}];
      const sample=(frame,now=performance.now())=>{
        const scaled=spiralCorridorCopiesForLayer(copies,frame.layer,now);
        const multiplied=__somataCorridorCopiesForLayer(scaled,frame.layer,now);
        return {order:frame.layer.spiralOrder,post:__somataCorridorHonestZeroOutro(frame.layer.id,now),
          scale:multiplied.map(c=>c.scale),alpha:multiplied.map(c=>c.alpha)};
      };
      const modeSamples=[];
      try{
        state.tunnel.active=true;runtimeState.morph.active=false;
        for(const mode of ['honest','beautiful']){
          const id='postzero-'+mode;
          const layer={...base,id,spiralEnabled:true,spiralOrder:1,spiralZeroTransitionMode:mode,
            testMorph:{...SomataTestMorph.config(base),enabled:true,duration:1}};
          state.layers=[layer];state.activeLayerId=id;SomataTestMorph.updateTask();
          layer.spiralOrder=0;
          const fresh=()=>({sourceLayer:layer,layer:{...layer},layerIndex:0});
          SomataTestMorph.applyFrame(fresh(),performance.now());
          const rec=SomataTestMorph.status().transitions.find(x=>x.id===id);
          if(!rec)throw Error('Missing manual transition');
          const pre=[];
          for(const t of [.1,.5,.9,.99]){
            const f=fresh();SomataTestMorph.applyFrame(f,rec.start+rec.duration*t);
            pre.push({t,...sample(f,rec.start+rec.duration*t)});
          }
          const f=fresh();SomataTestMorph.applyFrame(f,rec.start+rec.duration);
          const atEnd=sample(f,rec.start+rec.duration);
          const middle=sample({...f,layer:{...f.layer,spiralOrder:0}},rec.start+rec.duration+100);
          const done=sample({...f,layer:{...f.layer,spiralOrder:0}},rec.start+rec.duration+200);
          modeSamples.push({mode,pre,atEnd,middle,done,geometryDuration:rec.duration});
          __somataCorridorStopHonestZeroOutro(id);
        }
        state.tunnel.active=false;
        const noCorridor={...base,id:'no-corridor-postzero',spiralEnabled:true,spiralOrder:1,
          spiralZeroTransitionMode:'honest',testMorph:{enabled:true,duration:1}};
        state.layers=[noCorridor];state.activeLayerId=noCorridor.id;
        SomataTestMorph.updateTask();noCorridor.spiralOrder=0;
        const f=()=>({sourceLayer:noCorridor,layer:{...noCorridor},layerIndex:0});
        SomataTestMorph.applyFrame(f(),performance.now());
        const rec=SomataTestMorph.status().transitions.find(x=>x.id===noCorridor.id);
        SomataTestMorph.applyFrame(f(),rec.start+rec.duration+1);
        const noCorridorPost=__somataCorridorHonestZeroOutro(noCorridor.id);
        return {modeSamples,noCorridorPost,unchanged:copies.map(c=>c.scale)};
      }finally{
        state.layers=original;state.activeLayerId=activeId;
        state.tunnel.active=oldTunnel;runtimeState.morph.active=oldMorph;
        SomataTestMorph.updateTask();
      }
    })()`,{timeoutMs:25000});
    const [honest,beautiful]=out.modeSamples;
    assert.equal(honest.mode,'honest');assert.equal(beautiful.mode,'beautiful');
    assert(Math.abs(honest.geometryDuration-800)<.01,'Geometry must use 80% of total duration');
    assert(Math.abs(beautiful.geometryDuration-1000)<.01,'Beautiful duration is unchanged');
    for(const p of honest.pre){
      assert(Math.abs(p.order-(1-p.t))<1e-5,'Spiral geometry was re-timed before order zero');
      assert.equal(p.post,null,'Corridor began multiplying before geometry finished');
      assert(p.scale[2]>1&&p.scale[2]<2,'Original Spiral copy gathering was modified');
    }
    assert.equal(honest.atEnd.order,0);
    assert(Math.abs(honest.atEnd.scale[2]-1)<.005,'Zero-order corridor should be collapsed at finish');
    assert(honest.atEnd.alpha[0]<.01&&honest.atEnd.alpha[2]<.01,'Single-figure endpoint must hide other copies');
    assert(honest.middle.scale[2]>1.01&&honest.middle.scale[2]<1.99,'No smoothly expanding Corridor after reaching zero');
    assert(honest.middle.alpha[2]>.01&&honest.middle.alpha[2]<.99,'Extra copies must fade in over time');
    assert(Math.abs(honest.done.scale[2]-2)<.001&&honest.done.alpha.every(a=>a>.99),
      'Post-animation must reach the full original Corridor, without snapping');
    assert.equal(beautiful.atEnd.post,null,'Beautiful must remain unchanged');
    assert(Math.abs(beautiful.atEnd.scale[2]-2)<.001,'Beautiful endpoint must retain original Corridor');
    assert.equal(out.noCorridorPost,null,'Corridor disabled must never start multiplication');
    assert.deepEqual(out.unchanged,[.5,1,2],'Shared Corridor copies were changed');
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS 10.4.19.36 Honest exact Spiral collapse, THEN animated Corridor multiplication; other modes unchanged');
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
