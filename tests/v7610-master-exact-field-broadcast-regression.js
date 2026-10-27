const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:22000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const report=await h.evaluate(`(async()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const eq=(a,b)=>masterValuesEqual(a,b);
      const value=(root,path)=>masterPathValue(root,path);
      const snap=()=>state.layers.map(masterLayerSnapshot);
      const stop=()=>{for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel'])try{animationScheduler.remove(n)}catch(_){};if(runtimeState?.morph){runtimeState.morph.active=false;runtimeState.morph.paused=false;runtimeState.morph.frameLayers=[];runtimeState.morph.lightLayers=[];runtimeState.morph.renderSourceLayers=[];runtimeState.morph.renderTargetLayers=[];runtimeState.morph.progress=0;runtimeState.morph.geometryT=0;}};
      const make=(i)=>{const l=createLayer('master-exact-'+i);ensureLayerEffectState(l);Object.assign(l,{N:[12,16,20][i],K:[2,3,4][i],radius:[121,187,263][i],radiusMultiplier:[1,1.2,.8][i],rotation:[7,61,143][i],rounding:[4,17,29][i],strokeWidth:[1.5,3,5][i],strokeWidthMultiplier:[1,1.4,.7][i],strokeColor:['#ff3344','#33ff77','#4488ff'][i],glow:[5,12,21][i],glowMultiplier:[1,1.5,.8][i],glowIntensity:[25,70,130][i],glowIntensityMultiplier:[1,.8,1.7][i],opacity:[91,73,58][i],fill:false,fillColor:['rgba(255,20,30,.13)','rgba(20,255,30,.37)','rgba(20,30,255,.68)'][i],fillMatchStroke:false,fillRule:i===1?'nonzero':'evenodd',spiralEnabled:true,closedLoop:false,spiralClosed:true,spiralOrder:[1.1,2.2,3.3][i],spiralStep:[2.25,5.5,8.75][i],spiralStepLinked:false,spiralTangential:i===1,spiralRoundSeams:i!==1,spiralFillEnabled:false,spiralFillType:'interwinding'});l.web.width=[.6,1.5,2.7][i];l.web.spacing=[7,16,29][i];l.sweep.glow=[6,19,31][i];l.particles.sizePx=[2,5,9][i];return l;};
      const reset=async(prepare)=>{stop();state.masterLayerEdit=false;state.tunnel.active=false;const ls=[make(0),make(1),make(2)];state.layers.splice(0,state.layers.length,...ls);state.activeLayerId=ls[0].id;try{setSingleLayerSelection(ls[0])}catch(_){};try{refreshLayerLookup(true)}catch(_){};if(prepare)prepare(ls);syncSidebarInputs();syncSidebarToolStates();updateLayerListUI();await sleep(12);const beforeEnable=snap();document.getElementById('btnMasterLayer').click();await sleep(24);const afterEnable=snap();return{ls,beforeEnable,afterEnable};};
      const dispatch=(id,val,type='input')=>{const el=document.getElementById(id);if(!el)throw new Error('missing control '+id);if(el.type==='checkbox')el.checked=!!val;else el.value=String(val);el.dispatchEvent(new Event(type,{bubbles:true}));};
      const run=async(name,id,val,type='input',prepare=null)=>{const {ls,beforeEnable,afterEnable}=await reset(prepare);const enableDiffs=afterEnable.map((x,i)=>collectMasterChangedPaths(beforeEnable[i],x));const before=snap();dispatch(id,val,type);await sleep(50);const after=snap(),sourcePaths=collectMasterChangedPaths(before[0],after[0]);const broadcast=window.__spiroLastMasterBroadcast||null,expectedPaths=Array.isArray(broadcast?.paths)?broadcast.paths:sourcePaths;const targets=[];for(let i=1;i<3;i++){const changed=collectMasterChangedPaths(before[i],after[i]);const allowedDerived=(id==='paramFillMatchStroke'||id==='paramEnableFill'||id==='paramStrokeColor')?['fillColor']:[];const extra=changed.filter(p=>!expectedPaths.includes(p)&&!allowedDerived.includes(p));const missing=expectedPaths.filter(p=>{if(p==='fillColor'&&id==='paramFillOpacity')return Math.abs(getFillOpacityPercent(after[i].fillColor)-getFillOpacityPercent(after[0].fillColor))>1e-6;if(p==='fillColor'&&id==='paramFillColor')return colorBaseHex6(after[i].fillColor)!==colorBaseHex6(after[0].fillColor);return !eq(value(after[i],p),value(after[0],p));});targets.push({i,changed,extra,missing,beforeFill:before[i].fillColor,afterFill:after[i].fillColor,afterStroke:after[i].strokeColor,beforeFillRgb:colorBaseHex6(before[i].fillColor),afterFillRgb:colorBaseHex6(after[i].fillColor),afterStrokeRgb:colorBaseHex6(after[i].strokeColor)});}return{name,id,enableDiffs,sourcePaths,expectedPaths,targets,broadcast,sourceAfter:after[0]};};
      const cases=[];
      for(const spec of [
        ['radius','paramRadius',222],['radius multiplier','paramRadiusMultiplier',1.7],['rotation','paramRotation',77],['rounding','paramRounding',22],
        ['stroke width','paramStrokeWidth',6],['stroke multiplier','paramStrokeWidthMultiplier',1.8],['glow','paramGlow',27],['glow multiplier','paramGlowMultiplier',2.2],
        ['glow intensity','paramGlowIntensity',130],['glow intensity multiplier','paramGlowIntensityMultiplier',1.9],['opacity','paramOpacity',67],
        ['fill enabled','paramEnableFill',true,'change'],['fill match','paramFillMatchStroke',true,'change',ls=>{for(const l of ls){l.fill=true;l.fillMatchStroke=false;}}],['fill opacity','paramFillOpacity',44,'input',ls=>{for(const l of ls){l.fill=true;l.fillMatchStroke=false;}}],['fill RGB','paramFillColor','#22aaff','input',ls=>{for(const l of ls){l.fill=true;l.fillMatchStroke=false;}}],
        ['N','paramN',18],['K','paramK',4],['spiral order','paramSpiralOrder',3,'input'],
        ['spiral tangential','paramSpiralTangential',true,'change'],['spiral seams','paramSpiralRoundSeams',false,'change',ls=>{ls[0].spiralRoundSeams=true;}],
        ['spiral fill','paramSpiralFillEnabled',true,'change'],['web width','webWidth',3.3],['web spacing','webSpacing',24],['sweep glow','sweepGlow',34],['particle size','particleSize',11]
      ])cases.push(await run(...spec));

      // A no-op source interaction must be a no-op for every target too. This catches legacy
      // block copying even when the active layer value did not change.
      const noOp=await run('same-value seam is no-op','paramSpiralRoundSeams',true,'change',ls=>{ls[0].spiralRoundSeams=true;ls[1].spiralRoundSeams=false;ls[2].spiralRoundSeams=false;});
      return{cases,noOp,masterOn:state.masterLayerEdit===true,inFrame:animationScheduler.stats().inFrame};
    })()`,{timeoutMs:20000,label:'7.6.10 Master exact-field broadcast'});

    const failures=[];
    for(const c of report.cases){
      if(c.enableDiffs.some(x=>x.length))failures.push(`${c.name}: enabling Master changed layers ${JSON.stringify(c.enableDiffs)}`);
      if(!c.sourcePaths.length)failures.push(`${c.name}: source UI action changed no field`);
      for(const t of c.targets){if(t.extra.length)failures.push(`${c.name}: target ${t.i} extra paths: ${t.extra.join(', ')}`);if(t.missing.length)failures.push(`${c.name}: target ${t.i} missing/mismatched: ${t.missing.join(', ')}`);if(c.id==='paramFillOpacity'&&t.beforeFillRgb!==t.afterFillRgb)failures.push(`${c.name}: target ${t.i} RGB changed while editing opacity`);if(c.id==='paramFillMatchStroke'&&c.sourceAfter.fillMatchStroke===true&&t.afterFillRgb!==t.afterStrokeRgb)failures.push(`${c.name}: target ${t.i} fill no longer matches its own stroke`);}
      if(c.broadcast&&c.broadcast.rolledBackExtras<0)failures.push(`${c.name}: invalid rollback counter`);
    }
    if(report.noOp.sourcePaths.length)failures.push(`same-value no-op unexpectedly changed source: ${report.noOp.sourcePaths.join(', ')}`);
    for(const t of report.noOp.targets)if(t.changed.length)failures.push(`same-value no-op changed target ${t.i}: ${t.changed.join(', ')}`);
    if(!report.masterOn)failures.push('Master did not remain enabled');
    if(report.inFrame)failures.push('scheduler left inFrame');
    const uncaught=uncaughtExceptions(h.events).slice(baseline);if(uncaught.length)failures.push('uncaught: '+uncaught.join(' | '));
    if(failures.length)throw new Error('MASTER EXACT-FIELD BROADCAST REGRESSION FAIL:\n- '+failures.join('\n- '));
    console.log(`MASTER EXACT-FIELD BROADCAST REGRESSION: PASS — ${report.cases.length} field interactions + same-value no-op`);
  }finally{await h.close();}
}
main().catch(e=>{console.error(e.stack||e);process.exit(1);});
