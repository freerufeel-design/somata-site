'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:18000});
 try{
  const r=await h.evaluate(`(()=>{
    const cfg=ensureLayerLampState(state.layers[0]);
    const times=[0,.1,.25,.5,.75,.9,1], modes=['linear','ghost','smooth','dynamic'];
    const curves=modes.map(m=>[-100,-50,0,50,100].map(inertia=>{
      const c={...cfg,morphMotionMode:m,morphInertia:inertia,morphInertiaMultiplier:64};
      return withLampConfig(c,()=>times.map(t=>lampPhaseInertiaProgress(t)));
    }));
    const rail=[{points:[{x:0,y:0},{x:100,y:0},{x:100,y:100}],closed:false},
                {points:[{x:0,y:5},{x:100,y:5},{x:100,y:105}],closed:false}];
    const prior=runtimeState.morph.active; runtimeState.morph.active=true;
    const projector=(phase,inertia)=>withLampConfig({...cfg,morphMotionMode:'linear',morphInertia:inertia,snapToContour:true},()=>{
      const u=lampPhaseInertiaProgress(phase),p={x:1000,y:1000,pathIndex:1,lampId:'rail-owned-test',lampAttachFraction:u,vertexIndex:0};
      const got=projectLampPointsToCurrentPolygon([p],rail,state.layers[0],true,false,rail)[0];
      return {x:got.x,y:got.y,pathIndex:got.pathIndex,expected:lampPointAtFraction(rail[1],u)};
    });
    const projected=times.map(t=>[projector(t,0),projector(t,50),projector(t,-50)]);
    runtimeState.morph.active=prior;
    return {curves,projected,ui:!!document.getElementById('lampMorphInertiaMultiplier'),reg:!!SomataParameterRegistry.get('lamps.morphInertiaMultiplier'),
      control:{min:document.getElementById('lampMorphInertia')?.min,max:document.getElementById('lampMorphInertia')?.max,step:document.getElementById('lampMorphInertia')?.step}};
  })()`,{timeoutMs:18000});
  assert.equal(r.ui,false);assert.equal(r.reg,false);assert.deepEqual(r.control,{min:'-100',max:'100',step:'5'});
  for(const modes of r.curves)for(let j=0;j<5;j++){
   const vals=modes[j],inertia=[-100,-50,0,50,100][j];
   assert(vals.every((x,i)=>x>=0&&x<=1&&(i===0||x>=vals[i-1]-1e-12)));
   if(inertia===0)assert.deepEqual(vals,[0,.1,.25,.5,.75,.9,1]);
   if(inertia===-100)assert(vals.every(v=>v===1));
   if(inertia===100)assert.deepEqual(vals,[0,0,0,0,0,0,1]);
   if(inertia===-50)assert(vals[3]>.5);
   if(inertia===50)assert(vals[3]<.5);
  }
  for(const group of r.projected)for(const p of group){assert.equal(p.pathIndex,1);assert(Math.hypot(p.x-p.expected.x,p.y-p.expected.y)<1e-8,JSON.stringify(p));}
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS owned-rail linear inertia all 4 modes, no multiplier, exact path attachment');
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
