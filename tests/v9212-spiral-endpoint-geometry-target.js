const{createBrowserHarness}=require('./lib/browser-harness');const assert=(v,m)=>{if(!v)throw Error(m)};
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:20000});try{
const r=await h.evaluate(`(()=>{const s=createLayer('source-sp');Object.assign(s,{N:7,K:1,spiralEnabled:true,spiralClosed:true,spiralStep:1,spiralStepLinked:false,spiralOrder:1,rotation:45,radius:220,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.3,y:.12},{x:1,y:0}]});const d={...s,id:'target-sp',N:10,K:2,spiralStep:2};state.layers=[s];state.morph.mode='circleSlide';state.morph.spiralMorphType='phaseCircle';runtimeState.morph.active=true;runtimeState.morph.renderSourceLayers=[s];runtimeState.morph.renderTargetLayers=[d];runtimeState.morph.geometryT=1;
const plan=__somataSpiralCarrierMorphPlan(0,1),raw=buildOrbitPolylines(d)||[];const pairs=plan?.paths||[];
const end=(path)=>{const q=path?.[0],r=path?.[path.length-1];return q&&r?{start:q.p0,end:r.p3}:null};
const original=raw.map(path=>{const pts=path?.points||path||[];return {start:pts[0],end:pts[pts.length-1]}}).filter(x=>x.start&&x.end);
const min=(a,b)=>Math.min(...b.map(p=>Math.hypot(a.start.x-p.start.x,a.start.y-p.start.y)+Math.hypot(a.end.x-p.end.x,a.end.y-p.end.y)));
return{paths:pairs.length,original:original.length,maximumMatchError:Math.max(...pairs.map(end).filter(Boolean).map(p=>min(p,original))),preview:original.slice(0,1)}})()`,{timeoutMs:18000,label:'morph target geometry comparison'});
console.log('GEOMETRY TARGET',JSON.stringify(r));assert(r.paths>0&&r.original>0&&Number.isFinite(r.maximumMatchError),'missing geometry');assert(r.maximumMatchError<1e-4,`final morph geometry differs from target ${r.maximumMatchError}`)
}finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exit(1)});
