(function(){
    'use strict';

    // Somata in-app error console. It is a bottom dock owned by the page, not a
    // transient text overlay on the canvas. Errors are collected immediately;
    // automatic opening is opt-in and is OFF by default for this console version.
    const BUILD='20261011-error-console-v724-hotfix5';
    const MAX_ENTRIES=160;
    const MAX_TEXT_CHARS=140000;
    const MAX_ENTRY_CHARS=18000;
    const MAX_STRINGIFY_DEPTH=5;
    const MAX_OBJECT_KEYS=24;
    const MAX_ARRAY_ITEMS=16;
    const AUTO_SHOW_STORAGE_KEY='somata.errorConsole.autoShow.v4';
    const entries=[];
    let dock=null;
    let body=null;
    let output=null;
    let countNode=null;
    let collapseButton=null;
    let totalChars=0;
    let sequence=0;
    let visible=false;
    let collapsed=true;
    let autoShow=false;

    const nativeConsoleError=typeof console!=='undefined'&&typeof console.error==='function'
        ? console.error.bind(console)
        : null;
    const nativeConsoleClear=typeof console!=='undefined'&&typeof console.clear==='function'
        ? console.clear.bind(console)
        : null;
    const nativeConsoleWarn=typeof console!=='undefined'&&typeof console.warn==='function'
        ? console.warn.bind(console)
        : null;

    // A new storage key deliberately makes the shipped default OFF even if an older
    // experimental build left its previous auto-show key enabled in localStorage.
    try{autoShow=localStorage.getItem(AUTO_SHOW_STORAGE_KEY)==='1';}catch(_){}

    function fpsCounter(){return document.getElementById('fpsCounter');}
    function autoShowSetting(){return document.getElementById('autoShowErrorConsoleSetting');}
    function isMobileFpsMode(){
        try{return globalThis.matchMedia?.('(max-width: 760px)')?.matches===true;}catch(_){return false;}
    }

    let copyToastTimer=0;
    function showCopyToast(copied){
        if(!document.body)return;
        let toast=document.getElementById('somataErrorCopyToast');
        if(!toast){
            toast=document.createElement('div');
            toast.id='somataErrorCopyToast';
            toast.setAttribute('role','status');
            toast.setAttribute('aria-live','polite');
            document.body.appendChild(toast);
        }
        toast.textContent=copied?'Ошибки скопированы':'Не удалось скопировать ошибки';
        toast.classList.add('is-visible');
        clearTimeout(copyToastTimer);
        copyToastTimer=setTimeout(()=>toast.classList.remove('is-visible'),1300);
    }

    async function copyErrorsFromFps(){
        const copied=await copyAllErrors();
        showCopyToast(copied);
        return copied;
    }

    function stringify(value,seen,depth=0){
        if(typeof value==='string')return value.length>4000?`${value.slice(0,4000)}…[truncated]`:value;
        if(value instanceof Error){const text=value.stack||`${value.name||'Error'}: ${value.message||''}`;return text.length>6000?`${text.slice(0,6000)}…[truncated]`:text;}
        if(value===undefined)return 'undefined';
        if(value===null)return 'null';
        if(typeof value==='function')return `[Function ${value.name||'anonymous'}]`;
        if(typeof value==='bigint')return `${value}n`;
        if(typeof value==='symbol')return String(value);
        if(typeof value!=='object')return String(value);
        if(depth>=MAX_STRINGIFY_DEPTH)return Array.isArray(value)?`[Array(${value.length}) …]`:'{…}';
        if(seen.has(value))return '[Circular]';
        seen.add(value);
        try{
            if(Array.isArray(value)){
                const n=Math.min(value.length,MAX_ARRAY_ITEMS),items=[];
                for(let i=0;i<n;i++)items.push(stringify(value[i],seen,depth+1));
                return `[${items.join(', ')}${value.length>n?', …':''}]`;
            }
            const keys=Object.keys(value),shown=keys.slice(0,MAX_OBJECT_KEYS);
            const bodyText=shown.map(k=>`${k}: ${stringify(value[k],seen,depth+1)}`).join(', ');
            return `{${bodyText}${keys.length>shown.length?', …':''}}`;
        }catch(_){
            try{return String(value);}catch(__){return '[Unprintable value]';}
        }finally{seen.delete(value);}
    }

    function formatArgs(args){
        const seen=new WeakSet();
        const text=Array.from(args||[]).map(v=>stringify(v,seen,0)).join(' ');
        return text.length>MAX_ENTRY_CHARS?`${text.slice(0,MAX_ENTRY_CHARS)}
…[diagnostic truncated to keep UI responsive]`:text;
    }

    function isExpectedGpuFallback(args){
        try{
            const first=String(args?.[0]??'');
            // Only known-benign backend telemetry is suppressed. Strict Spiral / FullGPU
            // diagnostics are intentionally NOT filtered: they can correlate with visible
            // corruption and must be available in the in-app console for bug reports.
            if(first.startsWith('[Somata GPU fallback]'))return true;
            return Array.from(args||[]).some(value=>value&&typeof value==='object'&&value.diagnostic===true&&value.backend==='canvas'&&typeof value.reason==='string'&&/^(?:exact Canvas fill|isolated exact Canvas fill|authoritative static Canvas fill)$/i.test(value.reason.trim()));
        }catch(_){return false;}
    }

    function isImportantGpuWarning(args){
        try{
            const first=String(args?.[0]??'');
            return first.startsWith('[Somata GPU diagnostic]') ||
                first.startsWith('[Somata Morph Freeze]') ||
                /^\[Somata [^\]]+ FullGPU\] (?:STRICT_SPIRAL_CANVAS_PATH_TOUCHED|FINAL_FULL_GPU_PRESENT_FAILED)$/.test(first);
        }catch(_){return false;}
    }

    function makeButton(id,text,title){
        const button=document.createElement('button');
        button.id=id;
        button.type='button';
        button.textContent=text;
        button.title=title;
        button.setAttribute('aria-label',title);
        return button;
    }

    function updateFpsErrorState(){
        const fps=fpsCounter();
        if(!fps)return;
        const count=entries.length;
        const mobileCopy=isMobileFpsMode();
        if(count>0){
            fps.dataset.errorCount=String(count);
            fps.classList.add('has-errors');
            fps.title=mobileCopy?`Ошибок: ${count}. Нажмите, чтобы скопировать.`:`Консоль ошибок: ${count}. Нажмите, чтобы ${visible?'закрыть':'открыть'}.`;
            fps.setAttribute('aria-label',mobileCopy?`Текущая частота отрисовки. Ошибок: ${count}. Нажмите, чтобы скопировать ошибки.`:`Текущая частота отрисовки. Ошибок в консоли: ${count}. Нажмите, чтобы ${visible?'закрыть':'открыть'} консоль.`);
        }else{
            delete fps.dataset.errorCount;
            fps.classList.remove('has-errors');
            fps.title=mobileCopy?'Ошибок нет. Нажмите, чтобы скопировать текущий список.':`Консоль ошибок пуста. Нажмите, чтобы ${visible?'закрыть':'открыть'} консоль.`;
            fps.setAttribute('aria-label',mobileCopy?'Текущая частота отрисовки. Ошибок нет. Нажмите, чтобы скопировать текущий список ошибок.':`Текущая частота отрисовки. Консоль ошибок пуста. Нажмите, чтобы ${visible?'закрыть':'открыть'} консоль.`);
        }
        fps.setAttribute('role','button');
        fps.setAttribute('tabindex','0');
        fps.setAttribute('aria-expanded',String(visible));
    }

    function setCollapsed(next){
        collapsed=!!next;
        if(!dock)return;
        dock.classList.toggle('is-collapsed',collapsed);
        if(body)body.hidden=collapsed;
        if(collapseButton){
            collapseButton.textContent=collapsed?'▴':'▾';
            collapseButton.title=collapsed?'Развернуть консоль ошибок':'Свернуть консоль ошибок вниз';
            collapseButton.setAttribute('aria-label',collapseButton.title);
            collapseButton.setAttribute('aria-expanded',String(!collapsed));
        }
    }

    function setVisible(next,{expand=false}={}){
        visible=!!next;
        if(expand&&visible)collapsed=false;
        if(dock){
            dock.hidden=!visible;
            dock.setAttribute('aria-hidden',String(!visible));
            setCollapsed(collapsed);
        }
        updateFpsErrorState();
    }

    function render(){
        if(!ensureDock())return;
        const wasNearBottom=!body||body.scrollHeight-body.scrollTop-body.clientHeight<32;
        output.textContent=entries.length?entries.join('\n\n'):'Ошибок нет.';
        countNode.textContent=String(entries.length);
        dock.hidden=!visible;
        setCollapsed(collapsed);
        updateFpsErrorState();
        if(visible&&!collapsed&&body&&(wasNearBottom||entries.length===1))body.scrollTop=body.scrollHeight;
    }

    function toggleVisible(){
        ensureDock();
        if(!visible){
            render();
            // Opening from FPS must preserve the user's collapse/expand choice.
            // A freshly created console starts collapsed and is expanded only manually.
            setVisible(true);
            requestAnimationFrame(()=>{if(body&&!collapsed)body.scrollTop=body.scrollHeight;});
        }else setVisible(false);
        return visible;
    }

    async function copyAllErrors(button=null){
        const text=entries.length?entries.join('\n\n'):'Ошибок нет.';
        let copied=false;
        try{
            if(navigator?.clipboard?.writeText){await navigator.clipboard.writeText(text);copied=true;}
        }catch(_){}
        if(!copied){
            try{
                const ta=document.createElement('textarea');
                ta.value=text;ta.setAttribute('readonly','');
                Object.assign(ta.style,{position:'fixed',left:'-9999px',top:'0',opacity:'0'});
                document.body.appendChild(ta);ta.select();copied=document.execCommand('copy')===true;ta.remove();
            }catch(_){}
        }
        if(button){
            const prev=button.textContent;button.textContent=copied?'Скопировано':'Не скопировано';button.disabled=true;
            setTimeout(()=>{button.textContent=prev;button.disabled=false;},900);
        }
        return copied;
    }

    function clearErrors({clearDevtools=true}={}){
        entries.length=0;
        totalChars=0;
        if(output)output.textContent='Ошибок нет.';
        if(countNode)countNode.textContent='0';
        // Clearing must not erase the user's manual collapsed/expanded preference.
        setVisible(false);
        if(clearDevtools){try{nativeConsoleClear?.();}catch(_){}}
        updateFpsErrorState();
        return true;
    }

    function shieldViewportGestures(node){
        // The workspace owns wheel zoom / pan. Interaction in this dock must never
        // leak into mainContainer, including listeners registered later by app-c.js.
        const stop=e=>e.stopPropagation();
        ['mousedown','mouseup','click','dblclick','contextmenu','pointerdown','pointerup','pointermove','touchstart','touchmove','touchend'].forEach(type=>{
            node.addEventListener(type,stop,{passive:type.startsWith('touch')});
        });
        node.addEventListener('wheel',stop,{passive:true});
    }

    function ensureDock(){
        if(dock&&dock.isConnected)return true;
        if(!document.body)return false;

        dock=document.createElement('section');
        dock.id='screenErrorOverlay';
        dock.className='somata-error-console no-viewport-gesture';
        dock.hidden=!visible;
        dock.setAttribute('role','region');
        dock.setAttribute('aria-live','polite');
        dock.setAttribute('aria-label','Консоль ошибок приложения');
        dock.setAttribute('aria-hidden',String(!visible));
        dock.dataset.build=BUILD;

        const header=document.createElement('div');
        header.id='screenErrorOverlayHeader';

        const title=document.createElement('div');
        title.id='screenErrorOverlayTitle';
        title.textContent='Консоль ошибок';
        countNode=document.createElement('span');
        countNode.id='screenErrorOverlayCount';
        countNode.textContent=String(entries.length);
        title.append(' ',countNode);

        const actions=document.createElement('div');
        actions.id='screenErrorOverlayActions';
        const copyButton=makeButton('screenErrorOverlayCopy','Копировать всё','Скопировать весь текст консоли');
        const clearButton=makeButton('screenErrorOverlayClear','Clear console','Очистить консоль');
        collapseButton=makeButton('screenErrorOverlayCollapse','▾','Свернуть консоль ошибок вниз');
        const closeButton=makeButton('screenErrorOverlayClose','×','Закрыть консоль ошибок');
        collapseButton.setAttribute('aria-expanded','true');
        copyButton.addEventListener('click',()=>{void copyAllErrors(copyButton);});
        clearButton.addEventListener('click',()=>clearErrors());
        collapseButton.addEventListener('click',()=>{const next=!collapsed;setCollapsed(next);if(!next)render();});
        closeButton.addEventListener('click',()=>setVisible(false));
        actions.append(copyButton,clearButton,collapseButton,closeButton);
        header.append(title,actions);

        body=document.createElement('div');
        body.id='screenErrorOverlayBody';
        output=document.createElement('pre');
        output.id='screenErrorOverlayText';
        output.setAttribute('aria-label','Текст ошибок');
        output.tabIndex=0;
        body.appendChild(output);
        dock.append(header,body);
        shieldViewportGestures(dock);
        document.body.appendChild(dock);
        setCollapsed(collapsed);
        return true;
    }

    function push(kind,message){
        const text=String(message||'Unknown error').trim()||'Unknown error';
        const stamp=new Date().toLocaleTimeString([], {hour12:false});
        const rec=`[${stamp}] ${kind}\n${text}`;
        entries.push(rec);
        totalChars+=rec.length;
        while(entries.length>MAX_ENTRIES||totalChars>MAX_TEXT_CHARS){
            const removed=entries.shift();
            totalChars-=removed.length;
        }
        sequence++;
        // Hotfix2: diagnostics can contain deep GPU status trees. Do not rewrite the entire
        // hidden/collapsed <pre> for every warning; entries remain authoritative and are
        // rendered on demand when the console is actually opened/expanded.
        if(autoShow)setVisible(true);
        if(visible&&!collapsed)render();
        else{if(countNode)countNode.textContent=String(entries.length);updateFpsErrorState();}
    }

    function setAutoShow(next,{persist=true}={}){
        autoShow=next===true;
        const setting=autoShowSetting();
        if(setting)setting.checked=autoShow;
        if(persist){try{localStorage.setItem(AUTO_SHOW_STORAGE_KEY,autoShow?'1':'0');}catch(_){}}
        return autoShow;
    }

    if(nativeConsoleError){
        console.error=function(...args){
            // Keep DevTools useful, but do not promote expected GPU->Canvas backend telemetry
            // to an application error. Real console.error calls still enter the Somata dock.
            nativeConsoleError(...args);
            if(isExpectedGpuFallback(args))return;
            try{push('console.error',formatArgs(args));}catch(_){}
        };
    }

    if(nativeConsoleWarn){
        console.warn=function(...args){
            nativeConsoleWarn(...args);
            // Do not mirror every warning. Capture only GPU diagnostics that indicate a
            // failed strict frame / blocked GPU path, because these can explain visible
            // Spiral artefacts even when the browser did not throw a WebGPU exception.
            if(!isImportantGpuWarning(args))return;
            try{
                const first=String(args?.[0]??'');
                push(first.startsWith('[Somata Morph Freeze]')?'morph.freeze':'gpu.warning',formatArgs(args));
            }catch(_){}
        };
    }

    window.addEventListener('error',event=>{
        try{
            const where=[event?.filename,event?.lineno,event?.colno].filter(Boolean).join(':');
            const detail=event?.error?.stack||event?.error?.message||event?.message||'window error';
            push('error',where?`${detail}\n${where}`:detail);
        }catch(_){}
    });

    window.addEventListener('unhandledrejection',event=>{
        try{push('unhandledrejection',formatArgs([event?.reason||'Unhandled promise rejection']));}catch(_){}
    });

    function syncControls(){
        const setting=autoShowSetting();
        if(setting){
            setting.checked=autoShow;
            if(!setting.dataset.somataErrorConsoleBound){
                setting.dataset.somataErrorConsoleBound='1';
                setting.addEventListener('change',event=>{
                    event.stopPropagation();
                    setAutoShow(event.currentTarget?.checked===true);
                });
            }
        }
        updateFpsErrorState();
    }

    // Delegated CAPTURE handlers make FPS toggling survive any later DOM/event rebinding.
    // This also wins over canvas/workspace handlers installed after this bootstrap script.
    document.addEventListener('click',event=>{
        const fps=event.target?.closest?.('#fpsCounter');
        if(!fps)return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if(isMobileFpsMode()){void copyErrorsFromFps();return;}
        toggleVisible();
    },true);
    document.addEventListener('keydown',event=>{
        const fps=event.target?.closest?.('#fpsCounter');
        if(!fps||(event.key!=='Enter'&&event.key!==' '))return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if(isMobileFpsMode()){void copyErrorsFromFps();return;}
        toggleVisible();
    },true);

    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',syncControls,{once:true});
    else syncControls();

    window.__somataScreenErrors={
        build:BUILD,
        get count(){return sequence;},
        get entries(){return entries.slice();},
        get visible(){return visible;},
        get autoShow(){return autoShow;},
        clear:()=>clearErrors(),
        copyAll:()=>copyAllErrors(),
        close:()=>{setVisible(false);return true;},
        toggle:()=>toggleVisible(),
        collapse:()=>{ensureDock();setCollapsed(true);return true;},
        expand:()=>{ensureDock();setVisible(true,{expand:true});render();return true;},
        push:(kind,message)=>push(kind,message),
        setAutoShow:value=>setAutoShow(value)
    };
})();
