const fs=require('fs');
const path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function touch(h,x,y){
  await h.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,radiusX:3,radiusY:3,force:1}]});
  await h.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
async function main(){
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:16000,loadDelayMs:300});
 const baseline=uncaughtExceptions(h.events).length;
 try{
  const css=fs.readFileSync(path.join(h.ROOT,'styles/app.css'),'utf8');
  await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return true})()`);
  await h.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'});
  await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  const layerId=await h.evaluate(`(()=>{const l=state.layers[0]||createLayer('project-morph-mobile-spiral');if(!state.layers.length)state.layers.push(l);state.activeLayerId=l.id;l.visible=true;l.lineVisible=true;l.N=19;l.K=7;l.radius=226;l.rounding=68;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=4;l.spiralStepLinked=false;l.spiralStep=2.2;l.showWeb=true;ensureLayerEffectState(l);l.web.inside=true;l.web.outsideStraight=true;l.web.outsideArc=true;state.showWeb=true;invalidateLayerGeometry(l,'project-morph-mobile-panel');refreshLayerLookup(true);runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.progress=.31;runtimeState.morph.geometryT=.31;runtimeState.morph.frameLayers=[{...l,id:l.id,N:23,K:8,radius:238,rotation:17}];requestMainCanvasRender();return l.id;})()`);
  async function inspect(w,hh){
    await h.call('Emulation.setDeviceMetricsOverride',{width:w,height:hh,deviceScaleFactor:3,mobile:true,screenWidth:w,screenHeight:hh});
    await h.evaluate(`window.dispatchEvent(new Event('orientationchange'));window.dispatchEvent(new Event('resize'));`);await sleep(220);
    await h.evaluate(`(async()=>{const b=document.getElementById('btnProjectMorphSettings');b.scrollIntoView({block:'nearest',inline:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
    const target=await h.evaluate(`(()=>{const e=document.getElementById('btnProjectMorphSettings'),b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);return{x,y,w:b.width,h:b.height,hit:hit===e||e.contains(hit),inside:x>=0&&x<innerWidth&&y>=0&&y<innerHeight};})()`);
    assert(target.hit&&target.inside,`project morph settings launcher is not touch-reachable at ${w}x${hh}: ${JSON.stringify(target)}`);
    await touch(h,target.x,target.y);await sleep(160);
    return h.evaluate(`(()=>{const p=document.getElementById('projectMorphSettingsPanel'),pb=p.getBoundingClientRect(),ps=getComputedStyle(p);const nums=['projectMorphTransitionSec','projectMorphIntervalSec','projectMorphBeats','projectMorphTransitionBeats'].map(id=>{const e=document.getElementById(id),b=e.getBoundingClientRect();return{id,w:b.width,h:b.height,top:b.top,bottom:b.bottom}});const labels=['projectMorphSyncTap','projectMorphCameraWander'].map(id=>{const e=document.getElementById(id).closest('label'),b=e.getBoundingClientRect();return{id,w:b.width,h:b.height,top:b.top,bottom:b.bottom}});return{inner:[innerWidth,innerHeight],panel:{left:pb.left,top:pb.top,right:pb.right,bottom:pb.bottom,w:pb.width,h:pb.height,display:ps.display,overflowY:ps.overflowY,maxHeight:ps.maxHeight},nums,labels};})()`);
  }
  const portrait=await inspect(390,844); await h.evaluate(`document.getElementById('btnCloseProjectMorphSettings')?.click()`); await sleep(80);
  const landscape=await inspect(844,390);
  for(const [name,s] of [['portrait',portrait],['landscape',landscape]]){
    assert(s.panel.display!=='none'&&s.panel.left>=0&&s.panel.top>=0&&s.panel.right<=s.inner[0]+1&&s.panel.bottom<=s.inner[1]+1,`${name} project morph panel escapes viewport: ${JSON.stringify(s.panel)} inner=${JSON.stringify(s.inner)}`);
    const smallNums=s.nums.filter(x=>x.h<44-.01); assert(smallNums.length===0,`${name} project morph numeric targets below 44px: ${JSON.stringify(smallNums)}`);
    const smallLabels=s.labels.filter(x=>x.h<44-.01); assert(smallLabels.length===0,`${name} project morph checkbox label targets below 44px: ${JSON.stringify(smallLabels)}`);
  }
  // Real touch on transition seconds in short landscape, then a real input/change update.
  const field=await h.evaluate(`(async()=>{const p=document.getElementById('projectMorphSettingsPanel'),e=document.getElementById('projectMorphTransitionSec');e.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y);return{x,y,w:b.width,h:b.height,hit:hit===e||e.contains(hit),inside:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,before:normalizeProjectMorphSettings().transitionSec,frames:__spiroAnimationStats().frameCount};})()`);
  assert(field.hit&&field.inside&&field.h>=44,`transition field is not a reachable >=44px touch target: ${JSON.stringify(field)}`);
  await touch(h,field.x,field.y); await sleep(80);
  const focused=await h.evaluate(`document.activeElement===document.getElementById('projectMorphTransitionSec')`);assert(focused,'real touch did not focus project morph transition field');
  await h.evaluate(`(()=>{const e=document.getElementById('projectMorphTransitionSec');e.value='5.5';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));requestMainCanvasRender();})()`); await sleep(220);
  const action=await h.evaluate(`(()=>{const l=state.layers.find(x=>x.id===${JSON.stringify(layerId)}),stats=__spiroAnimationStats();beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=performance.now();c.frame.now=c.now;c.frame.id=c.frameId;c.frame.dpr=devicePixelRatio||1;c.strokeWidth=3;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;const w=prepareLayerFrameWebData(c),rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,w.paths,l,1,w,true,'inside');return{transitionSec:normalizeProjectMorphSettings().transitionSec,frames:stats.frameCount,inFrame:stats.inFrame,paintErrors:stats.paintErrors||0,progress:runtimeState.morph.progress,commands:rec.commands?.length||0,finite:(rec.commands||[]).every(cmd=>Object.values(cmd||{}).filter(v=>typeof v==='number').every(Number.isFinite))};})()`);
  assert(Math.abs(action.transitionSec-5.5)<1e-6,'project morph transition value did not update');
  assert(action.frames>field.frames&&action.commands>0&&action.finite&&action.paintErrors===0&&!action.inFrame,`Spiral/Web lost stability after mobile project-morph setting: ${JSON.stringify(action)}`);
  const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
  console.log('MOBILE PROJECT MORPH PANEL + SPIRAL REGRESSION: PASS',{portrait,landscape,field,action});
 }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL mobile project morph panel + Spiral regression:',e.stack||e.message);process.exit(1)});
