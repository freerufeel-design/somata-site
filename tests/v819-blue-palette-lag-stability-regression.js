const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(ok,message)=>{if(!ok)throw Error(message)};
const rgb=(hex)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:80,evalTimeoutMs:10000});
  try{
    const out=await h.evaluate(`(()=>{
      const chosen=getActivePlaylistPaletteKeys().find(key=>getPlaylistPaletteColors(key).length>=3);
      if(!chosen)throw Error('Need a palette with at least three stops');
      const colors=getPlaylistPaletteColors(chosen),idx=Math.min(colors.length-1,2);
      const original={active:runtimeState.morph.active,progress:runtimeState.morph.progress,t:runtimeState.morph.geometryT,source:runtimeState.morph.sourceVisuals,target:runtimeState.morph.targetVisuals,opts:state.morph.options,palette:state.morph.lineColorPalette,cycle:state.morph.cyclePalettes,tunnel:{...state.tunnel}};
      try{
        state.tunnel.active=true;state.tunnel.paletteLagEnabled=true;state.tunnel.colorShiftEnabled=false;
        state.morph.options={...state.morph.options,byColor:true};state.morph.lineColorPalette=chosen;state.morph.cyclePalettes=false;
        runtimeState.morph.active=true;runtimeState.morph.sourceVisuals=[{strokeColor:colors[0],fillColor:colors[0]+'80'}];runtimeState.morph.targetVisuals=[{strokeColor:colors[idx],fillColor:colors[idx]+'80'}];
        const values=[],profiles=[],fillColors=[];
        for(let i=0;i<=100;i++){
          runtimeState.morph.geometryT=i/100;
          const p=resolveTunnelPaletteProfile(colors[i===100?idx:0],null,0,'stroke');
          const f=resolveTunnelPaletteProfile(colors[0]+'80',null,0,'fill');
          profiles.push({key:p.key,index:p.index});
          values.push(getTunnelCopyColor(colors[0],{position:0,copyId:0,colorIndex:0},p));
          fillColors.push(getTunnelCopyColor(colors[0]+'80',{position:0,copyId:0,colorIndex:0},f));
        }
        // Three layers must keep their independent positions in the same palette.
        runtimeState.morph.sourceVisuals=[{strokeColor:colors[0]},{strokeColor:colors[1]},{strokeColor:colors[idx]}];
        runtimeState.morph.targetVisuals=[{strokeColor:colors[idx]},{strokeColor:colors[0]},{strokeColor:colors[1]}];
        runtimeState.morph.geometryT=.5;
        const multi=[0,1,2].map(i=>resolveTunnelPaletteProfile(colors[i%colors.length],null,i,'stroke'));
        const staticBefore=state.morph.lineColorPalette;
        runtimeState.morph.active=false;
        const oldPalette=resolveTunnelPaletteProfile(colors[0],null,0,'stroke');
        return{chosen,idx,colors,values,profiles,fillColors,multi,staticKey:oldPalette?.key,selectedAfter:staticBefore};
      }finally{
        runtimeState.morph.active=original.active;runtimeState.morph.progress=original.progress;runtimeState.morph.geometryT=original.t;runtimeState.morph.sourceVisuals=original.source;runtimeState.morph.targetVisuals=original.target;state.morph.options=original.opts;state.morph.lineColorPalette=original.palette;state.morph.cyclePalettes=original.cycle;Object.assign(state.tunnel,original.tunnel);
      }
    })()`,{timeoutMs:10000,label:'Blue+Corridor palette lag stability'});
    assert(out.profiles.length===101&&out.profiles.every(p=>p.key===out.chosen),'Blue changes palette during its colour Morph');
    assert(out.profiles[0].index===0,'Lag start does not match first palette stop');
    assert(Math.abs(out.profiles[100].index-out.idx)<1e-9,'Lag end does not match destination palette stop');
    for(let i=1;i<out.profiles.length;i++){
      assert(Math.abs(out.profiles[i].index-out.profiles[i-1].index)<=0.03,'Palette index jumped in a frame: '+i);
      const first=rgb(out.values[i-1]),second=rgb(out.values[i]);
      assert(Math.max(...first.map((v,k)=>Math.abs(v-second[k])))<=30,'Visible lag colour jumped in a frame: '+i);
    }
    assert(out.multi.length===3&&out.multi.every(p=>p.key===out.chosen)&&new Set(out.multi.map(p=>p.index)).size===3,'Independent layers share the wrong palette anchor');
    assert(out.fillColors.every(c=>/^#[0-9a-f]{8}$/i.test(c)&&c.endsWith('80')),'Fill alpha was lost');
    assert(out.selectedAfter===out.chosen,'Palette selection mutated despite cyclePalettes OFF');
    assert(uncaughtExceptions(h.events).length===0,'Uncaught browser exceptions: '+uncaughtExceptions(h.events).join(' | '));
    console.log('V819 BLUE + PALETTE LAG: PASS',JSON.stringify({palette:out.chosen,frameSamples:out.values.length,start:out.values[0],end:out.values[100],staticKey:out.staticKey}));
  }finally{await h.close();}
})().catch(e=>{console.error('V819 BLUE + PALETTE LAG: FAIL',e.stack||e);process.exitCode=1});
