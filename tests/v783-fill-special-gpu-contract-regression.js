const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
try{
  const gpu=read('js/app/geometry-gpu-core.js'),registry=read('js/render/pass-registry.js'),defs=read('js/core/defaults-layers.js'),ui=read('js/app/ui-project-runtime.js'),html=read('index.html');
  assert(/fillHistoryRecords=new Map\(\)/.test(gpu),'Accumulation Fill has no per-layer GPU history store');
  assert(/Somata accumulating Fill history/.test(gpu),'Accumulation Fill history texture missing');
  assert(/loadOp:reset\?'clear':'load'/.test(gpu),'Accumulation timer cannot clear/restart history');
  assert(/getLayerFillAccumulationSeconds/.test(gpu)&&/timerSec\*1000/.test(gpu),'Accumulation timer is not interpreted in seconds');
  assert(/setTimeout\(\(\)=>\{rec\.forceReset=true/.test(gpu),'Static accumulation cycle does not request reset repaint');
  assert(/FADE_COMPOSITE_WGSL/.test(gpu)&&/insideAt/.test(gpu)&&/smoothstep\(0\.08,0\.92,depth\)/.test(gpu),'Sharp Fading Fill contour-distance shader missing');
  assert(/fn ringAlpha8/.test(gpu)&&/near\*0\.50\+mid\*0\.32\+far\*0\.18/.test(gpu)&&/smoothstep\(0\.03,0\.97,depth\)/.test(gpu),'Smooth Fading Fill multiscale contour shader missing');
  assert(/u\.directionPad\.y<0\.5/.test(gpu)&&/fillType==='fadeSmooth'\?1:0/.test(gpu),'Sharp/Smooth fade branch selector is not wired');
  assert(/if\(h<=0\.0001\)\{return vec4<f32>\(0\.0\);\}/.test(gpu),'Fade hardness 0% is not guaranteed transparent');
  assert(/if\(h>=0\.9999\)\{return c;\}/.test(gpu),'Fade hardness 100% is not guaranteed ordinary Fill');
  assert(/getLayerFillFadeDirection/.test(gpu)&&/u\.directionPad\.x>0\.5/.test(gpu),'Fade center direction is not wired to shader');
  assert(/getLayerFillType\(frameCtx\?\.effectLayer\|\|frameCtx\?\.layer\)!=='normal'/.test(gpu),'Special Fill does not force isolated style rendering in direct paths');
  assert(/fillType==='normal'/.test(registry),'Effect stack does not reserve standalone compositor slots for special Fill');
  assert(/fillType: 'normal'/.test(defs)&&/fillAccumulationSeconds: 5/.test(defs)&&/fillFadeHardness: 50/.test(defs),'New Fill defaults missing');
  assert(/value="accumulation">С накоплением/.test(html)&&/value="fade">Затухающая — резкая/.test(html)&&/value="fadeSmooth">Затухающая — плавная/.test(html),'Fill type menu options missing');
  assert(/id="paramFillAccumulationSeconds"[^>]*type="number"/.test(html),'Accumulation seconds input missing');
  assert(/id="paramFillFadeHardness"[^>]*min="0"[^>]*max="100"/.test(html),'Fade hardness 0–100 slider missing');
  assert(/zoomDisplay'\)\?\.addEventListener\('dblclick'/.test(ui),'Zoom 100% double-click handler missing');
  console.log('PASS 7.8.3 special Fill GPU contracts + 100% zoom reset source contract');
}catch(e){console.error('FAIL 7.8.3 special Fill GPU contract regression:',e.stack||e.message);process.exit(1)}
