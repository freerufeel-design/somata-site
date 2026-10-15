const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
try{
  const gpu=read('js/app/geometry-gpu-core.js'),fill=read('js/render/fill-pass.js'),spiral=read('js/render/spiral-fill-adapter.js');
  assert(/isolatedFillTexture/.test(gpu),'isolated current-frame Fill texture missing');
  assert(/Somata isolated ordered Fill encoder/.test(gpu),'isolated ordered Fill encoder missing');
  assert(/encodeMeshPass\(encoder,isolatedFillTexture,frameCtx,mesh,targetCtx,corridor,false\)/.test(gpu),'isolated Fill does not force a transparent MSAA start');
  assert(/loadOp:clearTarget\?'clear':'load'/.test(gpu),'isolated Fill composite cannot preserve lower effect groups');
  assert(/encodeMeshIsolatedCommandToTexture/.test(fill),'ordinary ordered Fill does not use isolated current-frame rendering');
  assert(!/encodeMeshCommandToTexture\?\.\(scene\.texture,frameCtx,mesh,mainCtx,true\)/.test(fill),'ordinary Web-ordered Fill still loads persistent MSAA scratch');
  assert(/preserve\?FillGPURenderer\.encodeMeshIsolatedCommandToTexture/.test(spiral),'retained Spiral preserving Fill path is not isolated');
  assert(/preserve\s*\?\s*\(mesh\?\.corridorBaked===true\?FillGPURenderer\.encodeMeshIsolatedCommandToTexture/.test(fill),'Corridor preserving Fill path is not isolated');
  assert(/if\(fillAlreadyCommitted\)noteFillRuntime\(frameCtx,\{handled:true,stage:'fill-ordered'/.test(fill),'Fill diagnostic still overwrites a committed ordered Fill as handled:false');
  console.log('PASS 7.8.3 ordered Fill uses clean per-frame isolation; persistent MSAA cannot accumulate with Web');
}catch(e){console.error('FAIL 7.8.3 Fill MSAA isolation regression:',e.stack||e.message);process.exit(1)}
