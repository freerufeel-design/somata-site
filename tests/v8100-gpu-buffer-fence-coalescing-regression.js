'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {performance}=require('perf_hooks');
const current=path.join(__dirname,'..','js','app','geometry-gpu-core.js');
const baseline=process.env.SOMATA_BASELINE_ROOT
    ?path.join(process.env.SOMATA_BASELINE_ROOT,'js','app','geometry-gpu-core.js')
    :null;
function make(source){
    const code=fs.readFileSync(source,'utf8');
    const start=code.indexOf('        const WebGPUBufferRecycler = (() => {');
    const end=code.indexOf('        window.__spiroGPUBufferRecyclerStatus=',start);
    assert(start>=0&&end>start,'missing recycler');
    const rt={frameId:0}, pending=[], all=[], counters={fences:0,creates:0,destroys:0}, governor={residencyScale:()=>10};
    const queue={onSubmittedWorkDone(){counters.fences++;return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
    const device={queue,createBuffer({size,usage}){counters.creates++;const b={size,usage,destroyed:false,destroy(){assert(!this.destroyed,'double destroy');this.destroyed=true;counters.destroys++;}};all.push(b);return b;}};
    const context={renderRuntime:rt,performanceGovernor:governor,Math,Number,Array,Promise,window:{},Map,Set};
    vm.createContext(context);vm.runInContext(code.slice(start,end)+'\n;globalThis.recycler=WebGPUBufferRecycler;',context);
    const recycler=context.recycler;
    return{rt,pending,all,counters,device,recycler,flush(){const list=pending.splice(0);for(const rec of list)rec.resolve();},fail(){const list=pending.splice(0);for(const rec of list)rec.reject(new Error('device queue failure'));}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function lifecycle(source,coalesced){
    const h=make(source);const R=h.recycler,D=h.device;
    h.rt.frameId=1;
    const buffers=Array.from({length:64},()=>R.acquire(D,1,4096,17));
    for(const b of buffers)assert(R.recycle(D,1,b),'recycle failed');
    assert.equal(R.status().retiredBuffers,64);
    h.rt.frameId=2;R.status();assert.equal(h.counters.fences,0,'cannot arm before two frames');
    h.rt.frameId=3;R.status();
    assert.equal(h.counters.fences,coalesced?1:64,'unexpected number of GPU completion requests');
    assert.equal(R.status().readyBuffers,0,'reuse before GPU completion is unsafe');
    const newlyAllocated=R.acquire(D,1,4096,17);
    assert(!buffers.includes(newlyAllocated),'fence was ignored');
    h.flush();await tick();
    assert.equal(R.status().readyBuffers,64,'retired buffer did not become reusable');
    const old=R.acquire(D,1,4096,17);
    assert(buffers.includes(old),'did not reuse a completed resource');
    assert.equal(R.status().readyBuffers,63);
    assert.equal(R.status().hits,1);
    // In-flight completion must never resurrect resources after a device loss.
    R.recycle(D,1,old);h.rt.frameId=5;R.status();
    const other={...D,queue:D.queue};R.reset(other,2);
    h.flush();await tick();
    assert.equal(R.status().readyBuffers,0);
    assert.equal(R.status().retiredBuffers,0);
    assert(buffers.every(b=>b.destroyed),'old device resources survived generation reset');
    // Failed fences must destroy instead of handing unsafe buffers to a pass.
    const rejected=R.acquire(other,2,1024,17);
    R.recycle(other,2,rejected);h.rt.frameId=7;R.status();h.fail();await tick();
    assert(rejected.destroyed,'failed fence retained an unsafe buffer');
    assert.equal(R.status().readyBuffers,0);
    return{fences:h.counters.fences,recycles:R.status().recycles,destroys:h.counters.destroys};
}
async function throughput(source){
    const h=make(source);const R=h.recycler,D=h.device;
    const begun=performance.now();
    for(let i=0;i<90;i++){
        h.rt.frameId=i*4+1;
        const buffers=Array.from({length:100},()=>R.acquire(D,1,1024,17));
        for(const b of buffers)R.recycle(D,1,b);
        h.rt.frameId+=2;R.status();h.flush();await Promise.resolve();
        assert.equal(R.status().retiredBuffers,0);
    }
    return{durationMs:performance.now()-begun,fences:h.counters.fences,recycles:R.status().recycles,hits:R.status().hits};
}
(async()=>{
    const currentLifecycle=await lifecycle(current,true);
    let previousLifecycle=null;
    if(baseline)previousLifecycle=await lifecycle(baseline,false);
    const runs=[];for(let i=0;i<3;i++)runs.push({before:baseline?await throughput(baseline):null,after:await throughput(current)});
    console.log('GPU_FENCE_REGRESSION_PASS '+JSON.stringify({currentLifecycle,previousLifecycle,runs}));
})().catch(err=>{console.error('GPU_FENCE_REGRESSION_FAIL',err.stack||err);process.exitCode=1;});
