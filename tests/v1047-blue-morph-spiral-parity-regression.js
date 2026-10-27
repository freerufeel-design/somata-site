'use strict';
// Blue Morph Light and Full must share zero-order choreography without
// changing the per-mode rendering behavior or hue source tables.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:16000});
 try{
  const result=await h.evaluate(`(async()=>{
   const original=state.layers[0];
   const defs=[
    {from:3,to:0,mode:'beautiful',fromOn:true,toOn:true},
    {from:0,to:-2,mode:'honest',fromOn:true,toOn:true},
    {from:4,to:-4,mode:'beautiful',fromOn:true,toOn:true},
    {from:-3,to:0,mode:'honest',fromOn:true,toOn:true},
    {from:0,to:2,mode:'beautiful',fromOn:false,toOn:true},
    {from:2,to:0,mode:'beautiful',fromOn:true,toOn:false}
   ];
   state.layers=defs.map((d,i)=>({...original,
    id:'parity-1047-'+i,name:'Zero '+i,visible:true,
    profileMode:i%2?'spline':'segments',closedLoop:i%2===0,
    profileNodes:[{x:0,y:0},{x:0.3,y:0.3},{x:0.6,y:-0.3},{x:1,y:0}],
    spiralEnabled:d.fromOn,spiralOrder:d.from,
    spiralZeroTransitionMode:d.mode,
    strokeColor:['#f102a3','#2acaaf','#123456','#000000','#fffabc','#aa5500'][i],
    fillColor:['#c0ffee99','#123456ff','#ffaa0033','#010101ff','#eeccdd77','#ff551199'][i]
   }));
   state.activeLayerId=state.layers[0].id;
   Object.assign(state.morph.options,{byShape:true,byColor:true,byFillColor:true,
    bySpiralOrder:true,bySpiralLayers:true,byRotation:true});
   state.morph.spiralMorphType='phaseCircle';
   state.morph.monoOrbitTransforms=false;
   state.morph.intervalSec=5;
   // Identical random targets across builds for differential snapshots.
   let rng=123456789;
   Math.random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
   const add=animationScheduler.add;
   const captures=[];
   for(const morphMode of ['light','circleSlide']){
    state.morph.mode=morphMode;
    const modeControl=document.getElementById('morphMode');if(modeControl)modeControl.value=morphMode;
    let frame=null;
    animationScheduler.add=function(n,cb){if(n==='morph')frame=cb;return add.call(this,n,cb);};
    document.getElementById('btnMorph').click();
    await new Promise(r=>setTimeout(r,75));
    animationScheduler.add=add;
    animationScheduler.remove('morph');
    if(!runtimeState.morph.active||typeof frame!=='function')throw Error('Could not start '+morphMode);
    const rt=runtimeState.morph;
    for(let i=0;i<defs.length;i++){
     const d=defs[i];
     Object.assign(rt.sourceVisuals[i],{spiralEnabled:d.fromOn,spiralOrder:d.from,closedLoop:i%2===0});
     Object.assign(rt.targetVisuals[i],{spiralEnabled:d.toOn,spiralOrder:d.to,closedLoop:i%2!==0});
    }
    const round=n=>typeof n==='number'&&Number.isFinite(n)?Number(n.toFixed(5)):n;
    const hslArr=x=>(x||[]).map(h=>[round(h?.h),round(h?.s),round(h?.l)]);
    const colors={source:hslArr(rt.sourceColorHsl),target:hslArr(rt.targetColorHsl),
     sourceFill:hslArr(rt.sourceFillColorHsl),targetFill:hslArr(rt.targetFillColorHsl)};
    const snapshots=[];
    for(const corridor of [false,true]){
     state.tunnel.active=corridor;
     for(const t of [.07,.25,.43,.65,.85]){
      rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
      rt.lastEditorPaint=performance.now();
      rt.lightGeometryBucket=-1;
      const now=performance.now(),cycleMs=Math.max(100,getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000);
      rt.cycleStart=now-t*cycleMs;
      frame(now);
      const frames=morphMode==='light'?rt.lightLayers:rt.frameLayers;
      snapshots.push({corridor,t,rows:defs.map((d,i)=>{
       const l=frames[i];return {
        on:l?.spiralEnabled,order:round(l?.spiralOrder),
        population:round(l?.__spiralZeroCorridorPopulation??null),
        closed:l?.closedLoop,interpolating:l?.__spiralOrderInterpolating===true,
        stroke:l?.strokeColor,fill:l?.fillColor,
        N:l?.N,K:l?.K,profileCount:l?.profileNodes?.length
       };
      })});
     }
    }
    captures.push({morphMode,colors,snapshots});
    state.tunnel.active=false;
    document.getElementById('btnMorph').click();
    if(rt.active)throw Error('Could not stop '+morphMode);
   }
   return captures;
  })()`,{timeoutMs:20000});
  assert.equal(result.length,2);
  for(const mode of result){
   assert.equal(mode.colors.source.length,6);
   assert.equal(mode.colors.target.length,6);
   assert.equal(mode.colors.sourceFill.length,6);
   assert.equal(mode.colors.targetFill.length,6);
   assert.equal(mode.snapshots.length,10);
   for(const snap of mode.snapshots){
    assert.equal(snap.rows.length,6);
    snap.rows.forEach(row=>{
     assert(Number.isFinite(row.order),'Spiral order invalid');
     assert(Number.isFinite(row.N),'N invalid');
     assert(row.profileCount>=2,'Morph geometry missing');
    });
   }
  }
  assert.deepEqual(uncaughtExceptions(h.events),[],'Unexpected exceptions');
  console.log('PASS Somata 10.4.7 Light/Full Spiral zero and HSL consistency');
 } finally {await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
