const fs=require('fs'),path=require('path');
const s=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
const m=s.slice(s.indexOf('function encodeMeshPass('),s.indexOf('function appendIsolatedFillComposite('));
const i=s.slice(s.indexOf('function encodeIsolatedMeshCommandToTexture('),s.indexOf('function canEncodeToTexture(',s.indexOf('function encodeIsolatedMeshCommandToTexture(')));
function assert(c,msg){if(!c)throw Error(msg)}
assert(/targetTexture\.width/.test(m)&&/targetTexture\.height/.test(m),'native Fill must query actual resolveTarget extent');
assert(/targetW!==mainCanvas\.width\|\|targetH!==mainCanvas\.height/.test(m),'native Fill must refuse stale scene textures on resize');
assert(/ensureSize\(targetW,targetH\)/.test(m),'native MSAA must match GPU resolve target extent');
assert(i.indexOf('ensureSize(targetW,targetH)')<i.indexOf('encodeMeshPass('),'isolated Fill source must be sized before encoding');
assert(i.includes('scene/viewport resize pending'),'stale scene must skip pass rather than encode invalid command buffer');
console.log('7.11.5 FILL GPU TARGET/RESOLVE EXTENT INVARIANT: PASS (source contract; physical GPU validation pending)');
