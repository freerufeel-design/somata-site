import { geometryEventOrigin } from './geometry-monitor-origin.js';
import { state } from '../core/state.js';
import { SomataFrameContourService } from '../geometry/frame-contour.js';

// Observe the already recorded line, not a second rendering or the skeleton.
// All thresholds are CSS pixels, with coordinates in the layer's local space.
const axes = Array.from({ length: 48 }, (_, i) => [Math.cos(i * Math.PI / 24), Math.sin(i * Math.PI / 24)]);
const round = n => Math.round(n * 1000) / 1000;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const magnitude = a => Math.max(...a.map(Math.abs));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function contourSupport(paths) {
  const support = axes.map(() => -Infinity);
  for (const path of paths) for (const p of path.points || []) {
    if (!finite(p.x) || !finite(p.y)) continue;
    for (let k = 0; k < axes.length; k++) support[k] = Math.max(support[k], p.x * axes[k][0] + p.y * axes[k][1]);
  }
  return finite(support[0]) ? support : null;
}
export function classifyMotion(previous, current, cfg) {
  const dt = current.now - previous.now;
  if (!(dt > 0 && dt <= 100)) return { delta: null, dt, event: null };
  const delta = current.shape.map((v, i) => v - previous.shape[i]);
  const motion = magnitude(delta) * current.scale;
  const changedPhase = current.phase != null && previous.phase != null && current.phase !== previous.phase;
  const nearEnd = finite(previous.progress) && finite(current.progress) &&
    previous.progress >= 0.999 && current.progress >= 0.999 && Math.abs(current.progress - previous.progress) <= 0.0001;
  const nearStart = finite(previous.progress) && finite(current.progress) &&
    previous.progress <= 0.001 && current.progress <= 0.001 && Math.abs(current.progress - previous.progress) <= 0.0001;
  const boundary = changedPhase || nearEnd || nearStart;
  const ratio = Math.max(0.5, Math.min(2, dt / (previous.dt || dt)));
  const expected = previous.delta ? magnitude(previous.delta) * ratio * current.scale : 0;
  const impulse = previous.delta ? magnitude(delta.map((v, i) => v - previous.delta[i] * ratio)) * current.scale : motion;
  const hit = motion >= cfg.teleportPx && (boundary || (previous.delta && impulse >= cfg.teleportPx &&
    (motion > expected * 2.5 || impulse > motion * 1.25)));
  return { delta, dt, event: hit ? {
    type: boundary ? 'PHASE TELEPORT' : 'TELEPORT', motionPx: round(motion), impulsePx: round(impulse),
    expectedPx: round(expected), previousPhase: previous.phase, previousProgress: previous.progress,
    dtMs: round(dt), boundary: changedPhase ? (finite(previous.progress) && previous.progress < 0.99 ? 'phase-restart' : 'phase-change') : nearEnd ? 'phase-end' : nearStart ? 'phase-start' : null,
  } : null };
}
function resample(points, n) {
  const p = [];
  for (const q of points) if (finite(q.x) && finite(q.y) && (!p.length || distance(p.at(-1), q) > 1e-9)) p.push(q);
  if (p.length > 2 && distance(p[0], p.at(-1)) <= 1e-9) p.pop();
  if (p.length < 3) return [];
  const lengths = [0];
  for (let i = 0; i < p.length; i++) lengths.push(lengths[i] + distance(p[i], p[(i+1)%p.length]));
  const total = lengths.at(-1);
  if (!(total > 0)) return [];
  let j = 0;
  return Array.from({length:n}, (_, i) => {
    const d = total * i / n;
    while (j < p.length - 1 && lengths[j+1] <= d) j++;
    const a = p[j], b = p[(j+1)%p.length], t = (d-lengths[j]) / (lengths[j+1]-lengths[j]);
    return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t};
  });
}
export function sharpOutliers(path, scale, cfg) {
  if (!path.closed) return [];
  const p = resample(path.points || [], 512), n = p.length;
  if (!n) return [];
  const radius = p.map(q => Math.hypot(q.x, q.y)), at = i => p[(i+n)%n];
  function turn(i, step) {
    const a=at(i-step), b=at(i), c=at(i+step), ux=b.x-a.x, uy=b.y-a.y, vx=c.x-b.x, vy=c.y-b.y;
    return Math.atan2(Math.abs(ux*vy-uy*vx), ux*vx+uy*vy)*180/Math.PI;
  }
  const peaks=[];
  for(let i=0;i<n;i++) {
    const r=radius[i];
    if (r <= radius[(i+n-1)%n] || r < radius[(i+1)%n]) continue;
    let maximum = true;
    for (let k=1;k<=5;k++) if (radius[(i+k)%n]>r||radius[(i+n-k)%n]>r) {maximum=false;break;}
    if (!maximum) continue;
    let angle=0;
    for(let k=-2;k<=2;k++) {
      const near=turn(i+k,2), far=turn(i+k,6);
      if(near>=cfg.sharpAngle && near>=far*0.65) angle=Math.max(angle,near);
    }
    peaks.push({i,r,angle});
  }
  const vertices=[];
  for(const q of peaks.sort((a,b)=>b.r-a.r)) if(!vertices.some(v=>{const d=Math.abs(v.i-q.i);return Math.min(d,n-d)<12;})) vertices.push(q);
  if(vertices.length<3) return [];
  const result=[];
  for(const v of vertices) {
    if(!v.angle) continue;
    const others=vertices.filter(q=>q!==v).map(q=>q.r).sort((a,b)=>a-b), baseline=others[Math.floor(others.length/2)];
    const excess=(v.r-baseline)*scale;
    if(excess>=cfg.spikePx && v.r>baseline*(1+cfg.spikeRatio)) result.push({excessPx:round(excess), angle:round(v.angle), radius:round(v.r), otherRadius:round(baseline)});
  }
  return result;
}
const config={teleportPx:3,spikePx:3,spikeRatio:0.03,sharpAngle:30};
let enabled=true, previous=null, lastFrame=null, lastLayer=null, started=performance.now(), stats, events, phases, clear;
function reset() {
  previous=null; lastFrame=null; lastLayer=null; started=performance.now(); events=[]; phases=new Set(); clear={spike:3,jump:3};
  stats={frames:0,skipped:0,errors:0,spikes:0,spikeFrames:0,teleports:0,teleportFrames:0,phaseTeleports:0,maxSpikePx:0,maxTeleportPx:0,manualSpikes:0,manualTeleports:0,manualPhaseTeleports:0};
}
reset();
function emit(type, details) {
  const e={type,seconds:round((performance.now()-started)/1000),...details};
  events.push(e); if(events.length>1000) events.shift();
  console.warn('[Somata Geometry Monitor] '+type,e);
}
const nowGap = prev => performance.now()-prev.now;
function gap() { stats.skipped++; previous=null; clear={spike:3,jump:3}; }
function sample(f) {
  if(!enabled || !f?.layer || f.layer.id!==state.activeLayerId) return;
  try {
    if(lastLayer!==f.layer.id) { previous=null; lastFrame=null; lastLayer=f.layer.id; clear={spike:3,jump:3}; }
    if(f.frameId===lastFrame) return;
    lastFrame=f.frameId;
    if(!f.morphFrameActive) { previous=null;clear={spike:3,jump:3};return; }
    if(!f.lineDisplayEnabled || f.lineProfileStrokeOnly || state.tunnel?.active || !(Number(f.layer.rounding)>0)) { gap(); return; }
    const rec=SomataFrameContourService.inspectRecorded(f);
    if(!rec?.paths?.length || rec.paths.some(p=>!p.closed)) { gap(); return; }
    const m=rec.localToScreen;
    const scale=Math.hypot(m?.[0]??1,m?.[1]??0)/Math.max(1,f.frame?.dpr||window.devicePixelRatio||1);
    if(!(scale>0) || !finite(scale)) {gap();return;}
    const shape=contourSupport(rec.paths);
    if(!shape) {gap();return;}
    const clock=window.__somataBlueMorphPhaseClock?.(), phase=clock?.phaseSerial??null;
    if(phase!=null) phases.add(phase);
    const progress=f.geometryProvider?.progress??f.blueMorphProvider?.geometryT??null;
    const anchor = f.layer.roundingCornerType === 'simple' ? window.__somataSimpleAnchorRouteStatus?.()?.last : null;
    const anchorRoute = anchor?.layerId === f.layer.id && finite(progress) && finite(anchor.phase) && Math.abs(anchor.phase-progress)<1e-8 ? anchor.route : null;
    const meta={anchorRoute,layerId:f.layer.id,phase,progress,method:f.layer.roundingCornerType,roundingMode:f.layer.roundingMode,rounding:f.layer.rounding,N:f.layer.N,K:f.layer.K,route:f.geometryPlan?.kind,paths:rec.paths.length};
    if(previous && nowGap(previous)>100) {previous=null;clear={spike:3,jump:3};}
    if(previous && (previous.method!==meta.method || previous.roundingMode!==meta.roundingMode || previous.rounding!==meta.rounding || Math.abs(previous.scale-scale)>0.01*Math.max(1,scale))) {previous=null;clear={spike:3,jump:3};}
    stats.frames++;
    const now=performance.now();
    const current={shape,now,scale,phase,progress,method:meta.method,roundingMode:meta.roundingMode,rounding:meta.rounding,delta:null,dt:0};
    const spikeOrigin=geometryEventOrigin(previous,current);
    if(previous && previous.spikeOrigin!==spikeOrigin.origin) clear.spike=3;
    current.spikeOrigin=spikeOrigin.origin;
    const spikes=rec.paths.flatMap(p=>sharpOutliers(p,scale,config));
    if(spikes.length) {
      stats.spikeFrames++; stats.maxSpikePx=Math.max(stats.maxSpikePx,...spikes.map(s=>s.excessPx));
      if(clear.spike>=3) {stats.spikes++;if(spikeOrigin.origin==='manual') stats.manualSpikes++;emit('SPIKE',{number:stats.spikes,...spikeOrigin,vertices:spikes.slice(0,16),vertexCount:spikes.length,...meta});}
      clear.spike=0;
    } else clear.spike++;
    if(previous) {
      const result=classifyMotion(previous,current,config); current.delta=result.delta;current.dt=result.dt;
      if(result.event) {
        const origin=geometryEventOrigin(previous,current,result.event.boundary);
        if(previous.jumpOrigin!==origin.origin) clear.jump=3;
        current.jumpOrigin=origin.origin;
        stats.teleportFrames++;stats.maxTeleportPx=Math.max(stats.maxTeleportPx,result.event.motionPx);
        if(clear.jump>=3 || (result.event.type==='PHASE TELEPORT' && !previous.boundaryHit)) {
          stats.teleports++;if(result.event.type==='PHASE TELEPORT') stats.phaseTeleports++;
          if(origin.origin==='manual') {stats.manualTeleports++;if(result.event.type==='PHASE TELEPORT') stats.manualPhaseTeleports++;}
          emit(result.event.type,{number:stats.teleports,...origin,...result.event,...meta});
        }
        current.boundaryHit=result.event.type==='PHASE TELEPORT';clear.jump=0;
      } else {clear.jump++;current.jumpOrigin=previous.jumpOrigin;}
    }
    previous=current;
  } catch(e) { stats.errors++;previous=null;if(stats.errors===1) console.warn('[Somata Geometry Monitor] ERROR',String(e?.message||e)); }
}
function report() { return {version:typeof document!=='undefined'?document.title:null,running:enabled,seconds:round((performance.now()-started)/1000),phases:phases.size,...stats,events:events.slice(),config:{...config},notes:'Candidates from recorded CPU line; not GPU pixels. Closed paths, active layer, rounded morph, no Corridor. Last 1000 events retained.'}; }
function summary(){const {events,...r}=report();console.table(r);return r;}
export const SomataGeometryMonitor={config,sample,report,summary,reset,start(){reset();enabled=true;return summary();},stop(){enabled=false;previous=null;return summary();}};
window.SomataGeometryMonitor=SomataGeometryMonitor;
