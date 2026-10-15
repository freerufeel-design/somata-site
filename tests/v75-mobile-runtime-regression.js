const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.webmanifest'),'utf8'));
  assert(manifest.display==='fullscreen'||(Array.isArray(manifest.display_override)&&manifest.display_override.includes('fullscreen')),'installed mobile app does not request fullscreen display mode');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:10000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    await h.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true,screenWidth:390,screenHeight:844});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await sleep(80);

    const dock=await h.evaluate(`(()=>{
      const panel=document.getElementById('floatingViewportControls'),pcs=getComputedStyle(panel),pb=panel.getBoundingClientRect();
      const nodes=[...panel.querySelectorAll('button,label')].filter(e=>{const c=getComputedStyle(e),b=e.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&b.width>0&&b.height>0;});
      const controls=nodes.map(e=>{const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);return{id:e.id||e.className,w:b.width,h:b.height,inside:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,hit:hit===e||e.contains(hit)};});
      const fps=document.getElementById('fpsCounter'),fb=fps.getBoundingClientRect();
      return{panel:{position:pcs.position,overflowX:pcs.overflowX,rect:[pb.left,pb.top,pb.width,pb.height],inside:pb.bottom<=innerHeight+1&&pb.right<=innerWidth+1},controls,fps:{w:fb.width,h:fb.height,inside:fb.left>=0&&fb.top>=0&&fb.right<=innerWidth&&fb.bottom<=innerHeight}};
    })()`);
    assert(dock.panel.inside,'mobile bottom dock is outside the visual viewport');
    assert(dock.controls.length>=6,'expected mobile dock controls were not visible');
    for(const c of dock.controls){assert(c.w>=44&&c.h>=44,`${c.id} touch target is ${c.w}x${c.h}, expected at least 44x44`);assert(c.inside||dock.panel.overflowX==='auto'||dock.panel.overflowX==='scroll',`${c.id} is clipped without a scrollable dock`);if(c.inside)assert(c.hit,`${c.id} center is intercepted by another element`);}
    assert(dock.fps.w>=44&&dock.fps.h>=44&&dock.fps.inside,'FPS copy target is not a reachable 44x44 mobile control');

    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
    const android=await h.evaluate(`(async()=>{
      exitPseudoAppFullscreen();
      document.documentElement.requestFullscreen=async()=>{window.__somataNativeFsNoop=(window.__somataNativeFsNoop||0)+1;};
      document.getElementById('btnMobileFullscreen').click();
      await new Promise(r=>setTimeout(r,80));
      const entered=document.documentElement.classList.contains('app-pseudo-fullscreen');
      const exit=document.getElementById('btnPseudoFullscreenExit');const b=exit.getBoundingClientRect(),exitVisible=getComputedStyle(exit).display!=='none';
      exit.click();await new Promise(r=>setTimeout(r,30));
      return{entered,nativeCalls:window.__somataNativeFsNoop||0,exitVisible,exitSize:[b.width,b.height],left:document.documentElement.classList.contains('app-pseudo-fullscreen')};
    })()`);
    assert(android.nativeCalls===1,'Android fullscreen did not attempt the native API');
    assert(android.entered,'Android no-op native Fullscreen API did not fall back to app fullscreen');
    assert(android.exitVisible&&android.exitSize[0]>=42&&android.exitSize[1]>=42&&!android.left,'Android pseudo fullscreen has no usable exit path');

    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
    const iphone=await h.evaluate(`(async()=>{exitPseudoAppFullscreen();document.getElementById('btnMobileFullscreen').click();await new Promise(r=>setTimeout(r,50));const entered=document.documentElement.classList.contains('app-pseudo-fullscreen');document.getElementById('btnPseudoFullscreenExit').click();await new Promise(r=>setTimeout(r,20));return{entered,left:document.documentElement.classList.contains('app-pseudo-fullscreen')};})()`);
    assert(iphone.entered&&!iphone.left,'iPhone fullscreen fallback did not enter/exit app presentation mode');

    const copy=await h.evaluate(`(async()=>{
      window.__somataScreenErrors.clear();
      let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=String(text);}}});
      console.error('MOBILE-FPS-COPY-PROBE');
      document.getElementById('fpsCounter').click();
      await new Promise(r=>setTimeout(r,40));
      const toast=document.getElementById('somataErrorCopyToast');
      const out={copied,toastText:toast?.textContent||'',toastVisible:toast?.classList.contains('is-visible')===true};
      window.__somataScreenErrors.clear();return out;
    })()`);
    assert(copy.copied.includes('MOBILE-FPS-COPY-PROBE'),'mobile FPS click did not copy the captured error log');
    assert(copy.toastText==='Ошибки скопированы'&&copy.toastVisible,'mobile FPS copy has no confirmation toast');

    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE RUNTIME REGRESSION: PASS',{dock,android,iphone,copyToast:copy.toastText});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile runtime regression:',e.stack||e.message);process.exit(1)});
