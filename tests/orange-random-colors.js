const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:20000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(async()=>{
      const count=document.getElementById('randomLayerCount');count.value='3';count.dispatchEvent(new Event('change',{bubbles:true}));
      const byColor=document.getElementById('randomByColor');if(byColor){byColor.checked=true;byColor.dispatchEvent(new Event('change',{bubbles:true}));}
      const palette=document.querySelector('[data-palette-select="random"]')||document.getElementById('randomLineColorPalette');
      if(palette){palette.value='standard';palette.dispatchEvent(new Event('change',{bubbles:true}));}
      state.randomOptions.lineColorPalette='standard';state.randomOptions.byColor=true;
      const fullPalette=(getPlaylistPaletteColors('standard')||[]).map(c=>String(c).toLowerCase());
      const first3=fullPalette.slice(0,3);
      const mode=document.getElementById('minimalMorphMode');const dice=document.getElementById('btnRandomPreset');
      const samples=[];
      for(const m of ['standard','closed','loops','open','mandala']){
        mode.value=m;mode.dispatchEvent(new Event('change',{bubbles:true}));
        for(let i=0;i<8;i++){
          dice.click();await new Promise(r=>setTimeout(r,5));
          const c=state.layers.slice(0,3).map(l=>String(l.strokeColor||'').toLowerCase());
          samples.push({m,c,unique:new Set(c).size,outsideFirst3:c.some(x=>!first3.includes(x)),signature:c.join('|')});
        }
      }
      mode.value='mandala';mode.dispatchEvent(new Event('change',{bubbles:true}));
      const instant=document.getElementById('minimalMorphInstant');instant.checked=true;instant.dispatchEvent(new Event('change',{bubbles:true}));
      const orange=document.getElementById('btnMinimalMorph');const orangeSamples=[];
      for(let i=0;i<8;i++){
        if(runtimeState.minimalMorph.active)orange.click();
        orange.click();await new Promise(r=>setTimeout(r,35));
        const c=state.layers.slice(0,3).map(l=>String(l.strokeColor||'').toLowerCase());
        orangeSamples.push({c,unique:new Set(c).size,outsideFirst3:c.some(x=>!first3.includes(x)),signature:c.join('|')});
        if(runtimeState.minimalMorph.active)orange.click();
        await new Promise(r=>setTimeout(r,8));
      }
      return{samples,orangeSamples,first3,fullPalette};
    })()`);
    for(const s of result.samples)assert(s.unique===3,`dice produced repeated colors in ${s.m}: ${s.c.join(',')}`);
    assert(result.samples.some(s=>s.outsideFirst3),`dice stayed pinned to first three palette colors: ${result.first3.join(',')}`);
    assert(new Set(result.samples.map(s=>s.signature)).size>3,'dice color triples did not vary across random generations');
    for(const s of result.orangeSamples)assert(s.unique===3,`Orange Morph produced repeated colors: ${s.c.join(',')}`);
    assert(result.orangeSamples.some(s=>s.outsideFirst3),`Orange Morph stayed pinned to first three palette colors: ${result.first3.join(',')}`);
    assert(new Set(result.orangeSamples.map(s=>s.signature)).size>1,'Orange Morph color triple did not vary between starts');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,`uncaught browser exceptions: ${errors.join(' | ')}`);
    console.log('ORANGE RANDOM COLORS: PASS',{diceSamples:result.samples.length,orangeSamples:result.orangeSamples.length,first3:result.first3});
  }finally{await h.close();}
}
main().catch(err=>{console.error('ORANGE RANDOM COLORS: FAIL',err);process.exit(1);});
