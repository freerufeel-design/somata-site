'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const web=read('js/gpu/web-morph-renderer.js');
const corner=read('js/gpu/web-corner-resource.js');
const spiral=read('js/gpu/spiral-bezier-morph-renderer.js');
const app=read('js/legacy/app-c.js');
const pipe=read('js/render/main-pipeline.js');

// The native Corridor cross-link pipeline runs inside the same pass as stencil-clipped Web.
// WebGPU requires attachment compatibility even though 6.7 cross-links themselves are unclipped.
assert.ok(web.includes("crossDepthStencil={format:'depth24plus-stencil8'") && web.includes("stencilReadMask:0,stencilWriteMask:0"),
  'Corridor cross-link pipeline must declare Depth24PlusStencil8 while ignoring contour stencil');
assert.ok(web.includes('crossCorridorCombined=device.createRenderPipeline') && web.includes('depthStencil:crossDepthStencil'),
  'Native selfIntersectionCorridor pipeline must be attachment-compatible with the Web render pass');

// 6.7 corners contract: depth walks to neighbouring DETECTED corners on the complete contour.
assert.ok(corner.includes('GPU_WEB_CORNER_SPAN_WGSL') && corner.includes('for(var j=0u;j<cornerCount;j=j+1u)') && corner.includes('segmentMeta[sj].z!=pi'),
  'GPU corners mode must compute neighbour spans from the compacted detected-corner list per path');
assert.ok(corner.includes('r.z!=0u||r.w==2u') && corner.includes('before=anchor+(total-maxAnchor)') && corner.includes('after=(total-anchor)+minAnchor'),
  'Closed and periodic Spiral corner depth must wrap by one canonical contour period');
assert.ok(corner.includes('localSpan=max(0.0,cornerState[si].z)') && !corner.includes('min(max(0.0,prevQ.y),max(0.0,q.y))*frac*dm'),
  'Corners depth must not be clamped back to one Arc microsegment');
assert.ok(corner.includes('m.cpuPathCornerFractions||[]') && corner.includes('m.cpuPathKnotFractions||[]') && corner.includes('authoredLogical.add(firstLogical+best)'),
  'Web corner identity must be mapped from authored endpoint corner fractions, not technical equalisation boundaries');
assert.ok(corner.includes('retainedCubics:array<vec4<f32>>') && corner.includes('let cq0=retainedCubics[logical*2u]') && corner.includes('let pq1=retainedCubics[prevLogical*2u+1u]'),
  'Web corner angle classification must use exact retained-cubic endpoint tangents');
assert.ok(corner.includes('indices[slot]=candidates[i]&0x3fffffffu'),
  'Compacted corner indices must strip candidate metadata bits before Arc consumers read them');
assert.ok(corner.includes('ordinaryClosed=r.w==1u') && corner.includes('var localMax=select(spanMax,closedSelfMax,!cornerMode&&ordinaryClosed)'),
  '6.7 quarter-perimeter depth must apply only to ordinary closed contours; open/periodic Spiral must use neighbour-corner span');

// Spiral Morph must stay continuous at technical De Casteljau equalisation boundaries, regardless of profile mode.
assert.ok(spiral.includes('TANGENT_REPAIR_WGSL') && spiral.includes('segmentMeta[i-1u].z!=segmentMeta[i].z'),
  'Topology tangent repair must only join adjacent cubics inside the same retained path');
assert.ok(spiral.includes('sourceCorner=((pf&0x02000000u)!=0u)||((nf&0x01000000u)!=0u)') && spiral.includes('targetCorner=((pf&0x08000000u)!=0u)||((nf&0x04000000u)!=0u)') && spiral.includes('sourceSmooth=select(1.0,0.0,sourceCorner)') && spiral.includes('targetSmooth=select(1.0,0.0,targetCorner)') && spiral.includes('if(rec.tangentRepairBind&&tangentRepairPipeline&&rec.cubicCount>1)'),
  'Intermediate tangent repair must repair every non-authored technical cut while preserving authored Segment corners');
assert.ok(spiral.includes('repairedC2=knot-dir*lin') && spiral.includes('repairedC1=knot+dir*lout') && spiral.includes('tangentRepairDispatches++'),
  'Spiral Morph must repair G1 handles on the canonical current-cubic rail before effects/Fast Rail consume it');
assert.ok(pipe.includes('const liveMorphAuthority=frameCtx.morphFrameActive===true||frameCtx.geometryPlan?.dynamic===true') && pipe.includes('if(liveMorphAuthority&&rec?.specialSpiralBezierRail===true'),
  'A retired Morph Spiral resource must not keep a later static non-Spiral frame in strict-Spiral ownership');

// Project default-mode behaviour is intentionally kept at the known-good 6.7 contract.
assert.ok(app.includes("return projectData?.settings?.morph?.defaultActive === true") && app.includes("return projectData?.settings?.tunnel?.defaultActive === true"),
  'Morph/Tunnel default activation must still be read from project-local defaultActive flags');
const defaultApplyStart=app.indexOf("function applyProjectDefaultModeIntent(intent, reason='project-activate')");
const defaultApplyEnd=app.indexOf('let projectDefaultActivationSerial',defaultApplyStart);
const defaultApply=app.slice(defaultApplyStart,defaultApplyEnd);
assert.ok(defaultApply.includes("if (typeof setTunnelMode === 'function') setTunnelMode(wantsTunnel)") && defaultApply.includes('if (!runtimeState.morph.active) activeStartMorphing()') && defaultApply.indexOf('setTunnelMode(wantsTunnel)')<defaultApply.indexOf('if (!runtimeState.morph.active) activeStartMorphing();'),
  'Project switches must finalize Corridor before Blue Morph prepares the strict-Spiral phase');
assert.ok(app.includes("activateProjectDefaultModes(null,'project-load')") && app.includes("animationScheduler.afterNextPaint('project-default-modes-verify'"),
  'Normal project load must apply saved Corridor/Morph defaults and post-paint verify scheduler ownership without replaying activation');

const defaults=JSON.parse(read('default.plist'));
const brainProject=(defaults.projects||[]).find(p=>p?.name==='Мозголом')?.project;
assert.ok(brainProject?.settings?.morph?.defaultActive===true && brainProject?.settings?.tunnel?.defaultActive===true,
  'Factory Мозголом must still request Morph and Corridor by default');
assert.ok(brainProject?.settings?.minimalMorph?.defaultActive===false,
  'Factory Мозголом Orange/default transition state must remain explicit rather than inheriting runtime state');

assert.ok(['web67NeighbourCornerDepth:true','webAuthoredCornerFractionsOnly:true','webCornerExactCubicTangents:true','webPeriodicSelfIntersectionUsesNeighbourSpan:true','webCorridorCrosslinksDepthStencilCompatible:true','spiralTopologyTechnicalCutTangentRepair:true','spiralTangentRepairPreservesAuthoredCorners:true','strictSpiralStaleMorphResourceNotStaticAuthority:true','projectDefaultModes67Parity:true'].every(x=>pipe.includes(x)),
  'Runtime audit must expose the 7.3.9 Web/Spiral/default-mode contracts');

console.log('Somata 7.3.9 Web 6.7 / Spiral Morph invariants: PASS');
