const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const src=fs.readFileSync(path.join(__dirname,'../js/gpu/lightning-arc-renderer.js'),'utf8');
 const styles=src.slice(src.indexOf('function strokeStyles('),src.indexOf('function encode(',src.indexOf('function strokeStyles(')));
 assert.equal((styles.match(/out\.push\(/g)||[]).length,2,'Lightning should emit only halo and core, no outer duplicate');
 assert(!styles.includes("frame.stage==='after'"),'Lightning GPU retains tail draw loop');
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:22000});
 try{
  const v=await h.evaluate(`(()=>{
   const L=state.layers[0];ensureLayerEffectState(L);const c=getLayerSweepConfig(L);c.lightningTriggerMode='timer';c.lightningRateMultiplier=1;c.lightningRatePercent=100;c.lightningDurationMs=480;c.lightningDurationMultiplier=1;c.lightningMicroStrikes=2;c.lightningAfterglow=true;c.lightningAfterglowMs=600;
   normalizeSweepConfig(c);
   const f=lightningActiveCycleFraction(c,0),prep={gpuArcResident:true},a=prepareLightningVectorFrame(L,f/3,prep,0,c),b=prepareLightningVectorFrame(L,2*f/3,prep,0,c),tail=prepareLightningVectorFrame(L,Math.min(.999,f+.05),prep,0,c);
   return {stageA:a.stage,stageB:b.stage,microA:a.microIndex,microB:b.microIndex,tailStage:tail.stage,afterglowEnabled:c.lightningAfterglow,tailMs:c.lightningAfterglowMs,
   shape:"current",mode:c.lightningMode,random:c.lightningRandomPosition};
  })()`);
  assert.equal(v.stageA,'strike');assert.equal(v.stageB,'strike');assert.equal(v.microA,0);assert.equal(v.microB,1);
  assert.equal(v.tailStage,'idle');assert.equal(v.afterglowEnabled,false);assert.equal(v.tailMs,0);
  assert.equal(v.mode,'perPath');assert.equal(v.random,false);
  assert.equal(uncaughtExceptions(h.events).length,0,uncaughtExceptions(h.events).join(' | '));
  console.log('PASS strike-only Lightning, two GPU styles, microflashes without history',v);
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL strike-only Lightning',e);process.exitCode=1});
