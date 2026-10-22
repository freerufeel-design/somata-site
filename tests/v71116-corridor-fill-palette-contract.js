// GPU source contract; adapter/driver validation still requires the user's GPU.
const fs=require('fs'),path=require('path');
const {ROOT}=require('./lib/test-utils');
const kernel=fs.readFileSync(path.join(ROOT,'js/geometry/kernel.js'),'utf8');
const gpu=fs.readFileSync(path.join(ROOT,'js/app/geometry-gpu-core.js'),'utf8');
const pipeline=fs.readFileSync(path.join(ROOT,'js/render/main-pipeline.js'),'utf8');
const runtime=fs.readFileSync(path.join(ROOT,'js/app/ui-project-runtime.js'),'utf8');
const assert=(x,m)=>{if(!x)throw Error(m)};
assert(/const dynamicCorridorNative=[^;]+&&Boolean\(frameCtx\.drawLayerGeometry\)/.test(kernel),'Native dynamic corridor fill disabled');
assert(!/const nativeGpuFillEligible=[^;]+!tunnelColorShiftIsActive/.test(kernel),'Native corridor fill still disabled by colour lag');
assert(/getTunnelCopyColor\(fillColor,copy,frameCtx\.tunnelFillPaletteProfile\)/.test(gpu),'GPU mesh Fill must shift its own fill color for every Corridor copy');
assert(/rgba\[3\].*frameCtx\.baseAlpha/.test(gpu),'GPU mesh Fill must retain source opacity');
assert(/frameCtx\.tunnelFillPaletteProfile=/.test(pipeline),'Pipeline must resolve independent Fill palette');
assert(/t\.paletteLagEnabled === true \|\|/.test(runtime),'Palette lag must work without cumulative hue rotation enabled');
assert(/return `\$\{tunnelColorBaseHex\(palette\[idx\]\)\}\$\{tunnelColorAlphaSuffix\(baseColor\)\}`/.test(runtime),'Palette lag must preserve Fill/Line alpha');
console.log('7.11.16 CORRIDOR NATIVE GPU FILL / COLOR LAG CONTRACT: PASS (source only)');
