'use strict';
// Static/lightning/prepared frames must not clone exact Morph endpoints.
// All geometry-producing Blue provider modes retain their legacy contract.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:20000});
 try{
  const result=await h.evaluate(`(()=>{
    const origBuilder=window.buildBlueExactEndpointLayer;
    const origDraw=window.getCachedLayerDrawData;
    const origConstrained=window.morphBudgetConstrainedDevice;
    let builds=0,deviceReads=0;
    window.buildBlueExactEndpointLayer=(...args)=>{builds++;return origBuilder(...args);};
    window.getCachedLayerDrawData=layer=>({maxRadius:layer.radius||1,pointCount:layer.profileNodes?.length||0});
    window.morphBudgetConstrainedDevice=()=>{deviceReads++;return false;};
    try{
      const base={...state.layers[0],id:'qa-morph-1049',spiralEnabled:false,chaosStar:false,N:5,K:2,
       profileMode:'segments',profileNodes:[{x:0,y:0},{x:.4,y:.2},{x:1,y:0}],radius:170};
      const profile={mode:'segments',nodes:[{x:0,y:0},{x:.5,y:.3},{x:1,y:0}]};
      const cases=[
       {key:'inactive',active:false,mode:'circleSlide',options:{},want:'static',clones:0},
       {key:'light',active:true,mode:'light',options:{},want:'light-static',clones:0},
       {key:'lightning',active:true,mode:'lightning',options:{},want:'lightning',clones:0},
       {key:'prepared',active:true,mode:'circleSlide',options:{},chaos:true,want:'blue-prepared',clones:0},
       {key:'circle-slide',active:true,mode:'circleSlide',options:{byVertices:true},want:'blue-circle-slide',clones:2},
       {key:'anchor',active:true,mode:'topology',options:{byShape:true},want:'blue-anchor-linear',clones:2},
       {key:'fade',active:true,mode:'fade',options:{byShape:true},want:'blue-fade',clones:2}
      ];
      const providers=[];
      for(const c of cases){
        builds=0;
        const snap={active:c.active,mode:c.mode,monoOrbitTransforms:false,options:c.options,
          geometryT:.43,progress:.43,lightningCycleColor:'#ffffff',profileCarrierPlans:[],
          sourceVisuals:[{radius:80}],targetVisuals:[{radius:140}],
          sourceProfiles:[profile],targetProfiles:[profile],sourceGeometry:[[{}]],targetGeometry:[[{}]],
          renderSourceLayers:[c.chaos?{chaosStar:true}:{}],renderTargetLayers:[{}],
          lightLayers:[],lightScales:[],lightRotations:[],lightDrawData:[]};
        const frameCtx={layerIndex:0,sourceLayer:base};
        const p=resolveBlueMorphLayerProvider(frameCtx,{morphProviders:{blue:snap},audioRotationOverride:false});
        const row={key:c.key,kind:p.kind,geometryActive:p.geometryActive,
         sourceNodes:p.sourceLayer?.profileNodes?.length||0,targetNodes:p.targetLayer?.profileNodes?.length||0,
         sourceRadius:p.sourceLayer?.radius||null,targetRadius:p.targetLayer?.radius||null,
         sourceData:p.sourceData?.pointCount||0,targetData:p.targetData?.pointCount||0};
        if(p.kind!==c.want)throw Error('Wrong provider kind '+c.key+': '+p.kind);
        if(builds!==c.clones)throw Error('Unnecessary endpoint clones '+c.key+': '+builds);
        providers.push(row);
      }
      const budgetCases=[
       {layer:{N:8,K:3,profileMode:'segments',rounding:0},source:{N:8,K:3},target:{N:11,K:2},mode:'segments',ys:[0,0,0]},
       {layer:{N:37,K:5,profileMode:'spline',rounding:7},source:{N:37,K:5},target:{N:71,K:4},mode:'spline',ys:[0,.2,0]},
       {layer:{N:5,K:2,spiralEnabled:true,radius:250},source:{spiralEnabled:true,spiralOrder:1.5},target:{spiralEnabled:true,spiralOrder:-3.75},mode:'segments',ys:[.1,.2,.1]},
       {layer:{N:7,K:2,spiralEnabled:false,radius:380,rounding:8},source:{spiralEnabled:true,spiralOrder:18},target:{spiralEnabled:false},mode:'spline',ys:[.2,-.2,.1]},
       {layer:{N:15,K:6,radius:210},source:{spiralEnabled:false},target:{spiralEnabled:true,spiralOrder:0},mode:'segments',ys:[0,0,0]}
      ];
      const budgets=[];
      for(const c of budgetCases){
       const prof={mode:c.mode,nodes:c.ys.map((y,x)=>({x,y}))};
       deviceReads=0;
       const budget=chooseMorphLayerSampleBudget(c.layer,c.source,c.target,prof,prof,0);
       budgets.push({budget,spiral:morphBudgetRuntime.last[0]?.spiral,smooth:morphBudgetRuntime.last[0]?.smooth,
        constrained:morphBudgetRuntime.last[0]?.constrained,source:morphBudgetRuntime.last[0]?.source.estimate,target:morphBudgetRuntime.last[0]?.target.estimate});
       if(deviceReads!==(c.source.spiralEnabled===true||c.target.spiralEnabled===true||c.layer.spiralEnabled===true?1:0))
        throw Error('Duplicated device inspection for '+JSON.stringify(c));
      }
      return {providers,budgets};
    }finally{
       window.buildBlueExactEndpointLayer=origBuilder;
       window.getCachedLayerDrawData=origDraw;
       window.morphBudgetConstrainedDevice=origConstrained;
    }
  })()`,{timeoutMs:20000});
  assert.equal(result.providers.length,7);
  assert.deepEqual(result.providers.map(x=>x.kind),['static','light-static','lightning','blue-prepared','blue-circle-slide','blue-anchor-linear','blue-fade']);
  assert(result.providers.slice(4).every(x=>x.sourceNodes===3&&x.targetNodes===3));
  assert(result.budgets.every(x=>Number.isInteger(x.budget)&&x.budget>0));
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  if(process.env.SOMATA_PARITY_SNAPSHOT==='1')process.stdout.write('SNAPSHOT:'+JSON.stringify(result)+'\n');
  console.log('PASS Somata 10.4.9 lazy exact endpoints and Spiral budget parity');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
