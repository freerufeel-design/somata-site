const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:20000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const oldActive=renderRuntime.active,oldNow=renderRuntime.now,oldMorphActive=runtimeState.morph.active,oldMode=state.morph.mode;
      const layer=state.layers[0]||createLayer('lamp-spline-regression');state.layers.splice(0,state.layers.length,layer);state.activeLayerId=layer.id;
      Object.assign(layer,{visible:true,lineVisible:true,profileMode:'spline',showLamps:true});
      const cfg=ensureLayerLampState(layer);Object.assign(cfg,{positionMode:'key',morphMotionMode:'linear',snapToContour:true,snapToPolygon:true,stickToRounding:true,cornerInertiaLinked:false,cornerInertiaSec:1});
      runtimeState.morph.active=true;state.morph.mode='topology';renderRuntime.active=true;renderRuntime.now=1000;lampMotionRuntime.profileAttach.clear();lampMotionRuntime.blueMorph.clear();lampMotionRuntime.corners.clear();

      // A visible profile with two spatially-near branches that are far apart in arc length.
      const path={points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100},{x:0,y:2},{x:100,y:2}],closed:false};
      const profile=[path];Object.defineProperty(profile,'__somataFrameContour',{value:true,configurable:true});
      const layerKey=String(layer.id);
      const dist=(a,b)=>Math.hypot((a?.x||0)-(b?.x||0),(a?.y||0)-(b?.y||0));

      // Published topology arc fractions must win over nearest-point branch selection.
      const direct=[];
      for(let i=0;i<=8;i++){
        const f=.08+i*.095;renderRuntime.now+=16;
        const input={x:50,y:1.9,pathIndex:0,vertexIndex:0,lampId:'blue:direct',lampAttachFraction:f};
        const out=withLampConfig(cfg,()=>projectLampPointsToCurrentPolygon([input],profile,layer,true))[0];
        const expected=lampPointAtFraction(path,f);direct.push({f,outF:out?.lampContourFraction,error:dist(out,expected),attached:out?.__lampVisualProfileAttached===true});
      }

      // Without a published fraction, a tiny spatial move toward the other nearby branch
      // must not teleport a stable lamp to a remote arc location in one frame.
      lampMotionRuntime.profileAttach.clear();renderRuntime.now=2000;
      const a=withLampConfig(cfg,()=>projectLampPointsToCurrentPolygon([{x:50,y:.05,pathIndex:0,vertexIndex:1,lampId:'blue:fallback'}],profile,layer,true))[0];
      renderRuntime.now+=16;
      const b=withLampConfig(cfg,()=>projectLampPointsToCurrentPolygon([{x:50,y:1.95,pathIndex:0,vertexIndex:1,lampId:'blue:fallback'}],profile,layer,true))[0];
      const arcJump=Math.abs(Number(b?.lampContourFraction)-Number(a?.lampContourFraction));

      // Corner mode is exclusive: no key-point population is merged into it.
      const cornerPath={points:[{x:-100,y:0},{x:0,y:90},{x:100,y:0}],closed:false,cornerFlags:[false,true,false],lampCornerFlags:[false,true,false]};
      cfg.positionMode='corners';cfg.snapToContour=false;cfg.snapToPolygon=false;cfg.stickToRounding=false;cfg.cornerInertiaSec=0;
      runtimeState.morph.active=false;renderRuntime.now=3000;lampMotionRuntime.corners.clear();
      const expectedStatic=withLampConfig(cfg,()=>collectSmoothCornerLampPoints(0,[cornerPath],20,false));
      lampMotionRuntime.corners.clear();
      const staticCorners=withLampConfig(cfg,()=>collectStaticLampPoints(layer,{paths:[cornerPath]},20));

      runtimeState.morph.active=true;state.morph.mode='topology';renderRuntime.now=3100;lampMotionRuntime.corners.clear();lampMotionRuntime.blueMorph.clear();
      const expectedMorph=withLampConfig(cfg,()=>collectSmoothCornerLampPoints(0,[cornerPath],20,true));
      lampMotionRuntime.corners.clear();lampMotionRuntime.blueMorph.clear();
      const morphCorners=withLampConfig(cfg,()=>collectMorphLampPoints(0,.5,20,[cornerPath],null));

      // Corner inertia is a Morph-only brightness attack to full level.
      cfg.cornerInertiaSec=1;runtimeState.morph.active=true;renderRuntime.now=4000;lampMotionRuntime.corners.clear();
      const l0=withLampConfig(cfg,()=>collectSmoothCornerLampPoints(0,[cornerPath],20,true));
      renderRuntime.now=4250;const l25=withLampConfig(cfg,()=>collectSmoothCornerLampPoints(0,[cornerPath],20,true));
      renderRuntime.now=5000;const l100=withLampConfig(cfg,()=>collectSmoothCornerLampPoints(0,[cornerPath],20,true));
      runtimeState.morph.active=false;renderRuntime.now=6000;lampMotionRuntime.corners.clear();
      const ls=withLampConfig(cfg,()=>collectSmoothCornerLampPoints(0,[cornerPath],20,false));

      renderRuntime.active=oldActive;renderRuntime.now=oldNow;runtimeState.morph.active=oldMorphActive;state.morph.mode=oldMode;
      return {direct,arcJump,staticCount:staticCorners.length,expectedStaticCount:expectedStatic.length,morphCount:morphCorners.length,expectedMorphCount:expectedMorph.length,
        morphIds:morphCorners.map(p=>p.lampId),l0:l0.map(p=>p.lampLevel),l25:l25.map(p=>p.lampLevel),l100:l100.map(p=>p.lampLevel),ls:ls.map(p=>p.lampLevel)};
    })()`,{timeoutMs:14000,label:'topology lamp spline motion + corner semantics'});

    assert(r.direct.length===9,'missing direct arc samples');
    assert(r.direct.every(x=>x.attached&&x.error<1e-6),`topology lamp did not follow published spline fraction: ${JSON.stringify(r.direct)}`);
    assert(r.arcJump<0.08,`fallback attachment teleported along the profile arc: ${r.arcJump}`);
    assert(r.staticCount===r.expectedStaticCount&&r.staticCount>0,`static corner mode still merges key lamps: ${JSON.stringify(r)}`);
    assert(r.morphCount===r.expectedMorphCount&&r.morphCount>0,`Morph corner mode still merges key lamps: ${JSON.stringify(r)}`);
    assert(r.l0.length===0,'new Morph corner should start dark at inertia t=0');
    assert(r.l25.length>0&&r.l25.every(v=>v>.20&&v<.30),`corner inertia did not reach ~25% after 0.25s: ${JSON.stringify(r.l25)}`);
    assert(r.l100.length>0&&r.l100.every(v=>v>.99),`corner inertia did not reach full brightness after 1s: ${JSON.stringify(r.l100)}`);
    assert(r.ls.length>0&&r.ls.every(v=>v>.999),`static corner incorrectly used Morph inertia: ${JSON.stringify(r.ls)}`);
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(!exc.length,'uncaught browser errors: '+JSON.stringify(exc));
    console.log('PASS topology lamps move on spline; corner mode is exclusive; Morph corner inertia works',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL topology lamp spline/corner regression:',e.stack||e.message);process.exit(1)});
