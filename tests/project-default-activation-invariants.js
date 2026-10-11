'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const state=read('js/core/state.js');
const app=read('js/legacy/app-c.js');
const pipe=read('js/render/main-pipeline.js');
const defaults=JSON.parse(read('default.plist'));

assert.ok(state.includes("tunnel: ['active','raf','phase','travelPhase','lastTime']"),
  'Corridor active must be runtime-only so a saved active snapshot cannot suppress startup registration');
assert.ok(state.includes("tunnel: { active:false, raf:0, phase:0, travelPhase:0, lastTime:0 }"),
  'Corridor runtime must own the active flag');

const setTunnelStart=app.indexOf('        function setTunnelMode(enabled, options = {})');
const setTunnelEnd=app.indexOf('\n        function toggleTunnelMode()',setTunnelStart);
const setTunnel=app.slice(setTunnelStart,setTunnelEnd);
assert.ok(setTunnelStart>=0 && !setTunnel.includes('if (tunnel.active === next) return'),
  'Re-applying Corridor=true must not early-return before scheduler repair');
assert.ok(setTunnel.includes("animationScheduler.add('tunnel', tunnelAnimationFrame)") && setTunnel.includes('const wasActive = tunnel.active === true'),
  'Idempotent Corridor activation must always register its scheduler task without resetting phase unnecessarily');

assert.ok(app.includes('function projectDefaultModeIntent(projectData=null)') && app.includes('function applyProjectDefaultModeIntent(intent'),
  'Project startup modes must have one shared intent/application contract');

const applyStart=app.indexOf("        function applyProjectDefaultModeIntent(intent, reason='project-activate')");
const applyEnd=app.indexOf('\n        let projectDefaultActivationSerial',applyStart);
const applyBody=app.slice(applyStart,applyEnd);
assert.ok(applyBody.indexOf('setTunnelMode(wantsTunnel)')>=0 && applyBody.indexOf('setTunnelMode(wantsTunnel)')<applyBody.indexOf('if (!runtimeState.morph.active) activeStartMorphing();'),
  'Corridor default must be finalized before Blue Morph prepares strict-Spiral GPU resources');
assert.ok(app.includes('function quiesceProjectRuntimeForCommit()') && app.includes("setTunnelMode(false,{silent:true})"),
  'Project boundaries must remove the previous Corridor runtime before installing new project geometry');
assert.ok(!app.includes('active: state.tunnel.active,'),
  'tunnel.active must not be serialized back into project files');
assert.ok(app.includes("function activateProjectDefaultModes(projectData=null, reason='project-activate')") && app.includes("animationScheduler.afterNextPaint('project-default-modes-verify'"),
  'Project startup modes must verify scheduler ownership after the committed project receives its first paint without replaying the geometry contract');
assert.ok(app.includes("activateProjectDefaultModes(null,'project-load')"),
  'Ordinary project loading must use the same post-commit default-mode activator');
assert.ok(app.includes("syncOrangeAndBlueForProject(entry.project)") && app.includes("function syncOrangeAndBlueForProject(projectData) { return activateProjectDefaultModes(projectData,'playlist-project'); }"),
  'Manual playlist project activation must use the same default-mode activator');
assert.ok(app.includes('if(projects.length)await loadPlaylistProjectByIndex'),
  'Opening a playlist must activate its selected/first project through the same project loader');
assert.ok(app.includes("function ensureGreenProjectDefaultModes(projectData) { return applyProjectDefaultModeIntent(projectDefaultModeIntent(projectData),'green-project'); }"),
  'Green project transitions must apply target defaults directly at their atomic commit without a stale deferred retry');

const holy=(defaults.projects||[]).find(p=>p?.name==='Святой')?.project;
assert.ok(holy?.settings?.morph?.defaultActive===true && holy?.settings?.tunnel?.defaultActive===true && holy?.layers?.some(l=>l?.spiralEnabled===true),
  'Factory Святой must start Blue Morph + Corridor and contains a Spiral regression carrier');

const moz=(defaults.projects||[]).find(p=>p?.name==='Мозголом')?.project;
assert.ok(moz?.settings?.morph?.defaultActive===true && moz?.settings?.tunnel?.defaultActive===true,
  'Factory Мозголом must request Morph and Corridor on activation');
assert.ok(['projectDefaultModesPostCommitActivation:true','projectDefaultCorridorBeforeMorph:true','projectCommitQuiescesRuntime:true','projectDefaultPostPaintVerifyOnly:true','tunnelActiveRuntimeOnly:true','tunnelActiveNotSerialized:true'].every(x=>pipe.includes(x)),
  'Runtime audit must expose the atomic project-startup ownership repair');

console.log('Somata 7.3.7 project default activation invariants: PASS');
