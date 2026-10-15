const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const layer=state.layers[0];state.activeLayerId=layer.id;layer.fill=true;
      const mode=document.getElementById('paramFillMode'),dir=document.getElementById('paramFillFadeDirection'),hard=document.getElementById('paramFillFadeHardness');
      const set=(m,d,h)=>{mode.value=m;mode.dispatchEvent(new Event('change',{bubbles:true}));dir.value=d;dir.dispatchEvent(new Event('change',{bubbles:true}));hard.value=String(h);hard.dispatchEvent(new Event('input',{bubbles:true}));return{choice:getLayerFillModeChoice(layer),type:getLayerFillType(layer),direction:getLayerFillFadeDirection(layer),hardness:getLayerFillFadeHardness(layer),dirHidden:document.getElementById('fillFadeDirectionControl').classList.contains('hidden'),hardHidden:document.getElementById('fillFadeHardnessControl').classList.contains('hidden'),hint:document.getElementById('fillModeHint').textContent};};
      const sharp=set('fade','fromCenter',42);
      const smooth=set('fadeSmooth','toCenter',67);
      const normalized={old:normalizeLayerFillType('fade'),smooth:normalizeLayerFillType('fadeSmooth'),bad:normalizeLayerFillType('whatever')};
      const plan=SomataEffectStackOrder.plan({lineDisplayEnabled:true,effectsPlan:{},layer,effectLayer:layer,_geometryContract:{fillRequested:true}});
      return{sharp,smooth,normalized,plan:{fillType:plan.fillType,fillCanFuse:plan.fillCanFuse,standaloneFill:plan.standaloneFill},options:[...mode.options].map(o=>({value:o.value,text:o.textContent}))};
    })()`);
    assert(r.sharp.type==='fade'&&r.sharp.choice==='fade'&&!r.sharp.dirHidden&&!r.sharp.hardHidden,'Sharp fade mode is not preserved');
    assert(r.sharp.direction==='fromCenter'&&r.sharp.hardness===42,'Sharp fade controls did not persist');
    assert(r.smooth.type==='fadeSmooth'&&r.smooth.choice==='fadeSmooth'&&!r.smooth.dirHidden&&!r.smooth.hardHidden,'Smooth fade mode is not available');
    assert(r.smooth.direction==='toCenter'&&r.smooth.hardness===67,'Smooth fade reuses direction/hardness incorrectly');
    assert(r.normalized.old==='fade'&&r.normalized.smooth==='fadeSmooth'&&r.normalized.bad==='normal','Fade type normalization/backward compatibility broken');
    assert(r.plan.fillType==='fadeSmooth'&&!r.plan.fillCanFuse&&r.plan.standaloneFill,'Smooth fade is not isolated from Geometry');
    assert(r.options.some(o=>o.value==='fade'&&/резкая/.test(o.text))&&r.options.some(o=>o.value==='fadeSmooth'&&/плавная/.test(o.text)),'Fade mode labels missing');
    const uncaught=uncaughtExceptions(h.events).slice(baseline);assert(!uncaught.length,'uncaught browser errors: '+JSON.stringify(uncaught));
    console.log('PASS 7.8.3 sharp/smooth fading Fill modes + backward compatibility',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 fade modes regression:',e.stack||e.message);process.exit(1)});
