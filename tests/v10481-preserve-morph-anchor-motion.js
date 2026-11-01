'use strict';
// Fixed reference generated from Somata before the broad rounded-contour override.
// Geometry moving anchors must be identical for every intermediate frame.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:80000});
 try{
  const vals=await h.evaluate(`(()=>{
   const old={mode:state.morph.mode,fourier:state.fourierMode};
   const P=[{x:0,y:0},{x:.18,y:.41},{x:.47,y:-.27},{x:.76,y:.22},{x:1,y:0}];
   const Q=[{x:0,y:0},{x:.14,y:-.22},{x:.43,y:.38},{x:.81,y:-.32},{x:1,y:0}];
   const context={globalAlpha:1,save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},
    bezierCurveTo(){},quadraticCurveTo(){},closePath(){},stroke(){},fill(){}};
   const out=[];
   try{
    state.fourierMode=false;
    for(const mode of ['topology','calm','circleSlide','topoCircle']){
     state.morph.mode=mode;
     for(const movement of ['linear','angular'])for(const rounding of [0,35,90]){
      const a=createLayer('reference-a'),b=createLayer('reference-b');
      Object.assign(a,{N:7,K:2,radius:180,rotation:0,profileMode:'segments',rounding,
       closedLoop:true,fill:false,profileNodes:P,spiralEnabled:false});
      Object.assign(b,a,{id:'reference-b',N:10,K:3,rotation:21,profileNodes:Q});
      for(const t of [0,.02,.2,.5,.8,.98,1]){
       drawAngularAnchorMorph(context,b,a,b,t,1,'phase',movement);
       const plan=getCircleMorphPlan(a,b,'phase');
       const anchors=plan.pathPlans.map(row=>row.vertexPts.map(p=>[Number(p.x.toFixed(6)),Number(p.y.toFixed(6))]));
       out.push({mode,movement,rounding,t,anchors});
      }
     }
    }
   }finally{state.morph.mode=old.mode;state.fourierMode=old.fourier;}
   return out;
  })()`,{label:'preserve mode-specific anchor transport'});
  const hash=crypto.createHash('sha256').update(JSON.stringify(vals)).digest('hex');
  const expected='e83286e4d4498a7a56b5f04cfe5bdc73caf590e7119c412868d1d067cdb4be2f';
  if(process.env.SOMATA_RECORD_ANCHORS==='1')console.log('REFERENCE',hash,'snapshots',vals.length);
  else assert.equal(hash,expected,'morphing anchor paths changed: '+hash);
  assert.equal(vals.length,168);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS 168 mode/movement/rounding/t snapshots: original moving anchors preserved');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1});
