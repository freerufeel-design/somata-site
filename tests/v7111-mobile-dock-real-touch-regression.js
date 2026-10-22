// Regression: touches inside #mainContainer must not be swallowed by the canvas pan handler.
// Unlike .click(), CDP touch dispatch verifies the actual browser touch -> click path.
const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,m)=>{if(!v)throw new Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300,evalTimeoutMs:10000});
 try{
  await h.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true,screenWidth:390,screenHeight:844});
  await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
  await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);window.__dockTaps=[];document.addEventListener('click',e=>window.__dockTaps.push(e.target.closest('button,label')?.id||'other'),true)})()`);
  await h.sleep(650);
  async function tap(id){
    const p=await h.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return{x,y,w:r.width,h:r.height,hit:hit?.id||'',visible:getComputedStyle(e).display!=='none'}})()`);
    assert(p.visible&&p.w>=44&&p.h>=44,`${id} not a visible 44x44 control`);
    assert(p.hit===id,`${id} center is intercepted by ${p.hit}`);
    await h.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:p.x,y:p.y,force:1,radiusX:1,radiusY:1}]});
    await h.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await h.sleep(100);
    const taps=await h.evaluate('window.__dockTaps.splice(0)');
    assert(taps.filter(x=>x===id).length===1,`${id}: real finger tap generated ${JSON.stringify(taps)}, expected exactly one click`);
  }
  for(const id of ['btnMobileMic','btnMobileAudioRouting','btnResetView']){
    await tap(id);
    if(id==='btnMobileMic'){
      const open=await h.evaluate(`!document.getElementById('audioReactivePanel').classList.contains('hidden')`);
      assert(open,'microphone panel did not open from finger tap');
      // Close through normal (non-panel) click; subsequent probes must remain at the dock.
      await h.evaluate(`document.getElementById('btnCloseAudioPanel').click()`);
    }
    if(id==='btnMobileAudioRouting'){
      const open=await h.evaluate(`!document.getElementById('audioRoutingPanel').classList.contains('hidden')`);
      assert(open,'audio routing panel did not open from finger tap');
      await h.evaluate(`document.getElementById('btnCloseAudioRouting').click()`);
    }
  }
  // The dock also contains native labels. They must not start a canvas pan or lose
  // the checkbox click, even when scrolled horizontally to reach the control.
  const labelPos=await h.evaluate(`(()=>{const e=document.querySelector('#floatingViewportControls .display-check');e.scrollIntoView({inline:'center',block:'nearest'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,ok:e.contains(hit),before:document.getElementById('paramShowBoundingCircle').checked}})()`);
  assert(labelPos.ok,`circle label center intercepted at ${labelPos.x},${labelPos.y}`);
  await h.sleep(180);
  await h.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:labelPos.x,y:labelPos.y,force:1,radiusX:1,radiusY:1}]});
  await h.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await h.sleep(120);
  const labelChanged=await h.evaluate(`document.getElementById('paramShowBoundingCircle').checked`);
  assert(labelChanged!==labelPos.before,'bottom dock label lost its native tap/click');
  // Canvas touch gestures still must be preventDefault-ed to avoid page scroll / zoom.
  const canvasGesture=await h.evaluate(`(()=>{const c=document.getElementById('mainCanvas');const start=new Event('touchstart',{bubbles:true,cancelable:true});Object.defineProperty(start,'touches',{value:[{clientX:200,clientY:300}]});c.dispatchEvent(start);const e=new Event('touchend',{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:[]});c.dispatchEvent(e);return start.defaultPrevented && e.defaultPrevented;})()`);
  assert(canvasGesture,'canvas touchend stopped preventing the native gesture');
  const errors=uncaughtExceptions(h.events);
  assert(!errors.length,`browser exceptions: ${errors.join(' | ')}`);
  console.log('7.11.1 MOBILE DOCK REAL TOUCH REGRESSION: PASS');
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL real mobile touch:',e.stack||e);process.exit(1)});
