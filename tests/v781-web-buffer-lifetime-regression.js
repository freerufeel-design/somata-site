const fs=require('fs');const path=require('path');
const src=fs.readFileSync(path.resolve(__dirname,'../js/gpu/web-thread-scene-renderer.js'),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const slice=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i+1);if(i<0||j<0)throw new Error(`missing ${a}/${b}`);return src.slice(i,j)};
const seg=slice('function ensureSegments','function ensureMask');
const mask=slice('function ensureMask','function countSegments');
const cor=slice('function getCorridorSegmentRecord','function ensureCorridorCopyCapacity');
const copy=slice('function ensureCorridorCopyCapacity','const sharedCorridorCopyBinds');
const maskRec=slice('function maskRecord','function uploadMask');
for(const [name,part] of [['segments',seg],['mask-ring',mask],['corridor-master',cor],['corridor-copies',copy]]){
  assert(part.includes('retireDynamicList('),`${name} growth still destroys same-frame GPU buffers`);
  assert(!/safeDestroy\(b\)/.test(part),`${name} contains immediate buffer destruction`);
}
assert(maskRec.includes('retireDynamicBuffer(rec.buffer)'),'resident Web mask resize still destroys a queued buffer immediately');
assert(src.includes("bufferLifetimePolicy:'dynamic Web buffers are never destroyed while same-frame deferred command buffers may still reference them'"),'Web buffer lifetime policy marker missing');
console.log('PASS Web deferred-command GPU buffers survive same-frame growth until renderer teardown');
