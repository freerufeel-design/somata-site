import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importModule } from './helpers/app-env.mjs';

const modes = ['topology', 'circleSlide', 'fade', 'light', 'phaseCircle', 'coordinated', 'coordinatedFromCenter'];
const phases = [0, 0.001, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 1];

async function setup() {
  const { state } = await importModule('js/core/state.js');
  const { setContourMode } = await importModule('js/geometry/spiral/order-params.js');
  const { buildOrbitPolylines, buildPolygonProfilePathsFromSkeleton } = await importModule('js/geometry/orbit-builder.js');
  const { createGeometryGLRecordingContext } = await importModule('js/render/gl-recording-context.js');
  const { MorphRendering: { drawPreparedMorphGeometry } } = await importModule('js/geometry/morph.js');
  const { GeometryKernel } = await importModule('js/geometry/kernel.js');
  const { renderLayerOrbitPaths } = await importModule('js/render/spiral-stroke.js');
  const { getCachedLayerDrawData } = await importModule('js/effects/motion.js');
  const base = { ...state.layers[0], N: 4, K: 1, radius: 150, rotation: 0, rounding: 0,
    roundingMode: 'standard', profileMode: 'segments', fill: false, chaosStar: false, customSuborbits: null,
    profileNodes: [{ x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 1, y: 0 }] };
  return { base, setContourMode, buildOrbitPolylines, buildPolygonProfilePathsFromSkeleton,
    createGeometryGLRecordingContext, drawPreparedMorphGeometry, GeometryKernel, renderLayerOrbitPaths, getCachedLayerDrawData };
}

test('extended contour: each polygon edge survives all seven morph modes and reaches the recorded GPU stroke', async () => {
  const {base, setContourMode, buildOrbitPolylines, createGeometryGLRecordingContext,
    drawPreparedMorphGeometry, GeometryKernel, renderLayerOrbitPaths, getCachedLayerDrawData} = await setup();
  const runtime = globalThis.SomataMorphRuntime;
  for (const contourMode of ['extended-linear', 'extended-profile']) {
    for (const [N,K] of [[4,1],[5,2],[6,2]]) {
      const a = {...base,N,K}, b = {...a,rotation:35};
      setContourMode(a,contourMode); setContourMode(b,contourMode);
      assert.equal(a.closedLoop,false);
      const fixed = buildOrbitPolylines(a);
      assert.equal(fixed.length,N);
      const staticRec = createGeometryGLRecordingContext(null);
      staticRec.__suppressFill = true;
      renderLayerOrbitPaths(staticRec,a,getCachedLayerDrawData(a));
      const staticMeta=GeometryKernel.inspectStrokeCommands(staticRec.commands);
      assert.equal(staticMeta.pathCount,N);
      assert.equal(staticMeta.closedPathCount,0);
      assert.ok(staticMeta.count>=N);
      assert.equal(buildOrbitPolylines(a,true).reduce((sum,g)=>sum+g.edges.length,0),N);
      for (const mode of modes) {
        const spec = runtime.describe({sourceLayer:a,targetLayer:b,mode});
        for (const t of phases) {
          const f = runtime.samplePrimary(spec,t);
          assert.ok(f,`${contourMode} ${mode} ${t}`);
          const paths = f.paths.filter(p=>(p._alpha??1)>0.001);
          const expected = mode==='fade' ? N*(Number(1-t>0.001)+Number(t>0.001)) : N;
          assert.equal(paths.length,expected,`${contourMode} N${N} ${mode} ${t}`);
          assert.ok(paths.every(p=>p.extendedProfileRail && p.closed===false));
          const rec = createGeometryGLRecordingContext(null);
          rec.__suppressFill = true;
          drawPreparedMorphGeometry(rec,a,paths,t);
          const meta = GeometryKernel.inspectStrokeCommands(rec.commands);
          assert.equal(meta.pathCount,expected,`${contourMode} N${N} ${mode} ${t}: GPU command paths`);
          assert.equal(meta.closedPathCount,0);
          assert.equal(meta.invalidSegments,0);
          assert.ok(meta.count>=expected);
          for(const contour of meta.contours) {
            assert.ok(contour.segmentCount>=1);
            assert.ok(contour.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
          }
        }
      }
    }
  }
});

test('extended contour: an open morph carrier still owns the last-to-first rail', async()=>{
  const {base,setContourMode,buildPolygonProfilePathsFromSkeleton}=await setup();
  const a={...base};setContourMode(a,'extended-linear');
  const points=[{x:0,y:0,id:'a'},{x:100,y:0,id:'b'},{x:100,y:100,id:'c'},{x:0,y:100,id:'d'}];
  const paths=buildPolygonProfilePathsFromSkeleton([{orbitIndex:0,points,closed:false,order:0}],a);
  assert.equal(paths.length,4);
  assert.deepEqual(paths.at(-1).points,[{x:0,y:400},{x:0,y:-300}]);
});

test('ordinary open polygons retain their original open skeleton', async()=>{
  const {base,setContourMode,buildOrbitPolylines}=await setup();
  const a={...base};setContourMode(a,'open');
  const graph=buildOrbitPolylines(a,true)[0];
  assert.equal(graph.closed,false);
  assert.equal(graph.edges.length,3);
  assert.equal(globalThis.SomataSkeletonRuntime.anchors(a)[0].closed,false);
});

test('extended profile: do not discard a repeat start unless it equals the previous endpoint',async()=>{
  const {base,setContourMode,buildOrbitPolylines}=await setup();
  const a={...base,profileNodes:[{x:0,y:.2},{x:.5,y:.3},{x:1,y:-.2}]};
  setContourMode(a,'extended-profile');
  assert.ok(buildOrbitPolylines(a).every(p=>p.points.length===21));
  a.profileNodes=[{x:0,y:0},{x:.5,y:.3},{x:1,y:0}];
  assert.ok(buildOrbitPolylines(a).every(p=>p.points.length===15));
});

// Execute the real renderer's functions against a small fake queue. It models
// writeBuffer taking effect before command submission, without needing WebGPU.
const rendererSource=readFileSync(new URL('../js/gpu/stroke-renderer.js',import.meta.url),'utf8');
function rendererFunction(name) {
  const start=rendererSource.indexOf(`  function ${name}(`);
  assert.ok(start>=0, name);
  const next=rendererSource.indexOf('\n  function ',start+1);
  assert.ok(next>start,name);
  return rendererSource.slice(start,next);
}

test('deferred GPU batch: each layer/role retains its own uniform values before submission',()=>{
  const functions=['getLayerBatchUniformRecord','writeLayerBatchUniform','fillStrokeUniformArray','sameF32Data'];
  const make=new Function(`
    const mainCanvas={width:800,height:600}, layerBatchWidth=800,layerBatchHeight=600,width=800,height=600;
    let layerBatchUniformUploadSkips=0,layerBatchUniformUploads=0,layerBatchUniformUploadBytes=0;
    const pool=new Map(),bindGroupLayout={};
    const device={createBindGroup:opt=>opt,queue:{writeBuffer:(buffer,offset,values)=>buffer.data.set(values)}};
    function getLayerSceneUniformRecord(key) {
      if(!pool.has(key)) pool.set(key,{id:pool.size+1,buffer:{data:new Float32Array(12)},lastData:new Float32Array(12)});
      return pool.get(key);
    }
    ${functions.map(rendererFunction).join('\n')}
    return {getLayerBatchUniformRecord,writeLayerBatchUniform};`);
  const {getLayerBatchUniformRecord:get,writeLayerBatchUniform:write}=make();
  const base={role:'base'},glow={role:'glow'};
  const a=get(base,'0:layer'),b=get(base,'1:layer'),g=get(glow,'0:layer');
  write(a,4,{reuseStatic:true,alphaScale:1});
  write(b,4,{reuseStatic:true,alphaScale:0});
  write(g,2,{reuseStatic:true,alphaScale:.5});
  assert.notEqual(a.uniformBuffer,b.uniformBuffer);
  assert.notEqual(a.uniformBuffer,g.uniformBuffer);
  assert.equal(a.bindGroup.entries[0].resource.buffer.data[6],1);
  assert.equal(b.bindGroup.entries[0].resource.buffer.data[6],0);
  assert.equal(g.bindGroup.entries[0].resource.buffer.data[6],.5);
  assert.equal(get(base,'0:layer'),a);
  assert.equal(write(a,4,{reuseStatic:true,alphaScale:1}),false);
});

test('deferred GPU batch: uncached commands occupy distinct vertex slots in one frame',()=>{
  const make=new Function(`
    const FLOATS_PER_INSTANCE=11, FRAME_RESIDENT_DYNAMIC_RING=2;
    let frameResidentDynamicCursor=0,dynamicUploadBytes=0;
    const frameResidentDynamicSlots=[];
    const device={queue:{writeBuffer:(buffer,offset,raw,byteOffset,bytes)=>buffer.data.set(new Float32Array(raw,byteOffset,bytes/4))}};
    function ensureFrameResidentDynamicSlot(i,count){
      let rec=frameResidentDynamicSlots[i];
      if(!rec) rec=frameResidentDynamicSlots[i]={lastFrameId:0,data:new Float32Array(count*11),buffer:{data:new Float32Array(count*11)}};
      return rec;
    }
    function getBezierSpiralRecord(){return null} function getIndexedMorphFrameRecord(){return null}
    function prepareSharedJoinRecord(){return null} function getFrameResidentDynamicRecord(){return null}
    function countCommandSegments(c){return c.length}
    function commandLineBlendKind(c,k){return k} function commandLineLayerMode(){return 'uniform'}
    function frameResidentDynamicFrameId(){return 7}
    function packGeometryCommands(c,data){data[0]=c[0];return {k:1,blendKind:'max'}}
    ${rendererFunction('acquireFrameResidentDynamicSlot')}
    ${rendererFunction('prepareLayerBatchGeometry')}
    return prepareLayerBatchGeometry;`);
  const prepare=make(), a=prepare([100]),b=prepare([200]),c=prepare([300]);
  assert.notEqual(a.buffer,b.buffer);
  assert.notEqual(a.buffer,c.buffer);
  assert.notEqual(b.buffer,c.buffer);
  assert.deepEqual([a,b,c].map(r=>r.buffer.data[0]),[100,200,300]);
  assert.equal(a.lastFrameId,7);
});
