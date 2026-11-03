'use strict';
// Master must broadcast only the edited leaf, even from UI handlers that read
// an entire effect panel. Related fields on every layer must remain unchanged.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:40000});
 try{
  const result=await h.evaluate(`(async()=>{
   const layers=[createLayer('A'),createLayer('B'),createLayer('C')];
   layers.forEach((l,i)=>{
     ensureLayerEffectState(l);
     Object.assign(getLayerSweepConfig(l),{
       glintEnabled:true,enabled:true,lengthPercent:[12,25,38][i],
       opacity:[22,45,67][i],color:['#ff0000','#00ff00','#0000ff'][i],
       haloColor:['#aa0000','#00aa00','#0000aa'][i],brightness:[50,70,90][i],
       glow:[3,6,9][i],glowIntensity:[38,62,89][i],softness:[40,60,80][i]
     });
     l.particles.density=[10,20,30][i];l.particles.sizePx=[5,6,7][i];
     l.web.width=[.2,.4,.6][i];l.web.speed=[10,20,30][i];
     l.lamps.brightness=[30,50,70][i];l.lamps.radius=[4,8,12][i];
   });
   state.layers.splice(0,state.layers.length,...layers);
   state.activeLayerId=layers[0].id;state.masterLayerEdit=false;
   updateLayerListUI();syncSidebarInputs();syncSweepUI();
   const snapshot=()=>state.layers.map(l=>({
     sweep:{...l.sweep},particle:{...l.particles},web:{...l.web},lamp:{...l.lamps}
   }));
   const before=snapshot();
   document.getElementById('btnMasterLayer').click();
   const on=snapshot();
   const actions=[
     ['sweepLength','42','sweep','lengthPercent',42],
     ['sweepOpacity','77','sweep','opacity',77],
     ['sweepHaloColor','#cc88ee','sweep','haloColor','#cc88ee'],
     ['sweepColor','#88cc44','sweep','color','#88cc44'],
     ['sweepBrightness','115','sweep','brightness',115],
     ['sweepGlow','17.5','sweep','glow',17.5],
     ['sweepGlowIntensity','140','sweep','glowIntensity',140],
     ['particleDensity','63','particle','density',63],
     ['webWidth','0.8','web','width',.8],
     ['lampBrightness','112','lamp','brightness',112]
   ];
   const checks=[];
   for(const [id,val,group,key,want] of actions){
     const el=document.getElementById(id);if(!el)throw new Error('missing control '+id);
     const old=snapshot();
     el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));
     const now=snapshot();
     const actual=state.layers.map(l=>group==='sweep'?l.sweep[key]:group==='particle'?l.particles[key]:group==='web'?l.web[key]:l.lamps[key]);
     const mapped=group==='sweep'?'sweep':group==='particle'?'particles':group==='web'?'web':'lamps';
     const preserved=now.every((v,i)=>Object.keys(old[i][group]).every(k=>k===key||JSON.stringify(v[group][k])===JSON.stringify(old[i][group][k])));
     checks.push({id,preserved,actual,expected:want,path:mapped+'.'+key,paths:window.__spiroLastMasterBroadcast?.paths});
   }
   const old=snapshot();
   document.getElementById('sweepLength').value='42';
   document.getElementById('sweepLength').dispatchEvent(new Event('change',{bubbles:true}));
   const noOp=snapshot();
   state.masterLayerEdit=false;
   syncSidebarInputs();syncSweepUI();
   document.getElementById('sweepLength').value='51';
   document.getElementById('sweepLength').dispatchEvent(new Event('input',{bubbles:true}));
   const masterOff=state.layers.map(l=>l.sweep.lengthPercent);
   return {before,on,checks,masterOff};
  })()`);
  assert.deepEqual(result.on,result.before,'enabling Master should not alter any property');
  for(const c of result.checks){
   assert(c.preserved,'unrelated properties were modified by '+c.id+': '+JSON.stringify(c));
   assert.deepEqual(c.paths,[c.path],c.id+' changed extra Master paths');
   for(const v of c.actual)assert.equal(v,c.expected,c.id+' did not reach all layers');
  }
  assert.deepEqual(result.masterOff,[51,42,42]);
  const errors=uncaughtExceptions(h.events);assert.deepEqual(errors,[]);
  console.log('PASS Master strict isolation: '+result.checks.map(c=>c.id).join(', '));
 }finally{await h.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
