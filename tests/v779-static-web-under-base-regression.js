const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const fs=require('fs');
const path=require('path');
const assert=(c,m)=>{if(!c)throw new Error(m);};
async function main(){
  // Regression C: preserveExistingScene is not fulfilled by loadOp:'load' alone.
  // The full-screen Layer Scene composite writes transparent pixels everywhere outside
  // Fill/Glow/Base. Without source-over blending those transparent pixels replace the
  // resident Web texture, so static Web disappears as soon as Base is appended.
  const gpuCore=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
  const layerScenePipeline=/layerScenePipeline=device\.createRenderPipeline\(\{label:'SpiroStar layer scene pipeline',[\s\S]{0,420}?targets:\[\{format,blend:blendState\('over'\)\}\]/.test(gpuCore);
  assert(layerScenePipeline,'Layer Scene composite still replaces resident Web instead of alpha-compositing over it');
  const over=(src,dst)=>({a:src.a+dst.a*(1-src.a)});
  const residentWeb={a:.8},transparentBatch={a:0};
  assert(Math.abs(over(transparentBatch,residentWeb).a-.8)<1e-9,'transparent Base pixel must preserve resident Web alpha');
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:10000,loadDelayMs:80});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      // Regression A: 7.7.7 feature isolation must not hide the static Fill preparation
      // from Base. Static Web + normal Fill uses an authoritative mask in the same
      // Layer Scene. If Base sees this as undefined, it forces an out-of-scene Fill
      // split and the resident Web underlay can disappear while Morph still works.
      const featureCtx={
        prepared:true,layer:{id:'static-web-fill'},layerIndex:0,frame:{dpr:1},frameId:1,
        effectsPlan:{motion:{},sprite:{}},
        _geometryContract:{fillRequested:true,fillStyle:'#00ffcc08'},
        _webgpuStrokeBatch:{fillInScene:true,nativeFillInScene:false,sceneCombined:true,preserveExistingScene:true},
        _webgpuFillPrepared:{authoritative:true,mask:{kind:'static-fill-mask'},fillStyle:'#00ffcc08'},
        _nativeFillMeshCandidate:{kind:'candidate'},_corridorNativeFillPreflight:{kind:'preflight'},_fillMeshShadow:{kind:'shadow'}
      };
      let fillBoundary=null;
      SomataFeatureHost.run('base',featureCtx,child=>{
        const p=SomataFillPassService.begin(child,child._webgpuStrokeBatch,false,false);
        fillBoundary={
          fillVisible:child._webgpuFillPrepared?.authoritative===true,
          nativeVisible:child._nativeFillMeshCandidate?.kind==='candidate',
          preflightVisible:child._corridorNativeFillPreflight?.kind==='preflight',
          shadowVisible:child._fillMeshShadow?.kind==='shadow',
          sceneHasAuthoritativeFill:p.sceneHasAuthoritativeFill===true,
          needsOutOfSceneFill:p.needsOutOfSceneFill===true
        };
        return {ok:true};
      });

      // Regression B: once Web does have to materialize before a non-resident Base
      // backend, rebuild through the current stroke service (not the deleted 7.5 symbol).
      const old={
        getResidentGpuLayerScene,canDeferLayerSceneForFrame,canUseGpuOnlyCorridorLayerScene,
        canUseGpuSpiralBezierLayerScene,materializeDeferredLayerScene,
        prepare:SomataStrokeBatchService.prepare
      };
      let prepares=0,stack=null;
      try{
        getResidentGpuLayerScene=()=>({texture:{}});
        canDeferLayerSceneForFrame=()=>false;
        canUseGpuOnlyCorridorLayerScene=()=>false;
        canUseGpuSpiralBezierLayerScene=()=>false;
        materializeDeferredLayerScene=()=>true;
        SomataStrokeBatchService.prepare=(ctx)=>{prepares++;ctx._webgpuStrokeBatch={sceneCombined:false,rebuilt:true};return ctx._webgpuStrokeBatch;};
        const ctx={
          _webPassHandled:true,
          _webgpuStrokeBatch:{sceneCombined:false},
          lineProfileStrokeOnly:false,lineProfileApplication:'stroke',
          frame:{gpuMainCanvasHasContent:false,gpuLayerSceneDeferred:true},frameId:1
        };
        const result=stabilizeWebUnderBaseStack(ctx);
        stack={result,prepares,materialized:ctx._webMaterializedUnderBase===true,mainHasContent:ctx.frame.gpuMainCanvasHasContent===true,rebuilt:ctx._webgpuStrokeBatch?.rebuilt===true};
      } finally {
        getResidentGpuLayerScene=old.getResidentGpuLayerScene;
        canDeferLayerSceneForFrame=old.canDeferLayerSceneForFrame;
        canUseGpuOnlyCorridorLayerScene=old.canUseGpuOnlyCorridorLayerScene;
        canUseGpuSpiralBezierLayerScene=old.canUseGpuSpiralBezierLayerScene;
        materializeDeferredLayerScene=old.materializeDeferredLayerScene;
        SomataStrokeBatchService.prepare=old.prepare;
      }
      const baseSpec=__somataFeatureHostStatus().features.find(x=>x.name==='base');
      return{fillBoundary,stack,baseReads:baseSpec?.reads||[]};
    })()`);

    assert(r.fillBoundary.fillVisible,'Base feature isolation hid _webgpuFillPrepared in static Web + Fill');
    assert(r.fillBoundary.nativeVisible&&r.fillBoundary.preflightVisible&&r.fillBoundary.shadowVisible,'Base lost Fill geometry scratch state across the feature boundary');
    assert(r.fillBoundary.sceneHasAuthoritativeFill,'Base misclassified authoritative static Fill as out-of-scene');
    assert(!r.fillBoundary.needsOutOfSceneFill,'static Web + Fill would split the resident Layer Scene and can erase Web');

    assert(r.stack.materialized,'static Web fallback did not materialize the Web underlay');
    assert(r.stack.mainHasContent,'static Web fallback did not mark main canvas content');
    assert(r.stack.prepares===1,'stroke batch was not rebuilt exactly once after Web materialization');
    assert(r.stack.rebuilt,'rebuilt stroke batch was not retained on frame context');
    assert(r.stack.result===false,'fallback must continue through the non-resident Base path');

    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('STATIC WEB + FILL FEATURE-BOUNDARY REGRESSION: PASS',r);
  } finally { await h.close(); }
}
main().catch(e=>{console.error('FAIL static Web under Base regression:',e.stack||e.message);process.exit(1)});
