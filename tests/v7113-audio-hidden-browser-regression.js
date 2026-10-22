// Real Chromium execution: audio analysis and routing stay active when hidden,
// but hidden audio UI does not trigger per-row DOM work while Morph is running.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:240,evalTimeoutMs:12000});
 try{
  const result=await h.evaluate(`(()=>{
    const ar=state.audioReactive;
    ar.analyser={fftSize:1024,getByteFrequencyData(a){a.fill(190)},getFloatTimeDomainData(a){a.fill(0.23)}};
    ar.context={sampleRate:44100};ar.data=new Uint8Array(512);ar.timeData=new Float32Array(1024);
    ar.active=true;ar.gateListening=false;ar.noiseGateEnabled=false;
    ar.lastAnalysisTime=0;ar.lastMeterPaint=0;ar.analysisIntervalMs=16;ar.meterIntervalMs=16;
    state.tapTempo.autoTap=false;
    const audio=document.getElementById('audioReactivePanel'),routing=document.getElementById('audioRoutingPanel');
    if(!audio||!routing)throw Error('audio panels missing');
    audio.classList.add('hidden');routing.classList.add('hidden');
    const oldQ=document.querySelectorAll.bind(document);let routeQueries=0,updates=0;
    document.querySelectorAll=(selector)=>{if(selector==='.audio-route-row')routeQueries++;return oldQ(selector);};
    const start=performance.now();
    for(let i=1;i<=25;i++){if(audioReactiveFrame(start+i*50)!==true)throw Error('audio stopped');updates++;}
    document.querySelectorAll=oldQ;
    return{routeQueries,updates,levels:ar.levels,active:ar.active};
  })()`);
  assert(result.routeQueries===0,'Hidden audio routes generated DOM meter queries');
  assert(result.updates===25&&result.active,'Audio analysis lost continuity');
  assert(result.levels.some(x=>x>0.1),'Audio data stopped reaching the live state');
  assert(!uncaughtExceptions(h.events).length,'Unexpected browser exceptions: '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS 7.11.3 Chromium hidden-panel audio still modulates live state with zero route DOM scans',JSON.stringify(result));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL 7.11.3 audio hidden browser:',e.stack||e);process.exit(1)});
