const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const scenarios=[
  {name:'Desktop 1280x720',width:1280,height:720,dpr:1,mobile:false,touch:false,ua:null},
  {name:'Android 390x844 DPR3',width:390,height:844,dpr:3,mobile:true,touch:true,ua:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'},
  {name:'iPhone 390x844 DPR3',width:390,height:844,dpr:3,mobile:true,touch:true,ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'},
  {name:'Touch landscape 844x390 DPR3',width:844,height:390,dpr:3,mobile:true,touch:true,ua:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'}
];
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
async function one(sc){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:250});
  const baseExc=uncaughtExceptions(h.events).length;
  try{
    if(sc.ua)await h.call('Emulation.setUserAgentOverride',{userAgent:sc.ua});
    await h.call('Emulation.setDeviceMetricsOverride',{width:sc.width,height:sc.height,deviceScaleFactor:sc.dpr,mobile:sc.mobile,screenWidth:sc.width,screenHeight:sc.height});
    if(sc.touch)await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    const r=await h.evaluate(`(async()=>{
      for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel','fps-bench'])try{animationScheduler.remove(n)}catch(_){}
      const l=createLayer('fps-bench');l.N=17;l.K=5;l.customSuborbits=1;l.radius=230;l.rounding=72;l.strokeWidth=3;l.visible=true;l.lineVisible=true;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.75;l.spiralTangential=true;l.spiralRoundSeams=true;l.profileMode='spline';l.profileNodes=[{x:0,y:0},{x:.14,y:.42},{x:.37,y:-.31},{x:.68,y:.36},{x:1,y:0}];l.showWeb=true;l.showLamps=true;l.lineProfileApplication='graffiti';l.lineProfileGraffiti='slash';l.graffitiNibLength=13;l.graffitiSizeVariationEnabled=true;l.graffitiSizeVariation=35;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;l.sweep.enabled=true;l.sweep.effectType='glint';l.sweep.profileShape='current';l.particles.enabled=true;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=true;state.showLamps=true;state.tunnel.active=false;invalidateLayerGeometry(l,'fps-bench');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs?.();
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.exactStartPending=false;runtimeState.morph.progress=.42;runtimeState.morph.geometryT=.42;runtimeState.morph.frameLayers=[{...l,id:l.id,rotation:l.rotation+37,radius:l.radius*1.08,N:19,K:6}];
      let ticks=0;animationScheduler.add('fps-bench',()=>{ticks++;runtimeState.morph.progress=(runtimeState.morph.progress+.006)%1;runtimeState.morph.geometryT=runtimeState.morph.progress;requestMainCanvasRender();return true;});
      requestMainCanvasRender();await new Promise(r=>setTimeout(r,450));
      const s0=__spiroAnimationStats(),t0=performance.now(),f0=s0.frameCount,p0=s0.paintCount||s0.frameCount;
      await new Promise(r=>setTimeout(r,1800));
      const s1=__spiroAnimationStats(),t1=performance.now(),f1=s1.frameCount,p1=s1.paintCount||s1.frameCount;animationScheduler.remove('fps-bench');runtimeState.morph.active=false;await new Promise(r=>setTimeout(r,80));
      const sec=(t1-t0)/1000;return{fps:(f1-f0)/sec,paintFps:(p1-p0)/sec,frames:f1-f0,paints:p1-p0,ms:t1-t0,ticks,inFrame:animationScheduler.stats().inFrame,paintErrors:s1.paintErrors||0};
    })()`,{timeoutMs:6000,label:'fps benchmark'});
    assert(!r.inFrame,'scheduler stuck inFrame');assert((r.paintErrors||0)===0,'paint errors during benchmark');
    const exc=uncaughtExceptions(h.events).slice(baseExc);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    return r;
  }finally{await h.close();}
}
(async()=>{const runCount=Math.max(1,Number(process.env.BENCH_RUNS)||3);const wanted=process.env.BENCH_SCENARIO;const selected=wanted?scenarios.filter((s,i)=>String(i)===wanted||s.name===wanted):scenarios;const output={runs:runCount,scenarios:[]};for(const sc of selected){const vals=[];for(let i=0;i<runCount;i++)vals.push(await one(sc));output.scenarios.push({name:sc.name,medianFps:median(vals.map(x=>x.fps)),medianPaintFps:median(vals.map(x=>x.paintFps)),samples:vals});console.log(sc.name,output.scenarios.at(-1));}console.log('FPS_BENCH_JSON '+JSON.stringify(output));})().catch(e=>{console.error('FPS BENCH FAIL',e.stack||e.message);process.exit(1)});
