'use strict';
// v9.0.6: exercise real header selection and the renderer's lightning clock.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:450,evalTimeoutMs:25000});
 try{
  const result=await h.evaluate(`(()=>{
    const layer=state.layers[0],cfg=getLayerSweepConfig(layer),sel=document.getElementById('sweepLightningTriggerMode');
    if(!sel)throw Error('Lightning trigger selector is not in the heading');
    const original={morphActive:runtimeState.morph.active,morphPaused:runtimeState.morph.paused,blueStart:runtimeState.morph.cycleStart,orangeActive:runtimeState.minimalMorph.active,glint:cfg.glintEnabled,lightning:cfg.lightningEnabled,enabled:cfg.enabled,mode:cfg.lightningTriggerMode,sync:cfg.syncMusic,speed:cfg.speed,mult:cfg.speedMultiplier,phase:cfg.phase,last:cfg.lastUpdate,cycles:cfg.cycleCount,morphSec:state.morph.intervalSec,morphMult:state.morph.intervalMultiplier,tapSync:state.tapTempo.syncFullMorph};
    try{
      // Pick through a native change event, not a direct configuration assignment.
      state.activeLayerId=layer.id;syncSweepUI();
      sel.value='timer';sel.dispatchEvent(new Event('change',{bubbles:true}));
      const uiTimer=cfg.lightningTriggerMode==='timer';
      cfg.glintEnabled=true;cfg.enabled=true;runtimeState.morph.active=true;
      const strictTimer=getLightningTriggerSource(cfg)==='timer';
      const timerA=getLightningMotionPhase(1000,cfg,0),timerB=getLightningMotionPhase(1500,cfg,0);
      const timerMoves=timerA!==timerB;
      sel.value='glint';sel.dispatchEvent(new Event('change',{bubbles:true}));
      const uiGlint=cfg.lightningTriggerMode==='glint';
      cfg.syncMusic=false;cfg.speed=.5;cfg.speedMultiplier=1;cfg.phase=0;cfg.cycleCount=0;cfg.lastUpdate=0;
      // A newly enabled Glint does not strike before a full rotation.
      const glintStart=getLightningMotionPhase(1000,cfg,0),glintBefore=getLightningMotionPhase(1900,cfg,0);
      const glintAfter=getLightningMotionPhase(3100,cfg,0);
      cfg.glintEnabled=false;cfg.enabled=true;
      const strictOff=getLightningTriggerSource(cfg)==='off'&&getLightningMotionPhase(3300,cfg,0)===1;
      sel.value='morph';sel.dispatchEvent(new Event('change',{bubbles:true}));
      cfg.glintEnabled=false;
      runtimeState.minimalMorph.active=false;runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.pausedByOrangeProject=false;runtimeState.morph.pausedByGreenProject=false;
      state.tapTempo.syncFullMorph=false;state.morph.intervalSec=2;state.morph.intervalMultiplier=1;runtimeState.morph.cycleStart=4000;
      const morphSource=getLightningTriggerSource(cfg)==='morph';
      const morphPhase=getLightningMotionPhase(4500,cfg,0);
      state.tapTempo.syncFullMorph=true;state.tapTempo.bpm=120;state.tapTempo.beatsPerMorph=8;
      const bpmCycle=getLightningEffectiveCycleRateHz(cfg,0);state.tapTempo.syncFullMorph=false;
      // Glint wins when both Glint and Morph are enabled.
      cfg.glintEnabled=true;cfg.phase=.4;cfg.lastUpdate=4600;cfg.cycleCount=2;
      const glintWins=getLightningTriggerSource(cfg)==='glint';
      cfg.glintEnabled=false;runtimeState.morph.active=false;
      const fallbackTimer=getLightningTriggerSource(cfg)==='timer';
      runtimeState.minimalMorph.active=true;
      const orangeSource=getLightningTriggerSource(cfg)==='orange';
      runtimeState.morph.active=true;runtimeState.morph.pausedByOrangeProject=true;runtimeState.minimalMorph.transitioning=true;
      const orangeOverridesPausedBlue=getLightningTriggerSource(cfg)==='orange';
      runtimeState.morph.pausedByOrangeProject=false;runtimeState.minimalMorph.transitioning=false;runtimeState.minimalMorph.active=false;
      // Persistent schema and backwards compatibility.
      const legacy={effectType:'lightning',lightningEnabled:true};normalizeSweepConfig(legacy);
      const defaultMorph=legacy.lightningTriggerMode==='morph';
      return{uiTimer,strictTimer,timerMoves,bpmCycle,uiGlint,glintStart,glintBefore,glintAfter,strictOff,morphSource,morphPhase,glintWins,fallbackTimer,orangeSource,orangeOverridesPausedBlue,defaultMorph,selection:sel.value};
    } finally {
      runtimeState.morph.active=original.morphActive;runtimeState.morph.paused=original.morphPaused;runtimeState.morph.cycleStart=original.blueStart;runtimeState.minimalMorph.active=original.orangeActive;
      Object.assign(cfg,{glintEnabled:original.glint,lightningEnabled:original.lightning,enabled:original.enabled,lightningTriggerMode:original.mode,syncMusic:original.sync,speed:original.speed,speedMultiplier:original.mult,phase:original.phase,lastUpdate:original.last,cycleCount:original.cycles});
      state.morph.intervalSec=original.morphSec;state.morph.intervalMultiplier=original.morphMult;state.tapTempo.syncFullMorph=original.tapSync;
    }
   })()`);
  console.log(result);
  for(const flag of ['uiTimer','strictTimer','timerMoves','uiGlint','strictOff','morphSource','glintWins','fallbackTimer','orangeSource','orangeOverridesPausedBlue','defaultMorph'])assert.equal(result[flag],true,flag);
  assert.ok(Math.abs(result.bpmCycle-.25)<1e-6,'Morph clock follows BPM and beats-per-cycle');
  assert.equal(result.glintStart,1,'No premature strike on Glint activation');
  assert.equal(result.glintBefore,1,'No strike before a full Glint revolution');
  assert.ok(result.glintAfter<1 && result.glintAfter>=0,'Full Glint revolution fires a bolt');
  assert.ok(result.morphPhase>.23&&result.morphPhase<.27,'Lightning follows current Morph cycle clock');
  assert.equal(result.selection,'morph','Morph is the selected default mode');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v906 lightning trigger routing');
 }finally{await h.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
