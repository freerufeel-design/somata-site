const fs=require('fs');
const path=require('path');
const assert=(c,m)=>{if(!c)throw new Error(m)};
const root=path.join(__dirname,'..');
const pipeline=fs.readFileSync(path.join(root,'js/render/main-pipeline.js'),'utf8');
const web=fs.readFileSync(path.join(root,'js/render/web-pass.js'),'utf8');
const sweep=fs.readFileSync(path.join(root,'js/render/sweep-pass.js'),'utf8');
const particles=fs.readFileSync(path.join(root,'js/render/particle-pass.js'),'utf8');
const gpu=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');

const pass=(name)=>pipeline.indexOf(`runPass('${name}'`);
const webPos=pass('web'),glowPos=pass('glow'),geometryPos=pass('geometry'),profilePos=pass('profile'),lampsPos=pass('lamps'),sweepPos=pass('sweep'),particlesPos=pass('particles');
assert([webPos,glowPos,geometryPos,profilePos,lampsPos,sweepPos,particlesPos].every(x=>x>=0),'required render passes missing');
assert(webPos<glowPos&&glowPos<geometryPos&&geometryPos<profilePos&&profilePos<lampsPos&&lampsPos<sweepPos&&sweepPos<particlesPos,
  'physical pass order must be Web < Line/Glow/Base/Profile/Graffiti < Lamps < Glint/Lightning < Particles');
assert(/queueLayerSceneEffectCommand\(frameCtx,1,(?:rec|out)\.commandBuffer/.test(web),'Web must occupy resident phase 1 below Base');
assert(/queueLayerSceneEffectCommand\(frameCtx,5,(?:batch\.commandBuffer|command),'base-layer-scene'/.test(pipeline),'Base Layer Scene batch must be appended at resident phase 5 above Web');
assert(/preserveExistingScene/.test(gpu),'Layer Scene batch must support appending Base over an existing Web scene without a materialization round-trip');
assert(!/webNeedsUnderBase/.test(pipeline),'legacy materialize-Web-under-Base switch must be removed');
assert(/SOMATA_SWEEP_PHASE=60/.test(sweep),'Glint/Lightning phase must remain 60');
assert(/queueLayerSceneEffectCommand\(frameCtx,70/.test(particles),'Particles must remain top phase 70');
console.log('PASS Somata 7.5 effect stack: Web < Line/Graffiti < Lamps < Glint/Lightning < Particles');
