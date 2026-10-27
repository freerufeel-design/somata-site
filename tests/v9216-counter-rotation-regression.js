'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
const wrap=v=>((v+180)%360+360)%360-180;
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:20000});
 try{
 const rows=await h.evaluate(`(()=>{
  const set=(id,v)=>{const e=document.getElementById(id);if(!e)throw Error('missing '+id);e.value=String(v);e.dispatchEvent(new Event('change',{bubbles:true}));};
  const check=(id,v)=>{const e=document.getElementById(id);if(!e)throw Error('missing '+id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
  const wrap=v=>((v+180)%360+360)%360-180;
  const cases=[
   {name:'two positive full turns',mode:'phaseCircle',spin:2,n:12,k:1,order:1,rot:15},
   {name:'five negative full turns',mode:'phase',spin:-5,n:12,k:1,order:1,rot:30},
   {name:'short positive turn',mode:'minimalTurn',spin:0.25,n:13,k:2,order:2,rot:10},
   {name:'negative 180 counter to phase',mode:'phaseCircle',spin:0.5,n:12,k:1,order:1,rot:0}
  ];
  const rows=[];
  for(const c of cases){
   if(runtimeState.morph.active)document.getElementById('btnMorph').click();
   const a=createLayer('phase-test');Object.assign(a,{N:c.n,K:c.k,spiralEnabled:true,spiralOrder:c.order,spiralStep:c.k,spiralStepLinked:true,rotation:c.rot,radius:220,closedLoop:false,spiralClosed:true,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.35,y:.17},{x:1,y:0}]});state.layers=[a];state.activeLayerId=a.id;
   set('morphMode','circleSlide');set('morphSpiralMorphType',c.mode);
   for(const id of ['morphByVertices','morphBySteps','morphByShape','morphBySpiralLayers','morphByRounding','morphBySize','morphByColor','morphByFillColor','morphByOpacity'])check(id,false);
   check('morphByRotation',true);check('morphRotationRandomDirection',c.spin<0);
   set('morphRotationMin',100);set('morphRotationMax',100);set('morphRotationMultiplier',Math.abs(c.spin));
   // Freeze frame drawing; assertions compare CPU-endpoint to authored target.
   document.getElementById('btnMorph').click();
   const rt=runtimeState.morph,s=rt.renderSourceLayers[0],t=rt.renderTargetLayers[0];
   const normalized=wrap(t.rotation-s.rotation),counter=rt.spiralPhaseCounterRotation||[];
   const end=__somataSpiralCarrierMorphPlan(0,1)?.paths||[];
   const raw=buildOrbitPolylines(t)||[];
   const tips=(ps)=>ps.map(p=>{const a=p?.points||p;return a?.length?a[a.length-1]:null}).filter(Boolean);
   const endTips=end.map(x=>x?.length?x[x.length-1]?.p3:null).filter(Boolean),real=tips(raw);
   const error=endTips.length&&real.length?Math.max(...endTips.map(p=>Math.min(...real.map(q=>Math.hypot(q.x-p.x,q.y-p.y))))):NaN;
   rows.push({name:c.name,mode:c.mode,spin:c.spin,from:s.rotation,to:t.rotation,delta:t.rotation-s.rotation,counter,actualModulo:normalized,expectedModulo:wrap(c.spin*360),endError:error});
   document.getElementById('btnMorph').click();
  }
  return rows;
 })()`,{timeoutMs:19000,label:'spiral counter rotation across GPU and canonical geometry'});
 for(const x of rows){
  assert(Math.abs(x.delta)<=180+1e-6,`${x.name}: long turn remains ${x.delta}`);
  assert(Math.abs(wrap(x.delta-x.spin*360))<1e-6,`${x.name}: changed endpoint`);
  assert(x.endError<1e-5,`${x.name}: carrier endpoint differs from canonical ${x.endError}`);
 }
 assert(!uncaughtExceptions(h.events).length,'browser exceptions');
 console.log('PASS spiral counterrotation of full turns with final endpoint exact',JSON.stringify(rows));
 }finally{await h.close()}
})().catch(err=>{console.error(err.stack||err);process.exit(1)});
