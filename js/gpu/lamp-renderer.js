// SpiroStar v519 — isolated Lamp GPU/WebGL backends
window.__spiroRegisterModule?.('js/gpu/lamp-renderer');

const LampWebGLRenderer = (() => {
            const FLOATS_PER_INSTANCE = 11;
            const TYPE_CODE = Object.freeze({whiteCore:0,softCore:1,solarDark:2,ring:3,star:4});
            let gl=null, available=false, attempted=false, lost=false;
            let floatExt=null, floatBlendExt=null, lampProgram=null, toneProgram=null;
            let storageMode='rgba16f', lastGlError=0, lastFlushMode='none';
            let lampVao=null, toneVao=null, quadBuffer=null, instanceBuffer=null;
            let hdrTexture=null, hdrFbo=null, width=0, height=0;
            let instanceData=new Float32Array(FLOATS_PER_INSTANCE*512), instanceCount=0;
            let lampUniformViewport=null, toneUniformHdr=null, toneUniformExposure=null;
            let lastError='';
            const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));

            function setUiStatus(){
                const input=document.getElementById('lampWebGL');
                if(!input)return;
                const label=input.closest('label');
                if(available){
                    input.disabled=false;
                    label?.classList.remove('disabled');
                    label?.setAttribute('title',`WebGL2 активен: ${storageMode==='rgba16f'?'float RGBA16F':'RGBA8 fallback'}, результат один раз композитится в основной Canvas2D.`);
                }else if(attempted){
                    input.disabled=true;
                    label?.classList.add('disabled');
                    label?.setAttribute('title',`WebGL2 float недоступен — используется Canvas2D fallback${lastError?`: ${lastError}`:''}`);
                }
            }
            function compile(type,source){
                const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
                if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
                    const log=gl.getShaderInfoLog(s)||'shader compile error';gl.deleteShader(s);throw new Error(log);
                }
                return s;
            }
            function link(vsSource,fsSource){
                const p=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vsSource),fs=compile(gl.FRAGMENT_SHADER,fsSource);
                gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
                if(!gl.getProgramParameter(p,gl.LINK_STATUS)){
                    const log=gl.getProgramInfoLog(p)||'program link error';gl.deleteProgram(p);throw new Error(log);
                }
                return p;
            }
            const lampVS=`#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aCenter;
layout(location=2) in float aOuter;
layout(location=3) in float aBody;
layout(location=4) in vec3 aColor;
layout(location=5) in float aSoft;
layout(location=6) in float aBright;
layout(location=7) in float aType;
layout(location=8) in float aAlpha;
uniform vec2 uViewport;
out vec2 vQ;
out float vBody;
out vec3 vColor;
out float vSoft;
out float vBright;
out float vType;
out float vAlpha;
void main(){
    vec2 p=aCenter+aCorner*aOuter;
    vec2 clip=vec2(p.x/uViewport.x*2.0-1.0,1.0-p.y/uViewport.y*2.0);
    gl_Position=vec4(clip,0.0,1.0);
    vQ=aCorner;vBody=aBody;vColor=aColor;vSoft=aSoft;vBright=aBright;vType=aType;vAlpha=aAlpha;
}`;
            const lampFS=`#version 300 es
precision highp float;
in vec2 vQ;
in float vBody;
in vec3 vColor;
in float vSoft;
in float vBright;
in float vType;
in float vAlpha;
layout(location=0) out vec4 outColor;
float sat(float x){return clamp(x,0.0,1.0);}
float seg(float x,float a,float b){return sat((x-a)/max(0.000001,b-a));}
void main(){
    float d=length(vQ);
    if(d>=1.0)discard;

    // v261 variables and coefficients. vSoft is allowed up to 1.5 (150%).
    float softRaw=clamp(vSoft,0.0,1.5);
    float soft=min(softRaw,1.0);
    float over=sat(vBright-1.0);              // (brightness-100)/100
    float haloFade=1.0-over;
    float body=clamp(vBody,0.03,0.93);
    float edgeAlpha=0.08+0.92*over;
    float coreHardness=(vType<1.5)?(1.0-soft):0.0;
    float haloVisibility=haloFade*((vType<1.5)?soft:1.0);
    float plateauFrac=body*over;
    float justOutside=min(0.997,body+0.012);
    float aa=max(fwidth(d)*1.15,0.00035);

    vec3 rgb=vColor;
    float bodyEdge=edgeAlpha;
    float solidUntil=0.0;
    float bodyCoverage=1.0;

    // softCore / generic body: exact v261 stop semantics:
    // centre=1, optional opaque plateau, then interpolate to bodyEdge.
    if(vType>=0.5 && vType<1.5){
        float hard=max(over,coreHardness);
        solidUntil=body*hard;
        bodyEdge=max(edgeAlpha,hard);
        bodyCoverage=(d<=solidUntil)?1.0:mix(1.0,bodyEdge,seg(d,solidUntil,body));
    // solarDark: retain the dark-centre shape while using v261 edge/overdrive positions.
    }else if(vType>=1.5 && vType<2.5){
        float darkCore=max(0.06,body*(0.18+0.22*(1.0-soft)));
        float darkA0=0.96-soft*0.16;
        float darkA1=0.76-soft*0.22;
        if(d<darkCore){
            bodyCoverage=mix(darkA0,darkA1,seg(d,0.0,darkCore));
            rgb=vec3(0.0);
        }else{
            float p=max(darkCore+0.006,min(body-0.006,plateauFrac));
            if(over>0.001 && d<p){
                bodyCoverage=mix(darkA1,1.0,seg(d,darkCore,p));
            }else{
                float start=(over>0.001)?p:darkCore;
                float startA=(over>0.001)?1.0:darkA1;
                bodyCoverage=mix(startA,edgeAlpha,seg(d,start,body));
            }
        }
        bodyEdge=edgeAlpha;
    // ring: analytic equivalent of v261 ring stops.
    }else if(vType>=2.5 && vType<3.5){
        float inner=body*(0.35-0.12*over);
        float ringStart=max(inner+0.01,body*(0.67-0.18*over));
        float a0=0.02+0.12*over;
        float a1=0.08+0.25*over;
        if(d<inner)bodyCoverage=mix(a0,a1,seg(d,0.0,inner));
        else if(d<ringStart)bodyCoverage=mix(a1,1.0,seg(d,inner,ringStart));
        else bodyCoverage=mix(1.0,edgeAlpha,seg(d,ringStart,body));
        float whiteRing=1.0-sat(abs(d-ringStart)/max(0.008,body*0.09));
        rgb=mix(vColor,vec3(1.0),whiteRing*0.75);
        bodyEdge=edgeAlpha;
    // whiteCore: carry over v261 white hold -> colour body -> soft edge behaviour.
    }else if(vType<0.5){
        float whiteCoreFade=(softRaw<=1.0)?1.0:sat(1.0-(softRaw-1.0)/0.5);
        float whiteExtent;
        float whiteHold;
        float wt;
        if(softRaw<=1.0){
            whiteExtent=body*(1.0-0.90*soft);
            whiteHold=max(0.004,whiteExtent*((soft<0.01)?1.0:0.58));
            wt=min(body-0.004,max(whiteHold+0.004,whiteExtent));
            bodyEdge=max(edgeAlpha,coreHardness);
        }else{
            whiteExtent=max(0.002,body*0.10*whiteCoreFade);
            whiteHold=max(0.001,whiteExtent*0.58);
            wt=min(body-0.004,max(whiteHold+0.003,whiteExtent));
            bodyEdge=edgeAlpha;
        }
        float lastSolid=wt;
        if(over>0.001 && plateauFrac>wt+0.004)lastSolid=min(body-0.002,plateauFrac);
        bodyCoverage=(d<=lastSolid)?1.0:mix(1.0,bodyEdge,seg(d,lastSolid,body));
        float whiteMix;
        if(d<=whiteHold)whiteMix=1.0;
        else whiteMix=1.0-seg(d,whiteHold,max(whiteHold+0.0005,wt));
        whiteMix*=whiteCoreFade;
        rgb=mix(vColor,vec3(1.0),sat(whiteMix));
    // star radial carrier uses the same selected-body profile as v261.
    }else{
        float hard=over;
        solidUntil=body*hard;
        bodyEdge=max(edgeAlpha,hard);
        bodyCoverage=(d<=solidUntil)?1.0:mix(1.0,bodyEdge,seg(d,solidUntil,body));
    }

    // v261 halo stops. Crucially, for every value 100% <= brightness < 200%
    // the body edge blends into a non-zero halo and then fades outward. There is no
    // hard body cutoff. Only at exactly 200% is the halo removed, and even then the
    // edge fades from body to transparent over body..body+0.012.
    float coverage;
    if(d<=body){
        coverage=bodyCoverage;
    }else if(over>=0.999 || ((vType<1.5) && soft<=0.001)){
        coverage=mix(bodyEdge,0.0,seg(d,body,justOutside));
    }else{
        float haloA=min(0.30,edgeAlpha*0.85)*haloVisibility;
        float haloMidA=haloA*0.28;
        float h0=min(0.993,body+(1.0-body)*0.10);
        float h1=min(0.995,body+(1.0-body)*(0.34+0.20*soft));
        if(d<=h0)coverage=mix(bodyEdge,haloA,seg(d,body,h0));
        else if(d<=h1)coverage=mix(haloA,haloMidA,seg(d,h0,h1));
        else coverage=mix(haloMidA,0.0,seg(d,h1,1.0));
    }

    // v261 star rays are vector overlays. Keep an analytic equivalent without changing
    // the radial brightness law above.
    if(vType>=3.5){
        float rayFall=1.0-smoothstep(0.18,1.0,d);
        float ax=exp(-pow(abs(vQ.x)*34.0,2.0))+exp(-pow(abs(vQ.y)*34.0,2.0));
        float d1=abs(vQ.x-vQ.y)*0.70710678;
        float d2=abs(vQ.x+vQ.y)*0.70710678;
        float diag=(exp(-pow(d1*38.0,2.0))+exp(-pow(d2*38.0,2.0)))*0.52;
        float rays=(ax+diag)*rayFall;
        coverage=max(coverage,rays*0.66);
        rgb=mix(rgb,vec3(1.0),sat(rays));
    }

    // Small derivative AA only at the transparent outer boundary; it does not harden
    // the physical lamp edge and keeps the v261 soft body/halo interpolation intact.
    coverage*=1.0-smoothstep(1.0-aa,1.0,d);
    coverage=max(0.0,coverage)*clamp(vAlpha,0.0,1.0);
    if(coverage<=0.000002)discard;
    // Canvas2D-compatible visual accumulation: keep display-space RGB in the float
    // buffer.  Precision is still float16, so weak gradients no longer quantise per lamp,
    // but their apparent falloff stays the same as the v261 radial gradient.
    vec3 radiance=max(rgb,vec3(0.0))*coverage;
    outColor=vec4(radiance,coverage);
}`;
            const toneVS=`#version 300 es
precision highp float;
out vec2 vUv;
void main(){
    vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
    vUv=p;
    gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;
            const toneFS=`#version 300 es
precision highp float;
uniform sampler2D uHdr;
uniform float uExposure;
in vec2 vUv;
layout(location=0) out vec4 outColor;
void main(){
    vec3 hdr=max(texture(uHdr,vUv).rgb,vec3(0.0));
    // v261 / Canvas2D lighter semantics: preserve every sub-1.0 gradient value exactly
    // and clamp only the accumulated over-range energy at final presentation.  The HDR
    // buffer still prevents 8-bit quantisation while many weak lamps overlap.
    vec3 shown=clamp(hdr,0.0,1.0);
    float a=max(max(shown.r,shown.g),shown.b);
    if(a<0.00001){outColor=vec4(0.0);return;}
    outColor=vec4(clamp(shown/a,0.0,1.0),a);
}`;
            function init(){
                if(attempted)return available;attempted=true;
                if(!lampGlCanvas){lastError='нет GL canvas';setUiStatus();return false;}
                try{
                    gl=lampGlCanvas.getContext('webgl2',{
                        alpha:true,antialias:false,depth:false,stencil:false,
                        premultipliedAlpha:false,preserveDrawingBuffer:true,
                        powerPreference:'high-performance',desynchronized:false
                    });
                    if(!gl)throw new Error('WebGL2 не поддерживается');
                    floatExt=gl.getExtension('EXT_color_buffer_float');
                    floatBlendExt=gl.getExtension('EXT_float_blend');
                    storageMode=floatExt?'rgba16f':'rgba8';
                    lampProgram=link(lampVS,lampFS);toneProgram=link(toneVS,toneFS);
                    lampUniformViewport=gl.getUniformLocation(lampProgram,'uViewport');
                    toneUniformHdr=gl.getUniformLocation(toneProgram,'uHdr');
                    toneUniformExposure=gl.getUniformLocation(toneProgram,'uExposure');

                    lampVao=gl.createVertexArray();gl.bindVertexArray(lampVao);
                    quadBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([
                        -1,-1, 1,-1, -1,1,
                        -1,1, 1,-1, 1,1
                    ]),gl.STATIC_DRAW);
                    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);

                    instanceBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);
                    const stride=FLOATS_PER_INSTANCE*4;
                    const attr=(loc,size,offset)=>{
                        gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride,offset*4);gl.vertexAttribDivisor(loc,1);
                    };
                    attr(1,2,0);attr(2,1,2);attr(3,1,3);attr(4,3,4);attr(5,1,7);attr(6,1,8);attr(7,1,9);attr(8,1,10);
                    gl.bindVertexArray(null);

                    toneVao=gl.createVertexArray();
                    hdrTexture=gl.createTexture();hdrFbo=gl.createFramebuffer();
                    gl.bindTexture(gl.TEXTURE_2D,hdrTexture);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
                    gl.bindTexture(gl.TEXTURE_2D,null);

                    lampGlCanvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;available=false;lastError='context lost';setUiStatus();},{passive:false});
                    lampGlCanvas.addEventListener('webglcontextrestored',()=>{attempted=false;available=false;lost=false;gl=null;width=height=0;init();requestMainCanvasRender();});
                    available=true;setUiStatus();return true;
                }catch(err){
                    lastError=String(err?.message||err);available=false;
                    console.warn('WebGL HDR lamps disabled:',err);setUiStatus();return false;
                }
            }
            function drainGlErrors(){
                if(!gl)return 0;
                let first=0,e=0,guard=0;
                while((e=gl.getError())!==gl.NO_ERROR && guard++<16){if(!first)first=e;}
                return first;
            }
            function allocateTextureStorage(w,h,mode){
                storageMode=mode==='rgba16f'&&floatExt?'rgba16f':'rgba8';
                gl.bindTexture(gl.TEXTURE_2D,hdrTexture);
                if(storageMode==='rgba16f')gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);
                else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
                gl.bindFramebuffer(gl.FRAMEBUFFER,hdrFbo);
                gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,hdrTexture,0);
                gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
                const status=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
                gl.bindFramebuffer(gl.FRAMEBUFFER,null);
                return status===gl.FRAMEBUFFER_COMPLETE;
            }
            function allocate(w,h){
                if(!init()||lost)return false;
                w=Math.max(1,Math.floor(Number(w)||1));h=Math.max(1,Math.floor(Number(h)||1));
                if(width===w&&height===h&&lampGlCanvas.width===w&&lampGlCanvas.height===h)return true;
                width=w;height=h;
                lampGlCanvas.width=w;lampGlCanvas.height=h;
                drainGlErrors();
                let ok=allocateTextureStorage(w,h,floatExt?'rgba16f':'rgba8');
                if(!ok && storageMode==='rgba16f')ok=allocateTextureStorage(w,h,'rgba8');
                if(!ok){
                    available=false;lastError='WebGL framebuffer incomplete';setUiStatus();return false;
                }
                lastGlError=drainGlErrors();
                setUiStatus();
                return true;
            }
            function clear(){
                instanceCount=0;
                if(!gl||lost)return;
                gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,Math.max(1,lampGlCanvas.width),Math.max(1,lampGlCanvas.height));
                gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                if(hdrFbo){
                    gl.bindFramebuffer(gl.FRAMEBUFFER,hdrFbo);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
                }
            }
            function beginFrame(w,h){
                instanceCount=0;
                if(!allocate(w,h)){clear();return false;}
                gl.bindFramebuffer(gl.FRAMEBUFFER,hdrFbo);gl.viewport(0,0,width,height);
                gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                return true;
            }
            function canUse(cfg){
                if(cfg?.webgl===false)return false;
                if(!init()||!available||lost)return false;
                const blend=cfg?.blendMode||'lighter';
                // HDR batch is additive. Non-light blend modes keep their exact Canvas2D path.
                return blend==='lighter'||blend==='screen';
            }
            function ensureCapacity(count){
                const need=count*FLOATS_PER_INSTANCE;
                if(need<=instanceData.length)return;
                let n=instanceData.length;while(n<need)n*=2;
                const next=new Float32Array(n);next.set(instanceData);instanceData=next;
            }
            function queueVisualPlan(ctx,visualPlan,alpha,drawPlan){
                const items=visualPlan?.items,cfg=drawPlan?.config||visualPlan?.cfg||state.lamps||{};
                if(!items?.length||alpha<=.001||!canUse(cfg))return false;
                const tr=ctx.getTransform?.();if(!tr)return false;
                const scale=Math.hypot(Number(tr.a)||0,Number(tr.b)||0);if(!(scale>1e-9))return true;
                const style=drawPlan?.preparedStyle||visualPlan?.style||{};
                const softness=Math.max(0,Math.min(150,Number(style.effectiveSoftness)||0));
                const type=style.type||'whiteCore',typeCode=TYPE_CODE[type]??0;
                ensureCapacity(instanceCount+items.length);
                for(let i=0;i<items.length;i++){
                    const v=items[i],rad=Math.max(0,Number(v.rad)||0);if(rad<=.001)continue;
                    const a=clamp01(alpha*(Number(v.intensityAlpha)||0));if(a<=.00001)continue;
                    const x=Number(v.px)||0,y=Number(v.py)||0;
                    const px=(Number(tr.a)||0)*x+(Number(tr.c)||0)*y+(Number(tr.e)||0);
                    const py=(Number(tr.b)||0)*x+(Number(tr.d)||0)*y+(Number(tr.f)||0);
                    // v268: use the same gradient radius as v261.  Above 100% only the
                    // v261 haloScale/haloFade law contracts the halo; the physical body edge
                    // remains softly blended until the 200% endpoint.
                    const vb=Math.max(0,Math.min(200,Number(v.brightness)||0));
                    let outerLocal=lampV261GradientOuterRadius(rad,softness,type,vb);
                    if(type==='star')outerLocal=Math.max(outerLocal,rad*(2.15+.25*(1-Math.min(100,softness)/100))+6);
                    const outer=Math.max(1,outerLocal*scale);
                    const body=Math.max(.03,Math.min(.93,(rad*scale)/outer));
                    const rgb=hexToRgbaParts(v.color||'#ffffff');
                    let o=instanceCount*FLOATS_PER_INSTANCE;
                    instanceData[o++]=px;instanceData[o++]=py;instanceData[o++]=outer;instanceData[o++]=body;
                    instanceData[o++]=rgb.r/255;instanceData[o++]=rgb.g/255;instanceData[o++]=rgb.b/255;
                    instanceData[o++]=softness/100;instanceData[o++]=Math.max(0,Math.min(200,Number(v.brightness)||0)/100);
                    instanceData[o++]=typeCode;instanceData[o++]=a;instanceCount++;
                }
                return true;
            }
            function drawQueuedInstances(){
                gl.bindFramebuffer(gl.FRAMEBUFFER,hdrFbo);gl.viewport(0,0,width,height);
                gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);
                gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);
                gl.useProgram(lampProgram);gl.uniform2f(lampUniformViewport,width,height);
                gl.bindVertexArray(lampVao);gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);
                gl.bufferData(gl.ARRAY_BUFFER,instanceData.subarray(0,instanceCount*FLOATS_PER_INSTANCE),gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLES,0,6,instanceCount);
                gl.bindVertexArray(null);gl.disable(gl.BLEND);
            }
            function toneToGlCanvas(){
                gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);
                gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                gl.useProgram(toneProgram);gl.bindVertexArray(toneVao);
                gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,hdrTexture);
                gl.uniform1i(toneUniformHdr,0);gl.uniform1f(toneUniformExposure,1.0);
                gl.drawArrays(gl.TRIANGLES,0,3);
                gl.bindVertexArray(null);gl.bindTexture(gl.TEXTURE_2D,null);
            }
            function compositeToMainCanvas(){
                if(!mainCtx||!mainCanvas||!lampGlCanvas)return;
                mainCtx.save();
                mainCtx.setTransform(1,0,0,1,0,0);
                mainCtx.globalAlpha=1;
                mainCtx.filter='none';
                mainCtx.globalCompositeOperation='lighter';
                mainCtx.drawImage(lampGlCanvas,0,0,mainCanvas.width,mainCanvas.height);
                mainCtx.restore();
            }
            function flush(){
                if(!gl||!available||lost)return false;
                // Clear the internal presentation surface even on an empty frame.
                gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);
                gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                if(instanceCount<=0){lastFlushMode='empty';return true;}

                drainGlErrors();
                gl.bindFramebuffer(gl.FRAMEBUFFER,hdrFbo);gl.viewport(0,0,width,height);
                gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                drawQueuedInstances();
                let err=drainGlErrors();

                // Some drivers expose RGBA16F rendering but reject additive float blending.
                // Retry the SAME frame in WebGL RGBA8 instead of silently losing every lamp.
                if(err!==gl.NO_ERROR && storageMode==='rgba16f'){
                    lastGlError=err;
                    if(allocateTextureStorage(width,height,'rgba8')){
                        gl.bindFramebuffer(gl.FRAMEBUFFER,hdrFbo);gl.viewport(0,0,width,height);
                        gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                        drainGlErrors();
                        drawQueuedInstances();
                        err=drainGlErrors();
                    }
                }
                if(err!==gl.NO_ERROR){
                    lastGlError=err;lastError=`draw error 0x${err.toString(16)}`;lastFlushMode='failed';
                    // Disable GL for subsequent frames; the normal Canvas2D path then takes over.
                    available=false;setUiStatus();
                    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
                    requestMainCanvasRender();
                    return false;
                }

                toneToGlCanvas();
                err=drainGlErrors();
                if(err!==gl.NO_ERROR){
                    lastGlError=err;lastError=`tone error 0x${err.toString(16)}`;lastFlushMode='failed';
                    available=false;setUiStatus();requestMainCanvasRender();return false;
                }
                compositeToMainCanvas();
                lastFlushMode=storageMode;
                return true;
            }
            function status(){return {attempted,available,lost,float16:Boolean(floatExt),floatBlend:Boolean(floatBlendExt),storageMode,lastFlushMode,lastGlError,instances:instanceCount,width,height,error:lastError};}
            return {beginFrame,canUse,queueVisualPlan,flush,clear,status};
        })();
        window.__spiroLampWebGLStatus=()=>LampWebGLRenderer.status();

        // v331 — deferred HDR lamp command buffers can be submitted together with final presentation.
        // v319 — WebGPU HDR lamp backend.  The CPU lamp placement, adaptive exposure,
        // visual-plan transfer curve and Canvas fallback remain unchanged.  WebGPU only
        // replaces the instanced RGBA16F accumulation + final tone pass.  One command
        // encoder contains both passes, and the shared WebGPUDeviceHub owns the device.
        const WebGPULampRenderer = (() => {
            const FLOATS_PER_INSTANCE=11;
            const TYPE_CODE=Object.freeze({whiteCore:0,softCore:1,solarDark:2,ring:3,star:4});
            const canvas=document.createElement('canvas');
            let adapter=null,device=null,context=null,format=null,hubGeneration=0;
            let lampPipeline=null,corridorLampPipeline=null,arcLampPipeline=null,arcCorridorLampPipeline=null,topologyLampPipeline=null,topologyCorridorLampPipeline=null,tonePipeline=null,freezePipeline=null,cornerBuffer=null,instanceBuffers=[null,null,null],uniformBuffer=null,freezeUniformBuffer=null,dummyStorageBuffer=null;
            let lampBindGroup=null,toneBindGroups=[null,null,null],freezeBindGroups=[null,null],hdrTexture=null,toneTexture=null,freezeHistoryTextures=[null,null],freezeHistoryViews=[null,null];
            let attempted=false,initializing=false,ready=false,lost=false,lastError='';
            let width=0,height=0,capacity=0,instanceCount=0,submissions=0,lastFlushMode='none',lastToneValid=false,deferredComposite=false,directSceneFrames=0,fallbackPresentFrames=0,lampFrameSerial=0;
            // v331 — when final WebGPU presentation is available, finish the lamp encoder into a
            // GPUCommandBuffer but do not submit it yet. The final compositor submits lamp + final
            // presentation command buffers together, preserving queue order with one queue.submit().
            let deferredCommandBuffer=null,deferredCommandGeneration=0,mergedFrameSubmissions=0,hdrView=null,toneView=null;
            let instanceData=new Float32Array(FLOATS_PER_INSTANCE*512);
            const uniformData=new Float32Array(4),freezeUniformData=new Float32Array(4);
            let frameNow=0,freezeHistoryIndex=0,freezeHistoryValid=false,freezeLastRenderAt=0,freezeLastMotionAt=0,freezeFrameHash=2166136261>>>0,freezeLastFrameHash=0,freezeDrawCount=0,freezeLastDrawCount=-1,freezeFrames=0,freezeResets=0;
            // v404 — exact cross-frame payload residency for vector lamps. When a complete
            // lamp payload is byte-for-byte unchanged, keep using the already populated GPU
            // buffer instead of rotating to another ring slot and uploading identical data.
            let instanceFrameHash=2166136261>>>0,lastInstanceHash=0,lastInstanceCount=0,lastInstanceSnapshot=null,lastInstanceBuffer=null;
            let instanceUploadBytes=0,instanceUploadSkips=0,instanceUploadBytesAvoided=0;
            function lampHashMix(h,v){const q=(Math.fround(Number(v)||0)*1048576)|0;h^=q;return Math.imul(h,16777619)>>>0;}
            function sameLampF32(a,b,count){if(!a||!b||b.length<count)return false;for(let i=0;i<count;i++)if(a[i]!==b[i])return false;return true;}
            function sameLampU32(a,b,count){if(!a||!b||b.length<count)return false;for(let i=0;i<count;i++)if(a[i]!==b[i])return false;return true;}
            // v325 — Corridor lamps keep one lamp list and one copy-transform list.
            // The Cartesian product is expanded by @builtin(instance_index) on the GPU,
            // avoiding O(lamps*copies) CPU packing and uploads.
            const CORRIDOR_LAMP_FLOATS=12,CORRIDOR_COPY_FLOATS=8;
            const corridorBatchPool=[];let corridorBatchCount=0,corridorLogicalInstances=0,corridorLampUploads=0,corridorCopyUploads=0,corridorDraws=0,corridorFallbacks=0,corridorSharedCopyReuse=0,corridorSharedCopyAvoidedBytes=0;
            let corridorLampUploadSkips=0,corridorLampUploadBytesAvoided=0,corridorUniformUploads=0,corridorUniformUploadSkips=0;
            // v519 — bounded Arbitrary-Lamp attachment records. Display-frame xy is resolved from
            // resident Morph Arc in the vertex shader; style/scatter records stay <=600 on CPU.
            const ARC_LAMP_FLOATS=16,arcBatchPool=[];let arcBatchCount=0,arcDraws=0,arcCorridorDraws=0,arcAttachmentUploads=0,arcPrerequisiteFusions=0,arcScheduledReuses=0,topologyDraws=0,topologyCorridorDraws=0;let deferredLocalArcTables=[];

            const LAMP_WGSL=`
struct Uniforms { viewport: vec2<f32>, lampCount: u32, _pad: u32, root0: vec4<f32>, root1: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var<storage,read> corridorLampData: array<vec4<f32>>;
@group(1) @binding(1) var<storage,read> corridorCopyData: array<vec4<f32>>;
@group(1) @binding(2) var<storage,read> morphArcSegments: array<vec4<f32>>;
@group(1) @binding(3) var<storage,read> morphPathSegmentRanges: array<vec4<u32>>;
@group(1) @binding(4) var<storage,read> lampTopologyIdentity: array<vec4<f32>>;
@group(1) @binding(5) var<storage,read> retainedArcCubics: array<vec4<f32>>;
struct VSIn {
    @location(0) corner: vec2<f32>,
    @location(1) center: vec2<f32>,
    @location(2) outer: f32,
    @location(3) body: f32,
    @location(4) color: vec3<f32>,
    @location(5) soft: f32,
    @location(6) bright: f32,
    @location(7) lampType: f32,
    @location(8) alpha: f32,
};
struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) q: vec2<f32>,
    @location(1) body: f32,
    @location(2) color: vec3<f32>,
    @location(3) soft: f32,
    @location(4) bright: f32,
    @location(5) lampType: f32,
    @location(6) alpha: f32,
};
@vertex fn vsMain(v:VSIn)->VSOut{
    var o:VSOut;
    let p=v.center+v.corner*v.outer;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    o.q=v.corner;o.body=v.body;o.color=v.color;o.soft=v.soft;o.bright=v.bright;o.lampType=v.lampType;o.alpha=v.alpha;
    return o;
}
@vertex fn vsCorridor(@location(0) corner:vec2<f32>,@builtin(instance_index) iid:u32)->VSOut{
    var o:VSOut;
    let lampCount=max(u.lampCount,1u);
    let li=iid%lampCount;
    let ci=iid/lampCount;
    let l0=corridorLampData[li*3u];
    let l1=corridorLampData[li*3u+1u];
    let l2=corridorLampData[li*3u+2u];
    let c0=corridorCopyData[ci*2u];
    let c1=corridorCopyData[ci*2u+1u];
    // v400: c0/c1 are the shared local copy matrix: [a,c,alpha,0] / [b,d,scale,0].
    // Compose the layer root/frame matrix in WGSL so Lamps can share the same resident
    // transform storage used by the other Corridor GPU effects.
    let f00=u.root0.x*c0.x+u.root0.y*c1.x;
    let f01=u.root0.x*c0.y+u.root0.y*c1.y;
    let f10=u.root0.z*c0.x+u.root0.w*c1.x;
    let f11=u.root0.z*c0.y+u.root0.w*c1.y;
    let center=vec2<f32>(f00*l0.x+f01*l0.y+u.root1.x,f10*l0.x+f11*l0.y+u.root1.y);
    let screenScale=length(vec2<f32>(f00,f10));
    let outer=max(1.0,l0.z*screenScale);
    let p=center+corner*outer;
    o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    o.q=corner;o.body=l0.w;o.color=l1.xyz;o.soft=l1.w;o.bright=l2.x;o.lampType=l2.y;o.alpha=l2.z*c0.z;
    return o;
}


fn cubicDerivativeArc(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,t:f32)->vec2<f32>{let s=1.0-t;return 3.0*s*s*(c1-p0)+6.0*s*t*(c2-c1)+3.0*t*t*(p3-c2);}
fn arcCorrectMicroT(p0:vec2<f32>,c1:vec2<f32>,c2:vec2<f32>,p3:vec2<f32>,sub:u32,subdiv:u32,f0:f32)->f32{
    let f=clamp(f0,0.0,1.0);let sd=max(1u,subdiv);let t0=f32(sub)/f32(sd);let t1=f32(sub+1u)/f32(sd);if(f<=0.000001){return t0;}if(f>=0.999999){return t1;}
    let s0=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t0)));let s1=max(0.000001,length(cubicDerivativeArc(p0,c1,c2,p3,t1)));let dv=s1-s0;let arcTarget=f*max(0.000001,s0+0.5*dv);
    // Integral of the local linear-speed model has a closed-form inverse. Rationalized root
    // avoids cancellation and is cheaper than iterative Newton correction in particle/Web loads.
    let disc=max(0.000000000001,s0*s0+2.0*dv*arcTarget);let q=clamp((2.0*arcTarget)/max(0.000001,s0+sqrt(disc)),0.0,1.0);return mix(t0,t1,q);
}
fn retainedCubicPoint(globalMicro:u32,microT:f32)->vec2<f32>{
    let subdiv=max(1u,u32(u.root1.z+0.5));let logical=globalMicro/subdiv;let sub=globalMicro%subdiv;let q0=retainedArcCubics[logical*2u];let q1=retainedArcCubics[logical*2u+1u];let t=arcCorrectMicroT(q0.xy,q0.zw,q1.xy,q1.zw,sub,subdiv,microT);let a=mix(q0.xy,q0.zw,t);let b=mix(q0.zw,q1.xy,t);let c=mix(q1.xy,q1.zw,t);return mix(mix(a,b,t),mix(b,c,t),t);
}
fn sampleArcMicro(globalMicro:u32,microT:f32)->vec2<f32>{let g=morphArcSegments[globalMicro*2u];return select(mix(g.xy,g.zw,microT),retainedCubicPoint(globalMicro,microT),u.root1.w>0.5);}
fn sampleMorphArc(pathIndex:u32,fraction:f32)->vec2<f32>{
    let r=morphPathSegmentRanges[pathIndex];let first=r.x;let n=max(1u,r.y);let q0=morphArcSegments[first*2u+1u];let total=max(0.000001,q0.w);
    let arcTarget=q0.z+clamp(fraction,0.0,0.99999994)*total;var lo=0u;var hi=n-1u;
    loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;let q=morphArcSegments[(first+mid)*2u+1u];if(q.x+q.y<arcTarget){lo=mid+1u;}else{hi=mid;}}
    let q=morphArcSegments[(first+lo)*2u+1u];let t=select(0.0,clamp((arcTarget-q.x)/q.y,0.0,1.0),q.y>0.0000001);return sampleArcMicro(first+lo,t);
}
fn sampleMorphArcSegment(pathIndex:u32,segmentIndex:f32,segmentT:f32)->vec2<f32>{
    let r=morphPathSegmentRanges[pathIndex];let n=max(1u,r.y);let si=min(n-1u,u32(max(0.0,segmentIndex)+0.5));return sampleArcMicro(r.x+si,clamp(segmentT,0.0,1.0));
}
fn arcLampOut(corner:vec2<f32>,li:u32,copyIndex:u32,useCopy:bool)->VSOut{
    var o:VSOut;let l0=corridorLampData[li*4u];let l1=corridorLampData[li*4u+1u];let l2=corridorLampData[li*4u+2u];let l3=corridorLampData[li*4u+3u];
    let pathIndex=u32(max(0.0,l0.x)+0.5);let directSegment=l3.y>0.5;let railPoint=select(sampleMorphArc(pathIndex,l0.y),sampleMorphArcSegment(pathIndex,l3.z,l3.w),directSegment);let centerLocal=railPoint+l0.zw;var center:vec2<f32>;var screenScale:f32;var copyAlpha=1.0;
    if(useCopy){let c0=corridorCopyData[copyIndex*2u];let c1=corridorCopyData[copyIndex*2u+1u];let f00=u.root0.x*c0.x+u.root0.y*c1.x;let f01=u.root0.x*c0.y+u.root0.y*c1.y;let f10=u.root0.z*c0.x+u.root0.w*c1.x;let f11=u.root0.z*c0.y+u.root0.w*c1.y;center=vec2<f32>(f00*centerLocal.x+f01*centerLocal.y+u.root1.x,f10*centerLocal.x+f11*centerLocal.y+u.root1.y);screenScale=length(vec2<f32>(f00,f10));copyAlpha=c0.z;}
    else{center=vec2<f32>(u.root0.x*centerLocal.x+u.root0.y*centerLocal.y+u.root1.x,u.root0.z*centerLocal.x+u.root0.w*centerLocal.y+u.root1.y);screenScale=length(vec2<f32>(u.root0.x,u.root0.z));}
    let outer=max(1.0,l1.x*screenScale);let p=center+corner*outer;o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);
    o.q=corner;o.body=l1.y;o.color=vec3<f32>(l1.z,l1.w,l2.x);o.soft=l2.y;o.bright=l2.z;o.lampType=l2.w;o.alpha=l3.x*copyAlpha;return o;
}
@vertex fn vsArc(@location(0) corner:vec2<f32>,@builtin(instance_index) iid:u32)->VSOut{return arcLampOut(corner,iid,0u,false);}
@vertex fn vsArcCorridor(@location(0) corner:vec2<f32>,@builtin(instance_index) iid:u32)->VSOut{let lampCount=max(u.lampCount,1u);return arcLampOut(corner,iid%lampCount,iid/lampCount,true);}
fn sampleTopologyIdentity(identityIndex:u32)->vec2<f32>{
    let a=lampTopologyIdentity[identityIndex*3u];let m=lampTopologyIdentity[identityIndex*3u+1u];let t=u.root1.z;let rot=m.x*(1.0-t);let c=cos(rot);let s=sin(rot);let arcTarget=vec2<f32>(a.z*c-a.w*s,a.z*s+a.w*c);
    if(m.y>0.5){let source=a.xy;let sr=length(source);let tr=length(arcTarget);let sa=atan2(source.y,source.x);let ta=atan2(arcTarget.y,arcTarget.x);var delta=ta-sa;if(u.root1.w>0.5){delta=clamp(delta,-12.566370614359172,12.566370614359172);}let rr=mix(sr,tr,t);let aa=sa+delta*t;return vec2<f32>(cos(aa),sin(aa))*rr;}
    return mix(a.xy,arcTarget,t);
}
fn topologyLampOut(corner:vec2<f32>,li:u32,copyIndex:u32,useCopy:bool)->VSOut{
    var o:VSOut;let l0=corridorLampData[li*4u];let l1=corridorLampData[li*4u+1u];let l2=corridorLampData[li*4u+2u];let l3=corridorLampData[li*4u+3u];let centerLocal=sampleTopologyIdentity(u32(max(0.0,l0.x)+0.5))+l0.zw;var center:vec2<f32>;var screenScale:f32;var copyAlpha=1.0;
    if(useCopy){let c0=corridorCopyData[copyIndex*2u];let c1=corridorCopyData[copyIndex*2u+1u];let f00=u.root0.x*c0.x+u.root0.y*c1.x;let f01=u.root0.x*c0.y+u.root0.y*c1.y;let f10=u.root0.z*c0.x+u.root0.w*c1.x;let f11=u.root0.z*c0.y+u.root0.w*c1.y;center=vec2<f32>(f00*centerLocal.x+f01*centerLocal.y+u.root1.x,f10*centerLocal.x+f11*centerLocal.y+u.root1.y);screenScale=length(vec2<f32>(f00,f10));copyAlpha=c0.z;}
    else{center=vec2<f32>(u.root0.x*centerLocal.x+u.root0.y*centerLocal.y+u.root1.x,u.root0.z*centerLocal.x+u.root0.w*centerLocal.y+u.root1.y);screenScale=length(vec2<f32>(u.root0.x,u.root0.z));}
    let outer=max(1.0,l1.x*screenScale);let p=center+corner*outer;o.position=vec4<f32>(p.x/u.viewport.x*2.0-1.0,1.0-p.y/u.viewport.y*2.0,0.0,1.0);o.q=corner;o.body=l1.y;o.color=vec3<f32>(l1.z,l1.w,l2.x);o.soft=l2.y;o.bright=l2.z;o.lampType=l2.w;o.alpha=l3.x*copyAlpha;return o;
}
@vertex fn vsTopology(@location(0) corner:vec2<f32>,@builtin(instance_index) iid:u32)->VSOut{return topologyLampOut(corner,iid,0u,false);}
@vertex fn vsTopologyCorridor(@location(0) corner:vec2<f32>,@builtin(instance_index) iid:u32)->VSOut{let lampCount=max(u.lampCount,1u);return topologyLampOut(corner,iid%lampCount,iid/lampCount,true);}
fn sat(x:f32)->f32{return clamp(x,0.0,1.0);}
fn seg(x:f32,a:f32,b:f32)->f32{return sat((x-a)/max(0.000001,b-a));}
@fragment fn fsMain(v:VSOut)->@location(0) vec4<f32>{
    let d=length(v.q);let aa=max(fwidth(d)*1.15,0.00035);if(d>=1.0){discard;}
    let softRaw=clamp(v.soft,0.0,1.5);
    let soft=min(softRaw,1.0);
    let over=sat(v.bright-1.0);
    let haloFade=1.0-over;
    let body=clamp(v.body,0.03,0.93);
    let edgeAlpha=0.08+0.92*over;
    let coreHardness=select(0.0,1.0-soft,v.lampType<1.5);
    let haloVisibility=haloFade*select(1.0,soft,v.lampType<1.5);
    let plateauFrac=body*over;
    let justOutside=min(0.997,body+0.012);
    var rgb=v.color;
    var bodyEdge=edgeAlpha;
    var solidUntil=0.0;
    var bodyCoverage=1.0;
    if(v.lampType>=0.5 && v.lampType<1.5){
        let hard=max(over,coreHardness);solidUntil=body*hard;bodyEdge=max(edgeAlpha,hard);
        bodyCoverage=select(mix(1.0,bodyEdge,seg(d,solidUntil,body)),1.0,d<=solidUntil);
    }else if(v.lampType>=1.5 && v.lampType<2.5){
        let darkCore=max(0.06,body*(0.18+0.22*(1.0-soft)));
        let darkA0=0.96-soft*0.16;let darkA1=0.76-soft*0.22;
        if(d<darkCore){bodyCoverage=mix(darkA0,darkA1,seg(d,0.0,darkCore));rgb=vec3<f32>(0.0);}
        else{
            let p=max(darkCore+0.006,min(body-0.006,plateauFrac));
            if(over>0.001 && d<p){bodyCoverage=mix(darkA1,1.0,seg(d,darkCore,p));}
            else{let start=select(darkCore,p,over>0.001);let startA=select(darkA1,1.0,over>0.001);bodyCoverage=mix(startA,edgeAlpha,seg(d,start,body));}
        }
        bodyEdge=edgeAlpha;
    }else if(v.lampType>=2.5 && v.lampType<3.5){
        let inner=body*(0.35-0.12*over);let ringStart=max(inner+0.01,body*(0.67-0.18*over));
        let a0=0.02+0.12*over;let a1=0.08+0.25*over;
        if(d<inner){bodyCoverage=mix(a0,a1,seg(d,0.0,inner));}
        else if(d<ringStart){bodyCoverage=mix(a1,1.0,seg(d,inner,ringStart));}
        else{bodyCoverage=mix(1.0,edgeAlpha,seg(d,ringStart,body));}
        let whiteRing=1.0-sat(abs(d-ringStart)/max(0.008,body*0.09));rgb=mix(v.color,vec3<f32>(1.0),whiteRing*0.75);bodyEdge=edgeAlpha;
    }else if(v.lampType<0.5){
        let whiteCoreFade=select(sat(1.0-(softRaw-1.0)/0.5),1.0,softRaw<=1.0);
        var whiteExtent:f32;var whiteHold:f32;var wt:f32;
        if(softRaw<=1.0){whiteExtent=body*(1.0-0.90*soft);whiteHold=max(0.004,whiteExtent*select(0.58,1.0,soft<0.01));wt=min(body-0.004,max(whiteHold+0.004,whiteExtent));bodyEdge=max(edgeAlpha,coreHardness);}
        else{whiteExtent=max(0.002,body*0.10*whiteCoreFade);whiteHold=max(0.001,whiteExtent*0.58);wt=min(body-0.004,max(whiteHold+0.003,whiteExtent));bodyEdge=edgeAlpha;}
        var lastSolid=wt;if(over>0.001 && plateauFrac>wt+0.004){lastSolid=min(body-0.002,plateauFrac);}
        bodyCoverage=select(mix(1.0,bodyEdge,seg(d,lastSolid,body)),1.0,d<=lastSolid);
        var whiteMix:f32;if(d<=whiteHold){whiteMix=1.0;}else{whiteMix=1.0-seg(d,whiteHold,max(whiteHold+0.0005,wt));}
        whiteMix*=whiteCoreFade;rgb=mix(v.color,vec3<f32>(1.0),sat(whiteMix));
    }else{
        let hard=over;solidUntil=body*hard;bodyEdge=max(edgeAlpha,hard);
        bodyCoverage=select(mix(1.0,bodyEdge,seg(d,solidUntil,body)),1.0,d<=solidUntil);
    }
    var coverage:f32;
    if(d<=body){coverage=bodyCoverage;}
    else if(over>=0.999 || ((v.lampType<1.5)&&soft<=0.001)){coverage=mix(bodyEdge,0.0,seg(d,body,justOutside));}
    else{
        let haloA=min(0.30,edgeAlpha*0.85)*haloVisibility;let haloMidA=haloA*0.28;
        let h0=min(0.993,body+(1.0-body)*0.10);let h1=min(0.995,body+(1.0-body)*(0.34+0.20*soft));
        if(d<=h0){coverage=mix(bodyEdge,haloA,seg(d,body,h0));}
        else if(d<=h1){coverage=mix(haloA,haloMidA,seg(d,h0,h1));}
        else{coverage=mix(haloMidA,0.0,seg(d,h1,1.0));}
    }
    if(v.lampType>=3.5){
        let rayFall=1.0-smoothstep(0.18,1.0,d);
        let ax=exp(-pow(abs(v.q.x)*34.0,2.0))+exp(-pow(abs(v.q.y)*34.0,2.0));
        let d1=abs(v.q.x-v.q.y)*0.70710678;let d2=abs(v.q.x+v.q.y)*0.70710678;
        let diag=(exp(-pow(d1*38.0,2.0))+exp(-pow(d2*38.0,2.0)))*0.52;
        let rays=(ax+diag)*rayFall;coverage=max(coverage,rays*0.66);rgb=mix(rgb,vec3<f32>(1.0),sat(rays));
    }
    coverage*=1.0-smoothstep(1.0-aa,1.0,d);coverage=max(0.0,coverage)*clamp(v.alpha,0.0,1.0);
    if(coverage<=0.000002){discard;}
    return vec4<f32>(max(rgb,vec3<f32>(0.0))*coverage,coverage);
}`;
            const TONE_WGSL=`
@group(0) @binding(0) var hdrTex:texture_2d<f32>;
@vertex fn vsMain(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
    var p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    return vec4<f32>(p[i],0.0,1.0);
}
@fragment fn fsMain(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
    let dims=textureDimensions(hdrTex);
    let xy=clamp(vec2<i32>(p.xy),vec2<i32>(0),vec2<i32>(dims)-vec2<i32>(1));
    let hdr=max(textureLoad(hdrTex,xy,0).rgb,vec3<f32>(0.0));
    let shown=clamp(hdr,vec3<f32>(0.0),vec3<f32>(1.0));
    let a=max(max(shown.r,shown.g),shown.b);
    if(a<0.00001){return vec4<f32>(0.0);}
    // Canvas/WebGL tone path presents color=shown/a, alpha=a.  Premultiplied WebGPU
    // presentation stores exactly shown in RGB, preserving the same final composite.
    return vec4<f32>(shown,a);
}`;
            const FREEZE_WGSL=`
struct FreezeUniforms { decay:f32, _pad0:f32, _pad1:f32, _pad2:f32 };
@group(0) @binding(0) var currentTex:texture_2d<f32>;
@group(0) @binding(1) var historyTex:texture_2d<f32>;
@group(0) @binding(2) var<uniform> fu:FreezeUniforms;
@vertex fn vsMain(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
    var p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
    return vec4<f32>(p[i],0.0,1.0);
}
@fragment fn fsMain(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
    let dims=textureDimensions(currentTex);
    let xy=clamp(vec2<i32>(p.xy),vec2<i32>(0),vec2<i32>(dims)-vec2<i32>(1));
    let current=max(textureLoad(currentTex,xy,0),vec4<f32>(0.0));
    let history=max(textureLoad(historyTex,xy,0),vec4<f32>(0.0))*clamp(fu.decay,0.0,1.0);
    return max(current,history);
}`;
            function additiveBlend(){return{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}};}
            async function initAsync(){
                if(ready&&!lost)return true;if(initializing)return false;if(attempted&&!ready&&!lost)return false;
                attempted=true;initializing=true;lastError='';
                try{
                    const shared=await WebGPUDeviceHub.acquire();adapter=shared.adapter;device=shared.device;hubGeneration=shared.generation;lost=false;
                    if(typeof GPUTextureUsage==='undefined')throw new Error('GPUTextureUsage unavailable');
                    context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU lamp canvas context недоступен');
                    format=navigator.gpu.getPreferredCanvasFormat();
                    device.pushErrorScope?.('validation');
                    const lampModule=device.createShaderModule({label:'Spiro lamp HDR',code:LAMP_WGSL});await assertWebGPUShaderModule(lampModule,'Spiro lamp HDR');
                    const toneModule=device.createShaderModule({label:'Spiro lamp tone',code:TONE_WGSL});await assertWebGPUShaderModule(toneModule,'Spiro lamp tone');
                    const freezeModule=device.createShaderModule({label:'Somata FreezeLight feedback',code:FREEZE_WGSL});await assertWebGPUShaderModule(freezeModule,'Somata FreezeLight feedback');
                    lampPipeline=device.createRenderPipeline({label:'Spiro lamp HDR pipeline',layout:'auto',vertex:{module:lampModule,entryPoint:'vsMain',buffers:[
                        {arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},
                        {arrayStride:FLOATS_PER_INSTANCE*4,stepMode:'instance',attributes:[
                            {shaderLocation:1,offset:0,format:'float32x2'},{shaderLocation:2,offset:8,format:'float32'},{shaderLocation:3,offset:12,format:'float32'},
                            {shaderLocation:4,offset:16,format:'float32x3'},{shaderLocation:5,offset:28,format:'float32'},{shaderLocation:6,offset:32,format:'float32'},
                            {shaderLocation:7,offset:36,format:'float32'},{shaderLocation:8,offset:40,format:'float32'}]}]},
                        fragment:{module:lampModule,entryPoint:'fsMain',targets:[{format:'rgba16float',blend:additiveBlend()}]},primitive:{topology:'triangle-strip'}
                    });
                    corridorLampPipeline=device.createRenderPipeline({label:'Spiro corridor lamp HDR pipeline',layout:'auto',vertex:{module:lampModule,entryPoint:'vsCorridor',buffers:[
                        {arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}
                    ]},fragment:{module:lampModule,entryPoint:'fsMain',targets:[{format:'rgba16float',blend:additiveBlend()}]},primitive:{topology:'triangle-strip'}});
                    arcLampPipeline=device.createRenderPipeline({label:'Spiro Morph Arc lamp HDR pipeline',layout:'auto',vertex:{module:lampModule,entryPoint:'vsArc',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:lampModule,entryPoint:'fsMain',targets:[{format:'rgba16float',blend:additiveBlend()}]},primitive:{topology:'triangle-strip'}});
                    arcCorridorLampPipeline=device.createRenderPipeline({label:'Spiro Morph Arc corridor lamp HDR pipeline',layout:'auto',vertex:{module:lampModule,entryPoint:'vsArcCorridor',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:lampModule,entryPoint:'fsMain',targets:[{format:'rgba16float',blend:additiveBlend()}]},primitive:{topology:'triangle-strip'}});
                    topologyLampPipeline=device.createRenderPipeline({label:'Spiro topology identity lamp HDR pipeline',layout:'auto',vertex:{module:lampModule,entryPoint:'vsTopology',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:lampModule,entryPoint:'fsMain',targets:[{format:'rgba16float',blend:additiveBlend()}]},primitive:{topology:'triangle-strip'}});
                    topologyCorridorLampPipeline=device.createRenderPipeline({label:'Spiro topology identity corridor lamp HDR pipeline',layout:'auto',vertex:{module:lampModule,entryPoint:'vsTopologyCorridor',buffers:[{arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]}]},fragment:{module:lampModule,entryPoint:'fsMain',targets:[{format:'rgba16float',blend:additiveBlend()}]},primitive:{topology:'triangle-strip'}});
                    tonePipeline=device.createRenderPipeline({label:'Spiro lamp tone pipeline',layout:'auto',vertex:{module:toneModule,entryPoint:'vsMain'},fragment:{module:toneModule,entryPoint:'fsMain',targets:[{format}]},primitive:{topology:'triangle-list'}});
                    freezePipeline=device.createRenderPipeline({label:'Somata FreezeLight feedback pipeline',layout:'auto',vertex:{module:freezeModule,entryPoint:'vsMain'},fragment:{module:freezeModule,entryPoint:'fsMain',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
                    cornerBuffer=device.createBuffer({label:'Spiro lamp corners',size:32,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
                    device.queue.writeBuffer(cornerBuffer,0,new Float32Array([-1,-1,1,-1,-1,1,1,1]));
                    uniformBuffer=device.createBuffer({label:'Spiro lamp uniforms',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                    freezeUniformBuffer=device.createBuffer({label:'Somata FreezeLight uniforms',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
                    dummyStorageBuffer=device.createBuffer({label:'Spiro lamp dummy storage binding',size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
                    device.queue.writeBuffer(dummyStorageBuffer,0,new Float32Array(4));
                    lampBindGroup=device.createBindGroup({layout:lampPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniformBuffer}}]});
                    const validation=await device.popErrorScope?.();if(validation)throw new Error(`WebGPU lamps validation: ${validation.message||validation}`);
                    ready=true;return true;
                }catch(err){ready=false;lastError=String(err?.message||err);return false;}
                finally{initializing=false;}
            }
            async function ensureReady(){
                if(ready&&!lost)return true;
                // initAsync() intentionally returns immediately while another warmup owns init.
                // Phase-circle Morph needs an awaitable contract, so join that in-flight init
                // without creating a second device/pipeline build.
                if(initializing){
                    const deadline=performance.now()+5000;
                    while(initializing&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,4));
                    return ready&&!lost;
                }
                const ok=await initAsync();return ok===true&&ready&&!lost;
            }
            function resetCorridorBatchPool(){
                for(const batch of corridorBatchPool){for(const b of batch?.lampBuffers||[])try{b?.destroy?.();}catch(_){}for(const b of batch?.copyBuffers||[])try{b?.destroy?.();}catch(_){}try{batch?.uniformBuffer?.destroy?.();}catch(_){} }
                corridorBatchPool.length=0;corridorBatchCount=0;
                for(const batch of arcBatchPool){for(const b of batch?.lampBuffers||[])try{b?.destroy?.();}catch(_){}try{batch?.uniformBuffer?.destroy?.();}catch(_){} }
                arcBatchPool.length=0;arcBatchCount=0;deferredLocalArcTables=[];
            }
            function warmup(){
                const hubReady=WebGPUDeviceHub.warmup(),gen=WebGPUDeviceHub.getGeneration();
                if(ready&&(!hubReady||gen!==hubGeneration)){ready=false;attempted=false;initializing=false;lost=!hubReady;arcLampPipeline=arcCorridorLampPipeline=topologyLampPipeline=topologyCorridorLampPipeline=freezePipeline=null;try{context?.unconfigure?.();}catch(_){} try{hdrTexture?.destroy?.();}catch(_){} try{toneTexture?.destroy?.();}catch(_){}for(const t of freezeHistoryTextures)try{t?.destroy?.();}catch(_){}try{freezeUniformBuffer?.destroy?.();}catch(_){}try{dummyStorageBuffer?.destroy?.();}catch(_){}hdrTexture=toneTexture=null;freezeHistoryTextures=[null,null];freezeHistoryViews=[null,null];hdrView=toneView=null;toneBindGroups=[null,null,null];freezeBindGroups=[null,null];freezeUniformBuffer=null;dummyStorageBuffer=null;freezeHistoryValid=false;freezeLastRenderAt=0;freezeLastMotionAt=0;lastToneValid=false;deferredComposite=false;deferredCommandBuffer=null;deferredCommandGeneration=0;lampFrameSerial=0;lastInstanceBuffer=null;lastInstanceSnapshot=null;lastInstanceCount=0;lastInstanceHash=0;for(const b of instanceBuffers)try{b?.destroy?.();}catch(_){}instanceBuffers=[null,null,null];capacity=0;resetCorridorBatchPool();}
                if(!ready&&!initializing&&(!attempted||lost))void initAsync();return ready&&!lost&&hubReady;
            }
            function ensureCapacity(count){
                const desired=performanceGovernor.stickyRingCount(3,instanceBuffers.length),grow=count>capacity||instanceBuffers.some(x=>!x);
                if(grow){capacity=performanceGovernor.capacityFor(count,capacity,512,1.65);for(const b of instanceBuffers)try{b?.destroy?.();}catch(_){}instanceBuffers=[];lastInstanceBuffer=null;lastInstanceSnapshot=null;lastInstanceCount=0;lastInstanceHash=0;if(instanceData.length<capacity*FLOATS_PER_INSTANCE){const next=new Float32Array(capacity*FLOATS_PER_INSTANCE);next.set(instanceData.subarray(0,instanceCount*FLOATS_PER_INSTANCE));instanceData=next;}}
                while(instanceBuffers.length<desired)instanceBuffers.push(device.createBuffer({label:`Spiro lamp instances ${instanceBuffers.length}`,size:Math.max(4,capacity*FLOATS_PER_INSTANCE*4),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}));
                return true;
            }
            function ensureFreezeHistoryResources(){
                if(freezeHistoryTextures[0]&&freezeHistoryTextures[1]&&freezeHistoryViews[0]&&freezeHistoryViews[1]&&toneBindGroups[1]&&toneBindGroups[2]&&freezeBindGroups[0]&&freezeBindGroups[1])return true;
                for(const t of freezeHistoryTextures)try{t?.destroy?.();}catch(_){}
                freezeHistoryTextures=[0,1].map(i=>device.createTexture({label:`Somata FreezeLight history ${i}`,size:{width,height,depthOrArrayLayers:1},format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}));
                freezeHistoryViews=freezeHistoryTextures.map(t=>t.createView());
                toneBindGroups[1]=device.createBindGroup({layout:tonePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:freezeHistoryViews[0]}]});
                toneBindGroups[2]=device.createBindGroup({layout:tonePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:freezeHistoryViews[1]}]});
                freezeBindGroups=freezeHistoryViews.map(view=>device.createBindGroup({layout:freezePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:hdrView},{binding:1,resource:view},{binding:2,resource:{buffer:freezeUniformBuffer}}]}));
                freezeHistoryIndex=0;freezeHistoryValid=false;freezeLastRenderAt=0;freezeLastMotionAt=0;return true;
            }
            function ensureSize(w,h){
                if(!warmup()||!ready||!device||!context)return false;w=Math.max(1,w|0);h=Math.max(1,h|0);
                if(width===w&&height===h&&canvas.width===w&&canvas.height===h&&hdrTexture&&toneTexture)return true;
                width=w;height=h;canvas.width=w;canvas.height=h;context.configure({device,format,alphaMode:'premultiplied',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST});
                try{hdrTexture?.destroy?.();}catch(_){}try{toneTexture?.destroy?.();}catch(_){}for(const t of freezeHistoryTextures)try{t?.destroy?.();}catch(_){}
                hdrTexture=device.createTexture({label:'Spiro lamp RGBA16F HDR',size:{width,height,depthOrArrayLayers:1},format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
                toneTexture=device.createTexture({label:'Spiro lamp tone scene bridge',size:{width,height,depthOrArrayLayers:1},format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
                hdrView=hdrTexture.createView();toneView=toneTexture.createView();freezeHistoryTextures=[null,null];freezeHistoryViews=[null,null];freezeBindGroups=[null,null];
                toneBindGroups=[device.createBindGroup({layout:tonePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:hdrView}]}),null,null];
                freezeHistoryIndex=0;freezeHistoryValid=false;freezeLastRenderAt=0;freezeLastMotionAt=0;lastToneValid=false;deferredComposite=false;deferredCommandBuffer=null;deferredCommandGeneration=0;
                uniformData[0]=width;uniformData[1]=height;uniformData[2]=0;uniformData[3]=0;device.queue.writeBuffer(uniformBuffer,0,uniformData);
                return true;
            }
            function beginFrame(w,h,now=performance.now()){frameNow=Number(now)||performance.now();lampFrameSerial=(lampFrameSerial+1)>>>0;instanceCount=0;instanceFrameHash=2166136261>>>0;freezeFrameHash=2166136261>>>0;freezeDrawCount=0;corridorBatchCount=0;arcBatchCount=0;deferredLocalArcTables=[];lastFlushMode='none';lastToneValid=false;deferredComposite=false;deferredCommandBuffer=null;deferredCommandGeneration=0;return ensureSize(w,h);}
            function freezeTailSec(){return Math.max(.05,Math.min(30,Number(state?.lamps?.freezeTailSec)||1.5));}
            function freezeLightEnabled(){return state?.lamps?.freezeLight===true;}
            function freezeTailTick(now){if(!freezeLightEnabled()||!freezeHistoryValid)return false;requestMainCanvasRender();return Number(now)<freezeLastMotionAt+freezeTailSec()*1000;}
            function armFreezeTail(){try{animationScheduler?.add?.('lamp-freezelight',freezeTailTick);}catch(_){}}
            function resetFreezeLight(){freezeHistoryValid=false;freezeLastRenderAt=0;freezeLastMotionAt=0;freezeLastFrameHash=0;freezeLastDrawCount=-1;freezeResets++;try{animationScheduler?.remove?.('lamp-freezelight');}catch(_){}}
            function mixFreezeCopies(copies,alphas,frameCtx,layer){if(!freezeLightEnabled()||!Array.isArray(copies))return;freezeFrameHash=lampHashMix(freezeFrameHash,copies.length);for(let i=0;i<copies.length;i++){const c=copies[i];freezeFrameHash=lampHashMix(freezeFrameHash,Number(c?.scale)||0);freezeFrameHash=lampHashMix(freezeFrameHash,Number(alphas?.[i]??1));try{freezeFrameHash=lampHashMix(freezeFrameHash,getMotionTunnelLagRadians(c,layer));}catch(_){}}if(frameCtx){freezeFrameHash=lampHashMix(freezeFrameHash,Number(frameCtx.combinedScale)||1);freezeFrameHash=lampHashMix(freezeFrameHash,Number(frameCtx.combinedRotationRad)||0);}}
            function canUse(cfg){if(cfg?.webgl===false)return false;const blend=cfg?.blendMode||'lighter';return blend==='lighter'||blend==='screen';}
            function ensureCorridorBatch(index,lampNeed,copyNeed){
                let batch=corridorBatchPool[index];
                if(!batch){batch={lampCapacity:0,copyCapacity:0,lampData:null,copyData:null,lampBuffers:[],copyBuffers:[],uniformBuffer:null,uniformF32:null,uniformU32:null,uniformBindGroup:null,uniformSnapshot:new Uint32Array(12),uniformHasLast:false,storageBindGroups:[],sharedStorageBindGroups:[],sharedCopy:false,lampCount:0,copyCount:0,slot:0,ringCount:0,lastLampHash:0,lastLampCount:0,lastLampSnapshot:null,lastLampBuffer:null,lastLampSlot:-1};corridorBatchPool[index]=batch;}
                const desired=performanceGovernor.stickyRingCount(3,Math.max(batch.ringCount,batch.lampBuffers.length,batch.copyBuffers.length));
                if(!batch.uniformBuffer){const ab=new ArrayBuffer(48);batch.uniformF32=new Float32Array(ab);batch.uniformU32=new Uint32Array(ab);batch.uniformBuffer=device.createBuffer({label:`Spiro corridor lamp uniforms ${index}`,size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});batch.uniformBindGroup=device.createBindGroup({layout:corridorLampPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:batch.uniformBuffer}}]});}
                const lampGrow=lampNeed>batch.lampCapacity,copyGrow=copyNeed>batch.copyCapacity;
                if(lampGrow){batch.lampCapacity=performanceGovernor.capacityFor(lampNeed,batch.lampCapacity,64,1.6);batch.lampData=new Float32Array(batch.lampCapacity*CORRIDOR_LAMP_FLOATS);for(const b of batch.lampBuffers)try{b?.destroy?.();}catch(_){}batch.lampBuffers=[];batch.storageBindGroups=[];batch.sharedStorageBindGroups=[];batch.lastLampSnapshot=null;batch.lastLampBuffer=null;batch.lastLampCount=0;batch.lastLampHash=0;batch.lastLampSlot=-1;}
                if(copyGrow){batch.copyCapacity=performanceGovernor.capacityFor(copyNeed,batch.copyCapacity,32,1.6);batch.copyData=new Float32Array(batch.copyCapacity*CORRIDOR_COPY_FLOATS);for(const b of batch.copyBuffers)try{b?.destroy?.();}catch(_){}batch.copyBuffers=[];batch.storageBindGroups=[];batch.sharedStorageBindGroups=[];}
                while(batch.lampBuffers.length<desired)batch.lampBuffers.push(device.createBuffer({label:`Spiro corridor lamp data ${index}:${batch.lampBuffers.length}`,size:Math.max(16,batch.lampCapacity*CORRIDOR_LAMP_FLOATS*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));
                while(batch.copyBuffers.length<desired)batch.copyBuffers.push(device.createBuffer({label:`Spiro corridor lamp copies ${index}:${batch.copyBuffers.length}`,size:Math.max(16,batch.copyCapacity*CORRIDOR_COPY_FLOATS*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));
                while(batch.storageBindGroups.length<desired)batch.storageBindGroups.push(null);
                batch.ringCount=desired;return batch;
            }
            function queueCorridorVisualPlan(ctx,visualPlan,alpha,drawPlan,copies,alphas,frameCtx){
                const items=visualPlan?.items,cfg=drawPlan?.config||visualPlan?.cfg||state.lamps||{};
                if(!ready||!items?.length||alpha<=.001||!canUse(cfg)||!Array.isArray(copies)||!copies.length||!frameCtx)return false;
                const root=ctx?.getTransform?.();if(!root)return false;
                const batch=ensureCorridorBatch(corridorBatchCount,items.length,copies.length),style=drawPlan?.preparedStyle||visualPlan?.style||{};
                const softness=Math.max(0,Math.min(150,Number(style.effectiveSoftness)||0)),type=style.type||'whiteCore',typeCode=TYPE_CODE[type]??0;let lk=0,lampHash=2166136261>>>0;
                for(let i=0;i<items.length;i++){
                    const v=items[i],rad=Math.max(0,Number(v.rad)||0);if(rad<=.001)continue;const lampAlpha=Math.max(0,Math.min(1,alpha*(Number(v.intensityAlpha)||0)));if(lampAlpha<=.00001)continue;
                    const vb=Math.max(0,Math.min(200,Number(v.brightness)||0));let outerLocal=lampV261GradientOuterRadius(rad,softness,type,vb);if(type==='star')outerLocal=Math.max(outerLocal,rad*(2.15+.25*(1-Math.min(100,softness)/100))+6);
                    const body=Math.max(.03,Math.min(.93,rad/Math.max(.000001,outerLocal))),rgb=GPUColorCache.rgba(v.color||'#ffffff'),o=lk*CORRIDOR_LAMP_FLOATS;
                    batch.lampData[o]=Number(v.px)||0;batch.lampData[o+1]=Number(v.py)||0;batch.lampData[o+2]=outerLocal;batch.lampData[o+3]=body;batch.lampData[o+4]=rgb[0];batch.lampData[o+5]=rgb[1];batch.lampData[o+6]=rgb[2];batch.lampData[o+7]=softness/100;batch.lampData[o+8]=vb/100;batch.lampData[o+9]=typeCode;batch.lampData[o+10]=lampAlpha;batch.lampData[o+11]=0;for(let hi=0;hi<CORRIDOR_LAMP_FLOATS;hi++)lampHash=lampHashMix(lampHash,batch.lampData[o+hi]);lk++;
                }
                if(!lk)return true;
                // v400: keep copy-local lag/scale/alpha in the shared resident 8xf32 buffer.
                // Root * frameRotation * frameScale is constant for this lamp batch and moves to WGSL.
                const ra=Number(root.a)||0,rb=Number(root.b)||0,rc=Number(root.c)||0,rd=Number(root.d)||0,re=Number(root.e)||0,rf=Number(root.f)||0;
                const frameRot=frameCtx.hasCombinedRotation?(Number(frameCtx.combinedRotationRad)||0):0,ct=Math.cos(frameRot),sn=Math.sin(frameRot);
                const frameScale=frameCtx.hasCombinedScale?(Number(frameCtx.combinedScale)||0):1;
                batch.uniformF32[0]=width;batch.uniformF32[1]=height;batch.uniformU32[2]=lk;batch.uniformU32[3]=0;
                batch.uniformF32[4]=(ra*ct+rc*sn)*frameScale;batch.uniformF32[5]=(-ra*sn+rc*ct)*frameScale;
                batch.uniformF32[6]=(rb*ct+rd*sn)*frameScale;batch.uniformF32[7]=(-rb*sn+rd*ct)*frameScale;
                batch.uniformF32[8]=re;batch.uniformF32[9]=rf;batch.uniformF32[10]=0;batch.uniformF32[11]=0;
                let slot=lampFrameSerial%Math.max(1,batch.ringCount||batch.lampBuffers.length),lampBuffer=batch.lampBuffers[slot];
                const lampFloatCount=lk*CORRIDOR_LAMP_FLOATS,lampByteCount=lampFloatCount*4;
                const lampUnchanged=!!batch.lastLampBuffer&&batch.lastLampCount===lk&&batch.lastLampHash===lampHash&&sameLampF32(batch.lampData,batch.lastLampSnapshot,lampFloatCount);
                if(lampUnchanged){slot=batch.lastLampSlot;lampBuffer=batch.lastLampBuffer;corridorLampUploadSkips++;corridorLampUploadBytesAvoided+=lampByteCount;}
                else{device.queue.writeBuffer(lampBuffer,0,batch.lampData.buffer,batch.lampData.byteOffset,lampByteCount);corridorLampUploads+=lampByteCount;if(!batch.lastLampSnapshot||batch.lastLampSnapshot.length<lampFloatCount)batch.lastLampSnapshot=new Float32Array(Math.max(lampFloatCount,batch.lampCapacity*CORRIDOR_LAMP_FLOATS));batch.lastLampSnapshot.set(batch.lampData.subarray(0,lampFloatCount),0);batch.lastLampHash=lampHash;batch.lastLampCount=lk;batch.lastLampBuffer=lampBuffer;batch.lastLampSlot=slot;}
                let copyBuffer=null,ck=0,bg=null;const shared=WebGPUCorridorCopyStore.acquireRaw(device,hubGeneration,frameCtx,copies,alphas,'lamp',frameCtx.layer);
                if(shared?.buffer&&shared.k){copyBuffer=shared.buffer;ck=shared.k;corridorSharedCopyReuse++;corridorSharedCopyAvoidedBytes+=ck*CORRIDOR_COPY_FLOATS*4;let wm=batch.sharedStorageBindGroups[slot];if(!wm){wm=new WeakMap();batch.sharedStorageBindGroups[slot]=wm;}bg=wm.get(copyBuffer);if(!bg){bg=device.createBindGroup({layout:corridorLampPipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:lampBuffer}},{binding:1,resource:{buffer:copyBuffer}}]});wm.set(copyBuffer,bg);}batch.sharedCopy=true;}
                else{let k=0;for(let i=0;i<copies.length;i++){const ca=Math.max(0,Math.min(1,Number(alphas?.[i]??1)));if(ca<=.00001)continue;const copy=copies[i],sc=Math.max(.000001,Number(copy?.scale)||0),ang=getMotionTunnelLagRadians(copy,frameCtx.layer),c=Math.cos(ang),q=Math.sin(ang),o=k*CORRIDOR_COPY_FLOATS;batch.copyData[o]=sc*c;batch.copyData[o+1]=-sc*q;batch.copyData[o+2]=ca;batch.copyData[o+3]=0;batch.copyData[o+4]=sc*q;batch.copyData[o+5]=sc*c;batch.copyData[o+6]=sc;batch.copyData[o+7]=0;k++;}ck=k;if(!ck)return true;copyBuffer=batch.copyBuffers[slot];device.queue.writeBuffer(copyBuffer,0,batch.copyData.buffer,batch.copyData.byteOffset,ck*CORRIDOR_COPY_FLOATS*4);corridorCopyUploads+=ck*CORRIDOR_COPY_FLOATS*4;bg=batch.storageBindGroups[slot];if(!bg){bg=device.createBindGroup({layout:corridorLampPipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:lampBuffer}},{binding:1,resource:{buffer:copyBuffer}}]});batch.storageBindGroups[slot]=bg;}batch.sharedCopy=false;}
                if(!batch.uniformHasLast||!sameLampU32(batch.uniformU32,batch.uniformSnapshot,12)){device.queue.writeBuffer(batch.uniformBuffer,0,batch.uniformU32);batch.uniformSnapshot.set(batch.uniformU32);batch.uniformHasLast=true;corridorUniformUploads++;}else corridorUniformUploadSkips++;
                batch.storageBindGroups[slot]=batch.sharedCopy?batch.storageBindGroups[slot]:bg;batch.activeBindGroup=bg;batch.lampCount=lk;batch.copyCount=ck;batch.slot=slot;
                if(freezeLightEnabled()){freezeFrameHash=lampHashMix(freezeFrameHash,lampHash);for(const n of [ra,rb,rc,rd,re,rf,frameRot,frameScale])freezeFrameHash=lampHashMix(freezeFrameHash,n);mixFreezeCopies(copies,alphas,frameCtx,frameCtx.layer);freezeDrawCount+=lk*ck;}
                corridorBatchCount++;corridorLogicalInstances+=lk*ck;return true;
            }
            function ensureArcBatch(index,lampNeed){
                let batch=arcBatchPool[index];if(!batch){batch={capacity:0,data:null,lampBuffers:[],uniformBuffer:null,uniformF32:null,uniformU32:null,uniformBindGroup:null,storageBindGroup:null,corridorBindGroup:null,copyBuffer:null,lampCount:0,copyCount:0,slot:0,table:null,arcScheduled:false};arcBatchPool[index]=batch;}
                const desired=performanceGovernor.stickyRingCount(3,batch.lampBuffers.length||3);
                if(lampNeed>batch.capacity||!batch.data){batch.capacity=performanceGovernor.capacityFor(lampNeed,batch.capacity,64,1.6);batch.data=new Float32Array(batch.capacity*ARC_LAMP_FLOATS);for(const b of batch.lampBuffers)try{b?.destroy?.();}catch(_){}batch.lampBuffers=[];batch.storageBindGroup=null;batch.corridorBindGroup=null;}
                while(batch.lampBuffers.length<desired)batch.lampBuffers.push(device.createBuffer({label:`Spiro Morph Arc lamp data ${index}:${batch.lampBuffers.length}`,size:Math.max(16,batch.capacity*ARC_LAMP_FLOATS*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));
                if(!batch.uniformBuffer){const ab=new ArrayBuffer(48);batch.uniformF32=new Float32Array(ab);batch.uniformU32=new Uint32Array(ab);batch.uniformBuffer=device.createBuffer({label:`Spiro Morph Arc lamp uniforms ${index}`,size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});}
                return batch;
            }
            function queueArcVisualPlan(ctx,visualPlan,alpha,drawPlan,prepared,copies=null,alphas=null,frameCtx=null){
                const items=visualPlan?.items,cfg=drawPlan?.config||visualPlan?.cfg||state.lamps||{},table=prepared?.gpuMorphArcTable,arcRec=table?._gpuMorphArcResource;
                if(!ready||!items?.length||alpha<=.001||!canUse(cfg)||!arcRec?.ready||!frameCtx)return false;
                const root=ctx?.getTransform?.();if(!root)return false;const corridor=Array.isArray(copies)&&copies.length>0;
                const batch=ensureArcBatch(arcBatchCount,items.length),style=drawPlan?.preparedStyle||visualPlan?.style||{};
                const softness=Math.max(0,Math.min(150,Number(style.effectiveSoftness)||0)),type=style.type||'whiteCore',typeCode=TYPE_CODE[type]??0;let lk=0;
                for(let i=0;i<items.length;i++){
                    const v=items[i],rad=Math.max(0,Number(v.rad)||0);if(rad<=.001)continue;const lampAlpha=Math.max(0,Math.min(1,alpha*(Number(v.intensityAlpha)||0)));if(lampAlpha<=.00001)continue;
                    const vb=Math.max(0,Math.min(200,Number(v.brightness)||0));let outerLocal=lampV261GradientOuterRadius(rad,softness,type,vb);if(type==='star')outerLocal=Math.max(outerLocal,rad*(2.15+.25*(1-Math.min(100,softness)/100))+6);
                    const body=Math.max(.03,Math.min(.93,rad/Math.max(.000001,outerLocal))),rgb=GPUColorCache.rgba(v.color||'#ffffff'),o=lk*ARC_LAMP_FLOATS;
                    batch.data[o]=Math.max(0,Math.floor(Number(v.pathIndex)||0));batch.data[o+1]=Math.max(0,Math.min(1,Number(v.lampAttachFraction)||0));batch.data[o+2]=Number.isFinite(Number(v.gpuLampOffsetX))?Number(v.gpuLampOffsetX):(Number(v.px)||0);batch.data[o+3]=Number.isFinite(Number(v.gpuLampOffsetY))?Number(v.gpuLampOffsetY):(Number(v.py)||0);
                    batch.data[o+4]=outerLocal;batch.data[o+5]=body;batch.data[o+6]=rgb[0];batch.data[o+7]=rgb[1];batch.data[o+8]=rgb[2];batch.data[o+9]=softness/100;batch.data[o+10]=vb/100;batch.data[o+11]=typeCode;batch.data[o+12]=lampAlpha;const directSeg=Number.isFinite(Number(v.gpuLampArcSegmentIndex));batch.data[o+13]=directSeg?1:0;batch.data[o+14]=directSeg?Math.max(0,Number(v.gpuLampArcSegmentIndex)||0):0;batch.data[o+15]=directSeg?Math.max(0,Math.min(1,Number(v.gpuLampArcSegmentT)||0)):0;lk++;
                }
                if(!lk)return true;const slot=lampFrameSerial%batch.lampBuffers.length,lampBuffer=batch.lampBuffers[slot];device.queue.writeBuffer(lampBuffer,0,batch.data.buffer,batch.data.byteOffset,lk*ARC_LAMP_FLOATS*4);arcAttachmentUploads+=lk*ARC_LAMP_FLOATS*4;
                const ra=Number(root.a)||0,rb=Number(root.b)||0,rc=Number(root.c)||0,rd=Number(root.d)||0,re=Number(root.e)||0,rf=Number(root.f)||0;
                batch.uniformF32[0]=width;batch.uniformF32[1]=height;batch.uniformU32[2]=lk;batch.uniformU32[3]=0;
                if(corridor){const frameRot=frameCtx.hasCombinedRotation?(Number(frameCtx.combinedRotationRad)||0):0,ct=Math.cos(frameRot),sn=Math.sin(frameRot),frameScale=frameCtx.hasCombinedScale?(Number(frameCtx.combinedScale)||0):1;batch.uniformF32[4]=(ra*ct+rc*sn)*frameScale;batch.uniformF32[5]=(-ra*sn+rc*ct)*frameScale;batch.uniformF32[6]=(rb*ct+rd*sn)*frameScale;batch.uniformF32[7]=(-rb*sn+rd*ct)*frameScale;batch.uniformF32[8]=re;batch.uniformF32[9]=rf;}
                else{batch.uniformF32[4]=ra;batch.uniformF32[5]=rc;batch.uniformF32[6]=rb;batch.uniformF32[7]=rd;batch.uniformF32[8]=re;batch.uniformF32[9]=rf;}
                batch.uniformF32[10]=Math.max(1,Number(arcRec.subdiv)||1);batch.uniformF32[11]=arcRec.morphRec?.cubicBuffer?1:0;device.queue.writeBuffer(batch.uniformBuffer,0,batch.uniformF32.buffer,0,48);
                const pipe=corridor?arcCorridorLampPipeline:arcLampPipeline;batch.uniformBindGroup=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:batch.uniformBuffer}}]});
                let copyBuffer=null,copyCount=0;if(corridor){const shared=WebGPUCorridorCopyStore.acquireRaw(device,hubGeneration,frameCtx,copies,alphas,'lamp',frameCtx.layer);if(!shared?.buffer||!shared.k)return false;copyBuffer=shared.buffer;copyCount=shared.k;}
                // The shared Arc WGSL references corridorCopyData behind a runtime branch, so auto-layout
                // keeps binding(1) even for the non-Corridor entry point. Supply a tiny resident dummy buffer
                // instead of creating an invalid 4-entry bind group (the browser expects bindings 0,1,2,3,5).
                const entries=[{binding:0,resource:{buffer:lampBuffer}},{binding:1,resource:{buffer:corridor?copyBuffer:dummyStorageBuffer}},{binding:2,resource:{buffer:arcRec.segmentBuffer}},{binding:3,resource:{buffer:arcRec.pathSegmentRangeBuffer}},{binding:5,resource:{buffer:arcRec.morphRec.cubicBuffer}}];
                const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(1),entries});if(corridor)batch.corridorBindGroup=bg;else batch.storageBindGroup=bg;
                batch.lampCount=lk;batch.copyCount=corridor?copyCount:1;batch.slot=slot;batch.table=table;batch.kind='arc';batch.arcScheduled=typeof spiroGpuEnsureArcPrerequisite==='function'&&spiroGpuEnsureArcPrerequisite(frameCtx,table);batch.corridor=corridor;
                if(freezeLightEnabled()){for(const n of [ra,rb,rc,rd,re,rf,Number(table?.gpuMorphT)||0])freezeFrameHash=lampHashMix(freezeFrameHash,n);mixFreezeCopies(copies,alphas,frameCtx,frameCtx.layer);freezeDrawCount+=lk*(corridor?copyCount:1);}
                arcBatchCount++;return true;
            }
            function queueTopologyVisualPlan(ctx,visualPlan,alpha,drawPlan,prepared,copies=null,alphas=null,frameCtx=null){
                const items=visualPlan?.items,cfg=drawPlan?.config||visualPlan?.cfg||state.lamps||{},top=prepared?.gpuLampTopologyResource;
                if(!ready||!items?.length||alpha<=.001||!canUse(cfg)||!top?.gpuReady||!top?.gpuBuffer||!frameCtx)return false;
                const root=ctx?.getTransform?.();if(!root)return false;const corridor=Array.isArray(copies)&&copies.length>0,batch=ensureArcBatch(arcBatchCount,items.length),style=drawPlan?.preparedStyle||visualPlan?.style||{};
                const softness=Math.max(0,Math.min(150,Number(style.effectiveSoftness)||0)),type=style.type||'whiteCore',typeCode=TYPE_CODE[type]??0;let lk=0;
                for(let i=0;i<items.length;i++){
                    const v=items[i],rad=Math.max(0,Number(v.rad)||0);if(rad<=.001)continue;const lampAlpha=Math.max(0,Math.min(1,alpha*(Number(v.intensityAlpha)||0)));if(lampAlpha<=.00001)continue;
                    const vb=Math.max(0,Math.min(200,Number(v.brightness)||0));let outerLocal=lampV261GradientOuterRadius(rad,softness,type,vb);if(type==='star')outerLocal=Math.max(outerLocal,rad*(2.15+.25*(1-Math.min(100,softness)/100))+6);const body=Math.max(.03,Math.min(.93,rad/Math.max(.000001,outerLocal))),rgb=GPUColorCache.rgba(v.color||'#ffffff'),o=lk*ARC_LAMP_FLOATS;
                    batch.data[o]=Math.max(0,Math.floor(Number(v.lampIdentityIndex)||0));batch.data[o+1]=0;batch.data[o+2]=Number(v.gpuLampOffsetX)||0;batch.data[o+3]=Number(v.gpuLampOffsetY)||0;batch.data[o+4]=outerLocal;batch.data[o+5]=body;batch.data[o+6]=rgb[0];batch.data[o+7]=rgb[1];batch.data[o+8]=rgb[2];batch.data[o+9]=softness/100;batch.data[o+10]=vb/100;batch.data[o+11]=typeCode;batch.data[o+12]=lampAlpha;batch.data[o+13]=0;batch.data[o+14]=0;batch.data[o+15]=0;lk++;
                }
                if(!lk)return true;const slot=lampFrameSerial%batch.lampBuffers.length,lampBuffer=batch.lampBuffers[slot];device.queue.writeBuffer(lampBuffer,0,batch.data.buffer,batch.data.byteOffset,lk*ARC_LAMP_FLOATS*4);arcAttachmentUploads+=lk*ARC_LAMP_FLOATS*4;
                const ra=Number(root.a)||0,rb=Number(root.b)||0,rc=Number(root.c)||0,rd=Number(root.d)||0,re=Number(root.e)||0,rf=Number(root.f)||0;batch.uniformF32[0]=width;batch.uniformF32[1]=height;batch.uniformU32[2]=lk;batch.uniformU32[3]=0;
                if(corridor){const frameRot=frameCtx.hasCombinedRotation?(Number(frameCtx.combinedRotationRad)||0):0,ct=Math.cos(frameRot),sn=Math.sin(frameRot),frameScale=frameCtx.hasCombinedScale?(Number(frameCtx.combinedScale)||0):1;batch.uniformF32[4]=(ra*ct+rc*sn)*frameScale;batch.uniformF32[5]=(-ra*sn+rc*ct)*frameScale;batch.uniformF32[6]=(rb*ct+rd*sn)*frameScale;batch.uniformF32[7]=(-rb*sn+rd*ct)*frameScale;batch.uniformF32[8]=re;batch.uniformF32[9]=rf;}
                else{batch.uniformF32[4]=ra;batch.uniformF32[5]=rc;batch.uniformF32[6]=rb;batch.uniformF32[7]=rd;batch.uniformF32[8]=re;batch.uniformF32[9]=rf;}batch.uniformF32[10]=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(prepared?.gpuMorphT):Math.max(0,Math.min(1,Number(prepared?.gpuMorphT)||0)));batch.uniformF32[11]=state?.morph?.mode==='calm'?1:0;device.queue.writeBuffer(batch.uniformBuffer,0,batch.uniformF32.buffer,0,48);
                const pipe=corridor?topologyCorridorLampPipeline:topologyLampPipeline;batch.uniformBindGroup=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:batch.uniformBuffer}}]});let copyBuffer=null,copyCount=0;if(corridor){const shared=WebGPUCorridorCopyStore.acquireRaw(device,hubGeneration,frameCtx,copies,alphas,'lamp',frameCtx.layer);if(!shared?.buffer||!shared.k)return false;copyBuffer=shared.buffer;copyCount=shared.k;}
                const entries=[{binding:0,resource:{buffer:lampBuffer}},{binding:1,resource:{buffer:corridor?copyBuffer:dummyStorageBuffer}},{binding:4,resource:{buffer:top.gpuBuffer}}];const bg=device.createBindGroup({layout:pipe.getBindGroupLayout(1),entries});if(corridor)batch.corridorBindGroup=bg;else batch.storageBindGroup=bg;
                batch.lampCount=lk;batch.copyCount=corridor?copyCount:1;batch.slot=slot;batch.table=null;batch.kind='topology';batch.arcScheduled=false;batch.corridor=corridor;
                if(freezeLightEnabled()){for(const n of [ra,rb,rc,rd,re,rf,Number(prepared?.gpuMorphT)||0])freezeFrameHash=lampHashMix(freezeFrameHash,n);mixFreezeCopies(copies,alphas,frameCtx,frameCtx.layer);freezeDrawCount+=lk*(corridor?copyCount:1);}
                arcBatchCount++;return true;
            }
            function queueVisualPlan(ctx,visualPlan,alpha,drawPlan){
                const items=visualPlan?.items,cfg=drawPlan?.config||visualPlan?.cfg||state.lamps||{};
                if(!ready||!items?.length||alpha<=.001||!canUse(cfg))return false;
                const tr=ctx.getTransform?.();if(!tr)return false;const scale=Math.hypot(Number(tr.a)||0,Number(tr.b)||0);if(!(scale>1e-9))return true;
                const style=drawPlan?.preparedStyle||visualPlan?.style||{};const softness=Math.max(0,Math.min(150,Number(style.effectiveSoftness)||0));
                const type=style.type||'whiteCore',typeCode=TYPE_CODE[type]??0;ensureCapacity(instanceCount+items.length);const freezeStartCount=instanceCount;
                for(let i=0;i<items.length;i++){
                    const v=items[i],rad=Math.max(0,Number(v.rad)||0);if(rad<=.001)continue;
                    const a=Math.max(0,Math.min(1,alpha*(Number(v.intensityAlpha)||0)));if(a<=.00001)continue;
                    const x=Number(v.px)||0,y=Number(v.py)||0;
                    const px=(Number(tr.a)||0)*x+(Number(tr.c)||0)*y+(Number(tr.e)||0),py=(Number(tr.b)||0)*x+(Number(tr.d)||0)*y+(Number(tr.f)||0);
                    const vb=Math.max(0,Math.min(200,Number(v.brightness)||0));let outerLocal=lampV261GradientOuterRadius(rad,softness,type,vb);
                    if(type==='star')outerLocal=Math.max(outerLocal,rad*(2.15+.25*(1-Math.min(100,softness)/100))+6);
                    const outer=Math.max(1,outerLocal*scale),body=Math.max(.03,Math.min(.93,(rad*scale)/outer));const rgb=GPUColorCache.rgba(v.color||'#ffffff');
                    const base=instanceCount*FLOATS_PER_INSTANCE;let o=base;instanceData[o++]=px;instanceData[o++]=py;instanceData[o++]=outer;instanceData[o++]=body;
                    instanceData[o++]=rgb[0];instanceData[o++]=rgb[1];instanceData[o++]=rgb[2];instanceData[o++]=softness/100;instanceData[o++]=vb/100;instanceData[o++]=typeCode;instanceData[o++]=a;for(let hi=0;hi<FLOATS_PER_INSTANCE;hi++)instanceFrameHash=lampHashMix(instanceFrameHash,instanceData[base+hi]);instanceCount++;
                }
                if(freezeLightEnabled()){freezeFrameHash=lampHashMix(freezeFrameHash,instanceFrameHash);for(const n of [Number(tr.a)||0,Number(tr.b)||0,Number(tr.c)||0,Number(tr.d)||0,Number(tr.e)||0,Number(tr.f)||0])freezeFrameHash=lampHashMix(freezeFrameHash,n);freezeDrawCount+=Math.max(0,instanceCount-freezeStartCount);}
                return true;
            }
            function compositeToMain(){
                if(!mainCtx||!mainCanvas||!canvas)return;mainCtx.save();mainCtx.setTransform(1,0,0,1,0,0);mainCtx.globalAlpha=1;mainCtx.filter='none';mainCtx.globalCompositeOperation='lighter';mainCtx.drawImage(canvas,0,0,mainCanvas.width,mainCanvas.height);mainCtx.restore();
            }
            function flush(options={}){
                if(!ready||lost||!device||!context||!hdrTexture||!toneTexture)return false;
                const hasCurrent=instanceCount>0||corridorBatchCount>0||arcBatchCount>0,freezeEnabled=freezeLightEnabled(),now=Number(frameNow)||performance.now();
                let signatureChanged=false;
                if(freezeEnabled){
                    signatureChanged=freezeFrameHash!==freezeLastFrameHash||freezeDrawCount!==freezeLastDrawCount;
                    if(signatureChanged){freezeLastMotionAt=now;if(hasCurrent||freezeHistoryValid)armFreezeTail();}
                    freezeLastFrameHash=freezeFrameHash;freezeLastDrawCount=freezeDrawCount;
                }else if(freezeHistoryValid||freezeLastDrawCount>=0)resetFreezeLight();
                const tailSeconds=freezeTailSec(),tailEnd=freezeLastMotionAt+tailSeconds*1000,trailNeedsFrame=freezeEnabled&&freezeHistoryValid&&now<=tailEnd+1;
                if(!hasCurrent&&!trailNeedsFrame){if(freezeEnabled&&freezeHistoryValid&&now>tailEnd){freezeHistoryValid=false;freezeLastRenderAt=0;try{animationScheduler?.remove?.('lamp-freezelight');}catch(_){}}lastFlushMode='empty';lastToneValid=false;deferredComposite=false;deferredCommandBuffer=null;deferredCommandGeneration=0;return true;}
                const deferComposite=options?.deferComposite===true;
                try{
                    if(freezeEnabled&&!ensureFreezeHistoryResources())throw new Error('FreezeLight history allocation failed');
                    let ringBuffer=null;if(instanceCount>0){ensureCapacity(instanceCount);const floatCount=instanceCount*FLOATS_PER_INSTANCE,byteCount=floatCount*4;const unchanged=!!lastInstanceBuffer&&lastInstanceCount===instanceCount&&lastInstanceHash===instanceFrameHash&&sameLampF32(instanceData,lastInstanceSnapshot,floatCount);if(unchanged){ringBuffer=lastInstanceBuffer;instanceUploadSkips++;instanceUploadBytesAvoided+=byteCount;}else{ringBuffer=instanceBuffers[lampFrameSerial%instanceBuffers.length];device.queue.writeBuffer(ringBuffer,0,instanceData.buffer,0,byteCount);instanceUploadBytes+=byteCount;if(!lastInstanceSnapshot||lastInstanceSnapshot.length<floatCount)lastInstanceSnapshot=new Float32Array(Math.max(floatCount,capacity*FLOATS_PER_INSTANCE));lastInstanceSnapshot.set(instanceData.subarray(0,floatCount),0);lastInstanceHash=instanceFrameHash;lastInstanceCount=instanceCount;lastInstanceBuffer=ringBuffer;}}
                    const encoder=device.createCommandEncoder({label:'Spiro lamp frame'}),localArcTables=[],encodedArc=new WeakSet();
                    for(let ai=0;ai<arcBatchCount;ai++){
                        const batch=arcBatchPool[ai];if(batch?.kind==='topology')continue;const table=batch?.table,rec=table?._gpuMorphArcResource,t=(typeof morphInterpolationTForCurrentMode==='function'?morphInterpolationTForCurrentMode(table?.gpuMorphT):Math.max(0,Math.min(1,Number(table?.gpuMorphT)||0)));if(!rec?.ready)continue;
                        const committed=rec.hasCommittedData&&rec.lastCommittedT===t;if(committed)continue;
                        // A scheduler prerequisite is safe only when the Lamp command is deferred into
                        // the same ordered final submit. Immediate Lamp presentation must fuse Arc locally.
                        if(deferComposite&&batch.arcScheduled){arcScheduledReuses++;continue;}
                        if(encodedArc.has(rec))continue;if(typeof encodeGpuMorphArcTable!=='function'||!encodeGpuMorphArcTable(table,encoder))throw new Error('Morph Arc Lamp prerequisite encode failed');encodedArc.add(rec);localArcTables.push(table);arcPrerequisiteFusions++;
                    }
                    const hdrPass=encoder.beginRenderPass({label:'Spiro lamp HDR accumulation',colorAttachments:[{view:hdrView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                    if(instanceCount>0){hdrPass.setPipeline(lampPipeline);hdrPass.setBindGroup(0,lampBindGroup);hdrPass.setVertexBuffer(0,cornerBuffer);hdrPass.setVertexBuffer(1,ringBuffer);hdrPass.draw(4,instanceCount,0,0);}
                    for(let bi=0;bi<corridorBatchCount;bi++){const batch=corridorBatchPool[bi];if(!batch?.lampCount||!batch?.copyCount)continue;hdrPass.setPipeline(corridorLampPipeline);hdrPass.setBindGroup(0,batch.uniformBindGroup);hdrPass.setBindGroup(1,batch.activeBindGroup||batch.storageBindGroups[batch.slot]);hdrPass.setVertexBuffer(0,cornerBuffer);hdrPass.draw(4,batch.lampCount*batch.copyCount,0,0);corridorDraws++;}
                    for(let ai=0;ai<arcBatchCount;ai++){const batch=arcBatchPool[ai];if(!batch?.lampCount)continue;const topology=batch.kind==='topology';if(!topology&&!batch?.table)continue;hdrPass.setPipeline(topology?(batch.corridor?topologyCorridorLampPipeline:topologyLampPipeline):(batch.corridor?arcCorridorLampPipeline:arcLampPipeline));hdrPass.setBindGroup(0,batch.uniformBindGroup);hdrPass.setBindGroup(1,batch.corridor?batch.corridorBindGroup:batch.storageBindGroup);hdrPass.setVertexBuffer(0,cornerBuffer);hdrPass.draw(4,batch.lampCount*Math.max(1,batch.copyCount),0,0);if(topology){if(batch.corridor)topologyCorridorDraws++;else topologyDraws++;}else if(batch.corridor)arcCorridorDraws++;else arcDraws++;}
                    hdrPass.end();

                    let activeToneBindGroup=toneBindGroups[0],clearHistoryAfterFrame=false;
                    if(freezeEnabled){
                        const wasHistoryValid=freezeHistoryValid,previous=freezeHistoryIndex,next=1-previous;
                        const dt=wasHistoryValid&&freezeLastRenderAt>0?Math.max(0,(now-freezeLastRenderAt)/1000):0;
                        let decay=wasHistoryValid?Math.pow(.02,dt/tailSeconds):0;
                        // Tail length is a real end time: after it expires the next feedback frame
                        // contains only the current lamps (or transparent black when lamps vanished).
                        if(!wasHistoryValid||(!signatureChanged&&now>=tailEnd))decay=0;
                        freezeUniformData[0]=decay;freezeUniformData[1]=freezeUniformData[2]=freezeUniformData[3]=0;device.queue.writeBuffer(freezeUniformBuffer,0,freezeUniformData);
                        const freezePass=encoder.beginRenderPass({label:'Somata FreezeLight feedback',colorAttachments:[{view:freezeHistoryViews[next],clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
                        freezePass.setPipeline(freezePipeline);freezePass.setBindGroup(0,freezeBindGroups[previous]);freezePass.draw(3,1,0,0);freezePass.end();
                        freezeHistoryIndex=next;freezeHistoryValid=true;freezeLastRenderAt=now;freezeFrames++;activeToneBindGroup=toneBindGroups[1+freezeHistoryIndex];
                        if(!hasCurrent&&!signatureChanged&&now>=tailEnd)clearHistoryAfterFrame=true;
                    }
                    const tonePass=encoder.beginRenderPass({label:'Spiro lamp tone',colorAttachments:[{view:toneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});tonePass.setPipeline(tonePipeline);tonePass.setBindGroup(0,activeToneBindGroup);tonePass.draw(3,1,0,0);tonePass.end();
                    if(clearHistoryAfterFrame){freezeHistoryValid=false;freezeLastRenderAt=0;try{animationScheduler?.remove?.('lamp-freezelight');}catch(_){}}
                    lastToneValid=true;deferredComposite=deferComposite;
                    const freezeSuffix=freezeEnabled?'+freezelight':'';
                    if(deferComposite){
                        // Finish now so the final compositor can submit lamp + presentation command
                        // buffers in one ordered queue.submit(). No GPU work is launched yet.
                        deferredCommandBuffer=encoder.finish();deferredCommandGeneration=hubGeneration;deferredLocalArcTables=localArcTables.slice();directSceneFrames++;
                        lastFlushMode=(corridorBatchCount>0?'webgpu-rgba16f+corridor-instanced+scene-direct':'webgpu-rgba16f+scene-direct')+freezeSuffix+'+queued';
                    }else{
                        encoder.copyTextureToTexture({texture:toneTexture},{texture:context.getCurrentTexture()},[width,height,1]);device.queue.submit([encoder.finish()]);submissions++;for(const table of localArcTables)try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}deferredLocalArcTables=[];deferredCommandBuffer=null;deferredCommandGeneration=0;
                        compositeToMain();lastFlushMode=(corridorBatchCount>0?'webgpu-rgba16f+corridor-instanced':'webgpu-rgba16f')+freezeSuffix;
                    }
                    return true;
                }catch(err){deferredCommandBuffer=null;deferredCommandGeneration=0;lastError=String(err?.message||err);lastFlushMode='failed';ready=false;attempted=false;requestMainCanvasRender();return false;}
            }
            function getCompositeTexture(){return deferredComposite&&lastToneValid&&toneTexture?{texture:toneTexture,width,height,generation:hubGeneration}:null;}
            function getDeferredCommandBuffer(){return deferredComposite&&deferredCommandBuffer&&deferredCommandGeneration===hubGeneration?deferredCommandBuffer:null;}
            function markDeferredSubmitted(){if(!deferredComposite)return;for(const table of deferredLocalArcTables)try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}deferredLocalArcTables=[];deferredCommandBuffer=null;deferredCommandGeneration=0;deferredComposite=false;mergedFrameSubmissions++;lastFlushMode=lastFlushMode.replace('+queued','+merged-submit');}
            function presentDeferredToMain(){if(!deferredComposite||!lastToneValid||!toneTexture)return true;try{const encoder=device.createCommandEncoder({label:'Spiro lamp deferred fallback present'});encoder.copyTextureToTexture({texture:toneTexture},{texture:context.getCurrentTexture()},[width,height,1]);const copyCommand=encoder.finish(),lampCommand=getDeferredCommandBuffer();device.queue.submit(lampCommand?[lampCommand,copyCommand]:[copyCommand]);submissions++;for(const table of deferredLocalArcTables)try{noteGpuMorphArcTableSubmitted?.(table);}catch(_){}deferredLocalArcTables=[];deferredCommandBuffer=null;deferredCommandGeneration=0;compositeToMain();deferredComposite=false;fallbackPresentFrames++;lastFlushMode=lastFlushMode.replace('+queued','')+'→fallback-main';return true;}catch(err){deferredCommandBuffer=null;deferredCommandGeneration=0;lastError=String(err?.message||err);return false;}}
            function hasDeferredComposite(){return deferredComposite&&lastToneValid&&!!toneTexture;}
            function clear(){instanceCount=0;corridorBatchCount=0;arcBatchCount=0;deferredLocalArcTables=[];lastFlushMode='none';lastToneValid=false;deferredComposite=false;deferredCommandBuffer=null;deferredCommandGeneration=0;resetFreezeLight();}
            function status(){warmup();return{supported:!!navigator?.gpu,attempted,initializing,available:ready&&!lost&&WebGPUDeviceHub.isReady(),lost,lastError,width,height,instances:instanceCount,submissions,lastFlushMode,storageMode:'rgba16float',ringBuffers:instanceBuffers.length,frameSerial:lampFrameSerial,persistentTextureViews:Boolean(hdrView&&toneView),deferredComposite:hasDeferredComposite(),deferredCommandBuffer:Boolean(getDeferredCommandBuffer()),directSceneFrames,mergedFrameSubmissions,fallbackPresentFrames,residentPayloads:{instanceUploadBytes,instanceUploadSkips,instanceUploadBytesAvoided,policy:'exact payload reuse keeps prior ring slot resident when vector lamps are unchanged'},corridor:{batches:corridorBatchCount,logicalInstances:corridorLogicalInstances,lampUploadBytes:corridorLampUploads,lampUploadSkips:corridorLampUploadSkips,lampUploadBytesAvoided:corridorLampUploadBytesAvoided,uniformUploads:corridorUniformUploads,uniformUploadSkips:corridorUniformUploadSkips,copyUploadBytes:corridorCopyUploads,sharedCopyReuse:corridorSharedCopyReuse,sharedCopyAvoidedBytes:corridorSharedCopyAvoidedBytes,draws:corridorDraws,fallbacks:corridorFallbacks},arcNative:{batches:arcBatchCount,draws:arcDraws,corridorDraws:arcCorridorDraws,attachmentUploadBytes:arcAttachmentUploads,prerequisiteFusions:arcPrerequisiteFusions,scheduledReuses:arcScheduledReuses,policy:'bounded arbitrary lamp style records; xy sampled from resident exact Morph Arc in vertex shader'},topologyIdentity:{draws:topologyDraws,corridorDraws:topologyCorridorDraws,policy:'phase-resident Key lamp source/target identity; WGSL interpolates Dynamic/Smooth topology positions while CPU supplies only bounded handoff/style offsets'},freezeLight:{enabled:freezeLightEnabled(),tailSec:freezeTailSec(),historyValid:freezeHistoryValid,historyIndex:freezeHistoryIndex,frames:freezeFrames,resets:freezeResets,lastMotionAt:freezeLastMotionAt,policy:'ping-pong rgba16float; max(current, exponentially decayed history); hard cleanup at configured tail length'},arcBindGroupDummyStorage:Boolean(dummyStorageBuffer),hub:WebGPUDeviceHub.status()};}
            return{warmup,ensureReady,isReady:()=>warmup(),beginFrame,canUse,queueVisualPlan,queueCorridorVisualPlan,queueArcVisualPlan,queueTopologyVisualPlan,flush,getCompositeTexture,getDeferredCommandBuffer,markDeferredSubmitted,presentDeferredToMain,hasDeferredComposite,resetFreezeLight,clear,status};
        })();

        // v325 — stable lamp facade; WebGPU additionally supports two-dimensional Corridor lamp instancing.
        // v319 — stable lamp facade.  A frame chooses WebGPU only after the backend is fully
        // ready.  If a WebGPU flush unexpectedly fails, a repaint is requested and the
        // next frame falls through to the proven WebGL2/Canvas path without hot-path mirroring.
        const LampGPURenderer=(()=>{
            let active='none';
            function beginFrame(w,h,now=performance.now()){
                WebGPULampRenderer.warmup();
                if(WebGPULampRenderer.isReady()&&WebGPULampRenderer.beginFrame(w,h,now)){active='webgpu';return true;}
                active='webgl2';return LampWebGLRenderer.beginFrame(w,h);
            }
            function queueVisualPlan(ctx,visualPlan,alpha,drawPlan){
                return active==='webgpu'?WebGPULampRenderer.queueVisualPlan(ctx,visualPlan,alpha,drawPlan):LampWebGLRenderer.queueVisualPlan(ctx,visualPlan,alpha,drawPlan);
            }
            function queueCorridorVisualPlan(ctx,visualPlan,alpha,drawPlan,copies,alphas,frameCtx){if(active!=='webgpu')return false;return WebGPULampRenderer.queueCorridorVisualPlan(ctx,visualPlan,alpha,drawPlan,copies,alphas,frameCtx);}
            function queueArcVisualPlan(ctx,visualPlan,alpha,drawPlan,prepared,copies=null,alphas=null,frameCtx=null){if(active!=='webgpu')return false;return WebGPULampRenderer.queueArcVisualPlan(ctx,visualPlan,alpha,drawPlan,prepared,copies,alphas,frameCtx);}
            function queueTopologyVisualPlan(ctx,visualPlan,alpha,drawPlan,prepared,copies=null,alphas=null,frameCtx=null){if(active!=='webgpu')return false;return WebGPULampRenderer.queueTopologyVisualPlan(ctx,visualPlan,alpha,drawPlan,prepared,copies,alphas,frameCtx);}
            function isWebGPUReady(){return active==='webgpu'&&WebGPULampRenderer.isReady?.()===true;}
            async function ensureWebGPUReady(){const ok=await WebGPULampRenderer.ensureReady?.();if(ok===true){active='webgpu';return true;}return false;}
            function flush(options={}){
                if(active!=='webgpu')return LampWebGLRenderer.flush();
                const ok=WebGPULampRenderer.flush(options);
                // Device/pipeline failures request a repaint; the next frame immediately falls
                // through to WebGL2/Canvas.  Avoid mirroring every lamp plan each normal frame,
                // which would double getTransform() work and allocate recovery records in the hot path.
                if(!ok)active='webgpu-recovering';
                return ok;
            }
            function getCompositeTexture(){return active==='webgpu'?WebGPULampRenderer.getCompositeTexture():null;}
            function getDeferredCommandBuffer(){return active==='webgpu'?WebGPULampRenderer.getDeferredCommandBuffer():null;}
            function markDeferredSubmitted(){if(active==='webgpu')WebGPULampRenderer.markDeferredSubmitted();}
            function presentDeferredToMain(){return active==='webgpu'?WebGPULampRenderer.presentDeferredToMain():true;}
            function hasDeferredComposite(){return active==='webgpu'&&WebGPULampRenderer.hasDeferredComposite();}
            function resetFreezeLight(){WebGPULampRenderer.resetFreezeLight?.();}
            function clear(){active='none';WebGPULampRenderer.clear();LampWebGLRenderer.clear();}
            function status(){return{active,webgpu:WebGPULampRenderer.status(),webgl2:LampWebGLRenderer.status()};}
            return{beginFrame,queueVisualPlan,queueCorridorVisualPlan,queueArcVisualPlan,queueTopologyVisualPlan,isWebGPUReady,ensureWebGPUReady,flush,getCompositeTexture,getDeferredCommandBuffer,markDeferredSubmitted,presentDeferredToMain,hasDeferredComposite,resetFreezeLight,clear,status};
        })();
        window.__spiroLampGPUStatus=()=>LampGPURenderer.status();
