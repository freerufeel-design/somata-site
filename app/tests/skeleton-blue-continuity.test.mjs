import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from './helpers/app-env.mjs';

test('Blue compatibility phases retain a current skeleton instead of returning an empty guide', async () => {
  const { state, runtimeState } = await importModule('js/core/state.js');
  const overlay = globalThis.SomataSkeletonOverlay, runtime = globalThis.SomataMorphRuntime;
  const base = {...state.layers[0], N:4, K:1, radius:100, rotation:0, spiralOrder:0,
    spiralEnabled:false, closedLoop:true, chaosStar:false, profileMode:'segments', rounding:35,
    profileNodes:[{x:0,y:0},{x:1,y:0}]};
  const sig = paths => paths.map(p=>({closed:p.closed, points:p.points.map(({x,y,id})=>({x,y,id}))}));
  for(let cycle=0;cycle<12;cycle++) {
    const a={...base,N:3+cycle%4,rotation:cycle*11};
    const b={...base,N:4+(cycle+1)%4,rotation:cycle*11+13};
    runtimeState.morph.renderSourceLayers=[a]; runtimeState.morph.renderTargetLayers=[b];
    runtimeState.morph.gpuPhasePrepareSerial=cycle;
    for(const t of [0,.23,.5,.97,1]) {
      const blue={active:true,geometryActive:true,kind:'blue-circle-slide',geometryT:t,mode:'circleSlide'};
      const gp={...blue,sourceLayer:a,targetLayer:b,progress:t,modeOverride:'circleSlide'};
      const f={layerIndex:0,layer:base,geometryProvider:gp,blueMorphProvider:blue};
      const expected=runtime.sampleSkeleton(runtime.fromBlue(0),t,{layer:base,order:0});
      assert.ok(expected.length);
      assert.deepEqual(sig(overlay.framePaths(f)),sig(expected));
      assert.deepEqual(sig(overlay.framePaths({...f,__somataSkeletonFrame:[]})),sig(expected));
      const primary=runtime.samplePrimary(runtime.fromBlue(0),t,{layer:base,order:0});
      assert.equal(overlay.framePaths({...f,__somataSkeletonFrame:primary.skeletonFrame}),primary.skeletonFrame);
    }
  }
});
