// Somata 9 deterministic controller regression: breakdown, half-time, changed tempo,
// retained phase, one-observation/one-vote, deadband and hard restart.
'use strict';
const assert=require('node:assert/strict');
const ctl=require('../js/core/tempo-lock.js');
function input(s, t, bpm, confidence=.88, bands=3, peakTime=t, bassSupport=bands>=2){
    ctl.step(s,{now:t,bpm,confidence,bands,bassSupport,peakTime,fresh:true});return s;
}
function acquire(bpm=128){
    const s=ctl.create();
    for(let i=1;i<=11;i++)input(s,1000+i*460,bpm+Math.sin(i)*.45,.84,3);
    assert.equal(s.mode,'LOCKED','stable beat must acquire');
    assert.ok(Math.abs(s.bpm-bpm)<.5,'initial BPM accuracy');return s;
}
{
    const s=acquire();const bpm=s.bpm,anchor=s.anchorTime;
    for(let t=s.lastFreshAt+500;t<=s.lastFreshAt+16000;t+=500)ctl.step(s,{now:t,fresh:false});
    assert.equal(s.mode,'HOLD','must hold missing beats');
    assert.equal(s.bpm,bpm,'no drift during 16s breakdown');
    assert.equal(s.anchorTime,anchor,'phase clock must not reset on silence');
    // Half-time / double-time cues are octave aliases, not tempo change.
    for(let i=1;i<=35;i++)input(s,s.lastFreshAt+500, i%2?64:256,.9,3);
    assert.equal(s.bpm,bpm,'half and double tempo must not force 64 or 256 BPM');
    assert.equal(s.mode,'LOCKED');
}
{
    const s=acquire();const bpm=s.bpm;
    for(let i=1;i<=12;i++)input(s,s.lastFreshAt+500,96,.9,3);
    assert.ok(s.bpm===bpm||Math.abs(s.bpm-bpm)<.4,'no early false tempo change before 4 bars');
    assert.equal(s.mode,'CHANGE_PENDING');
    for(let i=1;i<=10;i++)input(s,s.lastFreshAt+500,128,.9,3);
    assert.equal(s.mode,'LOCKED','returning original tempo cancels change');
    assert.ok(Math.abs(s.bpm-bpm)<1);
}
{
    const s=acquire();const original=s.bpm;
    for(let i=1;i<=40;i++)input(s,s.lastFreshAt+500,140+Math.sin(i)*.25,.93,3);
    assert.equal(s.mode,'LOCKED','confirmed new tempo must re-lock');
    assert.ok(Math.abs(s.bpm-140)<1,'new BPM must settle');
    assert.notEqual(s.bpm,original);
}
{
    const s=acquire();const old=s.bpm;
    for(let i=1;i<=40;i++)input(s,s.lastFreshAt+500,105,.82,1);
    assert.equal(s.bpm,old,'single-band change with low confidence must hold indefinitely');
    const t=s.lastFreshAt;ctl.step(s,{now:t,bpm:145,confidence:1,bands:6,peakTime:t,fresh:true});
    assert.equal(s.lastFreshAt,t,'same onset cannot vote twice');
}
{
    const s=acquire();const old=s.bpm;
    // Breakdown's high-frequency pattern may be regular, but is not a kick/downbeat.
    for(let i=1;i<=45;i++)input(s,s.lastFreshAt+500,96,.86,3,undefined,false);
    assert.equal(s.bpm,old,'20s of high-only breakdown rhythm must not replace locked BPM');
}
{
    const s=acquire();const old=s.bpm;
    for(let i=1;i<=30;i++)input(s,s.lastFreshAt+500,old+Math.sin(i)*.37,.85,2);
    assert.ok(Math.abs(s.bpm-old)<.4,'near tempo noise should remain inside deadband');
    assert.ok(Number.isFinite(s.anchorTime));
    assert.equal(ctl.reset(s).mode,'ACQUIRE');
}
console.log('PASS v900-tempo-lock-regression: acquire, silence/hold, octave, hold rejects fake change, confirmed change, one-band restraint, deadband, phase, reset');
