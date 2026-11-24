import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from './helpers/app-env.mjs';

const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
test('Fourier profile morph does not teleport at midphase', async () => {
  const {state,somataWithFourierLayer}=await importModule('js/core/state.js');
  const {prepareFourierPathList}=await importModule('js/geometry/fourier.js');
  const rt=globalThis.SomataMorphRuntime;
  state.morph.profileModeTransition='phase';
  const base={...state.layers[0], N:5,K:1,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralClosed:true,chaosStar:false,customSuborbits:null,roundingCornerType:'fourier',rounding:100,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.3,y:.5},{x:1,y:0}]};
  const target={...base,profileMode:'spline',splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.24,y:-.3},{x:.7,y:.2},{x:1,y:0}]};
  let max=0;
  for(const order of [0,1,-1,2]) for(const origin of ['manual','blue']) for(const reverse of [false,true]) for(const closed of [false,true]) {
    const a={...(reverse?target:base),spiralEnabled:order!==0,spiralOrder:order,closedLoop:closed,spiralClosed:closed};
    const b={...(reverse?base:target),spiralEnabled:order!==0,spiralOrder:order,closedLoop:closed,spiralClosed:closed};
    const spec=rt.describe({sourceLayer:a,targetLayer:b,mode:order?'coordinated':'circleSlide',origin});
    const frames=[.499999,.500001].map(t=>somataWithFourierLayer(a,()=>{const frame=rt.samplePrimary(spec,t);return {raw:frame.paths,filtered:prepareFourierPathList(frame.paths),skeleton:frame.skeletonFrame};}));
    const [x,y]=frames;
    assert.ok(x.filtered.length);assert.equal(x.filtered.length,y.filtered.length);
    x.filtered.forEach((p,i)=>{const q=y.filtered[i];assert.equal(p.points.length,q.points.length);const d=Math.max(...p.points.map((v,j)=>distance(v,q.points[j])));max=Math.max(max,d);assert.ok(d<.02,`order ${order}, ${origin}, reverse ${reverse}, closed ${closed}: ${d}px`);});
  }
  process.stderr.write(`Maximum midphase displacement: ${max}px\n`);
});

test('Fourier mixed profile uses the same primary skeleton and GPU grid across the transition', async () => {
  const {state,somataWithFourierLayer}=await importModule('js/core/state.js');
  const {prepareGpuFourierRail,buildFourierWavePoints}=await importModule('js/geometry/fourier.js');
  const rt=globalThis.SomataMorphRuntime;
  state.morph.profileModeTransition='phase';
  const base={...state.layers[0],N:4,K:1,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralClosed:true,chaosStar:false,customSuborbits:null,roundingCornerType:'fourier',rounding:100,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.3,y:.5},{x:1,y:0}]};
  const target={...base,N:7,rotation:19,profileMode:'spline',splineRenderMode:'smooth',profileNodes:[{x:0,y:0},{x:.24,y:-.3},{x:.7,y:.2},{x:1,y:0}]};
  const skeleton=paths=>paths.map(p=>({nodes:p.graph?.nodes.map(v=>[v.id,v.x,v.y]),edges:p.graph?.edges.map(e=>[e.from,e.to])}));
  let max=0;
  for(const mode of ['topology','circleSlide','phaseCircle','coordinated','coordinatedFromCenter']) for(const order of [0,1,-1]) {
    const a={...base,spiralEnabled:order!==0,spiralOrder:order};
    const b={...target,spiralEnabled:order!==0,spiralOrder:order};
    const spec=rt.describe({sourceLayer:a,targetLayer:b,mode,origin:'blue'});
    const frames=[.499999,.500001].map(t=>somataWithFourierLayer(a,()=>{
      const frame=rt.samplePrimary(spec,t);
      assert.deepEqual(skeleton(frame.skeletonFrame),skeleton(rt.sampleSkeleton(spec,t)),`${mode}, ${order}: skeleton`);
      return frame.paths.map(p=>({rail:prepareGpuFourierRail(p.points,p.closed),filtered:buildFourierWavePoints(p.points,p.closed)}));
    }));
    const [x,y]=frames;
    assert.equal(x.length,y.length,`${mode} ${order}`);
    x.forEach((p,i)=>{
      const q=y[i];
      if(!p.rail||!q.rail)return;
      const d=Math.max(...p.filtered.map((v,j)=>distance(v,q.filtered[j])));
      const raw=Math.max(...p.rail.base.map((v,j)=>distance(v,q.rail.base[j])));
      max=Math.max(max,d);
      assert.ok(d<.05&&raw<.05,`${mode} ${order}: contour ${d}, GPU input ${raw}`);
    });
  }
  process.stderr.write(`Maximum with N/rotation morph: ${max}px\n`);
});

test('Fourier unequal spline knots and profile timing: no midpoint switch; preserve endpoint shape and radius', async () => {
  const {state,somataWithFourierLayer}=await importModule('js/core/state.js');
  const {buildFourierWavePoints}=await importModule('js/geometry/fourier.js');
  const rt=globalThis.SomataMorphRuntime;
  const a={...state.layers[0],N:5,K:1,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralClosed:true,spiralEnabled:false,spiralOrder:0,chaosStar:false,customSuborbits:null,roundingCornerType:'fourier',rounding:100,profileMode:'spline',profileNodes:[{x:0,y:0},{x:.3,y:.5},{x:1,y:0}]};
  const b={...a,profileNodes:[{x:0,y:0},{x:.24,y:-.3},{x:.7,y:.2},{x:1,y:0}]};
  const render=(a,b,t)=>somataWithFourierLayer(a,()=>rt.samplePrimary(rt.describe({sourceLayer:a,targetLayer:b,mode:'circleSlide',origin:'blue'}),t).paths.map(p=>buildFourierWavePoints(p.points,p.closed)));
  const delta=(x,y)=>Math.max(...x[0].map((p,i)=>distance(p,y[0][i])));
  for(const [timing,pct] of [['phase',100],['start',30],['end',30]]) {
    state.morph.profileModeTransition=timing;state.morph.profileModeTransitionPercent=pct;
    for(const t of [.3,.5,.7])assert.ok(delta(render(a,b,t-1e-6),render(a,b,t+1e-6))<.02);
    for(const [t,near,layer] of [[0,1e-6,a],[1,1-1e-6,b]]){
      const endpoint=render(a,b,t),neighbor=render(a,b,near);
      assert.ok(delta(endpoint,neighbor)<.02);
      assert.ok(delta(endpoint,render(layer,layer,t))<1e-8);
      assert.ok(Math.abs(Math.max(...endpoint[0].map(p=>Math.hypot(p.x,p.y)))-200)<1e-8);
    }
  }
  state.morph.profileModeTransition='phase';
});
