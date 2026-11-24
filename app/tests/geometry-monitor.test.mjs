import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {importModule} from './helpers/app-env.mjs';
const {classifyMotion,contourSupport,sharpOutliers,SomataGeometryMonitor:monitor}=await importModule('js/app/geometry-monitor.js');
const {state}=await importModule('js/core/state.js');
const {SomataFrameContourService:service}=await importModule('js/geometry/frame-contour.js');
const cfg={teleportPx:3,spikePx:3,spikeRatio:.03,sharpAngle:30};
const circle=(r=100)=>({closed:true,points:Array.from({length:128},(_,i)=>({x:r*Math.cos(i*Math.PI/64),y:r*Math.sin(i*Math.PI/64)}))});
const frame=(r,progress,phase,now)=>({shape:contourSupport([circle(r)]),progress,phase,now,scale:1,dt:16,delta:Array(48).fill(0)});

test('last frame and first frame jumps are phase events, even before phase serial changes',()=>{
 const old=frame(100,1-1e-9,62,0);
 assert.equal(classifyMotion(old,frame(120,1,62,16),cfg).event.boundary,'phase-end');
 assert.equal(classifyMotion(old,frame(120,0,63,16),cfg).event.boundary,'phase-change');
 assert.equal(classifyMotion(old,frame(100.1,1,62,16),cfg).event,null);
 assert.equal(classifyMotion(old,frame(120,1,62,120),cfg).event,null);
 const p=frame(100,.4,62,0);p.delta=Array(48).fill(2);
 assert.equal(classifyMotion(p,frame(102,.41,62,16),cfg).event,null);
 assert.equal(classifyMotion(p,frame(130,0,63,16),cfg).event.boundary,'phase-restart');
 assert.equal(classifyMotion(p,frame(116,.41,62,16),cfg).event.type,'TELEPORT');
});
test('radial outlier requires a sharp tip, not a regular circle or equal-radius corners',()=>{
 assert.equal(sharpOutliers(circle(),1,cfg).length,0);
 const poly={closed:true,points:Array.from({length:6},(_,i)=>({x:100*Math.cos(i*Math.PI/3),y:100*Math.sin(i*Math.PI/3)}))};
 assert.equal(sharpOutliers(poly,1,cfg).length,0);
 poly.points[0]={x:160,y:0};
 const spikes=sharpOutliers(poly,1,cfg);assert.ok(spikes.some(s=>s.excessPx>40));
 assert.equal(sharpOutliers({...poly,closed:false},1,cfg).length,0);
});
test('sampling reads existing contour, groups repeats, ignores unchanged phase and writes only event warnings',()=>{
 const oldActive=state.activeLayerId,oldTunnel=state.tunnel,oldClock=window.__somataBlueMorphPhaseClock,oldInspect=service.inspectRecorded,oldWarn=console.warn;
 const warnings=[];let phase=62, now=0;const oldPerformance=globalThis.performance;
 try {
  globalThis.performance={now:()=>now};
  state.activeLayerId='monitor';state.tunnel={active:false};window.__somataBlueMorphPhaseClock=()=>({phaseSerial:phase});
  service.inspectRecorded=f=>f.contour;console.warn=(...args)=>warnings.push(args);monitor.reset();
  const f={frameId:0,layer:{id:'monitor',roundingCornerType:'simple',roundingMode:'monoradius',rounding:20,N:6,K:1},lineDisplayEnabled:true,morphFrameActive:true,geometryProvider:{progress:1-1e-9},contour:{paths:[circle()],localToScreen:[1,0]},frame:{dpr:1}};
  monitor.sample(f);monitor.sample(f);assert.equal(monitor.report().frames,1);
  now+=16;f.frameId++;f.geometryProvider.progress=1;f.contour.paths=[circle(120)];monitor.sample(f);
  assert.equal(monitor.report().phaseTeleports,1);assert.equal(warnings[0][0],'[Somata Geometry Monitor] PHASE TELEPORT');assert.equal(warnings[0][1].roundingMode,'monoradius');
  now+=16;f.frameId++;monitor.sample(f);assert.equal(monitor.report().teleports,1);
  now+=16;f.frameId++;f.layer.id='other';monitor.sample(f);assert.equal(monitor.report().frames,3);
  now+=16;f.frameId++;f.layer.id='monitor';f.contour=null;monitor.sample(f);assert.equal(monitor.report().skipped,1);
  assert.equal(monitor.report().errors,0);
 } finally {state.activeLayerId=oldActive;state.tunnel=oldTunnel;window.__somataBlueMorphPhaseClock=oldClock;service.inspectRecorded=oldInspect;console.warn=oldWarn;globalThis.performance=oldPerformance;monitor.reset();}
});
test('in-app console accepts monitor warnings and keeps unrelated warnings filtered',()=>{
 const native=[];
 const context={console:{warn:(...args)=>native.push(args),error(){},clear(){}},window:{addEventListener(){}},document:{getElementById(){return null;},addEventListener(){},readyState:'loading'},localStorage:{getItem(){return null;}},performance:{now:()=>0}};
 vm.runInNewContext(fs.readFileSync(new URL('../js/bootstrap/error-overlay.js',import.meta.url),'utf8'),context);
 context.console.warn('[Somata Geometry Monitor] PHASE TELEPORT',{motionPx:12,phase:62});
 context.console.warn('[Somata Geometry Monitor] SPIKE',{excessPx:15});
 context.console.warn('irrelevant');
 const entries=context.window.__somataScreenErrors.entries;
 assert.equal(native.length,3);assert.equal(entries.length,2);assert.match(entries[0],/geometry.monitor[\s\S]*PHASE TELEPORT/);assert.match(entries[1],/SPIKE/);
});
test('recorded contour inspection does not publish or change the frame',()=>{
 const f={frameId:7,_glStrokeCommandFrameId:7,_glStrokeCommands:[{}],_geometryKernelStrokeView:{contours:[{points:circle().points,closed:true}]},layer:{id:'monitor',spiralEnabled:false},combinedScale:1,combinedRotationRad:0};
 const before=Object.keys(f);const rec=service.inspectRecorded(f);
 assert.ok(rec?.paths?.length);assert.equal(rec.paths[0].closed,true);assert.deepEqual(Object.keys(f),before);assert.equal(f._frameContourRecord,undefined);
 f._glStrokeCommandFrameId=6;assert.equal(service.inspectRecorded(f),null);
});
test('compact arrow controls wrap and the radius checkbox invokes existing change path',()=>{
 const code=fs.readFileSync(new URL('../js/ui/controls/layer-geometry-style.js',import.meta.url),'utf8');
 const binding=code.slice(code.indexOf("  for (const [id, step] of [['roundingPrevMethod'"),code.indexOf("  document.getElementById('paramRoundingMode')?.addEventListener('change'"));
 const mono=code.slice(code.indexOf("  document.getElementById('paramMonoradiusCheck')?.addEventListener('change'"),code.indexOf("  document.getElementById('paramRadius').addEventListener('input'"));
 const controls={},calls=[];const node=id=>controls[id]??=( {addEventListener(type,fn){this[type]=fn;},dispatchEvent(e){calls.push([id,e.type]);}} );
 const select=node('paramRoundingCornerType');select.options=['simple','fourier','local','classic'];select.selectedIndex=0;
 vm.runInNewContext(binding+mono,{document:{getElementById:node},Event:class{constructor(type){this.type=type;}}});
 node('roundingPrevMethod').click();assert.equal(select.selectedIndex,3);
 node('roundingNextMethod').click();assert.equal(select.selectedIndex,0);
 node('roundingNextMethod').click();assert.equal(select.selectedIndex,1);
 const check=node('paramMonoradiusCheck'),radius=node('paramRoundingMode');check.change({target:{checked:true}});assert.equal(radius.value,'monoradius');check.change({target:{checked:false}});assert.equal(radius.value,'standard');
 assert.deepEqual(calls,[['paramRoundingCornerType','change'],['paramRoundingCornerType','change'],['paramRoundingCornerType','change'],['paramRoundingMode','change'],['paramRoundingMode','change']]);
});
