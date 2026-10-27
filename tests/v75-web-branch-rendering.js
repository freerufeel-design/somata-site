const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const stop=()=>{for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel'])try{animationScheduler.remove(n)}catch(_){}};stop();
      const l=createLayer('web-branches');l.N=5;l.K=2;l.customSuborbits=1;l.radius=180;l.rounding=80;l.strokeWidth=2;l.visible=true;l.lineVisible=true;l.showWeb=true;ensureLayerEffectState(l);state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=true;refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs();
      const setCheck=(id,v)=>{const e=document.getElementById(id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const ctx=(now)=>{beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=now;c.frame.now=now;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=2;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=getLayerLineVisible(l);c.visibleInstances={copies:[{scale:1,depthT:0,index:0}],alphas:[1],particleAlphas:[1]};c.layerSweep=getLayerSweepConfig(l);return c;};
      const branch=(name,now)=>{const d=prepareLayerFrameWebData(ctx(now)),rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,d.paths,l,1,d,true,name);const nums=[];for(const cmd of rec.commands||[])for(const k of ['x','y','x1','y1','x2','y2','lineWidth','alpha']){const v=Number(cmd?.[k]);if(Number.isFinite(v))nums.push(v);}return{commands:rec.commands?.length||0,finite:nums.every(Number.isFinite),corners:d.corners?.length||0,visual:d.visualPaths?.reduce((n,p)=>n+(p?.points?.length||0),0)||0,lineVisible:getLayerLineVisible(l),flags:[d.insideEnabled,d.outsideStraightEnabled,d.outsideArcEnabled]};};
      document.getElementById('showWeb').checked=true;document.getElementById('showWeb').dispatchEvent(new Event('change',{bubbles:true}));
      const samples={};
      for(const topology of ['closed','spiral-closed','spiral-open']){
        __somataSelectContourMode(topology);await new Promise(r=>setTimeout(r,35));
        setCheck('webInside',true);setCheck('webOutsideStraight',false);setCheck('webOutsideArc',false);samples[topology+'-inside']=branch('inside',1200);
        setCheck('webInside',false);setCheck('webOutsideStraight',true);setCheck('webOutsideArc',false);samples[topology+'-outsideStraight']=branch('outsideStraight',1210);
        setCheck('webInside',false);setCheck('webOutsideStraight',false);setCheck('webOutsideArc',true);samples[topology+'-outsideArc']=branch('outsideArc',1220);
      }
      setCheck('webInside',true);setCheck('webOutsideStraight',true);setCheck('webOutsideArc',true);
      const morphBtn=document.getElementById('btnMorph');if(runtimeState.morph.active)morphBtn.click();morphBtn.click();await new Promise(r=>setTimeout(r,90));
      const morph=[];for(const topology of ['spiral-closed','spiral-open','closed']){__somataSelectContourMode(topology);await new Promise(r=>setTimeout(r,45));morph.push({topology,inside:branch('inside',performance.now()),straight:branch('outsideStraight',performance.now()+1),arc:branch('outsideArc',performance.now()+2),progress:Number(runtimeState.morph.progress)||0});}
      if(runtimeState.morph.active)morphBtn.click();await new Promise(r=>setTimeout(r,30));
      return{samples,morph,inFrame:animationScheduler.stats().inFrame};
    })()`);
    for(const [name,s] of Object.entries(r.samples)){assert(s.commands>0,`${name} produced no Web thread commands`);assert(s.finite,`${name} produced non-finite Web data`);assert(s.visual>0&&s.corners>0,`${name} has no contour/corners`);assert(s.lineVisible,`${name} hid the base line while Web is enabled`);}
    for(const s of r.morph){for(const [k,v] of Object.entries({inside:s.inside,straight:s.straight,arc:s.arc})){assert(v.commands>0,`${s.topology} Morph ${k} Web branch disappeared`);assert(v.finite&&v.lineVisible,`${s.topology} Morph ${k} produced invalid output or hid base line`);}}
    assert(!r.inFrame,'Web/Spiral Morph regression left scheduler inFrame');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('WEB BRANCH + SPIRAL/MORPH REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Web branch/Spiral regression:',e.stack||e.message);process.exit(1)});
