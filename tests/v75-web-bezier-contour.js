const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:10000,loadDelayMs:350});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const l=createLayer('v75-web-bezier');l.N=5;l.K=2;l.customSuborbits=1;l.radius=180;l.rounding=120;l.profileMode='spline';l.splineRenderMode='smooth';l.showWeb=true;ensureLayerEffectState(l);l.web.enabled=true;state.showWeb=true;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);
      beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=1234;c.frame.now=1234;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=2;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances={copies:[{scale:1,depthT:0,index:0}],alphas:[1],particleAlphas:[1]};c.layerSweep=getLayerSweepConfig(l);
      const source=getLayerFrameAuxiliaryPaths(c),legacy=getLayerFrameRoundedPaths(c),data=prepareLayerFrameWebData(c),visual=data?.visualPaths||[];
      const p=visual[0],rail=p?._exactLightningRail,curved=rail?.segments?.filter(s=>s.type==='C'||s.type==='Q')||[];
      let maxMidError=0;
      for(const seg of curved.slice(0,24)){
        let q;if(seg.type==='C'){const t=.5,u=.5;q={x:u*u*u*seg.p0.x+3*u*u*t*seg.p1.x+3*u*t*t*seg.p2.x+t*t*t*seg.p3.x,y:u*u*u*seg.p0.y+3*u*u*t*seg.p1.y+3*u*t*t*seg.p2.y+t*t*t*seg.p3.y};}
        else {const t=.5,u=.5;q={x:u*u*seg.p0.x+2*u*t*seg.p1.x+t*t*seg.p2.x,y:u*u*seg.p0.y+2*u*t*seg.p1.y+t*t*seg.p2.y};}
        let best=Infinity;for(const v of p?.points||[])best=Math.min(best,Math.hypot(v.x-q.x,v.y-q.y));maxMidError=Math.max(maxMidError,best);
      }
      const sameAsLegacy=visual===legacy || (visual.length===legacy.length&&visual.every((vp,i)=>vp===legacy[i]));
      return {enabled:data?.enabled===true,sourcePoints:source?.[0]?.points?.length||0,visualPoints:p?.points?.length||0,hasTruth:visual?._webBezierContourTruth===true,hasRail:!!rail,curved:curved.length,maxMidError,sameAsLegacy};
    })()`);
    assert(r.enabled,'Web did not prepare');
    assert(r.hasTruth,'Web visual paths are not marked as renderer-truth Bézier contours');
    assert(r.hasRail&&r.curved>0,'Web visual contour has no retained Q/C Bézier rail');
    assert(r.visualPoints>r.sourcePoints,'Web contour was not adaptively flattened from the rendered Bézier rail');
    assert(r.maxMidError<=0.35,`Web preview deviates from retained Bézier midpoint by ${r.maxMidError.toFixed(3)} px`);
    assert(!r.sameAsLegacy,'Web still uses the historical rounded-polyline contour');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS Web uses the real rendered Bézier contour',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Somata 7.5 Web Bézier contour:',e.stack||e.message);process.exit(1)});
