const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};

async function main(){
  const main=fs.readFileSync(path.join(__dirname,'../js/render/main-pipeline.js'),'utf8');
  const glow=fs.readFileSync(path.join(__dirname,'../js/render/glow-pass.js'),'utf8');
  const fill=fs.readFileSync(path.join(__dirname,'../js/render/fill-pass.js'),'utf8');
  const roles=fs.readFileSync(path.join(__dirname,'../js/render/spiral-role-adapter.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../js/render/geometry-scene-routing.js'),'utf8');
  const spiralAdapter=fs.readFileSync(path.join(__dirname,'../js/render/spiral-fill-adapter.js'),'utf8');
  const render=main+'\n'+glow+'\n'+roles;
  const core=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');

  assert(main.includes('runRegisteredStage(SomataRenderPassRegistry.STAGES.FILL)'),'missing registered Fill stage');
  assert(main.includes('runRegisteredStage(SomataRenderPassRegistry.STAGES.GLOW)'),'missing registered Glow stage');
  assert(main.indexOf('STAGES.FILL')<main.indexOf('STAGES.GLOW'),'Fill stage is not executed before Glow stage');
  assert(fill.includes("register?.('fill'"),'Fill pass is not self-registered');
  assert(glow.includes("register?.('glow'"),'Glow pass is not self-registered');
  assert(spiralAdapter.includes("SomataLayerSceneService.queue(frameCtx,somataEffectPhase('fill'),rec.commandBuffer,'retained-native-fill')"),'resident retained Fill is not scheduled from the central effect stack');
  assert(spiralAdapter.includes("SomataLayerSceneService.ensure(frameCtx,'retained-native-fill')"),'retained Fill cannot request an ordered Layer Scene through the scene service');
  assert(spiralAdapter.includes('frameCtx._baseFillCommitted=true;')&&spiralAdapter.includes('frameCtx._spiralFillGlowScenePrepared=true;'),'pre-Glow Fill is not committed/marked');
  assert(glow.includes("somataEffectPhase('geometry',10)"),'retained Spiral Glow is not scheduled from the Geometry group');
  assert(roles.includes("somataEffectPhase('geometry',20)"),'retained Spiral Base is not scheduled from the Geometry group');
  assert(roles.includes("if(contract?.fillRequested===true&&!resident?.texture)return false;"),'retained Spiral route no longer explicitly requires a resident scene for Fill');

  const iFill=core.indexOf('textureSample(nativeFillTex,sceneSampler,v.uv)');
  const iGlow=core.indexOf('textureSample(glowTex,sceneSampler,v.uv)');
  const iBase=core.indexOf('textureSample(baseTex,sceneSampler,v.uv)');
  assert(iFill>=0&&iGlow>iFill&&iBase>iGlow,'Layer Scene shader order is not Fill -> Glow -> Base');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:340,evalTimeoutMs:10000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const layer=createLayer('glow-fill-contract');ensureLayerEffectState(layer);
      layer.glow=18;layer.glowMultiplier=1;layer.glowIntensity=100;layer.glowIntensityMultiplier=1;layer.fill=true;layer.fillColor='rgba(70,120,220,.45)';
      const mk=()=>({layer,effectLayer:layer,frame:{dpr:1},baseAlpha:1,minimalFadeEnabled:false,lineDisplayEnabled:true,glow:18,layerIndex:0,geometryPlan:{kind:'blue-topology',dynamic:true}});
      const a={};resolveLayerGlowEffectProvider(mk(),a);
      layer.fill=false;const b={};resolveLayerGlowEffectProvider(mk(),b);
      const policy=__somataSpiralFillGlowPolicy?.();
      const originals={contract:getLayerGeometryContract,canRole:SomataGeometryRoleService.canRenderRole,eligible:WebGPUSpiralBezierMorphRenderer.isEligible,available:FillGPURenderer.isAvailable,canEncode:FillGPURenderer.canEncodeMeshToTexture,encode:FillGPURenderer.encodeMeshCommandToTexture,resident:WebGPUStrokeRenderer.getDeferredLayerSceneTexture,target:WebGPUStrokeRenderer.getExternalLayerSceneTarget,canUse:WebGPUStrokeRenderer.canUseExternalLayerScene,begin:WebGPUStrokeRenderer.beginExternalLayerScene,defer:WebGPUStrokeRenderer.deferExternalLayerScene};
      let deferred=null,mocked=null;
      try{
        getLayerGeometryContract=()=>({fillRequested:true,nativeGpuFillEligible:true});
        SomataGeometryRoleService.canRenderRole=()=>true;WebGPUSpiralBezierMorphRenderer.isEligible=()=>true;
        FillGPURenderer.isAvailable=()=>true;FillGPURenderer.canEncodeMeshToTexture=()=>true;FillGPURenderer.encodeMeshCommandToTexture=()=>({handled:true,commandBuffer:{id:'fill-cmd'},triangles:3});
        WebGPUStrokeRenderer.getDeferredLayerSceneTexture=()=>deferred;WebGPUStrokeRenderer.getExternalLayerSceneTarget=()=>({texture:{id:'scene'}});WebGPUStrokeRenderer.canUseExternalLayerScene=()=>true;WebGPUStrokeRenderer.beginExternalLayerScene=(id,label)=>{deferred={texture:{id:'scene'},frameId:id,label};return true;};WebGPUStrokeRenderer.deferExternalLayerScene=(cmd,id,label)=>{deferred={texture:{id:'scene'},commandBuffer:cmd,frameId:id,label};return true;};
        const spiral={spiralEnabled:true,spiralClosed:true};const f={layer:spiral,effectLayer:spiral,effectsPlan:{glow:{enabled:true}},_spiralBezierMorphGpuNative:true,geometryPlan:{dynamic:false},_nativeFillMeshCandidate:{nativeComplete:true,fanTriangleCount:3},frame:{},frameId:99,layerIndex:0};
        mocked={result:SomataFillGeometryAdapter.query('retainedScene',f,{glowRequested:true}),deferred,committed:f._baseFillCommitted===true,prepared:f._spiralFillGlowScenePrepared===true};
      }finally{
        getLayerGeometryContract=originals.contract;SomataGeometryRoleService.canRenderRole=originals.canRole;WebGPUSpiralBezierMorphRenderer.isEligible=originals.eligible;FillGPURenderer.isAvailable=originals.available;FillGPURenderer.canEncodeMeshToTexture=originals.canEncode;FillGPURenderer.encodeMeshCommandToTexture=originals.encode;WebGPUStrokeRenderer.getDeferredLayerSceneTexture=originals.resident;WebGPUStrokeRenderer.getExternalLayerSceneTarget=originals.target;WebGPUStrokeRenderer.canUseExternalLayerScene=originals.canUse;WebGPUStrokeRenderer.beginExternalLayerScene=originals.begin;WebGPUStrokeRenderer.deferExternalLayerScene=originals.defer;
      }
      const stackPhases={fill:SomataEffectStackOrder.phase('fill'),glow:SomataEffectStackOrder.phase('geometry',10),base:SomataEffectStackOrder.phase('geometry',20)};
      return{withFill:{enabled:a.enabled,amount:a.amount,alpha:a.compositeAlpha},withoutFill:{enabled:b.enabled,amount:b.amount,alpha:b.compositeAlpha},policy,stackPhases,mocked};
    })()`,{timeoutMs:8000,label:'7.6.10 Glow x Fill coexistence'});
    assert(out.withFill.enabled===true,'Glow effect provider disables Glow when Fill is on');
    assert(out.withoutFill.enabled===true,'Glow baseline is unexpectedly disabled');
    assert(out.withFill.amount===out.withoutFill.amount&&Math.abs(out.withFill.alpha-out.withoutFill.alpha)<1e-9,'Fill changes Glow amount/alpha');
    assert(out.policy?.fillPhase===out.stackPhases?.fill&&out.policy?.glowPhase===out.stackPhases?.glow&&out.policy?.basePhase===out.stackPhases?.base,'shared Layer Scene phases do not follow the central effect stack');
    assert(out.policy?.scene==='shared-layer-scene','Fill and Glow do not advertise a shared Layer Scene');
    assert(out.mocked?.result?.handled===true&&out.mocked?.result?.deferred===true,'retained-Spiral Fill preflight did not seed the Layer Scene');
    assert(out.mocked?.deferred?.label==='retained-native-fill','retained-Spiral Fill preflight used the wrong Layer Scene root');
    assert(out.mocked?.committed===true&&out.mocked?.prepared===true,'pre-Glow Fill did not mark the frame as committed/prepared');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('GLOW + FILL COEXISTENCE REGRESSION: PASS — Glow remains enabled; retained Spiral follows Fill/Geometry effect-stack phases');
  }finally{await h.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1);});
