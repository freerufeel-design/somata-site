'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:240,evalTimeoutMs:13000});
 try{
  const result=await h.evaluate(`(async()=>{
   const l=state.layers.find(x=>x.id===state.activeLayerId);
   if(state.tunnel.active)setTunnelMode(false,{silent:true});
   l.spiralEnabled=true;l.spiralOrder=2;l.spiralClosed=false;l.testMorph={...SomataTestMorph.config(l),enabled:true,duration:.6};
   invalidateLayerGeometry(l,'v102-start');SomataTestMorph.updateTask();
   document.getElementById('btnTunnel').click();
   const entered=__somataCorridorEntranceStatus();
   const snap={layer:SomataRenderLayerSnapshot.create(l)};
   __somataApplyCorridorEntranceLayer(snap,performance.now()+200);
   const preserved=snap.layer.spiralOrder;
   await new Promise(r=>setTimeout(r,650));
   // Deliberate nonzero -> zero order; this is the only fold/population trigger.
   l.spiralOrder=0;invalidateLayerGeometry(l,'v102-zero');renderMainCanvas();
   const toZero=__somataCorridorOrderChangeStatus();
   const oldToZero=__somataCorridorOrderChangeActive(l.id);
   const sample1={layer:SomataRenderLayerSnapshot.create(l)};
   __somataApplyCorridorEntranceLayer(sample1,performance.now());
   await new Promise(r=>setTimeout(r,650));
   // Reverse: polygon with active Corridor -> nonzero Spiral.
   l.spiralOrder=3;invalidateLayerGeometry(l,'v102-nonzero');renderMainCanvas();
   const toSpiral=__somataCorridorOrderChangeStatus();
   const reverseActive=__somataCorridorOrderChangeActive(l.id);
   await new Promise(r=>setTimeout(r,650));
   // From one spiral to another spiral through zero must not create a Corridor population.
   l.spiralOrder=-3;invalidateLayerGeometry(l,'v102-neg');renderMainCanvas();
   const directActive=__somataCorridorOrderChangeActive(l.id);
   await new Promise(r=>setTimeout(r,650));
   // A real polygon contour (spiralEnabled=false) -> Spiral is also staged.
   l.spiralEnabled=false;l.spiralOrder=0;invalidateLayerGeometry(l,'v102-polygon');
   SomataTestMorph.updateTask();renderMainCanvas();
   await new Promise(r=>setTimeout(r,650));
   l.spiralEnabled=true;l.spiralOrder=2;invalidateLayerGeometry(l,'v102-polygon-to-spiral');renderMainCanvas();
   const polygonToSpiral=__somataCorridorOrderChangeActive(l.id);
   setTunnelMode(false,{silent:true});
   // Mono radius: numeric outer visible rail must remain on base radius.
   const cases=[];
   for(const n of [3,4,5,9])for(const round of [30,70,135,200]){
      l.spiralEnabled=false;l.N=n;l.K=1;l.radius=220;l.radiusMultiplier=1;
      l.profileMode='spline';l.rounding=round;l.roundingMode='monoradius';
      invalidateLayerGeometry(l,'v102-mono');
      const data=getCachedLayerDrawData(l),drawn=buildLampRenderedAttachmentPathsUncached(data.paths,l,null,getRoundingStrength(round));
      const radius=Math.max(...drawn.flatMap(p=>p.points.map(pt=>Math.hypot(pt.x,pt.y))));
      cases.push({n,round,radius,scale:data.monoradiusScale,rawMax:Math.max(...data.paths.flatMap(p=>p.points.map(pt=>Math.hypot(pt.x,pt.y)))),effective:getEffectiveLayerRadius(l),key:data.geometryKey?.slice(0,40)});
   }
   return{entered,preserved,toZero,oldToZero,toSpiral,reverseActive,directActive,polygonToSpiral,cases};
  })()`,{timeoutMs:12000});
  console.log(JSON.stringify(result,null,2));
  assert.equal(result.entered.direction,'in');
  assert.equal(result.entered.hasFold,false,'Corridor ON must not collapse Spiral to order 0');
  assert.equal(result.preserved,2,'Corridor ON must preserve nonzero Spiral');
  assert(result.oldToZero,'explicit order 0 must initiate collapse + repopulation');
  assert(result.reverseActive,'explicit 0 -> nonzero must initiate inverse choreography');
  assert.equal(result.directActive,false,'nonzero -> nonzero must not repopulate at intermediary 0');
  assert(result.polygonToSpiral,'polygon contour -> nonzero Spiral must run collapse/unfold/repopulate');
  for(const row of result.cases)assert(Math.abs(row.radius-220)<7,`monoradius effective radius differs: ${JSON.stringify(row)}`);
  assert.equal(uncaughtExceptions(h.events).length,0,'browser JS exceptions');
  console.log('SOMATA 10.2 CORRIDOR / MONORADIUS: PASS');
 }finally{await h.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
