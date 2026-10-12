'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const appB=read('js/legacy/app-b.js');
const playlist=JSON.parse(read('default.plist'));

// Regression reported as «Радуга hangs». The bundled Rainbow project is the only
// default project that combines rainbow lamps with CPU HD supersampling.
const rainbow=playlist.projects.find(p=>p.name==='Радуга');
assert(rainbow,'Bundled Радуга project must exist for the regression fixture');
const layer=rainbow.project.layers[0];
assert(layer?.lamps?.colorMode==='rainbow'||layer?.lamps?.rainbow===true,'Радуга fixture must actually use rainbow lamp colour');
assert(layer?.lamps?.hd===true,'Радуга fixture must preserve its authored HD setting; runtime must solve overload without editing the playlist');

// CPU HD used to allow up to 32M supersampled pixels per frame. With the saved
// 12 × 50px soft lamps this is enough to create ~100ms frames in the existing soak log.
// HD is now a bounded quality enhancement: whole batches are preflighted and an
// overloaded batch uniformly uses the exact final-resolution gradient instead.
assert(appB.includes('const LAMP_HD_FRAME_PIXEL_BUDGET_MAX=8_000_000'),'HD CPU supersampling must have an 8Mpx hard frame cap');
assert(appB.includes('function lampHdVisualBatchAllowed('),'Lamp visual plans must preflight HD cost as a whole batch');
assert(appB.includes('lampHdBudget.pixels+estimate>budget'),'Batch preflight must account for HD work already spent in the frame');
assert(appB.includes("const hdBatch=cfg.hd===true&&lampHdVisualBatchAllowed(ctx,items,softness,type)"),'Visual-plan rendering must gate HD once per batch');
assert(appB.includes('if(hdBatch)drawLampHD')&&appB.includes('else drawLampDirect'),'Over-budget HD must fall back to the exact direct gradient, not skip lamps');
assert(appB.includes('function lampHdPointBatchAllowed(')&&appB.includes('if(hdPointBatch){'),'Legacy/direct lamp-point path must use the same bounded policy');
assert(!appB.includes('Math.min(32_000_000,Math.round(cssArea*18))'),'The old 32Mpx CPU HD allowance must be gone');

// Numerical sanity check for the saved Rainbow lamp: at DPR2 the 50px, softness100,
// white-core lamp has an outer extent around 218.5 local px and a 4x HD sample scale.
// Twelve such lamps are far over 8Mpx, so the new preflight rejects SSAA before painting.
const radius=50,softness=100,softN=softness/100,haloScale=1.45+softN*2.8;
const extent=Math.max(radius+4,radius*haloScale+6);
const sampleScale=4;
const one=Math.pow(extent*2*sampleScale+6,2);
const total=one*12;
assert(total>8_000_000,`Regression fixture should exceed HD frame cap, got ${Math.round(total)} px`);

assert(html.includes('js/legacy/app-b.js?v=20261012-v7320-hf10'),'Patched lamp renderer bridge must bypass the hf9 browser cache');
console.log('Rainbow / CPU-HD frame-budget regression invariants: PASS');
