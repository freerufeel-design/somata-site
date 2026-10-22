const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,msg)=>{if(!v)throw Error(msg)};
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:26000});try{
const r=await h.evaluate(`(async()=>{
const pause=ms=>new Promise(r=>setTimeout(r,ms));
if(runtimeState.minimalMorph.active)activeStopMinimalMorphing(false);
if(runtimeState.morph.active)activeStopMorphing?.(false);
while(state.layers.length<3)state.layers.push(createLayer());
state.layers=state.layers.slice(0,3);
state.layers.forEach((l,i)=>{l.visible=true;l.lineVisible=true;l.lineProfileApplication=i===2?'graffiti':'stroke';l.lineProfileStroke='round';l.fill=false;l.showLamps=false;l.showWeb=false;});
state.masterLayerEdit=false;state.activeLayerId=state.layers[2].id;
state.layers[2].graffitiNibLength=7;
updateLayerListUI();syncSidebarInputs();
const before=state.layers.map(l=>l.lineProfileApplication);
// Green owns display layers: a stale snapshot must not override live isolation visibility.
runtimeState.projectMorph.active=true;
runtimeState.projectMorph.transitionActive=true;
runtimeState.projectMorph.frameRenderLayers=state.layers.map(l=>({...l,visible:false}));
updateLayerListUI();
const btn=document.querySelectorAll('#layerList .layer-item .toggle-vis')[2];
btn.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
const solo={author:state.layers.map(l=>l.visible),display:SpiroMorphController.getDisplayLayers().map(l=>l.visible),thirdLine:state.layers[2].lineVisible};
btn.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
const restored=SpiroMorphController.getDisplayLayers().map(l=>l.visible);
runtimeState.projectMorph.active=false;runtimeState.projectMorph.transitionActive=false;
// A stale global Graffiti override used to turn the one Graffiti layer into Point.
state.randomLayerCount=3;document.getElementById('randomLayerCount').value='3';
state.minimalMorph.instantSwitch=true;state.minimalMorph.generatorStyle='standard';
state.minimalMorph.featureOverrides={graffiti:false};
document.getElementById('btnMinimalMorph').click();await pause(170);
const first=state.layers.map(l=>({m:l.lineProfileApplication,len:l.graffitiNibLength}));
document.getElementById('btnRandomPreset').click();await pause(140);
const second=state.layers.map(l=>({m:l.lineProfileApplication,len:l.graffitiNibLength}));
// Simulate a single-layer UI edit while Orange runs; must not broadcast style.
window.__somataRecordMorphFeatureOverride?.('graffiti',true);
const overrideStored=Object.prototype.hasOwnProperty.call(state.minimalMorph.featureOverrides,'graffiti');
document.getElementById('btnRandomPreset').click();await pause(140);
const third=state.layers.map(l=>l.lineProfileApplication);
document.getElementById('btnMinimalMorph').click();
// Default applies only when creating a fresh layer; existing values must be preserved.
const def=createLayer().graffitiNibLength;
return{before,solo,restored,first,second,third,overrideStored,def,all:state.layers.length};
})()`,{timeoutMs:26000,label:'solo + Orange Graffiti selection'});
assert(JSON.stringify(r.solo.author)===JSON.stringify([false,false,true]),'authored Solo wrong: '+JSON.stringify(r));
assert(JSON.stringify(r.solo.display)===JSON.stringify([false,false,true]),'Green frame Solo wrong: '+JSON.stringify(r));
assert(r.solo.thirdLine && r.restored.every(Boolean),'Solo line or restore failed');
for(const group of [r.first,r.second])assert(group.map(x=>x.m).join(',')==='stroke,stroke,graffiti' && group[2].len===7,'Orange lost per-slot Graffiti: '+JSON.stringify(group));
assert(r.third.join(',')==='stroke,stroke,graffiti'&&!r.overrideStored,'Orange global override polluted one-layer Graffiti');
assert(r.def===3,'Graffiti nib length default must be 3');
assert(!uncaughtExceptions(h.events).length,'Uncaught exceptions: '+uncaughtExceptions(h.events).join(' | '));
console.log('V818 SOLO + ORANGE GRAFFITI: PASS',JSON.stringify(r));
}finally{await h.close()}})().catch(e=>{console.error('V818 SOLO + ORANGE GRAFFITI: FAIL',e.stack||e);process.exit(1)});
