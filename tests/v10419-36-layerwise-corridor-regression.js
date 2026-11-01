'use strict';
// Layerwise is an in-place per-copy geometry+angle morph, not Corridor population.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:30000});
 try{
  const out=await h.evaluate(`(async()=>{
   const originals={layers:state.layers,active:state.activeLayerId,tunnel:state.tunnel.active,
     morphActive:runtimeState.morph.active,morphMode:state.morph.mode,interval:state.morph.intervalSec,
     options:{...state.morph.options}};
   const rows=[],copies=[{scale:.5,copyId:-1,stepRatio:1.15},{scale:1,copyId:0,stepRatio:1.15},{scale:2,copyId:1,stepRatio:1.15}];
   const phase=(frame,at)=>{
     const c=__somataCorridorCopiesForLayer(spiralCorridorCopiesForLayer(copies,frame,at),frame,at);
     return{order:frame.spiralOrder,angleMix:frame.__spiralLayerwiseAngleMix,
       exponent:frame.__spiralLayerwiseScaleExponent,
       angle:getMotionTunnelLagRadians(c[2],frame)-getMotionTunnelLagRadians(c[1],frame),
       rawDelta:runtimeState.morph?.active?window.__spiroCurrentSpiralMorphCorridorDelta?.(frame):null,
       scales:c.map(x=>x.scale),alphas:c.map(x=>x.alpha??1)};
   };
   try{
    state.tunnel.active=true;runtimeState.morph.active=false;
    const ui=document.getElementById('paramSpiralZeroTransition');
    const hasOption=[...ui.options].some(x=>x.value==='layerwise'&&x.textContent.trim()==='Послойный');
    for(const dir of [1,-1])for(const orderTarget of [1,2,-1,-2]){
      const a=dir===1?0:orderTarget,b=dir===1?orderTarget:0;
      const id='layerwise-manual-'+a+'-'+b;
      const layer={...originals.layers[0],id,visible:true,N:12,K:2,spiralStep:2,spiralStepLinked:false,
        spiralEnabled:true,spiralOrder:a,spiralZeroTransitionMode:'layerwise',spiralLayerwiseRotationMode:'active',
        motionRotation:{enabled:false},testMorph:{enabled:true,duration:1}};
      state.layers=[layer];state.activeLayerId=id;SomataTestMorph.updateTask();layer.spiralOrder=b;
      const make=()=>({sourceLayer:layer,layer:{...layer},layerIndex:0});
      SomataTestMorph.applyFrame(make(),performance.now());
      const r=SomataTestMorph.status().transitions.find(x=>x.id===id);
      if(!r)throw Error('Missing manual timeline '+id);
      const samples=[];
      for(const t of [0,.25,.5,.75,1]){
        const at=r.start+r.duration*t;
        const f=make();SomataTestMorph.applyFrame(f,at);
        samples.push({t,...phase(f.layer,at)});
      }
      rows.push({kind:'manual',a,b,duration:r.duration,totalDuration:r.totalDuration,
        intro:__somataCorridorHonestZeroIntro(id),outro:__somataCorridorHonestZeroOutro(id),
        corridorBusy:__somataCorridorOrderChangeActive(id),samples});
    }
    // Round-trip through real selector binding and its live layer property.
    state.layers=[{...originals.layers[0],id:'layerwise-ui',spiralZeroTransitionMode:'beautiful'}];
    state.activeLayerId='layerwise-ui';
    ui.value='layerwise';ui.dispatchEvent(new Event('change',{bubbles:true}));
    const uiMode=state.layers[0].spiralZeroTransitionMode;
    // Blue Morph: both directions share their full cycle, not 80/20 staging.
    let savedAdd=null;
    try{
     for(const [a,b] of [[0,1],[1,0],[0,-1],[-1,0]]){
      const layer={...originals.layers[0],id:'layerwise-blue-'+a+'-'+b,visible:true,
        N:12,K:2,spiralStep:2,spiralStepLinked:false,spiralEnabled:true,spiralOrder:a,
        motionRotation:{enabled:false},spiralZeroTransitionMode:'layerwise',spiralLayerwiseRotationMode:'active'};
      state.layers=[layer];state.activeLayerId=layer.id;
      state.morph.mode='circleSlide';state.morph.intervalSec=5;
      state.morph.options.bySpiralOrder=true;state.morph.options.bySpiralLayers=true;
      let cb=null;const originalAdd=animationScheduler.add;savedAdd=originalAdd;
      animationScheduler.add=function(name,fn){if(name==='morph')cb=fn;return originalAdd.call(this,name,fn);};
      document.getElementById('btnMorph').click();
      await new Promise(r=>setTimeout(r,95));
      animationScheduler.add=originalAdd;savedAdd=null;animationScheduler.remove('morph');
      if(!cb||!runtimeState.morph.active)throw Error('Blue missing');
      const rt=runtimeState.morph;
      Object.assign(rt.sourceVisuals[0],{spiralEnabled:true,spiralOrder:a,N:12,K:2,spiralStep:2});
      Object.assign(rt.targetVisuals[0],{spiralEnabled:true,spiralOrder:b,N:12,K:2,spiralStep:2});
      rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
      rt.honestZeroCorridorOutro=null;rt.honestZeroCorridorIntro=null;
      const ms=getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000,start=performance.now();rt.cycleStart=start;
      const snapshots=[];
      for(const t of [.05,.25,.5,.75,.95]){
       const at=start+ms*t;cb(at);
       snapshots.push({t,geometryT:rt.geometryT,offsetStart:rt.cycleStart,
         intro:rt.honestZeroCorridorIntro!==null&&rt.honestZeroCorridorIntro!==undefined,
         outro:rt.honestZeroCorridorOutro!==null&&rt.honestZeroCorridorOutro!==undefined,
         ...phase(rt.frameLayers[0],at)});
      }
      rows.push({kind:'blue',a,b,ms,snapshots});
      animationScheduler.remove('morph');document.getElementById('btnMorph').click();
     }
    }finally{if(savedAdd)animationScheduler.add=savedAdd;
      if(runtimeState.morph.active){animationScheduler.remove('morph');document.getElementById('btnMorph').click();}}
    return{hasOption,uiMode,rows,
      noCorridorMix:SomataSpiralZeroTransition.layerwiseAngleMix('layerwise',0,1,.5,false),
      beautiful:SomataSpiralZeroTransition.plan('beautiful',1,0,.5,true),
      layered:SomataSpiralZeroTransition.plan('layerwise',1,0,.5,true)};
   }finally{
    state.layers=originals.layers;state.activeLayerId=originals.active;
    state.tunnel.active=originals.tunnel;runtimeState.morph.active=originals.morphActive;
    state.morph.mode=originals.morphMode;state.morph.intervalSec=originals.interval;
    state.morph.options=originals.options;SomataTestMorph.updateTask();
   }
  })()`,{timeoutMs:30000,label:'Layerwise both directions UI/manual/Blue'});
  const near=(a,b,eps=2e-3)=>Math.abs(a-b)<eps;
  assert.equal(out.hasOption,true);
  assert.equal(out.uiMode,'layerwise');
  assert.equal(out.noCorridorMix,null);
  assert.equal(out.beautiful.choreographed,true);
  assert.equal(out.layered.choreographed,false);
  assert.equal(out.layered.population,1);
  assert.equal(out.rows.length,12);
  for(const r of out.rows){
    const samples=r.kind==='blue'?r.snapshots:r.samples;
    if(r.kind==='manual'){
      assert(near(r.duration,1000)&&near(r.totalDuration,1000),'Layerwise must use full Duration');
      assert.equal(r.intro,null);assert.equal(r.outro,null);assert.equal(r.corridorBusy,false);
    }
    for(const x of samples){
      const e=x.t*x.t*(3-2*x.t),angle=(r.a===0?e:1-e);
      assert(near(x.angleMix,angle,.008),`Layerwise mix not simultaneous ${JSON.stringify(r)} ${JSON.stringify(x)}`);
      const expectedOrder=r.a+(r.b-r.a)*e;
      assert(near(x.order,expectedOrder,.015),'Layerwise keypoints and angular progress disagree');
      const exp=(Math.abs(r.a)||1)+((Math.abs(r.b)||1)-(Math.abs(r.a)||1))*e;
      assert(near(x.exponent,exp,.015),'Layerwise scale exponent wrong');
      for(let i=0;i<3;i++){
        assert(near(x.scales[i],Math.pow([.5,1,2][i],exp),.04),'Layerwise should not collapse copies');
        assert(near(x.alphas[i],1,.001),'Layerwise should not fade Corridor copies');
      }
      if(r.kind==='blue'){
        assert.equal(x.intro,false,'Layerwise must not schedule Honest prelude');
        assert.equal(x.outro,false,'Layerwise must not schedule Honest postlude');
        assert(near(x.geometryT,x.t,.015),'Layerwise Blue must use full-cycle geometry');
      }
      // With K=2/N=12, one copy's final phase is 60 degrees.
      assert(near(x.angle,(r.kind==='blue'?x.rawDelta:(Math.PI/3)*((r.a||r.b)<0?-1:1))*angle,.055),`Copy angle must turn alongside keypoints ${JSON.stringify(x)}`);
    }
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS Layerwise Corridor both directions: UI, full-duration in-place copy scales, synchronized angles/keypoints, Blue Morph');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
