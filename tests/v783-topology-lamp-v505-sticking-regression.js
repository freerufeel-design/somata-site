const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:320,evalTimeoutMs:18000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const setV=(id,v,ev='change')=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.value=String(v);e.dispatchEvent(new Event(ev,{bubbles:true}));};
      const setC=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing '+id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      if(runtimeState.morph.active)document.getElementById('btnMorph')?.click();
      const l=state.layers[0]||createLayer('v505-topology-lamp');state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;
      Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:220,rounding:62,roundingMode:'standard',profileMode:'spline',splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.22,y:.25},{x:.55,y:-.2},{x:.82,y:.17},{x:1,y:0}],showLamps:true});
      const cfg=ensureLayerLampState(l);Object.assign(cfg,{positionMode:'key',morphMotionMode:'linear',snapToContour:true,snapToPolygon:true,stickToRounding:true,calmMode:true});
      invalidateLayerGeometry(l,'v505-lamp-regression');syncSidebarInputs();
      setV('morphMode','topology');setC('morphByVertices',true);setC('morphBySteps',true);setC('morphByRounding',true);
      setV('morphVertexMin',11);setV('morphVertexMax',11);setV('morphStepMin',3);setV('morphStepMax',3);setV('morphRoundingMin',72);setV('morphRoundingMax',72);setV('morphInterval',4,'input');setV('morphInterval',4,'change');
      document.getElementById('btnMorph')?.click();await wait(420);
      beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;
      const c=prepareMainLayerFrame(f,0);c.layerLampConfig=cfg;
      const route=useCanonicalV505TopologyLampAttachment(c);
      const native=prepareGpuMorphLampFrame(c);
      const status=window.__spiroGpuMorphLampBridgeStatus?.()||{};
      const t=Number(c.blueMorphProvider?.geometryT ?? runtimeState.morph.geometryT ?? runtimeState.morph.progress)||0;
      const raw=getLayerFrameAuxiliaryPaths(c);
      const pts=withLampConfig(cfg,()=>collectMorphLampPoints(0,t,260,raw,null));
      const lampRaw=buildCurrentMorphPathsForLamps(0,t);
      const attach=withLampConfig(cfg,()=>buildLampRenderedAttachmentPaths(lampRaw,l,getLampMorphRenderInfo(0,t,l)))||[];
      const segD2=(p,a,b)=>{const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,den=vx*vx+vy*vy;let u=den>1e-12?(wx*vx+wy*vy)/den:0;u=Math.max(0,Math.min(1,u));const dx=p.x-(a.x+vx*u),dy=p.y-(a.y+vy*u);return dx*dx+dy*dy;};
      let maxDist=0,checked=0;
      for(const p of pts){const pi=Number.isInteger(p.pathIndex)?p.pathIndex:-1;const paths=(pi>=0&&attach[pi])?[attach[pi]]:attach;let best=Infinity;for(const path of paths){const a=path?.points||[];if(a.length<2)continue;const n=path.closed?a.length:a.length-1;for(let i=0;i<n;i++)best=Math.min(best,segD2(p,a[i],a[(i+1)%a.length]));}if(Number.isFinite(best)){maxDist=Math.max(maxDist,Math.sqrt(best));checked++;}}
      cfg.snapToContour=false;cfg.snapToPolygon=false;cfg.stickToRounding=false;
      const routeWithoutStick=useCanonicalV505TopologyLampAttachment(c);
      const nativeWithoutStick=prepareGpuMorphLampFrame(c);
      const out={active:runtimeState.morph.active===true,mode:state.morph.mode,route,native:native?{kind:native.gpuLampNativeKind,count:native.attachmentCount}:null,lastReason:status.lastReason,t,points:pts.length,paths:attach.length,checked,maxDist,routeWithoutStick,nativeWithoutStick:nativeWithoutStick?{kind:nativeWithoutStick.gpuLampNativeKind,count:nativeWithoutStick.attachmentCount}:null};
      if(runtimeState.morph.active)document.getElementById('btnMorph')?.click();
      return out;
    })()`,{timeoutMs:14000,label:'v505 topology lamp sticking'});
    assert(r.active&&r.mode==='topology','topology Morph was not active');
    assert(r.route===true,'v505 canonical contour-attachment route was not selected');
    assert(r.native===null,'GPU topology shortcut still bypasses v505 sticking path');
    assert(r.lastReason==='v505-canonical-contour-attachment',`unexpected route reason: ${r.lastReason}`);
    assert(r.points>0&&r.paths>0&&r.checked>0,'canonical topology lamp path produced no attachable lamps');
    assert(r.maxDist<0.05,`topology lamps detached from current rendered rail: max distance ${r.maxDist}`);
    assert(r.routeWithoutStick===false,'v505 compatibility route stayed forced after contour sticking was disabled');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(!exc.length,'uncaught browser errors: '+JSON.stringify(exc));
    console.log('PASS v505 topology lamp sticking restored via canonical current-rail projection',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL v505 topology lamp sticking regression:',e.stack||e.message);process.exit(1)});
