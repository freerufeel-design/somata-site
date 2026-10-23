const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const l=createLayer('v781-web-shared');l.N=8;l.K=3;l.customSuborbits=1;l.radius=180;l.rounding=120;l.profileMode='spline';l.splineRenderMode='smooth';l.showWeb=true;ensureLayerEffectState(l);l.web.enabled=true;l.web.placementMode='selfIntersection';state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=1234;f.id=(Number(f.id)||0)+1;f.dpr=1;
      const c=prepareMainLayerFrame(f,0);if(!c)return{err:'no-frame'};
      const rec=SomataFrameContourService.current(c),data=c.effectsPlan?.web?.frameData||prepareLayerFrameWebData(c),visual=data?.visualPaths||[],anchor=data?.paths||[],rail=visual?.[0]?._exactLightningRail;
      let maxAnchorError=0;for(let i=0;i<(data?.corners||[]).length;i++){const corner=data.corners[i],metric=data?.cornerMetrics?.[i],vp=visual?.[corner.pathIndex];if(!metric)continue;let best=Infinity;for(const p of vp?.points||[])best=Math.min(best,Math.hypot((Number(p.x)||0)-(Number(metric.x)||0),(Number(p.y)||0)-(Number(metric.y)||0)));if(Number.isFinite(best))maxAnchorError=Math.max(maxAnchorError,best);}
      const out={shared:!!rec,anchorOwned:anchor===rec?.anchorPaths,visualOwned:visual===rec?.visualBezierPaths,anchorPoints:anchor?.[0]?.points?.length||0,flattenedPoints:rec?.paths?.[0]?.points?.length||0,visualPoints:visual?.[0]?.points?.length||0,corners:data?.corners?.length||0,truth:visual?._webBezierContourTruth===true,rail:!!rail,curved:rail?.segments?.filter(s=>s.type==='C'||s.type==='Q').length||0,maxAnchorError,webEnabled:data?.enabled===true};
      c.drawLayerGeometry=null;c.drawLayerInstances=null;c.frameVectorMaster=null;return out;
    })()`);
    assert(!r.err,r.err||'frame failed');
    assert(r.shared,'FrameContour was not active in real frame preparation');
    assert(r.anchorOwned&&r.visualOwned,'Web views are not owned by the shared FrameContour record');
    assert(r.webEnabled,'Web did not prepare');
    assert(r.corners>=4,`semantic Web corners disappeared (${r.corners})`);
    assert(r.flattenedPoints===r.visualPoints&&r.visualPoints>r.anchorPoints, 'v9 Web visual rail no longer derives from the exact shared FrameContour');
    assert(r.visualPoints>r.anchorPoints,'visual Bezier rail was not adaptively flattened');
    assert(r.maxAnchorError<1.0,`Web anchors do not lie on the visual rail (${r.maxAnchorError.toFixed(3)} px)`);
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS v9 ordinary Web shares one anchor + flattened visual FrameContour (strict Spiral exactness tested separately)',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL v781 Web FrameContour regression:',e.stack||e.message);process.exit(1)});
