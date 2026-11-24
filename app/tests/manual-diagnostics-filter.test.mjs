import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {importModule} from './helpers/app-env.mjs';
const {observeManualGeometryInput:observe,recentManualGeometryIntent:recent,markManualGeometryRebase:mark,geometryEventOrigin:origin,resetManualGeometryOrigin:reset}=await importModule('js/app/geometry-monitor-origin.js');
const {SomataGeometryMonitor:monitor}=await importModule('js/app/geometry-monitor.js');
const {state}=await importModule('js/core/state.js');
const {SomataFrameContourService:service}=await importModule('js/geometry/frame-contour.js');
const target={id:'paramRounding',closest(sel){return sel.includes('#settingsSidebar')||sel==='input, select, textarea'?this:null;}};
const manualEvent=(extra={})=>({type:'input',isTrusted:true,target,...extra});
const frame=(phase,now)=>({phase,now});
test('only real edits tag candidates; natural boundaries and unrelated phase restarts stay automatic',()=>{
 reset();observe(manualEvent({isTrusted:false}),100,7);assert.equal(recent(101,7),null);
 observe(manualEvent(),100,7);assert.equal(recent(101,7).control,'paramRounding');
 assert.equal(origin(frame(7,100),frame(7,120)).origin,'manual');
 assert.equal(origin(frame(7,100),frame(7,120),'phase-end').origin,'automatic');
 assert.equal(origin(frame(7,100),frame(8,120),'phase-restart').origin,'automatic');
 assert.equal(origin(frame(7,100),frame(7,351)).origin,'automatic');
 mark(recent(120,7),7,8,120);
 assert.equal(origin(frame(7,100),frame(8,140),'phase-restart').origin,'manual');
 mark(recent(140,8),8,9,140);
 assert.equal(origin(frame(7,100),frame(9,150),'phase-restart').origin,'manual');
 assert.equal(origin(frame(9,150),frame(10,170),'phase-change').origin,'automatic');
 reset();
});
test('FPS console hides manual geometry only, keeps history and toggles copyable entries',()=>{
 const native=[];
 const context={console:{warn:(...args)=>native.push(args),error(){},clear(){}},window:{addEventListener(){}},document:{getElementById(){return null;},addEventListener(){},readyState:'loading'},localStorage:{getItem(){return null;}},performance:{now:()=>0}};
 vm.runInNewContext(fs.readFileSync(new URL('../js/bootstrap/error-overlay.js',import.meta.url),'utf8'),context);
 const api=context.window.__somataScreenErrors;
 assert.equal(api.showManual,false);
 context.console.warn('[Somata Geometry Monitor] SPIKE',{origin:'manual',manualControl:'paramRounding'});
 context.console.warn('[Somata Geometry Monitor] PHASE TELEPORT',{origin:'automatic',boundary:'phase-restart'});
 context.console.warn('[Somata Geometry Monitor] TELEPORT',{origin:'manual'});
 context.console.warn('[Somata Performance]',{origin:'manual'});
 context.console.error('real error',{origin:'manual'});
 assert.equal(api.entries.length,3);assert.equal(api.hiddenManualCount,2);
 assert.match(api.entries[0],/phase-restart/);assert.match(api.entries[1],/Performance/);assert.match(api.entries[2],/real error/);
 api.setShowManual(true);assert.equal(api.entries.length,5);assert.match(api.entries[0],/SPIKE/);assert.match(api.entries[2],/TELEPORT/);
 api.setShowManual(false);assert.equal(api.entries.length,3);assert.equal(native.length,4);
 for(let i=0;i<180;i++)context.console.warn('[Somata Geometry Monitor] SPIKE',{origin:'manual',i});
 assert.equal(api.entries.length,3);assert.equal(api.hiddenManualCount,160);
 api.clear();api.setShowManual(true);assert.equal(api.entries.length,0);
});
test('a persistent spike becomes visible again after the manual edit window',()=>{
 const old={active:state.activeLayerId,tunnel:state.tunnel,clock:window.__somataBlueMorphPhaseClock,inspect:service.inspectRecorded,warn:console.warn,performance:globalThis.performance};
 let now=100;const warnings=[];
 try {
  globalThis.performance={now:()=>now};state.activeLayerId='manual-test';state.tunnel={active:false};window.__somataBlueMorphPhaseClock=()=>({phaseSerial:7});service.inspectRecorded=f=>f.contour;console.warn=(...a)=>warnings.push(a);reset();monitor.reset();
  const points=Array.from({length:6},(_,i)=>({x:100*Math.cos(i*Math.PI/3),y:100*Math.sin(i*Math.PI/3)}));points[0]={x:160,y:0};
  const f={frameId:0,layer:{id:'manual-test',roundingCornerType:'simple',roundingMode:'monoradius',rounding:20,N:6,K:1},lineDisplayEnabled:true,morphFrameActive:true,geometryProvider:{progress:.4},contour:{paths:[{points,closed:true}],localToScreen:[1,0]},frame:{dpr:1}};
  observe(manualEvent(),now,7);monitor.sample(f);
  for(let i=0;i<20;i++){now+=16;f.frameId++;f.geometryProvider.progress+=.001;monitor.sample(f);}
  assert.equal(warnings.length,2);assert.equal(warnings[0][1].origin,'manual');assert.equal(warnings[1][1].origin,'automatic');assert.equal(monitor.report().manualSpikes,1);
 }finally{state.activeLayerId=old.active;state.tunnel=old.tunnel;window.__somataBlueMorphPhaseClock=old.clock;service.inspectRecorded=old.inspect;console.warn=old.warn;globalThis.performance=old.performance;reset();monitor.reset();}
});
