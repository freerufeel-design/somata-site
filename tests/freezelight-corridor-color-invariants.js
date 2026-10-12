'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const css=read('styles/app.css');
const state=read('js/core/state.js');
const defaults=read('js/core/defaults-layers.js');
const appB=read('js/legacy/app-b.js');
const appC=read('js/legacy/app-c.js');
const gpu=read('js/gpu/lamp-renderer.js');

// FreezeLight and Rain are separate collapsible sub-blocks. Their controls are hidden
// until the corresponding checkbox is enabled.
for(const id of ['lampFreezeBlock','lampFreezeDetails','lampFreezeRainBlock','lampFreezeRainDetails']){
  assert(html.includes(`id="${id}"`),`Missing FreezeLight sub-block ${id}`);
}
assert(html.includes('class="lamp-freeze-details hidden"'),'FreezeLight detail panels must start hidden');
assert(css.includes('.lamp-freeze-details.hidden{display:none!important;}'),'Hidden FreezeLight panels must really leave layout');
assert(appB.includes("document.getElementById('lampFreezeDetails')?.classList.toggle('hidden',!freezeOn)"),'Ordinary FreezeLight settings must follow only its checkbox');
assert(appB.includes("document.getElementById('lampFreezeRainDetails')?.classList.toggle('hidden',!rainOn)"),'Rain settings must follow only its checkbox');

// Color contract for ordinary FreezeLight.
assert(html.includes('<option value="lamp" selected>Цвет лампочки</option>'),'Lamp color must be the FreezeLight default');
assert(html.includes('<option value="line">Цвет линии</option>'),'FreezeLight must offer line color');
assert(html.includes('<option value="fixed">Заданный цвет</option>'),'FreezeLight must offer fixed color');
assert(html.includes('<option value="hue">Изменение цвета</option>'),'FreezeLight must offer gradual hue change');
for(const id of ['lampFreezeColor','lampFreezeHueDegrees','lampFreezeHueDegreesNumber','lampFreezeChromatic','lampFreezeChromaticColor']){
  assert(html.includes(`id="${id}"`),`Missing FreezeLight color control ${id}`);
}
for(const token of ["freezeColorMode: 'lamp'","freezeColor: '#00ffcc'","freezeHueDegrees: 45","freezeChromatic: false","freezeChromaticColor: '#22d3ee'"]){
  assert(state.includes(token),`Missing FreezeLight color state default ${token}`);
}
for(const token of ['owner.lamps.freezeColorMode','owner.lamps.freezeColor','owner.lamps.freezeHueDegrees','owner.lamps.freezeChromatic','owner.lamps.freezeChromaticColor']){
  assert(defaults.includes(token),`Layer normalizer must preserve/default ${token}`);
}
for(const id of ['lampFreezeColorMode','lampFreezeColor','lampFreezeHueDegrees','lampFreezeHueDegreesNumber','lampFreezeChromatic','lampFreezeChromaticColor']){
  assert(appC.includes(`'${id}'`)||appC.includes(`"${id}"`),`${id} must have persistence/runtime binding`);
}
assert(gpu.includes('colorMode:f32')&&gpu.includes('hueRangeDeg:f32'),'Freeze feedback uniform must carry color mode and hue range');
assert(gpu.includes('fn hueRotate(')&&gpu.includes('sin(a0*6.283185307179586)')&&gpu.includes('sin(a1*6.283185307179586)'),'Hue mode must change gradually over trail age and span both +/- hue offsets');
assert(gpu.includes("fm==='line'?1:(fm==='fixed'?2:(fm==='hue'?3:0))"),'Runtime must map lamp/line/fixed/hue modes to the shader');
assert(gpu.includes('function freezeReferenceLineColor()'),'Line-color mode must resolve the current line color');

// Chromatic aberration is disabled by default, separately colored, and applied as an
// outward fringe at the tone stage rather than contaminating persistent trail history.
assert(!/id="lampFreezeChromatic"[^>]*checked/.test(html),'Chromatic aberration must default OFF');
assert(gpu.includes('let fringe=max(0.0,around-center)'),'Chromatic effect must originate from outer FreezeLight edges');
assert(gpu.includes('toneFx.p1.rgb')&&gpu.includes('const chromatic=freezeEnabled&&freezeChromaticEnabled()'),'Chromatic color must be independently configurable and ordinary-Freeze-only');

// Corridor motion regression: native Arc/Topology lamps move on GPU, so the scheduler
// signature must include the actual attachment payload, morph state, and the exact shared
// Corridor transform basis. Otherwise a moving lamp is misclassified as static and the
// trail can appear pinned to an arbitrary old sample.
assert(gpu.includes('lampMotionHash=2166136261>>>0'),'Native lamp paths need a motion hash');
assert((gpu.match(/for\(let hi=0;hi<ARC_LAMP_FLOATS;hi\+\+\)lampMotionHash=lampHashMix/g)||[]).length>=2,'Both Arc and Topology native paths must hash their packed lamp attachments');
assert(gpu.includes('freezeFrameHash=lampHashMix(freezeFrameHash,lampMotionHash)'),'Packed attachment motion must enter the FreezeLight frame signature');
assert(gpu.includes('WebGPUCorridorCopyStore?.getTransformBasis?.(frameCtx,copies,alphas,layer)'),'FreezeLight must hash the same exact Corridor transform basis used to place lamps');
assert(gpu.includes('for(let j=0;j<5;j++)freezeFrameHash=lampHashMix(freezeFrameHash,basis.data[o+j])'),'Every meaningful Corridor basis component must affect motion detection');
assert(gpu.includes('Number(table?.gpuMorphT)||0')&&gpu.includes('Number(prepared?.gpuMorphT)||0'),'Arc and Topology morph phase must affect FreezeLight motion detection');

// Modified assets must not be shadowed by an earlier hotfix cache entry.
for(const file of ['js/core/state.js','js/core/defaults-layers.js','js/gpu/lamp-renderer.js']){
  assert(html.includes(`${file}?v=20261012-v7320-hf9`),`${file} must preserve hf9 cache-buster`);
}
assert(html.includes('styles/app.css?v=20261012-v7320-hf11'),'Fullscreen CSS must use hf11 cache-buster');
assert(html.includes('js/legacy/app-c.js?v=20261012-v7320-hf11'),'Fullscreen runtime must use hf11 cache-buster');
assert(html.includes('js/legacy/app-b.js?v=20261012-v7320-hf10'),'Lamp renderer bridge must use hf10 cache-buster');

console.log('FreezeLight Corridor motion / color / chromatic UI invariants: PASS');
