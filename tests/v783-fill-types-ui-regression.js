const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:450});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const layer=state.layers[0];state.activeLayerId=layer.id;layer.fill=true;layer.lineVisible=true;
      const mode=document.getElementById('paramFillMode');
      const accum=document.getElementById('fillAccumulationControl');
      const fadeDir=document.getElementById('fillFadeDirectionControl');
      const fadeHard=document.getElementById('fillFadeHardnessControl');
      const setMode=(value)=>{mode.value=value;mode.dispatchEvent(new Event('change',{bubbles:true}));return {choice:getLayerFillModeChoice(layer),type:getLayerFillType(layer),rule:getLayerFillRule(layer),accumHidden:accum.classList.contains('hidden'),fadeDirHidden:fadeDir.classList.contains('hidden'),fadeHardHidden:fadeHard.classList.contains('hidden')};};
      const mathematical=setMode('mathematical');
      const accumulation=setMode('accumulation');
      const timer=document.getElementById('paramFillAccumulationSeconds');timer.value='7.5';timer.dispatchEvent(new Event('change',{bubbles:true}));
      const fade=setMode('fade');
      const dir=document.getElementById('paramFillFadeDirection');dir.value='toCenter';dir.dispatchEvent(new Event('change',{bubbles:true}));
      const hard=document.getElementById('paramFillFadeHardness');hard.value='63';hard.dispatchEvent(new Event('input',{bubbles:true}));
      const fadeState={direction:layer.fillFadeDirection,hardness:layer.fillFadeHardness,hardText:document.getElementById('valFillFadeHardness').textContent};
      const fadeSmooth=setMode('fadeSmooth');
      const dense=setMode('dense');
      const accumFromDense=setMode('accumulation');
      const plans={};
      layer.fillType='normal';state.showWeb=false;layer.showWeb=false;plans.normal=SomataEffectStackOrder.plan({lineDisplayEnabled:true,effectsPlan:{},layer,effectLayer:layer,_geometryContract:{fillRequested:true}});
      layer.fillType='accumulation';plans.accum=SomataEffectStackOrder.plan({lineDisplayEnabled:true,effectsPlan:{},layer,effectLayer:layer,_geometryContract:{fillRequested:true}});
      layer.fillType='fade';plans.fade=SomataEffectStackOrder.plan({lineDisplayEnabled:true,effectsPlan:{},layer,effectLayer:layer,_geometryContract:{fillRequested:true}});
      layer.fillType='fadeSmooth';plans.fadeSmooth=SomataEffectStackOrder.plan({lineDisplayEnabled:true,effectsPlan:{},layer,effectLayer:layer,_geometryContract:{fillRequested:true}});
      state.zoom=1.73;state.panX=41;state.panY=-19;document.getElementById('zoomDisplay').textContent='173%';document.getElementById('zoomDisplay').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));
      return{mathematical,accumulation,timer:layer.fillAccumulationSeconds,fade,fadeSmooth,fadeState,dense,accumFromDense,plans:{normal:{fillCanFuse:plans.normal.fillCanFuse,standaloneFill:plans.normal.standaloneFill,fillType:plans.normal.fillType},accum:{fillCanFuse:plans.accum.fillCanFuse,standaloneFill:plans.accum.standaloneFill,fillType:plans.accum.fillType},fade:{fillCanFuse:plans.fade.fillCanFuse,standaloneFill:plans.fade.standaloneFill,fillType:plans.fade.fillType},fadeSmooth:{fillCanFuse:plans.fadeSmooth.fillCanFuse,standaloneFill:plans.fadeSmooth.standaloneFill,fillType:plans.fadeSmooth.fillType}},zoom:state.zoom,pan:[state.panX,state.panY],zoomText:document.getElementById('zoomDisplay').textContent,options:[...mode.options].map(o=>[o.value,o.textContent])};
    })()`);
    assert(r.options.length===5,'Fill type menu does not have exactly five entries');
    assert(r.mathematical.type==='normal'&&r.mathematical.rule==='evenodd','Mathematical Fill lost legacy even-odd rule');
    assert(r.accumulation.type==='accumulation'&&!r.accumulation.accumHidden&&r.accumulation.fadeDirHidden,'Accumulation controls visibility/type wrong');
    assert(Math.abs(r.timer-7.5)<1e-9,'Accumulation timer is not stored in seconds');
    assert(r.fade.type==='fade'&&r.fade.accumHidden&&!r.fade.fadeDirHidden&&!r.fade.fadeHardHidden,'Sharp Fade controls visibility/type wrong');
    assert(r.fadeSmooth.type==='fadeSmooth'&&r.fadeSmooth.accumHidden&&!r.fadeSmooth.fadeDirHidden&&!r.fadeSmooth.fadeHardHidden,'Smooth Fade controls visibility/type wrong');
    assert(r.fadeState.direction==='toCenter'&&r.fadeState.hardness===63&&r.fadeState.hardText==='63%','Fade direction/hardness UI did not commit');
    assert(r.dense.rule==='nonzero'&&r.dense.type==='normal','Dense Fill lost legacy non-zero rule');
    assert(r.accumFromDense.rule==='nonzero','Special Fill did not preserve the last legacy topology rule');
    assert(r.plans.normal.fillCanFuse===true&&!r.plans.normal.standaloneFill,'Legacy Fill lost no-Web fast path');
    assert(!r.plans.accum.fillCanFuse&&r.plans.accum.standaloneFill&&r.plans.accum.fillType==='accumulation','Accumulation Fill was allowed to fuse with Geometry');
    assert(!r.plans.fade.fillCanFuse&&r.plans.fade.standaloneFill&&r.plans.fade.fillType==='fade','Sharp Fade Fill was allowed to fuse with Geometry');
    assert(!r.plans.fadeSmooth.fillCanFuse&&r.plans.fadeSmooth.standaloneFill&&r.plans.fadeSmooth.fillType==='fadeSmooth','Smooth Fade Fill was allowed to fuse with Geometry');
    assert(r.zoom===1&&r.zoomText==='100%','Double-click zoom display did not restore exact 100%');
    assert(r.pan[0]===41&&r.pan[1]===-19,'Double-click zoom reset unexpectedly changed pan');
    const uncaught=uncaughtExceptions(h.events).slice(baseline);assert(!uncaught.length,'uncaught browser errors: '+JSON.stringify(uncaught));
    console.log('PASS 7.8.3 Fill types UI/state + zoom double-click',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Fill types UI regression:',e.stack||e.message);process.exit(1)});
