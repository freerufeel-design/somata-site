const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:12000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const l=state.layers[0]||createLayer('v761-stop-continuity');
      if(!state.layers.length)state.layers.push(l);state.layers.splice(1);state.activeLayerId=l.id;
      Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:220,rotation:0,rounding:10,profileMode:'segments',closedLoop:true,
        profileNodes:[{x:0,y:0},{x:.30,y:.25},{x:.62,y:-.20},{x:1,y:0}],spiralEnabled:false,customSuborbits:null,chaosStar:false});
      invalidateLayerGeometry(l,'v761-stop-continuity-setup');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs();
      state.morph.intervalSec=2;state.morph.options.byShape=true;state.morph.options.byVertices=true;state.morph.options.bySteps=true;
      state.morph.options.byRounding=true;state.morph.options.bySize=true;state.morph.vertexMin=5;state.morph.vertexMax=14;
      const interval=document.getElementById('morphInterval');if(interval){interval.value='2';interval.dispatchEvent(new Event('input',{bubbles:true}));interval.dispatchEvent(new Event('change',{bubbles:true}));}
      const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn.click();btn.click();await wait(420);
      const frame=runtimeState.morph.frameLayers?.[0];if(!frame)throw new Error('missing active Morph frame');
      const snap={N:frame.N,K:frame.K,profileMode:frame.profileMode,closedLoop:frame.closedLoop,radius:frame.radius,rotation:frame.rotation,rounding:frame.rounding,
        spiralEnabled:frame.spiralEnabled,spiralOrder:frame.spiralOrder,spiralStep:frame.spiralStep,spiralClosed:frame.spiralClosed,
        customSuborbits:frame.customSuborbits,chaosStar:frame.chaosStar,profileNodes:(frame.profileNodes||[]).map(p=>({x:p.x,y:p.y}))};
      const progress=Number(runtimeState.morph.progress)||0;
      btn.click();await wait(60);
      const s=state.layers[0];
      const after={N:s.N,K:s.K,profileMode:s.profileMode,closedLoop:s.closedLoop,radius:s.radius,rotation:s.rotation,rounding:s.rounding,
        spiralEnabled:s.spiralEnabled,spiralOrder:s.spiralOrder,spiralStep:s.spiralStep,spiralClosed:s.spiralClosed,
        customSuborbits:s.customSuborbits,chaosStar:s.chaosStar,profileNodes:(s.profileNodes||[]).map(p=>({x:p.x,y:p.y}))};
      const stats=animationScheduler.stats();
      return {progress,active:runtimeState.morph.active===true,snap,after,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0};
    })()`,{timeoutMs:9000,label:'7.6.1 Static/Morph stop continuity'});
    assert(out.progress>0.03&&out.progress<0.98,'probe did not stop inside an active Morph frame: '+out.progress);
    assert(out.active===false,'Morph remained active after user stop');
    assert(JSON.stringify(out.after)===JSON.stringify(out.snap),'static state differs from the last resolved Morph frame: '+JSON.stringify({snap:out.snap,after:out.after}));
    assert(out.paintErrors===0&&!out.inFrame,'scheduler/render unstable after Morph stop');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6.1 STATIC/MORPH STOP CONTINUITY: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6.1 Static/Morph stop continuity:',e.stack||e.message);process.exit(1)});
