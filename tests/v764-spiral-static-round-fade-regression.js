const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:20000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const clone=p=>({x:Number(p?.x)||0,y:Number(p?.y)||0});
      const tangentDot=(a,b)=>{const la=Math.hypot(a.x,a.y),lb=Math.hypot(b.x,b.y);return la>1e-9&&lb>1e-9?(a.x*b.x+a.y*b.y)/(la*lb):1;};
      const joinStats=(segs)=>{let min=1,count=0;for(let i=1;i<(segs?.length||0);i++){const a=segs[i-1],b=segs[i];if(a?.__profileCorner1===true||b?.__profileCorner0===true)continue;const vin={x:(a.p3.x-a.c2.x),y:(a.p3.y-a.c2.y)},vout={x:(b.c1.x-b.p0.x),y:(b.c1.y-b.p0.y)};const d=tangentDot(vin,vout);if(Number.isFinite(d)){min=Math.min(min,d);count++;}}return{min,count};};
      const closure=(segs)=>{if(!segs?.length||segs._spiroPeriodic!==true)return{pos:Infinity,tan:Infinity,periodic:false};const delta=Number(segs._spiroPeriodicDelta),scale=Math.max(1e-6,Number(segs._spiroPeriodicScale)||1);if(!Number.isFinite(delta)||!Number.isFinite(scale))return{pos:Infinity,tan:Infinity,periodic:false};const c=Math.cos(delta),s=Math.sin(delta),map=p=>({x:(c*p.x-s*p.y)*scale,y:(s*p.x+c*p.y)*scale});const first=segs[0],last=segs[segs.length-1],ep=map(first.p0),ec1=map(first.c1),ec2={x:2*ep.x-ec1.x,y:2*ep.y-ec1.y};return{pos:Math.hypot(last.p3.x-ep.x,last.p3.y-ep.y),tan:segs._spiroPeriodicTangent===true?Math.hypot(last.c2.x-ec2.x,last.c2.y-ec2.y):0,periodic:true};};
      const mk=(rounding)=>{const l=createLayer('v764-static-spiral');Object.assign(l,{visible:true,lineVisible:true,N:13,K:4,radius:250,radiusMultiplier:1,rotation:0,rounding,lineJoinType:'rounded',profileMode:'segments',splineRenderMode:'smooth',closedLoop:false,profileNodes:[{x:0,y:0},{x:.08,y:.65},{x:.16,y:-.45},{x:.22,y:.70},{x:.40,y:-.20},{x:.62,y:.80},{x:.72,y:-.35},{x:1,y:0}],spiralEnabled:true,spiralOrder:1,spiralStep:4,spiralStepLinked:false,spiralTangential:true,spiralClosed:true,spiralRoundSeams:true,customSuborbits:null,chaosStar:false,glow:0,strokeWidth:2,strokeColor:'#ffd66b',opacity:100,fill:false});setPreSampledSplineLayer?.(l,false);return l;};

      // Synthetic regression: a generated fillet boundary that is still a 90deg kink
      // must be repaired without moving the knot itself.
      const synthetic=[{p0:{x:-2,y:0},c1:{x:-1.5,y:0},c2:{x:-1,y:0},p3:{x:0,y:0}},{p0:{x:0,y:0},c1:{x:0,y:1},c2:{x:0,y:1.5},p3:{x:0,y:2}}];
      const before=tangentDot({x:synthetic[0].p3.x-synthetic[0].c2.x,y:synthetic[0].p3.y-synthetic[0].c2.y},{x:synthetic[1].c1.x-synthetic[1].p0.x,y:synthetic[1].c1.y-synthetic[1].p0.y});
      __spiroRepairRoundedSpiralBezierJoins(synthetic);
      const after=tangentDot({x:synthetic[0].p3.x-synthetic[0].c2.x,y:synthetic[0].p3.y-synthetic[0].c2.y},{x:synthetic[1].c1.x-synthetic[1].p0.x,y:synthetic[1].c1.y-synthetic[1].p0.y});

      const cases=[];
      for(const rounding of [80,120,160,200]){
        const l=mk(rounding),paths=buildOrbitPolylines(l)||[];let repairs=0,minDot=1,maxPos=0,maxTan=0,cubics=0;
        for(const p of paths){const segs=p._bezierSegments||p._spiroRetainedCubics||[];cubics+=segs.length;repairs+=Number(segs._spiroSecondaryRoundRepairs)||0;const js=joinStats(segs);minDot=Math.min(minDot,js.min);const cl=closure(segs);maxPos=Math.max(maxPos,cl.pos);if(segs._spiroPeriodicTangent===true)maxTan=Math.max(maxTan,cl.tan);}
        cases.push({rounding,pathCount:paths.length,cubics,repairs,minDot,maxPos,maxTan});
      }

      // Center emergence is now temporal/per-copy alpha only.  A radial geometry mask
      // would also dim unrelated rails that merely cross the screen center.
      const backup={...state.tunnel};state.tunnel.active=true;state.tunnel.centerHiddenCopies=3;state.tunnel.minScale=.055;
      const sample=[];
      for(const phase of [.49,.50,.51]){state.tunnel.travelPhase=phase;const copies=getTunnelCopies();const partial=copies.find(c=>Number(c.centerRevealAlpha)>.001&&Number(c.centerRevealAlpha)<.999);const vis=prepareTunnelVisibleInstances(copies,220,1,900,1,'v764-center',performance.now());const idx=partial?vis.copies.indexOf(partial):-1;sample.push({phase,copyAlpha:Number(partial?.centerRevealAlpha)||0,visibleAlpha:idx>=0?Number(vis.alphas[idx]):-1});}
      const shade=WebGPUSpiralBezierMorphRenderer.debugCenterShadeSpec({layerExtent:300,lightMorphScale:1,visibleInstances:{copies:[{stepRatio:1.2}]}});
      const radial=[0,10,100,1000].map(r=>WebGPUSpiralBezierMorphRenderer.debugCenterShadeAlpha(r,shade));
      Object.assign(state.tunnel,backup);
      return{before,after,syntheticRepairs:synthetic._spiroSecondaryRoundRepairs||0,cases,sample,shade,radial,status:__somataSpiralBezierMorphStatus?.()?.contract||''};
    })()`,{timeoutMs:18000,label:'7.6.4 static spiral closure / secondary rounding / center fade'});

    assert(out.before<0.1,`synthetic setup is not a sharp join: ${out.before}`);
    assert(out.after>0.999,`secondary rounding did not tangent-repair the join: ${out.after}`);
    assert(out.syntheticRepairs===1,`synthetic secondary-round repair count is ${out.syntheticRepairs}`);
    let repairedReal=0;
    for(const c of out.cases){
      assert(c.pathCount>0&&c.cubics>0,`rounding=${c.rounding}: static Spiral is empty`);
      assert(c.maxPos<1e-6,`rounding=${c.rounding}: static Spiral periodic endpoint does not close (${c.maxPos})`);
      assert(c.maxTan<1e-5,`rounding=${c.rounding}: static Spiral periodic tangent does not close (${c.maxTan})`);
      assert(c.minDot>0.999,`rounding=${c.rounding}: rounded static Spiral still has a tangent kink (${c.minDot})`);
      repairedReal+=c.repairs;
    }
    assert(repairedReal>0,'aggressive real profile did not exercise secondary-round repair');
    assert(out.shade?.enabled===false&&out.shade?.mode==='copy-alpha','Spiral center emergence still owns a radial geometry mask');
    assert(out.radial.every(a=>Math.abs(a-1)<1e-12),'disabled radial center mask still dims center-crossing geometry');
    const a=out.sample.map(x=>x.copyAlpha),v=out.sample.map(x=>x.visibleAlpha);
    assert(a.every(x=>x>0&&x<1)&&v.every(x=>x>0&&x<1),'center copy does not emerge through partial alpha');
    assert(a[0]<a[1]&&a[1]<a[2],`center reveal is not monotonic around the phase boundary: ${a.join(',')}`);
    assert(Math.max(a[1]-a[0],a[2]-a[1])<0.06,`center reveal still jumps near phase=.5: ${a.join(',')}`);
    assert(String(out.status).includes('7.6.4')||String(out.status).includes('copy-alpha')||String(out.status).includes('whole-copy alpha'),'status does not advertise 7.6.4+ center/closure contract');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6.4 STATIC SPIRAL ROUND/FADE REGRESSION: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6.4 static spiral round/fade regression:',e.stack||e.message);process.exit(1)});
