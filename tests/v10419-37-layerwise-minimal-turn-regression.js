'use strict';
// Every Corridor copy must choose an independent shortest arc; first and last
// visible frames must agree with the canonical static renderer modulo 2*PI.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:30000});
 try{
  const result=await h.evaluate(`(async()=>{
    const original={layers:state.layers,id:state.activeLayerId,tunnel:state.tunnel.active,
      morphActive:runtimeState.morph.active,morphMode:state.morph.mode,interval:state.morph.intervalSec,
      options:{...state.morph.options}};
    const rotations=[-43,-23,-14,-5,-1,0,1,5,14,23,43],pairs=[[0,1],[1,0],[0,-1],[-1,0],[0,2],[2,0]];
    const rows=[];let ui={};
    try{
      state.tunnel.active=true;runtimeState.morph.active=false;
      const mode=document.getElementById('paramSpiralZeroTransition');
      const rotation=document.querySelector('[data-spiral-layerwise-rotation="minimal"]');
      const activeButton=document.querySelector('[data-spiral-layerwise-rotation="active"]');
      const row=document.getElementById('spiralLayerwiseRotationRow');
      const starter={...original.layers[0],id:'minimal-turn-ui',spiralEnabled:true,spiralOrder:0,
        spiralZeroTransitionMode:'beautiful',motionRotation:{enabled:false}};
      state.layers=[starter];state.activeLayerId=starter.id;
      syncSidebarInputs();
      const hiddenBefore=row.classList.contains('hidden');
      mode.value='layerwise';mode.dispatchEvent(new Event('change',{bubbles:true}));
      const visibleAfter=!row.classList.contains('hidden');
      const defaultMode=rotation.classList.contains('active')?'minimal':'active';
      activeButton.click();
      const activeStored=starter.spiralLayerwiseRotationMode;
      rotation.click();
      ui={hiddenBefore,visibleAfter,defaultMode,activeStored,minimalStored:starter.spiralLayerwiseRotationMode};
      // Manual geometry edits: two directions, +/- winding, large +/- copy ids.
      for(const [a,b] of pairs){
        const id='minimum-manual-'+a+'-'+b;
        const layer={...original.layers[0],id,visible:true,N:12,K:5,spiralStep:5,spiralStepLinked:false,
          spiralEnabled:true,spiralOrder:a,spiralZeroTransitionMode:'layerwise',
          spiralLayerwiseRotationMode:'minimal',motionRotation:{enabled:false},
          testMorph:{enabled:true,duration:1}};
        state.layers=[layer];state.activeLayerId=id;SomataTestMorph.updateTask();
        layer.spiralOrder=b;
        const make=()=>({sourceLayer:layer,layer:{...layer},layerIndex:0});
        SomataTestMorph.applyFrame(make(),performance.now());
        const task=SomataTestMorph.status().transitions.find(x=>x.id===id);
        if(!task)throw Error('missing edit task '+id);
        const sample=[];
        for(const t of [0,.001,.25,.5,.75,.999,1]){
          const at=task.start+task.duration*t;
          const frame=make();SomataTestMorph.applyFrame(frame,at);
          const g=frame.layer;
          sample.push({t,order:g.spiralOrder,mix:g.__spiralLayerwiseAngleMix,
            mode:g.__spiralLayerwiseRotationMode,ref:g.__spiralLayerwiseReferenceDelta,
            angles:rotations.map(i=>getMotionTunnelLagRadians({copyId:i},g))});
        }
        // Static frames after ending interpolation are computed through the same
        // public draw-time motion resolver, not a guessed target formula.
        const staticStart={...layer,spiralOrder:a},staticEnd={...layer,spiralOrder:b};
        rows.push({kind:'manual',a,b,rotations,sample,
          staticStart:rotations.map(i=>getMotionTunnelLagRadians({copyId:i},staticStart)),
          staticEnd:rotations.map(i=>getMotionTunnelLagRadians({copyId:i},staticEnd))});
      }
      for(const [a,b] of [[0,1],[1,0],[0,-1],[-1,0]]){
        const layer={...original.layers[0],id:'minimum-blue-'+a+'-'+b,visible:true,
          N:12,K:5,spiralStep:5,spiralStepLinked:false,spiralEnabled:true,spiralOrder:a,
          spiralZeroTransitionMode:'layerwise',spiralLayerwiseRotationMode:'minimal',motionRotation:{enabled:false}};
        state.layers=[layer];state.activeLayerId=layer.id;
        state.morph.mode='circleSlide';state.morph.intervalSec=5;
        state.morph.options.bySpiralOrder=true;state.morph.options.bySpiralLayers=true;
        let cb=null;const origAdd=animationScheduler.add;
        try{
          animationScheduler.add=function(name,fn){if(name==='morph')cb=fn;return origAdd.call(this,name,fn);};
          document.getElementById('btnMorph').click();
          await new Promise(resolve=>setTimeout(resolve,95));
        }finally{animationScheduler.add=origAdd;}
        if(!cb||!runtimeState.morph.active)throw Error('Blue failed to start');
        animationScheduler.remove('morph');
        const rt=runtimeState.morph;
        Object.assign(rt.sourceVisuals[0],{spiralEnabled:true,spiralOrder:a,N:12,K:5,spiralStep:5,spiralStepLinked:false});
        Object.assign(rt.targetVisuals[0],{spiralEnabled:true,spiralOrder:b,N:12,K:5,spiralStep:5,spiralStepLinked:false});
        rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
        const ms=getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000,start=performance.now();rt.cycleStart=start;
        const sample=[];
        for(const t of [.05,.25,.5,.75,.95]){
          cb(start+ms*t);
          const frame=rt.frameLayers[0];
          sample.push({t,order:frame.spiralOrder,mix:frame.__spiralLayerwiseAngleMix,
            mode:frame.__spiralLayerwiseRotationMode,ref:frame.__spiralLayerwiseReferenceDelta,
            angles:rotations.map(i=>getMotionTunnelLagRadians({copyId:i},frame))});
        }
        rows.push({kind:'blue',a,b,rotations,sample});
        animationScheduler.remove('morph');document.getElementById('btnMorph').click();
      }
      return{ui,rows,defaults:createLayer('default-test').spiralLayerwiseRotationMode,
        shortestExample:SomataSpiralZeroTransition.shortestEquivalentAngle(31*Math.PI/3)};
    }finally{
      if(runtimeState.morph.active){animationScheduler.remove('morph');document.getElementById('btnMorph').click();}
      state.layers=original.layers;state.activeLayerId=original.id;
      state.tunnel.active=original.tunnel;runtimeState.morph.active=original.morphActive;
      state.morph.mode=original.morphMode;state.morph.intervalSec=original.interval;
      state.morph.options=original.options;SomataTestMorph.updateTask();
    }
  })()`,{timeoutMs:30000,label:'Shortest arc and static parity'});
  assert.equal(result.defaults,'minimal');
  assert.deepEqual(result.ui,{hiddenBefore:true,visibleAfter:true,defaultMode:'minimal',activeStored:'active',minimalStored:'minimal'});
  const twoPi=2*Math.PI;
  const equivalent=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))<1e-8;
  for(const r of result.rows){
    for(const s of r.sample){
      const u=s.t*s.t*(3-2*s.t),mix=r.a===0?u:1-u;
      assert.equal(s.mode,'minimal');
      assert(Math.abs(s.mix-mix)<.01,`${r.kind} ${r.a}->${r.b} mix at ${s.t}`);
      assert(Number.isFinite(s.ref));
      s.angles.forEach((angle,j)=>{
        const raw=r.rotations[j]*s.ref;
        let shortest=Math.atan2(Math.sin(raw),Math.cos(raw));
        if(Math.abs(Math.abs(shortest)-Math.PI)<1e-9)shortest=raw<0?-Math.PI:Math.PI;
        const expected=shortest*mix;
        assert(Math.abs(angle-expected)<.045,`${r.kind} ${r.a}->${r.b} copy ${r.rotations[j]} at ${s.t}: ${angle} vs ${expected}`);
        assert(Math.abs(angle)<=Math.PI+.00001,`Excessive spin in ${r.kind}: ${angle}`);
      });
    }
    if(r.kind==='manual'){
      r.rotations.forEach((id,j)=>{
        assert(equivalent(r.sample[0].angles[j],r.staticStart[j]),`Start snap copy ${id} ${r.a}->${r.b}`);
        assert(equivalent(r.sample.at(-1).angles[j],r.staticEnd[j]),`End snap copy ${id} ${r.a}->${r.b}`);
        assert(Math.abs(Math.atan2(Math.sin(r.sample[1].angles[j]-r.staticStart[j]),Math.cos(r.sample[1].angles[j]-r.staticStart[j])))<.002,
          `First frame discontinuity copy ${id}`);
        assert(Math.abs(Math.atan2(Math.sin(r.sample.at(-2).angles[j]-r.staticEnd[j]),Math.cos(r.sample.at(-2).angles[j]-r.staticEnd[j])))<.002,
          `Last frame discontinuity copy ${id}`);
      });
    }
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS layerwise shortest arcs: default + UI, manual/Blue, +/- orders, 11 Corridor copies, boundary static parity');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
