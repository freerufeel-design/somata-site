'use strict';
// The Orange special rows must influence the actual generated composition,
// not only the UI and saved options.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:26000});
 try{
  const v=await h.evaluate(`(()=>{
    const ro=state.randomOptions;
    state.randomLayerCount=3;document.getElementById('randomLayerCount').value='3';
    Object.assign(ro,{bySpiralLayers:true,spiralLayersMin:2,spiralLayersMax:2,
      bySpiralOrder:true,spiralOrderMin:3,spiralOrderMax:3,spiralTangentialChance:100,
      specialLayerCoverage:{...(ro.specialLayerCoverage||{}),'spiral.order':100,'spiral.layers':100}});
    state.minimalMorph.generatorStyle='standard';
    document.getElementById('btnRandomPreset').click();
    const both=state.layers.map(l=>({spiral:l.spiralEnabled===true,order:l.spiralOrder,tangential:l.spiralTangential===true}));
    // Order-only changes a pre-existing Spiral, without changing layer count.
    const original=state.layers[0];Object.assign(original,{spiralEnabled:true,spiralOrder:1,spiralClosed:true});
    Object.assign(ro,{bySpiralLayers:false,bySpiralOrder:true,spiralOrderMin:-3,spiralOrderMax:-3});
    document.getElementById('btnRandomPreset').click();
    const only=state.layers[0];
    return {both,only:{spiral:only.spiralEnabled,order:only.spiralOrder},
       profileStored:typeof SomataOrangeMorphProfiles?.captureDraft==='function'};
 })()`,{label:'Orange Spiral-generated actual route values'});
  const selected=v.both.filter(x=>x.spiral);
  assert.equal(selected.length,2,'Orange generated wrong number of Spiral layers: '+JSON.stringify(v));
  assert(selected.every(x=>x.order===3&&x.tangential),'Orange Spiral order/tangency values ignored: '+JSON.stringify(v));
  assert.equal(v.only.order,-3,'Order-only route failed to change existing Spiral: '+JSON.stringify(v));
  assert(v.profileStored,'Orange profile persistence missing');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS v10423 real Orange dice: layer count, independent order, tangency and order-only existing Spiral');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
