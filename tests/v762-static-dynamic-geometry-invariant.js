const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};

async function main(){
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:360,evalTimeoutMs:15000});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const out=await h.evaluate(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const canvas=document.getElementById('mainCanvas');
      const capture=()=>{renderMainCanvas();const d=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;return new Uint8ClampedArray(d);};
      const diff=(a,b)=>{let changed=0,sum=0,max=0;for(let i=0;i<a.length;i++){const q=Math.abs(a[i]-b[i]);if(q){changed++;sum+=q;if(q>max)max=q;}}return{changed,sum,max};};
      const l=state.layers[0]||createLayer('v762-invariant');state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;
      Object.assign(l,{visible:true,lineVisible:true,N:10,K:3,radius:220,rotation:0,rounding:0,lineJoinType:'straight',profileMode:'spline',splineRenderMode:'smooth',closedLoop:true,
        profileNodes:[{x:0,y:0},{x:.18,y:.02},{x:.32,y:.20},{x:.50,y:.36},{x:.68,y:.20},{x:.82,y:.02},{x:1,y:0}],spiralEnabled:false,customSuborbits:null,chaosStar:false,
        glow:0,strokeWidth:2,strokeColor:'#ff00aa',opacity:100,fill:false});
      setPreSampledSplineLayer?.(l,false);invalidateLayerGeometry(l,'v762-static-dynamic-invariant');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs();
      if(runtimeState.morph.active)document.getElementById('btnMorph').click();
      state.morph.intervalSec=8;state.morph.options.byShape=true;state.morph.options.byVertices=true;state.morph.options.bySteps=true;state.morph.options.byRounding=false;state.morph.options.bySize=false;state.morph.options.byRotation=false;
      const base=capture();
      const probe=async(mode)=>{
        state.morph.mode=mode;const modeEl=document.getElementById('morphModeTop');if(modeEl){modeEl.value=mode;modeEl.dispatchEvent(new Event('change',{bubbles:true}));}
        document.getElementById('btnMorph').click();await wait(180);
        runtimeState.morph.cycleStart=performance.now()+500;runtimeState.morph.progress=0;runtimeState.morph.geometryT=0;runtimeState.morph.paused=true;
        const frame=capture();const d=diff(base,frame);
        document.getElementById('btnMorph').click();await wait(40);
        return d;
      };
      const fade=await probe('fade');
      const topology=await probe('topology');
      return {fade,topology,w:canvas.width,h:canvas.height,paintErrors:animationScheduler.stats().paintErrors||0};
    })()`,{timeoutMs:12000,label:'7.6.2 static/dynamic geometry invariant'});
    // Exact t=0 must be the same image. A tiny browser compositing tolerance is allowed.
    assert(out.fade.sum<=64,`Fade t=0 differs from static: ${JSON.stringify(out.fade)}`);
    assert(out.topology.sum<=256,`Topology t=0 differs from static: ${JSON.stringify(out.topology)}`);
    assert(out.paintErrors===0,'paint errors: '+out.paintErrors);
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught: '+exc.join(' | '));
    console.log('SOMATA 7.6.2 STATIC/DYNAMIC GEOMETRY INVARIANT: PASS',out);
  }finally{await h.close();}
}
main().catch(e=>{console.error('FAIL 7.6.2 static/dynamic geometry invariant:',e.stack||e.message);process.exit(1)});
