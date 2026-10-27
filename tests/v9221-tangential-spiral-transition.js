'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:25000});
 try{
 const result=await h.evaluate(`(()=>{
   const layer=createLayer('spiral-tangent-animation');
   Object.assign(layer,{N:6,K:1,spiralEnabled:true,spiralOrder:3,spiralClosed:false,spiralTangential:false,
     radius:220,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.25,y:0},{x:.5,y:0},{x:.75,y:0},{x:1,y:0}],
     rounding:0,testMorph:{enabled:true,spiralType:'phaseCircle',mode:'circleSlide',duration:1}});
   const getGeometry=(v)=>{const o=SomataRenderLayerSnapshot.create(layer);Object.assign(o,v);
     const path=(buildOrbitPolylines(o)||[])[0]?.points||[];
     const p=path[Math.floor(path.length/2)]||{};
     return {x:p.x,y:p.y,length:path.length,signature:typeof getLayerGeometrySignature==='function'?getLayerGeometrySignature(o):null};};
   const values=[0,.25,.5,.75,1].map(u=>getGeometry({__spiralTangentialMix:u}));
   delete layer.__spiralTangentialMix;
   state.layers=[layer];state.activeLayerId=layer.id;SomataTestMorph.updateTask();
   const frame=(time)=>{const l=SomataRenderLayerSnapshot.create(layer);SomataTestMorph.applyFrame({layer:l,sourceLayer:layer,layerIndex:0,
     blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}},time);
     const path=(buildOrbitPolylines(l)||[])[0]?.points||[];const p=path[Math.floor(path.length/2)]||{};
     return {mix:l.__spiralTangentialMix,active:SomataTestMorph.status().last?.transitioning,fade:SomataTestMorph.status().last?.topologyEndpointFade,
       gpu:SomataTestMorph.status().last?.retainedGpuEdit,point:[p.x,p.y],length:path.length};};
   const now=performance.now()+2000;frame(now);layer.spiralTangential=true;
   const forward=[0,.25,.5,.75,1,1.01].map(t=>frame(now+1000+t*1000));
   const next=now+4500;layer.spiralTangential=false;
   const reverse=[0,.25,.5,.75,1,1.01].map(t=>frame(next+t*1000));
   state.layers=[];SomataTestMorph.updateTask();
   return {values,forward,reverse};
 })()`,{label:'tangential static animation and true geometry'});
 for(const frame of result.values){assert(Number.isFinite(frame.x)&&Number.isFinite(frame.y));assert(frame.length>2);}
 const a=result.values[0],b=result.values.at(-1);assert(Math.hypot(a.x-b.x,a.y-b.y)>1,'Tangential geometry must really differ');
 for(let i=1;i<4;i++){
   const p=result.values[i],fraction=i/4;
   assert(Math.hypot(p.x-(a.x+(b.x-a.x)*fraction),p.y-(a.y+(b.y-a.y)*fraction))<1e-5,'Nonlinear/snapping geometry '+i);
 }
 for(const [name,series,increasing] of [['forward',result.forward,true],['reverse',result.reverse,false]]){
   for(let i=0;i<series.length;i++){
     const t=Math.min(1,i/4),smooth=t*t*(3-2*t);const x=series[i],expected=increasing?smooth:1-smooth;
     if(i===5){assert(x.mix===undefined || Math.abs(x.mix-expected)<1e-6,name+' wrong final static strength '+i);continue;}
     assert(Number.isFinite(x.mix),name+' mix missing '+i);
     assert(Math.abs(x.mix-expected)<1e-6,name+' does not ease continuously '+i+' '+JSON.stringify(x));
     assert(x.fade!==true,name+' fell back to endpoint fade at '+i);
     if(i>0&&i<5)assert(Math.hypot(x.point[0]-series[i-1].point[0],x.point[1]-series[i-1].point[1])>1e-3,name+' frozen '+i);
   }
 }
 // Finite-difference velocity must approach zero at both ends of the edit.
 for(const series of [result.forward,result.reverse]){
   const first=Math.abs(series[1].mix-series[0].mix),middle=Math.abs(series[3].mix-series[2].mix),last=Math.abs(series[4].mix-series[3].mix);
   assert(first<middle&&last<middle,'Tangential transition retains an abrupt stop');
 }
 const gpu=await h.evaluate(`(()=>{
    const a=createLayer('blue-from');Object.assign(a,{N:6,K:1,spiralEnabled:true,spiralOrder:2,spiralClosed:false,spiralTangential:false,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.3,y:.15},{x:.7,y:-.05},{x:1,y:0}]});
    const b={...a,id:'blue-to',spiralTangential:true};
    state.layers=[a];runtimeState.morph.active=true;state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
    runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
    const phases=[0,.25,.5,.75,1].map(t=>{
      runtimeState.morph.progress=t;runtimeState.morph.geometryT=t;
      const p=__somataSpiralCarrierMorphPlan(0,t),c=p?.carrierFrames?.[0],q=p?.paths?.[0]?.[0];
      return{mapped:p?.carrierMapped,overflow:p?.carrierOverflow,tangent:c?.tangential,x:q?.c1.x,y:q?.c1.y};
    });
    runtimeState.morph.active=false;state.layers=[];return phases;
  })()`,{label:'actual Blue GPU-carrier tangential transition'});
  assert.equal(gpu.length,5);
  for(let i=0;i<gpu.length;i++){
    const phase=i/4,wanted=phase*phase*(3-2*phase),g=gpu[i];
    assert(g.mapped&&!g.overflow,`Blue GPU carrier failed at ${wanted}: ${JSON.stringify(g)}`);
    assert(Math.abs(g.tangent-wanted)<1e-8,`Blue tangent strength snapped at ${wanted}: ${JSON.stringify(g)}`);
    assert(Number.isFinite(g.x)&&Number.isFinite(g.y));
  }
  for(let i=1;i<4;i++)assert(Math.hypot(gpu[i].x-gpu[i-1].x,gpu[i].y-gpu[i-1].y)>1e-5,'GPU morph has frozen mid-shape');
  assert(gpu[1].tangent-gpu[0].tangent<gpu[2].tangent-gpu[1].tangent,'GPU tangent has a hard start');
  assert(gpu[4].tangent-gpu[3].tangent<gpu[3].tangent-gpu[2].tangent,'GPU tangent has a hard stop');
 assert.equal(uncaughtExceptions(h.events).length,0);
 console.log('PASS v9221 tangential↔non-tangential: intermediary geometry, static animation, no endpoint fade',JSON.stringify(result.values.map(x=>({x:x.x,y:x.y}))));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
