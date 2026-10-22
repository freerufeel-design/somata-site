const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{let h=await createBrowserHarness({disableGpu:true,loadDelayMs:75});try{let r=await h.evaluate(`(()=>{
  let keys=getActivePlaylistPaletteKeys(),key=keys[0],colors=getPlaylistPaletteColors(key);
  const old={a:runtimeState.morph.active,s:runtimeState.morph.sourceVisuals,t:runtimeState.morph.targetVisuals,p:runtimeState.morph.geometryT,o:state.morph.options,c:state.morph.lineColorPalette,tunnel:{...state.tunnel}};
  try{
  state.tunnel.active=true;state.tunnel.paletteLagEnabled=true;state.morph.lineColorPalette=key;state.morph.options={...state.morph.options,byColor:true};
  runtimeState.morph.active=true;runtimeState.morph.sourceVisuals=[{strokeColor:colors[0]}];runtimeState.morph.targetVisuals=[{strokeColor:colors[Math.min(2,colors.length-1)]}];
  for(let i=0;i<30;i++)resolveTunnelPaletteProfile(colors[0],null,0,'stroke');
  let samples=[];for(let run=0;run<5;run++){let then=performance.now();for(let i=0;i<600;i++){runtimeState.morph.geometryT=i/600;resolveTunnelPaletteProfile(colors[0],null,0,'stroke');}samples.push(performance.now()-then);}
  return {palette:key,numberOfPalettes:keys.length,ms: samples.sort((a,b)=>a-b)[2]};
  }finally{runtimeState.morph.active=old.a;runtimeState.morph.sourceVisuals=old.s;runtimeState.morph.targetVisuals=old.t;runtimeState.morph.geometryT=old.p;state.morph.options=old.o;state.morph.lineColorPalette=old.c;Object.assign(state.tunnel,old.tunnel);}
})()`,{timeoutMs:15000});console.log('BENCH:',JSON.stringify(r));}finally{await h.close();}})().catch(e=>{console.error('BENCH FAIL',e.stack||e);process.exitCode=1});
