const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:20000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(()=>{
      const mk=(tangential, N=13, K=4, rot=0, step=4, rounding=35)=>{
        const l=createLayer('v763-spiral');
        Object.assign(l,{visible:true,lineVisible:true,N,K,radius:240,radiusMultiplier:1,rotation:rot,rounding,lineJoinType:'rounded',profileMode:'spline',splineRenderMode:'smooth',closedLoop:false,
          profileNodes:[{x:0,y:0},{x:.18,y:.08},{x:.35,y:.28},{x:.55,y:.36},{x:.72,y:.20},{x:.90,y:.04},{x:1,y:0}],
          spiralEnabled:true,spiralOrder:1,spiralStep:step,spiralStepLinked:false,spiralTangential:tangential,spiralClosed:true,spiralRoundSeams:true,customSuborbits:null,chaosStar:false,
          glow:0,strokeWidth:2,strokeColor:'#ffd66b',opacity:100,fill:false});
        setPreSampledSplineLayer?.(l,false);return l;
      };
      const cubicPoint=(q,t)=>{const u=1-t,u2=u*u,t2=t*t;return{x:u2*u*q.p0.x+3*u2*t*q.c1.x+3*u*t2*q.c2.x+t2*t*q.p3.x,y:u2*u*q.p0.y+3*u2*t*q.c1.y+3*u*t2*q.c2.y+t2*t*q.p3.y};};
      const dense=(path)=>{const out=[];for(const q of path||[]){for(let k=0;k<10;k++)out.push(cubicPoint(q,k/10));}if(path?.length)out.push({...path[path.length-1].p3});return out;};
      const directedHausdorff=(a,b)=>{let max=0,sum=0,n=0;for(const p of a){let best=Infinity;for(const q of b){const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<best)best=d;}max=Math.max(max,best);sum+=best;n++;}return{max,mean:sum/Math.max(1,n)};};
      const staticCases=[];
      for(const tangential of [false,true]){
        const l=mk(tangential);const paths=buildOrbitPolylines(l)||[];let maxControlDiff=0,countMismatch=0;
        for(const p of paths){const spec=__spiroGetSpiralCarrierSpec(l,p.spiralBranchIndex);const q=__spiroBuildSpiralCarrierPath(l,spec.anchor,{...spec,branchIndex:p.spiralBranchIndex});const a=p._bezierSegments||[],b=q?._bezierSegments||[];if(a.length!==b.length){countMismatch++;continue;}for(let i=0;i<a.length;i++)for(const key of ['p0','c1','c2','p3'])for(const c of ['x','y'])maxControlDiff=Math.max(maxControlDiff,Math.abs((a[i][key]?.[c]||0)-(b[i][key]?.[c]||0)));}
        staticCases.push({tangential,pathCount:paths.length,maxControlDiff,countMismatch});
      }
      const morphCases=[];
      for(const tangential of [false,true]){
        const src=mk(tangential,13,4,0,4,35),dst=mk(tangential,17,5,22,5,35);dst.radius=270;dst.spiralOrder=1.7;
        runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';
        const p0=__somataSpiralCarrierMorphPlan(0,0),pTiny=__somataSpiralCarrierMorphPlan(0,.001),pMid=__somataSpiralCarrierMorphPlan(0,.5),p1=__somataSpiralCarrierMorphPlan(0,1);
        let maxTiny=0,meanTiny=0,total=0;const n=Math.min(p0?.paths?.length||0,pTiny?.paths?.length||0);
        for(let i=0;i<n;i++){const a=dense(p0.paths[i]),b=dense(pTiny.paths[i]),ab=directedHausdorff(a,b),ba=directedHausdorff(b,a);maxTiny=Math.max(maxTiny,ab.max,ba.max);meanTiny+=ab.mean+ba.mean;total+=2;}
        const finite=x=>Array.isArray(x?.packed)&&x.packed.length>0&&x.packed.every(Number.isFinite);
        morphCases.push({tangential,carrierMapped:pTiny?.carrierMapped===true,overflowTiny:pTiny?.carrierOverflow===true,overflowMid:pMid?.carrierOverflow===true,pathCount:pTiny?.pathCount||0,cubicCount:pTiny?.cubicCount||0,finite0:finite(p0),finiteTiny:finite(pTiny),finiteMid:finite(pMid),finite1:finite(p1),maxTiny,meanTiny:meanTiny/Math.max(1,total)});
      }
      return{staticCases,morphCases,status:__somataSpiralBezierMorphStatus?.()?.contract||''};
    })()`,{timeoutMs:18000,label:'7.6.3 spiral carrier/profile invariant'});
    for(const c of out.staticCases){
      assert(c.pathCount>0,`static ${c.tangential?'tangential':'linear'} Spiral has no paths`);
      assert(c.countMismatch===0,`static ${c.tangential?'tangential':'linear'} carrier cubic count mismatch`);
      assert(c.maxControlDiff<1e-6,`static ${c.tangential?'tangential':'linear'} and carrier builder differ: ${c.maxControlDiff}`);
    }
    for(const c of out.morphCases){
      assert(c.carrierMapped,`Morph ${c.tangential?'tangential':'linear'} is not carrier/profile mapped`);
      assert(!c.overflowTiny&&!c.overflowMid,`Morph ${c.tangential?'tangential':'linear'} fell back from carrier mapping`);
      assert(c.finite0&&c.finiteTiny&&c.finiteMid&&c.finite1,`Morph ${c.tangential?'tangential':'linear'} produced non-finite cubics`);
      assert(c.pathCount>0&&c.cubicCount>0,`Morph ${c.tangential?'tangential':'linear'} has empty retained geometry`);
      // 0.1% into a phase may move the carrier, but must not instantly deform the authored profile.
      assert(c.maxTiny<1.5,`Morph ${c.tangential?'tangential':'linear'} has a first-frame geometry jump: ${c.maxTiny}px`);
    }
    assert(String(out.status).includes('carrier/profile constructor'),'status does not advertise the 7.6.3 carrier/profile invariant');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6.3 SPIRAL CARRIER/PROFILE INVARIANT: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6.3 spiral carrier/profile invariant:',e.stack||e.message);process.exit(1)});
