'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const root=path.resolve(__dirname,'..');
(async()=>{
  const gpu=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');
  const arc=fs.readFileSync(path.join(root,'js/gpu/lightning-arc-renderer.js'),'utf8');
  assert(gpu.includes('@fragment fn fsCombined'),'single-contour GPU shader must exist');
  assert(gpu.includes("if(cfg?.effectType==='lightning')stage('combined')"),'GPU Layer Scene must only raster once per flash frame');
  assert(gpu.includes("if(cfg?.effectType==='lightning')drawStage('combined')"),'GPU direct renderer must raster once per flash frame');
  assert(arc.includes('drawAnalyticGroup(combinedStyles,true)'),'GPU Arc renderer must use a single core/halo stroke');
  const sweep=fs.readFileSync(path.join(root,'js/render/sweep-pass.js'),'utf8');
  assert(sweep.includes("const useCurrentProfile=cfg.effectType!=='lightning'"),'complex Graffiti profiles must use the lightweight existing contour for Lightning');
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:75,evalTimeoutMs:30000});
  try{
    const data=await h.evaluate(`(()=>{
      const id='ambientCloudsDensity',speedId='ambientCloudsSpeed';
      const density=document.getElementById(id),speed=document.getElementById(speedId);
      if(!density||!speed)throw Error('missing cloud sliders');
      for(const [node,value] of [[density,'80'],[speed,'90']]){node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));}
      for(const [node,value] of [[document.getElementById('ambientCloudsDensityMultiplier'),'10'],[document.getElementById('ambientCloudsSpeedMultiplier'),'25']]){node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));}
      const cloud={...state.ambient.clouds};
      const before=SomataParameterRegistry.all().filter(x=>x.id.startsWith('ambient.clouds')).map(x=>({id:x.id,max:x.max}));
      const morph=SomataParameterRegistry.morphable().filter(x=>x.id.startsWith('ambient.clouds')).map(x=>x.id);
      const params=SomataParameterRegistry.all();
      const tintA=lightningOnePassColor('#ff0000','#0000ff'),tintB=lightningOnePassColor('#ff0000','#00ff00');
      const a=[];collectLightningMicroPulses(.26,3,a);
      const b=[];collectLightningMicroPulses(.26,100000,b);
      const prepared={pieces:[[{x:0,y:0},{x:5,y:3},{x:12,y:0}]],strikePath:{cached:true}};
      const layer=state.layers[0],cfg={...getLayerSweepConfig(layer),enabled:true,effectType:'lightning',lightningTriggerMode:'timer',lightningMicroStrikes:3,lightningDurationMs:480,lightningRatePercent:100};
      const samples=[0,.004,.008,.012,.016,.024].map(x=>{const f=prepareLightningVectorFrame(layer,x,prepared,0,cfg);return{phase:x,alpha:f.intensity,pulses:f.microPulses.length,pathSame:f.strikePath===prepared.strikePath,primary:f.primary};});
      const cfg0={...cfg,lightningMicroStrikes:0};
      const without=prepareLightningVectorFrame(layer,.15,prepared,0,cfg0);
      const c=state.ambient.clouds;c.color='#ff0000';c.hue=120;c.hueMultiplier=1;
      SomataAmbientPrism.syncUI();const legacy={color:c.color,hue:c.hue,mult:c.hueMultiplier};
      c.enabled=true;c.density=100;c.opacity=25;c.speed=0;SomataAmbientPrism.render(300000);
      const canvas=document.getElementById('ambientOverlayCanvas'),ctx=canvas.getContext('2d'),signature=()=>{const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let sum=0;for(let i=3;i<data.length;i+=137*4)sum+=data[i];return sum;};
      const one=signature();c.density=500;SomataAmbientPrism.render(300000);const many=signature();
      return {html:{dType:density.type,dMax:density.getAttribute('max'),sType:speed.type,sMax:speed.getAttribute('max'),valueDensity:cloud.density,valueSpeed:cloud.speed,dMult:cloud.densityMultiplier,sMult:cloud.speedMultiplier},catalog:before,morph,pulse3:a,pulseHuge:b,tints:{tintA,tintB},samples,without:without.intensity,legacy,clouds:{one,many}};
    })()`,{timeoutMs:30000});
    assert.deepEqual(data.html,{dType:'range',dMax:'100',sType:'range',sMax:'100',valueDensity:80,valueSpeed:90,dMult:10,sMult:25});
    assert(!data.catalog.some(x=>x.id.includes('.hue')),'cloud hue must not exist in the shared catalog');
    assert(data.catalog.some(x=>x.id==='ambient.clouds.density'),'cloud density must remain routed');
    assert(data.catalog.some(x=>x.id==='ambient.clouds.speed'),'cloud speed must remain routed');
    assert(data.morph.includes('ambient.clouds.density')&&data.morph.includes('ambient.clouds.speed'),'Blue/Orange must retain cloud numeric controls');
    assert.notEqual(data.tints.tintA,data.tints.tintB,'secondary lightning color must remain meaningful');
    assert(data.pulse3.length<=1&&data.pulseHuge.length<=1,'micro-strikes only animate one opacity envelope');
    assert(data.samples.every(x=>x.pulses<=1&&x.pathSame),'all flashes reuse exact same strike contour');
    assert(new Set(data.samples.map(x=>x.alpha.toFixed(3))).size>2,'opacity must blink instead of remaining saturated');
    assert(data.legacy.color!=='#ff0000'&&data.legacy.hue===undefined&&data.legacy.mult===undefined,'legacy hue must fold once into the color swatch');
    assert(data.clouds.many>data.clouds.one,`density above 100 must still increase cloud strength: ${JSON.stringify(data.clouds)}`);
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS lightning single GPU contour + cloud unlimited slider multipliers',JSON.stringify(data));
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
