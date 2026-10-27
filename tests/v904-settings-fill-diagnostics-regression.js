'use strict';
const fs=require('fs');const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const root=path.join(__dirname,'..');
const assert=(x,s)=>{if(!x)throw Error(s)};
(async()=>{
  const playlist=JSON.parse(fs.readFileSync(path.join(root,'default.plist'),'utf8'));
  const correct=m=>m.showFps===true&&m.showPresets===false&&m.showProjects===true&&m.showMorphs===false&&m.showProfiles===false&&m.pauseOnSpace===false;
  assert(correct(playlist.menuSettings),'default playlist visibility');
  assert(playlist.projects.length===22&&playlist.projects.every(p=>{const m=p.project.settings.menuSettings;return m.showPresets===false&&m.showProjects===true&&m.showMorphs===false&&typeof m.showProfiles==='boolean'}),'original project-specific visibility fixtures');
  assert(fs.readdirSync(root).filter(f=>f.toLowerCase().endsWith('.plist')).join(',')==='default.plist','only default.plist may be packaged');
  const fill=fs.readFileSync(path.join(root,'js/render/fill-pass.js'),'utf8');
  const retry=fill.slice(fill.indexOf('    function resolve(frameCtx,batch,plan,'));
  assert(!retry.includes('requestMainCanvasRender?.()'),'failed GPU-only Fill must never self-invalidate render loop');
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350});
  try {
    const data=await h.evaluate(`(()=>{
      const vis=state.uiVisibility;
      const prefs={fps:document.getElementById('showFpsSetting').checked,auto:document.getElementById('autoShowErrorConsoleSetting').checked,
        presets:document.getElementById('showPresetChooser').checked,projects:document.getElementById('hideProjectChooser').checked,
        morphs:document.getElementById('hideMorphChooser').checked,profiles:document.getElementById('hideProfiles').checked,
        pause:document.getElementById('morphPauseOnSpace').checked};
      // Exercise the failing Fill backend *through the registered service*.
      // Unlike checking source text alone, this proves repeated misses do not
      // enqueue unbounded redraws when WebGPU is unavailable.
      const l=state.layers[0],fc={layer:l,effectLayer:l,sourceLayer:l,frameId:1,frame:{id:1},geometryPlan:{kind:'static',dynamic:false},effectsPlan:{},layerIndex:0};
      const fillContract={fillRequested:true,fillAlpha:1,geometry:{closedPathCount:1,openPathCount:0,fillContourCount:1,hasClosedFillTopology:true},gpuMaskEligible:true};
      const invalidationsBefore=animationScheduler.stats().invalidateCount;
      const fillResults=[];
      for(let j=0;j<3;j++)fillResults.push(SomataFillPassService.resolve(fc,null,{contract:fillContract,forceCanvasFill:false,sceneHasAuthoritativeFill:false}));
      const fillRetries=animationScheduler.stats().invalidateCount-invalidationsBefore;
      const before=__somataScreenErrors.entries.length;
      console.warn('[SpiroStar Fill] NOT DRAWN @ gpu-backend-chain: GPU Fill backends returned false',{stage:'gpu-backend-chain'});
      const after=__somataScreenErrors.entries;
      console.error('[Somata 9.0.4 GPU-TEST1234] fill/gpu-only: GPU Fill backends returned false');
      const errs=__somataScreenErrors.entries;
      return{vis,prefs,fillRetries,fillResults,bridge:after.length===before+1&&after[after.length-1].includes('GPU Fill backends returned false'),
        errorBridge:errs.length===after.length+1&&errs[errs.length-1].includes('GPU-TEST1234'),
        popup:__somataScreenErrors.visible,autoShow:__somataScreenErrors.autoShow};
    })()`);
    assert(data.vis.showPresets===false&&data.vis.showProjects===true&&data.vis.hideMorphChooser===true&&data.vis.hideProfiles===false,'Somata 9.1 application menu state');
    assert(data.prefs.fps===true&&data.prefs.auto===false&&data.prefs.presets===false&&data.prefs.projects===true&&data.prefs.morphs===false&&data.prefs.profiles===true&&data.prefs.pause===false,'UI defaults differ from Somata 9.1 requirements');
    assert(data.fillRetries===0&&data.fillResults.every(x=>x===false),'failed Fill must not restart render loop');
    assert(data.bridge&&data.errorBridge,'GPU warnings and errors must reach on-screen FPS console');
    assert(data.autoShow===false,'error console must respect user selected auto-show preference');
    assert(!uncaughtExceptions(h.events).length,'uncaught browser exceptions');
    console.log('PASS v910 settings, single default playlist, GPU Fill backoff and FPS diagnostic bridge',JSON.stringify(data));
  }finally{await h.close()}
})().catch(e=>{console.error('FAIL v904',e.stack||e);process.exit(1)});
