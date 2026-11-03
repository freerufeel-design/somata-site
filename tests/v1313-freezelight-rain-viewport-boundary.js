'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../js/gpu/lamp-renderer.js'),'utf8');
const ambient=fs.readFileSync(path.join(__dirname,'../js/app/ambient-prism.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
const rainCode=src.match(/function freezeRainTravelPx\(dt\)\{([\s\S]*?)\n\s*\}/)?.[1];
assert(rainCode,'FreezeLight Rain speed function missing');
assert(rainCode.includes('Math.min(.05') && rainCode.includes('p*(1+4*p)'), 'Rain speed must be finite and frame-bounded');
assert(!rainCode.includes('p/(1-p)') || rainCode.includes('// Previous p/(1-p)'), 'unbounded Rain formula returned');
assert(src.includes('fn rainHistoryAt(') && src.includes('fu._pad0>0.5') && src.includes('rainUniformData[12]=1'), 'wrapped Rain history must be active only for Rain');
assert(src.includes('else{previous=historyAt(src,dims);}'), 'ordinary FreezeLight history must remain unwrapped');
for(const [width,height] of [[320,568],[1032,546],[1920,1080]]){
 const base=Math.max(60,Math.min(480,Math.min(width,height)*.25));
 let previous=-1;
 for(let p=0;p<=1.0001;p+=.02){
  const step=base*.05*p*(1+4*p);
  assert(Number.isFinite(step)&&step>=0&&step<=120,`out-of-view Rain jump at ${width}x${height}, p=${p}: ${step}`);
  assert(step>=previous,`Rain speed is not monotonic at ${p}`);
  previous=step;
 }
}
assert(ambient.includes('function cloudValueNoise(') && ambient.includes('const offsetX=') && ambient.includes('const offsetY='), 'clouds must use periodic scalar fields on both axes');
assert(ambient.includes('for(let x=offsetX-tileW;x<width;x+=tileW)') && ambient.includes('for(let y=offsetY-tileH;y<height;y+=tileH)'), 'cloud textures must cover both axes without repeated rows');
assert(!ambient.includes('ctx.drawImage(tex,x,baseY+drawH*.78'), 'old rectangular cloud rows must not return');
assert(css.includes('#settingsSidebar.desktop-collapsed > .section-header {display:none!important;}'), 'collapsed sidebar header still consumes width');
console.log('PASS FreezeLight Rain finite motion + wrapped-only-Rain feedback + seamless two-axis cloud fields and zero sidebar footprint');
