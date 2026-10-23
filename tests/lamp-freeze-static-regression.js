const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const root=path.resolve(__dirname,'..');
  const lamp=fs.readFileSync(path.join(root,'js/gpu/lamp-renderer.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'js/app/ui-project-runtime.js'),'utf8');
  const pipeline=fs.readFileSync(path.join(root,'js/render/main-pipeline.js'),'utf8');
  const scheduler=fs.readFileSync(path.join(root,'js/core/scheduler.js'),'utf8');
  const profilePass=fs.readFileSync(path.join(root,'js/render/profile-pass.js'),'utf8');

  assert(lamp.includes('let src=vec2<f32>(xy)-vec2<f32>(fu.shiftX,fu.shiftY)'), 'Freeze Light feedback still samples from fragment half-pixel coordinates');
  assert(!lamp.includes('let src=vec2<f32>(p.xy)-vec2<f32>(fu.shiftX,fu.shiftY)'), 'legacy half-pixel Freeze Light sampling remains');
  assert(lamp.includes('rainLastFrameHash=0,rainLastDrawCount=-1'), 'Freeze Rain does not own an independent motion signature');
  assert(lamp.includes('function resetFreezeLight(){resetFreezeTrail();}'), 'ordinary Freeze Light reset still resets Rain');
  assert(lamp.includes('function resetFreezeAll(){resetFreezeTrail();resetFreezeRain();'), 'lifecycle reset for both trails is missing');
  assert(lamp.includes('!freezeSignatureChanged')&&lamp.includes('!rainSignatureChanged'), 'Freeze Light and Rain expiry still share one motion flag');
  assert(lamp.includes('function updateFreezeEffectiveTail(')&&lamp.includes('freezeTailIsSettling()'), 'Freeze Light tail changes are not slewed continuously');
  assert(lamp.includes('freezeUniformData[1]=effectiveFreezeTail'), 'Freeze Light shader does not receive the slewed effective tail');
  assert(lamp.includes('let h0=a0*range;let h1=a1*range;historical=hueRotate(historical,h1-h0);'), 'Freeze Light hue no longer represents a monotonic maximum shift toward the tail');
  assert(!lamp.includes('sin(a0*6.28318530718)')&&!lamp.includes('sin(a1*6.28318530718)'), 'legacy cyclic Freeze Light hue modulation remains');
  assert(lamp.includes('rainFrameHash=lampHashMix(rainFrameHash,lampHash)')&&lamp.includes('rainDrawCount+=lk;'), 'Corridor Rain still reuses corridor-copy motion signature');
  assert(lamp.includes("Somata FreezeLight Rain independent emitter snapshot")&&lamp.includes('resource:rainSourceView'), 'Freeze Rain has no independent emitter snapshot');
  assert(lamp.includes('encoder.copyTextureToTexture({texture:hdrTexture},{texture:rainSourceTexture}')&&lamp.includes('!rainSourceValid||rainSignatureChanged'), 'Freeze Rain emitter snapshot is not refreshed from its independent signature');
  assert(lamp.includes('Corridor copy scale/phase is excluded from Rain source refresh'), 'Freeze Rain Corridor-independence policy is missing');
  const tailHandler=(ui.match(/getElementById\('lampFreezeTailSec'\)[\s\S]*?getElementById\('lampFreezeHardness'\)/)||[])[0]||'';
  const hueHandler=(ui.match(/getElementById\('lampFreezeColorMode'\)[\s\S]*?getElementById\('lampFreezeChromatic'\)/)||[])[0]||'';
  assert(tailHandler&&!tailHandler.includes('resetFreezeTrail'), 'changing Freeze Light tail still despawns/reset its history');
  assert(hueHandler&&!hueHandler.includes('resetFreezeTrail'), 'changing Freeze Light colour mode still despawns/reset its history');
  assert(ui.includes("LampGPURenderer?.resetFreezeTrail?.()")&&ui.includes("LampGPURenderer?.resetFreezeRain?.()"), 'Freeze Light/Rain lifecycle controls are not independently reset');
  assert(pipeline.includes('const glowOwner=frameCtx.effectLayer||layer;'), 'Glow does not follow the live effect owner on every layer');
  assert(profilePass.includes('noteGraffitiContourGlowOutcome(frameCtx,false)')&&profilePass.includes('noteGraffitiContourGlowOutcome(frameCtx,true)'), 'Graffiti glow warm-up misses are not tracked in the owner pass');
  assert(scheduler.includes('externalRafGapCount++')&&scheduler.includes('return null;'), 'unattributed browser rAF gaps are still emitted as Morph freezes');
  console.log('PASS static Freeze Light/Rain independence, tail slew, monotonic tail hue, Corridor Rain isolation, Glow owner/retry and rAF-gap contracts');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350,evalTimeoutMs:10000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      for(const n of ['morph','morph-owner','minimalMorph','project-morph'])try{animationScheduler.remove(n)}catch(_){}
      runtimeState.morph.active=false;runtimeState.minimalMorph.active=false;runtimeState.projectMorph.active=false;
      const oldCamera=state.motion?.cameraEnabled===true;if(state.motion)state.motion.cameraEnabled=true;
      const cfgB={...state.lamps,adaptiveBrightness:true,adaptiveAdjustBrightness:true,adaptiveStrength:100,adaptiveStrengthMultiplier:1,adaptiveFadeSec:8};
      beginLampAdaptiveFrame();const fb=lampAdaptiveExposureFactors(cfgB,500,20,80,100,1);const sb=window.__spiroLampAdaptiveStatus(cfgB);
      const cfgR={...state.lamps,adaptiveBrightness:true,adaptiveAdjustBrightness:false,adaptiveStrength:100,adaptiveStrengthMultiplier:1,adaptiveFadeSec:8};
      beginLampAdaptiveFrame();const fr=lampAdaptiveExposureFactors(cfgR,500,20,80,100,1);const sr=window.__spiroLampAdaptiveStatus(cfgR);
      if(state.motion)state.motion.cameraEnabled=oldCamera;

      const base=createLayer('glow-base'),live=createLayer('glow-live');base.glowIntensity=0;live.glowIntensity=100;
      const fp={layer:base,effectLayer:live,frame:{dpr:1,motionPanX:0,motionPanY:0,motionRotationRad:0},minimalFadeEnabled:false,baseAlpha:1,glow:12,lineDisplayEnabled:true};
      const gp={};resolveLayerGlowEffectProvider(fp,gp);

      await new Promise(r=>setTimeout(r,1500));
      const before=animationScheduler.freezeStats();
      const emitted=animationScheduler.reportMorphFreeze('MORPH_RAF_GAP',{durationMs:777,force:true});
      const after=animationScheduler.freezeStats();
      return {fb,sb,fr,sr,glow:gp,emitted,before,after};
    })()`,{timeoutMs:5000,label:'lamp/freeze static regression'});

    assert(r.sb.instantStatic===true&&r.fb.brightnessFactor<0.999&&Math.abs(r.fb.radiusFactor-1)<1e-6,'adaptive brightness does not apply immediately in geometry-static mode');
    assert(r.sr.instantStatic===true&&r.fr.radiusFactor<0.999&&Math.abs(r.fr.brightnessFactor-1)<1e-6,'adaptive radius does not apply immediately in geometry-static mode');
    assert(r.glow.enabled===true&&r.glow.compositeAlpha>0.7,'Glow provider ignored the live effect layer');
    if(r.emitted===null){assert(r.after.count===r.before.count&&r.after.externalRafGapCount===r.before.externalRafGapCount+1,'unattributed rAF gap classification did not increment external gap diagnostics');}
    else{assert(/previous main render|previous task|GPU/i.test(String(r.emitted.cause||'')),'rAF gap was emitted without a measured Somata/GPU cause');}
    const exc=uncaughtExceptions(h.events);assert(exc.length===baseline,`uncaught browser exceptions: ${exc.slice(baseline).join(' | ')}`);
    console.log('PASS browser adaptive Static, live-layer Glow and external rAF-gap classification');
  } finally { await h.close(); }
}
main().catch(err=>{console.error('FAIL lamp/freeze static regression:',err.message);process.exit(1);});
