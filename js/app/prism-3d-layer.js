window.__spiroRegisterModule?.('js/app/prism-3d-layer');
// v8.20.11 — smooth sphere refraction, color and fill uniforms, sculpted skull.
// Uses the existing shared WebGPU device hub and an independent depth-tested triangle mesh.
// The backdrop is a live texture snapshot of the 2D compositor. Sphere uses a
// two-interface Snell refraction ray through its spherical volume; other meshes
// use an approximate exit surface (not a general ray tracer).
const SomataPrism3D=(()=>{
    let canvas=null,context=null,device=null,hubGeneration=-1,format='',pipeline=null,depthTexture=null;
    let sceneTexture=null,sceneTextureWidth=0,sceneTextureHeight=0,sampler=null,uniformBuffer=null,bindGroup=null;
    let pending=null,ready=false,lastError='',frames=0,sceneUploaded=false,lastTriangles=0,lastShape='';
    let opticalReady=false,opticalError='';
    let viewportWidth=0,viewportHeight=0;
    let sceneCapture=null,sceneCaptureCtx=null,sceneOrigin='',lastSceneError='';
    let geometry=null,geometryShape=null;
    let vertexBuffer=null,uploadedShape='';
    const meshes=new Map(),gpuMeshes=new Map();
    const WGSL=`
struct Uniforms {
    model: mat4x4<f32>,
    eye: vec4<f32>,        // shiftX, shiftY, mesh scale, viewport aspect
    optics: vec4<f32>,     // refraction, dispersion [0,1], opacity [0,1], sphere flag
    viewport: vec4<f32>,   // width, height, hasBackground, skull flag
    palette: vec4<f32>,    // light hue, light strength, fill hue, fill intensity
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;
struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
};
struct VertexOutput {
    @builtin(position) clipPosition: vec4<f32>,
    @location(0) worldPosition: vec3<f32>,
    @location(1) worldNormal: vec3<f32>,
    @location(2) localPosition: vec3<f32>,
};
@vertex fn vs(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let p = (u.model * vec4<f32>(input.position * u.eye.z, 1.0)).xyz + vec3<f32>(u.eye.xy, -3.5);
    let z = -p.z;
    output.clipPosition = vec4<f32>(p.x * 2.35 / u.eye.w, p.y * 2.35, z * 1.0202 - 0.20202, z);
    output.worldPosition = p;
    output.worldNormal = normalize((u.model * vec4<f32>(input.normal, 0.0)).xyz);
    output.localPosition = input.position;
    return output;
}
fn projectToScene(origin: vec3<f32>, dir: vec3<f32>) -> vec2<f32> {
    let d = min(dir.z, -0.00001);
    let travel = max(0.0, (-7.0 - origin.z) / d);
    let hit = origin + dir * travel;
    let denom = max(-hit.z, 0.01);
    return clamp(vec2<f32>(0.5 + 1.175 * hit.x / (u.eye.w * denom),
                            0.5 - 1.175 * hit.y / denom), vec2<f32>(0.001), vec2<f32>(0.999));
}
fn opticalUv(pos: vec3<f32>, surfaceN: vec3<f32>, ior: f32, fragmentUv: vec2<f32>) -> vec2<f32> {
    let entering = normalize(pos);
    var inside = refract(entering, surfaceN, 1.0 / ior);
    if (length(inside) < 0.0001) { inside = entering; }
    var exitPos: vec3<f32>;
    var exitN: vec3<f32>;
    if (u.optics.w > 0.5) {
        let center = vec3<f32>(u.eye.xy, -3.5);
        let root = max(0.002, -2.0 * dot(pos - center, inside));
        exitPos = pos + inside * root;
        exitN = normalize(exitPos - center);
    } else {
        // Generic mesh: bounded thickness until accurate back-surface lookup exists.
        let thickness = u.eye.z * (0.8 + 0.8 * abs(dot(surfaceN, entering)));
        exitPos = pos + inside * thickness;
        exitN = -surfaceN;
    }
    var outgoing = refract(inside, -exitN, ior);
    if (length(outgoing) < 0.0001) { outgoing = reflect(inside, -exitN); }
    // The source is a FINISHED 2D SCREEN image, not a world-space wall at z=-7.
    // Compute the difference between bent and straight rays at the SAME depth,
    // then apply that displacement to the original screen pixel.  Sampling the
    // absolute hit UV was reading an unrelated area of Corridor (8.20.8).
    let straightUv = projectToScene(pos, entering);
    let refractedUv = projectToScene(exitPos, normalize(outgoing));
    let offsetPx = (refractedUv - straightUv) * u.viewport.xy;
    // Bound screen-space displacement to prevent a single grazing ray from
    // pulling the center of a distant polygon into the lens.
    let maxPixels = max(2.0, u.eye.z * min(u.viewport.x, u.viewport.y) * 0.075 *
                          (1.0 + log(1.0 + max(0.0, ior - 1.0))));
    // Isotropic soft radial limit: the old X/Y component clamp produced a
    // visibly square optical polygon in the CENTER of an otherwise round ball.
    let magnitude = length(offsetPx);
    let smoothMagnitude = maxPixels * (1.0 - exp(-magnitude / maxPixels));
    let boundedPx = offsetPx * (smoothMagnitude / max(magnitude, 0.00001));
    return clamp(fragmentUv + boundedPx / u.viewport.xy,
                 vec2<f32>(0.001), vec2<f32>(0.999));
}
fn hueColor(hue: f32) -> vec3<f32> {
    let a = fract(hue) * 6.0;
    return clamp(abs(fract(a / 6.0 + vec3<f32>(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - vec3<f32>(3.0)) - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
}
// In the fragment stage clipPosition IS the pixel-space position builtin.
// Declaring a second @builtin(position) parameter made the optical shader fail
// validation and forced the non-refractive blue backup material (8.20.6).
@fragment fn fs(input: VertexOutput) -> @location(0) vec4<f32> {
    let n = normalize(input.worldNormal);
    let v = normalize(-input.worldPosition);
    let ndv = clamp(dot(n, v), 0.0, 1.0);
    let fres = pow(1.0 - ndv, 3.0);
    let refr = max(u.optics.x, 0.0);
    let ior = 1.0 + refr * 0.028;
    let split = u.optics.y * (refr / (18.0 + refr)) * 0.09;
    var background = vec3<f32>(0.025, 0.045, 0.065);
    if (u.viewport.z > 0.5) {
        // Direct scene sampling at zero refraction makes image parity testable.
        let fragmentUv = input.clipPosition.xy / u.viewport.xy;
        if (refr < 0.001) {
            background = textureSample(sceneTex, sceneSampler, fragmentUv).rgb;
        } else {
            let uvR = opticalUv(input.worldPosition, n, ior + split, fragmentUv);
            let uvG = opticalUv(input.worldPosition, n, ior, fragmentUv);
            let uvB = opticalUv(input.worldPosition, n, max(1.00001, ior - split), fragmentUv);
            let red = textureSample(sceneTex, sceneSampler, uvR).r;
            let green = textureSample(sceneTex, sceneSampler, uvG).g;
            let blue = textureSample(sceneTex, sceneSampler, uvB).b;
            background = vec3<f32>(red, green, blue);
        }
    }
    let lightColor = mix(vec3<f32>(1.0), hueColor(u.palette.x), 0.76);
    let bodyColor = mix(vec3<f32>(0.07,0.19,0.27), hueColor(u.palette.z), 0.64);
    let fillAmount = clamp(u.palette.w,0.0,1.0);
    let illumination = clamp(u.palette.y,0.0,2.0);
    let light = normalize(vec3<f32>(-0.44, 0.76, 1.0));
    let h = normalize(light + v);
    let h2 = normalize(vec3<f32>(0.8, -0.12, 1.0) + v);
    let spec = pow(max(dot(n, h), 0.0), 110.0) * 0.7 + pow(max(dot(n, h2), 0.0), 185.0) * 0.45;
    // Fill is independent of optical scene refraction and the old opacity slider.
    var glass = mix(background, bodyColor, fillAmount);
    let tint = (0.012 + 0.11 * u.optics.z) * smoothstep(0.0, 1.0, ndv);
    glass = mix(glass, bodyColor, tint);
    glass += (0.016 + 0.24 * pow(1.0-ndv, 2.0)) * lightColor * (0.35 + illumination);
    glass += fres * mix(vec3<f32>(0.16,0.72,0.91), lightColor, 0.7) * (0.14 + 0.32 * u.optics.z) * (0.35 + illumination);
    glass += spec * lightColor * (0.3 + 0.9 * illumination);
    if (u.viewport.w > 0.5) {
        // Anatomical cavities on the front of the sculpted skull mesh.
        let p = input.localPosition;
        let front = smoothstep(0.0, 0.35, p.z);
        let leftEye = length((p.xy - vec2<f32>(-0.31,0.13)) / vec2<f32>(0.24,0.20));
        let rightEye = length((p.xy - vec2<f32>(0.31,0.13)) / vec2<f32>(0.24,0.20));
        let eyeSockets = (1.0-smoothstep(0.62,1.02,leftEye)) + (1.0-smoothstep(0.62,1.02,rightEye));
        let nose = 1.0-smoothstep(0.07,0.19,length((p.xy-vec2<f32>(0.0,-0.26))/vec2<f32>(0.85,1.0)));
        let teethBand = (smoothstep(-0.69,-0.59,p.y)-smoothstep(-0.48,-0.40,p.y))*front;
        let teeth = teethBand * (0.5 + 0.5*cos(p.x*58.0));
        let cavities = clamp((eyeSockets*0.91+nose*0.67)*front,0.0,0.93);
        glass = mix(glass, background*0.18, cavities);
        glass += teeth*vec3<f32>(0.46,0.47,0.44)*0.34;
    }
    // Already sampled the undistorted/diffracted backdrop: opaque INSIDE the mesh,
    // transparent OUTSIDE it. Blending the original scene again would erase bending.
    return vec4<f32>(clamp(glass, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
    // Minimal actual WebGPU shaded glass, only when the optical pipeline fails
    // WGSL validation. Not a 2D canvas fallback and not claimed as refraction.
    const WGSL_BASIC=`
struct Uniforms { model:mat4x4<f32>,eye:vec4<f32>,optics:vec4<f32>,viewport:vec4<f32>,palette:vec4<f32> };
@group(0) @binding(0) var<uniform> u:Uniforms;
struct In { @location(0) pos:vec3<f32>,@location(1) normal:vec3<f32> };
struct Out { @builtin(position) clip:vec4<f32>,@location(0) normal:vec3<f32>,@location(1) view:vec3<f32> };
@vertex fn vs(i:In)->Out {
 var o:Out;
 let p=(u.model*vec4<f32>(i.pos*u.eye.z,1.0)).xyz+vec3<f32>(u.eye.xy,-3.5);
 let z=-p.z;
 o.clip=vec4<f32>(p.x*2.35/u.eye.w,p.y*2.35,z*1.0202-0.20202,z);
 o.normal=normalize((u.model*vec4<f32>(i.normal,0.0)).xyz);
 o.view=normalize(-p);
 return o;
}
@fragment fn fs(i:Out)->@location(0) vec4<f32> {
 let n=normalize(i.normal);let v=normalize(i.view);
 let edge=pow(1.0-clamp(dot(n,v),0.0,1.0),2.0);
 let light=normalize(vec3<f32>(-0.55,0.73,1.0));
 let spec=pow(max(dot(n,normalize(v+light)),0.0),90.0);
 let hc=clamp(abs(fract(u.palette.x+vec3<f32>(0.0, 2.0/3.0, 1.0/3.0))*6.0-vec3<f32>(3.0))-vec3<f32>(1.0),vec3<f32>(0.0),vec3<f32>(1.0));
 let fc=clamp(abs(fract(u.palette.z+vec3<f32>(0.0, 2.0/3.0, 1.0/3.0))*6.0-vec3<f32>(3.0))-vec3<f32>(1.0),vec3<f32>(1.0));
 let glass=mix(vec3<f32>(0.035,0.14,0.19),fc,clamp(u.palette.w,0.0,1.0)) + edge*hc*(0.16+0.48*u.palette.y) + spec*hc*(0.20+u.palette.y);
 return vec4<f32>(clamp(glass,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}
`;
    function ensureCanvas(){
        if(canvas)return Boolean(canvas.isConnected);
        const root=document.getElementById('mainContainer')||document.getElementById('mainCanvas')?.parentNode;
        if(!root)return false;
        canvas=document.getElementById('prism3dLayerCanvas')||document.createElement('canvas');
        canvas.id='prism3dLayerCanvas';canvas.setAttribute('aria-label','Независимый WebGPU слой рефракции 3D');
        Object.assign(canvas.style,{position:'absolute',left:'0',top:'0',zIndex:'9',pointerEvents:'none',display:'none'});
        if(!canvas.isConnected)root.appendChild(canvas);
        return true;
    }
    function initAsync(){
        if(ready&&device&&hubGeneration===WebGPUDeviceHub.getGeneration?.())return;
        if(pending)return;
        if(!ensureCanvas())return;
        if(!navigator?.gpu||typeof WebGPUDeviceHub==='undefined'){
            lastError='WebGPU недоступен';return;
        }
        pending=(async()=>{
            try{
                const shared=await WebGPUDeviceHub.acquire();
                device=shared.device;hubGeneration=shared.generation;format=navigator.gpu.getPreferredCanvasFormat();
                context=canvas.getContext('webgpu');if(!context)throw Error('3D WebGPU canvas unavailable');
                const pipelineOptions=mod=>({label:'Somata optical 3D glass',layout:'auto',
                    vertex:{module:mod,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[
                        {shaderLocation:0,offset:0,format:'float32x3'},
                        {shaderLocation:1,offset:12,format:'float32x3'}]}]},
                    fragment:{module:mod,entryPoint:'fs',targets:[{format}]},
                    primitive:{topology:'triangle-list',frontFace:'ccw',cullMode:'back'},
                    depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
                opticalReady=false;opticalError='';
                try{
                    const shader=device.createShaderModule({label:'Somata optical 3D shader',code:WGSL});
                    if(typeof assertWebGPUShaderModule==='function')await assertWebGPUShaderModule(shader,'Somata optical 3D shader');
                    const problems=await shader.getCompilationInfo();
                    const errors=problems.messages.filter(m=>m.type==='error');
                    if(errors.length)throw Error('3D WGSL: '+errors.map(e=>e.message).join(' | ').slice(0,700));
                    pipeline=await (device.createRenderPipelineAsync?.(pipelineOptions(shader))??device.createRenderPipeline(pipelineOptions(shader)));
                    opticalReady=true;
                }catch(opticalFailure){
                    opticalError=String(opticalFailure?.message||opticalFailure);
                    const minimal=device.createShaderModule({label:'Somata basic WebGPU glass backup',code:WGSL_BASIC});
                    const problems=await minimal.getCompilationInfo();
                    const errors=problems.messages.filter(m=>m.type==='error');
                    if(errors.length)throw Error('Basic glass WGSL also failed: '+errors.map(e=>e.message).join(' | '));
                    pipeline=await (device.createRenderPipelineAsync?.(pipelineOptions(minimal))??device.createRenderPipeline(pipelineOptions(minimal)));
                }
                uniformBuffer=device.createBuffer({label:'Somata optical 3D params',size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                sampler=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
                bindGroup=null;ready=true;lastError='';
                window.requestAnimationFrame?.(()=>{ window.SomataAmbientPrism?.render?.(); animationScheduler?.invalidate?.(); });
            }catch(e){lastError=String(e?.message||e);ready=false;}
            finally{pending=null;}
        })();
    }
    function builder(){const v=[],n=[];return{
        tri(a,b,c,normals){const ab=b.map((x,i)=>x-a[i]),ac=c.map((x,i)=>x-a[i]);const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
            const len=Math.hypot(...cross)||1,face=cross.map(x=>x/len);for(const [i,p] of [a,b,c].entries()){v.push(...p);n.push(...(normals?.[i]||face));}},
        data(){return{vertices:new Float32Array(v),normals:new Float32Array(n),triangles:v.length/9};}
    };}
    const normalize=p=>{const l=Math.hypot(...p)||1;return p.map(x=>x/l);};
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const dot=(a,b)=>a.reduce((r,x,i)=>r+x*b[i],0);
    function uvBall(shape){const b=builder(),rows=shape==='sphere'?64:shape==='skull'?64:32,cols=shape==='sphere'?128:shape==='skull'?128:64,lens=shape==='lens',skull=shape==='skull';
        function point(lat,lon){const v=Math.sin(lat),h=Math.cos(lat),x=h*Math.cos(lon),y=v,z=h*Math.sin(lon);
            let p=[x,y,z];if(lens)p=[x*1.05,y*1.05,z*.29];
            if(skull){
                // Skull is sculpted rather than a uniformly shrunk ball:
                // broad cranium, temples, recessed eye sockets, nasal bridge,
                // cheek bones, a distinct upper jaw and narrowed chin.
                const lower=Math.max(0,-y);
                const front=Math.max(0,z);
                const taper=1.-0.18*lower-0.30*lower*lower;
                let xx=x*taper, yy=y-0.08*lower, zz=z*(1.0-0.10*lower);
                const leftEye=Math.exp(-((xx+0.33)**2/.035+(yy-0.13)**2/.029));
                const rightEye=Math.exp(-((xx-0.33)**2/.035+(yy-0.13)**2/.029));
                const nose=Math.exp(-(xx*xx/.010+(yy+0.26)**2/.043));
                const cheek=Math.exp(-((Math.abs(xx)-0.58)**2/.028+(yy+0.27)**2/.08));
                const muzzle=Math.exp(-(xx*xx/.22+(yy+0.50)**2/.033));
                zz += front*(-0.28*(leftEye+rightEye)-0.17*nose+0.12*cheek+0.12*muzzle);
                // Angular mandible creates a recognisable jaw and square teeth area.
                const chin=Math.max(0,(-yy-0.49)/0.51);
                xx *= 1-0.23*chin;
                p=[xx,yy,zz];
            }
            return p;
        }
        for(let j=0;j<rows;j++){const phi1=-Math.PI/2+Math.PI*j/rows,phi2=-Math.PI/2+Math.PI*(j+1)/rows;
            for(let i=0;i<cols;i++){const a=2*Math.PI*i/cols,c=2*Math.PI*(i+1)/cols;
                const p=point(phi1,a),q=point(phi1,c),r=point(phi2,c),s=point(phi2,a);
                // Outward orientation; upper sphere normals point away from the origin.
                function emit(x,y,z){const mid=[(x[0]+y[0]+z[0])/3,(x[1]+y[1]+z[1])/3,(x[2]+y[2]+z[2])/3];
                    const cx=cross(y.map((v,i)=>v-x[i]),z.map((v,i)=>v-x[i]));if(dot(cx,mid)<0){const t=y;y=z;z=t;}
                    b.tri(x,y,z,[normalize([x[0],x[1],x[2]*(lens?3:1)]),normalize([y[0],y[1],y[2]*(lens?3:1)]),normalize([z[0],z[1],z[2]*(lens?3:1)])]);}
                emit(p,q,r);emit(p,r,s);
            }}return b.data();
    }
    function box(b,c,s){const [x,y,z]=c,[w,h,d]=s,points=[[-w,-h,-d],[w,-h,-d],[w,h,-d],[-w,h,-d],[-w,-h,d],[w,-h,d],[w,h,d],[-w,h,d]].map(p=>p.map((a,i)=>a/2+[x,y,z][i]));
        for(const ids of [[4,5,6,7],[1,0,3,2],[5,1,2,6],[0,4,7,3],[7,6,2,3],[0,1,5,4]]){
            const [a,c,e,f]=ids,mid=points[a].map((v,i)=>(v+points[c][i]+points[e][i]+points[f][i])/4),out=mid.map((v,i)=>v-[x,y,z][i]);
            function emit(p,q,r){const t=cross(points[q].map((v,i)=>v-points[p][i]),points[r].map((v,i)=>v-points[p][i]));if(dot(t,out)<0){const tmp=q;q=r;r=tmp;}b.tri(points[p],points[q],points[r]);}
            emit(a,c,e);emit(a,e,f);
        }}
    function dodeca(){const b=builder(),ph=(1+Math.sqrt(5))/2;
        let verts=[[-1,ph,0],[1,ph,0],[-1,-ph,0],[1,-ph,0],[0,-1,ph],[0,1,ph],[0,-1,-ph],[0,1,-ph],[ph,0,-1],[ph,0,1],[-ph,0,-1],[-ph,0,1]].map(normalize);
        const faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
        const centers=faces.map(f=>normalize(f.reduce((a,i)=>a.map((x,k)=>x+verts[i][k]),[0,0,0])));
        for(let i=0;i<verts.length;i++){
            const axis=verts[i],ref=normalize(cross(Math.abs(axis[1])<.9?[0,1,0]:[1,0,0],axis)),right=cross(axis,ref);
            const ring=faces.map((f,j)=>f.includes(i)?j:-1).filter(j=>j>=0).sort((a,c)=>{
                const A=centers[a],B=centers[c];return Math.atan2(dot(A,right),dot(A,ref))-Math.atan2(dot(B,right),dot(B,ref));});
            const center=normalize(ring.reduce((p,j)=>p.map((v,k)=>v+centers[j][k]),[0,0,0]));
            for(let k=0;k<ring.length;k++){let p=centers[ring[k]],q=centers[ring[(k+1)%ring.length]],t=cross(p.map((v,j)=>v-center[j]),q.map((v,j)=>v-center[j]));if(dot(t,axis)<0)[p,q]=[q,p];b.tri(center,p,q);}
        }return b.data();
    }
    function meshFor(shape){if(meshes.has(shape))return meshes.get(shape);let m;
        if(shape==='sphere'||shape==='lens'||shape==='skull')m=uvBall(shape);
        else if(shape==='dodecahedron')m=dodeca();
        else{const b=builder();if(shape==='cross'){
            box(b,[0,0,0],[.58,1.9,.53]);box(b,[0,.30,0],[1.7,.58,.53]);box(b,[0,-.10,0],[.52,.52,1.18]);
        }else box(b,[0,0,0],[1.46,1.46,1.46]);m=b.data();}
        meshes.set(shape,m);return m;
    }
    // Validated polygon-mesh entry point for a future OBJ/glTF importer.
    // No file parser or upload UI is included in this release.
    function registerMesh(mesh){
        if(!mesh||!Array.isArray(mesh.vertices)||!Array.isArray(mesh.faces)||mesh.vertices.length<4||mesh.vertices.length>5000||mesh.faces.length<4||mesh.faces.length>10000)throw Error('3D mesh size/shape invalid');
        const vertices=mesh.vertices;
        if(!vertices.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw Error('Non-finite 3D mesh vertex');
        const b=builder();let triangles=0;
        for(const face of mesh.faces){
            if(!Array.isArray(face)||face.length<3||face.length>32||!face.every(i=>Number.isInteger(i)&&i>=0&&i<vertices.length))throw Error('Invalid 3D mesh face');
            for(let i=1;i<face.length-1;i++){b.tri(vertices[face[0]],vertices[face[i]],vertices[face[i+1]]);triangles++;}
        }
        if(!triangles)throw Error('Empty 3D mesh');
        meshes.set('custom',b.data());geometry=null;geometryShape=null;
        const previous=gpuMeshes.get('custom');if(previous){gpuMeshes.delete('custom');device?.queue?.onSubmittedWorkDone?.().then(()=>previous.buffer.destroy()).catch(()=>{});}
        vertexBuffer=null;
        return{vertices:vertices.length,faces:mesh.faces.length,triangles};
    }
    function rotation(ax,ay,az){const cx=Math.cos(ax),sx=Math.sin(ax),cy=Math.cos(ay),sy=Math.sin(ay),cz=Math.cos(az),sz=Math.sin(az);
        // column major 3x3; Rz * Ry * Rx
        return new Float32Array([cz*cy,sz*cy,-sy,cz*sy*sx-sz*cx,sz*sy*sx+cz*cx,cy*sx,cz*sy*cx+sz*sx,sz*sy*cx-cz*sx,cy*cx]);
    }
    function rotation4(ax,ay,az){
        const a=rotation(ax,ay,az),m=new Float32Array(16);
        m[0]=a[0];m[1]=a[1];m[2]=a[2];
        m[4]=a[3];m[5]=a[4];m[6]=a[5];
        m[8]=a[6];m[9]=a[7];m[10]=a[8];m[15]=1;
        return m;
    }
    function hide(){if(canvas)canvas.style.display='none';}
    function writeUniforms(cfg,w,h,now,shape){
        const data=new Float32Array(32);
        const t=(Number(cfg.speed)||0)*Math.PI/180*now/1000;
        data.set(rotation4((Number(cfg.tiltX)||0)*Math.PI/180+0.13*t,(Number(cfg.tiltY)||0)*Math.PI/180+t,t*.11),0);
        const requestedSize=Number(cfg.size);const size=Number.isFinite(requestedSize)?Math.max(0.1,requestedSize):260;
        data.set([(Number(cfg.positionX)||0)/100*(w/h)*.85,-(Number(cfg.positionY)||0)/100*.85,size/(h*.69),w/h],16);
        data.set([Math.max(0,Number(cfg.refraction)||0),Math.max(0,(Number(cfg.dispersion)||0)/100),Math.min(1,Math.max(0,(Number(cfg.opacity)||0)/100)),shape==='sphere'?1:0],20);
        data.set([canvas.width,canvas.height,sceneUploaded?1:0,shape==='skull'?1:0],24);
        data.set([((Number(cfg.lightHue)||0)%360+360)%360/360,Math.max(0,(Number(cfg.lightIntensity)||0)/100),((Number(cfg.fillHue)||0)%360+360)%360/360,Math.max(0,Math.min(1,(Number(cfg.fill)||0)/100))],28);
        device.queue.writeBuffer(uniformBuffer,0,data);
    }
    function resize(w,h){
        const ratio=Math.min(1.6,Math.max(0.5,window.devicePixelRatio||1));
        const pw=Math.max(1,Math.round(w*ratio)),ph=Math.max(1,Math.round(h*ratio));
        if(canvas.width===pw&&canvas.height===ph&&depthTexture)return;
        canvas.width=pw;canvas.height=ph;canvas.style.width=w+'px';canvas.style.height=h+'px';
        context.configure({device,format,alphaMode:'premultiplied'});
        const old=depthTexture;
        depthTexture=device.createTexture({label:'Somata optical mesh depth',size:[pw,ph,1],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
        if(old)device.queue.onSubmittedWorkDone().then(()=>old.destroy()).catch(()=>{});
        viewportWidth=pw;viewportHeight=ph;
    }
    function uploadMesh(shape){
        const rec=gpuMeshes.get(shape);if(rec){vertexBuffer=rec.buffer;geometry=rec.geometry;geometryShape=shape;return;}
        geometry=meshFor(shape);geometryShape=shape;
        const positions=geometry.vertices,normals=geometry.normals,flat=new Float32Array(geometry.triangles*3*6);
        for(let i=0,j=0;i<positions.length;i+=3,j+=6){
            flat[j]=positions[i];flat[j+1]=positions[i+1];flat[j+2]=positions[i+2];
            flat[j+3]=normals[i];flat[j+4]=normals[i+1];flat[j+5]=normals[i+2];
        }
        vertexBuffer=device.createBuffer({label:'Somata prism '+shape+' triangle vertices/normals',size:flat.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
        device.queue.writeBuffer(vertexBuffer,0,flat);
        gpuMeshes.set(shape,{buffer:vertexBuffer,geometry});uploadedShape=shape;
    }
    // Capture the SAME visible 2D stack that is actually behind the 3D layer.
    // A single mainCanvas/finalGpuCanvas misses deferred WebGPU Line, Corridor,
    // Graffiti, Particles and screen-space ambients living on separate surfaces.
    const SCENE_LAYERS=Object.freeze([
        'sceneBlendCanvas','mainCanvas','finalGpuCanvas',
        'graffitiGpuOverlayCanvas','pathFxOverlayCanvas',
        'particleGpuOverlayCanvas','ambientOverlayCanvas'
    ]);
    function visibleSurface(el){
        if(!el||!(el.width>0&&el.height>0))return false;
        const style=typeof getComputedStyle==='function'?getComputedStyle(el):el.style||{};
        if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;
        if(Number(style.opacity)===0)return false;
        return true;
    }
    function uploadScene(scene){
        sceneUploaded=false;sceneOrigin='none';lastSceneError='';
        const w=canvas.width,h=canvas.height;
        if(!(w>0&&h>0))return false;
        if(!sceneCapture){sceneCapture=document.createElement('canvas');sceneCaptureCtx=sceneCapture.getContext('2d',{alpha:false});}
        if(!sceneCaptureCtx){lastSceneError='Canvas2D-мост недоступен';return false;}
        if(sceneCapture.width!==w||sceneCapture.height!==h){sceneCapture.width=w;sceneCapture.height=h;}
        sceneCaptureCtx.setTransform?.(1,0,0,1,0,0);
        sceneCaptureCtx.globalAlpha=1;sceneCaptureCtx.globalCompositeOperation='source-over';
        const root=document.getElementById('mainContainer');
        const rootStyle=root&&typeof getComputedStyle==='function'?getComputedStyle(root):null;
        sceneCaptureCtx.fillStyle=rootStyle?.backgroundColor&&rootStyle.backgroundColor!=='transparent'?
            rootStyle.backgroundColor:'#07151d';
        sceneCaptureCtx.fillRect(0,0,w,h);
        const candidates=SCENE_LAYERS.filter(id=>id!=='ambientOverlayCanvas'||window.SomataAmbientPrism?.ambientOverPrism?.()!==true).map(id=>document.getElementById(id)).filter(visibleSurface);
        if(scene&&visibleSurface(scene)&&!candidates.includes(scene))candidates.push(scene);
        const sceneRootRect=root?.getBoundingClientRect?.();
        const scaleX=sceneRootRect?.width>0?w/sceneRootRect.width:1;
        const scaleY=sceneRootRect?.height>0?h/sceneRootRect.height:1;
        let drawn=0;
        const drawnIds=[];
        const captureErrors=[];
        for(const candidate of candidates){
            const style=typeof getComputedStyle==='function'?getComputedStyle(candidate):candidate.style||{};
            const opacity=Number(style.opacity);
            const rect=candidate.getBoundingClientRect?.();
            const dx=rect&&sceneRootRect?(rect.left-sceneRootRect.left)*scaleX:0;
            const dy=rect&&sceneRootRect?(rect.top-sceneRootRect.top)*scaleY:0;
            const dw=rect?.width>0?rect.width*scaleX:w;
            const dh=rect?.height>0?rect.height*scaleY:h;
            if(!dw||!dh||dx>=w||dy>=h||dx+dw<=0||dy+dh<=0)continue;
            sceneCaptureCtx.globalAlpha=Number.isFinite(opacity)?Math.max(0,Math.min(1,opacity)):1;
            const blend=String(style.mixBlendMode||'normal');
            sceneCaptureCtx.globalCompositeOperation=['multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'].includes(blend)?blend:'source-over';
            try{
                sceneCaptureCtx.drawImage(candidate,dx,dy,dw,dh);
                drawn++;drawnIds.push(candidate.id||'canvas');
            }catch(e){captureErrors.push('Захват '+(candidate.id||'canvas')+': '+String(e?.message||e));}
        }
        sceneCaptureCtx.globalAlpha=1;sceneCaptureCtx.globalCompositeOperation='source-over';
        if(w!==sceneTextureWidth||h!==sceneTextureHeight||!sceneTexture){
            const old=sceneTexture;
            sceneTexture=device.createTexture({label:'Somata optical scene capture',size:[w,h,1],format:'rgba8unorm',
                usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
            sceneTextureWidth=w;sceneTextureHeight=h;bindGroup=null;
            if(old)device.queue.onSubmittedWorkDone().then(()=>old.destroy()).catch(()=>{});
        }
        if(drawn){try{
            device.queue.copyExternalImageToTexture({source:sceneCapture},{texture:sceneTexture},[w,h]);
            sceneUploaded=true;sceneOrigin=drawnIds.join('+');lastSceneError=captureErrors.join(' | ');return true;
        }catch(e){lastSceneError='Загрузка текстуры сцены: '+String(e?.message||e);}}
        // Keep the geometry visible and identify the missing scene explicitly.
        const fallback=new Uint8Array(w*h*4);
        for(let i=0;i<fallback.length;i+=4){fallback[i]=7;fallback[i+1]=21;fallback[i+2]=29;fallback[i+3]=255;}
        device.queue.writeTexture({texture:sceneTexture},fallback,{bytesPerRow:w*4},[w,h]);
        sceneOrigin='fallback';return true;
    }
    function render(cfg,scene,now=performance.now()){
        if(cfg?.enabled!==true){hide();return true;}
        if(ready&&(!device||hubGeneration!==WebGPUDeviceHub.getGeneration?.())){
            ready=false;pipeline=null;sceneTexture=null;depthTexture=null;bindGroup=null;gpuMeshes.clear();
            sceneTextureWidth=0;sceneTextureHeight=0;
        }
        if(!ready){initAsync();return false;}
        try{
            if(!ensureCanvas())return false;
            const root=document.getElementById('mainContainer');if(!root)return false;
            const rect=root.getBoundingClientRect(),w=Math.floor(rect.width),h=Math.floor(rect.height);
            if(w<10||h<10)return false;
            resize(w,h);
            const shape=['sphere','lens','skull','cube','dodecahedron','cross'].includes(cfg.shape)||(cfg.shape==='custom'&&meshes.has('custom'))?cfg.shape:'sphere';
            if(geometryShape!==shape||!vertexBuffer)uploadMesh(shape);
            if(opticalReady&&!uploadScene(scene)){lastError=lastSceneError||'Снимок сцены недоступен';hide();return false;}
            if(!opticalReady){sceneUploaded=false;sceneOrigin='basic-webgpu-glass';}
            if(!bindGroup)bindGroup=device.createBindGroup({label:'Somata optical backdrop bind group',layout:pipeline.getBindGroupLayout(0),entries:[
                {binding:0,resource:{buffer:uniformBuffer}}, ...(opticalReady?[{binding:1,resource:sceneTexture.createView()},{binding:2,resource:sampler}]:[])]});
            canvas.style.display='block';writeUniforms(cfg,w,h,now,shape);
            const encoder=device.createCommandEncoder({label:'Somata optical foreground 3D'});
            const pass=encoder.beginRenderPass({colorAttachments:[{
                view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}],
                depthStencilAttachment:{view:depthTexture.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
            pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.setVertexBuffer(0,vertexBuffer);
            pass.draw(geometry.triangles*3);pass.end();
            device.queue.submit([encoder.finish()]);
            frames++;lastShape=shape;lastTriangles=geometry.triangles;lastError='';return true;
        }catch(e){lastError=String(e?.message||e);hide();return false;}
    }
    function status(){return{backend:ready?'WebGPU-3D':pending?'WebGPU-initializing':'WebGPU-unavailable',independentLayer:true,
        mesh:lastShape,triangles:lastTriangles,frames,sceneUploaded,initializing:!!pending,lastError,opticalReady,opticalError,
        canvasVisible:canvas?.style.display==='block',sceneOrigin,sceneError:lastSceneError,optics:'WebGPU WGSL mesh; screen-anchored Snell RGB sampling from visible 2D compositor stack; other meshes approximate exit thickness; no full ray tracing'};}
    return Object.freeze({render,hide,status,meshFor,registerMesh});
})();
window.SomataPrism3D=SomataPrism3D;
window.__somataPrism3DStatus=()=>SomataPrism3D.status();
