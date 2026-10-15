const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};

async function main(){
  const kernel=fs.readFileSync(path.join(__dirname,'../js/geometry/kernel.js'),'utf8');
  const adapter=fs.readFileSync(path.join(__dirname,'../js/render/fill-geometry-adapter.js'),'utf8');
  const fill=fs.readFileSync(path.join(__dirname,'../js/render/fill-pass.js'),'utf8');
  const gpuCore=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
  const routing=fs.readFileSync(path.join(__dirname,'../js/render/geometry-scene-routing.js'),'utf8');
  assert(kernel.includes('dynamicFrameNative=fillRequested&&dynamic&&!corridor&&!spiralEndpoint'), 'ordinary dynamic Morph Fill is not native-GPU eligible');
  assert(kernel.includes('dynamicSpiralNative=fillRequested&&dynamic&&!corridor&&spiralEndpoint'), 'retained Spiral dynamic Fill eligibility missing');
  assert(adapter.includes("SomataFillGeometryAdapter.register('line-carrier'"), 'shared Line-carrier Fill geometry adapter missing');
  assert(adapter.includes('SomataFrameContourService'), 'Fill does not consume the shared FrameContour');
  assert(adapter.includes('prepareFrameContour'), 'Static/Dynamic Fill do not share the FrameContour mesh preparer');
  assert(fill.includes("SomataFillGeometryAdapter.query('directMesh',frameCtx)"), 'Fill pass does not consume the shared dynamic mesh adapter');
  assert(fill.includes('getDynamicTunnelMorphMasterStrokeCommands?.(frameCtx,true)'), 'Corridor Fill cannot request the hidden Graffiti geometry carrier');
  assert(gpuCore.includes('getDynamicTunnelMorphMasterStrokeCommands(frameCtx,allowHiddenGraffitiCarrier=false)'), 'dynamic Corridor master has no hidden-carrier contract');
  assert(gpuCore.includes('(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiCarrier)'), 'dynamic Corridor master still rejects Graffiti unconditionally');
  assert(routing.includes('getDynamicTunnelMorphMasterStrokeCommands(frameCtx,allowHiddenGraffitiCarrier)'), 'Corridor scene routing drops the hidden-carrier flag');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:10000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const layer=createLayer('dynamic-fill-regression');
      Object.assign(layer,{fill:true,fillColor:'rgba(20,160,240,.55)',lineVisible:true,spiralEnabled:false});
      const commands=[{subpaths:[{closed:true,points:[{x:100,y:80},{x:260,y:90},{x:240,y:230},{x:110,y:220}]}]}];
      const frameCtx={
        layer,layerIndex:0,frameId:77908,frame:{id:77908,renderLayerCount:1},prepared:true,
        geometryPlan:{kind:'blue-circle-slide',dynamic:true},
        drawLayerInstances(){},combinedScale:1,combinedRotationRad:0,
        _geometryContract:{fillRequested:true,fillStyle:layer.fillColor,nativeGpuFillEligible:true,gpuMaskEligible:false,corridor:false,spiral:false,geometry:{hasClosedFillTopology:true,fillContourCount:1,closedPathCount:1,openPathCount:0}},
        visibleInstances:{copies:[{scale:1}],alphas:[1],fillAlphas:[1]},baseAlpha:1,
        lineProfileStrokeOnly:false,lineProfileApplication:'stroke'
      };
      const originalGetter=globalThis.getFrameGLStrokeCommands;let getterCalls=0,mesh=null;
      try{
        globalThis.getFrameGLStrokeCommands=(ctx,hidden)=>{getterCalls++;return commands;};
        mesh=SomataFillGeometryAdapter.query('directMesh',frameCtx);
      }finally{globalThis.getFrameGLStrokeCommands=originalGetter;}
      const originals={
        available:FillGPURenderer.isAvailable,
        canEncode:FillGPURenderer.canEncodeMeshToTexture,
        renderMesh:FillGPURenderer.renderMesh,
        strict:SomataGeometryRoleService.isStrict
      };
      let renderedMesh=null,attachment=null,direct=false;
      try{
        FillGPURenderer.isAvailable=()=>true;
        FillGPURenderer.canEncodeMeshToTexture=(ctx,m)=>m===mesh&&m?.nativeComplete===true;
        FillGPURenderer.renderMesh=(ctx,m)=>{renderedMesh=m;return m===mesh&&m?.nativeComplete===true;};
        SomataGeometryRoleService.isStrict=()=>false;
        attachment=SomataFillPassService.prepareBatchAttachment(frameCtx,false);
        direct=tryRenderLayerFillGPU(frameCtx);
      }finally{
        FillGPURenderer.isAvailable=originals.available;
        FillGPURenderer.canEncodeMeshToTexture=originals.canEncode;
        FillGPURenderer.renderMesh=originals.renderMesh;
        SomataGeometryRoleService.isStrict=originals.strict;
      }
      const prevTunnel=state.tunnel.active;state.tunnel.active=true;
      const corridorCtx={
        layer:{...layer,spiralEnabled:false},layerIndex:0,frameId:77909,frame:{id:77909},baseAlpha:1,
        geometryPlan:{kind:'blue-circle-slide',dynamic:true},lineProfileStrokeOnly:true,lineProfileApplication:'graffiti',
        tunnelBaseStrokeColor:'#ffffff',drawLayerGeometry(rec){rec.beginPath();rec.moveTo(100,100);rec.lineTo(240,100);rec.lineTo(240,220);rec.lineTo(100,220);rec.closePath();rec.stroke();}
      };
      let corridorMaster=null;try{corridorMaster=getDynamicTunnelMorphMasterStrokeCommands(corridorCtx,true);}finally{state.tunnel.active=prevTunnel;}
      return{
        mesh:mesh&&{nativeComplete:mesh.nativeComplete,triangles:mesh.fanTriangleCount,dynamic:mesh.dynamic,screen:mesh.dynamicScreenSpace,frameContour:mesh.frameContourFill===true},getterCalls,
        attachment:{nativeCandidate:attachment?.nativeCandidate===true,sceneNative:attachment?.sceneNativeFill===mesh,mask:attachment?.sceneFillMask||null},
        direct,renderedSame:renderedMesh===mesh,candidateSame:frameCtx._nativeFillMeshCandidate===mesh,
        corridorHiddenGraffiti:{commands:corridorMaster?.length||0,closed:corridorMaster?.reduce((n,c)=>n+(c.subpaths||[]).filter(p=>p.closed===true).length,0)||0}
      };
    })()`,{timeoutMs:8000,label:'7.7.9 dynamic Fill unified'});
    assert(out.mesh?.nativeComplete===true&&out.mesh?.triangles===4,'dynamic Fill mesh was not built from closed frame commands: '+JSON.stringify(out));
    assert(out.mesh?.dynamic===true&&out.mesh?.screen===true&&out.mesh?.frameContour===true,'dynamic Fill mesh lost shared FrameContour screen-space semantics');
    assert(out.getterCalls===1,'dynamic Fill rebuilt/queried the Line carrier more than once: '+JSON.stringify(out));
    assert(out.attachment?.nativeCandidate===true&&out.attachment?.sceneNative===true,'dynamic Fill was not attached to the same GPU Layer Scene batch');
    assert(out.attachment?.mask==null,'dynamic Fill incorrectly fell back to a Canvas mask');
    assert(out.direct===true&&out.renderedSame===true&&out.candidateSame===true,'direct dynamic Fill fallback did not use the exact same native mesh');
    assert(out.corridorHiddenGraffiti?.commands>0&&out.corridorHiddenGraffiti?.closed>0,'Graffiti replaced Base and accidentally removed the dynamic Corridor Fill carrier: '+JSON.stringify(out.corridorHiddenGraffiti));
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('DYNAMIC FILL UNIFIED REGRESSION: PASS — circleSlide/shared FrameContour -> native Fill mesh; Graffiti Corridor keeps hidden Fill carrier');
  }finally{await h.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1);});
