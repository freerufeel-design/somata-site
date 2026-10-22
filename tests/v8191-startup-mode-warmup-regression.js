// Somata 8.19.1 — startup Corridor / Blue Morph GPU warmup regression.
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
function assert(x,msg){if(!x)throw Error(msg);}
const code=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
(async()=>{
    // Isolate the actual production allocation gate with a mock GPU renderer.
    const start=code.indexOf('            function prewarmCorridorCopies(count=256){');
    const end=code.indexOf('            function canUseIndexedMorphCorridor(commands){',start);
    assert(start>=0&&end>start,'production copy-ring prewarm not found');
    const functionSource=code.slice(start,end);
    const mock={ready:false,lost:false,device:{},WebGPUDeviceHub:{isReady:()=>true},lastError:'',calls:[],ensureCorridorCopyCapacity(n){this.calls.push(n);}};
    // Use an independent closure, like the production scope. No buffer contents are written.
    const warm=vm.runInNewContext(`(function(){let ready=false,lost=false,device={};let lastError='';const WebGPUDeviceHub={isReady:()=>true};const calls=[];function ensureCorridorCopyCapacity(n){calls.push(n)}\n${functionSource}\nreturn {prewarmCorridorCopies,calls,setReady(v){ready=v},setLost(v){lost=v},setDevice(v){device=v}};})()`,{});
    assert(warm.prewarmCorridorCopies(200)===false&&warm.calls.length===0,'prewarm before ready allocated');
    warm.setReady(true);
    assert(warm.prewarmCorridorCopies(10)===true&&warm.calls[0]===10,'prewarm after ready failed');
    assert(warm.prewarmCorridorCopies(9999)===true&&warm.calls[1]===256,'copy allocation not capped');
    warm.setLost(true);
    assert(warm.prewarmCorridorCopies(10)===false&&warm.calls.length===2,'prewarm after device lost allocated');
    assert(code.includes('void WebGPUDeviceHub.acquire().then('),'GPU acquisition not sequenced before prewarm');
    assert(code.includes('window.__somataStartupModeWarmupStatus='),'startup progress diagnostics missing');
    const h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:20000});
    try{
        const r=await h.evaluate(`(async()=>{
            const first=window.__somataStartupModeWarmupStatus?.();
            if(!first||typeof first.completed!=='boolean')throw Error('Missing warmup diagnostics');
            document.getElementById('btnTunnel').click();
            await new Promise(r=>setTimeout(r,110));
            const corridor=state.tunnel.active===true;
            document.getElementById('btnMorph').click();
            await new Promise(r=>setTimeout(r,240));
            const blue=runtimeState.morph.active===true;
            const frameOk=typeof renderMainCanvas==='function'&&typeof requestMainCanvasRender==='function';
            document.getElementById('btnMorph').click();
            document.getElementById('btnTunnel').click();
            await new Promise(r=>setTimeout(r,60));
            return {first,corridor,blue,frameOk,stopped:!runtimeState.morph.active&&!state.tunnel.active};
        })()`,{timeoutMs:16000,label:'Corridor then Blue startup'});
        assert(r.corridor&&r.blue&&r.frameOk&&r.stopped,'Corridor / Blue interaction failed: '+JSON.stringify(r));
        assert(!uncaughtExceptions(h.events).length,'Uncaught exceptions: '+uncaughtExceptions(h.events).join(' | '));
        console.log('V8191 STARTUP MODE WARMUP: PASS',JSON.stringify(r));
    }finally{await h.close();}
})().catch(err=>{console.error('V8191 STARTUP MODE WARMUP: FAIL',err.stack||err);process.exitCode=1;});
