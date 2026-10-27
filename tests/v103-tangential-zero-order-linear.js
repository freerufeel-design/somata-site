'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:25000});
  try{
    const result=await h.evaluate(`(()=>{
      const initial=createLayer('v103-default-tangency');
      const checkbox=document.getElementById('paramSpiralTangential');
      const order=document.getElementById('paramSpiralOrder');
      initial.spiralEnabled=true;initial.spiralOrder=0;
      state.layers=[initial];state.activeLayerId=initial.id;syncSidebarInputs();
      const zeroUI={checked:checkbox.checked,disabled:checkbox.disabled,default:initial.spiralTangential,
        framed:document.getElementById('spiralOrderControl')?.classList.contains('spiral-order-morphable'),
        border:getComputedStyle(document.getElementById('spiralOrderControl')).borderTopWidth};
      initial.spiralTangential=true;syncSidebarInputs();
      const legacyZero={checked:checkbox.checked,disabled:checkbox.disabled};
      const samples=(enabled,spiralOrder,mix)=>{const layer=createLayer('v103-shape');Object.assign(layer,{spiralEnabled:true,spiralOrder,spiralTangential:enabled,
        N:6,K:1,radius:220,profileMode:'segments',profileNodes:[{x:0,y:0},{x:0.5,y:0.1},{x:1,y:0}],rounding:0});
        if(mix!==undefined)layer.__spiralTangentialMix=mix;
        const polys=buildOrbitPolylines(layer)||[];const path=polys[0]?.points||[];
        return path.map(p=>[+p.x.toFixed(6),+p.y.toFixed(6)]).slice(0,20);
      };
      const zeroOff=samples(false,0),zeroOn=samples(true,0),zeroStale=samples(true,0,1);
      const nonzeroOff=samples(false,2),nonzeroOn=samples(true,2);
      const now=performance.now()+1500;
      const animation=(fromOrder,toOrder,fromTangent,toTangent)=>{
        const layer=createLayer('v103-animation');Object.assign(layer,{spiralEnabled:true,spiralOrder:fromOrder,spiralTangential:fromTangent,
          testMorph:{enabled:true,mode:'circleSlide',spiralType:'phaseCircle',duration:1}});
        state.layers=[layer];state.activeLayerId=layer.id;SomataTestMorph.updateTask();
        const frame=(time)=>{const visual=SomataRenderLayerSnapshot.create(layer);
          SomataTestMorph.applyFrame({layer:visual,sourceLayer:layer,layerIndex:0,
            blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}},time);
          return {mix:visual.__spiralTangentialMix,order:visual.spiralOrder};};
        frame(now);layer.spiralOrder=toOrder;layer.spiralTangential=toTangent;
        const values=[0,.25,.5,.75,1].map(u=>frame(now+1000+u*1000));
        state.layers=[];SomataTestMorph.updateTask();return values;
      };
      const forward=animation(0,2,true,true),reverse=animation(2,0,true,true);
      const toggled=animation(2,2,false,true),untoggled=animation(2,2,true,false);
      state.layers=[initial];state.activeLayerId=initial.id;initial.spiralOrder=2;syncSidebarInputs();
      return {zeroUI,legacyZero,atTwo:{checked:checkbox.checked,disabled:checkbox.disabled},
        zeroOff,zeroOn,zeroStale,nonzeroOff,nonzeroOn,forward,reverse,toggled,untoggled};
    })()`,{label:'10.3 zero-order tangency / linear transitions / morph order framing'});
    assert.equal(result.zeroUI.default,false,'New layers must start without tangentiality');
    assert.equal(result.zeroUI.checked,false);assert.equal(result.zeroUI.disabled,true);
    assert.equal(result.legacyZero.checked,false);assert.equal(result.legacyZero.disabled,true);
    assert(result.zeroUI.framed,'Spiral order must have the morph frame class');
    assert.deepEqual(result.zeroOff,result.zeroOn,'Order 0 checkbox must not affect polygon');
    assert.deepEqual(result.zeroOff,result.zeroStale,'Order 0 stale mix must not affect polygon');
    assert.notDeepEqual(result.nonzeroOff,result.nonzeroOn,'Nonzero order must still allow tangency');
    assert(result.atTwo.checked&&!result.atTwo.disabled,'Explicitly saved true reactivates above order 0');
    for(const [key,expected] of [
      ['forward',[0,.15625,.5,.84375,1]],['reverse',[1,.84375,.5,.15625,0]],
      ['toggled',[0,.15625,.5,.84375,1]],['untoggled',[1,.84375,.5,.15625,0]]]){
      result[key].forEach((o,i)=>assert(Math.abs(o.mix-expected[i])<1e-7,`${key} frame ${i}: ${JSON.stringify(o)}`));
    }
    assert.equal(uncaughtExceptions(h.events).length,0);
    console.log('PASS v103 tangent defaults, zero-order invariance, both eased directions and morphable order field');
  }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
