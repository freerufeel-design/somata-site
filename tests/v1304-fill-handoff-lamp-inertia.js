'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:25000});
 try{
  const r=await h.evaluate(`(()=>{
    const R=window.SomataParameterRegistry;
    const registry={inertia:R.get('lamps.morphInertia'),shared:R.sharedRoutingDefinitions().some(d=>d.id==='lamps.morphInertia')};
    const c=ensureLayerLampState(state.layers[0]);
    const controls={slider:document.getElementById('lampMorphInertia'),calm:document.getElementById('lampCalmMode')};
    const samples=[];
    for(const mode of ['linear','ghost','smooth','dynamic']){
      for(const inertia of [-100,-50,0,50,100]){
        const cfg={...c,morphMotionMode:mode,morphInertia:inertia};
        const values=withLampConfig(cfg,()=>[0,.25,.5,.75,1].map(t=>lampPhaseInertiaProgress(t)));
        samples.push({mode,inertia,values});
      }
    }
    const before={brightness:c.brightness,radius:c.radius,radiusMultiplier:c.radiusMultiplier};
    return {registry:{present:!!registry.inertia,shared:registry.shared,min:registry.inertia?.min,max:registry.inertia?.max,step:registry.inertia?.step,multPresent:!!R.get('lamps.morphInertiaMultiplier')},controls:{min:controls.slider?.min,max:controls.slider?.max,step:controls.slider?.step,default:controls.slider?.defaultValue,calm:!!controls.calm},defaults:{inertia:c.morphInertia},samples,before};
  })()`,{timeoutMs:20000});
  assert.deepEqual(r.registry,{present:true,shared:true,min:-100,max:100,step:5,multPresent:false});
  assert.deepEqual(r.controls,{min:'-100',max:'100',step:'5',default:'0',calm:false});
  assert.equal(r.defaults.inertia,0);
  for(const s of r.samples){
   const exp=s.inertia===0?1:1+4*(Math.abs(s.inertia)/100)/(1-Math.abs(s.inertia)/100||1);
   const expected=s.inertia===-100?[1,1,1,1,1]:s.inertia===100?[0,0,0,0,1]:[0,.25,.5,.75,1].map(t=>s.inertia===0?t:(s.inertia>0?Math.pow(t,exp):1-Math.pow(1-t,exp)));
   for(let i=0;i<5;i++)assert(Math.abs(s.values[i]-expected[i])<1e-12,`${s.mode}/${s.inertia}: ${JSON.stringify(s.values)} expected ${expected}`);
  }

  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS inertia 4 modes × 5 signed values × 5 phase samples; no multiplier; UI; shared morph parameter registry; no calm switch');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;});
