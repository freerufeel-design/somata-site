import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from './helpers/app-env.mjs';

const square = [
  { x: -200, y: -200 }, { x: 200, y: -200 },
  { x: 200, y: 200 }, { x: -200, y: 200 },
];
const open = [
  { x: -200, y: 0, widthScale: 0 }, { x: 0, y: 150, widthScale: 0.5 },
  { x: 200, y: -30, widthScale: 2 },
];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function maxDelta(a, b) {
  assert.equal(a.length, b.length);
  return Math.max(...a.map((p, i) => distance(p, b[i])));
}
async function setup() {
  const { somataWithFourierLayer, state } = await importModule('js/core/state.js');
  const { buildFourierWavePoints, prepareFourierPathList } = await importModule('js/geometry/fourier.js');
  const scoped = (strength, run) => somataWithFourierLayer({ roundingCornerType: 'fourier', rounding: 200 - 2 * strength }, run);
  const wave = (points, closed, strength) => scoped(strength, () => buildFourierWavePoints(points, closed));
  return { wave, scoped, state, buildFourierWavePoints, prepareFourierPathList };
}

test('Fourier: sub-percent changes are continuous across all harmonic boundaries', async () => {
  const { wave } = await setup();
  let max = 0;
  // Integer cutoffs and the half-integer thresholds used by the previous implementation.
  const strengths = [0, 0.005, 12.5];
  for (const h of [7, 12, 22]) for (let k = 1; k <= 50; k += 0.5) {
    const v = 50 * Math.pow((k - 1) / (h - 1), 1 / 1.18);
    if (v < 94.99) strengths.push(v);
  }
  for (const [src, closed] of [[square, true], [open, false]]) for (const s of strengths) {
    const a = wave(src, closed, Math.max(0, s - 0.001));
    const b = wave(src, closed, Math.min(95, s + 0.001));
    max = Math.max(max, maxDelta(a, b));
    assert.ok(maxDelta(a, b) < 0.2, `strength ${s}, closed ${closed}`);
  }
  console.log('Maximum displacement for 0.002 percentage-point change:', max, 'px');
});

test('Fourier: duplicates and exact edge subdivisions do not change the geometry', async () => {
  const { wave } = await setup();
  for (const [src, closed] of [[square, true], [open, false]]) {
    const subdivided = src.flatMap((a, i) => {
      if (!closed && i === src.length - 1) return [a, { ...a }];
      const b = src[(i + 1) % src.length];
      return [a, { ...a }, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
        widthScale: ((a.widthScale ?? 1) + (b.widthScale ?? 1)) / 2 }];
    });
    for (const s of [0, 0.01, 12.5, 50, 95]) {
      const a = wave(src, closed, s), b = wave(subdivided, closed, s);
      assert.ok(maxDelta(a, b) < 1e-9);
      assert.ok(a.every((p, i) => Math.abs(p.widthScale - b[i].widthScale) < 1e-9));
    }
  }
});

test('Fourier: a vertex born on an existing edge moves the result continuously', async () => {
  const { wave } = await setup();
  for (const strength of [0, 12.5, 50, 95]) {
    const base = wave(square, true, strength);
    const next = wave([square[0], { x: square[0].x + 0.0001, y: square[0].y - 0.0001 }, ...square.slice(1)], true, strength);
    assert.ok(maxDelta(base, next) < 0.001);
  }
});

test('Fourier: collapsed contours stay collapsed and widths survive at zero strength', async () => {
  const { wave } = await setup();
  const center = { x: 23, y: -14 };
  for (const closed of [false, true]) for (const s of [0, 0.001, 12.5, 50, 95]) {
    const points = Array.from({ length: 5 }, () => ({ ...center }));
    const out = wave(points, closed, s);
    assert.equal(out.length, 288);
    assert.ok(out.every(p => distance(p, center) < 1e-9));
    const tiny = wave(square.map(p => ({x:center.x+p.x*1e-10, y:center.y+p.y*1e-10})), closed, s);
    assert.ok(tiny.every(p => distance(p, center) < 1e-6));
  }
  for (const s of [0, 0.001, 12.5, 50, 95]) {
    const out = wave(open, false, s);
    assert.equal(out[0].widthScale, 0);
    assert.equal(out.at(-1).widthScale, 2);
    if (s >= 12.5) {
      assert.equal(distance(out[0], open[0]), 0);
      assert.equal(distance(out.at(-1), open.at(-1)), 0);
    }
  }
});

test('Fourier: cache tracks exact strength and coordinates/width changes on reused arrays', async () => {
  const { wave } = await setup();
  const points = square.map(p => ({ ...p, widthScale: 1 }));
  const a = wave(points, true, 50);
  assert.equal(wave(points, true, 50), a);
  const b = wave(points, true, 50.0001);
  assert.notEqual(a, b);
  assert.ok(maxDelta(a, b) > 0);
  points[1].widthScale = 2;
  points[2].widthScale = 0; // same total width; previous checksum missed it
  const c = wave(points, true, 50.0001);
  assert.notEqual(b, c);
  assert.ok(c.some((p, i) => p.widthScale !== b[i].widthScale));
  points[0].x += 1e-6;
  const d = wave(points, true, 50.0001);
  assert.notEqual(c, d);
  assert.ok(maxDelta(c, d) > 0);
});

test('Fourier: all seven morph modes produce finite, fixed-size prepared paths', async () => {
  const { scoped, state, prepareFourierPathList } = await setup();
  const a = { ...state.layers[0], N:4, K:1, radius:200, rotation:0, closedLoop:true,
    spiralEnabled:false, spiralOrder:0, roundingCornerType:'fourier', rounding:100,
    profileMode:'segments', profileNodes:[{x:0,y:0},{x:1,y:0}], chaosStar:false, customSuborbits:null };
  const b = { ...a, N:5, rotation:22 };
  const runtime = globalThis.SomataMorphRuntime;
  for (const mode of ['topology','circle','fade','circleSlide','phaseCircle','coordinated','coordinatedFromCenter']) {
    const spec = runtime.describe({ sourceLayer:a, targetLayer:b, mode });
    for (const t of [0, 0.001, .1, .5, .9, .999, 1]) {
      const frame = scoped(50, () => runtime.samplePrimary(spec, t));
      const paths = scoped(50, () => prepareFourierPathList(frame.paths));
      assert.ok(paths.length, `${mode} at ${t}`);
      for (let i = 0; i < paths.length; i++) {
        if (frame.paths[i].points.length < 2) continue;
        assert.equal(paths[i].points.length, 288, `${mode} at ${t}`);
        assert.ok(paths[i].points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
        assert.equal(paths[i].points._fourierPrepared, true);
      }
    }
  }
});

// Point-to-polyline distance compares visible shapes even when the sharp
// transition introduces/removes collinear samples at original vertices.
function distanceToPath(p, path, closed) {
  let min = Infinity;
  for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
    const a = path[i], b = path[(i+1)%path.length];
    const dx=b.x-a.x, dy=b.y-a.y, d=dx*dx+dy*dy;
    const t=d ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)) : 0;
    min=Math.min(min, Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
  }
  return min;
}
function railDelta(a,b,closed) {
  return Math.max(...a.map(p=>distanceToPath(p,b,closed)), ...b.map(p=>distanceToPath(p,a,closed)));
}
test('Unified rounding: exact sharp zero and continuous at zero and at the blend boundary', async () => {
  const { state, buildFourierWavePoints } = await setup();
  const { somataWithFourierLayer } = await importModule('js/core/state.js');
  const src = [{x:0,y:0,widthScale:0},{x:132,y:-21,widthScale:0.7},{x:173,y:195,widthScale:2},{x:30,y:98,widthScale:1}];
  const run=(r,closed)=>somataWithFourierLayer({roundingCornerType:'fourier',rounding:r,fourierStrength:37},()=>{
    assert.equal(state.fourierStrength,100-r/2); // legacy parameter is ignored
    return buildFourierWavePoints(src,closed);
  });
  for (const closed of [true,false]) {
    const zero=run(0,closed);
    assert.deepEqual(zero,src);
    assert.notEqual(zero,src);
    assert.equal(zero._fourierPrepared,true);
    assert.equal(src._fourierPrepared,undefined);
    // Distances from all original vertices and from all near-zero samples.
    for(const r of [0.00001,0.001,0.01]) assert.ok(railDelta(zero,run(r,closed),closed)<0.002,`r=${r}`);
    assert.ok(railDelta(run(9.999,closed),run(10.001,closed),closed)<0.02);
    const full=run(200,closed);
    const radius=Math.hypot(full[0].x-full[144].x, full[0].y-full[144].y)/2;
    assert.ok(radius>0);
  }
});
test('Unified rounding: same filtered coordinates for line, spline, morph and effect rails', async () => {
  const { buildFourierWavePoints, state } = await setup();
  const { somataWithFourierLayer } = await importModule('js/core/state.js');
  const { roundPolylineForDraw } = await importModule('js/geometry/polyline-rounding.js');
  const { splinePathForDraw } = await importModule('js/geometry/spline-rounding.js');
  const { drawMorphPathQuality, roundMorphPolyline } = await importModule('js/geometry/morph.js');
  const { prepareSpiralStrokePoints } = await importModule('js/render/spiral-stroke.js');
  const { prepareWebVisiblePaths } = await importModule('js/effects/web.js');
  const { buildLampRenderedAttachmentPathsUncached } = await importModule('js/lamps/lamp-anchors.js');
  for (const r of [0,0.001,1,9.999,10,50,100,200]) {
    const layer={...state.layers[0],roundingCornerType:'fourier',rounding:r,roundingMode:'monoradius'};
    somataWithFourierLayer(layer,()=>{
      for (const closed of [true,false]) {
        const src=closed?square:open;
        const expected=buildFourierWavePoints(src,closed).map(({x,y})=>({x,y}));
        for (const conventional of [0,0.5,1,2]) {
          for (const draw of [roundPolylineForDraw,splinePathForDraw,roundMorphPolyline,drawMorphPathQuality]) {
            const recorded=[]; let didClose=false;
            const pen={moveTo:(x,y)=>recorded.push({x,y}),lineTo:(x,y)=>recorded.push({x,y}),closePath:()=>{didClose=true;},bezierCurveTo:()=>assert.fail('unexpected additional spline'),quadraticCurveTo:()=>assert.fail('unexpected additional fillet')};
            draw(pen,src,closed,conventional,[]);
            assert.deepEqual(recorded,expected);
            assert.equal(didClose,closed);
          }
        }
        const paths=[{points:src,closed,cornerFlags:src.map(()=>true)}];
        for(const rail of [prepareWebVisiblePaths(paths,layer),buildLampRenderedAttachmentPathsUncached(paths,layer,null,2)])
          assert.deepEqual(rail[0].points.map(({x,y})=>({x,y})),expected);
        if(!closed) assert.deepEqual(prepareSpiralStrokePoints(src,2,[],true,true,layer).map(({x,y})=>({x,y})),expected);
      }
    });
  }
});
test('Unified rounding: unfiltered spiral carrier independent of the rounding value', async () => {
  const { state }=await setup();
  const { buildOrbitPolylines }=await importModule('js/geometry/orbit-builder.js');
  const layer={...state.layers[0],N:4,K:1,radius:200,spiralEnabled:true,spiralOrder:2,spiralClosed:true,spiralTangential:true,profileMode:'segments',profileNodes:[{x:0,y:0},{x:.45,y:.35},{x:1,y:0}],roundingCornerType:'fourier'};
  const coords=r=>buildOrbitPolylines({...layer,rounding:r}).map(p=>p.points.map(({x,y})=>({x,y})));
  const base=coords(0);
  assert.ok(base.length);
  for(const r of [1,50,100,150,200]) assert.deepEqual(coords(r),base);
});
test('Unified rounding: old project and playlist imports migrate once without keeping independent strength', async () => {
  const { migrateFourierProjectData, normalizePlaylistProjectEntry } = await importModule('js/project/project-data.js');
  const old={settings:{fourierPerLayer:true,fourierStrength:42},layers:[{rounding:150,roundingCornerType:'fourier',fourierStrength:25},{rounding:17,roundingCornerType:'classic',fourierStrength:85}]};
  const next=migrateFourierProjectData(old);
  assert.deepEqual(next.layers,[{rounding:150,roundingCornerType:'fourier'},{rounding:17,roundingCornerType:'classic'}]);
  assert.equal(next.settings.fourierStrength,undefined);
  assert.equal(migrateFourierProjectData(next),next);
  assert.equal(old.layers[0].fourierStrength,25);
  const global={settings:{fourierMode:true,fourierStrength:75},layers:[{rounding:17,roundingCornerType:'local'}]};
  const entry=normalizePlaylistProjectEntry({project:global});
  assert.equal(entry.project.layers[0].rounding,50);
  assert.equal(entry.project.layers[0].roundingCornerType,'fourier');
  assert.equal(entry.project.settings.fourierPerLayer,true);
  assert.equal(migrateFourierProjectData(entry.project),entry.project);
});

// Independent reference: the integral of position along the source edges.
function sourceCircle(src, closed) {
  let x=0, y=0, len=0;
  for(let i=0;i<src.length-(closed?0:1);i++) {
    const a=src[i], b=src[(i+1)%src.length], d=distance(a,b);
    x+=(a.x+b.x)*d/2; y+=(a.y+b.y)*d/2; len+=d;
  }
  const center=len?{x:x/len,y:y/len}:src[0];
  return {center,r:Math.max(...src.map(p=>distance(p,center)))};
}
const outerRadius=(path,center)=>Math.max(...path.map(p=>distance(p,center)));
test('Fourier reference diameter: closed contours keep the exact source radius over the entire rounding range', async()=>{
  const {wave}=await setup();
  const shapes=[square,[{x:-61,y:-27},{x:132,y:-21},{x:173,y:195},{x:30,y:98}]];
  for(const n of [3,5,7,11]) for(const step of [1,-1,2]) shapes.push(Array.from({length:n},(_,i)=>({x:31+200*Math.cos(i*step*2*Math.PI/n),y:-19+200*Math.sin(i*step*2*Math.PI/n)})));
  for(const src of shapes) {
    const {center,r}=sourceCircle(src,true);
    for(const rounding of [0,.00001,.01,1,9.999,10,10.001,...Array.from({length:101},(_,i)=>2*i),175,199.999]) {
      const out=wave(src,true,100-rounding/2);
      assert.ok(Math.abs(outerRadius(out,center)-r)<1e-8,`n=${src.length}, R=${rounding}`);
    }
  }
});
test('Fourier reference circle: off-grid vertices and subdivision do not change diameter, open endpoints remain anchored',async()=>{
  const {wave}=await setup();
  const src=[{x:0,y:0},{x:37,y:123},{x:190,y:10},{x:203,y:-17}];
  for(const closed of [true,false]) {
    const {center,r}=sourceCircle(src,closed);
    const full=wave(src,closed,0);
    assert.ok(full.every(p=>Math.abs(distance(p,center)-r)<1e-8));
    const split=src.flatMap((p,i)=>{
      if(!closed&&i===src.length-1)return [p];
      const q=src[(i+1)%src.length];
      return [p,{...p},{x:p.x+.137*(q.x-p.x),y:p.y+.137*(q.y-p.y)}];
    });
    for(const s of [0,1,12.5,50,95]) assert.ok(maxDelta(wave(src,closed,s),wave(split,closed,s))<1e-8);
  }
  for(const s of [12.5,50,95,99.999,100]) {
    const out=wave(src,false,s);
    assert.equal(distance(out[0],src[0]),0);
    assert.equal(distance(out.at(-1),src.at(-1)),0);
  }
});
test('Authored circle: static skeleton, Fourier and viewport share an independent radius',async()=>{
  const {state,buildFourierWavePoints}=await setup();
  const {somataWithFourierLayer}=await importModule('js/core/state.js');
  const {buildOrbitPolylines}=await importModule('js/geometry/orbit-builder.js');
  const {getEffectiveLayerRadius,getFrameReferenceRadius}=await importModule('js/geometry/reference-circle.js');
  // An asymmetric star (and an intentionally off-circle profile) cannot
  // influence the reference radius or move its center.
  const layer={...state.layers[0],N:7,K:3,radius:125,radiusMultiplier:1.6,rotation:17,closedLoop:true,spiralEnabled:false,spiralOrder:0,roundingCornerType:'fourier',profileMode:'segments',profileNodes:[{x:0,y:0},{x:.31,y:.7},{x:1,y:0}],chaosStar:false,customSuborbits:null};
  const R=getEffectiveLayerRadius(layer), origin={x:0,y:0};
  assert.equal(R,200);
  for(const rounding of [0,.001,1,10,50,100,175,200]) {
    const l={...layer,rounding};
    const graphs=buildOrbitPolylines(l,true);
    assert.ok(graphs.length);
    for(const g of graphs) for(const p of g.sourceVertices) assert.ok(Math.abs(distance(p,origin)-R)<1e-9);
    assert.equal(getFrameReferenceRadius({layer:l,combinedScale:1}),R);
    const paths=buildOrbitPolylines(l);
    for(const p of paths) if(p.closed){
      assert.equal(p.points._somataReferenceRadius,R);
      const out=somataWithFourierLayer(l,()=>buildFourierWavePoints(p.points,true));
      if(rounding===0)assert.deepEqual(out,p.points);
      if(rounding>=10)assert.ok(Math.abs(outerRadius(out,origin)-R)<1e-8);
      if(rounding===200)assert.ok(out.every(q=>Math.abs(distance(q,origin)-R)<1e-8));
    }
  }
});
test('Authored circle: a nonuniform angular morph keeps its center and radius through every phase',async()=>{
  const {state,prepareFourierPathList}=await setup();
  const {somataWithFourierLayer}=await importModule('js/core/state.js');
  const {getFrameReferenceRadius}=await importModule('js/geometry/reference-circle.js');
  const a={...state.layers[0],N:4,K:1,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralEnabled:false,spiralOrder:0,roundingCornerType:'fourier',rounding:100,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],chaosStar:false,customSuborbits:null};
  const b={...a,N:7,rotation:39};
  const runtime=globalThis.SomataMorphRuntime, origin={x:0,y:0};
  for(const mode of ['topology','circleSlide','fade','light','phaseCircle','coordinated','coordinatedFromCenter']) {
    const spec=runtime.describe({sourceLayer:a,targetLayer:b,mode});
    for(const t of [0,.001,.1,.5,.9,.999,1]) {
      const frame=somataWithFourierLayer(a,()=>runtime.samplePrimary(spec,t));
      assert.ok(frame?.paths.length);
      const ctx={layer:{...a},combinedScale:.95};
      assert.ok(runtime.publish(ctx,frame));
      assert.equal(getFrameReferenceRadius(ctx),190);
      for(const p of frame.skeletonFrame) for(const q of p.points) {
        const rad=distance(q,origin);
        if(mode==='topology') assert.ok(rad<=200+1e-8); // chord motion intentionally enters the circle
        else assert.ok(Math.abs(rad-200)<1e-8,`${mode}, ${t}, ${rad}`);
      }
      for(const rounding of [0,10,50,175,200]) {
        const l={...ctx.layer,rounding};
        const out=somataWithFourierLayer(l,()=>prepareFourierPathList(frame.paths));
        for(let i=0;i<frame.paths.length;i++) {
          const p=frame.paths[i];
          if(!p.closed||p.points.length<2)continue;
          assert.equal(p.points._somataReferenceRadius,200);
          if(rounding===0)assert.deepEqual(out[i].points,p.points);
          else assert.ok(Math.abs(outerRadius(out[i].points,origin)-200)<1e-7,`${mode}, ${t}, ${rounding}`);
          if(rounding===200)assert.ok(out[i].points.every(q=>Math.abs(distance(q,origin)-200)<1e-7));
        }
      }
    }
  }
});
test('Authored circle: explicit size changes and center-born branches retain their intended radii',async()=>{
  const {state,prepareFourierPathList,buildFourierWavePoints}=await setup();
  const {somataWithFourierLayer}=await importModule('js/core/state.js');
  const {getFrameReferenceRadius}=await importModule('js/geometry/reference-circle.js');
  const a={...state.layers[0],N:5,K:1,radius:200,radiusMultiplier:1,rotation:0,closedLoop:true,spiralEnabled:false,spiralOrder:0,roundingCornerType:'fourier',rounding:200,profileMode:'segments',profileNodes:[{x:0,y:0},{x:1,y:0}],chaosStar:false,customSuborbits:null};
  const runtime=globalThis.SomataMorphRuntime, origin={x:0,y:0};
  const spec=runtime.describe({sourceLayer:a,targetLayer:{...a,N:6,K:2},mode:'coordinatedFromCenter'});
  let born=0;
  for(const t of [.001,.01,.1,.5,.9,.999]){
    const frame=somataWithFourierLayer(a,()=>runtime.samplePrimary(spec,t));
    const out=somataWithFourierLayer(a,()=>prepareFourierPathList(frame.paths));
    frame.paths.forEach((p,i)=>{
      if(!p.closed)return;
      const expected=p.lifecycle?200*p.strokeGrowth:200;
      if(p.lifecycle)born++;
      assert.ok(Math.abs(p.points._somataReferenceRadius-expected)<1e-8);
      assert.ok(Math.abs(outerRadius(out[i].points,origin)-expected)<1e-7);
    });
  }
  assert.ok(born>0);
  const resized=runtime.describe({sourceLayer:a,targetLayer:{...a,N:7,radius:300},mode:'circleSlide'});
  for(const t of [0,.25,.5,1]) {
    const frame=somataWithFourierLayer(a,()=>runtime.samplePrimary(resized,t));
    const ctx={layer:{...a},combinedScale:1}; runtime.publish(ctx,frame);
    assert.equal(getFrameReferenceRadius(ctx),200+100*t);
    for(const p of frame.paths)if(p.closed)assert.equal(p.points._somataReferenceRadius,200+100*t);
  }
  // A reused input array may be filtered by two layers of different sizes.
  const p=[{x:-1,y:-2},{x:3,y:-2},{x:1,y:5}];
  for(const r of [200,250,200]) {
    const out=somataWithFourierLayer({...a,radius:r},()=>buildFourierWavePoints(p,true));
    assert.ok(out.every(q=>Math.abs(distance(q,origin)-r)<1e-8));
  }
});
