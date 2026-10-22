// Chromium regression: the actual TAP/BPM wheel handler edits live tempo, not its label.
const fs = require('fs');
const path = require('path');
const {createBrowserHarness,uncaughtExceptions} = require('./lib/browser-harness');
const assert = (value,message) => { if(!value) throw new Error(message); };
(async () => {
  const h = await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:12000});
  try {
    const result = await h.evaluate(`(() => {
      const button=document.getElementById('btnTapTempo');
      if(!button||typeof stepTapTempoByWheel!=='function') throw Error('Missing TAP wheel binding');
      const t=state.tapTempo, saved={...t};
      const wheel=(el,deltaY,options={}) => {
        const e=new WheelEvent('wheel',{deltaY,cancelable:true,bubbles:true,...options});
        el.dispatchEvent(e);
        return {bpm:t.bpm,canceled:e.defaultPrevented,label:button.textContent,auto:t.autoTap,syncFull:t.syncFullMorph,syncOrange:t.syncMinimalMorph};
      };
      t.bpm=120;t.autoTap=false;t.syncFullMorph=false;t.syncMinimalMorph=false;t.tapTimes=[];
      syncTapUI();
      const up=wheel(button,-120);
      const down=wheel(button,120);
      const largeDelta=wheel(button,-500);
      const another=wheel(button,-3);
      const out=wheel(document.getElementById('btnTapSettings'),-120);
      const zeroDelta=wheel(button,0);
      t.bpm=300;const max=wheel(button,-120);
      t.bpm=1;const off=wheel(button,120);
      const first=wheel(button,-120);
      t.bpm=120;t.autoTap=true;const auto=wheel(button,-120);
      const ctrl=wheel(button,-120,{ctrlKey:true});
      Object.assign(t,saved);syncTapUI();
      return{up,down,largeDelta,another,out,zeroDelta,max,off,first,auto,ctrl};
    })()`);
    assert(result.up.bpm===121&&result.up.canceled&&result.up.label==='121 BPM','Wheel up must add one and repaint BPM');
    assert(result.down.bpm===120&&result.down.canceled,'Wheel down must subtract one BPM');
    assert(result.largeDelta.bpm===121&&result.another.bpm===122,'Each wheel event changes BPM exactly one, regardless of delta magnitude');
    assert(result.out.bpm===122&&!result.out.canceled,'Outside TAP button wheel was intercepted');
    assert(result.zeroDelta.bpm===122&&!result.zeroDelta.canceled,'Zero delta should not be handled');
    assert(result.max.bpm===300&&result.max.canceled,'Wheel must clamp to max supported BPM');
    assert(result.off.bpm===0&&result.off.label==='TAP','Decrementing 1 BPM must use real TAP reset');
    assert(result.first.bpm===1&&result.first.syncFull&&result.first.syncOrange,'Wheel starts sync from zero');
    assert(result.auto.bpm===121&&!result.auto.auto,'Manual wheel must take ownership from Auto-TAP');
    assert(result.ctrl.bpm===121&&!result.ctrl.canceled,'Ctrl+wheel should preserve browser zoom gesture');

    // Exercise Chromium's real input pipeline, not just synthetic Event dispatch.
    const css = fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    const before = await h.evaluate(`(() => {
      const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);
      state.tapTempo.bpm=130;state.tapTempo.autoTap=false;syncTapUI();
      const b=document.getElementById('btnTapTempo'),r=b.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id};
    })()`);
    assert(before.width>25&&before.height>15,`TAP button has invalid dimensions: ${JSON.stringify(before)}`);
    assert(before.hit==='btnTapTempo',`TAP wheel hit intercepted by: ${before.hit}`);
    await h.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.x,y:before.y});
    await h.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:before.x,y:before.y,deltaX:0,deltaY:-120});
    await h.sleep(140);
    const actual=await h.evaluate(`({bpm:state.tapTempo.bpm,label:document.getElementById('btnTapTempo').textContent})`);
    assert(actual.bpm===131&&actual.label==='131 BPM',`Physical Chromium wheel failed: ${JSON.stringify(actual)}`);
    assert(!uncaughtExceptions(h.events).length,'Uncaught browser errors: '+uncaughtExceptions(h.events).join(' | '));
    console.log('7.11.13 TAP WHEEL BPM REGRESSION: PASS',JSON.stringify({result,actual}));
  } finally { await h.close(); }
})().catch(e=>{console.error('FAIL 7.11.13 TAP wheel:',e.stack||e);process.exit(1)});
