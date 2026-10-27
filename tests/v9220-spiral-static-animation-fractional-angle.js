'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:35000});
 try{
  const data=await h.evaluate(`(()=>{
    const cases=[];
    const sample=(a,now)=>{
      const layer=SomataRenderLayerSnapshot.create(a);
      const frame={layer,sourceLayer:a,layerIndex:0,blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}};
      SomataTestMorph.applyFrame(frame,now);
      const paths=buildOrbitPolylines(layer)||[],p=paths[0]?.points||[];
      const angle=__spiroGetSpiralCarrierSpec(layer,0)?.delta;
      return {N:layer.N,angularN:layer.__spiralAnimatedN,angularK:layer.__spiralAnimatedK,
        angle,opacity:layer.opacity,px:p[1]?.x,py:p[1]?.y,pts:p.length,
        faded:SomataTestMorph.status().last?.topologyEndpointFade,
        continuous:SomataTestMorph.status().last?.angularSpiralEdit};
    };
    for(const [N0,N1,K0,K1] of [[2,3,1,1],[3,4,1,1],[4,5,1,1],[3,4,1,2],[5,3,2,1]]){
      const a=createLayer('stat-edit'+N0+N1+K0+K1);Object.assign(a,{N:N0,K:K0,spiralEnabled:true,
         spiralOrder:2,spiralClosed:false,opacity:80,profileMode:'segments',
         profileNodes:[{x:0,y:0},{x:1,y:0}],testMorph:{enabled:true,spiralType:'phaseCircle',mode:'circleSlide',duration:1}});
      state.layers=[a];state.activeLayerId=a.id;SomataTestMorph.updateTask();
      const init=performance.now()+2000;sample(a,init);
      a.N=N1;a.K=K1;
      const begin=init+1000,phases=[0,.1,.25,.49,.5,.51,.75,.9,.99,1,1.01];
      const frames=phases.map(t=>sample(a,begin+t*1000));
      cases.push({N0,N1,K0,K1,frames,phases});
    }state.layers=[];SomataTestMorph.updateTask();return cases;
  })()`,{timeoutMs:34000,label:'actual static animation fractional N/K rendered contour'});
  for(const c of data){
   let last=null;
   for(let i=0;i<c.frames.length;i++){
     const f=c.frames[i],t=c.phases[i],u=Math.max(0,Math.min(1,t)),q=u*u*(3-2*u),expectedN=c.N0+(c.N1-c.N0)*q,expectedK=c.K0+(c.K1-c.K0)*q;
     if(u<1){assert.equal(f.continuous,true,JSON.stringify({c,i,f}));assert.equal(f.faded,false,'midpoint endpoint fade');}
     assert(Math.abs((f.angularN??c.N1)-expectedN)<1e-8,JSON.stringify({c,i,f,expectedN}));
     assert(Math.abs((f.angularK??c.K1)-expectedK)<1e-8,JSON.stringify({c,i,f,expectedK}));
     assert.equal(f.opacity,80,'No artificial disappearance');
     assert(f.pts>=2&&Number.isFinite(f.px)&&Number.isFinite(f.py),'missing rendered spiral');
     if(i&&i<c.phases.length-1)assert(Math.abs(f.angle-last.angle)<1.4,'step phase jump');
     last=f;
   }
   const at100=c.frames[c.frames.length-2],post=c.frames[c.frames.length-1];
   assert(Math.hypot(at100.px-post.px,at100.py-post.py)<1e-7,'terminal render discontinuity '+JSON.stringify(c));
  }
  assert.equal(uncaughtExceptions(h.events).length,0);
  console.log('PASS v9220 actual static Animation 2→3, 3→4, 4→5, K changes, and end-to-static (11 visible frames each)');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
