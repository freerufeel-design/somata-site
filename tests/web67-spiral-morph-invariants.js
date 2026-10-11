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
assert.ok(corner.includes('total*0.25*frac*dm'),
  'Self-intersection Web must retain the 6.7 quarter-perimeter depth rule');

// Spline Morph must stay continuous at technical De Casteljau equalisation boundaries.
assert.ok(spiral.includes('TANGENT_REPAIR_WGSL') && spiral.includes('segmentMeta[i-1u].z!=segmentMeta[i].z'),
  'Spline tangent repair must only join adjacent cubics inside the same retained path');
assert.ok(spiral.includes('strength=clamp(mix(u.phase.y,u.phase.z,t)') && spiral.includes("sourceSpline:srcLayer?.profileMode==='spline'") && spiral.includes("targetSpline:dstLayer?.profileMode==='spline'"),
  'Intermediate tangent continuity must follow the source/target profile-mode transition');
assert.ok(spiral.includes('repairedC2=knot-dir*lin') && spiral.includes('repairedC1=knot+dir*lout') && spiral.includes('tangentRepairDispatches++'),
  'Spline Morph must repair G1 handles on the canonical current-cubic rail before effects/Fast Rail consume it');

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

assert.ok(['web67NeighbourCornerDepth:true','webCorridorCrosslinksDepthStencilCompatible:true','spiralSplineIntermediateTangentRepair:true','projectDefaultModes67Parity:true'].every(x=>pipe.includes(x)),
  'Runtime audit must expose the 7.3.7 Web/Spiral/default-mode contracts');

console.log('Somata 7.3.7 Web 6.7 / Spiral Morph invariants: PASS');
