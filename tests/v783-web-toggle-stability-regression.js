const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:22000,loadDelayMs:350});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const l=createLayer('v783-web-toggle');Object.assign(l,{visible:true,lineVisible:true,N:9,K:2,radius:185,rounding:40,closedLoop:true,fill:true,fillColor:'#223355aa',strokeWidth:3,strokeColor:'#44bbff'});ensureLayerEffectState(l);l.showWeb=false;l.web.style='web';l.web.placementMode='corners';l.web.distance=60;state.showWeb=false;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs();
      const cb=document.getElementById('showWeb');
      function probe(tag){beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);const d=c.effectsPlan?.web?.frameData||prepareLayerFrameWebData(c);const cmds=d?.enabled===true?getFrameWebGPUCommands(c,{frameData:d,paths:d.paths,tunnelActive:false},'inside'):null;return{tag,enabled:d?.enabled===true,layer:getLayerWebEnabled(l)===true,corners:d?.corners?.length||0,commands:cmds?.length||0,subpaths:(cmds||[]).reduce((n,x)=>n+(x?.subpaths?.length||0),0),placement:d?.placementMode,depth:d?.depthPercent};}
      const samples=[];
      for(let i=0;i<6;i++){
        cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));samples.push(probe('static-on-'+i));
        cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));samples.push(probe('static-off-'+i));
      }
      state.morph.mode='circleSlide';state.morph.intervalSec=3;state.morph.options.byShape=true;state.morph.options.byVertices=true;state.morph.options.bySteps=true;syncSidebarInputs();
      const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn.click();btn.click();await new Promise(r=>setTimeout(r,120));
      for(let i=0;i<8;i++){
        cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));samples.push(probe('morph-on-'+i));
        await new Promise(r=>setTimeout(r,22));
        cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));samples.push(probe('morph-off-'+i));
        await new Promise(r=>setTimeout(r,18));
      }
      if(runtimeState.morph.active)btn.click();
      cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));samples.push(probe('static-after-morph-on'));
      return{samples,inFrame:renderRuntime?.scheduler?.inFrame===true};
    })()`);
    const ons=r.samples.filter(x=>x.tag.includes('-on'));
    const offs=r.samples.filter(x=>x.tag.includes('-off'));
    assert(ons.length===15,'unexpected ON sample count '+ons.length);
    for(const q of ons){assert(q.layer&&q.enabled,`${q.tag}: Web did not enable immediately`);assert(q.placement==='corners'&&q.depth===60,`${q.tag}: Web defaults drifted ${JSON.stringify(q)}`);assert(q.corners>0,`${q.tag}: no corners on first ON frame`);assert(q.commands>0&&q.subpaths>0,`${q.tag}: no Web threads on first ON frame ${JSON.stringify(q)}`);}
    for(const q of offs){assert(!q.layer&&!q.enabled,`${q.tag}: Web did not disable immediately`);assert(q.commands===0&&q.subpaths===0,`${q.tag}: disabled Web still emitted geometry`);}
    assert(r.inFrame===false,'scheduler left inFrame');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 Web repeated static/Morph ON-OFF stability',{on:ons.length,off:offs.length,last:ons.at(-1)});
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Web toggle stability:',e.stack||e.message);process.exit(1)});
