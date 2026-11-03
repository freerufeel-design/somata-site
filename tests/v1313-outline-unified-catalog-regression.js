'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:30000});
  try{
    const r=await h.evaluate(`(async()=>{
      const ids=['outline.layerCount','outline.width','outline.color','outline.mode'];
      const R=window.SomataParameterRegistry,M=window.SomataParameterMatrix,B=window.SomataMorphParameterRouting,O=window.SomataOrangeMorphProfiles;
      const blueCatalog=M.all().filter(x=>x.id.startsWith('outline.')).map(x=>x.id);
      const orangeCatalog=M.all().filter(x=>x.id.startsWith('outline.')).map(x=>x.id);
      const audioCatalog=R.audioDefinitions().filter(x=>x.parameterId.startsWith('outline.')).map(x=>x.parameterId);
      const metadata=ids.map(id=>{const d=R.get(id);return {id,group:d.group,mainId:d.ui.mainId,type:d.type,target:d.morph.frameTarget,path:d.morph.framePath,supported:d.morph.supported,audio:d.audio.supported};});
      B.ensureProfiles(state.morph,state.minimalMorph);
      O.ensureProfiles(state.minimalMorph,state.randomOptions,state.randomLayerCount);
      const whitePreview={neutral:R.shiftHexHue('#ffffff',0),morph:R.shiftHexHue('#ffffff',120),black:R.shiftHexHue('#000000',120)};
      const originalOutline={...state.lineOutline},originalMorph={active:runtimeState.morph.active,paused:runtimeState.morph.paused,phaseSerial:runtimeState.morph.phaseSerial,geometryT:runtimeState.morph.geometryT};
      state.lineOutline.enabled=true;state.lineOutline.layerCount=0;state.lineOutline.width=1.5;state.lineOutline.color='#ff0000';state.lineOutline.mode='outer';
      // Add four params via the canonical registry (not an Audio-only list).
      const originalBlue=B.workingBindings(state.morph,state.minimalMorph).map(x=>({...x}));
      const originalOrange=O.workingBindings(state.minimalMorph,state.randomOptions,state.randomLayerCount).map(x=>({...x}));
      for(const id of ids){B.addBinding(state.morph,state.minimalMorph,id,id==='outline.color'?{min:120,max:120}:id==='outline.width'?{min:6,max:6}:id==='outline.layerCount'?{min:1,max:1}:{min:2,max:2});
        O.setBinding(state.minimalMorph,state.randomOptions,state.randomLayerCount,id,true,id==='outline.color'?{min:120,max:120}:id==='outline.width'?{min:6,max:6}:id==='outline.layerCount'?{min:1,max:1}:{min:2,max:2});}
      window.__syncParameterRoutingDecorations();
      const decorated=metadata.map(d=>{const input=document.getElementById(d.mainId);
        const host=d.id==='outline.layerCount'?input.closest('.blue-morph-range-host')||input:d.id==='outline.mode'?input.closest('.line-outline-modes'):input.closest('.blue-morph-range-host')||input;
        return{id:d.id,hostTag:host?.tagName,capable:host?.classList.contains('parameter-routing-capable'),blueOrange:host?.classList.contains('parameter-routing-blue-orange'),neutral:host?.classList.contains('parameter-routing-neutral'),context:host?.classList.contains('parameter-routing-control'),visual:host?.getBoundingClientRect().width||0};});
      const opened=()=>document.getElementById('parameterRoutingContextMenu');
      const input=document.getElementById('paramLineOutlineWidth');
      input.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:145}));
      const context={visible:!!opened()&&!opened().classList.contains('hidden'),text:opened()?.textContent||''};
      // All four Blue routes affect actual render-plan inputs without overwriting state.
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.pausedByOrangeProject=false;runtimeState.morph.pausedByGreenProject=false;
      runtimeState.morph.phaseSerial=(Number(runtimeState.morph.phaseSerial)||0)+1;runtimeState.morph.geometryT=1;B.resetRuntime(runtimeState.morph);
      const get=id=>B.resolveGlobalValue(id,id==='outline.color'?0:id==='outline.layerCount'?0:id==='outline.width'?1.5:0);
      const blue={layerCount:get('outline.layerCount'),width:get('outline.width'),hue:get('outline.color'),mode:get('outline.mode')};
      const ctx={layer:state.layers[0],effectLayer:state.layers[0],layerIndex:0,strokeWidth:2,geometryPlan:{kind:'polygon'},lineProfileApplication:'stroke'};
      const plan=resolveLayerOutlineEffectProvider(ctx,resetOutlineEffectPlan({}));
      const bluePlan={enabled:plan.enabled,extra:plan.extra,color:plan.color,mode:plan.mode};
      const immutable={...state.lineOutline};
      runtimeState.morph.active=false;B.resetRuntime(runtimeState.morph);
      const restored=resolveLayerOutlineEffectProvider(ctx,resetOutlineEffectPlan({}));
      // Orange uses the same global target sink (authored state generation).
      window.__somataApplyOrangeGlobalTargets({'outline.layerCount':1,'outline.width':5,'outline.color':120,'outline.mode':2});
      const orangeApplied={...state.lineOutline};
      const orangeBindings=O.workingBindings(state.minimalMorph,state.randomOptions,state.randomLayerCount).filter(b=>ids.includes(b.parameter)).map(b=>b.parameter);
      // Revert all fixture changes.
      state.lineOutline={...originalOutline};
      const bw=B.workingBindings(state.morph,state.minimalMorph);bw.splice(0,bw.length,...originalBlue);
      state.minimalMorph.routingBindings=originalOrange;
      Object.assign(runtimeState.morph,originalMorph);B.resetRuntime(runtimeState.morph);
      window.__syncParameterRoutingDecorations();
      const neutralBorder=document.getElementById('paramLineOutlineWidth').closest('.blue-morph-range-host').classList.contains('parameter-routing-neutral');
      return{whitePreview,neutralBorder,blueCatalog,orangeCatalog,audioCatalog,metadata,decorated,context,blue,bluePlan,immutable,restored:{enabled:restored.enabled},orangeApplied,orangeBindings};
    })()`,{timeoutMs:30000});
    const expected=['outline.layerCount','outline.width','outline.color','outline.mode'];
    for(const k of ['blueCatalog','orangeCatalog','audioCatalog','orangeBindings'])assert.deepEqual([...r[k]].sort(),[...expected].sort(),k);
    for(const d of r.metadata){assert.equal(d.group,'Линия');assert.equal(d.target,'global');assert.equal(d.supported,true);assert.equal(d.audio,true);assert(d.path.startsWith('lineOutline.'));}
    for(const d of r.decorated){assert(d.capable,'missing routing border '+d.id);assert(d.blueOrange,'missing blue-orange border '+d.id);assert(d.context,'missing context target '+d.id);assert(d.visual>0,'invisible host '+d.id);}
    assert(r.context.visible,'right click outline width did not open common routing popup');
    assert(/Orange|Оранж|Син|Blue|Morph/.test(r.context.text),'route menu lacks Morph controls');
    assert.equal(r.whitePreview.neutral,'#ffffff','Unrouted white must stay white');
    assert.notEqual(r.whitePreview.morph,'#ffffff','White outline colour automation must be visible');
    assert.notEqual(r.whitePreview.black,'#000000','Black outline colour automation must be visible');
    assert(r.neutralBorder,'Unrouted outline width must have a neutral grey frame');
    assert.equal(r.blue.layerCount,1);assert.equal(r.blue.width,6);assert.equal(r.blue.hue,120);assert.equal(r.blue.mode,2);
    assert.equal(r.bluePlan.enabled,true);assert.equal(r.bluePlan.extra,6);assert.equal(r.bluePlan.mode,'median');
    assert.notEqual(r.bluePlan.color,'#ff0000');
    assert.deepEqual(r.immutable,{enabled:true,layerCount:0,width:1.5,color:'#ff0000',mode:'outer'},'Blue changed authored settings');
    assert.equal(r.restored.enabled,false,'Blue disable not restored');
    assert.deepEqual(r.orangeApplied,{enabled:true,layerCount:1,width:5,color:'#00ff00',mode:'median'},'Orange did not apply all four canonical properties');
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS canonical Outline routing: Blue + Orange + Audio catalog, left panel routing borders, context menu, render-time Blue and authored Orange');
  }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
