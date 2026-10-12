'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const defaults=read('js/core/defaults-layers.js');
const appA=read('js/legacy/app-a.js');
const appC=read('js/legacy/app-c.js');
const morph=read('js/geometry/morph.js');
const pipe=read('js/render/main-pipeline.js');
const bridge=read('js/render/lamp-morph-bridge.js');
const spiral=read('js/gpu/spiral-bezier-morph-renderer.js');
const arc=read('js/gpu/morph-arc-resource.js');

// UI / persistence: this is a generic overlap policy, not a Spiral geometry mode.
assert(html.includes('id="lineLayerModeControl"')&&html.includes('Тип наслоения'),'Line overlap control must be generic and labelled Тип наслоения');
assert(html.includes('data-line-layer-mode="uniform"')&&html.includes('>Равномерный</button>'),'Uniform layering option missing');
assert(html.includes('data-line-layer-mode="segmented"')&&html.includes('>Сегментный</button>'),'Segmented layering option missing');
assert(!html.includes('Тип линии спирали'),'Old Spiral-only line-type label must be gone');
assert(defaults.includes("lineLayerMode: 'uniform'")&&defaults.includes("spiralLineType: 'uniform'"),'Generic line layering must default to Uniform while retaining the legacy import alias');
assert(appC.includes("lineLayerMode:(l.lineLayerMode??l.spiralLineType)==='segmented'?'segmented':'uniform'")&&appC.includes("spiralLineType:(l.lineLayerMode??l.spiralLineType)==='segmented'?'segmented':'uniform'"),'Project loading must migrate the old Spiral alias into generic line layering');
assert(appC.includes("document.querySelectorAll('[data-line-layer-mode]')")&&appC.includes('layer.lineLayerMode=mode;layer.spiralLineType=mode'),'Sidebar editing must write generic line layering and preserve legacy export compatibility');
assert(pipe.includes('frameCtx.lineLayerMode=(layer?.lineLayerMode??layer?.spiralLineType)'),'Frame contract must expose one line layering mode to every renderer');
assert(appA.includes("function commandLineLayerMode(commands)")&&appA.includes("if(commandLineLayerMode(commands)==='segmented')"),'Generic GPU stroke backend must bypass MAX shared-join union for Segmented layering');
assert(appA.includes("rec.lineRenderMode==='segmented'?pipelineOver")&&appA.includes("blendKind=rec?.lineRenderMode==='segmented'?'over'"),'Segmented Base/Glow/Morph passes must use source-over accumulation');

// Key and Corners follow the UI contract: Key = logical ends; Corners = Key + bends.
assert(appA.includes('Lamp mode «Ключевое» on a Spiral means ONLY the two ends')&&appA.includes("pushPoint(pts[0],0,'start')")&&appA.includes("pushPoint(pts[pts.length-1],pts.length-1,'end')"),'Spiral Key markers must be logical path endpoints only');
assert(spiral.includes('sourceLampKeyFractions:authoredFlagFractions')&&spiral.includes('sourceCornerFractions:authoredFlagFractions'),'Retained Spiral resource must keep separate Key and Corner metadata');
assert(spiral.includes('cpuPathLampKeyFractions')&&spiral.includes('cpuPathCornerFractions'),'Morph retained rail must publish separate Key/Corner identity resources');
assert(arc.includes('cpuPathLampKeyFractions')&&arc.includes('cpuPathCornerFractions'),'Static retained rail must publish separate Key/Corner identity resources');
assert(bridge.includes("}else if(mode==='key')")&&bridge.includes('const records=morphRec?.cpuPathLampKeyFractions'),'Key lamp mode must use authored Key fractions only');
assert(bridge.includes('const keyFractions=spiralMorphFractionIdentityAtT(morphRec?.cpuPathLampKeyFractions')&&bridge.includes('const bendFractions=spiralMorphFractionIdentityAtT(morphRec?.cpuPathCornerFractions')&&bridge.includes('const merged=[...keyFractions,...bendFractions]'),'Corners must contain every Key endpoint plus logical bend identities');
assert(bridge.includes("if(!points.length&&mode!=='arbitrary')return null"),'Key/Corners special-Spiral modes must never accept an empty identity population; Corners always includes Key endpoints');

// Atomic phase swap: same-frame stale/null Arc decisions must not poison Lamps.
assert(arc.includes('cachedAuthority===currentAuthority')&&arc.includes('currentAuthority=typeof currentGpuBezierResourceForFrame'),'Arc same-frame cache must be authority-aware after retained-rail atomic swap');
assert(arc.includes("getGpuMorphArcResource(frameCtx.layerIndex,frameCtx)"),'Arc lookup must rebuild against the frame-authoritative retained rail');

// Spiral Morph design contract: no seam rephasing, endpoint-exact De Casteljau, one metric per path.
assert(morph.includes('preserveSpiralPhaseEndpoints')&&morph.includes('if (!preserveSpiralPhaseEndpoints)'),'Phase Spiral Morph must preserve the authored open seam/order instead of cyclically rephasing it');
assert(spiral.includes('equalizeCubicRailsByArc')&&spiral.includes('cubicSubsegment'),'Endpoint rails must remain exact and may only be normalized by De Casteljau subdivision');
assert(spiral.includes('crossFamilyCartesianTransport')&&spiral.includes("crossFamily&&(morphType==='phaseCircle'||morphType==='minimalTurn'||morphType==='phase')"),'Spiral↔non-Spiral phase-family Morph must select path-wide Cartesian transport');
assert(spiral.includes('forceCartesianPath')&&spiral.includes('pathCartesianFallback=forceCartesian||forceCartesianPath'),'Cross-family transport must be chosen once for the whole retained path, preventing saws at technical split boundaries');

console.log('Somata 7.3.9 Spiral lamps / line layering / Morph invariants: PASS');
