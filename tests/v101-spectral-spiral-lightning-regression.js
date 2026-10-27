'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:16000});
 try{
  const result=await h.evaluate(`(()=>{
    const input=document.getElementById('sweepLightningRateMultiplier');
    const duration=document.getElementById('sweepLightningDurationMultiplier');
    const lo=document.getElementById('morphStrokeWidthMin');
    const hi=document.getElementById('morphStrokeWidthMax');
    const defaultWidths={min:state.morph.strokeWidthMin,max:state.morph.strokeWidthMax,htmlMin:lo.defaultValue,htmlMax:hi.defaultValue};
    const numerical=input?.type==='number'&&duration?.type==='number'&&!input.hasAttribute('min')&&!duration.hasAttribute('min');
    ensureLayerEffectState(state.layers[0]);state.activeLayerId=state.layers[0].id;
    const cfg=getLayerSweepConfig(state.layers[0]);
    input.value='0.000001';input.dispatchEvent(new Event('change',{bubbles:true}));
    const raw=cfg.lightningRateMultiplier;const factor=getLightningRateFactor(cfg,0);
    cfg.lightningRateMultiplier=0.000001;syncSweepUI();
    const roundTrip=input.value;
    duration.value='0.0000001';duration.dispatchEvent(new Event('change',{bubbles:true}));
    const dur=cfg.lightningDurationMultiplier;
    const a={x:10,y:5},b={x:20,y:15};
    const points=[a,b],seg={type:'L',p0:a,p1:b,_start:0,_length:14.1421356237,breakBefore:true};
    const paths=[{points,closed:false,_exactLightningRail:{total:seg._length,segments:[seg]}}];
    const settings={flashMode:'spectral',spectralSectorDegrees:50,spectralAngularSpeed:90,direction:'forward'};
    const s0=buildBezierGlintPrepared(null,paths,settings,0.1,100,0);
    const s1=buildBezierGlintPrepared(null,paths,{...settings,spectralSectorDegrees:60},0.5,500,0);
    const spectralStatic=s0.spectral===true&&s0.cubicData===s1.cubicData&&s0.spectralResident===true&&s1.spectralProgress===0.5&&s1.sectorDegrees===60;
    paths._frameGeometryId=999;
    const s2=buildBezierGlintPrepared(null,paths,settings,0.75,750,0);
    const dynamicNotCached=s2.spectralResident===false&&s2.cubicData!==s1.cubicData;
    return {numerical,defaultWidths,raw,factor,roundTrip,dur,spectralStatic,dynamicNotCached};
  })()`,{timeoutMs:12000});
  assert(result.numerical,'previous numeric multiplier fields must replace binary dropdowns');
  assert.deepEqual(result.defaultWidths,{min:0.5,max:2,htmlMin:'0.5',htmlMax:'2'});
  assert.equal(result.raw,0.000001);
  assert(Math.abs(result.factor-1e6)<0.01,'small multiplier must speed strikes');
  assert.equal(result.roundTrip,'0.000001');
  assert.equal(result.dur,1e-7);
  assert(result.spectralStatic,'spectral static geometry must reuse identical Bézier data and update angular uniforms');
  assert(result.dynamicNotCached,'animated spectral geometry must not reuse stale buffers');
  assert.equal(uncaughtExceptions(h.events).length,0,JSON.stringify(uncaughtExceptions(h.events)));
  console.log('PASS Somata 10.1 lightning numeric range, morph defaults, static/dynamic spectral cache',result);
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
