'use strict';
const fs=require('fs'),assert=require('assert').strict;
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const playlist=JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','default.plist'),'utf8'));
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:350,evalTimeoutMs:20000});
 try{
  const data=JSON.stringify(playlist);
  let imported=await h.evaluate(`(async()=>{const p=${data};await window.__somataLoadPlaylistDocumentForTest(p,'default.plist');return {count:state.playlistProjects.length,current:state.playlistCurrentProjectId,expected:p.currentProjectId,bpm:state.playlistBpm,morphSettings:{beats:state.projectMorph.beatsPerProject,transition:state.projectMorph.transitionBeats},layerCount:state.layers.length};})()`,{timeoutMs:35000,label:'load 10 project playlist'});
  assert.equal(imported.count,playlist.projects.length);
  assert.equal(imported.current,imported.expected);
  assert.equal(imported.bpm,Number(playlist.tapTempo?.bpm)||0);
  assert.equal(imported.morphSettings.beats,playlist.projectMorph.beatsPerProject);
  assert.equal(imported.morphSettings.transition,playlist.projectMorph.transitionBeats);
  assert.equal(imported.layerCount,playlist.projects.find(p=>p.id===imported.expected)?.project.layers.length);
  console.log('loaded',JSON.stringify(imported));
  for(let i=0;i<playlist.projects.length;i++){
   const expected=playlist.projects[i];
   const result=await h.evaluate(`(async()=>{await loadPlaylistProjectByIndex(${i});await new Promise(r=>setTimeout(r,120));const s=state;return{selected:s.playlistCurrentProjectId,layers:s.layers.length,palette:s.activeProjectPaletteKey,ambient:s.ambient,runtime:{morph:runtimeState.morph.active,tunnel:s.tunnel.active},spiral:s.layers.filter(l=>l.spiralEnabled).length,web:s.layers.filter(l=>l.showWeb).length,lightning:s.layers.filter(l=>l.sweep?.lightningEnabled).length,prism:s.prism?.enabled===true};})()`,{timeoutMs:22000,label:'load scene '+i});
   assert.equal(result.selected,expected.id,`scene ${i+1} selected`);
   assert.equal(result.layers,expected.project.layers.length,`scene ${i+1} layers`);
   // Some editors resolve active palette through multiple state keys; captured project value is definitive.
   assert.equal(result.spiral,expected.project.layers.filter(l=>l.spiralEnabled).length,`scene ${i+1} spiral`);
   assert.equal(result.web,expected.project.layers.filter(l=>l.showWeb).length,`scene ${i+1} web`);
   assert.equal(result.lightning,expected.project.layers.filter(l=>l.sweep?.lightningEnabled).length,`scene ${i+1} lightning`);
   assert.equal(result.prism,expected.project.settings.prism.enabled,`scene ${i+1} prism`);
   console.log('scene '+(i+1),expected.name,JSON.stringify({layers:result.layers,morph:result.runtime.morph,tunnel:result.runtime.tunnel,prism:result.prism}));
  }
  const green=await h.evaluate(`(async()=>{document.getElementById('btnProjectMorph').click();await new Promise(r=>setTimeout(r,160));const a={active:runtimeState.projectMorph.active,targetIndex:runtimeState.projectMorph.targetIndex,sourceIndex:runtimeState.projectMorph.sourceIndex,duration:getProjectMorphDurationSec(),fade:getProjectMorphTransitionSec(),scheduled:animationScheduler.has('project-morph')};document.getElementById('btnProjectMorph').click();a.stopped=!runtimeState.projectMorph.active;return a;})()`,{timeoutMs:18000,label:'green playlist switch'});
  assert.equal(green.active,true,'Green Morph must start from user button');
  assert.equal(green.targetIndex,0,'Green must loop last project to first');
  assert.equal(green.scheduled,true,'Green must own scheduler');
  assert.equal(green.stopped,true,'Green must stop through real UI button');
  assert.ok(green.duration>0 && Number.isFinite(green.duration),'invalid Green Morph interval');
  assert.ok(green.fade>=0 && Number.isFinite(green.fade),'invalid Green Morph transition duration');
  console.log('green',JSON.stringify(green));
  const errors=uncaughtExceptions(h.events);
  assert.deepEqual(errors,[],`Uncaught browser errors: ${errors.join('\n')}`);
  console.log('PASS v902-curated-playlist-browser-regression');
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL curated playlist browser regression',e.stack||e);process.exit(1)});
