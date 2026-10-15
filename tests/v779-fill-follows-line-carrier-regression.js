const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};

function addSuite(name){
  const p=path.join(__dirname,'run-all.js');
  let s=fs.readFileSync(p,'utf8');
  return s;
}

async function main(){
  const plan=fs.readFileSync(path.join(__dirname,'../js/render/fill-plan.js'),'utf8');
  const adapter=fs.readFileSync(path.join(__dirname,'../js/render/fill-geometry-adapter.js'),'utf8');
  const pass=fs.readFileSync(path.join(__dirname,'../js/render/fill-pass.js'),'utf8');
  const contour=fs.readFileSync(path.join(__dirname,'../js/geometry/frame-contour.js'),'utf8');
  assert(contour.includes('buildScreenPaths'), 'shared FrameContour connection stage missing');
  assert(contour.includes('JOIN_EPS'), 'shared endpoint stitching policy missing');
  assert(adapter.includes("register('line-carrier'"), 'Static/Dynamic Fill do not share the Line carrier adapter');
  assert(adapter.includes('prepareFrameContour'), 'Fill adapter does not consume shared FrameContour');
  assert(!adapter.includes("register('dynamic-frame'"), 'old Dynamic-only Fill adapter still present');
  assert(pass.includes("SomataFillGeometryAdapter.query('directMesh',frameCtx)"), 'Fill pass does not ask the shared geometry adapter');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:10000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      // Four sides are deliberately FOUR DIFFERENT stroke commands. This is the case that
      // used to make Web/Fill see separate open paths while Line visually formed one polygon.
      const A={x:100,y:100},B={x:300,y:100},C={x:320,y:260},D={x:80,y:260};
      const commands=[
        {alpha:1,subpaths:[{closed:false,points:[A,{x:195,y:72},B]}]},
        {alpha:1,subpaths:[{closed:false,points:[B,{x:338,y:178},C]}]},
        {alpha:1,subpaths:[{closed:false,points:[C,{x:205,y:294},D]}]},
        {alpha:1,subpaths:[{closed:false,points:[D,{x:62,y:178},A]}]}
      ];
      const mk=(dynamic,id)=>({
        layer:Object.assign(createLayer('fill-line-'+id),{fill:true,fillColor:'rgba(20,160,240,.55)',lineVisible:true,spiralEnabled:false}),
        layerIndex:0,frameId:id,frame:{id,renderLayerCount:1},prepared:true,
        geometryPlan:{kind:dynamic?'blue-circle-slide':'static',dynamic},drawLayerInstances(){},combinedScale:1,combinedRotationRad:0,
        _geometryContract:{fillRequested:true,fillStyle:'rgba(20,160,240,.55)',nativeGpuFillEligible:true,gpuMaskEligible:!dynamic,corridor:false,spiral:false,geometry:{hasClosedFillTopology:true,fillContourCount:1,closedPathCount:1,openPathCount:0}},
        visibleInstances:{copies:[{scale:1}],alphas:[1],fillAlphas:[1]},baseAlpha:1,
        lineDisplayEnabled:true,lineProfileStrokeOnly:false,lineProfileApplication:'stroke'
      });
      const originalGetter=globalThis.getFrameGLStrokeCommands;
      let calls=0,staticMesh=null,dynamicMesh=null,staticRec=null,dynamicRec=null;
      try{
        globalThis.getFrameGLStrokeCommands=()=>{calls++;return commands;};
        const staticCtx=mk(false,78020),dynamicCtx=mk(true,78021);
        staticRec=SomataFrameContourService.get(staticCtx);staticMesh=SomataFillGeometryAdapter.query('directMesh',staticCtx);
        dynamicRec=SomataFrameContourService.get(dynamicCtx);dynamicMesh=SomataFillGeometryAdapter.query('directMesh',dynamicCtx);
      }finally{globalThis.getFrameGLStrokeCommands=originalGetter;}
      const edges=(mesh)=>{const out=[],d=mesh?.fanData||[];for(let i=0;i<Number(mesh?.fanFloatCount||0);i+=6)out.push([[d[i+2],d[i+3]],[d[i+4],d[i+5]]]);return out;};
      const expected=staticRec?.screenPaths?.[0]?.points?.map(p=>[p.x,p.y])||[];

      const broken=[
        {subpaths:[{closed:false,points:[{x:0,y:0},{x:10,y:0}]}]},
        {subpaths:[{closed:false,points:[{x:10,y:0},{x:10,y:10}]}]},
        {subpaths:[{closed:false,points:[{x:30,y:30},{x:40,y:40}]}]}
      ];
      const brokenCtx=mk(true,78022);let brokenRec=null,brokenMesh=null;
      try{globalThis.getFrameGLStrokeCommands=()=>broken;brokenRec=SomataFrameContourService.get(brokenCtx);brokenMesh=SomataFillGeometryAdapter.query('directMesh',brokenCtx);}finally{globalThis.getFrameGLStrokeCommands=originalGetter;}

      // Pooled frameCtx may still carry a previous FrameContour. A mismatched frameId must
      // never be accepted; current-frame commands have to rebuild the authority.
      const stale=[{subpaths:[{closed:true,points:[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20}]}]}];
      const fresh=[{subpaths:[{closed:true,points:[{x:410,y:110},{x:560,y:115},{x:545,y:270},{x:405,y:255}]}]}];
      const staleCtx=mk(true,78023);staleCtx._frameContourRecord={frameId:78022,commands:stale,screenPaths:[{closed:true,points:stale[0].subpaths[0].points}],paths:[]};
      let getterCalls=0,staleMesh=null,staleRec=null;
      try{globalThis.getFrameGLStrokeCommands=()=>{getterCalls++;return fresh;};staleRec=SomataFrameContourService.get(staleCtx);staleMesh=SomataFillGeometryAdapter.query('directMesh',staleCtx);}finally{globalThis.getFrameGLStrokeCommands=originalGetter;}
      const staleFlat=edges(staleMesh).flat(2),staleRejected=!staleFlat.includes(10)&&staleFlat.includes(410);

      return{
        calls,
        expected,
        sharedPath:{count:staticRec?.screenPaths?.length||0,closed:staticRec?.screenPaths?.[0]?.closed===true,points:staticRec?.screenPaths?.[0]?.points?.length||0},
        staticMesh:staticMesh&&{triangles:staticMesh.fanTriangleCount,contours:staticMesh.contourCount,dynamic:staticMesh.dynamic,screen:staticMesh.dynamicScreenSpace,frameContour:staticMesh.frameContourFill===true,edges:edges(staticMesh)},
        dynamicMesh:dynamicMesh&&{triangles:dynamicMesh.fanTriangleCount,contours:dynamicMesh.contourCount,dynamic:dynamicMesh.dynamic,screen:dynamicMesh.dynamicScreenSpace,frameContour:dynamicMesh.frameContourFill===true,edges:edges(dynamicMesh)},
        sameStaticPaths:staticRec?.screenPaths?.[0]?.points?.length===staticMesh?.fanTriangleCount,
        broken:{paths:brokenRec?.screenPaths?.length||0,closed:brokenRec?.closedPathCount||0,native:brokenMesh?.nativeComplete===true,triangles:brokenMesh?.fanTriangleCount||0},
        stale:{getterCalls,rejected:staleRejected,frameId:staleRec?.frameId||0}
      };
    })()`,{timeoutMs:8000,label:'7.8 Fill follows shared FrameContour'});

    assert(out.calls===2,'Static/Dynamic FrameContour was rebuilt more than once per frame: '+JSON.stringify(out));
    assert(out.sharedPath?.count===1&&out.sharedPath?.closed===true,'four separate Line commands were not joined into one closed FrameContour: '+JSON.stringify(out));
    assert(out.sharedPath?.points===8&&out.expected.length===8,'shared contour dropped/rewrote sampled Line points: '+JSON.stringify(out.expected));
    assert(out.staticMesh?.triangles===8&&out.dynamicMesh?.triangles===8,'Fill edge count differs from the shared FrameContour: '+JSON.stringify(out));
    assert(out.staticMesh?.frameContour===true&&out.dynamicMesh?.frameContour===true,'Fill used a legacy/reconstructed mesh instead of FrameContour');
    assert(out.staticMesh?.screen===true&&out.dynamicMesh?.screen===true,'shared screen-space contour was transformed again by Fill');
    assert(out.staticMesh?.dynamic===false&&out.dynamicMesh?.dynamic===true,'Static/Dynamic mesh lifetime flags are wrong');
    assert(JSON.stringify(out.staticMesh.edges)===JSON.stringify(out.dynamicMesh.edges),'Static and Dynamic Fill use different geometric edges');
    const flattened=out.staticMesh.edges.flat(2);
    for(const [x,y] of out.expected)assert(flattened.some((v,i)=>i%2===0&&Math.abs(v-x)<1e-5&&Math.abs(flattened[i+1]-y)<1e-5),'Fill fan does not contain shared contour point '+x+','+y);
    assert(out.broken.closed===0&&out.broken.native===false&&out.broken.triangles===0,'Fill invented a contour across disconnected Line segments: '+JSON.stringify(out.broken));
    assert(out.stale?.getterCalls===1&&out.stale?.rejected===true&&out.stale?.frameId===78023,'Fill consumed a pooled previous-frame authority: '+JSON.stringify(out.stale));
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('FILL FOLLOWS FRAME CONTOUR REGRESSION: PASS — one connected authority across command boundaries + stale frame rejected');
  }finally{await h.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1);});
