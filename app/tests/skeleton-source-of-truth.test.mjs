import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from './helpers/app-env.mjs';

const xy = points => points.map(({x,y}) => ({x,y}));
const graphSignature = graphs => graphs.map(g => ({
  nodes: g.nodes.map(({id,x,y}) => ({id,x,y})),
  edges: g.edges.map(({from,to,kind}) => ({from,to,kind})),
  closed: g.closed,
}));

async function setup() {
  const { state } = await importModule('js/core/state.js');
  const { buildOrbitPolylines, buildPolygonProfilePathsFromSkeleton } = await importModule('js/geometry/orbit-builder.js');
  const { setContourMode } = await importModule('js/geometry/spiral/order-params.js');
  const layer = { ...state.layers[0], N: 4, K: 1, radius: 100, rotation: 0,
    spiralEnabled: false, spiralOrder: 0, spiralClosed: true, closedLoop: true,
    chaosStar: false, extendedProfileEnabled: false, profileMode: 'segments', rounding: 0,
    profileNodes: [{x:0,y:0},{x:1,y:0}] };
  return {layer, buildOrbitPolylines, buildPolygonProfilePathsFromSkeleton, setContourMode};
}

test('a flat contour uses live graph nodes, not stale authored anchors; contour edits cannot move the skeleton', async () => {
  const {layer, buildPolygonProfilePathsFromSkeleton} = await setup();
  const graph = globalThis.SomataSkeletonRuntime.createGraph(0,
    [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}], {connectEdges:true});
  graph.nodes[1].x = 137;
  graph.nodes[2].y = 123;
  const before = graphSignature([graph]);
  const carrier = {orbitIndex:0, points:graph.nodes, graph, closed:true, order:0};
  const [rail] = buildPolygonProfilePathsFromSkeleton([carrier], layer);
  assert.deepEqual(xy(rail.points), xy(graph.nodes));
  assert.notDeepEqual(xy(rail.points), xy(graph.sourceVertices));
  rail.points[1].x += 1000;
  assert.deepEqual(graphSignature([graph]), before);
});

test('extended lines use the actual graph edge, not the original ring coordinates', async () => {
  const {layer, buildPolygonProfilePathsFromSkeleton, setContourMode} = await setup();
  setContourMode(layer,'extended-linear');
  const graph = globalThis.SomataSkeletonRuntime.createGraph(0,
    [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}], {connectEdges:true});
  graph.nodes[1].x = 150;
  const before = graphSignature([graph]);
  const carrier = {orbitIndex:0,points:graph.nodes,graph,closed:true,order:0};
  const rails = buildPolygonProfilePathsFromSkeleton([carrier],layer);
  assert.equal(rails.length,graph.edges.length);
  assert.deepEqual(rails[0].points,[{x:-450,y:0},{x:600,y:0}]);
  assert.ok(rails.every(p => p.closed === false));
  assert.deepEqual(graphSignature([graph]),before);
});

test('static graph topology and positions do not depend on profile, rounding or tangential blend', async () => {
  const {layer,buildOrbitPolylines} = await setup();
  for (const order of [0, -2, -0.4, 0.4, 1, 2]) for (const twist of [false,true]) for (const closed of [false,true]) {
    const base = {...layer,N:6,K:2,spiralOrder:order,spiralEnabled:order!==0,spiralTwist:twist,
      spiralClosed:closed,closedLoop:closed};
    const flat = buildOrbitPolylines(base);
    const original = graphSignature(flat.__somataSkeletonGraphs);
    for (const profileMode of ['segments','spline']) for (const roundingCornerType of ['standard','fourier']) {
      const variant = {...base,profileMode,rounding:60,roundingCornerType,spiralTangential:true,
        profileNodes:[{x:0,y:0},{x:0.4,y:0.3},{x:0.7,y:-0.2},{x:1,y:0}]};
      const paths = buildOrbitPolylines(variant);
      assert.deepEqual(graphSignature(paths.__somataSkeletonGraphs),original,
        `order=${order} twist=${twist} closed=${closed} profile=${profileMode} rounding=${roundingCornerType}`);
    }
  }
});

const frameSignature = paths => paths.map(p => ({closed:p.closed, points:p.points.map(({id,x,y})=>({id,x,y})),
  graph:p.graph?graphSignature([p.graph]):null}));
test('primary morph line consumes the same skeleton as the skeleton-only sampler in all seven modes', async () => {
  const {layer} = await setup();
  const rt = globalThis.SomataMorphRuntime;
  for (const mode of ['topology','circleSlide','fade','light','phaseCircle','coordinated','coordinatedFromCenter']) {
    for (const order of [0,1,-1]) for (const origin of ['manual','blue']) {
      const a = {...layer,spiralOrder:order,spiralEnabled:order!==0,spiralTwist:false};
      const b = {...a,N:5,rotation:23,radius:120};
      const spec = rt.describe({sourceLayer:a,targetLayer:b,mode,origin});
      for (const t of [0.17,0.5,0.83]) {
        const expected = frameSignature(rt.sampleSkeleton(spec,t));
        const actual = rt.samplePrimary(spec,t);
        assert.ok(actual?.paths.length);
        assert.deepEqual(frameSignature(actual.skeletonFrame),expected,`${mode} ${order} ${origin} ${t}`);
      }
    }
  }
});
