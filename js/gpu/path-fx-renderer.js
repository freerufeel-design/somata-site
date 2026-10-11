// SpiroStar v512 — dedicated WebGPU Path FX renderer
// Extracted from legacy/app-a; owns Sprite + Moving Line pipelines and frame-wide overlay queue.
window.__spiroRegisterModule?.('js/gpu/path-fx-renderer');

// v432 — GPU Path FX renderer: spline-bent sprites, hard key-corner head stops, animated sinusoid and reliable base replacement.
// v429 — GPU Path FX renderer. Sprite and Moving Line no longer depend on
// deferred Layer Scene: they can render into a transparent WebGPU overlay that sits
// above whichever Canvas/WebGPU backend produced the base scene. This avoids the
// previous "effect enabled but invisible" failure when any legacy pass blocked FrameGraph.
// Custom sprite images are sampled directly in WGSL; the built-in snake is procedural.
const WebGPUPathFxRenderer=(()=>{
    const overlayCanvas=document.getElementById('pathFxOverlayCanvas');
    let overlayContext=null,overlayConfiguredGeneration=-1,overlayFrameId=-1,overlayUsedFrame=-1;
    let device=null,format=null,ready=false,attempted=false,initializing=false,lost=false,lastError='',generation=0;
    let pipeline=null,uniformBuffers=[],uniformCursor=0,pathIndexStatic=new WeakMap(),pathIndexDynamic=new WeakMap(),recordSet=new Set(),bindCache=new WeakMap(),renderBundleCache=new WeakMap(),fallbackArcMetaBuffer=null;
    let views=new WeakMap(),frames=0,draws=0,segments=0,pathIndexUploads=0,pathIndexUploadBytes=0,overlayFrames=0,overlayDraws=0;
    // v510: one frame-wide overlay queue replaces per-copy command encoders/submits.
    let overlayFrameActive=false,overlayQueue=[],overlayQueuedDraws=0,overlayFlushes=0,overlaySubmissions=0,overlayClearOnlySubmissions=0,overlayMaxBatch=0,uniformBufferGrows=0,sharedArcReuses=0,bundleBuilds=0,bundleHits=0,bundleExecutes=0,bundleFallbacks=0;
    let sampler=null,whiteTexture=null,whiteTextureView=null,builtinSpriteTextures=new Map(),spriteTextureCache=new Map(),customTextureLoads=0,customTextureErrors=0;
    const uf=new Float32Array(36);
    const WGSL=`
struct U{
    viewport:vec2<f32>, aaLocal:f32, total:f32,
    row0:vec4<f32>, row1:vec4<f32>, color:vec4<f32>,
    p0:vec4<f32>, // halfWidth, subdivisions, effectMode(0 motion/1 sprite), placement
    p1:vec4<f32>, // everyN, baseSegmentCount, nativeTextureColor, builtInProcedural
    p2:vec4<f32>, // motionMode(0 none/1 raft/2 rope/3 sinusoid), amplitude, wavelength, travelDistance
    p3:vec4<f32>, // phaseRadians, sprite secondary RGB
    p4:vec4<f32>, // smoothSpline, spriteTypeCode, gpuArcResident, constructionSegmentCount
};
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var<storage,read> segData:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> pathIndex:array<u32>;
@group(0) @binding(3) var spriteTex:texture_2d<f32>;
@group(0) @binding(4) var spriteSampler:sampler;
@group(0) @binding(5) var<storage,read> arcMeta:array<vec4<f32>>;
fn tableTotal()->f32{return select(u.total,arcMeta[0].x,u.p4.z>0.5);}
struct O{
    @builtin(position) pos:vec4<f32>,
    @location(0) arcSide:vec2<f32>, // absolute arc distance, signed normalized transverse coordinate
    @location(1) @interpolate(flat) pathMeta:vec4<f32>, // pathIndex, pathStart, pathLength, selected
};
fn screen(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
fn selectedPath(pi:u32)->bool{
    if(u.p0.z<0.5){return true;}
    let placement=i32(u.p0.w+0.5);
    if(placement==1){let every=max(1u,u32(u.p1.x+0.5));return (pi%every)==0u;}
    return true;
}
fn offsetAt(globalDist:f32,pathLocalDist:f32)->f32{
    let mode=i32(u.p2.x+0.5);let amp=u.p2.y;if(mode==0||amp<=0.00001){return 0.0;}
    let wl=max(1.0,u.p2.z);
    if(mode==1){return sin(6.28318530718*(globalDist-u.p2.w)/wl)*amp;}
    let cell=floor(pathLocalDist/wl);let t=fract(pathLocalDist/wl);let anchored=sin(3.14159265359*t);
    if(mode==2){return anchored*sin(u.p3.x+cell*0.37)*amp;}
    return anchored*sin(6.28318530718*t-u.p3.x)*amp;
}
fn splinePoint(p0:vec2<f32>,p1:vec2<f32>,t0:vec2<f32>,t1:vec2<f32>,x:f32)->vec2<f32>{
    if(u.p4.x<0.5){return mix(p0,p1,x);}
    let l=max(.0001,length(p1-p0));let m0=t0*l*.56;let m1=t1*l*.56;let x2=x*x;let x3=x2*x;
    return (2.0*x3-3.0*x2+1.0)*p0+(x3-2.0*x2+x)*m0+(-2.0*x3+3.0*x2)*p1+(x3-x2)*m1;
}
fn splineTangent(p0:vec2<f32>,p1:vec2<f32>,t0:vec2<f32>,t1:vec2<f32>,x:f32)->vec2<f32>{
    if(u.p4.x<0.5){return normalize(p1-p0);}
    let l=max(.0001,length(p1-p0));let m0=t0*l*.56;let m1=t1*l*.56;let x2=x*x;
    let d=(6.0*x2-6.0*x)*p0+(3.0*x2-4.0*x+1.0)*m0+(-6.0*x2+6.0*x)*p1+(3.0*x2-2.0*x)*m1;
    return select(normalize(p1-p0),normalize(d),length(d)>.0001);
}
fn deadVertex()->O{var o:O;o.pos=vec4<f32>(-3.0,-3.0,0.0,1.0);o.arcSide=vec2<f32>(0.0);o.pathMeta=vec4<f32>(0.0);return o;}
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) iid:u32)->O{
    let subdivisions=max(1u,u32(u.p0.y+0.5));let bi=iid/subdivisions;let sj=iid%subdivisions;let baseCount=u32(u.p1.y+0.5);
    if(bi>=baseCount){return deadVertex();}
    let s0=segData[bi*2u];let s1=segData[bi*2u+1u];let a0=s0.xy;let b0=s0.zw;
    // A topology morph can transiently collapse an edge even when both phase endpoints are
    // valid. Keep the resident topology stable, but discard that instance before normalize()
    // so a zero vector can never inject NaNs into the whole ribbon pass.
    if(s1.y<=0.000001){return deadVertex();}
    let baseLen=s1.y;let packedPi=pathIndex[bi];let pi=packedPi&0x00ffffffu;if(!selectedPath(pi)){return deadVertex();}
    let keyStart=(packedPi&0x40000000u)!=0u;let keyEnd=(packedPi&0x80000000u)!=0u;
    var ta=normalize(b0-a0);var tb=ta;
    // Sprite is a continuous ribbon: even authored key corners share a join tangent.  Motion-only
    // keeps the authored hard-corner contract unless the visible carrier is a smooth spline.
    let spriteMode=u.p0.z>0.5;let joinStart=spriteMode||u.p4.x>.5||!keyStart;let joinEnd=spriteMode||u.p4.x>.5||!keyEnd;
    if(joinStart&&bi>0u&&(pathIndex[bi-1u]&0x00ffffffu)==pi){let ps=segData[(bi-1u)*2u];let dv=ps.zw-ps.xy;let dl=length(dv);if(dl>.000001){let pd=dv/dl;let sum=pd+ta;if(length(sum)>.0001){ta=normalize(sum);}}}
    if(joinEnd&&bi+1u<baseCount&&(pathIndex[bi+1u]&0x00ffffffu)==pi){let ns=segData[(bi+1u)*2u];let dv=ns.zw-ns.xy;let dl=length(dv);if(dl>.000001){let nd=dv/dl;let sum=tb+nd;if(length(sum)>.0001){tb=normalize(sum);}}}
    let den=f32(subdivisions);let x0=f32(sj)/den;let x1=f32(sj+1u)/den;
    let pa=splinePoint(a0,b0,ta,tb,x0);let pb=splinePoint(a0,b0,ta,tb,x1);let tna=splineTangent(a0,b0,ta,tb,x0);let tnb=splineTangent(a0,b0,ta,tb,x1);
    let g0=s1.x+baseLen*x0;let g1=s1.x+baseLen*x1;let l0=(s1.x-s1.z)+baseLen*x0;let l1=(s1.x-s1.z)+baseLen*x1;
    let oa=offsetAt(g0,l0);let ob=offsetAt(g1,l1);let a=pa+vec2<f32>(-tna.y,tna.x)*oa;let b=pb+vec2<f32>(-tnb.y,tnb.x)*ob;
    // Shared cross-sections, not six independent capsule corners.  Adjacent instances therefore
    // meet on exactly the same two vertices and the sprite reads as one continuous printed ribbon.
    let na=normalize(vec2<f32>(-tna.y,tna.x));let nb=normalize(vec2<f32>(-tnb.y,tnb.x));
    let half=max(.0001,u.p0.x);let edge=half+u.aaLocal;let sideScale=edge/half;
    let endFlags=array<f32,4>(0.0,1.0,0.0,1.0);let sideFlags=array<f32,4>(-1.0,-1.0,1.0,1.0);
    let ee=endFlags[vi];let ss=sideFlags[vi];let p=mix(a+na*(edge*ss),b+nb*(edge*ss),ee);let sc=screen(p);
    var o:O;o.pos=vec4<f32>(sc.x/u.viewport.x*2.0-1.0,1.0-sc.y/u.viewport.y*2.0,0.0,1.0);o.arcSide=vec2<f32>(mix(g0,g1,ee),ss*sideScale);o.pathMeta=vec4<f32>(f32(pi),s1.z,s1.w,1.0);return o;
}
fn softBand(x:f32,a:f32,b:f32)->f32{return smoothstep(a,a+.035,x)*(1.0-smoothstep(b-.035,b,x));}
fn builtInSprite(spriteType:i32,spriteU:f32,dist:f32,span:f32,side:f32)->vec4<f32>{
    let primary=u.color.rgb;let secondary=u.p3.yzw;let ink=vec3<f32>(.025,.018,.012);let hw=max(1.0,u.p0.x);
    let fromStart=max(0.0,spriteU*span);let fromEnd=max(0.0,(1.0-spriteU)*span);let absSide=abs(side);
    var alpha=0.0;var rgb=primary;
    if(spriteType==0){
// Snake: mathematically printed emerald/yellow body. Head and eye exist only at the final end.
let tailSpan=max(8.0,hw*2.2);let headSpan=max(12.0,hw*3.4);let tail=mix(.10,.56,smoothstep(0.0,tailSpan,fromStart));
let headT=1.0-clamp(fromEnd/headSpan,0.0,1.0);let half=max(tail,mix(.56,.88,smoothstep(.05,.82,headT)));
alpha=1.0-smoothstep(half,half+.045,absSide);
let period=max(5.0,hw*.72);let stripe=.5+.5*sin(6.28318530718*dist/period+side*2.2);let yellow=smoothstep(.47,.58,stripe);rgb=mix(primary,secondary,yellow*.88);
let ex=(fromEnd-headSpan*.26)/max(1.0,headSpan*.115);let ey=(side+.27)/.075;if(ex*ex+ey*ey<1.0){rgb=ink;alpha=1.0;}
    }else if(spriteType==1){
// Bones: continuous centre rail with periodic knobs, like a printed bone chain.
let period=max(6.0,hw*1.35);let ph=fract(dist/period);let shaft=1.0-smoothstep(.13,.18,absSide);let knob=max(1.0-smoothstep(.36,.43,absSide),0.0)*(1.0-smoothstep(.12,.22,min(ph,1.0-ph)*2.0));alpha=max(shaft,knob);rgb=mix(primary,secondary,.25+.55*absSide);
    }else if(spriteType==2){
// Dachshund: long brown body, light belly/legs, broad head at the end.
let headSpan=max(13.0,hw*3.0);let tailSpan=max(9.0,hw*2.0);let tail=mix(.10,.48,smoothstep(0.0,tailSpan,fromStart));let headT=1.0-clamp(fromEnd/headSpan,0.0,1.0);let half=max(tail,mix(.48,.82,smoothstep(.15,.85,headT)));let period=max(8.0,hw*2.2);let ph=fract(dist/period);let leg=select(0.0,1.0,side>.25&&softBand(ph,.16,.28)>.5);let shape=max(half,select(half,.78,leg>0.5));alpha=1.0-smoothstep(shape,shape+.045,absSide);rgb=mix(primary,secondary,clamp((side+.05)*.55+leg*.55,0.0,1.0));let ex=(fromEnd-headSpan*.25)/max(1.0,headSpan*.11);let ey=(side+.25)/.07;if(ex*ex+ey*ey<1.0){rgb=ink;alpha=1.0;}
    }else if(spriteType==3){
// Dragon: continuous red body with periodic gold dorsal spikes and a final head.
let headSpan=max(13.0,hw*3.1);let headT=1.0-clamp(fromEnd/headSpan,0.0,1.0);let baseHalf=mix(.46,.78,smoothstep(.15,.86,headT));let period=max(6.0,hw*.95);let ph=abs(fract(dist/period)-.5)*2.0;let spike=(1.0-ph)*.42;let half=select(baseHalf,max(baseHalf,.45+spike),side<0.0);alpha=1.0-smoothstep(half,half+.045,absSide);rgb=mix(primary,secondary,select(.12,.92,side<-.38&&ph<.72));let ex=(fromEnd-headSpan*.25)/max(1.0,headSpan*.11);let ey=(side+.24)/.07;if(ex*ex+ey*ey<1.0){rgb=ink;alpha=1.0;}
    }else{
// Caterpillar: smoothly connected periodic lobes, no separate rectangles.
let period=max(6.0,hw*1.15);let ph=.5+.5*cos(6.28318530718*dist/period);var half=.42+.18*ph;let headSpan=max(11.0,hw*2.7);let headT=1.0-clamp(fromEnd/headSpan,0.0,1.0);half=max(half,mix(.42,.76,smoothstep(.15,.85,headT)));alpha=1.0-smoothstep(half,half+.045,absSide);rgb=mix(primary,secondary,.18+.68*(1.0-ph));let ex=(fromEnd-headSpan*.24)/max(1.0,headSpan*.105);let ey=(side+.23)/.07;if(ex*ex+ey*ey<1.0){rgb=ink;alpha=1.0;}
    }
    return vec4<f32>(rgb,alpha);
}
@fragment fn fs(v:O)->@location(0) vec4<f32>{
    let half=max(.0001,u.p0.x);let aa=max(.0001,u.aaLocal/half);var cov=1.0-smoothstep(1.0,1.0+aa,abs(v.arcSide.y));if(cov<=.0001){discard;}
    var rgb=u.color.rgb;
    if(u.p0.z>0.5){
let placement=i32(u.p0.w+0.5);let dist=v.arcSide.x;var start=v.pathMeta.y;var span=max(.0001,v.pathMeta.z);
if(placement==2){start=0.0;span=max(.0001,tableTotal());}
if(placement==3||placement==4){let segmentCount=max(1u,u32(u.p4.w+0.5));let segmentLen=max(.0001,v.pathMeta.z/f32(segmentCount));let localDist=clamp(dist-v.pathMeta.y,0.0,max(0.0,v.pathMeta.z-.000001));let segmentIndex=min(segmentCount-1u,u32(floor(localDist/segmentLen)));if(placement==4){let every=max(1u,u32(u.p1.x+0.5));if((segmentIndex%every)!=0u){discard;}}start=v.pathMeta.y+f32(segmentIndex)*segmentLen;span=segmentLen;}
let spriteU=clamp((dist-start)/span,0.0,1.0);
if(u.p1.w>.5){let b=builtInSprite(i32(u.p4.y+0.5),spriteU,dist-start,span,v.arcSide.y);cov*=b.a;rgb=b.rgb;}
else{
    let vv=clamp(.5+.5*v.arcSide.y,0.0,1.0);let texColor=textureSample(spriteTex,spriteSampler,vec2<f32>(spriteU,vv));cov*=texColor.a;if(u.p1.z>.5){rgb=texColor.rgb;}else{rgb=u.color.rgb*texColor.rgb;}
}
if(cov<=.0001){discard;}
    }
    let a=clamp(u.color.a*cov,0.0,1.0);return vec4<f32>(rgb*a,a);
}`
    function destroySpriteTextures(){
        for(const rec of spriteTextureCache.values())try{rec?.texture?.destroy?.();}catch(_){}
        for(const rec of builtinSpriteTextures.values())try{rec?.texture?.destroy?.();}catch(_){}
        spriteTextureCache.clear();builtinSpriteTextures.clear();
        try{whiteTexture?.destroy?.();}catch(_){}whiteTexture=null;whiteTextureView=null;
    }
    function reset(){
        for(const b of uniformBuffers)try{b?.destroy?.();}catch(_){}
        for(const r of recordSet)try{r?.buffer?.destroy?.();}catch(_){}
        destroySpriteTextures();uniformBuffers=[];recordSet.clear();pathIndexStatic=new WeakMap();pathIndexDynamic=new WeakMap();bindCache=new WeakMap();renderBundleCache=new WeakMap();views=new WeakMap();overlayQueue.length=0;overlayFrameActive=false;uniformCursor=0;
        try{fallbackArcMetaBuffer?.destroy?.();}catch(_){}fallbackArcMetaBuffer=null;pipeline=null;sampler=null;ready=false;attempted=false;overlayConfiguredGeneration=-1;
    }
    function ensureWhiteTexture(){
        if(whiteTextureView)return whiteTextureView;
        whiteTexture=device.createTexture({label:'SpiroStar Path FX white texture',size:[1,1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
        device.queue.writeTexture({texture:whiteTexture},new Uint8Array([255,255,255,255]),{bytesPerRow:4},{width:1,height:1,depthOrArrayLayers:1});whiteTextureView=whiteTexture.createView();return whiteTextureView;
    }
    function ensureBuiltinSpriteTexture(type){
        type=normalizeLineSpriteType(type);const hit=builtinSpriteTextures.get(type);if(hit?.view)return hit.view;
        const w=1024,h=128,data=new Uint8Array(w*h*4),clamp=v=>Math.max(0,Math.min(1,v)),smooth=(a,b,x)=>{const t=clamp((x-a)/Math.max(1e-9,b-a));return t*t*(3-2*t);},edge=q=>clamp(.5+q*34);
        const put=(x,y,alpha,p=1,s=0,k=0)=>{const o=(y*w+x)*4,sum=Math.max(.001,p+s+k);data[o]=Math.round(clamp(p/sum)*255);data[o+1]=Math.round(clamp(s/sum)*255);data[o+2]=Math.round(clamp(k/sum)*255);data[o+3]=Math.round(clamp(alpha)*255);};
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
            const u=x/(w-1),v=(y/(h-1)-.5)*2;let a=0,p=1,sc=0,k=0;
            if(type==='snake'){
                const tail=.025+.275*smooth(0,.16,u),body=.30,headGrow=.17*smooth(.83,.95,u)-.09*smooth(.988,1,u),half=u<.18?tail:Math.max(.06,body+headGrow);a=edge(half-Math.abs(v));
                if(u>.90){const ex=(u-.958)/.052,ey=v/.46;a=Math.max(a,edge(1-(ex*ex+ey*ey)));}
                const stripe=.5+.5*Math.sin(u*34*Math.PI+v*3.2),belly=smooth(.02,.26,v);sc=clamp(.10+.62*belly+.42*smooth(.72,.94,stripe));p=Math.max(.08,1-sc);
                const eye=u>.953&&u<.978&&Math.abs(v+.18)<.065;if(eye){p=0;sc=0;k=1;a=1;}
            }else if(type==='bones'){
                const cells=12,cu=(u*cells)%1,shaft=cu>.17&&cu<.83?edge(.115-Math.abs(v)):0;const knob=(cx,cy,r)=>edge(1-(((cu-cx)/r)**2+((v-cy)/(.18))**2));a=Math.max(shaft,knob(.16,-.13,.11),knob(.16,.13,.11),knob(.84,-.13,.11),knob(.84,.13,.11));sc=clamp(.18+.5*Math.abs(v));p=1-sc*.65;k=(cu>.47&&cu<.53&&Math.abs(v)<.04)?.55:0;
            }else if(type==='dachshund'){
                const body=(u>.13&&u<.79)?edge(.24-Math.abs(v)):0,head=edge(1-(((u-.865)/.095)**2+((v+.01)/.40)**2)),snout=(u>.86&&u<.995)?edge(.15-Math.abs(v-.02)):0;let tail=0;if(u<.18){const tc=-.18+.9*(.18-u),th=.055+.05*smooth(0,.18,u);tail=edge(th-Math.abs(v-tc));}
                let legs=0;for(const lx of [.28,.41,.62,.73])if(Math.abs(u-lx)<.025&&v>.18&&v<.72)legs=1;const ear=edge(1-(((u-.81)/.045)**2+((v-.28)/.30)**2));a=Math.max(body,head,snout,tail,legs,ear);sc=clamp((v>.12?.62:.12)+(legs?.22:0)+(ear?.28:0));p=1-sc*.78;const eye=u>.87&&u<.89&&v<-.10&&v>-.19,nose=u>.982&&Math.abs(v)<.10;if(eye||nose){p=0;sc=0;k=1;a=1;}
            }else if(type==='dragon'){
                const tail=.025+.26*smooth(0,.15,u),half=u<.18?tail:.28+.11*smooth(.84,.96,u);a=edge(half-Math.abs(v));if(u>.90){const ex=(u-.96)/.055,ey=v/.43;a=Math.max(a,edge(1-(ex*ex+ey*ey)));}
                const cell=(u*13)%1,spike=cell>.35&&cell<.65?(.23+.65*(1-Math.abs(cell-.5)/.15)):0;if(v<-.25&&-v<spike)a=Math.max(a,edge(spike+v));sc=clamp(.12+.68*smooth(-.05,.34,v)+.35*(spike>0&&v<-.25?1:0));p=1-sc*.8;const eye=u>.958&&u<.98&&v<-.08&&v>-.2;if(eye){p=0;sc=0;k=1;a=1;}
            }else{
                const cells=14,cu=(u*cells)%1,cx=.5,rr=.42,dx=(cu-cx)/.48,dy=v/.43;a=edge(1-(dx*dx+dy*dy));if(u>.92){const hx=(u-.965)/.045,hy=v/.50;a=Math.max(a,edge(1-(hx*hx+hy*hy)));}sc=clamp(.10+.55*(.5+.5*Math.sin(u*28*Math.PI)));p=1-sc*.75;const eye=u>.967&&u<.985&&v<-.10&&v>-.22;if(eye){p=0;sc=0;k=1;a=1;}
            }
            put(x,y,a,p,sc,k);
        }
        const texture=device.createTexture({label:`SpiroStar built-in ${type} sprite`,size:[w,h,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});device.queue.writeTexture({texture},data,{bytesPerRow:w*4,rowsPerImage:h},{width:w,height:h,depthOrArrayLayers:1});const rec={texture,view:texture.createView(),type};builtinSpriteTextures.set(type,rec);return rec.view;
    }
    async function initAsync(){
        if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready)return false;attempted=true;initializing=true;lastError='';
        try{
            const sh=await WebGPUDeviceHub.acquire();device=sh.device;generation=sh.generation;format=navigator.gpu.getPreferredCanvasFormat();lost=false;
            const mod=device.createShaderModule({label:'SpiroStar GPU Path FX WGSL v435',code:WGSL});await assertWebGPUShaderModule(mod,'SpiroStar GPU Path FX WGSL v435');
            pipeline=device.createRenderPipeline({label:'SpiroStar GPU Path FX v435',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-strip',cullMode:'none'}});
                fallbackArcMetaBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar Path FX fallback arc meta'});device.queue.writeBuffer(fallbackArcMetaBuffer,0,new Float32Array([0,0,0,0]));
            uniformBuffers=Array.from({length:96},(_,i)=>device.createBuffer({size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar Path FX U ${i}`}));
            sampler=device.createSampler({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});ensureWhiteTexture();ensureBuiltinSpriteTexture('snake');uniformCursor=0;ready=true;requestMainCanvasRender();return true;
        }catch(err){lastError=String(err?.message||err);ready=false;return false;}finally{initializing=false;}
    }
    function warmup(){const hub=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();if(ready&&(!hub||gen!==generation)){reset();lost=!hub;}if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hub;}
    function pathIndexRecord(table){
        const count=Math.max(0,Number(table?.segmentCount)||table?.segs?.length||0);
        if(table?.gpuArcResident===true&&table?.gpuPathIndexBuffer)return{buffer:table.gpuPathIndexBuffer,count,generation,frameId:Math.max(0,Number(table?.frameId)||0),externalGpu:true};
        const dynamic=table?.dynamicFrame===true,cache=dynamic?pathIndexDynamic:pathIndexStatic;let rec=cache.get(table),fid=Math.max(0,Number(table?.frameId)||0);
        if(!rec||rec.generation!==generation||rec.capacity<count){try{rec?.buffer?.destroy?.();}catch(_){}const cap=performanceGovernor.capacityFor(count,rec?.capacity||0,64,1.6);rec={buffer:device.createBuffer({size:Math.max(4,cap*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label:'SpiroStar Path FX path indices'}),capacity:cap,count:0,frameId:-1,generation,cpu:new Uint32Array(Math.max(1,cap)),snapshot:new Uint32Array(Math.max(1,cap)),packedVersion:-1};cache.set(table,rec);recordSet.add(rec);}
        const direct=table?.gpuPathIndexData instanceof Uint32Array&&Math.max(0,Number(table?.gpuPathIndexCount)||0)===count;
        if(direct){const version=Math.max(0,Number(table?.gpuPathIndexVersion)||0);rec.frameId=fid;if(rec.count===count&&rec.packedVersion===version)return rec;device.queue.writeBuffer(rec.buffer,0,table.gpuPathIndexData.buffer,table.gpuPathIndexData.byteOffset,count*4);rec.count=count;rec.packedVersion=version;pathIndexUploads++;pathIndexUploadBytes+=count*4;return rec;}
        let changed=rec.count!==count;for(let i=0;i<count;i++){const seg=table.segs?.[i],pi=(Math.max(0,Number(seg?.pathIndex)||0)>>>0)&0x00ffffff,v=(pi|(seg?.keyStart===true?0x40000000:0)|(seg?.keyEnd===true?0x80000000:0))>>>0;rec.cpu[i]=v;if(!changed&&rec.snapshot[i]!==v)changed=true;}rec.frameId=fid;rec.packedVersion=-1;if(!changed)return rec;
        device.queue.writeBuffer(rec.buffer,0,rec.cpu.buffer,0,count*4);rec.snapshot.set(rec.cpu.subarray(0,count),0);rec.count=count;pathIndexUploads++;pathIndexUploadBytes+=count*4;return rec;
    }
    function textureRecord(cfg){
        const type=normalizeLineSpriteType(cfg?.type),data=String(cfg?.imageDataUrl||'');if(!data)return{view:ensureBuiltinSpriteTexture(type),custom:false,native:false,template:true,ready:true};
        let rec=spriteTextureCache.get(data);if(rec?.generation===generation&&rec.ready&&rec.view)return{view:rec.view,custom:true,native:cfg?.matchLineColor===false,template:false,ready:true};
        if(!rec||rec.generation!==generation){
            rec={generation,ready:false,loading:true,error:'',texture:null,view:null};spriteTextureCache.set(data,rec);customTextureLoads++;
            (async()=>{try{const blob=await (await fetch(data)).blob(),bitmap=await createImageBitmap(blob),w=Math.max(1,bitmap.width||1),h=Math.max(1,bitmap.height||1),texture=device.createTexture({label:'SpiroStar custom line sprite',size:[w,h,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});device.queue.copyExternalImageToTexture({source:bitmap},{texture},{width:w,height:h,depthOrArrayLayers:1});bitmap.close?.();rec.texture=texture;rec.view=texture.createView();rec.ready=true;rec.loading=false;requestMainCanvasRender();}catch(err){rec.error=String(err?.message||err);rec.loading=false;customTextureErrors++;lastError=`Custom sprite: ${rec.error}`;requestMainCanvasRender();}})();
        }
        return{view:rec?.ready&&rec.view?rec.view:ensureBuiltinSpriteTexture(type),custom:!!rec?.ready,native:cfg?.matchLineColor===false&&!!rec?.ready,template:!rec?.ready,ready:!!rec?.ready};
    }
    function pathFxBindGroup(ub,segBuffer,indexBuffer,texView,metaBuffer){let bySeg=bindCache.get(ub);if(!bySeg){bySeg=new WeakMap();bindCache.set(ub,bySeg);}let byIdx=bySeg.get(segBuffer);if(!byIdx){byIdx=new WeakMap();bySeg.set(segBuffer,byIdx);}let byTex=byIdx.get(indexBuffer);if(!byTex){byTex=new WeakMap();byIdx.set(indexBuffer,byTex);}let byMeta=byTex.get(texView);if(!byMeta){byMeta=new WeakMap();byTex.set(texView,byMeta);}const mb=metaBuffer||fallbackArcMetaBuffer;let bg=byMeta.get(mb);if(!bg){bg=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ub}},{binding:1,resource:{buffer:segBuffer}},{binding:2,resource:{buffer:indexBuffer}},{binding:3,resource:texView},{binding:4,resource:sampler},{binding:5,resource:{buffer:mb}}]});byMeta.set(mb,bg);}return bg;}
    function textureView(tex){let v=views.get(tex);if(v)return v;v=tex.createView();views.set(tex,v);return v;}
    function pathFxRenderBundle(bg,instanceCount){
        const count=Math.max(0,Math.floor(Number(instanceCount)||0));
        if(!bg||!count||typeof device?.createRenderBundleEncoder!=='function'){bundleFallbacks++;return null;}
        let byCount=renderBundleCache.get(bg);if(!byCount){byCount=new Map();renderBundleCache.set(bg,byCount);}
        let rec=byCount.get(count);if(rec?.generation===generation){bundleHits++;return rec;}
        try{
            const enc=device.createRenderBundleEncoder({label:'SpiroStar Path FX retained draw v535',colorFormats:[format]});
            enc.setPipeline(pipeline);enc.setBindGroup(0,bg);enc.draw(4,count);
            rec={generation,bundle:enc.finish({label:'SpiroStar Path FX retained bundle v535'}),count};byCount.set(count,rec);bundleBuilds++;return rec;
        }catch(err){bundleFallbacks++;lastError=String(err?.message||err);return null;}
    }
    function normalizeMotionType(type){if(type==='sine')return'seaRaft';return['seaRaft','jumpRope','sinusoid'].includes(type)?type:'seaRaft';}
    function spriteTypeCode(type){return({snake:0,bones:1,dachshund:2,dragon:3,caterpillar:4})[normalizeLineSpriteType(type)]??0;}
    function ensureUniformBufferCount(count){
        const need=Math.max(1,Math.floor(Number(count)||1));
        while(uniformBuffers.length<need){const i=uniformBuffers.length;uniformBuffers.push(device.createBuffer({size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:`SpiroStar Path FX U ${i}`}));uniformBufferGrows++;}
    }
    function fillUniforms(table,layer,cfg,alpha,targetCtx,effectMode,now,canonCount,texRec,motionCfg=null){
        const m=targetCtx?.getTransform?.();if(!m)return null;const sx=Math.hypot(Number(m.a)||0,Number(m.b)||0),sy=Math.hypot(Number(m.c)||0,Number(m.d)||0),scale=Math.sqrt(Math.max(1e-8,sx*sy));
        ensureUniformBufferCount(uniformCursor+1);
        const ub=uniformBuffers[uniformCursor++],preset=getLineSpritePreset(cfg?.type),primary=effectMode==='sprite'?(cfg.matchLineColor!==false?(layer?.strokeColor||'#ffffff'):(cfg.color||preset.primary)):(layer?.strokeColor||'#ffffff'),col=GPUColorCache.rgba(primary),secondary=GPUColorCache.rgba(cfg?.secondaryColor||preset.secondary);
        const widthMul=effectMode==='sprite'?Math.max(.01,Number(cfg?.widthMultiplier)||1):1,width=Math.max(.2,(Number(layer?.strokeWidth)||1.5)*getLayerStrokeWidthMultiplier(layer)*Math.max(.2,Number(cfg?.widthPercent)||100)/100*widthMul),mc=(motionCfg?.enabled===true||effectMode==='motion')?(motionCfg||cfg):null,mt=mc?normalizeMotionType(mc.type):null,mode=mt==='seaRaft'?1:mt==='jumpRope'?2:mt==='sinusoid'?3:0;
        const amp=mc?(Math.max(0,Number(mc.amplitudePx)||0)*Math.max(0,Number.isFinite(Number(mc.amplitudeMultiplier))?Number(mc.amplitudeMultiplier):1))/Math.max(.0001,scale):0,wl=mc?Math.max(2,(Number(mc.wavelengthPx)||36)*Math.max(.01,Number.isFinite(Number(mc.wavelengthMultiplier))?Number(mc.wavelengthMultiplier):2))/Math.max(.0001,scale):72,speed=mc?Math.max(0,Number(mc.speedPercent)||0)/100:0,time=(Number(now)||performance.now())*.001,travel=time*60*speed/Math.max(.0001,scale),phase=time*6.28318530718*speed;
        const residentVisualRail=table?.gpuArcResident===true&&table?._gpuMorphArcResource?.morphRec?.bezierVisualRail===true;const smoothSpline=!residentVisualRail&&layer?.profileMode==='spline'&&normalizeSplineRenderMode(layer?.splineRenderMode)==='smooth';

// v437 summary:
// - Fill preparation remains available for Dash/Graffiti profiles instead of being skipped with the hidden carrier stroke.
// - Dash markers are physically 5x the displayed line thickness while the UI value/multiplier contract stays unchanged.
// - Dash Glow and Outline now use the GPU marker SDF itself, not the hidden continuous carrier line.
// - Moving Line is positioned after Fill in the editor and its effect provider is independent from Morph/line visibility.
// - Sprite mode explicitly enables/warms GPU Path FX. Graffiti Waist gets dense local sampling and tangent-normalized orientation.
// v436 summary:
// - Four top-level line modes: Point / Dash / Sprite / Graffiti.
// - Dash owns independent GPU stamp types: circle / square / cross / slash.
// - Sprite gallery is visible only in Sprite mode; Graffiti never exposes sprites.
// - Graffiti owns only calligraphic nib stamps; its ribbon angle is local-tangent-relative.
// - Playlist palette is common to the whole line and stays above the four mode selectors.
// v435: the spline carrier itself is already adaptively sampled. Extra shader subdivisions
        // are only for time-varying deformation, never for making a sprite look less segmented.
        let subdivisions=mode===2?8:mode===3?12:mode===1?8:1;const spritePlacement=normalizeLineSpritePlacement(cfg?.mode),placement=spritePlacement==='everyNthPath'?1:spritePlacement==='whole'?2:spritePlacement==='perSegment'?3:spritePlacement==='everyNth'?4:0;
        uf.fill(0);uf[0]=mainCanvas.width;uf[1]=mainCanvas.height;uf[2]=.8/Math.max(.0001,scale);uf[3]=Number(table.total)||0;uf[4]=m.a;uf[5]=m.c;uf[6]=m.e;uf[8]=m.b;uf[9]=m.d;uf[10]=m.f;
        uf[12]=col[0];uf[13]=col[1];uf[14]=col[2];uf[15]=Math.max(0,Math.min(1,Number(alpha)||0))*col[3];
        uf[16]=width*.5;uf[17]=subdivisions;uf[18]=effectMode==='sprite'?1:0;uf[19]=placement;uf[20]=Math.max(1,Math.round(Number(cfg?.everyN)||2));uf[21]=canonCount;uf[22]=texRec?.native?1:0;uf[23]=texRec?.template?1:0;
        uf[24]=mode;uf[25]=amp;uf[26]=wl;uf[27]=travel;uf[28]=phase;uf[29]=secondary[0];uf[30]=secondary[1];uf[31]=secondary[2];uf[32]=smoothSpline?1:0;uf[33]=effectMode==='sprite'?spriteTypeCode(cfg?.type):0;uf[34]=table?.gpuArcResident===true?1:0;{const N=Math.max(2,Math.round(Number(layer?.N)||2)),K=Math.max(1,Math.round(Number(layer?.K)||1));uf[35]=Math.max(1,Math.round(N/Math.max(1,gcd(N,K))));}device.queue.writeBuffer(ub,0,uf);return{ub,subdivisions,smoothSpline};
    }
    function hasPathFxTableData(table){return Boolean(table&&((Number(table.total)||0)>0||(table.gpuArcResident===true&&Math.max(0,Number(table.segmentCount)||0)>0)));}
    function encodeToTexture(targetTexture,table,layer,cfg,alpha,targetCtx,effectMode,now,loadOp='load',motionCfg=null){
        if(!targetTexture||!hasPathFxTableData(table)||!warmup())return null;
        try{
            const canon=WebGPUCanonicalPathStore.acquire(table,device,generation),idx=pathIndexRecord(table);if(!canon?.buffer||!canon.count||!idx?.buffer)return{handled:true,commandBuffer:null};
            const texRec=effectMode==='sprite'?textureRecord(cfg):{view:ensureWhiteTexture(),custom:false,native:false,ready:true},u=fillUniforms(table,layer,cfg,alpha,targetCtx,effectMode,now,canon.count,texRec,motionCfg);if(!u)return null;
            const bg=pathFxBindGroup(u.ub,canon.buffer,idx.buffer,texRec.view,table.gpuArcMetaBuffer),instanceCount=canon.count*u.subdivisions,bundleRec=pathFxRenderBundle(bg,instanceCount),enc=device.createCommandEncoder({label:`SpiroStar ${effectMode} Path FX v535`});
            if(table?._gpuMorphArcResource&&(typeof encodeGpuMorphArcTable!=='function'||!encodeGpuMorphArcTable(table,enc)))throw new Error('GPU Morph Arc encode failed');
            const pass=enc.beginRenderPass({colorAttachments:[{view:textureView(targetTexture),loadOp,storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
            if(bundleRec?.bundle){pass.executeBundles([bundleRec.bundle]);bundleExecutes++;}else{pass.setPipeline(pipeline);pass.setBindGroup(0,bg);pass.draw(4,instanceCount);}
            pass.end();frames++;draws++;segments+=instanceCount;return{handled:true,commandBuffer:enc.finish(),textureReady:texRec.ready,gpuArcTable:table?._gpuMorphArcResource?table:null};
        }catch(err){lastError=String(err?.message||err);return null;}
    }
    function encodeToLayerScene(targetTexture,table,layer,cfg,alpha,targetCtx,effectMode,now,motionCfg=null){return encodeToTexture(targetTexture,table,layer,cfg,alpha,targetCtx,effectMode,now,'load',motionCfg);}
    function configureOverlay(width,height){if(!warmup()||!overlayCanvas)return false;try{if(!overlayContext)overlayContext=overlayCanvas.getContext('webgpu');if(!overlayContext)throw new Error('WebGPU overlay context unavailable');const w=Math.max(1,Math.round(Number(width)||mainCanvas.width||1)),h=Math.max(1,Math.round(Number(height)||mainCanvas.height||1));if(overlayCanvas.width!==w)overlayCanvas.width=w;if(overlayCanvas.height!==h)overlayCanvas.height=h;if(overlayConfiguredGeneration!==generation){overlayContext.configure({device,format,alphaMode:'premultiplied'});overlayConfiguredGeneration=generation;}return true;}catch(err){lastError=String(err?.message||err);return false;}}
    function beginOverlayFrame(frameId,width,height,active){
        overlayFrameId=Math.max(0,Number(frameId)||0);overlayUsedFrame=-1;overlayQueue.length=0;uniformCursor=0;overlayFrameActive=active===true;
        if(!overlayFrameActive){if(overlayCanvas)overlayCanvas.style.display='none';return false;}
        if(!configureOverlay(width,height)){overlayFrameActive=false;if(overlayCanvas)overlayCanvas.style.display='none';return false;}
        overlayCanvas.style.display='block';overlayFrames++;return true;
    }
    function overlayQueueMark(){return overlayQueue.length;}
    function rollbackOverlayQueue(mark){const n=Math.max(0,Math.min(overlayQueue.length,Number(mark)||0));if(n<overlayQueue.length)overlayQueue.length=n;return true;}
    function queueOverlayDraw(table,layer,cfg,alpha,targetCtx,effectMode,now,motionCfg=null){
        if(!overlayFrameActive||!hasPathFxTableData(table)||!warmup())return null;
        try{
            const canon=WebGPUCanonicalPathStore.acquire(table,device,generation),idx=pathIndexRecord(table);if(!canon?.buffer||!canon.count||!idx?.buffer)return{handled:true,queued:false};
            const texRec=effectMode==='sprite'?textureRecord(cfg):{view:ensureWhiteTexture(),custom:false,native:false,ready:true},u=fillUniforms(table,layer,cfg,alpha,targetCtx,effectMode,now,canon.count,texRec,motionCfg);if(!u)return null;
            const bg=pathFxBindGroup(u.ub,canon.buffer,idx.buffer,texRec.view,table.gpuArcMetaBuffer),logicalSegments=canon.count*u.subdivisions,bundleRec=pathFxRenderBundle(bg,logicalSegments);overlayQueue.push({bg,count:canon.count,subdivisions:u.subdivisions,logicalSegments,table,bundle:bundleRec?.bundle||null});overlayQueuedDraws++;overlayMaxBatch=Math.max(overlayMaxBatch,overlayQueue.length);
            return{handled:true,queued:true,textureReady:texRec.ready};
        }catch(err){lastError=String(err?.message||err);return null;}
    }
    function flushOverlayFrame(){
        if(!overlayFrameActive)return true;if(!configureOverlay(mainCanvas.width,mainCanvas.height)){overlayFrameActive=false;return false;}
        try{
            const tex=overlayContext.getCurrentTexture(),enc=device.createCommandEncoder({label:'SpiroStar Path FX frame queue v512'});
            // v512: the same command buffer first produces Morph points + exact arc metrics,
            // then consumes them in the overlay render pass. No CPU readback and no extra submit.
            const encodedArc=new Set(),submittedArcTables=[];for(const item of overlayQueue){const rec=item.table?._gpuMorphArcResource;if(rec&&!encodedArc.has(rec)){
                const committed=typeof isGpuMorphArcTableCommitted==='function'&&isGpuMorphArcTableCommitted(item.table);
                if(committed){sharedArcReuses++;encodedArc.add(rec);continue;}
                if(typeof encodeGpuMorphArcTable!=='function'||!encodeGpuMorphArcTable(item.table,enc))throw new Error('GPU Morph Arc encode failed');encodedArc.add(rec);submittedArcTables.push(item.table);
            }}
            const pass=enc.beginRenderPass({colorAttachments:[{view:tex.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
            let logical=0;for(const item of overlayQueue){if(item.bundle){pass.executeBundles([item.bundle]);bundleExecutes++;}else{pass.setPipeline(pipeline);pass.setBindGroup(0,item.bg);pass.draw(4,item.count*item.subdivisions);}logical+=item.logicalSegments;}pass.end();device.queue.submit([enc.finish()]);for(const table of submittedArcTables)try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}overlaySubmissions++;overlayFlushes++;
            if(overlayQueue.length){overlayUsedFrame=overlayFrameId;overlayDraws+=overlayQueue.length;frames+=overlayQueue.length;draws+=overlayQueue.length;segments+=logical;}else overlayClearOnlySubmissions++;
            overlayQueue.length=0;overlayFrameActive=false;overlayCanvas.style.display='block';return true;
        }catch(err){lastError=String(err?.message||err);overlayQueue.length=0;overlayFrameActive=false;if(overlayCanvas)overlayCanvas.style.display='none';return false;}
    }
    function drawToOverlay(table,layer,cfg,alpha,targetCtx,effectMode,now,motionCfg=null){if(overlayFrameActive)return queueOverlayDraw(table,layer,cfg,alpha,targetCtx,effectMode,now,motionCfg);if(!configureOverlay(mainCanvas.width,mainCanvas.height))return null;try{const tex=overlayContext.getCurrentTexture(),loadOp=overlayUsedFrame===overlayFrameId?'load':'clear',rec=encodeToTexture(tex,table,layer,cfg,alpha,targetCtx,effectMode,now,loadOp,motionCfg);if(rec?.commandBuffer){device.queue.submit([rec.commandBuffer]);if(rec.gpuArcTable)try{noteGpuMorphArcTableSubmitted?.(rec.gpuArcTable);}catch(_){}overlayUsedFrame=overlayFrameId;overlayDraws++;overlaySubmissions++;overlayCanvas.style.display='block';}return rec;}catch(err){lastError=String(err?.message||err);return null;}}
    function status(){warmup();return{supported:!!navigator?.gpu,available:ready&&!lost,lastError,frames,draws,segments,pathIndexUploads,pathIndexUploadBytes,overlayFrames,overlayDraws,overlayQueue:{active:overlayFrameActive,pending:overlayQueue.length,queuedDraws:overlayQueuedDraws,flushes:overlayFlushes,submissions:overlaySubmissions,clearOnlySubmissions:overlayClearOnlySubmissions,maxBatch:overlayMaxBatch,uniformBuffers:uniformBuffers.length,uniformBufferGrows,sharedArcReuses,bundleBuilds,bundleHits,bundleExecutes,bundleFallbacks,policy:'all layer/copy Sprite + Moving Line draws share one WebGPU render pass and one queue.submit per active frame; v535 also reuses retained draw bundles; v530 reuses main-scene committed Morph Arc'},customTextureLoads,customTextureErrors,overlayActive:overlayCanvas?.style?.display!=='none',motionModes:['seaRaft','jumpRope','sinusoid'],spriteTypes:Object.keys(LINE_SPRITE_PRESETS),spritePolicy:'continuous arc-length ribbon; perSegment/everyNth/perPath/everyNthPath/whole placement; construction segments use N/gcd(N,K); adaptive spline carrier; procedural jet-print body with endpoint head/tail; custom image uses continuous UV',policy:'shared canonical GPU carrier; v512 submitted GPU Morph Arc fast path; frame-wide overlay queue; no per-copy command encoder/submit; no Canvas bridge'};}
    return{warmup,isReady:()=>warmup(),encodeToLayerScene,beginOverlayFrame,overlayQueueMark,rollbackOverlayQueue,queueOverlayDraw,flushOverlayFrame,drawToOverlay,status};
})();
window.__spiroPathFxGPUStatus=()=>WebGPUPathFxRenderer.status();
