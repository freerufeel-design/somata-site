'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
const begin=src.indexOf('        const WebGPUBufferRecycler = (() => {');
const end=src.indexOf('        window.__spiroGPUBufferRecyclerStatus=',begin);
assert(begin>=0&&end>begin,'Recycler must be in production GPU core');
const core=src.slice(begin,end);
const queues=[],stats={created:0,destroyed:0,renderRequests:0};
let frame=0;
const device={createBuffer(desc){stats.created++;return {size:desc.size,usage:desc.usage,dead:false,destroy(){assert(!this.dead,'double destruction');this.dead=true;stats.destroyed++;}};},queue:{onSubmittedWorkDone(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});queues.push({resolve,reject});return promise;}}};
const ctx={performance:{now:()=>frame*16},renderRuntime:{frameId:0},performanceGovernor:{residencyScale:()=>1},requestMainCanvasRender:()=>stats.renderRequests++,console,Number,Array,Math,Date,Promise,window:{}};
vm.createContext(ctx);
vm.runInContext(core+';globalThis.recycler=WebGPUBufferRecycler;',ctx);
const r=ctx.recycler;
async function flush(){for(let i=0;i<6;i++)await Promise.resolve();}
(async()=>{
 // Simulate a GPU queue that never signals completion, while each frame replaces a 1 MiB buffer.
 let throttledAt=-1;
 for(frame=1;frame<=350;frame++){
   ctx.renderRuntime.frameId=frame;
   if(r.shouldThrottle()){if(throttledAt===-1)throttledAt=frame;break;}
   const buffer=r.acquire(device,1,1024*1024,8,'stall-test');
   assert(buffer&&buffer.size>=1024*1024);
   r.recycle(device,1,buffer);
 }
 const stalled=r.status();
 assert(throttledAt>0&&throttledAt<=110,'Backpressure never stopped the runaway allocations');
 assert(stalled.retiredBuffers<120,'Retired GPU queue grew unbounded');
 assert(stalled.retiredBytes<=105*1024*1024,'Retired VRAM exceeded pressure threshold by too much');
 assert.equal(queues.length,1,'Must not create a fence promise per retired buffer');
 assert.equal(stats.destroyed,0,'Must not destroy GPU buffers still in-flight');
 assert(stalled.throttleActive,'Render should be paused while the GPU fence is still unresolved');
 // Let the last retired item become eligible without allocating a new GPU buffer.
 frame+=3;ctx.renderRuntime.frameId=frame;
 // Resume GPU progress and make sure it actually recovers, rather than remaining locked.
 let answered=0;
 while(answered<10){
   const pending=queues[answered++];if(!pending)break;
   pending.resolve();await flush();
 }
 const resumed=r.status();
 assert.equal(resumed.retiredBuffers,0,'All pending retired buffers must be safely drained on GPU completion');
 assert(!r.shouldThrottle(),'Backpressure must clear when GPU catches up');
 assert(resumed.readyBytes<=48*1024*1024,'Ready VRAM cache must be pruned');
 assert(stats.renderRequests>0,'The scheduler must be asked to repaint after the fence completes');
 // Test old pending promises cannot promote buffers into a new generation.
 frame+=2;ctx.renderRuntime.frameId=frame;
 const old=r.acquire(device,1,1024*1024,8);r.recycle(device,1,old);
 frame+=2;ctx.renderRuntime.frameId=frame;r.status();
 const other={createBuffer:device.createBuffer.bind(device),queue:device.queue};
 r.acquire(other,2,256,8);const reset=r.status();
 assert.equal(reset.retiredBuffers,0,'Device generation switch must drop stale records');
 assert.equal(reset.generation,2,'Generation tracking lost');
 assert(r.status().pendingFence===false,'Old generation fence must not poison a new GPU device');
 const pipeline=fs.readFileSync(path.join(__dirname,'../js/render/main-pipeline.js'),'utf8');
 assert(/function renderMainCanvas\(\)[\s\S]{0,350}WebGPUBufferRecycler\.shouldThrottle\(\)/.test(pipeline),'GPU backpressure must guard real frame preparation');
 const governor=fs.readFileSync(path.join(__dirname,'../js/core/scheduler.js'),'utf8');
 assert(governor.includes("pressureLevel>=2&&bottleneck()==='gpu'"),'GPU pressure must not trigger maximal buffer growth');
 console.log('PASS 9.0.8 GPU stall protection',JSON.stringify({throttledAt,created:stats.created,stalledBuffers:stalled.retiredBuffers,stalledMiB:stalled.retiredBytes/(1024*1024),fencesDuringStall:1,fencesAfterRecovery:queues.length,renderRequests:stats.renderRequests}));
})().catch(e=>{console.error('FAIL 9.0.8 GPU stall protection',e.stack||e);process.exitCode=1;});
