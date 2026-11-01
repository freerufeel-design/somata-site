'use strict';
// 10.4.19.33: regression for user's original Honest Spiral duplication, as in 10.4.19.29.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const near=(a,b,eps=.02)=>Math.abs(a-b)<eps;
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:18000});
  try{
    const result=await h.evaluate(`(()=>{
      const saved={layers:state.layers,activeId:state.activeLayerId,tunnel:state.tunnel.active,morph:runtimeState.morph.active};
      const out=[];
      try{
        state.tunnel.active=true;runtimeState.morph.active=false;
        for(const mode of ['honest','beautiful'])for(const [from,to] of [[3,0],[0,3]]){
          const layer={...saved.layers[0],id:'honest-population-'+mode+'-'+from+'-'+to,
            spiralEnabled:true,spiralOrder:from,spiralZeroTransitionMode:mode,
            testMorph:{...SomataTestMorph.config(saved.layers[0]),enabled:true,duration:1}};
          state.layers=[layer];state.activeLayerId=layer.id;
          SomataTestMorph.updateTask();
          layer.spiralOrder=to;
          const t0=performance.now();
          const context=()=>({sourceLayer:layer,layer:{...layer},layerIndex:0});
          SomataTestMorph.applyFrame(context(),t0);
          const record=SomataTestMorph.status().transitions.find(x=>x.id===layer.id);
          if(!record)throw Error('missing manual animation '+mode);
          const halfTime=record.start+record.duration*.5;
          const frame=context();
          SomataTestMorph.applyFrame(frame,halfTime);
          const copies=[{scale:.5,alpha:1},{scale:1,alpha:1},{scale:2,alpha:1}];
          const rendered=__somataCorridorCopiesForLayer(copies,frame.layer,halfTime);
          out.push({mode,from,to,order:frame.layer.spiralOrder,
            staged:__somataCorridorOrderChangeActive(layer.id),
            copies:rendered.map(x=>({scale:x.scale,alpha:x.alpha})),
            unchangedOriginal:copies.every(x=>x.alpha===1)});
          SomataTestMorph.applyFrame(context(),record.start+record.duration+1);
        }
      }finally{
        state.layers=saved.layers;state.activeLayerId=saved.activeId;
        state.tunnel.active=saved.tunnel;runtimeState.morph.active=saved.morph;
        SomataTestMorph.updateTask();
      }
      return out;
    })()`,{timeoutMs:16000});
    assert.equal(result.length,4);
    for(const row of result){
      assert(near(row.order,(row.from+row.to)/2),`wrong mid-phase Spiral order: ${JSON.stringify(row)}`);
      assert(row.unchangedOriginal,'Corridor input was mutated');
      if(row.mode==='honest'){
        assert.equal(row.staged,false,'Honest must not hide multiplied Spirals behind Beautiful staging');
        assert.deepEqual(row.copies,[{scale:.5,alpha:1},{scale:1,alpha:1},{scale:2,alpha:1}],
          'Honest must preserve every scaled Spiral copy at mid-transition');
      }else{
        assert.equal(row.staged,true,'Beautiful must retain its staged transition');
        assert(row.copies[0].alpha<.02&&row.copies[1].alpha>.98&&row.copies[2].alpha<.02,
          'Beautiful must collect multiplied copies to the central figure at mid-transition');
      }
    }
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS 10.4.19.33: Honest multiplies Spiral copies; Beautiful gathers; both directions');
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
