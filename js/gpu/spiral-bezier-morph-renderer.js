

window.__spiroRegisterModule?.('js/gpu/spiral-bezier-morph-renderer');

const WebGPUSpiralBezierMorphRenderer = (() => {
    const SUBDIV=12, ARC_SUBDIV=8, FLOATS_PER_CUBIC=24;
    let device=null,format=null,pipelineMax=null,pipelineOver=null,uniformPipelineMax=null,uniformPipelineOver=null,effectCubicPipeline=null,closurePipeline=null,tangentRepairPipeline=null,fastRailPipeline=null,cornerBuffer=null,renderUniformLayout=null,renderCubicLayout=null,renderCopyLayout=null,renderPipelineLayout=null;
    let width=0,height=0,generation=-1,ready=false,initializing=null,lastError='not-initialized';
    const resources=new Map(),retiredResources=[],staticVisualResources=new Map();
    let retireTimer=0;
    const stats={phaseBuilds:0,layerBuilds:0,staticVisualBuilds:0,staticVisualHits:0,uploads:0,uploadSkips:0,frames:0,baseFrames:0,glowFrames:0,fusedFrames:0,corridorFrames:0,deferredLayerSceneFrames:0,directFrameSceneFrames:0,cubics:0,gpuSegments:0,arcSubdiv:ARC_SUBDIV,cubicComputeDispatches:0,cubicComputeReuses:0,tangentRepairDispatches:0,fastRailDispatches:0,fastRailReuses:0,fastRailSegments:0,auxFrames:0,auxHits:0,auxPoints:0,carrierMappedFrames:0,carrierMappedUploads:0,carrierMappedUploadSkips:0,carrierProfilePrepares:0,carrierIdentityCubics:0,carrierMappedFallbacks:0,carrierRotationalBuilds:0,carrierRotationalReuses:0,retired:0,fallbacks:0,errors:0,gpuSceneUnavailable:0};
    const decision={eligible:false,reason:'not-requested',layerIndex:-1,frameId:-1};
    const uniformBytes=new ArrayBuffer(80),uf=new Float32Array(uniformBytes),uu=new Uint32Array(uniformBytes);
    const TWO_PI=Math.PI*2;

    const EFFECT_CUBIC_WGSL=`
struct U { count:u32, _a:u32, _b:u32, _c:u32, phase:vec4<f32>, };
@group(0) @binding(0) var<storage,read> endpointData:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read_write> currentCubics:array<vec4<f32>>;
@group(0) @binding(2) var<uniform> u:U;
fn polarXY(a:vec2<f32>)->vec2<f32>{return vec2<f32>(a.x*cos(a.y),a.x*sin(a.y));}
fn polarMix(a:vec2<f32>,b:vec2<f32>,t:f32)->vec2<f32>{let r=mix(a.x,b.x,t);let ang=mix(a.y,b.y,t);return vec2<f32>(r*cos(ang),r*sin(ang));}
fn safeSpiralMix(a:vec2<f32>,b:vec2<f32>,t:f32,cartesian:bool)->vec2<f32>{return select(polarMix(a,b,t),mix(polarXY(a),polarXY(b),t),cartesian);}
fn rotate2(v:vec2<f32>,a:f32)->vec2<f32>{let c=cos(a);let s=sin(a);return vec2<f32>(c*v.x-s*v.y,s*v.x+c*v.y);}
fn transportedHandle(endpointPolar:vec2<f32>,controlPolar:vec2<f32>,currentAngle:f32,cartesian:bool)->vec2<f32>{
 let v=polarXY(controlPolar)-polarXY(endpointPolar);return select(rotate2(v,currentAngle-endpointPolar.y),v,cartesian);
}
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=u.count){return;}let b=i*6u;
 let s0=endpointData[b];let s1=endpointData[b+1u];let d0=endpointData[b+2u];let d1=endpointData[b+3u];let metaData=endpointData[b+5u];let t=clamp(u.phase.x,0.0,1.0);let cartesian=metaData.z>0.5;
 let p0=safeSpiralMix(s0.xy,d0.xy,t,cartesian);let p3=safeSpiralMix(s1.zw,d1.zw,t,cartesian);var c1=safeSpiralMix(s0.zw,d0.zw,t,cartesian);var c2=safeSpiralMix(s1.xy,d1.xy,t,cartesian);
 let mixed=(u.phase.z>.5)!=(u.phase.w>.5);if(mixed){
   let pt=clamp(u.phase.y,0.0,1.0);let a0=mix(s0.y,d0.y,t);let a3=mix(s1.w,d1.w,t);
   let hs1=transportedHandle(s0.xy,s0.zw,a0,cartesian);let hd1=transportedHandle(d0.xy,d0.zw,a0,cartesian);
   let hs2=transportedHandle(s1.zw,s1.xy,a3,cartesian);let hd2=transportedHandle(d1.zw,d1.xy,a3,cartesian);
   c1=p0+mix(hs1,hd1,pt);c2=p3+mix(hs2,hd2,pt);
 }
 currentCubics[i*2u]=vec4<f32>(p0,c1);currentCubics[i*2u+1u]=vec4<f32>(c2,p3);
}`;

    const CLOSURE_WGSL=`
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
 let delta=mix(spec.x,spec.z,t);let scale=exp(mix(spec.y,spec.w,t));let firstQ=currentCubics[first*2u];let p0=firstQ.xy;let c1=firstQ.zw;let expectedP3=rotateScale(p0,delta,scale);let expectedNextC1=rotateScale(c1,delta,scale);let expectedC2=2.0*expectedP3-expectedNextC1;
 let packed=u32(max(0.0,flags.w)+0.5);let sourceTangent=select(0.0,1.0,(packed&1u)!=0u);let targetTangent=select(0.0,1.0,(packed&2u)!=0u);let tangentStrength=min(positionStrength,mix(sourceTangent,targetTangent,t));
 let last=first+n-1u;var q=currentCubics[last*2u+1u];q.xy=mix(q.xy,expectedC2,clamp(tangentStrength,0.0,1.0));q.zw=mix(q.zw,expectedP3,clamp(positionStrength,0.0,1.0));currentCubics[last*2u+1u]=q;
}`;

    const TANGENT_REPAIR_WGSL=`
struct U { count:u32, _a:u32, _b:u32, _c:u32, phase:vec4<f32>, };
@group(0) @binding(0) var<storage,read_write> currentCubics:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(0) @binding(2) var<uniform> u:U;
fn safeUnit(v:vec2<f32>,fallback:vec2<f32>)->vec2<f32>{let l=length(v);if(l>0.000001){return v/l;}return fallback;}
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x+1u;if(i>=u.count){return;}if(segmentMeta[i-1u].z!=segmentMeta[i].z){return;}
 let t=clamp(u.phase.x,0.0,1.0);let mixed=(u.phase.z>.5)!=(u.phase.w>.5);let modeT=select(t,clamp(u.phase.y,0.0,1.0),mixed);let pf=segmentMeta[i-1u].w;let nf=segmentMeta[i].w;let sourceCorner=((pf&0x02000000u)!=0u)||((nf&0x01000000u)!=0u);let targetCorner=((pf&0x08000000u)!=0u)||((nf&0x04000000u)!=0u);let sourceSmooth=select(1.0,0.0,sourceCorner);let targetSmooth=select(1.0,0.0,targetCorner);let strength=clamp(mix(sourceSmooth,targetSmooth,modeT),0.0,1.0);if(strength<=0.000001){return;}
 var prev=currentCubics[(i-1u)*2u+1u];var next=currentCubics[i*2u];let knot=(prev.zw+next.xy)*0.5;let vin=knot-prev.xy;let vout=next.zw-knot;let lin=length(vin);let lout=length(vout);if(lin<=0.000001&&lout<=0.000001){prev.zw=knot;next.xy=knot;currentCubics[(i-1u)*2u+1u]=prev;currentCubics[i*2u]=next;return;}
 let di=safeUnit(vin,safeUnit(vout,vec2<f32>(1.0,0.0)));let dout=safeUnit(vout,di);var sum=di+dout;var dir=safeUnit(sum,select(di,dout,lout>lin));if(dot(di,dout)< -0.95){dir=select(di,dout,lout>lin);}
 let repairedC2=knot-dir*lin;let repairedC1=knot+dir*lout;prev.xy=mix(prev.xy,repairedC2,strength);prev.zw=knot;next.xy=knot;next.zw=mix(next.zw,repairedC1,strength);currentCubics[(i-1u)*2u+1u]=prev;currentCubics[i*2u]=next;
}`;

    const FAST_RAIL_WGSL=`
struct U { count:u32, _a:u32, _b:u32, _c:u32, phase:vec4<f32>, };
@group(0) @binding(0) var<storage,read> endpointData:array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> currentCubics:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> fastRail:array<vec4<f32>>;
@group(0) @binding(3) var<uniform> u:U;
fn cubic(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let q=1.0-t;return q*q*q*p0+3.0*q*q*t*c1+3.0*q*t*t*c2+t*t*t*p3;}
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let total=u.count*${SUBDIV}u;if(i>=total){return;}let ci=i/${SUBDIV}u;let sub=i%${SUBDIV}u;let b=ci*6u;let q=currentCubics[ci*2u];let r=currentCubics[ci*2u+1u];let w=endpointData[b+4u];let metaData=endpointData[b+5u];let phaseT=clamp(u.phase.x,0.0,1.0);
 let t0=f32(sub)/f32(${SUBDIV});let t1=f32(sub+1u)/f32(${SUBDIV});let a=cubic(q.xy,q.zw,r.xy,r.zw,t0);let bb=cubic(q.xy,q.zw,r.xy,r.zw,t1);
 let ws0=exp(mix(log(max(.02,w.x)),log(max(.02,w.z)),phaseT));let ws1=exp(mix(log(max(.02,w.y)),log(max(.02,w.w)),phaseT));let l0=exp(mix(log(max(.02,ws0)),log(max(.02,ws1)),t0));let l1=exp(mix(log(max(.02,ws0)),log(max(.02,ws1)),t1));let presence=mix(metaData.x,metaData.y,phaseT);
 fastRail[i*2u]=vec4<f32>(a,bb);fastRail[i*2u+1u]=vec4<f32>(l0,l1,presence,metaData.w);
}`;

    const WGSL=`
struct U {
  viewport:vec2<f32>, cubicCount:u32, copyCount:u32,
  row0:vec4<f32>, row1:vec4<f32>,
  params:vec4<f32>, // halfWidth, glowRadius, coreAlpha, glowAlpha
  phase:vec4<f32>,  // t, reserved...
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
 let cp0=copyData[ci*3u];let cp1=copyData[ci*3u+1u];let cp2=copyData[ci*3u+2u];let a=vec2<f32>(cp0.x*a0.x+cp0.y*a0.y,cp1.x*a0.x+cp1.y*a0.y);let bb=vec2<f32>(cp0.x*b0.x+cp0.y*b0.y,cp1.x*b0.x+cp1.y*b0.y);
 let sp0=screenPoint(a);let sp1=screenPoint(bb);let delta=sp1-sp0;let len=max(length(delta),0.0001);let dir=delta/len;let normal=vec2<f32>(-dir.y,dir.x);let l0=g1.x;let l1=g1.y;let sc=max(.000001,abs(cp0.w));
 let hw0=max(.18,u.params.x*sc*l0);let hw1=max(.18,u.params.x*sc*l1);let gr=max(0.0,u.params.y*sc);let pad=max(hw0,hw1)+gr+2.0;let tx=(v.corner.x+1.0)*.5;let lx=mix(-pad,len+pad,tx);let ly=v.corner.y*pad;let pos=sp0+dir*lx+normal*ly;
 o.position=vec4<f32>(pos.x/u.viewport.x*2.0-1.0,1.0-pos.y/u.viewport.y*2.0,0.0,1.0);o.local=vec2<f32>(lx,ly);o.segLen=len;o.logHalfWidth0=log(max(.001,hw0));o.logHalfWidth1=log(max(.001,hw1));o.glowRadius=gr;o.alpha=cp0.z*g1.z;o.color=vec4<f32>(cp1.z,cp1.w,cp2.x,cp2.y);return o;
}
@fragment fn fs(v:Vout)->@location(0) vec4<f32>{
 if(v.alpha<=.00001||v.color.a<=.00001){discard;}let cx=clamp(v.local.x,0.0,v.segLen);let q=cx/max(.0001,v.segLen);let hw=exp(mix(v.logHalfWidth0,v.logHalfWidth1,q));let d=length(vec2<f32>(v.local.x-cx,v.local.y));var cov=0.0;
 if(u.params.w>.00001&&v.glowRadius>.01){let edge=max(0.0,d-hw);let z=edge/max(.55,v.glowRadius*.44);cov=exp(-z*z*1.65)*(1.0-smoothstep(v.glowRadius*.76,v.glowRadius+2.0,edge))*u.params.w;}else{cov=clamp(hw+.75-d,0.0,1.0)*u.params.z;}
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
 let cur=railScreenDir(ri,cp0,cp1,vec2<f32>(1.0,0.0));var sum=cur;let first=(flags>=.5&&flags<1.5)||flags>=2.5;let last=flags>=1.5;
 if(!right){if(sub>0u||!first){sum=sum+railScreenDir(ri-1u,cp0,cp1,cur);}}else{if(sub+1u<${SUBDIV}u||!last){sum=sum+railScreenDir(ri+1u,cp0,cp1,cur);}}return safeUnit(sum,cur);
}
fn fastJoinHasNeighbor(sub:u32,right:bool,flags:f32)->bool{let first=(flags>=.5&&flags<1.5)||flags>=2.5;let last=flags>=1.5;return select(sub>0u||!first,sub+1u<${SUBDIV}u||!last,right);}
@vertex fn vsUniform(v:Vin,@builtin(instance_index) iid:u32)->UniformOut{
 var o:UniformOut;let ci=(iid/${SUBDIV}u)%max(1u,u.cubicCount);let sub=iid%${SUBDIV}u;let copyIndex=iid/(max(1u,u.cubicCount)*${SUBDIV}u);let ri=ci*${SUBDIV}u+sub;let g0=fastRail[ri*2u];let g1=fastRail[ri*2u+1u];let right=v.corner.x>0.0;let local=select(g0.xy,g0.zw,right);
 let cp0=copyData[copyIndex*3u];let cp1=copyData[copyIndex*3u+1u];let cp2=copyData[copyIndex*3u+2u];let copied=vec2<f32>(cp0.x*local.x+cp0.y*local.y,cp1.x*local.x+cp1.y*local.y);let center=screenPoint(copied);
 let tangent=fastJoinedTangent(ri,sub,right,g1.w,cp0,cp1);let normal=vec2<f32>(-tangent.y,tangent.x);let scaleAt=select(g1.x,g1.y,right);let sc=max(.000001,abs(cp0.w));let hw=max(.18,u.params.x*sc*scaleAt);let pad=hw+.75;let seamOverlap=select(0.0,min(.55,max(.18,hw*.16)),fastJoinHasNeighbor(sub,right,g1.w));let along=select(-seamOverlap,seamOverlap,right);let pos=center+tangent*along+normal*(v.corner.y*pad);
 o.position=vec4<f32>(pos.x/u.viewport.x*2.0-1.0,1.0-pos.y/u.viewport.y*2.0,0.0,1.0);o.edge=v.corner.y*pad;o.halfWidth=hw;o.alpha=cp0.z*g1.z;o.color=vec4<f32>(cp1.z,cp1.w,cp2.x,cp2.y);return o;
}
@fragment fn fsUniform(v:UniformOut)->@location(0) vec4<f32>{
 if(v.alpha<=.00001||v.color.a<=.00001||u.params.z<=.00001){discard;}let hw=max(.001,v.halfWidth);let cc=min(1.0,2.0*hw);let cov=min(cc,clamp(hw+.5-abs(v.edge),0.0,1.0))*u.params.z;let centerMask=centerShade(v.position.xy);let a=clamp(cov*centerMask*v.alpha*v.color.a,0.0,1.0);if(a<.0001){discard;}return vec4<f32>(v.color.rgb*a,a);
}`;

    function destroyResource(rec){
        for(const b of [rec?.buffer,rec?.copyBuffer,rec?.uniformBase,rec?.uniformGlow,rec?.cubicBuffer,rec?.cubicUniformBuffer,rec?.pathRangeBuffer,rec?.segmentMetaBuffer,rec?.pathSegmentRangeBuffer,rec?.pathClosureBuffer,rec?.fastRailBuffer,rec?.fastUniformBuffer])try{b?.destroy?.();}catch(_){}
    }
    function destroyStaticVisual(rec){
        for(const b of [rec?.metaBuffer,rec?.copyBuffer,rec?.uniformBase,rec?.uniformGlow,rec?.fastRailBuffer,rec?.fastUniformBuffer])try{b?.destroy?.();}catch(_){}
    }
    function resetStaticVisuals(){for(const rec of staticVisualResources.values())destroyStaticVisual(rec);staticVisualResources.clear();}
    function flushRetired(){retireTimer=0;while(retiredResources.length)destroyResource(retiredResources.pop());}
    function scheduleRetiredFlush(){if(retireTimer)return;const run=()=>flushRetired();if(typeof requestIdleCallback==='function')retireTimer=requestIdleCallback(run,{timeout:800});else retireTimer=setTimeout(run,80);}
    function retireCurrentResources(reason='phase-change'){try{invalidateGpuMorphArcResources?.(`spiral-bezier-${reason}`);}catch(_){}for(const rec of resources.values()){retiredResources.push(rec);stats.retired++;}resources.clear();decision.reason=reason;scheduleRetiredFlush();}

    function replaceResources(nextResources,reason='phase-swap'){
        try{invalidateGpuMorphArcResources?.(`spiral-bezier-${reason}`);}catch(_){}
        for(const rec of resources.values()){retiredResources.push(rec);stats.retired++;}
        resources.clear();
        for(const [key,rec] of nextResources)resources.set(key,rec);
        decision.reason=reason;
        scheduleRetiredFlush();
    }
    function invalidate(reason='phase-change'){retireCurrentResources(reason);}

    function park(reason='stopped'){decision.eligible=false;decision.reason=reason;for(const rec of resources.values()){rec.copyPackedFrameId=-1;rec.auxT=NaN;}return true;}
    function reset(){for(const rec of resources.values())destroyResource(rec);resources.clear();resetStaticVisuals();flushRetired();try{cornerBuffer?.destroy?.();}catch(_){}pipelineMax=null;pipelineOver=null;uniformPipelineMax=null;uniformPipelineOver=null;effectCubicPipeline=null;closurePipeline=null;tangentRepairPipeline=null;fastRailPipeline=null;cornerBuffer=null;renderUniformLayout=null;renderCubicLayout=null;renderCopyLayout=null;renderPipelineLayout=null;width=0;height=0;device=null;ready=false;}
    async function ensureReady(){
        const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration?.():-1;
        if(ready&&device&&gen===generation)return true;if(initializing)return initializing;
        if(ready&&gen!==generation)reset();
        initializing=(async()=>{try{if(typeof WebGPUDeviceHub==='undefined')throw new Error('WebGPUDeviceHub unavailable');const sh=await WebGPUDeviceHub.acquire();device=sh.device;generation=sh.generation;format=navigator.gpu.getPreferredCanvasFormat();const mod=device.createShaderModule({label:'Somata Spiral Bézier Morph WGSL',code:WGSL}),effectMod=device.createShaderModule({label:'Somata Spiral Bézier shared effect cubics WGSL',code:EFFECT_CUBIC_WGSL}),repairMod=device.createShaderModule({label:'Somata 7.5 Spiral topology tangent repair WGSL',code:TANGENT_REPAIR_WGSL}),fastMod=device.createShaderModule({label:'Somata 7.5 Spiral Fast Visual Rail WGSL',code:FAST_RAIL_WGSL});if(typeof assertWebGPUShaderModule==='function'){await assertWebGPUShaderModule(mod,'Somata Spiral Bézier Morph WGSL');await assertWebGPUShaderModule(effectMod,'Somata Spiral Bézier shared effect cubics WGSL');await assertWebGPUShaderModule(repairMod,'Somata 7.5 Spiral topology tangent repair WGSL');await assertWebGPUShaderModule(fastMod,'Somata 7.5 Spiral Fast Visual Rail WGSL');}effectCubicPipeline=device.createComputePipeline({label:'Somata Spiral Bézier shared effect cubics',layout:'auto',compute:{module:effectMod,entryPoint:'main'}});tangentRepairPipeline=device.createComputePipeline({label:'Somata 7.5 Spiral topology tangent repair',layout:'auto',compute:{module:repairMod,entryPoint:'main'}});fastRailPipeline=device.createComputePipeline({label:'Somata 7.5 Spiral Fast Visual Rail',layout:'auto',compute:{module:fastMod,entryPoint:'main'}});const closureMod=device.createShaderModule({label:'Somata 7.5 Spiral periodic closure WGSL',code:CLOSURE_WGSL});if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(closureMod,'Somata 7.5 Spiral periodic closure WGSL');closurePipeline=device.createComputePipeline({label:'Somata 7.5 Spiral periodic closure',layout:'auto',compute:{module:closureMod,entryPoint:'main'}});const blendOver={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}},blendMax={color:{srcFactor:'one',dstFactor:'one',operation:'max'},alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}};const vertexBuffers=[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}];

            renderUniformLayout=device.createBindGroupLayout({label:'Somata Spiral Morph render uniforms',entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
            renderCubicLayout=device.createBindGroupLayout({label:'Somata 7.5 Spiral Fast Visual Rail raster',entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
            renderCopyLayout=device.createBindGroupLayout({label:'Somata Spiral Morph corridor copies',entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
            renderPipelineLayout=device.createPipelineLayout({label:'Somata Spiral Morph shared render layout',bindGroupLayouts:[renderUniformLayout,renderCubicLayout,renderCopyLayout]});
            const makePipeline=(kind,blend)=>device.createRenderPipeline({label:`Somata 7.5 Spiral Bézier Morph ${kind}`,layout:renderPipelineLayout,vertex:{module:mod,entryPoint:'vs',buffers:vertexBuffers},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend}]},primitive:{topology:'triangle-strip'}});const makeUniformPipeline=(kind,blend)=>device.createRenderPipeline({label:`Somata 7.5 Uniform Spiral Bézier Morph ${kind}`,layout:renderPipelineLayout,vertex:{module:mod,entryPoint:'vsUniform',buffers:vertexBuffers},fragment:{module:mod,entryPoint:'fsUniform',targets:[{format,blend}]},primitive:{topology:'triangle-strip'}});pipelineMax=makePipeline('MAX union',blendMax);pipelineOver=makePipeline('source-over',blendOver);uniformPipelineMax=makeUniformPipeline('MAX union',blendMax);uniformPipelineOver=makeUniformPipeline('source-over',blendOver);cornerBuffer=device.createBuffer({label:'Somata Spiral Bézier corners',size:32,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,1,1]));ready=true;lastError='';

            try{requestMainCanvasRender?.();}catch(_){}
            return true;}catch(err){lastError=String(err?.message||err);stats.errors++;ready=false;return false;}finally{initializing=null;}})();return initializing;
    }
    function warmup(){void ensureReady();return ready;}
    function ensureSize(){if(!ready||!device)return false;width=Math.max(1,mainCanvas.width|0);height=Math.max(1,mainCanvas.height|0);return true;}
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    function lineCubics(points){const out=[];for(let i=0;i<points.length-1;i++){const p0=points[i],p3=points[i+1],c1={x:p0.x+(p3.x-p0.x)/3,y:p0.y+(p3.y-p0.y)/3},c2={x:p0.x+2*(p3.x-p0.x)/3,y:p0.y+2*(p3.y-p0.y)/3};out.push({p0:{...p0},c1,c2,p3:{...p3},widthScale0:Math.max(.02,Number(p0.widthScale)||1),widthScale1:Math.max(.02,Number(p3.widthScale)||1)});}return out;}
    function endpointCubics(path,layer){
        const points=path?.points||[];if(points.length<2)return [];
        // A fresh carrier path was just constructed by geometry-gpu-core. Its retained
        // cubics have already passed periodic finalization and rounded-join repair, so
        // cloning/finalizing all controls again here only creates garbage on every frame.
        if(path?.__carrierMapped===true&&Array.isArray(path?._bezierSegments)&&path._bezierSegments.length){stats.carrierIdentityCubics++;return path._bezierSegments;}
        const exact=(src)=>{let c=(src||[]).map(q=>({...q,p0:{...q.p0},c1:{...q.c1},c2:{...q.c2},p3:{...q.p3}}));if(c.length&&typeof __spiroFinalizePeriodicSpiralBezierCarrier==='function')c=__spiroFinalizePeriodicSpiralBezierCarrier(c,points);if(c.length&&(Number(layer?.rounding)||0)>0&&typeof __spiroRepairRoundedSpiralBezierJoins==='function')c=__spiroRepairRoundedSpiralBezierJoins(c);return c;};
        if(Array.isArray(path?._bezierSegments)&&path._bezierSegments.length)return exact(path._bezierSegments);
        if(Array.isArray(points?._spiroRetainedCubics)&&points._spiroRetainedCubics.length)return exact(points._spiroRetainedCubics);
        const smooth=layer?.profileMode==='spline'&&path?.spiralProfileSplineBaked!==true;
        const round=path?.spiralProfileRoundingBaked===true?0:Math.max(0,Math.min(2,Number(typeof getRoundingStrength==='function'?getRoundingStrength(layer?.rounding):layer?.rounding)||0));
        if(typeof buildSpiralBezierSegments==='function'){const c=buildSpiralBezierSegments(points,round,path?.cornerFlags||[],smooth);if(c?.length)return c;}
        if(typeof __spiroBuildSpiralBezierSegments==='function'){const c=__spiroBuildSpiralBezierSegments(points,round,path?.cornerFlags||[],smooth);if(c?.length)return c;}
        return lineCubics(points);
    }
    function periodicClosureSpec(path,cubics,layer){
        const periodic=Boolean(layer?.spiralEnabled===true&&layer?.spiralClosed!==false&&cubics?.length);
        if(!periodic)return{periodic:false,delta:0,logScale:0,error:0,tangentProtected:false};
        const points=Array.isArray(path?.points)?path.points:[],p0=cubics[0].p0,p3=cubics[cubics.length-1].p3,meta=points[0]||null;
        const hasAutoCloseBridge=points.some(p=>p?.__spiralAutoCloseBridgeEnd===true);
        const hasExplicitSeamFillet=points.some(p=>p?.__spiralClosureProtected===true||p?.__spiralSeamProtected===true||Boolean(p?.__spiralClosureFillet)||Number(p?.__spiralSeamRoundFraction)>0);
        const tangentProtected=cubics?._spiroPeriodicTangent===true||((layer?.spiralTangential===true||meta?.__spiralTangential===true)&&!hasAutoCloseBridge)||hasExplicitSeamFillet;
        let delta=Number(meta?.__spiralDelta),scale=Number(meta?.__spiralTargetScale);
        if(!Number.isFinite(delta)){delta=Math.atan2(Number(p3.y)||0,Number(p3.x)||0)-Math.atan2(Number(p0.y)||0,Number(p0.x)||0);while(delta>Math.PI)delta-=TWO_PI;while(delta<=-Math.PI)delta+=TWO_PI;}
        if(!(Number.isFinite(scale)&&scale>0)){const r0=Math.hypot(Number(p0.x)||0,Number(p0.y)||0),r3=Math.hypot(Number(p3.x)||0,Number(p3.y)||0);scale=r0>1e-9?Math.max(1e-6,r3/r0):1;}
        const c=Math.cos(delta),sn=Math.sin(delta),ex=(c*(Number(p0.x)||0)-sn*(Number(p0.y)||0))*scale,ey=(sn*(Number(p0.x)||0)+c*(Number(p0.y)||0))*scale;
        const firstC1=cubics[0]?.c1||p0,lastC2=cubics[cubics.length-1]?.c2||p3,ec1x=(c*(Number(firstC1.x)||0)-sn*(Number(firstC1.y)||0))*scale,ec1y=(sn*(Number(firstC1.x)||0)+c*(Number(firstC1.y)||0))*scale,ec2x=2*ex-ec1x,ec2y=2*ey-ec1y;
        return{periodic:true,delta,logScale:Math.log(Math.max(1e-6,scale)),error:Math.hypot((Number(p3.x)||0)-ex,(Number(p3.y)||0)-ey),tangentError:Math.hypot((Number(lastC2.x)||0)-ec2x,(Number(lastC2.y)||0)-ec2y),tangentProtected};
    }
    function lerpPoint(a,b,t){return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
    function splitCubic(q,t){const p01=lerpPoint(q.p0,q.c1,t),p12=lerpPoint(q.c1,q.c2,t),p23=lerpPoint(q.c2,q.p3,t),p012=lerpPoint(p01,p12,t),p123=lerpPoint(p12,p23,t),p=lerpPoint(p012,p123,t);return[{p0:{...q.p0},c1:p01,c2:p012,p3:p},{p0:p,c1:p123,c2:p23,p3:{...q.p3}}];}
    function cubicSubsegment(q,a,b){a=clamp(a,0,1);b=clamp(b,a,1);let out;if(a<=1e-12&&b>=1-1e-12)out={...q,p0:{...q.p0},c1:{...q.c1},c2:{...q.c2},p3:{...q.p3}};else{let left=q;if(b<1-1e-12)left=splitCubic(q,b)[0];out=a<=1e-12?left:splitCubic(left,a/Math.max(1e-12,b))[1];}

        out.__profileCorner0=a<=1e-8&&q.__profileCorner0===true;out.__profileCorner1=b>=1-1e-8&&q.__profileCorner1===true;
        return out;}
    function cubicPoint(q,t){const u=1-t,u2=u*u,t2=t*t;return{x:u2*u*q.p0.x+3*u2*t*q.c1.x+3*u*t2*q.c2.x+t2*t*q.p3.x,y:u2*u*q.p0.y+3*u2*t*q.c1.y+3*u*t2*q.c2.y+t2*t*q.p3.y};}
    function cubicSpeed(q,t){const u=1-t,dx=3*u*u*(q.c1.x-q.p0.x)+6*u*t*(q.c2.x-q.c1.x)+3*t*t*(q.p3.x-q.c2.x),dy=3*u*u*(q.c1.y-q.p0.y)+6*u*t*(q.c2.y-q.c1.y)+3*t*t*(q.p3.y-q.c2.y);return Math.hypot(dx,dy);}
    function cubicArcLengthGauss3(q,a=0,b=1){const m=(a+b)*.5,h=(b-a)*.5,x=.7745966692414834;return Math.max(1e-12,h*((8/9)*cubicSpeed(q,m)+(5/9)*(cubicSpeed(q,m-h*x)+cubicSpeed(q,m+h*x))));}
    function cubicApproxLength(q){return Math.max(1e-9,cubicArcLengthGauss3(q,0,1));}
    function cubicArcLut(q,steps=12){const ts=new Float32Array(steps+1),ls=new Float32Array(steps+1);let total=0;for(let i=1;i<=steps;i++){const a=(i-1)/steps,t=i/steps;total+=cubicArcLengthGauss3(q,a,t);ts[i]=t;ls[i]=total;}return{ts,ls,total:Math.max(1e-9,total)};}
    function buildRailArcMap(cubics){const src=Array.isArray(cubics)?cubics:[],entries=[],knots=[0];let total=0;for(let i=0;i<src.length;i++){const lut=cubicArcLut(src[i]);entries.push({q:src[i],lut,start:total,end:total+lut.total});total+=lut.total;}total=Math.max(1e-9,total);for(const e of entries)knots.push(e.end/total);knots[knots.length-1]=1;return{entries,total,knots};}
    function localTAtArcFraction(entry,localFraction){const f=clamp(localFraction,0,1),target=f*entry.lut.total,ls=entry.lut.ls,ts=entry.lut.ts;let hi=1;while(hi<ls.length&&ls[hi]<target)hi++;if(hi>=ls.length)return 1;const lo=Math.max(0,hi-1),den=Math.max(1e-9,ls[hi]-ls[lo]),u=(target-ls[lo])/den;return ts[lo]+(ts[hi]-ts[lo])*u;}
    function railLocationAtFraction(map,f){
        const target=clamp(f,0,1)*map.total, entries=map.entries;
        // Arc-map endpoints are monotonically increasing. Find precisely the first
        // endpoint accepted by the old linear walk, using the SAME 1e-9 tolerance.
        // Morph may query thousands of common knots per branch: O(log N) instead
        // of revisiting O(N) entries for each query.
        let lo=0,hi=entries.length-1;
        while(lo<hi){const mid=(lo+hi)>>>1;if(target>entries[mid].end+1e-9)lo=mid+1;else hi=mid;}
        const e=entries[lo],local=(target-e.start)/Math.max(1e-9,e.end-e.start);
        return{index:lo,t:localTAtArcFraction(e,local)};
    }
    function uniqueFractions(values){const a=(values||[]).map(v=>clamp(Number(v)||0,0,1)).sort((x,y)=>x-y),out=[];for(const v of a)if(!out.length||Math.abs(v-out[out.length-1])>1e-6)out.push(v);if(!out.length||out[0]>1e-8)out.unshift(0);else out[0]=0;if(out[out.length-1]<1-1e-8)out.push(1);else out[out.length-1]=1;return out;}
    function splitRailAtFractions(map,fractions){const out=[];for(let k=0;k<fractions.length-1;k++){const fa=fractions[k],fb=fractions[k+1];if(fb-fa<1e-8)continue;const a=railLocationAtFraction(map,fa),b=railLocationAtFraction(map,fb);if(a.index!==b.index){/* union includes all original knots, so only floating-point boundary drift can land here */const boundary=map.knots[Math.min(a.index,b.index)+1];const aa=railLocationAtFraction(map,Math.min(fb,boundary-1e-8)),bb=railLocationAtFraction(map,Math.max(fa,boundary+1e-8));if(a.index!==aa.index||bb.index!==b.index)continue;}
        const e=map.entries[a.index];let tb=b.index===a.index?b.t:1;let ta=a.t;if(k===fractions.length-2&&fb>=1-1e-8){const last=map.entries.length-1;if(a.index===last)tb=1;}const r=cubicSubsegment(e.q,ta,tb),lw0=Math.log(Math.max(.02,Number(e.q.widthScale0)||1)),lw1=Math.log(Math.max(.02,Number(e.q.widthScale1)||1));r.widthScale0=Math.exp(lw0+(lw1-lw0)*ta);r.widthScale1=Math.exp(lw0+(lw1-lw0)*tb);out.push(r);
    }return out;}
    function equalizeCubicRailsByArc(srcCubics,dstCubics,sourceMap=null,targetMap=null){const sm=sourceMap||buildRailArcMap(srcCubics),dm=targetMap||buildRailArcMap(dstCubics),fractions=uniqueFractions([0,1,...sm.knots,...dm.knots]);const source=splitRailAtFractions(sm,fractions),target=splitRailAtFractions(dm,fractions);if(source.length!==target.length||!source.length){const count=Math.max(srcCubics.length,dstCubics.length),fallback=(cubics)=>{const map=buildRailArcMap(cubics),f=[];for(let i=0;i<=count;i++)f.push(i/count);return splitRailAtFractions(map,f);};return{source:fallback(srcCubics),target:fallback(dstCubics),fractions:Array.from({length:count+1},(_,i)=>i/count),fallback:true};}return{source,target,fractions,fallback:false};}
    function authoredFlagFractions(path,map,kind='key'){
        const knots=map?.knots||[];

        if(kind==='key')return knots.length>1?[0,1]:[0];
        const logical=path?.lampCornerFlags||[],geometric=path?.cornerFlags||[],out=[];
        for(let i=1;i<knots.length-1;i++)if(logical[i]===true||geometric[i]===true)out.push(Math.max(0,Math.min(1,Number(knots[i])||0)));
        return out.sort((a,b)=>a-b).filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>1e-6);
    }
    function cubicRailPoints(cubics){if(!cubics?.length)return[];const out=[{...cubics[0].p0,widthScale:Math.max(.02,Number(cubics[0].widthScale0)||1)}];for(const q of cubics)out.push({...q.p3,widthScale:Math.max(.02,Number(q.widthScale1)||1)});return out;}
    function cubicRailLength(cubics){let d=0;for(const q of cubics||[])d+=cubicApproxLength(q);return d;}
    function cubicKnotFractions(cubics){const src=cubics||[];if(!src.length)return[0,1];return buildRailArcMap(src).knots;}
    function polarSequence(cubics){const seq=[];for(let i=0;i<cubics.length;i++){const q=cubics[i];if(i===0)seq.push(q.p0);seq.push(q.c1,q.c2,q.p3);}let prev=null;const out=[];for(const p of seq){let a=Math.atan2(Number(p.y)||0,Number(p.x)||0);if(prev!==null){while(a-prev>Math.PI)a-=TWO_PI;while(a-prev<-Math.PI)a+=TWO_PI;}prev=a;out.push({r:Math.hypot(Number(p.x)||0,Number(p.y)||0),a});}return out;}
    function alignMinimalTurnPolarAngles(sp,dp){
        const n=Math.min(sp.length,dp.length);if(!n)return 0;let scale=0;for(let i=0;i<n;i++)scale=Math.max(scale,sp[i].r,dp[i].r);const radiusEps=Math.max(1e-6,scale*.0015);

        let meanNum=0,meanDen=0;
        for(let i=0;i<n;i++){const r=Math.max(sp[i].r,dp[i].r),w=r<=radiusEps?.01:(.08+.92*Math.min(1,r/Math.max(radiusEps,scale*.15)));meanNum+=(sp[i].a-dp[i].a)*w;meanDen+=w;}
        const k0=Math.round((meanNum/Math.max(1e-9,meanDen))/TWO_PI);let bestK=k0,bestCost=Infinity,bestMax=Infinity;
        for(let k=k0-2;k<=k0+2;k++){const shift=k*TWO_PI;let cost=0,maxAbs=0,weight=0;for(let i=0;i<n;i++){const r=Math.max(sp[i].r,dp[i].r),w=r<=radiusEps?.01:(.08+.92*Math.min(1,r/Math.max(radiusEps,scale*.15))),d=(dp[i].a+shift)-sp[i].a;cost+=d*d*w;maxAbs=Math.max(maxAbs,Math.abs(d));weight+=w;}cost/=Math.max(1e-9,weight);const score=cost+maxAbs*maxAbs*.08;if(score<bestCost-1e-12||(Math.abs(score-bestCost)<1e-12&&maxAbs<bestMax)){bestCost=score;bestMax=maxAbs;bestK=k;}}
        const globalPhaseK=bestK,shift=globalPhaseK*TWO_PI;for(let i=0;i<n;i++)dp[i].a+=shift;
        return globalPhaseK;
    }
    function packPairCubics(srcCubics,dstCubics,srcPresent,dstPresent,out,offset,spiralTransport='phaseCircle',profileMorphMode=String(state?.morph?.mode||'circleSlide'),forceCartesianPath=false){
        const n=Math.min(srcCubics.length,dstCubics.length);if(!n)return offset;const sp=polarSequence(srcCubics),dp=polarSequence(dstCubics);
        if(spiralTransport==='minimalTurn')alignMinimalTurnPolarAngles(sp,dp);else{const shift=Math.round((sp[0].a-dp[0].a)/TWO_PI)*TWO_PI;for(const p of dp)p.a+=shift;}
        if(profileMorphMode==='calm'){const lim=Math.PI*4;for(let i=0;i<Math.min(sp.length,dp.length);i++){const d=dp[i].a-sp[i].a;dp[i].a=sp[i].a+Math.max(-lim,Math.min(lim,d));}}
        const at=(arr,i,slot)=>arr[i*3+slot],minimal=spiralTransport==='minimalTurn',forceCartesian=profileMorphMode==='topology'||spiralTransport==='continuous'||spiralTransport==='topology';

        let pathMaxRadius=1e-9;for(let i=0;i<n;i++)for(let k=0;k<4;k++){const s=at(sp,i,k),d=at(dp,i,k);pathMaxRadius=Math.max(pathMaxRadius,s.r,d.r);}
        let pathMaxPolarTurn=0,pathNearOriginTurn=0,visibleTurnEnergy=0,visibleTurnWeight=0,outerMaxTurn=0,outerTurnEnergy=0,outerTurnWeight=0,outerSignedTurn=0;for(let i=0;i<n;i++)for(let k=0;k<4;k++){const s=at(sp,i,k),d=at(dp,i,k);const signed=d.a-s.a,turn=Math.abs(signed),r=Math.max(s.r,d.r);pathMaxPolarTurn=Math.max(pathMaxPolarTurn,turn);if(Math.min(s.r,d.r)<pathMaxRadius*.006)pathNearOriginTurn=Math.max(pathNearOriginTurn,turn);const w=Math.max(.01,r/pathMaxRadius);visibleTurnEnergy+=turn*turn*w;visibleTurnWeight+=w;if(r>=pathMaxRadius*.28){outerMaxTurn=Math.max(outerMaxTurn,turn);outerTurnEnergy+=turn*turn*w;outerSignedTurn+=signed*w;outerTurnWeight+=w;}}
        const visibleTurnRms=Math.sqrt(visibleTurnEnergy/Math.max(1e-9,visibleTurnWeight)),outerTurnRms=Math.sqrt(outerTurnEnergy/Math.max(1e-9,outerTurnWeight)),coherentOuterTurn=Math.abs(outerSignedTurn/Math.max(1e-9,outerTurnWeight));

        // Polar transport is what gives Phase / Phase-circle their circular motion, but a
        // changed winding can make one retained rail accumulate whole extra revolutions.
        // Never animate such a correspondence as a multi-turn spin: use the same retained
        // cubic endpoints with Cartesian transport for that one rail instead.  Minimal-turn
        // stays polar for all ordinary <= 180° moves and falls back only when a winding
        // mismatch makes a least-turn polar path impossible.
        const impossiblePolarWinding=pathMaxPolarTurn>Math.PI+1e-5||pathNearOriginTurn>Math.PI*.85;
        const phaseCircleSpinRisk=spiralTransport==='phaseCircle'&&(
            impossiblePolarWinding||
            (coherentOuterTurn>Math.PI*.92&&outerTurnRms>Math.PI*.72)||
            (outerMaxTurn>Math.PI*1.05&&visibleTurnRms>Math.PI*.70)
        );
        const phaseSpinRisk=spiralTransport==='phase'&&impossiblePolarWinding;
        const minimalSpinRisk=minimal&&impossiblePolarWinding;
        const pathCartesianFallback=forceCartesian||forceCartesianPath||phaseCircleSpinRisk||phaseSpinRisk||minimalSpinRisk;
        for(let i=0;i<n;i++){const s0=at(sp,i,0),s1=at(sp,i,1),s2=at(sp,i,2),s3=at(sp,i,3),d0=at(dp,i,0),d1=at(dp,i,1),d2=at(dp,i,2),d3=at(dp,i,3);const s=srcCubics[i],d=dstCubics[i],o=offset*FLOATS_PER_CUBIC;
            const localMaxPolarTurn=Math.max(Math.abs(d0.a-s0.a),Math.abs(d1.a-s1.a),Math.abs(d2.a-s2.a),Math.abs(d3.a-s3.a));
            out[o]=s0.r;out[o+1]=s0.a;out[o+2]=s1.r;out[o+3]=s1.a;out[o+4]=s2.r;out[o+5]=s2.a;out[o+6]=s3.r;out[o+7]=s3.a;out[o+8]=d0.r;out[o+9]=d0.a;out[o+10]=d1.r;out[o+11]=d1.a;out[o+12]=d2.r;out[o+13]=d2.a;out[o+14]=d3.r;out[o+15]=d3.a;out[o+16]=Math.max(.02,Number(s.widthScale0)||1);out[o+17]=Math.max(.02,Number(s.widthScale1)||1);out[o+18]=Math.max(.02,Number(d.widthScale0)||1);out[o+19]=Math.max(.02,Number(d.widthScale1)||1);const strictContinuous=spiralTransport==='phaseCircle'||spiralTransport==='minimalTurn',continuousPresence=strictContinuous||(spiralTransport!=='torn'&&profileMorphMode!=='fade');out[o+20]=continuousPresence?1:(srcPresent?1:0);out[o+21]=continuousPresence?1:(dstPresent?1:0);out[o+22]=pathCartesianFallback?1:0;out[o+23]=(i===0?1:0)+(i===n-1?2:0);offset++;}return offset;
    }
    function minimalTurnPathReference(path){
        const pts=path?.points||[];let fallback=0;
        for(const p of pts){const x=Number(p?.x)||0,y=Number(p?.y)||0,r=Math.hypot(x,y);if(r>1e-5)return Math.atan2(y,x);if(r>0)fallback=Math.atan2(y,x);}
        return fallback;
    }
    function shortestAngleDelta(a,b){let d=(Number(b)||0)-(Number(a)||0);while(d<=-Math.PI)d+=TWO_PI;while(d>Math.PI)d-=TWO_PI;return d;}
    function minimalTurnPathPairCost(a,b){
        const ap=a?.points||[],bp=b?.points||[];if(!ap.length||!bp.length){const d=shortestAngleDelta(minimalTurnPathReference(a),minimalTurnPathReference(b));return d*d;}

        const samples=Math.min(11,Math.max(3,Math.min(ap.length,bp.length))),at=(arr,q)=>arr[Math.min(arr.length-1,Math.max(0,Math.round(q*(arr.length-1))))];let cost=0,weight=0,maxR=1;
        for(const p of ap)maxR=Math.max(maxR,Math.hypot(Number(p?.x)||0,Number(p?.y)||0));for(const p of bp)maxR=Math.max(maxR,Math.hypot(Number(p?.x)||0,Number(p?.y)||0));
        for(let k=0;k<samples;k++){const q=samples===1?0:k/(samples-1),pa=at(ap,q),pb=at(bp,q),ar=Math.hypot(Number(pa?.x)||0,Number(pa?.y)||0),br=Math.hypot(Number(pb?.x)||0,Number(pb?.y)||0),visibility=Math.max(ar,br)/maxR,w=Math.max(.025,Math.min(1,visibility)),d=shortestAngleDelta(Math.atan2(Number(pa?.y)||0,Number(pa?.x)||0),Math.atan2(Number(pb?.y)||0,Number(pb?.x)||0)),radial=(ar-br)/maxR;cost+=(d*d*w)+.32*radial*radial;weight+=w+.32;}
        return cost/Math.max(1e-6,weight);
    }
    function minimalTurnRetainedBezierPairCost(a,b,srcLayer,dstLayer,srcMetrics=null,dstMetrics=null){
        try{

            const metrics=(path,layer,cache)=>{
                if(cache?.has(path))return cache.get(path);
                const cubics=endpointCubics(path,layer),map=cubics.length?buildRailArcMap(cubics):null,rec={cubics,map};
                try{cache?.set(path,rec);}catch(_){}
                return rec;
            };
            const am=metrics(a,srcLayer,srcMetrics).map,bm=metrics(b,dstLayer,dstMetrics).map;if(!am||!bm)return minimalTurnPathPairCost(a,b);
            const samples=13;let maxR=1;
            const samplePoint=(map,q)=>{const loc=railLocationAtFraction(map,q),e=map.entries[loc.index];return cubicPoint(e.q,loc.t);};
            for(let k=0;k<samples;k++){const q=k/(samples-1),pa=samplePoint(am,q),pb=samplePoint(bm,q);maxR=Math.max(maxR,Math.hypot(pa.x,pa.y),Math.hypot(pb.x,pb.y));}
            let cost=0,weight=0;for(let k=0;k<samples;k++){const q=k/(samples-1),pa=samplePoint(am,q),pb=samplePoint(bm,q),ar=Math.hypot(pa.x,pa.y),br=Math.hypot(pb.x,pb.y),w=Math.max(.02,Math.min(1,Math.max(ar,br)/maxR)),da=shortestAngleDelta(Math.atan2(pa.y,pa.x),Math.atan2(pb.y,pb.x)),dr=(ar-br)/maxR;cost+=da*da*w+.35*dr*dr;weight+=w+.35;}
            return cost/Math.max(1e-6,weight);
        }catch(_){return minimalTurnPathPairCost(a,b);}
    }
    function wrapUnit(v){v=Number(v)||0;v%=1;if(v<0)v+=1;return v;}
    function signedUnitDelta(a,b){let d=wrapUnit(b)-wrapUnit(a);while(d<=-.5)d+=1;while(d>.5)d-=1;return d;}
    function spiralBranchPhase(path,layer,fallbackIndex=0,total=1){
        const n=Math.max(2,Math.round(Number(layer?.N)||Math.max(2,total))),bi=Number(path?.spiralBranchIndex),rot=(Number(layer?.rotation)||0)/360;
        return wrapUnit((Number.isFinite(bi)?bi/n:fallbackIndex/Math.max(1,total))+rot);
    }
    function stableSpiralPairs(srcPaths,dstPaths,srcLayer=null,dstLayer=null,costFn=null){
        const src=(Array.isArray(srcPaths)?srcPaths:[]).map((path,i)=>({path,i,phase:spiralBranchPhase(path,srcLayer,i,srcPaths.length)})).sort((a,b)=>a.phase-b.phase||a.i-b.i);
        const dst=(Array.isArray(dstPaths)?dstPaths:[]).map((path,i)=>({path,i,phase:spiralBranchPhase(path,dstLayer,i,dstPaths.length)})).sort((a,b)=>a.phase-b.phase||a.i-b.i);
        if(!src.length||!dst.length)return[];
        const pairCost=(a,b)=>{if(typeof costFn==='function'){const c=Number(costFn(a.path,b.path));if(Number.isFinite(c))return c;}const d=signedUnitDelta(a.phase,b.phase);return d*d;};
        const pairs=[];
        if(src.length===dst.length){
            let bestShift=0,best=Infinity;for(let sh=0;sh<dst.length;sh++){let c=0;for(let i=0;i<src.length;i++)c+=pairCost(src[i],dst[(i+sh)%dst.length]);if(c<best){best=c;bestShift=sh;}}
            for(let i=0;i<src.length;i++)pairs.push({src:src[i].path,dst:dst[(i+bestShift)%dst.length].path,sourcePathPresent:true,targetPathPresent:true,stableSpiralPairing:true,stableShift:bestShift});
            return pairs;
        }
        if(src.length>dst.length){
            let bestShift=0,best=Infinity;for(let sh=0;sh<dst.length;sh++){let c=0;for(let i=0;i<src.length;i++){const j=(Math.floor(i*dst.length/src.length)+sh)%dst.length;c+=pairCost(src[i],dst[j]);}if(c<best){best=c;bestShift=sh;}}
            const candidates=[];for(let i=0;i<src.length;i++){const j=(Math.floor(i*dst.length/src.length)+bestShift)%dst.length;candidates.push({src:src[i].path,dst:dst[j].path,sourcePathPresent:true,targetPathPresent:false,radialMerge:true,stableSpiralPairing:true,_stableTarget:j,_stableCost:pairCost(src[i],dst[j])});}
            for(let j=0;j<dst.length;j++){let winner=null;for(const q of candidates)if(q._stableTarget===j&&(!winner||q._stableCost<winner._stableCost))winner=q;if(winner)winner.targetPathPresent=true;}
            return candidates;
        }
        let bestShift=0,best=Infinity;for(let sh=0;sh<src.length;sh++){let c=0;for(let j=0;j<dst.length;j++){const i=(Math.floor(j*src.length/dst.length)+sh)%src.length;c+=pairCost(src[i],dst[j]);}if(c<best){best=c;bestShift=sh;}}
        const candidates=[];for(let j=0;j<dst.length;j++){const i=(Math.floor(j*src.length/dst.length)+bestShift)%src.length;candidates.push({src:src[i].path,dst:dst[j].path,sourcePathPresent:false,targetPathPresent:true,radialSplit:true,stableSpiralPairing:true,_stableSource:i,_stableCost:pairCost(src[i],dst[j])});}
        for(let i=0;i<src.length;i++){let winner=null;for(const q of candidates)if(q._stableSource===i&&(!winner||q._stableCost<winner._stableCost))winner=q;if(winner)winner.sourcePathPresent=true;}
        return candidates;
    }
    function pairMinimalTurnSpiralPaths(srcPaths,dstPaths,srcLayer=null,dstLayer=null){
        const src=Array.isArray(srcPaths)?srcPaths:[],dst=Array.isArray(dstPaths)?dstPaths:[];
        const srcMetrics=new Map(),dstMetrics=new Map();
        const pairCost=(a,b)=>minimalTurnRetainedBezierPairCost(a,b,srcLayer,dstLayer,srcMetrics,dstMetrics);
        const pairs=stableSpiralPairs(src,dst,srcLayer,dstLayer,pairCost);
        for(const pair of pairs||[]){pair._sourceRetainedMetrics=srcMetrics.get(pair.src)||null;pair._targetRetainedMetrics=dstMetrics.get(pair.dst)||null;pair.minimalTurnStablePairing=true;}
        return pairs||[];
    }
    function splitCubicRailToCountExact(cubics,count,allowIdentity=false){
        const src=Array.isArray(cubics)?cubics:[],target=Math.max(0,Math.round(Number(count)||0));
        if(!src.length||target<src.length)return null;
        if(target===src.length)return allowIdentity?src:src.map(q=>({...q,p0:{...q.p0},c1:{...q.c1},c2:{...q.c2},p3:{...q.p3}}));
        const pieces=new Array(src.length).fill(1),extras=target-src.length;
        if(extras>0){
            const lengths=src.map(q=>cubicApproxLength(q)),total=Math.max(1e-9,lengths.reduce((a,b)=>a+b,0));
            const remainders=[];let assigned=0;
            for(let i=0;i<src.length;i++){
                const raw=extras*lengths[i]/total,whole=Math.floor(raw);pieces[i]+=whole;assigned+=whole;remainders.push({i,r:raw-whole});
            }
            remainders.sort((a,b)=>b.r-a.r||a.i-b.i);
            for(let k=0;k<extras-assigned;k++)pieces[remainders[k%remainders.length].i]++;
        }
        const out=[];
        for(let i=0;i<src.length;i++){
            const q=src[i],n=pieces[i],lw0=Math.log(Math.max(.02,Number(q.widthScale0)||1)),lw1=Math.log(Math.max(.02,Number(q.widthScale1)||1));
            for(let j=0;j<n;j++){
                const a=j/n,b=(j+1)/n,r=cubicSubsegment(q,a,b);
                r.widthScale0=Math.exp(lw0+(lw1-lw0)*a);r.widthScale1=Math.exp(lw0+(lw1-lw0)*b);out.push(r);
            }
        }
        return out.length===target?out:null;
    }
    function carrierLayerSpec(layer,branchIndex){
        try{if(typeof __spiroGetSpiralCarrierSpec==='function')return __spiroGetSpiralCarrierSpec(layer,branchIndex);}catch(_){}
        const N=Math.max(2,Math.round(Number(layer?.N)||4)),R=typeof getEffectiveLayerRadius==='function'?getEffectiveLayerRadius(layer,220):Math.max(1,Number(layer?.radius)||220),rot=((Number(layer?.rotation)||0)*Math.PI)/180,bi=Number.isFinite(Number(branchIndex))?Number(branchIndex):0,angle=bi/N*TWO_PI+rot-Math.PI/2,order=typeof getEffectiveSpiralOrder==='function'?getEffectiveSpiralOrder(layer):(Number(layer?.spiralOrder)||1),dir=order<0?-1:1,step=typeof getEffectiveSpiralStep==='function'?getEffectiveSpiralStep(layer):(Number(layer?.spiralStep ?? layer?.K)||1),ratio=typeof getSpiralClosureRatio==='function'?getSpiralClosureRatio():1.1,exp=Math.max(1e-9,Math.abs(order)||1),targetScale=Math.pow(Math.max(1.0000001,ratio),exp);
        return{anchor:{x:R*Math.cos(angle),y:R*Math.sin(angle)},radius:R,N,step,order,direction:dir,delta:TWO_PI*step/N*dir,targetScale,logScale:Math.log(targetScale),tangential:layer?.spiralTangential===true,closed:layer?.spiralClosed!==false,roundSeams:layer?.spiralRoundSeams!==false};
    }
    function copyProfileNodesForCarrier(srcLayer,dstLayer,t,scratch){
        const u=clamp(Number(t)||0,0,1),sa=Array.isArray(srcLayer?.profileNodes)&&srcLayer.profileNodes.length?srcLayer.profileNodes:[{x:0,y:0},{x:1,y:0}],da=Array.isArray(dstLayer?.profileNodes)&&dstLayer.profileNodes.length?dstLayer.profileNodes:sa;
        if(u<=1e-9)return sa.map(p=>({...p,x:Number(p?.x)||0,y:Number(p?.y)||0}));
        if(u>=1-1e-9)return da.map(p=>({...p,x:Number(p?.x)||0,y:Number(p?.y)||0}));
        const n=Math.max(sa.length,da.length),out=scratch||[];while(out.length<n)out.push({x:0,y:0});out.length=n;
        for(let i=0;i<n;i++){
            const a=sa[Math.min(i,sa.length-1)]||sa[sa.length-1],b=da[Math.min(i,da.length-1)]||da[da.length-1]||a,p=out[i];
            p.x=(Number(a?.x)||0)+((Number(b?.x)||0)-(Number(a?.x)||0))*u;p.y=(Number(a?.y)||0)+((Number(b?.y)||0)-(Number(a?.y)||0))*u;
            p.__profileCorner=u<.5?(a?.__profileCorner===true):(b?.__profileCorner===true);p.__profileKeyCorner=u<.5?(a?.__profileKeyCorner===true):(b?.__profileKeyCorner===true);
        }
        return out;
    }
    function buildCarrierMappedLayer(rec,t){
        const src=rec.sourceLayer,dst=rec.targetLayer,u=clamp(Number(t)||0,0,1),transport=String(rec.spiralTransport||'phaseCircle'),layer=rec.carrierFrameLayer||(rec.carrierFrameLayer={});Object.assign(layer,src);
        const sn=Math.max(2,Number(src?.N)||4),dn=Math.max(2,Number(dst?.N)||sn),sk=Math.max(1,Number(src?.K)||1),dk=Math.max(1,Number(dst?.K)||sk);
        let frameN=sn,frameK=sk;
        if(transport==='phase'){frameN=sn;frameK=sk+(dk-sk)*u;}
        else if(transport==='minimalTurn'){frameN=sn+(dn-sn)*u;frameK=sk;}
        else if(transport==='continuous'){frameN=sn;frameK=sk;}
        else {frameN=sn+(dn-sn)*u;frameK=sk+(dk-sk)*u;}
        layer.N=Math.max(2,Math.round(frameN));layer.K=Math.max(1,Math.round(frameK));
        const sr=typeof getEffectiveLayerRadius==='function'?getEffectiveLayerRadius(src,220):Math.max(1,Number(src?.radius)||220),dr=typeof getEffectiveLayerRadius==='function'?getEffectiveLayerRadius(dst,sr):Math.max(1,Number(dst?.radius)||sr),radius=sr+(dr-sr)*u;layer.radius=radius;layer.radiusMultiplier=1;
        layer.rotation=(Number(src?.rotation)||0)+((Number(dst?.rotation)||0)-(Number(src?.rotation)||0))*u;
        layer.rounding=(Number(src?.rounding)||0)+((Number(dst?.rounding)||0)-(Number(src?.rounding)||0))*u;
        layer.lineJoinType=u<.5?(src?.lineJoinType||'rounded'):(dst?.lineJoinType||src?.lineJoinType||'rounded');
        layer.spiralEnabled=true;layer.spiralClosed=src?.spiralClosed===dst?.spiralClosed?(src?.spiralClosed!==false):(u<.5?src?.spiralClosed!==false:dst?.spiralClosed!==false);layer.spiralTangential=src?.spiralTangential===dst?.spiralTangential?(src?.spiralTangential===true):(u<.5?src?.spiralTangential===true:dst?.spiralTangential===true);layer.spiralRoundSeams=src?.spiralRoundSeams===dst?.spiralRoundSeams?(src?.spiralRoundSeams!==false):(u<.5?src?.spiralRoundSeams!==false:dst?.spiralRoundSeams!==false);
        const so=Number(src?.spiralOrder)||0,to=Number(dst?.spiralOrder)||0;layer.spiralOrder=so+(to-so)*u;const ss=typeof getEffectiveSpiralStep==='function'?getEffectiveSpiralStep(src):(Number(src?.spiralStep ?? src?.K)||1),ts=typeof getEffectiveSpiralStep==='function'?getEffectiveSpiralStep(dst):(Number(dst?.spiralStep ?? dst?.K)||ss);
        if(transport==='continuous'||transport==='minimalTurn')layer.spiralStep=ss;
        else layer.spiralStep=ss+(ts-ss)*u;
        layer.spiralStepLinked=false;
        let mode;
        try{mode=typeof MorphRendering!=='undefined'&&typeof MorphRendering.resolveMorphProfileModeForRender==='function'?MorphRendering.resolveMorphProfileModeForRender(src?.profileMode,dst?.profileMode,u):(u<.5?(src?.profileMode||'segments'):(dst?.profileMode||src?.profileMode||'segments'));}catch(_){mode=u<.5?(src?.profileMode||'segments'):(dst?.profileMode||src?.profileMode||'segments');}
        layer.profileMode=mode;layer.profileNodes=copyProfileNodesForCarrier(src,dst,u,rec.carrierProfileScratch||(rec.carrierProfileScratch=[]));
        try{if(typeof setPreSampledSplineLayer==='function'&&typeof isPreSampledSplineLayer==='function'){const sampled=mode==='spline'&&((u<=1e-9&&isPreSampledSplineLayer(src))||(u>=1-1e-9&&isPreSampledSplineLayer(dst))||(u>1e-9&&u<1-1e-9&&isPreSampledSplineLayer(src)&&isPreSampledSplineLayer(dst)));setPreSampledSplineLayer(layer,sampled);}}catch(_){ }
        let preparedProfile=null;try{if(typeof __spiroPrepareSpiralCarrierProfile==='function'){preparedProfile=__spiroPrepareSpiralCarrierProfile(layer,{profileNodes:layer.profileNodes,roundingFrac:typeof getRoundingStrength==='function'?getRoundingStrength(layer.rounding):Math.max(0,Number(layer.rounding)||0)/100});if(preparedProfile)stats.carrierProfilePrepares++;}}catch(_){preparedProfile=null;}
        return{layer,radius,frameN,frameK,preparedProfile};
    }
    function carrierAnchorAt(specS,specD,t,cartesian){
        const u=clamp(Number(t)||0,0,1),a=specS.anchor,b=specD.anchor;
        if(cartesian)return{x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u};
        const ar=Math.hypot(a.x,a.y),br=Math.hypot(b.x,b.y),aa=Math.atan2(a.y,a.x),ba=Math.atan2(b.y,b.x),d=shortestAngleDelta(aa,ba),r=ar+(br-ar)*u,ang=aa+d*u;return{x:r*Math.cos(ang),y:r*Math.sin(ang)};
    }
    function rotateScaleCarrierPoint(p,delta,scale){const c=Math.cos(delta),q=Math.sin(delta),x=Number(p?.x)||0,y=Number(p?.y)||0,s=Math.max(1e-9,Number(scale)||1);return{x:(c*x-q*y)*s,y:(q*x+c*y)*s};}
    function carrierEndpoint(spec){return rotateScaleCarrierPoint(spec?.anchor||{x:0,y:0},Number(spec?.delta)||0,Math.max(1e-9,Number(spec?.targetScale)||1));}
    function unwrapAngleNear(angle,reference){let a=Number(angle)||0,r=Number(reference)||0;while(a-r>Math.PI)a-=TWO_PI;while(a-r<-Math.PI)a+=TWO_PI;return a;}
    function carrierFrameSpec(rec,r,t){
        const u=clamp(Number(t)||0,0,1),s=r.sourceCarrier,d=r.targetCarrier,transport=String(rec.spiralTransport||'phaseCircle');
        const sn=Math.max(2,Number(s?.N)||2),dn=Math.max(2,Number(d?.N)||sn),ss=Math.max(1e-9,Number(s?.step)||1),ds=Math.max(1e-9,Number(d?.step)||ss);
        const sdir=(Number(s?.direction)||1)<0?-1:1,ddir=(Number(d?.direction)||sdir)<0?-1:1,dir=sdir===ddir?sdir:(u<.5?sdir:ddir);
        let N=sn,step=ss,anchor,delta,targetScale,end,metric='polar-keypoints';
        if(transport==='continuous'){
            N=sn;step=ss;anchor=carrierAnchorAt(s,d,u,true);delta=TWO_PI*step/N*dir;targetScale=Math.exp((Number(s?.logScale)||0)+((Number(d?.logScale)||0)-(Number(s?.logScale)||0))*u);metric='cartesian-anchor-fixed-NK';
        }else if(transport==='phase'){
            N=sn;step=ss+(ds-ss)*u;anchor=carrierAnchorAt(s,d,u,false);delta=TWO_PI*step/N*dir;targetScale=Math.exp((Number(s?.logScale)||0)+((Number(d?.logScale)||0)-(Number(s?.logScale)||0))*u);metric='fixed-N-variable-K-polar';
        }else if(transport==='phaseCircle'){
            N=sn+(dn-sn)*u;step=ss+(ds-ss)*u;anchor=carrierAnchorAt(s,d,u,false);delta=TWO_PI*step/Math.max(2,N)*dir;targetScale=Math.exp((Number(s?.logScale)||0)+((Number(d?.logScale)||0)-(Number(s?.logScale)||0))*u);metric='phase-circle-clone-merge';
        }else if(transport==='minimalTurn'){
            N=sn+(dn-sn)*u;step=ss;anchor=carrierAnchorAt(s,d,u,false);delta=TWO_PI*step/Math.max(2,N)*dir;targetScale=Math.exp((Number(s?.logScale)||0)+((Number(d?.logScale)||0)-(Number(s?.logScale)||0))*u);metric='constant-step-least-turn';
        }else if(transport==='topology'){
            const sa=s?.anchor||{x:0,y:0},da=d?.anchor||sa,se=carrierEndpoint(s),de=carrierEndpoint(d);
            anchor={x:(Number(sa.x)||0)+((Number(da.x)||0)-(Number(sa.x)||0))*u,y:(Number(sa.y)||0)+((Number(da.y)||0)-(Number(sa.y)||0))*u};
            end={x:(Number(se.x)||0)+((Number(de.x)||0)-(Number(se.x)||0))*u,y:(Number(se.y)||0)+((Number(de.y)||0)-(Number(se.y)||0))*u};
            const ar=Math.max(1e-9,Math.hypot(anchor.x,anchor.y)),er=Math.max(1e-9,Math.hypot(end.x,end.y)),ref=(Number(s?.delta)||0)+((Number(d?.delta)||0)-(Number(s?.delta)||0))*u,raw=Math.atan2(end.y,end.x)-Math.atan2(anchor.y,anchor.x);
            delta=unwrapAngleNear(raw,ref);targetScale=er/ar;N=sn+(dn-sn)*u;step=Math.abs(delta)*Math.max(2,N)/TWO_PI;metric='cartesian-start-end-keypoints';
        }else{
            anchor=carrierAnchorAt(s,d,u,false);delta=(Number(s?.delta)||0)+((Number(d?.delta)||0)-(Number(s?.delta)||0))*u;targetScale=Math.exp((Number(s?.logScale)||0)+((Number(d?.logScale)||0)-(Number(s?.logScale)||0))*u);metric='legacy';
        }
        if(!end)end=rotateScaleCarrierPoint(anchor,delta,targetScale);
        const tangential=s?.tangential===d?.tangential?s?.tangential:(u<.5?s?.tangential:d?.tangential);
        return{anchor,end,delta,targetScale,N,step,direction:dir,tangential:Boolean(tangential),metric};
    }
    function rotateCarrierCubics(cubics,angle){
        const c=Math.cos(angle),sn=Math.sin(angle),rot=(p)=>({x:c*(Number(p?.x)||0)-sn*(Number(p?.y)||0),y:sn*(Number(p?.x)||0)+c*(Number(p?.y)||0)});
        return(cubics||[]).map(q=>{const p0=rot(q.p0),c1=rot(q.c1),c2=rot(q.c2),p3=rot(q.p3);return{...q,p0,c1,c2,p3};});
    }
    function ensureCarrierMappedCurrent(rec,t){
        if(!rec?.carrierMapped)return null;const tt=resolveEffectT(rec,t);if(Number.isFinite(rec.carrierCpuT)&&Math.abs(rec.carrierCpuT-tt)<1e-12&&rec.carrierPacked&&rec.carrierCurrentByPath)return rec.carrierPacked;
        const packed=rec.carrierPacked||(rec.carrierPacked=new Float32Array(rec.cubicCount*8)),byPath=rec.carrierCurrentByPath||(rec.carrierCurrentByPath=[]),frames=rec.carrierFrameSpecs||(rec.carrierFrameSpecs=[]);byPath.length=0;frames.length=0;
        const built=buildCarrierMappedLayer(rec,tt),layer=built.layer,radius=built.radius;let global=0,overflow=false;
        // 7.7 performance: for the circular Spiral transports every branch is the same
        // profile/carrier rail rotated around the origin. Build that expensive rail once per
        // compatible group and rotate the exact Bezier control points for sibling branches.
        // This preserves the 7.6 carrier/profile geometry byte-for-byte up to FP rotation noise,
        // while restoring the branch sharing that made 7.5 fast. Topology stays explicit because
        // its start/end key points are intentionally Cartesian and need not be rotational copies.
        const rotationalTemplates=new Map();
        const canRotateTemplate=rec.spiralTransport!=='topology'&&rec.spiralTransport!=='torn';
        for(let pi=0;pi<rec.carrierRecords.length;pi++){
            const r=rec.carrierRecords[pi];let cubics;
            if(tt<=1e-9){cubics=r.sc;frames.push(carrierFrameSpec(rec,r,0));}
            else if(tt>=1-1e-9){cubics=r.dc;frames.push(carrierFrameSpec(rec,r,1));}
            else{
                const frame=carrierFrameSpec(rec,r,tt);frames.push(frame);
                const ar=Math.hypot(Number(frame.anchor?.x)||0,Number(frame.anchor?.y)||0);
                const key=canRotateTemplate?`${r.count}|${r.profileTargetCount||0}|${Number(frame.delta).toPrecision(14)}|${Number(frame.targetScale).toPrecision(14)}|${frame.tangential?1:0}|${layer.spiralClosed!==false?1:0}|${layer.spiralRoundSeams!==false?1:0}`:'';
                const templ=key?rotationalTemplates.get(key):null;
                if(templ&&Math.abs(ar-templ.radius)<=Math.max(1e-7,templ.radius*1e-9)){
                    const da=Math.atan2(Number(frame.anchor.y)||0,Number(frame.anchor.x)||0)-templ.angle;
                    cubics=rotateCarrierCubics(templ.cubics,da);stats.carrierRotationalReuses=(stats.carrierRotationalReuses||0)+1;
                }else{
                    let path=null;try{if(typeof __spiroBuildSpiralCarrierPath==='function')path=__spiroBuildSpiralCarrierPath(layer,frame.anchor,{radius,delta:frame.delta,targetScale:frame.targetScale,tangential:frame.tangential,closed:layer.spiralClosed!==false,roundSeams:layer.spiralRoundSeams!==false,roundingFrac:typeof getRoundingStrength==='function'?getRoundingStrength(layer.rounding):Math.max(0,Number(layer.rounding)||0)/100,profileNodes:layer.profileNodes,preparedProfile:built.preparedProfile,branchIndex:r.currentBranchIndex,profileTargetCount:r.profileTargetCount});}catch(_){ }
                    const raw=path?endpointCubics(path,layer):[];cubics=splitCubicRailToCountExact(raw,r.count,path?.__carrierMapped===true);
                    if(cubics&&key){rotationalTemplates.set(key,{cubics,angle:Math.atan2(Number(frame.anchor.y)||0,Number(frame.anchor.x)||0),radius:ar});stats.carrierRotationalBuilds=(stats.carrierRotationalBuilds||0)+1;}
                }
                if(!cubics){overflow=true;cubics=r.sc.map((q,j)=>{const d=r.dc[Math.min(j,r.dc.length-1)]||q,lerp=(a,b)=>a+(b-a)*tt;return{p0:{x:lerp(q.p0.x,d.p0.x),y:lerp(q.p0.y,d.p0.y)},c1:{x:lerp(q.c1.x,d.c1.x),y:lerp(q.c1.y,d.c1.y)},c2:{x:lerp(q.c2.x,d.c2.x),y:lerp(q.c2.y,d.c2.y)},p3:{x:lerp(q.p3.x,d.p3.x),y:lerp(q.p3.y,d.p3.y)},widthScale0:Math.exp(Math.log(Math.max(.02,Number(q.widthScale0)||1))*(1-tt)+Math.log(Math.max(.02,Number(d.widthScale0)||1))*tt),widthScale1:Math.exp(Math.log(Math.max(.02,Number(q.widthScale1)||1))*(1-tt)+Math.log(Math.max(.02,Number(d.widthScale1)||1))*tt)};});}
            }
            byPath.push(cubics);for(const q of cubics){const o=global*8;packed[o]=q.p0.x;packed[o+1]=q.p0.y;packed[o+2]=q.c1.x;packed[o+3]=q.c1.y;packed[o+4]=q.c2.x;packed[o+5]=q.c2.y;packed[o+6]=q.p3.x;packed[o+7]=q.p3.y;global++;}
        }
        if(global!==rec.cubicCount)return null;rec.carrierCpuT=tt;rec.carrierOverflow=overflow;return packed;
    }

    function buildLayerCpuResource(layerIndex){
        const srcLayer=runtimeState.morph?.renderSourceLayers?.[layerIndex],dstLayer=runtimeState.morph?.renderTargetLayers?.[layerIndex];if(!srcLayer||!dstLayer)return null;
        if(!(srcLayer.spiralEnabled===true||dstLayer.spiralEnabled===true))return null;if(state?.fourierMode===true)return null;
        const spiralTransport=typeof getSpiralMorphType==='function'?getSpiralMorphType():String(state?.morph?.spiralMorphType||'phaseCircle');
        const profileMorphMode=String(state?.morph?.mode||'circleSlide');
        const carrierMappedEligible=srcLayer?.spiralEnabled===true&&dstLayer?.spiralEnabled===true&&spiralTransport!=='torn'&&profileMorphMode!=='fade';
        let srcPaths=buildOrbitPolylines(srcLayer)||[],dstPaths=buildOrbitPolylines(dstLayer)||[];if(!srcPaths.length||!dstPaths.length)return null;const pairs=spiralTransport==='minimalTurn'?pairMinimalTurnSpiralPaths(srcPaths,dstPaths,srcLayer,dstLayer):stableSpiralPairs(srcPaths,dstPaths,srcLayer,dstLayer);if(!pairs.length)return null;

        const records=[];let cubicCount=0;
        for(let pairIndex=0;pairIndex<pairs.length;pairIndex++){
            const pair=pairs[pairIndex],sourceMetrics=pair._sourceRetainedMetrics||null,targetMetrics=pair._targetRetainedMetrics||null,rawSc=sourceMetrics?.cubics||endpointCubics(pair.src,srcLayer),rawDc=targetMetrics?.cubics||endpointCubics(pair.dst,dstLayer);if(!rawSc.length||!rawDc.length)continue;

            const sourceRawArcMap=sourceMetrics?.map||buildRailArcMap(rawSc),targetRawArcMap=targetMetrics?.map||buildRailArcMap(rawDc),sourceRawKnotFractions=sourceRawArcMap.knots,targetRawKnotFractions=targetRawArcMap.knots;
            const crossFamily=Boolean(srcLayer?.spiralEnabled===true)!==Boolean(dstLayer?.spiralEnabled===true),crossFamilyCartesianTransport=crossFamily&&(spiralTransport==='phaseCircle'||spiralTransport==='minimalTurn'||spiralTransport==='phase'||spiralTransport==='topology');

            let sc,dc,n,commonFractions,arcEqualized=false,exactSubdivisionOnly=false;
            if(carrierMappedEligible||spiralTransport==='torn'){
                n=Math.max(rawSc.length,rawDc.length);sc=splitCubicRailToCountExact(rawSc,n);dc=splitCubicRailToCountExact(rawDc,n);
                if(sc&&dc){exactSubdivisionOnly=true;commonFractions=cubicKnotFractions(sc);}else{const eq=equalizeCubicRailsByArc(rawSc,rawDc,sourceRawArcMap,targetRawArcMap);sc=eq.source;dc=eq.target;n=Math.min(sc.length,dc.length);commonFractions=eq.fractions.slice(0,n+1);arcEqualized=true;}
            }else{
                const eq=equalizeCubicRailsByArc(rawSc,rawDc,sourceRawArcMap,targetRawArcMap);sc=eq.source;dc=eq.target;n=Math.min(sc.length,dc.length);commonFractions=eq.fractions.slice(0,n+1);arcEqualized=true;
            }
            if(!n||!sc?.length||!dc?.length)continue;
            const sp=cubicRailPoints(sc),dp=cubicRailPoints(dc),sourceClosure=periodicClosureSpec(pair.src,rawSc,srcLayer),targetClosure=periodicClosureSpec(pair.dst,rawDc,dstLayer);records.push({pair,sp,dp,sc:sc.slice(0,n),dc:dc.slice(0,n),count:n,closed:Boolean(pair?.src?.closed&&pair?.dst?.closed),sourceClosure,targetClosure,periodic:Boolean(sourceClosure.periodic&&targetClosure.periodic),sourceRawCubics:rawSc,targetRawCubics:rawDc,sourceRawKnotFractions,targetRawKnotFractions,sourceLampKeyFractions:authoredFlagFractions(pair.src,sourceRawArcMap,'key'),targetLampKeyFractions:authoredFlagFractions(pair.dst,targetRawArcMap,'key'),sourceCornerFractions:authoredFlagFractions(pair.src,sourceRawArcMap,'corner'),targetCornerFractions:authoredFlagFractions(pair.dst,targetRawArcMap,'corner'),sourcePathLength:sourceRawArcMap.total,targetPathLength:targetRawArcMap.total,knotFractions:commonFractions||cubicKnotFractions(sc),arcEqualized,exactSubdivisionOnly,crossFamilyCartesianTransport});cubicCount+=n;
        }
        if(!cubicCount)return null;const data=new Float32Array(cubicCount*FLOATS_PER_CUBIC);let ci=0;for(const r of records)ci=packPairCubics(r.sc,r.dc,r.pair.sourcePathPresent!==false,r.pair.targetPathPresent!==false,data,ci,spiralTransport,profileMorphMode,r.crossFamilyCartesianTransport===true);
        const topologyMergeSplitCount=records.reduce((n,r)=>n+((r.pair.sourcePathPresent!==false)!==(r.pair.targetPathPresent!==false)?1:0),0);
        let cartesianFallbackCubics=0,maxPackedPolarTurn=0;for(let i=0;i<cubicCount;i++){const o=i*FLOATS_PER_CUBIC;if(data[o+22]>.5)cartesianFallbackCubics++;for(let k=0;k<4;k++)maxPackedPolarTurn=Math.max(maxPackedPolarTurn,Math.abs(data[o+9+k*2]-data[o+1+k*2]));}
        const pathCount=records.length,cpuSegmentMeta=new Uint32Array(cubicCount*4),cpuPathSegmentRanges=new Uint32Array(pathCount*4),pathRanges=new Uint32Array(pathCount*4),cpuPathPeriodic=new Uint32Array(pathCount),cpuEndpointPathLengths=new Float32Array(pathCount*2),cpuPathKnotFractions=new Array(pathCount),cpuPathLampKeyFractions=new Array(pathCount),cpuPathCornerFractions=new Array(pathCount),cpuPathClosure=new Float32Array(pathCount*8);let seg=0,pointBase=0,maxEndpointClosureError=0,maxEndpointTangentClosureError=0;
        for(let pi=0;pi<records.length;pi++){
            const rec0=records[pi],n=rec0.sc.length,po=pi*4;cpuPathSegmentRanges[po]=seg;cpuPathSegmentRanges[po+1]=n;cpuPathSegmentRanges[po+2]=pointBase;cpuPathSegmentRanges[po+3]=n+1;
            pathRanges[po]=pointBase;pathRanges[po+1]=n+1;pathRanges[po+2]=rec0.closed?1:0;pathRanges[po+3]=pi;
            const co=pi*8,sc0=rec0.sourceClosure||{},dc0=rec0.targetClosure||{};cpuPathClosure[co]=Number(sc0.delta)||0;cpuPathClosure[co+1]=Number(sc0.logScale)||0;cpuPathClosure[co+2]=Number(dc0.delta)||0;cpuPathClosure[co+3]=Number(dc0.logScale)||0;cpuPathClosure[co+4]=sc0.periodic?1:0;cpuPathClosure[co+5]=dc0.periodic?1:0;cpuPathClosure[co+6]=(sc0.periodic&&dc0.periodic)?1:0;cpuPathClosure[co+7]=(sc0.tangentProtected?1:0)+(dc0.tangentProtected?2:0);maxEndpointClosureError=Math.max(maxEndpointClosureError,Number(sc0.error)||0,Number(dc0.error)||0);maxEndpointTangentClosureError=Math.max(maxEndpointTangentClosureError,sc0.tangentProtected?(Number(sc0.tangentError)||0):0,dc0.tangentProtected?(Number(dc0.tangentError)||0):0);

            cpuPathPeriodic[pi]=(sc0.periodic&&dc0.periodic&&cpuPathClosure[co+6]>.5)?1:0;
            cpuEndpointPathLengths[pi*2]=Math.max(1e-9,Number(rec0.sourcePathLength)||cubicRailLength(rec0.sc));cpuEndpointPathLengths[pi*2+1]=Math.max(1e-9,Number(rec0.targetPathLength)||cubicRailLength(rec0.dc));

            cpuPathKnotFractions[pi]={source:rec0.sourceRawKnotFractions||cubicKnotFractions(rec0.sourceRawCubics),target:rec0.targetRawKnotFractions||cubicKnotFractions(rec0.targetRawCubics),common:rec0.knotFractions||cubicKnotFractions(rec0.sc)};
            cpuPathLampKeyFractions[pi]={source:rec0.sourceLampKeyFractions||[0,1],target:rec0.targetLampKeyFractions||[0,1]};
            cpuPathCornerFractions[pi]={source:rec0.sourceCornerFractions||[],target:rec0.targetCornerFractions||[]};
            for(let j=0;j<n;j++,seg++){const o=seg*4,sq=rec0.sc[j],dq=rec0.dc[j];let flags=0;const s0=sq?.__profileCorner0===true,s1=sq?.__profileCorner1===true,t0=dq?.__profileCorner0===true,t1=dq?.__profileCorner1===true;if(s0)flags|=0x01000000;if(s1)flags|=0x02000000;if(t0)flags|=0x04000000;if(t1)flags|=0x08000000;if(s0||t0)flags|=0x40000000;if(s1||t1)flags|=0x80000000;cpuSegmentMeta[o]=pointBase+j;cpuSegmentMeta[o+1]=pointBase+j+1;cpuSegmentMeta[o+2]=pi;cpuSegmentMeta[o+3]=flags>>>0;}pointBase+=n+1;
        }
        const carrierMapped=carrierMappedEligible;
        let carrierFirst=0;for(let ri=0;ri<records.length;ri++){const r=records[ri],sbi=Number(r.pair?.src?.spiralBranchIndex),dbi=Number(r.pair?.dst?.spiralBranchIndex);r.firstSegment=carrierFirst;carrierFirst+=r.count;r.sourceCarrier=carrierLayerSpec(srcLayer,Number.isFinite(sbi)?sbi:ri);r.targetCarrier=carrierLayerSpec(dstLayer,Number.isFinite(dbi)?dbi:ri);r.currentBranchIndex=Number.isFinite(sbi)?sbi:(Number.isFinite(dbi)?dbi:ri);r.profileTargetCount=0;}
        const auxPairs=records.map((r,pairIndex)=>({source:r.sp,target:r.dp,sourcePresent:r.pair.sourcePathPresent!==false,targetPresent:r.pair.targetPathPresent!==false,closed:r.closed===true,points:[],pairIndex,sourceBranchIndex:Number(r.pair?.src?.spiralBranchIndex),targetBranchIndex:Number(r.pair?.dst?.spiralBranchIndex),sourceBranchCount:Math.max(2,Math.round(Number(srcLayer?.N)||records.length)),targetBranchCount:Math.max(2,Math.round(Number(dstLayer?.N)||records.length)),branchPhase:0}));const allClosed=records.length>0&&records.every(r=>r.closed===true);
        const interpolationMetric=spiralTransport==='topology'?'cartesian-keypoints':(spiralTransport==='continuous'?'cartesian':(spiralTransport==='minimalTurn'?'least-turn-polar':(spiralTransport==='torn'?(profileMorphMode==='topology'?'cartesian':'profile-mode'):(profileMorphMode==='calm'?'polar-calm':'polar'))));
        return{layerIndex,sourceLayer:srcLayer,targetLayer:dstLayer,carrierMapped,carrierRecords:records,carrierCpuT:NaN,carrierPacked:null,carrierCurrentByPath:null,carrierOverflow:false,carrierUploadedT:NaN,carrierUploadedGeneration:-1,phaseSerial:Number(runtimeState.morph?.gpuPhasePrepareSerial)||0,morphType:spiralTransport,spiralTransport,profileMorphMode,interpolationMetric,sourceSpline:srcLayer?.profileMode==='spline',targetSpline:dstLayer?.profileMode==='spline',data,cubicCount,segmentCount:cubicCount,pathCount,pointCount:pointBase,allClosed,topologyMergeSplitCount,continuousTopologyTransport:spiralTransport==='phaseCircle'||spiralTransport==='minimalTurn'||(spiralTransport!=='torn'&&profileMorphMode!=='fade'),stableSpiralPairing:records.every(r=>r.pair?.stableSpiralPairing===true),exactSubdivisionOnly:records.every(r=>r.exactSubdivisionOnly===true),arcEqualizedRecords:records.filter(r=>r.arcEqualized===true).length,cartesianFallbackCubics,maxPackedPolarTurn,topologySignature:`spiral-bezier:${profileMorphMode}:${spiralTransport}:${layerIndex}:${pathCount}:${cubicCount}:${srcLayer?.profileMode==='spline'?'S':'G'}${dstLayer?.profileMode==='spline'?'S':'G'}:${records.map(r=>r.closed?1:0).join('')}`,cpuSegmentMeta,cpuPathSegmentRanges,cpuPathRanges:pathRanges,cpuPathPeriodic,cpuEndpointPathLengths,cpuPathKnotFractions,cpuPathLampKeyFractions,cpuPathCornerFractions,cpuPathClosure,maxEndpointClosureError,maxEndpointTangentClosureError,pathRanges,auxPairs,buffer:null,bind:null,uniformBase:null,uniformGlow:null,uniformBaseBind:null,uniformGlowBind:null,cubicBuffer:null,cubicUniformBuffer:null,cubicBind:null,pathRangeBuffer:null,segmentMetaBuffer:null,pathSegmentRangeBuffer:null,pathClosureBuffer:null,closureBind:null,tangentRepairBind:null,bezierVisualRail:true,bezierSubdiv:SUBDIV,arcSubdiv:ARC_SUBDIV,specialSpiralBezierRail:true,exactEndpointCubics:true,gpuOnlySpiralEffects:true,copyBuffer:null,copyBind:null,copyCapacity:0,copyData:new Float32Array(0),copyPackedFrameId:-1,copyPackedCount:0,copyPackedMultiColor:false,auxT:NaN,lastCubicT:NaN,currentCubicsCommittedFrameId:-1,currentCubicsCommittedT:NaN,currentCubicsRootProducerFrameId:-1,currentCubicsRootProducerT:NaN,ready:false};
    }
    async function preparePhase(){
        if(!(state?.morph?.mode==='circleSlide'||(typeof spiralMorphUsesRetainedBezierRail==='function'&&spiralMorphUsesRetainedBezierRail()))){retireCurrentResources('prepare-ineligible');return 0;}
        if(!await ensureReady()){retireCurrentResources('prepare-unavailable');return 0;}
        const nextResources=new Map();let built=0;
        try{
            for(let i=0;i<(state.layers?.length||0);i++){
                const rec=buildLayerCpuResource(i);if(!rec)continue;
                rec.buffer=device.createBuffer({label:`Somata Spiral Bézier Morph L${i}`,size:Math.max(96,Math.ceil(rec.data.byteLength/16)*16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(rec.buffer,0,rec.data.buffer,rec.data.byteOffset,rec.data.byteLength);
                rec.cubicBuffer=device.createBuffer({label:`Somata Spiral Bézier shared current cubics L${i}`,size:Math.max(32,rec.cubicCount*32),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
                rec.fastRailBuffer=device.createBuffer({label:`Somata 7.5 Spiral Fast Visual Rail L${i}`,size:Math.max(32,rec.cubicCount*SUBDIV*32),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
                rec.cubicUniformBuffer=device.createBuffer({label:`Somata Spiral Bézier shared cubic phase L${i}`,size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                rec.bind=device.createBindGroup({layout:renderCubicLayout,entries:[{binding:0,resource:{buffer:rec.fastRailBuffer}}]});
                rec.cubicBind=device.createBindGroup({layout:effectCubicPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rec.buffer}},{binding:1,resource:{buffer:rec.cubicBuffer}},{binding:2,resource:{buffer:rec.cubicUniformBuffer}}]});
                rec.fastRailBind=device.createBindGroup({layout:fastRailPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rec.buffer}},{binding:1,resource:{buffer:rec.cubicBuffer}},{binding:2,resource:{buffer:rec.fastRailBuffer}},{binding:3,resource:{buffer:rec.cubicUniformBuffer}}]});
                rec.pathRangeBuffer=device.createBuffer({label:`Somata Spiral Bézier effect path ranges L${i}`,size:Math.max(16,rec.pathRanges.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(rec.pathRangeBuffer,0,rec.pathRanges);
                rec.segmentMetaBuffer=device.createBuffer({label:`Somata Spiral Bézier effect segment metadata L${i}`,size:Math.max(16,rec.cpuSegmentMeta.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(rec.segmentMetaBuffer,0,rec.cpuSegmentMeta);
                rec.pathSegmentRangeBuffer=device.createBuffer({label:`Somata Spiral Bézier effect segment ranges L${i}`,size:Math.max(16,rec.cpuPathSegmentRanges.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(rec.pathSegmentRangeBuffer,0,rec.cpuPathSegmentRanges);
                rec.pathClosureBuffer=device.createBuffer({label:`Somata 7.5 Spiral periodic closure L${i}`,size:Math.max(32,rec.cpuPathClosure.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(rec.pathClosureBuffer,0,rec.cpuPathClosure);
                rec.closureBind=device.createBindGroup({layout:closurePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rec.cubicBuffer}},{binding:1,resource:{buffer:rec.pathSegmentRangeBuffer}},{binding:2,resource:{buffer:rec.pathClosureBuffer}},{binding:3,resource:{buffer:rec.cubicUniformBuffer}}]});
                rec.tangentRepairBind=device.createBindGroup({layout:tangentRepairPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:rec.cubicBuffer}},{binding:1,resource:{buffer:rec.segmentMetaBuffer}},{binding:2,resource:{buffer:rec.cubicUniformBuffer}}]});
                rec.uniformBase=device.createBuffer({label:`Somata Spiral Bézier Morph base uniforms L${i}`,size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});rec.uniformGlow=device.createBuffer({label:`Somata Spiral Bézier Morph glow uniforms L${i}`,size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                rec.uniformBaseBind=device.createBindGroup({layout:renderUniformLayout,entries:[{binding:0,resource:{buffer:rec.uniformBase}}]});rec.uniformGlowBind=device.createBindGroup({layout:renderUniformLayout,entries:[{binding:0,resource:{buffer:rec.uniformGlow}}]});rec.ready=true;nextResources.set(i,rec);built++;stats.layerBuilds++;stats.uploads+=rec.data.byteLength;stats.cubics+=rec.cubicCount;stats.gpuSegments+=rec.cubicCount*SUBDIV;stats.fastRailSegments+=rec.cubicCount*SUBDIV;
            }
            replaceResources(nextResources,'phase-atomic-swap');
            stats.phaseBuilds++;return built;
        }catch(err){
            for(const rec of nextResources.values())destroyResource(rec);
            retireCurrentResources('prepare-error');
            lastError=String(err?.message||err);stats.errors++;return 0;
        }
    }

    function getStaticVisualResource(frameCtx){
        if(!frameCtx||frameCtx.morphFrameActive||typeof isSpiralLayer!=='function'||!isSpiralLayer(frameCtx.layer))return null;
        if(!ready||!device)return null;
        try{warmupGpuMorphArcResource?.();}catch(_){}
        const source=typeof getStaticSpiralBezierResource==='function'?getStaticSpiralBezierResource(frameCtx.layerIndex,device,generation):null;
        if(!source?.ready||!source.cubicBuffer||!(source.cubicCount>0))return null;
        const key=Number(frameCtx.layerIndex)||0,old=staticVisualResources.get(key);
        if(old?.source===source&&old?.generation===generation&&old?.ready){stats.staticVisualHits++;return old;}
        if(old)destroyStaticVisual(old);
        try{
            const meta=new Float32Array(source.cubicCount*24);
            for(let i=0;i<source.cubicCount;i++){const o=i*24,w0=Math.max(.02,Number(source.cpuCubicWidthScales?.[i*2])||1),w1=Math.max(.02,Number(source.cpuCubicWidthScales?.[i*2+1])||1);meta[o+16]=w0;meta[o+17]=w1;meta[o+18]=w0;meta[o+19]=w1;meta[o+20]=1;meta[o+21]=1;}for(let pi=0;pi<(source.pathCount||0);pi++){const ro=pi*4,first=source.cpuPathSegmentRanges?.[ro]>>>0,count=source.cpuPathSegmentRanges?.[ro+1]>>>0;if(!count)continue;meta[first*24+23]=meta[first*24+23]+1;meta[(first+count-1)*24+23]=meta[(first+count-1)*24+23]+2;}
            const metaBuffer=device.createBuffer({label:`Somata static Spiral visual metadata L${key}`,size:Math.max(96,meta.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
            device.queue.writeBuffer(metaBuffer,0,meta);
            const uniformBase=device.createBuffer({label:`Somata static Spiral base uniforms L${key}`,size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
            const uniformGlow=device.createBuffer({label:`Somata static Spiral glow uniforms L${key}`,size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
            const fastRailBuffer=device.createBuffer({label:`Somata 7.5 static Spiral Fast Visual Rail L${key}`,size:Math.max(32,source.cubicCount*SUBDIV*32),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
            const fastUniformBuffer=device.createBuffer({label:`Somata 7.5 static Spiral Fast Rail uniform L${key}`,size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const fastRaw=new ArrayBuffer(32),fastU32=new Uint32Array(fastRaw),fastF32=new Float32Array(fastRaw);fastU32[0]=source.cubicCount>>>0;fastF32[4]=0;device.queue.writeBuffer(fastUniformBuffer,0,fastRaw);
            const fastRailBind=device.createBindGroup({layout:fastRailPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:metaBuffer}},{binding:1,resource:{buffer:source.cubicBuffer}},{binding:2,resource:{buffer:fastRailBuffer}},{binding:3,resource:{buffer:fastUniformBuffer}}]});
            {const enc=device.createCommandEncoder({label:`Somata 7.5 static Spiral Fast Rail L${key}`});const pass=enc.beginComputePass({label:`Somata 7.5 static Spiral Fast Rail L${key}`});pass.setPipeline(fastRailPipeline);pass.setBindGroup(0,fastRailBind);pass.dispatchWorkgroups(Math.ceil(source.cubicCount*SUBDIV/128));pass.end();device.queue.submit([enc.finish()]);stats.fastRailDispatches++;stats.fastRailSegments+=source.cubicCount*SUBDIV;}
            const rec={source,generation,layerIndex:key,phaseSerial:0,staticVisual:true,ready:true,cubicCount:source.cubicCount,pathCount:source.pathCount||0,cubicBuffer:source.cubicBuffer,metaBuffer,fastRailBuffer,fastUniformBuffer,fastRailBind,bind:device.createBindGroup({layout:renderCubicLayout,entries:[{binding:0,resource:{buffer:fastRailBuffer}}]}),uniformBase,uniformGlow,uniformBaseBind:device.createBindGroup({layout:renderUniformLayout,entries:[{binding:0,resource:{buffer:uniformBase}}]}),uniformGlowBind:device.createBindGroup({layout:renderUniformLayout,entries:[{binding:0,resource:{buffer:uniformGlow}}]}),copyBuffer:null,copyBind:null,copyCapacity:0,copyData:new Float32Array(0),copyPackedFrameId:-1,copyPackedCount:0,copyPackedMultiColor:false,currentCubicsRootProducerFrameId:-1,currentCubicsRootProducerT:0,fastRailRootProducerFrameId:-1,fastRailRootProducerT:0};
            staticVisualResources.set(key,rec);stats.staticVisualBuilds++;stats.uploads+=meta.byteLength;return rec;
        }catch(err){lastError=String(err?.message||err);stats.errors++;return null;}
    }
    function getVisualResource(frameCtx){return frameCtx?.morphFrameActive?getResource(frameCtx.layerIndex):getStaticVisualResource(frameCtx);}
    function resolveEffectT(rec,t){let tt=clamp(Number(t)||0,0,1);const currentPhaseSerial=Number(runtimeState.morph?.gpuPhasePrepareSerial)||0;if(runtimeState.morph?.gpuPhasePreparing===true&&Number(rec?.phaseSerial)!==currentPhaseSerial)tt=clamp(Number(runtimeState.morph?.gpuPhaseHandoffT),0,1);return tt;}
    function resolveProfileModeTransitionT(rec,t){
        const tt=Math.max(0,Math.min(1,Number(t)||0));
        if(rec?.sourceSpline===rec?.targetSpline)return tt;
        try{if(typeof profileModeTransitionProgress==='function')return Math.max(0,Math.min(1,Number(profileModeTransitionProgress(tt))||0));}catch(_){}
        const mode=state?.morph?.profileModeTransition==='second'?'second':'phase';
        let u=(runtimeState?.morph?.active===true&&Number.isFinite(Number(runtimeState.morph.progress)))?Math.max(0,Math.min(1,Number(runtimeState.morph.progress)||0)):tt;
        if(mode==='second'){const cycleMs=Math.max(100,Number(runtimeState?.morph?.transitionMs)||Math.max(.5,Number(state?.morph?.intervalSec)||5)*1000);u=Math.min(1,u/Math.min(1,1000/cycleMs));}
        return u*u*(3-2*u);
    }

    function encodeEffectCubics(rec,encoder,t){
        if(!rec?.ready||!rec.cubicBind||!effectCubicPipeline||!encoder)return false;
        const tt=resolveEffectT(rec,t),raw=rec.cubicUniformStaging||(rec.cubicUniformStaging=new ArrayBuffer(32)),u32=rec.cubicUniformU32||(rec.cubicUniformU32=new Uint32Array(raw)),f32=rec.cubicUniformF32||(rec.cubicUniformF32=new Float32Array(raw));
        u32[0]=rec.cubicCount>>>0;f32[4]=tt;f32[5]=resolveProfileModeTransitionT(rec,tt);f32[6]=rec.sourceSpline===true?1:0;f32[7]=rec.targetSpline===true?1:0;device.queue.writeBuffer(rec.cubicUniformBuffer,0,raw);
        if(rec.carrierMapped===true){
            const packed=ensureCarrierMappedCurrent(rec,tt);if(!packed){stats.carrierMappedFallbacks++;return false;}
            // queue.writeBuffer is queue-ordered, not encoder-local.  Web/Lightning/Fill/Glow/Base
            // may all ask for the same current rail in one frame; upload it once and let every
            // consumer read the same resident cubic buffer, just as the 7.5 GPU path did.
            if(Number.isFinite(rec.carrierUploadedT)&&Math.abs(rec.carrierUploadedT-tt)<1e-12&&rec.carrierUploadedGeneration===generation){stats.carrierMappedUploadSkips++;}
            else{device.queue.writeBuffer(rec.cubicBuffer,0,packed.buffer,packed.byteOffset,packed.byteLength);stats.uploads+=packed.byteLength;stats.carrierMappedUploads+=packed.byteLength;stats.carrierMappedFrames++;rec.carrierUploadedT=tt;rec.carrierUploadedGeneration=generation;}
            rec.lastCubicT=tt;return true;
        }
        let pass=encoder.beginComputePass({label:`Somata Spiral shared effect cubics L${rec.layerIndex}`});pass.setPipeline(effectCubicPipeline);pass.setBindGroup(0,rec.cubicBind);pass.dispatchWorkgroups(Math.ceil(rec.cubicCount/128));pass.end();
        if(rec.closureBind&&closurePipeline&&rec.pathCount>0){pass=encoder.beginComputePass({label:`Somata 7.5 Spiral periodic closure L${rec.layerIndex}`});pass.setPipeline(closurePipeline);pass.setBindGroup(0,rec.closureBind);pass.dispatchWorkgroups(Math.ceil(rec.pathCount/64));pass.end();}
        if(rec.tangentRepairBind&&tangentRepairPipeline&&rec.cubicCount>1){pass=encoder.beginComputePass({label:`Somata 7.5 Spiral topology tangent repair L${rec.layerIndex}`});pass.setPipeline(tangentRepairPipeline);pass.setBindGroup(0,rec.tangentRepairBind);pass.dispatchWorkgroups(Math.ceil(Math.max(0,rec.cubicCount-1)/128));pass.end();stats.tangentRepairDispatches++;}
        rec.lastCubicT=tt;stats.cubicComputeDispatches++;return true;
    }
    function encodeFastRail(rec,encoder,t){
        if(!rec?.ready||!encoder||!fastRailPipeline||!rec.fastRailBind)return false;if(rec.staticVisual===true)return true;
        const tt=resolveEffectT(rec,t),raw=rec.cubicUniformStaging||(rec.cubicUniformStaging=new ArrayBuffer(32)),u32=rec.cubicUniformU32||(rec.cubicUniformU32=new Uint32Array(raw)),f32=rec.cubicUniformF32||(rec.cubicUniformF32=new Float32Array(raw));u32[0]=rec.cubicCount>>>0;f32[4]=tt;f32[5]=resolveProfileModeTransitionT(rec,tt);f32[6]=rec.sourceSpline===true?1:0;f32[7]=rec.targetSpline===true?1:0;device.queue.writeBuffer(rec.cubicUniformBuffer,0,raw);
        const pass=encoder.beginComputePass({label:`Somata 7.5 Spiral Fast Visual Rail L${rec.layerIndex}`});pass.setPipeline(fastRailPipeline);pass.setBindGroup(0,rec.fastRailBind);pass.dispatchWorkgroups(Math.ceil(rec.cubicCount*SUBDIV/128));pass.end();stats.fastRailDispatches++;return true;
    }
    function canReuseOrderedFastRail(rec,frameCtx,target,currentT){const fid=Math.max(0,Number(frameCtx?.frameId)||0),tt=rec?.staticVisual===true?0:resolveEffectT(rec,currentT);return Boolean(rec?.ready&&(target?.deferred===true||target?.deferredFrame===true)&&Number(rec.fastRailRootProducerFrameId)===fid&&Math.abs((Number(rec.fastRailRootProducerT)||0)-tt)<1e-12);}
    function canReuseOrderedCurrentCubics(rec,frameCtx,target,currentT){const fid=Math.max(0,Number(frameCtx?.frameId)||0),tt=rec?.staticVisual===true?0:resolveEffectT(rec,currentT);return Boolean(rec?.ready&&(target?.deferred===true||target?.deferredFrame===true)&&Number(rec.currentCubicsRootProducerFrameId)===fid&&Math.abs((Number(rec.currentCubicsRootProducerT)||0)-tt)<1e-12);}
    function buildCurrentCubicsPrerequisite(rec,frameId,t){
        if(!rec?.ready||!device)return null;const tt=resolveEffectT(rec,t),fid=Math.max(0,Number(frameId)||0);
        if(Number(rec.currentCubicsCommittedFrameId)===fid&&Math.abs((Number(rec.currentCubicsCommittedT)||0)-tt)<1e-12)return{ready:true,committed:true,commandBuffer:null,onSubmitted:null};
        try{const enc=device.createCommandEncoder({label:`Somata Spiral current-cubic prerequisite L${rec.layerIndex}`});if(!encodeEffectCubics(rec,enc,tt))return null;return{ready:true,committed:false,commandBuffer:enc.finish(),onSubmitted:()=>{rec.currentCubicsCommittedFrameId=fid;rec.currentCubicsCommittedT=tt;}};}catch(err){lastError=String(err?.message||err);return null;}
    }
    function getResource(i){const rec=resources.get(Number(i)||0)||null;if(rec&&!rec.encodeCurrentCubics){rec.resolveMorphT=(t)=>resolveEffectT(rec,t);rec.encodeCurrentCubics=(encoder,t)=>encodeEffectCubics(rec,encoder,t);rec.buildCurrentCubicsPrerequisite=(frameId,t)=>buildCurrentCubicsPrerequisite(rec,frameId,t);}return rec;}
    function reason(frameCtx,mode='base'){
        if(!frameCtx)return'no-frame';
        const hiddenGraffitiGlow=mode==='glow'&&frameCtx.lineProfileStrokeOnly===true&&frameCtx.lineProfileApplication==='graffiti';
        if(state?.fourierMode===true)return'fourier';if(state?.showRoundingGuides)return'rounding-guides';if(frameCtx.lineProfileStrokeOnly&&!hiddenGraffitiGlow)return'profile-replaces-base';if(mode==='base'&&!frameCtx.lineDisplayEnabled)return'line-hidden';
        if(frameCtx.morphFrameActive){if(frameCtx.geometryProvider!==frameCtx.blueMorphProvider)return'another-provider';if(frameCtx.geometryPlan?.kind!=='blue-circle-slide'&&frameCtx.geometryPlan?.kind!=='blue-prepared')return'kind-'+String(frameCtx.geometryPlan?.kind||'unknown');const rec=getResource(frameCtx.layerIndex);if(!rec?.ready)return'resource-not-ready';return'';}

        if(typeof isSpiralLayer!=='function'||!isSpiralLayer(frameCtx.layer))return'not-static-spiral';
        if(frameCtx.geometryPlan?.dynamic===true)return'static-dynamic-geometry';
        if(!ready){warmup();return'renderer-warming';}
        try{warmupGpuMorphArcResource?.();}catch(_){}
        const rec=getStaticVisualResource(frameCtx);if(!rec?.ready)return'static-resource-not-ready';return'';
    }
    function isEligible(frameCtx,mode='base'){const r=reason(frameCtx,mode);decision.eligible=!r;decision.reason=r||'gpu-spiral-bezier';decision.layerIndex=Number(frameCtx?.layerIndex)||0;decision.frameId=Number(frameCtx?.frameId)||0;return !r;}
    function ensureCopyCapacity(rec,n){
        const need=Math.max(1,n|0);if(rec.copyBuffer&&rec.copyCapacity>=need)return;
        const cap=Math.max(8,1<<Math.ceil(Math.log2(need)));try{rec.copyBuffer?.destroy?.();}catch(_){}
        rec.copyCapacity=cap;rec.copyData=new Float32Array(cap*12);rec.copyBuffer=device.createBuffer({label:`Somata Spiral Bézier Morph copies L${rec.layerIndex}`,size:rec.copyData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});rec.copyBind=device.createBindGroup({layout:renderCopyLayout,entries:[{binding:0,resource:{buffer:rec.copyBuffer}}]});rec.copyPackedFrameId=-1;
    }
    function rgba(style){try{return GPUColorCache.rgba(style||'#fff');}catch(_){return[1,1,1,1];}}
    function spiralCenterShadeSpec(frameCtx){
        // 7.6.5: no radial geometry mask. The Corridor's per-copy reveal
        // alpha is the single owner of center emergence, so a Spiral crossing the
        // center is not cut a second time and unrelated crossings are untouched.
        return{enabled:false,mode:'copy-alpha',hidden:Math.max(0,Math.min(32,Math.round(Number(state?.tunnel?.centerHiddenCopies)||0))),startRadius:0,endRadius:0};
    }
    function centerShadeAlphaForRadius(radius,spec){
        if(!spec?.enabled)return 1;const a=Number(spec.startRadius)||0,b=Math.max(a+1e-9,Number(spec.endRadius)||0),q=clamp(((Number(radius)||0)-a)/(b-a),0,1);return q*q*(3-2*q);
    }
    function packCopies(frameCtx,rec){
        const fid=Number(frameCtx?.frameId)||0;if(rec.copyBuffer&&rec.copyPackedFrameId===fid)return rec.copyPackedCount;
        const corridor=state.tunnel?.active===true,copies=corridor?frameCtx.visibleInstances?.copies:[{scale:1}],alphas=corridor?frameCtx.visibleInstances?.alphas:[1],src=Array.isArray(copies)&&copies.length?copies:[{scale:1}],centerShade=spiralCenterShadeSpec(frameCtx);rec.lastCenterShade=centerShade;ensureCopyCapacity(rec,src.length);let k=0,firstStyle=null,multiColor=false;
        const shared=corridor&&typeof SomataCorridorCopyFrame!=='undefined'?SomataCorridorCopyFrame:null;
        const sharedBatch=shared?.peek(frameCtx)||null;
        for(let i=0;i<src.length;i++){const cp=src[i]||{};let ca=clamp(Number(alphas?.[i]??1),0,1);if(ca<=.0001)continue;const sc=corridor?Math.max(.000001,Math.abs(Number(cp.scale)||0)):1;
            // Share the authoritative Corridor colour/angle values with Glow/Base/Fill.
            // Missing stroke base keeps the original direct rule (no cache substitution).
            const ang=corridor&&typeof getMotionTunnelLagRadians==='function'?(sharedBatch&&sharedBatch.copies[i]===cp&&sharedBatch.angleVersion[i]===sharedBatch.serial?sharedBatch.angles[i]:getMotionTunnelLagRadians(cp,frameCtx.layer)):0,cs=Math.cos(ang),sn=Math.sin(ang);
            const style=corridor&&typeof getTunnelCopyColor==='function'?(sharedBatch&&frameCtx.tunnelBaseStrokeColor&&sharedBatch.copies[i]===cp&&sharedBatch.strokeVersion[i]===sharedBatch.serial?sharedBatch.stroke[i]:getTunnelCopyColor(frameCtx.tunnelBaseStrokeColor,cp,frameCtx.tunnelPaletteProfile)):(frameCtx.lightningStroke||frameCtx.layer?.strokeColor||'#fff'),styleKey=String(style||''),c=rgba(style),o=k*12;if(firstStyle===null)firstStyle=styleKey;else if(styleKey!==firstStyle)multiColor=true;rec.copyData[o]=sc*cs;rec.copyData[o+1]=-sc*sn;rec.copyData[o+2]=ca;rec.copyData[o+3]=sc;rec.copyData[o+4]=sc*sn;rec.copyData[o+5]=sc*cs;rec.copyData[o+6]=c[0];rec.copyData[o+7]=c[1];rec.copyData[o+8]=c[2];rec.copyData[o+9]=c[3];k++;}
        if(k){device.queue.writeBuffer(rec.copyBuffer,0,rec.copyData.buffer,0,k*48);stats.uploads+=k*48;}else stats.uploadSkips++;
        rec.copyPackedFrameId=fid;rec.copyPackedCount=k;rec.copyPackedMultiColor=multiColor;return k;
    }
    function prepareUniform(frameCtx,rec,copyCount,ctx,mode,opts){
        const tr=ctx.getTransform(),a=Number(tr.a)||1,b=Number(tr.b)||0,c=Number(tr.c)||0,d=Number(tr.d)||1,e=Number(tr.e)||0,f=Number(tr.f)||0;const matrixScale=Math.sqrt(Math.max(1e-12,Math.abs(a*d-b*c))),combined=Math.max(.001,Math.abs(Number(frameCtx.combinedScale)||1)),outerScale=matrixScale/combined;const hw=Math.max(.18,Math.max(.001,Number(frameCtx.strokeWidth)||1.5)*outerScale*.5),gr=mode==='glow'?Math.max(.5,Number(opts?.radiusPx)||0):0,core=mode==='base'?clamp(Number(opts?.alphaScale??1),0,1)*clamp(Number(frameCtx.baseAlpha)||0,0,1):0,glow=mode==='glow'?clamp(Number(opts?.alphaScale??1),0,1)*clamp(Number(frameCtx.baseAlpha)||0,0,1):0;let t=rec?.staticVisual===true?0:clamp(Number(frameCtx.blueMorphProvider?.geometryT??frameCtx.geometryPlan?.progress)||0,0,1);
        const currentPhaseSerial=Number(runtimeState.morph?.gpuPhasePrepareSerial)||0;
        if(rec?.staticVisual!==true&&runtimeState.morph?.gpuPhasePreparing===true&&Number(rec?.phaseSerial)!==currentPhaseSerial)t=clamp(Number(runtimeState.morph?.gpuPhaseHandoffT),0,1);
        const centerShade=rec?.lastCenterShade?.enabled===true?rec.lastCenterShade:spiralCenterShadeSpec(frameCtx);rec.lastCenterShade=centerShade;uf.fill(0);uf[0]=width;uf[1]=height;uu[2]=rec.cubicCount>>>0;uu[3]=copyCount>>>0;uf[4]=a;uf[5]=c;uf[6]=e;uf[8]=b;uf[9]=d;uf[10]=f;uf[12]=hw;uf[13]=gr;uf[14]=core;uf[15]=glow;uf[16]=t;uf[17]=centerShade.enabled?centerShade.startRadius:0;uf[18]=centerShade.enabled?centerShade.endRadius:0;uf[19]=centerShade.enabled?1:0;const buf=mode==='glow'?rec.uniformGlow:rec.uniformBase;device.queue.writeBuffer(buf,0,uniformBytes);stats.uploads+=80;return mode==='glow'?rec.uniformGlowBind:rec.uniformBaseBind;
    }
    function resolveTarget(frameCtx,opts={}){

        if(opts.deferFrameScene===true&&typeof WebGPUStrokeRenderer!=='undefined'&&WebGPUStrokeRenderer.getExternalFrameSceneTarget){
            const t=WebGPUStrokeRenderer.getExternalFrameSceneTarget(frameCtx.frameId);if(t?.view){width=Math.max(1,Number(t.width)||mainCanvas.width||1);height=Math.max(1,Number(t.height)||mainCanvas.height||1);return{view:t.view,deferredFrame:true,deferred:false,loadOp:'load'};}
        }
        if(opts.deferLayerScene===true&&typeof WebGPUStrokeRenderer!=='undefined'){

            const resident=WebGPUStrokeRenderer.getDeferredLayerSceneTexture?.(frameCtx.frameId);
            if(resident?.texture){width=Math.max(1,mainCanvas.width||1);height=Math.max(1,mainCanvas.height||1);return{view:resident.texture.createView(),texture:resident.texture,deferred:true,deferredFrame:false,resident:true,loadOp:'load'};}
            if(WebGPUStrokeRenderer.getExternalLayerSceneTarget){const t=WebGPUStrokeRenderer.getExternalLayerSceneTarget(frameCtx.frameId);if(t?.view){width=Math.max(1,Number(t.width)||mainCanvas.width||1);height=Math.max(1,Number(t.height)||mainCanvas.height||1);return{view:t.view,texture:t.texture,deferred:true,deferredFrame:false,resident:false,loadOp:'clear'};}}
        }

        stats.gpuSceneUnavailable=(stats.gpuSceneUnavailable||0)+1;return null;
    }
    function finishEncoded(frameCtx,targetCtx,enc,target,opts={},rec=null,currentT=NaN){
        const cmd=enc.finish();
        if(target.deferredFrame){
            if(WebGPUStrokeRenderer.deferExternalFrameScene?.(cmd,frameCtx.frameId,'spiral-bezier-morph')){frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;frameCtx._spiralBezierFrameSceneDirect=true;stats.directFrameSceneFrames++;if(rec?.ready&&Number.isFinite(Number(currentT))){rec.currentCubicsRootProducerFrameId=Math.max(0,Number(frameCtx.frameId)||0);rec.currentCubicsRootProducerT=rec.staticVisual===true?0:resolveEffectT(rec,currentT);rec.fastRailRootProducerFrameId=Math.max(0,Number(frameCtx.frameId)||0);rec.fastRailRootProducerT=rec.staticVisual===true?0:resolveEffectT(rec,currentT);}return true;}
            stats.fallbacks++;return false;
        }
        if(target.deferred){
            let accepted=false;
            if(target.resident===true){
                const phase=Number.isFinite(Number(opts.layerScenePhase))?Number(opts.layerScenePhase):(typeof somataEffectPhase==='function'?somataEffectPhase('geometry',opts.mode==='glow'?10:20):(opts.mode==='glow'?3:5));
                accepted=typeof queueLayerSceneEffectCommand==='function'&&queueLayerSceneEffectCommand(frameCtx,phase,cmd,opts.layerSceneLabel||`spiral-bezier-${opts.mode||'effect'}`)===true;
            }else accepted=WebGPUStrokeRenderer.deferExternalLayerScene?.(cmd,frameCtx.frameId,'spiral-bezier-morph')===true;
            if(accepted){
                frameCtx.frame.gpuLayerSceneDeferred=true;frameCtx.frame.gpuMainSceneEmpty=frameCtx.frame.gpuMainCanvasHasContent!==true;frameCtx._spiralBezierLayerSceneDeferred=true;stats.deferredLayerSceneFrames++;

                if(target.resident!==true&&rec?.ready&&Number.isFinite(Number(currentT))){rec.currentCubicsRootProducerFrameId=Math.max(0,Number(frameCtx.frameId)||0);rec.currentCubicsRootProducerT=rec.staticVisual===true?0:resolveEffectT(rec,currentT);rec.fastRailRootProducerFrameId=Math.max(0,Number(frameCtx.frameId)||0);rec.fastRailRootProducerT=rec.staticVisual===true?0:resolveEffectT(rec,currentT);}
                return true;
            }
            stats.fallbacks++;return false;
        }
        stats.gpuSceneUnavailable=(stats.gpuSceneUnavailable||0)+1;return false;
    }
    function draw(frameCtx,targetCtx,mode,opts={}){
        if(!isEligible(frameCtx,mode)){stats.fallbacks++;return false;}const rec=getVisualResource(frameCtx);const target=resolveTarget(frameCtx,opts);if(!rec?.ready||!target){stats.fallbacks++;return false;}
        try{
            targetCtx.save();applyLayerFrameEffectTransform(targetCtx,frameCtx);const copies=packCopies(frameCtx,rec);if(!copies){targetCtx.restore();return true;}const ub=prepareUniform(frameCtx,rec,copies,targetCtx,mode,opts);targetCtx.restore();
            const enc=device.createCommandEncoder({label:`Somata 7.5 Spiral Fast Rail ${rec.staticVisual===true?'Static':'Morph'} ${mode}`});const currentT=rec.staticVisual===true?0:resolveEffectT(rec,frameCtx.blueMorphProvider?.geometryT??frameCtx.geometryPlan?.progress);
            if(rec.staticVisual!==true){
                if(canReuseOrderedCurrentCubics(rec,frameCtx,target,currentT))stats.cubicComputeReuses++;else if(!encodeEffectCubics(rec,enc,currentT)){stats.fallbacks++;return false;}
                if(canReuseOrderedFastRail(rec,frameCtx,target,currentT))stats.fastRailReuses++;else if(!encodeFastRail(rec,enc,currentT)){stats.fallbacks++;return false;}
            }
            const pass=enc.beginRenderPass({colorAttachments:[{view:target.view,clearValue:{r:0,g:0,b:0,a:0},loadOp:target.loadOp||'clear',storeOp:'store'}]});const segmented=(frameCtx?.lineLayerMode??frameCtx?.spiralLineType)==='segmented',useUniform=mode==='base'&&!segmented&&uniformPipelineMax;const blendPipe=useUniform?((target.deferredFrame||rec.copyPackedMultiColor)?uniformPipelineOver:uniformPipelineMax):(segmented?pipelineOver:((target.deferredFrame||((mode==='base')&&rec.copyPackedMultiColor))?pipelineOver:pipelineMax));pass.setPipeline(blendPipe);pass.setBindGroup(0,ub);pass.setBindGroup(1,rec.bind);pass.setBindGroup(2,rec.copyBind);pass.setVertexBuffer(0,cornerBuffer);pass.draw(4,rec.cubicCount*SUBDIV*copies);pass.end();
            if(!finishEncoded(frameCtx,targetCtx,enc,target,opts,rec,currentT))return false;stats.frames++;if(mode==='glow')stats.glowFrames++;else stats.baseFrames++;if(state.tunnel?.active===true)stats.corridorFrames++;return true;
        }catch(err){try{targetCtx.restore();}catch(_){}lastError=String(err?.message||err);stats.errors++;stats.fallbacks++;return false;}
    }
    function render(frameCtx,targetCtx,opts={}){return draw(frameCtx,targetCtx,opts.mode==='glow'?'glow':'base',opts);}
    function renderGlowAndBase(frameCtx,targetCtx,opts={}){
        if(!isEligible(frameCtx,'glow')||!isEligible(frameCtx,'base')){stats.fallbacks++;return false;}const rec=getVisualResource(frameCtx),target=resolveTarget(frameCtx,opts);if(!target){stats.fallbacks++;return false;}
        try{
            targetCtx.save();applyLayerFrameEffectTransform(targetCtx,frameCtx);const copies=packCopies(frameCtx,rec);if(!copies){targetCtx.restore();return true;}const ug=prepareUniform(frameCtx,rec,copies,targetCtx,'glow',{radiusPx:opts.radiusPx,alphaScale:opts.glowAlphaScale}),ub=prepareUniform(frameCtx,rec,copies,targetCtx,'base',{alphaScale:opts.baseAlphaScale});targetCtx.restore();
            const enc=device.createCommandEncoder({label:`Somata 7.5 Spiral Fast Rail ${rec.staticVisual===true?'Static':'Morph'} fused Glow+Base`});const currentT=rec.staticVisual===true?0:resolveEffectT(rec,frameCtx.blueMorphProvider?.geometryT??frameCtx.geometryPlan?.progress);
            if(rec.staticVisual!==true){if(canReuseOrderedCurrentCubics(rec,frameCtx,target,currentT))stats.cubicComputeReuses++;else if(!encodeEffectCubics(rec,enc,currentT)){stats.fallbacks++;return false;}if(canReuseOrderedFastRail(rec,frameCtx,target,currentT))stats.fastRailReuses++;else if(!encodeFastRail(rec,enc,currentT)){stats.fallbacks++;return false;}}
            const pass=enc.beginRenderPass({colorAttachments:[{view:target.view,clearValue:{r:0,g:0,b:0,a:0},loadOp:target.loadOp||'clear',storeOp:'store'}]});const segmented=(frameCtx?.lineLayerMode??frameCtx?.spiralLineType)==='segmented';pass.setPipeline(segmented?pipelineOver:(target.deferredFrame?pipelineOver:pipelineMax));pass.setBindGroup(1,rec.bind);pass.setBindGroup(2,rec.copyBind);pass.setVertexBuffer(0,cornerBuffer);pass.setBindGroup(0,ug);pass.draw(4,rec.cubicCount*SUBDIV*copies);const basePipe=!segmented&&uniformPipelineMax?((target.deferredFrame||rec.copyPackedMultiColor)?uniformPipelineOver:uniformPipelineMax):(segmented?pipelineOver:((target.deferredFrame||rec.copyPackedMultiColor)?pipelineOver:pipelineMax));pass.setPipeline(basePipe);pass.setBindGroup(0,ub);pass.draw(4,rec.cubicCount*SUBDIV*copies);pass.end();
            if(!finishEncoded(frameCtx,targetCtx,enc,target,opts,rec,currentT))return false;stats.frames++;stats.glowFrames++;stats.baseFrames++;stats.fusedFrames++;if(state.tunnel?.active===true)stats.corridorFrames++;return true;
        }catch(err){try{targetCtx.restore();}catch(_){}lastError=String(err?.message||err);stats.errors++;stats.fallbacks++;return false;}
    }
    function auxiliaryPaths(layerIndex,t){
        const rec=getResource(layerIndex);if(!rec?.ready||!rec?.pathCount)return null;const tt=resolveEffectT(rec,t);if(Number.isFinite(rec.auxT)&&Math.abs(rec.auxT-tt)<1e-12){stats.auxHits++;return rec.auxPairs;}
        if(rec.carrierMapped===true){
            if(!ensureCarrierMappedCurrent(rec,tt))return null;const subdiv=6,cubicAt=(p0,c1,c2,p3,q)=>{const z=1-q,z2=z*z,q2=q*q;return{x:z2*z*p0.x+3*z2*q*c1.x+3*z*q2*c2.x+q2*q*p3.x,y:z2*z*p0.y+3*z2*q*c1.y+3*z*q2*c2.y+q2*q*p3.y};};
            for(let pi=0;pi<rec.pathCount;pi++){const pair=rec.auxPairs[pi],cubics=rec.carrierCurrentByPath?.[pi]||[],need=cubics.length*subdiv+1;while(pair.points.length<need)pair.points.push({x:0,y:0,widthScale:1});pair.points.length=need;let w=0;for(let j=0;j<cubics.length;j++){const q=cubics[j],q0=j===0?0:1,l0=Math.log(Math.max(.02,Number(q.widthScale0)||1)),l1=Math.log(Math.max(.02,Number(q.widthScale1)||1));for(let sj=q0;sj<=subdiv;sj++){const u=sj/subdiv,p=cubicAt(q.p0,q.c1,q.c2,q.p3,u),dst=pair.points[w++];dst.x=p.x;dst.y=p.y;dst.widthScale=Math.exp(l0+(l1-l0)*u);}}pair.points.length=w;pair.closed=false;pair.alpha=1;const sn=Math.max(1,Number(pair.sourceBranchCount)||rec.pathCount),dn=Math.max(1,Number(pair.targetBranchCount)||rec.pathCount),sa=Number.isFinite(pair.sourceBranchIndex)?(((pair.sourceBranchIndex/sn)%1)+1)%1:NaN,da=Number.isFinite(pair.targetBranchIndex)?(((pair.targetBranchIndex/dn)%1)+1)%1:NaN;if(Number.isFinite(sa)&&Number.isFinite(da)){let d=da-sa;d=((d+.5)%1+1)%1-.5;pair.branchPhase=((sa+d*tt)%1+1)%1;}else pair.branchPhase=Number.isFinite(sa)?sa:(Number.isFinite(da)?da:pi/Math.max(1,rec.pathCount));}
            rec.auxT=tt;stats.auxFrames++;stats.auxPoints+=rec.auxPairs.reduce((n,p)=>n+p.points.length,0);return rec.auxPairs;
        }
        const subdiv=6,data=rec.data,ranges=rec.cpuPathSegmentRanges,profileT=resolveProfileModeTransitionT(rec,tt),mixedMode=rec.sourceSpline!==rec.targetSpline;
        const polarXY=(r,a)=>({x:r*Math.cos(a),y:r*Math.sin(a)}),mixPolar=(sr,sa,dr,da,cart=false)=>{if(cart){const s=polarXY(sr,sa),d=polarXY(dr,da);return{x:s.x+(d.x-s.x)*tt,y:s.y+(d.y-s.y)*tt};}const r=sr+(dr-sr)*tt,a=sa+(da-sa)*tt;return{x:r*Math.cos(a),y:r*Math.sin(a)};};
        const rot=(v,a)=>{const c=Math.cos(a),q=Math.sin(a);return{x:c*v.x-q*v.y,y:q*v.x+c*v.y};};
        const transported=(er,ea,cr,ca,currentAngle,cart)=>{const e=polarXY(er,ea),c=polarXY(cr,ca),v={x:c.x-e.x,y:c.y-e.y};return cart?v:rot(v,currentAngle-ea);};
        const mixHandle=(a,b,u)=>({x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u});
        const cubicAt=(p0,c1,c2,p3,q)=>{const z=1-q,z2=z*z,q2=q*q;return{x:z2*z*p0.x+3*z2*q*c1.x+3*z*q2*c2.x+q2*q*p3.x,y:z2*z*p0.y+3*z2*q*c1.y+3*z*q2*c2.y+q2*q*p3.y};};
        for(let pi=0;pi<rec.pathCount;pi++){
            const pair=rec.auxPairs[pi],ro=pi*4,first=ranges[ro]>>>0,count=ranges[ro+1]>>>0,need=count*subdiv+1;while(pair.points.length<need)pair.points.push({x:0,y:0,widthScale:1});pair.points.length=need;let w=0;
            for(let j=0;j<count;j++){
                const ci=first+j,o=ci*FLOATS_PER_CUBIC,cart=data[o+22]>.5,p0=mixPolar(data[o],data[o+1],data[o+8],data[o+9],cart),p3=mixPolar(data[o+6],data[o+7],data[o+14],data[o+15],cart);
                let c1=mixPolar(data[o+2],data[o+3],data[o+10],data[o+11],cart),c2=mixPolar(data[o+4],data[o+5],data[o+12],data[o+13],cart);
                if(mixedMode){const a0=data[o+1]+(data[o+9]-data[o+1])*tt,a3=data[o+7]+(data[o+15]-data[o+7])*tt,hs1=transported(data[o],data[o+1],data[o+2],data[o+3],a0,cart),hd1=transported(data[o+8],data[o+9],data[o+10],data[o+11],a0,cart),hs2=transported(data[o+6],data[o+7],data[o+4],data[o+5],a3,cart),hd2=transported(data[o+14],data[o+15],data[o+12],data[o+13],a3,cart),h1=mixHandle(hs1,hd1,profileT),h2=mixHandle(hs2,hd2,profileT);c1={x:p0.x+h1.x,y:p0.y+h1.y};c2={x:p3.x+h2.x,y:p3.y+h2.y};}
                const ws0=Math.exp(Math.log(Math.max(.02,data[o+16]))*(1-tt)+Math.log(Math.max(.02,data[o+18]))*tt),ws1=Math.exp(Math.log(Math.max(.02,data[o+17]))*(1-tt)+Math.log(Math.max(.02,data[o+19]))*tt);
                const q0=j===0?0:1;for(let sj=q0;sj<=subdiv;sj++){const q=sj/subdiv,p=cubicAt(p0,c1,c2,p3,q),dst=pair.points[w++];dst.x=p.x;dst.y=p.y;dst.widthScale=Math.exp(Math.log(Math.max(.02,ws0))*(1-q)+Math.log(Math.max(.02,ws1))*q);}
            }
            pair.points.length=w;pair.closed=pair.closed===true;const base=first*FLOATS_PER_CUBIC;pair.alpha=(data[base+20]*(1-tt)+data[base+21]*tt);
            const sn=Math.max(1,Number(pair.sourceBranchCount)||rec.pathCount),dn=Math.max(1,Number(pair.targetBranchCount)||rec.pathCount),sa=Number.isFinite(pair.sourceBranchIndex)?(((pair.sourceBranchIndex/sn)%1)+1)%1:NaN,da=Number.isFinite(pair.targetBranchIndex)?(((pair.targetBranchIndex/dn)%1)+1)%1:NaN;if(Number.isFinite(sa)&&Number.isFinite(da)){let d=da-sa;d=((d+.5)%1+1)%1-.5;pair.branchPhase=((sa+d*tt)%1+1)%1;}else pair.branchPhase=Number.isFinite(sa)?sa:(Number.isFinite(da)?da:pi/Math.max(1,rec.pathCount));
        }
        rec.auxT=tt;stats.auxFrames++;stats.auxPoints+=rec.auxPairs.reduce((n,p)=>n+p.points.length,0);return rec.auxPairs;
    }
    function debugCarrierMappedPlan(layerIndex=0,t=0){const rec=buildLayerCpuResource(layerIndex);if(!rec)return null;const packed=rec.carrierMapped?ensureCarrierMappedCurrent(rec,t):null;return{carrierMapped:rec.carrierMapped===true,carrierOverflow:rec.carrierOverflow===true,cubicCount:rec.cubicCount,pathCount:rec.pathCount,interpolationMetric:rec.interpolationMetric,exactSubdivisionOnly:rec.exactSubdivisionOnly===true,arcEqualizedRecords:Number(rec.arcEqualizedRecords)||0,packed:packed?Array.from(packed):null,carrierFrames:(rec.carrierFrameSpecs||[]).map(f=>({anchor:{...f.anchor},end:{...f.end},delta:Number(f.delta)||0,targetScale:Number(f.targetScale)||1,N:Number(f.N)||0,step:Number(f.step)||0,direction:Number(f.direction)||1,metric:f.metric||''})),paths:(rec.carrierCurrentByPath||[]).map(path=>path.map(q=>({p0:{...q.p0},c1:{...q.c1},c2:{...q.c2},p3:{...q.p3},widthScale0:Number(q.widthScale0)||1,widthScale1:Number(q.widthScale1)||1}))),sourcePaths:(rec.carrierRecords||[]).map(r=>r.sc.map(q=>({p0:{...q.p0},c1:{...q.c1},c2:{...q.c2},p3:{...q.p3}}))),targetPaths:(rec.carrierRecords||[]).map(r=>r.dc.map(q=>({p0:{...q.p0},c1:{...q.c1},c2:{...q.c2},p3:{...q.p3}})))};}
    function debugCarrierAdvanceBench(layerIndex=0,samples=60){const rec=buildLayerCpuResource(layerIndex);if(!rec?.carrierMapped)return null;const n=Math.max(1,Math.min(600,Math.round(Number(samples)||60)));const t0=performance.now();let checksum=0;for(let i=0;i<n;i++){const t=(i+.5)/n,packed=ensureCarrierMappedCurrent(rec,t);if(!packed)return null;checksum+=packed[0]||0;}const ms=performance.now()-t0;return{samples:n,ms,msPerSample:ms/n,cubicCount:rec.cubicCount,pathCount:rec.pathCount,bytesPerRail:rec.cubicCount*8*4,checksum,carrierOverflow:rec.carrierOverflow===true};}
    function status(){const active=[...resources.entries()].map(([layerIndex,r])=>({layerIndex,morphType:r.morphType||'',spiralTransport:r.spiralTransport||r.morphType||'',profileMorphMode:r.profileMorphMode||'',interpolationMetric:r.interpolationMetric||'',carrierMapped:r.carrierMapped===true,carrierOverflow:r.carrierOverflow===true,cubicCount:r.cubicCount||0,pathCount:r.pathCount||0,topologyMergeSplitCount:r.topologyMergeSplitCount||0,continuousTopologyTransport:r.continuousTopologyTransport===true,exactSubdivisionOnly:r.exactSubdivisionOnly===true,arcEqualizedRecords:Number(r.arcEqualizedRecords)||0,cartesianFallbackCubics:r.cartesianFallbackCubics||0,maxPackedPolarTurn:Number(r.maxPackedPolarTurn)||0,ready:r.ready===true,periodicPaths:r.cpuPathClosure?Array.from({length:r.pathCount||0},(_,pi)=>r.cpuPathClosure[pi*8+4]>0.5&&r.cpuPathClosure[pi*8+5]>0.5).filter(Boolean).length:0,maxEndpointClosureError:Number(r.maxEndpointClosureError)||0,maxEndpointTangentClosureError:Number(r.maxEndpointTangentClosureError)||0}));return{supported:!!globalThis.navigator?.gpu,ready,initializing:Boolean(initializing),generation,lastError,resources:resources.size,active,staticVisualResources:staticVisualResources.size,stats:{...stats},lastDecision:{...decision},contract:'Somata 7.8.3 keeps the late-7.7.9 exact carrier/profile constructor for Spiral, no arc resampling, and one upload per t. Circular Spiral transports reuse an exact rotational carrier template across sibling branches; Topology and Torn stay explicit per-branch. Web and Lightning are 7.5-reference consumers: strict Spiral effects may only consume the exact specialized visible Spiral rail and never the generic shared morph rail. Continuous fixes N/K; Phase fixes N and transports K as the phase step; Phase-circle adds no-fade branch clone/merge; Minimal-turn keeps the step constant while N branches clone/merge; Topology linearly transports both key endpoints; Torn uses exact Bezier subdivision only. Every spiral-to-spiral rail keeps periodic closure. Corridor center reveal remains whole-copy alpha; constant-step Corridor copy phase is synchronized to the exact current carrier delta; Glow follows the retained Spiral rail, and Glow/Base share the same packed copy transforms.'};}
    return{warmup,isReady:()=>ready,preparePhase,invalidate,park,getResource,isEligible,reason,render,renderGlowAndBase,auxiliaryPaths,status,debugBuildCpuResource:buildLayerCpuResource,debugCarrierMappedPlan,debugCarrierAdvanceBench,debugCenterShadeSpec:spiralCenterShadeSpec,debugCenterShadeAlpha:centerShadeAlphaForRadius};
})();
window.prepareGpuSpiralBezierMorphResources=()=>WebGPUSpiralBezierMorphRenderer.preparePhase();
window.invalidateGpuSpiralBezierMorphResources=(reason)=>WebGPUSpiralBezierMorphRenderer.invalidate(reason);
window.parkGpuSpiralBezierMorphResources=(reason)=>WebGPUSpiralBezierMorphRenderer.park(reason);
window.getGpuSpiralBezierMorphAuxPaths=(layerIndex,t)=>WebGPUSpiralBezierMorphRenderer.auxiliaryPaths(layerIndex,t);
window.__somataSpiralBezierMorphStatus=()=>WebGPUSpiralBezierMorphRenderer.status();
window.__somataSpiralMorphCpuPlan=(layerIndex=0)=>WebGPUSpiralBezierMorphRenderer.debugBuildCpuResource(layerIndex);
window.__somataSpiralCarrierMorphPlan=(layerIndex=0,t=0)=>WebGPUSpiralBezierMorphRenderer.debugCarrierMappedPlan(layerIndex,t);
window.__somataSpiralCarrierAdvanceBench=(layerIndex=0,samples=60)=>WebGPUSpiralBezierMorphRenderer.debugCarrierAdvanceBench(layerIndex,samples);

(()=>{if(!globalThis.navigator?.gpu||globalThis.isSecureContext!==true)return;const kick=()=>{try{WebGPUSpiralBezierMorphRenderer.warmup?.();}catch(_){}};if(typeof requestIdleCallback==='function')requestIdleCallback(kick,{timeout:350});else setTimeout(kick,0);})();
