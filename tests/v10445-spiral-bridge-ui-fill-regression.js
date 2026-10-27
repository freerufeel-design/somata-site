'use strict';
// Closed Spiral keeps an authored bridge plus Fill; UI owns only Round seams.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:45000});
 try{
  const v=await h.evaluate(`(()=>{
    const prev={layers:state.layers,active:state.activeLayerId};
    try{
      const layer=createLayer('closed-fill-bridge');Object.assign(layer,{N:8,K:3,spiralEnabled:true,spiralClosed:true,
       spiralOrder:1,spiralRoundSeams:false,spiralFillEnabled:true,spiralFillType:'interwinding',fill:true,
       profileMode:'segments',rounding:52,profileNodes:[{x:0,y:0},{x:.28,y:.32},{x:.61,y:-.23},{x:1,y:0}]});
      state.layers=[layer];state.activeLayerId=layer.id;
      if(typeof setSingleLayerSelection==='function')setSingleLayerSelection(layer);
      syncSidebarInputs();
      const round=document.getElementById('paramSpiralRoundSeams');
      const result={removed:document.getElementById('paramSpiralJoinInterpolation')===null,
        registered:SomataParameterRegistry.get('spiral.joinInterpolation')!==null,
        roundAvailable:!!round&&!round.disabled,initial:round?.checked};
      const spec={radius:220,delta:1.1,targetScale:1.3,tangential:0,closed:true,roundingFrac:.52};
      const a=__spiroBuildSpiralCarrierPath(layer,{x:220,y:0},spec),b=__spiroBuildSpiralCarrierPath(layer,{x:155,y:110},spec);
      const contours=FillMeshPreparer.buildSpiralBandContours({paths:[a,b]},layer);
      result.fillCount=contours?.length||0;result.fillPoints=contours?.[0]?.points?.length||0;
      round.click();result.afterClick={checked:round.checked,layerValue:layer.spiralRoundSeams};
      return result;
    }finally{state.layers=prev.layers;state.activeLayerId=prev.active;}
  })()`,{label:'real round-seams UI and fill for closed Spiral'});
  assert.equal(v.removed,true);assert.equal(v.registered,false);
  assert.equal(v.roundAvailable,true);assert.equal(v.initial,false);
  assert(v.fillCount>0&&v.fillPoints>10,'closed fill unavailable: '+JSON.stringify(v));
  assert.deepEqual(v.afterClick,{checked:true,layerValue:true});
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10445: obsolete join toggle removed; independent round-seams UI and closed Fill work');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v10445',e.stack||e);process.exitCode=1;});
