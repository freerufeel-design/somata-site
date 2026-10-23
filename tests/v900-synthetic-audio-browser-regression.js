// Exercises real six-band audio analyzer (not just TempoLock.step) on 128 BPM
// synthetic kick/click pulses followed by a genuine breakdown.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:90000});
 try{
  const result=await h.evaluate(`(() => {
    const t=state.tapTempo;
    setAutoTapEnabled(true,true);
    const base=10000, frameMs=40, durationMs=13000, pulse=60000/128;
    const data=new Uint8Array(512);
    let locks=0;
    for(let ms=0;ms<durationMs;ms+=frameMs){
      const on=(ms%pulse)<80;
      data.fill(on?210:12);
      analyzeAutoTap(data,base+ms,44100,1024,1);
      if(t.autoTempoLock?.mode==='LOCKED')locks++;
    }
    const before={mode:t.autoTempoLock?.mode,bpm:t.bpm,locks,chosen:t.autoChosenBand,
      evidence:t.autoTempoEvidence?.length,confidence:t.autoConfidence};
    for(let ms=durationMs;ms<durationMs+9000;ms+=frameMs){
      data.fill(12);
      analyzeAutoTap(data,base+ms,44100,1024,1);
    }
    const after={mode:t.autoTempoLock?.mode,bpm:t.bpm,chosen:t.autoChosenBand};
    return {before,after};
  })()`,{timeoutMs:90000,label:'v900 synthetic analyzer'});
  assert.equal(result.before.mode,'LOCKED','128 BPM synthetic pulses must yield a lock');
  assert.ok(Math.abs(result.before.bpm-128)<4,'synthetic pulse BPM must be close to input');
  assert.equal(result.after.mode,'HOLD','breakdown must enter HOLD');
  assert.equal(result.after.bpm,result.before.bpm,'BPM must stay during breakdown');
  assert.deepEqual(uncaughtExceptions(h.events),[],'no browser uncaught errors');
  console.log('PASS v900-synthetic-audio-browser-regression',JSON.stringify(result));
 }finally{await h.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
