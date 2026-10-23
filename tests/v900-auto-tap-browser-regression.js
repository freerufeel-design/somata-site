// Browser regression: real checkbox -> live TAP -> detector selection -> BPM label,
// hold across breakdown -> no repeated stale votes -> manual wheel takes over.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=require('node:assert/strict');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300,evalTimeoutMs:18000});
 try{
  const result=await h.evaluate(`(() => {
    const t=state.tapTempo,cb=document.getElementById('tapAutoEnabled'),btn=document.getElementById('btnTapTempo');
    if(!window.SomataTempoLock)throw Error('Tempo Lock module not loaded');
    if(!cb||!btn)throw Error('TAP controls missing');
    if(cb.checked)cb.click();cb.click();
    const activated=t.autoTap&&cb.checked&&t.bpm===0;
    state.audioReactive.active=true;
    const base=2000,now=base+12*460+600;
    const update=(i,bpm)=>{
      const at=base+i*460,trackers=ensureAutoTapBandTrackers();
      for(const key of ['low','mid','combined']){
        const tr=trackers[key];tr.bpm=bpm;tr.confidence=.96;tr.stability=.98;tr.score=.94;
        tr.lastPeakAt=at;tr.beatTimes=Array.from({length:Math.max(5,i)},(_,j)=>at-j*460).reverse();
      }
      if(chooseStableAutoTapBand(at))syncTapUI();
    };
    for(let i=1;i<=12;i++)update(i,128);
    const first={mode:t.autoTempoLock.mode,bpm:t.bpm,label:btn.textContent,anchor:t.anchorTime,phaseDelay:btn.style.animationDelay};
    const voters=t.autoTempoEvidence.length;
    for(let i=0;i<12;i++)chooseStableAutoTapBand(now-1000+i*35);
    const duplicateVotes=t.autoTempoEvidence.length;
    chooseStableAutoTapBand(now+4000);syncTapUI();
    const hold={mode:t.autoTempoLock.mode,bpm:t.bpm,label:btn.textContent,anchor:t.anchorTime,status:document.getElementById('tapAutoStatus').textContent};
    btn.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
    const manual={bpm:t.bpm,auto:t.autoTap,label:btn.textContent};
    return{activated,first,voters,duplicateVotes,hold,manual};
  })()`,{timeoutMs:18000});
  assert.ok(result.activated,'real auto checkbox must activate');
  assert.equal(result.first.mode,'LOCKED','browser-selected bands must lock');
  assert.ok(Math.abs(result.first.bpm-128)<1,'browser band selection must lock correct BPM');
  assert.match(result.first.label,/128 BPM/);
  assert.equal(result.voters,result.duplicateVotes,'no repeated votes from stale detector frames');
  assert.equal(result.hold.mode,'HOLD');
  assert.equal(result.hold.bpm,result.first.bpm,'breakdown must not change BPM');
  assert.equal(result.hold.anchor,result.first.anchor,'breakdown must not reset phase anchor');
  assert.match(result.hold.status,/HOLD/);
  assert.equal(result.manual.auto,false,'manual wheel must take control away from auto');
  assert.equal(result.manual.bpm,129);
  const errors=uncaughtExceptions(h.events);assert.deepEqual(errors,[],'browser console must not throw');
  console.log('PASS v900-auto-tap-browser-regression',JSON.stringify(result));
 }finally{await h.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
