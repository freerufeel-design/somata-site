const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const {ROOT,read,scriptsFromIndex,assert}=require('./lib/test-utils');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function findChromium(){for(const p of [process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'])if(p&&fs.existsSync(p))return p;throw new Error('Chromium not found; set CHROME_BIN');}
async function json(url,options){const r=await fetch(url,options);if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json();}
async function main(){
  const chrome=findChromium(),port=9300+Math.floor(Math.random()*500),profile=path.join('/tmp',`somata-preflight-${process.pid}-${Date.now()}`);
  const proc=cp.spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${port}`,'--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let ws;
  try{
    let ready=false;for(let i=0;i<60;i++){try{await json(`http://127.0.0.1:${port}/json/version`);ready=true;break;}catch{await sleep(100);}}if(!ready)throw new Error('Chromium DevTools did not start');
    const target=await json(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'});ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
    let id=0;const pending=new Map(),events=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}else events.push(m);};
    const call=(method,params={})=>new Promise(resolve=>{const i=++id;pending.set(i,resolve);ws.send(JSON.stringify({id:i,method,params}));});
    const evaluate=async(expression,returnByValue=true)=>{const m=await call('Runtime.evaluate',{expression,returnByValue,awaitPromise:true});const ex=m.result?.exceptionDetails;if(ex)throw new Error(ex.exception?.description||ex.text||'Runtime.evaluate failed');return m.result?.result?.value;};
    await call('Runtime.enable');await call('Page.enable');await call('Log.enable');
    const bareHtml=read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*(?:stylesheet|manifest)[^>]*>/gi,'');
    await evaluate(`document.open();document.write(${JSON.stringify(bareHtml)});document.close();`);
    const scripts=scriptsFromIndex();
    for(const rel of scripts){const code=read(rel)+`\n//# sourceURL=${rel}`;await evaluate(code,false);console.log(`PASS browser load ${rel}`);}
    await evaluate(`document.dispatchEvent(new Event('DOMContentLoaded'));window.dispatchEvent(new Event('load'));`);await sleep(350);
    const expected=['requestMainCanvasRender','renderMainCanvas','renderLayerSweepPass','renderLayerLampPass','prepareLampDrawStyle','prepareLampVisualPlan','buildMorphGeometry','invalidateLayerGeometry','liveEffectOwnerForFrameLayer','WebGPUCanonicalSweepRenderer','WebGPUGraffitiRibbonRenderer','WebGPUWebThreadSceneRenderer','LampGPURenderer','WebGPUParticleRenderer'];
    const types=await evaluate(`Object.fromEntries(${JSON.stringify(expected)}.map(n=>[n,typeof globalThis[n]==='undefined'?eval('typeof '+n):typeof globalThis[n]]))`);
    for(const n of expected)assert(types[n]!=='undefined',`browser binding missing: ${n}`);console.log('PASS browser critical bindings');
    const moduleState=await evaluate(`({boot:window.__spiroAppBootComplete===true,loaded:Object.keys(window.__spiroModules||{}),assetFailures:(window.__somataAssetFailures||[]).length})`);
    assert(moduleState.boot,'app boot marker missing');assert(moduleState.assetFailures===0,`boot asset failures=${moduleState.assetFailures}`);for(const rel of scripts.filter(x=>!x.startsWith('js/bootstrap/'))){const key=rel.replace(/\.js$/,'');assert(moduleState.loaded.includes(rel)||moduleState.loaded.includes(key),`module did not register: ${rel}`);}console.log('PASS browser module registry');
    const geom=await evaluate(`(()=>{const l=createLayer('preflight-geometry');l.N=4;l.K=1;l.radius=100;const sig=x=>(x||[]).flatMap(p=>p.points||[]).slice(0,32).reduce((s,p)=>s+(Number(p.x)||0)*.73+(Number(p.y)||0)*1.17,0);const a=sig(buildMorphGeometry(l,48));l.N=7;invalidateLayerGeometry(l,'preflight');const b=sig(buildMorphGeometry(l,48));return {a,b,diff:Math.abs(a-b)};})()`);
    assert(Number.isFinite(geom.diff)&&geom.diff>1e-4,`geometry did not change after invalidation: ${JSON.stringify(geom)}`);console.log('PASS browser geometry invalidation/rebuild');
    const lamp=await evaluate(`(()=>{beginLampAdaptiveFrame();const layer=createLayer('preflight-lamp');const cfg={...state.lamps,radius:20,radiusMultiplier:1,brightness:100,adaptiveBrightness:false,color:'#ff0000',colorMode:'selected',scatter:0,sizeVariation:0,brightnessVariation:0};const style=prepareLampDrawStyle(cfg,-1,1,1,1,{});const plan=prepareLampVisualPlan([{x:10,y:20,lampLevel:1,lampPresence:1}],layer,cfg,style,-1,{items:[]});return {count:plan.items.length,rad:plan.items[0]?.rad,brightness:plan.items[0]?.brightness,color:plan.items[0]?.color};})()`);
    assert(lamp.count===1&&lamp.rad>0&&lamp.brightness>0,`lamp preparation failed: ${JSON.stringify(lamp)}`);console.log('PASS browser lamp preparation');
    const live=await evaluate(`(()=>{const l=createLayer('preflight-live');state.layers.push(l);try{const snap={...l,showWeb:false,sweep:{...l.sweep,enabled:false,profileShape:'line'}};l.showWeb=true;l.sweep.enabled=true;l.sweep.profileShape='current';const owner=liveEffectOwnerForFrameLayer(snap),first={same:owner===l,web:getLayerWebEnabled(owner),sweep:getLayerSweepConfig(owner).enabled===true,profile:getLayerSweepConfig(owner).profileShape};l.showWeb=false;l.sweep.profileShape='line';const second={web:getLayerWebEnabled(owner),profile:getLayerSweepConfig(owner).profileShape};return {first,second};}finally{state.layers.pop();}})()`);
    assert(live.first.same&&live.first.web&&live.first.sweep&&live.first.profile==='current'&&live.second.web===false&&live.second.profile==='line',`live effect ownership failed: ${JSON.stringify(live)}`);console.log('PASS browser live effects + immediate Sweep profile switch');
    const isolated=await evaluate(`(()=>{const before=window.__spiroPassIsolationStatus().failures;const r=runSpiroIsolatedRenderPass({frameId:991,layerIndex:0},'preflightFault',()=>{throw new Error('preflight injected fault')});const after=window.__spiroPassIsolationStatus();return {ok:r.ok,before,after:after.failures,last:after.lastPass};})()`);
    assert(isolated.ok===false&&isolated.after===isolated.before+1&&isolated.last==='preflightFault',`fault containment failed: ${JSON.stringify(isolated)}`);console.log('PASS browser fault containment');
    const asyncExceptions=events.filter(e=>e.method==='Runtime.exceptionThrown');assert(asyncExceptions.length===0,`uncaught browser exceptions: ${asyncExceptions.map(e=>e.params?.exceptionDetails?.exception?.description||e.params?.exceptionDetails?.text).join(' | ')}`);console.log('PASS browser no uncaught exceptions');
  } finally {try{ws?.close();}catch{}try{proc.kill('SIGTERM');}catch{}try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
}
main().catch(err=>{console.error(`FAIL browser preflight: ${err.message}`);process.exit(1);});
