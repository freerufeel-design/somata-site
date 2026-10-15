const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:16000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const l=createLayer('v782-corridor-shared');l.N=7;l.K=3;l.customSuborbits=1;l.radius=180;l.rounding=90;l.visible=true;l.lineVisible=true;l.fill=true;l.fillColor='#7733ff66';l.showWeb=true;ensureLayerEffectState(l);l.web.enabled=true;l.web.placementMode='corners';l.web.angleThreshold=25;state.showWeb=true;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);state.tunnel.active=true;
      function inspect(now){beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=now;f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0),rec=SomataFrameContourService.current(c)||SomataFrameContourService.get(c),master=c.geometryPlan?.dynamic===true?getDynamicTunnelMorphMasterStrokeCommands(c,true):getTunnelMasterStrokeCommands(c,true),data=c.effectsPlan?.web?.frameData||prepareLayerFrameWebData(c),mesh=SomataFillGeometryAdapter.query('corridorMesh',c);return{dynamic:c.geometryPlan?.dynamic===true,shared:!!rec,sameMaster:rec?.commands===master,webSame:data?.visualPaths===rec?.paths,corners:data?.corners?.length||0,meshShared:mesh?.frameContourFill===true&&mesh?.corridorFrameContour===true,tri:Number(mesh?.fanTriangleCount)||0,authority:rec?.authority||''};}
      const stat=inspect(1000);
      const mb=document.getElementById('btnMorph');if(runtimeState.morph.active)mb?.click();mb?.click();await new Promise(r=>setTimeout(r,120));const dyn=inspect(performance.now());if(runtimeState.morph.active)mb?.click();
      return{stat,dyn};
    })()`);
    for(const [name,x] of Object.entries(r)){assert(x.shared,`${name}: no shared master FrameContour`);assert(x.sameMaster,`${name}: FrameContour is not the exact Corridor Base master commands`);assert(x.webSame,`${name}: Web does not use Corridor master FrameContour`);assert(x.corners>0,`${name}: no Web corners`);assert(x.meshShared&&x.tri>0,`${name}: Fill does not use Corridor master FrameContour`);}
    assert(r.stat.dynamic===false,'static Corridor unexpectedly dynamic');assert(r.dyn.dynamic===true,'Morph Corridor did not use dynamic master');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.2 Corridor Line/Fill/Web share one master FrameContour',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL v782 Corridor FrameContour regression:',e.stack||e.message);process.exit(1)});
