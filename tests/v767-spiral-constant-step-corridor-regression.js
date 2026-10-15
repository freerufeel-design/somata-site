const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:420,evalTimeoutMs:26000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const mk=(id,{N=12,step=2,rotation=0,radius=235,glow=18}={})=>{
        const l=createLayer(id);Object.assign(l,{visible:true,lineVisible:true,N,K:1,radius,radiusMultiplier:1,rotation,rounding:0,lineJoinType:'sharp',profileMode:'segments',closedLoop:false,
          profileNodes:[{x:0,y:0},{x:.18,y:.31},{x:.52,y:-.22},{x:1,y:0}],spiralEnabled:true,spiralOrder:1,spiralStep:step,spiralStepLinked:false,
          spiralTangential:true,spiralClosed:true,spiralRoundSeams:false,customSuborbits:null,chaosStar:false,glow,strokeWidth:2,strokeColor:'#ff0077',opacity:100,fill:false});
        setPreSampledSplineLayer?.(l,false);return l;
      };
      state.tunnel.active=true;state.tunnel.spacingStrength=1;state.tunnel.spacingMultiplier=1;state.tunnel.minScale=.055;state.tunnel.maxScale=3.8;state.tunnel.copies=28;
      const q=getTunnelStepRatio();
      const src=mk('seam-s',{N:12,step:2,rotation:-17,radius:235}),dst=mk('seam-d',{N:17,step:2,rotation:46,radius:286});
      state.layers=[src];state.activeLayerId=src.id;state.morph.spiralMorphType='minimalTurn';state.morph.mode='circleSlide';state.morph.pauseOnSpace=true;
      state.morph.options={...(state.morph.options||{}),byVertices:true,bySteps:true,byShape:true,bySize:true,byRotation:true,bySpiralOrder:false,bySpiralLayers:false};
      runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];runtimeState.morph.sourceVisuals=[{...src}];runtimeState.morph.targetVisuals=[{...dst}];runtimeState.morph.sourceProfiles=[{mode:'segments',nodes:src.profileNodes.map(p=>({...p})),rawNodes:src.profileNodes.map(p=>({...p}))}];runtimeState.morph.targetProfiles=[{mode:'segments',nodes:dst.profileNodes.map(p=>({...p})),rawNodes:dst.profileNodes.map(p=>({...p}))}];
      const xform=(p,scale,ang)=>({x:scale*(Math.cos(ang)*p.x-Math.sin(ang)*p.y),y:scale*(Math.sin(ang)*p.x+Math.cos(ang)*p.y)});
      const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
      const samples=[];
      for(const t of [0,.125,.37,.5,.73,.91,1]){
        runtimeState.morph.geometryT=t;runtimeState.morph.progress=t;runtimeState.morph.geometryBlend=t;
        // This deliberately mirrors the live resolved layer in 7.6.6: N is still canonical/source.
        const frame={...src,id:src.id,glow:src.glow};
        const plan=__somataSpiralCarrierMorphPlan(0,t),paths=plan?.paths||[],frames=plan?.carrierFrames||[];
        const c0={copyId:0,position:0,scale:1},c1={copyId:1,position:1,scale:q};
        const a0=getMotionTunnelLagRadians(c0,frame),a1=getMotionTunnelLagRadians(c1,frame);
        let maxGap=0,maxLocalEndpointError=0;
        for(let i=0;i<Math.min(paths.length,frames.length);i++){
          const path=paths[i];if(!path?.length)continue;
          const p0=path[0].p0,p3=path[path.length-1].p3,f=frames[i];
          maxLocalEndpointError=Math.max(maxLocalEndpointError,dist(p3,f.end));
          maxGap=Math.max(maxGap,dist(xform(p3,1,a0),xform(p0,q,a1)));
        }
        samples.push({t,maxGap,maxLocalEndpointError,phaseStep:a1-a0,carrierDelta:frames[0]?.delta||0,N:frames[0]?.N||0,step:frames[0]?.step||0});
      }
      // Pause must snap the visible full Morph back to its stable source endpoint rather than
      // leaving a half-built continuous spiral on screen.
      runtimeState.morph.geometryT=.43;runtimeState.morph.progress=.43;runtimeState.morph.geometryBlend=.43;runtimeState.morph.cycleStart=performance.now()-430;
      runtimeState.morph.frameLayers=[{...src,N:14,rotation:12,glow:src.glow}];
      const cb=document.getElementById('morphPauseOnSpace');if(cb)cb.checked=true;
      document.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true}));
      const paused={paused:runtimeState.morph.paused===true,geometryT:Number(runtimeState.morph.geometryT),progress:Number(runtimeState.morph.progress),blend:Number(runtimeState.morph.geometryBlend),frameN:Number(runtimeState.morph.frameLayers?.[0]?.N),frameRotation:Number(runtimeState.morph.frameLayers?.[0]?.rotation)};
      return{q,samples,paused,glowRoute:__somataSpiralBezierGlowRouting?.({_spiralBezierMorphGpuNative:true},false)===true,contract:__somata76MorphArchitectureStatus?.()?.contract||''};
    })()`,{timeoutMs:24000,label:'7.6.7 constant-step corridor seam regression'});

    for(const s of out.samples){
      assert(s.maxLocalEndpointError<1e-5,`carrier profile misses its key endpoint at t=${s.t}: ${s.maxLocalEndpointError}`);
      assert(s.maxGap<1e-4,`constant-step Corridor seam opens at t=${s.t}: gap=${s.maxGap}, phase=${s.phaseStep}, delta=${s.carrierDelta}, N=${s.N}`);
      assert(Math.abs(s.phaseStep-s.carrierDelta)<1e-8,`Corridor phase is not synchronized with the carrier at t=${s.t}: ${s.phaseStep} vs ${s.carrierDelta}`);
      assert(Math.abs(s.step-2)<1e-9,`constant-step changed K/spiralStep at t=${s.t}: ${s.step}`);
    }
    assert(out.paused.paused,'Space did not pause full Morph');
    assert(Math.abs(out.paused.geometryT)<1e-12&&Math.abs(out.paused.progress)<1e-12&&Math.abs(out.paused.blend)<1e-12,`Space froze an intermediate Morph instead of stable source: ${JSON.stringify(out.paused)}`);
    assert(out.paused.frameN===12&&Math.abs(out.paused.frameRotation-(-17))<1e-9,`paused resolved layer is not the exact stable source: ${JSON.stringify(out.paused)}`);
    assert(out.glowRoute,'Spiral Morph Glow is not routed to the retained spiral rail');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6.7 CONSTANT-STEP CORRIDOR SEAM: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6.7 constant-step Corridor regression:',e.stack||e.message);process.exit(1)});
