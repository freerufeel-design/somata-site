const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'js/legacy/app-a.js'),'utf8');
const web=fs.readFileSync(path.join(root,'js/gpu/web-corner-resource.js'),'utf8');
function ok(v,m){if(!v)throw new Error(m);}
ok(app.includes('window.__somataGpuBufferRecycler=WebGPUBufferRecycler'),'shared recycler must be exported');
ok(app.includes('WebGPUBufferRecycler.recycle(device,hubGeneration,b);instanceBuffers=[]'),'sweep instance ring must retire buffers, not destroy them');
ok(app.includes('WebGPUBufferRecycler.acquire(device,hubGeneration,capacity*STRIDE*4'),'sweep instance ring must acquire through recycler');
ok(!/function ensureCapacity\(n\)[\s\S]{0,500}instanceBuffers\)try\{b\?\.destroy/.test(app),'ensureCapacity must not immediately destroy sweep instance buffers');
ok(web.includes('gpuWebCornerRecycleBuffer(st.buffer)'), 'Web corner growth replacement must retire old state');
ok(web.includes('gpuWebCornerAcquireBuffer(Math.max(16,count*8)'), 'Web corner growth must allocate through recycler');
ok(!/gpuWebCornerStateFor[\s\S]{0,900}st\.buffer\.destroy/.test(web),'Web corner growth state must not be destroyed inline');
ok(app.includes('/used in submit while destroyed/i.test(lastUncapturedError)'), 'hub must detect lifetime faults');
ok(app.includes('faultBurstCount>=3&&forcedRecoveryGeneration!==ownGeneration'), 'hub must circuit-break repeated lifetime faults');
ok(app.includes('badDevice?.destroy?.()'), 'circuit breaker must reset poisoned device generation');
console.log('GPU buffer lifetime invariants OK');
