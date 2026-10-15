const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:24000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const mk=(id,{N=12,K=1,step=K,rotation=0,radius=235,order=1,tangential=true,profile=null}={})=>{
        const l=createLayer(id);Object.assign(l,{visible:true,lineVisible:true,N,K,radius,radiusMultiplier:1,rotation,rounding:0,lineJoinType:'sharp',profileMode:'segments',closedLoop:false,
          profileNodes:(profile||[{x:0,y:0},{x:.22,y:.26},{x:.58,y:-.19},{x:1,y:0}]).map(p=>({...p})),
          spiralEnabled:true,spiralOrder:order,spiralStep:step,spiralStepLinked:false,spiralTangential:tangential,spiralClosed:true,spiralRoundSeams:false,customSuborbits:null,chaosStar:false,
          glow:0,strokeWidth:2,strokeColor:'#fff',opacity:100,fill:false});setPreSampledSplineLayer?.(l,false);return l;
      };
      const setPair=(type,mode,src,dst)=>{state.morph.spiralMorphType=type;state.morph.mode=mode;runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];};
      const periodicCount=p=>{let n=0;const a=p?.cpuPathClosure||[];for(let i=0;i<(p?.pathCount||0);i++)if(Number(a[i*8+6])>.5)n++;return n;};
      const cpuSummary=p=>({carrierMapped:p?.carrierMapped===true,exact:p?.exactSubdivisionOnly===true,arc:Number(p?.arcEqualizedRecords)||0,paths:Number(p?.pathCount)||0,cubics:Number(p?.cubicCount)||0,merge:Number(p?.topologyMergeSplitCount)||0,presence:(p?.data?Array.from({length:p.cubicCount},(_,i)=>p.data[i*24+20]>.5&&p.data[i*24+21]>.5).every(Boolean):false),periodic:periodicCount(p),cart:Number(p?.cartesianFallbackCubics)||0,metric:String(p?.interpolationMetric||'')});
      const frameSummary=p=>{const f=p?.carrierFrames?.[0];return f?{anchor:{...f.anchor},end:{...f.end},N:f.N,step:f.step,delta:f.delta,targetScale:f.targetScale,metric:f.metric}:null;};
      const dist=(a,b)=>Math.hypot((Number(a?.x)||0)-(Number(b?.x)||0),(Number(a?.y)||0)-(Number(b?.y)||0));
      const avg=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
      const modes={};

      // Continuous: the carrier topology is literally fixed. Only non-topological authored
      // transforms may move the rail.
      {
        const s=mk('c-s',{N:12,K:3,step:3,rotation:7}),d=mk('c-d',{N:12,K:3,step:3,rotation:41,radius:265});setPair('continuous','circleSlide',s,d);
        const cpu=__somataSpiralMorphCpuPlan(0),mid=__somataSpiralCarrierMorphPlan(0,.5);modes.continuous={cpu:cpuSummary(cpu),mid:frameSummary(mid)};
      }
      // Phase: N stays fixed; K is the phase step. The end keypoint is allowed to wind as K
      // changes, while every retained rail remains periodic and present.
      {
        const s=mk('p-s',{N:12,K:1,step:1,rotation:0}),d=mk('p-d',{N:12,K:5,step:5,rotation:0});setPair('phase','circleSlide',s,d);
        const cpu=__somataSpiralMorphCpuPlan(0),mid=__somataSpiralCarrierMorphPlan(0,.5);modes.phase={cpu:cpuSummary(cpu),mid:frameSummary(mid),src:{N:s.N,K:s.K,step:s.spiralStep},dst:{N:d.N,K:d.K,step:d.spiralStep}};
      }
      // Phase-circle: it is Phase plus branch/turn clone-merge when N changes.
      {
        const s=mk('pc-s',{N:12,K:1,step:1,rotation:0}),d=mk('pc-d',{N:15,K:4,step:4,rotation:31});setPair('phaseCircle','circleSlide',s,d);
        const cpu=__somataSpiralMorphCpuPlan(0),mid=__somataSpiralCarrierMorphPlan(0,.5);modes.phaseCircle={cpu:cpuSummary(cpu),mid:frameSummary(mid)};
      }
      // Constant-step continuous: N may change through clone-merge but the winding step may not.
      {
        const s=mk('m-s',{N:12,K:1,step:2,rotation:0}),d=mk('m-d',{N:15,K:1,step:2,rotation:23});setPair('minimalTurn','circleSlide',s,d);
        const cpu=__somataSpiralMorphCpuPlan(0),mid=__somataSpiralCarrierMorphPlan(0,.5);modes.minimalTurn={cpu:cpuSummary(cpu),mid:frameSummary(mid)};
      }
      // Topology: the two key endpoints themselves must travel Cartesianly. The profile is only
      // mapped after that key carrier has been resolved.
      {
        const s=mk('t-s',{N:12,K:1,step:1,rotation:-37,radius:210,order:1}),d=mk('t-d',{N:17,K:6,step:6,rotation:126,radius:285,order:-2});setPair('topology','topology',s,d);
        const p0=__somataSpiralCarrierMorphPlan(0,0),pm=__somataSpiralCarrierMorphPlan(0,.5),p1=__somataSpiralCarrierMorphPlan(0,1),f0=frameSummary(p0),fm=frameSummary(pm),f1=frameSummary(p1),path=pm?.paths?.[0]||[];
        modes.topology={cpu:cpuSummary(__somataSpiralMorphCpuPlan(0)),f0,fm,f1,startMidError:dist(fm?.anchor,avg(f0.anchor,f1.anchor)),endMidError:dist(fm?.end,avg(f0.end,f1.end)),pathStartError:path.length?dist(path[0].p0,fm.anchor):Infinity,pathEndError:path.length?dist(path[path.length-1].p3,fm.end):Infinity};
      }
      // Key-carrier motion must be independent from the selected line profile.
      {
        const profileA=[{x:0,y:0},{x:.08,y:.7},{x:.42,y:-.48},{x:1,y:0}],profileB=[{x:0,y:0},{x:.31,y:-.58},{x:.64,y:.62},{x:.82,y:-.25},{x:1,y:0}];
        const get=(profile)=>{const s=mk('pi-s',{N:13,K:2,step:2,rotation:-15,profile}),d=mk('pi-d',{N:18,K:7,step:7,rotation:119,radius:290,order:-1,profile});setPair('topology','topology',s,d);return frameSummary(__somataSpiralCarrierMorphPlan(0,.37));};
        const a=get(profileA),b=get(profileB);modes.profileInvariant={anchorError:dist(a.anchor,b.anchor),endError:dist(a.end,b.end),deltaError:Math.abs(a.delta-b.delta),NError:Math.abs(a.N-b.N),stepError:Math.abs(a.step-b.step)};
      }
      // Torn: no arc-length resampling. Exact Bézier subdivision may equalize segment count,
      // because subdivision is shape-preserving. Its transport metric follows the ordinary
      // polygon/profile Morph mode (circle/polar vs Topology/Cartesian).
      {
        const s=mk('r-s',{N:11,K:2,step:2,rotation:-12,profile:[{x:0,y:0},{x:.12,y:.8},{x:.38,y:-.5},{x:1,y:0}]}),d=mk('r-d',{N:16,K:5,step:5,rotation:103,profile:[{x:0,y:0},{x:.25,y:-.65},{x:.54,y:.55},{x:.79,y:-.32},{x:1,y:0}]});
        setPair('torn','circleSlide',s,d);const circular=cpuSummary(__somataSpiralMorphCpuPlan(0));
        setPair('torn','topology',s,d);const topology=cpuSummary(__somataSpiralMorphCpuPlan(0));
        modes.torn={circular,topology};
      }
      return{modes,contract:__somataSpiralBezierMorphStatus?.()?.contract||''};
    })()`,{timeoutMs:22000,label:'7.6.6 spiral keypoint transport regression'});

    const m=out.modes;
    assert(m.continuous.cpu.carrierMapped&&m.continuous.cpu.exact&&m.continuous.cpu.arc===0,'Continuous is not carrier-first/exact');
    assert(m.continuous.cpu.presence&&m.continuous.cpu.periodic===m.continuous.cpu.paths,'Continuous spiral rail is not fully retained/periodic');
    assert(Math.abs(m.continuous.mid.N-12)<1e-9&&Math.abs(m.continuous.mid.step-3)<1e-9,'Continuous changed N or K/step');

    assert(m.phase.src.N===m.phase.dst.N&&m.phase.src.K!==m.phase.dst.K,'Phase setup did not exercise fixed-N variable-K');
    assert(m.phase.cpu.carrierMapped&&m.phase.cpu.exact&&m.phase.cpu.arc===0&&m.phase.cpu.presence,'Phase is not an exact retained carrier rail');
    assert(m.phase.cpu.periodic===m.phase.cpu.paths,'Phase loses periodic continuity while K changes');
    assert(Math.abs(m.phase.mid.N-12)<1e-9&&Math.abs(m.phase.mid.step-3)<1e-9,'Phase did not interpolate K as the actual step');
    assert(Math.abs(m.phase.mid.delta-(Math.PI*2*3/12))<1e-9,'Phase key endpoint does not wind by 2π*K/N');

    assert(m.phaseCircle.cpu.carrierMapped&&m.phaseCircle.cpu.exact&&m.phaseCircle.cpu.arc===0&&m.phaseCircle.cpu.presence,'Phase-circle is not exact retained carrier transport');
    assert(m.phaseCircle.cpu.merge>0,'Phase-circle did not clone/merge turns when N changed');
    assert(m.phaseCircle.cpu.periodic===m.phaseCircle.cpu.paths,'Phase-circle clone/merge breaks the continuous rail');
    assert(Math.abs(m.phaseCircle.mid.delta-(Math.PI*2*m.phaseCircle.mid.step/m.phaseCircle.mid.N))<1e-9,'Phase-circle is not derived from the Phase carrier law');

    assert(m.minimalTurn.cpu.carrierMapped&&m.minimalTurn.cpu.exact&&m.minimalTurn.cpu.arc===0&&m.minimalTurn.cpu.presence,'constant-step mode is not exact retained carrier transport');
    assert(m.minimalTurn.cpu.merge>0,'constant-step mode did not clone/merge turns when N changed');
    assert(Math.abs(m.minimalTurn.mid.step-2)<1e-9,'constant-step mode changed its step');
    assert(Math.abs(m.minimalTurn.mid.delta-(Math.PI*2*2/m.minimalTurn.mid.N))<1e-9,'constant-step mode does not derive winding from fixed step/current N');

    assert(m.topology.cpu.carrierMapped&&m.topology.cpu.exact&&m.topology.cpu.arc===0&&m.topology.cpu.presence,'Topology is not exact retained carrier transport');
    assert(m.topology.fm.metric==='cartesian-start-end-keypoints','Topology does not report Cartesian keypoint transport');
    assert(m.topology.startMidError<1e-7&&m.topology.endMidError<1e-7,`Topology keypoints are not linear: ${m.topology.startMidError}, ${m.topology.endMidError}`);
    assert(m.topology.pathStartError<1e-6&&m.topology.pathEndError<1e-5,`profile mapping does not land on Topology keypoints: ${m.topology.pathStartError}, ${m.topology.pathEndError}`);
    assert(m.profileInvariant.anchorError<1e-8&&m.profileInvariant.endError<1e-8&&m.profileInvariant.deltaError<1e-10&&m.profileInvariant.NError<1e-10&&m.profileInvariant.stepError<1e-10,'carrier keypoint motion depends on the line profile');

    assert(m.torn.circular.exact&&m.torn.circular.arc===0,'Torn circle transport reintroduced arc resampling');
    assert(m.torn.topology.exact&&m.torn.topology.arc===0,'Torn Topology transport reintroduced arc resampling');
    assert(m.torn.circular.metric==='profile-mode'&&m.torn.circular.cart===0,'Torn circle mode does not follow ordinary profile/polygon circular transport');
    assert(m.torn.topology.metric==='cartesian'&&m.torn.topology.cart>0,'Torn Topology mode does not follow ordinary profile/polygon Cartesian transport');
    assert(m.torn.circular.periodic>0&&m.torn.topology.periodic>0,'Torn removed periodic seam metadata from matched spiral rails');
    assert(String(out.contract).includes('7.7.9')&&String(out.contract).includes('no arc resampling'),'renderer contract does not advertise 7.6.6 Spiral semantics');

    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6.6 SPIRAL KEYPOINT TRANSPORT: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6.6 spiral keypoint transport regression:',e.stack||e.message);process.exit(1)});
