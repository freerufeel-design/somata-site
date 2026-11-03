"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const root=path.resolve(__dirname,'..');
(async()=>{
 const gpu=fs.readFileSync(path.join(root,'js/gpu/bezier-sweep-renderer.js'),'utf8');
 const cpu=fs.readFileSync(path.join(root,'js/render/profile-sweep-adapter.js'),'utf8');
 assert(!gpu.includes('tail=Math.max(0,head-span)'),'GPU must never truncate the angular sector at cycle start');
 assert(!cpu.includes('if(spectral&&head<=.000001)return []'),'CPU fallback must not vanish at phase 0');
 assert(gpu.includes('cubicCount*subdiv')&&gpu.includes('sectorClass'),'spectral GPU must use adaptive geometry and fast mask classification');
 assert(gpu.includes('spectralResidentHits')&&gpu.includes('spectralResidentUploads'),'resident GPU cubic cache must remain active');
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:60,evalTimeoutMs:30000});
 try{
 const out=await h.evaluate(`(()=>{
  const d=document.getElementById('ambientCloudsDensity'),dm=document.getElementById('ambientCloudsDensityMultiplier');
  const s=document.getElementById('ambientCloudsSpeed'),sm=document.getElementById('ambientCloudsSpeedMultiplier');
  const shape=[d.type,d.getAttribute('max'),dm.type,dm.getAttribute('max'),s.type,s.getAttribute('max'),sm.type,sm.getAttribute('max')];
  // Existing numeric-only projects keep their EXACT effective values.
  const c=state.ambient.clouds;c.density=500;c.densityMultiplier=1.5;c.speed=1750;c.speedMultiplier=2;
  SomataAmbientPrism.syncUI();
  const migrated={db:c.density,dm:c.densityMultiplier,sb:c.speed,sm:c.speedMultiplier,baseD:d.value,baseS:s.value,multD:dm.value,multS:sm.value};
  dm.value='1000';dm.dispatchEvent(new Event('input',{bubbles:true}));
  sm.value='10000';sm.dispatchEvent(new Event('input',{bubbles:true}));
  const unlimited=[c.densityMultiplier,c.speedMultiplier];
  const k=0.5522847498;
  const controls=new Float32Array([100,0,100,k*100,k*100,100,0,100, 0,100,-k*100,100,-100,k*100,-100,0, -100,0,-100,-k*100,-k*100,-100,0,-100, 0,-100,k*100,-100,100,-k*100,100,0]);
  const p={spectral:true,cubicData:controls,cubicCount:4,cubicBreaks:new Uint8Array([1,0,0,0]),centerX:0,centerY:0,spectralStartAngle:0,spectralDirection:1,sectorSpanAngle:Math.PI/4};
  const sig=t=>{const paths=sampleGraffitiSweepBezierPieces({...p,spectralProgress:t});let x=0,y=0,n=0;for(const path of paths)for(const q of path){x+=q.x;y+=q.y;n++;}return{x:n?x/n:0,y:n?y/n:0,n,paths:paths.length};};
  const cacheBefore=__somataSpectralGraffitiCacheStatus();
  const samples=[0,.001,.005,.995,.999,1].map(sig);
  const cacheAfter=__somataSpectralGraffitiCacheStatus();
  const quarters=[0,.125,.25,.5,.75].map(sig);
  const backward=[0,.001,.999,1].map(t=>sampleGraffitiSweepBezierPieces({...p,spectralDirection:-1,spectralProgress:t}).flat().length);
  const full=sampleGraffitiSweepBezierPieces({...p,spectralProgress:0,sectorSpanAngle:2*Math.PI}).flat().length;
  const layer=state.layers[0],cfg={...getLayerSweepConfig(layer),flashMode:'spectral',flashType:'high',spectralSectorDegrees:45,spectralAngularSpeed:90,direction:'forward'};
  const points=(shift=0)=>[{x:10+shift,y:0},{x:0,y:10},{x:-10,y:0}];
  const paths=shift=>{const pt=points(shift);return [{points:pt,_exactLightningRail:{total:30,segments:[{type:'L',p0:pt[0],p1:pt[1],breakBefore:true},{type:'L',p0:pt[1],p1:pt[2]}]}}];};
  const f={layer,layerIndex:0};
  const a=buildBezierGlintPrepared(f,paths(),cfg,.98,1000,0),b=buildBezierGlintPrepared(f,paths(),cfg,.01,1016,0),changed=buildBezierGlintPrepared(f,paths(1),cfg,.02,1032,0);
  return {shape,migrated,unlimited,samples,quarters,backward,full,profileCache:{before:cacheBefore,after:cacheAfter},cache:{reused:a.cubicData===b.cubicData,invalidated:changed.cubicData!==b.cubicData,phaseA:a.spectralProgress,phaseB:b.spectralProgress}};
 })()`,{timeoutMs:30000});
 assert.deepEqual(out.shape,['range','100','number',null,'range','100','number',null]);
 assert.deepEqual(out.migrated,{db:100,dm:7.5,sb:100,sm:35,baseD:'100',baseS:'100',multD:'7.5',multS:'35'});
 assert.deepEqual(out.unlimited,[1000,10000]);
 assert(out.samples.every(x=>x.n>0),'spectral mask must never disappear at cycle seam');
 assert.deepEqual(out.samples[0],out.samples[5],'phase 0 and phase 1 must render identically');
 const a=out.samples[4],b=out.samples[1];
 assert(Math.hypot(a.x-b.x,a.y-b.y)<20,'spectral sector must continue smoothly over cycle boundary');
 assert(out.backward.every(n=>n>0),'backward spectral sector must survive its wrap');
 assert(new Set(out.quarters.map(q=>Math.round(q.x)+':'+Math.round(q.y))).size>=4,'spectral sector must genuinely rotate across four quadrants');
 assert(out.full>out.samples[0].n,'360 degree sector must illuminate whole profile');
 assert(out.cache.reused&&out.cache.invalidated,'static spectral buffers must be reused and invalidated on geometry changes');
 assert(out.profileCache.after.hits>=out.profileCache.before.hits+5&&out.profileCache.after.builds===out.profileCache.before.builds+1,'spectral Graffiti samples must be cached across phase changes');
 assert.deepEqual(uncaughtExceptions(h.events),[]);
 console.log('PASS spectral seamless wrap + cache + unlimited cloud sliders',JSON.stringify(out));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
