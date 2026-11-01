'use strict';
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:130,evalTimeoutMs:40000});try{
 const r=await h.evaluate(`(()=>{
    const setup=(id,N,K,S=5)=>{const l=createLayer(id);Object.assign(l,{visible:true,lineVisible:true,N,K,customSuborbits:S,profileMode:'segments',spiralEnabled:true,spiralOrder:1,spiralClosed:true,spiralStep:K,spiralStepLinked:true,spiralTangential:false,spiralRoundSeams:true,radius:200,rotation:-429.5,rounding:23,profileNodes:[{x:0,y:0},{x:1,y:0}]});return l;};
    const results=[];
    for(const [sn,sk,dn,dk] of [[17,7,17,8],[16,7,17,8],[16,7,16,8],[17,7,18,8],[17,8,17,8]]){
      const s=setup('s',sn,sk),d=setup('d',dn,dk);
      state.morph.spiralMorphType='phaseCircle';state.morph.mode='circleSlide';
      runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];
      const staticS=buildOrbitPolylines(s),staticD=buildOrbitPolylines(d);
      const plan=__somataSpiralMorphCpuPlan(0);
      const frames=[0,.2,.5,.74,.99,1].map(t=>{const p=__somataSpiralCarrierMorphPlan(0,t);return{t,pathCount:p?.pathCount,cubicCount:p?.cubicCount,vis:p?.branchPresence?.filter(v=>v>.0001).length,degree:p?.carrierFrames?.[0]?.delta*180/Math.PI,gapMax:Math.max(0,...(p?.paths||[]).map(path=>path.reduce((m,q,i)=>{if(!i)return m;const a=path[i-1].p3,b=q.p0;return Math.max(m,Math.hypot(a.x-b.x,a.y-b.y))},0))),gapCount:(p?.paths||[]).reduce((n,path)=>n+path.reduce((m,q,i)=>{if(!i)return m;const a=path[i-1].p3,b=q.p0;return m+(Math.hypot(a.x-b.x,a.y-b.y)>1?1:0)},0),0),overflow:p?.carrierOverflow};});
      results.push({sn,sk,dn,dk,staticSourcePaths:staticS.length,staticTargetPaths:staticD.length,srcSegments:staticS.reduce((n,p)=>n+(p._bezierSegments?.length||0),0),dstSegments:staticD.reduce((n,p)=>n+(p._bezierSegments?.length||0),0),planPathCount:plan?.pathCount,planCubics:plan?.cubicCount,merge:plan?.topologyMergeSplitCount,frames});
    }
    return results;
 })()`,{timeoutMs:38000});console.log(JSON.stringify(r,null,2));}finally{await h.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
