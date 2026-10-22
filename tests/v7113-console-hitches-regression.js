// 7.11.3: closed audio panels never repaint meters, visible meters deduplicate
// writes, and a warming GPU Fill does not become an early permanent failure.
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const assert=(ok,why)=>{if(!ok)throw new Error(why)};
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const gpu=read('js/app/geometry-gpu-core.js');
const ui=read('js/app/ui-project-runtime.js');
const fill=read('js/render/fill-pass.js');
const between=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert(a>=0&&b>a,'Cannot find regression boundary '+start);return text.slice(a,b)};
const fn=between(gpu,'        function paintAudioRoutingMeters(){','        function toggleAudioRouteGroupWithMemory(');
let panelHidden=true,bandValue=0.4562,levelWrites=0,colorWrites=0,bandCalls=0,queryCount=0;
const dot={style:{setProperty(){colorWrites++}}};
const row={dataset:{band:'mid',derivative:'0'},style:{setProperty(){levelWrites++}},querySelector(){return dot}};
const panel={classList:{contains(name){return name==='hidden'&&panelHidden}},querySelectorAll(sel){queryCount++;assert(sel==='.audio-route-row','wrong meter selector');return[row]}};
const audioContext={document:{getElementById(id){assert(id==='audioRoutingPanel','wrong panel');return panel}},audioBandValue(){bandCalls++;return bandValue},AUDIO_BAND_COLORS:{mid:'#345678'}};
vm.runInNewContext(fn+';this.paint=paintAudioRoutingMeters;',audioContext);
for(let i=0;i<1000;i++)audioContext.paint();
assert(queryCount===0&&bandCalls===0&&levelWrites===0&&colorWrites===0,'Closed routing panel is still doing per-row DOM/audio work');
panelHidden=false;audioContext.paint();
assert(queryCount===1&&bandCalls===1&&levelWrites===1&&colorWrites===1,'First visible frame must render meters');
for(let i=0;i<100;i++)audioContext.paint();
assert(levelWrites===1&&colorWrites===1,'Unchanged levels are still invalidating CSS styles');
bandValue=0.7;audioContext.paint();assert(levelWrites===2,'Live meter no longer responds to audio changes');
panelHidden=true;audioContext.paint();assert(levelWrites===2,'Closed panel performed a write');
// Rendering to audioReactivePanel must be conditional; audio analysis and
// routing always continue independently of the panel's visibility.
const audioTick=between(ui,'        function audioReactiveFrame(now = performance.now()) {','        function isMobileAudioEnvironment()');
assert(audioTick.includes("audioPanel&&!audioPanel.classList.contains('hidden')"),'Main audio meter updates not guarded by panel visibility');
assert(audioTick.includes('paintAudioRoutingMeters();')&&audioTick.includes('requestMainCanvasRender();'),'Audio routing or frame invalidation was disabled by meter optimization');
assert(audioTick.includes('ar.analyser.getByteFrequencyData(ar.data)'),'Audio FFT analysis must remain active with hidden panels');
const warmFn=between(fill,'function isFillGpuWarming(frameCtx){','function noteFillFailureOnce(');
let clock=0,state={nativeMesh:{initializing:true,available:false,lastError:'',lost:false},webgpuMask:{initializing:true,available:false,lastError:'',lost:false}};
const warmCtx={FillGPURenderer:{status:()=>state},performance:{now:()=>clock},fillWarmupStartedAtByLayer:new Map(),FILL_WARMUP_GRACE_MS:2500};
vm.runInNewContext(warmFn+';this.check=isFillGpuWarming;',warmCtx);
const frameCtx={layer:{id:'L1'},effectLayer:{id:'L1'}};
assert(warmCtx.check(frameCtx),'Cold Fill GPU init must be treated as waiting');
clock=2200;assert(warmCtx.check(frameCtx),'Valid initial warmup was prematurely classified as failure');
clock=2700;assert(!warmCtx.check(frameCtx),'Stuck GPU initialization must become a reportable error');
state={nativeMesh:{initializing:false,available:false,lastError:'bad shader'},webgpuMask:{initializing:false,available:false,lastError:''}};
assert(!warmCtx.check(frameCtx),'GPU validation failure was hidden as warmup');
assert(warmCtx.fillWarmupStartedAtByLayer.size===0,'Resolved/failed warmup bookkeeping not cleaned');
state={nativeMesh:{initializing:false,available:true,lastError:''},webgpuMask:{initializing:true,available:false,lastError:''}};
assert(!warmCtx.check(frameCtx),'GPU Fill already ready: deferred incorrectly');
assert(fill.indexOf('if(isFillGpuWarming(frameCtx)){')<fill.indexOf('fillMaskValidationStats.canvasFallback++;stats.misses++;'),'Warmup classification must run before permanent failure accounting');
console.log('PASS 7.11.3 console hitch mitigation: hidden audio DOM, stable active meters, GPU Fill startup/grace/failure paths');
