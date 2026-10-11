// SpiroStar v516 — exact topology-Morph Lightning directly from shared GPU Arc.
// CPU owns timing/style only. Active arc windows, random placement and clipping happen on GPU.
// No CPU Morph path, exact rail, sliced pieces, flattening or per-frame segment upload is required.
window.__spiroRegisterModule?.('js/gpu/lightning-arc-renderer');

const WebGPULightningArcRenderer=(()=>{
    let device=null,generation=-1,format=null,ready=false,initializing=null,lastError='not-initialized';
    let uniformLayout=null,pathLayout=null,copyLayout=null,compositeLayout=null;
    let strokePipeline=null,strokeCorridorPipeline=null,maskPipeline=null,compositePipeline=null,compositeStencilPipeline=null,compositeOverPipeline=null,compositeOverStencilPipeline=null,compositePipelines=Object.create(null),compositeStencilPipelines=Object.create(null);
    let scratchTexture=null,scratchView=null,stencilTexture=null,stencilView=null,compositeBind=null,width=0,height=0,targetViews=new WeakMap();
    let uniformBuffers=[],uniformBinds=[],uniformCursor=0,pathBinds=new WeakMap(),copyBinds=new WeakMap(),strokeBundleCache=new WeakMap(),bundleObjectIds=new WeakMap(),bundleObjectSerial=0;
    const uniformData=new Float32Array(32);
    const stats={frames:0,draws:0,strokeDraws:0,uniformBindReuses:0,corridorFrames:0,corridorCopies:0,logicalSegments:0,arcEncodes:0,arcReuses:0,
        clippedFrames:0,stencilEdges:0,blurredHaloPasses:0,bundleBuilds:0,bundleHits:0,bundleExecutes:0,bundleFallbacks:0,cpuPathBuildsAvoided:0,cpuExactRailBuildsAvoided:0,cpuPieceBuildsAvoided:0,cpuSegmentUploadsAvoided:0,failures:0};

    const WGSL=`
struct U {
    viewport:vec2<f32>, _pad0:vec2<f32>,
    row0:vec4<f32>, row1:vec4<f32>, color:vec4<f32>,
    style:vec4<f32>, select0:vec4<f32>, select1:vec4<f32>, extra:vec4<f32>
};
@group(0) @binding(0) var<uniform> u:U;
@group(1) @binding(0) var<storage,read> segments:array<vec4<f32>>;
@group(1) @binding(1) var<storage,read> segmentMeta:array<vec4<u32>>;
@group(1) @binding(2) var<storage,read> pathRanges:array<vec4<u32>>;
@group(1) @binding(3) var<storage,read> arcMeta:array<vec4<f32>>;
@group(1) @binding(4) var<storage,read> retainedCubics:array<vec4<f32>>;
@group(2) @binding(0) var<storage,read> copyData:array<vec4<f32>>;

struct VOut{
    @builtin(position) position:vec4<f32>,
    @location(0) local:vec2<f32>,
    @location(1) @interpolate(flat) screenLen:f32,
    @location(2) @interpolate(flat) sourceStart:f32,
    @location(3) @interpolate(flat) sourceLen:f32,
    @location(4) @interpolate(flat) pathStart:f32,
    @location(5) @interpolate(flat) pathTotal:f32,
    @location(6) @interpolate(flat) pathIndex:u32,
    @location(7) @interpolate(flat) halfWidth:f32,
    @location(8) @interpolate(flat) glowRadius:f32,
    @location(9) @interpolate(flat) copyAlpha:f32
};
fn stableUnit(seed0:u32)->f32{
    var x=((seed0^0x9e3779b9u)*1664525u+1013904223u);
    x=x^(x>>16u);x=x*2246822507u;x=x^(x>>13u);
    return f32(x)*0.00000000023283064365386962890625;
}
fn intervalDelta(x:f32,a:f32,b:f32)->f32{if(x<a){return a-x;}if(x>b){return x-b;}return 0.0;}
fn flashedDelta(x:f32,start0:f32,len0:f32)->f32{
    let flash=clamp(u.select1.z,0.01,1.0);let travel=clamp(u.select1.w,0.0,1.0);let len=len0*flash;let start=start0+(len0-len)*travel;
    return intervalDelta(x,start,start+len);
}
fn selectedCellDelta(localD:f32,pathIndex:u32,pathTotal:f32,cell:i32)->f32{
    let virtualCount=max(1u,u32(u.select1.x+0.5));if(cell<0||cell>=i32(virtualCount)){return 1e20;}
    let mode=i32(u.select0.x+0.5);let nth=max(1u,u32(u.select1.y+0.5));let ci=u32(cell);let globalIndex=pathIndex*virtualCount+ci;
    if(mode==1&&globalIndex%nth!=0u){return 1e20;}
    let cellLen=pathTotal/f32(virtualCount);let baseLen=cellLen*clamp(u.select0.y,0.01,1.0);let room=max(0.0,cellLen-baseLen);
    let cycle=u32(max(0.0,u.select0.w)+0.5);let random=u.select0.z>0.5;
    let offset=select(0.0,stableUnit(cycle*4099u+globalIndex*131u+17u)*room,random);
    return flashedDelta(localD,f32(ci)*cellLen+offset,baseLen);
}
fn nearestActiveDelta(globalD:f32,pathIndex:u32,pathStart:f32,pathTotal:f32)->f32{
    let mode=i32(u.select0.x+0.5);let frac=clamp(u.select0.y,0.01,1.0);let random=u.select0.z>0.5;let cycle=u32(max(0.0,u.select0.w)+0.5);
    if(mode==3){
        let total=max(0.000001,arcMeta[0].x);let len=total*frac;let room=max(0.0,total-len);let off=select(0.0,stableUnit(cycle*4099u+73u)*room,random);return flashedDelta(globalD,off,len);
    }
    let localD=globalD-pathStart;
    if(mode==2){
        let len=pathTotal*frac;let room=max(0.0,pathTotal-len);let off=select(0.0,stableUnit(cycle*4099u+pathIndex*271u+31u)*room,random);return flashedDelta(localD,off,len);
    }
    let virtualCount=max(1u,u32(u.select1.x+0.5));let nth=select(1u,max(2u,u32(u.select1.y+0.5)),mode==1);let cellLen=max(0.000001,pathTotal/f32(virtualCount));
    let cur=i32(floor(localD/cellLen));let rem=i32((nth-((pathIndex*virtualCount)%nth))%nth);let base=rem+i32(floor(f32(cur-rem)/f32(nth)))*i32(nth);
    var best=selectedCellDelta(localD,pathIndex,pathTotal,base);
    best=min(best,selectedCellDelta(localD,pathIndex,pathTotal,base-i32(nth)));
    best=min(best,selectedCellDelta(localD,pathIndex,pathTotal,base+i32(nth)));
    return best;
}
fn cubicPoint(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let z=1.0-t;return z*z*z*p0+3.0*z*z*t*c1+3.0*z*t*t*c2+t*t*t*p3;}

fn cubicDerivativeArc(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let s=1.0-t;return 3.0*s*s*(c1-p0)+6.0*s*t*(c2-c1)+3.0*t*t*(p3-c2);}
fn arcCorrectMicroT(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,sub:u32,subdiv:u32,f0:f32)->f32{
    let f=clamp(f0,0.0,1.0);let sd=max(1u,subdiv);let t0=f32(sub)/f32(sd);let t1=f32(sub+1u)/f32(sd);if(f<=0.000001){return t0;}if(f>=0.999999){return t1;}
    let s0=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t0)));let s1=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t1)));let dv=s1-s0;let arcTarget=f*max(0.000001,s0+0.5*dv);
    // Integral of the local linear-speed model has a closed-form inverse. Rationalized root
    // avoids cancellation and is cheaper than iterative Newton correction in particle/Web loads.
    let disc=max(0.000000000001,s0*s0+2.0*dv*arcTarget);let q=clamp((2.0*arcTarget)/max(0.000001,s0+sqrt(disc)),0.0,1.0);return mix(t0,t1,q);
}
fn retainedPoint(si:u32,microT:f32)->vec2<f32>{
    let g=segments[si*2u];if(u.extra.w<0.5){return mix(g.xy,g.zw,microT);}let subdiv=max(1u,u32(u.extra.y+0.5));let logical=si/subdiv;let sub=si%subdiv;let q0=retainedCubics[logical*2u];let q1=retainedCubics[logical*2u+1u];let t=arcCorrectMicroT(q0.xy,q0.zw,q1.xy,q1.zw,sub,subdiv,microT);return cubicPoint(q0.xy,q0.zw,q1.xy,q1.zw,t);
}
fn screenPoint(p:vec2<f32>)->vec2<f32>{return vec2<f32>(u.row0.x*p.x+u.row0.y*p.y+u.row0.z,u.row1.x*p.x+u.row1.y*p.y+u.row1.z);}
fn corner(vid:u32)->vec2<f32>{return array<vec2<f32>,4>(vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,1.0))[vid%4u];}
fn makeStrokeVertex(si:u32,vid:u32,c0:vec4<f32>,c1:vec4<f32>,useCopy:bool)->VOut{
    let q=segments[si*2u+1u];var p0=retainedPoint(si,0.0);var p1=retainedPoint(si,1.0);var ca=1.0;var copyScale=1.0;
    if(useCopy){p0=vec2<f32>(c0.x*p0.x+c0.y*p0.y,c1.x*p0.x+c1.y*p0.y);p1=vec2<f32>(c0.x*p1.x+c0.y*p1.y,c1.x*p1.x+c1.y*p1.y);ca=c0.z;copyScale=max(0.000001,abs(c1.z));}
    let a=screenPoint(p0);let b=screenPoint(p1);let delta=b-a;let len=max(length(delta),0.0001);let dir=delta/len;let n=vec2<f32>(-dir.y,dir.x);
    let hw=max(0.18,u.style.x*copyScale);let gr=max(0.0,u.style.y*copyScale);let pad=hw+gr+3.0;let pathIndex=segmentMeta[si].z;let sourceLen=max(0.000001,q.y);
    // Conservative vertex-stage cull: inactive ultra-polygon segments never reach rasterization.
    // Keep one halo/cap radius in source-arc units so selected boundaries remain exact.
    let near=nearestActiveDelta(q.x+sourceLen*0.5,pathIndex,q.z,max(0.000001,q.w));let padSource=pad*(sourceLen/len);let activeCandidate=near<=sourceLen*0.5+padSource;
    let c=corner(vid);let tx=(c.x+1.0)*0.5;let lx=mix(-pad,len+pad,tx);let ly=c.y*pad;let p=a+dir*lx+n*ly;
    var o:VOut;if(activeCandidate){o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);}else{o.position=vec4<f32>(-3.0,-3.0,0.0,1.0);}
    o.local=vec2<f32>(lx,ly);o.screenLen=len;o.sourceStart=q.x;o.sourceLen=sourceLen;o.pathStart=q.z;o.pathTotal=max(0.000001,q.w);o.pathIndex=pathIndex;o.halfWidth=hw;o.glowRadius=gr;o.copyAlpha=select(0.0,ca,activeCandidate);return o;
}
@vertex fn vs(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->VOut{return makeStrokeVertex(iid,vid,vec4<f32>(0.0),vec4<f32>(0.0),false);}
@vertex fn vsCorridor(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->VOut{
    let segCount=max(1u,u32(u.extra.x+0.5));let ci=iid/segCount;let si=iid%segCount;return makeStrokeVertex(si,vid,copyData[ci*2u],copyData[ci*2u+1u],true);
}
@fragment fn fs(v:VOut)->@location(0) vec4<f32>{
    if(v.copyAlpha<=0.00001){discard;}let sourceX=v.sourceStart+(v.local.x/v.screenLen)*v.sourceLen;let da=nearestActiveDelta(sourceX,v.pathIndex,v.pathStart,v.pathTotal);let along=da*(v.screenLen/v.sourceLen);let d=length(vec2<f32>(along,v.local.y));
    let centerCoverage=min(1.0,2.0*v.halfWidth);let core=min(centerCoverage,clamp(v.halfWidth+0.5-d,0.0,1.0));let edge=max(0.0,d-v.halfWidth);var glow=0.0;
    if(v.glowRadius>0.01){let qq=edge/max(0.0001,v.glowRadius);let ss=clamp(u.extra.z,0.0,1.5);let start=mix(0.84,0.02,min(1.0,ss));glow=1.0-smoothstep(start,1.0,qq);if(ss>1.0){glow=pow(max(0.0,glow),mix(1.0,0.58,min(1.0,(ss-1.0)*2.0)));}}
    let intensity=max(0.0,(u.style.z*core+u.style.w*glow)*v.copyAlpha);let aa=clamp(intensity,0.0,1.0);if(aa<0.00015){discard;}return vec4<f32>(u.color.rgb*aa,aa);
}
struct MaskOut{@builtin(position) position:vec4<f32>};
@vertex fn vsMask(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->MaskOut{
    let metaData=segmentMeta[iid];let pr=pathRanges[metaData.z];let closed=pr.z!=0u;let a=screenPoint(retainedPoint(iid,0.0));let b=screenPoint(retainedPoint(iid,1.0));let anchor=vec2<f32>(-u.viewport.x*4.0-4096.0,-u.viewport.y*4.0-4096.0);
    var p=select(select(a,b,vid==2u),anchor,vid==0u);if(!closed){p=vec2<f32>(-8192.0,-8192.0);}var o:MaskOut;o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);return o;
}
@fragment fn fsMask()->@location(0) vec4<f32>{return vec4<f32>(0.0);}
`;
    const COMPOSITE_WGSL=`
@group(0) @binding(0) var srcTex:texture_2d<f32>;
struct V{@builtin(position) p:vec4<f32>};
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let q=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0))[i];var o:V;o.p=vec4<f32>(q,0.0,1.0);return o;}
@fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{let d=textureDimensions(srcTex);let q=vec2<i32>(clamp(i32(p.x),0,i32(d.x)-1),clamp(i32(p.y),0,i32(d.y)-1));return textureLoad(srcTex,q,0);}`;

    function blendMax(){return{color:{srcFactor:'one',dstFactor:'one',operation:'max'},alpha:{srcFactor:'one',dstFactor:'one',operation:'max'}};}
    async function initAsync(){
        if(ready&&device&&generation===WebGPUDeviceHub.getGeneration())return true;if(initializing)return initializing;
        const task=(async()=>{try{
            const shared=await WebGPUDeviceHub.acquire();device=shared.device;generation=shared.generation;format=navigator.gpu.getPreferredCanvasFormat();
            const mod=device.createShaderModule({label:'SpiroStar GPU Lightning Arc WGSL',code:WGSL}),comp=device.createShaderModule({label:'SpiroStar GPU Lightning Arc composite WGSL',code:COMPOSITE_WGSL});
            if(typeof assertWebGPUShaderModule==='function'){await assertWebGPUShaderModule(mod,'SpiroStar GPU Lightning Arc WGSL');await assertWebGPUShaderModule(comp,'SpiroStar GPU Lightning Arc composite WGSL');}
            uniformLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
            pathLayout=device.createBindGroupLayout({entries:[0,1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}))});
            copyLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
            const maxTarget={format,blend:blendMax()};
            strokePipeline=device.createRenderPipeline({label:'SpiroStar GPU Lightning Arc',layout:device.createPipelineLayout({bindGroupLayouts:[uniformLayout,pathLayout]}),vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[maxTarget]},primitive:{topology:'triangle-strip'}});
            strokeCorridorPipeline=device.createRenderPipeline({label:'SpiroStar GPU Lightning Arc Corridor',layout:device.createPipelineLayout({bindGroupLayouts:[uniformLayout,pathLayout,copyLayout]}),vertex:{module:mod,entryPoint:'vsCorridor'},fragment:{module:mod,entryPoint:'fs',targets:[maxTarget]},primitive:{topology:'triangle-strip'}});
            maskPipeline=device.createRenderPipeline({label:'SpiroStar GPU Lightning Arc parity mask',layout:device.createPipelineLayout({bindGroupLayouts:[uniformLayout,pathLayout]}),vertex:{module:mod,entryPoint:'vsMask'},fragment:{module:mod,entryPoint:'fsMask',targets:[{format,writeMask:0}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',stencilFront:{compare:'always',failOp:'keep',depthFailOp:'keep',passOp:'invert'},stencilBack:{compare:'always',failOp:'keep',depthFailOp:'keep',passOp:'invert'},stencilReadMask:1,stencilWriteMask:1}});
            // Iter33: explicit composite BGL. A layout obtained from a pipeline's
            // default `layout:'auto'` cannot legally be embedded into another PipelineLayout.
            compositeLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}}]});
            const compLayout=device.createPipelineLayout({bindGroupLayouts:[compositeLayout]}),stencilState={format:'depth24plus-stencil8',depthWriteEnabled:false,depthCompare:'always',stencilFront:{compare:'equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},stencilBack:{compare:'equal',failOp:'keep',depthFailOp:'keep',passOp:'keep'},stencilReadMask:1,stencilWriteMask:0};
            compositePipelines=Object.create(null);compositeStencilPipelines=Object.create(null);
            for(const mode of (typeof SWEEP_BLEND_MODES!=='undefined'?SWEEP_BLEND_MODES:['normal','screen','multiply','add','darken','lighten'])){
                const blend=sweepBlendGpuState(mode);
                compositePipelines[mode]=device.createRenderPipeline({label:`SpiroStar GPU Lightning Arc ${mode} composite`,layout:compLayout,vertex:{module:comp,entryPoint:'vs'},fragment:{module:comp,entryPoint:'fs',targets:[{format,blend}]},primitive:{topology:'triangle-list'}});
                compositeStencilPipelines[mode]=device.createRenderPipeline({label:`SpiroStar GPU Lightning Arc ${mode} stencil composite`,layout:compLayout,vertex:{module:comp,entryPoint:'vs'},fragment:{module:comp,entryPoint:'fs',targets:[{format,blend}]},primitive:{topology:'triangle-list'},depthStencil:stencilState});
            }
            compositePipeline=compositePipelines.add;compositeStencilPipeline=compositeStencilPipelines.add;compositeOverPipeline=compositePipelines.normal;compositeOverStencilPipeline=compositeStencilPipelines.normal;
            uniformBuffers=Array.from({length:96},(_,i)=>device.createBuffer({label:`SpiroStar Lightning Arc uniforms ${i}`,size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));uniformBinds=uniformBuffers.map(buffer=>device.createBindGroup({layout:uniformLayout,entries:[{binding:0,resource:{buffer}}]}));uniformCursor=0;pathBinds=new WeakMap();copyBinds=new WeakMap();strokeBundleCache=new WeakMap();bundleObjectIds=new WeakMap();bundleObjectSerial=0;ready=true;lastError='';return true;
        }catch(err){ready=false;lastError=String(err?.message||err);stats.failures++;return false;}})();initializing=task;try{return await task;}finally{if(initializing===task)initializing=null;}
    }
    function destroySize(){try{scratchTexture?.destroy?.();}catch(_){}try{stencilTexture?.destroy?.();}catch(_){}scratchTexture=scratchView=stencilTexture=stencilView=compositeBind=null;width=height=0;}
    function warmup(){try{WebGPUGraffitiContourGlow?.warmup?.();}catch(_){}const gen=typeof WebGPUDeviceHub!=='undefined'?WebGPUDeviceHub.getGeneration():-1;if(ready&&gen!==generation){ready=false;device=null;destroySize();uniformBuffers=[];uniformBinds=[];pathBinds=new WeakMap();copyBinds=new WeakMap();strokeBundleCache=new WeakMap();bundleObjectIds=new WeakMap();bundleObjectSerial=0;targetViews=new WeakMap();compositeLayout=null;}if(!ready&&!initializing)void initAsync();return ready;}
    function ensureSize(){if(!ready||!device)return false;const w=Math.max(1,mainCanvas.width|0),h=Math.max(1,mainCanvas.height|0);if(w===width&&h===height&&scratchTexture&&stencilTexture)return true;destroySize();width=w;height=h;scratchTexture=device.createTexture({label:'SpiroStar Lightning Arc scratch',size:[w,h,1],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});scratchView=scratchTexture.createView();stencilTexture=device.createTexture({label:'SpiroStar Lightning Arc stencil',size:[w,h,1],format:'depth24plus-stencil8',usage:GPUTextureUsage.RENDER_ATTACHMENT});stencilView=stencilTexture.createView();compositeBind=device.createBindGroup({layout:compositeLayout,entries:[{binding:0,resource:scratchView}]});return true;}
    function pathBind(table){const arcRec=table?._gpuMorphArcResource;if(!arcRec?.ready)return null;let bg=pathBinds.get(arcRec);if(bg)return bg;const morph=arcRec.morphRec;if(!morph?.cubicBuffer)return null;bg=device.createBindGroup({layout:pathLayout,entries:[{binding:0,resource:{buffer:arcRec.segmentBuffer}},{binding:1,resource:{buffer:arcRec.segmentMetaBuffer}},{binding:2,resource:{buffer:morph.pathRangeBuffer}},{binding:3,resource:{buffer:arcRec.metaBuffer}},{binding:4,resource:{buffer:morph.cubicBuffer}}]});pathBinds.set(arcRec,bg);return bg;}
    function copyBind(buffer){let bg=copyBinds.get(buffer);if(bg)return bg;bg=device.createBindGroup({layout:copyLayout,entries:[{binding:0,resource:{buffer}}]});copyBinds.set(buffer,bg);return bg;}
    function fillUniform(ctx,prepared,style,copyMode=false){
        const tr=ctx?.getTransform?.();if(!tr)return null;const cfg=prepared.cfg,sel=prepared.lightningSelection||{},rgb=GPUColorCache.rgb(style.color),sx=Math.hypot(Number(tr.a)||0,Number(tr.b)||0),sy=Math.hypot(Number(tr.c)||0,Number(tr.d)||0),screenScale=Math.sqrt(Math.max(1e-12,sx*sy));
        uniformData.fill(0);uniformData[0]=width;uniformData[1]=height;uniformData[4]=tr.a;uniformData[5]=tr.c;uniformData[6]=tr.e;uniformData[8]=tr.b;uniformData[9]=tr.d;uniformData[10]=tr.f;uniformData[12]=rgb[0];uniformData[13]=rgb[1];uniformData[14]=rgb[2];uniformData[15]=1;
        uniformData[16]=Math.max(.18,Math.abs(Number(style.width)||1)*screenScale*.5);uniformData[17]=Math.max(0,Number(style.glowRadius)||0)*screenScale;uniformData[18]=Math.max(0,Math.min(8,Number(style.coreAlpha)||0));uniformData[19]=Math.max(0,Math.min(32,Number(style.glowAlpha)||0));
        uniformData[20]=Number(sel.modeCode)||0;uniformData[21]=Math.max(.01,Math.min(1,Number(sel.frac)||1));uniformData[22]=sel.random?1:0;uniformData[23]=Math.max(0,Number(sel.cycle)||0);
        uniformData[24]=Math.max(1,Number(sel.constructionSegments)||1);uniformData[25]=Math.max(1,Number(sel.nth)||1);uniformData[26]=Math.max(.01,Math.min(1,Number(style.flashFrac)||1));uniformData[27]=Math.max(0,Math.min(1,Number(style.travel)||0));
        uniformData[28]=Math.max(1,Number(prepared.table?._gpuMorphArcResource?.segmentCount)||1);uniformData[29]=Math.max(1,Number(prepared.table?._gpuMorphArcResource?.subdiv)||1);uniformData[30]=Math.max(0,Math.min(1.5,Number(style.softness)||0));uniformData[31]=prepared.table?._gpuMorphArcResource?.morphRec?.cubicBuffer?1:0;
        const slot=uniformCursor++%uniformBuffers.length,ub=uniformBuffers[slot];device.queue.writeBuffer(ub,0,uniformData.buffer,0,128);stats.uniformBindReuses++;return{bind:uniformBinds[slot],slot};
    }
    function bundleObjectId(obj){if(!obj)return 0;let id=bundleObjectIds.get(obj);if(id)return id;id=++bundleObjectSerial;bundleObjectIds.set(obj,id);return id;}
    function strokeBundle(arcRec,pbg,copyBg,uniformRow,instances){
        if(typeof device?.createRenderBundleEncoder!=='function'||!arcRec||!pbg||!uniformRow?.bind)return null;
        let cache=strokeBundleCache.get(arcRec);if(!cache){cache=new Map();strokeBundleCache.set(arcRec,cache);}
        const corridor=Boolean(copyBg),key=`${corridor?1:0}|${bundleObjectId(copyBg)}|${uniformRow.slot}|${instances}`;let hit=cache.get(key);
        if(hit){stats.bundleHits++;return hit;}
        try{
            const rbe=device.createRenderBundleEncoder({label:'SpiroStar exact Lightning retained stroke',colorFormats:[format]});
            rbe.setPipeline(corridor?strokeCorridorPipeline:strokePipeline);rbe.setBindGroup(0,uniformRow.bind);rbe.setBindGroup(1,pbg);if(corridor)rbe.setBindGroup(2,copyBg);rbe.draw(4,instances);
            const bundle=rbe.finish();hit={bundle,list:[bundle]};cache.set(key,hit);stats.bundleBuilds++;return hit;
        }catch(_){stats.bundleFallbacks++;return null;}
    }
    function strokeStyles(frame,baseAlpha,cfg){
        const out=[];if(!frame||frame.stage==='idle')return out;const aBase=Math.max(0,Math.min(1,Number(baseAlpha)||0));
        if(frame.stage==='precharge'){
            const paGlow=Math.max(0,Math.min(1,aBase*Math.max(0,Number(frame.prechargeAlpha)||0))),paCore=paGlow*Math.max(0,Math.min(1,Number.isFinite(Number(frame.flashOpacity))?Number(frame.flashOpacity):1));
            if(paGlow>.001||paCore>.001){
                const gr=lightningVisualGlowRadius(frame.prechargeGlow),flashFrac=Math.max(.01,Math.min(1,Number.isFinite(Number(frame.flashLength))?Number(frame.flashLength):getLightningFlashLengthPercent(cfg)/100)),flashColor=frame.flash||'#ffffff',w=Math.max(.15,Number(frame.prechargeWidth)||.15),bright=Math.max(0,Number(frame.prechargeBrightness)||0);
                out.push({width:w,color:flashColor,coreAlpha:0,glowRadius:gr,glowAlpha:paGlow*frame.prechargeGlowIntensity*bright*(frame.smoothLighting?.32:.24),softness:frame.prechargeSoftness,flashFrac,travel:frame.prechargeT});
                out.push({width:w*1.12,color:flashColor,coreAlpha:paCore*.32,glowRadius:0,glowAlpha:0,softness:0,flashFrac,travel:frame.prechargeT});
                out.push({width:w,color:flashColor,coreAlpha:paCore,glowRadius:0,glowAlpha:0,softness:0,flashFrac,travel:frame.prechargeT});
            }return out;
        }
        const pushStrike=(intensity,microIndex=-1)=>{const a=Math.max(0,Math.min(1,aBase*Math.max(0,Number(intensity)||0)));if(a<=.001)return;const micro=microIndex>=0,outerColor=micro&&microIndex%2===0?frame.primary:frame.secondary,innerColor=micro&&microIndex%2===0?frame.secondary:frame.primary,outerW=frame.precisionHigh?Math.max(frame.boltW+.22,frame.boltW*1.18):Math.max(frame.boltW+.7,frame.boltW*1.9),gr=lightningVisualGlowRadius(frame.glow),bright=Math.max(0,frame.brightness||0),haloA=a*.82*frame.glowIntensity*bright;
            out.push({width:outerW,color:outerColor,coreAlpha:0,glowRadius:gr,glowAlpha:haloA*(frame.smoothLighting?.34:.27),softness:frame.softness,flashFrac:1,travel:0});
            out.push({width:outerW,color:outerColor,coreAlpha:a*.34,glowRadius:0,glowAlpha:0,softness:0,flashFrac:1,travel:0});
            out.push({width:frame.boltW,color:lightningBrightCoreColor(innerColor),coreAlpha:a,glowRadius:0,glowAlpha:0,softness:0,flashFrac:1,travel:0});};
        pushStrike(frame.intensity,-1);if(frame.stage==='after')for(const pulse of frame.microPulses||[])pushStrike(pulse.intensity,pulse.index);return out;
    }
    function encode(targetTexture,prepared,frame,ctx,baseAlpha,behavior='symmetric',copies=null,alphas=null,frameCtx=null,footprint=1){
        if(!targetTexture||!prepared?.gpuMorphArcLightning||!prepared.table?.gpuArcResident||!frame||frame.showBase===true||!warmup()||!ensureSize())return{handled:false,commandBuffer:null};
        if(behavior!=='symmetric'&&Array.isArray(copies)&&copies.length)return{handled:false,commandBuffer:null,reason:'clipped-corridor-exact-fallback'};
        const arcRec=prepared.table._gpuMorphArcResource,morph=arcRec?.morphRec;if(!arcRec?.ready||!morph?.ready)return{handled:false,commandBuffer:null};
        if(frame.stage==='idle')return{handled:true,commandBuffer:null};
        try{
            const styles=strokeStyles(frame,baseAlpha,prepared.cfg);if(!styles.length)return{handled:true,commandBuffer:null};
            const encoder=device.createCommandEncoder({label:`SpiroStar exact GPU Lightning Arc L${morph.layerIndex}`});
            const hadCommitted=arcRec.hasCommittedData&&arcRec.lastCommittedT===prepared.table.gpuMorphT;const arcReady=typeof spiroGpuPrepareArcForLayerScene==='function'?spiroGpuPrepareArcForLayerScene(frameCtx,prepared.table,encoder):(typeof encodeGpuMorphArcTable==='function'&&encodeGpuMorphArcTable(prepared.table,encoder));if(!arcReady)throw new Error('GPU Morph Arc encode failed');if(hadCommitted||frameCtx?.frame?.gpuLayerSceneDeferred)stats.arcReuses++;else stats.arcEncodes++;
            const pbg=pathBind(prepared.table);if(!pbg)throw new Error('Lightning Arc path bind unavailable');let copyBg=null,copyCount=1;
            if(Array.isArray(copies)&&copies.length){const shared=WebGPUCorridorCopyStore.acquire(device,generation,frameCtx,copies,alphas,'sweep',footprint,frameCtx?.layer);if(!shared?.buffer||!shared.k)return{handled:true,commandBuffer:null};copyCount=shared.k;copyBg=copyBind(shared.buffer);stats.corridorFrames++;stats.corridorCopies+=copyCount;}
            const instances=arcRec.segmentCount*copyCount,haloStyles=styles.filter(s=>Number(s.glowAlpha)>0&&!(Number(s.coreAlpha)>0)),coreStyles=styles.filter(s=>Number(s.coreAlpha)>0);let targetView=targetViews.get(targetTexture);if(!targetView){targetView=targetTexture.createView();targetViews.set(targetTexture,targetView);}const clipped=behavior==='inside'||behavior==='outside';let pass;
            if(clipped){const maskUniform=fillUniform(ctx,prepared,{width:1,color:'#ffffff',coreAlpha:0,glowRadius:0,glowAlpha:0,flashFrac:1,travel:0},false);pass=encoder.beginRenderPass({colorAttachments:[{view:targetView,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:stencilView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard',stencilClearValue:0,stencilLoadOp:'clear',stencilStoreOp:'store'}});pass.setPipeline(maskPipeline);pass.setBindGroup(0,maskUniform.bind);pass.setBindGroup(1,pbg);pass.draw(3,arcRec.segmentCount);pass.end();stats.clippedFrames++;stats.stencilEdges+=arcRec.segmentCount;}
            const drawAnalyticGroup=(group,core)=>{if(!group.length)return;pass=encoder.beginRenderPass({colorAttachments:[{view:scratchView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});for(const style of group){const ub=fillUniform(ctx,prepared,style,Boolean(copyBg));if(!ub)continue;const bundled=strokeBundle(arcRec,pbg,copyBg,ub,instances);if(bundled){pass.executeBundles(bundled.list);stats.bundleExecutes++;}else{pass.setPipeline(copyBg?strokeCorridorPipeline:strokePipeline);pass.setBindGroup(0,ub.bind);pass.setBindGroup(1,pbg);if(copyBg)pass.setBindGroup(2,copyBg);pass.draw(4,instances);}stats.strokeDraws++;}pass.end();const desc={colorAttachments:[{view:targetView,loadOp:'load',storeOp:'store'}]};if(clipped)desc.depthStencilAttachment={view:stencilView,depthLoadOp:'load',depthStoreOp:'discard',stencilLoadOp:'load',stencilStoreOp:'discard'};pass=encoder.beginRenderPass(desc);if(clipped)pass.setStencilReference(behavior==='inside'?1:0);const blendMode=core?sweepCoreBlendMode(prepared.cfg):sweepGlowBlendMode(prepared.cfg),pipelines=clipped?compositeStencilPipelines:compositePipelines;pass.setPipeline(pipelines[blendMode]||pipelines.normal);pass.setBindGroup(0,compositeBind);pass.draw(3);pass.end();};
            // Somata 7.3.7 — large analytic per-microsegment halos create the radial support
            // wedges visible on curved Spiral lightning.  For symmetric Lightning, rasterize
            // only the exact narrow strike into a GPU mask and generate Glow by separable blur.
            // The retained cubic/Arc still selects the strike; only halo construction changes.
            const drawBlurredHaloGroup=(group)=>{
                if(!group.length)return;
                const blurApi=typeof WebGPUGraffitiContourGlow!=='undefined'?WebGPUGraffitiContourGlow:null;
                // Never fall back to expanded per-microsegment halo geometry: that path is the
                // source of the triangular/radial wedges on curved Spiral lightning. A warming
                // blur pipeline rejects this frame and retries GPU-only on the next one.
                if(!blurApi?.isReady?.())throw new Error('Lightning contour Glow blur warming');
                for(const style of group){
                    const slot=blurApi.acquire?.(width,height);if(!slot)throw new Error('Lightning contour Glow scratch unavailable');
                    const maskStyle={...style,color:'#ffffff',coreAlpha:1,glowRadius:0,glowAlpha:0};const ub=fillUniform(ctx,prepared,maskStyle,Boolean(copyBg));if(!ub)continue;
                    pass=encoder.beginRenderPass({colorAttachments:[{view:slot.mask.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(copyBg?strokeCorridorPipeline:strokePipeline);pass.setBindGroup(0,ub.bind);pass.setBindGroup(1,pbg);if(copyBg)pass.setBindGroup(2,copyBg);pass.draw(4,instances);pass.end();stats.strokeDraws++;
                    const color=GPUColorCache.rgba(style.color);const ok=blurApi.encodeBlurComposite?.(encoder,slot,targetTexture,{radiusPx:Math.max(.5,Number(style.glowRadius)||.5),alphaScale:Math.max(0,Math.min(1,Number(style.glowAlpha)||0)),color,softness:style.softness,blendMode:sweepGlowBlendMode(prepared.cfg),stencilView:clipped?stencilView:null,stencilReference:behavior==='inside'?1:0});if(!ok)throw new Error('Lightning contour Glow blur encode failed');stats.blurredHaloPasses++;
                }
            };
            drawBlurredHaloGroup(haloStyles);drawAnalyticGroup(coreStyles,true);
            stats.frames++;stats.draws++;stats.logicalSegments+=arcRec.segmentCount*copyCount*styles.length;stats.cpuPathBuildsAvoided++;stats.cpuExactRailBuildsAvoided++;stats.cpuPieceBuildsAvoided++;stats.cpuSegmentUploadsAvoided+=arcRec.segmentCount;
            return{handled:true,commandBuffer:encoder.finish(),onSubmitted:()=>noteGpuMorphArcTableSubmitted?.(prepared.table)};
        }catch(err){lastError=String(err?.message||err);stats.failures++;return{handled:false,commandBuffer:null,reason:lastError};}
    }
    function encodeToLayerScene(targetTexture,prepared,frame,ctx,baseAlpha,behavior='symmetric',frameCtx=null){return encode(targetTexture,prepared,frame,ctx,baseAlpha,behavior,null,null,frameCtx,1);}
    function encodeCorridorToLayerScene(targetTexture,prepared,frame,ctx,baseAlpha,copies,alphas,frameCtx,footprint=1,behavior='symmetric'){return encode(targetTexture,prepared,frame,ctx,baseAlpha,behavior,copies,alphas,frameCtx,footprint);}
    function status(){warmup();return{available:ready,generation,lastError,width,height,...stats,contract:'Topology/Spiral Morph Lightning uses the shared resident GPU Arc and retained cubic Bézier carrier. Core keeps exact retained-Arc raster; symmetric Glow is generated from the exact strike mask by separable GPU blur (independent blend mode), eliminating microsegment support wedges. Precharge flash is composited as Glow. No CPU geometry or Canvas carrier is rebuilt.'};}
    return{warmup,isReady:()=>warmup()&&Boolean(typeof WebGPUGraffitiContourGlow!=='undefined'&&WebGPUGraffitiContourGlow.isReady?.()),encodeToLayerScene,encodeCorridorToLayerScene,status};
})();
window.__spiroGpuLightningArcStatus=()=>WebGPULightningArcRenderer.status();
