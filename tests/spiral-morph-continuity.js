const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:12000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      const setValue=(id,value)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.value=String(value);e.dispatchEvent(new Event('change',{bubbles:true}));};
      const setCheck=(id,value)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.checked=!!value;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const wrapDeg=(v)=>{let d=Number(v)||0;while(d<=-180)d+=360;while(d>180)d-=360;return d;};
      const summarizePlan=(p)=>{
        if(!p)return null;
        const F=24,xy=(r,a)=>({x:r*Math.cos(a),y:r*Math.sin(a)});
        const pt=(ci,slot,t)=>{const o=ci*F,cart=p.data[o+22]>.5,si=o+slot*2,di=o+8+slot*2,sr=p.data[si],sa=p.data[si+1],dr=p.data[di],da=p.data[di+1];if(cart){const s=xy(sr,sa),d=xy(dr,da);return{x:s.x+(d.x-s.x)*t,y:s.y+(d.y-s.y)*t};}const r=sr+(dr-sr)*t,a=sa+(da-sa)*t;return xy(r,a);};
        let finite=true,presenceBoth=true,spinSafe=true,maxPolarTurn=0,maxSeam=0,maxFrameStepNorm=0,maxRadius=1;
        for(let ci=0;ci<p.cubicCount;ci++){
          const o=ci*F;
          for(let k=0;k<F;k++)if(!Number.isFinite(p.data[o+k]))finite=false;
          if(!(p.data[o+20]>.5&&p.data[o+21]>.5))presenceBoth=false;
          const cart=p.data[o+22]>.5;
          for(let slot=0;slot<4;slot++){
            const d=Math.abs(p.data[o+9+slot*2]-p.data[o+1+slot*2]);maxPolarTurn=Math.max(maxPolarTurn,d);if(!cart&&d>Math.PI+1e-4)spinSafe=false;
            const a=pt(ci,slot,0),b=pt(ci,slot,1);maxRadius=Math.max(maxRadius,Math.hypot(a.x,a.y),Math.hypot(b.x,b.y));
            let prev=a;for(let f=1;f<=60;f++){const q=pt(ci,slot,f/60),dist=Math.hypot(q.x-prev.x,q.y-prev.y);maxFrameStepNorm=Math.max(maxFrameStepNorm,dist);prev=q;}
          }
        }
        maxFrameStepNorm/=maxRadius;
        const ranges=p.cpuPathSegmentRanges;
        for(let pi=0;pi<p.pathCount;pi++){
          const first=ranges[pi*4]>>>0,count=ranges[pi*4+1]>>>0;
          for(let ti=0;ti<=24;ti++){
            const t=ti/24;
            for(let j=0;j+1<count;j++){
              const a=pt(first+j,3,t),b=pt(first+j+1,0,t);maxSeam=Math.max(maxSeam,Math.hypot(a.x-b.x,a.y-b.y));
            }
          }
        }
        return{morphType:p.morphType,interpolationMetric:p.interpolationMetric||'',paths:p.pathCount,cubics:p.cubicCount,mergeSplit:p.topologyMergeSplitCount||0,continuousTopology:p.continuousTopologyTransport===true,exactSubdivisionOnly:p.exactSubdivisionOnly===true,arcEqualizedRecords:Number(p.arcEqualizedRecords)||0,cartesianFallbackCubics:p.cartesianFallbackCubics||0,maxPackedPolarTurn:p.maxPackedPolarTurn||0,finite,presenceBoth,spinSafe,maxPolarTurn,maxSeam,maxFrameStepNorm};
      };
      const configureBase=()=>{
        if(runtimeState.morph.active)document.getElementById('btnMorph').click();
        const L=state.layers[0];
        L.visible=true;L.spiralEnabled=true;L.spiralOrder=1;L.spiralClosed=true;L.spiralTangential=true;L.spiralRoundSeams=true;L.closedLoop=false;L.N=12;L.K=1;L.spiralStep=1;L.spiralStepLinked=false;L.radius=220;L.rotation=0;L.rounding=0;L.profileMode='segments';L.profileNodes=[{x:0,y:0},{x:.32,y:.18},{x:.70,y:-.13},{x:1,y:0}];
        state.activeLayerId=L.id;
        setCheck('morphByShape',false);setCheck('morphByVertices',true);setCheck('morphBySteps',true);setCheck('morphByRounding',false);setCheck('morphByStrokeWidth',false);setCheck('morphBySize',false);setCheck('morphByColor',false);setCheck('morphByFillColor',false);setCheck('morphByOpacity',false);setCheck('morphByRotation',false);setCheck('morphDiversity',false);
        setValue('morphMode','circleSlide');setValue('morphVertexMultiplier',1);setValue('morphVertexMin',15);setValue('morphVertexMax',15);setValue('morphStepMin',100);setValue('morphStepMax',100);
      };
      const runUiCase=(type,comp=false,morphMode='circleSlide')=>{
        configureBase();
        if(type==='topology'){
          setValue('morphStepMin',67);setValue('morphStepMax',67);
          setCheck('morphBySpiralLayers',true);setValue('morphSpiralLayersMin',1);setValue('morphSpiralLayersMax',1);setCheck('morphSpiralOrderLinked',false);setValue('morphSpiralOrderMin',-3);setValue('morphSpiralOrderMax',-3);
        }
        setValue('morphMode',morphMode);setValue('morphSpiralMorphType',type);setCheck('morphSpiralRotationCompensation',comp);document.getElementById('btnMorph').click();
        const s=runtimeState.morph.renderSourceLayers[0],d=runtimeState.morph.renderTargetLayers[0],status=window.__spiroSpiralMorphModeStatus?.()||null,plan=summarizePlan(window.__somataSpiralMorphCpuPlan?.(0));
        let compensation=null,tunnelPhase=null;
        if(type==='phase'){
          const pairs=MorphGeometry.pairMorphPaths(buildOrbitPolylines(s),buildOrbitPolylines(d));let best=null;
          for(const pair of pairs){const sp=pair?.src?.points||[],dp=pair?.dst?.points||[];if(!sp.length||!dp.length)continue;const a=sp[sp.length-1],b=dp[dp.length-1],r=Math.max(Math.hypot(a.x,a.y),Math.hypot(b.x,b.y)),delta=wrapDeg((Math.atan2(b.y,b.x)-Math.atan2(a.y,a.x))*180/Math.PI);if(!best||r>best.r)best={r,delta};}
          const phaseDeg=Number(runtimeState.morph.spiralRotationCompensationPhaseDeg)||0;compensation={outerTipDelta:best?.delta??NaN,phaseDeg,residual:wrapDeg((best?.delta??0)-phaseDeg),anchor:runtimeState.morph.spiralRotationCompensationAnchorIndex};
          const oldTunnel=state.tunnel.active,oldT=runtimeState.morph.geometryT;state.tunnel.active=true;runtimeState.morph.geometryT=.5;const mid={...s,spiralStep:(Number(s.spiralStep)+Number(d.spiralStep))/2,spiralStepLinked:false};const actual=getSpiralMorphTunnelPhaseRadians({copyId:1,position:1},s),expected=Math.PI*2*Number(mid.spiralStep)/Number(mid.N);tunnelPhase={actual,expected,error:Math.abs(actual-expected)};runtimeState.morph.geometryT=oldT;state.tunnel.active=oldTunnel;
        }
        const out={type,source:{N:s.N,K:s.K,step:s.spiralStep,order:s.spiralOrder},target:{N:d.N,K:d.K,step:d.spiralStep,order:d.spiralOrder},status,plan,compensation,tunnelPhase};
        document.getElementById('btnMorph').click();
        return out;
      };
      const continuous=runUiCase('continuous');
      const phase=runUiCase('phase',true);
      const phaseCircle=runUiCase('phaseCircle');
      const minimalTurn=runUiCase('minimalTurn');
      const phaseCircleFade=runUiCase('phaseCircle',false,'fade');
      const minimalTurnFade=runUiCase('minimalTurn',false,'fade');
      const topological=runUiCase('topology',false,'topology');
      const phaseCircleTopology=runUiCase('phaseCircle',false,'topology');
      const torn=runUiCase('torn');

      // Shape-morph stress: deliberately different retained profiles.  The non-torn modes
      // must still be one finite, seam-free rail and must never encode an unguarded >180°
      // polar spin.  Phase keeps N while K itself is the transported phase step; the two
      // branch-changing modes also exercise simultaneous profile + N/K topology change.
      const shapeStress={};
      for(const type of ['continuous','phase','phaseCircle','minimalTurn','topology','torn']){
        const src={...state.layers[0],id:'shape-src',visible:true,spiralEnabled:true,spiralOrder:1,spiralClosed:true,spiralTangential:true,spiralRoundSeams:true,closedLoop:false,N:12,K:1,spiralStep:1,spiralStepLinked:false,radius:220,rotation:12,rounding:0,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.15,y:.58},{x:.42,y:-.38},{x:.72,y:.33},{x:1,y:0}]};
        const topologyChanging=type==='phaseCircle'||type==='topology'||type==='torn';
        const dst={...src,id:'shape-dst',N:(topologyChanging||type==='minimalTurn')?15:12,K:type==='topology'?5:(topologyChanging?7:1),spiralStep:type==='phase'?6:(type==='topology'?5:1),spiralOrder:type==='topology'?-3:1,rotation:type==='continuous'?48:132,profileNodes:[{x:0,y:0},{x:.10,y:-.52},{x:.34,y:.48},{x:.61,y:-.31},{x:.86,y:.24},{x:1,y:0}]};
        state.morph.spiralMorphType=type;state.morph.mode='topology';runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];shapeStress[type]=summarizePlan(window.__somataSpiralMorphCpuPlan?.(0));
      }

      // The compensation checkbox is defined by the outermost visible Spiral layer, not an
      // average of all layers.  Use a real UI start with two layers to verify the anchor.
      configureBase();const inner=state.layers[0];inner.radius=120;inner.id='spiral-inner-test';
      const outer={...inner,id:'spiral-outer-test',name:'Outer spiral test',radius:320,profileNodes:(inner.profileNodes||[]).map(p=>({...p}))};state.layers=[inner,outer];state.activeLayerId=inner.id;
      setCheck('morphByVertices',false);setValue('morphSpiralMorphType','phase');setCheck('morphSpiralRotationCompensation',true);document.getElementById('btnMorph').click();
      const outerAnchor={index:runtimeState.morph.spiralRotationCompensationAnchorIndex,id:runtimeState.morph.spiralRotationCompensationAnchorId,radius:runtimeState.morph.spiralRotationCompensationAnchorRadius,participants:runtimeState.morph.spiralRotationCompensationParticipants};document.getElementById('btnMorph').click();

      configureBase();setValue('morphSpiralMorphType','topology');setValue('morphVertexMultiplier',4);setValue('morphVertexMin',5);setValue('morphVertexMax',19);document.getElementById('btnMorph').click();
      const multiplierCase={multiplier:state.morph.vertexMultiplier,min:state.morph.vertexMin,max:state.morph.vertexMax,targetNs:runtimeState.morph.targetVisuals.map(v=>Number(v?.N)||0)};document.getElementById('btnMorph').click();

      const tunnelBackup={...state.tunnel};state.tunnel.active=true;state.tunnel.centerHiddenCopies=3;state.tunnel.minScale=.055;
      const centerShadeSpec=WebGPUSpiralBezierMorphRenderer.debugCenterShadeSpec({layerExtent:300,lightMorphScale:1,visibleInstances:{copies:[{stepRatio:1.2}]}});
      const centerShade={spec:centerShadeSpec,inside:WebGPUSpiralBezierMorphRenderer.debugCenterShadeAlpha(centerShadeSpec.startRadius*.5,centerShadeSpec),feather:WebGPUSpiralBezierMorphRenderer.debugCenterShadeAlpha((centerShadeSpec.startRadius+centerShadeSpec.endRadius)*.5,centerShadeSpec),outside:WebGPUSpiralBezierMorphRenderer.debugCenterShadeAlpha(centerShadeSpec.endRadius*1.5,centerShadeSpec)};
      Object.assign(state.tunnel,tunnelBackup);
      return{continuous,phase,phaseCircle,minimalTurn,phaseCircleFade,minimalTurnFade,topological,phaseCircleTopology,torn,shapeStress,outerAnchor,multiplierCase,centerShade};
    })()`,{timeoutMs:12000,label:'spiral morph continuity verification'});

    const {continuous,phase,phaseCircle,minimalTurn,phaseCircleFade,minimalTurnFade,topological,phaseCircleTopology,torn,shapeStress,outerAnchor,multiplierCase,centerShade}=result;
    assert(continuous.status?.keepsContinuity&&continuous.status?.locksN&&continuous.status?.locksK,'continuous spiral morph must lock N/K and remain continuity protected');
    assert(continuous.target.N===continuous.source.N&&continuous.target.K===continuous.source.K,'continuous spiral morph changed N/K topology');

    assert(phase.status?.keepsContinuity&&phase.status?.locksN&&!phase.status?.locksK&&phase.status?.phaseKTransport,'phase mode must keep N fixed while transporting K itself as the phase step');
    assert(phase.target.N===phase.source.N&&phase.target.K!==phase.source.K,'phase mode must keep N fixed and change K');
    assert(Math.abs(phase.target.step-phase.target.K)<1e-9&&Math.abs(phase.target.step-phase.source.step)>1,'phase mode did not transport K through the actual spiral step');
    assert(phase.plan?.mergeSplit===0,'fixed-N Phase introduced branch clone/merge instead of pure winding transport');
    assert(phase.compensation&&Math.abs(phase.compensation.residual)<1e-4,'rotation compensation does not pin the outer spiral tip');
    assert(phase.tunnelPhase&&phase.tunnelPhase.error<1e-9,'corridor/next-copy phase is not derived continuously from the current spiral step');

    for(const c of [continuous,phase,phaseCircle,minimalTurn,topological,phaseCircleTopology]){
      assert(c.plan&&c.plan.finite,`${c.type}: retained cubic plan contains non-finite data`);
      assert(c.plan.presenceBoth,`${c.type}: a continuity-preserving rail still fades/disappears during morph`);
      assert(c.plan.spinSafe,`${c.type}: polar transport contains an unguarded >180° rail spin`);
      assert(c.plan.maxSeam<2e-3,`${c.type}: retained cubic path develops an internal seam (${c.plan.maxSeam})`);
      assert(c.plan.maxFrameStepNorm<0.12,`${c.type}: sampled frame-to-frame motion is too large (${c.plan.maxFrameStepNorm})`);
    }
    assert(phaseCircle.target.N!==phaseCircle.source.N&&phaseCircle.target.K!==phaseCircle.source.K,'phase-circle mode did not exercise N/K topology change');
    assert(phaseCircle.plan.mergeSplit>0&&phaseCircle.plan.continuousTopology,'phase-circle N/K change is not encoded as continuous merge/split transport');
    assert(minimalTurn.status?.constantStepVariableN===true&&!minimalTurn.status?.locksN&&minimalTurn.status?.locksK,'minimal-turn mode must expose variable N with constant step/K');
    assert(minimalTurn.target.N!==minimalTurn.source.N&&minimalTurn.target.K===minimalTurn.source.K,'minimal-turn mode did not keep K constant while changing N');
    assert(Math.abs(minimalTurn.target.step-minimalTurn.source.step)<1e-9,'minimal-turn mode changed the explicit spiral step');
    assert(minimalTurn.plan.continuousTopology&&minimalTurn.plan.interpolationMetric!=='cartesian','minimal-turn variable-N morph lost least-turn continuous transport');
    assert(minimalTurn.plan.cartesianFallbackCubics===0,'ordinary minimal-turn morph fell back to Cartesian transport instead of least-turn polar motion');
    for(const c of [phaseCircleFade,minimalTurnFade]){assert(c.status?.strictContinuous===true&&c.status?.keepsContinuity===true&&c.status?.retainedBezierRail===true,`${c.type} must stay on a strict retained rail even in outer Fade mode`);assert(c.plan?.presenceBoth===true&&c.plan?.continuousTopology===true,`${c.type} Fade mode broke retained continuity`);}
    assert(multiplierCase?.multiplier===4&&multiplierCase.min===8&&multiplierCase.max===16,'Morph N multiplier did not snap 5—19 to the valid ×4 range 8—16');
    assert(multiplierCase.targetNs.length>0&&multiplierCase.targetNs.every(n=>n%4===0&&n>=8&&n<=16),'Morph generated an N outside the ×4 grid');
    // Legacy projects authored with removed Spiral Topology must migrate safely.
    assert(topological.status?.type==='phaseCircle'&&!topological.status?.unrestrictedParameters,'obsolete Spiral Topology was not migrated to phase-circle');
    assert(topological.plan?.continuousTopology&&topological.plan?.presenceBoth,'legacy Topology migration did not preserve a retained path');
    assert(phaseCircleTopology.target.N!==phaseCircleTopology.source.N&&phaseCircleTopology.target.K!==phaseCircleTopology.source.K,'topological Spiral morph did not change N/K');
    assert(phaseCircleTopology.plan.mergeSplit>0&&phaseCircleTopology.plan.continuousTopology&&phaseCircleTopology.plan.presenceBoth,'topological Spiral N/K change is not a no-fade merge/split');
    assert(torn.target.N!==torn.source.N&&torn.target.K!==torn.source.K,'torn mode did not exercise topology change');
    assert(torn.plan&&!torn.plan.presenceBoth,'torn mode unexpectedly lost its intentional appear/disappear topology behavior');
    assert(torn.plan.exactSubdivisionOnly&&torn.plan.arcEqualizedRecords===0,'torn mode must preserve authored Beziers by exact subdivision only; arc resampling/equalization is forbidden');

    for(const type of ['continuous','phase','phaseCircle','minimalTurn','topology']){
      const p=shapeStress[type];
      assert(p&&p.finite,`${type} shape morph produced non-finite retained geometry`);
      assert(p.presenceBoth,`${type} shape morph breaks continuity by fading a rail`);
      assert(p.spinSafe,`${type} shape morph contains an unguarded multi-turn polar jump`);
      assert(p.maxSeam<2e-3,`${type} shape morph opens a seam (${p.maxSeam})`);
      assert(p.maxFrameStepNorm<0.12,`${type} shape morph frame displacement is too abrupt (${p.maxFrameStepNorm})`);
    }
    assert(shapeStress.phaseCircle.mergeSplit>0,'phase-circle shape + topology stress did not exercise Spiral merge/split');
    assert(shapeStress.topology?.finite&&shapeStress.topology?.presenceBoth,'legacy Topology stress did not migrate to retained Spiral transport');
    assert(shapeStress.torn&&shapeStress.torn.finite,'torn shape morph did not produce a finite plan');
    assert(shapeStress.torn.exactSubdivisionOnly&&shapeStress.torn.arcEqualizedRecords===0,'torn shape stress reintroduced arc resampling');
    assert(centerShade?.spec?.enabled===true&&centerShade.spec.mode==='spiral-soft-radial-plus-copy-alpha'&&centerShade.inside>=0&&centerShade.inside<centerShade.feather&&centerShade.feather<centerShade.outside&&centerShade.outside===1,'Spiral center gradient must be continuous while retaining Corridor copy alpha');
    assert(outerAnchor&&outerAnchor.index===1&&outerAnchor.id==='spiral-outer-test'&&outerAnchor.radius===320&&outerAnchor.participants===2,'rotation compensation is not anchored to the outermost visible Spiral layer');

    const exc=uncaughtExceptions(h.events).slice(baseline);
    assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('SPIRAL MORPH CONTINUITY: PASS',result);
  }finally{await h.close();}
}
main().catch(err=>{console.error('FAIL spiral morph continuity:',err.stack||err.message);process.exit(1);});
