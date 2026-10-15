const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const root=path.join(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
(async()=>{
  // 7.5 visual kernels remain reference-identical. Orchestration passes are intentionally
  // modular in 7.7.x, so their whole-file hashes must NOT be used as a visual contract.
  const referenceHashes={
    'js/render/web-morph-bridge.js':'fbea9f235b45babf46b2d69f92965cc902918ad65e156d6022f5e819e72d3970'
  };
  for(const [file,expected] of Object.entries(referenceHashes))assert(sha(file)===expected,`${file} drifted from the 7.5 visual kernel`);
  // 7.8.1 intentionally changes ONLY Web GPU buffer lifetime. Compare the visual shader
  // and encode bodies to the 7.5 reference instead of whole-file hashing allocator code.
  const webRendererSource=read('js/gpu/web-thread-scene-renderer.js');
  const between=(a,b)=>{const i=webRendererSource.indexOf(a),j=webRendererSource.indexOf(b,i+a.length);assert(i>=0&&j>i,`missing Web visual region ${a}`);return webRendererSource.slice(i,j);};
  const webVisualKernel=[between('const THREAD_WGSL=`','const MASK_WGSL=`'),between('const MASK_WGSL=`','const COMPOSITE_WGSL=`'),between('const COMPOSITE_WGSL=`','let uniformBuffer='),between('function encodeToLayerScene','function sameWebCorridorUniform'),between('function encodeCorridorToLayerScene','function status')].join('\n--PART--\n');
  const webVisualHash=crypto.createHash('sha256').update(webVisualKernel).digest('hex');
  assert(webVisualHash==='689ee0d50e962db26962d6a52d5769d9956a9d5f09b5f1dcf02e83e5e128f3a9','js/gpu/web-thread-scene-renderer.js visual shader/encode kernel drifted from 7.5');
  const webPass=read('js/render/web-pass.js'),sweepPass=read('js/render/sweep-pass.js'),webMorph=read('js/gpu/web-morph-renderer.js');
  assert(webPass.includes('WebGPUWebThreadSceneRenderer')&&webPass.includes('WebGPUWebMorphRenderer'),'modular Web pass is disconnected from 7.5 render kernels');
  assert(webPass.includes('SomataLayerSceneService'),'Web orchestration bypasses the modular scene boundary');
  assert(sweepPass.includes('WebGPULightningArcRenderer'),'modular Sweep/Lightning pass is disconnected from exact Lightning renderer');
  assert(webMorph.includes("prepared?.gpuMorphWebNative===true")&&webMorph.includes('encodeGpuWebCornerResource'),'7.5 GPU Morph Web corner/thread path missing');
  assert(webMorph.includes('corner.generation===gen')&&webMorph.includes('arc.generation===gen'),'Web generation safety missing from 7.5 renderer path');

  const lamp=read('js/app/lamp-audio-core.js');
  assert(lamp.includes("const collectWebCorners=(source)=>(data.placementMode==='corners'||cfg.style==='spiderSun')?getPersistentWebKinkCorners(source,threshold,8):getPersistentWebCorners(source,threshold,8);"),'7.5 Web corner collector semantics missing');
  assert(lamp.includes('buildCurrentWebCornerTopologyPaths(frameCtx,layer,mt)'),'Spiral Web corners do not follow the current Morph key topology');
  assert(!lamp.includes('morphT<.5?runtimeState.morph.renderSourceLayers'),'Web corners still snap between Morph endpoints');
  const lightning=read('js/gpu/lightning-arc-renderer.js');
  assert(lightning.includes('const EXACT_BEZIER_RASTER_SUBDIV=4;'),'7.5 exact Lightning Bezier raster missing');
  assert(lightning.includes('drawAnalyticGroup(haloStyles,false)'),'7.5 analytic Lightning halo path missing');
  assert(lightning.includes("reason:'stale-gpu-generation'")||lightning.includes("reason:'stale-gpu-generation'"),'device-generation safety was lost while restoring Lightning');

  const arc=read('js/gpu/morph-arc-resource.js');
  assert(arc.includes("spiralMorphUsesCircleRebuild==='function'&&spiralMorphUsesCircleRebuild()"),'7.5 Spiral circle-rebuild authority rule missing');
  const strictStart=arc.indexOf('if(strictSpiralMorphRail){'),strictEnd=arc.indexOf('if(hasSpiralEndpoint&&!spiralGeometryRequested',strictStart);
  assert(strictStart>=0&&strictEnd>strictStart,'strict Spiral authority block not found');
  const strictBlock=arc.slice(strictStart,strictEnd);
  assert(!/const\s+shared\s*=|return\s+shared/.test(strictBlock),'strict Spiral effects can still fall back to generic shared morph rail');
  const blueStart=arc.indexOf('if(blueOwnsFrame){'),blueEnd=arc.indexOf('const layer=frameCtx.layer',blueStart);
  assert(blueStart>=0&&blueEnd>blueStart,'blue-owned authority block not found');
  assert(!/const\s+shared\s*=|return\s+shared/.test(arc.slice(blueStart,blueEnd)),'blue-owned Spiral frame can still use generic shared rail');

  // Runtime proof: if the exact Spiral rail is absent, generic shared geometry must NOT be used.
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:280,evalTimeoutMs:12000});
  const base=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const old={layers:state.layers,active:state.activeLayerId,mode:state.morph.mode,options:state.morph.options,rtActive:runtimeState.morph.active,src:runtimeState.morph.renderSourceLayers,dst:runtimeState.morph.renderTargetLayers,get:WebGPUSpiralBezierMorphRenderer.getResource,warm:WebGPUSpiralBezierMorphRenderer.warmup,shared:window.getSharedGpuMorphPathResource};
      try{
        const a=createLayer('authority-a'),b=createLayer('authority-b');a.spiralEnabled=b.spiralEnabled=true;a.spiralClosed=b.spiralClosed=true;
        state.layers=[a];state.activeLayerId=a.id;state.morph.mode='circleSlide';state.morph.options={...(state.morph.options||{}),byVertices:true};runtimeState.morph.active=true;runtimeState.morph.renderSourceLayers=[a];runtimeState.morph.renderTargetLayers=[b];
        const shared={ready:true,id:'shared'};window.getSharedGpuMorphPathResource=()=>shared;WebGPUSpiralBezierMorphRenderer.warmup=()=>true;WebGPUSpiralBezierMorphRenderer.getResource=()=>null;
        const strictMiss=currentGpuBezierMorphResource(0);
        const provider={mode:'circleSlide'},frame={layer:a,layerIndex:0,morphFrameActive:true,greenMorphEnabled:false,minimalFadeEnabled:false,blueMorphProvider:provider,geometryProvider:provider,geometryPlan:{kind:'blue-prepared'}};
        const frameMiss=currentGpuBezierResourceForFrame(frame);
        const exact={ready:true,bezierVisualRail:true,specialSpiralBezierRail:true,id:'exact'};WebGPUSpiralBezierMorphRenderer.getResource=()=>exact;
        const strictHit=currentGpuBezierMorphResource(0),frameHit=currentGpuBezierResourceForFrame(frame);
        return{strictMiss:strictMiss?.id||null,frameMiss:frameMiss?.id||null,strictHit:strictHit?.id||null,frameHit:frameHit?.id||null};
      }finally{state.layers=old.layers;state.activeLayerId=old.active;state.morph.mode=old.mode;state.morph.options=old.options;runtimeState.morph.active=old.rtActive;runtimeState.morph.renderSourceLayers=old.src;runtimeState.morph.renderTargetLayers=old.dst;WebGPUSpiralBezierMorphRenderer.getResource=old.get;WebGPUSpiralBezierMorphRenderer.warmup=old.warm;window.getSharedGpuMorphPathResource=old.shared;}
    })()`,{timeoutMs:10000,label:'7.7 Web/Lightning exact Spiral authority'});
    assert(out.strictMiss===null,`strict Spiral used ${out.strictMiss} instead of waiting for exact rail`);
    assert(out.frameMiss===null,`blue-owned Spiral used ${out.frameMiss} instead of waiting for exact rail`);
    assert(out.strictHit==='exact'&&out.frameHit==='exact','exact Spiral rail was not selected when ready');
    const exc=uncaughtExceptions(h.events).slice(base);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.7 WEB/LIGHTNING REFERENCE AUTHORITY: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('FAIL 7.7 Web/Lightning reference authority:',e.stack||e.message);process.exit(1)});
