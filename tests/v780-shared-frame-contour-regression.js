const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const ROOT=path.resolve(__dirname,'..');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

(async()=>{
  const contour=read('js/geometry/frame-contour.js');
  const fillAdapter=read('js/render/fill-geometry-adapter.js');
  const batch=read('js/render/stroke-batch-service.js');
  const role=read('js/render/geometry-role-service.js');
  assert(contour.includes("authority='shared-line-command-topology'"),'7.8 FrameContour authority marker missing');
  assert(contour.includes('may join')||contour.includes('join'),'FrameContour does not connect separately-stroked sides');
  assert(fillAdapter.includes('prepareFrameContour'),'Fill still reconstructs ordinary topology independently');
  assert(batch.includes('sharedAuthority?null:SomataGeometryRoleService.nativeBaseKind'),'shared contour does not disable native topology/green Base bypass');
  assert(role.includes('shared-frame-contour-batch'),'visible Line does not prioritize shared FrameContour batch');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:12000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const oldGetter=window.getFrameGLStrokeCommands,oldTunnel=state.tunnel.active,oldTransform=mainCtx.getTransform();
      try{
        state.tunnel.active=false;mainCtx.setTransform(1,0,0,1,0,0);beginFrameGeometryRuntime();
        const layer=createLayer('v780-shared');layer.spiralEnabled=false;layer.fill=true;layer.fillColor='#00ff66';layer.showWeb=true;layer.strokeColor='#4080ff';layer.lineProfileApplication='stroke';
        // Four sides are deliberately four DIFFERENT stroke commands.  7.7.9 treated
        // these as four unrelated paths, which made Web/Fill invent another contour.
        const commands=[
          {alpha:1,strokeStyle:'#4080ff',subpaths:[{closed:false,points:[{x:10,y:10},{x:110,y:10}]}]},
          {alpha:1,strokeStyle:'#4080ff',subpaths:[{closed:false,points:[{x:110,y:10},{x:110,y:90}]}]},
          {alpha:1,strokeStyle:'#4080ff',subpaths:[{closed:false,points:[{x:110,y:90},{x:10,y:90}]}]},
          {alpha:1,strokeStyle:'#4080ff',subpaths:[{closed:false,points:[{x:10,y:90},{x:10,y:10}]}]}
        ];
        let seenVisible=null,calls=0;
        window.getFrameGLStrokeCommands=(ctx)=>{calls++;seenVisible=ctx.lineDisplayEnabled;ctx._glStrokeCommands=commands;ctx._glStrokeCommandFrameId=ctx.frameId;ctx._glStrokeCommandHiddenGraffitiCarrier=false;return commands;};
        const ctx={layer,effectLayer:layer,layerIndex:0,frameId:78001,frame:{id:78001,dpr:1,renderLayerCount:1},now:1000,drawLayerInstances:()=>{},combinedScale:1,combinedRotationRad:0,lineDisplayEnabled:false,lineProfileStrokeOnly:true,lineProfileApplication:'stroke',strokeWidth:2,geometryPlan:{kind:'blue-prepared',dynamic:true},profilePreparedReady:false,sweepPreparedReady:false,webPreparedReady:false};
        const rec=SomataFrameContourService.get(ctx);const mesh=SomataFillGeometryAdapter.query('directMesh',ctx);const web=prepareLayerFrameWebData(ctx);
        // Prove the *visible* ordinary Line cannot silently return to a native topology/green
        // carrier after Web/Fill have claimed FrameContour. The shared batch must receive the
        // exact same commands object and nativeBaseKind must not even be queried.
        const oldWarm=WebGPUStrokeRenderer.warmup,oldReady=WebGPUStrokeRenderer.isReady,oldBatch=WebGPUStrokeRenderer.renderLayerBatch,oldNative=SomataGeometryRoleService.nativeBaseKind;
        let batchCommands=null,nativeCalls=0,batchMade=false;
        try{
          ctx.lineDisplayEnabled=true;ctx.prepared=true;ctx.effectsPlan=ctx.effectsPlan||{};ctx._fillRenderedBelowWeb=true;
          WebGPUStrokeRenderer.warmup=()=>true;WebGPUStrokeRenderer.isReady=()=>true;
          WebGPUStrokeRenderer.renderLayerBatch=(cmds)=>{batchCommands=cmds;return{roles:new Map([['base',{}]]),sceneCombined:true};};
          SomataGeometryRoleService.nativeBaseKind=(...a)=>{nativeCalls++;return oldNative.apply(SomataGeometryRoleService,a);};
          batchMade=Boolean(SomataStrokeBatchService.prepare(ctx));
        }finally{WebGPUStrokeRenderer.warmup=oldWarm;WebGPUStrokeRenderer.isReady=oldReady;WebGPUStrokeRenderer.renderLayerBatch=oldBatch;SomataGeometryRoleService.nativeBaseKind=oldNative;}
        const firstFrameCalls=calls;
        // A failed shared Fill must not fall through to an older/different shadow mesh.
        const guardCtx={...ctx,frameId:78002,frame:{id:78002,dpr:1,renderLayerCount:1},geometryPlan:{kind:'blue-prepared',dynamic:true},_frameContourRecord:null,_sharedFrameContourRequired:false,_geometryContract:{fillRequested:true,fillStyle:'#00ff66',nativeGpuFillEligible:true,gpuMaskEligible:false,corridor:false,spiral:false,geometry:{hasClosedFillTopology:true,fillContourCount:1,closedPathCount:1,openPathCount:0}}};
        const fakeWrong={complete:true,nativeComplete:true,fanTriangleCount:99};
        const oldQuery=SomataFillGeometryAdapter.query,oldCan=FillMeshPreparer.canUseNative;let guarded=null;
        try{
          SomataFillGeometryAdapter.query=(method,c,...a)=>{if(method==='directMesh'){SomataFrameContourService.get(c);c._fillMeshShadow=fakeWrong;return null;}return oldQuery.call(SomataFillGeometryAdapter,method,c,...a);};
          FillMeshPreparer.canUseNative=()=>true;
          const a=SomataFillPassService.prepareBatchAttachment(guardCtx,false);guarded={shared:guardCtx._sharedFrameContourRequired===true,nativeCandidate:a?.nativeCandidate===true,wrongSelected:guardCtx._nativeFillMeshCandidate===fakeWrong};
        }finally{SomataFillGeometryAdapter.query=oldQuery;FillMeshPreparer.canUseNative=oldCan;}
        return{calls,firstFrameCalls,seenVisible,restoredVisible:false,restoredStrokeOnly:ctx.lineProfileStrokeOnly,shared:ctx._sharedFrameContourRequired===true,authority:rec?.authority,pathCount:rec?.pathCount,closed:rec?.closedPathCount,screenPoints:rec?.screenPaths?.[0]?.points?.length||0,localClosed:rec?.paths?.[0]?.closed===true,meshContours:mesh?.contourCount||0,meshEdges:mesh?.fanTriangleCount||0,meshFrameContour:mesh?.frameContourFill===true,webAnchorOwned:web?.paths===rec?.anchorPaths,webVisualOwned:web?.visualPaths===rec?.visualBezierPaths,batchMade,batchSame:batchCommands===rec?.commands,nativeCalls,guarded};
      }finally{window.getFrameGLStrokeCommands=oldGetter;state.tunnel.active=oldTunnel;mainCtx.setTransform(oldTransform);try{endFrameGeometryRuntime();}catch(_){}}
    })()`,{timeoutMs:9000,label:'7.8 shared contour invariant'});
    assert(out.firstFrameCalls===1&&out.calls===2,'authoritative Line carrier was not recorded exactly once per tested frame: '+JSON.stringify(out));
    assert(out.seenVisible===true&&out.restoredVisible===false&&out.restoredStrokeOnly===true,'hidden Line could not provide independent geometry carrier: '+JSON.stringify(out));
    assert(out.shared&&out.authority==='shared-line-command-topology','FrameContour was not claimed as authority: '+JSON.stringify(out));
    assert(out.pathCount===1&&out.closed===1&&out.screenPoints===4&&out.localClosed,'separate Line sides were not connected into one exact contour: '+JSON.stringify(out));
    assert(out.meshContours===1&&out.meshEdges===4&&out.meshFrameContour,'Fill did not consume the connected FrameContour: '+JSON.stringify(out));
    assert(out.webAnchorOwned&&out.webVisualOwned,'Web views are not owned by the shared FrameContour record: '+JSON.stringify(out));
    assert(out.batchMade&&out.batchSame&&out.nativeCalls===0,'visible Line bypassed the shared FrameContour carrier: '+JSON.stringify(out));
    assert(out.guarded?.shared===true&&out.guarded?.nativeCandidate===false&&out.guarded?.wrongSelected===false,'Fill fell back to a different contour after FrameContour was claimed: '+JSON.stringify(out));
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(!exc.length,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.8 SHARED FRAME CONTOUR: PASS',out);
  }finally{await h.close();}
})().catch(e=>{console.error('SOMATA 7.8 SHARED FRAME CONTOUR: FAIL',e.stack||e);process.exit(1)});
