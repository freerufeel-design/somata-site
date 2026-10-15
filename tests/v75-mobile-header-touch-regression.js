const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:16000,loadDelayMs:300});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
    await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});

    const setup=await h.evaluate(`(()=>{
      const l=state.layers[0]||createLayer('mobile-header-spiral');
      if(!state.layers.length)state.layers.push(l);
      state.activeLayerId=l.id;l.visible=true;l.lineVisible=true;l.N=17;l.K=5;l.radius=220;l.rounding=62;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.4;l.spiralTangential=true;l.spiralRoundSeams=true;l.showWeb=true;l.showLamps=true;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;l.sweep.enabled=true;l.sweep.effectType='glint';l.particles.enabled=true;state.showWeb=true;state.showLamps=true;state.tunnel.active=false;invalidateLayerGeometry(l,'mobile-header-touch');refreshLayerLookup(true);requestMainCanvasRender();
      return{id:l.id};
    })()`);

    const inspect=async(width,height)=>{
      await h.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:3,mobile:true,screenWidth:width,screenHeight:height});
      await h.evaluate(`window.dispatchEvent(new Event('orientationchange'));window.dispatchEvent(new Event('resize'));`);
      await sleep(320);
      return h.evaluate(`(()=>{
        const head=document.querySelector('header'),actions=document.querySelector('.header-actions'),hs=getComputedStyle(head),as=getComputedStyle(actions);
        const controls=[...actions.querySelectorAll('button,select')].filter(e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&b.width>0&&b.height>0;}).map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return{id:e.id||e.tagName,w:b.width,h:b.height,display:s.display};});
        return{inner:[innerWidth,innerHeight],mobile:matchMedia('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)').matches,header:{h:head.getBoundingClientRect().height,display:hs.display,overflow:hs.overflow},actions:{overflowX:as.overflowX,flexWrap:as.flexWrap,clientWidth:actions.clientWidth,scrollWidth:actions.scrollWidth},controls};
      })()`);
    };

    const portrait=await inspect(390,844);
    const landscape=await inspect(844,390);
    for(const [name,s] of [['portrait',portrait],['landscape',landscape]]){
      assert(s.mobile,`${name} is not using mobile contract`);
      assert(s.header.h<=64,`${name} header consumes ${s.header.h}px; expected one compact row <=64px`);
      assert(s.actions.flexWrap==='nowrap',`${name} header actions wrap=${s.actions.flexWrap}; expected nowrap`);
      assert(s.actions.overflowX==='auto'||s.actions.overflowX==='scroll',`${name} header is not horizontally scrollable: ${s.actions.overflowX}`);
      assert(s.controls.length>=15,`${name} too few live header controls: ${s.controls.length}`);
      const tooSmall=s.controls.filter(c=>c.h<44-0.01||c.w<44-0.01);
      assert(tooSmall.length===0,`${name} header touch targets below 44x44: ${JSON.stringify(tooSmall.slice(0,8))}`);
    }

    await h.call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:3,mobile:true,screenWidth:844,screenHeight:390});
    await sleep(250);
    const target=await h.evaluate(`(async()=>{
      const actions=document.querySelector('.header-actions'),btn=document.getElementById('btnTunnel');
      actions.scrollLeft=Math.max(0,btn.offsetLeft-actions.clientWidth/2+btn.offsetWidth/2);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const b=btn.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y),before=state.tunnel.active===true,frames=__spiroAnimationStats().frameCount;
      return{x,y,w:b.width,h:b.height,inside:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,hit:hit===btn||btn.contains(hit),before,frames};
    })()`);
    assert(target.inside&&target.hit&&target.w>=44&&target.h>=44,`Tunnel header control is not a reachable touch target after horizontal scroll: ${JSON.stringify(target)}`);
    await h.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:target.x,y:target.y,id:1,radiusX:2,radiusY:2,force:1}]});
    await h.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(220);
    const action=await h.evaluate(`(()=>{const l=state.layers.find(x=>x.id===${JSON.stringify(setup.id)});const stats=__spiroAnimationStats();beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.id=c.frameId;c.frame.dpr=devicePixelRatio||1;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;const w=prepareLayerFrameWebData(c);const rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');return{after:state.tunnel.active===true,frames:stats.frameCount,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0,webCommands:rec.commands?.length||0,finite:(rec.commands||[]).every(cmd=>Object.values(cmd||{}).filter(v=>typeof v==='number').every(Number.isFinite))};})()`);
    assert(action.after!==target.before,'real touch on Tunnel did not toggle Corridor state');
    assert(action.frames>target.frames,'real touch on Tunnel did not produce a later frame');
    assert(action.webCommands>0&&action.finite&&action.paintErrors===0&&!action.inFrame,`Spiral/Web renderer lost stability after mobile header action: ${JSON.stringify(action)}`);

    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('MOBILE HEADER TOUCH + SPIRAL ACTION REGRESSION: PASS',{portrait,landscape,target,action});
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile header touch regression:',e.stack||e.message);process.exit(1)});
