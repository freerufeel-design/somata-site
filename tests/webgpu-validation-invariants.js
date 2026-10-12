const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('index.html');
const graffiti=read('js/gpu/graffiti-ribbon-renderer.js');
const bezier=read('js/gpu/bezier-sweep-renderer.js');
const appA=read('js/legacy/app-a.js');

assert.ok(graffiti.includes('var zScale=select('),'Graffiti Glow zScale is mutated and must be WGSL var, not let');
assert.ok(!graffiti.includes('let zScale=select('),'Immutable WGSL let zScale regression detected');
assert.ok(bezier.includes("cubicLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT"),
  'Bézier cubicData is read from fragment sectorVisible() and needs FRAGMENT binding visibility');
assert.ok(!appA.includes('[Somata GPU fallback]'),'Expected GPU/Canvas backend selection must stay silent in the browser console');
assert.ok(appA.includes("console.error('[Somata WebGPU uncaptured]'"),'Uncaptured WebGPU validation errors must be mirrored into the in-app error console');
assert.ok(html.includes('js/gpu/graffiti-ribbon-renderer.js?v=20261012-v7320'),'Graffiti GPU module should be cache-busted after WGSL repair');
assert.ok(html.includes('js/gpu/bezier-sweep-renderer.js?v=20261012-v7320'),'Bézier GPU module should be cache-busted after layout repair');
console.log('WebGPU validation invariants OK');
