'use strict';
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,s)=>{if(!v)throw Error(s)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:420,evalTimeoutMs:14000});
 try{
  const out=await h.evaluate(`(()=>{
   document.getElementById('btnSidebarShape')?.click();
   const layer=state.layers.find(x=>x.id===state.activeLayerId);
   Object.assign(layer,{spiralEnabled:true,spiralClosed:true,spiralOrder:3,N:8,K:3,opacity:100});
   const enabled=document.getElementById('testMorphEnabled');if(!enabled.checked)enabled.click();
   SomataTestMorph.syncUI();
   const panel=document.getElementById('testMorphControls'),row=document.getElementById('testMorphSpiralRow');
   const elements=[...panel.querySelectorAll('select,input')];
   const sidebar=document.getElementById('settingsSidebar').getBoundingClientRect();
   const bounds=[panel,row,...elements].map(el=>({id:el.id||el.tagName,x:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}));
   const inside=bounds.every(x=>x.x>=sidebar.left-1&&x.right<=sidebar.right+1);
   const renderer=WebGPUSpiralBezierMorphRenderer,original=renderer.beginStaticEdit;
   let calls=[];renderer.beginStaticEdit=(index,pair)=>{calls.push({index,sourceN:pair.sourceLayer.N,targetN:pair.targetLayer.N,spiralType:pair.spiralType,progress:pair.progress,mode:pair.mode});return true;};
   try{
    const snap=()=>({layer:SomataRenderLayerSnapshot.create(layer),sourceLayer:layer,layerIndex:0,
      blueMorphProvider:{active:false},orangeMorphProvider:{active:false},greenMorphProvider:{active:false}});
    SomataTestMorph.applyFrame(snap(),performance.now()+1200);
    const origin=layer.N;layer.N=origin+5;
    const t=performance.now(),first=snap();SomataTestMorph.applyFrame(first,t);
    const middle=snap();SomataTestMorph.applyFrame(middle,t+450);
    const final=snap();SomataTestMorph.applyFrame(final,t+1450);
    return{inside,bounds,sidebar:{left:sidebar.left,right:sidebar.right},origin,nowN:layer.N,
      calls,first:{kind:first.geometryProvider?.kind,edit:first.spiralEditMorph?.progress,opacity:first.layer.opacity},
      middle:{kind:middle.geometryProvider?.kind,edit:middle.spiralEditMorph?.progress,opacity:middle.layer.opacity},
      settled:SomataTestMorph.status().active===false,
      availableTypes:[...document.getElementById('testMorphSpiralType').options].map(o=>o.value),
      noFade:middle.layer.opacity>99};
   }finally{renderer.beginStaticEdit=original;}
  })()`,{timeoutMs:14000});
  assert(out.inside,'Static animation controls overflow sidebar: '+JSON.stringify(out.bounds));
  assert(out.calls.length>=2&&out.calls.every(x=>x.sourceN===out.origin&&x.targetN===out.origin+5),'retained edit does not carry fixed endpoints');
  assert(out.first.kind==='blue-circle-slide'&&out.middle.kind==='blue-circle-slide','real GPU edit not routed into Blue geometry');
  assert(out.middle.edit>0&&out.middle.edit<1&&out.noFade,'no realtime 0<t<1 Spiral morph');
  assert(out.settled&&out.nowN===out.origin+5,'static geometry was not restored after edit');
  assert(out.availableTypes.length===6,'Spiral morph transports missing');
  assert(!uncaughtExceptions(h.events).length,'uncaught browser errors');
  console.log('PASS v9011 Spiral static GPU realtime + sidebar fitting',JSON.stringify({calls:out.calls.length,inside:out.inside,midProgress:out.middle.edit,settled:out.settled}));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL v9011',e.stack||e);process.exitCode=1});
