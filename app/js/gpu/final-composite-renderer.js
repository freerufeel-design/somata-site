// WebGPU: финальная композиция.
import '../render/backend-telemetry.js'; // initialisation order: this module runs after it
import { normalizeLightningBehaviorValue } from '../effects/lightning-exact.js';
import { getLayerSweepConfig } from '../core/defaults-layers.js';
import { gridPatternEl, mainContainerEl, renderRuntime } from '../core/render-runtime.js';
import { performanceGovernor, renderPerf, requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { getMotionViewportTransform } from '../effects/motion.js';
import { LampGPURenderer } from './lamp-renderer.js';
import { notifyFrameSceneEffectCommandsSubmitted } from '../render/gpu-command-scheduler.js';
import {
  clearLayerSceneEffectCommands,
  notifyLayerSceneEffectCommandsSubmitted,
  peekLayerSceneEffectCommands,
} from '../render/layer-scene-service.js';
import { finalGpuCanvas, mainCanvas, sceneBlendCanvas } from '../ui/profile-presets.js';
import { normalizeSceneBlendState } from '../ui/viewport-background.js';
import { WebGPUDeviceHub } from './device-hub.js';
import { GPUColorCache, assertWebGPUShaderModule } from './gpu-utils.js';
import {
  frameGraphPerformanceRuntime,
  knownFrameGraphCanvasRisk,
  renderBackendTelemetry,
} from '../render/backend-telemetry.js';
import { WebGPUStrokeRenderer } from './stroke-renderer.js';
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUFinalCompositeRenderer = (() => {
  let device = null,
    context = null,
    format = null,
    pipeline = null,
    textureOverPipeline = null,
    lampBlendPipeline = null,
    sampler = null,
    uniformBuffer = null,
    lampBlendUniformBuffer = null;
  let sceneTexture = null,
    bgTexture = null,
    dummyBgTexture = null,
    dummyLampTexture = null,
    dummyLayerTexture = null,
    lampBlendScratchTexture = null,
    lampBlendScratchView = null,
    bindGroup = null,
    boundBgTexture = null,
    boundLampTexture = null,
    boundLayerTexture = null,
    boundUnderlayTexture = null,
    boundSceneTexture = null,
    textureOverBindGroups = new WeakMap(),
    lampBlendBindGroups = new WeakMap();

  let finalRenderBundle = null,
    finalRenderBundleList = [],
    finalBundleBuilds = 0,
    finalBundleExecutes = 0;
  let ready = false,
    attempted = false,
    initializing = false,
    lost = false,
    lastError = '',
    lastInitError = '',
    retryCount = 0,
    hubGeneration = 0;
  let width = 0,
    height = 0,
    bgWidth = 0,
    bgHeight = 0,
    submissions = 0,
    sceneUploads = 0,
    sceneUploadSkips = 0,
    bgUploads = 0,
    frames = 0,
    lampDirectFrames = 0,
    layerDirectFrames = 0,
    underlayDirectFrames = 0,
    mergedLampSubmissions = 0;
  let bgKey = '',
    bgImage = null,
    bgLoadingKey = '',
    bgLoadToken = 0;
  const uniformData = new Float32Array(16),
    uniformLast = new Float32Array(16),
    frameCommandScratch = [];
  let uniformHasLast = false,
    uniformUploads = 0,
    uniformUploadSkips = 0,
    mergedFrameCommandBuffers = 0;

  let gpuTimerSlots = [],
    gpuTimerCursor = 0,
    gpuTimerGeneration = 0,
    gpuTimingSamples = 0,
    gpuTimingMisses = 0,
    gpuTimingLastMs = 0,
    gpuTimingEmaMs = 0,
    gpuTimingDisabledReason = '';
  let GPU_TIMING_INTERVAL = 24;
  const modeCode = Object.freeze({
    normal: 0,
    darken: 1,
    multiply: 2,
    'color-burn': 3,
    lighten: 4,
    screen: 5,
    'color-dodge': 6,
    'plus-lighter': 7,
    overlay: 8,
    'soft-light': 9,
    'hard-light': 10,
    difference: 11,
    exclusion: 12,
    hue: 13,
    saturation: 14,
    color: 15,
    luminosity: 16,
  });
  const lampBlendCode = Object.freeze({
    'source-over': 0,
    lighter: 7,
    screen: 5,
    'color-dodge': 6,
    difference: 11,
    color: 15,
  });
  function normalizedLampBlend(value) {
    const v = String(value || 'lighter').toLowerCase();
    if (v === 'normal') return 'source-over';
    if (v === 'add' || v === 'plus-lighter' || v === 'linear-dodge') return 'lighter';
    if (v === 'inverted' || v === 'invert') return 'difference';
    return Object.prototype.hasOwnProperty.call(lampBlendCode, v) ? v : 'lighter';
  }
  const WGSL = `
struct U {
    a: vec4<f32>, 
    b: vec4<f32>, 
    c: vec4<f32>, 
    d: vec4<f32>, 
};
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var bgTex: texture_2d<f32>;
@group(0) @binding(2) var lampTex: texture_2d<f32>;
@group(0) @binding(3) var layerTex: texture_2d<f32>;
@group(0) @binding(4) var underlayTex: texture_2d<f32>;
@group(0) @binding(5) var samp: sampler;
@group(0) @binding(6) var<uniform> u: U;
struct V { @builtin(position) p: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vsMain(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn lum(c:vec3<f32>)->f32{return dot(c,vec3<f32>(0.3,0.59,0.11));}
fn sat(c:vec3<f32>)->f32{return max(max(c.r,c.g),c.b)-min(min(c.r,c.g),c.b);}
fn clipColor(c0:vec3<f32>)->vec3<f32>{
    var c=c0;let l=lum(c);let n=min(min(c.r,c.g),c.b);let x=max(max(c.r,c.g),c.b);
    if(n<0.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*(l/max(0.000001,l-n));}
    let x2=max(max(c.r,c.g),c.b);
    if(x2>1.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*((1.0-l)/max(0.000001,x2-l));}
    return clamp(c,vec3<f32>(0.0),vec3<f32>(1.0));
}
fn setLum(c:vec3<f32>,l:f32)->vec3<f32>{return clipColor(c+vec3<f32>(l-lum(c)));}
fn setSat(c:vec3<f32>,s:f32)->vec3<f32>{
    let mn=min(min(c.r,c.g),c.b);let mx=max(max(c.r,c.g),c.b);let d=mx-mn;
    if(d<0.000001){return vec3<f32>(0.0);}
    return (c-vec3<f32>(mn))*(s/d);
}
fn softChannel(b:f32,s:f32)->f32{
    if(s<=0.5){return b-(1.0-2.0*s)*b*(1.0-b);}
    var d=sqrt(max(0.0,b));if(b<=0.25){d=((16.0*b-12.0)*b+4.0)*b;}
    return b+(2.0*s-1.0)*(d-b);
}
fn blend(b:vec3<f32>,s:vec3<f32>,m:i32)->vec3<f32>{
    if(m==0){return s;} if(m==1){return min(b,s);} if(m==2){return b*s;}
    if(m==3){return vec3<f32>(select(1.0-min(1.0,(1.0-b.r)/max(0.000001,s.r)),0.0,s.r<=0.000001),select(1.0-min(1.0,(1.0-b.g)/max(0.000001,s.g)),0.0,s.g<=0.000001),select(1.0-min(1.0,(1.0-b.b)/max(0.000001,s.b)),0.0,s.b<=0.000001));}
    if(m==4){return max(b,s);} if(m==5){return b+s-b*s;}
    if(m==6){return vec3<f32>(select(min(1.0,b.r/max(0.000001,1.0-s.r)),1.0,s.r>=0.999999),select(min(1.0,b.g/max(0.000001,1.0-s.g)),1.0,s.g>=0.999999),select(min(1.0,b.b/max(0.000001,1.0-s.b)),1.0,s.b>=0.999999));}
    if(m==7){return min(vec3<f32>(1.0),b+s);}
    if(m==8){return vec3<f32>(select(2.0*b.r*s.r,1.0-2.0*(1.0-b.r)*(1.0-s.r),b.r>0.5),select(2.0*b.g*s.g,1.0-2.0*(1.0-b.g)*(1.0-s.g),b.g>0.5),select(2.0*b.b*s.b,1.0-2.0*(1.0-b.b)*(1.0-s.b),b.b>0.5));}
    if(m==9){return vec3<f32>(softChannel(b.r,s.r),softChannel(b.g,s.g),softChannel(b.b,s.b));}
    if(m==10){return vec3<f32>(select(2.0*b.r*s.r,1.0-2.0*(1.0-b.r)*(1.0-s.r),s.r>0.5),select(2.0*b.g*s.g,1.0-2.0*(1.0-b.g)*(1.0-s.g),s.g>0.5),select(2.0*b.b*s.b,1.0-2.0*(1.0-b.b)*(1.0-s.b),s.b>0.5));}
    if(m==11){return abs(b-s);} if(m==12){return b+s-2.0*b*s;}
    if(m==13){return setLum(setSat(s,sat(b)),lum(b));}
    if(m==14){return setLum(setSat(b,sat(s)),lum(b));}
    if(m==15){return setLum(s,lum(b));}
    return setLum(b,lum(s));
}
fn compositeLamp(dst:vec4<f32>,src:vec4<f32>,m:i32)->vec4<f32>{
    let asrc=clamp(src.a,0.0,1.0);let adst=clamp(dst.a,0.0,1.0);
    if(asrc<=0.000001){return dst;}
    let cs=clamp(src.rgb,vec3<f32>(0.0),vec3<f32>(1.0));let cb=clamp(dst.rgb,vec3<f32>(0.0),vec3<f32>(1.0));
    if(m==7){
        let outA=min(1.0,asrc+adst);let outP=min(vec3<f32>(1.0),cs*asrc+cb*adst);
        let outRgb=select(vec3<f32>(0.0),outP/max(0.000001,outA),outA>0.000001);return vec4<f32>(outRgb,outA);
    }
    let blended=blend(cb,cs,m);let outA=asrc+adst-asrc*adst;
    let outP=cs*asrc*(1.0-adst)+cb*adst*(1.0-asrc)+blended*asrc*adst;
    let outRgb=select(vec3<f32>(0.0),outP/max(0.000001,outA),outA>0.000001);
    return vec4<f32>(clamp(outRgb,vec3<f32>(0.0),vec3<f32>(1.0)),outA);
}
fn smoother(x:f32)->f32{let q=clamp(x,0.0,1.0);return q*q*q*(q*(q*6.0-15.0)+10.0);}
fn coverUv(uv:vec2<f32>)->vec2<f32>{
    let d=vec2<f32>(textureDimensions(bgTex));let sa=d.x/max(1.0,d.y);let da=u.a.x/max(1.0,u.a.y);var q=uv;
    if(sa>da){let f=da/sa;q.x=0.5+(uv.x-0.5)*f;}else{let f=sa/da;q.y=0.5+(uv.y-0.5)*f;}return q;
}
@fragment fn fsMain(v:V)->@location(0) vec4<f32>{
    var base=vec3<f32>(u.a.z,u.a.w,u.b.x);
    if(u.d.x>0.5){let css=(v.uv*u.a.xy)/max(0.25,u.d.y);let cell=fract(css/24.0)*24.0;let dist=length(cell-vec2<f32>(12.0));let dotA=(1.0-smoothstep(0.65,1.35,dist))*0.4;base=mix(base,vec3<f32>(0.1176,0.1608,0.2314),dotA);}
    if(u.c.x>0.5){let q=coverUv(v.uv);let im=textureSample(bgTex,samp,q);base=im.rgb*im.a+base*(1.0-im.a);}
    let lateCanvasOverlay=u.d.w>1.5;
    let sceneSample=textureSample(sceneTex,samp,v.uv);
    let layerSample=textureSample(layerTex,samp,v.uv);
    var sc=sceneSample;
    if(lateCanvasOverlay){let layerRgb=select(vec3<f32>(0.0),layerSample.rgb/max(0.000001,layerSample.a),layerSample.a>0.000001);sc=vec4<f32>(layerRgb,layerSample.a);}
    let ul=textureSample(underlayTex,samp,v.uv);if(ul.a>0.000001){let outA=sc.a+ul.a*(1.0-sc.a);let outPremul=sc.rgb*sc.a+ul.rgb*(1.0-sc.a);let outRgb=select(vec3<f32>(0.0),outPremul/max(0.000001,outA),outA>0.000001);sc=vec4<f32>(outRgb,outA);}
    if(u.d.w>0.5&&!lateCanvasOverlay){let ly=layerSample;let outA=ly.a+sc.a*(1.0-ly.a);let outPremul=ly.rgb+sc.rgb*sc.a*(1.0-ly.a);let outRgb=select(vec3<f32>(0.0),outPremul/max(0.000001,outA),outA>0.000001);sc=vec4<f32>(outRgb,outA);}
    if(lateCanvasOverlay){let ov=sceneSample;let outA=ov.a+sc.a*(1.0-ov.a);let outPremul=ov.rgb*ov.a+sc.rgb*sc.a*(1.0-ov.a);let outRgb=select(vec3<f32>(0.0),outPremul/max(0.000001,outA),outA>0.000001);sc=vec4<f32>(outRgb,outA);}
    if(u.d.z>50.0){let lp=textureSample(lampTex,samp,v.uv);let lampMode=i32(round(u.d.z))-100;sc=compositeLamp(sc,lp,lampMode);}
    var a=clamp(sc.a*u.b.w,0.0,1.0);
    if(u.c.w>0.5){var mx=1.0;var my=1.0;if(v.uv.x<u.c.y){mx=smoother(v.uv.x/max(0.000001,u.c.y));}else if(v.uv.x>1.0-u.c.y){mx=smoother((1.0-v.uv.x)/max(0.000001,u.c.y));}if(v.uv.y<u.c.z){my=smoother(v.uv.y/max(0.000001,u.c.z));}else if(v.uv.y>1.0-u.c.z){my=smoother((1.0-v.uv.y)/max(0.000001,u.c.z));}a*=mx*my;}
    let src=clamp(sc.rgb,vec3<f32>(0.0),vec3<f32>(1.0));let bm=blend(base,src,i32(round(u.b.y)));let mixed=mix(src,bm,clamp(u.b.z,0.0,1.0));let outRgb=mixed*a+base*(1.0-a);return vec4<f32>(clamp(outRgb,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}`;
  const TEXTURE_OVER_WGSL = `
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;}
@fragment fn fs(v:V)->@location(0) vec4<f32>{return textureSample(srcTex,srcSampler,v.uv);}`;
  const LAMP_BLEND_WGSL = `
struct BlendU{mode:f32,_p0:f32,_p1:f32,_p2:f32};
@group(0) @binding(0) var lampTex:texture_2d<f32>;
@group(0) @binding(1) var sceneTex:texture_2d<f32>;
@group(0) @binding(2) var<uniform> bu:BlendU;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
    let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];
    return vec4<f32>(q,0.0,1.0);
}
fn lum(c:vec3<f32>)->f32{return dot(c,vec3<f32>(0.3,0.59,0.11));}
fn clipColor(c0:vec3<f32>)->vec3<f32>{
    var c=c0;let l=lum(c);let n=min(min(c.r,c.g),c.b);
    if(n<0.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*(l/max(0.000001,l-n));}
    let x=max(max(c.r,c.g),c.b);if(x>1.0){c=vec3<f32>(l)+(c-vec3<f32>(l))*((1.0-l)/max(0.000001,x-l));}
    return clamp(c,vec3<f32>(0.0),vec3<f32>(1.0));
}
fn setLum(c:vec3<f32>,l:f32)->vec3<f32>{return clipColor(c+vec3<f32>(l-lum(c)));}
fn lampBlend(cb:vec3<f32>,cs:vec3<f32>,m:i32)->vec3<f32>{
    if(m==5){return cb+cs-cb*cs;}
    if(m==6){return vec3<f32>(
        select(min(1.0,cb.r/max(0.000001,1.0-cs.r)),1.0,cs.r>=0.999999),
        select(min(1.0,cb.g/max(0.000001,1.0-cs.g)),1.0,cs.g>=0.999999),
        select(min(1.0,cb.b/max(0.000001,1.0-cs.b)),1.0,cs.b>=0.999999));}
    if(m==11){return abs(cb-cs);}
    if(m==15){return setLum(cs,lum(cb));}
    return cs;
}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
    let dims=vec2<i32>(textureDimensions(sceneTex));let xy=clamp(vec2<i32>(p.xy),vec2<i32>(0),dims-vec2<i32>(1));
    let src=textureLoad(lampTex,xy,0);let dst=textureLoad(sceneTex,xy,0);
    let asrc=clamp(src.a,0.0,1.0);let adst=clamp(dst.a,0.0,1.0);if(asrc<=0.000001){return dst;}
    let cs=clamp(src.rgb,vec3<f32>(0.0),vec3<f32>(1.0));
    let cb=select(vec3<f32>(0.0),clamp(dst.rgb/max(0.000001,adst),vec3<f32>(0.0),vec3<f32>(1.0)),adst>0.000001);
    let m=i32(round(bu.mode));
    if(m==7){return vec4<f32>(min(vec3<f32>(1.0),dst.rgb+cs*asrc),min(1.0,adst+asrc));}
    let b=lampBlend(cb,cs,m);let outA=asrc+adst-asrc*adst;
    let outP=cs*asrc*(1.0-adst)+cb*adst*(1.0-asrc)+b*asrc*adst;
    return vec4<f32>(clamp(outP,vec3<f32>(0.0),vec3<f32>(1.0)),clamp(outA,0.0,1.0));
}`;
  function resetGpuTiming() {
    for (const slot of gpuTimerSlots) {
      try {
        slot?.querySet?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/final-composite-renderer#resetGpuTiming', error);
      }
      try {
        slot?.resolve?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/final-composite-renderer#resetGpuTiming', error);
      }
      try {
        slot?.read?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/final-composite-renderer#resetGpuTiming', error);
      }
    }
    gpuTimerSlots = [];
    gpuTimerCursor = 0;
    gpuTimerGeneration = 0;
    gpuTimingDisabledReason = '';
  }
  function ensureGpuTiming() {
    if (
      !WebGPUDeviceHub.hasTimestampQuery?.() ||
      typeof device?.createQuerySet !== 'function' ||
      typeof GPUMapMode === 'undefined'
    ) {
      gpuTimingDisabledReason = 'timestamp-query unavailable';
      return false;
    }
    if (gpuTimerSlots.length && gpuTimerGeneration === hubGeneration) return true;
    resetGpuTiming();
    try {
      for (let i = 0; i < 3; i++) {
        const querySet = device.createQuerySet({
          label: `SpiroStar frame timestamps ${i}`,
          type: 'timestamp',
          count: 2,
        });
        const resolve = device.createBuffer({
          label: `SpiroStar frame timestamp resolve ${i}`,
          size: 16,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        const read = device.createBuffer({
          label: `SpiroStar frame timestamp read ${i}`,
          size: 16,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        gpuTimerSlots.push({ querySet, resolve, read, pending: false });
      }
      gpuTimerGeneration = hubGeneration;
      return true;
    } catch (err) {
      const reason = String(err?.message || err);
      resetGpuTiming();
      gpuTimingDisabledReason = reason;
      return false;
    }
  }
  function beginGpuTiming(frameId) {
    if ((Number(frameId) || 0) % GPU_TIMING_INTERVAL !== 0 || !ensureGpuTiming()) return null;
    for (let n = 0; n < gpuTimerSlots.length; n++) {
      const slot = gpuTimerSlots[gpuTimerCursor++ % gpuTimerSlots.length];
      if (slot.pending) continue;
      try {
        const e = device.createCommandEncoder({ label: 'SpiroStar frame timestamp begin' });
        if (typeof e.writeTimestamp !== 'function') {
          gpuTimingDisabledReason = 'GPUCommandEncoder.writeTimestamp unavailable';
          return null;
        }
        e.writeTimestamp(slot.querySet, 0);
        return { slot, begin: e.finish() };
      } catch (err) {
        gpuTimingMisses++;
        gpuTimingDisabledReason = String(err?.message || err);
        return null;
      }
    }
    gpuTimingMisses++;
    return null;
  }
  function finishGpuTiming(timer) {
    if (!timer?.slot) return null;
    try {
      const e = device.createCommandEncoder({ label: 'SpiroStar frame timestamp end' });
      e.writeTimestamp(timer.slot.querySet, 1);
      e.resolveQuerySet(timer.slot.querySet, 0, 2, timer.slot.resolve, 0);
      e.copyBufferToBuffer(timer.slot.resolve, 0, timer.slot.read, 0, 16);
      return e.finish();
    } catch (err) {
      gpuTimingMisses++;
      gpuTimingDisabledReason = String(err?.message || err);
      return null;
    }
  }
  function readGpuTiming(timer) {
    const slot = timer?.slot;
    if (!slot || slot.pending) return;
    slot.pending = true;
    slot.read
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        try {
          const a = new BigUint64Array(slot.read.getMappedRange());
          const dt = a[1] >= a[0] ? a[1] - a[0] : 0n;
          const ms = Number(dt) / 1e6;
          slot.read.unmap();
          if (Number.isFinite(ms) && ms > 0 && ms < 250) {
            gpuTimingLastMs = ms;
            gpuTimingEmaMs = gpuTimingEmaMs ? gpuTimingEmaMs * 0.85 + ms * 0.15 : ms;
            gpuTimingSamples++;
            performanceGovernor.noteGpuFrame(ms);
          } else gpuTimingMisses++;
        } catch (_) {
          try {
            slot.read.unmap();
          } catch (error) {
            noteSuppressedError('gpu/final-composite-renderer#readGpuTiming', error);
          }
          gpuTimingMisses++;
        } finally {
          slot.pending = false;
        }
      })
      .catch(() => {
        slot.pending = false;
        gpuTimingMisses++;
      });
  }
  function resetTextures() {
    resetGpuTiming();
    textureOverBindGroups = new WeakMap();
    lampBlendBindGroups = new WeakMap();
    for (const t of [
      sceneTexture,
      bgTexture,
      dummyBgTexture,
      dummyLampTexture,
      dummyLayerTexture,
      lampBlendScratchTexture,
    ])
      try {
        t?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/final-composite-renderer#resetTextures', error);
      }
    sceneTexture =
      bgTexture =
      dummyBgTexture =
      dummyLampTexture =
      dummyLayerTexture =
      lampBlendScratchTexture =
        null;
    lampBlendScratchView = null;
    bindGroup = null;
    finalRenderBundle = null;
    finalRenderBundleList.length = 0;
    boundBgTexture = boundLampTexture = boundLayerTexture = boundUnderlayTexture = boundSceneTexture = null;
    width = height = bgWidth = bgHeight = 0;
  }
  async function initAsync() {
    if (ready && !lost) return true;
    if (initializing) return false;
    if (attempted && !ready && !lost) return false;
    attempted = true;
    initializing = true;
    lastError = '';
    try {
      const shared = await WebGPUDeviceHub.acquire();
      device = shared.device;
      hubGeneration = shared.generation;
      lost = false;
      context = finalGpuCanvas?.getContext?.('webgpu');
      if (!context) throw new Error('WebGPU final canvas context недоступен');
      format = navigator.gpu.getPreferredCanvasFormat();
      device.pushErrorScope?.('validation');
      const module = device.createShaderModule({ label: 'SpiroStar final composite WGSL', code: WGSL });
      await assertWebGPUShaderModule(module, 'SpiroStar final composite WGSL');
      pipeline = device.createRenderPipeline({
        label: 'SpiroStar final composite',
        layout: 'auto',
        vertex: { module, entryPoint: 'vsMain' },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      const overModule = device.createShaderModule({
        label: 'Somata effect-stack texture-over WGSL',
        code: TEXTURE_OVER_WGSL,
      });
      await assertWebGPUShaderModule(overModule, 'Somata effect-stack texture-over WGSL');
      textureOverPipeline = device.createRenderPipeline({
        label: 'Somata effect-stack texture-over',
        layout: 'auto',
        vertex: { module: overModule, entryPoint: 'vs' },
        fragment: {
          module: overModule,
          entryPoint: 'fs',
          targets: [
            {
              format,
              blend: {
                color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              },
            },
          ],
        },
        primitive: { topology: 'triangle-list' },
      });
      const lampBlendModule = device.createShaderModule({
        label: 'Somata lamp blend interleave WGSL',
        code: LAMP_BLEND_WGSL,
      });
      await assertWebGPUShaderModule(lampBlendModule, 'Somata lamp blend interleave WGSL');
      lampBlendPipeline = device.createRenderPipeline({
        label: 'Somata lamp blend interleave',
        layout: 'auto',
        vertex: { module: lampBlendModule, entryPoint: 'vs' },
        fragment: { module: lampBlendModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });
      uniformBuffer = device.createBuffer({
        label: 'SpiroStar final composite uniforms',
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      lampBlendUniformBuffer = device.createBuffer({
        label: 'Somata lamp blend mode uniform',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      dummyBgTexture = device.createTexture({
        label: 'SpiroStar dummy background',
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: dummyBgTexture },
        new Uint8Array([0, 0, 0, 0]),
        { bytesPerRow: 4 },
        [1, 1, 1],
      );
      dummyLampTexture = device.createTexture({
        label: 'SpiroStar dummy lamp input',
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: dummyLampTexture },
        new Uint8Array([0, 0, 0, 0]),
        { bytesPerRow: 4 },
        [1, 1, 1],
      );
      dummyLayerTexture = device.createTexture({
        label: 'SpiroStar dummy layer input',
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: dummyLayerTexture },
        new Uint8Array([0, 0, 0, 0]),
        { bytesPerRow: 4 },
        [1, 1, 1],
      );
      const validation = await device.popErrorScope?.();
      if (validation) throw new Error(`WebGPU final validation: ${validation.message || validation}`);
      ready = true;
      requestMainCanvasRender();
      return true;
    } catch (err) {
      ready = false;
      lastError = String(err?.message || err);
      lastInitError = lastError;
      return false;
    } finally {
      initializing = false;
    }
  }
  function warmup() {
    const hr = WebGPUDeviceHub.warmup(),
      gen = WebGPUDeviceHub.getGeneration();
    if (ready && (!hr || gen !== hubGeneration)) {
      ready = false;
      attempted = false;
      lost = !hr;
      resetTextures();
      try {
        context?.unconfigure?.();
      } catch (error) {
        noteSuppressedError('gpu/final-composite-renderer#warmup', error);
      }
    }
    if (!ready && !initializing && (!attempted || lost)) void initAsync();
    return ready && !lost && hr;
  }

  function retry() {
    if (ready && !lost) return true;
    if (initializing) return false;
    attempted = false;
    lost = false;
    retryCount++;
    void initAsync();
    return false;
  }
  function vignetteInfo(frame) {
    if (
      !state.showVignette ||
      !state.tunnel?.active ||
      !state.tunnel.fadeOversize
    )
      return { on: false, fx: 0, fy: 0 };
    const authored = Math.max(0, Math.min(1200, Number(state.tunnel.vignetteAmount) || 0)),
      morphed = Number(window.SomataMorphParameterRouting?.resolveGlobalValue?.('tunnel.vignette', authored));
    const amountPx = Math.max(
      0,
      Math.min(1200, audioApplyNumeric('tunnel.vignette', Number.isFinite(morphed) ? morphed : authored, -1)),
    );
    if (amountPx <= 0.0001) return { on: false, fx: 0, fy: 0 };
    const cssW = Math.max(1, Number(frame?.w) || mainCanvas.clientWidth || 1),
      cssH = Math.max(1, Number(frame?.h) || mainCanvas.clientHeight || 1),
      dpr = Math.max(0.25, Number(frame?.dpr) || window.devicePixelRatio || 1);
    const mv = getMotionViewportTransform(cssW, cssH),
      ox = cssW * 0.5 + (Number(state.panX) || 0) + (Number(mv.panX) || 0),
      oy = cssH * 0.5 + (Number(state.panY) || 0) + (Number(mv.panY) || 0);
    const ex = Math.max(1, Math.min(ox, cssW - ox)),
      ey = Math.max(1, Math.min(oy, cssH - oy));
    const fxc = Math.max(0.25, Math.min(amountPx, ex * 0.98, cssW * 0.49)),
      fyc = Math.max(0.25, Math.min(amountPx, ey * 0.98, cssH * 0.49));
    return {
      on: true,
      fx: Math.max(0.0001, Math.min(0.49, (fxc * dpr) / Math.max(1, mainCanvas.width))),
      fy: Math.max(0.0001, Math.min(0.49, (fyc * dpr) / Math.max(1, mainCanvas.height))),
    };
  }
  function presentationNeeds(frame) {
    const cfg = normalizeSceneBlendState(),
      v = vignetteInfo(frame),
      strength = Math.max(0, Math.min(100, Number(cfg.strength) || 0));
    return {
      cfg,
      v,
      intermediateBlend: cfg.mode !== 'normal' && strength > 0.001 && strength < 99.999,
      fullCssBlend: cfg.mode !== 'normal' && strength >= 99.999,
      opacityOnly: cfg.mode === 'normal' && cfg.opacity < 99.999,
    };
  }

  function dynamicGeometryMorphHot() {
    return Boolean(
      (runtimeState?.morph?.active === true && state?.morph?.mode !== 'light') ||
      runtimeState?.minimalMorph?.active === true ||
      runtimeState?.projectMorph?.active === true,
    );
  }
  function frameGraphGpuResidentBenefit() {
    const layers = (state?.layers || []).filter((l) => l?.visible !== false);
    for (const l of layers) {
      const sw = getLayerSweepConfig?.(l);
      if (
        sw?.lightningEnabled === true &&
        normalizeLightningBehaviorValue(sw.lightningBehavior, 'symmetric') !== 'symmetric'
      )
        return true;
      if (l?.lineProfileApplication === 'graffiti') return true;
      if (l?.sprite?.enabled === true || l?.lineMotionFx?.enabled === true) return true;
    }
    return false;
  }
  function gpuPathFxRequired() {
    return (state?.layers || []).some(
      (l) => l?.visible !== false && (l?.sprite?.enabled === true || l?.lineMotionFx?.enabled === true),
    );
  }
  function deferredFrameGraphWorthIt(frame) {
    const fid = Math.max(0, Number(frame?.id) || Number(renderRuntime?.frameId) || 0);

    if (
      gpuPathFxRequired() ||
      state?.tunnel?.active === true ||
      frame?.strictSpiralEntryIntent === true ||
      frame?.strictSpiralGpuPresentRequired === true
    ) {
      frameGraphPerformanceRuntime.lastRiskReason = '';
      return true;
    }
    if (fid <= frameGraphPerformanceRuntime.penaltyUntilFrame) return false;
    const risk = knownFrameGraphCanvasRisk();
    if (risk) {
      frameGraphPerformanceRuntime.lastRiskReason = risk;
      frameGraphPerformanceRuntime.preflightRejects++;
      return false;
    }
    frameGraphPerformanceRuntime.lastRiskReason = '';
    if (dynamicGeometryMorphHot()) return frameGraphGpuResidentBenefit();
    if (frameGraphGpuResidentBenefit()) return true;
    if (state?.tunnel?.active === true) return true;
    return Math.max(0, Number(frame?.renderLayerCount) || 0) >= 3;
  }
  function finalGpuPostWorthIt(frame) {
    const p = presentationNeeds(frame),
      layers = Math.max(0, Number(frame?.renderLayerCount) || 0);

    if (p.opacityOnly || p.fullCssBlend) return false;
    if (p.center?.on) return true;
    if (dynamicGeometryMorphHot()) return false;
    if (p.intermediateBlend) return layers >= 3;
    if (p.v.on) return state?.tunnel?.active === true && layers >= 3;
    return false;
  }
  function backgroundMorphActive() {
    return (
      mainContainerEl?.classList?.contains('project-morph-background-active') === true ||
      runtimeState?.projectMorph?.backgroundActive === true
    );
  }
  function startBgLoad(url) {
    if (!url || bgLoadingKey === url || (bgKey === url && bgImage)) return;
    const token = ++bgLoadToken;
    bgLoadingKey = url;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (token !== bgLoadToken) return;
      bgImage = img;
      bgKey = url;
      bgLoadingKey = '';
      try {
        bgTexture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/final-composite-renderer#onload', error);
      }
      bgTexture = null;
      bgWidth = bgHeight = 0;
      bindGroup = null;
      finalRenderBundle = null;
      finalRenderBundleList.length = 0;
      boundBgTexture = boundLampTexture = boundLayerTexture = boundUnderlayTexture = boundSceneTexture = null;
      requestMainCanvasRender();
    };
    img.onerror = () => {
      if (token !== bgLoadToken) return;
      bgLoadingKey = '';
      bgImage = null;
      bgKey = '';
      lastError = 'Фоновое изображение не декодировано для WebGPU';
      requestMainCanvasRender();
    };
    img.src = url;
  }
  function backgroundReady() {
    const url = typeof state.backgroundImageDataUrl === 'string' ? state.backgroundImageDataUrl : '';
    if (!url) return true;
    if (bgKey === url && bgImage?.naturalWidth > 0) return true;
    startBgLoad(url);
    return false;
  }
  function deferredLampSource() {
    try {
      return LampGPURenderer?.getCompositeTexture?.() || null;
    } catch (_) {
      return null;
    }
  }
  function deferredLayerSource() {
    try {
      return (
        WebGPUStrokeRenderer?.getFrameSceneTexture?.(renderRuntime.frameId) ||
        WebGPUStrokeRenderer?.getDeferredLayerSceneTexture?.(renderRuntime.frameId) ||
        null
      );
    } catch (_) {
      return null;
    }
  }
  function deferredUnderlaySource() {
    try {
      return WebGPUStrokeRenderer?.getFrameUnderlayTexture?.(renderRuntime.frameId) || null;
    } catch (_) {
      return null;
    }
  }
  function canDeferLamps(frame) {
    if (state.transparentDesktop === true || backgroundMorphActive() || !warmup())
      return false;
    const canvasTouched = renderBackendTelemetry.canvasTouched?.() === true;
    if (canvasTouched && (deferredLayerSource() || deferredUnderlaySource())) return false;
    return backgroundReady();
  }
  function canDeferLayerScene(frame, forceGpuResident = false) {
    if (
      state.transparentDesktop === true ||
      renderBackendTelemetry.blocksGpuScene() ||
      backgroundMorphActive()
    )
      return false;

    if (!forceGpuResident && !deferredFrameGraphWorthIt(frame)) return false;
    if (!warmup()) return false;
    return backgroundReady();
  }
  function canPresent(frame) {
    const lamp = deferredLampSource(),
      layer = deferredLayerSource(),
      underlay = deferredUnderlaySource(),
      hasDeferred = Boolean(lamp || layer || underlay),
      lampOnly = Boolean(lamp && !layer && !underlay),
      strictSpiral = frame?.strictSpiralGpuPresentRequired === true;
    const lateCanvasOverlay = Boolean(
      strictSpiral &&
      frame?.strictSpiralLateCanvasOverlay === true &&
      frame?.gpuMainCanvasHasContent === true &&
      renderBackendTelemetry.hasMaterialization?.() !== true,
    );
    if (state.transparentDesktop === true) return false;

    if (
      strictSpiral &&
      (frame?._strictSpiralGpuFrameIncomplete === true ||
        !layer ||
        (!lateCanvasOverlay && frame?.gpuMainCanvasHasContent === true) ||
        (!lateCanvasOverlay && renderBackendTelemetry.canvasTouched?.() === true) ||
        renderBackendTelemetry.hasMaterialization?.() === true)
    )
      return false;

    if (renderBackendTelemetry.hasMaterialization?.() === true && !lampOnly) return false;
    if (renderBackendTelemetry.canvasTouched?.() === true && (layer || underlay) && !lateCanvasOverlay)
      return false;
    if ((!hasDeferred && !finalGpuPostWorthIt(frame)) || backgroundMorphActive() || !warmup()) return false;
    return backgroundReady();
  }
  function ensureSize() {
    const w = Math.max(1, mainCanvas.width | 0),
      h = Math.max(1, mainCanvas.height | 0);
    if (
      width === w &&
      height === h &&
      sceneTexture &&
      lampBlendScratchTexture &&
      finalGpuCanvas.width === w &&
      finalGpuCanvas.height === h
    )
      return true;
    width = w;
    height = h;
    finalGpuCanvas.width = w;
    finalGpuCanvas.height = h;
    context.configure({ device, format, alphaMode: 'opaque' });
    try {
      sceneTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/final-composite-renderer#ensureSize', error);
    }
    try {
      lampBlendScratchTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/final-composite-renderer#ensureSize', error);
    }
    sceneTexture = device.createTexture({
      label: 'SpiroStar final scene input',
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    lampBlendScratchTexture = device.createTexture({
      label: 'Somata lamp blend destination scratch',
      size: [w, h, 1],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    lampBlendScratchView = lampBlendScratchTexture.createView();
    lampBlendBindGroups = new WeakMap();
    bindGroup = null;
    finalRenderBundle = null;
    finalRenderBundleList.length = 0;
    boundBgTexture = boundLampTexture = boundLayerTexture = boundUnderlayTexture = boundSceneTexture = null;
    return true;
  }
  function ensureBgTexture() {
    const url = typeof state.backgroundImageDataUrl === 'string' ? state.backgroundImageDataUrl : '';
    if (!url) return dummyBgTexture;
    if (!(bgKey === url && bgImage?.naturalWidth > 0)) return null;
    const w = Math.max(1, bgImage.naturalWidth | 0),
      h = Math.max(1, bgImage.naturalHeight | 0);
    if (bgTexture && bgWidth === w && bgHeight === h) return bgTexture;
    try {
      bgTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/final-composite-renderer#ensureBgTexture', error);
    }
    bgTexture = device.createTexture({
      label: 'SpiroStar final background',
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    bgWidth = w;
    bgHeight = h;
    device.queue.copyExternalImageToTexture(
      { source: bgImage },
      { texture: bgTexture, premultipliedAlpha: false },
      [w, h],
    );
    bgUploads++;
    bindGroup = null;
    finalRenderBundle = null;
    finalRenderBundleList.length = 0;
    boundBgTexture = boundLampTexture = boundLayerTexture = boundUnderlayTexture = boundSceneTexture = null;
    return bgTexture;
  }
  function encodeTextureOverTarget(sourceTexture, targetTexture, label = 'effect-stack texture-over') {
    if (!sourceTexture || !targetTexture || !textureOverPipeline || !sampler || !warmup()) return null;
    try {
      let bg = textureOverBindGroups.get(sourceTexture);
      if (!bg) {
        bg = device.createBindGroup({
          layout: textureOverPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sourceTexture.createView() },
            { binding: 1, resource: sampler },
          ],
        });
        textureOverBindGroups.set(sourceTexture, bg);
      }
      const enc = device.createCommandEncoder({ label: String(label || 'effect-stack texture-over') }),
        pass = enc.beginRenderPass({
          colorAttachments: [{ view: targetTexture.createView(), loadOp: 'load', storeOp: 'store' }],
        });
      pass.setPipeline(textureOverPipeline);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
      return enc.finish();
    } catch (err) {
      lastError = String(err?.message || err);
      return null;
    }
  }
  function encodeLampBlendIntoTarget(
    sourceTexture,
    targetTexture,
    blendMode = 'lighter',
    label = 'Somata lamp blend → Layer Scene',
  ) {
    if (
      !sourceTexture ||
      !targetTexture ||
      !lampBlendPipeline ||
      !lampBlendUniformBuffer ||
      !lampBlendScratchTexture ||
      !lampBlendScratchView ||
      !warmup()
    )
      return null;
    try {
      const mode = normalizedLampBlend(blendMode),
        code = lampBlendCode[mode] ?? 7;
      device.queue.writeBuffer(lampBlendUniformBuffer, 0, new Float32Array([code, 0, 0, 0]));
      let bg = lampBlendBindGroups.get(sourceTexture);
      if (!bg) {
        bg = device.createBindGroup({
          layout: lampBlendPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sourceTexture.createView() },
            { binding: 1, resource: lampBlendScratchView },
            { binding: 2, resource: { buffer: lampBlendUniformBuffer } },
          ],
        });
        lampBlendBindGroups.set(sourceTexture, bg);
      }
      const enc = device.createCommandEncoder({ label: String(label || 'Somata lamp blend → Layer Scene') });
      enc.copyTextureToTexture({ texture: targetTexture }, { texture: lampBlendScratchTexture }, [
        width,
        height,
        1,
      ]);
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: targetTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(lampBlendPipeline);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
      return enc.finish();
    } catch (err) {
      lastError = String(err?.message || err);
      return null;
    }
  }
  function updatePresentationCss(active) {
    if (active) {
      finalGpuCanvas.style.display = 'block';
      mainCanvas.style.visibility = 'hidden';
      sceneBlendCanvas.style.display = 'none';
      sceneBlendCanvas.style.visibility = 'hidden';
      if (gridPatternEl) gridPatternEl.style.visibility = 'hidden';
      const bg = document.getElementById('viewportBackgroundImage');
      if (bg) bg.style.visibility = 'hidden';
    } else {
      finalGpuCanvas.style.display = 'none';
      mainCanvas.style.visibility = '';
      sceneBlendCanvas.style.visibility = '';
      if (gridPatternEl) gridPatternEl.style.visibility = '';
      const bg = document.getElementById('viewportBackgroundImage');
      if (bg) bg.style.visibility = '';
    }
  }
  function render(frame) {
    if (!canPresent(frame) || !ensureSize()) {
      updatePresentationCss(false);
      return false;
    }
    const bt = ensureBgTexture();
    if (!bt) {
      updatePresentationCss(false);
      return false;
    }
    try {
      const layerSource = deferredLayerSource(),
        ltx = layerSource?.texture || dummyLayerTexture;
      const underlaySource = deferredUnderlaySource(),
        utx = underlaySource?.texture || dummyLayerTexture;
      const layerEffects =
        layerSource && !layerSource?.globalFrameScene ? peekLayerSceneEffectCommands(frame) : [];
      const rawLampSource = deferredLampSource(),
        rawLampCommand = rawLampSource ? LampGPURenderer?.getDeferredCommandBuffer?.() : null;
      const lampPhase = typeof somataEffectPhase === 'function' ? somataEffectPhase('lamps') : 450;
      const wantsLampInterleave = Boolean(
        rawLampSource?.texture &&
        layerSource?.texture &&
        !layerSource?.globalFrameScene &&
        layerEffects.some((item) => Number(item?.phase) >= lampPhase),
      );
      const lampLayerSceneCommand = wantsLampInterleave
        ? encodeLampBlendIntoTarget(
            rawLampSource.texture,
            layerSource.texture,
            rawLampSource?.blendMode,
            'Somata Lamps blend-aware → ordered Layer Scene',
          )
        : null;
      const lampsEmbedded = Boolean(wantsLampInterleave && lampLayerSceneCommand),
        lampSource = lampsEmbedded ? null : rawLampSource,
        lt = lampSource?.texture || dummyLampTexture;

      const strictSpiral = frame?.strictSpiralGpuPresentRequired === true,
        lateCanvasOverlay = Boolean(
          strictSpiral &&
          frame?.strictSpiralLateCanvasOverlay === true &&
          frame?.gpuMainCanvasHasContent === true &&
          renderBackendTelemetry.hasMaterialization?.() !== true,
        ),
        mainSceneEmpty = Boolean(
          layerSource &&
          (lateCanvasOverlay
            ? false
            : strictSpiral
              ? frame?.gpuMainCanvasHasContent !== true
              : frame?.gpuMainSceneEmpty),
        );
      const st = mainSceneEmpty ? dummyLampTexture : sceneTexture;
      const framePhase = renderPerf?.currentFramePhases || null;
      if (mainSceneEmpty) sceneUploadSkips++;
      else {
        const uploadAt = performance.now();
        device.queue.copyExternalImageToTexture(
          { source: mainCanvas },
          { texture: sceneTexture, premultipliedAlpha: false },
          [width, height],
        );
        sceneUploads++;
        if (framePhase) framePhase.gpuMainUploadMs = performance.now() - uploadAt;
      }
      if (
        !bindGroup ||
        boundBgTexture !== bt ||
        boundLampTexture !== lt ||
        boundLayerTexture !== ltx ||
        boundUnderlayTexture !== utx ||
        boundSceneTexture !== st
      ) {
        bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: st.createView() },
            { binding: 1, resource: bt.createView() },
            { binding: 2, resource: lt.createView() },
            { binding: 3, resource: ltx.createView() },
            { binding: 4, resource: utx.createView() },
            { binding: 5, resource: sampler },
            { binding: 6, resource: { buffer: uniformBuffer } },
          ],
        });
        boundBgTexture = bt;
        boundLampTexture = lt;
        boundLayerTexture = ltx;
        boundUnderlayTexture = utx;
        boundSceneTexture = st;
        finalRenderBundle = null;
        finalRenderBundleList.length = 0;
        if (typeof device.createRenderBundleEncoder === 'function') {
          try {
            const rbe = device.createRenderBundleEncoder({
              label: 'SpiroStar final composite render bundle',
              colorFormats: [format],
            });
            rbe.setPipeline(pipeline);
            rbe.setBindGroup(0, bindGroup);
            rbe.draw(3);
            finalRenderBundle = rbe.finish();
            finalRenderBundleList[0] = finalRenderBundle;
            finalBundleBuilds++;
          } catch (_) {
            finalRenderBundle = null;
            finalRenderBundleList.length = 0;
          }
        }
      }
      const cfg = normalizeSceneBlendState(),
        c = GPUColorCache.rgba(state.bgColor || '#090d16'),
        v = vignetteInfo(frame),
        dpr = Math.max(0.25, Number(frame?.dpr) || window.devicePixelRatio || 1);
      uniformData.fill(0);

      uniformData[0] = width;
      uniformData[1] = height;
      uniformData[2] = c[0];
      uniformData[3] = c[1];

      uniformData[4] = c[2];
      uniformData[5] = modeCode[cfg.mode] ?? 0;
      uniformData[6] = cfg.mode === 'normal' ? 0 : cfg.strength / 100;
      uniformData[7] = cfg.opacity / 100;

      uniformData[8] = state.backgroundImageDataUrl ? 1 : 0;
      uniformData[9] = v.fx;
      uniformData[10] = v.fy;
      uniformData[11] = v.on ? 1 : 0;
      uniformData[12] = state.showGrid ? 1 : 0;
      uniformData[13] = dpr;
      uniformData[14] = lampSource
        ? 100 + (lampBlendCode[normalizedLampBlend(lampSource?.blendMode)] ?? 7)
        : 0;
      uniformData[15] = layerSource ? (lateCanvasOverlay ? 2 : 1) : 0;
      let uniformChanged = !uniformHasLast;
      for (let i = 0; !uniformChanged && i < 16; i++)
        if (uniformData[i] !== uniformLast[i]) uniformChanged = true;
      if (uniformChanged) {
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        uniformLast.set(uniformData);
        uniformHasLast = true;
        uniformUploads++;
      } else uniformUploadSkips++;
      if (rawLampSource) lampDirectFrames++;
      if (layerSource) layerDirectFrames++;
      if (underlaySource) underlayDirectFrames++;
      const enc = device.createCommandEncoder({ label: 'SpiroStar final composite frame' }),
        pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: c[0], g: c[1], b: c[2], a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
      if (finalRenderBundle) {
        pass.executeBundles(finalRenderBundleList);
        finalBundleExecutes++;
      } else {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
      }
      pass.end();
      const finalCommand = enc.finish(),
        frameSceneCommands = layerSource?.globalFrameScene
          ? WebGPUStrokeRenderer?.getFrameSceneCommandBuffers?.(renderRuntime.frameId)
          : null,
        layerCommand =
          layerSource && !layerSource?.globalFrameScene
            ? WebGPUStrokeRenderer?.getDeferredLayerSceneCommandBuffer?.(renderRuntime.frameId)
            : null;
      const underlayCommands = underlaySource
        ? WebGPUStrokeRenderer.getFrameUnderlayCommandBuffers?.(renderRuntime.frameId)
        : null;

      const frameCommands = frameCommandScratch;
      frameCommands.length = 0;
      const gpuTimer = beginGpuTiming(frame?.id ?? renderRuntime.frameId);
      if (gpuTimer?.begin) frameCommands.push(gpuTimer.begin);
      if (underlayCommands?.clearCommand) frameCommands.push(underlayCommands.clearCommand);
      for (const cmd of underlayCommands?.effectCommands || []) if (cmd) frameCommands.push(cmd);
      if (Array.isArray(frameSceneCommands))
        for (const cmd of frameSceneCommands) if (cmd) frameCommands.push(cmd);
      if (layerCommand) frameCommands.push(layerCommand);
      if (lampsEmbedded) {
        for (const item of layerEffects)
          if (Number(item?.phase) < lampPhase && item?.commandBuffer) frameCommands.push(item.commandBuffer);
        if (rawLampCommand) frameCommands.push(rawLampCommand);
        frameCommands.push(lampLayerSceneCommand);
        for (const item of layerEffects)
          if (Number(item?.phase) >= lampPhase && item?.commandBuffer) frameCommands.push(item.commandBuffer);
      } else {
        for (const item of layerEffects) if (item?.commandBuffer) frameCommands.push(item.commandBuffer);
        if (rawLampCommand) frameCommands.push(rawLampCommand);
      }
      frameCommands.push(finalCommand);
      const gpuTimerEnd = finishGpuTiming(gpuTimer);
      if (gpuTimerEnd) frameCommands.push(gpuTimerEnd);
      mergedFrameCommandBuffers += frameCommands.length;
      const submitAt = performance.now();
      device.queue.submit(frameCommands);
      if (framePhase) framePhase.gpuQueueSubmitMs = performance.now() - submitAt;
      try {
        notifyLayerSceneEffectCommandsSubmitted?.(frame);
      } catch (error) {
        noteSuppressedError('gpu/final-composite-renderer#render', error);
      }
      try {
        notifyFrameSceneEffectCommandsSubmitted?.(frame);
      } catch (error) {
        noteSuppressedError('gpu/final-composite-renderer#render', error);
      }
      if (gpuTimerEnd) readGpuTiming(gpuTimer);
      submissions++;
      if (rawLampCommand) {
        LampGPURenderer.markDeferredSubmitted();
        mergedLampSubmissions++;
      }
      if (layerSource?.globalFrameScene) {
        WebGPUStrokeRenderer.markFrameScenePresented?.(renderRuntime.frameId);
        clearLayerSceneEffectCommands(frame);
      } else if (layerSource) {
        WebGPUStrokeRenderer.markDeferredLayerScenePresented?.(renderRuntime.frameId);
        clearLayerSceneEffectCommands(frame);
      }
      if (underlaySource) {
        WebGPUStrokeRenderer.markFrameUnderlayCommandsSubmitted?.(renderRuntime.frameId);
        WebGPUStrokeRenderer.markFrameUnderlayPresented?.(renderRuntime.frameId);
      }
      frames++;
      updatePresentationCss(true);
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      updatePresentationCss(false);
      return false;
    }
  }
  function disable() {
    updatePresentationCss(false);
  }
  function canDeferVignette(frame) {
    return vignetteInfo(frame).on && canPresent(frame);
  }
  function setGpuTimingInterval(value = 24) {
    GPU_TIMING_INTERVAL = Math.max(1, Math.min(120, Math.round(Number(value) || 24)));
    return GPU_TIMING_INTERVAL;
  }
  function status() {
    warmup();
    return {
      supported: !!navigator?.gpu,
      attempted,
      initializing,
      available: ready && !lost && WebGPUDeviceHub.isReady(),
      lost,
      active: finalGpuCanvas?.style?.display === 'block',
      lastError,
      lastInitError,
      retryCount,
      width,
      height,
      submissions,
      sceneUploads,
      sceneUploadSkips,
      bgUploads,
      frames,
      lampDirectFrames,
      layerDirectFrames,
      underlayDirectFrames,
      mergedLampSubmissions,
      frameGraph: {
        singleSubmitFrames: submissions,
        mergedCommandBuffers: mergedFrameCommandBuffers,
        uniformUploads,
        uniformUploadSkips,
        commandScratchReused: true,
        effectQueueSortedOnInsert: true,
        policy:
          'ordinary Base line and GPU-only effects force GPU-resident Layer Scene; other optional scenes still use profitability/correctness preflight; expected Canvas content may upload once beneath/above the resident line when ordering is explicit; mixed-path materialization still triggers cooldown',
        materializations: frameGraphPerformanceRuntime.materializations,
        penaltyUntilFrame: frameGraphPerformanceRuntime.penaltyUntilFrame,
        preflightRejects: frameGraphPerformanceRuntime.preflightRejects,
        lastRiskReason: frameGraphPerformanceRuntime.lastRiskReason,
        renderBundles: {
          supported: typeof device?.createRenderBundleEncoder === 'function',
          finalBuilds: finalBundleBuilds,
          finalExecutes: finalBundleExecutes,
        },
        gpuTiming: {
          supported: WebGPUDeviceHub.hasTimestampQuery?.() === true,
          samples: gpuTimingSamples,
          misses: gpuTimingMisses,
          lastMs: Number(gpuTimingLastMs.toFixed(3)),
          emaMs: Number(gpuTimingEmaMs.toFixed(3)),
          interval: GPU_TIMING_INTERVAL,
          disabledReason: gpuTimingDisabledReason,
        },
      },
      backgroundReady: backgroundReady(),
      hub: WebGPUDeviceHub.status(),
    };
  }
  return {
    warmup,
    retry,
    canPresent,
    canDeferVignette,
    canDeferLamps,
    canDeferLayerScene,
    encodeTextureOverTarget,
    encodeLampBlendIntoTarget,
    render,
    disable,
    status,
    setGpuTimingInterval,
  };
})();

export { WebGPUFinalCompositeRenderer };
