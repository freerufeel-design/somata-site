const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:20000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const setV=(id,v,ev='change')=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.value=String(v);e.dispatchEvent(new Event(ev,{bubbles:true}));};
      const setC=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      if(runtimeState.morph.active)document.getElementById('btnMorph')?.click();
      const l=state.layers[0]||createLayer('topology-profile-authority');state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;
      Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:220,rounding:68,roundingMode:'standard',profileMode:'spline',splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.13,y:.42},{x:.31,y:-.34},{x:.52,y:.48},{x:.73,y:-.31},{x:.9,y:.28},{x:1,y:0}],showLamps:true});
      l.particles=normalizeParticleConfig({...l.particles,enabled:true,mode:'flow',density:48,scatter:0});
      const cfg=ensureLayerLampState(l);Object.assign(cfg,{positionMode:'key',morphMotionMode:'linear',snapToContour:true,snapToPolygon:true,stickToRounding:true,calmMode:true});
      invalidateLayerGeometry(l,'topology-profile-authority');syncSidebarInputs();
      setV('morphMode','topology');setC('morphByVertices',true);setC('morphBySteps',true);setC('morphByRounding',true);
      setV('morphVertexMin',11);setV('morphVertexMax',11);setV('morphStepMin',3);setV('morphStepMax',3);setV('morphRoundingMin',75);setV('morphRoundingMax',75);setV('morphInterval',4,'input');setV('morphInterval',4,'change');
      document.getElementById('btnMorph')?.click();await wait(460);
      beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;
      const c=prepareMainLayerFrame(f,0);c.layerLampConfig=cfg;
      const profile=SomataFrameContourService.paths(c)||[];
      const raw=getLayerFrameAuxiliaryPaths(c)||[];
      const t=Number(c.blueMorphProvider?.geometryT ?? runtimeState.morph.geometryT ?? runtimeState.morph.progress)||0;
      const lamps=withLampConfig(cfg,()=>collectMorphLampPoints(0,t,260,raw,profile));
      const particleCarrier=WebGPUParticleRenderer.describeCarrier(c);
      const table=getLayerFrameAuthoritativePathFxTable(c);
      const segD2=(p,a,b)=>{const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,den=vx*vx+vy*vy;let u=den>1e-12?(wx*vx+wy*vy)/den:0;u=Math.max(0,Math.min(1,u));const dx=p.x-(a.x+vx*u),dy=p.y-(a.y+vy*u);return dx*dx+dy*dy;};
      const distToPaths=(p,paths)=>{let best=Infinity;for(const path of paths){const a=path?.points||[];if(a.length<2)continue;const n=path.closed?a.length:a.length-1;for(let i=0;i<n;i++)best=Math.min(best,segD2(p,a[i],a[(i+1)%a.length]));}return Math.sqrt(best);};
      let lampMax=0;for(const p of lamps)lampMax=Math.max(lampMax,distToPaths(p,profile));
      // Prove the old auxiliary rail is not just another name for the visible profile.
      let rawVsProfileMax=0,samples=0;for(const path of profile){const pts=path?.points||[];for(let i=0;i<pts.length;i+=Math.max(1,Math.floor(pts.length/12))){rawVsProfileMax=Math.max(rawVsProfileMax,distToPaths(pts[i],raw));samples++;}}
      let particleEndpointMax=0;const data=table?.gpuSegmentData||[];for(let i=0;i<Math.min(Number(table?.segmentCount)||0,80);i++){const o=i*8;particleEndpointMax=Math.max(particleEndpointMax,distToPaths({x:data[o],y:data[o+1]},profile),distToPaths({x:data[o+2],y:data[o+3]},profile));}
      const out={active:runtimeState.morph.active===true,mode:state.morph.mode,profilePaths:profile.length,rawPaths:raw.length,lamps:lamps.length,lampMax,rawVsProfileMax,samples,particleCarrier,particleSegments:Number(table?.segmentCount)||0,particleEndpointMax,route:useCanonicalV505TopologyLampAttachment(c),sharedRoute:useTopologyVisualProfileRail(c)};
      if(runtimeState.morph.active)document.getElementById('btnMorph')?.click();
      return out;
    })()`,{timeoutMs:16000,label:'topology profile attachment authority'});
    assert(r.active&&r.mode==='topology','topology Morph was not active');
    assert(r.sharedRoute===true&&r.route===true,'authoritative topology profile rail route was not selected');
    assert(r.profilePaths>0&&r.rawPaths>0,'missing profile/raw paths');
    assert(r.rawVsProfileMax>0.5,`test profile does not distinguish visible FrameContour from old auxiliary rail: ${r.rawVsProfileMax}`);
    assert(r.lamps>0&&r.lampMax<0.05,`lamps are not attached to actual FrameContour profile: ${r.lampMax}`);
    assert(r.particleCarrier?.kind==='frame-contour-profile',`particles still use wrong carrier: ${JSON.stringify(r.particleCarrier)}`);
    assert(r.particleSegments>0&&r.particleEndpointMax<0.001,`particle segments do not come from FrameContour profile: ${r.particleEndpointMax}`);
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(!exc.length,'uncaught browser errors: '+JSON.stringify(exc));
    console.log('PASS topology Lamps + Particles share actual FrameContour profile rail',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL topology profile attachment authority regression:',e.stack||e.message);process.exit(1)});
