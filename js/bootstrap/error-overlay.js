(function(){
    'use strict';

    const BUILD='20261015-v78101';
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
    let errorsPanel=null;
    let loadPanel=null;
    let loadOutput=null;
    let errorTabButton=null;
    let loadTabButton=null;
    let analysisToggleButton=null;
    let activeTab='errors';
    let analysisEnabled=false;
    let analysisTimer=0;
    let profilerSampleEveryBeforeAnalysis=null;
    let lastLoadCounters=null;
    let lastLoadCounterAt=0;
    let lastLoadSnapshot=null;
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

    try{autoShow=localStorage.getItem(AUTO_SHOW_STORAGE_KEY)==='1';}catch(_){}

    function fpsCounter(){return document.getElementById('fpsCounter');}
    function autoShowSetting(){return document.getElementById('autoShowErrorConsoleSetting');}
    function isMobileFpsMode(){
        try{return globalThis.matchMedia?.('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)')?.matches===true;}catch(_){return false;}
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

            if(first.startsWith('[Somata GPU fallback]'))return true;
            return Array.from(args||[]).some(value=>value&&typeof value==='object'&&value.diagnostic===true&&value.backend==='canvas'&&typeof value.reason==='string'&&/^(?:exact Canvas fill|isolated exact Canvas fill|authoritative static Canvas fill)$/i.test(value.reason.trim()));
        }catch(_){return false;}
    }

    function isImportantGpuWarning(args){
        try{
            const first=String(args?.[0]??'');
            return first.startsWith('[SpiroStar Fill] NOT DRAWN') ||
                first.startsWith('[Somata Performance]') ||
                first.startsWith('[Somata GPU diagnostic]') ||
                first.startsWith('[Somata Morph Freeze]') ||
                /^\[Somata [^\]]+ FullGPU\] (?:STRICT_SPIRAL_CANVAS_PATH_TOUCHED|FINAL_FULL_GPU_PRESENT_FAILED)$/.test(first);
        }catch(_){return false;}
    }

    function safeCall(name){
        try{const fn=globalThis?.[name];return typeof fn==='function'?fn():null;}catch(_){return null;}
    }

    function fmtMs(v){v=Number(v);return Number.isFinite(v)?`${v.toFixed(v>=100?0:(v>=10?1:2))} ms`:'—';}
    function fmtRate(v){v=Number(v);if(!Number.isFinite(v))return '—';const a=Math.abs(v);return a>=1000000?`${(v/1000000).toFixed(1)}M/s`:a>=1000?`${(v/1000).toFixed(1)}k/s`:`${v.toFixed(a>=100?0:(a>=10?1:2))}/s`;}
    function fmtPct(v){v=Number(v);return Number.isFinite(v)?`${Math.max(0,v).toFixed(v>=10?0:1)}%`:'—';}
    function flattenNumbers(value,prefix='',out={}){
        if(value==null)return out;
        if(typeof value==='number'&&Number.isFinite(value)){out[prefix]=value;return out;}
        if(typeof value!=='object'||Array.isArray(value))return out;
        for(const [k,v] of Object.entries(value)){const key=prefix?`${prefix}.${k}`:k;if(typeof v==='number'&&Number.isFinite(v))out[key]=v;else if(v&&typeof v==='object'&&!Array.isArray(v))flattenNumbers(v,key,out);}
        return out;
    }
    function counterRates(current,now){
        const flat=flattenNumbers(current||{}),rates={};
        if(lastLoadCounters&&lastLoadCounterAt>0){const dt=Math.max(.001,(now-lastLoadCounterAt)/1000);for(const [k,v] of Object.entries(flat)){const prev=lastLoadCounters[k];if(Number.isFinite(prev)&&v>=prev)rates[k]=(v-prev)/dt;}}
        lastLoadCounters=flat;lastLoadCounterAt=now;return rates;
    }
    function passLabel(name){
        const map={sweep:'Sweep / Lightning',layerPrepare:'Подготовка слоя / геометрии',base:'Base / контур',fill:'Fill',web:'Паутина',graffiti:'Graffiti',lamps:'Lamps',particles:'Particles',glow:'Glow',outline:'Outline',profile:'Profile',pathFx:'Path FX',framePrepare:'Подготовка кадра',lampGPU:'Lamp GPU',viewport:'Viewport'};
        return map[name]||name;
    }
    function collectLoadSnapshot(){
        const now=performance.now(),perf=safeCall('__spiroPerfSnapshot')||{},governor=perf.performanceGovernor||safeCall('__spiroPerformanceGovernorStatus')||{},scheduler=perf.animation||safeCall('__spiroAnimationStats')||{},finalGpu=safeCall('__spiroFinalGPUStatus')||{},lightning=(safeCall('__spiroGpuLightningArcPeekStatus')||{}),lightningBridge=safeCall('__spiroLightningGpuArcBridgeStatus')||{},gpuRuntime=safeCall('__somataGpuRuntimeDiagnostics')||{},hub=safeCall('__spiroWebGPUHubStatus')||{},mode=safeCall('__somataMorphFreezeContext')||{};
        const passEma=perf.passes?.ema||{},passLast=perf.passes?.last||{},profileTotal=Math.max(0,Number(passEma.total)||Number(passLast.total)||Number(perf.renderMs)||0);
        const aggregate=new Set(['total','layersTotal']);
        const cpuRows=Object.entries(passEma).filter(([name,v])=>!aggregate.has(name)&&Number.isFinite(Number(v))&&Number(v)>=.01).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,10).map(([name,ms])=>({name,label:passLabel(name),ms:Number(ms),pct:profileTotal>0?Number(ms)*100/profileTotal:0}));
        const paintMs=Math.max(0,Number(scheduler?.lastPaintMs)||Number(perf.renderMs)||0),tickMs=Math.max(0,Number(scheduler?.lastTickDurationMs)||0),unprofiled=Math.max(0,paintMs-profileTotal);
        const gpuTiming=finalGpu?.frameGraph?.gpuTiming||{},gpuEma=Math.max(0,Number(gpuTiming.emaMs)||Number(governor.emaGpuMs)||0),gpuLast=Math.max(0,Number(gpuTiming.lastMs)||0),fps=Math.max(0,Number(governor.emaFps)||0),budget=1000/Math.max(1,Number(governor.targetFps)||60);
        const counters={lightning:{frames:Number(lightning.frames)||0,draws:Number(lightning.draws)||0,strokeDraws:Number(lightning.strokeDraws)||0,logicalSegments:Number(lightning.logicalSegments)||0,exactRasterSubsegments:Number(lightning.exactRasterSubsegments)||0,arcEncodes:Number(lightning.arcEncodes)||0,arcReuses:Number(lightning.arcReuses)||0,bundleBuilds:Number(lightning.bundleBuilds)||0,bundleHits:Number(lightning.bundleHits)||0,bundleExecutes:Number(lightning.bundleExecutes)||0,failures:Number(lightning.failures)||0},bridge:{requests:Number(lightningBridge.requests)||0,hits:Number(lightningBridge.hits)||0,fallbacks:Number(lightningBridge.fallbacks)||0},hub:{uncapturedErrorCount:Number(hub.uncapturedErrorCount)||0,lostCount:Number(hub.lostCount)||0}};
        const rates=counterRates(counters,now);
        const candidates=[];
        if(cpuRows[0])candidates.push({label:cpuRows[0].label,ms:cpuRows[0].ms,kind:'CPU pass'});
        if(unprofiled>.5)candidates.push({label:'Driver / submit / present / непрофилированная часть renderMainCanvas',ms:unprofiled,kind:'main thread / driver'});
        if(gpuEma>.5)candidates.push({label:'GPU',ms:gpuEma,kind:'GPU timing'});
        if(Number(lightning.lastEncodeCpuMs)>.5)candidates.push({label:'Lightning encode (CPU)',ms:Number(lightning.lastEncodeCpuMs),kind:'Lightning'});
        candidates.sort((a,b)=>b.ms-a.ms);const hottest=candidates[0]||{label:'нет измеримого потребителя',ms:0,kind:'idle'};
        let bottleneck=String(governor.bottleneck||'unknown');
        if(bottleneck==='unknown'){
            if(gpuEma>=budget*.9)bottleneck='gpu';
            else if(unprofiled>=Math.max(8,profileTotal*.5))bottleneck='driver/present-or-unprofiled';
            else if(cpuRows[0]?.ms>=budget*.35)bottleneck='cpu-pass';
        }
        const latestError=entries.length?entries[entries.length-1].split('\n').slice(0,2).join(' — '):'';
        return{now,fps,budget,paintMs,tickMs,profileTotal,unprofiled,gpuEma,gpuLast,gpuSamples:Number(gpuTiming.samples)||0,gpuSupported:gpuTiming.supported===true,bottleneck,hottest,cpuRows,lightning,lightningBridge,rates,errorCount:entries.length,latestError,gpuRuntime,hub,mode};
    }
    function renderLoadText(){
        if(!loadOutput)return;
        if(!analysisEnabled){loadOutput.textContent='Анализ выключен. Нажмите «Анализ: ВКЛ», затем воспроизведите лаг — таблица будет обновляться в реальном времени.';return;}
        const s=collectLoadSnapshot();lastLoadSnapshot=s;
        const lines=[];const overload=s.budget>0?s.paintMs/s.budget:0;
        lines.push(`LIVE ${new Date().toLocaleTimeString([], {hour12:false})}   FPS ${s.fps?s.fps.toFixed(1):'—'}   budget ${fmtMs(s.budget)}`);
        const m=s.mode||{},activeMode=m.blue?.active?`Blue/${m.blue?.mode||'morph'}`:(m.minimal?.active?`Orange/${m.minimal?.mode||'minimal'}`:(m.project?.active?'Green/project':'Static'));
        lines.push(`Режим: ${activeMode}   layers=${Number(m.layers)||0}   spiral=${m.spiral?.type||'—'}${m.spiral?.corridorPhase?' + corridor-phase':''}`);
        lines.push(`Главный потребитель: ${s.hottest.label} — ${fmtMs(s.hottest.ms)}   [${s.hottest.kind}]`);
        lines.push(`Bottleneck: ${s.bottleneck}   render/paint ${fmtMs(s.paintMs)} (${overload.toFixed(1)}× budget)   tick ${fmtMs(s.tickMs)}`);
        lines.push(`Профилированный render: ${fmtMs(s.profileTotal)}   вне pass-профайлера: ${fmtMs(s.unprofiled)}   GPU EMA: ${s.gpuEma?fmtMs(s.gpuEma):'нет данных'} (${s.gpuSamples} samples)`);
        lines.push('');lines.push('CPU / render passes (EMA):');
        if(!s.cpuRows.length)lines.push('  — нет выборки; подождите несколько кадров');
        else s.cpuRows.forEach((r,i)=>lines.push(`  ${String(i+1).padStart(2,' ')}. ${r.label.padEnd(34,' ')} ${fmtMs(r.ms).padStart(9,' ')}   ${fmtPct(r.pct).padStart(6,' ')}`));
        lines.push('');lines.push('Lightning:');
        const l=s.lightning||{},r=s.rates||{};
        lines.push(`  encode CPU last/EMA/max: ${fmtMs(l.lastEncodeCpuMs)} / ${fmtMs(l.emaEncodeCpuMs)} / ${fmtMs(l.maxEncodeCpuMs)}   arc prepare ${fmtMs(l.lastArcPrepareCpuMs)}`);
        lines.push(`  stage=${l.lastStage||'—'} behavior=${l.lastBehavior||'—'} precision=${l.lastPrecision||'—'} raster×${Number(l.lastRasterSubdiv)||0} instances=${Number(l.lastInstances)||0} styles=${Number(l.lastStyleCount)||0}`);
        lines.push(`  exact raster: ${fmtRate(r['lightning.exactRasterSubsegments'])}   logical segments: ${fmtRate(r['lightning.logicalSegments'])}   stroke draws: ${fmtRate(r['lightning.strokeDraws'])}`);
        lines.push(`  arc encode/reuse: ${fmtRate(r['lightning.arcEncodes'])} / ${fmtRate(r['lightning.arcReuses'])}   failures: ${Number(l.failures)||0} (${fmtRate(r['lightning.failures'])})`);
        lines.push(`  bridge: requests=${Number(s.lightningBridge?.requests)||0} hits=${Number(s.lightningBridge?.hits)||0} fallbacks=${Number(s.lightningBridge?.fallbacks)||0} reason=${s.lightningBridge?.lastReason||'—'}`);
        if(l.lastError)lines.push(`  renderer error: ${String(l.lastError)}`);
        lines.push('');lines.push(`Ошибки FPS-консоли: ${s.errorCount}   WebGPU uncaptured: ${Number(s.hub?.uncapturedErrorCount)||0}   device lost: ${Number(s.hub?.lostCount)||0}`);
        if(s.latestError)lines.push(`Последняя: ${s.latestError}`);
        if(s.gpuRuntime?.last?.reason)lines.push(`Последняя GPU-диагностика: ${s.gpuRuntime.last.feature}/${s.gpuRuntime.last.stage} — ${s.gpuRuntime.last.reason}`);
        if(s.unprofiled>=Math.max(8,s.profileTotal*.5)&&!s.gpuEma)lines.push('\nПодсказка: большая непрофилированная часть при отсутствии GPU timestamps обычно означает driver submit/present, sync/validation или другой браузерный paint вне отдельных JS-pass’ов.');
        loadOutput.textContent=lines.join('\n');
    }
    function stopAnalysisSampling(){
        if(analysisTimer){clearInterval(analysisTimer);analysisTimer=0;}
        const profiler=globalThis.__spiroPassProfiler;
        if(profiler&&profilerSampleEveryBeforeAnalysis!==null){profiler.sampleEvery=profilerSampleEveryBeforeAnalysis;profilerSampleEveryBeforeAnalysis=null;}
    }
    function updateAnalysisSampling(){
        const shouldRun=analysisEnabled&&visible&&!collapsed&&activeTab==='load';
        if(!shouldRun){stopAnalysisSampling();return;}
        const profiler=globalThis.__spiroPassProfiler;
        if(profiler&&profilerSampleEveryBeforeAnalysis===null){profilerSampleEveryBeforeAnalysis=Math.max(1,Number(profiler.sampleEvery)||10);profiler.sampleEvery=1;}
        if(!analysisTimer){lastLoadCounters=null;lastLoadCounterAt=0;renderLoadText();analysisTimer=setInterval(()=>{if(analysisEnabled&&visible&&!collapsed&&activeTab==='load')renderLoadText();},350);}
    }
    function setAnalysisEnabled(next){
        analysisEnabled=next===true;
        if(analysisToggleButton){analysisToggleButton.textContent=analysisEnabled?'Анализ: ВКЛ':'Анализ: ВЫКЛ';analysisToggleButton.classList.toggle('is-enabled',analysisEnabled);analysisToggleButton.setAttribute('aria-pressed',String(analysisEnabled));}
        if(!analysisEnabled){lastLoadCounters=null;lastLoadCounterAt=0;}
        updateAnalysisSampling();if(activeTab==='load')renderLoadText();return analysisEnabled;
    }
    function setTab(tab){
        activeTab=tab==='load'?'load':'errors';
        errorTabButton?.classList.toggle('is-active',activeTab==='errors');loadTabButton?.classList.toggle('is-active',activeTab==='load');
        errorTabButton?.setAttribute('aria-selected',String(activeTab==='errors'));loadTabButton?.setAttribute('aria-selected',String(activeTab==='load'));dock?.classList.toggle('is-load-tab',activeTab==='load');
        if(errorsPanel)errorsPanel.hidden=activeTab!=='errors';if(loadPanel)loadPanel.hidden=activeTab!=='load';
        if(activeTab==='load')renderLoadText();else if(dock?.isConnected&&output){output.textContent=entries.length?entries.join('\n\n'):'Ошибок нет.';if(countNode)countNode.textContent=String(entries.length);}
        updateAnalysisSampling();return activeTab;
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
        updateAnalysisSampling();
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
        updateAnalysisSampling();
    }

    function render(){
        if(!ensureDock())return;
        const wasNearBottom=!body||body.scrollHeight-body.scrollTop-body.clientHeight<32;
        output.textContent=entries.length?entries.join('\n\n'):'Ошибок нет.';
        countNode.textContent=String(entries.length);
        if(activeTab==='load')renderLoadText();
        dock.hidden=!visible;
        setCollapsed(collapsed);
        updateFpsErrorState();
        if(visible&&!collapsed&&body&&(wasNearBottom||entries.length===1))body.scrollTop=body.scrollHeight;
    }

    function toggleVisible(){
        ensureDock();
        if(!visible){
            render();

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

        if(activeTab==='errors'&&visible)render();
        if(clearDevtools){try{nativeConsoleClear?.();}catch(_){}}
        updateFpsErrorState();
        return true;
    }

    function shieldViewportGestures(node){

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
        dock.setAttribute('aria-label','FPS консоль: ошибки и анализ нагрузки');
        dock.setAttribute('aria-hidden',String(!visible));
        dock.dataset.build=BUILD;

        const header=document.createElement('div');
        header.id='screenErrorOverlayHeader';

        const title=document.createElement('div');
        title.id='screenErrorOverlayTitle';
        title.textContent='FPS консоль';
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
        const tabs=document.createElement('div');
        tabs.id='screenErrorOverlayTabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Разделы FPS консоли');
        errorTabButton=makeButton('screenErrorOverlayTabErrors','Ошибки','Показать ошибки и GPU-диагностику');errorTabButton.setAttribute('role','tab');
        loadTabButton=makeButton('screenErrorOverlayTabLoad','Нагрузка','Показать анализ нагрузки в реальном времени');loadTabButton.setAttribute('role','tab');
        analysisToggleButton=makeButton('screenErrorOverlayAnalyze','Анализ: ВЫКЛ','Включить непрерывный анализ нагрузки');analysisToggleButton.setAttribute('aria-pressed','false');
        errorTabButton.addEventListener('click',()=>setTab('errors'));loadTabButton.addEventListener('click',()=>setTab('load'));analysisToggleButton.addEventListener('click',()=>setAnalysisEnabled(!analysisEnabled));
        tabs.append(errorTabButton,loadTabButton,analysisToggleButton);
        errorsPanel=document.createElement('div');errorsPanel.id='screenErrorOverlayErrorsPanel';errorsPanel.setAttribute('role','tabpanel');
        output=document.createElement('pre');
        output.id='screenErrorOverlayText';
        output.setAttribute('aria-label','Текст ошибок');
        output.tabIndex=0;errorsPanel.appendChild(output);
        loadPanel=document.createElement('div');loadPanel.id='screenErrorOverlayLoadPanel';loadPanel.setAttribute('role','tabpanel');
        loadOutput=document.createElement('pre');loadOutput.id='screenErrorOverlayLoadText';loadOutput.setAttribute('aria-label','Анализ нагрузки');loadOutput.tabIndex=0;loadPanel.appendChild(loadOutput);
        body.append(tabs,errorsPanel,loadPanel);
        dock.append(header,body);setTab(activeTab);
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

        if(autoShow){setTab('errors');setVisible(true);}
        if(visible&&!collapsed){if(activeTab==='errors')render();else{if(countNode)countNode.textContent=String(entries.length);updateFpsErrorState();renderLoadText();}}
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

            nativeConsoleError(...args);
            if(isExpectedGpuFallback(args))return;
            try{push('console.error',formatArgs(args));}catch(_){}
        };
    }

    let lastPerformanceWarningAt=-Infinity;
    if(nativeConsoleWarn){
        console.warn=function(...args){
            nativeConsoleWarn(...args);

            if(!isImportantGpuWarning(args))return;
            // Do not flood the on-screen console with 60 performance events/s.
            const first=String(args?.[0]??'');
            if(first.startsWith('[Somata Performance]')){
                const now=performance.now();
                if(now-lastPerformanceWarningAt<3000)return;
                lastPerformanceWarningAt=now;
            }
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
        setAutoShow:value=>setAutoShow(value),
        setTab:value=>{ensureDock();return setTab(value);},
        setAnalysis:value=>{ensureDock();return setAnalysisEnabled(value);},
        get activeTab(){return activeTab;},
        get analysisEnabled(){return analysisEnabled;},
        get loadSnapshot(){return lastLoadSnapshot;}
    };
})();
