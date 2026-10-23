'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
const a=src.indexOf('        const WebGPUDeviceHub = (() => {'),b=src.indexOf('        // 9.0.8: GPU backpressure',a);
assert(a>=0&&b>a,'DeviceHub contract missing');
let now=0,requests=0,lossResolvers=[],paints=0;
const adapter={features:new Set(),limits:{maxStorageBuffersPerShaderStage:16},requestDevice:async()=>{
 requests++;let loss;const lost=new Promise(res=>loss=res);lossResolvers.push(loss);
 return {lost,limits:{maxStorageBuffersPerShaderStage:16},features:new Set(),addEventListener(){},destroy(){}};
}};
const ctx={performance:{now:()=>now},navigator:{gpu:{requestAdapter:async()=>adapter}},isSecureContext:true,GPUBufferUsage:{STORAGE:128},GPUShaderStage:{VERTEX:1},console:{error(){},log(){},warn(){}},requestMainCanvasRender:()=>paints++,setTimeout,Math,Number,Promise,window:{}};
vm.createContext(ctx);vm.runInContext(src.slice(a,b)+';globalThis.hub=WebGPUDeviceHub;',ctx);
async function flush(){for(let j=0;j<10;j++)await Promise.resolve();}
(async()=>{
 for(let i=1;i<=5;i++){
  const got=await ctx.hub.acquire();assert(got.device,'Expected GPU device acquired');
  lossResolvers[i-1]({reason:'unknown',message:'simulated driver loss'});await flush();
  const st=ctx.hub.status();assert.equal(st.consecutiveLosses,i);
  assert.equal(st.lostCount,i);
  if(i<5){const before=requests;for(let step=0;step<10;step++)ctx.hub.warmup();await flush();assert.equal(requests,before,'Cannot reacquire during cooldown');now+=Math.max(st.recoveryCooldownMs,1)+1;}
 }
 const blocked=ctx.hub.status();assert(blocked.recoveryCircuitOpen,'Auto recovery must stop after repeated losses');
 now+=120000;ctx.hub.warmup();await flush();assert.equal(requests,5,'Circuit breaker must survive cooldown expiry');
 ctx.hub.retry();await flush();assert.equal(requests,6,'Explicit retry must be possible');
 // A permanently pending GPU completion fence must pause new frames after 10 seconds
 // even when the recycler holds no retired buffers at all.
 const queueDeviceProbe=src.slice(a,b);
 assert(queueDeviceProbe.includes('queueWatchdogTrips'),'Queue watchdog instrumentation missing');
 // Test the real WebGPUDeviceHub watchdog against an unresolved device queue.
 const watchdogDevice={lost:new Promise(()=>{}),limits:{maxStorageBuffersPerShaderStage:16},features:new Set(),addEventListener(){},queue:{onSubmittedWorkDone(){return new Promise(resolve=>{globalThis.__testProbeResolve=resolve;});}}};
 const adapter2={...adapter,requestDevice:async()=>watchdogDevice};
 const clock={time:0};
 const ctx2={...ctx,performance:{now:()=>clock.time},navigator:{gpu:{requestAdapter:async()=>adapter2}},requestMainCanvasRender:()=>paints++};
 vm.createContext(ctx2);vm.runInContext(queueDeviceProbe+';globalThis.queueHub=WebGPUDeviceHub;',ctx2);
 await ctx2.queueHub.acquire();
 assert.equal(ctx2.queueHub.shouldThrottle(),false);
 clock.time=10001;assert.equal(ctx2.queueHub.shouldThrottle(),true,'Independent GPU queue stall must pause new frames');
 assert(ctx2.queueHub.status().queueWatchdogTrips>=1,'Missing queue-stall diagnostic');
 // Complete the pending GPU fence and verify normal rendering resumes.
 assert(typeof globalThis.__testProbeResolve==='function');globalThis.__testProbeResolve();await flush();
 assert.equal(ctx2.queueHub.shouldThrottle(),false,'Queue watchdog must release on completion');
 console.log('PASS v908 device-loss exponential backoff and circuit breaker',JSON.stringify({losses:5,requests,paints,cooldownMs:blocked.recoveryCooldownMs}));
})().catch(e=>{console.error('FAIL v908 DeviceHub',e.stack||e);process.exitCode=1;});
