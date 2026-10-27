'use strict';
// Verify native Fill fan bytes and audio-layer reconciliation remain deterministic.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:20000});
 try{
  const snapshot=await h.evaluate(`(()=>{
    const beforeLayers=state.layers,beforeAudio=state.audioReactive;
    const layer=createLayer('fill-fan-10412');
    layer.fill=true;layer.rounding=0;layer.profileMode='segments';layer.spiralEnabled=false;
    const meshInfo=(m)=>m?{
      count:m.fanFloatCount??m.fanData?.length??0,triangles:m.fanTriangleCount??0,
      data:Array.from((m.fanData||[]).subarray(0,m.fanFloatCount??m.fanData?.length??0)),
      anchor:m.anchor||null,complete:m.complete,nativeComplete:m.nativeComplete,
      contours:m.contourCount??null
    }:null;
    const poly=(n,shift=0)=>Array.from({length:n},(_,i)=>{
      const a=2*Math.PI*i/n;return{x:shift+Math.cos(a)*93,y:Math.sin(a)*66};
    });
    const duplicate=(p)=>[p[0],{x:p[0].x+1e-10,y:p[0].y-1e-10},...p.slice(1)];
    const out={};
    try{
      const data={paths:[{points:duplicate(poly(7)),closed:true},{points:poly(4,250),closed:true}]};
      out.static=meshInfo(FillMeshPreparer.prepareStatic(data,layer));
      const contours={screenPaths:[{points:duplicate(poly(9)),closed:true},{points:poly(6,300),closed:true}]};
      out.frame=meshInfo(FillMeshPreparer.prepareFrameContour({layer,frameId:175,geometryPlan:{dynamic:false}},contours));
      const commands=[{subpaths:[{points:duplicate(poly(10)),closed:true},{points:poly(5,180),closed:true}]},
       {subpaths:[{points:poly(4,400).concat([poly(4,400)[0]]),closed:false}]}];
      out.line=meshInfo(FillMeshPreparer.prepareLineCarrierCommands({layer,frameId:176,geometryPlan:{dynamic:true}},commands));
      const live1=createLayer('audio-live-1'),live2=createLayer('audio-live-2');
      live1.id='qa-live-A';live2.id='qa-live-B';
      state.layers=[live1,live2];
      state.audioReactive={...beforeAudio,routingInitialized:true,
        routes:{master:[],layers:{'qa-live-A':[{param:'lamps.softness',band:'low'},{param:'layer.radius',band:'low'},{param:'lamps.softness',band:'mid'}],'qa-live-B':[],'qa-removed-1':[],'qa-removed-2':[]}},
        layerSignalEnabled:{'qa-live-A':false,'qa-live-B':true,'qa-removed-1':true,'qa-removed-3':false},
        routingTarget:'qa-removed-2',groupToggleMemory:{},
        masterRouteMultipliers:{},defaultRoutesEnabled:false};
      const routes=ensureAudioRoutingState();
      out.audio={routes:Object.keys(routes.layers).sort(),enabled:{...state.audioReactive.layerSignalEnabled},
        target:state.audioReactive.routingTarget,initialized:state.audioReactive.routingInitialized,
        masterUsed:audioMasterParamsInUse(),
        nativeBands:state.layers.map(l=>[l.id,l.audioNativeBand,l.audioNativeBandAuto])};
      // Keep a valid layer target untouched on the second normalization.
      state.audioReactive.routingTarget='qa-live-B';
      ensureAudioRoutingState();
      out.audioTargetSecond=state.audioReactive.routingTarget;
      return out;
    }finally{
      state.layers=beforeLayers;state.audioReactive=beforeAudio;
      FillMeshPreparer.reset();
    }
  })()`,{timeoutMs:20000,label:'v10412 fill/audio parity'});
  for(const k of ['static','frame','line']){
   assert(snapshot[k]?.complete,`${k} is incomplete`);
   assert(snapshot[k].count>0&&snapshot[k].count===snapshot[k].data.length,`${k} missing vertices`);
   assert.equal(snapshot[k].count/6,snapshot[k].triangles);
  }
  assert.deepEqual(snapshot.audio.routes,['qa-live-A','qa-live-B']);
  assert.deepEqual(Object.keys(snapshot.audio.enabled).sort(),['qa-live-A','qa-live-B']);
  assert.equal(snapshot.audio.enabled['qa-live-A'],false);
  assert.equal(snapshot.audio.target,'master');
  assert.deepEqual(snapshot.audio.masterUsed,['layer.radius','lamps.softness']);
  assert.equal(snapshot.audioTargetSecond,'qa-live-B');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  if(process.env.SOMATA_PARITY_SNAPSHOT==='1')console.log('SNAPSHOT:'+JSON.stringify(snapshot));
  console.log('PASS Somata 10.4.12 Fill fan packing + Audio Routing');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
