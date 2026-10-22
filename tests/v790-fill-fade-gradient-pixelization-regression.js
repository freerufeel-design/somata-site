const fs=require('fs'),path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const root=path.resolve(__dirname,'..');
const gpu=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');
const defaults=fs.readFileSync(path.join(root,'js/core/defaults-layers.js'),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
function sharpScale(p){p=Math.max(0,Math.min(1,p));return 2.25+(1-2.25)*Math.min(1,p/.25)}
function advancedMix(p){const x=Math.max(0,Math.min(1,(p-.25)/.75));return x*x*(3-2*x)}
async function main(){
  assert(/fillFadePixelization:\s*25/.test(defaults),'7.9 sharp Fade default pixelization is not 25%');
  assert(/function getLayerFillFadePixelization\(layer\)/.test(defaults),'Fade pixelization normalizer missing');
  assert(/Fade field H 1\/2-res/.test(gpu)&&/Fade field V 1\/2-res/.test(gpu),'Continuous half-resolution Fade field textures missing');
  assert(/fadeBlurPipelineH/.test(gpu)&&/fadeBlurPipelineV/.test(gpu)&&/fadeSmoothCompositePipeline/.test(gpu),'Separable continuous Fade pipelines missing');
  assert(/Math\.ceil\(width\*\.5\)/.test(gpu)&&/Math\.ceil\(height\*\.5\)/.test(gpu),'Continuous Fade field is not isolated at half resolution');
  assert(/smoothMode===1\|\|pixelization>0\.2501/.test(gpu),'Continuous Fade path is not lazy above the 25% sharp baseline');
  assert(/fadeUniformScratch\[6\]=pixelization/.test(gpu),'Pixelization control is not forwarded into renderer-consumed Fade uniform data');
  assert(/let sharpScale=mix\(2\.25,1\.0,min\(1\.0,pix\/0\.25\)\)/.test(gpu),'Coarse sharp pixelization mapping missing');
  assert(/let t=smoothstep\(0\.25,1\.0,pix\)/.test(gpu),'Sharp→continuous interpolation mapping missing');
  assert(Math.abs(sharpScale(.25)-1)<1e-12,'25% does not preserve the established sharp sampling scale');
  assert(sharpScale(0)>sharpScale(.25),'0% does not make sharp cells coarser');
  assert(Math.abs(advancedMix(.25))<1e-12&&Math.abs(advancedMix(1)-1)<1e-12,'25→100 interpolation endpoints broken');

  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:450});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const layer=state.layers[0];state.activeLayerId=layer.id;layer.fill=true;
      delete layer.fillFadePixelization;syncSidebarInputs();
      const mode=document.getElementById('paramFillMode'),pix=document.getElementById('paramFillFadePixelization'),control=document.getElementById('fillFadePixelizationControl');
      const initial={value:getLayerFillFadePixelization(layer),input:Number(pix.value)};
      mode.value='fade';mode.dispatchEvent(new Event('change',{bubbles:true}));
      const sharpVisible=!control.classList.contains('hidden');
      pix.value='0';pix.dispatchEvent(new Event('input',{bubbles:true}));const coarse=getLayerFillFadePixelization(layer);
      pix.value='25';pix.dispatchEvent(new Event('input',{bubbles:true}));const baseline25=getLayerFillFadePixelization(layer);
      pix.value='100';pix.dispatchEvent(new Event('input',{bubbles:true}));const smooth100=getLayerFillFadePixelization(layer);
      mode.value='fadeSmooth';mode.dispatchEvent(new Event('change',{bubbles:true}));
      const smoothHidden=control.classList.contains('hidden');
      return{initial,sharpVisible,coarse,baseline25,smooth100,smoothHidden,text:document.getElementById('valFillFadePixelization').textContent};
    })()`);
    assert(r.initial.value===25&&r.initial.input===25,'Old project did not normalize sharp pixelization to 25%');
    assert(r.sharpVisible,'Pixelization control is not visible for sharp Fade');
    assert(r.coarse===0&&r.baseline25===25&&r.smooth100===100,'Pixelization slider state does not span 0/25/100');
    assert(r.smoothHidden,'Pixelization control must be hidden for the dedicated smooth Fade mode');
    assert(r.text==='100%','Pixelization value label did not update');
    const uncaught=uncaughtExceptions(h.events).slice(baseline);assert(!uncaught.length,'uncaught browser errors: '+JSON.stringify(uncaught));
  }finally{await h.close();}
  console.log('PASS 7.9 continuous Fade field + sharp pixelization 0/25/100');
}
main().catch(e=>{console.error('FAIL 7.9 Fade gradient/pixelization regression:',e.stack||e.message);process.exit(1)});
