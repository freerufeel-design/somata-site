const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m);};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:25000,loadDelayMs:250});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      for(const n of ['morph','morph-owner','morph-arm','morph-cycle-boundary','minimalMorph','project-morph','sweep','particles','gpu-path-fx','motion','tunnel'])try{animationScheduler.remove(n)}catch(_){}
      let seed=0x75a11e5>>>0;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const ri=(a,b)=>Math.floor(a+rnd()*(b-a+1));const rf=(a,b)=>a+rnd()*(b-a);
      const gcd=(a,b)=>{a=Math.abs(a);b=Math.abs(b);while(b){const t=a%b;a=b;b=t;}return a||1;};
      const l=createLayer('spiral-web-adversarial');l.visible=true;l.lineVisible=true;l.showWeb=true;l.strokeWidth=2;l.radius=180;l.profileMode='segments';ensureLayerEffectState(l);state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;state.showLines=true;state.showWeb=true;refreshLayerLookup(true);setSingleLayerSelection?.(l);
      const setCheck=(id,v)=>{const e=document.getElementById(id);e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}));};
      const ctx=(now)=>{beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=l;c.effectLayer=l;c.sourceLayer=l;c.staticDrawData=getCachedLayerDrawData(l);c.canonicalGeometry=getCanonicalLayerGeometry(l);c.now=now;c.frame.now=now;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=2;c.baseAlpha=1;c.lineAlpha=1;c.lineDisplayEnabled=true;c.visibleInstances={copies:[{scale:1,depthT:0,index:0}],alphas:[1],particleAlphas:[1]};c.layerSweep=getLayerSweepConfig(l);return c;};
      const render=(branch,now)=>{const d=prepareLayerFrameWebData(ctx(now)),rec=createGeometryGLRecordingContext(mainCtx);drawWebThreadsAnimated(rec,d.paths,l,1,d,true,branch);const vals=[];for(const cmd of rec.commands||[])for(const k of ['x','y','x1','y1','x2','y2','lineWidth','alpha']){const v=Number(cmd?.[k]);if(Number.isFinite(v))vals.push(v);}return{commands:rec.commands?.length||0,corners:d.corners?.length||0,visual:d.visualPaths?.reduce((n,p)=>n+(p?.points?.length||0),0)||0,finite:vals.every(Number.isFinite)};};
      const failures=[],samples=[];let checked=0;
      for(let i=0;i<48;i++){
        l.N=ri(5,29);do{l.K=ri(1,Math.max(1,Math.floor((l.N-1)/2)));}while(gcd(l.N,l.K)!==1);l.customSuborbits=1;l.radius=rf(110,330);l.rotation=ri(-180,180);l.rounding=ri(0,100);l.spiralOrder=ri(-4,4)||1;l.spiralStepLinked=false;l.spiralStep=rf(.5,Math.max(.75,l.K+2));l.spiralTangential=rnd()>.25;l.spiralRoundSeams=rnd()>.25;l.profileMode=rnd()>.45?'spline':'segments';l.profileNodes=[{x:0,y:0},{x:.12,y:rf(-.7,.7)},{x:.35,y:rf(-.7,.7)},{x:.68,y:rf(-.7,.7)},{x:1,y:0}];
        for(const closed of [true,false]){
          l.spiralEnabled=true;l.spiralClosed=closed;l.closedLoop=false;invalidateLayerGeometry(l,'spiral-web-adversarial');
          for(const branch of ['inside','outsideStraight','outsideArc']){
            setCheck('webInside',branch==='inside');setCheck('webOutsideStraight',branch==='outsideStraight');setCheck('webOutsideArc',branch==='outsideArc');
            const out=render(branch,1000+checked);checked++;
            if(!(out.commands>0&&out.corners>0&&out.visual>0&&out.finite))failures.push({i,closed,N:l.N,K:l.K,order:l.spiralOrder,step:l.spiralStep,rounding:l.rounding,profile:l.profileMode,branch,out});
            if(samples.length<8)samples.push({i,closed,N:l.N,K:l.K,branch,out});
          }
        }
      }
      return{checked,failures:failures.slice(0,12),failureCount:failures.length,samples,inFrame:animationScheduler.stats().inFrame};
    })()`);
    assert(r.failureCount===0,`adversarial Spiral/Web lost render commands in ${r.failureCount}/${r.checked} branch cases; first=${JSON.stringify(r.failures[0])}`);
    assert(!r.inFrame,'adversarial Spiral/Web left scheduler inFrame');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('SPIRAL + WEB ADVERSARIAL REGRESSION: PASS',r);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL Spiral/Web adversarial regression:',e.stack||e.message);process.exit(1)});
