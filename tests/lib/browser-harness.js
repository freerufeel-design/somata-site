const fs=require('fs');
const path=require('path');
const cp=require('child_process');
const {ROOT,read,scriptsFromIndex,assert}=require('./test-utils');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function findChromium(){for(const p of [process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'])if(p&&fs.existsSync(p))return p;throw new Error('Chromium not found; set CHROME_BIN');}
async function fetchJson(url,options){const r=await fetch(url,options);if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json();}
function withTimeout(promise,ms,label,onTimeout){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(async()=>{try{await onTimeout?.();}catch(_){}reject(new Error(`${label||'browser operation'} timed out after ${ms} ms`));},ms);})]).finally(()=>clearTimeout(timer));}
async function createBrowserHarness({disableGpu=true,loadDelayMs=300,evalTimeoutMs=4000}={}){
  const chrome=findChromium(),port=9300+Math.floor(Math.random()*500),profile=path.join('/tmp',`somata-tests-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const args=['--headless=new','--no-sandbox',`--remote-debugging-port=${port}`,'--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'];if(disableGpu)args.splice(1,0,'--disable-gpu');
  const proc=cp.spawn(chrome,args,{stdio:'ignore'});let ws=null,id=0;const pending=new Map(),events=[];
  const waitForExit=ms=>proc.exitCode!==null?Promise.resolve(true):Promise.race([
    new Promise(resolve=>proc.once('exit',()=>resolve(true))),
    sleep(ms).then(()=>false)
  ]);
  const close=async()=>{
    try{ws?.close();}catch(_){}
    if(proc.exitCode===null){
      try{proc.kill('SIGTERM');}catch(_){}
      if(!(await waitForExit(1200))&&proc.exitCode===null){
        try{proc.kill('SIGKILL');}catch(_){}
        await waitForExit(800);
      }
    }
    try{fs.rmSync(profile,{recursive:true,force:true});}catch(_){}
  };
  try{
    let ready=false;for(let i=0;i<80;i++){try{await fetchJson(`http://127.0.0.1:${port}/json/version`);ready=true;break;}catch{await sleep(100);}}if(!ready)throw new Error('Chromium DevTools did not start');
    const target=await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'});ws=new WebSocket(target.webSocketDebuggerUrl);await withTimeout(new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;}),3000,'DevTools websocket open',close);
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}else events.push(m);};
    const call=(method,params={})=>withTimeout(new Promise(resolve=>{const i=++id;pending.set(i,resolve);ws.send(JSON.stringify({id:i,method,params}));}),evalTimeoutMs,method,async()=>{try{ws.send(JSON.stringify({id:++id,method:'Runtime.terminateExecution'}));}catch(_){}});
    const evaluate=async(expression,{returnByValue=true,timeoutMs=evalTimeoutMs,label='Runtime.evaluate'}={})=>{
      const operation=new Promise((resolve,reject)=>{const i=++id;pending.set(i,m=>{const ex=m.result?.exceptionDetails;if(ex)reject(new Error(ex.exception?.description||ex.text||'Runtime.evaluate failed'));else resolve(m.result?.result?.value);});ws.send(JSON.stringify({id:i,method:'Runtime.evaluate',params:{expression,returnByValue,awaitPromise:true}}));});
      return withTimeout(operation,timeoutMs,label,async()=>{try{ws.send(JSON.stringify({id:++id,method:'Runtime.terminateExecution'}));}catch(_){}});
    };
    await call('Runtime.enable');await call('Page.enable');await call('Log.enable');
    const bareHtml=read('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*(?:stylesheet|manifest)[^>]*>/gi,'');
    await evaluate(`document.open();document.write(${JSON.stringify(bareHtml)});document.close();`,{label:'inject HTML'});
    const scripts=scriptsFromIndex();
    for(const rel of scripts){const code=read(rel)+`\n//# sourceURL=${rel}`;await evaluate(code,{returnByValue:false,timeoutMs:10000,label:`load ${rel}`});}
    await evaluate(`document.dispatchEvent(new Event('DOMContentLoaded'));window.dispatchEvent(new Event('load'));`,{label:'bootstrap events'});await sleep(loadDelayMs);
    // Test-only adapter for historical topology names: ALWAYS clicks current UI
    // controls (family + variant), rather than mutating layer state directly.
    await evaluate(`window.__somataSelectContourMode=function(mode){
      const family=mode.startsWith('spiral-')?'spiral':mode.startsWith('extended-')?'extended':'polygon';
      const variant=mode.endsWith('-open')||mode==='open'?'second':'first';
      const a=document.querySelector('[data-contour-family="'+family+'"]');
      const b=document.querySelector('[data-contour-variant="'+variant+'"]');
      if(!a||!b)throw new Error('missing live contour controls: '+mode);
      a.click();b.click();
      // Order 0 is intentionally an ordinary polygon. Tests requesting a
      // visible Spiral must also use the genuine Order control to set a coil.
      if(family==='spiral'){
        const order=document.getElementById('paramSpiralOrder');
        if(order&&Math.abs(Number(order.value)||0)<1e-8){order.value='1';order.dispatchEvent(new Event('change',{bubbles:true}));}
      }
      return a;
    };`,{label:'install test-only real UI topology adapter'});
    return{proc,ws,events,call,evaluate,close,scripts,assert,sleep,ROOT};
  }catch(err){await close();throw err;}
}
function uncaughtExceptions(events){return events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params?.exceptionDetails?.exception?.description||e.params?.exceptionDetails?.text||'uncaught browser exception');}
module.exports={createBrowserHarness,uncaughtExceptions,sleep};
