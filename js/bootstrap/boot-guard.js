/* Somata 7.4.9 boot guard: intentionally inline so it still works when external JS/CSS fails. */
(function(){
    'use strict';
    if(location.hostname&&location.hostname.toLowerCase()==='www.somata.su'){
        location.replace('https://somata.su'+location.pathname+location.search+location.hash);
        return;
    }
    const BUILD='7.4.9';
    const failures=[];
    let panel=null, list=null;
    window.__somataAssetBuild=BUILD;
    window.__somataAssetFailures=failures;

    function safeText(v){ try{return String(v==null?'':v);}catch(_){return '[unprintable]';} }
    function resourceUrl(target){ return safeText((target&&target.src)||(target&&target.href)||''); }
    function ensurePanel(){
        if(panel||document.getElementById('somataBootAssetError')) return panel||document.getElementById('somataBootAssetError');
        panel=document.createElement('section');
        panel.id='somataBootAssetError';
        panel.setAttribute('role','alert');
        panel.style.cssText='position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;max-height:42vh;overflow:auto;background:#21090b;color:#ffb4b8;border:1px solid #ff4d57;border-radius:8px;padding:8px 10px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;user-select:text;-webkit-user-select:text;box-shadow:0 8px 30px rgba(0,0,0,.45)';
        const head=document.createElement('div');
        head.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:6px;font-family:system-ui,sans-serif;font-weight:700';
        const title=document.createElement('span'); title.textContent='Somata '+BUILD+' · ошибка загрузки ресурсов';
        const copy=document.createElement('button'); copy.type='button'; copy.textContent='Копировать всё'; copy.style.cssText='margin-left:auto;font:inherit;padding:3px 7px;cursor:pointer';
        const close=document.createElement('button'); close.type='button'; close.textContent='×'; close.style.cssText='font:inherit;padding:3px 8px;cursor:pointer';
        copy.addEventListener('click',async()=>{ const text=failures.map(formatFailure).join('\n\n'); try{await navigator.clipboard.writeText(text);copy.textContent='Скопировано';setTimeout(()=>copy.textContent='Копировать всё',1000);}catch(_){ try{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}catch(__){} } });
        close.addEventListener('click',()=>{panel.hidden=true;});
        list=document.createElement('div');
        head.append(title,copy,close); panel.append(head,list); (document.body||document.documentElement).appendChild(panel); return panel;
    }
    function formatFailure(f){
        const bits=['['+(f.time||new Date().toLocaleTimeString())+'] '+(f.kind||'asset.error'),f.message||''];
        if(f.url) bits.push('URL: '+f.url);
        if(f.status!=null) bits.push('HTTP: '+f.status+(f.statusText?' '+f.statusText:''));
        if(f.contentType) bits.push('Content-Type: '+f.contentType);
        if(f.finalUrl&&f.finalUrl!==f.url) bits.push('Final URL: '+f.finalUrl);
        if(f.detail) bits.push(f.detail);
        return bits.filter(Boolean).join('\n');
    }
    function render(){
        if(!failures.length) return;
        ensurePanel();
        if(list) list.textContent=failures.map(formatFailure).join('\n\n');
    }
    async function probe(f){
        if(!f.url||!/^https?:/i.test(f.url)) return;
        try{
            let r=await fetch(f.url,{method:'HEAD',cache:'no-store',credentials:'same-origin'});
            if(r.status===405||r.status===501) r=await fetch(f.url,{method:'GET',cache:'no-store',credentials:'same-origin'});
            f.status=r.status; f.statusText=r.statusText||''; f.contentType=r.headers.get('content-type')||''; f.finalUrl=r.url||f.url;
            if(/text\/html/i.test(f.contentType)&&/\.(?:js|css)(?:\?|$)/i.test(f.url)) f.detail='Сервер вернул HTML вместо JS/CSS. Проверьте rewrite/404 fallback и document root.';
        }catch(err){ f.detail='Проверочный запрос не удался: '+safeText((err&&err.message)||err); }
        render();
    }
    function report(kind,message,url,detail){
        const f={kind,message,time:new Date().toLocaleTimeString(),url:url||'',detail:detail||''};
        failures.push(f);
        try{
            if(window.__somataScreenErrors&&typeof window.__somataScreenErrors.push==='function'){ window.__somataScreenErrors.push(kind,formatFailure(f)); }
            else render();
        }catch(_){render();}
        probe(f);
    }
    window.__somataReportAssetFailure=report;
    window.addEventListener('error',function(ev){
        const t=ev.target;
        if(t&&t!==window&&(t.tagName==='SCRIPT'||t.tagName==='LINK')){
            const url=resourceUrl(t);
            report('asset.error','Не удалось загрузить '+t.tagName.toLowerCase()+' ресурс.',url);
            return;
        }
        if(ev&&ev.filename){ report('boot.javascript',safeText(ev.message||'JavaScript error'),safeText(ev.filename),ev.lineno?('строка '+ev.lineno+(ev.colno?':'+ev.colno:'')):''); }
    },true);
    window.addEventListener('unhandledrejection',function(ev){
        if(window.__spiroAppBootComplete===true) return;
        report('boot.promise','Unhandled promise rejection во время запуска','',safeText((ev&&ev.reason&&ev.reason.stack)||(ev&&ev.reason&&ev.reason.message)||(ev&&ev.reason)));
    });
    window.addEventListener('DOMContentLoaded',function(){
        setTimeout(function(){
            if(document.visibilityState!=='visible'||window.__spiroAppBootComplete===true) return;
            report('boot.timeout','index.html загружен, но Somata не завершила запуск за 15 секунд.',location.href,'Если выше нет конкретного ресурса, откройте Network: вероятны кэш старых JS, неверный MIME или серверный rewrite.');
        },15000);
    });
})();
