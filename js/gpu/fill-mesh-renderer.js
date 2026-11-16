// WebGPU: заливка сеткой.
import './corridor-copy-store.js'; // initialisation order: this module runs after it
import {
  getLayerFillAccumulationSeconds,
  getLayerFillFadeDirection,
  getLayerFillFadeHardness,
  getLayerFillFadePixelization,
  getLayerFillRule,
  getLayerFillType,
  somataEffectiveSpiralFillColor,
} from '../core/defaults-layers.js';
import { mainCtx, renderRuntime } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { state } from '../core/state.js';
import { getTunnelCopyColor } from '../corridor/corridor-appearance.js';
import { getMotionTunnelLagRadians } from '../effects/motion.js';
import { WebGPUSpiralBezierMorphRenderer } from './spiral-bezier-morph-renderer.js';
import { FillMeshPreparer } from '../render/fill-plan.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { WebGPUDeviceHub } from './device-hub.js';
import { GPUColorCache, assertWebGPUShaderModule } from './gpu-utils.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUFillMeshRenderer = (() => {
  const canvas = document.createElement('canvas');
  let device = null,
    context = null,
    format = null,
    pipeline = null,
    windingStencilPipeline = null,
    windingCoverPipeline = null,
    parityStencilPipeline = null,
    parityCoverPipeline = null,
    bindGroupLayout = null,
    pipelineLayout = null,
    msaaTexture = null,
    stencilTexture = null,
    isolatedFillTexture = null,
    isolatedFillView = null,
    isolatedCompositePipeline = null,
    isolatedCompositeSampler = null,
    isolatedCompositeBindGroup = null,
    fadeCompositePipeline = null,
    fadeSmoothSampler = null,
    fadeCompositeError = '',
    fadeBlurPipelineH = null,
    fadeBlurPipelineV = null,
    fadeSmoothCompositePipeline = null,
    fadeBlurTextureA = null,
    fadeBlurTextureB = null,
    fadeBlurViewA = null,
    fadeBlurViewB = null,
    fadeBlurUniformBuffer = null,
    fadeBlurBindGroupH = null,
    fadeBlurBindGroupV = null,
    fadeBlurWidth = 0,
    fadeBlurHeight = 0,
    fadeAdvancedError = '';
  let ready = false,
    attempted = false,
    initializing = false,
    lost = false,
    lastError = '',
    hubGeneration = 0,
    width = 0,
    height = 0;
  let submissions = 0,
    draws = 0,
    bufferBuilds = 0,
    bufferHits = 0,
    fallbacks = 0,
    renderedTriangles = 0,
    gpuEvictions = 0;
  let directEncodes = 0,
    directTriangles = 0,
    isolatedEncodes = 0,
    uniformSlotGrows = 0,
    windingDraws = 0,
    windingCovers = 0,
    windingTriangles = 0,
    parityDraws = 0,
    parityCovers = 0,
    dynamicMeshUploads = 0,
    dynamicMeshUploadBytes = 0,
    dynamicMeshGrows = 0,
    dynamicMeshReuses = 0;
  let gpuMeshCache = new WeakMap(),
    gpuMeshRecords = new Set(),
    uniformSlots = [],
    uniformCursor = 0;
  const fillHistoryRecords = new Map(),
    fadeStyleRecords = new Map();
  const fullUniform = new Float32Array(20),
    UNIFORM_RING = 16,
    fadeUniformScratch = new Float32Array(8);
  const WGSL = `
struct U {
    viewport: vec2<f32>,
    _pad: vec2<f32>,
    row0: vec4<f32>,
    row1: vec4<f32>,
    color: vec4<f32>,
    centerShade: vec4<f32>, 
};
@group(0) @binding(0) var<uniform> u: U;
struct VOut { @builtin(position) p: vec4<f32> };
@vertex fn vsMain(@location(0) pos:vec2<f32>)->VOut{
    let q=vec2<f32>(
        u.row0.x*pos.x+u.row0.y*pos.y+u.row0.z,
        u.row1.x*pos.x+u.row1.y*pos.y+u.row1.z
    );
    var o:VOut;
    o.p=vec4<f32>(q.x/u.viewport.x*2.0-1.0,1.0-q.y/u.viewport.y*2.0,0.0,1.0);
    return o;
}
@vertex fn vsCover(@builtin(vertex_index) vid:u32)->VOut{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    var o:VOut;o.p=vec4<f32>(p[vid],0.0,1.0);return o;
}
@fragment fn fsMain(v:VOut)->@location(0) vec4<f32>{
    var a=clamp(u.color.a,0.0,1.0);
    if(u.centerShade.w>u.centerShade.z+0.001){
        a*=smoothstep(u.centerShade.z,u.centerShade.w,distance(v.p.xy,u.centerShade.xy));
    }
    if(a<0.00001){discard;}
    return vec4<f32>(u.color.rgb*a,a);
}`;
  const ISOLATED_COMPOSITE_WGSL = `
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{return textureSample(srcTex,srcSampler,v.uv);}
`;
  const FADE_COMPOSITE_WGSL = `
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct FadeU { viewportRadiusHardness:vec4<f32>, directionPad:vec4<f32> };
@group(0) @binding(2) var<uniform> u:FadeU;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn insideAt(uv:vec2<f32>)->f32{return select(0.0,1.0,textureSampleLevel(srcTex,srcSampler,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).a>0.00001);}
fn alphaAt(uv:vec2<f32>,baseA:f32)->f32{return clamp(textureSampleLevel(srcTex,srcSampler,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).a/max(baseA,0.00001),0.0,1.0);}
fn ringAlpha8(uv:vec2<f32>,d:vec2<f32>,baseA:f32)->f32{
    var a=0.0;
    a+=alphaAt(uv+vec2<f32>( d.x,0.0),baseA);a+=alphaAt(uv+vec2<f32>(-d.x,0.0),baseA);
    a+=alphaAt(uv+vec2<f32>(0.0, d.y),baseA);a+=alphaAt(uv+vec2<f32>(0.0,-d.y),baseA);
    a+=alphaAt(uv+vec2<f32>( d.x*0.7071, d.y*0.7071),baseA);a+=alphaAt(uv+vec2<f32>(-d.x*0.7071, d.y*0.7071),baseA);
    a+=alphaAt(uv+vec2<f32>( d.x*0.7071,-d.y*0.7071),baseA);a+=alphaAt(uv+vec2<f32>(-d.x*0.7071,-d.y*0.7071),baseA);
    return a/8.0;
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{
    let c=textureSampleLevel(srcTex,srcSampler,v.uv,0.0);
    if(c.a<=0.00001){return vec4<f32>(0.0);}
    let h=clamp(u.viewportRadiusHardness.w,0.0,1.0);
    if(h<=0.0001){return vec4<f32>(0.0);}
    if(h>=0.9999){return c;}
    let vp=max(u.viewportRadiusHardness.xy,vec2<f32>(1.0));
    
    
    
    
    let radius=max(1.0,u.viewportRadiusHardness.z);
    let pix=clamp(u.directionPad.z,0.0,1.0);
    
    
    let sharpScale=mix(2.25,1.0,min(1.0,pix/0.25));
    let baseD=vec2<f32>(radius/vp.x,radius/vp.y);
    let d=select(baseD*sharpScale,baseD,u.directionPad.y>0.5);
    var core=0.0;
    if(u.directionPad.y<0.5){
        
        let h2=d*0.5;
        var cov=0.0;
        cov+=insideAt(v.uv+vec2<f32>( d.x,0.0));cov+=insideAt(v.uv+vec2<f32>(-d.x,0.0));
        cov+=insideAt(v.uv+vec2<f32>(0.0, d.y));cov+=insideAt(v.uv+vec2<f32>(0.0,-d.y));
        cov+=insideAt(v.uv+vec2<f32>( d.x*0.7071, d.y*0.7071));cov+=insideAt(v.uv+vec2<f32>(-d.x*0.7071, d.y*0.7071));
        cov+=insideAt(v.uv+vec2<f32>( d.x*0.7071,-d.y*0.7071));cov+=insideAt(v.uv+vec2<f32>(-d.x*0.7071,-d.y*0.7071));
        var cov2=0.0;
        cov2+=insideAt(v.uv+vec2<f32>( h2.x,0.0));cov2+=insideAt(v.uv+vec2<f32>(-h2.x,0.0));
        cov2+=insideAt(v.uv+vec2<f32>(0.0, h2.y));cov2+=insideAt(v.uv+vec2<f32>(0.0,-h2.y));
        cov2+=insideAt(v.uv+vec2<f32>( h2.x*0.7071, h2.y*0.7071));cov2+=insideAt(v.uv+vec2<f32>(-h2.x*0.7071, h2.y*0.7071));
        cov2+=insideAt(v.uv+vec2<f32>( h2.x*0.7071,-h2.y*0.7071));cov2+=insideAt(v.uv+vec2<f32>(-h2.x*0.7071,-h2.y*0.7071));
        let depth=clamp((cov/8.0)*0.68+(cov2/8.0)*0.32,0.0,1.0);
        core=smoothstep(0.08,0.92,depth);
    }else{
        
        
        
        
        let baseA=max(c.a,0.00001);
        let near=ringAlpha8(v.uv,d*0.24,baseA);
        let mid=ringAlpha8(v.uv,d*0.52,baseA);
        let far=ringAlpha8(v.uv,d*0.84,baseA);
        let depth=clamp(near*0.50+mid*0.32+far*0.18,0.0,1.0);
        core=smoothstep(0.03,0.97,depth);
    }
    let directedDepth=select(core,1.0-core,u.directionPad.x>0.5);
    
    
    
    
    let progress=smoothstep(0.0,1.0,h);
    let threshold=1.0-progress;
    let band=select(0.025,0.12,u.directionPad.y>0.5);
    let weight=clamp(smoothstep(threshold-band,threshold+band,directedDepth),0.0,1.0);
    return c*weight;
}`;
  const FADE_BLUR_WGSL = `
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
struct BlurU { uvStep:vec4<f32> };
@group(0) @binding(2) var<uniform> u:BlurU;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn aAt(uv:vec2<f32>)->f32{return textureSampleLevel(srcTex,srcSampler,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).a;}
fn gaussian9(uv:vec2<f32>,step:vec2<f32>)->f32{
    var a=aAt(uv)*0.204164;
    a+=(aAt(uv+step)+aAt(uv-step))*0.180174;
    a+=(aAt(uv+step*2.0)+aAt(uv-step*2.0))*0.123832;
    a+=(aAt(uv+step*3.0)+aAt(uv-step*3.0))*0.066282;
    a+=(aAt(uv+step*4.0)+aAt(uv-step*4.0))*0.027631;
    return a;
}
@fragment fn fsH(v:V)->@location(0) vec4<f32>{let a=gaussian9(v.uv,vec2<f32>(u.uvStep.x,0.0));return vec4<f32>(a,a,a,a);}
@fragment fn fsV(v:V)->@location(0) vec4<f32>{let a=gaussian9(v.uv,vec2<f32>(0.0,u.uvStep.y));return vec4<f32>(a,a,a,a);}
`;
  const FADE_SMOOTH_COMPOSITE_WGSL = `
@group(0) @binding(0) var srcTex:texture_2d<f32>;
@group(0) @binding(1) var srcSampler:sampler;
@group(0) @binding(2) var blurTex:texture_2d<f32>;
@group(0) @binding(3) var blurSampler:sampler;
struct FadeU { viewportRadiusHardness:vec4<f32>, directionPad:vec4<f32> };
@group(0) @binding(4) var<uniform> u:FadeU;
struct V{@builtin(position) p:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{
    let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    let q=p[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);o.uv=vec2<f32>((q.x+1.0)*0.5,(1.0-q.y)*0.5);return o;
}
fn insideAt(uv:vec2<f32>)->f32{return select(0.0,1.0,textureSampleLevel(srcTex,srcSampler,clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).a>0.00001);}
fn sharpCore(uv:vec2<f32>,d:vec2<f32>)->f32{
    let h2=d*0.5;var cov=0.0;var cov2=0.0;
    cov+=insideAt(uv+vec2<f32>( d.x,0.0));cov+=insideAt(uv+vec2<f32>(-d.x,0.0));
    cov+=insideAt(uv+vec2<f32>(0.0, d.y));cov+=insideAt(uv+vec2<f32>(0.0,-d.y));
    cov+=insideAt(uv+vec2<f32>( d.x*0.7071, d.y*0.7071));cov+=insideAt(uv+vec2<f32>(-d.x*0.7071, d.y*0.7071));
    cov+=insideAt(uv+vec2<f32>( d.x*0.7071,-d.y*0.7071));cov+=insideAt(uv+vec2<f32>(-d.x*0.7071,-d.y*0.7071));
    cov2+=insideAt(uv+vec2<f32>( h2.x,0.0));cov2+=insideAt(uv+vec2<f32>(-h2.x,0.0));
    cov2+=insideAt(uv+vec2<f32>(0.0, h2.y));cov2+=insideAt(uv+vec2<f32>(0.0,-h2.y));
    cov2+=insideAt(uv+vec2<f32>( h2.x*0.7071, h2.y*0.7071));cov2+=insideAt(uv+vec2<f32>(-h2.x*0.7071, h2.y*0.7071));
    cov2+=insideAt(uv+vec2<f32>( h2.x*0.7071,-h2.y*0.7071));cov2+=insideAt(uv+vec2<f32>(-h2.x*0.7071,-h2.y*0.7071));
    return smoothstep(0.08,0.92,clamp((cov/8.0)*0.68+(cov2/8.0)*0.32,0.0,1.0));
}
@fragment fn fs(v:V)->@location(0) vec4<f32>{
    let c=textureSampleLevel(srcTex,srcSampler,v.uv,0.0);if(c.a<=0.00001){return vec4<f32>(0.0);}
    let h=clamp(u.viewportRadiusHardness.w,0.0,1.0);if(h<=0.0001){return vec4<f32>(0.0);}if(h>=0.9999){return c;}
    let baseA=max(c.a,0.00001);
    let blurA=textureSampleLevel(blurTex,blurSampler,v.uv,0.0).a;
    let smoothCore=smoothstep(0.01,0.99,clamp(blurA/baseA,0.0,1.0));
    let smoothMode=u.directionPad.y>0.5;
    let pix=clamp(u.directionPad.z,0.0,1.0);
    var core=smoothCore;var band=0.12;
    if(!smoothMode){
        let vp=max(u.viewportRadiusHardness.xy,vec2<f32>(1.0));
        let d=vec2<f32>(max(1.0,u.viewportRadiusHardness.z)/vp.x,max(1.0,u.viewportRadiusHardness.z)/vp.y);
        let sharp=sharpCore(v.uv,d);
        let t=smoothstep(0.25,1.0,pix);
        core=mix(sharp,smoothCore,t);band=mix(0.025,0.12,t);
    }
    let directed=select(core,1.0-core,u.directionPad.x>0.5);
    let progress=smoothstep(0.0,1.0,h);let threshold=1.0-progress;
    let weight=clamp(smoothstep(threshold-band,threshold+band,directed),0.0,1.0);
    return c*weight;
}`;
  function destroyMeshRecord(rec) {
    if (!rec) return;
    for (const part of rec.parts || []) {
      try {
        part.vertexBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#destroyMeshRecord', error);
      }
      try {
        part.indexBuffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#destroyMeshRecord', error);
      }
    }
  }
  function resetGpuObjects() {
    try {
      msaaTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
    }
    msaaTexture = null;
    try {
      stencilTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
    }
    stencilTexture = null;
    try {
      isolatedFillTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
    }
    isolatedFillTexture = null;
    isolatedFillView = null;
    isolatedCompositeBindGroup = null;
    try {
      fadeBlurTextureA?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
    }
    try {
      fadeBlurTextureB?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
    }
    fadeBlurTextureA = null;
    fadeBlurTextureB = null;
    fadeBlurViewA = null;
    fadeBlurViewB = null;
    fadeBlurBindGroupH = null;
    fadeBlurBindGroupV = null;
    fadeBlurWidth = 0;
    fadeBlurHeight = 0;
    try {
      fadeBlurUniformBuffer?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
    }
    fadeBlurUniformBuffer = null;
    for (const rec of fillHistoryRecords.values()) {
      try {
        clearTimeout(rec?.timerHandle);
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
      }
      try {
        rec?.texture?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
      }
    }
    fillHistoryRecords.clear();
    for (const rec of fadeStyleRecords.values()) {
      try {
        rec?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
      }
    }
    fadeStyleRecords.clear();
    for (const rec of gpuMeshRecords) destroyMeshRecord(rec);
    gpuMeshRecords.clear();
    gpuMeshCache = new WeakMap();
    for (const slot of uniformSlots)
      try {
        slot?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#resetGpuObjects', error);
      }
    uniformSlots = [];
    uniformCursor = 0;
    pipeline = null;
    windingStencilPipeline = null;
    windingCoverPipeline = null;
    parityStencilPipeline = null;
    parityCoverPipeline = null;
    bindGroupLayout = null;
    pipelineLayout = null;
    fadeCompositePipeline = null;
    fadeSmoothSampler = null;
    fadeCompositeError = '';
    fadeBlurPipelineH = null;
    fadeBlurPipelineV = null;
    fadeSmoothCompositePipeline = null;
    fadeAdvancedError = '';
  }
  function drainMeshEvictions() {
    for (const mesh of FillMeshPreparer.takeEvicted?.() || []) {
      const rec = gpuMeshCache.get(mesh);
      if (!rec) continue;
      destroyMeshRecord(rec);
      gpuMeshCache.delete(mesh);
      gpuMeshRecords.delete(rec);
      gpuEvictions++;
    }
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
      context = canvas.getContext('webgpu');
      if (!context) throw new Error('WebGPU Fill Mesh canvas context недоступен');
      format = navigator.gpu.getPreferredCanvasFormat();
      const module = device.createShaderModule({ label: 'SpiroStar native Fill Mesh WGSL', code: WGSL });
      await assertWebGPUShaderModule(module, 'SpiroStar native Fill Mesh WGSL');
      bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      });
      pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const vertexBuffers = [
        {
          arrayStride: 8,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        },
      ];
      const blend = {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
      pipeline = device.createRenderPipeline({
        label: 'SpiroStar native Fill Mesh pipeline',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsMain', buffers: vertexBuffers },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        multisample: { count: 4 },
      });
      windingStencilPipeline = device.createRenderPipeline({
        label: 'SpiroStar native Fill winding stencil',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsMain', buffers: vertexBuffers },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format, writeMask: 0 }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: 'depth24plus-stencil8',
          depthWriteEnabled: false,
          depthCompare: 'always',
          stencilFront: { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'increment-wrap' },
          stencilBack: { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'decrement-wrap' },
          stencilReadMask: 0xff,
          stencilWriteMask: 0xff,
        },
        multisample: { count: 4 },
      });
      windingCoverPipeline = device.createRenderPipeline({
        label: 'SpiroStar native Fill winding cover',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsCover' },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: 'depth24plus-stencil8',
          depthWriteEnabled: false,
          depthCompare: 'always',
          stencilFront: { compare: 'not-equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
          stencilBack: { compare: 'not-equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
          stencilReadMask: 0xff,
          stencilWriteMask: 0,
        },
        multisample: { count: 4 },
      });
      parityStencilPipeline = device.createRenderPipeline({
        label: 'SpiroStar native Fill even-odd stencil',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsMain', buffers: vertexBuffers },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format, writeMask: 0 }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: 'depth24plus-stencil8',
          depthWriteEnabled: false,
          depthCompare: 'always',
          stencilFront: { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'invert' },
          stencilBack: { compare: 'always', failOp: 'keep', depthFailOp: 'keep', passOp: 'invert' },
          stencilReadMask: 0x01,
          stencilWriteMask: 0x01,
        },
        multisample: { count: 4 },
      });
      parityCoverPipeline = device.createRenderPipeline({
        label: 'SpiroStar native Fill even-odd cover',
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'vsCover' },
        fragment: { module, entryPoint: 'fsMain', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: 'depth24plus-stencil8',
          depthWriteEnabled: false,
          depthCompare: 'always',
          stencilFront: { compare: 'not-equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
          stencilBack: { compare: 'not-equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
          stencilReadMask: 0x01,
          stencilWriteMask: 0,
        },
        multisample: { count: 4 },
      });
      const isolatedCompositeModule = device.createShaderModule({
        label: 'Somata isolated Fill composite WGSL',
        code: ISOLATED_COMPOSITE_WGSL,
      });
      await assertWebGPUShaderModule(isolatedCompositeModule, 'Somata isolated Fill composite WGSL');
      isolatedCompositeSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
      fadeSmoothSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      });
      isolatedCompositePipeline = device.createRenderPipeline({
        label: 'Somata isolated Fill source-over composite',
        layout: 'auto',
        vertex: { module: isolatedCompositeModule, entryPoint: 'vs' },
        fragment: { module: isolatedCompositeModule, entryPoint: 'fs', targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      });
      // Special Fill shaders are optional capabilities.  They must never poison
      // the base Fill renderer: Dense/Mathematical/Accumulation all depend on the
      // native + isolated pipelines above and must stay usable even when a future
      // Fade shader is rejected by a real GPU/driver.
      fadeCompositePipeline = null;
      fadeCompositeError = '';
      try {
        const fadeCompositeModule = device.createShaderModule({
          label: 'Somata fading Fill composite WGSL',
          code: FADE_COMPOSITE_WGSL,
        });
        await assertWebGPUShaderModule(fadeCompositeModule, 'Somata fading Fill composite WGSL');
        fadeCompositePipeline = device.createRenderPipeline({
          label: 'Somata fading Fill contour-distance composite',
          layout: 'auto',
          vertex: { module: fadeCompositeModule, entryPoint: 'vs' },
          fragment: { module: fadeCompositeModule, entryPoint: 'fs', targets: [{ format, blend }] },
          primitive: { topology: 'triangle-list' },
        });
      } catch (fadeErr) {
        fadeCompositePipeline = null;
        fadeCompositeError = String(fadeErr?.message || fadeErr);
        try {
          console.error(
            '[Somata Fill] Fading Fill shader unavailable; base Fill remains active',
            fadeCompositeError,
          );
        } catch (error) {
          noteSuppressedError('gpu/fill-mesh-renderer#initAsync', error);
        }
      }
      // 7.9 smooth-field capability: optional and lazy.  Failure falls back to
      // the established sharp/multisample Fade shader and never disables Fill.
      fadeBlurPipelineH = null;
      fadeBlurPipelineV = null;
      fadeSmoothCompositePipeline = null;
      fadeAdvancedError = '';
      try {
        const blurModule = device.createShaderModule({
          label: 'Somata 7.11.0 smooth Fill separable blur WGSL',
          code: FADE_BLUR_WGSL,
        });
        const smoothModule = device.createShaderModule({
          label: 'Somata 7.11.0 smooth Fill composite WGSL',
          code: FADE_SMOOTH_COMPOSITE_WGSL,
        });
        await assertWebGPUShaderModule(blurModule, 'Somata 7.11.0 smooth Fill separable blur WGSL');
        await assertWebGPUShaderModule(smoothModule, 'Somata 7.11.0 smooth Fill composite WGSL');
        fadeBlurPipelineH = device.createRenderPipeline({
          label: 'Somata 7.11.0 Fade field horizontal',
          layout: 'auto',
          vertex: { module: blurModule, entryPoint: 'vs' },
          fragment: { module: blurModule, entryPoint: 'fsH', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        });
        fadeBlurPipelineV = device.createRenderPipeline({
          label: 'Somata 7.11.0 Fade field vertical',
          layout: 'auto',
          vertex: { module: blurModule, entryPoint: 'vs' },
          fragment: { module: blurModule, entryPoint: 'fsV', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        });
        fadeSmoothCompositePipeline = device.createRenderPipeline({
          label: 'Somata 7.11.0 continuous Fade composite',
          layout: 'auto',
          vertex: { module: smoothModule, entryPoint: 'vs' },
          fragment: { module: smoothModule, entryPoint: 'fs', targets: [{ format, blend }] },
          primitive: { topology: 'triangle-list' },
        });
        fadeBlurUniformBuffer = device.createBuffer({
          label: 'Somata 7.11.0 Fade blur uniform',
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
      } catch (advancedErr) {
        fadeBlurPipelineH = null;
        fadeBlurPipelineV = null;
        fadeSmoothCompositePipeline = null;
        fadeAdvancedError = String(advancedErr?.message || advancedErr);
        try {
          fadeBlurUniformBuffer?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/fill-mesh-renderer#initAsync', error);
        }
        fadeBlurUniformBuffer = null;
        try {
          console.warn(
            '[Somata Fill] Continuous Fade field unavailable; using legacy fade field',
            fadeAdvancedError,
          );
        } catch (error) {
          noteSuppressedError('gpu/fill-mesh-renderer#initAsync', error);
        }
      }
      ready = true;
      lost = false;
      lastError = '';
      try {
        requestMainCanvasRender();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#initAsync', error);
      }
      return true;
    } catch (err) {
      ready = false;
      lastError = String(err?.message || err);
      return false;
    } finally {
      initializing = false;
    }
  }
  function warmup() {
    const hubReady = WebGPUDeviceHub.warmup(),
      gen = WebGPUDeviceHub.getGeneration();
    if (ready && (!hubReady || gen !== hubGeneration)) {
      ready = false;
      attempted = false;
      initializing = false;
      lost = !hubReady;
      resetGpuObjects();
      try {
        context?.unconfigure?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#warmup', error);
      }
    }
    if (!ready && !initializing && (!attempted || lost)) void initAsync();
    return ready && !lost && hubReady;
  }
  function ensureSize(w, h) {
    if (!warmup()) return false;
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    if (
      width === w &&
      height === h &&
      msaaTexture &&
      stencilTexture &&
      isolatedFillTexture &&
      canvas.width === w &&
      canvas.height === h
    )
      return true;
    width = w;
    height = h;
    canvas.width = w;
    canvas.height = h;
    context.configure({ device, format, alphaMode: 'premultiplied' });
    try {
      msaaTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#ensureSize', error);
    }
    try {
      stencilTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#ensureSize', error);
    }
    try {
      isolatedFillTexture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#ensureSize', error);
    }
    // The continuous Fade field samples isolatedFillView, so any resize/source
    // replacement invalidates its cached bind groups even when half-res dimensions
    // happen to round to the same values.
    try {
      fadeBlurTextureA?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#ensureSize', error);
    }
    try {
      fadeBlurTextureB?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#ensureSize', error);
    }
    fadeBlurTextureA = null;
    fadeBlurTextureB = null;
    fadeBlurViewA = null;
    fadeBlurViewB = null;
    fadeBlurBindGroupH = null;
    fadeBlurBindGroupV = null;
    fadeBlurWidth = 0;
    fadeBlurHeight = 0;
    msaaTexture = device.createTexture({
      label: 'SpiroStar native Fill Mesh MSAA',
      size: [w, h, 1],
      sampleCount: 4,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    stencilTexture = device.createTexture({
      label: 'SpiroStar native Fill winding stencil',
      size: [w, h, 1],
      sampleCount: 4,
      format: 'depth24plus-stencil8',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    isolatedFillTexture = device.createTexture({
      label: 'Somata isolated ordered Fill current-frame texture',
      size: [w, h, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    isolatedFillView = isolatedFillTexture.createView();
    isolatedCompositeBindGroup = null;
    return true;
  }
  function ensureUniformSlot(index) {
    let slot = uniformSlots[index];
    if (slot?.generation === hubGeneration && slot.buffer && slot.bindGroup) return slot;
    if (slot)
      try {
        slot.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#ensureUniformSlot', error);
      }
    const buffer = device.createBuffer({
      label: `SpiroStar native Fill Mesh uniform ${index}`,
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer } }],
    });
    slot = { buffer, bindGroup, lastFrameId: 0, generation: hubGeneration, index };
    uniformSlots[index] = slot;
    uniformSlotGrows++;
    return slot;
  }
  function acquireUniformSlot(frameId) {
    const total = Math.max(UNIFORM_RING, uniformSlots.length || UNIFORM_RING);
    for (let attempt = 0; attempt < total; attempt++) {
      const idx = (uniformCursor + attempt) % total,
        slot = uniformSlots[idx];
      if (!slot || slot.lastFrameId !== frameId) {
        uniformCursor = (idx + 1) % Math.max(UNIFORM_RING, uniformSlots.length || UNIFORM_RING);
        return ensureUniformSlot(idx);
      }
    }
    const idx = uniformSlots.length;
    uniformCursor = (idx + 1) % Math.max(UNIFORM_RING, idx + 1);
    return ensureUniformSlot(idx);
  }
  function getGpuMesh(mesh) {
    drainMeshEvictions();
    const dynamic = mesh?.dynamic === true;
    if (dynamic) {
      const data = mesh?.fanData,
        activeFloats = Math.max(0, Math.min(Number(mesh?.fanFloatCount) || 0, data?.length || 0)),
        n = Number(mesh?.fanTriangleCount) || Math.floor(activeFloats / 6);
      if (!data || activeFloats < 6 || n <= 0) return null;
      const bytes = activeFloats * 4,
        revision = Number(mesh?.revision) || 0;
      let rec = gpuMeshCache.get(mesh),
        part = rec?.records?.[0] || null;
      if (rec?.generation !== hubGeneration || rec?.dynamic !== true) {
        if (rec) destroyMeshRecord(rec);
        rec = null;
        part = null;
      }
      if (!rec) {
        let cap = Math.max(8, bytes);
        cap = Math.ceil(cap / 256) * 256;
        const vertexBuffer = device.createBuffer({
          label: 'Somata dynamic Corridor Fill stencil fan',
          size: cap,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        part = {
          type: 'winding',
          vertexBuffer,
          indexBuffer: null,
          vertexCount: n * 3,
          triangleCount: n,
          capacityBytes: cap,
        };
        rec = {
          records: [part],
          parts: [part],
          generation: hubGeneration,
          triangleCount: 0,
          windingTriangleCount: n,
          dynamic: true,
          revision: -1,
        };
        gpuMeshCache.set(mesh, rec);
        gpuMeshRecords.add(rec);
        bufferBuilds++;
        dynamicMeshGrows++;
      } else if (!part?.vertexBuffer || Number(part.capacityBytes || 0) < bytes) {
        let cap = Math.max(8, Number(part?.capacityBytes) || 0);
        while (cap < bytes) cap = Math.ceil(Math.max(cap * 1.6, bytes) / 256) * 256;
        const old = part?.vertexBuffer;
        part.vertexBuffer = device.createBuffer({
          label: 'Somata dynamic Corridor Fill stencil fan',
          size: cap,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        part.capacityBytes = cap;
        try {
          old?.destroy?.();
        } catch (error) {
          noteSuppressedError('gpu/fill-mesh-renderer#getGpuMesh', error);
        }
        dynamicMeshGrows++;
      } else dynamicMeshReuses++;
      part.vertexCount = n * 3;
      part.triangleCount = n;
      rec.windingTriangleCount = n;
      rec.triangleCount = 0;
      if (rec.revision !== revision) {
        device.queue.writeBuffer(part.vertexBuffer, 0, data.buffer, data.byteOffset, bytes);
        rec.revision = revision;
        dynamicMeshUploads++;
        dynamicMeshUploadBytes += bytes;
      }
      bufferHits++;
      return rec;
    }
    let rec = gpuMeshCache.get(mesh);
    if (rec?.generation === hubGeneration) {
      bufferHits++;
      return rec;
    }
    if (rec) destroyMeshRecord(rec);
    const records = [];
    let triangleCount = 0,
      windingTriangleCount = 0;

    if (mesh?.fanData?.length) {
      const data = mesh.fanData,
        activeFloats = Math.max(0, Math.min(Number(mesh?.fanFloatCount) || data.length, data.length));
      const vertexBuffer = device.createBuffer({
        label: 'SpiroStar Fill canonical stencil fan vertices',
        size: Math.max(8, activeFloats * 4),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(vertexBuffer, 0, data.buffer, data.byteOffset, activeFloats * 4);
      const n = mesh.fanTriangleCount || Math.floor(activeFloats / 6);
      records.push({
        type: 'winding',
        vertexBuffer,
        indexBuffer: null,
        vertexCount: n * 3,
        triangleCount: n,
      });
      windingTriangleCount += n;
    } else
      for (const item of mesh?.records || []) {
        if (item?.status === 'mesh' && item.vertexData?.length && item.indexData?.length) {
          const vertexBuffer = device.createBuffer({
            label: 'SpiroStar Fill Mesh vertices',
            size: Math.max(8, item.vertexData.byteLength),
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          const indexBuffer = device.createBuffer({
            label: 'SpiroStar Fill Mesh indices',
            size: Math.max(4, item.indexData.byteLength),
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(
            vertexBuffer,
            0,
            item.vertexData.buffer,
            item.vertexData.byteOffset,
            item.vertexData.byteLength,
          );
          device.queue.writeBuffer(
            indexBuffer,
            0,
            item.indexData.buffer,
            item.indexData.byteOffset,
            item.indexData.byteLength,
          );
          records.push({
            type: 'mesh',
            vertexBuffer,
            indexBuffer,
            indexCount: item.indexData.length,
            indexFormat: item.indexData instanceof Uint32Array ? 'uint32' : 'uint16',
            triangleCount: item.triangleCount || item.indexData.length / 3,
          });
          triangleCount += item.triangleCount || item.indexData.length / 3;
        } else if (item?.status === 'winding-stencil' && item.fanData?.length) {
          const vertexBuffer = device.createBuffer({
            label: 'SpiroStar Fill winding fan vertices',
            size: Math.max(8, item.fanData.byteLength),
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(
            vertexBuffer,
            0,
            item.fanData.buffer,
            item.fanData.byteOffset,
            item.fanData.byteLength,
          );
          const n = item.windingTriangleCount || Math.floor(item.fanData.length / 6);
          records.push({
            type: 'winding',
            vertexBuffer,
            indexBuffer: null,
            vertexCount: n * 3,
            triangleCount: n,
          });
          windingTriangleCount += n;
        }
      }
    if (!records.length) return null;
    rec = { records, parts: records, generation: hubGeneration, triangleCount, windingTriangleCount };
    gpuMeshCache.set(mesh, rec);
    gpuMeshRecords.add(rec);
    bufferBuilds++;
    return rec;
  }
  function affineForFrame(frameCtx, targetCtx, copy = null, mesh = null) {
    if (mesh?.dynamicScreenSpace === true) {
      if (!copy) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const src = targetCtx.getTransform(),
        ox = Number(src?.e) || 0,
        oy = Number(src?.f) || 0;
      let lag = 0;
      try {
        lag = Number(getMotionTunnelLagRadians?.(copy, frameCtx?.layer)) || 0;
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#affineForFrame', error);
      }
      const sc = Math.max(0.000001, Math.abs(Number(copy?.scale) || 0)),
        lc = Math.cos(lag),
        ls = Math.sin(lag);
      const a = sc * lc,
        b = sc * ls,
        c = -sc * ls,
        d = sc * lc;
      return { a, b, c, d, e: ox - (a * ox + c * oy), f: oy - (b * ox + d * oy) };
    }
    const src = targetCtx.getTransform();
    let a = src.a,
      b = src.b,
      c = src.c,
      d = src.d,
      e = src.e,
      f = src.f;

    if (copy) {
      let lag = 0;
      try {
        lag = Number(getMotionTunnelLagRadians?.(copy, frameCtx?.layer)) || 0;
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#affineForFrame', error);
      }
      const lc = Math.cos(lag),
        ls = Math.sin(lag),
        na = a * lc + c * ls,
        nb = b * lc + d * ls,
        nc = a * -ls + c * lc,
        nd = b * -ls + d * lc,
        sc = Number(copy?.scale) || 0;
      a = na * sc;
      b = nb * sc;
      c = nc * sc;
      d = nd * sc;
    }
    const rot = frameCtx?.hasCombinedRotation ? Number(frameCtx.combinedRotationRad) || 0 : 0,
      scale = frameCtx?.hasCombinedScale ? Number(frameCtx.combinedScale) || 1 : 1,
      cc = Math.cos(rot) * scale,
      ss = Math.sin(rot) * scale;
    return { a: a * cc + c * ss, b: b * cc + d * ss, c: a * -ss + c * cc, d: b * -ss + d * cc, e, f };
  }
  function fillSpiralCenterShade(frameCtx, targetCtx) {
    if (
      state?.tunnel?.active !== true ||
      typeof isSpiralLayer !== 'function' ||
      !isSpiralLayer(frameCtx?.layer)
    )
      return null;
    // Match Spiral Glow/Base soft center gradient, without changing the
    // Fill topology. Only Spiral uses this mask; polygon Fill remains on
    // Corridor copy-alpha. Center shade = 0 disables the mask entirely.
    const spiral =
      typeof WebGPUSpiralBezierMorphRenderer !== 'undefined' ? WebGPUSpiralBezierMorphRenderer : null;
    const spec = spiral?.debugCenterShadeSpec?.(frameCtx);
    if (spec?.enabled !== true) return null;
    const t = targetCtx?.getTransform?.();
    if (!t) return null;
    const screenScale = Math.sqrt(Math.max(1e-12, Math.abs(t.a * t.d - t.b * t.c)));
    return {
      cx: Number(t.e) || 0,
      cy: Number(t.f) || 0,
      inner: spec.startRadius * screenScale,
      outer: spec.endRadius * screenScale,
    };
  }
  function prepareUniformSlot(frameCtx, targetCtx, copyIndex = null, mesh = null, weight = 1, power = 1) {
    const copies = frameCtx.visibleInstances?.copies || [],
      copy = copyIndex == null ? null : copies[copyIndex];
    const fillColor =
      frameCtx.layer?.__morphOrbitFillCompositeColor ||
      (isSpiralLayer(frameCtx.layer)
        ? somataEffectiveSpiralFillColor(frameCtx.layer)
        : frameCtx.layer?.fillColor || frameCtx.layer?.strokeColor || '#ffffff');
    const shiftedFill =
      copy && mesh?.corridorBaked !== true && typeof getTunnelCopyColor === 'function'
        ? getTunnelCopyColor(fillColor, copy, frameCtx.tunnelFillPaletteProfile, frameCtx.layer)
        : fillColor;
    const rgba = GPUColorCache.rgba(shiftedFill);
    const alphaList = frameCtx.visibleInstances?.fillAlphas || frameCtx.visibleInstances?.alphas || [];
    const copyAlpha =
      mesh?.corridorBaked === true
        ? 1
        : Math.max(0, Math.min(1, Number(alphaList[copyIndex == null ? 0 : copyIndex] ?? 1)));
    const linear = Math.max(
      0,
      Math.min(1, rgba[3] * Math.max(0, Number(frameCtx.baseAlpha) || 0) * copyAlpha * weight),
    );
    // Доля α для перекрывающихся групп заливки: 1−(1−α)^p (см. fill-plan, лишние контуры морфа).
    const alpha = power === 1 ? linear : 1 - Math.pow(1 - linear, Math.max(0, power));
    if (alpha <= 0.00001) return { empty: true, slot: null };
    const m = affineForFrame(frameCtx, targetCtx, copy, mesh),
      frameId = Math.max(1, Number(frameCtx?.frameId) || Number(renderRuntime?.frameId) || 1),
      slot = acquireUniformSlot(frameId);
    fullUniform[0] = width;
    fullUniform[1] = height;
    fullUniform[2] = 0;
    fullUniform[3] = 0;
    fullUniform[4] = m.a;
    fullUniform[5] = m.c;
    fullUniform[6] = m.e;
    fullUniform[7] = 0;
    fullUniform[8] = m.b;
    fullUniform[9] = m.d;
    fullUniform[10] = m.f;
    fullUniform[11] = 0;
    fullUniform[12] = rgba[0];
    fullUniform[13] = rgba[1];
    fullUniform[14] = rgba[2];
    fullUniform[15] = alpha;
    const centerShade = fillSpiralCenterShade(frameCtx, targetCtx);
    fullUniform[16] = centerShade?.cx || 0;
    fullUniform[17] = centerShade?.cy || 0;
    fullUniform[18] = centerShade?.inner || 0;
    fullUniform[19] = centerShade?.outer || 0;
    device.queue.writeBuffer(slot.buffer, 0, fullUniform);
    slot.lastFrameId = frameId;
    return { empty: false, slot };
  }
  function encodeMeshPass(
    encoder,
    targetTexture,
    frameCtx,
    mesh,
    targetCtx,
    corridor = false,
    preserveTarget = false,
  ) {
    // A Layer Scene can outlive a canvas resize. GPU resolveTarget and MSAA
    // attachment *must* have identical pixel dimensions: never encode against
    // mainCanvas dimensions while the supplied GPUTexture is a different size.
    if (!encoder || !targetTexture || !frameCtx || !mesh?.nativeComplete || !targetCtx)
      return { handled: false, triangles: 0, windingTriangles: 0 };
    const targetW = Number(targetTexture.width) || mainCanvas.width;
    const targetH = Number(targetTexture.height) || mainCanvas.height;
    if (targetW !== mainCanvas.width || targetH !== mainCanvas.height) {
      lastError = `Fill scene/viewport resize pending: ${targetW}x${targetH} vs ${mainCanvas.width}x${mainCanvas.height}`;
      return { handled: false, triangles: 0, windingTriangles: 0, reason: lastError };
    }
    if (!ensureSize(targetW, targetH)) return { handled: false, triangles: 0, windingTriangles: 0 };
    const gpu = getGpuMesh(mesh);
    if (!gpu) return { handled: false, triangles: 0, windingTriangles: 0 };
    const copyCount = corridor ? Math.max(0, frameCtx.visibleInstances?.copies?.length || 0) : 1;
    if (corridor && !copyCount) return { handled: true, triangles: 0, windingTriangles: 0 };
    try {
      let first = true,
        totalTriangles = 0,
        totalWinding = 0,
        visibleCopies = 0;
      for (let ci = 0; ci < copyCount; ci++) {
        const prepared = prepareUniformSlot(frameCtx, targetCtx, corridor ? ci : null, mesh);
        if (prepared.empty) continue;
        visibleCopies++;
        for (const part of gpu.records) {
          if (part.type === 'mesh') {
            const pass = encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: msaaTexture.createView(),
                  resolveTarget: targetTexture.createView(),
                  clearValue: { r: 0, g: 0, b: 0, a: 0 },
                  loadOp: first && !preserveTarget ? 'clear' : 'load',
                  storeOp: 'store',
                },
              ],
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, prepared.slot.bindGroup);
            pass.setVertexBuffer(0, part.vertexBuffer);
            pass.setIndexBuffer(part.indexBuffer, part.indexFormat);
            pass.drawIndexed(part.indexCount);
            pass.end();
            draws++;
            first = false;
            totalTriangles += part.triangleCount;
          } else if (part.type === 'winding') {
            // A cross-fading morph draws the outgoing and incoming shapes as separate
            // stencil groups, each with its own Fill alpha (no even-odd cancellation).
            const groups = Array.isArray(mesh.fanGroups) ? mesh.fanGroups : [null];
            for (const group of groups) {
              const groupPrepared =
                group && (Math.abs(group.weight - 1) > 1e-3 || (group.power ?? 1) !== 1)
                  ? prepareUniformSlot(
                      frameCtx,
                      targetCtx,
                      corridor ? ci : null,
                      mesh,
                      group.weight,
                      group.power ?? 1,
                    )
                  : prepared;
              if (groupPrepared.empty) continue;
              const pass = encoder.beginRenderPass({
                colorAttachments: [
                  {
                    view: msaaTexture.createView(),
                    resolveTarget: targetTexture.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: first && !preserveTarget ? 'clear' : 'load',
                    storeOp: 'store',
                  },
                ],
                depthStencilAttachment: {
                  view: stencilTexture.createView(),
                  depthClearValue: 1,
                  depthLoadOp: 'clear',
                  depthStoreOp: 'discard',
                  stencilClearValue: 0,
                  stencilLoadOp: 'clear',
                  stencilStoreOp: 'discard',
                },
              });
              // An orbit split repeats identical closed paths at the
              // boundary. Even-odd stencil would cancel on even
              // overlap counts (Fill appears OFF); winding keeps
              // the covered union with one composite Fill alpha.
              const mathematical =
                !frameCtx.layer?.__morphOrbitFillCompositeColor &&
                getLayerFillRule(frameCtx.layer) === 'evenodd';
              pass.setStencilReference(0);
              pass.setPipeline(mathematical ? parityStencilPipeline : windingStencilPipeline);
              pass.setBindGroup(0, groupPrepared.slot.bindGroup);
              pass.setVertexBuffer(0, part.vertexBuffer);
              pass.draw(group ? group.count * 3 : part.vertexCount, 1, group ? group.start * 3 : 0);
              if (mathematical) parityDraws++;
              else windingDraws++;
              totalWinding += group ? group.count : part.triangleCount;
              pass.setPipeline(mathematical ? parityCoverPipeline : windingCoverPipeline);
              pass.setBindGroup(0, groupPrepared.slot.bindGroup);
              pass.draw(3);
              if (mathematical) parityCovers++;
              else windingCovers++;
              pass.end();
              draws++;
              first = false;
            }
          }
        }
      }

      return {
        handled: true,
        triangles: totalTriangles,
        windingTriangles: totalWinding,
        visibleCopies,
        empty: visibleCopies === 0,
      };
    } catch (err) {
      lastError = String(err?.message || err);
      fallbacks++;
      return { handled: false, triangles: 0, windingTriangles: 0 };
    }
  }
  function appendIsolatedFillComposite(encoder, targetTexture, clearTarget = false) {
    if (
      !encoder ||
      !targetTexture ||
      !isolatedFillTexture ||
      !isolatedFillView ||
      !isolatedCompositePipeline ||
      !isolatedCompositeSampler
    )
      return false;
    try {
      if (!isolatedCompositeBindGroup)
        isolatedCompositeBindGroup = device.createBindGroup({
          layout: isolatedCompositePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: isolatedFillView },
            { binding: 1, resource: isolatedCompositeSampler },
          ],
        });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: clearTarget ? 'clear' : 'load',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(isolatedCompositePipeline);
      pass.setBindGroup(0, isolatedCompositeBindGroup);
      pass.draw(3);
      pass.end();
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function fillBoundaryRadiusPx(frameCtx, mesh, targetCtx) {
    const data = mesh?.fanData,
      limit = Math.max(0, Math.min(Number(mesh?.fanFloatCount) || data?.length || 0, data?.length || 0));
    if (!data || limit < 6) return Math.max(8, Math.min(width, height) * 0.18);
    const m = affineForFrame(frameCtx, targetCtx, null, mesh);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    // fanData = [anchor,a,b] per edge. Ignore the synthetic far-away anchor:
    // only a/b describe the visible contour.
    for (let i = 0; i + 5 < limit; i += 6) {
      for (const j of [i + 2, i + 4]) {
        const x = Number(data[j]),
          y = Number(data[j + 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const sx = m.a * x + m.c * y + m.e,
          sy = m.b * x + m.d * y + m.f;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY))
      return Math.max(8, Math.min(width, height) * 0.18);
    const w = Math.max(1, maxX - minX),
      h = Math.max(1, maxY - minY);
    return Math.max(4, Math.min(Math.min(w, h) * 0.5, Math.min(width, height) * 0.45));
  }
  function ensureFadeBlurResources() {
    if (
      !fadeBlurPipelineH ||
      !fadeBlurPipelineV ||
      !fadeSmoothCompositePipeline ||
      !fadeBlurUniformBuffer ||
      !isolatedFillView ||
      !fadeSmoothSampler
    )
      return false;
    const bw = Math.max(1, Math.ceil(width * 0.5)),
      bh = Math.max(1, Math.ceil(height * 0.5));
    if (
      fadeBlurTextureA &&
      fadeBlurTextureB &&
      fadeBlurWidth === bw &&
      fadeBlurHeight === bh &&
      fadeBlurBindGroupH &&
      fadeBlurBindGroupV
    )
      return true;
    try {
      fadeBlurTextureA?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#ensureFadeBlurResources', error);
    }
    try {
      fadeBlurTextureB?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#ensureFadeBlurResources', error);
    }
    fadeBlurTextureA = device.createTexture({
      label: 'Somata 7.11.0 Fade field H 1/2-res',
      size: [bw, bh, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    fadeBlurTextureB = device.createTexture({
      label: 'Somata 7.11.0 Fade field V 1/2-res',
      size: [bw, bh, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    fadeBlurViewA = fadeBlurTextureA.createView();
    fadeBlurViewB = fadeBlurTextureB.createView();
    fadeBlurWidth = bw;
    fadeBlurHeight = bh;
    fadeBlurBindGroupH = device.createBindGroup({
      layout: fadeBlurPipelineH.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: isolatedFillView },
        { binding: 1, resource: fadeSmoothSampler },
        { binding: 2, resource: { buffer: fadeBlurUniformBuffer } },
      ],
    });
    fadeBlurBindGroupV = device.createBindGroup({
      layout: fadeBlurPipelineV.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: fadeBlurViewA },
        { binding: 1, resource: fadeSmoothSampler },
        { binding: 2, resource: { buffer: fadeBlurUniformBuffer } },
      ],
    });
    return true;
  }
  const fadeBlurUniformScratch = new Float32Array(4);
  function appendContinuousFadeField(encoder, radius) {
    if (!encoder || !ensureFadeBlurResources()) return false;
    // Nine taps per axis on a half-resolution target.  The farthest tap is
    // exactly the requested contour radius; this replaces 24 full-resolution
    // directional samples with a much smoother and cheaper separable field.
    fadeBlurUniformScratch[0] = Math.max(1, radius) / (4 * Math.max(1, width));
    fadeBlurUniformScratch[1] = Math.max(1, radius) / (4 * Math.max(1, height));
    fadeBlurUniformScratch[2] = 0;
    fadeBlurUniformScratch[3] = 0;
    device.queue.writeBuffer(fadeBlurUniformBuffer, 0, fadeBlurUniformScratch);
    const clear = { r: 0, g: 0, b: 0, a: 0 };
    const ph = encoder.beginRenderPass({
      colorAttachments: [{ view: fadeBlurViewA, clearValue: clear, loadOp: 'clear', storeOp: 'store' }],
    });
    ph.setPipeline(fadeBlurPipelineH);
    ph.setBindGroup(0, fadeBlurBindGroupH);
    ph.draw(3);
    ph.end();
    const pv = encoder.beginRenderPass({
      colorAttachments: [{ view: fadeBlurViewB, clearValue: clear, loadOp: 'clear', storeOp: 'store' }],
    });
    pv.setPipeline(fadeBlurPipelineV);
    pv.setBindGroup(0, fadeBlurBindGroupV);
    pv.draw(3);
    pv.end();
    return true;
  }
  function fadeStyleRecord(frameCtx) {
    const key = String(frameCtx?.layer?.id || `layer-${Number(frameCtx?.layerIndex) || 0}`);
    let rec = fadeStyleRecords.get(key);
    if (!rec || rec.generation !== hubGeneration) {
      try {
        rec?.buffer?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/fill-mesh-renderer#fadeStyleRecord', error);
      }
      rec = {
        generation: hubGeneration,
        buffer: device.createBuffer({
          label: `Somata fading Fill uniform ${key}`,
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
      };
      fadeStyleRecords.set(key, rec);
    }
    return rec;
  }
  function appendFadingFillComposite(encoder, targetTexture, frameCtx, mesh, targetCtx, clearTarget = false) {
    if (
      !encoder ||
      !targetTexture ||
      !fadeCompositePipeline ||
      !isolatedCompositeSampler ||
      !isolatedFillView
    ) {
      if (!fadeCompositePipeline && fadeCompositeError) lastError = fadeCompositeError;
      return false;
    }
    try {
      const rec = fadeStyleRecord(frameCtx),
        hardness = getLayerFillFadeHardness(frameCtx?.effectLayer || frameCtx?.layer) / 100;
      const layer = frameCtx?.effectLayer || frameCtx?.layer;
      const direction = getLayerFillFadeDirection(layer) === 'toCenter' ? 1 : 0;
      const fillType = getLayerFillType(layer);
      const smoothMode = fillType === 'fadeSmooth' ? 1 : 0;
      const pixelization = getLayerFillFadePixelization(layer) / 100;
      const radius = fillBoundaryRadiusPx(frameCtx, mesh, targetCtx);
      fadeUniformScratch[0] = width;
      fadeUniformScratch[1] = height;
      fadeUniformScratch[2] = radius;
      fadeUniformScratch[3] = hardness;
      fadeUniformScratch[4] = direction;
      fadeUniformScratch[5] = smoothMode;
      fadeUniformScratch[6] = pixelization;
      fadeUniformScratch[7] = 0;
      device.queue.writeBuffer(rec.buffer, 0, fadeUniformScratch);

      // Smooth Fade, and Sharp Fade above its 25% legacy baseline, use the
      // new continuous field.  At <=25% Sharp stays on the established cheap
      // binary-ring path; this preserves the stable 7.9 look and avoids extra
      // offscreen passes unless the user actually asks for finer gradation.
      const wantsContinuous =
        (smoothMode === 1 || pixelization > 0.2501) && hardness > 0.0001 && hardness < 0.9999;
      const continuousReady =
        wantsContinuous &&
        fadeSmoothCompositePipeline &&
        fadeSmoothSampler &&
        appendContinuousFadeField(encoder, radius);
      if (continuousReady) {
        const bindGroup = device.createBindGroup({
          layout: fadeSmoothCompositePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: isolatedFillView },
            { binding: 1, resource: isolatedCompositeSampler },
            { binding: 2, resource: fadeBlurViewB },
            { binding: 3, resource: fadeSmoothSampler },
            { binding: 4, resource: { buffer: rec.buffer } },
          ],
        });
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targetTexture.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: clearTarget ? 'clear' : 'load',
              storeOp: 'store',
            },
          ],
        });
        pass.setPipeline(fadeSmoothCompositePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        return true;
      }

      const fadeSampler = smoothMode && fadeSmoothSampler ? fadeSmoothSampler : isolatedCompositeSampler;
      const bindGroup = device.createBindGroup({
        layout: fadeCompositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: isolatedFillView },
          { binding: 1, resource: fadeSampler },
          { binding: 2, resource: { buffer: rec.buffer } },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: clearTarget ? 'clear' : 'load',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(fadeCompositePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  // Accumulating Fill owns a full-resolution GPUTexture per layer ID.
  // Orange regenerates those IDs indefinitely; without eviction, the
  // old history textures and timer closures survive until device reset.
  function disposeAccumulatingFillHistory(key, rec) {
    try {
      clearTimeout(rec?.timerHandle);
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#disposeAccumulatingFillHistory', error);
    }
    try {
      rec?.texture?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/fill-mesh-renderer#disposeAccumulatingFillHistory', error);
    }
    fillHistoryRecords.delete(key);
  }
  function pruneAccumulatingFillHistory(frameId, activeKey) {
    const maxRecords = 8,
      staleFrames = 150;
    for (const [key, rec] of fillHistoryRecords) {
      if (key !== activeKey && frameId - (Number(rec.lastUsedFrame) || 0) > staleFrames)
        disposeAccumulatingFillHistory(key, rec);
    }
    if (fillHistoryRecords.size > maxRecords) {
      const oldest = [...fillHistoryRecords.entries()]
        .filter(([key]) => key !== activeKey)
        .sort((a, b) => (a[1].lastUsedFrame || 0) - (b[1].lastUsedFrame || 0));
      for (const [key, rec] of oldest) {
        if (fillHistoryRecords.size <= maxRecords) break;
        if (frameId - (Number(rec.lastUsedFrame) || 0) > 4) disposeAccumulatingFillHistory(key, rec);
      }
    }
  }
  function accumulationHistoryRecord(frameCtx) {
    const key = String(frameCtx?.layer?.id || `layer-${Number(frameCtx?.layerIndex) || 0}`);
    const frameId = Number(frameCtx?.frameId) || Number(renderRuntime?.frameId) || 1;
    let rec = fillHistoryRecords.get(key);
    if (!rec || rec.generation !== hubGeneration || rec.width !== width || rec.height !== height) {
      if (rec) disposeAccumulatingFillHistory(key, rec);
      const texture = device.createTexture({
        label: `Somata accumulating Fill history ${key}`,
        size: [width, height, 1],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      rec = {
        generation: hubGeneration,
        width,
        height,
        texture,
        view: texture.createView(),
        bindGroup: null,
        cycleStartMs: 0,
        lastFrameId: -1,
        timerSec: 0,
        timerHandle: null,
        forceReset: false,
      };
      fillHistoryRecords.set(key, rec);
    }
    rec.lastUsedFrame = frameId;
    pruneAccumulatingFillHistory(frameId, key);
    if (!rec.bindGroup)
      rec.bindGroup = device.createBindGroup({
        layout: isolatedCompositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: rec.view },
          { binding: 1, resource: isolatedCompositeSampler },
        ],
      });
    return rec;
  }
  function appendAccumulatingFillComposite(encoder, targetTexture, frameCtx, clearTarget = false) {
    if (
      !encoder ||
      !targetTexture ||
      !isolatedCompositePipeline ||
      !isolatedCompositeSampler ||
      !isolatedFillView
    )
      return false;
    try {
      if (!isolatedCompositeBindGroup)
        isolatedCompositeBindGroup = device.createBindGroup({
          layout: isolatedCompositePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: isolatedFillView },
            { binding: 1, resource: isolatedCompositeSampler },
          ],
        });
      const rec = accumulationHistoryRecord(frameCtx),
        frameId = Number(frameCtx?.frameId) || 0,
        now = Number(frameCtx?.frame?.now ?? frameCtx?.now) || performance.now();
      const timerSec = getLayerFillAccumulationSeconds(frameCtx?.effectLayer || frameCtx?.layer);
      const timerChanged = Math.abs(Number(rec.timerSec || 0) - timerSec) > 0.0001;
      const discontinuity = rec.lastFrameId >= 0 && frameId > rec.lastFrameId + 1;
      const expired = rec.cycleStartMs > 0 && now - rec.cycleStartMs >= timerSec * 1000;
      const reset =
        rec.forceReset === true ||
        rec.cycleStartMs <= 0 ||
        timerChanged ||
        discontinuity ||
        expired ||
        frameId <= rec.lastFrameId;
      if (reset) {
        rec.forceReset = false;
        rec.cycleStartMs = now;
        try {
          clearTimeout(rec.timerHandle);
        } catch (error) {
          noteSuppressedError('gpu/fill-mesh-renderer#appendAccumulatingFillComposite', error);
        }
        rec.timerHandle = setTimeout(
          () => {
            rec.forceReset = true;
            try {
              requestMainCanvasRender?.();
            } catch (error) {
              noteSuppressedError('gpu/fill-mesh-renderer#appendAccumulatingFillComposite', error);
            }
          },
          Math.max(100, timerSec * 1000),
        );
      }
      rec.timerSec = timerSec;
      rec.lastFrameId = frameId;
      const accumulatePass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: rec.view,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: reset ? 'clear' : 'load',
            storeOp: 'store',
          },
        ],
      });
      accumulatePass.setPipeline(isolatedCompositePipeline);
      accumulatePass.setBindGroup(0, isolatedCompositeBindGroup);
      accumulatePass.draw(3);
      accumulatePass.end();
      const compositePass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: clearTarget ? 'clear' : 'load',
            storeOp: 'store',
          },
        ],
      });
      compositePass.setPipeline(isolatedCompositePipeline);
      compositePass.setBindGroup(0, rec.bindGroup);
      compositePass.draw(3);
      compositePass.end();
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      return false;
    }
  }
  function appendStyledFillComposite(encoder, targetTexture, frameCtx, mesh, targetCtx, clearTarget = false) {
    const type = getLayerFillType(frameCtx?.effectLayer || frameCtx?.layer);
    if (type === 'accumulation')
      return appendAccumulatingFillComposite(encoder, targetTexture, frameCtx, clearTarget);
    if (type === 'fade' || type === 'fadeSmooth')
      return appendFadingFillComposite(encoder, targetTexture, frameCtx, mesh, targetCtx, clearTarget);
    return appendIsolatedFillComposite(encoder, targetTexture, clearTarget);
  }
  function encodeIsolatedMeshCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    corridor = false,
    clearTarget = false,
  ) {
    if (!targetTexture || !canEncodeToTexture(frameCtx, mesh))
      return { handled: false, commandBuffer: null, reason: lastError || 'isolated Fill renderer not ready' };
    // Synchronize the isolated source with the destination *before* encoding;
    // the old code could keep a stale 1415x828 source while the Layer Scene
    // had already changed to 1920x1080 (and vice versa).
    const targetW = Number(targetTexture.width) || mainCanvas.width;
    const targetH = Number(targetTexture.height) || mainCanvas.height;
    if (targetW !== mainCanvas.width || targetH !== mainCanvas.height)
      return {
        handled: false,
        commandBuffer: null,
        reason: `Fill scene/viewport resize pending: ${targetW}x${targetH} vs ${mainCanvas.width}x${mainCanvas.height}`,
      };
    if (!ensureSize(targetW, targetH) || !isolatedFillTexture)
      return { handled: false, commandBuffer: null, reason: lastError || 'isolated Fill resize not ready' };
    try {
      const encoder = device.createCommandEncoder({
        label: corridor ? 'Somata isolated Corridor Fill encoder' : 'Somata isolated ordered Fill encoder',
      });
      // Critical invariant: the MSAA attachment always starts from transparent for
      // an isolated Fill.  Loading it would retain the previous frame and make a
      // normal translucent Fill accumulate whenever Web forces a separate pass.
      const rec = encodeMeshPass(encoder, isolatedFillTexture, frameCtx, mesh, targetCtx, corridor, false);
      if (!rec.handled)
        return { ...rec, commandBuffer: null, reason: lastError || 'isolated Fill encode failed' };
      if (rec.empty) return { ...rec, commandBuffer: null, isolated: true };
      if (!appendStyledFillComposite(encoder, targetTexture, frameCtx, mesh, targetCtx, clearTarget))
        return { handled: false, commandBuffer: null, reason: lastError || 'styled Fill composite failed' };
      const commandBuffer = encoder.finish();
      isolatedEncodes++;
      directEncodes++;
      directTriangles += rec.triangles + rec.windingTriangles;
      return { ...rec, commandBuffer, isolated: true };
    } catch (err) {
      lastError = String(err?.message || err);
      fallbacks++;
      return { handled: false, commandBuffer: null, reason: lastError };
    }
  }
  function canEncodeToTexture(frameCtx, mesh) {
    warmup();
    return Boolean(ready && !lost && WebGPUDeviceHub.isReady() && frameCtx && mesh?.nativeComplete);
  }
  function encodeToTexture(encoder, targetTexture, frameCtx, mesh, targetCtx = mainCtx) {
    const rec = encodeMeshPass(encoder, targetTexture, frameCtx, mesh, targetCtx, false);
    if (rec.handled) {
      directEncodes++;
      directTriangles += rec.triangles + rec.windingTriangles;
    }
    return rec;
  }
  function encodeMeshCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    preserveTarget = false,
  ) {
    if (!targetTexture || !canEncodeToTexture(frameCtx, mesh))
      return { handled: false, commandBuffer: null, reason: lastError || 'native Fill renderer not ready' };
    const special = getLayerFillType(frameCtx?.effectLayer || frameCtx?.layer) !== 'normal';
    if (special)
      return encodeIsolatedMeshCommandToTexture(targetTexture, frameCtx, mesh, targetCtx, !preserveTarget);
    try {
      const encoder = device.createCommandEncoder({
          label: 'Somata interwinding Spiral Fill Layer Scene encoder',
        }),
        rec = encodeMeshPass(encoder, targetTexture, frameCtx, mesh, targetCtx, false, preserveTarget);
      if (!rec.handled) return { ...rec, commandBuffer: null, reason: lastError || 'Fill encode failed' };
      if (rec.empty) return { ...rec, commandBuffer: null };
      const commandBuffer = encoder.finish();
      directEncodes++;
      directTriangles += rec.triangles + rec.windingTriangles;
      return { ...rec, commandBuffer };
    } catch (err) {
      lastError = String(err?.message || err);
      fallbacks++;
      return { handled: false, commandBuffer: null, reason: lastError };
    }
  }
  function encodeCorridorCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    preserveTarget = false,
  ) {
    if (!targetTexture || !canEncodeToTexture(frameCtx, mesh))
      return { handled: false, commandBuffer: null, reason: lastError || 'native Fill renderer not ready' };
    const special = getLayerFillType(frameCtx?.effectLayer || frameCtx?.layer) !== 'normal';
    if (special)
      return encodeCorridorIsolatedCommandToTexture(
        targetTexture,
        frameCtx,
        mesh,
        targetCtx,
        !preserveTarget,
      );
    try {
      const encoder = device.createCommandEncoder({
          label: 'SpiroStar native Corridor Fill Layer Scene encoder',
        }),
        rec = encodeMeshPass(encoder, targetTexture, frameCtx, mesh, targetCtx, true, preserveTarget);
      if (!rec.handled)
        return { ...rec, commandBuffer: null, reason: lastError || 'Corridor Fill encode failed' };
      if (rec.empty) return { ...rec, commandBuffer: null };
      const commandBuffer = encoder.finish();
      directEncodes++;
      directTriangles += rec.triangles + rec.windingTriangles;
      return { ...rec, commandBuffer };
    } catch (err) {
      lastError = String(err?.message || err);
      fallbacks++;
      return { handled: false, commandBuffer: null, reason: lastError };
    }
  }
  function encodeMeshIsolatedCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    clearTarget = false,
  ) {
    return encodeIsolatedMeshCommandToTexture(targetTexture, frameCtx, mesh, targetCtx, false, clearTarget);
  }
  function encodeCorridorIsolatedCommandToTexture(
    targetTexture,
    frameCtx,
    mesh,
    targetCtx = mainCtx,
    clearTarget = false,
  ) {
    return encodeIsolatedMeshCommandToTexture(targetTexture, frameCtx, mesh, targetCtx, true, clearTarget);
  }
  function render(frameCtx, mesh, targetCtx) {
    if (!frameCtx || !mesh?.nativeComplete || !targetCtx || !ensureSize(mainCanvas.width, mainCanvas.height))
      return false;
    try {
      const encoder = device.createCommandEncoder({ label: 'SpiroStar native Fill Mesh encoder' }),
        current = context.getCurrentTexture();
      const rec = encodeMeshPass(encoder, current, frameCtx, mesh, targetCtx);
      if (!rec.handled) return false;
      device.queue.submit([encoder.finish()]);
      submissions++;
      renderedTriangles += rec.triangles + rec.windingTriangles;
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = 'source-over';
      targetCtx.filter = 'none';
      targetCtx.drawImage(canvas, 0, 0);
      targetCtx.restore();
      return true;
    } catch (err) {
      lastError = String(err?.message || err);
      fallbacks++;
      return false;
    }
  }
  function clear() {
    /* render pass clears every presentation */
  }
  function status() {
    warmup();
    return {
      supported: !!navigator?.gpu,
      available: ready && !lost && WebGPUDeviceHub.isReady(),
      attempted,
      initializing,
      lost,
      lastError,
      width,
      height,
      submissions,
      draws,
      bufferBuilds,
      bufferHits,
      gpuEvictions,
      residentMeshRecords: gpuMeshRecords.size,
      fallbacks,
      renderedTriangles,
      directEncodes,
      directTriangles,
      isolatedEncodes,
      windingDraws,
      windingCovers,
      parityDraws,
      parityCovers,
      windingTriangles,
      uniformSlots: uniformSlots.length,
      uniformSlotGrows,
      dynamicMeshUploads,
      dynamicMeshUploadBytes,
      dynamicMeshGrows,
      dynamicMeshReuses,
      fillHistoryLayers: fillHistoryRecords.size,
      fillHistoryLimit: 8,
      fadeStyleLayers: fadeStyleRecords.size,
      fadeAvailable: !!fadeCompositePipeline,
      fadeError: fadeCompositeError,
      fadeContinuousAvailable: !!(fadeBlurPipelineH && fadeBlurPipelineV && fadeSmoothCompositePipeline),
      fadeContinuousError: fadeAdvancedError,
      fadeFieldResolution: fadeBlurWidth && fadeBlurHeight ? [fadeBlurWidth, fadeBlurHeight] : null,
      msaa: 4,
      stencilFormat: 'depth24plus-stencil8',
      hubGeneration,
    };
  }
  return {
    warmup,
    isReady: () => warmup(),
    canEncodeToTexture,
    encodeToTexture,
    encodeMeshCommandToTexture,
    encodeCorridorCommandToTexture,
    encodeMeshIsolatedCommandToTexture,
    encodeCorridorIsolatedCommandToTexture,
    render,
    clear,
    status,
  };
})();

export { WebGPUFillMeshRenderer };
