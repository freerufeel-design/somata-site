import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-env.mjs';

test('both orbit-unfold presets keep physical Corridor copies continuous when unit-size reference changes', async () => {
  await loadApp();
  const { state } = await import('../js/core/state.js');
  const { createLayer } = await import('../js/core/defaults-layers.js');
  const { getTunnelCopies } = await import('../js/corridor/corridor-instances.js');
  const { untwistedUnfoldCorridorCopies } = await import('../js/render/main-pipeline.js');
  const rt = window.SomataMorphRuntime;
  const zero = window.SomataSpiralZeroTransition;
  state.tunnel.active = true;
  state.tunnel.travelPhase = 0;
  state.tunnel.minScale = 0.055;
  state.tunnel.depthCurveMultiplier = 0;
  const raw = getTunnelCopies();
  const pivot = raw._corridorContinuousOriginPosition;
  assert.ok(Number.isFinite(pivot));
  // At this phase a different physical copy becomes the nearest to scale 1.
  const crossing = ((pivot - 0.5) % 1 + 1) % 1;
  const eps = 1e-7;
  let oldMax = 0, newMax = 0, checks = 0;
  const angleDiff = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
  for (const mode of ['seaweed','unfoldUntwisted']) for (const N of [3,4,7]) for (const order of [-1,1]) {
    const layer = {...createLayer(), N, K:1, spiralEnabled:true, spiralOrder:order,
      spiralConstructionMode:mode, spiralTwist:false, spiralClosed:true, closedLoop:false};
    const spec = rt.describe({sourceLayer:layer,targetLayer:layer,mode:'coordinated'});
    const g = rt.samplePrimary(spec,0,{layer});
    const ctx = {layer:{...layer},layerIndex:0};
    assert.ok(rt.publish(ctx,g));
    assert.equal(ctx.layer.__somataUnfoldUntwisted,true);
    const render = (travel, phaseLayer, legacy=false) => {
      state.tunnel.travelPhase=travel;
      const raw=getTunnelCopies();
      const copies=raw.map(c=>({...c}));
      for (const k of Object.keys(raw)) if (!/^\d+$/.test(k)) copies[k]=raw[k];
      if (legacy) delete copies._corridorContinuousOriginPosition;
      const out=untwistedUnfoldCorridorCopies(copies,phaseLayer,copies);
      return new Map(out.map(c=>[c.copyId,c]));
    };
    for (const phase of [null,0.1,0.4,0.8]) {
      const live={...ctx.layer};
      if (phase!==null) zero.applyCorridorFrame(live,mode,0,order,phase,true,layer,layer);
      for (const t of [crossing, crossing-1, 0, 1, -1]) {
        const a=render(t-eps,live),b=render(t+eps,live);
        const oldA=render(t-eps,live,true),oldB=render(t+eps,live,true);
        let common=0;
        for (const [id,p] of a) {
          const q=b.get(id); if (!q) continue;
          common++;
          const diff=angleDiff(p._spiralUntwistedAngle,q._spiralUntwistedAngle);
          newMax=Math.max(newMax,diff);
          assert.ok(diff<1e-5,`${mode} N${N} order ${order} phase ${phase} travel ${t}: ${diff}`);
          assert.ok(Math.abs(Math.log(p.scale/q.scale))<1e-5);
          // Raw Corridor depth opacity may depend on copy position, but
          // the special anchor contribution must never jump.
          assert.ok(Math.abs(p._spiralUnfoldAnchorWeight-q._spiralUnfoldAnchorWeight)<1e-5);
          if (oldA.has(id)&&oldB.has(id)) oldMax=Math.max(oldMax,angleDiff(oldA.get(id)._spiralUntwistedAngle,oldB.get(id)._spiralUntwistedAngle));
        }
        assert.ok(common>2);
        checks++;
      }
    }
  }
  assert.ok(oldMax>0.1,`old discrete pivot did not reproduce jump: ${oldMax}`);
  process.stdout.write(`orbit pivot: ${checks} crossings; old ${oldMax} rad; new ${newMax} rad\n`);
  state.tunnel.active=false;
});

// Compare the actual Bezier curves, not the raw skeleton-like points of
// a rail: after a fillet those two representations are not identical.
function contourPoints(frame) {
  return frame.paths.flatMap(p => p._bezierSegments?.length
    ? p._bezierSegments.flatMap(q => Array.from({length:65}, (_,i) => {
        const t=i/64,z=1-t;
        return {x:z**3*q.p0.x+3*z*z*t*q.c1.x+3*z*t*t*q.c2.x+t**3*q.p3.x,
          y:z**3*q.p0.y+3*z*z*t*q.c1.y+3*z*t*t*q.c2.y+t**3*q.p3.y};
      })) : p.points);
}
function supportDistance(a,b) {
  const p=contourPoints(a),q=contourPoints(b);
  assert.ok(p.length&&q.length);
  const sup=(a,x,y)=>a.reduce((m,v)=>Math.max(m,v.x*x+v.y*y),-Infinity);
  return Math.max(...Array.from({length:128},(_,i)=>{
    const t=i*Math.PI*2/128,x=Math.cos(t),y=Math.sin(t);
    return Math.abs(sup(p,x,y)-sup(q,x,y));
  }));
}

test('rooted single orbit unfold keeps rounded rails on both phase endpoints with changing N/K', async () => {
  await loadApp();
  const {state}=await import('../js/core/state.js');
  const {createLayer}=await import('../js/core/defaults-layers.js');
  const rt=window.SomataMorphRuntime;
  state.tunnel.active=true;
  let max=0,checked=0;
  for (const mode of ['seaweed','unfoldUntwisted']) for (const morph of ['coordinated','circleSlide'])
    for (const rounding of [0,32]) for (const order of [-1,1])
    for (const [N,K,M,L] of [[4,1,5,2],[7,2,3,1],[7,3,5,2],[3,1,7,2],[5,2,7,3]]) {
      const make=(N,K)=>({...createLayer(),N,K,radius:200,spiralEnabled:true,spiralOrder:order,
        spiralConstructionMode:mode,spiralTwist:false,spiralClosed:true,closedLoop:false,rounding,roundingMode:'monoradius'});
      const a=make(N,K),b=make(M,L);
      const opts={order,zeroMode:mode};
      const spec=(x,y)=>rt.describe({sourceLayer:x,targetLayer:y,mode:morph});
      const f=t=>rt.samplePrimary(spec(a,b),t,opts);
      for(const [edge,near,l] of [[0,1e-9,a],[1,1-1e-9,b]]) {
        const end=f(edge),live=f(near),rest=rt.samplePrimary(spec(l,l),0,opts);
        assert.ok(supportDistance(end,rest)<1e-6,`${mode} ${morph} ${N}/${K}→${M}/${L} endpoint ${edge}`);
        const d=supportDistance(live,end);
        max=Math.max(max,d);
        assert.ok(d<0.02,`${mode} ${morph} ${N}/${K}→${M}/${L} order ${order} rounding ${rounding} ${edge}: ${d}`);
        checked++;
      }
    }
  state.tunnel.active=false;
  process.stdout.write(`orbit phase boundaries: ${checked}; max sampled support deviation ${max}\n`);
});
