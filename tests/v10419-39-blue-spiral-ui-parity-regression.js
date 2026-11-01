'use strict';
// Fresh Spiral defaults and per-layer order memory; full Blue Morph must not
// throttle visibly changing Spiral keypoints to the profile-editor refresh rate.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:30000});
 try{
  const r=await h.evaluate(`(async()=>{
   const old={layers:state.layers,id:state.activeLayerId,morph:state.morph.mode,active:runtimeState.morph.active,
      speed:state.morph.speedType,options:{...state.morph.options},tunnel:state.tunnel.active};
   const row=[];
   try{
     if(runtimeState.morph.active)document.getElementById('btnMorph').click();
     const fresh=createLayer('spiral-memory-test');
     state.layers=[fresh];state.activeLayerId=fresh.id;state.tunnel.active=true;
     const defaults={zeroMode:fresh.spiralZeroTransitionMode,turn:fresh.spiralLayerwiseRotationMode,
        remembered:fresh.spiralRememberedOrder,order:fresh.spiralOrder};
     const click=name=>document.querySelector('[data-contour-family="'+name+'"]').click();
     syncSidebarInputs();click('spiral');row.push({stage:'first',order:fresh.spiralOrder,enabled:fresh.spiralEnabled});
     const input=document.getElementById('paramSpiralOrder');input.value='-3';input.dispatchEvent(new Event('change',{bubbles:true}));
     click('polygon');row.push({stage:'polygon',order:fresh.spiralOrder,memory:fresh.spiralRememberedOrder,enabled:fresh.spiralEnabled});
     click('spiral');row.push({stage:'return',order:fresh.spiralOrder,memory:fresh.spiralRememberedOrder,enabled:fresh.spiralEnabled});
     click('polygon');const persisted=JSON.parse(JSON.stringify(fresh));setContourMode(persisted,'spiral');
     row.push({stage:'saved',order:persisted.spiralOrder,memory:persisted.spiralRememberedOrder});
     const oldLayer=createLayer('legacy-memory');delete oldLayer.spiralRememberedOrder;
     setContourMode(oldLayer,'spiral');row.push({stage:'legacy',order:oldLayer.spiralOrder});

     // Start Blue using a simple segment profile. Ensure a changed target rail
     // refreshes on two successive frames despite the editor refresh lockout.
     fresh.spiralOrder=0;fresh.spiralEnabled=true;
     Object.assign(state.morph.options,{byShape:true,bySpiralOrder:true,bySpiralLayers:true,
       byVertices:false,bySteps:false,byRounding:false,byRotation:false});
     state.morph.mode='circleSlide';state.morph.speedType='linear';state.morph.intervalSec=5;
     let cb=null;const previousAdd=animationScheduler.add;
     try{animationScheduler.add=function(name,fn){if(name==='morph')cb=fn;return previousAdd.call(this,name,fn);};
       document.getElementById('btnMorph').click();await new Promise(done=>setTimeout(done,90));}
     finally{animationScheduler.add=previousAdd;}
     if(!runtimeState.morph.active||!cb)throw Error('Blue Morph not running');
     animationScheduler.remove('morph');
     const rt=runtimeState.morph;
     Object.assign(rt.sourceVisuals[0],{spiralEnabled:true,spiralOrder:0});
     Object.assign(rt.targetVisuals[0],{spiralEnabled:true,spiralOrder:1});
     const src=rt.sourceProfiles[0],dst=rt.targetProfiles[0];
     const base=(src.nodes||[]).map(p=>({x:p.x,y:p.y}));
     dst.nodes=base.map(p=>({x:p.x,y:p.y+.17}));
     dst.mode=src.mode;
     const ms=getTapMorphIntervalSec(state.morph.intervalSec,'full')*1000;
     const now=performance.now();rt.cycleStart=now;
     rt.lastEditorPaint=now+1000000;rt.gpuPhasePreparing=false;rt.gpuPhaseWarming=false;
     const snapshots=[];
     for(const t of [.2,.25,.3]){
       cb(now+ms*t);
       const frame=rt.frameLayers[0];
       snapshots.push({t,order:frame?.spiralOrder,mix:frame?.__spiralLayerwiseAngleMix,
         profileY:frame?.profileNodes?.[0]?.y,
         expectedY:base[0].y+.17*t});
     }
     animationScheduler.remove('morph');document.getElementById('btnMorph').click();
     return {defaults,row,snapshots,labelSize:getComputedStyle(document.querySelector('.spiral-zero-mode-setting > span')).fontSize};
   }finally{
     if(runtimeState.morph.active){animationScheduler.remove('morph');document.getElementById('btnMorph').click();}
     state.layers=old.layers;state.activeLayerId=old.id;state.morph.mode=old.morph;
     state.morph.speedType=old.speed;state.morph.options=old.options;state.tunnel.active=old.tunnel;
     SomataTestMorph.updateTask();
   }
  })()`,{timeoutMs:30000});
  assert.deepEqual(r.defaults,{zeroMode:'layerwise',turn:'minimal',remembered:1,order:0});
  assert.deepEqual(r.row,[{stage:'first',order:1,enabled:true},
   {stage:'polygon',order:0,memory:-3,enabled:false},
   {stage:'return',order:-3,memory:-3,enabled:true},
   {stage:'saved',order:-3,memory:-3},
   {stage:'legacy',order:1}]);
  assert.match(require('fs').readFileSync(require('path').join(__dirname,'../styles/app.css'),'utf8'), /spiral-zero-mode-setting > span \{ font-size:13px !important;/);
  assert.equal(r.snapshots.length,3);
  for(const s of r.snapshots){
   const e=s.t*s.t*(3-2*s.t);
   assert(Math.abs(s.order-e)<.008,'Blue order deviates from Geometry Animation at '+s.t);
   assert(Math.abs(s.mix-e)<.008,'Blue Corridor angle deviates from Geometry Animation at '+s.t);
   assert(Number.isFinite(s.profileY)&&s.profileY>0&&s.profileY<.17, 'Blue Spiral profile invalid at '+s.t+': '+JSON.stringify(s));
  }
  for(let i=1;i<r.snapshots.length;i++)assert(r.snapshots[i].profileY>r.snapshots[i-1].profileY+1e-5,
     'Blue Spiral keypoints were frozen by editor throttle: '+JSON.stringify(r.snapshots));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS fresh defaults, remembered Spiral order, Blue per-frame profile, synchronized layerwise motion');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
