const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const fs=require('fs');const path=require('path');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){

  const playlist=JSON.parse(fs.readFileSync(path.join(__dirname,'../default.plist'),'utf8'));let dormant=0;
  const walk=x=>{if(Array.isArray(x)){x.forEach(walk);return;}if(!x||typeof x!=='object')return;if(x.web&&typeof x.web==='object'&&Object.prototype.hasOwnProperty.call(x,'showWeb')&&x.showWeb!==true){dormant++;assert(x.web.placementMode==='corners','bundled dormant Web default is not corners');assert(Number(x.web.distance)===60,'bundled dormant Web depth is not 60%');}for(const v of Object.values(x))walk(v);};walk(playlist);assert(dormant>0,'default.plist had no dormant Web configs to verify');
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:15000,loadDelayMs:400});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(async()=>{
      const fresh=createLayer('v783-default-web');ensureLayerEffectState(fresh);
      const defaults={style:fresh.web.style,placementMode:fresh.web.placementMode,distance:fresh.web.distance,uiPlacement:document.getElementById('webPlacementMode')?.value,uiDistance:Number(document.getElementById('webDistance')?.value)};
      Object.assign(fresh,{visible:true,lineVisible:true,N:7,K:2,radius:190,rounding:0,closedLoop:true,fill:true,fillColor:'#334455aa',strokeWidth:3,strokeColor:'#33aaff'});
      fresh.showWeb=false;state.showWeb=false;state.tunnel.active=false;state.layers.splice(0,state.layers.length,fresh);state.activeLayerId=fresh.id;refreshLayerLookup(true);setSingleLayerSelection?.(fresh);syncSidebarInputs();
      const webToggle=document.getElementById('showWeb');webToggle.checked=true;webToggle.dispatchEvent(new Event('change',{bubbles:true}));
      // Regression: corner-mode remains usable when explicitly chosen, although the new default is self-intersection.
      const placementControl=document.getElementById('webPlacementMode');placementControl.value='corners';placementControl.dispatchEvent(new Event('change',{bubbles:true}));
      function probe(now){beginFrameGeometryRuntime();const f=renderRuntime.frame||{};f.now=now;f.id=(Number(f.id)||0)+1;f.dpr=1;const c=prepareMainLayerFrame(f,0);const d=c.effectsPlan?.web?.frameData||prepareLayerFrameWebData(c);const cmds=getFrameWebGPUCommands(c,{frameData:d,paths:d?.paths,tunnelActive:false},'inside');return{enabled:d?.enabled===true,corners:d?.corners?.length||0,commands:cmds?.length||0,subpaths:(cmds||[]).reduce((n,x)=>n+(x?.subpaths?.length||0),0),depth:d?.depthPercent,placement:d?.placementMode,animating:d?.animating===true};}
      const first=probe(1000),second=probe(1016);const uiEnabled=getLayerWebEnabled(fresh)===true;
      // Also probe a rounded shape: corner semantics must remain usable in corner mode.
      fresh.rounding=65;invalidateLayerGeometry(fresh,'v783-web-rounded');const rounded=probe(1032);
      // Real Morph: corner Web must keep producing thread geometry throughout the cycle.
      state.morph.mode='circleSlide';state.morph.intervalSec=3;state.morph.options.byShape=true;state.morph.options.byVertices=true;state.morph.options.bySteps=true;syncSidebarInputs();
      const btn=document.getElementById('btnMorph');if(runtimeState.morph.active)btn.click();btn.click();await new Promise(r=>setTimeout(r,140));
      const morph=[];for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,70));morph.push(probe(performance.now()));}
      if(runtimeState.morph.active)btn.click();
      return{defaults,uiEnabled,first,second,rounded,morph};
    })()`);
    assert(r.uiEnabled,'real showWeb UI change did not enable static Web');
    assert(r.defaults.style==='web','default Web style is not web');
    assert(r.defaults.placementMode==='selfIntersection','new layer default is not self-intersection');
    assert(r.defaults.distance===30,'new layer Web depth is not 30%');
    assert(r.defaults.uiPlacement==='selfIntersection'&&r.defaults.uiDistance===30,'HTML defaults do not match Web defaults');
    for(const [name,q] of Object.entries({first:r.first,second:r.second,rounded:r.rounded})){
      assert(q.enabled,`${name}: Web disabled`);
      assert(q.placement==='corners'&&q.depth===30,`${name}: wrong runtime defaults ${JSON.stringify(q)}`);
      assert(q.corners>0,`${name}: corner mode found no corners`);
      assert(q.commands>0&&q.subpaths>0,`${name}: Web produced no thread geometry on the real first-frame path`);
    }
    assert(Array.isArray(r.morph)&&r.morph.length===8,'Morph probe did not run');
    for(let i=0;i<r.morph.length;i++){const q=r.morph[i];assert(q.enabled!==false,`morph ${i}: Web disabled`);assert(q.corners>0&&q.commands>0&&q.subpaths>0,`morph ${i}: Web disappeared ${JSON.stringify(q)}`);assert(q.placement==='corners'&&q.depth===30,`morph ${i}: defaults drifted`);}
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.11.11 Web self-intersection defaults + explicit corner visibility',r);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 Web defaults regression:',e.stack||e.message);process.exit(1)});
