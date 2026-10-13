const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const {ROOT}=require('./lib/test-utils');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:7000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const css=fs.readFileSync(path.join(ROOT,'styles/app.css'),'utf8');
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true;})()`);
    await h.call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await h.sleep(100);
    const desktop=await h.evaluate(`(()=>{const button=document.getElementById('desktopBrandLogoButton'),logo=document.getElementById('desktopBrandLogo'),actions=document.querySelector('.header-actions'),neighbor=document.getElementById('btnAudioReactive'),header=document.querySelector('header'),stage=document.getElementById('desktopBrandStage');const br=button.getBoundingClientRect(),lr=logo.getBoundingClientRect(),ar=actions.getBoundingClientRect(),nr=neighbor.getBoundingClientRect(),bcs=getComputedStyle(button),lcs=getComputedStyle(logo),scs=getComputedStyle(stage);return{exists:!!button&&!!logo,parentIsHeader:button?.parentElement===header,buttonDisplay:bcs.display,logoDisplay:lcs.display,pointerEvents:bcs.pointerEvents,width:br.width,height:br.height,logoWidth:lr.width,logoHeight:lr.height,neighborHeight:nr.height,borderWidth:bcs.borderTopWidth,backgroundColor:bcs.backgroundColor,left:br.left,right:br.right,actionsLeft:ar.left,overlap:br.right>ar.left+.5,stageDisplay:scs.display,status:window.__somataDesktopBrandStatus?.()||null};})()`);
    assert(desktop.exists&&desktop.parentIsHeader,'desktop logo launcher is missing from header');
    assert(desktop.buttonDisplay!=='none'&&desktop.logoDisplay!=='none','desktop logo is hidden at desktop width');
    assert(Math.abs(desktop.height-desktop.neighborHeight)<=1,'logo launcher is not the same height as the neighboring buttons');
    assert(desktop.width>desktop.height,'compact logo aspect ratio is lost');
    assert(Math.abs(desktop.logoHeight-desktop.height)<=.5,'logo artwork does not fill the existing toolbar row');
    assert(parseFloat(desktop.borderWidth)===0,'logo launcher still has a visible border');
    assert(desktop.pointerEvents!=='none','desktop logo launcher cannot receive clicks');
    assert(!desktop.overlap,'desktop logo overlaps the header controls');
    assert(desktop.stageDisplay==='none','center stage logo is visible before click');
    assert(desktop.status&&desktop.status.active===false,'brand output runtime starts active');

    const click=await h.evaluate(`(()=>{const calls=[];window.open=(url,name,features)=>{calls.push({url,name,features});return null;};const button=document.getElementById('desktopBrandLogoButton');button.click();const stage=document.getElementById('desktopBrandStage'),img=stage.querySelector('.desktop-brand-stage-logo'),host=document.getElementById('mainContainer'),sr=stage.getBoundingClientRect(),ir=img.getBoundingClientRect(),hr=host.getBoundingClientRect(),status=window.__somataDesktopBrandStatus?.()||null;return{calls,display:getComputedStyle(stage).display,aria:stage.getAttribute('aria-hidden'),pressed:button.getAttribute('aria-pressed'),status,centerDeltaX:Math.abs((ir.left+ir.width/2)-(hr.left+hr.width/2)),centerDeltaY:Math.abs((ir.top+ir.height/2)-(hr.top+hr.height/2)),stageMatchesHost:Math.abs(sr.width-hr.width)<1&&Math.abs(sr.height-hr.height)<1};})()`);
    assert(click.calls.length===1,'logo click did not attempt to open a detachable window');
    assert(click.calls[0].name==='somataExternalOutput','detachable output window does not use a stable reusable name');
    assert(/popup=yes/.test(click.calls[0].features)&&/resizable=yes/.test(click.calls[0].features),'output window is not a draggable/resizable browser popup');
    assert(click.display==='flex'&&click.aria==='false'&&click.pressed==='true','logo click did not activate the centered canvas logo');
    assert(click.stageMatchesHost&&click.centerDeltaX<2&&click.centerDeltaY<2,'stage logo is not centered in the actual canvas workspace');
    assert(click.status?.active===true&&click.status?.openAttempts===1&&click.status?.popupBlocked===1,'popup-blocked path does not preserve centered logo and runtime diagnostics');
    assert(click.status?.localPresentationHidden===false,'blocked popup must not hide the local canvas presentation');

    const toggledOff=await h.evaluate(`(()=>{document.getElementById('desktopBrandLogoButton').click();const stage=document.getElementById('desktopBrandStage'),button=document.getElementById('desktopBrandLogoButton');return{display:getComputedStyle(stage).display,pressed:button.getAttribute('aria-pressed'),status:window.__somataDesktopBrandStatus?.()||null};})()`);
    assert(toggledOff.display==='none'&&toggledOff.pressed==='false'&&toggledOff.status?.active===false,'second logo click does not close the stage/output mode');

    const livePopup=await h.evaluate(`(async()=>{const rec={html:'',fps:0,played:0,closed:0,stopped:0,classes:new Set()},video={srcObject:null,muted:false,play(){rec.played++;return Promise.resolve();}},fallback={classList:{add(v){rec.classes.add(v);},remove(v){rec.classes.delete(v);}}},doc={open(){},write(v){rec.html+=v;},close(){},getElementById(id){return id==='somataOutputVideo'?video:id==='fallback'?fallback:null;}},popup={closed:false,document:doc,focus(){},close(){this.closed=true;rec.closed++;}};window.open=()=>popup;const host=document.getElementById('mainContainer'),stage=document.getElementById('desktopBrandStage'),main=document.getElementById('mainCanvas'),final=document.getElementById('finalGpuCanvas');final.style.display='none';const track={stop(){rec.stopped++;}},stream={active:true,getTracks(){return[track];}};main.captureStream=(fps)=>{rec.fps=fps;return stream;};document.getElementById('desktopBrandLogoButton').click();await new Promise(r=>setTimeout(r,50));const during={status:window.__somataDesktopBrandStatus?.()||null,srcAttached:video.srcObject===stream,fps:rec.fps,played:rec.played,readyClass:rec.classes.has('stream-ready'),hostHidden:host.classList.contains('desktop-output-local-hidden'),mainOpacity:getComputedStyle(main).opacity,htmlHasVideo:/somataOutputVideo/.test(rec.html),htmlHasMoveHint:/второй монитор/.test(rec.html),htmlHasFullscreen:/requestFullscreen/.test(rec.html)&&/Borderless fullscreen/.test(rec.html)};popup.closed=true;await new Promise(r=>setTimeout(r,320));const after={status:window.__somataDesktopBrandStatus?.()||null,stopped:rec.stopped,hostHidden:host.classList.contains('desktop-output-local-hidden'),mainOpacity:getComputedStyle(main).opacity,stageDisplay:getComputedStyle(stage).display};return{during,after};})()`);
    assert(livePopup.during.status?.popupOpen===true&&livePopup.during.status?.sourceId==='mainCanvas','detachable output did not attach to the live presentation surface');
    assert(livePopup.during.srcAttached&&livePopup.during.fps===60&&livePopup.during.played>0&&livePopup.during.readyClass,'popup did not receive the live 60 fps canvas stream');
    assert(livePopup.during.hostHidden&&livePopup.during.status?.localPresentationHidden===true&&Number(livePopup.during.mainOpacity)===0,'local presentation was not suppressed after detached output became live');
    assert(livePopup.during.htmlHasVideo&&livePopup.during.htmlHasMoveHint&&livePopup.during.htmlHasFullscreen,'popup document is missing output surface, second-monitor hint, or borderless fullscreen action');
    assert(livePopup.after.status?.active===false&&livePopup.after.status?.popupOpen===false&&livePopup.after.stopped>=1,'closing the external window did not stop capture and deactivate output mode');
    assert(!livePopup.after.hostHidden&&Number(livePopup.after.mainOpacity)>0&&livePopup.after.stageDisplay==='none','closing the external window did not restore the original canvas presentation');

    await h.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await h.sleep(80);
    const mobile=await h.evaluate(`(()=>{const button=document.getElementById('desktopBrandLogoButton'),logo=document.getElementById('desktopBrandLogo'),stage=document.getElementById('desktopBrandStage'),br=button.getBoundingClientRect(),lr=logo.getBoundingClientRect(),sr=stage.getBoundingClientRect();return{buttonDisplay:getComputedStyle(button).display,logoDisplay:getComputedStyle(logo).display,stageDisplay:getComputedStyle(stage).display,buttonWidth:br.width,buttonHeight:br.height,logoWidth:lr.width,logoHeight:lr.height,stageWidth:sr.width,stageHeight:sr.height};})()`);
    assert(mobile.buttonDisplay==='none'&&mobile.buttonWidth===0&&mobile.buttonHeight===0,'desktop logo launcher must be completely hidden on mobile');
    assert(mobile.logoDisplay==='none'&&mobile.logoWidth===0&&mobile.logoHeight===0,'desktop logo image must be completely hidden on mobile');
    assert(mobile.stageDisplay==='none','desktop center-stage logo must never appear on mobile');

    const exc=uncaughtExceptions(h.events).slice(baseline);
    assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('DESKTOP LOGO + DETACHABLE OUTPUT: PASS',{desktop,click,mobile});
  } finally {await h.close();}
}
main().catch(err=>{console.error('FAIL desktop logo:',err.stack||err.message);process.exit(1);});
