const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function main(){
  const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000,loadDelayMs:350});
  const baseline=uncaughtExceptions(h.events).length;
  try{
    const r=await h.evaluate(`(()=>{
      const l=createLayer('v783-effect-order-feature-scope');
      Object.assign(l,{visible:true,lineVisible:true,N:7,K:2,radius:150,rounding:10,closedLoop:true,fill:true,fillColor:'#224466cc',strokeWidth:3,strokeColor:'#00e0ff'});
      ensureLayerEffectState(l);l.showWeb=true;l.web.style='web';l.web.placementMode='corners';l.web.distance=60;l.web.width=2;l.web.color='#ffffff';
      state.showWeb=true;state.tunnel.active=false;state.layers.splice(0,state.layers.length,l);state.activeLayerId=l.id;refreshLayerLookup(true);beginFrameGeometryRuntime();
      const f=renderRuntime.frame||{};f.now=performance.now();f.id=(Number(f.id)||0)+1;f.dpr=1;
      const c=prepareMainLayerFrame(f,0);
      const outer=SomataEffectStackOrder.plan(c);
      const fillInner=SomataFeatureHost.run('fill',c,child=>SomataEffectStackOrder.plan(child));
      const baseInner=SomataFeatureHost.run('base',c,child=>SomataEffectStackOrder.plan(child));
      return{outer,fillInner,baseInner,fillPlans:(__somataFeatureHostStatus().features.find(x=>x.name==='fill')?.plans||[]),basePlans:(__somataFeatureHostStatus().features.find(x=>x.name==='base')?.plans||[])};
    })()`);
    for(const [name,p] of [['outer',r.outer],['fillInner',r.fillInner],['baseInner',r.baseInner]]){
      assert(p.fillRequested===true,`${name}: Fill not active`);
      assert(p.webActive===true,`${name}: Web disappeared from frame-wide effect-order plan`);
      assert(p.geometryActive===true,`${name}: Geometry not active`);
      assert(p.standaloneFill===true,`${name}: Fill was incorrectly fused with Geometry while Web is active`);
      assert(Array.isArray(p.activeOrder)&&p.activeOrder.indexOf('fill')>=0&&p.activeOrder.indexOf('web')>=0&&p.activeOrder.indexOf('geometry')>=0,`${name}: active order lost Fill/Web/Geometry`);
    }
    // Prove the test really runs through scoped feature plans: Fill itself does not declare Web.
    assert(!r.fillPlans.includes('web'),'test precondition changed: Fill feature now directly sees Web plan');
    assert(!r.basePlans.includes('web'),'test precondition changed: Base feature now directly sees Web plan');
    const exc=uncaughtExceptions(h.events).slice(baseline);assert(exc.length===0,'uncaught browser exceptions: '+exc.join(' | '));
    console.log('PASS 7.8.3 effect-order plan remains frame-wide inside scoped FeatureHost views',r);
  } finally {await h.close();}
}
main().catch(e=>{console.error('FAIL 7.8.3 effect-order FeatureHost scope regression:',e.stack||e.message);process.exit(1)});
