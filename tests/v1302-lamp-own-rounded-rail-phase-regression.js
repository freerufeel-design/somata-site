// Somata 13.0.2: lamp centers must follow THEIR OWN visible Bezier rail at
// their published morph-phase arc fractions, even when rails are reordered
// or spatially close. Not loaded by the application.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw Error(m);};
async function main(){
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300,evalTimeoutMs:20000});
 const baseline=uncaughtExceptions(h.events).length;
 try{
  const r=await h.evaluate(`(()=>{
    const origMode=state.morph.mode,origActive=runtimeState.morph.active,origNow=renderRuntime.now;
    const layer=state.layers[0],cfg=ensureLayerLampState(layer);
    const previous={positionMode:cfg.positionMode,snapToContour:cfg.snapToContour,morphMotionMode:cfg.morphMotionMode};
    Object.assign(cfg,{snapToContour:true,morphMotionMode:'linear',positionMode:'key'});
    runtimeState.morph.active=true;state.morph.mode='topology';renderRuntime.now=5000;
    lampMotionRuntime.profileAttach.clear();
    // Semantic path index 0 is the LOWER curve. FrameContour index 0 is
    // the UPPER curve. Their midsections are only 6 units apart.
    const semantic=[
      {points:[{x:0,y:0},{x:30,y:0},{x:70,y:0},{x:100,y:0}],closed:false},
      {points:[{x:0,y:6},{x:30,y:6},{x:70,y:6},{x:100,y:6}],closed:false}
    ];
    // Samples along rounded cubic-like rails, deliberately reversed.
    const visible=[
      {points:[{x:0,y:6},{x:20,y:10},{x:40,y:12},{x:60,y:12},{x:80,y:10},{x:100,y:6}],closed:false,__frameContour:true},
      {points:[{x:0,y:0},{x:20,y:-4},{x:40,y:-6},{x:60,y:-6},{x:80,y:-4},{x:100,y:0}],closed:false,__frameContour:true}
    ];
    Object.defineProperty(visible,'__somataFrameContour',{value:true});
    const samples=[];
    for(const u of [0,.1,.25,.5,.75,.9,1]){
       renderRuntime.now+=16;
       const fs=[.1+.8*u,.2+.6*u];
       const pts=[
         {x:50,y:10,pathIndex:0,vertexIndex:0,lampId:'rail:lower',lampAttachFraction:fs[0],lampAttachProgress:u},
         {x:50,y:-4,pathIndex:1,vertexIndex:0,lampId:'rail:upper',lampAttachFraction:fs[1],lampAttachProgress:u}
       ];
       const projected=withLampConfig(cfg,()=>projectLampPointsToCurrentPolygon(pts,visible,layer,true,false,semantic));
       samples.push(...projected.map((p,i)=>{
          const own=visible[1-i],expected=lampPointAtFraction(own,fs[i]);
          return{u,semanticIndex:i,visualIndex:p.pathIndex,f:p.lampContourFraction,
             expectedF:fs[i],error:Math.hypot(p.x-expected.x,p.y-expected.y),attached:p.__lampVisualProfileAttached===true};
       }));
    }
    // No fraction: the per-lamp projection may not switch to the nearby
    // wrong line just because that other line is spatially closer.
    const falls=withLampConfig(cfg,()=>projectLampPointsToCurrentPolygon([
      {x:50,y:12,pathIndex:0,vertexIndex:1,lampId:'rail:nearest-lower'},
      {x:50,y:-6,pathIndex:1,vertexIndex:1,lampId:'rail:nearest-upper'}
    ],visible,layer,true,false,semantic));
    const toggled=withLampConfig({...cfg,snapToContour:false,snapToPolygon:false,stickToRounding:false},()=>projectLampPointsToCurrentPolygon([
      {x:10,y:100,pathIndex:0,lampId:'off'}],visible,layer,true,false,semantic));
    // Existing manually edited projects must retain their saved settings.
    const saved={...cfg,brightness:42,radius:17,radiusMultiplier:3};
    const preserved=withLampConfig(saved,()=>({brightness:ensureLayerLampState({lamps:saved}).brightness,
       radius:ensureLayerLampState({lamps:saved}).radius,radiusMultiplier:ensureLayerLampState({lamps:saved}).radiusMultiplier}));
    Object.assign(cfg,previous);runtimeState.morph.active=origActive;state.morph.mode=origMode;renderRuntime.now=origNow;
    return{samples,falls:falls.map(p=>({x:p.x,y:p.y,pathIndex:p.pathIndex,attached:p.__lampVisualProfileAttached})),
      off:toggled.map(p=>({x:p.x,y:p.y})),preserved,
      defaults:{brightness:state.lamps.brightness,radius:state.lamps.radius,radiusMultiplier:state.lamps.radiusMultiplier},
      controls:{brightness:document.getElementById('lampBrightness')?.defaultValue,
                radius:document.getElementById('lampRadius')?.defaultValue,
                multiplier:document.getElementById('lampRadiusMultiplier')?.defaultValue}};
  })()`,{timeoutMs:15000,label:'per-rail rounded morph lamp fractions'});
  assert(r.samples.length===14,'missing arc samples');
  assert(r.samples.every(x=>x.attached&&x.visualIndex===1-x.semanticIndex&&x.error<1e-6&&Math.abs(x.f-x.expectedF)<1e-8),'wrong rail or non-phase-based location: '+JSON.stringify(r.samples));
  assert(r.falls[0].pathIndex===1&&r.falls[1].pathIndex===0,'fallback moved a lamp to the wrong contour: '+JSON.stringify(r.falls));
  assert(r.falls[0].y<0&&r.falls[1].y>0,'fallback snapped to nearby wrong line: '+JSON.stringify(r.falls));
  assert(r.off[0].x===10&&r.off[0].y===100,'disabled checkbox must not alter lamp anchors');
  assert(r.preserved.brightness===42&&r.preserved.radius===17&&r.preserved.radiusMultiplier===3,'saved project settings were overwritten');
  assert(r.defaults.brightness===100&&r.defaults.radius===30&&r.defaults.radiusMultiplier===2,'new project defaults missing: '+JSON.stringify(r.defaults));
  assert(Number(r.controls.brightness)===100&&Number(r.controls.radius)===30&&Number(r.controls.multiplier)===2,'DOM controls have wrong defaults: '+JSON.stringify(r.controls));
  assert(!uncaughtExceptions(h.events).slice(baseline).length,'uncaught errors in browser');
  console.log('PASS Somata 13.0.2: defaults 100 / 30×2; independent rounded rails; exact morph-phase fractions; saved values retained',JSON.stringify({samples:r.samples.length,maxError:Math.max(...r.samples.map(p=>p.error)),falls:r.falls,defaults:r.defaults}));
 }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 13.0.2 lamp regression',e.stack||e.message);process.exit(1);});
