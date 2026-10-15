const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});

    const inspect=async(width,height)=>{
      await h.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:3,mobile:true,screenWidth:width,screenHeight:height});
      await sleep(320);
      return h.evaluate(`(()=>{
        const panel=document.getElementById('floatingViewportControls'),p=panel.getBoundingClientRect(),pcs=getComputedStyle(panel);
        const ids=['btnMobileFullscreen','btnMobileMic','btnMobileAudioRouting','btnResetView'];
        const controls=ids.map(id=>{const e=document.getElementById(id),c=getComputedStyle(e),b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);return{id,display:c.display,w:b.width,h:b.height,inside:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,hit:hit===e||e.contains(hit)};});
        const fps=document.getElementById('fpsCounter'),fb=fps.getBoundingClientRect();
        const menu=document.getElementById('btnMobileControls'),mb=menu.getBoundingClientRect(),mc=getComputedStyle(menu);
        return{inner:[innerWidth,innerHeight],coarse:matchMedia('(pointer: coarse)').matches,hoverNone:matchMedia('(hover: none)').matches,panel:{rect:[p.left,p.top,p.right,p.bottom,p.width,p.height],inside:p.left>=0&&p.top>=0&&p.right<=innerWidth+1&&p.bottom<=innerHeight+1,overflowX:pcs.overflowX},controls,fps:{w:fb.width,h:fb.height,inside:fb.left>=0&&fb.top>=0&&fb.right<=innerWidth&&fb.bottom<=innerHeight},menu:{display:mc.display,w:mb.width,h:mb.height,inside:mb.left>=0&&mb.top>=0&&mb.right<=innerWidth&&mb.bottom<=innerHeight}};
      })()`);
    };

    const portrait=await inspect(390,844);
    const landscape=await inspect(844,390);
    for(const [name,s] of [['portrait',portrait],['landscape',landscape]]){
      assert(s.coarse&&s.hoverNone,`${name} emulation is not a touch/coarse environment`);
      assert(s.panel.inside,`${name} bottom dock is outside the viewport`);
      assert(s.fps.w>=44&&s.fps.h>=44&&s.fps.inside,`${name} FPS target is ${s.fps.w}x${s.fps.h}, expected reachable >=44x44`);
      assert(s.menu.display!=='none'&&s.menu.w>=44&&s.menu.h>=44&&s.menu.inside,`${name} mobile sidebar launcher is not a reachable >=44x44 target`);
      for(const c of s.controls){
        assert(c.display!=='none',`${name} ${c.id} disappeared in mobile orientation`);
        assert(c.w>=44&&c.h>=44,`${name} ${c.id} is ${c.w}x${c.h}, expected >=44x44`);
        assert(c.inside||s.panel.overflowX==='auto'||s.panel.overflowX==='scroll',`${name} ${c.id} is clipped without horizontal scroll`);
        if(c.inside)assert(c.hit,`${name} ${c.id} center is intercepted`);
      }
    }

    const sidebar=await h.evaluate(`(async()=>{
      const launch=document.getElementById('btnMobileControls');launch.click();await new Promise(r=>requestAnimationFrame(r));
      const tool=document.querySelector('[data-sidebar-mode]');tool.click();await new Promise(r=>setTimeout(r,260));
      const aside=document.getElementById('settingsSidebar'),close=document.getElementById('btnMobileCloseSidebar'),b=close.getBoundingClientRect(),c=getComputedStyle(close);
      const x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);
      const out={open:aside.classList.contains('mobile-open'),display:c.display,w:b.width,h:b.height,hit:hit===close||close.contains(hit)};
      close.click();await new Promise(r=>requestAnimationFrame(r));out.closed=!aside.classList.contains('mobile-open');return out;
    })()`);
    assert(sidebar.open&&sidebar.display!=='none'&&sidebar.w>=44&&sidebar.h>=44&&sidebar.hit&&sidebar.closed,`landscape mobile sidebar close path is not a reachable >=44x44 control: ${JSON.stringify(sidebar)}`);

    const fullscreen=await h.evaluate(`(async()=>{
      exitPseudoAppFullscreen();
      enterPseudoAppFullscreen();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const exit=document.getElementById('btnPseudoFullscreenExit'),b0=exit.getBoundingClientRect();
      const before=[getComputedStyle(document.documentElement).getPropertyValue('--somata-viewport-width').trim(),getComputedStyle(document.documentElement).getPropertyValue('--somata-viewport-height').trim()];
      return{entered:document.documentElement.classList.contains('app-pseudo-fullscreen'),exitSize:[b0.width,b0.height],before};
    })()`);
    assert(fullscreen.entered,'pseudo fullscreen did not enter');
    assert(fullscreen.exitSize[0]>=44&&fullscreen.exitSize[1]>=44,`pseudo fullscreen exit is ${fullscreen.exitSize[0]}x${fullscreen.exitSize[1]}, expected >=44x44`);

    await h.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
    await sleep(320);
    const rotated=await h.evaluate(`(async()=>{window.dispatchEvent(new Event('orientationchange'));window.dispatchEvent(new Event('resize'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const cs=getComputedStyle(document.documentElement);const out={w:cs.getPropertyValue('--somata-viewport-width').trim(),h:cs.getPropertyValue('--somata-viewport-height').trim(),inFrame:!!window.animationScheduler?.inFrame};exitPseudoAppFullscreen();return out;})()`);
    assert(rotated.w==='390px'&&rotated.h==='844px',`pseudo fullscreen viewport did not follow rotation: ${rotated.w} x ${rotated.h}`);
    assert(!rotated.inFrame,'scheduler remained inFrame after mobile rotation');

    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE LANDSCAPE + ROTATION REGRESSION: PASS',{portrait,landscape,sidebar,fullscreen,rotated});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile landscape regression:',e.stack||e.message);process.exit(1)});
