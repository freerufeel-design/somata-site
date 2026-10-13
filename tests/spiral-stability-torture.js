const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:25000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      let seed=0x7427cafe>>>0;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},ri=(a,b)=>Math.floor(a+rnd()*(b-a+1)),rf=(a,b)=>a+rnd()*(b-a);
      const wrap01=v=>{v%=1;if(v<0)v+=1;return v;};
      const branchPhase=(idx,n)=>wrap01((Number(idx)||0)/Math.max(1,Number(n)||1));
      const inversionCount=(pairs,n1,n2)=>{
        const a=(pairs||[]).map(p=>({s:branchPhase(p.sourceBranchIndex,n1),d:branchPhase(p.targetBranchIndex,n2)})).filter(q=>Number.isFinite(q.s)&&Number.isFinite(q.d)).sort((x,y)=>x.s-y.s);
        if(a.length<3)return 0;let best=1e9;
        for(let cut=0;cut<a.length;cut++){
          let inv=0,prev=null,unwrap=0;
          for(let k=0;k<a.length;k++){
            let d=a[(k+cut)%a.length].d;
            if(prev!==null){while(d+unwrap<prev-.5)unwrap+=1;while(d+unwrap>prev+.5)unwrap-=1;d+=unwrap;if(d+1e-6<prev)inv++;}else d+=unwrap;
            prev=d;
          }
          best=Math.min(best,inv);
        }
        return best;
      };
      const finitePlan=p=>p&&p.data&&Array.from(p.data).every(Number.isFinite);
      const seamError=p=>{let max=0;const F=24,xy=(r,a)=>({x:r*Math.cos(a),y:r*Math.sin(a)});const pt=(ci,slot,t)=>{const o=ci*F,cart=p.data[o+22]>.5,si=o+slot*2,di=o+8+slot*2,s=xy(p.data[si],p.data[si+1]),d=xy(p.data[di],p.data[di+1]);if(cart)return{x:s.x+(d.x-s.x)*t,y:s.y+(d.y-s.y)*t};const r=p.data[si]+(p.data[di]-p.data[si])*t,a=p.data[si+1]+(p.data[di+1]-p.data[si+1])*t;return xy(r,a)};const rr=p.cpuPathSegmentRanges;for(let pi=0;pi<p.pathCount;pi++){const first=rr[pi*4]>>>0,n=rr[pi*4+1]>>>0;for(let ti=0;ti<=8;ti++){const t=ti/8;for(let j=0;j+1<n;j++){const a=pt(first+j,3,t),b=pt(first+j+1,0,t);max=Math.max(max,Math.hypot(a.x-b.x,a.y-b.y));}}}return max;};
      const base=state.layers[0],cases=[];
      const known=[
        {type:'phaseCircle',N1:4,N2:30,K1:2,K2:14,o1:-1,o2:-4,r1:-29,r2:-175},
        {type:'phaseCircle',N1:10,N2:29,K1:3,K2:4,o1:-3,o2:-3,r1:13,r2:120},
        {type:'topology',N1:9,N2:27,K1:1,K2:8,o1:-2,o2:2,r1:108,r2:38},
        {type:'minimalTurn',N1:6,N2:22,K1:2,K2:2,o1:3,o2:-4,r1:138,r2:46}
      ];
      for(let i=0;i<180;i++){const type=['continuous','phase','phaseCircle','minimalTurn','topology','torn'][ri(0,5)],N1=ri(4,30),N2=(type==='continuous'||type==='phase')?N1:ri(4,30),K1=ri(1,Math.max(1,Math.floor(N1/2))),K2=type==='phase'||type==='minimalTurn'?K1:ri(1,Math.max(1,Math.floor(N2/2)));known.push({type,N1,N2,K1,K2,o1:ri(-4,4)||1,o2:ri(-4,4)||1,r1:ri(-180,180),r2:ri(-180,180)});}
      let maxInv=0,maxSeam=0,maxPolarTurn=0,totalPlans=0,stablePlans=0;
      for(const c of known){
        const src={...base,id:'spiral-stress-src',visible:true,spiralEnabled:true,spiralClosed:true,spiralTangential:rnd()<.7,spiralRoundSeams:true,closedLoop:false,N:c.N1,K:c.K1,spiralStep:c.K1,spiralStepLinked:false,spiralOrder:c.o1,radius:rf(130,330),rotation:c.r1,rounding:ri(0,24),profileMode:rnd()<.5?'segments':'spline',profileNodes:[{x:0,y:0},{x:.14,y:rf(-.72,.72)},{x:.38,y:rf(-.72,.72)},{x:.67,y:rf(-.72,.72)},{x:1,y:0}]};
        const dst={...src,id:'spiral-stress-dst',N:c.N2,K:c.K2,spiralStep:c.type==='phase'?ri(1,Math.max(1,c.N1-1)):c.K2,spiralOrder:c.o2,radius:rf(130,330),rotation:c.r2,profileMode:rnd()<.5?'segments':'spline',profileNodes:[{x:0,y:0},{x:.10,y:rf(-.72,.72)},{x:.31,y:rf(-.72,.72)},{x:.58,y:rf(-.72,.72)},{x:.84,y:rf(-.72,.72)},{x:1,y:0}]};
        state.morph.spiralMorphType=c.type;state.morph.mode=c.type==='topology'?'topology':'circleSlide';runtimeState.morph.renderSourceLayers=[src];runtimeState.morph.renderTargetLayers=[dst];const p=__somataSpiralMorphCpuPlan(0);if(!p)throw new Error('no plan for '+JSON.stringify(c));totalPlans++;
        if(p.stableSpiralPairing===true)stablePlans++;
        if(!finitePlan(p))throw new Error('non-finite Spiral plan '+JSON.stringify(c));
        const inv=inversionCount(p.auxPairs,c.N1,c.N2);maxInv=Math.max(maxInv,inv);if(inv!==0)throw new Error('crossed Spiral branch pairing '+JSON.stringify({...c,inv,pairs:p.auxPairs.map(q=>[q.sourceBranchIndex,q.targetBranchIndex]).slice(0,40)}));
        const seam=seamError(p);maxSeam=Math.max(maxSeam,seam);if(seam>1e-4)throw new Error('Spiral seam gap '+seam+' '+JSON.stringify(c));
        maxPolarTurn=Math.max(maxPolarTurn,Number(p.maxPackedPolarTurn)||0);
      }
      return{totalPlans,stablePlans,maxInv,maxSeam,maxPolarTurn,knownRegressions:4};
    })()`);
    assert(result.totalPlans>=184,'not all Spiral torture cases ran');
    assert(result.stablePlans===result.totalPlans,'not every Spiral plan used stable order-preserving pairing');
    assert(result.maxInv===0,'Spiral branch-order inversion detected');
    assert(result.maxSeam<=1e-4,'Spiral seam regression');
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,`uncaught browser exceptions: ${errors.join(' | ')}`);
    console.log('SPIRAL STABILITY TORTURE: PASS',result);
  }finally{await h.close();}
}
main().catch(err=>{console.error('SPIRAL STABILITY TORTURE: FAIL',err);process.exit(1);});
