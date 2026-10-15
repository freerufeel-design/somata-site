const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};

async function main(){
  const mainSrc=fs.readFileSync(path.join(__dirname,'../js/render/main-pipeline.js'),'utf8');
  const roleSrc=fs.readFileSync(path.join(__dirname,'../js/render/geometry-scene-routing.js'),'utf8');
  const fillSrc=fs.readFileSync(path.join(__dirname,'../js/render/fill-pass.js'),'utf8');
  const spiralAdapterSrc=fs.readFileSync(path.join(__dirname,'../js/render/spiral-fill-adapter.js'),'utf8');
  assert(roleSrc.includes("getLayerGeometryContract(frameCtx)?.fillRequested===true"),'fill-only retained Spiral does not request a Layer Scene root');
  assert(!fillSrc.includes("if(!glowRequested||contract?.fillRequested!==true)"),'Fill preflight is still incorrectly gated by Glow');
  assert(spiralAdapterSrc.includes("fillWithoutGlow:true"),'Fill-without-Glow policy flag missing from Spiral adapter');
  assert(mainSrc.includes('runRegisteredStage(SomataRenderPassRegistry.STAGES.FILL)'),'orchestrator no longer executes Fill stage');
  assert(fillSrc.includes("register?.('fill'"),'Fill module is not registered into Fill stage');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:10000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const originals={
        contract:getLayerGeometryContract,
        canRole:SomataGeometryRoleService.canRenderRole,
        eligible:WebGPUSpiralBezierMorphRenderer.isEligible,
        available:FillGPURenderer.isAvailable,
        canEncode:FillGPURenderer.canEncodeMeshToTexture,
        encode:FillGPURenderer.encodeMeshCommandToTexture,
        resident:WebGPUStrokeRenderer.getDeferredLayerSceneTexture,
        target:WebGPUStrokeRenderer.getExternalLayerSceneTarget,
        canUse:WebGPUStrokeRenderer.canUseExternalLayerScene,
        begin:WebGPUStrokeRenderer.beginExternalLayerScene,
        defer:WebGPUStrokeRenderer.deferExternalLayerScene,
        aux:getGpuSpiralBezierMorphAuxPaths,
        morphMesh:FillMeshPreparer.prepareSpiralMorphBands
      };
      let deferred=null,result=null,rootDemand=false;
      try{
        getLayerGeometryContract=()=>({fillRequested:true,nativeGpuFillEligible:true});
        SomataGeometryRoleService.canRenderRole=()=>true;
        WebGPUSpiralBezierMorphRenderer.isEligible=(ctx,mode)=>mode==='base';
        FillGPURenderer.isAvailable=()=>true;
        FillGPURenderer.canEncodeMeshToTexture=()=>true;
        FillGPURenderer.encodeMeshCommandToTexture=()=>({handled:true,commandBuffer:{id:'fill-only-morph'},triangles:7});
        WebGPUStrokeRenderer.getDeferredLayerSceneTexture=()=>deferred;
        WebGPUStrokeRenderer.getExternalLayerSceneTarget=()=>({texture:{id:'fill-only-scene'}});
        WebGPUStrokeRenderer.canUseExternalLayerScene=()=>true;
        WebGPUStrokeRenderer.beginExternalLayerScene=(id,label)=>{deferred={texture:{id:'fill-only-scene'},frameId:id,label};return true;};
        WebGPUStrokeRenderer.deferExternalLayerScene=(cmd,id,label)=>{deferred={texture:{id:'fill-only-scene'},commandBuffer:cmd,frameId:id,label};return true;};
        getGpuSpiralBezierMorphAuxPaths=()=>[{points:[{x:0,y:0},{x:1,y:0}]},{points:[{x:0,y:1},{x:1,y:1}]}];
        FillMeshPreparer.prepareSpiralMorphBands=()=>({nativeComplete:true,complete:true,fanTriangleCount:7});
        const frameCtx={
          effectsPlan:{glow:{enabled:false},outline:{enabled:false},profile:{enabled:false},motion:{enabled:false},sweep:{enabled:false},sprite:{enabled:false},web:{enabled:false},lamps:{enabled:false}},
          _spiralBezierMorphGpuNative:true,
          geometryPlan:{kind:'blue-topology',dynamic:true},
          frame:{},
          frameId:711,
          layerIndex:0,
          layer:{spiralEnabled:true,spiralClosed:true}
        };
        rootDemand=spiralGpuEffectsRequested(frameCtx);
        result=SomataFillGeometryAdapter.query('retainedScene',frameCtx,{glowRequested:false});
        result={...result,deferred,baseFillCommitted:frameCtx._baseFillCommitted===true,fillScenePrepared:frameCtx._spiralFillScenePrepared===true,glowScenePrepared:frameCtx._spiralFillGlowScenePrepared===true};
      }finally{
        getLayerGeometryContract=originals.contract;
        SomataGeometryRoleService.canRenderRole=originals.canRole;
        WebGPUSpiralBezierMorphRenderer.isEligible=originals.eligible;
        FillGPURenderer.isAvailable=originals.available;
        FillGPURenderer.canEncodeMeshToTexture=originals.canEncode;
        FillGPURenderer.encodeMeshCommandToTexture=originals.encode;
        WebGPUStrokeRenderer.getDeferredLayerSceneTexture=originals.resident;
        WebGPUStrokeRenderer.getExternalLayerSceneTarget=originals.target;
        WebGPUStrokeRenderer.canUseExternalLayerScene=originals.canUse;
        WebGPUStrokeRenderer.beginExternalLayerScene=originals.begin;
        WebGPUStrokeRenderer.deferExternalLayerScene=originals.defer;
        getGpuSpiralBezierMorphAuxPaths=originals.aux;
        FillMeshPreparer.prepareSpiralMorphBands=originals.morphMesh;
      }
      return{rootDemand,result,policy:__somataSpiralFillGlowPolicy?.()};
    })()`,{timeoutMs:8000,label:'7.6.11 Morph Fill without Corridor'});

    assert(out.rootDemand===true,'fill-only Spiral Morph does not demand a GPU Layer Scene root');
    assert(out.result?.handled===true&&out.result?.required===true,'fill-only Spiral Morph did not seed native Fill');
    assert(out.result?.deferred?.label==='retained-native-fill','fill-only Spiral Morph used the wrong scene root');
    assert(out.result?.baseFillCommitted===true&&out.result?.fillScenePrepared===true,'fill-only Spiral Morph was not marked committed');
    assert(out.policy?.fillWithoutGlow===true,'policy does not permit Fill without Glow');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('MORPH FILL WITHOUT CORRIDOR REGRESSION: PASS — ordered Fill seeds retained Spiral scene even with Glow OFF and Corridor OFF');
  }finally{await h.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1);});
