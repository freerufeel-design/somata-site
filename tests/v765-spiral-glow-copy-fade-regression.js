const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

async function main(){
  const mainSource=fs.readFileSync(path.join(__dirname,'../js/render/main-pipeline.js'),'utf8');
  const glowSource=fs.readFileSync(path.join(__dirname,'../js/render/glow-pass.js'),'utf8');
  assert(/SomataGeometryRoleService\.renderGlowBase\(frameCtx/.test(glowSource)&&/SomataGeometryRoleService\.renderGlow\(frameCtx/.test(glowSource),
    'Glow pass does not route fused and standalone Glow through the semantic geometry-role service');
  assert(!/WebGPUSpiralBezierMorphRenderer|WebGPUTopologyMorphBaseRenderer|WebGPUGreenProjectMorphRenderer/.test(glowSource),
    'Glow pass knows concrete geometry renderers and can bypass the module firewall');
  assert(!/WebGPUSpiralBezierMorphRenderer/.test(mainSource),
    'main pipeline regained direct Spiral renderer knowledge');

  const coreSource=fs.readFileSync(path.join(__dirname,'../js/app/geometry-gpu-core.js'),'utf8');
  assert(coreSource.includes('spiralSeamAlpha:SOMATA_CORRIDOR_INTERPOLATE_COPY_ALPHA_ALONG_SPIRAL'),
    'static/general Corridor is not bound to the whole-copy alpha policy');

  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:16000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const routing={
        morph:__somataSpiralBezierGlowRouting({_spiralBezierMorphGpuNative:true},false),
        staticNormal:__somataSpiralBezierGlowRouting({_spiralBezierMorphGpuNative:false},false),
        strict:__somataSpiralBezierGlowRouting({_spiralBezierMorphGpuNative:false},true)
      };
      const policy=__spiroCorridorRevealPolicy?.();
      const backup={...state.tunnel};
      state.tunnel.active=true;state.tunnel.centerHiddenCopies=3;state.tunnel.minScale=.055;state.tunnel.travelPhase=.5;
      const copies=getTunnelCopies();
      const partial=copies.find(c=>Number(c.centerRevealAlpha)>.001&&Number(c.centerRevealAlpha)<.999);
      const vis=prepareTunnelVisibleInstances(copies,220,1,900,1,'v765-center',performance.now());
      const idx=partial?vis.copies.indexOf(partial):-1;
      const copySample=partial?{copyId:partial.copyId,scale:partial.scale,reveal:Number(partial.centerRevealAlpha),visible:idx>=0?Number(vis.alphas[idx]):-1}:null;
      Object.assign(state.tunnel,backup);
      const architecture=__somata76MorphArchitectureStatus?.();
      const spiralStatus=__somataSpiralBezierMorphStatus?.();
      return{routing,policy,copySample,architectureVersion:architecture?.version||'',contract:spiralStatus?.contract||''};
    })()`,{timeoutMs:12000,label:'7.6.5 Spiral Glow / whole-copy center reveal'});

    assert(out.routing.morph===true,'retained Spiral Morph does not route Glow to the retained rail');
    assert(out.routing.staticNormal===false,'ordinary static layer unexpectedly claims retained-Morph Glow routing');
    assert(out.routing.strict===true,'strict Spiral routing no longer routes Glow');
    assert(out.policy?.owner==='copy-alpha'&&out.policy?.alphaScope==='whole-copy','Corridor reveal is not whole-copy alpha');
    assert(out.policy?.interpolateAlongSpiral===false,'Corridor still interpolates one copy alpha into the next along a Spiral');
    assert(out.policy?.radialMask===false,'a radial center mask is still enabled');
    assert(out.copySample&&out.copySample.reveal>0&&out.copySample.reveal<1,'test did not capture a newly emerging Corridor copy');
    assert(out.copySample.visible>0&&out.copySample.visible<1,'new Corridor copy is not partially visible through copy alpha');
    assert(/^\d+\.\d+\.\d+$/.test(out.architectureVersion),`geometry contract status is invalid: ${out.architectureVersion}`);
    assert(String(out.contract).includes('whole-copy alpha')&&String(out.contract).includes('Glow follows'),
      'Spiral status does not advertise the 7.6.5 Glow/copy-alpha contract');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6.5 SPIRAL GLOW / COPY-FADE REGRESSION: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6.5 Spiral Glow / copy-fade regression:',e.stack||e.message);process.exit(1)});
