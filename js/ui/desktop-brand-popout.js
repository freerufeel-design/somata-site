(()=>{
'use strict';
window.__spiroRegisterModule?.('js/ui/desktop-brand-popout.js');

const brandRuntime={
    active:false,
    popout:null,
    stream:null,
    source:null,
    syncTimer:0,
    openAttempts:0,
    popupBlocked:0,
    lastError:'',
    lastOpenedAt:0,
    localPresentationHidden:false,
    fullscreenAttempts:0
};

function isDesktopBrandMode(){
    return typeof matchMedia==='function'?matchMedia('(min-width: 761px)').matches:(innerWidth>760);
}
function getStage(){return document.getElementById('desktopBrandStage');}
function getButton(){return document.getElementById('desktopBrandLogoButton');}
function getMainContainer(){return document.getElementById('mainContainer');}
function setStageActive(active){
    const on=active===true&&isDesktopBrandMode();
    brandRuntime.active=on;
    const stage=getStage(),button=getButton();
    stage?.classList.toggle('active',on);
    stage?.setAttribute('aria-hidden',on?'false':'true');
    button?.setAttribute('aria-pressed',on?'true':'false');
    button?.classList.toggle('active',on);
}
function setLocalPresentationHidden(hidden){
    const on=hidden===true&&brandRuntime.active===true;
    brandRuntime.localPresentationHidden=on;
    getMainContainer()?.classList.toggle('desktop-output-local-hidden',on);
}
function stopCapture(){
    try{for(const track of brandRuntime.stream?.getTracks?.()||[])track.stop?.();}catch(_){}
    brandRuntime.stream=null;
    brandRuntime.source=null;
}
function clearSyncTimer(){
    if(brandRuntime.syncTimer){clearInterval(brandRuntime.syncTimer);brandRuntime.syncTimer=0;}
}
function currentPresentationCanvas(){
    const finalCanvas=document.getElementById('finalGpuCanvas');
    if(finalCanvas){
        const cs=getComputedStyle(finalCanvas);
        // Local-output hiding changes only opacity.  It must never make the live
        // canvas ineligible as a captureStream source.
        if(cs.display!=='none'&&finalCanvas.width>0&&finalCanvas.height>0)return finalCanvas;
    }
    const main=document.getElementById('mainCanvas');
    return main&&main.width>0&&main.height>0?main:null;
}
function popupDocumentHtml(){
    const logoUrl=String(document.getElementById('desktopBrandLogo')?.src||'assets/somata-logo.webp?v=20261013-v74190').replaceAll('&','&amp;').replaceAll('"','&quot;');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Somata · Output</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050816;color:#cbd5e1;font:12px/1.35 system-ui,-apple-system,Segoe UI,sans-serif}#wrap{position:fixed;inset:0;background:#050816}video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#050816}#fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;padding:28px;box-sizing:border-box;text-align:center;background:#050816}#fallback img{width:min(72vw,720px);max-height:62vh;object-fit:contain}#fallback small{color:#64748b}#fallback.stream-ready{display:none}#fs{position:fixed;right:8px;top:8px;z-index:5;width:30px;height:30px;padding:0;border:0;border-radius:6px;background:rgba(2,6,23,.34);color:#cbd5e1;font:18px/1 system-ui;cursor:pointer;opacity:.24;transition:opacity .15s ease,background .15s ease}#fs:hover,#fs:focus-visible{opacity:1;background:rgba(2,6,23,.78);outline:none}html:fullscreen #fs{opacity:0;pointer-events:none}</style></head><body><div id="wrap"><video id="somataOutputVideo" autoplay muted playsinline></video><div id="fallback"><img src="${logoUrl}" alt="Somata"><small>Перетащите окно на второй монитор · кнопка ⛶ включает borderless fullscreen</small></div><button id="fs" type="button" title="Borderless fullscreen" aria-label="Borderless fullscreen">⛶</button></div><script>
(()=>{const root=document.documentElement,btn=document.getElementById('fs');async function fs(){try{if(!document.fullscreenElement)await root.requestFullscreen();else await document.exitFullscreen();}catch(_){}}btn?.addEventListener('click',fs);document.getElementById('wrap')?.addEventListener('dblclick',fs);const notify=()=>{try{window.opener?.__somataDesktopBrandPopupClosing?.();}catch(_){}};addEventListener('pagehide',notify,{once:true});addEventListener('beforeunload',notify,{once:true});})();
<\/script></body></html>`;
}
function handleExternalWindowClosed(){
    if(!brandRuntime.popout&&!brandRuntime.active)return;
    clearSyncTimer();
    stopCapture();
    brandRuntime.popout=null;
    setLocalPresentationHidden(false);
    setStageActive(false);
    try{requestMainCanvasRender?.();}catch(_){}
}
function syncPopoutStream(){
    const w=brandRuntime.popout;
    if(!w||w.closed){handleExternalWindowClosed();return false;}
    const source=currentPresentationCanvas();
    if(!source||typeof source.captureStream!=='function'){
        brandRuntime.lastError='captureStream-unavailable';
        setLocalPresentationHidden(false);
        try{w.document.getElementById('fallback')?.classList.remove('stream-ready');}catch(_){}
        return false;
    }
    if(brandRuntime.source===source&&brandRuntime.stream?.active!==false){
        setLocalPresentationHidden(true);
        return true;
    }
    stopCapture();
    try{
        const stream=source.captureStream(60);
        const video=w.document.getElementById('somataOutputVideo');
        if(!video)throw new Error('output video missing');
        video.srcObject=stream;
        video.muted=true;
        Promise.resolve(video.play?.()).catch(()=>{});
        w.document.getElementById('fallback')?.classList.add('stream-ready');
        brandRuntime.stream=stream;
        brandRuntime.source=source;
        brandRuntime.lastError='';
        setLocalPresentationHidden(true);
        return true;
    }catch(err){
        brandRuntime.lastError=String(err?.message||err||'capture failed');
        try{w.document.getElementById('fallback')?.classList.remove('stream-ready');}catch(_){}
        stopCapture();
        setLocalPresentationHidden(false);
        return false;
    }
}
function openOutputWindow(){
    brandRuntime.openAttempts++;
    if(brandRuntime.popout&&!brandRuntime.popout.closed){
        try{brandRuntime.popout.focus();}catch(_){}
        syncPopoutStream();
        return true;
    }
    const width=720,height=430;
    const baseX=Number(window.screenX??window.screenLeft)||0;
    const baseY=Number(window.screenY??window.screenTop)||0;
    const left=Math.round(baseX+(Number(window.outerWidth)||Number(window.innerWidth)||1200)+12);
    const top=Math.round(baseY+24);
    let w=null;
    try{
        w=window.open('','somataExternalOutput',`popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`);
    }catch(err){brandRuntime.lastError=String(err?.message||err||'popup open failed');}
    if(!w){
        brandRuntime.popupBlocked++;
        if(!brandRuntime.lastError)brandRuntime.lastError='popup-blocked';
        setLocalPresentationHidden(false);
        console.warn('[Somata 7.4.30] external output window was blocked; centered logo remains active');
        return false;
    }
    brandRuntime.popout=w;
    brandRuntime.lastOpenedAt=performance.now();
    try{
        w.document.open();
        w.document.write(popupDocumentHtml());
        w.document.close();
        w.focus();
    }catch(err){
        brandRuntime.lastError=String(err?.message||err||'popup initialization failed');
        setLocalPresentationHidden(false);
        return false;
    }
    clearSyncTimer();
    brandRuntime.syncTimer=setInterval(syncPopoutStream,250);
    setTimeout(syncPopoutStream,0);
    return true;
}
function closeOutputWindow(){
    clearSyncTimer();
    stopCapture();
    setLocalPresentationHidden(false);
    const w=brandRuntime.popout;
    brandRuntime.popout=null;
    try{if(w&&!w.closed)w.close();}catch(_){}
    try{requestMainCanvasRender?.();}catch(_){}
}
function activateBrandOutput(){setStageActive(true);openOutputWindow();}
function deactivateBrandOutput(){setStageActive(false);closeOutputWindow();}
function toggleBrandOutput(){
    if(!isDesktopBrandMode())return false;
    if(brandRuntime.active)deactivateBrandOutput();else activateBrandOutput();
    return brandRuntime.active;
}
function initDesktopBrandOutput(){
    const button=getButton();
    if(!button)return;
    button.addEventListener('click',toggleBrandOutput);
    window.addEventListener('resize',()=>{if(!isDesktopBrandMode()&&brandRuntime.active)deactivateBrandOutput();},{passive:true});
    window.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&brandRuntime.active)deactivateBrandOutput();});
    window.addEventListener('beforeunload',closeOutputWindow);
}

window.__somataDesktopBrandPopupClosing=()=>{
    if(brandRuntime.popout&&!brandRuntime.popout.closed){
        // pagehide/beforeunload fires while the popup is still technically open.
        setTimeout(()=>{if(!brandRuntime.popout||brandRuntime.popout.closed)handleExternalWindowClosed();},0);
    }else handleExternalWindowClosed();
};
window.__somataDesktopBrandStatus=()=>({
    active:brandRuntime.active,
    desktop:isDesktopBrandMode(),
    popupOpen:!!brandRuntime.popout&&!brandRuntime.popout.closed,
    sourceId:brandRuntime.source?.id||null,
    localPresentationHidden:brandRuntime.localPresentationHidden,
    openAttempts:brandRuntime.openAttempts,
    popupBlocked:brandRuntime.popupBlocked,
    lastError:brandRuntime.lastError,
    lastOpenedAt:brandRuntime.lastOpenedAt
});
window.__somataDesktopBrandToggle=toggleBrandOutput;

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initDesktopBrandOutput,{once:true});
else initDesktopBrandOutput();
})();
