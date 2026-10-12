const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const native=read('js/gpu/web-morph-renderer.js');
const compat=read('js/gpu/web-thread-scene-renderer.js');
const pipeline=read('js/render/main-pipeline.js');
const html=read('index.html');
for(const [name,src] of [['native Morph Web',native],['compat Web Threads',compat]]){
  if(!src.includes('fsCombined')) throw new Error(`${name} must fuse Halo/Core in one fragment pass`);
  const hasDualMax=src.includes('targets=[{format,blend:blendMax()},{format,blend:blendMax()}]')||src.includes("targets=[{format,blend:maxBlend},{format,blend:maxBlend}]")||src.includes("const targets=[{format,blend:maxBlend},{format,blend:maxBlend}]"); if(!hasDualMax) throw new Error(`${name} must use two MAX-union color attachments`);
  if(src.includes('sampleCount:4')||src.includes('multisample:{count:4}')||src.includes('resolveTarget:')) throw new Error(`${name} must not restore 4x MSAA/resolve Web raster path`);
  if(!src.includes('c+h*(1.0-c.a)')) throw new Error(`${name} must composite Core over Halo exactly once`);
  if(!src.includes('fullScreenCompositesAvoided')) throw new Error(`${name} must expose fused-composite diagnostics`);
}
if(!native.includes('iid/12u')||!native.includes('iid%12u')) throw new Error('Native Morph Web must preserve 12-step rounded-thread geometry');
if(!native.includes('threadGeometry[recIndex*2u]')||native.includes('retainedCubicPoint(first+lo,t)')) throw new Error('Native Web raster must consume resident master thread geometry instead of repeating exact Arc sampling per vertex');
const corner=read('js/gpu/web-corner-resource.js');
if(!corner.includes('Web master thread geometry')||!corner.includes('retainedCubicPoint(first+lo,t)')||!corner.includes('threadGeometry[w*2u]')) throw new Error('Web compute must build exact resident {A,Control,B} geometry once per active thread');
for(const flag of ['webHaloCoreFusedMrt:true','webAnalyticCoverageNoMsaa:true','webSingleCompositePerLayerScene:true','webLegacyAndMorphGpuPathsFused:true','webMasterThreadGeometryCompute:true','webPerVertexArcSamplingRemoved:true','webCorridorReusesMasterGeometry:true']){
  if(!pipeline.includes(flag)) throw new Error(`Runtime audit missing ${flag}`);
}
if(!pipeline.includes("version:'7.3.9'")||!pipeline.includes('iteration:17')) throw new Error('Runtime audit must be 7.3.9 iteration 17');
if(!html.includes('<title>Somata 7.3.20</title>')||!html.includes('?v=20261012-v7320')) throw new Error('7.2.8 build/cache epoch missing');
console.log('Somata 7.3.9 Web GPU pressure invariants: PASS');
