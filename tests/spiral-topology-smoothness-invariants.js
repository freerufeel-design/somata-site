'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const spiral=read('js/gpu/spiral-bezier-morph-renderer.js');
const pipe=read('js/render/main-pipeline.js');
const appA=read('js/legacy/app-a.js');
const stateJs=read('js/core/state.js');

// Topological Spiral Morph uses exact retained cubics split at technical De Casteljau boundaries.
// Those boundaries are topology bookkeeping, not authored corners, so they must remain G1-smooth
// throughout the interpolation for both Segment and Spline profiles.
assert.ok(spiral.includes('sourceSmooth=select(1.0,0.0,sourceCorner)') &&
          spiral.includes('targetSmooth=select(1.0,0.0,targetCorner)'),
  'Technical retained-cubic cuts must request tangent repair independently of profile mode');
assert.ok(spiral.includes('if(rec.tangentRepairBind&&tangentRepairPipeline&&rec.cubicCount>1)') &&
          !spiral.includes("tangentRepairPipeline&&(rec.sourceSpline===true||rec.targetSpline===true)"),
  'Tangent-repair dispatch must not be limited to Spline-profile endpoints');
assert.ok(spiral.includes('sourceCorner=((pf&0x02000000u)!=0u)||((nf&0x01000000u)!=0u)') &&
          spiral.includes('targetCorner=((pf&0x08000000u)!=0u)||((nf&0x04000000u)!=0u)'),
  'Authored endpoint corners must remain explicit so real bends are not accidentally smoothed');

// Mirror the repair geometry on a deliberately broken internal join and verify G1 continuity.
const unit=(v,f=[1,0])=>{const l=Math.hypot(v[0],v[1]);return l>1e-12?[v[0]/l,v[1]/l]:f;};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const knot=[10,5];
const oldC2=[6,2];
const oldC1=[13,10];
const vin=[knot[0]-oldC2[0],knot[1]-oldC2[1]];
const vout=[oldC1[0]-knot[0],oldC1[1]-knot[1]];
const lin=Math.hypot(...vin),lout=Math.hypot(...vout);
const di=unit(vin),dout=unit(vout,di);
let dir=unit([di[0]+dout[0],di[1]+dout[1]],lout>lin?dout:di);
if(dot(di,dout)<-0.95)dir=lout>lin?dout:di;
const repairedC2=[knot[0]-dir[0]*lin,knot[1]-dir[1]*lin];
const repairedC1=[knot[0]+dir[0]*lout,knot[1]+dir[1]*lout];
const incoming=unit([knot[0]-repairedC2[0],knot[1]-repairedC2[1]]);
const outgoing=unit([repairedC1[0]-knot[0],repairedC1[1]-knot[1]]);
assert.ok(dot(incoming,outgoing)>1-1e-12,
  'Topology repair must make the incoming and outgoing cubic handles collinear at a technical join');

// Corner strength semantics: smooth->smooth is fully repaired, corner->corner is untouched,
// and a corner present at only one endpoint fades continuously across the morph.
const strength=(sourceCorner,targetCorner,t)=>(1-t)*(sourceCorner?0:1)+t*(targetCorner?0:1);
assert.strictEqual(strength(false,false,0.37),1,'A non-authored join must be repaired for the whole morph');
assert.strictEqual(strength(true,true,0.37),0,'An authored corner at both endpoints must remain sharp');
assert.ok(Math.abs(strength(true,false,0.25)-0.25)<1e-12 && Math.abs(strength(false,true,0.25)-0.75)<1e-12,
  'Corner topology changes must blend tangent repair continuously rather than pop');

// hf8: smoothness must come from correct topology/knot placement, not by silently doubling
// the approximation budget. Keep the original 12-step retained-cubic visual rail.
assert.ok(spiral.includes('const SUBDIV=12, ARC_SUBDIV=8') &&
          pipe.includes('visualBezierSubdiv:12') && pipe.includes('unifiedSpiralGpuSubdiv:12'),
  'Spiral visual rail must retain the original 12-step budget');
assert.ok(spiral.includes('fractions=uniqueFractions([0,1,...sm.knots,...dm.knots])') &&
          spiral.includes('const source=splitRailAtFractions(sm,fractions),target=splitRailAtFractions(dm,fractions)') &&
          spiral.includes('function cubicSubsegment(q,a,b)'),
  'Topology equalisation must place technical cuts at the union of source/target arc-length knots and split exact cubics there');

// The user-visible spline point budget remains authoritative (12 by default), and authored spline
// samples are placed by arc length rather than by simply multiplying the number of points.
assert.ok(stateJs.includes('splinePoints: 12') && appA.includes('const targetCount = normalizeSplinePointCount(count)') &&
          appA.includes('const cumulative = [0]') && appA.includes('const d = (i / Math.max(1, targetCount - 1)) * total'),
  'Configured spline point count must stay at 12 by default and samples must be arc-length placed');

assert.ok(pipe.includes('spiralTopologyTechnicalCutTangentRepair:true') && pipe.includes('spiralTangentRepairPreservesAuthoredCorners:true'),
  'Runtime audit must expose the topology-cut tangent repair contract');

console.log('Somata Spiral topology smoothness invariants: PASS (12-step budget; arc-knot placement; G1 technical joins)');
