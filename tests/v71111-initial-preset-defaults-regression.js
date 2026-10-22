// 7.11.11 defaults: web, lamp, and first-time audio routing. Keep authored route edits untouched.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,m)=>{if(!x)throw new Error(m);};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350,evalTimeoutMs:16000});
 try{
  const data=await h.evaluate(`(()=>{
   const lamp=state.lamps, web=state.web, fresh=createLayer('new');ensureLayerEffectState(fresh);
   const preset=state.audioReactive.routingPreset;
   const r=ensureAudioRoutingState();const layer=state.layers[0];
   const layerRoutes=(r.layers[layer.id]||[]).map(x=>({param:x.param,enabled:x.enabled}));
   const polarity=getAudioMasterRouteConfig('lamps.softness').polarity;
   const otherPolarity=getAudioMasterRouteConfig('lamps.radius').polarity;
   const html={placement:document.getElementById('webPlacementMode').value,depth:Number(document.getElementById('webDistance').value),
    radius:Number(document.getElementById('lampRadius').value),mult:Number(document.getElementById('lampRadiusMultiplier').value),brightness:Number(document.getElementById('lampBrightness').value),
    adaptive:document.getElementById('lampAdaptiveBrightness').checked,adjustBrightness:document.getElementById('lampAdaptiveAdjustBrightness').checked,
    label:document.querySelector('#lampAdaptiveBrightness + span')?.textContent,adaptLabel:document.querySelector('#lampAdaptiveAdjustBrightness + span')?.textContent,
    preset:document.getElementById('audioRoutingPreset').value};
   // An explicit edit of Master polarity and routes must not be overwritten by ensure.
   setAudioMasterRouteConfig('lamps.softness',{polarity:'plus'});
   r.layers[layer.id]=[{id:'user-link',enabled:true,band:'mid',param:'layer.radius',strength:71,multiplier:1.25,derivative:false,signalMode:'add'}];
   ensureAudioRoutingState();
   const userPreserved=r.layers[layer.id].length===1&&r.layers[layer.id][0].id==='user-link';
   const masterPreserved=getAudioMasterRouteConfig('lamps.softness').polarity==='plus';
   // Construct a new Master softness configuration: the default must be minus again.
   delete state.audioReactive.masterRouteMultipliers['lamps.softness'];
   // Clearing the saved map reference also resets the transient runtime cache.
   state.audioReactive.masterRouteMultipliers={};
   const restoredDefault=getAudioMasterRouteConfig('lamps.softness').polarity;
   return{web:{placement:web.placementMode,depth:web.distance,freshPlacement:fresh.web.placementMode,freshDepth:fresh.web.distance},
     lamp:{radius:lamp.radius,mult:lamp.radiusMultiplier,brightness:lamp.brightness,adaptive:lamp.adaptiveBrightness,adjust:lamp.adaptiveAdjustBrightness,
       freshRadius:fresh.lamps?.radius,freshBrightness:fresh.lamps?.brightness},
     preset,html,layerRoutes,polarity,otherPolarity,userPreserved,masterPreserved,restoredDefault};
  })()`,{label:'7.11.11 defaults'});
  assert(data.web.placement==='selfIntersection'&&data.web.depth===30,'web state '+JSON.stringify(data.web));
  assert(data.web.freshPlacement==='selfIntersection'&&data.web.freshDepth===30,'new layer web '+JSON.stringify(data.web));
  assert(data.lamp.radius===25&&data.lamp.mult===1&&data.lamp.brightness===60&&data.lamp.adaptive===true&&data.lamp.adjust===false,'lamp defaults '+JSON.stringify(data.lamp));
  assert(data.lamp.freshRadius===25&&data.lamp.freshBrightness===60,'new layer lamp defaults '+JSON.stringify(data.lamp));
  assert(data.html.placement==='selfIntersection'&&data.html.depth===30&&data.html.radius===25&&data.html.mult===1&&data.html.brightness===60&&data.html.adaptive&&!data.html.adjustBrightness,'UI defaults '+JSON.stringify(data.html));
  assert(data.html.label==='Адаптивный свет'&&data.html.adaptLabel==='Адаптировать яркость','labels '+JSON.stringify(data.html));
  assert(data.preset==='geometryLamps'&&data.html.preset==='geometryLamps','preset mismatch '+JSON.stringify(data));
  const needed=['layer.radius','layer.rotation','lamps.radius','lamps.brightness','lamps.softness'];
  assert(needed.every(k=>data.layerRoutes.some(r=>r.param===k)),'first-time routes missing '+JSON.stringify(data.layerRoutes));
  assert(data.polarity==='minus'&&data.otherPolarity==='plus'&&data.restoredDefault==='minus','Master defaults '+JSON.stringify(data));
  assert(data.userPreserved&&data.masterPreserved,'authored routes or Master polarity were overwritten');
  assert(uncaughtExceptions(h.events).length===0,'uncaught browser exceptions '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS 7.11.11 web/lamp/audio first-time defaults',data);
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL 7.11.11 defaults',e.stack||e);process.exitCode=1;});
