const fs=require('fs');
const path=require('path');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

function block(src,startNeedle,endNeedle){
  const a=src.indexOf(startNeedle);assert(a>=0,`missing ${startNeedle}`);
  const b=endNeedle?src.indexOf(endNeedle,a+startNeedle.length):-1;
  return src.slice(a,b>a?b:Math.min(src.length,a+5000));
}

function main(){
  const morphPath=read('js/gpu/morph-path-resource.js');
  const arc=read('js/gpu/morph-arc-resource.js');
  const corner=read('js/gpu/web-corner-resource.js');
  const web=read('js/gpu/web-morph-renderer.js');
  const lightning=read('js/gpu/lightning-arc-renderer.js');
  const core=read('js/app/geometry-gpu-core.js');
  const index=read('index.html');

  assert(/<title>Somata 9\.\d+\.\d+<\/title>/.test(index),'Somata 9 release title/version missing');
  assert(/<script[^>]+src="js\/gpu\/morph-arc-resource\.js\?v=[^"]+"/.test(index),'GPU resource not loaded or missing cache-busting');

  assert(/generation:sharedGpuMorphPathRuntime\.generation/.test(morphPath),'shared Morph resource is not stamped with GPU generation');
  const getter=block(morphPath,'function getSharedGpuMorphPathResource','function writeSharedGpuMorphFrameUniform');
  assert(/rec\.generation===sharedGpuMorphPathRuntime\.generation/.test(getter),'shared Morph getter accepts stale-generation resource');
  assert(/sharedGpuMorphPathRuntime\.generation===WebGPUDeviceHub\.getGeneration\(\)/.test(getter),'shared Morph getter is not tied to live DeviceHub generation');

  const arcWarm=block(arc,'function warmupGpuMorphArcResource','function buildGpuMorphArcResource');
  assert(/WebGPUDeviceHub\.getGeneration\(\)/.test(arcWarm),'Arc warmup does not read live generation');
  assert(/invalidateGpuMorphArcResources\('device-generation-changed'\)/.test(arcWarm),'Arc warmup does not invalidate resident Arc buffers after generation change');
  const arcEncode=block(arc,'function encodeGpuMorphArcTable','function isGpuMorphArcTableCommitted');
  assert(/rec\.generation!==gpuMorphArcRuntime\.generation/.test(arcEncode),'Arc encoder accepts stale Arc resource generation');
  assert(/gpuMorphArcRuntime\.generation!==currentGen/.test(arcEncode),'Arc encoder accepts stale runtime generation');

  const cornerWarm=block(corner,'function warmupGpuWebCornerResource','function gpuWebCornerStateFor');
  assert(/gpuWebCornerRuntime\.generation!==gen/.test(cornerWarm),'Web corner warmup ignores DeviceHub generation change');
  assert(/gpuWebCornerReset\(null,-1\)/.test(cornerWarm),'Web corner warmup does not drop old-device pipelines/resources');
  const cornerEncode=block(corner,'function encodeGpuWebCornerResource','function noteGpuWebCornerSubmitted');
  assert(/rec\.generation!==gpuWebCornerRuntime\.generation/.test(cornerEncode),'Web corner encoder accepts stale corner resource');
  assert(/rec\.arcRec\?\.generation!==currentGen/.test(cornerEncode),'Web corner encoder accepts Arc buffers from another device');

  const webCan=block(web,'function canEncode','function encode(');
  assert(/corner\.generation===gen/.test(webCan)&&/arc\.generation===gen/.test(webCan),'Morph Web renderer does not require current-generation corner + Arc resources');

  const lightBind=block(lightning,'function pathBind','function copyBind');
  assert(/arcRec\.generation!==generation/.test(lightBind)&&/generation!==currentGen/.test(lightBind),'Lightning path bind can be built from stale-device Arc buffers');
  const lightEncode=block(lightning,'function encode(targetTexture','function encodeToLayerScene');
  assert(/reason:'stale-gpu-generation'/.test(lightEncode),'Lightning renderer has no explicit stale-generation bailout');
  assert(/arcRec\.generation!==generation/.test(lightEncode),'Lightning renderer does not reject stale Arc generation');

  const hub=block(core,'const WebGPUDeviceHub = (() => {','const WebGPUBufferRecycler = (() => {');
  assert(/associated with \\\[Device\\\].*cannot be used with \\\[Device\\\]/.test(hub),'DeviceHub does not classify cross-device WebGPU errors as lifetime faults');

  // Semantic model of the expected gate: after a generation change no renderer may encode
  // until its retained resources have been rebuilt for the new generation.
  const canEncode=(hubGen,rendererGen,arcGen,cornerGen)=>hubGen===rendererGen&&hubGen===arcGen&&(cornerGen==null||hubGen===cornerGen);
  assert(canEncode(4,4,4,4)===true,'same-generation gate rejected valid resources');
  assert(canEncode(5,4,4,4)===false,'hub generation change did not stop stale resources');
  assert(canEncode(5,5,4,5)===false,'stale Arc was accepted after renderer rebuild');
  assert(canEncode(5,5,5,4)===false,'stale Web corner resource was accepted after renderer rebuild');
  assert(canEncode(5,5,5,5)===true,'fully rebuilt generation did not recover');

  console.log('SOMATA 7.7.x LIGHTNING/WEB DEVICE GENERATION REGRESSION: PASS');
}

try{main();}catch(e){console.error('FAIL 7.7.x Lightning/Web device generation regression:',e.stack||e.message);process.exit(1)}
