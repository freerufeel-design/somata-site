import './topology-morph-base-renderer.js'; // initialisation order: this module runs after it
import { getRoundingStrength, interpolateMorphRounding } from '../core/palette.js';
import { runtimeState, somataFourierActive, state } from '../core/state.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { isPreSampledSplineLayer, setPreSampledSplineLayer } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { getEffectiveLayerRadius, getMotionTunnelLagRadians } from '../effects/motion.js';
import { SomataCorridorCopyFrame } from '../render/corridor-copy-frame.js';
import { buildSpiralBezierSegments } from '../geometry/spiral/bezier-carrier.js';
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralClosureRatio,
  getSpiralGeometryLayer,
  isSpiralLayer,
} from '../geometry/spiral/order-params.js';
import { buildOrbitPolylines } from '../geometry/orbit-builder.js';
import { WebGPUDeviceHub } from './device-hub.js';
import { GPUColorCache, assertWebGPUShaderModule } from './gpu-utils.js';
import { WebGPUStrokeRenderer } from './stroke-renderer.js';
import { applyLayerFrameEffectTransform } from '../geometry/frame-paths.js';
import { MorphRendering, profileModeTransitionProgress } from '../geometry/morph.js';
import {
  getStaticSpiralBezierResource,
  gpuArcEncoderInputT,
  invalidateGpuMorphArcResources,
  warmupGpuMorphArcResource,
} from './morph-arc-resource.js';
import { SomataLayerSceneService, queueLayerSceneEffectCommand } from '../render/layer-scene-service.js';
import { getTunnelCenterRevealRange, getTunnelCopyColor } from '../corridor/corridor-appearance.js';
import {
  getEffectiveSpiralMorphTransport,
  getSpiralMorphType,
  spiralMorphUsesRetainedBezierRail,
} from '../morph-runtime/morph-mode.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const WebGPUSpiralBezierMorphRenderer = (() => {
  const SUBDIV = 8,
    ARC_SUBDIV = 8,
    FLOATS_PER_CUBIC = 24;

  const FAST_RAIL_SEGMENTS_PER_THREAD = 2;
  let device = null,
    format = null,
    pipelineMax = null,
    pipelineOver = null,
    uniformPipelineMax = null,
    uniformPipelineOver = null,
    effectCubicPipeline = null,
    closurePipeline = null,
    tangentRepairPipeline = null,
    germAttachPipeline = null,
    fastRailPipeline = null,
    cornerBuffer = null,
    renderUniformLayout = null,
    renderCubicLayout = null,
    renderCopyLayout = null,
    renderPipelineLayout = null;
  let width = 0,
    height = 0,
    generation = -1,
    ready = false,
    initializing = null,
    lastError = 'not-initialized';
  const resources = new Map(),
    retiredResources = [],
    staticVisualResources = new Map(),
    staticEditResources = new Map();
  let retireTimer = 0;
  const stats = {
    phaseBuilds: 0,
    layerBuilds: 0,
    staticVisualBuilds: 0,
    staticVisualHits: 0,
    uploads: 0,
    uploadSkips: 0,
    frames: 0,
    baseFrames: 0,
    glowFrames: 0,
    fusedFrames: 0,
    corridorFrames: 0,
    deferredLayerSceneFrames: 0,
    directFrameSceneFrames: 0,
    cubics: 0,
    gpuSegments: 0,
    arcSubdiv: ARC_SUBDIV,
    cubicComputeDispatches: 0,
    cubicComputeReuses: 0,
    tangentRepairDispatches: 0,
    fastRailDispatches: 0,
    fastRailReuses: 0,
    fastRailSegments: 0,
    auxFrames: 0,
    auxHits: 0,
    auxPoints: 0,
    carrierMappedFrames: 0,
    carrierMappedUploads: 0,
    carrierMappedUploadSkips: 0,
    carrierProfilePrepares: 0,
    carrierIdentityCubics: 0,
    carrierMappedFallbacks: 0,
    carrierRotationalBuilds: 0,
    carrierRotationalReuses: 0,
    retired: 0,
    fallbacks: 0,
    errors: 0,
    gpuSceneUnavailable: 0,
  };
  const decision = { eligible: false, reason: 'not-requested', layerIndex: -1, frameId: -1 };
  const uniformBytes = new ArrayBuffer(80),
    uf = new Float32Array(uniformBytes),
    uu = new Uint32Array(uniformBytes);
  const TWO_PI = Math.PI * 2;

  const EFFECT_CUBIC_WGSL = `
struct U { count:u32, _a:u32, _b:u32, _c:u32, phase:vec4<f32>, };
@group(0) @binding(0) var<storage,read> endpointData:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read_write> currentCubics:array<vec4<f32>>;
@group(0) @binding(2) var<uniform> u:U;
fn polarXY(a:vec2<f32>)->vec2<f32>{return vec2<f32>(a.x*cos(a.y),a.x*sin(a.y));}
fn polarMix(a:vec2<f32>,b:vec2<f32>,t:f32)->vec2<f32>{let r=mix(a.x,b.x,t);let ang=mix(a.y,b.y,t);return vec2<f32>(r*cos(ang),r*sin(ang));}




fn safeSpiralMix(a:vec2<f32>,b:vec2<f32>,t:f32,cartesian:bool)->vec2<f32>{
 if(cartesian){return mix(polarXY(a),polarXY(b),t);}
 return polarMix(a,b,t);
}

fn profileMix(a:vec2<f32>,b:vec2<f32>,t:f32,cartesian:bool,topoCircle:bool)->vec2<f32>{
 let circular=safeSpiralMix(a,b,t,cartesian);
 if(!topoCircle||cartesian){return circular;}
 return mix(circular,mix(polarXY(a),polarXY(b),t),0.42);
}
fn rotate2(v:vec2<f32>,a:f32)->vec2<f32>{let c=cos(a);let s=sin(a);return vec2<f32>(c*v.x-s*v.y,s*v.x+c*v.y);}
fn transportedHandle(endpointPolar:vec2<f32>,controlPolar:vec2<f32>,currentAngle:f32,cartesian:bool)->vec2<f32>{
 let v=polarXY(controlPolar)-polarXY(endpointPolar);
 
 if(cartesian){return v;}
 return rotate2(v,currentAngle-endpointPolar.y);
}
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=u.count){return;}let b=i*6u;
 let s0=endpointData[b];let s1=endpointData[b+1u];let d0=endpointData[b+2u];let d1=endpointData[b+3u];let metaData=endpointData[b+5u];let t=clamp(u.phase.x,0.0,1.0);let cartesian=metaData.z>0.5;
 let flags=u32(max(metaData.w,0.0)+0.5);let coordinated=flags & 4u;let topoCircle=(flags & 16u)!=0u;
 
 
 
 
 
 
 
 
 
 let germ=(flags & 8u)!=0u;
 
 
 
 
 
 
 let geometryT=select(t,t*t*(3.0-2.0*t),coordinated!=0u);
 let t0=geometryT;let t1=geometryT;let t2=geometryT;let t3=geometryT;
 let p0=profileMix(s0.xy,d0.xy,t0,cartesian,topoCircle);let p3=profileMix(s1.zw,d1.zw,t3,cartesian,topoCircle);var c1=profileMix(s0.zw,d0.zw,t1,cartesian,topoCircle);var c2=profileMix(s1.xy,d1.xy,t2,cartesian,topoCircle);
 let profileCurvature=(u.phase.z>.5)||(u.phase.w>.5);if(profileCurvature){
   
   
   let pt=select(clamp(u.phase.y,0.0,1.0),geometryT,coordinated!=0u);let a0=mix(s0.y,d0.y,t0);let a3=mix(s1.w,d1.w,t3);
   let hs1=transportedHandle(s0.xy,s0.zw,a0,cartesian);let hd1=transportedHandle(d0.xy,d0.zw,a0,cartesian);
   let hs2=transportedHandle(s1.zw,s1.xy,a3,cartesian);let hd2=transportedHandle(d1.zw,d1.xy,a3,cartesian);
   c1=p0+mix(hs1,hd1,pt);c2=p3+mix(hs2,hd2,pt);
 }
 currentCubics[i*2u]=vec4<f32>(p0,c1);currentCubics[i*2u+1u]=vec4<f32>(c2,p3);
}`;

  // Germs are attached to the CURRENT position of a paired neighboring rail,
  // not to a stationary point captured at the beginning of the phase.
  // This is a separate pass after all parent cubics have been evaluated.
  // Parent cubics are not written by this pass, so cross-workgroup reads are safe.
  const GERM_ATTACH_WGSL = `
struct U {count:u32, _a:u32, _b:u32, _c:u32, phase:vec4<f32>,};


@group(0) @binding(0) var<storage,read> previousCubics:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read_write> cubics:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> links:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> u:U;
fn bezier(a:vec2<f32>,b:vec2<f32>,c:vec2<f32>,d:vec2<f32>,t:f32)->vec2<f32>{
 let z=1.0-t;return a*z*z*z+3.0*b*z*z*t+3.0*c*z*t*t+d*t*t*t;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=u._a){return;}
 let a=links[i];
 let b=links[u._a+i];
 let child=u32(a.x+0.5);let parent=u32(a.y+0.5);let q=clamp(a.z,0.0,1.0);
 let birth=a.w>0.5;let t=clamp(u.phase.x,0.0,1.0);
 
 
 
 
 
 
 
 var strength=select(smoothstep(0.0,0.22,t),1.0-smoothstep(0.55,1.0,t),birth);
 if(!birth&&b.z>0.5){strength=smoothstep(0.0,1.0,t);}
 if(birth&&b.w>0.5){
   
   
   let q=clamp((t-0.25)/0.75,0.0,1.0);
   strength=1.0-(q*q*q*(q*(q*6.0-15.0)+10.0));
 }
 if(strength<=0.000001){return;}
 let pq=previousCubics[parent*2u];
 let pr=previousCubics[parent*2u+1u];
 let attachment=bezier(pq.xy,pq.zw,pr.xy,pr.zw,q);
 let h=previousCubics[child*2u];
 let j=previousCubics[child*2u+1u];
 let ordinal=b.x;let count=max(1.0,b.y);
 
 
 
 
 
 let rootIndex=child-u32(b.x+0.5);
 let rootPoint=previousCubics[rootIndex*2u].xy;
 let delta=(attachment-rootPoint)*strength;
 if(!birth&&b.z>0.5){
   
   
   
   cubics[child*2u]=vec4<f32>(h.xy+delta,h.zw+delta);
   cubics[child*2u+1u]=vec4<f32>(j.xy+delta,j.zw+delta);
 }else{
   cubics[child*2u]=vec4<f32>(h.xy+delta,h.zw+delta);
   cubics[child*2u+1u]=vec4<f32>(j.xy+delta,j.zw+delta);
 }
}`;

  const CLOSURE_WGSL = `
struct U { count:u32, _a:u32, _b:u32, _c:u32, phase:vec4<f32>, };
@group(0) @binding(0) var<storage,read_write> currentCubics:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> pathRanges:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read> closureData:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> u:U;
fn rotateScale(p:vec2<f32>,ang:f32,sc:f32)->vec2<f32>{let c=cos(ang);let s=sin(ang);return vec2<f32>((c*p.x-s*p.y)*sc,(s*p.x+c*p.y)*sc);}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let pi=gid.x;if(pi>=arrayLength(&pathRanges)){return;}let range=pathRanges[pi];let first=range.x;let n=range.y;if(n==0u){return;}
 let spec=closureData[pi*2u];let flags=closureData[pi*2u+1u];if(flags.z<0.5){return;}
 let t=clamp(u.phase.x,0.0,1.0);let positionStrength=mix(flags.x,flags.y,t);if(positionStrength<=0.000001){return;}
 let packed=u32(max(0.0,flags.w)+0.5);
 
 
 
 let periodT=select(t,t*t*(3.0-2.0*t),(packed&4u)!=0u);
 let delta=mix(spec.x,spec.z,periodT);let scale=exp(mix(spec.y,spec.w,periodT));let firstQ=currentCubics[first*2u];let p0=firstQ.xy;let c1=firstQ.zw;let expectedP3=rotateScale(p0,delta,scale);let expectedNextC1=rotateScale(c1,delta,scale);let expectedC2=2.0*expectedP3-expectedNextC1;
 let sourceTangent=select(0.0,1.0,(packed&1u)!=0u);let targetTangent=select(0.0,1.0,(packed&2u)!=0u);let tangentStrength=min(positionStrength,mix(sourceTangent,targetTangent,t));
 let last=first+n-1u;var q=currentCubics[last*2u+1u];
 if((packed&8u)!=0u){
   
   
   
   
   
   var bridge=currentCubics[last*2u];let v=expectedP3-bridge.xy;
   bridge.zw=mix(bridge.zw,bridge.xy+v/3.0,clamp(positionStrength,0.0,1.0));
   q.xy=mix(q.xy,bridge.xy+v*2.0/3.0,clamp(positionStrength,0.0,1.0));
   currentCubics[last*2u]=bridge;
 }else{q.xy=mix(q.xy,expectedC2,clamp(tangentStrength,0.0,1.0));}
 q.zw=mix(q.zw,expectedP3,clamp(positionStrength,0.0,1.0));currentCubics[last*2u+1u]=q;
}`;

  const TANGENT_REPAIR_WGSL = `
struct U { count:u32, _a:u32, _b:u32, _c:u32, phase:vec4<f32>, };
@group(0) @binding(0) var<storage,read_write> currentCubics:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(0) @binding(2) var<uniform> u:U;
fn safeUnit(v:vec2<f32>,fallback:vec2<f32>)->vec2<f32>{let l=length(v);if(l>0.000001){return v/l;}return fallback;}
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x+1u;if(i>=u.count){return;}if(segmentMeta[i-1u].z!=segmentMeta[i].z){return;}
 
 
 
 let pf0=segmentMeta[i-1u].w;let nf0=segmentMeta[i].w;
 if(((pf0|nf0)&1u)!=0u){
   let left=currentCubics[(i-1u)*2u+1u].zw;
   let right=currentCubics[i*2u].xy;
   if(length(left-right)>0.001){return;}
 }
 let t=clamp(u.phase.x,0.0,1.0);let profileCurvature=(u.phase.z>.5)||(u.phase.w>.5);let modeT=select(t,clamp(u.phase.y,0.0,1.0),profileCurvature);let pf=segmentMeta[i-1u].w;let nf=segmentMeta[i].w;let sourceCorner=((pf&0x02000000u)!=0u)||((nf&0x01000000u)!=0u);let targetCorner=((pf&0x08000000u)!=0u)||((nf&0x04000000u)!=0u);let sourceSmooth=select(1.0,0.0,sourceCorner);let targetSmooth=select(1.0,0.0,targetCorner);let strength=clamp(mix(sourceSmooth,targetSmooth,modeT),0.0,1.0);if(strength<=0.000001){return;}
 var prev=currentCubics[(i-1u)*2u+1u];var next=currentCubics[i*2u];let knot=(prev.zw+next.xy)*0.5;let vin=knot-prev.xy;let vout=next.zw-knot;let lin=length(vin);let lout=length(vout);if(lin<=0.000001&&lout<=0.000001){prev.zw=knot;next.xy=knot;currentCubics[(i-1u)*2u+1u]=prev;currentCubics[i*2u]=next;return;}
 let di=safeUnit(vin,safeUnit(vout,vec2<f32>(1.0,0.0)));let dout=safeUnit(vout,di);var sum=di+dout;var dir=safeUnit(sum,select(di,dout,lout>lin));if(dot(di,dout)< -0.95){dir=select(di,dout,lout>lin);}
 let repairedC2=knot-dir*lin;let repairedC1=knot+dir*lout;prev.xy=mix(prev.xy,repairedC2,strength);prev.zw=knot;next.xy=knot;next.zw=mix(next.zw,repairedC1,strength);currentCubics[(i-1u)*2u+1u]=prev;currentCubics[i*2u]=next;
}`;

  const FAST_RAIL_WGSL = `
struct U { count:u32, _a:u32, _b:u32, _c:u32, phase:vec4<f32>, };
@group(0) @binding(0) var<storage,read> endpointData:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> currentCubics:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> fastRail:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> u:U;
fn cubic(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;}
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 
 
 
 let pair=gid.x;let total=u.count*${SUBDIV / FAST_RAIL_SEGMENTS_PER_THREAD}u;if(pair>=total){return;}
 let ci=pair/${SUBDIV / FAST_RAIL_SEGMENTS_PER_THREAD}u;let sub=(pair%${SUBDIV / FAST_RAIL_SEGMENTS_PER_THREAD}u)*${FAST_RAIL_SEGMENTS_PER_THREAD}u;
 let b=ci*6u;let q=currentCubics[ci*2u];let r=currentCubics[ci*2u+1u];let w=endpointData[b+4u];let metaData=endpointData[b+5u];let phaseT=clamp(u.phase.x,0.0,1.0);
 let t0=f32(sub)/f32(${SUBDIV});let t1=f32(sub+1u)/f32(${SUBDIV});let t2=f32(sub+2u)/f32(${SUBDIV});
 let a=cubic(q.xy,q.zw,r.xy,r.zw,t0);let bb=cubic(q.xy,q.zw,r.xy,r.zw,t1);let c=cubic(q.xy,q.zw,r.xy,r.zw,t2);
 let flags=u32(max(metaData.w,0.0)+0.5);
 let widthPhase=select(phaseT,smoothstep(0.92,1.0,phaseT),(flags & 32u)!=0u);
 let logWs0=mix(w.x,w.z,widthPhase);let logWs1=mix(w.y,w.w,widthPhase);
 let l0=exp(mix(logWs0,logWs1,t0));let l1=exp(mix(logWs0,logWs1,t1));let l2=exp(mix(logWs0,logWs1,t2));
 let smoothPhase=phaseT*phaseT*(3.0-2.0*phaseT);let presence=mix(metaData.x,metaData.y,smoothPhase);let ri=ci*${SUBDIV}u+sub;
 fastRail[ri*2u]=vec4<f32>(a,bb);fastRail[ri*2u+1u]=vec4<f32>(l0,l1,presence,metaData.w);
 fastRail[(ri+1u)*2u]=vec4<f32>(bb,c);fastRail[(ri+1u)*2u+1u]=vec4<f32>(l1,l2,presence,metaData.w);
}`;

  const WGSL = `
struct U {
  viewport:vec2<f32>, cubicCount:u32, copyCount:u32,
  row0:vec4<f32>, row1:vec4<f32>,
  params:vec4<f32>, 
  phase:vec4<f32>,  
};
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<storage,read> fastRail:array<vec4<f32>>;
@group(2) @binding(0) var<storage,read> copyData:array<vec4<f32>>;
struct Vin { @location(0) corner:vec2<f32>, };
struct Vout {
 @builtin(position) position:vec4<f32>, @location(0) local:vec2<f32>,
 @location(1) @interpolate(flat) segLen:f32,
 @location(2) @interpolate(flat) logHalfWidth0:f32,
 @location(3) @interpolate(flat) logHalfWidth1:f32,
 @location(4) @interpolate(flat) glowRadius:f32,
 @location(5) @interpolate(flat) alpha:f32,
 @location(6) @interpolate(flat) color:vec4<f32>,
};
fn screenPoint(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
fn centerShade(screenPos:vec2<f32>)->f32{if(u.phase.w<=.5){return 1.0;}let center=screenPoint(vec2<f32>(0.0,0.0));let det=abs(u.row0.x*u.row1.y-u.row0.y*u.row1.x);let matrixScale=max(.000001,sqrt(det));let rr=length(screenPos-center)/matrixScale;return smoothstep(u.phase.y,u.phase.z,rr);}
@vertex fn vs(v:Vin,@builtin(instance_index) iid:u32)->Vout{
 var o:Vout;let cubicIndex=(iid/${SUBDIV}u)%max(1u,u.cubicCount);let sub=iid%${SUBDIV}u;let ci=iid/(max(1u,u.cubicCount)*${SUBDIV}u);let ri=cubicIndex*${SUBDIV}u+sub;let g0=fastRail[ri*2u];let g1=fastRail[ri*2u+1u];let a0=g0.xy;let b0=g0.zw;
 let cp0=copyData[ci*3u];let cp1=copyData[ci*3u+1u];let cp2=copyData[ci*3u+2u];
 
 
 
 if(cp0.z*g1.z<=.00001||cp2.y<=.00001){
   o.position=vec4<f32>(-2.0,-2.0,0.0,1.0);o.local=vec2<f32>(0.0);
   o.segLen=1.0;o.logHalfWidth0=0.0;o.logHalfWidth1=0.0;
   o.glowRadius=0.0;o.alpha=0.0;o.color=vec4<f32>(0.0);return o;
 }
 let a=vec2<f32>(cp0.x*a0.x+cp0.y*a0.y,cp1.x*a0.x+cp1.y*a0.y);let bb=vec2<f32>(cp0.x*b0.x+cp0.y*b0.y,cp1.x*b0.x+cp1.y*b0.y);
 
 
 
 if((u32(max(g1.w,0.0)+0.5)&8u)!=0u&&length(screenPoint(bb)-screenPoint(a))<0.1){
   o.position=vec4<f32>(-2.0,-2.0,0.0,1.0);o.local=vec2<f32>(0.0);
   o.segLen=1.0;o.logHalfWidth0=0.0;o.logHalfWidth1=0.0;
   o.glowRadius=0.0;o.alpha=0.0;o.color=vec4<f32>(0.0);return o;
 }
 
 
 
 
 
 var sp0=screenPoint(a);var sp1=screenPoint(bb);var l0=g1.x;var l1=g1.y;
 let sc=max(.000001,abs(cp0.w));let gr=max(0.0,u.params.y*sc);
 if(u.params.w>.00001){
   let pairRi=cubicIndex*${SUBDIV}u+(sub&~1u);
   let pg0=fastRail[pairRi*2u];let pg1=fastRail[pairRi*2u+1u];
   let eg0=fastRail[(pairRi+1u)*2u];let eg1=fastRail[(pairRi+1u)*2u+1u];
   let p0=screenPoint(vec2<f32>(cp0.x*pg0.x+cp0.y*pg0.y,cp1.x*pg0.x+cp1.y*pg0.y));
   let pm=screenPoint(vec2<f32>(cp0.x*pg0.z+cp0.y*pg0.w,cp1.x*pg0.z+cp1.y*pg0.w));
   let pe=screenPoint(vec2<f32>(cp0.x*eg0.z+cp0.y*eg0.w,cp1.x*eg0.z+cp1.y*eg0.w));
   let chord=pe-p0;let denom=max(dot(chord,chord),.000001);
   let f=clamp(dot(pm-p0,chord)/denom,0.0,1.0);
   let shapeError=length(pm-(p0+f*chord));
   
   
   
   let smoothJoin=dot(pm-p0,pe-pm)>0.0;
   if(smoothJoin&&shapeError<=min(.60,max(.22,gr*.045))){
     let w0=max(.18,u.params.x*sc*pg1.x);let wm=max(.18,u.params.x*sc*pg1.y);let we=max(.18,u.params.x*sc*eg1.y);
     let widthLimit=min(.25,max(.12,gr*.020));
     
     
     
     
     let widthSafe=max(max(w0,wm),we)<=4096.0&&max(abs(wm-w0),abs(wm-we))<widthLimit*.90;
     var widthOk=widthSafe;
     if(!widthSafe){
       let predictedWidth=exp(mix(log(w0),log(we),f));
       widthOk=abs(wm-predictedWidth)<=widthLimit;
     }
     if(widthOk){
       if((sub&1u)==1u){
         o.position=vec4<f32>(-2.0,-2.0,0.0,1.0);o.local=vec2<f32>(0.0);o.segLen=1.0;
         o.logHalfWidth0=0.0;o.logHalfWidth1=0.0;o.glowRadius=0.0;o.alpha=0.0;o.color=vec4<f32>(0.0);return o;
       }
       sp0=p0;sp1=pe;l0=pg1.x;l1=eg1.y;
     }
   }
 }
 let delta=sp1-sp0;let len=max(length(delta),0.0001);let dir=delta/len;let normal=vec2<f32>(-dir.y,dir.x);
 let hw0=max(.18,u.params.x*sc*l0);let hw1=max(.18,u.params.x*sc*l1);let pad=max(hw0,hw1)+gr+2.0;
 
 
 
 let boundsPad=1.415*pad;
 if(max(sp0.x,sp1.x)+boundsPad<0.0||min(sp0.x,sp1.x)-boundsPad>u.viewport.x||
    max(sp0.y,sp1.y)+boundsPad<0.0||min(sp0.y,sp1.y)-boundsPad>u.viewport.y){
   o.position=vec4<f32>(-2.0,-2.0,0.0,1.0);o.local=vec2<f32>(0.0);
   o.segLen=1.0;o.logHalfWidth0=0.0;o.logHalfWidth1=0.0;
   o.glowRadius=0.0;o.alpha=0.0;o.color=vec4<f32>(0.0);return o;
 }
 let tx=(v.corner.x+1.0)*.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let pos=sp0+dir*lx+normal*ly;
 o.position=vec4<f32>(pos.x/u.viewport.x*2.0-1.0,1.0-pos.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.logHalfWidth0=log(max(.001,hw0));o.logHalfWidth1=log(max(.001,hw1));o.glowRadius=gr;o.alpha=cp0.z*g1.z;o.color=vec4<f32>(cp1.z,cp1.w,cp2.x,cp2.y);return o;
}
@fragment fn fs(v:Vout)->@location(0) vec4<f32>{
 if(v.alpha<=.00001||v.color.a<=.00001){discard;}let cx=clamp(v.local.x,0.0,v.segLen);let q=cx/max(.0001,v.segLen);let hw=exp(mix(v.logHalfWidth0,v.logHalfWidth1,q));let d=length(vec2<f32>(v.local.x-cx,v.local.y));var cov=0.0;
 if(u.params.w>.00001&&v.glowRadius>.01){let edge=max(0.0,d-hw);
   
   
   if(edge>=v.glowRadius+2.0){discard;}
   let z=edge/max(.55,v.glowRadius*.44);cov=exp(-z*z*1.65)*(1.0-smoothstep(v.glowRadius*.76,v.glowRadius+2.0,edge))*u.params.w;
 }else{if(d>=hw+.75){discard;}cov=clamp(hw+.75-d,0.0,1.0)*u.params.z;}
 let centerMask=centerShade(v.position.xy);
 let a=clamp(cov*centerMask*v.alpha*v.color.a,0.0,1.0);if(a<.0001){discard;}return vec4<f32>(v.color.rgb*a,a);
}

struct UniformOut {
 @builtin(position) position:vec4<f32>, @location(0) edge:f32,
 @location(1) halfWidth:f32, @location(2) alpha:f32, @location(3) color:vec4<f32>,
};
fn safeUnit(v:vec2<f32>,fallback:vec2<f32>)->vec2<f32>{let n=length(v);if(n>.00001){return v/n;}let f=length(fallback);if(f>.00001){return fallback/f;}return vec2<f32>(1.0,0.0);}
fn screenVector(v:vec2<f32>,cp0:vec4<f32>,cp1:vec4<f32>)->vec2<f32>{
 let a=vec2<f32>(cp0.x*v.x+cp0.y*v.y,cp1.x*v.x+cp1.y*v.y);return vec2<f32>(u.row0.x*a.x+u.row0.y*a.y,u.row1.x*a.x+u.row1.y*a.y);
}
fn railScreenDir(ri:u32,cp0:vec4<f32>,cp1:vec4<f32>,fallback:vec2<f32>)->vec2<f32>{let g=fastRail[ri*2u];return safeUnit(screenVector(g.zw-g.xy,cp0,cp1),fallback);}
fn fastJoinedTangent(ri:u32,sub:u32,right:bool,flags:f32,cp0:vec4<f32>,cp1:vec4<f32>)->vec2<f32>{
 let cur=railScreenDir(ri,cp0,cp1,vec2<f32>(1.0,0.0));var sum=cur;let boundary=flags-floor(flags/4.0)*4.0;let first=(boundary>=.5&&boundary<1.5)||boundary>=2.5;let last=boundary>=1.5;
 if(!right){if(sub>0u||!first){sum=sum+railScreenDir(ri-1u,cp0,cp1,cur);}}else{if(sub+1u<${SUBDIV}u||!last){sum=sum+railScreenDir(ri+1u,cp0,cp1,cur);}}return safeUnit(sum,cur);
}
fn fastJoinHasNeighbor(sub:u32,right:bool,flags:f32)->bool{let boundary=flags-floor(flags/4.0)*4.0;let first=(boundary>=.5&&boundary<1.5)||boundary>=2.5;let last=boundary>=1.5;return select(sub>0u||!first,sub+1u<${SUBDIV}u||!last,right);}
@vertex fn vsUniform(v:Vin,@builtin(instance_index) iid:u32)->UniformOut{
 var o:UniformOut;let ci=(iid/${SUBDIV}u)%max(1u,u.cubicCount);let sub=iid%${SUBDIV}u;let copyIndex=iid/(max(1u,u.cubicCount)*${SUBDIV}u);let ri=ci*${SUBDIV}u+sub;let g0=fastRail[ri*2u];let g1=fastRail[ri*2u+1u];let right=v.corner.x>0.0;let local=select(g0.xy,g0.zw,right);
 let cp0=copyData[copyIndex*3u];let cp1=copyData[copyIndex*3u+1u];let cp2=copyData[copyIndex*3u+2u];
 
 if(cp0.z*g1.z<=.00001||cp2.y<=.00001||u.params.z<=.00001){
   o.position=vec4<f32>(-2.0,-2.0,0.0,1.0);o.edge=0.0;
   o.halfWidth=0.0;o.alpha=0.0;o.color=vec4<f32>(0.0);return o;
 }
 
 
 if((u32(max(g1.w,0.0)+0.5)&8u)!=0u&&
    length(screenVector(g0.zw-g0.xy,cp0,cp1))<0.1){
   o.position=vec4<f32>(-2.0,-2.0,0.0,1.0);o.edge=0.0;
   o.halfWidth=0.0;o.alpha=0.0;o.color=vec4<f32>(0.0);return o;
 }
 
 
 
 
 let copied=vec2<f32>(cp0.x*local.x+cp0.y*local.y,cp1.x*local.x+cp1.y*local.y);
 let center=screenPoint(copied);let sc=max(.000001,abs(cp0.w));
 if(u.copyCount>1u){
   let other=select(g0.zw,g0.xy,right);
   let copiedOther=vec2<f32>(cp0.x*other.x+cp0.y*other.y,cp1.x*other.x+cp1.y*other.y);
   let otherCenter=screenPoint(copiedOther);
   
   
   let boundsPad=max(.18,u.params.x*sc*max(g1.x,g1.y))+.75+.55+2.0;
   if(max(center.x,otherCenter.x)+boundsPad<0.0||min(center.x,otherCenter.x)-boundsPad>u.viewport.x||
      max(center.y,otherCenter.y)+boundsPad<0.0||min(center.y,otherCenter.y)-boundsPad>u.viewport.y){
     o.position=vec4<f32>(-2.0,-2.0,0.0,1.0);o.edge=0.0;
     o.halfWidth=0.0;o.alpha=0.0;o.color=vec4<f32>(0.0);return o;
   }
 }
 let tangent=fastJoinedTangent(ri,sub,right,g1.w,cp0,cp1);let normal=vec2<f32>(-tangent.y,tangent.x);let scaleAt=select(g1.x,g1.y,right);let hw=max(.18,u.params.x*sc*scaleAt);let pad=hw+.75;let seamOverlap=select(0.0,min(.55,max(.18,hw*.16)),fastJoinHasNeighbor(sub,right,g1.w));let along=select(-seamOverlap,seamOverlap,right);let pos=center+tangent*along+normal*(v.corner.y*pad);
 o.position=vec4<f32>(pos.x/u.viewport.x*2.0-1.0,1.0-pos.y/u.viewport.y*2.0,0.0,1.0);o.edge=v.corner.y*pad;o.halfWidth=hw;o.alpha=cp0.z*g1.z;o.color=vec4<f32>(cp1.z,cp1.w,cp2.x,cp2.y);return o;
}
@fragment fn fsUniform(v:UniformOut)->@location(0) vec4<f32>{
 if(v.alpha<=.00001||v.color.a<=.00001||u.params.z<=.00001){discard;}let hw=max(.001,v.halfWidth);let cc=min(1.0,2.0*hw);let cov=min(cc,clamp(hw+.5-abs(v.edge),0.0,1.0))*u.params.z;let centerMask=centerShade(v.position.xy);let a=clamp(cov*centerMask*v.alpha*v.color.a,0.0,1.0);if(a<.0001){discard;}return vec4<f32>(v.color.rgb*a,a);
}`;

  function destroyResource(rec) {
    for (const b of [
      rec?.buffer,
      rec?.copyBuffer,
      rec?.uniformBase,
      rec?.uniformGlow,
      rec?.cubicBuffer,
      rec?.cubicUniformBuffer,
      rec?.pathRangeBuffer,
      rec?.segmentMetaBuffer,
      rec?.pathSegmentRangeBuffer,
      rec?.pathClosureBuffer,
      rec?.germLinkBuffer,
      rec?.germSnapshotBuffer,
      rec?.fastRailBuffer,
      rec?.fastUniformBuffer,
    ])
      try {
        b?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/spiral-bezier-morph-renderer#destroyResource', error);
      }
  }
  function destroyStaticVisual(rec) {
    for (const b of [
      rec?.metaBuffer,
      rec?.copyBuffer,
      rec?.uniformBase,
      rec?.uniformGlow,
      rec?.fastRailBuffer,
      rec?.fastUniformBuffer,
    ])
      try {
        b?.destroy?.();
      } catch (error) {
        noteSuppressedError('gpu/spiral-bezier-morph-renderer#destroyStaticVisual', error);
      }
  }
  function resetStaticVisuals() {
    for (const rec of staticVisualResources.values()) destroyStaticVisual(rec);
    staticVisualResources.clear();
  }
  function resetStaticEdits() {
    for (const slot of staticEditResources.values()) if (slot.rec) retiredResources.push(slot.rec);
    staticEditResources.clear();
    scheduleRetiredFlush();
  }

  function flushRetired() {
    retireTimer = 0;
    while (retiredResources.length) destroyResource(retiredResources.pop());
  }
  function scheduleRetiredFlush() {
    if (retireTimer) return;
    const run = () => flushRetired();
    if (typeof requestIdleCallback === 'function') retireTimer = requestIdleCallback(run, { timeout: 800 });
    else retireTimer = setTimeout(run, 80);
  }
  function retireCurrentResources(reason = 'phase-change') {
    try {
      invalidateGpuMorphArcResources?.(`spiral-bezier-${reason}`);
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#retireCurrentResources', error);
    }
    for (const rec of resources.values()) {
      retiredResources.push(rec);
      stats.retired++;
    }
    resources.clear();
    decision.reason = reason;
    scheduleRetiredFlush();
  }

  function replaceResources(nextResources, reason = 'phase-swap') {
    try {
      invalidateGpuMorphArcResources?.(`spiral-bezier-${reason}`);
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#replaceResources', error);
    }
    for (const rec of resources.values()) {
      retiredResources.push(rec);
      stats.retired++;
    }
    resources.clear();
    for (const [key, rec] of nextResources) resources.set(key, rec);
    decision.reason = reason;
    scheduleRetiredFlush();
  }
  function invalidate(reason = 'phase-change') {
    retireCurrentResources(reason);
  }

  function park(reason = 'stopped') {
    decision.eligible = false;
    decision.reason = reason;
    for (const rec of resources.values()) {
      rec.copyPackedFrameId = -1;
      rec.auxT = NaN;
    }
    return true;
  }
  function reset() {
    for (const rec of resources.values()) destroyResource(rec);
    resources.clear();
    resetStaticVisuals();
    resetStaticEdits();
    flushRetired();
    try {
      cornerBuffer?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#reset', error);
    }
    pipelineMax = null;
    pipelineOver = null;
    uniformPipelineMax = null;
    uniformPipelineOver = null;
    effectCubicPipeline = null;
    closurePipeline = null;
    tangentRepairPipeline = null;
    germAttachPipeline = null;
    fastRailPipeline = null;
    cornerBuffer = null;
    renderUniformLayout = null;
    renderCubicLayout = null;
    renderCopyLayout = null;
    renderPipelineLayout = null;
    width = 0;
    height = 0;
    device = null;
    ready = false;
  }
  async function ensureReady() {
    const gen = typeof WebGPUDeviceHub !== 'undefined' ? WebGPUDeviceHub.getGeneration?.() : -1;
    if (ready && device && gen === generation) return true;
    if (initializing) return initializing;
    if (ready && gen !== generation) reset();
    initializing = (async () => {
      try {
        if (typeof WebGPUDeviceHub === 'undefined') throw new Error('WebGPUDeviceHub unavailable');
        const sh = await WebGPUDeviceHub.acquire();
        device = sh.device;
        generation = sh.generation;
        format = navigator.gpu.getPreferredCanvasFormat();
        const mod = device.createShaderModule({ label: 'Somata Spiral Bézier Morph WGSL', code: WGSL }),
          effectMod = device.createShaderModule({
            label: 'Somata Spiral Bézier shared effect cubics WGSL',
            code: EFFECT_CUBIC_WGSL,
          }),
          repairMod = device.createShaderModule({
            label: 'Somata 7.5 Spiral topology tangent repair WGSL',
            code: TANGENT_REPAIR_WGSL,
          }),
          fastMod = device.createShaderModule({
            label: 'Somata 7.5 Spiral Fast Visual Rail WGSL',
            code: FAST_RAIL_WGSL,
          });
        {
          await assertWebGPUShaderModule(mod, 'Somata Spiral Bézier Morph WGSL');
          await assertWebGPUShaderModule(effectMod, 'Somata Spiral Bézier shared effect cubics WGSL');
          await assertWebGPUShaderModule(repairMod, 'Somata 7.5 Spiral topology tangent repair WGSL');
          await assertWebGPUShaderModule(fastMod, 'Somata 7.5 Spiral Fast Visual Rail WGSL');
        }
        effectCubicPipeline = device.createComputePipeline({
          label: 'Somata Spiral Bézier shared effect cubics',
          layout: 'auto',
          compute: { module: effectMod, entryPoint: 'main' },
        });
        const germMod = device.createShaderModule({
          label: 'Somata neighbor-coil germ attachment',
          code: GERM_ATTACH_WGSL,
        });
        await assertWebGPUShaderModule(germMod, 'Somata neighbor-coil germ attachment');
        germAttachPipeline = device.createComputePipeline({
          label: 'Somata neighbor-coil germ attachment',
          layout: 'auto',
          compute: { module: germMod, entryPoint: 'main' },
        });
        tangentRepairPipeline = device.createComputePipeline({
          label: 'Somata 7.5 Spiral topology tangent repair',
          layout: 'auto',
          compute: { module: repairMod, entryPoint: 'main' },
        });
        fastRailPipeline = device.createComputePipeline({
          label: 'Somata 7.5 Spiral Fast Visual Rail',
          layout: 'auto',
          compute: { module: fastMod, entryPoint: 'main' },
        });
        const closureMod = device.createShaderModule({
          label: 'Somata 7.5 Spiral periodic closure WGSL',
          code: CLOSURE_WGSL,
        });
        await assertWebGPUShaderModule(closureMod, 'Somata 7.5 Spiral periodic closure WGSL');
        closurePipeline = device.createComputePipeline({
          label: 'Somata 7.5 Spiral periodic closure',
          layout: 'auto',
          compute: { module: closureMod, entryPoint: 'main' },
        });
        const blendOver = {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
          blendMax = {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
          };
        const vertexBuffers = [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
        ];

        renderUniformLayout = device.createBindGroupLayout({
          label: 'Somata Spiral Morph render uniforms',
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: { type: 'uniform' },
            },
          ],
        });
        renderCubicLayout = device.createBindGroupLayout({
          label: 'Somata 7.5 Spiral Fast Visual Rail raster',
          entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
        });
        renderCopyLayout = device.createBindGroupLayout({
          label: 'Somata Spiral Morph corridor copies',
          entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
        });
        renderPipelineLayout = device.createPipelineLayout({
          label: 'Somata Spiral Morph shared render layout',
          bindGroupLayouts: [renderUniformLayout, renderCubicLayout, renderCopyLayout],
        });
        const makePipeline = (kind, blend) =>
          device.createRenderPipeline({
            label: `Somata 7.5 Spiral Bézier Morph ${kind}`,
            layout: renderPipelineLayout,
            vertex: { module: mod, entryPoint: 'vs', buffers: vertexBuffers },
            fragment: { module: mod, entryPoint: 'fs', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-strip' },
          });
        const makeUniformPipeline = (kind, blend) =>
          device.createRenderPipeline({
            label: `Somata 7.5 Uniform Spiral Bézier Morph ${kind}`,
            layout: renderPipelineLayout,
            vertex: { module: mod, entryPoint: 'vsUniform', buffers: vertexBuffers },
            fragment: { module: mod, entryPoint: 'fsUniform', targets: [{ format, blend }] },
            primitive: { topology: 'triangle-strip' },
          });
        pipelineMax = makePipeline('MAX union', blendMax);
        pipelineOver = makePipeline('source-over', blendOver);
        uniformPipelineMax = makeUniformPipeline('MAX union', blendMax);
        uniformPipelineOver = makeUniformPipeline('source-over', blendOver);
        cornerBuffer = device.createBuffer({
          label: 'Somata Spiral Bézier corners',
          size: 32,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(cornerBuffer, 0, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
        ready = true;
        lastError = '';

        try {
          requestMainCanvasRender?.();
        } catch (error) {
          noteSuppressedError('gpu/spiral-bezier-morph-renderer#ensureReady', error);
        }
        return true;
      } catch (err) {
        lastError = String(err?.message || err);
        stats.errors++;
        ready = false;
        return false;
      } finally {
        initializing = null;
      }
    })();
    return initializing;
  }
  function warmup() {
    void ensureReady();
    return ready;
  }
  function ensureSize() {
    if (!ready || !device) return false;
    width = Math.max(1, mainCanvas.width | 0);
    height = Math.max(1, mainCanvas.height | 0);
    return true;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function lineCubics(points) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i],
        p3 = points[i + 1],
        c1 = { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 },
        c2 = { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 };
      out.push({
        p0: { ...p0 },
        c1,
        c2,
        p3: { ...p3 },
        widthScale0: Math.max(0.02, Number(p0.widthScale) || 1),
        widthScale1: Math.max(0.02, Number(p3.widthScale) || 1),
      });
    }
    return out;
  }
  function endpointCubics(path, layer) {
    // On a Blue phase boundary the EXACT cubics shown at t=1 in the
    // previous cycle are the only valid source for coordinated transport.
    // Rebuilding from authored integer N/K silently changes handle and
    // knot identity, even when the outermost endpoints still coincide.
    if (Array.isArray(path?.__morphBoundarySourceCubics) && path.__morphBoundarySourceCubics.length)
      return path.__morphBoundarySourceCubics;
    const points = path?.points || [];
    if (points.length < 2) return [];
    // A fresh carrier path was just constructed by geometry-gpu-core. Its retained
    // cubics have already passed periodic finalization and rounded-join repair, so
    // cloning/finalizing all controls again here only creates garbage on every frame.
    // Both static buildOrbitPolylines() and the animated carrier constructor
    // already finalize these authoritative retained cubics. Re-running
    // repairRoundedSpiralBezierJoins() on an endpoint subtly bends the
    // handles again (especially closed spline + seam rounding), so Morph's
    // last frame no longer agrees with the untouched static frame.
    if (
      (path?.__carrierMapped === true || path?.spiralRetainedProfileCarrier === true) &&
      Array.isArray(path?._bezierSegments) &&
      path._bezierSegments.length
    ) {
      stats.carrierIdentityCubics++;
      return path._bezierSegments;
    }
    const exact = (src) => {
      let c = (src || []).map((q) => ({
        ...q,
        p0: { ...q.p0 },
        c1: { ...q.c1 },
        c2: { ...q.c2 },
        p3: { ...q.p3 },
      }));
      if (c.length && typeof __spiroFinalizePeriodicSpiralBezierCarrier === 'function')
        c = __spiroFinalizePeriodicSpiralBezierCarrier(c, points);
      if (
        c.length &&
        (Number(layer?.rounding) || 0) > 0 &&
        typeof __spiroRepairRoundedSpiralBezierJoins === 'function'
      )
        c = __spiroRepairRoundedSpiralBezierJoins(c);
      return c;
    };
    if (Array.isArray(path?._bezierSegments) && path._bezierSegments.length)
      return exact(path._bezierSegments);
    if (Array.isArray(points?._spiroRetainedCubics) && points._spiroRetainedCubics.length)
      return exact(points._spiroRetainedCubics);
    const smooth = layer?.profileMode === 'spline' && path?.spiralProfileSplineBaked !== true;
    const round =
      path?.spiralProfileRoundingBaked === true
        ? 0
        : Math.max(0, Math.min(2, Number(getRoundingStrength(layer?.rounding)) || 0));
    {
      const c = buildSpiralBezierSegments(points, round, path?.cornerFlags || [], smooth);
      if (c?.length) return c;
    }
    if (typeof __spiroBuildSpiralBezierSegments === 'function') {
      const c = __spiroBuildSpiralBezierSegments(points, round, path?.cornerFlags || [], smooth);
      if (c?.length) return c;
    }
    return lineCubics(points);
  }
  function periodicClosureSpec(path, cubics, layer) {
    const periodic = Boolean(
      layer?.spiralEnabled === true &&
      layer?.spiralClosed !== false &&
      cubics?.length &&
      path?.spiralExplicitBridge !== true,
    );
    if (!periodic) return { periodic: false, delta: 0, logScale: 0, error: 0, tangentProtected: false };
    const points = Array.isArray(path?.points) ? path.points : [],
      p0 = cubics[0].p0,
      p3 = cubics[cubics.length - 1].p3,
      meta = points[0] || null;
    const hasAutoCloseBridge = points.some((p) => p?.__spiralAutoCloseBridgeEnd === true);
    const hasExplicitSeamFillet = points.some(
      (p) =>
        p?.__spiralClosureProtected === true ||
        p?.__spiralSeamProtected === true ||
        Boolean(p?.__spiralClosureFillet) ||
        Number(p?.__spiralSeamRoundFraction) > 0,
    );
    const tangentProtected =
      cubics?._spiroPeriodicTangent === true ||
      (((Number(layer?.__spiralTangentialMix) || 0) > 0 ||
        layer?.spiralTangential === true ||
        (Number(meta?.__spiralTangentialMix) || 0) > 0 ||
        meta?.__spiralTangential === true) &&
        !hasAutoCloseBridge) ||
      hasExplicitSeamFillet;
    let delta = Number(meta?.__spiralDelta),
      scale = Number(meta?.__spiralTargetScale);
    if (!Number.isFinite(delta)) {
      delta =
        Math.atan2(Number(p3.y) || 0, Number(p3.x) || 0) - Math.atan2(Number(p0.y) || 0, Number(p0.x) || 0);
      while (delta > Math.PI) delta -= TWO_PI;
      while (delta <= -Math.PI) delta += TWO_PI;
    }
    if (!(Number.isFinite(scale) && scale > 0)) {
      const r0 = Math.hypot(Number(p0.x) || 0, Number(p0.y) || 0),
        r3 = Math.hypot(Number(p3.x) || 0, Number(p3.y) || 0);
      scale = r0 > 1e-9 ? Math.max(1e-6, r3 / r0) : 1;
    }
    const c = Math.cos(delta),
      sn = Math.sin(delta),
      ex = (c * (Number(p0.x) || 0) - sn * (Number(p0.y) || 0)) * scale,
      ey = (sn * (Number(p0.x) || 0) + c * (Number(p0.y) || 0)) * scale;
    const firstC1 = cubics[0]?.c1 || p0,
      lastC2 = cubics[cubics.length - 1]?.c2 || p3,
      ec1x = (c * (Number(firstC1.x) || 0) - sn * (Number(firstC1.y) || 0)) * scale,
      ec1y = (sn * (Number(firstC1.x) || 0) + c * (Number(firstC1.y) || 0)) * scale,
      ec2x = 2 * ex - ec1x,
      ec2y = 2 * ey - ec1y;
    return {
      periodic: true,
      delta,
      logScale: Math.log(Math.max(1e-6, scale)),
      error: Math.hypot((Number(p3.x) || 0) - ex, (Number(p3.y) || 0) - ey),
      tangentError: Math.hypot((Number(lastC2.x) || 0) - ec2x, (Number(lastC2.y) || 0) - ec2y),
      tangentProtected,
    };
  }
  const HARD_CONTINUOUS_SPIRAL_MODES = new Set([
    'phase',
    'minimalTurn',
    'phaseCircle',
    'coordinated',
    'coordinatedFromCenter',
  ]);
  const hardContinuousSpiralMode = (mode) => HARD_CONTINUOUS_SPIRAL_MODES.has(String(mode || ''));
  // Only the FOUR continuous Spiral transports are allowed to seal a period.
  // Ordinary 13.2 modes (topology/calm/circleSlide/topoCircle/fade/light)
  // must retain their original potentially discontinuous geometry.
  const usesPhaseClones = (mode, a, b) =>
    mode === 'phaseCircle' &&
    window.SomataMorphRegistry?.get('phaseCircle')?.usesCloneTransport(a, b) === true;
  function shouldSealWoundSpiral(mode, source, target) {
    return (
      hardContinuousSpiralMode(mode) &&
      !usesPhaseClones(mode, source, target) &&
      source?.spiralEnabled === true &&
      target?.spiralEnabled === true &&
      source?.spiralClosed !== false &&
      target?.spiralClosed !== false &&
      Math.abs(Number(source.spiralOrder) || 0) > 1e-8 &&
      Math.abs(Number(target.spiralOrder) || 0) > 1e-8
    );
  }

  // A completed Spiral rail with an explicit authored bridge is still a
  // PERIOD: the bridge terminates at transformed(start), not at start.
  // Earlier versions skipped every such rail in the closure compute pass.
  // When N/K changes, interpolating the four controls does NOT preserve the
  // rotated/scaled period equation, and repeated windings visibly separate.
  // Use the same rule for EVERY original continuous Spiral transport,
  // including both version-13.2 and Stage10 prepared-rail constructors.
  // Closed zero-order handoffs are handled by the separate authored shape
  // choreography; they are not silently converted to a periodic spiral.
  function hardContinuousPeriodicClosureSpec(path, cubics, layer) {
    const original = periodicClosureSpec(path, cubics, layer);
    if (
      original.periodic ||
      layer?.spiralEnabled !== true ||
      layer?.spiralClosed === false ||
      path?.spiralExplicitBridge !== true ||
      !cubics?.length
    )
      return original;
    if (path.__somataGeometricGerm === true)
      return {
        periodic: true,
        delta: 0,
        logScale: 0,
        error: 0,
        tangentProtected: false,
        tangentError: 0,
      };
    const start = path?.points?.[0] || {};
    const delta = Number(start.__spiralDelta),
      scale = Number(start.__spiralTargetScale);
    if (!Number.isFinite(delta) || !(Number.isFinite(scale) && scale > 0)) return original;
    const a = cubics[0].p0,
      z = cubics[cubics.length - 1].p3;
    const ex = scale * (Math.cos(delta) * a.x - Math.sin(delta) * a.y);
    const ey = scale * (Math.sin(delta) * a.x + Math.cos(delta) * a.y);
    const hasSeamFillet = (path.points || []).some(
      (p) =>
        p?.__spiralClosureProtected === true ||
        p?.__spiralSeamProtected === true ||
        Boolean(p?.__spiralClosureFillet),
    );
    return {
      periodic: true,
      delta,
      logScale: Math.log(scale),
      error: Math.hypot(ex - z.x, ey - z.y),
      tangentProtected: hasSeamFillet,
      tangentError: 0,
    };
  }
  function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function splitCubic(q, t) {
    const p01 = lerpPoint(q.p0, q.c1, t),
      p12 = lerpPoint(q.c1, q.c2, t),
      p23 = lerpPoint(q.c2, q.p3, t),
      p012 = lerpPoint(p01, p12, t),
      p123 = lerpPoint(p12, p23, t),
      p = lerpPoint(p012, p123, t);
    return [
      { p0: { ...q.p0 }, c1: p01, c2: p012, p3: p },
      { p0: p, c1: p123, c2: p23, p3: { ...q.p3 } },
    ];
  }
  function cubicSubsegment(q, a, b) {
    a = clamp(a, 0, 1);
    b = clamp(b, a, 1);
    let out;
    if (a <= 1e-12 && b >= 1 - 1e-12)
      out = { ...q, p0: { ...q.p0 }, c1: { ...q.c1 }, c2: { ...q.c2 }, p3: { ...q.p3 } };
    else {
      let left = q;
      if (b < 1 - 1e-12) left = splitCubic(q, b)[0];
      out = a <= 1e-12 ? left : splitCubic(left, a / Math.max(1e-12, b))[1];
    }

    out.__profileCorner0 = a <= 1e-8 && q.__profileCorner0 === true;
    out.__profileCorner1 = b >= 1 - 1e-8 && q.__profileCorner1 === true;
    return out;
  }
  function cubicPoint(q, t) {
    const u = 1 - t,
      u2 = u * u,
      t2 = t * t;
    return {
      x: u2 * u * q.p0.x + 3 * u2 * t * q.c1.x + 3 * u * t2 * q.c2.x + t2 * t * q.p3.x,
      y: u2 * u * q.p0.y + 3 * u2 * t * q.c1.y + 3 * u * t2 * q.c2.y + t2 * t * q.p3.y,
    };
  }
  function cubicSpeed(q, t) {
    const u = 1 - t,
      dx = 3 * u * u * (q.c1.x - q.p0.x) + 6 * u * t * (q.c2.x - q.c1.x) + 3 * t * t * (q.p3.x - q.c2.x),
      dy = 3 * u * u * (q.c1.y - q.p0.y) + 6 * u * t * (q.c2.y - q.c1.y) + 3 * t * t * (q.p3.y - q.c2.y);
    return Math.hypot(dx, dy);
  }
  function cubicArcLengthGauss3(q, a = 0, b = 1) {
    const m = (a + b) * 0.5,
      h = (b - a) * 0.5,
      x = 0.7745966692414834;
    return Math.max(
      1e-12,
      h * ((8 / 9) * cubicSpeed(q, m) + (5 / 9) * (cubicSpeed(q, m - h * x) + cubicSpeed(q, m + h * x))),
    );
  }
  function cubicApproxLength(q) {
    return Math.max(1e-9, cubicArcLengthGauss3(q, 0, 1));
  }
  function cubicArcLut(q, steps = 12) {
    const ts = new Float32Array(steps + 1),
      ls = new Float32Array(steps + 1);
    let total = 0;
    for (let i = 1; i <= steps; i++) {
      const a = (i - 1) / steps,
        t = i / steps;
      total += cubicArcLengthGauss3(q, a, t);
      ts[i] = t;
      ls[i] = total;
    }
    return { ts, ls, total: Math.max(1e-9, total) };
  }
  function buildRailArcMap(cubics) {
    const src = Array.isArray(cubics) ? cubics : [],
      entries = [],
      knots = [0];
    let total = 0;
    for (let i = 0; i < src.length; i++) {
      const lut = cubicArcLut(src[i]);
      entries.push({ q: src[i], lut, start: total, end: total + lut.total });
      total += lut.total;
    }
    total = Math.max(1e-9, total);
    for (const e of entries) knots.push(e.end / total);
    knots[knots.length - 1] = 1;
    return { entries, total, knots };
  }
  function localTAtArcFraction(entry, localFraction) {
    const f = clamp(localFraction, 0, 1),
      target = f * entry.lut.total,
      ls = entry.lut.ls,
      ts = entry.lut.ts;
    let hi = 1;
    while (hi < ls.length && ls[hi] < target) hi++;
    if (hi >= ls.length) return 1;
    const lo = Math.max(0, hi - 1),
      den = Math.max(1e-9, ls[hi] - ls[lo]),
      u = (target - ls[lo]) / den;
    return ts[lo] + (ts[hi] - ts[lo]) * u;
  }
  function railLocationAtFraction(map, f) {
    const target = clamp(f, 0, 1) * map.total,
      entries = map.entries;
    // Arc-map endpoints are monotonically increasing. Find precisely the first
    // endpoint accepted by the old linear walk, using the SAME 1e-9 tolerance.
    // Morph may query thousands of common knots per branch: O(log N) instead
    // of revisiting O(N) entries for each query.
    let lo = 0,
      hi = entries.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (target > entries[mid].end + 1e-9) lo = mid + 1;
      else hi = mid;
    }
    const e = entries[lo],
      local = (target - e.start) / Math.max(1e-9, e.end - e.start);
    return { index: lo, t: localTAtArcFraction(e, local) };
  }
  function uniqueFractions(values) {
    const a = (values || []).map((v) => clamp(Number(v) || 0, 0, 1)).sort((x, y) => x - y),
      out = [];
    for (const v of a) if (!out.length || Math.abs(v - out[out.length - 1]) > 1e-6) out.push(v);
    if (!out.length || out[0] > 1e-8) out.unshift(0);
    else out[0] = 0;
    if (out[out.length - 1] < 1 - 1e-8) out.push(1);
    else out[out.length - 1] = 1;
    return out;
  }
  function splitRailAtFractions(map, fractions) {
    const out = [];
    for (let k = 0; k < fractions.length - 1; k++) {
      const fa = fractions[k],
        fb = fractions[k + 1];
      if (fb - fa < 1e-8) continue;
      const a = railLocationAtFraction(map, fa),
        b = railLocationAtFraction(map, fb);
      if (a.index !== b.index) {
        /* union includes all original knots, so only floating-point boundary drift can land here */ const boundary =
          map.knots[Math.min(a.index, b.index) + 1];
        const aa = railLocationAtFraction(map, Math.min(fb, boundary - 1e-8)),
          bb = railLocationAtFraction(map, Math.max(fa, boundary + 1e-8));
        if (a.index !== aa.index || bb.index !== b.index) continue;
      }
      const e = map.entries[a.index];
      let tb = b.index === a.index ? b.t : 1;
      let ta = a.t;
      if (k === fractions.length - 2 && fb >= 1 - 1e-8) {
        const last = map.entries.length - 1;
        if (a.index === last) tb = 1;
      }
      const r = cubicSubsegment(e.q, ta, tb),
        lw0 = Math.log(Math.max(0.02, Number(e.q.widthScale0) || 1)),
        lw1 = Math.log(Math.max(0.02, Number(e.q.widthScale1) || 1));
      r.widthScale0 = Math.exp(lw0 + (lw1 - lw0) * ta);
      r.widthScale1 = Math.exp(lw0 + (lw1 - lw0) * tb);
      out.push(r);
    }
    return out;
  }
  function equalizeCubicRailsByArc(srcCubics, dstCubics, sourceMap = null, targetMap = null) {
    const sm = sourceMap || buildRailArcMap(srcCubics),
      dm = targetMap || buildRailArcMap(dstCubics),
      fractions = uniqueFractions([0, 1, ...sm.knots, ...dm.knots]);
    const source = splitRailAtFractions(sm, fractions),
      target = splitRailAtFractions(dm, fractions);
    if (source.length !== target.length || !source.length) {
      const count = Math.max(srcCubics.length, dstCubics.length),
        fallback = (cubics) => {
          const map = buildRailArcMap(cubics),
            f = [];
          for (let i = 0; i <= count; i++) f.push(i / count);
          return splitRailAtFractions(map, f);
        };
      return {
        source: fallback(srcCubics),
        target: fallback(dstCubics),
        fractions: Array.from({ length: count + 1 }, (_, i) => i / count),
        fallback: true,
      };
    }
    return { source, target, fractions, fallback: false };
  }
  function authoredFlagFractions(path, map, kind = 'key') {
    const knots = map?.knots || [];

    const pts = path?.points || [],
      logical = path?.lampCornerFlags || [],
      geometric = path?.cornerFlags || [];
    const out = kind === 'key' ? [0, 1] : [];
    for (let i = 1; i < pts.length - 1; i++) {
      const key = logical[i] === true || pts[i]?.__profileKeyCorner === true;
      if (kind === 'key' ? !key : key || !(geometric[i] === true || pts[i]?.__profileCorner === true))
        continue;
      let k = i;
      if (knots.length !== pts.length) {
        let best = Infinity;
        k = -1;
        for (let j = 1; j < knots.length - 1; j++) {
          const q = map?.entries?.[j - 1]?.q?.p3;
          if (!q) continue;
          const d = (q.x - pts[i].x) ** 2 + (q.y - pts[i].y) ** 2;
          if (d < best) {
            best = d;
            k = j;
          }
        }
      }
      if (k > 0 && k < knots.length - 1) out.push(knots[k]);
    }
    return out.sort((a, b) => a - b).filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 1e-6);
  }
  function cubicRailPoints(cubics) {
    if (!cubics?.length) return [];
    const out = [{ ...cubics[0].p0, widthScale: Math.max(0.02, Number(cubics[0].widthScale0) || 1) }];
    for (const q of cubics) out.push({ ...q.p3, widthScale: Math.max(0.02, Number(q.widthScale1) || 1) });
    return out;
  }
  function cubicRailLength(cubics) {
    let d = 0;
    for (const q of cubics || []) d += cubicApproxLength(q);
    return d;
  }
  function cubicKnotFractions(cubics) {
    const src = cubics || [];
    if (!src.length) return [0, 1];
    return buildRailArcMap(src).knots;
  }
  function polarSequence(cubics) {
    const seq = [];
    for (let i = 0; i < cubics.length; i++) {
      const q = cubics[i];
      if (i === 0) seq.push(q.p0);
      seq.push(q.c1, q.c2, q.p3);
    }
    let prev = null;
    const out = [];
    for (const p of seq) {
      let a = Math.atan2(Number(p.y) || 0, Number(p.x) || 0);
      if (prev !== null) {
        while (a - prev > Math.PI) a -= TWO_PI;
        while (a - prev < -Math.PI) a += TWO_PI;
      }
      prev = a;
      out.push({ r: Math.hypot(Number(p.x) || 0, Number(p.y) || 0), a });
    }
    return out;
  }
  // Keep each cubic's authored p0 as a separate sample. Some polygon/order-0
  // rails have deliberate disconnected segments: the legacy compact 3-per-
  // cubic sequence aliases p0(i) to p3(i-1), reflecting a vertex across the
  // path when their coordinates differ. Coordinated GPU pairs MUST retain
  // the exact authored endpoint geometry at both t=0 and t=1.
  function polarSequenceExactCubics(cubics) {
    const out = [];
    let prev = null;
    for (const q of cubics)
      for (const p of [q.p0, q.c1, q.c2, q.p3]) {
        let a = Math.atan2(Number(p.y) || 0, Number(p.x) || 0);
        if (prev !== null) {
          while (a - prev > Math.PI) a -= TWO_PI;
          while (a - prev < -Math.PI) a += TWO_PI;
        }
        prev = a;
        out.push({ r: Math.hypot(Number(p.x) || 0, Number(p.y) || 0), a });
      }
    return out;
  }
  const { alignWeightedWholeTurns: alignMinimalTurnPolarAngles } = window.SomataRotationMath;
  const { alignSectorPolarAngles } = window.SomataMorphMath;
  // CPU mirror of the shared coordinated geometry clock. Do not phase-warp
  // individual knots: neighboring Bezier controls must move coherently.
  function coordinatedVertexT(t, knot, retiring = false) {
    const u = Math.max(0, Math.min(1, Number(t) || 0));
    return retiring ? u * u * (3 - 2 * u) : u;
  }
  function packPairCubics132(
    srcCubics,
    dstCubics,
    srcPresent,
    dstPresent,
    out,
    offset,
    spiralTransport = 'phaseCircle',
    profileMorphMode = String(state?.morph?.mode || 'circleSlide'),
    forceCartesianPath = false,
    standardSpiralSlide = false,
  ) {
    const n = Math.min(srcCubics.length, dstCubics.length);
    if (!n) return offset;
    const sp = polarSequence(srcCubics),
      dp = polarSequence(dstCubics);
    if (spiralTransport === 'minimalTurn' || spiralTransport === 'torn') alignMinimalTurnPolarAngles(sp, dp);
    else {
      const shift = Math.round((sp[0].a - dp[0].a) / TWO_PI) * TWO_PI;
      for (const p of dp) p.a += shift;
    }
    if (profileMorphMode === 'calm') {
      const limit = window.SomataMorphRegistry.get('calm').limitTurn;
      for (let i = 0; i < Math.min(sp.length, dp.length); i++) dp[i].a = sp[i].a + limit(dp[i].a - sp[i].a);
    }
    const at = (arr, i, slot) => arr[i * 3 + slot],
      minimal = spiralTransport === 'minimalTurn',
      forceCartesian =
        profileMorphMode === 'topology' || spiralTransport === 'continuous' || spiralTransport === 'topology';

    let pathMaxRadius = 1e-9;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 4; k++) {
        const s = at(sp, i, k),
          d = at(dp, i, k);
        pathMaxRadius = Math.max(pathMaxRadius, s.r, d.r);
      }
    let pathMaxPolarTurn = 0,
      pathNearOriginTurn = 0,
      visibleTurnEnergy = 0,
      visibleTurnWeight = 0,
      outerMaxTurn = 0,
      outerTurnEnergy = 0,
      outerTurnWeight = 0,
      outerSignedTurn = 0;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 4; k++) {
        const s = at(sp, i, k),
          d = at(dp, i, k);
        const signed = d.a - s.a,
          turn = Math.abs(signed),
          r = Math.max(s.r, d.r);
        pathMaxPolarTurn = Math.max(pathMaxPolarTurn, turn);
        if (Math.min(s.r, d.r) < pathMaxRadius * 0.006)
          pathNearOriginTurn = Math.max(pathNearOriginTurn, turn);
        const w = Math.max(0.01, r / pathMaxRadius);
        visibleTurnEnergy += turn * turn * w;
        visibleTurnWeight += w;
        if (r >= pathMaxRadius * 0.28) {
          outerMaxTurn = Math.max(outerMaxTurn, turn);
          outerTurnEnergy += turn * turn * w;
          outerSignedTurn += signed * w;
          outerTurnWeight += w;
        }
      }
    const visibleTurnRms = Math.sqrt(visibleTurnEnergy / Math.max(1e-9, visibleTurnWeight)),
      outerTurnRms = Math.sqrt(outerTurnEnergy / Math.max(1e-9, outerTurnWeight)),
      coherentOuterTurn = Math.abs(outerSignedTurn / Math.max(1e-9, outerTurnWeight));

    // Polar transport is what gives Phase / Phase-circle their circular motion, but a
    // changed winding can make one retained rail accumulate whole extra revolutions.
    // Never animate such a correspondence as a multi-turn spin: use the same retained
    // cubic endpoints with Cartesian transport for that one rail instead.  Minimal-turn
    // stays polar for all ordinary <= 180° moves and falls back only when a winding
    // mismatch makes a least-turn polar path impossible.
    const impossiblePolarWinding = pathMaxPolarTurn > Math.PI + 1e-5 || pathNearOriginTurn > Math.PI * 0.85;
    const phaseCircleSpinRisk =
      spiralTransport === 'phaseCircle' &&
      (impossiblePolarWinding ||
        (coherentOuterTurn > Math.PI * 0.92 && outerTurnRms > Math.PI * 0.72) ||
        (outerMaxTurn > Math.PI * 1.05 && visibleTurnRms > Math.PI * 0.7));
    const phaseSpinRisk = spiralTransport === 'phase' && impossiblePolarWinding;
    const minimalSpinRisk = (minimal || spiralTransport === 'torn') && impossiblePolarWinding;
    const pathCartesianFallback =
      forceCartesian || forceCartesianPath || phaseCircleSpinRisk || phaseSpinRisk || minimalSpinRisk;
    for (let i = 0; i < n; i++) {
      const s0 = at(sp, i, 0),
        s1 = at(sp, i, 1),
        s2 = at(sp, i, 2),
        s3 = at(sp, i, 3),
        d0 = at(dp, i, 0),
        d1 = at(dp, i, 1),
        d2 = at(dp, i, 2),
        d3 = at(dp, i, 3);
      const s = srcCubics[i],
        d = dstCubics[i],
        o = offset * FLOATS_PER_CUBIC;
      const localMaxPolarTurn = Math.max(
        Math.abs(d0.a - s0.a),
        Math.abs(d1.a - s1.a),
        Math.abs(d2.a - s2.a),
        Math.abs(d3.a - s3.a),
      );
      out[o] = s0.r;
      out[o + 1] = s0.a;
      out[o + 2] = s1.r;
      out[o + 3] = s1.a;
      out[o + 4] = s2.r;
      out[o + 5] = s2.a;
      out[o + 6] = s3.r;
      out[o + 7] = s3.a;
      out[o + 8] = d0.r;
      out[o + 9] = d0.a;
      out[o + 10] = d1.r;
      out[o + 11] = d1.a;
      out[o + 12] = d2.r;
      out[o + 13] = d2.a;
      out[o + 14] = d3.r;
      out[o + 15] = d3.a;
      out[o + 16] = Math.max(0.02, Number(s.widthScale0) || 1);
      out[o + 17] = Math.max(0.02, Number(s.widthScale1) || 1);
      out[o + 18] = Math.max(0.02, Number(d.widthScale0) || 1);
      out[o + 19] = Math.max(0.02, Number(d.widthScale1) || 1); // A cloned rail is not an extra opaque rail at the start/end of a
      // split/merge. Keep ordinary matching branches fully present, but
      // fade cloned/retiring branches smoothly so they cannot produce
      // bright doubled chunks while sharing the same source geometry.
      out[o + 20] = srcPresent ? 1 : 0;
      out[o + 21] = dstPresent ? 1 : 0;
      out[o + 22] = pathCartesianFallback ? 1 : 0;
      out[o + 23] = (i === 0 ? 1 : 0) + (i === n - 1 ? 2 : 0);
      offset++;
    }
    return offset;
  }

  function packPairCubics(
    srcCubics,
    dstCubics,
    srcPresent,
    dstPresent,
    out,
    offset,
    spiralTransport = 'phaseCircle',
    profileMorphMode = String(state?.morph?.mode || 'circleSlide'),
    forceCartesianPath = false,
    standardSpiralSlide = false,
    isGeometricGerm = false,
    selectedSlide = null,
    isCoordinatedRetirement = false,
  ) {
    const n = Math.min(srcCubics.length, dstCubics.length);
    if (!n) return offset;
    const exactKnots = spiralTransport === 'coordinated';
    const sp = exactKnots ? polarSequenceExactCubics(srcCubics) : polarSequence(srcCubics);
    const dp = exactKnots ? polarSequenceExactCubics(dstCubics) : polarSequence(dstCubics);
    const sharedSlide = ['minimal', 'sector', 'phase'].includes(selectedSlide)
      ? selectedSlide
      : ['minimal', 'sector', 'phase'].includes(state?.morph?.slideType)
        ? state.morph.slideType
        : 'minimal';
    if (sharedSlide === 'minimal') alignMinimalTurnPolarAngles(sp, dp);
    else if (sharedSlide === 'sector') alignSectorPolarAngles(sp, dp);
    else {
      const shift = Math.round((sp[0].a - dp[0].a) / TWO_PI) * TWO_PI;
      for (const p of dp) p.a += shift;
    }
    if (profileMorphMode === 'calm') {
      const limit = window.SomataMorphRegistry.get('calm').limitTurn;
      for (let i = 0; i < Math.min(sp.length, dp.length); i++) dp[i].a = sp[i].a + limit(dp[i].a - sp[i].a);
    }
    const at = (arr, i, slot) => arr[i * (exactKnots ? 4 : 3) + slot],
      minimal = spiralTransport === 'minimalTurn',
      forceCartesian =
        profileMorphMode === 'topology' || spiralTransport === 'continuous' || spiralTransport === 'topology';

    let pathMaxRadius = 1e-9;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 4; k++) {
        const s = at(sp, i, k),
          d = at(dp, i, k);
        pathMaxRadius = Math.max(pathMaxRadius, s.r, d.r);
      }
    let pathMaxPolarTurn = 0,
      pathNearOriginTurn = 0,
      visibleTurnEnergy = 0,
      visibleTurnWeight = 0,
      outerMaxTurn = 0,
      outerTurnEnergy = 0,
      outerTurnWeight = 0,
      outerSignedTurn = 0;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 4; k++) {
        const s = at(sp, i, k),
          d = at(dp, i, k);
        const signed = d.a - s.a,
          turn = Math.abs(signed),
          r = Math.max(s.r, d.r);
        pathMaxPolarTurn = Math.max(pathMaxPolarTurn, turn);
        if (Math.min(s.r, d.r) < pathMaxRadius * 0.006)
          pathNearOriginTurn = Math.max(pathNearOriginTurn, turn);
        const w = Math.max(0.01, r / pathMaxRadius);
        visibleTurnEnergy += turn * turn * w;
        visibleTurnWeight += w;
        if (r >= pathMaxRadius * 0.28) {
          outerMaxTurn = Math.max(outerMaxTurn, turn);
          outerTurnEnergy += turn * turn * w;
          outerSignedTurn += signed * w;
          outerTurnWeight += w;
        }
      }
    const visibleTurnRms = Math.sqrt(visibleTurnEnergy / Math.max(1e-9, visibleTurnWeight)),
      outerTurnRms = Math.sqrt(outerTurnEnergy / Math.max(1e-9, outerTurnWeight)),
      coherentOuterTurn = Math.abs(outerSignedTurn / Math.max(1e-9, outerTurnWeight));

    // Polar transport is what gives Phase / Phase-circle their circular motion, but a
    // changed winding can make one retained rail accumulate whole extra revolutions.
    // Never animate such a correspondence as a multi-turn spin: use the same retained
    // cubic endpoints with Cartesian transport for that one rail instead.  Minimal-turn
    // stays polar for all ordinary <= 180° moves and falls back only when a winding
    // mismatch makes a least-turn polar path impossible.
    const impossiblePolarWinding = pathMaxPolarTurn > Math.PI + 1e-5 || pathNearOriginTurn > Math.PI * 0.85;
    const phaseCircleSpinRisk =
      spiralTransport === 'phaseCircle' &&
      (impossiblePolarWinding ||
        (coherentOuterTurn > Math.PI * 0.92 && outerTurnRms > Math.PI * 0.72) ||
        (outerMaxTurn > Math.PI * 1.05 && visibleTurnRms > Math.PI * 0.7));
    const phaseSpinRisk = spiralTransport === 'phase' && impossiblePolarWinding;
    const minimalSpinRisk = (minimal || spiralTransport === 'torn') && impossiblePolarWinding;
    const pathCartesianFallback =
      forceCartesian || forceCartesianPath || phaseCircleSpinRisk || phaseSpinRisk || minimalSpinRisk;
    for (let i = 0; i < n; i++) {
      const s0 = at(sp, i, 0),
        s1 = at(sp, i, 1),
        s2 = at(sp, i, 2),
        s3 = at(sp, i, 3),
        d0 = at(dp, i, 0),
        d1 = at(dp, i, 1),
        d2 = at(dp, i, 2),
        d3 = at(dp, i, 3);
      const s = srcCubics[i],
        d = dstCubics[i],
        o = offset * FLOATS_PER_CUBIC;
      const gap = (a, b) =>
        Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0)) >
        1e-5;
      const boundaryBefore =
        exactKnots && i > 0 && (gap(srcCubics[i - 1].p3, s.p0) || gap(dstCubics[i - 1].p3, d.p0));
      const boundaryAfter =
        exactKnots && i + 1 < n && (gap(s.p3, srcCubics[i + 1].p0) || gap(d.p3, dstCubics[i + 1].p0));
      const localMaxPolarTurn = Math.max(
        Math.abs(d0.a - s0.a),
        Math.abs(d1.a - s1.a),
        Math.abs(d2.a - s2.a),
        Math.abs(d3.a - s3.a),
      );
      out[o] = s0.r;
      out[o + 1] = s0.a;
      out[o + 2] = s1.r;
      out[o + 3] = s1.a;
      out[o + 4] = s2.r;
      out[o + 5] = s2.a;
      out[o + 6] = s3.r;
      out[o + 7] = s3.a;
      out[o + 8] = d0.r;
      out[o + 9] = d0.a;
      out[o + 10] = d1.r;
      out[o + 11] = d1.a;
      out[o + 12] = d2.r;
      out[o + 13] = d2.a;
      out[o + 14] = d3.r;
      out[o + 15] = d3.a;
      out[o + 16] = Math.max(0.02, Number(s.widthScale0) || 1);
      out[o + 17] = Math.max(0.02, Number(s.widthScale1) || 1);
      out[o + 18] = Math.max(0.02, Number(d.widthScale0) || 1);
      out[o + 19] = Math.max(0.02, Number(d.widthScale1) || 1); // A cloned rail is not an extra opaque rail at the start/end of a
      // split/merge. Keep ordinary matching branches fully present, but
      // fade cloned/retiring branches smoothly so they cannot produce
      // bright doubled chunks while sharing the same source geometry.
      out[o + 20] = srcPresent ? 1 : 0;
      out[o + 21] = dstPresent ? 1 : 0;
      out[o + 22] = pathCartesianFallback ? 1 : 0;
      out[o + 23] =
        (i === 0 || boundaryBefore ? 1 : 0) +
        (i === n - 1 || boundaryAfter ? 2 : 0) +
        (spiralTransport === 'coordinated' ? 4 : 0) +
        (isGeometricGerm ? 8 : 0) +
        (profileMorphMode === 'topoCircleOpacity' ? 16 : 0) +
        (isCoordinatedRetirement ? 32 : 0);
      offset++;
    }
    return offset;
  }
  const { shortestAngleDelta, angularRadialCost: minimalTurnPathPairCost } = window.SomataRotationMath;
  function minimalTurnRetainedBezierPairCost(a, b, srcLayer, dstLayer, srcMetrics = null, dstMetrics = null) {
    try {
      const metrics = (path, layer, cache) => {
        if (cache?.has(path)) return cache.get(path);
        const cubics = path?.__morphBoundarySourceCubics || endpointCubics(path, layer),
          map = cubics.length ? buildRailArcMap(cubics) : null,
          rec = { cubics, map };
        try {
          cache?.set(path, rec);
        } catch (error) {
          noteSuppressedError('gpu/spiral-bezier-morph-renderer#metrics', error);
        }
        return rec;
      };
      const am = metrics(a, srcLayer, srcMetrics).map,
        bm = metrics(b, dstLayer, dstMetrics).map;
      if (!am || !bm) return minimalTurnPathPairCost(a, b);
      const samples = 13;
      let maxR = 1;
      const samplePoint = (map, q) => {
        const loc = railLocationAtFraction(map, q),
          e = map.entries[loc.index];
        return cubicPoint(e.q, loc.t);
      };
      for (let k = 0; k < samples; k++) {
        const q = k / (samples - 1),
          pa = samplePoint(am, q),
          pb = samplePoint(bm, q);
        maxR = Math.max(maxR, Math.hypot(pa.x, pa.y), Math.hypot(pb.x, pb.y));
      }
      let cost = 0,
        weight = 0;
      for (let k = 0; k < samples; k++) {
        const q = k / (samples - 1),
          pa = samplePoint(am, q),
          pb = samplePoint(bm, q),
          ar = Math.hypot(pa.x, pa.y),
          br = Math.hypot(pb.x, pb.y),
          w = Math.max(0.02, Math.min(1, Math.max(ar, br) / maxR)),
          da = shortestAngleDelta(Math.atan2(pa.y, pa.x), Math.atan2(pb.y, pb.x)),
          dr = (ar - br) / maxR;
        cost += da * da * w + 0.35 * dr * dr;
        weight += w + 0.35;
      }
      return cost / Math.max(1e-6, weight);
    } catch (_) {
      return minimalTurnPathPairCost(a, b);
    }
  }
  const { spiralBranchPhase, signedUnitDelta, stableSpiralPairs } = window.SomataPhaseMatching;
  // The first, Polygon-compatible Topological morph: preserve the cyclic
  // identity of roots, then move corresponding Bézier controls in Cartesian
  // coordinates. This deliberately does NOT use phaseCircle's branch/phase
  // correspondence. At unequal N, choose a one-to-one, order-preserving
  // subset of roots with minimum planar movement. Missing physical branches
  // grow/retire from neighboring *moving* branches, not opacity crossfades.
  function pairTopologySpiralPaths(srcPaths, dstPaths, srcLayer, dstLayer) {
    const entries = (paths, layer) =>
      (paths || [])
        .map((path, i) => ({
          path,
          i,
          phase: spiralBranchPhase(path, layer, i, paths.length),
          root: path?.points?.[0] || { x: 0, y: 0 },
        }))
        .sort((a, b) => a.phase - b.phase || a.i - b.i);
    const source = entries(srcPaths, srcLayer),
      target = entries(dstPaths, dstLayer);
    if (!source.length || !target.length) return [];
    const sourceIsShort = source.length <= target.length;
    const shorter = sourceIsShort ? source : target,
      longer = sourceIsShort ? target : source;
    const n = shorter.length,
      m = longer.length;
    const cost = (a, b) => {
      const dx = (Number(a.root.x) || 0) - (Number(b.root.x) || 0);
      const dy = (Number(a.root.y) || 0) - (Number(b.root.y) || 0);
      return dx * dx + dy * dy;
    };
    let best = Infinity,
      selected = null;
    // Rotating the larger cyclic list covers the seam without changing
    // the physical order of any rail. The DP never clones a source branch.
    for (let shift = 0; shift < m; shift++) {
      const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
      const take = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
      for (let j = 0; j <= m; j++) dp[0][j] = 0;
      for (let i = 1; i <= n; i++)
        for (let j = i; j <= m; j++) {
          const skip = dp[i][j - 1];
          const match = dp[i - 1][j - 1] + cost(shorter[i - 1], longer[(j - 1 + shift) % m]);
          if (match < skip - 1e-7) {
            dp[i][j] = match;
            take[i][j] = 1;
          } else dp[i][j] = skip;
        }
      const result = dp[n][m];
      if (result >= best - 1e-7) continue;
      const indices = new Array(n);
      let i = n,
        j = m;
      while (i > 0 && j > 0) {
        if (take[i][j]) {
          indices[i - 1] = (j - 1 + shift) % m;
          i--;
          j--;
        } else j--;
      }
      if (i !== 0) continue;
      best = result;
      selected = indices;
    }
    if (!selected) return [];
    const result = [],
      usedSource = new Set(),
      usedTarget = new Set();
    for (let i = 0; i < n; i++) {
      const a = sourceIsShort ? shorter[i] : longer[selected[i]];
      const b = sourceIsShort ? longer[selected[i]] : shorter[i];
      usedSource.add(a.i);
      usedTarget.add(b.i);
      result.push({
        src: a.path,
        dst: b.path,
        sourcePathPresent: true,
        targetPathPresent: true,
        stableSpiralPairing: true,
        topologyRootPair: true,
      });
    }
    for (const a of source)
      if (!usedSource.has(a.i))
        result.push({
          src: a.path,
          dst: a.path,
          sourcePathPresent: true,
          targetPathPresent: false,
          topologyUnmatched: true,
        });
    for (const b of target)
      if (!usedTarget.has(b.i))
        result.push({
          src: b.path,
          dst: b.path,
          sourcePathPresent: false,
          targetPathPresent: true,
          topologyUnmatched: true,
        });
    // Reuse ONLY the physical neighbor/germ attachment primitive; the
    // matching, interpolation and mode authority above are Topological.
    return expandCoordinatedGeometricGerms(result, srcLayer, dstLayer);
  }
  function pairMinimalTurnSpiralPaths(srcPaths, dstPaths, srcLayer = null, dstLayer = null) {
    const src = Array.isArray(srcPaths) ? srcPaths : [],
      dst = Array.isArray(dstPaths) ? dstPaths : [];
    const srcMetrics = new Map(),
      dstMetrics = new Map();
    const pairCost = (a, b) =>
      minimalTurnRetainedBezierPairCost(a, b, srcLayer, dstLayer, srcMetrics, dstMetrics);
    const pairs = stableSpiralPairs(src, dst, srcLayer, dstLayer, pairCost);
    for (const pair of pairs || []) {
      pair._sourceRetainedMetrics = srcMetrics.get(pair.src) || null;
      pair._targetRetainedMetrics = dstMetrics.get(pair.dst) || null;
      pair.minimalTurnStablePairing = true;
    }
    return pairs || [];
  }
  // Torn slide never duplicates an existing ray. Pair each source/target at
  // most once; unmatched rays simply appear/disappear (a genuine tear).
  const pairTornWithoutClones = SomataBranchMatching.pairPlanarOneToOne;
  // Stage 3 unified correspondence: no branch in either endpoint can be
  // assigned twice. Phase preserves rank, Sector favors local angular bins,
  // Minimal uses the existing global planar assignment.
  // Coordinated morph alone: physical rails retain their CYCLIC order.
  // A global rectangular Hungarian assignment can cross correspondences and
  // relabel other physical branches whenever N changes by just one. The
  // following cyclic monotone assignment has no such reorder: extra target
  // rails are inserted between matched neighbors; extra source rails retire.
  // The three slides vary the metric, never the one-to-one/order invariant.
  // SOMATA 14 EXPERIMENT: 13.27 Stage10 coordinated GEOMETRIC correspondence.
  // This reference path deliberately avoids all subsequent moving-parent GPU
  // attachment and automatic cyclic re-pairing. Other transports are intact.
  const pairCoordinatedStage10 = window.SomataCoordinatedRules.pairSpirals;
  // Stage 4: a surplus rail is no longer opacity-faded.  It starts (or ends)
  // as a *zero-length geometric germ*, attached to a sampled point on an
  // existing, matched rail. The germ has its own object and DOES NOT duplicate
  // any physical source/target rail or wind around the center as a clone.
  // This guarantees a continuous parametrized rail, NOT arbitrary graph
  // topology (connections between different rails can still change).
  function coordinatedGermAnchorStage10(physicalPath, parentPaths, physicalLayer, parentLayer) {
    const actual = endpointCubics(physicalPath, physicalLayer);
    const endpoints = actual.length
      ? [actual[0].p0, actual[actual.length - 1].p3]
      : physicalPath?.points || [];
    const references = parentPaths.length ? parentPaths : [physicalPath];
    let anchor = null,
      best = Infinity;
    for (const parent of references) {
      const rails = endpointCubics(parent, parentLayer);
      for (const q of rails) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const p = t === 0 ? q.p0 : t === 1 ? q.p3 : cubicPoint(q, t);
          for (const e of endpoints) {
            const dx = (Number(e?.x) || 0) - (Number(p.x) || 0),
              dy = (Number(e?.y) || 0) - (Number(p.y) || 0),
              d = dx * dx + dy * dy;
            if (d < best) {
              best = d;
              anchor = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
            }
          }
        }
      }
    }
    if (!anchor) {
      const p = endpoints[0] || { x: 0, y: 0 };
      anchor = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
    }
    return anchor;
  }
  function coordinatedCollapsedPathStage10(reference, anchor, layer) {
    const cubics = endpointCubics(reference, layer);
    // Preserve the actual cubic count; avoid an arc-length map of a zero
    // rail when packing.  A thin geometric germ, NOT an opacity fade.
    const folded = cubics.map(() => ({
      p0: { ...anchor },
      c1: { ...anchor },
      c2: { ...anchor },
      p3: { ...anchor },
      widthScale0: 0.02,
      widthScale1: 0.02,
    }));
    return {
      points: [{ ...anchor }, { ...anchor }],
      _bezierSegments: folded,
      __carrierMapped: true,
      __somataGeometricGerm: true,
      closed: false,
      spiralExplicitBridge: true,
    };
  }
  function expandCoordinatedGeometricGermsStage10(pairs, srcLayer, dstLayer) {
    const matched = pairs.filter((p) => p.sourcePathPresent !== false && p.targetPathPresent !== false);
    const sourceParents = matched.map((p) => p.src),
      targetParents = matched.map((p) => p.dst);
    for (const pair of pairs) {
      const birth = pair.sourcePathPresent === false,
        retire = pair.targetPathPresent === false;
      if (!birth && !retire) continue;
      if (birth) {
        const anchor = coordinatedGermAnchorStage10(pair.dst, sourceParents, dstLayer, srcLayer);
        pair.src = coordinatedCollapsedPathStage10(pair.dst, anchor, dstLayer);
        pair.coordinatedGerm = 'birth';
        pair.coordinatedAnchor = anchor;
      } else {
        const anchor = coordinatedGermAnchorStage10(pair.src, targetParents, srcLayer, dstLayer);
        pair.dst = coordinatedCollapsedPathStage10(pair.src, anchor, srcLayer);
        pair.coordinatedGerm = 'retire';
        pair.coordinatedAnchor = anchor;
      }
      // Both endpoints now have geometry. The synthetic endpoint has
      // identically coincident controls and minimal width. No branch
      // receives a zero-alpha flag and no original path is reused.
      pair.sourcePathPresent = true;
      pair.targetPathPresent = true;
      pair.coordinatedUnmatched = false;
      pair.stableSpiralPairing = true;
    }
    return pairs;
  }

  const pairCoordinatedWithoutClones = window.SomataCoordinatedRules.pairCyclic;
  function coordinatedNeighborAttachment(
    physicalPath,
    matched,
    physicalSide,
    physicalLayer,
    otherLayer,
    usage = null,
  ) {
    const physical = endpointCubics(physicalPath, physicalLayer);
    if (!physical.length || !matched.length) return null;
    // A newborn winding must bud ON the body of another winding, not at
    // that winding's outer root (or at a free end). The old closest-to-root
    // rule systematically picked arc fraction 0..0.125, so buds appeared
    // on the sparse perimeter rather than among already drawn windings.
    // Find a site in the physical INTERIOR of a nearby surviving winding.
    const ownMap = buildRailArcMap(physical);
    const ownLocation = railLocationAtFraction(ownMap, 0.46);
    const ownBody =
      physicalSide === 'src'
        ? physical[0].p0
        : cubicPoint(ownMap.entries[ownLocation.index].q, ownLocation.t);
    const wantedPhase = spiralBranchPhase(
      physicalPath,
      physicalLayer,
      Number(physicalPath?.spiralBranchIndex) || 0,
      Math.max(1, Number(physicalLayer?.N) || matched.length),
    );
    const candidates = [];
    for (const parent of matched) {
      const neighbor = parent[physicalSide],
        rail = endpointCubics(neighbor, physicalLayer);
      if (!rail.length) continue;
      const phase = spiralBranchPhase(
        neighbor,
        physicalLayer,
        Number(neighbor?.spiralBranchIndex) || 0,
        Math.max(1, Number(physicalLayer?.N) || matched.length),
      );
      const angularGap = Math.abs(signedUnitDelta(wantedPhase, phase));
      candidates.push({ parent, neighbor, rail, angularGap, used: usage?.get(parent) || 0 });
    }
    if (!candidates.length) return null;
    // Only the two immediate angular neighbors are candidates. Selecting a
    // distant parent's winding because of a global XY coincidence would
    // scramble the physical branch graph on the next cycle.
    candidates.sort((a, b) => a.angularGap - b.angularGap || a.used - b.used);
    const immediate = candidates.slice(0, Math.min(2, candidates.length));
    let best = null,
      bestScore = Infinity;
    for (const candidate of immediate) {
      const map = buildRailArcMap(candidate.rail);
      // Select an ARC fraction (not a cubic index); these sites are at
      // least 28% away from either endpoint of the whole parent rail.
      for (let j = 0; j <= 24; j++) {
        const fraction = physicalSide === 'src' ? 0.06 + (0.3 * j) / 24 : 0.28 + (0.44 * j) / 24;
        const loc = railLocationAtFraction(map, fraction);
        const p = cubicPoint(map.entries[loc.index].q, loc.t);
        const distance = Math.hypot(p.x - ownBody.x, p.y - ownBody.y);
        // Prefer the actual closest point of the same physical
        // neighborhood; angular distance is only the tie-break term.
        const score = distance + Math.max(1, Math.hypot(ownBody.x, ownBody.y)) * candidate.angularGap * 0.1;
        if (score >= bestScore) continue;
        bestScore = score;
        best = {
          parent: candidate.parent,
          fraction,
          physicalAnchor: p,
          parentBranchIndex: Number(candidate.neighbor?.spiralBranchIndex),
          angularGap: candidate.angularGap,
          distanceToNeighbor: distance,
        };
      }
    }
    if (!best) return null;
    const chosen = { parent: best.parent };
    const mate = chosen.parent[physicalSide === 'dst' ? 'src' : 'dst'];
    const otherCubics = endpointCubics(mate, otherLayer);
    if (!otherCubics.length) return null;
    const otherMap = buildRailArcMap(otherCubics),
      loc = railLocationAtFraction(otherMap, best.fraction),
      e = otherMap.entries[loc.index];
    if (!e) return null;
    best.anchor = cubicPoint(e.q, loc.t);
    usage?.set(chosen.parent, (usage.get(chosen.parent) || 0) + 1);
    return best;
  }
  function coordinatedCollapsedPath(reference, anchor, layer, birth = false) {
    const cubics = endpointCubics(reference, layer);
    // Preserve the actual cubic count; avoid an arc-length map of a zero
    // rail when packing.  A thin geometric germ, NOT an opacity fade.
    // A birth starts as a mathematical point, which is already culled by
    // the geometric zero-length rule. Give it its proper stroke width from
    // the beginning: logarithmic .02→1 width interpolation previously hid
    // most of a growing rail until it was long, then made it pop into view.
    // Retirements may still taper as the physical rail collapses.
    const folded = cubics.map((q) => ({
      p0: { ...anchor },
      c1: { ...anchor },
      c2: { ...anchor },
      p3: { ...anchor },
      widthScale0: birth ? Math.max(0.02, Number(q.widthScale0) || 1) : 0.02,
      widthScale1: birth ? Math.max(0.02, Number(q.widthScale1) || 1) : 0.02,
    }));
    return {
      points: [{ ...anchor }, { ...anchor }],
      _bezierSegments: folded,
      __carrierMapped: true,
      __somataGeometricGerm: true,
      closed: false,
      spiralExplicitBridge: true,
    };
  }
  function expandCoordinatedGeometricGerms(pairs, srcLayer, dstLayer) {
    const matched = pairs.filter((p) => p.sourcePathPresent !== false && p.targetPathPresent !== false);
    const neighborUsage = new Map();
    for (const pair of pairs) {
      const birth = pair.sourcePathPresent === false,
        retire = pair.targetPathPresent === false;
      if (!birth && !retire) continue;
      const link = birth
        ? coordinatedNeighborAttachment(pair.dst, matched, 'dst', dstLayer, srcLayer, neighborUsage)
        : coordinatedNeighborAttachment(pair.src, matched, 'src', srcLayer, dstLayer, neighborUsage);
      // With no matched parent there is no honest neighboring coil. Keep
      // the original explicit tear/fade rather than create from nowhere.
      if (!link) {
        pair.coordinatedOrphan = true;
        continue;
      }
      const anchor = { x: link.anchor.x, y: link.anchor.y };
      if (birth) {
        pair.src = coordinatedCollapsedPath(pair.dst, anchor, dstLayer, true);
        pair.coordinatedGerm = 'birth';
      } else {
        pair.dst = coordinatedCollapsedPath(pair.src, anchor, srcLayer);
        pair.coordinatedGerm = 'retire';
      }
      pair.coordinatedAnchor = anchor;
      pair.coordinatedParentPair = link.parent;
      pair.coordinatedParentFraction = link.fraction;
      pair.coordinatedPhysicalNeighbor = link.physicalAnchor;
      pair.coordinatedNeighborDistance = link.distanceToNeighbor;
      pair.coordinatedParentBranchIndex = link.parentBranchIndex;
      pair.coordinatedNeighborAngularGap = link.angularGap;
      pair.sourcePathPresent = true;
      pair.targetPathPresent = true;
      pair.coordinatedUnmatched = false;
      pair.stableSpiralPairing = true;
    }
    return pairs;
  }
  const { hasStepAxisChange, hasVertexAxisChange, fixedAxisPairs } = window.SomataFixedAxisRules;
  function pairFixedAxisFade(transport, srcLayer, dstLayer, srcPaths, dstPaths) {
    const mode = window.SomataMorphRegistry.get(transport);
    return mode?.fixedAxisChanged?.(srcLayer, dstLayer)
      ? fixedAxisPairs(
          mode.fixedAxis,
          srcLayer,
          dstLayer,
          srcPaths,
          dstPaths,
          buildOrbitPolylines,
          stableSpiralPairs,
        )
      : null;
  }
  function splitCubicRailToCountExact(cubics, count, allowIdentity = false) {
    const src = Array.isArray(cubics) ? cubics : [],
      target = Math.max(0, Math.round(Number(count) || 0));
    if (!src.length || target < src.length) return null;
    if (target === src.length)
      return allowIdentity
        ? src
        : src.map((q) => ({ ...q, p0: { ...q.p0 }, c1: { ...q.c1 }, c2: { ...q.c2 }, p3: { ...q.p3 } }));
    const pieces = new Array(src.length).fill(1),
      extras = target - src.length;
    if (extras > 0) {
      const lengths = src.map((q) => cubicApproxLength(q)),
        total = Math.max(
          1e-9,
          lengths.reduce((a, b) => a + b, 0),
        );
      const remainders = [];
      let assigned = 0;
      for (let i = 0; i < src.length; i++) {
        const raw = (extras * lengths[i]) / total,
          whole = Math.floor(raw);
        pieces[i] += whole;
        assigned += whole;
        remainders.push({ i, r: raw - whole });
      }
      remainders.sort((a, b) => b.r - a.r || a.i - b.i);
      for (let k = 0; k < extras - assigned; k++) pieces[remainders[k % remainders.length].i]++;
    }
    const out = [];
    for (let i = 0; i < src.length; i++) {
      const q = src[i],
        n = pieces[i],
        lw0 = Math.log(Math.max(0.02, Number(q.widthScale0) || 1)),
        lw1 = Math.log(Math.max(0.02, Number(q.widthScale1) || 1));
      for (let j = 0; j < n; j++) {
        const a = j / n,
          b = (j + 1) / n,
          r = cubicSubsegment(q, a, b);
        r.widthScale0 = Math.exp(lw0 + (lw1 - lw0) * a);
        r.widthScale1 = Math.exp(lw0 + (lw1 - lw0) * b);
        out.push(r);
      }
    }
    return out.length === target ? out : null;
  }
  function padExactPhaseSourceCubics(cubics, count) {
    // Keep every physically rendered cubic and its junction untouched.
    // Correspondence slots are appended past the terminal point and are
    // zero-length on the source frame; they grow only as the next Morph
    // unfolds. No source cubic is re-tessellated at the phase seam.
    const source = cubics || [],
      extra = Math.max(0, count - source.length);
    if (!extra) return source;
    const result = source.slice(),
      last = source.at(-1),
      p = last.p3;
    for (let i = 0; i < extra; i++)
      result.push({
        p0: { ...p },
        c1: { ...p },
        c2: { ...p },
        p3: { ...p },
        widthScale0: 0.02,
        widthScale1: 0.02,
        // The original last knot had no successor, hence cannot be
        // tangent-repaired against a newly inserted ghost segment.
        __profileCorner0: true,
        __profileCorner1: true,
      });
    // The old terminal cubic must remain the endpoint of the original
    // segment group for source-side GPU tangent repair.
    result[source.length - 1] = { ...last, __profileCorner1: true };
    return result;
  }
  function carrierLayerSpec(layer, branchIndex) {
    try {
      if (typeof __spiroGetSpiralCarrierSpec === 'function')
        return __spiroGetSpiralCarrierSpec(layer, branchIndex);
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#carrierLayerSpec', error);
    }
    const animatedN = Number(layer?.__spiralAnimatedN),
      N = Math.max(2, Number.isFinite(animatedN) ? animatedN : Number(layer?.N) || 4),
      R = getEffectiveLayerRadius(layer, 220),
      rot = ((Number(layer?.rotation) || 0) * Math.PI) / 180,
      bi = Number.isFinite(Number(branchIndex)) ? Number(branchIndex) : 0,
      angle = (bi / N) * TWO_PI + rot - Math.PI / 2,
      order = getEffectiveSpiralOrder(layer),
      twist = layer?.spiralTwist === true ? 1 : 0,
      dir = Math.max(-1, Math.min(1, order)),
      step = getEffectiveSpiralStep(layer),
      ratio = getSpiralClosureRatio(),
      exp = Math.max(1e-9, Math.abs(order) || 1),
      targetScale = Math.pow(Math.max(1.0000001, ratio), exp);
    return {
      anchor: { x: R * Math.cos(angle), y: R * Math.sin(angle) },
      radius: R,
      N,
      step,
      order,
      direction: dir,
      twist,
      delta: ((TWO_PI * step) / N) * dir,
      targetScale,
      logScale: Math.log(targetScale),
      tangential:
        Math.abs(order) <= 1e-8
          ? 0
          : Number.isFinite(layer?.__spiralTangentialMix)
            ? Math.max(0, Math.min(1, layer.__spiralTangentialMix))
            : layer?.spiralTangential === true
              ? 1
              : 0,
      closed: layer?.spiralClosed !== false,
      roundSeams: layer?.spiralRoundSeams !== false,
    };
  }
  function copyProfileNodesForCarrier(srcLayer, dstLayer, t, scratch) {
    const u = clamp(Number(t) || 0, 0, 1),
      sa =
        Array.isArray(srcLayer?.profileNodes) && srcLayer.profileNodes.length
          ? srcLayer.profileNodes
          : [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
      da = Array.isArray(dstLayer?.profileNodes) && dstLayer.profileNodes.length ? dstLayer.profileNodes : sa;
    if (u <= 1e-9) return sa.map((p) => ({ ...p, x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
    if (u >= 1 - 1e-9) return da.map((p) => ({ ...p, x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
    const n = Math.max(sa.length, da.length),
      out = scratch || [];
    while (out.length < n) out.push({ x: 0, y: 0 });
    out.length = n;
    for (let i = 0; i < n; i++) {
      const a = sa[Math.min(i, sa.length - 1)] || sa[sa.length - 1],
        b = da[Math.min(i, da.length - 1)] || da[da.length - 1] || a,
        p = out[i];
      p.x = (Number(a?.x) || 0) + ((Number(b?.x) || 0) - (Number(a?.x) || 0)) * u;
      p.y = (Number(a?.y) || 0) + ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * u;
      p.__profileCorner = u < 0.5 ? a?.__profileCorner === true : b?.__profileCorner === true;
      p.__profileKeyCorner = u < 0.5 ? a?.__profileKeyCorner === true : b?.__profileKeyCorner === true;
    }
    return out;
  }
  // Only run value-key profile memoization for layers whose authored profile
  // pair matches another Spiral layer. A unique animated spline changes on
  // every frame; hashing it would cost more than the avoided preparation.
  function spiralAuthoredProfileSignature(layer) {
    const nodes = Array.isArray(layer?.profileNodes) ? layer.profileNodes : [];
    return [
      layer?.profileMode || '',
      nodes.length,
      ...nodes.flatMap((p) => [
        Number(p?.x) || 0,
        Number(p?.y) || 0,
        p?.__profileCorner === true ? 1 : 0,
        p?.__profileKeyCorner === true ? 1 : 0,
      ]),
    ].join('|');
  }
  function hasEquivalentSpiralProfilePair(layerIndex, source, target) {
    const sources = runtimeState.morph?.renderSourceLayers || [],
      targets = runtimeState.morph?.renderTargetLayers || [];
    if (sources.length < 2 || targets.length < 2) return false;
    const sk = spiralAuthoredProfileSignature(source),
      dk = spiralAuthoredProfileSignature(target);
    for (let i = 0; i < Math.min(sources.length, targets.length); i++) {
      if (i === layerIndex) continue;
      const a = sources[i],
        b = targets[i];
      if (!a || !b) continue;
      if (spiralAuthoredProfileSignature(a) === sk && spiralAuthoredProfileSignature(b) === dk) return true;
    }
    return false;
  }
  function buildCarrierMappedLayer(rec, t, prepareProfile = true) {
    const src = rec.sourceLayer,
      dst = rec.targetLayer,
      u = clamp(Number(t) || 0, 0, 1),
      transport = String(rec.spiralTransport || 'phaseCircle'),
      layer = rec.carrierFrameLayer || (rec.carrierFrameLayer = {});
    Object.assign(layer, src);
    layer.__spiralSharedProfileAcrossLayers = rec.sharedProfilePair === true;
    const sn = Math.max(2, Number(src?.N) || 4),
      dn = Math.max(2, Number(dst?.N) || sn),
      sk = Math.max(1, Number(src?.K) || 1),
      dk = Math.max(1, Number(dst?.K) || sk);
    let frameN = sn,
      frameK = sk;
    // The mode-specific locks apply when the authored endpoints agree. Manual
    // projects may contain a different N/K despite the factory lock; never
    // snap to that unmatched endpoint at t=1 (which opens every Corridor seam).
    // In that case transport the differing parameter continuously as well.
    if (transport === 'phase' || transport === 'minimalTurn' || transport === 'continuous') {
      frameN = sn + (dn - sn) * u;
      frameK = sk + (dk - sk) * u;
    } else {
      frameN = sn + (dn - sn) * u;
      frameK = sk + (dk - sk) * u;
    }
    layer.N = Math.max(2, Math.round(frameN));
    layer.K = Math.max(1, Math.round(frameK));
    layer.__spiralAnimatedN = frameN; // Topology integer; carrier angle continuous.
    const sr = getEffectiveLayerRadius(src, 220),
      dr = getEffectiveLayerRadius(dst, sr),
      radius = sr + (dr - sr) * u;
    layer.radius = radius;
    layer.radiusMultiplier = 1;
    layer.rotation =
      (Number(src?.rotation) || 0) + ((Number(dst?.rotation) || 0) - (Number(src?.rotation) || 0)) * u;
    layer.rounding = interpolateMorphRounding(src?.rounding, dst?.rounding, u);
    layer.lineJoinType =
      u < 0.5 ? src?.lineJoinType || 'rounded' : dst?.lineJoinType || src?.lineJoinType || 'rounded';
    layer.spiralEnabled = true;
    layer.spiralClosed =
      src?.spiralClosed === dst?.spiralClosed
        ? src?.spiralClosed !== false
        : u < 0.5
          ? src?.spiralClosed !== false
          : dst?.spiralClosed !== false;
    layer.spiralTangential = u < 0.5 ? src?.spiralTangential === true : dst?.spiralTangential === true;
    const fromTangency =
      Math.abs(Number(src?.spiralOrder) || 0) > 1e-8 && src?.spiralTangential === true ? 1 : 0;
    const toTangency =
      Math.abs(Number(dst?.spiralOrder) || 0) > 1e-8 && dst?.spiralTangential === true ? 1 : 0;
    // Ease only the tangent strength: both endpoint shapes stay exact, with zero endpoint velocity.
    layer.__spiralTangentialMix = fromTangency + (toTangency - fromTangency) * (u * u * (3 - 2 * u));
    layer.spiralRoundSeams =
      src?.spiralRoundSeams === dst?.spiralRoundSeams
        ? src?.spiralRoundSeams !== false
        : u < 0.5
          ? src?.spiralRoundSeams !== false
          : dst?.spiralRoundSeams !== false;
    const so = Number(src?.spiralOrder) || 0,
      to = Number(dst?.spiralOrder) || 0;
    const orderT = u * u * (3 - 2 * u);
    layer.spiralOrder = so + (to - so) * orderT;
    if (Math.abs(layer.spiralOrder) <= 1e-8) layer.__spiralTangentialMix = 0;
    const ss = getEffectiveSpiralStep(src),
      ts = getEffectiveSpiralStep(dst);
    layer.__spiralAnimatedK = frameK; // Authored K for UI, not the orbit carrier.
    layer.__spiralAnimatedEffectiveK = ss + (ts - ss) * u;
    layer.__spiralOrderInterpolating = true;
    layer.spiralStep = frameK; // Legacy mirror; never an independent control.
    layer.spiralStepLinked = true;
    let mode;
    try {
      mode =
        typeof MorphRendering !== 'undefined' &&
        typeof MorphRendering.resolveMorphProfileModeForRender === 'function'
          ? MorphRendering.resolveMorphProfileModeForRender(src?.profileMode, dst?.profileMode, u)
          : u < 0.5
            ? src?.profileMode || 'segments'
            : dst?.profileMode || src?.profileMode || 'segments';
    } catch (_) {
      mode = u < 0.5 ? src?.profileMode || 'segments' : dst?.profileMode || src?.profileMode || 'segments';
    }
    layer.profileMode = mode;
    layer.wholeCurveSpline = u < 0.5 ? src?.wholeCurveSpline === true : dst?.wholeCurveSpline === true;
    layer.profileNodes = copyProfileNodesForCarrier(
      src,
      dst,
      u,
      rec.carrierProfileScratch || (rec.carrierProfileScratch = []),
    );
    try {
      if (typeof setPreSampledSplineLayer === 'function' && typeof isPreSampledSplineLayer === 'function') {
        const sampled =
          mode === 'spline' &&
          ((u <= 1e-9 && isPreSampledSplineLayer(src)) ||
            (u >= 1 - 1e-9 && isPreSampledSplineLayer(dst)) ||
            (u > 1e-9 && u < 1 - 1e-9 && isPreSampledSplineLayer(src) && isPreSampledSplineLayer(dst)));
        setPreSampledSplineLayer(layer, sampled);
      }
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#buildCarrierMappedLayer', error);
    }
    // The live spline clock can differ from the carrier clock. When it does,
    // the sampled profile for the carrier clock would be thrown away immediately.
    // Defer that preparation until the authoritative spline clock is applied.
    let preparedProfile = null;
    if (prepareProfile)
      try {
        if (typeof __spiroPrepareSpiralCarrierProfile === 'function') {
          preparedProfile = __spiroPrepareSpiralCarrierProfile(layer, {
            profileNodes: layer.profileNodes,
            roundingFrac: getRoundingStrength(layer.rounding),
          });
          if (preparedProfile) stats.carrierProfilePrepares++;
        }
      } catch (_) {
        preparedProfile = null;
      }
    return { layer, radius, frameN, frameK, preparedProfile };
  }
  function carrierAnchorAt(specS, specD, t, cartesian) {
    const u = clamp(Number(t) || 0, 0, 1),
      a = specS.anchor,
      b = specD.anchor;
    if (cartesian) return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    const ar = Math.hypot(a.x, a.y),
      br = Math.hypot(b.x, b.y),
      aa = Math.atan2(a.y, a.x),
      ba = Math.atan2(b.y, b.x),
      d = shortestAngleDelta(aa, ba),
      r = ar + (br - ar) * u,
      ang = aa + d * u;
    return { x: r * Math.cos(ang), y: r * Math.sin(ang) };
  }
  function rotateScaleCarrierPoint(p, delta, scale) {
    const c = Math.cos(delta),
      q = Math.sin(delta),
      x = Number(p?.x) || 0,
      y = Number(p?.y) || 0,
      s = Math.max(1e-9, Number(scale) || 1);
    return { x: (c * x - q * y) * s, y: (q * x + c * y) * s };
  }
  function carrierEndpoint(spec) {
    return rotateScaleCarrierPoint(
      spec?.anchor || { x: 0, y: 0 },
      Number(spec?.delta) || 0,
      Math.max(1e-9, Number(spec?.targetScale) || 1),
    );
  }
  function unwrapAngleNear(angle, reference) {
    let a = Number(angle) || 0,
      r = Number(reference) || 0;
    while (a - r > Math.PI) a -= TWO_PI;
    while (a - r < -Math.PI) a += TWO_PI;
    return a;
  }
  function spiralPhaseStepAtDepth(sourceStep, targetStep, N, direction, t, depth) {
    const u = clamp(Number(t) || 0, 0, 1),
      q = clamp(Number(depth) || 0, 0, 1);
    // Same continuous signed direction as Corridor, including the smooth
    // zero crossing during a reverse-winding morph.
    const n = Math.max(2, Number(N) || 2),
      sign = clamp(Number(direction), -1, 1);
    const s = Math.max(1e-9, Number(sourceStep) || 1),
      d = Math.max(1e-9, Number(targetStep) || s);
    const step = s + (d - s) * u,
      delta = ((TWO_PI * step) / n) * sign;
    // At depth 0 the outer anchor is fixed. At each step towards the
    // center, the relative angular displacement increases continuously.
    return { step, delta, angle: q * delta, rotationSinceSource: ((q * TWO_PI * (step - s)) / n) * sign };
  }
  function carrierFrameSpec(rec, r, t) {
    const u = clamp(Number(t) || 0, 0, 1),
      s = r.sourceCarrier,
      d = r.targetCarrier,
      transport = String(rec.spiralTransport || 'phaseCircle');
    const sn = Math.max(2, Number(s?.N) || 2),
      dn = Math.max(2, Number(d?.N) || sn),
      ss = Math.max(1e-9, Number(s?.step) || 1),
      ds = Math.max(1e-9, Number(d?.step) || ss);
    const sdir = s?.twist === 0 ? 0 : (Number(s?.direction) || 1) < 0 ? -1 : 1,
      ddir = d?.twist === 0 ? 0 : (Number(d?.direction) || sdir || 1) < 0 ? -1 : 1;
    const ease = u * u * (3 - 2 * u),
      dir = sdir + (ddir - sdir) * ease;
    let N = sn,
      step = ss,
      anchor,
      delta,
      targetScale,
      end,
      metric = 'polar-keypoints';
    if (transport === 'continuous') {
      N = sn + (dn - sn) * u;
      step = ss + (ds - ss) * u;
      anchor = carrierAnchorAt(s, d, u, true);
      delta = ((TWO_PI * step) / N) * dir;
      targetScale = Math.exp(
        (Number(s?.logScale) || 0) + ((Number(d?.logScale) || 0) - (Number(s?.logScale) || 0)) * u,
      );
      metric = 'cartesian-anchor-continuous-NK';
    } else if (transport === 'phase') {
      N = sn + (dn - sn) * u;
      anchor = carrierAnchorAt(s, d, u, false);
      const phase = spiralPhaseStepAtDepth(ss, ds, N, dir, u, 1);
      step = phase.step;
      delta = phase.delta;
      targetScale = Math.exp(
        (Number(s?.logScale) || 0) + ((Number(d?.logScale) || 0) - (Number(s?.logScale) || 0)) * u,
      );
      metric = 'variable-K-polar';
    } else if (transport === 'phaseCircle') {
      N = sn + (dn - sn) * u;
      anchor = carrierAnchorAt(s, d, u, false);
      const phase = spiralPhaseStepAtDepth(ss, ds, N, dir, u, 1);
      step = phase.step;
      delta = phase.delta;
      targetScale = Math.exp(
        (Number(s?.logScale) || 0) + ((Number(d?.logScale) || 0) - (Number(s?.logScale) || 0)) * u,
      );
      metric = 'phase-circle-clone-merge';
    } else if (transport === 'minimalTurn') {
      N = sn + (dn - sn) * u;
      step = ss + (ds - ss) * u;
      anchor = carrierAnchorAt(s, d, u, false);
      delta = ((TWO_PI * step) / Math.max(2, N)) * dir;
      targetScale = Math.exp(
        (Number(s?.logScale) || 0) + ((Number(d?.logScale) || 0) - (Number(s?.logScale) || 0)) * u,
      );
      metric = 'constant-step-least-turn';
    } else if (transport === 'topology') {
      const sa = s?.anchor || { x: 0, y: 0 },
        da = d?.anchor || sa,
        se = carrierEndpoint(s),
        de = carrierEndpoint(d);
      anchor = {
        x: (Number(sa.x) || 0) + ((Number(da.x) || 0) - (Number(sa.x) || 0)) * u,
        y: (Number(sa.y) || 0) + ((Number(da.y) || 0) - (Number(sa.y) || 0)) * u,
      };
      end = {
        x: (Number(se.x) || 0) + ((Number(de.x) || 0) - (Number(se.x) || 0)) * u,
        y: (Number(se.y) || 0) + ((Number(de.y) || 0) - (Number(se.y) || 0)) * u,
      };
      const ar = Math.max(1e-9, Math.hypot(anchor.x, anchor.y)),
        er = Math.max(1e-9, Math.hypot(end.x, end.y)),
        ref = (Number(s?.delta) || 0) + ((Number(d?.delta) || 0) - (Number(s?.delta) || 0)) * u,
        raw = Math.atan2(end.y, end.x) - Math.atan2(anchor.y, anchor.x);
      delta = unwrapAngleNear(raw, ref);
      targetScale = er / ar;
      N = sn + (dn - sn) * u;
      step = (Math.abs(delta) * Math.max(2, N)) / TWO_PI;
      metric = 'cartesian-start-end-keypoints';
    } else {
      anchor = carrierAnchorAt(s, d, u, false);
      delta = (Number(s?.delta) || 0) + ((Number(d?.delta) || 0) - (Number(s?.delta) || 0)) * u;
      targetScale = Math.exp(
        (Number(s?.logScale) || 0) + ((Number(d?.logScale) || 0) - (Number(s?.logScale) || 0)) * u,
      );
      metric = 'legacy';
    }
    // A cyclic limiter acts on the instantaneous authored K, not merely
    // on its source/target endpoint values. Otherwise a 2→10 Morph with
    // L=2 would freeze at 2 while the regular Spiral snapshot cycles.
    const fromLayer = r.pair?.sourceLayer || rec.sourceLayer,
      toLayer = r.pair?.targetLayer || rec.targetLayer;
    // Source/target carriers already contain bounded effective steps.
    // NEVER re-cycle raw authored K in the middle of a changing N phase;
    // that was the last path that injected extra full-step revolutions.
    if (['continuous', 'phase', 'phaseCircle', 'minimalTurn'].includes(transport))
      metric += '-effective-endpoint-step';
    // Topology and rendered angular carrier must share the legal N step.
    // This also covers a manually edited destination N smaller than 2*K.
    const ringMax = Math.max(1, Math.floor(Math.max(2, N) / 2));
    if (step > ringMax) {
      step = ringMax;
      delta = ((TWO_PI * step) / Math.max(2, N)) * dir;
      end = null;
      metric += '-N-clamped';
    }
    if (!end) end = rotateScaleCarrierPoint(anchor, delta, targetScale);
    // Match the per-layer frame snapshot so the GPU rail and ordinary geometry agree.
    const tangential =
      (Number(s?.tangential) || 0) + ((Number(d?.tangential) || 0) - (Number(s?.tangential) || 0)) * ease;
    return {
      anchor,
      end,
      delta,
      targetScale,
      N,
      step,
      direction: dir,
      tangential: clamp(tangential, 0, 1),
      metric,
    };
  }
  function rotateCarrierCubics(cubics, angle) {
    const c = Math.cos(angle),
      sn = Math.sin(angle),
      rot = (p) => ({
        x: c * (Number(p?.x) || 0) - sn * (Number(p?.y) || 0),
        y: sn * (Number(p?.x) || 0) + c * (Number(p?.y) || 0),
      });
    return (cubics || []).map((q) => {
      const p0 = rot(q.p0),
        c1 = rot(q.c1),
        c2 = rot(q.c2),
        p3 = rot(q.p3);
      return { ...q, p0, c1, c2, p3 };
    });
  }
  // When tangentiality is the only edited geometry parameter, interpolating the
  // full baked Bézier controls keeps authored endpoint rounding *exact* while
  // avoiding discontinuous reallocation of subdivision pieces near t=1.
  // The ordinary carrier mapping remains authoritative for all other Morphs.
  function isTangentialOnlyCarrierChange(a, b) {
    if (a?.spiralTangential === b?.spiralTangential || a?.spiralEnabled !== true || b?.spiralEnabled !== true)
      return false;
    const keys = [
      'N',
      'K',
      'spiralOrder',
      'spiralStep',
      'spiralStepLinked',
      'radius',
      'radiusMultiplier',
      'rotation',
      'rounding',
      'profileMode',
      'splineRenderMode',
      'wholeCurveSpline',
      'spiralClosed',
      'spiralRoundSeams',
      'closedLoop',
      'profileSplineSegments',
      'profileSplineMix',
      'spiralRounding',
    ];
    for (const key of keys) if (a?.[key] !== b?.[key]) return false;
    const sa = Array.isArray(a?.profileNodes) ? a.profileNodes : [],
      sb = Array.isArray(b?.profileNodes) ? b.profileNodes : [];
    if (sa.length !== sb.length) return false;
    for (let i = 0; i < sa.length; i++) {
      if (Number(sa[i]?.x) !== Number(sb[i]?.x) || Number(sa[i]?.y) !== Number(sb[i]?.y)) return false;
      if (
        Boolean(sa[i]?.__profileCorner) !== Boolean(sb[i]?.__profileCorner) ||
        Boolean(sa[i]?.__profileKeyCorner) !== Boolean(sb[i]?.__profileKeyCorner)
      )
        return false;
    }
    return true;
  }
  function interpolateTangentialBakedCubics(source, target, t) {
    const u = clamp(Number(t) || 0, 0, 1),
      w = u * u * (3 - 2 * u),
      inv = 1 - w;
    const out = new Array(source.length);
    for (let j = 0; j < source.length; j++) {
      const a = source[j],
        b = target[j];
      const lerpPoint = (key) => ({ x: a[key].x * inv + b[key].x * w, y: a[key].y * inv + b[key].y * w });
      const wa0 = Math.log(Math.max(0.02, Number(a.widthScale0) || 1)),
        wb0 = Math.log(Math.max(0.02, Number(b.widthScale0) || 1));
      const wa1 = Math.log(Math.max(0.02, Number(a.widthScale1) || 1)),
        wb1 = Math.log(Math.max(0.02, Number(b.widthScale1) || 1));
      out[j] = {
        p0: lerpPoint('p0'),
        c1: lerpPoint('c1'),
        c2: lerpPoint('c2'),
        p3: lerpPoint('p3'),
        widthScale0: Math.exp(wa0 * inv + wb0 * w),
        widthScale1: Math.exp(wa1 * inv + wb1 * w),
      };
    }
    return out;
  }
  // A continuous spline Morph owns exactly one compatible Bézier pair for the
  // whole phase.  Both rails are finalized and subdivided in buildLayerCpuResource.
  // Mixing their controls must NEVER rebuild an intermediate path from profile
  // nodes: that used to reintroduce spline sampling and join repair at the
  // end of the animation.  Mixed spline/segments transitions interpolate
  // handles relative to their moving anchors, preserving the existing timing
  // of profileModeTransition without changing the carrier's endpoints.
  function preparedSpiralWidthLogs(record) {
    // Width values belong to the phase's immutable paired cubic rails.
    // Precompute their logarithms once instead of four Math.log calls
    // for every cubic on every animation frame.
    if (record.preparedWidthLogs) return record.preparedWidthLogs;
    const src = record.sc,
      dst = record.dc,
      log = new Float64Array(src.length * 4);
    for (let i = 0; i < src.length; i++) {
      const a = src[i],
        b = dst[i],
        o = i * 4;
      log[o] = Math.log(Math.max(0.02, Number(a.widthScale0) || 1));
      log[o + 1] = Math.log(Math.max(0.02, Number(b.widthScale0) || 1));
      log[o + 2] = Math.log(Math.max(0.02, Number(a.widthScale1) || 1));
      log[o + 3] = Math.log(Math.max(0.02, Number(b.widthScale1) || 1));
    }
    record.preparedWidthLogs = log;
    return log;
  }
  function interpolatePreparedProfileCubics(source, target, t, handleT = t, widthLogs = null) {
    const u = clamp(Number(t) || 0, 0, 1),
      h = clamp(Number(handleT) || 0, 0, 1),
      out = new Array(source.length);
    const mix = (a, b, w) => a + (b - a) * w;
    for (let j = 0; j < source.length; j++) {
      const a = source[j],
        b = target[j];
      const p0 = { x: mix(a.p0.x, b.p0.x, u), y: mix(a.p0.y, b.p0.y, u) };
      const p3 = { x: mix(a.p3.x, b.p3.x, u), y: mix(a.p3.y, b.p3.y, u) };
      const c1 = {
        x: p0.x + mix(a.c1.x - a.p0.x, b.c1.x - b.p0.x, h),
        y: p0.y + mix(a.c1.y - a.p0.y, b.c1.y - b.p0.y, h),
      };
      const c2 = {
        x: p3.x + mix(a.c2.x - a.p3.x, b.c2.x - b.p3.x, h),
        y: p3.y + mix(a.c2.y - a.p3.y, b.c2.y - b.p3.y, h),
      };
      const wo = j * 4;
      const wa0 = widthLogs ? widthLogs[wo] : Math.log(Math.max(0.02, Number(a.widthScale0) || 1));
      const wb0 = widthLogs ? widthLogs[wo + 1] : Math.log(Math.max(0.02, Number(b.widthScale0) || 1));
      const wa1 = widthLogs ? widthLogs[wo + 2] : Math.log(Math.max(0.02, Number(a.widthScale1) || 1));
      const wb1 = widthLogs ? widthLogs[wo + 3] : Math.log(Math.max(0.02, Number(b.widthScale1) || 1));
      out[j] = {
        p0,
        c1,
        c2,
        p3,
        widthScale0: wa0 === 0 && wb0 === 0 ? 1 : Math.exp(mix(wa0, wb0, u)),
        widthScale1: wa1 === 0 && wb1 === 0 ? 1 : Math.exp(mix(wa1, wb1, u)),
      };
    }
    return out;
  }
  // Endpoint interpolation alone does not commute with a changing Spiral
  // phase/scale (N/K and winding). A straight blend of two periodic Béziers
  // would leave a visible gap between adjacent Corridor copies at mid-phase.
  // Distribute the small closure delta across the ALREADY prepared control
  // points; never resample, round or re-fit the spline. This is an affine
  // correction, not an additional tangential fillet.
  function alignPreparedSplineToCarrierPhase(cubics, frame, knotFractions, strength = 1) {
    // A continuous closed Spiral must be periodic on EVERY frame: reducing
    // the endpoint correction itself opens a visible Corridor/Fill seam.
    // Instead blend the DISTRIBUTION of the correction along the already
    // interpolated Bézier handles. At the beginning the correction is eased
    // towards the join; by the selected profile-transition deadline it is
    // distributed evenly across the rail (the authored closed endpoint).
    // Both distributions keep f(0)=0 and f(1)=1, so the join never opens.
    const amount = clamp(Number(strength) || 0, 0, 1);
    const n = cubics.length;
    if (!n || !frame) return cubics;
    const first = cubics[0].p0,
      last = cubics[n - 1].p3;
    const expected = rotateScaleCarrierPoint(first, frame.delta, frame.targetScale);
    const dx = expected.x - last.x,
      dy = expected.y - last.y;
    if (Math.abs(dx) + Math.abs(dy) < 1e-9) return cubics;
    const spatialWeight = (f) => {
      const x = clamp(f, 0, 1),
        soft = x * x * (3 - 2 * x);
      return soft + (x - soft) * amount;
    };
    for (let i = 0; i < n; i++) {
      const f0 = clamp(Number(knotFractions?.[i]) || i / n, 0, 1);
      const f1 = clamp(Number(knotFractions?.[i + 1]) || (i + 1) / n, f0, 1);
      const df = f1 - f0,
        q = cubics[i];
      const w0 = spatialWeight(f0),
        w1 = spatialWeight(f1);
      const wC1 = spatialWeight(f0 + df / 3),
        wC2 = spatialWeight(f0 + (2 * df) / 3);
      q.p0.x += dx * w0;
      q.p0.y += dy * w0;
      q.c1.x += dx * wC1;
      q.c1.y += dy * wC1;
      q.c2.x += dx * wC2;
      q.c2.y += dy * wC2;
      q.p3.x += dx * w1;
      q.p3.y += dy * w1;
    }
    return cubics;
  }
  // Closed Spiral uses exactly the open profile rail plus one authored bridge.
  // During Morph, N/K/scale can vary nonlinearly. Update only the trailing
  // bridge endpoint to the CURRENT next-period origin; never distribute a
  // correction through the body of the Spiral or add a second spline fit.
  function alignExplicitBridgeToCurrentPeriod(cubics, frame, roundSeams = false) {
    if (!cubics?.length || !frame) return cubics;
    const first = cubics[0]?.p0,
      last = cubics[cubics.length - 1]?.p3;
    if (!first || !last) return cubics;
    const next = rotateScaleCarrierPoint(first, frame.delta, frame.targetScale);
    const dx = next.x - last.x,
      dy = next.y - last.y;
    if (Math.abs(dx) + Math.abs(dy) < 1e-10) return cubics;
    // Without corner rounding the final cubic is the straight connector.
    const n = cubics.length;
    if (!roundSeams) {
      const c = cubics[n - 1],
        p = c.p0;
      c.p3 = { ...next };
      c.c1 = { x: p.x + (next.x - p.x) / 3, y: p.y + (next.y - p.y) / 3 };
      c.c2 = { x: p.x + (2 * (next.x - p.x)) / 3, y: p.y + (2 * (next.y - p.y)) / 3 };
      return cubics;
    }
    // A rounded bridge may contain several authored fillet cubics. Move
    // ONLY this short tail, leaving all preceding open-profile cubics intact.
    const start = Math.max(0, n - Math.min(16, Math.max(3, Math.ceil(n * 0.08))));
    const weight = (x) => {
      const u = clamp(x, 0, 1);
      return u * u * (3 - 2 * u);
    };
    for (let i = start; i < n; i++) {
      const c = cubics[i],
        t = (i - start) / (n - start),
        dt = 1 / (n - start);
      const add = (p, w) => {
        p.x += dx * w;
        p.y += dy * w;
      };
      add(c.p0, weight(t));
      add(c.c1, weight(t + dt / 3));
      add(c.c2, weight(t + (2 * dt) / 3));
      add(c.p3, weight(t + dt));
    }
    return cubics;
  }
  // An exact phase snapshot can be topologically equal to the previous
  // rendered rail but parametrized very differently from a newly rebuilt
  // live-rounded Spline+ rail. Without this boundary taper, t=0 reads r.sc
  // while t=epsilon reads the regenerated carrier: visually a teleport,
  // particularly at sharp spiral tips. Keep the real endpoint cubics fixed,
  // and introduce the live profile continuously over a short transition.
  // The same correction applies approaching the target t=1 endpoint.
  function spliceLiveRoundedCarrierAtBoundary(current, endpoint, endpointWeight) {
    if (!Array.isArray(current) || current.length !== endpoint?.length) return current;
    const w = clamp(endpointWeight, 0, 1);
    if (w <= 0) return current;
    if (w >= 1) return endpoint;
    // The path is newly built for this frame. Correct its coordinates
    // in place instead of allocating four additional points per cubic.
    // Rotational templates are independently snapshotted below before
    // this function runs, so sibling branches still share the raw rail.
    for (let i = 0; i < current.length; i++) {
      const q = current[i],
        e = endpoint[i];
      for (const name of ['p0', 'c1', 'c2', 'p3']) {
        q[name].x += (e[name].x - q[name].x) * w;
        q[name].y += (e[name].y - q[name].y) * w;
      }
      q.widthScale0 = (Number(q.widthScale0) || 1) * (1 - w) + (Number(e.widthScale0) || 1) * w;
      q.widthScale1 = (Number(q.widthScale1) || 1) * (1 - w) + (Number(e.widthScale1) || 1) * w;
    }
    return current;
  }
  function cloneCarrierCubicRailForTemplate(cubics) {
    return cubics.map((q) => ({ ...q, p0: { ...q.p0 }, c1: { ...q.c1 }, c2: { ...q.c2 }, p3: { ...q.p3 } }));
  }
  function spiralEndpointTaper(t) {
    const u = clamp(t, 0, 1);
    return u * u * (3 - 2 * u);
  }
  function ensureCarrierMappedCurrent(rec, t) {
    if (!rec?.carrierMapped) return null;
    const tt = resolveEffectT(rec, t);
    if (
      Number.isFinite(rec.carrierCpuT) &&
      Math.abs(rec.carrierCpuT - tt) < 1e-12 &&
      rec.carrierPacked &&
      rec.carrierCurrentByPath
    )
      return rec.carrierPacked;
    const packed = rec.carrierPacked || (rec.carrierPacked = new Float32Array(rec.cubicCount * 8)),
      byPath = rec.carrierCurrentByPath || (rec.carrierCurrentByPath = []),
      frames = rec.carrierFrameSpecs || (rec.carrierFrameSpecs = []);
    byPath.length = 0;
    frames.length = 0;
    const tangentialOnly = rec.tangentialOnlyCarrierChange === true && rec.fullBezierMode === true;
    // For non-torn spline and locally rounded segment profiles the finished
    // endpoints are prepared once per cycle; never rebuild inserted fillets
    // from intermediate polylines.
    const preparedSpline = rec.preparedContinuousSplineRail === true && !tangentialOnly;
    // A spline whose *connector joints* are rounded must keep those joints
    // rounded during an edit, not merely at its two endpoint snapshots.
    // Cubic-control interpolation can cancel the two corner fillets when
    // the authored spline knots move in opposite directions. Evaluate the
    // SAME finalized carrier builder used by Static for intermediate frames.
    // The fixed exact endpoint cubics are retained at t=0/1; no separate
    // post-Morph rounding pass is introduced.
    const liveRoundedSpline = rec.liveRoundedSpline === true && preparedSpline;
    // Smooth time only for the immutable two-endpoint Spiral rail. This
    // suppresses the high derivative that otherwise looks like a tip snap
    // in the last few real frames, without a special terminal renderer.
    // The Carrier endpoint angle (K/N) must follow the SAME geometry clock
    // as Corridor copy poses and the ordinary per-frame Spiral snapshot.
    // Smoothing the *endpoint positions* independently opened visible gaps
    // between adjacent copied coils (22+ px in the bundled playlist).
    // Keep the intentional smoothing only for the Bézier *handles*.
    const endpointT = tt;
    const splineHandleT =
      rec.phaseLockedEndpoints === true
        ? spiralEndpointTaper(tt)
        : preparedSpline
          ? resolveProfileModeTransitionT(rec, tt)
          : tt;
    const deferredProfilePrep = liveRoundedSpline && Math.abs(splineHandleT - tt) > 1e-9;
    const built =
        tangentialOnly || (preparedSpline && !liveRoundedSpline)
          ? null
          : buildCarrierMappedLayer(rec, tt, !deferredProfilePrep),
      layer = built?.layer,
      radius = built?.radius;
    // The UI profile-transition schedule owns spline curvature, while the
    // carrier anchors/N/K keep their ordinary Morph clock. Rebuild only
    // the profile part of the intermediate static-equivalent rail when
    // the chosen handle schedule differs from geometric progress.
    if (deferredProfilePrep && built) {
      layer.profileNodes = copyProfileNodesForCarrier(
        rec.sourceLayer,
        rec.targetLayer,
        splineHandleT,
        rec.liveRoundProfileScratch || (rec.liveRoundProfileScratch = []),
      );
      if (typeof __spiroPrepareSpiralCarrierProfile === 'function') {
        built.preparedProfile = __spiroPrepareSpiralCarrierProfile(layer, {
          profileNodes: layer.profileNodes,
          roundingFrac: getRoundingStrength(layer.rounding),
        });
        if (built.preparedProfile) stats.carrierProfilePrepares++;
      }
    }
    let global = 0,
      overflow = false;
    // 7.7 performance: for the circular Spiral transports every branch is the same
    // profile/carrier rail rotated around the origin. Build that expensive rail once per
    // compatible group and rotate the exact Bezier control points for sibling branches.
    // This preserves the 7.6 carrier/profile geometry byte-for-byte up to FP rotation noise,
    // while restoring the branch sharing that made 7.5 fast. Topology stays explicit because
    // its start/end key points are intentionally Cartesian and need not be rotational copies.
    const rotationalTemplates = new Map();
    const canRotateTemplate = rec.spiralTransport !== 'topology' && rec.spiralTransport !== 'torn';
    for (let pi = 0; pi < rec.carrierRecords.length; pi++) {
      const r = rec.carrierRecords[pi];
      let cubics;
      if (tt <= 1e-9) {
        cubics = r.sc;
        frames.push(carrierFrameSpec(rec, r, 0));
      } else if (tt >= 1 - 1e-9) {
        cubics = r.dc;
        frames.push(carrierFrameSpec(rec, r, 1));
      } else if (tangentialOnly) {
        frames.push(carrierFrameSpec(rec, r, tt));
        cubics = interpolateTangentialBakedCubics(r.sc, r.dc, tt);
      } else if (liveRoundedSpline) {
        // Static and animated spline corners are constructed by the
        // same routine. Each current rail is then subdivided *exactly*
        // to the immutable GPU command count. If an exceptional frame
        // exceeds that budget, retain the safe prepared cubic blend.
        const frame = carrierFrameSpec(rec, r, tt);
        frames.push(frame);
        const ar = Math.hypot(Number(frame.anchor?.x) || 0, Number(frame.anchor?.y) || 0);
        const key = canRotateTemplate
          ? `${r.count}|${Number(frame.delta).toPrecision(14)}|${Number(frame.targetScale).toPrecision(14)}|${Number(frame.tangential).toPrecision(8)}|${layer?.spiralRoundSeams !== false ? 1 : 0}`
          : '';
        const templ = key ? rotationalTemplates.get(key) : null;
        if (templ && Math.abs(ar - templ.radius) <= Math.max(1e-7, templ.radius * 1e-9)) {
          cubics = rotateCarrierCubics(
            templ.cubics,
            Math.atan2(Number(frame.anchor.y) || 0, Number(frame.anchor.x) || 0) - templ.angle,
          );
          stats.carrierRotationalReuses = (stats.carrierRotationalReuses || 0) + 1;
        } else {
          const path =
            typeof __spiroBuildSpiralCarrierPath === 'function'
              ? __spiroBuildSpiralCarrierPath(layer, frame.anchor, {
                  radius,
                  delta: frame.delta,
                  targetScale: frame.targetScale,
                  tangential: frame.tangential,
                  closed: true,
                  roundSeams: true,
                  roundingFrac: getRoundingStrength(layer.rounding),
                  profileNodes: layer.profileNodes,
                  preparedProfile: built.preparedProfile,
                  branchIndex: r.currentBranchIndex,
                  profileTargetCount: r.profileTargetCount,
                })
              : null;
          const raw = path ? endpointCubics(path, layer) : [];
          cubics = splitCubicRailToCountExact(raw, r.count, path?.__carrierMapped === true);
          if (cubics && key) {
            // The endpoint splice must not alter the rotational
            // template reused for other branches of this frame.
            const templateRail = tt < 0.15 || tt > 0.85 ? cloneCarrierCubicRailForTemplate(cubics) : cubics;
            rotationalTemplates.set(key, {
              cubics: templateRail,
              angle: Math.atan2(Number(frame.anchor.y) || 0, Number(frame.anchor.x) || 0),
              radius: ar,
            });
            stats.carrierRotationalBuilds = (stats.carrierRotationalBuilds || 0) + 1;
          }
        }
        if (!cubics) {
          rec.liveRoundedSplineFallbacks = (rec.liveRoundedSplineFallbacks || 0) + 1;
          cubics = interpolatePreparedProfileCubics(r.sc, r.dc, tt, splineHandleT);
          if (r.explicitBridge === true)
            cubics = alignExplicitBridgeToCurrentPeriod(cubics, frame, r.roundedBridge === true);
        } else rec.liveRoundedSplineFrames = (rec.liveRoundedSplineFrames || 0) + 1;
        // 12.7.1: true C0 continuity for *nearby* real frames, not
        // just the idealized 1.0/0.0 snapshot tested in 12.7.0.
        // Preserve the static-equivalent live spline in the interior.
        const boundarySpan = 0.15;
        if (tt < boundarySpan) {
          const liveWeight = spiralEndpointTaper(tt / boundarySpan);
          cubics = spliceLiveRoundedCarrierAtBoundary(cubics, r.sc, 1 - liveWeight);
        } else if (tt > 1 - boundarySpan) {
          const targetWeight = spiralEndpointTaper((tt - (1 - boundarySpan)) / boundarySpan);
          cubics = spliceLiveRoundedCarrierAtBoundary(cubics, r.dc, targetWeight);
        }
      } else if (preparedSpline) {
        // This is a true Bézier-to-Bézier Morph, not a spline rebuild.
        // Its subdivision layout is immutable until the next phase.
        const frame = carrierFrameSpec(rec, r, endpointT);
        frames.push(frame);
        cubics = interpolatePreparedProfileCubics(
          r.sc,
          r.dc,
          endpointT,
          splineHandleT,
          preparedSpiralWidthLogs(r),
        );
        if (r.explicitBridge === true) {
          cubics = alignExplicitBridgeToCurrentPeriod(cubics, frame, r.roundedBridge === true);
        } else if (r.periodic === true) {
          // The carrier's instantaneous delta is authoritative for
          // Corridor as well as the Spiral rail, even during N/K Morph.
          cubics = alignPreparedSplineToCarrierPhase(cubics, frame, r.knotFractions, splineHandleT);
        }
      } else {
        const frame = carrierFrameSpec(rec, r, tt);
        frames.push(frame);
        const ar = Math.hypot(Number(frame.anchor?.x) || 0, Number(frame.anchor?.y) || 0);
        const key = canRotateTemplate
          ? `${r.count}|${r.profileTargetCount || 0}|${Number(frame.delta).toPrecision(14)}|${Number(frame.targetScale).toPrecision(14)}|${Number(frame.tangential).toPrecision(8)}|${layer.spiralClosed !== false ? 1 : 0}|${layer.spiralRoundSeams !== false ? 1 : 0}`
          : '';
        const templ = key ? rotationalTemplates.get(key) : null;
        if (templ && Math.abs(ar - templ.radius) <= Math.max(1e-7, templ.radius * 1e-9)) {
          const da = Math.atan2(Number(frame.anchor.y) || 0, Number(frame.anchor.x) || 0) - templ.angle;
          cubics = rotateCarrierCubics(templ.cubics, da);
          stats.carrierRotationalReuses = (stats.carrierRotationalReuses || 0) + 1;
        } else {
          let path = null;
          try {
            if (typeof __spiroBuildSpiralCarrierPath === 'function')
              path = __spiroBuildSpiralCarrierPath(layer, frame.anchor, {
                radius,
                delta: frame.delta,
                targetScale: frame.targetScale,
                tangential: frame.tangential,
                closed: layer.spiralClosed !== false,
                roundSeams: layer.spiralRoundSeams !== false,
                roundingFrac: getRoundingStrength(layer.rounding),
                profileNodes: layer.profileNodes,
                preparedProfile: built.preparedProfile,
                branchIndex: r.currentBranchIndex,
                profileTargetCount: r.profileTargetCount,
              });
          } catch (error) {
            noteSuppressedError('gpu/spiral-bezier-morph-renderer#ensureCarrierMappedCurrent', error);
          }
          const raw = path ? endpointCubics(path, layer) : [];
          cubics = splitCubicRailToCountExact(raw, r.count, path?.__carrierMapped === true);
          if (cubics && key) {
            rotationalTemplates.set(key, {
              cubics,
              angle: Math.atan2(Number(frame.anchor.y) || 0, Number(frame.anchor.x) || 0),
              radius: ar,
            });
            stats.carrierRotationalBuilds = (stats.carrierRotationalBuilds || 0) + 1;
          }
        }
        if (!cubics) {
          overflow = true;
          cubics = r.sc.map((q, j) => {
            const d = r.dc[Math.min(j, r.dc.length - 1)] || q,
              lerp = (a, b) => a + (b - a) * tt;
            return {
              p0: { x: lerp(q.p0.x, d.p0.x), y: lerp(q.p0.y, d.p0.y) },
              c1: { x: lerp(q.c1.x, d.c1.x), y: lerp(q.c1.y, d.c1.y) },
              c2: { x: lerp(q.c2.x, d.c2.x), y: lerp(q.c2.y, d.c2.y) },
              p3: { x: lerp(q.p3.x, d.p3.x), y: lerp(q.p3.y, d.p3.y) },
              widthScale0: Math.exp(
                Math.log(Math.max(0.02, Number(q.widthScale0) || 1)) * (1 - tt) +
                  Math.log(Math.max(0.02, Number(d.widthScale0) || 1)) * tt,
              ),
              widthScale1: Math.exp(
                Math.log(Math.max(0.02, Number(q.widthScale1) || 1)) * (1 - tt) +
                  Math.log(Math.max(0.02, Number(d.widthScale1) || 1)) * tt,
              ),
            };
          });
        }
      }
      // Phase-circle is the original 13.2 clone/merge transport. Its authored
      // carrier already defines the complete motion and the period. A later
      // forced terminal reprojection changed valid Bezier frames (including
      // the exact endpoints) and destroyed phase-circle's characteristic
      // movement. Do not apply that correction to phaseCircle. Keep it for
      // the other continuous modes that require their own seam enforcement.
      if (
        rec.spiralTransport !== 'phaseCircle' &&
        rec.periodSeamEnforced &&
        r.periodic &&
        cubics?.length &&
        rec.sourceLayer?.spiralClosed !== false &&
        rec.targetLayer?.spiralClosed !== false
      ) {
        // This is the LAST geometry operation on the live rail. All
        // consumers (GPU Base, Glow, Corridor, Fill, CPU fallback) read
        // the SAME sealed points, rather than different seam repairs.
        const frame = frames[pi];
        const last = cubics[cubics.length - 1];
        if (frame && last) {
          const expected = rotateScaleCarrierPoint(cubics[0].p0, frame.delta, frame.targetScale);
          if (Number.isFinite(expected.x) && Number.isFinite(expected.y)) {
            const original = last.p3;
            if (Math.hypot(expected.x - original.x, expected.y - original.y) > 1e-8) {
              if (r.explicitBridge && r.roundedBridge !== true) {
                last.c1 = {
                  x: last.p0.x + (expected.x - last.p0.x) / 3,
                  y: last.p0.y + (expected.y - last.p0.y) / 3,
                };
                last.c2 = {
                  x: last.p0.x + (2 * (expected.x - last.p0.x)) / 3,
                  y: last.p0.y + (2 * (expected.y - last.p0.y)) / 3,
                };
              } else if (r.sourceClosure?.tangentProtected && r.targetClosure?.tangentProtected) {
                // Translation of terminal handle preserves
                // its authored local tangent direction.
                last.c2 = { x: last.c2.x + expected.x - original.x, y: last.c2.y + expected.y - original.y };
              }
            }
            last.p3 = expected;
          }
        }
      }
      byPath.push(cubics);
      for (const q of cubics) {
        const o = global * 8;
        packed[o] = q.p0.x;
        packed[o + 1] = q.p0.y;
        packed[o + 2] = q.c1.x;
        packed[o + 3] = q.c1.y;
        packed[o + 4] = q.c2.x;
        packed[o + 5] = q.c2.y;
        packed[o + 6] = q.p3.x;
        packed[o + 7] = q.p3.y;
        global++;
      }
    }
    if (global !== rec.cubicCount) return null;
    rec.carrierCpuT = tt;
    rec.carrierOverflow = overflow;
    return packed;
  }

  function buildLayerCpuResource132(layerIndex, editPair = null) {
    const bluePhase = editPair === null || editPair?.origin === 'blue';
    const rawSrcLayer = editPair?.sourceLayer || runtimeState.morph?.renderSourceLayers?.[layerIndex],
      rawDstLayer = editPair?.targetLayer || runtimeState.morph?.renderTargetLayers?.[layerIndex];
    if (!rawSrcLayer || !rawDstLayer) return null;
    // The GPU must receive precisely the same bounded K as the ordinary
    // geometry and the CPU fallbacks, BEFORE branch pairing or carrier
    // creation. Never let raw authored K back into correspondence costs.
    const srcLayer = getSpiralGeometryLayer(rawSrcLayer);
    const dstLayer = getSpiralGeometryLayer(rawDstLayer);
    const sharedProfilePair = bluePhase && hasEquivalentSpiralProfilePair(layerIndex, srcLayer, dstLayer);
    if (!(srcLayer.spiralEnabled === true || dstLayer.spiralEnabled === true)) return null;
    if (somataFourierActive(srcLayer) || somataFourierActive(dstLayer)) return null;
    const namedMode = String(
      editPair?.mode || window.SomataMorphMode?.spiral?.() || state?.morph?.unifiedMode || 'circleSlide',
    );
    // Somata 14: ordinary polygon-family modes never inherit phaseCircle continuity or clones.
    const spiralTransport = ['topology', 'calm', 'circleSlide', 'topoCircle', 'fade', 'light'].includes(
      namedMode,
    )
      ? 'torn'
      : editPair?.spiralType || getEffectiveSpiralMorphTransport();
    const profileMorphMode = namedMode;
    // Use exactly one slide selector for order-zero and wound geometry.
    // The old 13.2 one-to-one Torn matching remains the minimal default.
    // For Sector/Phase ONLY the no-clone correspondence changes; we do not
    // borrow coordinated timing, germ attachment or continuity rules.
    const ordinarySlide = ['minimal', 'sector', 'phase'].includes(editPair?.slideType)
      ? editPair.slideType
      : ['minimal', 'sector', 'phase'].includes(state?.morph?.slideType)
        ? state.morph.slideType
        : 'minimal';
    const standardSpiralSlide = false; // One authoritative mode; no forced least-turn in phase/phaseCircle.
    // An authored zero-order Spiral is a *polygon* in the actual renderer.
    // It has polygon edges, not a spiral carrier with a nonzero angular phase.
    // The carrier-only path builds full-phase coils for intermediate frames and
    // can exceed the static polygon cubic budget, silently falling back to the
    // triangle-shaped endpoint rail until the final frame. Blend the exact
    // polygon and spiral endpoint rails in this cross-family case instead.
    const srcHasCoils =
      srcLayer?.spiralEnabled === true && Math.abs(Number(srcLayer?.spiralOrder) || 0) > 1e-8;
    const dstHasCoils =
      dstLayer?.spiralEnabled === true && Math.abs(Number(dstLayer?.spiralOrder) || 0) > 1e-8;
    const periodSeamEnforced = shouldSealWoundSpiral(spiralTransport, srcLayer, dstLayer);
    const selectiveFade =
      (spiralTransport === 'phase' && hasVertexAxisChange(srcLayer, dstLayer)) ||
      (spiralTransport === 'minimalTurn' && hasStepAxisChange(srcLayer, dstLayer));
    // A fading axis cannot simultaneously be rebuilt by the live carrier:
    // otherwise the shader receives independently moving geometry even at
    // a frame where that rail should ONLY be changing opacity. The paired
    // static endpoint rails remain exact, while the non-fading axis still
    // interpolates on each independent rail.
    const carrierMappedEligible =
      srcHasCoils &&
      dstHasCoils &&
      !selectiveFade &&
      spiralTransport !== 'torn' &&
      spiralTransport !== 'continuous' &&
      profileMorphMode !== 'fade';
    // Phase-locked endpoints (12.7.2): construct the static source and
    // target once and only interpolate their prepared cubic rails. Never
    // switch to a second live Spline+ rail inside the phase. The latter
    // changes corner classification / tip curvature as N/K and branch
    // correspondence change and was the source of visible topology snaps.
    // Static edit preview keeps its existing live-rounded behavior.
    // 14.2: the same endpoint/handle clock applies to Blue and manual.
    const phaseLockedEndpoints = carrierMappedEligible;
    const needsLiveRoundedSpline = Boolean(
      !phaseLockedEndpoints &&
      carrierMappedEligible &&
      srcLayer?.profileMode === 'spline' &&
      dstLayer?.profileMode === 'spline' &&
      srcLayer?.spiralClosed !== false &&
      dstLayer?.spiralClosed !== false &&
      srcLayer?.spiralRoundSeams !== false &&
      dstLayer?.spiralRoundSeams !== false &&
      Math.min(
        Number(getRoundingStrength(srcLayer.rounding)) || 0,
        Number(getRoundingStrength(dstLayer.rounding)) || 0,
      ) > 0.001 &&
      Array.isArray(srcLayer.profileNodes) &&
      Array.isArray(dstLayer.profileNodes) &&
      srcLayer.profileNodes.length === dstLayer.profileNodes.length,
    );
    // A single authored Bézier profile rail; closed topology adds only a bridge.
    // The phase end is the ONLY authoritative start of the next phase.
    // A new branch-count pairing can have more/less (including invisible)
    // paths even when all authored parameters match. Carry the exact
    // completed GPU Bezier rails, not a newly generated similar contour.
    const axisFade =
      (spiralTransport === 'phase' && hasVertexAxisChange(srcLayer, dstLayer)) ||
      (spiralTransport === 'minimalTurn' && hasStepAxisChange(srcLayer, dstLayer));
    const capped = srcLayer.spiralStepLimiterEnabled !== false || dstLayer.spiralStepLimiterEnabled !== false;
    const exactStart =
      bluePhase &&
      !axisFade &&
      spiralTransport === 'phaseCircle' &&
      !capped &&
      Array.isArray(srcLayer.__morphBoundaryRails)
        ? srcLayer.__morphBoundaryRails
        : null;
    let srcPaths = exactStart?.length
      ? exactStart.map((entry) => ({
          ...entry.path,
          __morphBoundarySourceCubics: entry.cubics,
          __morphBoundarySourcePresent: entry.present === true,
        }))
      : buildOrbitPolylines(srcLayer) || [];
    const dstPaths = buildOrbitPolylines(dstLayer) || [];
    // Retired rails must never become new visible source paths. With a cyclic
    // limiter rebuild the canonical N paths; otherwise phase boundaries can
    // multiply K=3/4 even though their effective K is only 1/2.
    srcPaths = srcPaths.filter((path) => path.__morphBoundarySourcePresent !== false);
    if (!srcPaths.length || !dstPaths.length) return null;
    const fixedAxisPairs = pairFixedAxisFade(spiralTransport, srcLayer, dstLayer, srcPaths, dstPaths);
    // Under a cyclic cap, branch changes come from the vertex count N,
    // not a growing integer K. Pair each path at most once; unmatched
    // paths fade rather than repeatedly reusing one endpoint as clones.
    // Unrestricted phase-circle retains its original split/merge feature.
    // Fixed N/K is a strict crossfade for ALL geometric edits, not only a
    // K/N count change. Neither rail moves, regardless of profile/rotation.
    const fadesNK = spiralTransport === 'continuous' || profileMorphMode === 'fade';
    const pairs =
      fixedAxisPairs ||
      (fadesNK
        ? [
            ...srcPaths.map((src) => ({
              src,
              dst: src,
              sourcePathPresent: true,
              targetPathPresent: false,
              fadeOutgoing: true,
              stableSpiralPairing: true,
            })),
            ...dstPaths.map((dst) => ({
              src: dst,
              dst,
              sourcePathPresent: false,
              targetPathPresent: true,
              fadeIncoming: true,
              stableSpiralPairing: true,
            })),
          ]
        : spiralTransport === 'torn'
          ? ['topology', 'calm', 'circleSlide', 'topoCircle'].includes(namedMode) &&
            ordinarySlide !== 'minimal'
            ? pairCoordinatedWithoutClones(srcPaths, dstPaths, srcLayer, dstLayer, ordinarySlide)
            : pairTornWithoutClones(srcPaths, dstPaths, srcLayer, dstLayer)
          : spiralTransport === 'phaseCircle' &&
              !usesPhaseClones(spiralTransport, srcLayer, dstLayer) &&
              SomataPhaseMatching.usesUniquePairs(srcLayer, dstLayer)
            ? pairTornWithoutClones(srcPaths, dstPaths, srcLayer, dstLayer)
            : spiralTransport === 'minimalTurn'
              ? pairMinimalTurnSpiralPaths(srcPaths, dstPaths, srcLayer, dstLayer)
              : stableSpiralPairs(srcPaths, dstPaths, srcLayer, dstLayer));
    if (!pairs.length) return null;
    if (exactStart?.length) {
      // Stable split/merge already selects one visible copy per branch.
      // An old retiring/ghost branch must remain invisible at phase 0.
      for (const pair of pairs)
        pair.sourcePathPresent =
          pair.sourcePathPresent !== false && pair.src?.__morphBoundarySourcePresent === true;
    }

    const records = [];
    let cubicCount = 0;
    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
      const pair = pairs[pairIndex],
        pairSourceLayer = pair.sourceLayer || (pair.fadeIncoming ? dstLayer : srcLayer),
        pairTargetLayer = pair.targetLayer || (pair.fadeOutgoing ? srcLayer : dstLayer),
        sourceMetrics = pair._sourceRetainedMetrics || null,
        targetMetrics = pair._targetRetainedMetrics || null,
        rawSc =
          pair.src?.__morphBoundarySourceCubics ||
          sourceMetrics?.cubics ||
          endpointCubics(pair.src, pairSourceLayer),
        rawDc =
          pair.fadeOutgoing && pair.src?.__morphBoundarySourceCubics
            ? pair.src.__morphBoundarySourceCubics
            : targetMetrics?.cubics || endpointCubics(pair.dst, pairTargetLayer);
      if (!rawSc.length || !rawDc.length) continue;

      const sourceRawArcMap = sourceMetrics?.map || buildRailArcMap(rawSc),
        targetRawArcMap = targetMetrics?.map || buildRailArcMap(rawDc),
        sourceRawKnotFractions = sourceRawArcMap.knots,
        targetRawKnotFractions = targetRawArcMap.knots;
      const crossFamily = srcHasCoils !== dstHasCoils,
        crossFamilyCartesianTransport =
          crossFamily &&
          (spiralTransport === 'phaseCircle' ||
            spiralTransport === 'minimalTurn' ||
            spiralTransport === 'phase' ||
            spiralTransport === 'topology');
      let sc,
        dc,
        n,
        commonFractions,
        arcEqualized = false,
        exactSubdivisionOnly = false;
      if (carrierMappedEligible || spiralTransport === 'torn') {
        n = Math.max(rawSc.length, rawDc.length);
        // A rounded connector can gain a few more exact spline pieces
        // *between* its two authored endpoints. Reserve subdivision-only
        // cubics so the live intermediate carrier never falls back to
        // the unsmoothed endpoint mix because of an inadequate budget.
        // Budget the extra *target* curvature once, not 20% of the
        // carried source on every phase. Otherwise exact handoffs
        // inflate the rail exponentially and destroy multi-layer FPS.
        if (needsLiveRoundedSpline) {
          if (exactStart?.length) n = Math.max(n, rawDc.length + Math.max(8, Math.ceil(rawDc.length * 0.2)));
          else n += Math.max(8, Math.ceil(n * 0.2)); // unchanged original phase budget
        }
        sc = pair.src?.__morphBoundarySourceCubics
          ? padExactPhaseSourceCubics(rawSc, n)
          : splitCubicRailToCountExact(rawSc, n);
        dc = splitCubicRailToCountExact(rawDc, n);
        if (sc && dc) {
          exactSubdivisionOnly = true;
          commonFractions = cubicKnotFractions(sc);
        } else {
          const eq = equalizeCubicRailsByArc(rawSc, rawDc, sourceRawArcMap, targetRawArcMap);
          sc = eq.source;
          dc = eq.target;
          n = Math.min(sc.length, dc.length);
          commonFractions = eq.fractions.slice(0, n + 1);
          arcEqualized = true;
        }
      } else {
        const eq = equalizeCubicRailsByArc(rawSc, rawDc, sourceRawArcMap, targetRawArcMap);
        sc = eq.source;
        dc = eq.target;
        n = Math.min(sc.length, dc.length);
        commonFractions = eq.fractions.slice(0, n + 1);
        arcEqualized = true;
      }
      if (!n || !sc?.length || !dc?.length) continue;
      const sp = cubicRailPoints(sc),
        dp = cubicRailPoints(dc),
        sourceClosure = periodSeamEnforced
          ? hardContinuousPeriodicClosureSpec(pair.src, rawSc, pairSourceLayer)
          : spiralTransport === 'torn'
            ? { periodic: false, delta: 0, logScale: 0, error: 0, tangentProtected: false }
            : periodicClosureSpec(pair.src, rawSc, pairSourceLayer),
        targetClosure = periodSeamEnforced
          ? hardContinuousPeriodicClosureSpec(pair.dst, rawDc, pairTargetLayer)
          : spiralTransport === 'torn'
            ? { periodic: false, delta: 0, logScale: 0, error: 0, tangentProtected: false }
            : periodicClosureSpec(pair.dst, rawDc, pairTargetLayer);
      records.push({
        pair,
        sp,
        dp,
        sc: sc.slice(0, n),
        dc: dc.slice(0, n),
        count: n,
        closed: spiralTransport !== 'torn' && Boolean(pair?.src?.closed && pair?.dst?.closed),
        sourceClosure,
        targetClosure,
        periodic: Boolean(sourceClosure.periodic && targetClosure.periodic),
        sourceRawCubics: rawSc,
        targetRawCubics: rawDc,
        sourceRawKnotFractions,
        targetRawKnotFractions,
        sourceLampKeyFractions: authoredFlagFractions(pair.src, sourceRawArcMap, 'key'),
        targetLampKeyFractions: authoredFlagFractions(pair.dst, targetRawArcMap, 'key'),
        sourceCornerFractions: authoredFlagFractions(pair.src, sourceRawArcMap, 'corner'),
        targetCornerFractions: authoredFlagFractions(pair.dst, targetRawArcMap, 'corner'),
        sourcePathLength: sourceRawArcMap.total,
        targetPathLength: targetRawArcMap.total,
        knotFractions: commonFractions || cubicKnotFractions(sc),
        explicitBridge: pair.src?.spiralExplicitBridge === true && pair.dst?.spiralExplicitBridge === true,
        roundedBridge: srcLayer.spiralRoundSeams !== false && dstLayer.spiralRoundSeams !== false,
        arcEqualized,
        exactSubdivisionOnly,
        crossFamilyCartesianTransport,
      });
      cubicCount += n;
    }
    if (!cubicCount) return null;
    const data = new Float32Array(cubicCount * FLOATS_PER_CUBIC);
    let ci = 0;
    for (const r of records)
      ci = packPairCubics132(
        r.sc,
        r.dc,
        r.pair.sourcePathPresent !== false,
        r.pair.targetPathPresent !== false,
        data,
        ci,
        spiralTransport,
        profileMorphMode,
        r.crossFamilyCartesianTransport === true,
        standardSpiralSlide,
      );
    const topologyMergeSplitCount = records.reduce(
      (n, r) => n + ((r.pair.sourcePathPresent !== false) !== (r.pair.targetPathPresent !== false) ? 1 : 0),
      0,
    );
    let cartesianFallbackCubics = 0,
      maxPackedPolarTurn = 0;
    for (let i = 0; i < cubicCount; i++) {
      const o = i * FLOATS_PER_CUBIC;
      if (data[o + 22] > 0.5) cartesianFallbackCubics++;
      for (let k = 0; k < 4; k++)
        maxPackedPolarTurn = Math.max(
          maxPackedPolarTurn,
          Math.abs(data[o + 9 + k * 2] - data[o + 1 + k * 2]),
        );
    }
    const pathCount = records.length,
      cpuSegmentMeta = new Uint32Array(cubicCount * 4),
      cpuPathSegmentRanges = new Uint32Array(pathCount * 4),
      pathRanges = new Uint32Array(pathCount * 4),
      closureCubicRanges = new Uint32Array(pathCount * 4),
      cpuPathPeriodic = new Uint32Array(pathCount),
      cpuEndpointPathLengths = new Float32Array(pathCount * 2),
      cpuPathKnotFractions = new Array(pathCount),
      cpuPathLampKeyFractions = new Array(pathCount),
      cpuPathCornerFractions = new Array(pathCount),
      cpuPathClosure = new Float32Array(pathCount * 8);
    let seg = 0,
      pointBase = 0,
      maxEndpointClosureError = 0,
      maxEndpointTangentClosureError = 0;
    for (let pi = 0; pi < records.length; pi++) {
      const rec0 = records[pi],
        n = rec0.sc.length,
        po = pi * 4;
      cpuPathSegmentRanges[po] = seg;
      cpuPathSegmentRanges[po + 1] = n;
      cpuPathSegmentRanges[po + 2] = pointBase;
      cpuPathSegmentRanges[po + 3] = n + 1;
      // Public/arc path ranges are in *points*.  The closure compute shader
      // indexes currentCubics (two vec4 per *cubic*), NOT points.  Before
      // 9.0.10 we uploaded pointBase / n+1 to that shader; from the second
      // spiral branch onwards it modified unrelated or out-of-range cubics.
      pathRanges[po] = pointBase;
      pathRanges[po + 1] = n + 1;
      pathRanges[po + 2] = rec0.closed ? 1 : 0;
      pathRanges[po + 3] = pi;
      closureCubicRanges[po] = seg;
      closureCubicRanges[po + 1] = n;
      closureCubicRanges[po + 2] = rec0.closed ? 1 : 0;
      closureCubicRanges[po + 3] = pi;
      const isStraightEnd = (rail) => {
        const q = rail?.[rail.length - 1];
        if (!q) return false;
        const vx = q.p3.x - q.p0.x,
          vy = q.p3.y - q.p0.y;
        const eps = 1e-5 * Math.max(1, Math.hypot(vx, vy));
        return (
          Math.hypot(q.c1.x - q.p0.x - vx / 3, q.c1.y - q.p0.y - vy / 3) <= eps &&
          Math.hypot(q.c2.x - q.p0.x - (vx * 2) / 3, q.c2.y - q.p0.y - (vy * 2) / 3) <= eps
        );
      };
      const strictStraightBridge =
        periodSeamEnforced && rec0.explicitBridge && isStraightEnd(rec0.sc) && isStraightEnd(rec0.dc);
      const co = pi * 8,
        sc0 = rec0.sourceClosure || {},
        dc0 = rec0.targetClosure || {};
      cpuPathClosure[co] = Number(sc0.delta) || 0;
      cpuPathClosure[co + 1] = Number(sc0.logScale) || 0;
      cpuPathClosure[co + 2] = Number(dc0.delta) || 0;
      cpuPathClosure[co + 3] = Number(dc0.logScale) || 0;
      cpuPathClosure[co + 4] = sc0.periodic ? 1 : 0;
      cpuPathClosure[co + 5] = dc0.periodic ? 1 : 0;
      cpuPathClosure[co + 6] = sc0.periodic && dc0.periodic ? 1 : 0;
      cpuPathClosure[co + 7] =
        (sc0.tangentProtected ? 1 : 0) + (dc0.tangentProtected ? 2 : 0) + (strictStraightBridge ? 8 : 0);
      maxEndpointClosureError = Math.max(
        maxEndpointClosureError,
        Number(sc0.error) || 0,
        Number(dc0.error) || 0,
      );
      maxEndpointTangentClosureError = Math.max(
        maxEndpointTangentClosureError,
        sc0.tangentProtected ? Number(sc0.tangentError) || 0 : 0,
        dc0.tangentProtected ? Number(dc0.tangentError) || 0 : 0,
      );

      cpuPathPeriodic[pi] = sc0.periodic && dc0.periodic && cpuPathClosure[co + 6] > 0.5 ? 1 : 0;
      cpuEndpointPathLengths[pi * 2] = Math.max(
        1e-9,
        Number(rec0.sourcePathLength) || cubicRailLength(rec0.sc),
      );
      cpuEndpointPathLengths[pi * 2 + 1] = Math.max(
        1e-9,
        Number(rec0.targetPathLength) || cubicRailLength(rec0.dc),
      );

      cpuPathKnotFractions[pi] = {
        source: rec0.sourceRawKnotFractions || cubicKnotFractions(rec0.sourceRawCubics),
        target: rec0.targetRawKnotFractions || cubicKnotFractions(rec0.targetRawCubics),
        common: rec0.knotFractions || cubicKnotFractions(rec0.sc),
      };
      cpuPathLampKeyFractions[pi] = {
        source: rec0.sourceLampKeyFractions || [0, 1],
        target: rec0.targetLampKeyFractions || [0, 1],
      };
      cpuPathCornerFractions[pi] = {
        source: rec0.sourceCornerFractions || [],
        target: rec0.targetCornerFractions || [],
      };
      for (let j = 0; j < n; j++, seg++) {
        const o = seg * 4,
          sq = rec0.sc[j],
          dq = rec0.dc[j];
        let flags = 0;
        const s0 = sq?.__profileCorner0 === true,
          s1 = sq?.__profileCorner1 === true,
          t0 = dq?.__profileCorner0 === true,
          t1 = dq?.__profileCorner1 === true;
        if (s0) flags |= 0x01000000;
        if (s1) flags |= 0x02000000;
        if (t0) flags |= 0x04000000;
        if (t1) flags |= 0x08000000;
        if (s0 || t0) flags |= 0x40000000;
        if (s1 || t1) flags |= 0x80000000;
        cpuSegmentMeta[o] = pointBase + j;
        cpuSegmentMeta[o + 1] = pointBase + j + 1;
        cpuSegmentMeta[o + 2] = pi;
        cpuSegmentMeta[o + 3] = flags >>> 0;
      }
      pointBase += n + 1;
    }
    const carrierMapped = carrierMappedEligible;
    // All continuous Spiral Morphs use one precomputed pair of finished Bézier rails.
    // Legacy segmented-toggle values are ignored; torn/fade keep their transport.
    const hasBakedCornerFillet = (layer) =>
      layer?.profileMode === 'segments' && (Number(getRoundingStrength(layer.rounding)) || 0) > 0.001;
    const preparedRoundedProfileRail =
      carrierMapped && (hasBakedCornerFillet(srcLayer) || hasBakedCornerFillet(dstLayer));
    const fullBezierMode = true;
    const preparedContinuousSplineRail = carrierMapped && fullBezierMode;
    // Local spline connector rounding is a geometric operation, not a
    // fade between two unrelated sets of handle vectors. Restrict this
    // authority to equal-sized, closed spline edits with positive authored
    // rounding. Other Morphs preserve the proven prepared-rail transport.
    const liveRoundedSpline = needsLiveRoundedSpline;
    let carrierFirst = 0;
    for (let ri = 0; ri < records.length; ri++) {
      const r = records[ri],
        sbi = Number(r.pair?.src?.spiralBranchIndex),
        dbi = Number(r.pair?.dst?.spiralBranchIndex);
      r.firstSegment = carrierFirst;
      carrierFirst += r.count;
      r.sourceCarrier = carrierLayerSpec(r.pair.sourceLayer || srcLayer, Number.isFinite(sbi) ? sbi : ri);
      r.targetCarrier = carrierLayerSpec(r.pair.targetLayer || dstLayer, Number.isFinite(dbi) ? dbi : ri);
      r.currentBranchIndex = Number.isFinite(sbi) ? sbi : Number.isFinite(dbi) ? dbi : ri;
      r.profileTargetCount = 0;
    }
    const auxPairs = records.map((r, pairIndex) => ({
      source: r.sp,
      target: r.dp,
      sourcePresent: r.pair.sourcePathPresent !== false,
      targetPresent: r.pair.targetPathPresent !== false,
      closed: r.closed === true,
      points: [],
      pairIndex,
      sourceBranchIndex: Number(r.pair?.src?.spiralBranchIndex),
      targetBranchIndex: Number(r.pair?.dst?.spiralBranchIndex),
      sourceBranchCount: Math.max(2, Math.round(Number(srcLayer?.N) || records.length)),
      targetBranchCount: Math.max(2, Math.round(Number(dstLayer?.N) || records.length)),
      branchPhase: 0,
    }));
    const allClosed = records.length > 0 && records.every((r) => r.closed === true);
    const interpolationMetric =
      spiralTransport === 'continuous'
        ? 'opacity-crossfade'
        : spiralTransport === 'torn'
          ? profileMorphMode === 'topology'
            ? 'cartesian'
            : 'least-turn-polar'
          : spiralTransport === 'minimalTurn'
            ? 'least-turn-polar'
            : 'outer-pinned-phase-polar';
    return {
      layerIndex,
      sourceLayer: srcLayer,
      targetLayer: dstLayer,
      sharedProfilePair,
      carrierMapped,
      periodSeamEnforced,
      phaseLockedEndpoints,
      fullBezierMode,
      preparedContinuousSplineRail,
      preparedRoundedProfileRail,
      liveRoundedSpline,
      extraInterpolationActive: false,
      tangentialOnlyCarrierChange: isTangentialOnlyCarrierChange(srcLayer, dstLayer),
      carrierRecords: records,
      carrierCpuT: NaN,
      carrierPacked: null,
      carrierCurrentByPath: null,
      carrierOverflow: false,
      carrierUploadedT: NaN,
      carrierUploadedGeneration: -1,
      phaseSerial: Number(editPair?.phaseSerial ?? runtimeState.morph?.gpuPhasePrepareSerial) || 0,
      staticEdit: !bluePhase,
      morphType: spiralTransport,
      spiralTransport,
      spiralSlideType: ordinarySlide,
      profileMorphMode,
      interpolationMetric,
      sourceSpline: srcLayer?.profileMode === 'spline',
      targetSpline: dstLayer?.profileMode === 'spline',
      data,
      cubicCount,
      segmentCount: cubicCount,
      pathCount,
      pointCount: pointBase,
      allClosed,
      topologyMergeSplitCount,
      geometricBirths: 0,
      geometricRetirements: 0,
      opacityFadeBranches: 0,
      germLinks: [],
      germLinkData: new Uint32Array(0),
      germLinkCount: 0,
      orphanGerms: 0,
      continuousTopologyTransport:
        spiralTransport === 'phaseCircle' ||
        spiralTransport === 'minimalTurn' ||
        (spiralTransport !== 'torn' && profileMorphMode !== 'fade'),
      stableSpiralPairing: records.every((r) => r.pair?.stableSpiralPairing === true),
      exactSubdivisionOnly: records.every((r) => r.exactSubdivisionOnly === true),
      arcEqualizedRecords: records.filter((r) => r.arcEqualized === true).length,
      cartesianFallbackCubics,
      maxPackedPolarTurn,
      topologySignature: `spiral-bezier:${profileMorphMode}:${spiralTransport}:${layerIndex}:${pathCount}:${cubicCount}:${srcLayer?.profileMode === 'spline' ? 'S' : 'G'}${dstLayer?.profileMode === 'spline' ? 'S' : 'G'}:${records.map((r) => (r.closed ? 1 : 0)).join('')}`,
      cpuSegmentMeta,
      cpuPathSegmentRanges,
      cpuPathRanges: pathRanges,
      cpuPathPeriodic,
      cpuEndpointPathLengths,
      cpuPathKnotFractions,
      cpuPathLampKeyFractions,
      cpuPathCornerFractions,
      cpuPathClosure,
      maxEndpointClosureError,
      maxEndpointTangentClosureError,
      pathRanges: closureCubicRanges,
      closureCubicRanges,
      auxPairs,
      buffer: null,
      bind: null,
      uniformBase: null,
      uniformGlow: null,
      uniformBaseBind: null,
      uniformGlowBind: null,
      cubicBuffer: null,
      cubicUniformBuffer: null,
      cubicBind: null,
      pathRangeBuffer: null,
      segmentMetaBuffer: null,
      pathSegmentRangeBuffer: null,
      pathClosureBuffer: null,
      closureBind: null,
      tangentRepairBind: null,
      bezierVisualRail: true,
      bezierSubdiv: SUBDIV,
      arcSubdiv: ARC_SUBDIV,
      specialSpiralBezierRail: true,
      exactEndpointCubics: true,
      gpuOnlySpiralEffects: true,
      copyBuffer: null,
      copyBind: null,
      copyCapacity: 0,
      copyData: new Float32Array(0),
      copyPackedFrameId: -1,
      copyPackedCount: 0,
      copyPackedMultiColor: false,
      auxT: NaN,
      lastCubicT: NaN,
      currentCubicsCommittedFrameId: -1,
      currentCubicsCommittedT: NaN,
      currentCubicsRootProducerFrameId: -1,
      currentCubicsRootProducerT: NaN,
      ready: false,
    };
  }

  function buildLayerCpuResource(layerIndex, editPair = null) {
    // Blue and Geometry > Animate are two clocks driving one source/target
    // descriptor and one canonical Bezier planning kernel.
    if (editPair === null && window.SomataMorphRuntime?.fromBlue) {
      editPair = window.SomataMorphRuntime.fromBlue(layerIndex);
    }
    const bluePhase = editPair === null || editPair?.origin === 'blue';
    // Version 13.2 rail planner for every mode except Stage 32 coordinated.
    const selectedMode = String(
      editPair?.mode || window.SomataMorphMode?.spiral?.() || state?.morph?.unifiedMode || 'circleSlide',
    );
    if (selectedMode !== 'coordinated') return buildLayerCpuResource132(layerIndex, editPair);
    const rawSrcLayer = editPair?.sourceLayer || runtimeState.morph?.renderSourceLayers?.[layerIndex],
      rawDstLayer = editPair?.targetLayer || runtimeState.morph?.renderTargetLayers?.[layerIndex];
    if (!rawSrcLayer || !rawDstLayer) return null;
    // The GPU must receive precisely the same bounded K as the ordinary
    // geometry and the CPU fallbacks, BEFORE branch pairing or carrier
    // creation. Never let raw authored K back into correspondence costs.
    const srcLayer = getSpiralGeometryLayer(rawSrcLayer);
    const dstLayer = getSpiralGeometryLayer(rawDstLayer);
    const sharedProfilePair = bluePhase && hasEquivalentSpiralProfilePair(layerIndex, srcLayer, dstLayer);
    if (!(srcLayer.spiralEnabled === true || dstLayer.spiralEnabled === true)) return null;
    if (somataFourierActive(srcLayer) || somataFourierActive(dstLayer)) return null;
    const spiralTransport = editPair?.spiralType || getEffectiveSpiralMorphTransport();
    const profileMorphMode = String(
      editPair?.mode || window.SomataMorphMode?.spiral?.() || state?.morph?.unifiedMode || 'circleSlide',
    );
    const standardSpiralSlide = false; // One authoritative mode; no forced least-turn in phase/phaseCircle.
    const selectedSlide = ['minimal', 'sector', 'phase'].includes(editPair?.slideType)
      ? editPair.slideType
      : ['minimal', 'sector', 'phase'].includes(state?.morph?.slideType)
        ? state.morph.slideType
        : 'minimal';
    // An authored zero-order Spiral is a *polygon* in the actual renderer.
    // It has polygon edges, not a spiral carrier with a nonzero angular phase.
    // The carrier-only path builds full-phase coils for intermediate frames and
    // can exceed the static polygon cubic budget, silently falling back to the
    // triangle-shaped endpoint rail until the final frame. Blend the exact
    // polygon and spiral endpoint rails in this cross-family case instead.
    const srcHasCoils =
      srcLayer?.spiralEnabled === true && Math.abs(Number(srcLayer?.spiralOrder) || 0) > 1e-8;
    const dstHasCoils =
      dstLayer?.spiralEnabled === true && Math.abs(Number(dstLayer?.spiralOrder) || 0) > 1e-8;
    const periodSeamEnforced = shouldSealWoundSpiral(spiralTransport, srcLayer, dstLayer);
    const selectiveFade =
      (spiralTransport === 'phase' && hasVertexAxisChange(srcLayer, dstLayer)) ||
      (spiralTransport === 'minimalTurn' && hasStepAxisChange(srcLayer, dstLayer));
    // A fading axis cannot simultaneously be rebuilt by the live carrier:
    // otherwise the shader receives independently moving geometry even at
    // a frame where that rail should ONLY be changing opacity. The paired
    // static endpoint rails remain exact, while the non-fading axis still
    // interpolates on each independent rail.
    const carrierMappedEligible =
      profileMorphMode === 'circleSlide' &&
      srcHasCoils &&
      dstHasCoils &&
      !selectiveFade &&
      !(spiralTransport === 'phaseCircle' && hasVertexAxisChange(srcLayer, dstLayer)) &&
      spiralTransport !== 'coordinated' &&
      spiralTransport !== 'torn' &&
      spiralTransport !== 'continuous' &&
      profileMorphMode !== 'fade';
    // Phase-locked endpoints (12.7.2): construct the static source and
    // target once and only interpolate their prepared cubic rails. Never
    // switch to a second live Spline+ rail inside the phase. The latter
    // changes corner classification / tip curvature as N/K and branch
    // correspondence change and was the source of visible topology snaps.
    // Static edit preview keeps its existing live-rounded behavior.
    // 14.2: the same endpoint/handle clock applies to Blue and manual.
    const phaseLockedEndpoints = carrierMappedEligible;
    const needsLiveRoundedSpline = Boolean(
      !phaseLockedEndpoints &&
      carrierMappedEligible &&
      srcLayer?.profileMode === 'spline' &&
      dstLayer?.profileMode === 'spline' &&
      srcLayer?.spiralClosed !== false &&
      dstLayer?.spiralClosed !== false &&
      srcLayer?.spiralRoundSeams !== false &&
      dstLayer?.spiralRoundSeams !== false &&
      Math.min(
        Number(getRoundingStrength(srcLayer.rounding)) || 0,
        Number(getRoundingStrength(dstLayer.rounding)) || 0,
      ) > 0.001 &&
      Array.isArray(srcLayer.profileNodes) &&
      Array.isArray(dstLayer.profileNodes) &&
      srcLayer.profileNodes.length === dstLayer.profileNodes.length,
    );
    // A single authored Bézier profile rail; closed topology adds only a bridge.
    // The phase end is the ONLY authoritative start of the next phase.
    // A new branch-count pairing can have more/less (including invisible)
    // paths even when all authored parameters match. Carry the exact
    // completed GPU Bezier rails, not a newly generated similar contour.
    const axisFade =
      (spiralTransport === 'phase' && hasVertexAxisChange(srcLayer, dstLayer)) ||
      (spiralTransport === 'minimalTurn' && hasStepAxisChange(srcLayer, dstLayer));
    const capped = srcLayer.spiralStepLimiterEnabled !== false || dstLayer.spiralStepLimiterEnabled !== false;
    const exactStart =
      bluePhase &&
      !axisFade &&
      ['phaseCircle', 'topology', 'coordinated'].includes(spiralTransport) &&
      (!capped || spiralTransport === 'coordinated') &&
      Array.isArray(srcLayer.__morphBoundaryRails)
        ? srcLayer.__morphBoundaryRails
        : null;
    let srcPaths = exactStart?.length
      ? exactStart.map((entry) => ({
          ...entry.path,
          __morphBoundarySourceCubics: entry.cubics,
          __morphBoundarySourcePresent: entry.present === true,
        }))
      : buildOrbitPolylines(srcLayer) || [];
    const dstPaths = buildOrbitPolylines(dstLayer) || [];
    // Retired rails must never become new visible source paths. With a cyclic
    // limiter rebuild the canonical N paths; otherwise phase boundaries can
    // multiply K=3/4 even though their effective K is only 1/2.
    srcPaths = srcPaths.filter((path) => path.__morphBoundarySourcePresent !== false);
    if (!srcPaths.length || !dstPaths.length) return null;
    const fixedAxisPairs = pairFixedAxisFade(spiralTransport, srcLayer, dstLayer, srcPaths, dstPaths);
    // Phase-circle now follows real neighboring rails for branch-count
    // changes, regardless of the optional K limiter. This supersedes the
    // old capped/unrestricted split-and-fade distinction. Other transports
    // retain their explicit fixed-axis / torn / fade semantics.
    // Fixed N/K is a strict crossfade for ALL geometric edits, not only a
    // K/N count change. Neither rail moves, regardless of profile/rotation.
    const fadesNK = spiralTransport === 'continuous' || profileMorphMode === 'fade';
    const pairs =
      fixedAxisPairs ||
      (fadesNK
        ? [
            ...srcPaths.map((src) => ({
              src,
              dst: src,
              sourcePathPresent: true,
              targetPathPresent: false,
              fadeOutgoing: true,
              stableSpiralPairing: true,
            })),
            ...dstPaths.map((dst) => ({
              src: dst,
              dst,
              sourcePathPresent: false,
              targetPathPresent: true,
              fadeIncoming: true,
              stableSpiralPairing: true,
            })),
          ]
        : spiralTransport === 'coordinated'
          ? expandCoordinatedGeometricGermsStage10(
              pairCoordinatedStage10(srcPaths, dstPaths, srcLayer, dstLayer, selectedSlide),
              srcLayer,
              dstLayer,
            )
          : spiralTransport === 'topology'
            ? pairTopologySpiralPaths(srcPaths, dstPaths, srcLayer, dstLayer)
            : spiralTransport === 'torn'
              ? pairTornWithoutClones(srcPaths, dstPaths, srcLayer, dstLayer)
              : spiralTransport === 'phaseCircle'
                ? usesPhaseClones(spiralTransport, srcLayer, dstLayer)
                  ? stableSpiralPairs(srcPaths, dstPaths, srcLayer, dstLayer)
                  : expandCoordinatedGeometricGerms(
                      pairCoordinatedWithoutClones(srcPaths, dstPaths, srcLayer, dstLayer, selectedSlide),
                      srcLayer,
                      dstLayer,
                    )
                : spiralTransport === 'minimalTurn'
                  ? pairMinimalTurnSpiralPaths(srcPaths, dstPaths, srcLayer, dstLayer)
                  : stableSpiralPairs(srcPaths, dstPaths, srcLayer, dstLayer));
    if (!pairs.length) return null;
    if (exactStart?.length) {
      // Stable split/merge already selects one visible copy per branch.
      // An old retiring/ghost branch must remain invisible at phase 0.
      for (const pair of pairs)
        pair.sourcePathPresent =
          pair.coordinatedGerm === 'birth' ||
          (pair.sourcePathPresent !== false && pair.src?.__morphBoundarySourcePresent === true);
    }

    const records = [];
    let cubicCount = 0;
    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
      const pair = pairs[pairIndex],
        pairSourceLayer = pair.sourceLayer || (pair.fadeIncoming ? dstLayer : srcLayer),
        pairTargetLayer = pair.targetLayer || (pair.fadeOutgoing ? srcLayer : dstLayer),
        sourceMetrics = pair._sourceRetainedMetrics || null,
        targetMetrics = pair._targetRetainedMetrics || null,
        rawSc =
          pair.src?.__morphBoundarySourceCubics ||
          sourceMetrics?.cubics ||
          endpointCubics(pair.src, pairSourceLayer),
        rawDc =
          pair.fadeOutgoing && pair.src?.__morphBoundarySourceCubics
            ? pair.src.__morphBoundarySourceCubics
            : targetMetrics?.cubics || endpointCubics(pair.dst, pairTargetLayer);
      if (!rawSc.length || !rawDc.length) continue;

      const sourceRawArcMap = sourceMetrics?.map || buildRailArcMap(rawSc),
        targetRawArcMap = targetMetrics?.map || buildRailArcMap(rawDc),
        sourceRawKnotFractions = sourceRawArcMap.knots,
        targetRawKnotFractions = targetRawArcMap.knots;
      const crossFamily = srcHasCoils !== dstHasCoils,
        crossFamilyCartesianTransport =
          crossFamily &&
          (spiralTransport === 'phaseCircle' ||
            spiralTransport === 'minimalTurn' ||
            spiralTransport === 'phase' ||
            spiralTransport === 'coordinated' ||
            spiralTransport === 'topology');
      let sc,
        dc,
        n,
        commonFractions,
        arcEqualized = false,
        exactSubdivisionOnly = false;
      if (pair.coordinatedGerm) {
        // A germ is already exactly subdivided as the same number of
        // cubic segments as its real rail. Arc-length equalization of
        // the zero-length endpoint would introduce unstable fractions.
        n = Math.min(rawSc.length, rawDc.length);
        sc = rawSc.slice(0, n);
        dc = rawDc.slice(0, n);
        commonFractions = pair.coordinatedGerm === 'birth' ? targetRawKnotFractions : sourceRawKnotFractions;
        exactSubdivisionOnly = true;
      } else if (spiralTransport === 'coordinated') {
        // Never arc-resample a retained physical branch at a cycle seam.
        // Arc fraction boundaries can jump across a disconnected cubic
        // and silently discard the terminal segment (a real teleport
        // although the root still matches). Only de Casteljau-split
        // existing cubics; that preserves their entire authored shape.
        n = Math.max(rawSc.length, rawDc.length);
        sc = splitCubicRailToCountExact(rawSc, n);
        dc = splitCubicRailToCountExact(rawDc, n);
        if (!sc || !dc) continue;
        commonFractions = cubicKnotFractions(sc);
        exactSubdivisionOnly = true;
      } else if (carrierMappedEligible || spiralTransport === 'torn') {
        n = Math.max(rawSc.length, rawDc.length);
        // A rounded connector can gain a few more exact spline pieces
        // *between* its two authored endpoints. Reserve subdivision-only
        // cubics so the live intermediate carrier never falls back to
        // the unsmoothed endpoint mix because of an inadequate budget.
        // Budget the extra *target* curvature once, not 20% of the
        // carried source on every phase. Otherwise exact handoffs
        // inflate the rail exponentially and destroy multi-layer FPS.
        if (needsLiveRoundedSpline) {
          if (exactStart?.length) n = Math.max(n, rawDc.length + Math.max(8, Math.ceil(rawDc.length * 0.2)));
          else n += Math.max(8, Math.ceil(n * 0.2)); // unchanged original phase budget
        }
        sc = pair.src?.__morphBoundarySourceCubics
          ? padExactPhaseSourceCubics(rawSc, n)
          : splitCubicRailToCountExact(rawSc, n);
        dc = splitCubicRailToCountExact(rawDc, n);
        if (sc && dc) {
          exactSubdivisionOnly = true;
          commonFractions = cubicKnotFractions(sc);
        } else {
          const eq = equalizeCubicRailsByArc(rawSc, rawDc, sourceRawArcMap, targetRawArcMap);
          sc = eq.source;
          dc = eq.target;
          n = Math.min(sc.length, dc.length);
          commonFractions = eq.fractions.slice(0, n + 1);
          arcEqualized = true;
        }
      } else {
        const eq = equalizeCubicRailsByArc(rawSc, rawDc, sourceRawArcMap, targetRawArcMap);
        sc = eq.source;
        dc = eq.target;
        n = Math.min(sc.length, dc.length);
        commonFractions = eq.fractions.slice(0, n + 1);
        arcEqualized = true;
      }
      if (!n || !sc?.length || !dc?.length) continue;
      const sp = cubicRailPoints(sc),
        dp = cubicRailPoints(dc),
        sourceClosure = periodSeamEnforced
          ? hardContinuousPeriodicClosureSpec(pair.src, rawSc, pairSourceLayer)
          : spiralTransport === 'torn'
            ? { periodic: false, delta: 0, logScale: 0, error: 0, tangentProtected: false }
            : periodicClosureSpec(pair.src, rawSc, pairSourceLayer),
        targetClosure = periodSeamEnforced
          ? hardContinuousPeriodicClosureSpec(pair.dst, rawDc, pairTargetLayer)
          : spiralTransport === 'torn'
            ? { periodic: false, delta: 0, logScale: 0, error: 0, tangentProtected: false }
            : periodicClosureSpec(pair.dst, rawDc, pairTargetLayer);
      records.push({
        pair,
        sp,
        dp,
        sc: sc.slice(0, n),
        dc: dc.slice(0, n),
        count: n,
        closed: spiralTransport !== 'torn' && Boolean(pair?.src?.closed && pair?.dst?.closed),
        sourceClosure,
        targetClosure,
        periodic: Boolean(sourceClosure.periodic && targetClosure.periodic),
        sourceRawCubics: rawSc,
        targetRawCubics: rawDc,
        sourceRawKnotFractions,
        targetRawKnotFractions,
        sourceLampKeyFractions: authoredFlagFractions(pair.src, sourceRawArcMap, 'key'),
        targetLampKeyFractions: authoredFlagFractions(pair.dst, targetRawArcMap, 'key'),
        sourceCornerFractions: authoredFlagFractions(pair.src, sourceRawArcMap, 'corner'),
        targetCornerFractions: authoredFlagFractions(pair.dst, targetRawArcMap, 'corner'),
        sourcePathLength: sourceRawArcMap.total,
        targetPathLength: targetRawArcMap.total,
        knotFractions: commonFractions || cubicKnotFractions(sc),
        explicitBridge: pair.src?.spiralExplicitBridge === true && pair.dst?.spiralExplicitBridge === true,
        roundedBridge: srcLayer.spiralRoundSeams !== false && dstLayer.spiralRoundSeams !== false,
        arcEqualized,
        exactSubdivisionOnly,
        crossFamilyCartesianTransport,
      });
      cubicCount += n;
    }
    // Each growing/retiring coil follows the animated neighboring coil's
    // CURRENT cubic before it is drawn. Keep link indices explicit so the
    // GPU attachment pass cannot accidentally connect unrelated branches.
    const germLinks = [];
    const pairRecordIndices = new Map(records.map((r, i) => [r.pair, i]));
    const cubicStarts = [];
    let cursor = 0;
    for (const r of records) {
      cubicStarts.push(cursor);
      cursor += r.count;
    }
    if (spiralTransport !== 'coordinated')
      for (let ri = 0; ri < records.length; ri++) {
        const r = records[ri],
          g = r.pair.coordinatedGerm;
        if (!g) continue;
        const parentRi = pairRecordIndices.get(r.pair.coordinatedParentPair);
        if (parentRi === undefined) continue;
        const parent = records[parentRi];
        const fractions = parent.knotFractions || [];
        const fraction = clamp(Number(r.pair.coordinatedParentFraction) || 0, 0, 1);
        let local = 0;
        while (local < parent.count - 1 && Number(fractions[local + 1]) < fraction) local++;
        const lo = Number(fractions[local]) || 0,
          hi = Number(fractions[local + 1]) || 1;
        const localT = clamp((fraction - lo) / Math.max(1e-9, hi - lo), 0, 1);
        if (spiralTransport === 'coordinated') {
          // The earlier collapse anchor came from an ARC-LENGTH query on
          // the original neighbor. The GPU attachment uses localT on a
          // subdivided/equalized parent cubic instead. These are not
          // generally the same point. Align the *zero* physical rail to
          // the very point the shader will use, on the exact paired
          // parent endpoint. Otherwise the newborn germ is translated
          // by several pixels on its first frame; the retiring germ
          // also ends away from the real parent before the final pass.
          const parentRail = g === 'birth' ? parent.sc : parent.dc;
          const parentCubic = parentRail[Math.min(local, parentRail.length - 1)];
          if (parentCubic) {
            const fixedAnchor = cubicPoint(parentCubic, localT);
            const collapsed = g === 'birth' ? r.sc : r.dc;
            for (const q of collapsed) {
              for (const name of ['p0', 'c1', 'c2', 'p3']) q[name] = { ...fixedAnchor };
            }
            if (g === 'birth') r.sp = cubicRailPoints(collapsed);
            else r.dp = cubicRailPoints(collapsed);
            r.pair.coordinatedAnchor = { ...fixedAnchor };
          }
        }
        for (let j = 0; j < r.count; j++)
          germLinks.push({
            child: cubicStarts[ri] + j,
            parent: cubicStarts[parentRi] + local,
            parentT: localT,
            birth: g === 'birth',
            ordinal: j,
            count: r.count,
            retireCoordinated: spiralTransport === 'coordinated' && g === 'retire',
            smootherBirth: spiralTransport === 'coordinated' && g === 'birth',
          });
      }
    const germLinkData = new Float32Array(germLinks.length * 8);
    for (let i = 0; i < germLinks.length; i++) {
      const g = germLinks[i],
        n = germLinks.length * 4,
        o = i * 4;
      germLinkData[o] = g.child;
      germLinkData[o + 1] = g.parent;
      germLinkData[o + 2] = g.parentT;
      germLinkData[o + 3] = g.birth ? 1 : 0;
      germLinkData[n + o] = g.ordinal;
      germLinkData[n + o + 1] = g.count;
      germLinkData[n + o + 2] = g.retireCoordinated ? 1 : 0;
      germLinkData[n + o + 3] = g.smootherBirth ? 1 : 0;
    }
    if (!cubicCount) return null;
    const data = new Float32Array(cubicCount * FLOATS_PER_CUBIC);
    let ci = 0;
    for (const r of records)
      ci = packPairCubics(
        r.sc,
        r.dc,
        r.pair.sourcePathPresent !== false,
        r.pair.targetPathPresent !== false,
        data,
        ci,
        spiralTransport,
        profileMorphMode,
        r.crossFamilyCartesianTransport === true || !!r.pair.coordinatedGerm,
        standardSpiralSlide,
        !!r.pair.coordinatedGerm,
        selectedSlide,
        spiralTransport === 'coordinated' && r.pair.coordinatedGerm === 'retire',
      );
    const topologyMergeSplitCount = records.reduce(
      (n, r) =>
        n +
        (r.pair.coordinatedGerm
          ? 1
          : (r.pair.sourcePathPresent !== false) !== (r.pair.targetPathPresent !== false)
            ? 1
            : 0),
      0,
    );
    const geometricBirths = records.filter((r) => r.pair.coordinatedGerm === 'birth').length;
    const geometricRetirements = records.filter((r) => r.pair.coordinatedGerm === 'retire').length;
    const opacityFadeBranches = records.filter(
      (r) => (r.pair.sourcePathPresent !== false) !== (r.pair.targetPathPresent !== false),
    ).length;
    let cartesianFallbackCubics = 0,
      maxPackedPolarTurn = 0;
    for (let i = 0; i < cubicCount; i++) {
      const o = i * FLOATS_PER_CUBIC;
      if (data[o + 22] > 0.5) cartesianFallbackCubics++;
      for (let k = 0; k < 4; k++)
        maxPackedPolarTurn = Math.max(
          maxPackedPolarTurn,
          Math.abs(data[o + 9 + k * 2] - data[o + 1 + k * 2]),
        );
    }
    const pathCount = records.length,
      cpuSegmentMeta = new Uint32Array(cubicCount * 4),
      cpuPathSegmentRanges = new Uint32Array(pathCount * 4),
      pathRanges = new Uint32Array(pathCount * 4),
      closureCubicRanges = new Uint32Array(pathCount * 4),
      cpuPathPeriodic = new Uint32Array(pathCount),
      cpuEndpointPathLengths = new Float32Array(pathCount * 2),
      cpuPathKnotFractions = new Array(pathCount),
      cpuPathLampKeyFractions = new Array(pathCount),
      cpuPathCornerFractions = new Array(pathCount),
      cpuPathClosure = new Float32Array(pathCount * 8);
    let seg = 0,
      pointBase = 0,
      maxEndpointClosureError = 0,
      maxEndpointTangentClosureError = 0;
    for (let pi = 0; pi < records.length; pi++) {
      const rec0 = records[pi],
        n = rec0.sc.length,
        po = pi * 4;
      cpuPathSegmentRanges[po] = seg;
      cpuPathSegmentRanges[po + 1] = n;
      cpuPathSegmentRanges[po + 2] = pointBase;
      cpuPathSegmentRanges[po + 3] = n + 1;
      // Public/arc path ranges are in *points*.  The closure compute shader
      // indexes currentCubics (two vec4 per *cubic*), NOT points.  Before
      // 9.0.10 we uploaded pointBase / n+1 to that shader; from the second
      // spiral branch onwards it modified unrelated or out-of-range cubics.
      pathRanges[po] = pointBase;
      pathRanges[po + 1] = n + 1;
      pathRanges[po + 2] = rec0.closed ? 1 : 0;
      pathRanges[po + 3] = pi;
      closureCubicRanges[po] = seg;
      closureCubicRanges[po + 1] = n;
      closureCubicRanges[po + 2] = rec0.closed ? 1 : 0;
      closureCubicRanges[po + 3] = pi;
      // A straight authored bridge remains straight throughout the morph.
      // Only tag it when BOTH terminal cubic controls are collinear.
      const isStraightBridge = (rail) => {
        const q = rail?.[rail.length - 1];
        if (!q) return false;
        const dx = q.p3.x - q.p0.x,
          dy = q.p3.y - q.p0.y;
        const d1 = Math.hypot(q.c1.x - q.p0.x - dx / 3, q.c1.y - q.p0.y - dy / 3);
        const d2 = Math.hypot(q.c2.x - q.p0.x - (dx * 2) / 3, q.c2.y - q.p0.y - (dy * 2) / 3);
        return Math.max(d1, d2) < 1e-5 * Math.max(1, Math.hypot(dx, dy));
      };
      const coordinatedStraightBridge =
        periodSeamEnforced && rec0.explicitBridge && isStraightBridge(rec0.sc) && isStraightBridge(rec0.dc);
      const co = pi * 8,
        sc0 = rec0.sourceClosure || {},
        dc0 = rec0.targetClosure || {};
      cpuPathClosure[co] = Number(sc0.delta) || 0;
      cpuPathClosure[co + 1] = Number(sc0.logScale) || 0;
      cpuPathClosure[co + 2] = Number(dc0.delta) || 0;
      cpuPathClosure[co + 3] = Number(dc0.logScale) || 0;
      cpuPathClosure[co + 4] = sc0.periodic ? 1 : 0;
      cpuPathClosure[co + 5] = dc0.periodic ? 1 : 0;
      cpuPathClosure[co + 6] = sc0.periodic && dc0.periodic ? 1 : 0;
      cpuPathClosure[co + 7] =
        (sc0.tangentProtected ? 1 : 0) +
        (dc0.tangentProtected ? 2 : 0) +
        (spiralTransport === 'coordinated' ? 4 : 0) +
        (coordinatedStraightBridge ? 8 : 0);
      maxEndpointClosureError = Math.max(
        maxEndpointClosureError,
        Number(sc0.error) || 0,
        Number(dc0.error) || 0,
      );
      maxEndpointTangentClosureError = Math.max(
        maxEndpointTangentClosureError,
        sc0.tangentProtected ? Number(sc0.tangentError) || 0 : 0,
        dc0.tangentProtected ? Number(dc0.tangentError) || 0 : 0,
      );

      cpuPathPeriodic[pi] = sc0.periodic && dc0.periodic && cpuPathClosure[co + 6] > 0.5 ? 1 : 0;
      cpuEndpointPathLengths[pi * 2] = Math.max(
        1e-9,
        Number(rec0.sourcePathLength) || cubicRailLength(rec0.sc),
      );
      cpuEndpointPathLengths[pi * 2 + 1] = Math.max(
        1e-9,
        Number(rec0.targetPathLength) || cubicRailLength(rec0.dc),
      );

      cpuPathKnotFractions[pi] = {
        source: rec0.sourceRawKnotFractions || cubicKnotFractions(rec0.sourceRawCubics),
        target: rec0.targetRawKnotFractions || cubicKnotFractions(rec0.targetRawCubics),
        common: rec0.knotFractions || cubicKnotFractions(rec0.sc),
      };
      cpuPathLampKeyFractions[pi] = {
        source: rec0.sourceLampKeyFractions || [0, 1],
        target: rec0.targetLampKeyFractions || [0, 1],
      };
      cpuPathCornerFractions[pi] = {
        source: rec0.sourceCornerFractions || [],
        target: rec0.targetCornerFractions || [],
      };
      for (let j = 0; j < n; j++, seg++) {
        const o = seg * 4,
          sq = rec0.sc[j],
          dq = rec0.dc[j];
        let flags = 0;
        const s0 = sq?.__profileCorner0 === true,
          s1 = sq?.__profileCorner1 === true,
          t0 = dq?.__profileCorner0 === true,
          t1 = dq?.__profileCorner1 === true;
        if (s0) flags |= 0x01000000;
        if (s1) flags |= 0x02000000;
        if (t0) flags |= 0x04000000;
        if (t1) flags |= 0x08000000;
        if (s0 || t0) flags |= 0x40000000;
        if (s1 || t1) flags |= 0x80000000;
        if (spiralTransport === 'coordinated') flags |= 1;
        cpuSegmentMeta[o] = pointBase + j;
        cpuSegmentMeta[o + 1] = pointBase + j + 1;
        cpuSegmentMeta[o + 2] = pi;
        cpuSegmentMeta[o + 3] = flags >>> 0;
      }
      pointBase += n + 1;
    }
    const carrierMapped = carrierMappedEligible;
    // All continuous Spiral Morphs use one precomputed pair of finished Bézier rails.
    // Legacy segmented-toggle values are ignored; torn/fade keep their transport.
    const hasBakedCornerFillet = (layer) =>
      layer?.profileMode === 'segments' && (Number(getRoundingStrength(layer.rounding)) || 0) > 0.001;
    const preparedRoundedProfileRail =
      carrierMapped && (hasBakedCornerFillet(srcLayer) || hasBakedCornerFillet(dstLayer));
    const fullBezierMode = true;
    const preparedContinuousSplineRail = carrierMapped && fullBezierMode;
    // Local spline connector rounding is a geometric operation, not a
    // fade between two unrelated sets of handle vectors. Restrict this
    // authority to equal-sized, closed spline edits with positive authored
    // rounding. Other Morphs preserve the proven prepared-rail transport.
    const liveRoundedSpline = needsLiveRoundedSpline;
    let carrierFirst = 0;
    for (let ri = 0; ri < records.length; ri++) {
      const r = records[ri],
        sbi = Number(r.pair?.src?.spiralBranchIndex),
        dbi = Number(r.pair?.dst?.spiralBranchIndex);
      r.firstSegment = carrierFirst;
      carrierFirst += r.count;
      r.sourceCarrier = carrierLayerSpec(r.pair.sourceLayer || srcLayer, Number.isFinite(sbi) ? sbi : ri);
      r.targetCarrier = carrierLayerSpec(r.pair.targetLayer || dstLayer, Number.isFinite(dbi) ? dbi : ri);
      r.currentBranchIndex = Number.isFinite(sbi) ? sbi : Number.isFinite(dbi) ? dbi : ri;
      r.profileTargetCount = 0;
    }
    const auxPairs = records.map((r, pairIndex) => ({
      source: r.sp,
      target: r.dp,
      sourcePresent: r.pair.sourcePathPresent !== false,
      targetPresent: r.pair.targetPathPresent !== false,
      closed: r.closed === true,
      points: [],
      pairIndex,
      sourceBranchIndex: Number(r.pair?.src?.spiralBranchIndex),
      targetBranchIndex: Number(r.pair?.dst?.spiralBranchIndex),
      sourceBranchCount: Math.max(2, Math.round(Number(srcLayer?.N) || records.length)),
      targetBranchCount: Math.max(2, Math.round(Number(dstLayer?.N) || records.length)),
      branchPhase: 0,
    }));
    const allClosed = records.length > 0 && records.every((r) => r.closed === true);
    const interpolationMetric =
      spiralTransport === 'topology'
        ? 'cartesian-topological-branch-controls'
        : profileMorphMode === 'topoCircleOpacity'
          ? 'hybrid-topological-circular-opacity'
          : spiralTransport === 'coordinated'
            ? 'stage10-reference-geometric-germs-no-parent-pass'
            : spiralTransport === 'continuous' || profileMorphMode === 'fade'
              ? 'opacity-crossfade'
              : spiralTransport === 'torn'
                ? profileMorphMode === 'topology'
                  ? 'cartesian'
                  : 'least-turn-polar'
                : spiralTransport === 'minimalTurn'
                  ? 'least-turn-polar'
                  : 'outer-pinned-phase-polar';
    return {
      layerIndex,
      sourceLayer: srcLayer,
      targetLayer: dstLayer,
      sharedProfilePair,
      carrierMapped,
      periodSeamEnforced,
      phaseLockedEndpoints,
      fullBezierMode,
      preparedContinuousSplineRail,
      preparedRoundedProfileRail,
      liveRoundedSpline,
      extraInterpolationActive: false,
      tangentialOnlyCarrierChange: isTangentialOnlyCarrierChange(srcLayer, dstLayer),
      carrierRecords: records,
      carrierCpuT: NaN,
      carrierPacked: null,
      carrierCurrentByPath: null,
      carrierOverflow: false,
      carrierUploadedT: NaN,
      carrierUploadedGeneration: -1,
      phaseSerial: Number(editPair?.phaseSerial ?? runtimeState.morph?.gpuPhasePrepareSerial) || 0,
      staticEdit: !bluePhase,
      morphType: spiralTransport,
      spiralTransport,
      spiralSlideType: selectedSlide,
      profileMorphMode,
      interpolationMetric,
      sourceSpline: srcLayer?.profileMode === 'spline',
      targetSpline: dstLayer?.profileMode === 'spline',
      data,
      cubicCount,
      segmentCount: cubicCount,
      pathCount,
      pointCount: pointBase,
      allClosed,
      topologyMergeSplitCount,
      geometricBirths,
      geometricRetirements,
      opacityFadeBranches,
      germLinks,
      germLinkData,
      germLinkCount: germLinks.length,
      orphanGerms: records.filter((r) => r.pair.coordinatedOrphan).length,
      continuousTopologyTransport:
        spiralTransport === 'phaseCircle' ||
        spiralTransport === 'minimalTurn' ||
        (spiralTransport !== 'torn' && profileMorphMode !== 'fade'),
      stableSpiralPairing: records.every((r) => r.pair?.stableSpiralPairing === true),
      exactSubdivisionOnly: records.every((r) => r.exactSubdivisionOnly === true),
      arcEqualizedRecords: records.filter((r) => r.arcEqualized === true).length,
      cartesianFallbackCubics,
      maxPackedPolarTurn,
      topologySignature: `spiral-bezier:${profileMorphMode}:${spiralTransport}:${layerIndex}:${pathCount}:${cubicCount}:${srcLayer?.profileMode === 'spline' ? 'S' : 'G'}${dstLayer?.profileMode === 'spline' ? 'S' : 'G'}:${records.map((r) => (r.closed ? 1 : 0)).join('')}`,
      cpuSegmentMeta,
      cpuPathSegmentRanges,
      cpuPathRanges: pathRanges,
      cpuPathPeriodic,
      cpuEndpointPathLengths,
      cpuPathKnotFractions,
      cpuPathLampKeyFractions,
      cpuPathCornerFractions,
      cpuPathClosure,
      maxEndpointClosureError,
      maxEndpointTangentClosureError,
      pathRanges: closureCubicRanges,
      closureCubicRanges,
      auxPairs,
      buffer: null,
      bind: null,
      uniformBase: null,
      uniformGlow: null,
      uniformBaseBind: null,
      uniformGlowBind: null,
      cubicBuffer: null,
      cubicUniformBuffer: null,
      cubicBind: null,
      pathRangeBuffer: null,
      segmentMetaBuffer: null,
      pathSegmentRangeBuffer: null,
      pathClosureBuffer: null,
      closureBind: null,
      tangentRepairBind: null,
      bezierVisualRail: true,
      bezierSubdiv: SUBDIV,
      arcSubdiv: ARC_SUBDIV,
      specialSpiralBezierRail: true,
      exactEndpointCubics: true,
      gpuOnlySpiralEffects: true,
      copyBuffer: null,
      copyBind: null,
      copyCapacity: 0,
      copyData: new Float32Array(0),
      copyPackedFrameId: -1,
      copyPackedCount: 0,
      copyPackedMultiColor: false,
      auxT: NaN,
      lastCubicT: NaN,
      currentCubicsCommittedFrameId: -1,
      currentCubicsCommittedT: NaN,
      currentCubicsRootProducerFrameId: -1,
      currentCubicsRootProducerT: NaN,
      ready: false,
    };
  }
  function allocateMorphPairGpu(rec, i) {
    // Spiral 13.0.6: bake logarithms of immutable width endpoints once
    // per phase instead of evaluating 4 log + 2 exp operations in
    // every GPU tessellation invocation for all SUBDIV samples.
    // Keep rec.data untouched: auxiliary CPU paths still use widths.
    const gpuData = new Float32Array(rec.data);
    for (let ci = 0; ci < rec.cubicCount; ci++) {
      const o = ci * FLOATS_PER_CUBIC;
      for (let k = 16; k < 20; k++) gpuData[o + k] = Math.log(Math.max(0.02, gpuData[o + k]));
    }
    rec.buffer = device.createBuffer({
      label: `Somata Spiral Bézier Morph L${i}`,
      size: Math.max(96, Math.ceil(gpuData.byteLength / 16) * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(rec.buffer, 0, gpuData.buffer, gpuData.byteOffset, gpuData.byteLength);
    rec.cubicBuffer = device.createBuffer({
      label: `Somata Spiral Bézier shared current cubics L${i}`,
      size: Math.max(32, rec.cubicCount * 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    rec.fastRailBuffer = device.createBuffer({
      label: `Somata 7.5 Spiral Fast Visual Rail L${i}`,
      size: Math.max(32, rec.cubicCount * SUBDIV * 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    rec.cubicUniformBuffer = device.createBuffer({
      label: `Somata Spiral Bézier shared cubic phase L${i}`,
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    rec.bind = device.createBindGroup({
      layout: renderCubicLayout,
      entries: [{ binding: 0, resource: { buffer: rec.fastRailBuffer } }],
    });
    rec.cubicBind = device.createBindGroup({
      layout: effectCubicPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: rec.buffer } },
        { binding: 1, resource: { buffer: rec.cubicBuffer } },
        { binding: 2, resource: { buffer: rec.cubicUniformBuffer } },
      ],
    });
    if (rec.germLinkCount > 0 && germAttachPipeline) {
      rec.germSnapshotBuffer = device.createBuffer({
        label: `Somata neighbor-coil immutable parent/child snapshot L${i}`,
        size: Math.max(32, rec.cubicCount * 32),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      rec.germLinkBuffer = device.createBuffer({
        label: `Somata neighbor-coil attachments L${i}`,
        size: rec.germLinkData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(rec.germLinkBuffer, 0, rec.germLinkData);
      rec.germAttachBind = device.createBindGroup({
        layout: germAttachPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rec.germSnapshotBuffer } },
          { binding: 1, resource: { buffer: rec.cubicBuffer } },
          { binding: 2, resource: { buffer: rec.germLinkBuffer } },
          { binding: 3, resource: { buffer: rec.cubicUniformBuffer } },
        ],
      });
    }
    rec.fastRailBind = device.createBindGroup({
      layout: fastRailPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: rec.buffer } },
        { binding: 1, resource: { buffer: rec.cubicBuffer } },
        { binding: 2, resource: { buffer: rec.fastRailBuffer } },
        { binding: 3, resource: { buffer: rec.cubicUniformBuffer } },
      ],
    });
    rec.pathRangeBuffer = device.createBuffer({
      label: `Somata Spiral Bézier effect path ranges L${i}`,
      size: Math.max(16, rec.pathRanges.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(rec.pathRangeBuffer, 0, rec.pathRanges);
    rec.segmentMetaBuffer = device.createBuffer({
      label: `Somata Spiral Bézier effect segment metadata L${i}`,
      size: Math.max(16, rec.cpuSegmentMeta.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(rec.segmentMetaBuffer, 0, rec.cpuSegmentMeta);
    rec.pathSegmentRangeBuffer = device.createBuffer({
      label: `Somata Spiral Bézier effect segment ranges L${i}`,
      size: Math.max(16, rec.cpuPathSegmentRanges.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(rec.pathSegmentRangeBuffer, 0, rec.cpuPathSegmentRanges);
    rec.pathClosureBuffer = device.createBuffer({
      label: `Somata 7.5 Spiral periodic closure L${i}`,
      size: Math.max(32, rec.cpuPathClosure.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(rec.pathClosureBuffer, 0, rec.cpuPathClosure);
    rec.closureBind = device.createBindGroup({
      layout: closurePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: rec.cubicBuffer } },
        { binding: 1, resource: { buffer: rec.pathSegmentRangeBuffer } },
        { binding: 2, resource: { buffer: rec.pathClosureBuffer } },
        { binding: 3, resource: { buffer: rec.cubicUniformBuffer } },
      ],
    });
    rec.tangentRepairBind = device.createBindGroup({
      layout: tangentRepairPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: rec.cubicBuffer } },
        { binding: 1, resource: { buffer: rec.segmentMetaBuffer } },
        { binding: 2, resource: { buffer: rec.cubicUniformBuffer } },
      ],
    });
    rec.uniformBase = device.createBuffer({
      label: `Somata Spiral Bézier Morph base uniforms L${i}`,
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    rec.uniformGlow = device.createBuffer({
      label: `Somata Spiral Bézier Morph glow uniforms L${i}`,
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    rec.uniformBaseBind = device.createBindGroup({
      layout: renderUniformLayout,
      entries: [{ binding: 0, resource: { buffer: rec.uniformBase } }],
    });
    rec.uniformGlowBind = device.createBindGroup({
      layout: renderUniformLayout,
      entries: [{ binding: 0, resource: { buffer: rec.uniformGlow } }],
    });
    rec.ready = true;
    return rec;
  }
  async function preparePhase() {
    if (!(
      state?.morph?.mode === 'circleSlide' ||
      state?.morph?.mode === 'topoCircle' ||
      state?.morph?.mode === 'topoCircleOpacity' ||
      spiralMorphUsesRetainedBezierRail()
    )) {
      retireCurrentResources('prepare-ineligible');
      return 0;
    }
    if (!(await ensureReady())) {
      retireCurrentResources('prepare-unavailable');
      return 0;
    }
    const nextResources = new Map();
    let built = 0;
    try {
      for (let i = 0; i < (state.layers?.length || 0); i++) {
        const rec = buildLayerCpuResource(i);
        if (!rec) continue;
        allocateMorphPairGpu(rec, i);
        nextResources.set(i, rec);
        built++;
        stats.layerBuilds++;
        stats.uploads += rec.data.byteLength;
        stats.cubics += rec.cubicCount;
        stats.gpuSegments += rec.cubicCount * SUBDIV;
        stats.fastRailSegments += rec.cubicCount * SUBDIV;
      }
      replaceResources(nextResources, 'phase-atomic-swap');
      stats.phaseBuilds++;
      return built;
    } catch (err) {
      for (const rec of nextResources.values()) destroyResource(rec);
      retireCurrentResources('prepare-error');
      lastError = String(err?.message || err);
      stats.errors++;
      return 0;
    }
  }

  // User-initiated finite Spiral edits use the *same retained Bezier GPU Morph*
  // as Blue. Endpoints are prepared once per edit, then only the progress
  // uniform changes each frame. This never aliases Blue's own resources.
  function beginStaticEdit(layerIndex, pair) {
    if (!pair?.sourceLayer || !pair?.targetLayer) return false;
    const i = Math.max(0, Number(layerIndex) || 0),
      previous = staticEditResources.get(i);
    if (
      previous?.source === pair.sourceLayer &&
      previous?.target === pair.targetLayer &&
      previous?.type === pair.spiralType &&
      previous?.mode === pair.mode &&
      previous.generation === generation
    ) {
      if (previous.rec?.ready) return true;
      if (previous.pending || performance.now() - (previous.lastAttempt || 0) < 300) return false;
      staticEditResources.delete(i);
    }
    if (previous?.rec) {
      retiredResources.push(previous.rec);
      stats.retired++;
      scheduleRetiredFlush();
    }
    const slot = {
      source: pair.sourceLayer,
      target: pair.targetLayer,
      type: pair.spiralType,
      mode: pair.mode,
      generation,
      rec: null,
      pending: true,
      lastAttempt: performance.now(),
    };
    staticEditResources.set(i, slot);
    Promise.resolve(ensureReady())
      .then((ok) => {
        if (staticEditResources.get(i) !== slot) return;
        slot.generation = generation;
        if (!ok) {
          slot.pending = false;
          return;
        }
        const cpu = buildLayerCpuResource(i, {
          sourceLayer: slot.source,
          targetLayer: slot.target,
          spiralType: slot.type,
          mode: slot.mode,
        });
        if (!cpu) {
          slot.pending = false;
          return;
        }
        try {
          cpu.staticEdit = true;
          allocateMorphPairGpu(cpu, i);
          if (staticEditResources.get(i) !== slot) {
            retiredResources.push(cpu);
            scheduleRetiredFlush();
            return;
          }
          slot.rec = cpu;
          slot.pending = false;
          stats.layerBuilds++;
          stats.uploads += cpu.data.byteLength;
          requestMainCanvasRender?.();
        } catch (error) {
          slot.pending = false;
          lastError = String(error?.message || error);
          stats.errors++;
          destroyResource(cpu);
        }
      })
      .catch((error) => {
        slot.pending = false;
        lastError = String(error?.message || error);
        stats.errors++;
      });
    return false;
  }
  function getStaticEditResource(frameCtx) {
    return staticEditResources.get(Number(frameCtx?.layerIndex) || 0)?.rec || null;
  }
  // Both Blue and finite left-panel edits MUST publish the same physical
  // period as the actual retained Bezier rail. In a wound Corridor,
  // using Math.round(N) or a second linear N/K interpolation opens the seam
  // between adjacent copies even though every individual cubic is C0 exact.
  function coordinatedPeriodDelta(rec, t) {
    if (!rec || !rec.periodSeamEnforced || !rec.cpuPathClosure) return NaN;
    const u = resolveEffectT(rec, t),
      ease = rec.spiralTransport === 'coordinated' ? u * u * (3 - 2 * u) : u,
      c = rec.cpuPathClosure;
    if (rec.carrierMapped === true) {
      ensureCarrierMappedCurrent(rec, u);
      for (let pi = 0; pi < rec.pathCount; pi++) {
        if (c[pi * 8 + 6] < 0.5 || rec.carrierRecords?.[pi]?.pair?.coordinatedGerm) continue;
        const delta = Number(rec.carrierFrameSpecs?.[pi]?.delta);
        if (Number.isFinite(delta)) return delta;
      }
    }

    // Matched real branch, never a birth/retirement with a zero-period germ.
    for (let pi = 0; pi < rec.pathCount; pi++) {
      const pair = rec.carrierRecords?.[pi]?.pair;
      const o = pi * 8;
      if (
        c[o + 6] < 0.5 ||
        pair?.coordinatedGerm ||
        pair?.sourcePathPresent === false ||
        pair?.targetPathPresent === false
      )
        continue;
      return c[o] + (c[o + 2] - c[o]) * ease;
    }
    return NaN;
  }

  function getStaticVisualResource(frameCtx) {
    if (
      !frameCtx ||
      frameCtx.morphFrameActive ||
      typeof isSpiralLayer !== 'function' ||
      !isSpiralLayer(frameCtx.layer)
    )
      return null;
    if (!ready || !device) return null;
    try {
      warmupGpuMorphArcResource?.();
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#getStaticVisualResource', error);
    }
    const source = getStaticSpiralBezierResource(frameCtx.layerIndex, device, generation);
    if (!source?.ready || !source.cubicBuffer || !(source.cubicCount > 0)) return null;
    const key = Number(frameCtx.layerIndex) || 0,
      old = staticVisualResources.get(key);
    if (old?.source === source && old?.generation === generation && old?.ready) {
      stats.staticVisualHits++;
      return old;
    }
    if (old) destroyStaticVisual(old);
    try {
      const meta = new Float32Array(source.cubicCount * 24);
      for (let i = 0; i < source.cubicCount; i++) {
        const o = i * 24,
          w0 = Math.max(0.02, Number(source.cpuCubicWidthScales?.[i * 2]) || 1),
          w1 = Math.max(0.02, Number(source.cpuCubicWidthScales?.[i * 2 + 1]) || 1);
        meta[o + 16] = Math.log(w0);
        meta[o + 17] = Math.log(w1);
        meta[o + 18] = meta[o + 16];
        meta[o + 19] = meta[o + 17];
        meta[o + 20] = 1;
        meta[o + 21] = 1;
      }
      for (let pi = 0; pi < (source.pathCount || 0); pi++) {
        const ro = pi * 4,
          first = source.cpuPathSegmentRanges?.[ro] >>> 0,
          count = source.cpuPathSegmentRanges?.[ro + 1] >>> 0;
        if (!count) continue;
        meta[first * 24 + 23] = meta[first * 24 + 23] + 1;
        meta[(first + count - 1) * 24 + 23] = meta[(first + count - 1) * 24 + 23] + 2;
      }
      const metaBuffer = device.createBuffer({
        label: `Somata static Spiral visual metadata L${key}`,
        size: Math.max(96, meta.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(metaBuffer, 0, meta);
      const uniformBase = device.createBuffer({
        label: `Somata static Spiral base uniforms L${key}`,
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const uniformGlow = device.createBuffer({
        label: `Somata static Spiral glow uniforms L${key}`,
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const fastRailBuffer = device.createBuffer({
        label: `Somata 7.5 static Spiral Fast Visual Rail L${key}`,
        size: Math.max(32, source.cubicCount * SUBDIV * 32),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const fastUniformBuffer = device.createBuffer({
        label: `Somata 7.5 static Spiral Fast Rail uniform L${key}`,
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const fastRaw = new ArrayBuffer(32),
        fastU32 = new Uint32Array(fastRaw),
        fastF32 = new Float32Array(fastRaw);
      fastU32[0] = source.cubicCount >>> 0;
      fastF32[4] = 0;
      device.queue.writeBuffer(fastUniformBuffer, 0, fastRaw);
      const fastRailBind = device.createBindGroup({
        layout: fastRailPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: metaBuffer } },
          { binding: 1, resource: { buffer: source.cubicBuffer } },
          { binding: 2, resource: { buffer: fastRailBuffer } },
          { binding: 3, resource: { buffer: fastUniformBuffer } },
        ],
      });
      {
        const enc = device.createCommandEncoder({ label: `Somata 7.5 static Spiral Fast Rail L${key}` });
        const pass = enc.beginComputePass({ label: `Somata 7.5 static Spiral Fast Rail L${key}` });
        pass.setPipeline(fastRailPipeline);
        pass.setBindGroup(0, fastRailBind);
        pass.dispatchWorkgroups(
          Math.ceil((source.cubicCount * (SUBDIV / FAST_RAIL_SEGMENTS_PER_THREAD)) / 128),
        );
        pass.end();
        device.queue.submit([enc.finish()]);
        stats.fastRailDispatches++;
        stats.fastRailSegments += source.cubicCount * SUBDIV;
      }
      const rec = {
        source,
        generation,
        layerIndex: key,
        phaseSerial: 0,
        staticVisual: true,
        ready: true,
        cubicCount: source.cubicCount,
        pathCount: source.pathCount || 0,
        cubicBuffer: source.cubicBuffer,
        metaBuffer,
        fastRailBuffer,
        fastUniformBuffer,
        fastRailBind,
        bind: device.createBindGroup({
          layout: renderCubicLayout,
          entries: [{ binding: 0, resource: { buffer: fastRailBuffer } }],
        }),
        uniformBase,
        uniformGlow,
        uniformBaseBind: device.createBindGroup({
          layout: renderUniformLayout,
          entries: [{ binding: 0, resource: { buffer: uniformBase } }],
        }),
        uniformGlowBind: device.createBindGroup({
          layout: renderUniformLayout,
          entries: [{ binding: 0, resource: { buffer: uniformGlow } }],
        }),
        copyBuffer: null,
        copyBind: null,
        copyCapacity: 0,
        copyData: new Float32Array(0),
        copyPackedFrameId: -1,
        copyPackedCount: 0,
        copyPackedMultiColor: false,
        currentCubicsRootProducerFrameId: -1,
        currentCubicsRootProducerT: 0,
        fastRailRootProducerFrameId: -1,
        fastRailRootProducerT: 0,
      };
      staticVisualResources.set(key, rec);
      stats.staticVisualBuilds++;
      stats.uploads += meta.byteLength;
      return rec;
    } catch (err) {
      lastError = String(err?.message || err);
      stats.errors++;
      return null;
    }
  }
  function getVisualResource(frameCtx) {
    return frameCtx?.spiralEditMorph
      ? getStaticEditResource(frameCtx)
      : frameCtx?.morphFrameActive
        ? getResource(frameCtx.layerIndex)
        : getStaticVisualResource(frameCtx);
  }
  // One authority for Base and retained GPU effects. The exact resource
  // selected by draw() is also the only cubic/Arc source allowed to Web.
  function getAuthoritativeArcResource(frameCtx) {
    if (!frameCtx || state?.fourierMode === true) return null;
    if (frameCtx.morphFrameActive) {
      if (
        frameCtx.geometryProvider !== frameCtx.blueMorphProvider ||
        !['blue-circle-slide', 'blue-prepared'].includes(frameCtx.geometryPlan?.kind) ||
        frameCtx.greenMorphEnabled === true ||
        frameCtx.minimalFadeEnabled === true
      )
        return null;
    } else if (frameCtx.geometryPlan?.dynamic === true && !frameCtx.spiralEditMorph) return null;
    const visual = getVisualResource(frameCtx);
    const rec = visual?.staticVisual === true ? visual.source : visual;
    if (!rec?.ready || rec.bezierVisualRail !== true) return null;
    // The rasterized Line is precisely the eight-piece fast visual rail,
    // not an analytically re-sampled cubic. Expose its *actual buffer* to
    // the Arc/Web consumers; this never creates another geometry source.
    rec.visibleRailBuffer = visual?.fastRailBuffer || rec.fastRailBuffer || null;
    rec.visibleRailExact = Boolean(rec.visibleRailBuffer);
    if (typeof rec.encodeVisibleRailForEffects !== 'function') {
      rec.encodeVisibleRailForEffects = (encoder, t, reuseCurrentCubics = false) => {
        if (visual?.staticVisual === true) return true; // static rail already resident
        if (!reuseCurrentCubics && !encodeEffectCubics(rec, encoder, t)) return false;
        return encodeFastRail(rec, encoder, t);
      };
    }
    if (typeof rec.encodeCurrentCubics !== 'function') {
      rec.resolveMorphT = (t) => resolveEffectT(rec, t);
      rec.encodeCurrentCubics = (encoder, t) => encodeEffectCubics(rec, encoder, t);
      rec.buildCurrentCubicsPrerequisite = (fid, t) => buildCurrentCubicsPrerequisite(rec, fid, t);
    }
    return rec;
  }
  // 13.16: prepare the exact visible Line rail before any GPU Web geometry is
  // generated. This is a COMPUTE prerequisite, not a Line draw: the artistic
  // compositor still paints Web below Line. Both passes consume the same
  // fastRailBuffer in the same GPU frame and on the same effective Morph phase.
  const visibleRailWebStage = {
    requests: 0,
    queued: 0,
    reused: 0,
    failures: 0,
    lastReason: 'not-requested',
    lastFrame: -1,
    lastLayer: -1,
  };
  function queueVisibleRailForWeb(frameCtx, table) {
    visibleRailWebStage.requests++;
    const fail = (reason) => {
      visibleRailWebStage.failures++;
      visibleRailWebStage.lastReason = reason;
      return false;
    };
    if (!frameCtx?.morphFrameActive || !frameCtx?.frame?.gpuLayerSceneDeferred)
      return fail('not-resident-blue-morph');
    if (!ready || !device || !fastRailPipeline) return fail('line-gpu-not-ready');
    const arc = table?._gpuMorphArcResource,
      rec = getAuthoritativeArcResource(frameCtx);
    if (
      !arc?.ready ||
      !arc.visibleRailExact ||
      !rec?.ready ||
      rec.staticVisual === true ||
      arc.morphRec !== rec ||
      arc.sourceVisibleRailBuffer !== rec.fastRailBuffer ||
      rec.visibleRailBuffer !== rec.fastRailBuffer
    )
      return fail('line-web-resource-mismatch');
    const rawT =
      frameCtx.spiralEditMorph?.progress ??
      frameCtx.blueMorphProvider?.geometryT ??
      frameCtx.geometryPlan?.progress;
    // Line.draw passes resolveEffectT(rawT) into both retained compute
    // encoders, which each resolve the effective phase internally. Mirror
    // precisely that existing clock; do not introduce a new easing rule.
    const lineT = resolveEffectT(rec, rawT),
      effectiveT = resolveEffectT(rec, lineT);
    const arcT = gpuArcEncoderInputT(table);
    if (!Number.isFinite(lineT) || !Number.isFinite(arcT) || Math.abs(arcT - lineT) > 1e-10)
      return fail('line-web-phase-mismatch');
    const fid = Math.max(0, Number(frameCtx.frameId) || 0);
    if (
      Number(rec.fastRailRootProducerFrameId) === fid &&
      Math.abs((Number(rec.fastRailRootProducerT) || 0) - effectiveT) < 1e-10
    ) {
      visibleRailWebStage.reused++;
      visibleRailWebStage.lastReason = 'same-frame-line-rail-reuse';
      return true;
    }
    try {
      const enc = device.createCommandEncoder({
        label: `Somata Blue Morph visible Line rail before Web L${rec.layerIndex}`,
      });
      if (!encodeEffectCubics(rec, enc, lineT) || !encodeFastRail(rec, enc, lineT))
        return fail('visible-line-rail-encode-failed');
      // The scene scheduler executes prerequisite phases 1..9 before all
      // artistic paint commands (100+), irrespective of UI effect order.
      const queued =
        SomataLayerSceneService?.queue?.(
          frameCtx,
          1,
          enc.finish(),
          `blue-morph-visible-line-rail-L${rec.layerIndex}`,
        ) === true;
      if (!queued) return fail('visible-line-rail-queue-failed');
      rec.currentCubicsRootProducerFrameId = fid;
      rec.currentCubicsRootProducerT = effectiveT;
      rec.fastRailRootProducerFrameId = fid;
      rec.fastRailRootProducerT = effectiveT;
      visibleRailWebStage.queued++;
      visibleRailWebStage.lastFrame = fid;
      visibleRailWebStage.lastLayer = Number(frameCtx.layerIndex) || 0;
      visibleRailWebStage.lastReason = 'line-rail-queued-before-web';
      return true;
    } catch (err) {
      return fail(String(err?.message || err));
    }
  }
  function resolveEffectT(rec, t) {
    let tt = clamp(Number(t) || 0, 0, 1);
    if (rec?.staticEdit !== true) {
      const currentPhaseSerial = Number(runtimeState.morph?.gpuPhasePrepareSerial) || 0;
      if (runtimeState.morph?.gpuPhasePreparing === true && Number(rec?.phaseSerial) !== currentPhaseSerial)
        tt = clamp(Number(runtimeState.morph?.gpuPhaseHandoffT), 0, 1);
    }
    // The exact Bézier carrier and its Web/Fill/Glow consumers must travel
    // along the same zero-order phase as the Blue frame. Never invent a
    // second easing curve or apply this to nonzero -> nonzero transports.
    const from = rec?.sourceLayer?.spiralEnabled === true ? Number(rec.sourceLayer.spiralOrder) || 0 : 0;
    const to = rec?.targetLayer?.spiralEnabled === true ? Number(rec.targetLayer.spiralOrder) || 0 : 0;
    const withCorridor =
      rec?.staticEdit === true
        ? window.__somataCorridorOrderChangeActive?.(rec.sourceLayer?.id) === true
        : state.tunnel?.active === true;
    const phase = window.SomataSpiralZeroTransition?.plan(
      window.SomataSpiralZeroTransition.modeFor(rec?.sourceLayer),
      from,
      to,
      tt,
      withCorridor,
    );
    if (phase?.zeroEndpoint && Math.abs(to - from) > 1e-8)
      return clamp((phase.order - from) / (to - from), 0, 1);
    return tt;
  }
  function resolveProfileModeTransitionT(rec, t) {
    const tt = Math.max(0, Math.min(1, Number(t) || 0));
    // Even spline→spline changes can carry a different final curvature.
    // Follow the UI timeline for Bézier *handles*, not just the mode toggle.
    // The geometry anchors continue to follow the ordinary Morph clock.
    // The same author-controlled timeline must drive both CPU and GPU
    // Bézier handles, including the exact 0/1 endpoint hand-off.
    try {
      return Math.max(0, Math.min(1, Number(profileModeTransitionProgress(tt)) || 0));
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#resolveProfileModeTransitionT', error);
    }
    const rawMode = state?.morph?.profileModeTransition;
    const mode =
      rawMode === 'second' ? 'start' : ['phase', 'start', 'end'].includes(rawMode) ? rawMode : 'phase';
    // The transition schedule must follow the rendered geometry's t;
    // an unrelated animation-clock sample can move spline handles abruptly.
    let u = tt;
    if (mode !== 'phase') {
      const span = Math.max(0, Math.min(1, (Number(state?.morph?.profileModeTransitionPercent) || 0) / 100));
      if (span <= 1e-7) u = mode === 'start' ? 1 : u >= 1 ? 1 : 0;
      else if (mode === 'start') u = Math.max(0, Math.min(1, u / span));
      else u = Math.max(0, Math.min(1, (u - (1 - span)) / span));
    }
    return u * u * (3 - 2 * u);
  }

  function encodeEffectCubics(rec, encoder, t) {
    if (!rec?.ready || !rec.cubicBind || !effectCubicPipeline || !encoder) return false;
    const tt = resolveEffectT(rec, t);
    // The authoritative Phase Circle carrier is already packed on the CPU.
    // This branch uploads cubics directly and dispatches NO effect-cubic
    // compute shader. Its uniform is only needed later by Fast Rail, which
    // owns that upload. Avoid an unused queue.writeBuffer for every
    // Web/Lightning/Fill/Glow/Base request of the current carrier.
    if (rec.carrierMapped === true) {
      const packed = ensureCarrierMappedCurrent(rec, tt);
      if (!packed) {
        stats.carrierMappedFallbacks++;
        return false;
      }
      // queue.writeBuffer is queue-ordered, not encoder-local.  Web/Lightning/Fill/Glow/Base
      // may all ask for the same current rail in one frame; upload it once and let every
      // consumer read the same resident cubic buffer, just as the 7.5 GPU path did.
      if (
        Number.isFinite(rec.carrierUploadedT) &&
        Math.abs(rec.carrierUploadedT - tt) < 1e-12 &&
        rec.carrierUploadedGeneration === generation
      ) {
        stats.carrierMappedUploadSkips++;
      } else {
        device.queue.writeBuffer(rec.cubicBuffer, 0, packed.buffer, packed.byteOffset, packed.byteLength);
        stats.uploads += packed.byteLength;
        stats.carrierMappedUploads += packed.byteLength;
        stats.carrierMappedFrames++;
        rec.carrierUploadedT = tt;
        rec.carrierUploadedGeneration = generation;
      }
      rec.lastCubicT = tt;
      return true;
    }
    // Continuous/Torn still compute the current cubics on the GPU and
    // require this same uniform before the compute pass.
    const raw = rec.cubicUniformStaging || (rec.cubicUniformStaging = new ArrayBuffer(32)),
      u32 = rec.cubicUniformU32 || (rec.cubicUniformU32 = new Uint32Array(raw)),
      f32 = rec.cubicUniformF32 || (rec.cubicUniformF32 = new Float32Array(raw));
    u32[0] = rec.cubicCount >>> 0;
    u32[1] = (rec.germLinkCount || 0) >>> 0;
    f32[4] = tt;
    f32[5] = resolveProfileModeTransitionT(rec, tt);
    f32[6] = rec.sourceSpline === true ? 1 : 0;
    f32[7] = rec.targetSpline === true ? 1 : 0;
    device.queue.writeBuffer(rec.cubicUniformBuffer, 0, raw);
    let pass = encoder.beginComputePass({ label: `Somata Spiral shared effect cubics L${rec.layerIndex}` });
    pass.setPipeline(effectCubicPipeline);
    pass.setBindGroup(0, rec.cubicBind);
    pass.dispatchWorkgroups(Math.ceil(rec.cubicCount / 128));
    pass.end();
    if (rec.closureBind && closurePipeline && rec.pathCount > 0) {
      pass = encoder.beginComputePass({ label: `Somata 7.5 Spiral periodic closure L${rec.layerIndex}` });
      pass.setPipeline(closurePipeline);
      pass.setBindGroup(0, rec.closureBind);
      pass.dispatchWorkgroups(Math.ceil(rec.pathCount / 64));
      pass.end();
    }
    if (
      rec.extraInterpolationActive === true &&
      rec.tangentRepairBind &&
      tangentRepairPipeline &&
      rec.cubicCount > 1
    ) {
      pass = encoder.beginComputePass({
        label: `Somata 7.5 Spiral topology tangent repair L${rec.layerIndex}`,
      });
      pass.setPipeline(tangentRepairPipeline);
      pass.setBindGroup(0, rec.tangentRepairBind);
      pass.dispatchWorkgroups(Math.ceil(Math.max(0, rec.cubicCount - 1) / 128));
      pass.end();
      stats.tangentRepairDispatches++;
    }
    if (rec.germAttachBind && rec.germSnapshotBuffer && germAttachPipeline && rec.germLinkCount) {
      // Snapshot AFTER profile, closure and tangent repair, BEFORE any germ
      // writes. All light/glint/web/lightning consumers see only the final
      // canonical cubic buffer after this attachment compute pass.
      encoder.copyBufferToBuffer(
        rec.cubicBuffer,
        0,
        rec.germSnapshotBuffer,
        0,
        Math.max(32, rec.cubicCount * 32),
      );
      pass = encoder.beginComputePass({
        label: `Somata spiral neighboring-rail attachment L${rec.layerIndex}`,
      });
      pass.setPipeline(germAttachPipeline);
      pass.setBindGroup(0, rec.germAttachBind);
      pass.dispatchWorkgroups(Math.ceil(rec.germLinkCount / 64));
      pass.end();
      // Attachment translates a child rail after the first closure pass.
      // Translation does not commute with a non-unit periodic rotation /
      // scale: repair the period again on the final visible GPU cubics.
      if (rec.spiralTransport === 'coordinated' && rec.closureBind && closurePipeline && rec.pathCount > 0) {
        pass = encoder.beginComputePass({
          label: `Somata coordinated post-attachment period seam L${rec.layerIndex}`,
        });
        pass.setPipeline(closurePipeline);
        pass.setBindGroup(0, rec.closureBind);
        pass.dispatchWorkgroups(Math.ceil(rec.pathCount / 64));
        pass.end();
      }
    }
    rec.lastCubicT = tt;
    stats.cubicComputeDispatches++;
    return true;
  }
  function encodeFastRail(rec, encoder, t) {
    if (!rec?.ready || !encoder || !fastRailPipeline || !rec.fastRailBind) return false;
    if (rec.staticVisual === true) return true;
    const tt = resolveEffectT(rec, t),
      raw = rec.cubicUniformStaging || (rec.cubicUniformStaging = new ArrayBuffer(32)),
      u32 = rec.cubicUniformU32 || (rec.cubicUniformU32 = new Uint32Array(raw)),
      f32 = rec.cubicUniformF32 || (rec.cubicUniformF32 = new Float32Array(raw));
    u32[0] = rec.cubicCount >>> 0;
    u32[1] = (rec.germLinkCount || 0) >>> 0;
    f32[4] = tt;
    f32[5] = resolveProfileModeTransitionT(rec, tt);
    f32[6] = rec.sourceSpline === true ? 1 : 0;
    f32[7] = rec.targetSpline === true ? 1 : 0;
    device.queue.writeBuffer(rec.cubicUniformBuffer, 0, raw);
    const pass = encoder.beginComputePass({ label: `Somata 7.5 Spiral Fast Visual Rail L${rec.layerIndex}` });
    pass.setPipeline(fastRailPipeline);
    pass.setBindGroup(0, rec.fastRailBind);
    pass.dispatchWorkgroups(Math.ceil((rec.cubicCount * (SUBDIV / FAST_RAIL_SEGMENTS_PER_THREAD)) / 128));
    pass.end();
    stats.fastRailDispatches++;
    return true;
  }
  function canReuseOrderedFastRail(rec, frameCtx, target, currentT) {
    const fid = Math.max(0, Number(frameCtx?.frameId) || 0),
      tt = rec?.staticVisual === true ? 0 : resolveEffectT(rec, currentT);
    return Boolean(
      rec?.ready &&
      (target?.deferred === true || target?.deferredFrame === true) &&
      Number(rec.fastRailRootProducerFrameId) === fid &&
      Math.abs((Number(rec.fastRailRootProducerT) || 0) - tt) < 1e-12,
    );
  }
  function canReuseOrderedCurrentCubics(rec, frameCtx, target, currentT) {
    const fid = Math.max(0, Number(frameCtx?.frameId) || 0),
      tt = rec?.staticVisual === true ? 0 : resolveEffectT(rec, currentT);
    return Boolean(
      rec?.ready &&
      (target?.deferred === true || target?.deferredFrame === true) &&
      Number(rec.currentCubicsRootProducerFrameId) === fid &&
      Math.abs((Number(rec.currentCubicsRootProducerT) || 0) - tt) < 1e-12,
    );
  }
  function buildCurrentCubicsPrerequisite(rec, frameId, t) {
    if (!rec?.ready || !device) return null;
    const tt = resolveEffectT(rec, t),
      fid = Math.max(0, Number(frameId) || 0);
    if (
      Number(rec.currentCubicsCommittedFrameId) === fid &&
      Math.abs((Number(rec.currentCubicsCommittedT) || 0) - tt) < 1e-12
    )
      return { ready: true, committed: true, commandBuffer: null, onSubmitted: null };
    try {
      const enc = device.createCommandEncoder({
        label: `Somata Spiral current-cubic prerequisite L${rec.layerIndex}`,
      });
      if (!encodeEffectCubics(rec, enc, tt)) return null;
      return {
        ready: true,
        committed: false,
        commandBuffer: enc.finish(),
        onSubmitted: () => {
          rec.currentCubicsCommittedFrameId = fid;
          rec.currentCubicsCommittedT = tt;
        },
      };
    } catch (err) {
      lastError = String(err?.message || err);
      return null;
    }
  }
  function getResource(i) {
    const rec = resources.get(Number(i) || 0) || null;
    if (rec && !rec.encodeCurrentCubics) {
      rec.resolveMorphT = (t) => resolveEffectT(rec, t);
      rec.encodeCurrentCubics = (encoder, t) => encodeEffectCubics(rec, encoder, t);
      rec.buildCurrentCubicsPrerequisite = (frameId, t) => buildCurrentCubicsPrerequisite(rec, frameId, t);
    }
    return rec;
  }
  function reason(frameCtx, mode = 'base') {
    if (!frameCtx) return 'no-frame';
    const hiddenGraffitiGlow =
      mode === 'glow' &&
      frameCtx.lineProfileStrokeOnly === true &&
      frameCtx.lineProfileApplication === 'graffiti';
    if (state?.fourierMode === true) return 'fourier';
    if (state?.showRoundingGuides) return 'rounding-guides';
    if (frameCtx.lineProfileStrokeOnly && !hiddenGraffitiGlow) return 'profile-replaces-base';
    if (mode === 'base' && !frameCtx.lineDisplayEnabled) return 'line-hidden';
    if (frameCtx.spiralEditMorph) {
      if (!ready) return 'renderer-warming';
      const rec = getStaticEditResource(frameCtx);
      return rec?.ready ? '' : 'edit-resource-not-ready';
    }
    if (frameCtx.morphFrameActive) {
      if (frameCtx.geometryProvider !== frameCtx.blueMorphProvider) return 'another-provider';
      if (
        frameCtx.geometryPlan?.kind !== 'blue-circle-slide' &&
        frameCtx.geometryPlan?.kind !== 'blue-prepared'
      )
        return 'kind-' + String(frameCtx.geometryPlan?.kind || 'unknown');
      const rec = getResource(frameCtx.layerIndex);
      if (!rec?.ready) return 'resource-not-ready';
      return '';
    }

    if (typeof isSpiralLayer !== 'function' || !isSpiralLayer(frameCtx.layer)) return 'not-static-spiral';
    if (frameCtx.geometryPlan?.dynamic === true) return 'static-dynamic-geometry';
    if (!ready) {
      warmup();
      return 'renderer-warming';
    }
    try {
      warmupGpuMorphArcResource?.();
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#reason', error);
    }
    const rec = getStaticVisualResource(frameCtx);
    if (!rec?.ready) return 'static-resource-not-ready';
    return '';
  }
  function isEligible(frameCtx, mode = 'base') {
    const r = reason(frameCtx, mode);
    decision.eligible = !r;
    decision.reason = r || 'gpu-spiral-bezier';
    decision.layerIndex = Number(frameCtx?.layerIndex) || 0;
    decision.frameId = Number(frameCtx?.frameId) || 0;
    return !r;
  }
  function ensureCopyCapacity(rec, n) {
    const need = Math.max(1, n | 0);
    if (rec.copyBuffer && rec.copyCapacity >= need) return;
    const cap = Math.max(8, 1 << Math.ceil(Math.log2(need)));
    try {
      rec.copyBuffer?.destroy?.();
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#ensureCopyCapacity', error);
    }
    rec.copyCapacity = cap;
    rec.copyData = new Float32Array(cap * 12);
    rec.copyBuffer = device.createBuffer({
      label: `Somata Spiral Bézier Morph copies L${rec.layerIndex}`,
      size: rec.copyData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    rec.copyBind = device.createBindGroup({
      layout: renderCopyLayout,
      entries: [{ binding: 0, resource: { buffer: rec.copyBuffer } }],
    });
    rec.copyPackedFrameId = -1;
  }
  function rgba(style) {
    try {
      return GPUColorCache.rgba(style || '#fff');
    } catch (_) {
      return [1, 1, 1, 1];
    }
  }
  function spiralCenterShadeSpec(frameCtx) {
    const hidden = Math.max(0, Math.min(32, Math.round(Number(state?.tunnel?.centerHiddenCopies) || 0)));
    if (state?.tunnel?.active !== true || hidden === 0)
      return { enabled: false, mode: 'disabled', hidden, startRadius: 0, endRadius: 0 };
    // Polygon Corridor hides complete small copies. A Spiral has a connected
    // rail spanning the origin, so hiding entire copies makes its center pop.
    // Add a *smooth*, per-fragment inner reveal, in local Spiral coordinates.
    // Preserve the copy-alpha fade too, and never clip a segment or change
    // the retained Bézier rail. Shader applies one smoothstep on both Glow/Base.
    const baseRadius = Math.max(1, Number(getEffectiveLayerRadius(frameCtx?.layer, 220)) || 220);
    const range = getTunnelCenterRevealRange(state.tunnel);
    const scale = Math.max(
      0.001,
      Math.min(0.75, Number(range?.endScale) || Number(state.tunnel.minScale) || 0.055),
    );
    // 9.2.9: Spiral needs a wider center reveal than the polygon's copy
    // fade. Scale only the radial boundaries: GPU Base, Glow and Fill
    // share this spec, while copy alpha and transition smoothness remain intact.
    const width = baseRadius * scale * 2;
    return {
      enabled: true,
      mode: 'spiral-soft-radial-plus-copy-alpha',
      hidden,
      startRadius: Math.max(0, width * 0.18),
      endRadius: Math.max(0.001, width * 1.55),
    };
  }
  function packCopies(frameCtx, rec) {
    const fid = Number(frameCtx?.frameId) || 0;
    if (rec.copyBuffer && rec.copyPackedFrameId === fid) return rec.copyPackedCount;
    const corridor = state.tunnel?.active === true,
      copies = corridor ? frameCtx.visibleInstances?.copies : [{ scale: 1 }],
      alphas = corridor ? frameCtx.visibleInstances?.alphas : [1],
      src = Array.isArray(copies) && copies.length ? copies : [{ scale: 1 }],
      centerShade = spiralCenterShadeSpec(frameCtx);
    rec.lastCenterShade = centerShade;
    ensureCopyCapacity(rec, src.length);
    let k = 0,
      firstStyle = null,
      multiColor = false;
    const shared =
      corridor && typeof SomataCorridorCopyFrame !== 'undefined' ? SomataCorridorCopyFrame : null;
    const sharedBatch = shared?.peek(frameCtx) || null;
    // All passes share the Corridor copy scale and getMotionTunnelLagRadians.
    // There must be no renderer-private endpoint correction: that previously
    // vanished on the last morph frame and made the spiral jump into place.
    for (let i = 0; i < src.length; i++) {
      const cp = src[i] || {};
      let ca = clamp(Number(alphas?.[i] ?? 1), 0, 1);
      if (ca <= 0.0001) continue;
      const sc = corridor ? Math.max(0.000001, Math.abs(Number(cp.scale) || 0)) : 1;
      // Share the authoritative Corridor colour/angle values with Glow/Base/Fill.
      // Missing stroke base keeps the original direct rule (no cache substitution).
      const ang =
          corridor && typeof getMotionTunnelLagRadians === 'function'
            ? sharedBatch &&
              sharedBatch.copies[i] === cp &&
              sharedBatch.angleVersion[i] === sharedBatch.serial
              ? sharedBatch.angles[i]
              : getMotionTunnelLagRadians(cp, frameCtx.layer)
            : 0,
        cs = Math.cos(ang),
        sn = Math.sin(ang);
      const style =
          corridor && typeof getTunnelCopyColor === 'function'
            ? sharedBatch &&
              frameCtx.tunnelBaseStrokeColor &&
              sharedBatch.copies[i] === cp &&
              sharedBatch.strokeVersion[i] === sharedBatch.serial
              ? sharedBatch.stroke[i]
              : getTunnelCopyColor(
                  frameCtx.tunnelBaseStrokeColor,
                  cp,
                  frameCtx.tunnelPaletteProfile,
                  frameCtx.layer,
                )
            : frameCtx.lightningStroke || frameCtx.layer?.strokeColor || '#fff',
        styleKey = String(style || ''),
        c = rgba(style),
        o = k * 12;
      if (firstStyle === null) firstStyle = styleKey;
      else if (styleKey !== firstStyle) multiColor = true;
      rec.copyData[o] = sc * cs;
      rec.copyData[o + 1] = -sc * sn;
      rec.copyData[o + 2] = ca;
      rec.copyData[o + 3] = sc;
      rec.copyData[o + 4] = sc * sn;
      rec.copyData[o + 5] = sc * cs;
      rec.copyData[o + 6] = c[0];
      rec.copyData[o + 7] = c[1];
      rec.copyData[o + 8] = c[2];
      rec.copyData[o + 9] = c[3];
      k++;
    }
    if (k) {
      device.queue.writeBuffer(rec.copyBuffer, 0, rec.copyData.buffer, 0, k * 48);
      stats.uploads += k * 48;
    } else stats.uploadSkips++;
    rec.copyPackedFrameId = fid;
    rec.copyPackedCount = k;
    rec.copyPackedMultiColor = multiColor;
    return k;
  }
  function prepareUniform(frameCtx, rec, copyCount, ctx, mode, opts) {
    const tr = ctx.getTransform(),
      a = Number(tr.a) || 1,
      b = Number(tr.b) || 0,
      c = Number(tr.c) || 0,
      d = Number(tr.d) || 1,
      e = Number(tr.e) || 0,
      f = Number(tr.f) || 0;
    const matrixScale = Math.sqrt(Math.max(1e-12, Math.abs(a * d - b * c))),
      combined = Math.max(0.001, Math.abs(Number(frameCtx.combinedScale) || 1)),
      outerScale = matrixScale / combined;
    const hw = Math.max(0.18, Math.max(0.001, Number(frameCtx.strokeWidth) || 1.5) * outerScale * 0.5),
      gr = mode === 'glow' ? Math.max(0.5, Number(opts?.radiusPx) || 0) : 0,
      core =
        mode === 'base'
          ? clamp(Number(opts?.alphaScale ?? 1), 0, 1) * clamp(Number(frameCtx.baseAlpha) || 0, 0, 1)
          : 0,
      glow =
        mode === 'glow'
          ? clamp(Number(opts?.alphaScale ?? 1), 0, 1) * clamp(Number(frameCtx.baseAlpha) || 0, 0, 1)
          : 0;
    let t =
      rec?.staticVisual === true
        ? 0
        : clamp(
            Number(
              frameCtx.spiralEditMorph?.progress ??
                frameCtx.blueMorphProvider?.geometryT ??
                frameCtx.geometryPlan?.progress,
            ) || 0,
            0,
            1,
          );
    t = rec?.staticVisual === true ? 0 : resolveEffectT(rec, t);
    const centerShade =
      rec?.lastCenterShade?.enabled === true ? rec.lastCenterShade : spiralCenterShadeSpec(frameCtx);
    rec.lastCenterShade = centerShade;
    uf.fill(0);
    uf[0] = width;
    uf[1] = height;
    uu[2] = rec.cubicCount >>> 0;
    uu[3] = copyCount >>> 0;
    uf[4] = a;
    uf[5] = c;
    uf[6] = e;
    uf[8] = b;
    uf[9] = d;
    uf[10] = f;
    uf[12] = hw;
    uf[13] = gr;
    uf[14] = core;
    uf[15] = glow;
    uf[16] = t;
    uf[17] = centerShade.enabled ? centerShade.startRadius : 0;
    uf[18] = centerShade.enabled ? centerShade.endRadius : 0;
    uf[19] = centerShade.enabled ? 1 : 0;
    const buf = mode === 'glow' ? rec.uniformGlow : rec.uniformBase;
    device.queue.writeBuffer(buf, 0, uniformBytes);
    stats.uploads += 80;
    return mode === 'glow' ? rec.uniformGlowBind : rec.uniformBaseBind;
  }
  function resolveTarget(frameCtx, opts = {}) {
    if (
      opts.deferFrameScene === true &&
      typeof WebGPUStrokeRenderer !== 'undefined' &&
      WebGPUStrokeRenderer.getExternalFrameSceneTarget
    ) {
      const t = WebGPUStrokeRenderer.getExternalFrameSceneTarget(frameCtx.frameId);
      if (t?.view) {
        width = Math.max(1, Number(t.width) || mainCanvas.width || 1);
        height = Math.max(1, Number(t.height) || mainCanvas.height || 1);
        return { view: t.view, deferredFrame: true, deferred: false, loadOp: 'load' };
      }
    }
    if (opts.deferLayerScene === true && typeof WebGPUStrokeRenderer !== 'undefined') {
      const resident = WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId);
      if (resident?.texture) {
        width = Math.max(1, mainCanvas.width || 1);
        height = Math.max(1, mainCanvas.height || 1);
        return {
          view: resident.texture.createView(),
          texture: resident.texture,
          deferred: true,
          deferredFrame: false,
          resident: true,
          loadOp: 'load',
        };
      }
      if (WebGPUStrokeRenderer.getExternalLayerSceneTarget) {
        const t = WebGPUStrokeRenderer.getExternalLayerSceneTarget(frameCtx.frameId);
        if (t?.view) {
          width = Math.max(1, Number(t.width) || mainCanvas.width || 1);
          height = Math.max(1, Number(t.height) || mainCanvas.height || 1);
          return {
            view: t.view,
            texture: t.texture,
            deferred: true,
            deferredFrame: false,
            resident: false,
            loadOp: 'clear',
          };
        }
      }
    }

    stats.gpuSceneUnavailable = (stats.gpuSceneUnavailable || 0) + 1;
    return null;
  }
  function finishEncoded(frameCtx, targetCtx, enc, target, opts = {}, rec = null, currentT = NaN) {
    const cmd = enc.finish();
    if (target.deferredFrame) {
      if (WebGPUStrokeRenderer.deferExternalFrameScene?.(cmd, frameCtx.frameId, 'spiral-bezier-morph')) {
        frameCtx.frame.gpuMainSceneEmpty = frameCtx.frame.gpuMainCanvasHasContent !== true;
        frameCtx._spiralBezierFrameSceneDirect = true;
        stats.directFrameSceneFrames++;
        if (rec?.ready && Number.isFinite(Number(currentT))) {
          rec.currentCubicsRootProducerFrameId = Math.max(0, Number(frameCtx.frameId) || 0);
          rec.currentCubicsRootProducerT = rec.staticVisual === true ? 0 : resolveEffectT(rec, currentT);
          rec.fastRailRootProducerFrameId = Math.max(0, Number(frameCtx.frameId) || 0);
          rec.fastRailRootProducerT = rec.staticVisual === true ? 0 : resolveEffectT(rec, currentT);
        }
        return true;
      }
      stats.fallbacks++;
      return false;
    }
    if (target.deferred) {
      let accepted = false;
      if (target.resident === true) {
        const phase = Number.isFinite(Number(opts.layerScenePhase))
          ? Number(opts.layerScenePhase)
          : typeof somataEffectPhase === 'function'
            ? somataEffectPhase('geometry', opts.mode === 'glow' ? 10 : 20)
            : opts.mode === 'glow'
              ? 3
              : 5;
        accepted =
          queueLayerSceneEffectCommand(
            frameCtx,
            phase,
            cmd,
            opts.layerSceneLabel || `spiral-bezier-${opts.mode || 'effect'}`,
          ) === true;
      } else
        accepted =
          WebGPUStrokeRenderer.deferExternalLayerScene?.(cmd, frameCtx.frameId, 'spiral-bezier-morph') ===
          true;
      if (accepted) {
        frameCtx.frame.gpuLayerSceneDeferred = true;
        frameCtx.frame.gpuMainSceneEmpty = frameCtx.frame.gpuMainCanvasHasContent !== true;
        frameCtx._spiralBezierLayerSceneDeferred = true;
        stats.deferredLayerSceneFrames++;

        if (target.resident !== true && rec?.ready && Number.isFinite(Number(currentT))) {
          rec.currentCubicsRootProducerFrameId = Math.max(0, Number(frameCtx.frameId) || 0);
          rec.currentCubicsRootProducerT = rec.staticVisual === true ? 0 : resolveEffectT(rec, currentT);
          rec.fastRailRootProducerFrameId = Math.max(0, Number(frameCtx.frameId) || 0);
          rec.fastRailRootProducerT = rec.staticVisual === true ? 0 : resolveEffectT(rec, currentT);
        }
        return true;
      }
      stats.fallbacks++;
      return false;
    }
    stats.gpuSceneUnavailable = (stats.gpuSceneUnavailable || 0) + 1;
    return false;
  }
  function draw(frameCtx, targetCtx, mode, opts = {}) {
    if (!isEligible(frameCtx, mode)) {
      stats.fallbacks++;
      return false;
    }
    const rec = getVisualResource(frameCtx);
    const target = resolveTarget(frameCtx, opts);
    if (!rec?.ready || !target) {
      stats.fallbacks++;
      return false;
    }

    try {
      targetCtx.save();
      applyLayerFrameEffectTransform(targetCtx, frameCtx);
      const copies = packCopies(frameCtx, rec);
      if (!copies) {
        targetCtx.restore();
        return true;
      }
      const ub = prepareUniform(frameCtx, rec, copies, targetCtx, mode, opts);
      targetCtx.restore();
      const enc = device.createCommandEncoder({
        label: `Somata 9.2 Spiral Fast Rail ${rec.staticVisual === true ? 'Static' : 'Morph'} ${mode}`,
      });
      const currentT =
        rec.staticVisual === true
          ? 0
          : resolveEffectT(
              rec,
              frameCtx.spiralEditMorph?.progress ??
                frameCtx.blueMorphProvider?.geometryT ??
                frameCtx.geometryPlan?.progress,
            );

      if (rec.staticVisual !== true) {
        if (canReuseOrderedCurrentCubics(rec, frameCtx, target, currentT)) stats.cubicComputeReuses++;
        else if (!encodeEffectCubics(rec, enc, currentT)) {
          stats.fallbacks++;
          return false;
        }

        if (canReuseOrderedFastRail(rec, frameCtx, target, currentT)) stats.fastRailReuses++;
        else if (!encodeFastRail(rec, enc, currentT)) {
          stats.fallbacks++;
          return false;
        }
      }

      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: target.view,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: target.loadOp || 'clear',
            storeOp: 'store',
          },
        ],
      });
      const segmented = false,
        useUniform = mode === 'base' && !segmented && uniformPipelineMax;
      const blendPipe = useUniform
        ? target.deferredFrame || rec.copyPackedMultiColor
          ? uniformPipelineOver
          : uniformPipelineMax
        : segmented
          ? pipelineOver
          : target.deferredFrame || (mode === 'base' && rec.copyPackedMultiColor)
            ? pipelineOver
            : pipelineMax;
      pass.setPipeline(blendPipe);
      pass.setBindGroup(0, ub);
      pass.setBindGroup(1, rec.bind);
      pass.setBindGroup(2, rec.copyBind);
      pass.setVertexBuffer(0, cornerBuffer);
      pass.draw(4, rec.cubicCount * SUBDIV * copies);
      pass.end();

      const submitted = finishEncoded(frameCtx, targetCtx, enc, target, opts, rec, currentT);

      if (!submitted) return false;
      stats.frames++;
      if (mode === 'glow') stats.glowFrames++;
      else stats.baseFrames++;
      if (state.tunnel?.active === true) stats.corridorFrames++;
      return true;
    } catch (err) {
      try {
        targetCtx.restore();
      } catch (error) {
        noteSuppressedError('gpu/spiral-bezier-morph-renderer#draw', error);
      }
      lastError = String(err?.message || err);
      stats.errors++;
      stats.fallbacks++;
      return false;
    }
  }
  function render(frameCtx, targetCtx, opts = {}) {
    return draw(frameCtx, targetCtx, opts.mode === 'glow' ? 'glow' : 'base', opts);
  }
  function renderGlowAndBase(frameCtx, targetCtx, opts = {}) {
    if (!isEligible(frameCtx, 'glow') || !isEligible(frameCtx, 'base')) {
      stats.fallbacks++;
      return false;
    }
    const rec = getVisualResource(frameCtx),
      target = resolveTarget(frameCtx, opts);
    if (!target) {
      stats.fallbacks++;
      return false;
    }

    try {
      targetCtx.save();
      applyLayerFrameEffectTransform(targetCtx, frameCtx);
      const copies = packCopies(frameCtx, rec);
      if (!copies) {
        targetCtx.restore();
        return true;
      }
      const ug = prepareUniform(frameCtx, rec, copies, targetCtx, 'glow', {
          radiusPx: opts.radiusPx,
          alphaScale: opts.glowAlphaScale,
        }),
        ub = prepareUniform(frameCtx, rec, copies, targetCtx, 'base', { alphaScale: opts.baseAlphaScale });
      targetCtx.restore();
      const enc = device.createCommandEncoder({
        label: `Somata 9.2 Spiral Fast Rail ${rec.staticVisual === true ? 'Static' : 'Morph'} fused Glow+Base`,
      });
      const currentT =
        rec.staticVisual === true
          ? 0
          : resolveEffectT(
              rec,
              frameCtx.spiralEditMorph?.progress ??
                frameCtx.blueMorphProvider?.geometryT ??
                frameCtx.geometryPlan?.progress,
            );

      if (rec.staticVisual !== true) {
        if (canReuseOrderedCurrentCubics(rec, frameCtx, target, currentT)) stats.cubicComputeReuses++;
        else if (!encodeEffectCubics(rec, enc, currentT)) {
          stats.fallbacks++;
          return false;
        }

        if (canReuseOrderedFastRail(rec, frameCtx, target, currentT)) stats.fastRailReuses++;
        else if (!encodeFastRail(rec, enc, currentT)) {
          stats.fallbacks++;
          return false;
        }
      }

      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: target.view,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: target.loadOp || 'clear',
            storeOp: 'store',
          },
        ],
      });
      const segmented = false;
      pass.setPipeline(segmented ? pipelineOver : target.deferredFrame ? pipelineOver : pipelineMax);
      pass.setBindGroup(1, rec.bind);
      pass.setBindGroup(2, rec.copyBind);
      pass.setVertexBuffer(0, cornerBuffer);
      pass.setBindGroup(0, ug);
      pass.draw(4, rec.cubicCount * SUBDIV * copies);
      const basePipe =
        !segmented && uniformPipelineMax
          ? target.deferredFrame || rec.copyPackedMultiColor
            ? uniformPipelineOver
            : uniformPipelineMax
          : segmented
            ? pipelineOver
            : target.deferredFrame || rec.copyPackedMultiColor
              ? pipelineOver
              : pipelineMax;
      pass.setPipeline(basePipe);
      pass.setBindGroup(0, ub);
      pass.draw(4, rec.cubicCount * SUBDIV * copies);
      pass.end();

      const submitted = finishEncoded(frameCtx, targetCtx, enc, target, opts, rec, currentT);

      if (!submitted) return false;
      stats.frames++;
      stats.glowFrames++;
      stats.baseFrames++;
      stats.fusedFrames++;
      if (state.tunnel?.active === true) stats.corridorFrames++;
      return true;
    } catch (err) {
      try {
        targetCtx.restore();
      } catch (error) {
        noteSuppressedError('gpu/spiral-bezier-morph-renderer#renderGlowAndBase', error);
      }
      lastError = String(err?.message || err);
      stats.errors++;
      stats.fallbacks++;
      return false;
    }
  }
  function auxiliaryPaths(layerIndex, t, frameCtx = null) {
    // Static edit Spiral has a dedicated retained GPU pair.  Fill and visual
    // Line MUST sample the same source, not the stale/global Blue morph pair.
    // Other consumers keep the original two-argument Blue Morph contract.
    const rec = frameCtx?.spiralEditMorph ? getStaticEditResource(frameCtx) : getResource(layerIndex);
    if (!rec?.ready || !rec?.pathCount) return null;
    const tt = resolveEffectT(rec, t);
    if (Number.isFinite(rec.auxT) && Math.abs(rec.auxT - tt) < 1e-12) {
      stats.auxHits++;
      return rec.auxPairs;
    }
    if (rec.carrierMapped === true) {
      if (!ensureCarrierMappedCurrent(rec, tt)) return null;
      const subdiv = 6,
        cubicAt = (p0, c1, c2, p3, q) => {
          const z = 1 - q,
            z2 = z * z,
            q2 = q * q;
          return {
            x: z2 * z * p0.x + 3 * z2 * q * c1.x + 3 * z * q2 * c2.x + q2 * q * p3.x,
            y: z2 * z * p0.y + 3 * z2 * q * c1.y + 3 * z * q2 * c2.y + q2 * q * p3.y,
          };
        };
      for (let pi = 0; pi < rec.pathCount; pi++) {
        const pair = rec.auxPairs[pi],
          cubics = rec.carrierCurrentByPath?.[pi] || [],
          need = cubics.length * subdiv + 1;
        while (pair.points.length < need) pair.points.push({ x: 0, y: 0, widthScale: 1 });
        pair.points.length = need;
        let w = 0;
        for (let j = 0; j < cubics.length; j++) {
          const q = cubics[j],
            q0 = j === 0 ? 0 : 1,
            l0 = Math.log(Math.max(0.02, Number(q.widthScale0) || 1)),
            l1 = Math.log(Math.max(0.02, Number(q.widthScale1) || 1));
          for (let sj = q0; sj <= subdiv; sj++) {
            const u = sj / subdiv,
              p = cubicAt(q.p0, q.c1, q.c2, q.p3, u),
              dst = pair.points[w++];
            dst.x = p.x;
            dst.y = p.y;
            dst.widthScale = Math.exp(l0 + (l1 - l0) * u);
          }
        }
        pair.points.length = w;
        pair.closed = false;
        // Keep the auxiliary (Fill/Web/Glow consumers) path visibility in
        // lockstep with the fast GPU rail. On an N morph a new branch
        // initially shares the same shape as its source; drawing it with
        // alpha 1 here creates the bright doubled coils seen in live scenes.
        // The GPU rail uses smoothstep for presence, not a linear fade.
        pair.alpha = spiralBranchPresence(pair.sourcePresent, pair.targetPresent, tt);
        const sn = Math.max(1, Number(pair.sourceBranchCount) || rec.pathCount),
          dn = Math.max(1, Number(pair.targetBranchCount) || rec.pathCount),
          sa = Number.isFinite(pair.sourceBranchIndex) ? (((pair.sourceBranchIndex / sn) % 1) + 1) % 1 : NaN,
          da = Number.isFinite(pair.targetBranchIndex) ? (((pair.targetBranchIndex / dn) % 1) + 1) % 1 : NaN;
        if (Number.isFinite(sa) && Number.isFinite(da)) {
          let d = da - sa;
          d = ((((d + 0.5) % 1) + 1) % 1) - 0.5;
          pair.branchPhase = (((sa + d * tt) % 1) + 1) % 1;
        } else
          pair.branchPhase = Number.isFinite(sa)
            ? sa
            : Number.isFinite(da)
              ? da
              : pi / Math.max(1, rec.pathCount);
      }
      rec.auxT = tt;
      stats.auxFrames++;
      stats.auxPoints += rec.auxPairs.reduce((n, p) => n + p.points.length, 0);
      return rec.auxPairs;
    }
    const subdiv = 6,
      data = rec.data,
      ranges = rec.cpuPathSegmentRanges,
      profileT = resolveProfileModeTransitionT(rec, tt),
      mixedMode = rec.sourceSpline !== rec.targetSpline;
    const polarXY = (r, a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) }),
      mixPolar = (sr, sa, dr, da, cart = false, localT = tt) => {
        if (cart) {
          const s = polarXY(sr, sa),
            d = polarXY(dr, da);
          return { x: s.x + (d.x - s.x) * localT, y: s.y + (d.y - s.y) * localT };
        }
        const r = sr + (dr - sr) * localT,
          a = sa + (da - sa) * localT;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      };
    const rot = (v, a) => {
      const c = Math.cos(a),
        q = Math.sin(a);
      return { x: c * v.x - q * v.y, y: q * v.x + c * v.y };
    };
    const transported = (er, ea, cr, ca, currentAngle, cart) => {
      const e = polarXY(er, ea),
        c = polarXY(cr, ca),
        v = { x: c.x - e.x, y: c.y - e.y };
      return cart ? v : rot(v, currentAngle - ea);
    };
    const mixHandle = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    const cubicAt = (p0, c1, c2, p3, q) => {
      const z = 1 - q,
        z2 = z * z,
        q2 = q * q;
      return {
        x: z2 * z * p0.x + 3 * z2 * q * c1.x + 3 * z * q2 * c2.x + q2 * q * p3.x,
        y: z2 * z * p0.y + 3 * z2 * q * c1.y + 3 * z * q2 * c2.y + q2 * q * p3.y,
      };
    };
    // Width endpoints are immutable within a prepared phase. Cache their
    // logarithms for all subpaths; each new frame only interpolates logs.
    let widthLogs = rec.auxWidthLogs;
    if (!widthLogs || widthLogs.length !== rec.cubicCount * 4) {
      widthLogs = new Float64Array(rec.cubicCount * 4);
      for (let ci = 0; ci < rec.cubicCount; ci++) {
        const off = ci * FLOATS_PER_CUBIC,
          wo = ci * 4;
        widthLogs[wo] = Math.log(Math.max(0.02, data[off + 16]));
        widthLogs[wo + 1] = Math.log(Math.max(0.02, data[off + 17]));
        widthLogs[wo + 2] = Math.log(Math.max(0.02, data[off + 18]));
        widthLogs[wo + 3] = Math.log(Math.max(0.02, data[off + 19]));
      }
      rec.auxWidthLogs = widthLogs;
    }
    for (let pi = 0; pi < rec.pathCount; pi++) {
      const pair = rec.auxPairs[pi],
        ro = pi * 4,
        first = ranges[ro] >>> 0,
        count = ranges[ro + 1] >>> 0,
        need = count * subdiv + 1;
      while (pair.points.length < need) pair.points.push({ x: 0, y: 0, widthScale: 1 });
      pair.points.length = need;
      let w = 0;
      for (let j = 0; j < count; j++) {
        const ci = first + j,
          o = ci * FLOATS_PER_CUBIC,
          cart = data[o + 22] > 0.5,
          coordinated = (Math.round(data[o + 23]) & 4) !== 0;
        const retiring = (Math.round(data[o + 23]) & 32) !== 0;
        const t0 = coordinated ? coordinatedVertexT(tt, ci, retiring) : tt,
          t1 = coordinated ? coordinatedVertexT(tt, ci + 1 / 3, retiring) : tt;
        const t2 = coordinated ? coordinatedVertexT(tt, ci + 2 / 3, retiring) : tt,
          t3 = coordinated ? coordinatedVertexT(tt, ci + 1, retiring) : tt;
        const p0 = mixPolar(data[o], data[o + 1], data[o + 8], data[o + 9], cart, t0),
          p3 = mixPolar(data[o + 6], data[o + 7], data[o + 14], data[o + 15], cart, t3);
        let c1 = mixPolar(data[o + 2], data[o + 3], data[o + 10], data[o + 11], cart, t1),
          c2 = mixPolar(data[o + 4], data[o + 5], data[o + 12], data[o + 13], cart, t2);
        if (mixedMode) {
          const a0 = data[o + 1] + (data[o + 9] - data[o + 1]) * t0,
            a3 = data[o + 7] + (data[o + 15] - data[o + 7]) * t3,
            hs1 = transported(data[o], data[o + 1], data[o + 2], data[o + 3], a0, cart),
            hd1 = transported(data[o + 8], data[o + 9], data[o + 10], data[o + 11], a0, cart),
            hs2 = transported(data[o + 6], data[o + 7], data[o + 4], data[o + 5], a3, cart),
            hd2 = transported(data[o + 14], data[o + 15], data[o + 12], data[o + 13], a3, cart),
            h1 = mixHandle(hs1, hd1, profileT),
            h2 = mixHandle(hs2, hd2, profileT);
          c1 = { x: p0.x + h1.x, y: p0.y + h1.y };
          c2 = { x: p3.x + h2.x, y: p3.y + h2.y };
        }
        const wo = ci * 4;
        const widthT = retiring ? (window.SomataCoordinatedFinish?.widthTime(tt) ?? tt) : tt,
          invT = 1 - widthT;
        const logWs0 = widthLogs[wo] * invT + widthLogs[wo + 2] * widthT;
        const logWs1 = widthLogs[wo + 1] * invT + widthLogs[wo + 3] * widthT;
        const q0 = j === 0 ? 0 : 1;
        for (let sj = q0; sj <= subdiv; sj++) {
          const q = sj / subdiv,
            p = cubicAt(p0, c1, c2, p3, q),
            dst = pair.points[w++];
          dst.x = p.x;
          dst.y = p.y;
          dst.widthScale = Math.exp(logWs0 * (1 - q) + logWs1 * q);
        }
      }
      pair.points.length = w;
      pair.closed = pair.closed === true;
      const base = first * FLOATS_PER_CUBIC;
      pair.alpha = data[base + 20] * (1 - tt) + data[base + 21] * tt;
      const sn = Math.max(1, Number(pair.sourceBranchCount) || rec.pathCount),
        dn = Math.max(1, Number(pair.targetBranchCount) || rec.pathCount),
        sa = Number.isFinite(pair.sourceBranchIndex) ? (((pair.sourceBranchIndex / sn) % 1) + 1) % 1 : NaN,
        da = Number.isFinite(pair.targetBranchIndex) ? (((pair.targetBranchIndex / dn) % 1) + 1) % 1 : NaN;
      if (Number.isFinite(sa) && Number.isFinite(da)) {
        let d = da - sa;
        d = ((((d + 0.5) % 1) + 1) % 1) - 0.5;
        pair.branchPhase = (((sa + d * tt) % 1) + 1) % 1;
      } else
        pair.branchPhase = Number.isFinite(sa)
          ? sa
          : Number.isFinite(da)
            ? da
            : pi / Math.max(1, rec.pathCount);
    }
    rec.auxT = tt;
    stats.auxFrames++;
    stats.auxPoints += rec.auxPairs.reduce((n, p) => n + p.points.length, 0);
    return rec.auxPairs;
  }
  function spiralBranchPresence(sourcePresent, targetPresent, t) {
    const u = clamp(Number(t) || 0, 0, 1),
      q = u * u * (3 - 2 * u);
    return (sourcePresent !== false ? 1 : 0) * (1 - q) + (targetPresent !== false ? 1 : 0) * q;
  }
  function captureTerminalRails(layerIndex = 0) {
    // Prefer the already prepared resource; CPU fallback is only for tests
    // and a temporarily unavailable GPU. No GPU readback is necessary.
    const idx = Math.max(0, Number(layerIndex) || 0),
      live = resources.get(idx);
    const rt = runtimeState.morph;
    // Use the resource that *actually painted* the completed phase when
    // its identity and phase serial match. Rebuild only when unavailable.
    const rec =
      live?.ready === true &&
      Number(live.phaseSerial) === Number(rt?.gpuPhasePrepareSerial) &&
      live.sourceLayer === rt?.renderSourceLayers?.[idx] &&
      live.targetLayer === rt?.renderTargetLayers?.[idx]
        ? live
        : buildLayerCpuResource(idx);
    if (!rec?.carrierRecords?.length) return null;
    return rec.carrierRecords.map((r) => ({
      path: r.pair.dst,
      cubics: r.dc,
      // A retiring branch is a collapsed geometric germ, not a new
      // physical source branch for the next Blue phase. Exposing it as
      // present causes ghost rails and discontinuous rematching.
      present: r.pair.targetPathPresent !== false && r.pair.coordinatedGerm !== 'retire',
    }));
  }
  // CPU presentation of a retained Spiral edit. WebGPU can take several frames
  // to prepare a new pair; NEVER rebuild an intermediate integer N/K geometry
  // while waiting. The integer rebuild creates/erases whole coils on the
  // frames where Math.round(N) changes. This sampler keeps a fixed set of
  // matched physical rails for the entire edit, including zero-length germs.
  function createCpuEditFallback(layerIndex, editPair) {
    return buildLayerCpuResource(layerIndex, editPair);
  }
  function cpuEditFallbackPaths(rec, t) {
    if (!rec?.carrierRecords?.length) return null;
    const u = clamp(Number(t) || 0, 0, 1),
      raw = rec.data;
    const mixScalar = (a, b, v) => a + (b - a) * v;
    const vec = (x, y) => ({ x, y });
    const interpolate = (a, b, v) => vec(mixScalar(a.x, b.x, v), mixScalar(a.y, b.y, v));
    const polar = (r, angle) => vec(r * Math.cos(angle), r * Math.sin(angle));
    const polarMix = (a, b, v) => polar(mixScalar(a[0], b[0], v), mixScalar(a[1], b[1], v));
    const polarPoint = (a) => polar(a[0], a[1]);
    const angleRotate = (v, a) =>
      vec(v.x * Math.cos(a) - v.y * Math.sin(a), v.x * Math.sin(a) + v.y * Math.cos(a));
    const at = (offset) => [raw[offset], raw[offset + 1]];
    const curr = [];
    if (rec.carrierMapped === true && ensureCarrierMappedCurrent(rec, u)) {
      for (const path of rec.carrierCurrentByPath || [])
        for (const q of path)
          curr.push({
            p0: { ...q.p0 },
            c1: { ...q.c1 },
            c2: { ...q.c2 },
            p3: { ...q.p3 },
          });
    } else {
      const curvature = rec.sourceSpline === true || rec.targetSpline === true;
      const pt = resolveProfileModeTransitionT(rec, u);
      for (let i = 0; i < rec.cubicCount; i++) {
        const o = i * FLOATS_PER_CUBIC,
          meta = raw[o + 22],
          flags = Math.round(raw[o + 23] || 0);
        const cartesian = meta > 0.5,
          topoCircle = (flags & 16) !== 0,
          coordinated = (flags & 4) !== 0;
        // Mirror WGSL: coordinated physical rails use one shared
        // time, not four unrelated per-control vertex clocks.
        const geometryT = coordinated ? SomataCoordinatedRules.spiralTime(u) : u;
        const phases = [geometryT, geometryT, geometryT, geometryT];
        const s = [at(o), at(o + 2), at(o + 4), at(o + 6)],
          d = [at(o + 8), at(o + 10), at(o + 12), at(o + 14)];
        const point = (j, v) => {
          const a = s[j],
            b = d[j];
          const circular = cartesian ? interpolate(polarPoint(a), polarPoint(b), v) : polarMix(a, b, v);
          return topoCircle && !cartesian
            ? interpolate(circular, interpolate(polarPoint(a), polarPoint(b), v), 0.42)
            : circular;
        };
        const p0 = point(0, phases[0]),
          p3 = point(3, phases[3]);
        let c1 = point(1, phases[1]),
          c2 = point(2, phases[2]);
        if (curvature) {
          const coordinatedPt = coordinated ? geometryT : pt;
          const a0 = mixScalar(s[0][1], d[0][1], phases[0]);
          const a3 = mixScalar(s[3][1], d[3][1], phases[3]);
          const handle = (ep, ctrl, angle) => {
            const e = polarPoint(ep),
              c = polarPoint(ctrl),
              v = vec(c.x - e.x, c.y - e.y);
            return cartesian ? v : angleRotate(v, angle - ep[1]);
          };
          const h1 = interpolate(handle(s[0], s[1], a0), handle(d[0], d[1], a0), coordinatedPt);
          const h2 = interpolate(handle(s[3], s[2], a3), handle(d[3], d[2], a3), coordinatedPt);
          c1 = vec(p0.x + h1.x, p0.y + h1.y);
          c2 = vec(p3.x + h2.x, p3.y + h2.y);
        }
        curr.push({ p0, c1, c2, p3 });
      }
    }
    if (curr.length !== rec.cubicCount) return null;
    // Mirror BOTH GPU period-closure passes (parent correction, then any
    // correction disturbed by moving-child attachment). Exact terminal
    // interpolation is kept: only intermediate period joins are repaired.
    const correctPeriodSeams = () => {
      if (!rec.periodSeamEnforced || rec.carrierMapped === true || !rec.cpuPathClosure) return;
      for (let pi = 0; pi < rec.pathCount; pi++) {
        const co = pi * 8,
          flags = rec.cpuPathClosure;
        if (flags[co + 6] < 0.5) continue;
        const first = rec.cpuPathSegmentRanges[pi * 4],
          count = rec.cpuPathSegmentRanges[pi * 4 + 1];
        if (!count) continue;
        const periodT = (flags[co + 7] & 4) !== 0 ? u * u * (3 - 2 * u) : u;
        const delta = flags[co] + (flags[co + 2] - flags[co]) * periodT;
        const scale = Math.exp(flags[co + 1] + (flags[co + 3] - flags[co + 1]) * periodT);
        const root = curr[first].p0,
          c1 = curr[first].c1;
        const rot = (p) => ({
          x: scale * (Math.cos(delta) * p.x - Math.sin(delta) * p.y),
          y: scale * (Math.sin(delta) * p.x + Math.cos(delta) * p.y),
        });
        const next = rot(root),
          last = curr[first + count - 1];
        last.p3 = next;
        const tangentFlag = flags[co + 7];
        if ((tangentFlag & 8) !== 0) {
          last.c1 = { x: last.p0.x + (next.x - last.p0.x) / 3, y: last.p0.y + (next.y - last.p0.y) / 3 };
          last.c2 = {
            x: last.p0.x + (2 * (next.x - last.p0.x)) / 3,
            y: last.p0.y + (2 * (next.y - last.p0.y)) / 3,
          };
        } else if ((tangentFlag & 3) !== 0) {
          const strength =
            ((tangentFlag & 1) !== 0 ? 1 : 0) * (1 - u) + ((tangentFlag & 2) !== 0 ? 1 : 0) * u;
          const outgoing = rot(c1),
            wanted = { x: 2 * next.x - outgoing.x, y: 2 * next.y - outgoing.y };
          last.c2 = {
            x: last.c2.x + (wanted.x - last.c2.x) * strength,
            y: last.c2.y + (wanted.y - last.c2.y) * strength,
          };
        }
      }
    };
    correctPeriodSeams();
    if (rec.germLinks?.length) {
      const unmodified = curr.map((q) => ({ p0: q.p0, c1: q.c1, c2: q.c2, p3: q.p3 }));
      const bez = (q, t) => {
        const z = 1 - t;
        return vec(
          z * z * z * q.p0.x + 3 * z * z * t * q.c1.x + 3 * z * t * t * q.c2.x + t * t * t * q.p3.x,
          z * z * z * q.p0.y + 3 * z * z * t * q.c1.y + 3 * z * t * t * q.c2.y + t * t * t * q.p3.y,
        );
      };
      const smooth = (a, b, v) => {
        const q = clamp((v - a) / (b - a), 0, 1);
        return q * q * (3 - 2 * q);
      };
      for (const g of rec.germLinks) {
        const smoother = (q) => q * q * q * (q * (q * 6 - 15) + 10);
        const strength = g.birth
          ? g.smootherBirth
            ? 1 - smoother(clamp((u - 0.25) / 0.75, 0, 1))
            : 1 - smooth(0.55, 1, u)
          : g.retireCoordinated
            ? smooth(0, 1, u)
            : smooth(0, 0.22, u);
        if (strength <= 1e-6) continue;
        const parent = unmodified[g.parent],
          start = unmodified[g.child - g.ordinal]?.p0;
        if (!parent || !start) continue;
        const anchor = bez(parent, g.parentT),
          dx = (anchor.x - start.x) * strength,
          dy = (anchor.y - start.y) * strength;
        const q = curr[g.child];
        if (g.retireCoordinated) {
          // No secondary collapse: the shared eased source-to-germ
          // blend already shrinks this branch to a point. Follow the
          // CURRENT moving neighbor via one shared translation.
          // This mirrors GERM_ATTACH_WGSL.
          for (const key of ['p0', 'c1', 'c2', 'p3']) q[key] = vec(q[key].x + dx, q[key].y + dy);
        } else for (const key of ['p0', 'c1', 'c2', 'p3']) q[key] = vec(q[key].x + dx, q[key].y + dy);
      }
    }
    correctPeriodSeams();
    const paths = [],
      subdiv = 8;
    for (let pi = 0; pi < rec.pathCount; pi++) {
      const rr = rec.carrierRecords[pi],
        first = rec.cpuPathSegmentRanges[pi * 4],
        count = rec.cpuPathSegmentRanges[pi * 4 + 1];
      const points = [];
      for (let j = 0; j < count; j++) {
        const q = curr[first + j],
          wo = (first + j) * FLOATS_PER_CUBIC,
          widthT =
            (Math.round(raw[wo + 23]) & 32) !== 0 ? (window.SomataCoordinatedFinish?.widthTime(u) ?? u) : u,
          // CPU fallback must mirror Fast Rail WGSL: stored widths
          // are linear multipliers, so interpolate their LOGS for
          // both ordinary and retiring cubics. Previously only
          // retirements did this; others incorrectly grew by exp(w).
          w0 = Math.exp(
            mixScalar(Math.log(Math.max(0.02, raw[wo + 16])), Math.log(Math.max(0.02, raw[wo + 18])), widthT),
          ),
          w1 = Math.exp(
            mixScalar(Math.log(Math.max(0.02, raw[wo + 17])), Math.log(Math.max(0.02, raw[wo + 19])), widthT),
          );
        for (let k = j === 0 ? 0 : 1; k <= subdiv; k++) {
          const v = k / subdiv,
            z = 1 - v;
          points.push({
            x: z * z * z * q.p0.x + 3 * z * z * v * q.c1.x + 3 * z * v * v * q.c2.x + v * v * v * q.p3.x,
            y: z * z * z * q.p0.y + 3 * z * z * v * q.c1.y + 3 * z * v * v * q.c2.y + v * v * v * q.p3.y,
            widthScale: Math.exp(mixScalar(Math.log(Math.max(0.02, w0)), Math.log(Math.max(0.02, w1)), v)),
          });
        }
      }
      const branch = Number(rr.pair?.src?.spiralBranchIndex);
      paths.push({
        points,
        closed: rr.closed === true,
        _alpha: spiralBranchPresence(
          rr.pair.sourcePathPresent !== false,
          rr.pair.targetPathPresent !== false,
          u,
        ),
        spiralBranchIndex: Number.isFinite(branch) ? branch : Number(rr.pair?.dst?.spiralBranchIndex) || pi,
        cornerFlags: [],
      });
    }
    return paths;
  }

  function status() {
    const active = [...resources.entries()].map(([layerIndex, r]) => ({
      layerIndex,
      morphType: r.morphType || '',
      spiralTransport: r.spiralTransport || r.morphType || '',
      profileMorphMode: r.profileMorphMode || '',
      interpolationMetric: r.interpolationMetric || '',
      carrierMapped: r.carrierMapped === true,
      carrierOverflow: r.carrierOverflow === true,
      cubicCount: r.cubicCount || 0,
      pathCount: r.pathCount || 0,
      topologyMergeSplitCount: r.topologyMergeSplitCount || 0,
      geometricBirths: r.geometricBirths || 0,
      geometricRetirements: r.geometricRetirements || 0,
      opacityFadeBranches: r.opacityFadeBranches || 0,
      germLinkCount: r.germLinkCount || 0,
      orphanGerms: r.orphanGerms || 0,
      continuousTopologyTransport: r.continuousTopologyTransport === true,
      exactSubdivisionOnly: r.exactSubdivisionOnly === true,
      arcEqualizedRecords: Number(r.arcEqualizedRecords) || 0,
      cartesianFallbackCubics: r.cartesianFallbackCubics || 0,
      maxPackedPolarTurn: Number(r.maxPackedPolarTurn) || 0,
      ready: r.ready === true,
      periodicPaths: r.cpuPathClosure
        ? Array.from(
            { length: r.pathCount || 0 },
            (_, pi) => r.cpuPathClosure[pi * 8 + 4] > 0.5 && r.cpuPathClosure[pi * 8 + 5] > 0.5,
          ).filter(Boolean).length
        : 0,
      hardPeriodicEnforced: r.periodSeamEnforced === true,
      periodSeamEnforced: r.periodSeamEnforced === true,
      maxEndpointClosureError: Number(r.maxEndpointClosureError) || 0,
      maxEndpointTangentClosureError: Number(r.maxEndpointTangentClosureError) || 0,
    }));
    return {
      supported: !!globalThis.navigator?.gpu,
      ready,
      initializing: Boolean(initializing),
      generation,
      lastError,
      resources: resources.size,
      active,
      staticVisualResources: staticVisualResources.size,
      stats: { ...stats },
      lastDecision: { ...decision },
      contract:
        'Somata 7.8.3 keeps the late-7.7.9 exact carrier/profile constructor for Spiral, no arc resampling, and one upload per t. Circular Spiral transports reuse an exact rotational carrier template across sibling branches; Torn stays explicit per-branch. Web and Lightning are 7.5-reference consumers: strict Spiral effects may only consume the exact specialized visible Spiral rail and never the generic shared morph rail. Continuous fixes N/K and crossfades exact source/target rails; Phase locks N; MinimalTurn locks K; Phase-circle changes N/K with clone/merge; Torn uses unique one-to-one branches with no cloning. Every spiral-to-spiral rail keeps periodic closure. Corridor center reveal remains whole-copy alpha; constant-step Corridor copy phase is synchronized to the exact current carrier delta; Glow follows the retained Spiral rail, and Glow/Base share the same packed copy transforms.',
    };
  }
  return {
    warmup,
    isReady: () => ready,
    beginStaticEdit,
    getStaticEditResource,
    coordinatedPeriodDelta,
    createCpuEditFallback,
    cpuEditFallbackPaths,
    preparePhase,
    invalidate,
    park,
    getResource,
    getAuthoritativeArcResource,
    queueVisibleRailForWeb,
    visibleRailWebStatus: () => ({ ...visibleRailWebStage }),
    isEligible,
    reason,
    render,
    renderGlowAndBase,
    auxiliaryPaths,
    status,
    captureTerminalRails,
    debugCenterShadeSpec: spiralCenterShadeSpec,
  };
})();
window.prepareGpuSpiralBezierMorphResources = () => WebGPUSpiralBezierMorphRenderer.preparePhase();
window.invalidateGpuSpiralBezierMorphResources = (reason) =>
  WebGPUSpiralBezierMorphRenderer.invalidate(reason);

window.parkGpuSpiralBezierMorphResources = (reason) => WebGPUSpiralBezierMorphRenderer.park(reason);
window.getGpuSpiralBezierMorphAuxPaths = (layerIndex, t, frameCtx = null) =>
  WebGPUSpiralBezierMorphRenderer.auxiliaryPaths(layerIndex, t, frameCtx);
window.__somataSpiralBezierMorphStatus = () => WebGPUSpiralBezierMorphRenderer.status();
window.__somataBlueMorphVisibleRailWebStatus = () => WebGPUSpiralBezierMorphRenderer.visibleRailWebStatus();

// Lightweight, read-only user-side performance evidence. Call from DevTools
// after allowing a three-layer Spiral scene to animate for several seconds.
// No pipeline changes, GPU readback, or extra frame requests are performed.

(() => {
  if (!globalThis.navigator?.gpu || globalThis.isSecureContext !== true) return;
  const kick = () => {
    try {
      WebGPUSpiralBezierMorphRenderer.warmup?.();
    } catch (error) {
      noteSuppressedError('gpu/spiral-bezier-morph-renderer#kick', error);
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(kick, { timeout: 350 });
  else setTimeout(kick, 0);
})();

export { WebGPUSpiralBezierMorphRenderer };
