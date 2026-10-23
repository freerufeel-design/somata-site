'use strict';
// Ensure real production GPU Lightning adapter is invoked and that UI changes
// reach a nonempty, non-idle render plan. No hardware pixel claims.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
 const m=source.match(/function encodeToLayerScene\(targetTexture,clipGeometry=null,clipMode='symmetric',frameId=null,cfg=null\)\{if\(active!=='webgpu'\)[^\n]+\}/g);
 assert.ok(m&&m.length===1,'Locate GPU Lightning adapter in shipped source');
 const actual=vm.runInNewContext(`(()=>{const active='webgpu',WebGPUSweepRenderer={encodeToLayerScene:(...args)=>({handled:true,count:args.length,frameId:args[3]})};${m[0]};return encodeToLayerScene({},null,'symmetric',907,{effectType:'lightning'});})()`);
 assert.equal(actual.handled,true);assert.equal(actual.count,5);assert.equal(actual.frameId,907);
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:18000});
 try{
  const data=await h.evaluate(`(()=>{
   const l=state.layers[0],check=document.getElementById('showLightning'),sel=document.getElementById('sweepLightningTriggerMode');
   state.activeLayerId=l.id;syncSweepUI();check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));
   sel.value='timer';sel.dispatchEvent(new Event('change',{bubbles:true}));
   const c=getLayerSweepConfig(l);c.syncMusic=false;c.speed=1;c.speedMultiplier=4;state.lightningRateSync=false;resetLightningClock(0,c,0);
   beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;
   const fc=prepareMainLayerFrame(f,0),e=fc?.effectsPlan?.sweep,i=e?.instances?.find(x=>x.cfg?.effectType==='lightning');
   return{enabled:c.lightningEnabled,mode:c.lightningTriggerMode,plan:e?.enabled,stage:i?.frameData?.lightningVector?.stage,pieces:i?.frameData?.prepared?.pieces?.length||0};
  })()`);
  assert.equal(data.enabled,true);assert.equal(data.mode,'timer');assert.equal(data.plan,true);assert.equal(data.stage,'strike');assert.ok(data.pieces>0);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v907 GPU Lightning adapter and UI -> strike geometry',JSON.stringify(data));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v907',e.stack||e);process.exitCode=1});
