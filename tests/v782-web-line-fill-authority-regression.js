const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000,loadDelayMs:350});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const l=createLayer('v782-web-line-fill');l.N=9;l.K=4;l.customSuborbits=1;l.radius=180;l.rounding=115;l.profileMode='spline';l.splineRenderMode='smooth';l.visible=true;l.lineVisible=true;l.fill=true;l.fillColor='#ff00aa66';l.showWeb=true;ensureLayerEffectState(l);l.web.enabled=true;l.web.placementMode='selfIntersection';l.web.angleThreshold=35;state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      function frame(now){beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=now;f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);const rec=SomataFrameContourService.current(c)||SomataFrameContourService.get(c),data=c.effectsPlan?.web?.frameData||prepareLayerFrameWebData(c),mesh=SomataFillGeometryAdapter.query('directMesh',c),cmds=getFrameWebGPUCommands(c,{frameData:data,paths:data?.paths,tunnelActive:false},'inside');return{c,rec,data,mesh,cmds};}
      // First frame initializes the 7.5 growth state; second frame must contain real threads.
      frame(2222);const q=frame(2422),{c,rec,data,mesh,cmds}=q;
      const tables=(data?.visualPaths||[]).map(p=>p?.points?.length>2?buildSinglePathLengthTable(p,false):null);
      function nearestSq(x,y){let best=Infinity;for(const table of tables){if(!(table?.total>0))continue;const n=nearestWebDistanceOnTable(table,x,y,{distance:0,x:0,y:0,sq:Infinity});best=Math.min(best,Number(n.sq));}return best;}
      let maxMetricDist=0;for(const m of data?.cornerMetrics||[]){if(!m)continue;maxMetricDist=Math.max(maxMetricDist,Math.sqrt(Math.max(0,nearestSq(m.x,m.y))));}
      let maxEndpointDist=0,endpointCount=0;for(const cmd of cmds||[])for(const sp of cmd?.subpaths||[]){const pts=sp?.points||[];if(pts.length<2)continue;for(const p of [pts[0],pts[pts.length-1]]){maxEndpointDist=Math.max(maxEndpointDist,Math.sqrt(Math.max(0,nearestSq(p.x,p.y))));endpointCount++;}}
      // Deliberately destroy semantic/visual path-index correspondence and require metric projection to recover it.
      const fakeVisual=[{points:[{x:1000,y:1000},{x:1100,y:1000},{x:1100,y:1100}],closed:false},{points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],closed:true}];
      const fakeTables=fakeVisual.map(p=>buildSinglePathLengthTable(p,false));
      const fakeCorner={x:0,y:0,pathIndex:0,pointIndex:0,cornerOrdinal:0,inLen:100,outLen:100};
      const fakeMetric=buildWebCornerMetrics([fakeCorner],fakeTables,fakeVisual)[0];
      return{
        shared:!!rec,visualSame:data?.visualPaths===rec?.paths,compatAliasSame:rec?.visualBezierPaths===rec?.paths,
        corners:data?.corners?.length||0,metrics:(data?.cornerMetrics||[]).filter(Boolean).length,maxMetricDist,maxEndpointDist,endpointCount,
        fillFrameContour:mesh?.frameContourFill===true,fillTriangles:Number(mesh?.fanTriangleCount)||0,
        fakeProjectedPath:fakeMetric?.pathIndex,webCommands:cmds?.length||0,webSubpaths:(cmds||[]).reduce((n,x)=>n+(x?.subpaths?.length||0),0)
      };
    })()`);
    console.log('DEBUG',r);assert(!r.err,r.err||'frame failed');
    assert(r.shared,'FrameContour missing');
    assert(r.visualSame&&r.compatAliasSame,'ordinary Web visual rail is not the exact visible Line carrier');
    assert(r.corners>0&&r.metrics>0,'Web corners/metrics missing');
    assert(r.maxMetricDist<1e-6,`projected Web anchors miss Line by ${r.maxMetricDist}px`);
    assert(r.endpointCount>0&&r.maxEndpointDist<1e-5,`Web thread endpoints miss Line by ${r.maxEndpointDist}px`);
    assert(r.fillFrameContour&&r.fillTriangles>0,'Fill does not use the shared FrameContour');
    assert(r.fakeProjectedPath===1,'corner metric trusted semantic pathIndex instead of nearest visible Line path');
    assert(r.webCommands>0&&r.webSubpaths>0,'Web commands contain no real thread geometry');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.2 Web/Fill/Line share one visible contour',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL v782 Web/Line/Fill authority regression:',e.stack||e.message);process.exit(1)});
