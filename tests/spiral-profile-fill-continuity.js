const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:12000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const L=state.layers[0];
      if(runtimeState.morph.active)document.getElementById('btnMorph')?.click();
      L.visible=true;L.spiralEnabled=true;L.spiralClosed=true;L.spiralTangential=true;L.spiralRoundSeams=true;L.closedLoop=false;
      L.N=12;L.K=1;L.spiralStep=1;L.spiralStepLinked=false;L.spiralOrder=1;L.radius=220;L.rotation=0;L.rounding=35;
      L.profileMode='segments';L.profileNodes=[{x:0,y:0},{x:.18,y:.34},{x:.5,y:-.22},{x:.78,y:.28},{x:1,y:0}];L.fill=true;L.fillColor='#00ffc899';L.spiralFillEnabled=true;L.spiralFillType='chopped';
      state.activeLayerId=L.id;invalidateLayerGeometry(L,'test-spiral-fill');
      const draw=getCachedLayerDrawData(L),bands=FillMeshPreparer.buildSpiralBandContours(draw,L),mesh=FillMeshPreparer.prepareStatic(draw,L);
      let maxCubicSeam=0,cubicPairs=0;
      for(const path of draw.paths||[]){const cc=path?._bezierSegments||[];for(let i=0;i+1<cc.length;i++){const a=cc[i]?.p3,b=cc[i+1]?.p0;if(!a||!b)continue;cubicPairs++;maxCubicSeam=Math.max(maxCubicSeam,Math.hypot(a.x-b.x,a.y-b.y));}}
      const bandCount=bands?.length||0,pathCount=draw.paths?.length||0;

      L.N=11;invalidateLayerGeometry(L,'test-spiral-fill-odd');const oddDraw=getCachedLayerDrawData(L);const oddBands=FillMeshPreparer.buildSpiralBandContours(oddDraw,L);
      L.N=12;L.spiralClosed=false;invalidateLayerGeometry(L,'test-spiral-fill-open');const openDraw=getCachedLayerDrawData(L);const openBands=FillMeshPreparer.buildSpiralBandContours(openDraw,L);
      L.spiralClosed=true;invalidateLayerGeometry(L,'test-spiral-fill-restore');
      __somataSelectContourMode('spiral-open');syncSidebarInputs();const tangentOpenEnabled=document.getElementById('paramSpiralTangential')?.disabled!==true;
      L.spiralTangential=false;invalidateLayerGeometry(L,'test-open-tangent-off');const tanOff=getCachedLayerDrawData(L);const tanOffSig=(tanOff.paths||[]).flatMap(p=>p.points||[]).reduce((a,p)=>a+Math.abs(Number(p.x)||0)*.17+Math.abs(Number(p.y)||0)*.31,0);
      L.spiralTangential=true;invalidateLayerGeometry(L,'test-open-tangent-on');const tanOn=getCachedLayerDrawData(L);const tanOnSig=(tanOn.paths||[]).flatMap(p=>p.points||[]).reduce((a,p)=>a+Math.abs(Number(p.x)||0)*.17+Math.abs(Number(p.y)||0)*.31,0);
      __somataSelectContourMode('spiral-closed');L.spiralClosed=true;invalidateLayerGeometry(L,'test-spiral-fill-restore2');
      const freshLayer=createLayer(),fillUiDefault=freshLayer.spiralFillEnabled===false,fillTypeDefault=freshLayer.spiralFillType==='interwinding',fillCheckbox=Boolean(document.getElementById('paramSpiralFillEnabled')),fillType=Boolean(document.getElementById('paramSpiralFillType'));

      state.morph.profileModeTransition='phase';runtimeState.morph.active=false;runtimeState.morph.transitionMs=5000;
      const phase=[0,.25,.5,.75,1].map(t=>profileModeTransitionProgress(t));
      const forward=[0,.25,.5,.75,1].map(t=>morphSplineBlend('segments','spline',t));
      const reverse=[0,.25,.5,.75,1].map(t=>morphSplineBlend('spline','segments',t));
      state.morph.profileModeTransition='start';state.morph.profileModeTransitionPercent=20;
      const start=[0,.05,.10,.15,.20,.30].map(t=>profileModeTransitionProgress(t));
      state.morph.profileModeTransition='end';
      const end=[.70,.80,.85,.90,.95,1].map(t=>profileModeTransitionProgress(t));
      const transitionButtons=[...document.querySelectorAll('[data-profile-mode-transition]')].map(b=>b.dataset.profileModeTransition);
      const profileCarrier=[{x:0,y:0},{x:40,y:36},{x:85,y:-28},{x:132,y:22},{x:180,y:0}];
      const recordBlend=(blend)=>{const commands=[];const rec={moveTo(x,y){commands.push(['M',x,y]);},lineTo(x,y){commands.push(['L',x,y]);},bezierCurveTo(a,b,c,d,x,y){commands.push(['C',a,b,c,d,x,y]);},closePath(){commands.push(['Z']);}};drawMorphSplineBlendPath(rec,profileCarrier,false,blend,[]);return commands;};
      const blendCmd0=recordBlend(0),blendCmdMid=recordBlend(.5),blendCmd1=recordBlend(1);
      const bezierCounts=[blendCmd0,blendCmdMid,blendCmd1].map(c=>c.filter(q=>q[0]==='C').length);
      const c0=blendCmd0.filter(q=>q[0]==='C'),cm=blendCmdMid.filter(q=>q[0]==='C');let midControlShift=0;for(let i=0;i<Math.min(c0.length,cm.length);i++)for(let k=1;k<=4;k++)midControlShift=Math.max(midControlShift,Math.abs((cm[i][k]||0)-(c0[i][k]||0)));
      const sameBlendEndpoints=[blendCmd0,blendCmdMid,blendCmd1].every(cmd=>{const m=cmd.find(q=>q[0]==='M'),last=[...cmd].reverse().find(q=>q[0]==='C'||q[0]==='L');return m&&last&&Math.abs(m[1]-profileCarrier[0].x)<1e-9&&Math.abs(m[2]-profileCarrier[0].y)<1e-9&&Math.abs(last[last.length-2]-profileCarrier.at(-1).x)<1e-9&&Math.abs(last[last.length-1]-profileCarrier.at(-1).y)<1e-9;});
      const startButton=document.querySelector('[data-profile-mode-transition="start"]');startButton?.click();
      const uiStart=state.morph.profileModeTransition;
      const pct=document.getElementById('profileModeTransitionPercent');pct.value='50';pct.dispatchEvent(new Event('input',{bubbles:true}));const uiPct=state.morph.profileModeTransitionPercent;
      const endButton=document.querySelector('[data-profile-mode-transition="end"]');endButton?.click();const uiEnd=state.morph.profileModeTransition;
      document.querySelector('[data-profile-mode-transition="phase"]')?.click();
      const uiPhase=state.morph.profileModeTransition;

      // Dynamic retained-rail fill preparation: 12 branches -> 6 alternating bands.
      const aux=[];for(let i=0;i<12;i++){const a=i*Math.PI*2/12,pts=[];for(let j=0;j<7;j++){const rr=70+j*20,ang=a+j*.08;pts.push({x:rr*Math.cos(ang),y:rr*Math.sin(ang)});}aux.push({points:pts,alpha:1,sourceBranchIndex:i,targetBranchIndex:i,sourceBranchCount:12,targetBranchCount:12,branchPhase:i/12});}
      const fakeCtx={layer:L,frameId:77,layerIndex:0,geometryPlan:{dynamic:true},blueMorphProvider:{sourceLayer:{...L,N:12,spiralClosed:true},targetLayer:{...L,N:12,spiralClosed:true}}};
      const dynamicMesh=FillMeshPreparer.prepareSpiralMorphBands(fakeCtx,aux);
      const fakeOdd={...fakeCtx,frameId:78,blueMorphProvider:{sourceLayer:{...L,N:12,spiralClosed:true},targetLayer:{...L,N:11,spiralClosed:true}}};
      const dynamicOdd=FillMeshPreparer.prepareSpiralMorphBands(fakeOdd,aux);
      const tunnelWas=state.tunnel.active;state.tunnel.active=true;L.spiralFillType='interwinding';
      const interCtx={...fakeCtx,geometryPlan:{dynamic:false,sourceData:getCachedLayerDrawData(L)},staticDrawData:getCachedLayerDrawData(L),visibleInstances:{copies:[{scale:1,stepRatio:1.2},{scale:.82,stepRatio:1.2},{scale:.67,stepRatio:1.2}],alphas:[1,1,1],fillAlphas:[1,1,1]}};
      const interMesh=FillMeshPreparer.prepareInterwindingCorridor(interCtx,null);state.tunnel.active=tunnelWas;L.spiralFillType='chopped';

      return{maxCubicSeam,cubicPairs,pathCount,bandCount,meshBands:mesh?.spiralBandCount||0,meshComplete:mesh?.nativeComplete===true,oddBands:oddBands?.length||0,openBands:openBands?.length||0,phase,forward,reverse,start,end,transitionButtons,bezierCounts,midControlShift,sameBlendEndpoints,uiStart,uiEnd,uiPct,uiPhase,dynamicBands:dynamicMesh?.spiralBandCount||0,dynamicComplete:dynamicMesh?.nativeComplete===true,dynamicOdd:dynamicOdd!==null,tangentOpenEnabled,tangentDelta:Math.abs(tanOnSig-tanOffSig),fillUiDefault,fillTypeDefault,fillCheckbox,fillType,interComplete:interMesh?.nativeComplete===true,interBaked:interMesh?.corridorBaked===true,interBands:interMesh?.spiralBandCount||0};
    })()`,{timeoutMs:12000,label:'spiral profile/fill continuity'});

    assert(r.cubicPairs>0,'no retained spiral cubic joins were inspected');
    assert(r.maxCubicSeam<1e-6,`retained spiral cubic join gap ${r.maxCubicSeam}`);
    assert(r.pathCount===12,`expected 12 spiral branches, got ${r.pathCount}`);
    assert(r.bandCount===6&&r.meshBands===6&&r.meshComplete,'closed 12-branch spiral did not create six GPU fill bands');
    assert(r.oddBands===0,'odd branch count unexpectedly produced alternating fill bands');
    assert(r.openBands===0,'open spiral unexpectedly produced fill bands');
    assert(r.tangentOpenEnabled===true,'open Spiral tangentiality control is disabled');
    assert(r.tangentDelta>1e-6,'open Spiral tangentiality does not affect the profile median geometry');
    assert(r.fillUiDefault&&r.fillTypeDefault&&r.fillCheckbox&&r.fillType,'spiral Fill must default OFF with interwinding selected and expose Fill + type controls');
    assert(r.interComplete&&r.interBaked&&r.interBands===6,'interwinding Corridor Fill did not build six continuous baked bands');
    assert(r.transitionButtons.includes('phase')&&r.transitionButtons.includes('start')&&r.transitionButtons.includes('end'),'profile transition UI is missing');
    assert(r.bezierCounts[0]>0&&r.bezierCounts[0]===r.bezierCounts[1]&&r.bezierCounts[1]===r.bezierCounts[2],'profile mode blend changes the Bézier segment budget');
    assert(r.midControlShift>1e-6,'profile mode midpoint did not interpolate Bézier handles');
    assert(r.sameBlendEndpoints===true,'profile mode blend moved authored endpoints');
    assert(r.uiStart==='start'&&r.uiEnd==='end'&&r.uiPct===50&&r.uiPhase==='phase','profile transition UI does not update state');
    assert(Math.abs(r.phase[0])<1e-9&&Math.abs(r.phase[4]-1)<1e-9&&Math.abs(r.phase[2]-.5)<1e-9,'whole-phase smoothstep is incorrect');
    for(let i=1;i<r.forward.length;i++)assert(r.forward[i]>=r.forward[i-1],`segments->spline blend is not monotonic at ${i}`);
    for(let i=1;i<r.reverse.length;i++)assert(r.reverse[i]<=r.reverse[i-1],`spline->segments blend is not monotonic at ${i}`);
    assert(Math.abs(r.forward[2]+r.reverse[2]-1)<1e-9,'forward/reverse spline blends are not complementary');
    assert(r.start[1]>0&&r.start[1]<.5&&Math.abs(r.start[2]-.5)<1e-9&&Math.abs(r.start[4]-1)<1e-9&&Math.abs(r.start[5]-1)<1e-9,'start-of-phase transition does not finish at the requested phase share');
    assert(Math.abs(r.end[0])<1e-9&&Math.abs(r.end[1])<1e-9&&r.end[2]>0&&r.end[2]<.5&&Math.abs(r.end[3]-.5)<1e-9&&Math.abs(r.end[5]-1)<1e-9,'end-of-phase transition is incorrect');
    assert(r.dynamicComplete&&r.dynamicBands===6,'dynamic retained spiral fill did not create six bands');
    assert(r.dynamicOdd===false,'dynamic spiral fill was not suppressed when an endpoint has odd N');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('SPIRAL PROFILE/FILL CONTINUITY: PASS',r);
  }finally{await h.close();}
}
main().catch(err=>{console.error('FAIL spiral profile/fill continuity:',err.stack||err.message);process.exit(1);});
