const {createBrowserHarness,uncaughtExceptions,sleep}=require('./lib/browser-harness');
const check=(x,msg)=>{if(!x)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:450,evalTimeoutMs:15000});
 try{
  const r=await h.evaluate(`(async()=>{
    const reg=SomataParameterRegistry,mat=SomataParameterMatrix;
    const curve=SomataCorridorDepthCurve;
    const zero=Array.from({length:22},(_,i)=>curve.position(i,22,0,1)===i).every(Boolean);
    const midpoint=curve.position(10,21,100,1)===10&&curve.position(10,21,-100,1)===10;
    const narrow=curve.position(11,21,-100,1)<11,wide=curve.position(11,21,100,1)>11;
    const strict=curve.position(1,21,-100,1)<curve.position(2,21,-100,1);
    const ids=['tunnel.depthCurve','ambient.rain.angle','ambient.rain.density','ambient.rain.hue','ambient.rain.opacity','ambient.rain.speed','ambient.dichotomy.count','ambient.clouds.speed','prism.refraction'];
    const matrix=ids.every(id=>reg.get(id)&&mat.get(id)&&(mat.all().some(d=>d.id===id)||mat.descendants('tunnel.depthCurve').some(d=>d.id===id)));
    const audio=SomataParameterRegistry.audioDefinitions().some(d=>d.key==='ambient.rain.angle')&&reg.get('tunnel.depthCurveMultiplier')&&mat.descendants('tunnel.depthCurve').some(d=>d.id==='tunnel.depthCurveMultiplier');
    document.getElementById('btnTunnelSettings').click();
    const settings=document.getElementById('tunnelDepthCurveNumber');
    settings.value='65';settings.dispatchEvent(new Event('input',{bubbles:true}));
    const curveChanged=state.tunnel.depthCurve===65;
    settings.value='0';settings.dispatchEvent(new Event('input',{bubbles:true}));
    const ambientBtn=document.getElementById('btnSidebarAmbient');ambientBtn.click();
    const ambientPanel=state.sidebarMode==='ambient'&&document.querySelector('#settingsSidebar.sidebar-mode-ambient')!=null;
    const rain=document.getElementById('ambientRainEnabled');rain.click();
    const rainOn=state.ambient.rain.enabled===true;
    SomataAmbientPrism.render(performance.now());
    const rainCanvas=document.getElementById('ambientOverlayCanvas');
    const rainPixels=rainCanvas?.getContext('2d')?.getImageData(0,0,rainCanvas.width,rainCanvas.height).data;
    const rainOutput=!!rainPixels&&rainPixels.some((value,i)=>i%4===3&&value>0);
    rain.click();
    const prismBtn=document.getElementById('btnSidebarPrism');prismBtn.click();
    const prismPanel=state.sidebarMode==='prism';
    // 8.20.5 defaults to OFF and 2D Sprite; select legacy to test historical overlay geometry.
    if(!state.prism.enabled)document.getElementById('prismEnabled').click();
    state.prism.mode='2d';state.prism.source2d='legacy';SomataAmbientPrism.syncUI();
    const shapeSelect=document.getElementById('prismShape');shapeSelect.value='cube';shapeSelect.dispatchEvent(new Event('change',{bubbles:true}));
    SomataAmbientPrism.render(performance.now());
    const prismOn=state.prism.enabled===true&&state.prism.shape==='cube';
    const prismOutputs={};
    for(const shape of ['lens','cube','skull','dodecahedron','cross']){
      shapeSelect.value=shape;shapeSelect.dispatchEvent(new Event('change',{bubbles:true}));
      SomataAmbientPrism.render(performance.now());
      const canvas=document.getElementById('prismOverlayCanvas');
      const px=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      const gpu=window.SomataPrism3D?.status?.();
      prismOutputs[shape]=px.some((v,i)=>i%4===3&&v>0); // intentionally testing the legacy 2D route
    }
    const testToggle=document.getElementById('testMorphEnabled');
    document.getElementById('btnSidebarShape').click();testToggle.click();
    const testOn=state.layers.find(l=>l.id===state.activeLayerId)?.testMorph?.enabled===true;
    const initialLayer=JSON.stringify(state.layers.find(l=>l.id===state.activeLayerId));
    const source=state.layers.find(l=>l.id===state.activeLayerId);
    const snapshot=SomataRenderLayerSnapshot.create(source),ctx={layer:snapshot,sourceLayer:source,blueMorphProvider:{active:false},minimalFadeEnabled:false,greenMorphEnabled:false};
    const at=performance.now();SomataTestMorph.applyFrame(ctx,at+500);
    const captured0=SomataTestMorph.status().last;
    const idle=!SomataTestMorph.status().active;
    // New contract: an enabled checkbox is idle until an authored parameter is changed.
    const radiusBefore=source.radius;
    source.radius=radiusBefore+30;
    const startCtx={...ctx,layer:SomataRenderLayerSnapshot.create(source)};
    SomataTestMorph.applyFrame(startCtx,at+600);
    const secondCtx={...ctx,layer:SomataRenderLayerSnapshot.create(source)};
    SomataTestMorph.applyFrame(secondCtx,at+1100);
    const captured=SomataTestMorph.status().last;
    const frameChanged=secondCtx.layer.radius>radiusBefore && secondCtx.layer.radius<source.radius;
    source.radius=radiusBefore;
    // The authored object is intentionally restored before checking immutability.
    const authoredUnchanged=JSON.stringify(source)===initialLayer;
    const snapshotSeparate=snapshot!==source;
    testToggle.click();document.getElementById('prismEnabled').click();
    return {zero,midpoint,narrow,wide,strict,matrix,audio,curveChanged,ambientPanel,rainOn,rainOutput,prismPanel,prismOn,prismOutputs,testOn,idle,authoredUnchanged,snapshotSeparate,frameChanged,captured,overlayStatus:SomataAmbientPrism.status()};
  })()`,{timeoutMs:20000,label:'8.20 corridor ambient prism and test morph'});
  for(const [k,v] of Object.entries({...r,...r.prismOutputs})){if(typeof v==='boolean')check(v,k+': '+JSON.stringify(r));}
  const errors=uncaughtExceptions(h.events);check(!errors.length,'uncaught browser exception: '+errors.join(' | '));
  console.log('8.20 TEST PASS',JSON.stringify(r));
 }finally{await h.close()}
})().catch(e=>{console.error('8.20 TEST FAIL',e.stack||e);process.exit(1)});
